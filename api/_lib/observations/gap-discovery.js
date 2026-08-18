// Observation coverage gap → swim-spot discovery candidate.
//
// WHERE THIS LANDS, AND WHY NOT THE EVENT PIPELINE. The Global Swim
// Discovery tables are event-shaped all the way down: the candidate table
// is `discovery_candidate_events`, its constraints are date rules, and its
// only promotion RPC inserts an `event_editions` row. There is no generic
// candidate concept to borrow, and bending one into existence would be a
// bigger change than the idea deserves.
//
// `spot_suggestions` already is the spot-candidate table. It carries
// latitude/longitude/locality/country_code, the pending → approved | merged
// | rejected state machine, `matched_spot_id` for duplicates and
// `created_spot_id` for promotions — and its `source` column was added with
// this exact case written into the migration: "a later automatic
// GPS-discovery phase can insert source='gps_detected' rows through the same
// review pipeline without schema change".
//
// So an observation gap becomes a `spot_suggestions` row with
// source='observation_gap', and Dave reviews it in the tool he already uses.
// Nothing here creates a spot: approval remains the existing human step.

/** How many stations agreeing on a location before it is worth proposing. */
export const GAP_DISCOVERY_CONFIG = {
  // Only propose where the station's own metadata names shore or bathing
  // water. A sensor is not a beach; without a locational signal we would be
  // inventing swimming places out of coordinates.
  requireSwimSignal: true,
  // Nothing already covered: if a spot is this close, the station belongs to
  // that spot (a matching question), not to a new one (a discovery question).
  minDistanceFromExistingSpotKm: 25,
  maxObservationAgeHours: 48,
  // A suggestion without a country becomes a spot without a domain. Off by
  // default so existing callers/tests keep working; the generator turns it
  // on and resolves the country by reverse geocoding.
  requireCountry: false,
};

/**
 * Deterministic dedupe key. The station id IS the identity of the finding —
 * the same station must never generate a second suggestion on the next
 * hourly run, however the ranking around it moves.
 */
export function gapCandidateKey(station) {
  return `observation_gap:${station.providerCode}:${station.externalId}`;
}

/**
 * Convert a ranked gap into a spot_suggestions row.
 *
 * Every fact in the row comes from the provider's own metadata. The
 * description states what we actually know and what we do not, because a
 * reviewer's first question is "why am I being shown this?" and the honest
 * answer includes the uncertainty.
 *
 * @returns {object|null} row, or null when the gap does not qualify
 */
export function gapToSuggestion(gap, opts = {}) {
  const cfg = opts.config || GAP_DISCOVERY_CONFIG;
  const st = gap.station;
  const relevance = gap.relevance || {};

  if (cfg.requireSwimSignal && relevance.verdict !== 'probable_swim_water') return null;
  if (!gap.usability?.usable) return null;
  if (gap.usability.ageHours != null && gap.usability.ageHours > cfg.maxObservationAgeHours) return null;
  if (gap.nearestDistanceKm != null && gap.nearestDistanceKm < cfg.minDistanceFromExistingSpotKm) return null;
  if (!Number.isFinite(st.latitude) || !Number.isFinite(st.longitude)) return null;
  // Refuse to file a suggestion whose country is unknown — see the note on
  // country_code below. Better no suggestion than one that silently becomes
  // a spot in the wrong hemisphere.
  if (cfg.requireCountry && !opts.countryCode) return null;

  // The station's own name, minus the provider's numbering, is the best
  // locality we have. We do NOT invent a beach name.
  const stationName = (st.name || st.externalId).replace(/\s*\(\d+\)\s*$/, '').trim();
  const regionMatch = stationName.match(/,\s*([A-Z]{2})\s*$/);

  const temp = st.latestTempC == null ? 'no current reading'
    : `${st.latestTempC}°C measured ${Math.round((gap.usability.ageHours || 0) * 10) / 10}h ago`;

  return {
    // NOTE: user_id is deliberately absent — see the migration. A
    // machine-generated suggestion has no submitting swimmer.
    spot_name: stationName,
    water_type: 'OCEAN',
    region: regionMatch ? regionMatch[1] : null,
    description:
      `Automatic suggestion from observation coverage: ${st.providerCode} station ${st.externalId} `
      + `("${stationName}") reports water temperature here (${temp}) and the nearest SwimLoading spot is `
      + `${gap.nearestSpot?.name || 'none'}${gap.nearestDistanceKm != null ? ` at ${gap.nearestDistanceKm} km` : ''}. `
      + `Swim-relevance signals: ${(relevance.signals || []).join('; ') || 'none'}. `
      + `NOT VERIFIED as a swimming location — the sensor proves measured water, not public access, safety or that anyone swims here.`,
    latitude: st.latitude,
    longitude: st.longitude,
    country: opts.country ?? null,
    // A NULL country is not neutral downstream. The admin Add-Spot form
    // derives a spot's DOMAIN from its country code, and with none it fell
    // back to the South African default — which on 2026-08-18 put sixteen
    // US beaches on Cape Town's Atlantic Seaboard page. So a caller that
    // can resolve the country (the generator geocodes) must pass it, and
    // one that cannot should expect the suggestion to be refused below.
    country_code: opts.countryCode ?? null,
    locality: null,
    admin_area: regionMatch ? regionMatch[1] : null,
    source: 'observation_gap',
    observation_station_id: st.id,
    status: 'pending',
  };
}

/**
 * Build the full set of rows for a run, de-duplicated against what already
 * exists. Idempotency is by station: re-running produces nothing new.
 *
 * @param {Array} rankedGaps          output of rankCoverageGaps
 * @param {Set<string>} existingStationIds  observation_station_id values already suggested
 */
export function buildGapSuggestions(rankedGaps, existingStationIds = new Set(), opts = {}) {
  const rows = [];
  const skipped = { alreadySuggested: 0, noSwimSignal: 0, tooCloseToSpot: 0, unusable: 0 };
  for (const gap of rankedGaps) {
    if (existingStationIds.has(gap.station.id)) { skipped.alreadySuggested++; continue; }
    const row = gapToSuggestion(gap, opts);
    if (!row) {
      if (!gap.usability?.usable) skipped.unusable++;
      else if ((gap.relevance?.verdict) !== 'probable_swim_water') skipped.noSwimSignal++;
      else skipped.tooCloseToSpot++;
      continue;
    }
    rows.push(row);
  }
  return { rows, skipped };
}
