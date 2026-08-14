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
  const hasUsableTemp =
    Number.isFinite(Number(spot.temp_c)) &&
    ageDays !== null && Number.isFinite(ageDays) &&
    ageDays >= 0 && ageDays <= INDEXABILITY_RULES.spot.temperatureMaxAgeDays;
  const hasEstimate = Number.isFinite(Number(spot.estimate_c));
  const hasContext = nonEmpty(spot.area) || nonEmpty(spot.meet_note);

  if (!hasUsableTemp && !hasEstimate && !hasContext) missing.push('temperature or descriptive context');

  if (spot.active === false) {
    return { indexable: false, reasons: ['spot is not active'], missing };
  }
  if (missing.length > 0) {
    return { indexable: false, reasons: [`thin: missing ${missing.join(', ')}`], missing };
  }
  return {
    indexable: true,
    reasons: [hasUsableTemp ? 'has a recent temperature reading' : hasEstimate ? 'has a modelled temperature' : 'has descriptive context'],
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

/** The meta robots value a page should serve, given the gate's verdict. */
export function robotsFor(verdict) {
  return verdict?.indexable ? 'index,follow' : 'noindex,follow';
}
