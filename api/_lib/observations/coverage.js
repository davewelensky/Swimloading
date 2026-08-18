// Coverage analysis over the whole observation catalogue.
//
// The platform now holds ~1,400 stations from three providers. This module
// answers two questions about that catalogue:
//
//   1. Which stations could serve a SwimLoading spot that has no measured
//      temperature yet?  (existing-spot opportunities)
//   2. Which stations sit in water we have no spot for at all?  (coverage
//      gaps — a possible signal that we are missing a swimming area)
//
// Everything here is PURE and injectable so it can be unit tested against
// fixtures; the script (scripts/analyse-observation-coverage.mjs) does the
// fetching and reporting.
//
// A note on what this module is NOT. It never decides that a sensor is a
// swimming place. A buoy is an instrument, not a beach: it can be 30 km
// offshore, inside an oil terminal, or in a shipping channel. So station →
// "probable swim spot" is expressed as a RANKED SUGGESTION with its evidence
// attached, for a human to judge. Guessing here would invent beaches, which
// is the one thing this project must never do.

import { haversineKm } from '../../seo-utils.js';
import { MATCH_CONFIG, suitabilityScore, matchEligibility } from './matching.js';
import { FRESHNESS_THRESHOLDS } from '../temperature-freshness.js';

export const COVERAGE_CONFIG = {
  // A station only counts as usable if it has actually reported a
  // temperature recently. `temperature_available` is a capability flag, not
  // evidence — a dead sensor keeps its flag forever.
  usableMaxAgeHours: FRESHNESS_THRESHOLDS.recentHours,   // 48
  // Ranking threshold for "this obviously belongs to that spot".
  highConfidenceScore: 70,
  // Same radius the match engine trusts.
  searchKm: MATCH_CONFIG.maxDistanceKm,                  // 25
  // Beyond this, a station is in water we simply do not cover.
  gapIsolationKm: 50,
};

export const COVERAGE_GROUPS = {
  A: 'APPROVED',
  B: 'HIGH_CONFIDENCE_EXISTING_SPOT',
  C: 'REVIEW_REQUIRED',
  D: 'COVERAGE_GAP',
  E: 'UNUSABLE',
};

/**
 * Is this station's temperature currently trustworthy enough to act on?
 * @param {{active?:boolean, temperatureAvailable?:boolean, latestTempAt?:Date|string|null, latestTempC?:number|null}} station
 * @returns {{usable:boolean, reason:string, ageHours:number|null}}
 */
export function stationUsability(station, opts = {}) {
  const now = opts.now || new Date();
  const cfg = opts.config || COVERAGE_CONFIG;

  if (station.active === false) return { usable: false, reason: 'station inactive', ageHours: null };
  if (station.latestTempC == null || !station.latestTempAt) {
    return {
      usable: false,
      // The distinction matters: a station that CLAIMS temperature but has
      // never delivered one is a sensor failure, not merely a quiet station.
      reason: station.temperatureAvailable
        ? 'no temperature observation stored (capability flag only)'
        : 'no temperature capability',
      ageHours: null,
    };
  }
  const at = station.latestTempAt instanceof Date ? station.latestTempAt : new Date(station.latestTempAt);
  if (Number.isNaN(at.getTime())) return { usable: false, reason: 'unparseable observation time', ageHours: null };

  const ageHours = (now.getTime() - at.getTime()) / 3_600_000;
  if (ageHours > cfg.usableMaxAgeHours) {
    return { usable: false, reason: `stale (${Math.round(ageHours)}h old)`, ageHours };
  }
  return { usable: true, reason: 'recent temperature observation', ageHours };
}

/**
 * Nearest spot, and nearest spot the match engine would actually allow
 * (marine stations may never serve pools or inland water).
 */
export function nearestSpots(station, spots, opts = {}) {
  const cfg = opts.config || COVERAGE_CONFIG;
  let nearest = null;
  let nearestEligible = null;
  for (const spot of spots) {
    if (!Number.isFinite(spot.latitude) || !Number.isFinite(spot.longitude)) continue;
    const distanceKm = haversineKm(station.latitude, station.longitude, spot.latitude, spot.longitude);
    if (!nearest || distanceKm < nearest.distanceKm) nearest = { spot, distanceKm };
    if (matchEligibility({ waterBody: station.waterBody }, { waterType: spot.water_type }).ok) {
      if (!nearestEligible || distanceKm < nearestEligible.distanceKm) nearestEligible = { spot, distanceKm };
    }
  }
  return {
    nearest,
    nearestEligible,
    withinSearch: nearestEligible ? nearestEligible.distanceKm <= cfg.searchKm : false,
  };
}

/**
 * Classify one station into A–E.
 *
 * @param {object} station        enriched station (see the script)
 * @param {object} context
 * @param {Array}  context.spots
 * @param {Map}    context.linksByStation  station external id → [{spot_id, status, is_primary}]
 * @param {Set}    context.spotsWithApprovedPrimary
 */
export function classifyStation(station, context, opts = {}) {
  const cfg = opts.config || COVERAGE_CONFIG;
  const now = opts.now || new Date();
  const links = context.linksByStation.get(station.externalId) || [];

  const approvedLink = links.find((l) => l.status === 'approved');
  const usability = stationUsability(station, { now, config: cfg });
  const { nearest, nearestEligible } = nearestSpots(station, context.spots, { config: cfg });

  const base = {
    usability,
    nearestSpot: nearest?.spot || null,
    nearestDistanceKm: nearest ? round1(nearest.distanceKm) : null,
    nearestEligibleSpot: nearestEligible?.spot || null,
    nearestEligibleDistanceKm: nearestEligible ? round1(nearestEligible.distanceKm) : null,
    suitabilityScore: null,
    existingStatus: links.length ? links.map((l) => l.status).join(',') : 'none',
  };

  // A — already approved. Reported first so an approved station is never
  // re-suggested, even if it has since gone stale (that is a monitoring
  // concern, surfaced separately in the report).
  if (approvedLink) {
    return { ...base, group: 'A', groupName: COVERAGE_GROUPS.A,
      reason: approvedLink.is_primary ? 'approved primary for a spot' : 'approved secondary for a spot' };
  }

  // E — cannot be acted on at all.
  if (!usability.usable) {
    return { ...base, group: 'E', groupName: COVERAGE_GROUPS.E, reason: usability.reason };
  }

  // D — usable, but no eligible spot in range: possible coverage gap.
  if (!nearestEligible || nearestEligible.distanceKm > cfg.searchKm) {
    const d = nearestEligible ? round1(nearestEligible.distanceKm) : null;
    return { ...base, group: 'D', groupName: COVERAGE_GROUPS.D,
      reason: d == null
        ? 'no eligible (coastal) SwimLoading spot anywhere'
        : `nearest eligible spot ${d} km away, beyond the ${cfg.searchKm} km trust radius` };
  }

  const score = suitabilityScore({
    distanceKm: nearestEligible.distanceKm,
    stationType: station.stationType,
    sensorDepthM: station.sensorDepthM,
    lastObservationAt: station.latestTempAt,
  }, { waterType: nearestEligible.spot.water_type }, { now });
  base.suitabilityScore = score;

  const rejectedHere = links.some((l) => l.status === 'rejected' && l.spot_id === nearestEligible.spot.id);
  // A human said no to exactly this pairing. Never re-propose it.
  if (rejectedHere) {
    return { ...base, group: 'C', groupName: COVERAGE_GROUPS.C,
      reason: 'manually rejected for this spot — excluded from suggestions' };
  }

  const spotAlreadyServed = context.spotsWithApprovedPrimary.has(nearestEligible.spot.id);
  const relevance = swimRelevance(station);

  // B — obviously belongs to this spot, and the spot has nothing better.
  if (score >= cfg.highConfidenceScore && !spotAlreadyServed && relevance.verdict !== 'offshore_or_industrial') {
    return { ...base, group: 'B', groupName: COVERAGE_GROUPS.B,
      reason: `score ${score}, ${round1(nearestEligible.distanceKm)} km, spot has no measured source` };
  }

  // C — everything else near a spot: worth a human's eye, not a promotion.
  const why = [];
  if (spotAlreadyServed) why.push('spot already has an approved primary');
  if (score < cfg.highConfidenceScore) why.push(`score ${score} below ${cfg.highConfidenceScore}`);
  if (relevance.verdict === 'offshore_or_industrial') why.push(`station reads as ${relevance.signals.join('; ')}`);
  return { ...base, group: 'C', groupName: COVERAGE_GROUPS.C, reason: why.join('; ') || 'ambiguous' };
}

// ── Swimming relevance ──────────────────────────────────────────────────────
// Signals read out of provider metadata we already store. These are
// heuristics over station NAMES and types, and they are reported with the
// evidence that produced them so a reviewer can disagree. They never create
// anything on their own.

const OFFSHORE_PATTERNS = [
  // NDBC names distant buoys as "<N> NM <bearing> of <place>" — "44 NM SE of
  // Mobile, AL", "214 NM NE of Veracruz", "24NM SSW of San Francisco". An
  // earlier version required the bearing spelled out in full, so every
  // abbreviated compass point (SE, SSW, NE) slipped through and put buoys
  // hundreds of miles offshore on the swim shortlist purely because their
  // name contained the word "Bay". A distance-with-unit in the name is
  // itself the offshore marker; the bearing is not needed.
  [/\b\d+\s*(nm|nmi)\b/i, 'name states a nautical-mile distance from shore'],
  [/\b\d+\s*(km|mi)\b.*\b(w|e|n|s|nw|ne|sw|se|west|east|north|south|off)\b/i, 'name states a distance offshore'],
  [/\boffshore\b/i, 'name says offshore'],
  [/\bplatform\b|\boil\b|\brig\b/i, 'oil/gas platform'],
  [/\bbar\b(?!bour)/i, 'harbour bar / entrance shoal'],
  [/\bdart\b|\btsunami\b/i, 'deep-ocean tsunami buoy'],
  [/\bocean station\b|\bopen ocean\b/i, 'open ocean station'],
];

const INDUSTRIAL_PATTERNS = [
  [/\bterminal\b|\bberth\b|\banchorage\b|\brefinery\b/i, 'port/industrial installation'],
  [/\bshipping\b|\bfairway\b|\bchannel marker\b/i, 'shipping infrastructure'],
  [/\block\b|\bdry dock\b/i, 'dock infrastructure'],
];

const NEARSHORE_PATTERNS = [
  [/\bnearshore\b/i, 'name says nearshore'],
  [/\bbeach\b/i, 'beach in name'],
  [/\bpier\b|\bjetty\b|\bwharf\b|\bpromenade\b/i, 'shore structure in name'],
  [/\bcove\b|\blido\b|\bbathing\b|\bswim/i, 'bathing location in name'],
  [/\bbay\b|\blagoon\b/i, 'sheltered water in name'],
];

/**
 * @returns {{verdict:'probable_swim_water'|'observation_only'|'offshore_or_industrial',
 *            signals:string[], confidence:'low'|'medium', nameSignals:number}}
 */
export function swimRelevance(station) {
  const text = [station.name, station.externalId, station.waterBody,
    station.metadata?.institution, station.metadata?.owner].filter(Boolean).join(' ');

  const offshore = [];
  for (const [re, label] of [...OFFSHORE_PATTERNS, ...INDUSTRIAL_PATTERNS]) {
    if (re.test(text)) offshore.push(label);
  }
  // Signals from the station's NAME — someone named this place after a
  // beach, a pier, a cove. That is evidence about the location itself.
  const nameSignals = [];
  for (const [re, label] of NEARSHORE_PATTERNS) {
    if (re.test(text)) nameSignals.push(label);
  }
  // A shore-mounted station is at the water's edge, but "the sensor is
  // bolted to something" says nothing about whether people swim there —
  // most C-MAN stations are on breakwaters and light towers. Kept as a
  // weak supporting signal ONLY; it can never on its own promote a station
  // to "probable swim water", or half the catalogue would qualify.
  const weak = [];
  const type = (station.stationType || '').toLowerCase();
  if (type === 'fixed' || type === 'lido_sensor') weak.push(`station type '${type}' is shore-mounted`);

  // An explicit distance-from-shore in the name is decisive, even when the
  // name also contains a "Bay" or "Beach": "BAY OF CAMPECHE - 214 NM NE of
  // Veracruz" is a name about a region, and a statement about a buoy 214
  // nautical miles out. The second fact wins.
  const statesDistance = offshore.some((s) => s.startsWith('name states'));
  if (statesDistance || (offshore.length && !nameSignals.length)) {
    return { verdict: 'offshore_or_industrial', signals: offshore, confidence: 'medium', nameSignals: 0 };
  }
  if (nameSignals.length && !offshore.length) {
    return {
      verdict: 'probable_swim_water',
      signals: [...nameSignals, ...weak],
      confidence: nameSignals.length > 1 ? 'medium' : 'low',
      nameSignals: nameSignals.length,
    };
  }
  if (nameSignals.length && offshore.length) {
    return { verdict: 'observation_only', signals: [...nameSignals, ...offshore], confidence: 'low', nameSignals: nameSignals.length };
  }
  // No signal either way. Unknown must NOT read as positive.
  return {
    verdict: 'observation_only',
    signals: weak.length ? weak : ['no locational signal in station metadata'],
    confidence: 'low',
    nameSignals: 0,
  };
}

/**
 * Rank existing-spot opportunities (group B and the promising part of C).
 * Order: suitability, then freshness, then distance, then whether the spot
 * currently has nothing at all (that is where a match changes a page).
 */
export function rankExistingSpotOpportunities(classified, context, opts = {}) {
  const cfg = opts.config || COVERAGE_CONFIG;
  return classified
    .filter((c) => (c.group === 'B' || c.group === 'C')
      && c.usability.usable
      && c.nearestEligibleSpot
      && c.nearestEligibleDistanceKm <= cfg.searchKm
      && !/manually rejected/.test(c.reason))
    .map((c) => ({
      ...c,
      spotHasNoSource: !context.spotsWithApprovedPrimary.has(c.nearestEligibleSpot.id),
    }))
    .sort((a, b) =>
      (b.spotHasNoSource - a.spotHasNoSource)
      || (b.suitabilityScore - a.suitabilityScore)
      || (a.usability.ageHours - b.usability.ageHours)
      || (a.nearestEligibleDistanceKm - b.nearestEligibleDistanceKm));
}

const VERDICT_RANK = { probable_swim_water: 2, observation_only: 1, offshore_or_industrial: 0 };

/** Rank coverage gaps (group D) — most swim-plausible first. Freshness is a
 *  weak tiebreak only: every station in a healthy catalogue reports within
 *  the hour, so sorting on it mainly produces noise. */
export function rankCoverageGaps(classified, opts = {}) {
  return classified
    .filter((c) => c.group === 'D')
    .map((c) => ({ ...c, relevance: swimRelevance(c.station) }))
    .sort((a, b) =>
      (VERDICT_RANK[b.relevance.verdict] - VERDICT_RANK[a.relevance.verdict])
      || (b.relevance.nameSignals - a.relevance.nameSignals)
      || (a.usability.ageHours - b.usability.ageHours));
}

/**
 * Cluster coverage gaps geographically.
 *
 * A list of 520 individual sensors is not an actionable finding; "eleven
 * stations around Lake Erie, none of which we cover" is. Simple
 * single-link clustering by distance — no dependency, and the clusters are
 * only ever a way to present the same stations, never a claim about them.
 *
 * @param {Array} gaps  output of rankCoverageGaps
 * @param {{radiusKm?:number}} [opts]
 */
export function clusterGaps(gaps, opts = {}) {
  const radiusKm = opts.radiusKm ?? 60;
  const clusters = [];

  for (const gap of gaps) {
    const st = gap.station;
    let joined = null;
    for (const cluster of clusters) {
      if (cluster.members.some((m) => haversineKm(
        st.latitude, st.longitude, m.station.latitude, m.station.longitude) <= radiusKm)) {
        cluster.members.push(gap);
        joined = cluster;
        break;
      }
    }
    if (!joined) clusters.push({ members: [gap] });
  }

  return clusters.map((c) => {
    const lat = c.members.reduce((s, m) => s + m.station.latitude, 0) / c.members.length;
    const lon = c.members.reduce((s, m) => s + m.station.longitude, 0) / c.members.length;
    const best = [...c.members].sort((a, b) =>
      (VERDICT_RANK[b.relevance.verdict] - VERDICT_RANK[a.relevance.verdict])
      || (b.relevance.nameSignals - a.relevance.nameSignals))[0];
    const swimmable = c.members.filter((m) => m.relevance.verdict === 'probable_swim_water');
    return {
      centroid: { latitude: round3(lat), longitude: round3(lon) },
      stationCount: c.members.length,
      probableSwimWaterCount: swimmable.length,
      // Locality names come straight from the providers' own station names.
      localityHints: [...new Set(c.members.map((m) => m.station.name).filter(Boolean))].slice(0, 6),
      bestStation: {
        externalId: best.station.externalId, name: best.station.name,
        provider: best.station.providerCode, latestTempC: best.station.latestTempC,
        verdict: best.relevance.verdict, signals: best.relevance.signals,
      },
      nearestSpot: best.nearestSpot?.name || null,
      nearestSpotKm: best.nearestDistanceKm,
      members: c.members.map((m) => m.station.externalId),
    };
  }).sort((a, b) =>
    (b.probableSwimWaterCount - a.probableSwimWaterCount) || (b.stationCount - a.stationCount));
}

function round3(n) { return Math.round(n * 1000) / 1000; }

function round1(n) { return Math.round(n * 10) / 10; }
