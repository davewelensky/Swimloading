// Single source of truth for schema.org SportsEvent JSON-LD.
//
// Rule: every property is emitted only when a real value backs it. Nothing
// here has a default, a placeholder or a "good enough" fallback — Google would
// repeat a wrong price, organiser or date long after we corrected it, so an
// absent property is always preferable to a guessed one.
//
// Deliberately NOT produced, ever:
//   performer  — an open-water race has no performer in the schema.org sense.
//   organizer  — unless the caller passes the real organising body. SwimLoading
//                lists and analyses events; it is not their organiser.

const SITE = 'https://www.swimloading.com';

const present = (v) => v !== undefined && v !== null && !(typeof v === 'string' && v.trim() === '');

/** Recursively drop undefined / null / empty strings / empty objects. */
function prune(value) {
  if (Array.isArray(value)) {
    const arr = value.map(prune).filter((v) => v !== undefined);
    return arr.length ? arr : undefined;
  }
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      const p = prune(v);
      if (p !== undefined) out[k] = p;
    }
    return Object.keys(out).length ? out : undefined;
  }
  return present(value) ? value : undefined;
}

/** Plain http(s) only; anything else (javascript:, data:) is dropped. */
export function httpUrl(u, { httpsOnly = false } = {}) {
  if (!present(u)) return undefined;
  try {
    const p = new URL(u);
    if (p.protocol === 'https:' || (!httpsOnly && p.protocol === 'http:')) return p.toString();
  } catch { /* fall through */ }
  return undefined;
}

// YYYY-MM-DD, or a full ISO 8601 date-time WITH an explicit offset/Z. A
// date-time without an offset is rejected: we never guess a timezone.
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;
export function isoDate(v) {
  if (!present(v)) return undefined;
  const s = String(v).trim();
  const ok = (ISO_DATE.test(s) || ISO_DATETIME.test(s)) && !Number.isNaN(Date.parse(s));
  return ok ? s : undefined;
}

function buildOffers(offers) {
  const built = (offers || []).map((o) => {
    const url = httpUrl(o.url);
    if (!url) return undefined;            // no real registration URL → no offer
    const price = Number(o.price);
    const hasPrice = present(o.price) && Number.isFinite(price) && price >= 0 &&
      typeof o.currency === 'string' && /^[A-Z]{3}$/.test(o.currency);
    return {
      '@type': 'Offer',
      name: o.name,
      url,
      ...(hasPrice ? { price: String(price), priceCurrency: o.currency } : {}),
      availability: o.availability,
    };
  }).filter(Boolean);
  if (!built.length) return undefined;
  return built.length === 1 ? built[0] : built;
}

/**
 * @param {object} e
 *   name, url (canonical), startDate, endDate, description, images[],
 *   status (schema.org URL), venue{name,city,region,country,lat,lng},
 *   organizer{name,url}, offers[{url,price,currency,name,availability}]
 * @returns {object|null} null when the minimum viable event is not known.
 */
export function buildSportsEvent(e) {
  const startDate = isoDate(e.startDate);
  const name = present(e.name) ? String(e.name).trim() : undefined;
  const venueName = e.venue && present(e.venue.name) ? e.venue.name : undefined;
  if (!name || !startDate || !venueName) return null;

  const v = e.venue;
  const endDate = isoDate(e.endDate);
  const images = (e.images || []).map((u) => httpUrl(u, { httpsOnly: true })).filter(Boolean);

  const data = {
    '@context': 'https://schema.org',
    '@type': 'SportsEvent',
    name,
    description: present(e.description) ? String(e.description).trim() : undefined,
    url: httpUrl(e.url),
    image: images.length ? images : undefined,
    startDate,
    // Never calculated: only a stored end date that is not before the start.
    endDate: endDate && endDate >= startDate ? endDate : undefined,
    eventStatus: e.status || 'https://schema.org/EventScheduled',
    eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
    location: {
      '@type': 'Place',
      name: venueName,
      address: [v.city, v.region, v.country].some(present) ? {
        '@type': 'PostalAddress',
        addressLocality: v.city,
        addressRegion: v.region,
        addressCountry: v.country,
      } : undefined,
      geo: Number.isFinite(v.lat) && Number.isFinite(v.lng)
        ? { '@type': 'GeoCoordinates', latitude: v.lat, longitude: v.lng } : undefined,
    },
    organizer: e.organizer && present(e.organizer.name)
      ? { '@type': 'Organization', name: e.organizer.name, url: httpUrl(e.organizer.url) }
      : undefined,
    offers: buildOffers(e.offers),
  };
  return prune(data);
}

/**
 * Serialise for a <script type="application/ld+json"> block. JSON.stringify
 * alone is not safe inside HTML: "</script>" ends the block, and U+2028/2029
 * are legal JSON but break some parsers. Event names/venues come off
 * crawled third-party pages, so treat them as hostile.
 */
export function ldJsonScript(obj) {
  if (!obj) return '';
  const json = JSON.stringify(obj)
    .replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  return `<script type="application/ld+json">${json}</script>`;
}

export { SITE };
