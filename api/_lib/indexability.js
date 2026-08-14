// Whether a public page is worth putting in front of Google.
//
// WHY A GATE AT ALL. There are 194 active spots and the catalogue is meant
// to grow automatically. Indexing every row the moment it exists is how a
// site acquires thousands of near-empty pages, and thin pages do not just
// fail to rank — they drag down the pages that do. The sitemap currently
// lists every active spot at priority 0.9 with no test applied, which is
// the failure mode this exists to close.
//
// THE RULE IS "ENOUGH TO ANSWER THE QUERY". A spot page ranks for
// "<place> water temperature". To deserve that it must at minimum be a
// real named place, locatable, of a known water type, and have something
// to say about its water. A row with a name and nothing else is a
// database record, not an answer.
//
// Failing the gate is NOT deletion and NOT a 404. The page still renders
// and still works inside the app; it is served `noindex, follow` and left
// out of the sitemap, so its links still pass to pages that do qualify.

export const INDEXABILITY_RULES = {
  spot: {
    // A temperature reading older than this tells a swimmer nothing about
    // the water today, so it does not count towards qualifying.
    temperatureMaxAgeDays: 30,
  },
  crossing: {
    minDistanceKm: 0,
  },
  event: {
    // A date a reader cannot act on is not an answer. 'exact' and 'range'
    // both tell a swimmer when to turn up; 'month' and 'year' do not.
    usableDatePrecision: ['exact', 'range'],
    // Statuses a public, indexable listing may have. 'cancelled' and
    // 'completed' still render — people search for last year's race — but
    // they are not what a search for an upcoming swim should return.
    indexableStatuses: ['announced', 'entries_open', 'entries_closed'],
    // 'unverified' is a raw discovery candidate: found by a crawler and
    // not yet stood behind by anyone. Those must never reach the index.
    excludedVerificationTiers: ['unverified'],
    minTitleLength: 3,
  },
};

function nonEmpty(v) {
  return typeof v === 'string' ? v.trim().length > 0 : v !== null && v !== undefined;
}

function hasCoords(r) {
  const lat = Number(r?.latitude ?? r?.start_lat);
  const lng = Number(r?.longitude ?? r?.start_lng);
  return Number.isFinite(lat) && Number.isFinite(lng) && !(lat === 0 && lng === 0);
}

/**
 * @returns {{ indexable: boolean, reasons: string[], missing: string[] }}
 *   `reasons` always explains the verdict — a gate whose decisions cannot
 *   be inspected becomes a mystery the first time a page is missing.
 */
export function isPublicPageIndexable(record, kind, opts = {}) {
  const now = opts.now instanceof Date ? opts.now : new Date();
  if (!record || typeof record !== 'object') {
    return { indexable: false, reasons: ['no record'], missing: ['record'] };
  }

  if (kind === 'spot') return spotIndexable(record, now);
  if (kind === 'crossing') return crossingIndexable(record);
  if (kind === 'event') return eventIndexable(record, now);
  // An unknown kind is not a licence to index. Say so rather than defaulting
  // to true and quietly publishing something nobody designed a rule for.
  return { indexable: false, reasons: [`no indexability rule for kind "${kind}"`], missing: [] };
}

function spotIndexable(spot, now) {
  const missing = [];
  if (!nonEmpty(spot.name)) missing.push('name');
  if (!hasCoords(spot)) missing.push('coordinates');
  if (!nonEmpty(spot.country_code)) missing.push('country_code');
  if (!nonEmpty(spot.water_type)) missing.push('water_type');

  // Something to say about the water: a reading recent enough to be
  // meaningful, or a modelled estimate, or human context (an area, a note).
  const ageDays = spot.temp_observed_at
    ? (now.getTime() - new Date(spot.temp_observed_at).getTime()) / 86_400_000
    : null;
  // isNumber, not Number.isFinite(Number(x)) — Number(null) is 0, which is
  // finite, so a spot with NO estimate was reading as one with an estimate
  // of 0°C and passing the gate on the strength of a value that does not
  // exist. Caught by test on 2026-08-14.
  const isNumber = (v) => v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v));
  const hasUsableTemp =
    isNumber(spot.temp_c) &&
    ageDays !== null && Number.isFinite(ageDays) &&
    ageDays >= 0 && ageDays <= INDEXABILITY_RULES.spot.temperatureMaxAgeDays;
  const hasEstimate = isNumber(spot.estimate_c);
  // A temperature HISTORY is also something to say about the water. An
  // inland pool gets no marine model and may go months between logs, but
  // a page with a season of past readings still answers "how cold is this
  // pool usually" — which is the query it ranks for. Counting only recent
  // readings is the same over-gating that held back 67 real beaches when
  // this rule was first written.
  const hasHistory = spot.has_readings === true || isNumber(spot.reading_count) && Number(spot.reading_count) > 0;
  const hasContext = nonEmpty(spot.area) || nonEmpty(spot.meet_note);

  if (!hasUsableTemp && !hasEstimate && !hasHistory && !hasContext) missing.push('temperature, history or descriptive context');

  if (spot.active === false) {
    return { indexable: false, reasons: ['spot is not active'], missing };
  }
  if (missing.length > 0) {
    return { indexable: false, reasons: [`thin: missing ${missing.join(', ')}`], missing };
  }
  return {
    indexable: true,
    reasons: [hasUsableTemp ? 'has a recent temperature reading'
      : hasEstimate ? 'has a modelled temperature'
      : hasHistory ? 'has logged temperature history'
      : 'has descriptive context'],
    missing: [],
  };
}

function crossingIndexable(c) {
  const missing = [];
  if (!nonEmpty(c.name)) missing.push('name');
  if (!nonEmpty(c.slug)) missing.push('slug');
  // A crossing page's whole job is answering "how far is X". Without a
  // distance there is no page.
  if (!Number.isFinite(Number(c.distance_km)) || Number(c.distance_km) <= INDEXABILITY_RULES.crossing.minDistanceKm) {
    missing.push('distance_km');
  }
  if (c.is_active === false) {
    return { indexable: false, reasons: ['crossing is not active'], missing };
  }
  if (missing.length > 0) {
    return { indexable: false, reasons: [`thin: missing ${missing.join(', ')}`], missing };
  }
  return { indexable: true, reasons: ['has a name, slug and distance'], missing: [] };
}

/**
 * Events are DISCOVERED, not authored — a crawler proposes them and most
 * are never touched by a human. That makes them the one page type where
 * "a row exists" is furthest from "this is worth putting in front of a
 * swimmer", so the gate is correspondingly strict: a real name, a place, a
 * date precise enough to act on, a canonical slug, and someone standing
 * behind it.
 *
 * Failing is not deletion. The record stays, the page still renders for
 * anyone holding the link, and it is served noindex,follow — a listing we
 * have not verified must not be the thing Google shows a swimmer planning
 * their season.
 *
 * `record.venue` may be the joined event_venues row (or the edition may
 * carry venue_country_code / venue_latitude directly) — both shapes are
 * accepted so callers need not reshape their query.
 */
function eventIndexable(ev, now) {
  const rules = INDEXABILITY_RULES.event;
  const missing = [];

  if (!nonEmpty(ev.title) || String(ev.title).trim().length < rules.minTitleLength) missing.push('title');
  // Canonical identity: without a slug there is no stable URL to index.
  if (!nonEmpty(ev.slug)) missing.push('slug');

  // Location: a venue with at least a country, or usable coordinates.
  const venue = ev.venue || ev.event_venues || {};
  const hasCountry = nonEmpty(ev.venue_country_code) || nonEmpty(venue.country_code);
  const hasVenueCoords = hasCoords({
    latitude: ev.venue_latitude ?? venue.latitude,
    longitude: ev.venue_longitude ?? venue.longitude,
  });
  const hasVenueId = nonEmpty(ev.venue_id);
  if (!hasCountry && !hasVenueCoords && !hasVenueId) missing.push('location');

  // Date, and a precision a swimmer can act on.
  if (!nonEmpty(ev.start_date)) {
    missing.push('start_date');
  } else if (nonEmpty(ev.date_precision) && !rules.usableDatePrecision.includes(ev.date_precision)) {
    missing.push(`date precision "${ev.date_precision}"`);
  }

  if (!nonEmpty(ev.discipline)) missing.push('discipline');

  // Explicit editorial opt-out always wins.
  if (ev.is_indexable === false) {
    return { indexable: false, reasons: ['is_indexable is false'], missing };
  }
  if (nonEmpty(ev.status) && !rules.indexableStatuses.includes(ev.status)) {
    return { indexable: false, reasons: [`status is "${ev.status}"`], missing };
  }
  if (nonEmpty(ev.verification_tier) && rules.excludedVerificationTiers.includes(ev.verification_tier)) {
    return { indexable: false, reasons: [`verification tier is "${ev.verification_tier}"`], missing };
  }
  // A finished event is not a candidate for "swims I can enter". Compared
  // on end_date where the event spans days, so a festival is not dropped
  // on its middle morning.
  const endsAt = ev.end_date || ev.start_date;
  if (nonEmpty(endsAt)) {
    const end = new Date(`${String(endsAt).slice(0, 10)}T23:59:59Z`);
    if (!Number.isNaN(end.getTime()) && end.getTime() < now.getTime()) {
      return { indexable: false, reasons: ['event has already finished'], missing };
    }
  }
  if (missing.length > 0) {
    return { indexable: false, reasons: [`thin: missing ${missing.join(', ')}`], missing };
  }
  return { indexable: true, reasons: ['has a name, location, actionable date and canonical slug'], missing: [] };
}

/** The meta robots value a page should serve, given the gate's verdict. */
export function robotsFor(verdict) {
  return verdict?.indexable ? 'index,follow' : 'noindex,follow';
}
