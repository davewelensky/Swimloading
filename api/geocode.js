// /api/geocode — location search for the Spot Contribution system.
//
// WHY A PROXY AND NOT CLIENT-SIDE CALLS
// -------------------------------------
// The provider today is OpenStreetMap's Nominatim (free, no key), the same
// service scripts/geocode-venues.mjs already uses. Its usage policy requires
// an identifying User-Agent and at most 1 request/second — neither of which
// a browser can promise. Routing through this function means:
//   - one place sets the User-Agent/contact,
//   - identical queries hit Vercel's edge cache instead of Nominatim,
//   - the provider can be swapped (Mapbox, Google, Photon) by replacing
//     PROVIDER below without touching admin.html or app.js.
//
// RESPONSE SHAPE (stable contract for admin.html + app.js — keep it if the
// provider changes):
//   { results: [{ lat, lng, label, name, locality, admin_area, country,
//                 country_code, kind }] }
//
// No secrets involved. If a paid provider is ever introduced, its key stays
// server-side here — never in client code.

const CONTACT = process.env.GEOCODE_CONTACT || 'https://www.swimloading.com';
const USER_AGENT = `SwimLoading/1.0 (spot contribution; ${CONTACT})`;

// Feature classes that make sense as a swim location pin. Streets and shops
// with matching names are the classic wrong-beach failure — exclude them.
// (Same reasoning as scripts/geocode-venues.mjs, slightly wider because a
// named pool/lido can be a leisure or amenity feature.)
const ACCEPTABLE_CLASSES = new Set([
  'place', 'natural', 'water', 'waterway', 'leisure', 'boundary', 'landuse', 'amenity', 'tourism',
]);

const nominatim = {
  async search(q, limit) {
    const url = new URL('https://nominatim.openstreetmap.org/search');
    url.searchParams.set('q', q);
    url.searchParams.set('format', 'jsonv2');
    url.searchParams.set('limit', String(Math.min(limit * 2, 10))); // fetch extra, filter below
    url.searchParams.set('addressdetails', '1');

    const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT, 'Accept-Language': 'en' } });
    if (!res.ok) throw new Error(`geocoder ${res.status}`);
    const rows = await res.json();

    return (Array.isArray(rows) ? rows : [])
      .filter((r) => ACCEPTABLE_CLASSES.has(r.category || r.class))
      .slice(0, limit)
      .map((r) => {
        const a = r.address || {};
        return {
          lat: parseFloat(r.lat),
          lng: parseFloat(r.lon),
          label: r.display_name || '',
          name: r.name || (r.display_name || '').split(',')[0] || '',
          locality: a.city || a.town || a.village || a.suburb || a.municipality || null,
          admin_area: a.state || a.province || a.state_district || a.county || null,
          country: a.country || null,
          country_code: a.country_code ? a.country_code.toUpperCase() : null,
          kind: [r.category || r.class, r.type].filter(Boolean).join('/'),
        };
      });
  },
};

const PROVIDER = nominatim;

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'GET only' });
    return;
  }

  const q = String(req.query.q || '').trim().slice(0, 200);
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 5, 1), 8);
  if (q.length < 2) {
    res.status(400).json({ error: 'q must be at least 2 characters' });
    return;
  }

  try {
    const results = await PROVIDER.search(q, limit);
    // Long edge cache: place names do not move. Repeated searches for the
    // same text are served by Vercel, not Nominatim — this is most of our
    // politeness budget.
    res.setHeader('Cache-Control', 'public, s-maxage=604800, stale-while-revalidate=86400');
    res.status(200).json({ results });
  } catch (err) {
    res.setHeader('Cache-Control', 'no-store');
    res.status(502).json({ error: 'geocoding unavailable', detail: String(err.message || err) });
  }
}
