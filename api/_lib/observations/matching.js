// Station-to-spot match engine.
//
// Produces CANDIDATES, never decisions. Straight-line proximity can be
// scientifically wrong — False Bay and the Atlantic seaboard are ~10 km
// apart across a peninsula and 5°C apart in the water — and the metadata
// to prove sides of a peninsula does not exist in any provider catalogue.
// So in Increment 1 every match, however close, lands as status='candidate'
// and a human approves it in /admin. The suitability score exists to rank
// the review queue, not to bypass it.

import { haversineKm } from '../../seo-utils.js';

export const MATCH_CONFIG = {
  // Coastal search radius. Beyond this a buoy is weather context, not a
  // water temperature a swimmer at the beach should trust.
  maxDistanceKm: 25,
  // Only spot types a marine observation network can speak for. Pools and
  // inland water bodies never match a marine station — that is the
  // lake-vs-ocean rule made structural.
  matchableWaterTypes: ['OCEAN', 'LAGOON'],
  weights: { distance: 50, freshness: 20, stationType: 15, sensorDepth: 15 },
};

/**
 * Score one station for one spot, 0–100. Kept pure: everything it needs
 * arrives as arguments, so tests pin every branch.
 *
 * @param {{distanceKm:number, stationType?:string|null, sensorDepthM?:number|null,
 *          lastObservationAt?:Date|string|null, waterBody?:string|null}} station
 * @param {{waterType?:string}} spot
 * @param {{now?:Date, config?:typeof MATCH_CONFIG}} [opts]
 */
export function suitabilityScore(station, spot, opts = {}) {
  const cfg = opts.config || MATCH_CONFIG;
  const now = opts.now || new Date();
  const w = cfg.weights;

  // Distance: linear falloff to zero at the search radius.
  const d = Number(station.distanceKm);
  if (!Number.isFinite(d) || d < 0 || d > cfg.maxDistanceKm) return 0;
  const distance = (1 - d / cfg.maxDistanceKm) * w.distance;

  // Freshness of the station's newest observation: a silent buoy ranks
  // below a reporting one no matter how close it floats.
  let freshness = 0;
  const at = station.lastObservationAt ? new Date(station.lastObservationAt) : null;
  if (at && !Number.isNaN(at.getTime())) {
    const ageH = (now.getTime() - at.getTime()) / 3_600_000;
    if (ageH <= 2) freshness = w.freshness;
    else if (ageH <= 6) freshness = w.freshness * 0.75;
    else if (ageH <= 24) freshness = w.freshness * 0.4;
    else if (ageH <= 7 * 24) freshness = w.freshness * 0.15;
  }

  // Station type: a shore/fixed station stands in the swimmer's water;
  // a moored buoy is usually further out; unknown types rank lowest.
  const type = (station.stationType || '').toLowerCase();
  const stationType = type === 'fixed' || type === 'lido_sensor' ? w.stationType
    : type === 'buoy' ? w.stationType * 0.7
    : w.stationType * 0.3;

  // Sensor depth: surface readings describe what a swimmer feels; deep
  // sensors describe a different layer. Unknown depth is mid-ranked —
  // most NDBC hull sensors sit near the surface, but we don't claim it.
  const depth = station.sensorDepthM;
  const sensorDepth = depth == null ? w.sensorDepth * 0.5
    : depth <= 3 ? w.sensorDepth
    : depth <= 10 ? w.sensorDepth * 0.5
    : w.sensorDepth * 0.1;

  return Math.round((distance + freshness + stationType + sensorDepth) * 10) / 10;
}

/**
 * Should this pairing exist at all?  Structural rules only — anything that
 * passes still becomes a candidate for a human, never an auto-approval.
 * Returns { ok: boolean, reason?: string }.
 */
export function matchEligibility(station, spot, opts = {}) {
  const cfg = opts.config || MATCH_CONFIG;
  if (!cfg.matchableWaterTypes.includes(spot.waterType)) {
    return { ok: false, reason: `spot water_type ${spot.waterType} cannot use a marine station` };
  }
  // Where a provider DOES state a water body, believe it: a lake or pool
  // station never speaks for coastal water and vice versa.
  const wb = (station.waterBody || '').toLowerCase();
  if (wb && ['lake', 'pool', 'river', 'dam'].includes(wb)) {
    return { ok: false, reason: `station water body '${station.waterBody}' does not match coastal spot` };
  }
  return { ok: true };
}

/**
 * Generate candidate links for all spot/station pairs in range.
 *
 * @param {Array<{id:string, name:string, water_type:string, latitude:number, longitude:number}>} spots
 * @param {Array<{id?:string, externalId:string, name?:string, latitude:number, longitude:number,
 *                stationType?:string, sensorDepthM?:number, waterBody?:string,
 *                temperatureAvailable?:boolean, active?:boolean, lastObservationAt?:string|Date}>} stations
 * @returns {{candidates: Array, rejected: Array}}  rejected carries the reason, for the report/audit
 */
export function generateCandidates(spots, stations, opts = {}) {
  const cfg = opts.config || MATCH_CONFIG;
  const now = opts.now || new Date();
  const candidates = [];
  const rejected = [];

  const usable = stations.filter((st) => st.active !== false && st.temperatureAvailable !== false
    && Number.isFinite(Number(st.latitude)) && Number.isFinite(Number(st.longitude)));

  for (const spot of spots) {
    if (!Number.isFinite(spot.latitude) || !Number.isFinite(spot.longitude)) continue;
    for (const st of usable) {
      const distanceKm = haversineKm(spot.latitude, spot.longitude, st.latitude, st.longitude);
      if (distanceKm > cfg.maxDistanceKm) continue;

      const eligibility = matchEligibility(
        { waterBody: st.waterBody }, { waterType: spot.water_type }, { config: cfg });
      if (!eligibility.ok) {
        rejected.push({ spot, station: st, distanceKm: round1(distanceKm), reason: eligibility.reason });
        continue;
      }

      const score = suitabilityScore({
        distanceKm,
        stationType: st.stationType,
        sensorDepthM: st.sensorDepthM,
        lastObservationAt: st.lastObservationAt,
      }, { waterType: spot.water_type }, { now, config: cfg });

      candidates.push({
        spot,
        station: st,
        distanceKm: round1(distanceKm),
        suitabilityScore: score,
        matchType: 'auto_distance',
        status: 'candidate',
      });
    }
  }

  candidates.sort((a, b) => b.suitabilityScore - a.suitabilityScore);
  return { candidates, rejected };
}

function round1(n) { return Math.round(n * 10) / 10; }
