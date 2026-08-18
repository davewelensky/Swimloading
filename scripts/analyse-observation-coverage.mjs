// Coverage analysis over the whole observation catalogue.
//
//   node scripts/analyse-observation-coverage.mjs
//   node scripts/analyse-observation-coverage.mjs --json-only
//
// Reads (never writes) the live database with the anon key, classifies every
// station A–E, ranks existing-spot opportunities and coverage gaps, dry-runs
// the auto-approval rules, and checks the suitability score against the
// decisions humans have actually made.
//
// Output: out/observation-coverage.json (machine) + out/observation-coverage.md
// (human). Nothing is approved, created or modified by this script.

import { writeFileSync, mkdirSync } from 'node:fs';
import {
  COVERAGE_CONFIG, COVERAGE_GROUPS, classifyStation, swimRelevance,
  rankExistingSpotOpportunities, rankCoverageGaps, clusterGaps,
} from '../api/_lib/observations/coverage.js';
import { dryRunAutoApproval, AUTO_APPROVE_CONFIG } from '../api/_lib/observations/auto-approve.js';
import { suitabilityScore } from '../api/_lib/observations/matching.js';
import { generateSlug } from '../api/seo-utils.js';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://szgkzuswelntnevobnoh.supabase.co';
const ANON_KEY = process.env.SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InN6Z2t6dXN3ZWxudG5ldm9ibm9oIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjgxODY1NTUsImV4cCI6MjA4Mzc2MjU1NX0.UfKqj2OZ-XeyzCy-MZYZqsDWjn_4EKrhgCFR8eIK2NA';
const HEADERS = { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}`, Accept: 'application/json' };

const NOW = new Date();

// PostgREST caps a response at 1000 rows; every table here can exceed that.
async function fetchAll(path, pageSize = 1000) {
  const out = [];
  for (let offset = 0; ; offset += pageSize) {
    const sep = path.includes('?') ? '&' : '?';
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}${sep}limit=${pageSize}&offset=${offset}`, { headers: HEADERS });
    if (!res.ok) throw new Error(`REST ${res.status} for ${path}: ${await res.text()}`);
    const rows = await res.json();
    out.push(...rows);
    if (rows.length < pageSize) return out;
  }
}

console.log('Loading catalogue…');
const [spotsRaw, stationsRaw, linksRaw, observationsRaw] = await Promise.all([
  fetchAll('spots?active=eq.true&select=id,name,water_type,latitude,longitude,country_code,domain'),
  fetchAll('observation_stations?select=id,external_id,name,latitude,longitude,station_type,water_body,sensor_depth_m,temperature_available,active,metadata,last_observation_at,provider_id'),
  fetchAll('spot_observation_stations?select=spot_id,station_id,status,is_primary,distance_km,suitability_score,reviewed_by'),
  fetchAll('observations?water_temperature_c=not.is.null&select=station_id,observed_at,water_temperature_c&order=observed_at.desc'),
]);
const providers = await fetchAll('observation_providers?select=id,code,name,enabled');

const providerById = new Map(providers.map((p) => [p.id, p]));
const spots = spotsRaw.map((s) => ({ ...s, latitude: Number(s.latitude), longitude: Number(s.longitude) }));
const stationById = new Map(stationsRaw.map((s) => [s.id, s]));

// Newest temperature per station (observations arrive newest-first).
const latestTemp = new Map();
for (const o of observationsRaw) {
  if (!latestTemp.has(o.station_id)) {
    latestTemp.set(o.station_id, { at: new Date(o.observed_at), tempC: Number(o.water_temperature_c) });
  }
}

const stations = stationsRaw.map((s) => {
  const lt = latestTemp.get(s.id);
  return {
    id: s.id,
    externalId: s.external_id,
    providerCode: providerById.get(s.provider_id)?.code || 'unknown',
    name: s.name,
    latitude: Number(s.latitude),
    longitude: Number(s.longitude),
    stationType: s.station_type,
    waterBody: s.water_body,
    sensorDepthM: s.sensor_depth_m == null ? null : Number(s.sensor_depth_m),
    temperatureAvailable: s.temperature_available,
    active: s.active,
    metadata: s.metadata || {},
    lastObservationAt: s.last_observation_at,
    latestTempAt: lt?.at || null,
    latestTempC: lt?.tempC ?? null,
  };
});

// Links, keyed both ways.
const linksByStation = new Map();
const linksBySpot = new Map();
for (const l of linksRaw) {
  const st = stationById.get(l.station_id);
  const rec = { ...l, station_external_id: st?.external_id || null };
  if (!linksByStation.has(rec.station_external_id)) linksByStation.set(rec.station_external_id, []);
  linksByStation.get(rec.station_external_id).push(rec);
  if (!linksBySpot.has(l.spot_id)) linksBySpot.set(l.spot_id, []);
  linksBySpot.get(l.spot_id).push(rec);
}
const spotsWithApprovedPrimary = new Set(
  linksRaw.filter((l) => l.status === 'approved' && l.is_primary).map((l) => l.spot_id));

const context = { spots, linksByStation, spotsWithApprovedPrimary };

console.log(`${stations.length} stations, ${spots.length} spots, ${linksRaw.length} links, ${observationsRaw.length} temperature observations.`);
console.log('Classifying…');

const classified = stations.map((station) => ({
  station,
  ...classifyStation(station, context, { now: NOW }),
}));

const byGroup = (g) => classified.filter((c) => c.group === g);
const ageBuckets = (h) => stations.filter((s) => s.latestTempAt && (NOW - s.latestTempAt) / 3_600_000 <= h).length;

const summary = {
  generatedAt: NOW.toISOString(),
  totals: {
    providers: providers.length,
    providersEnabled: providers.filter((p) => p.enabled).length,
    stations: stations.length,
    stationsActive: stations.filter((s) => s.active).length,
    temperatureCapable: stations.filter((s) => s.temperatureAvailable && s.active).length,
    temperatureIn3h: ageBuckets(3),
    temperatureIn12h: ageBuckets(12),
    temperatureIn48h: ageBuckets(48),
    spots: spots.length,
    spotsWithApprovedPrimary: spotsWithApprovedPrimary.size,
  },
  groups: {
    A_approved: byGroup('A').length,
    B_highConfidence: byGroup('B').length,
    C_reviewRequired: byGroup('C').length,
    D_coverageGap: byGroup('D').length,
    E_unusable: byGroup('E').length,
  },
  byProvider: Object.fromEntries(providers.map((p) => {
    const mine = classified.filter((c) => c.station.providerCode === p.code);
    return [p.code, {
      stations: mine.length,
      usable: mine.filter((c) => c.usability.usable).length,
      A: mine.filter((c) => c.group === 'A').length,
      B: mine.filter((c) => c.group === 'B').length,
      C: mine.filter((c) => c.group === 'C').length,
      D: mine.filter((c) => c.group === 'D').length,
      E: mine.filter((c) => c.group === 'E').length,
    }];
  })),
};

// ── Spot-side coverage ──────────────────────────────────────────────────────
const spotCoverage = spots.map((spot) => {
  const links = linksBySpot.get(spot.id) || [];
  const approvedPrimary = links.find((l) => l.status === 'approved' && l.is_primary);
  const approvedAny = links.find((l) => l.status === 'approved');
  const candidate = links.find((l) => l.status === 'candidate');
  return {
    id: spot.id, name: spot.name, slug: generateSlug(spot.name),
    country: spot.country_code, waterType: spot.water_type,
    state: approvedPrimary ? 'live_measured' : approvedAny ? 'approved_secondary_only'
      : candidate ? 'candidate_only' : 'no_measured_source',
  };
});
summary.spotCoverage = {
  live_measured: spotCoverage.filter((s) => s.state === 'live_measured').length,
  approved_secondary_only: spotCoverage.filter((s) => s.state === 'approved_secondary_only').length,
  candidate_only: spotCoverage.filter((s) => s.state === 'candidate_only').length,
  no_measured_source: spotCoverage.filter((s) => s.state === 'no_measured_source').length,
  eligible_no_source: spotCoverage.filter((s) => s.state === 'no_measured_source'
    && ['OCEAN', 'LAGOON'].includes(s.waterType)).length,
};

// ── Rankings ────────────────────────────────────────────────────────────────
const opportunities = rankExistingSpotOpportunities(classified, context).slice(0, 50).map((c) => ({
  spot: c.nearestEligibleSpot.name,
  spotSlug: generateSlug(c.nearestEligibleSpot.name),
  country: c.nearestEligibleSpot.country_code,
  provider: c.station.providerCode,
  station: c.station.externalId,
  stationName: c.station.name,
  distanceKm: c.nearestEligibleDistanceKm,
  sensorDepthM: c.station.sensorDepthM,
  latestTempC: c.station.latestTempC,
  observationAgeHours: c.usability.ageHours == null ? null : Math.round(c.usability.ageHours * 10) / 10,
  suitabilityScore: c.suitabilityScore,
  group: c.group,
  spotHasNoSource: c.spotHasNoSource,
  relevance: swimRelevance(c.station).verdict,
  recommendation: c.group === 'B' && c.spotHasNoSource ? 'approve as primary'
    : c.group === 'B' ? 'approve as secondary'
    : 'review manually',
  reason: c.reason,
}));

const allGapsRanked = rankCoverageGaps(classified);
// Clustered view first — 500 individual sensors is not an actionable
// finding, "this stretch of coast has stations and no spots" is.
const gapClusters = clusterGaps(allGapsRanked);
const gaps = allGapsRanked.slice(0, 50).map((c) => ({
  provider: c.station.providerCode,
  station: c.station.externalId,
  stationName: c.station.name,
  latitude: c.station.latitude,
  longitude: c.station.longitude,
  waterBody: c.station.waterBody,
  stationType: c.station.stationType,
  sensorDepthM: c.station.sensorDepthM,
  latestTempC: c.station.latestTempC,
  observationAgeHours: c.usability.ageHours == null ? null : Math.round(c.usability.ageHours * 10) / 10,
  nearestSpot: c.nearestSpot?.name || null,
  nearestSpotDistanceKm: c.nearestDistanceKm,
  nearestEligibleSpotDistanceKm: c.nearestEligibleDistanceKm,
  probableLocality: localityFromMetadata(c.station),
  swimRelevance: c.relevance.verdict,
  swimSignals: c.relevance.signals,
  reason: c.reason,
}));

// Probable NEW SWIM LOCATION opportunities: the subset of gaps whose own
// metadata suggests shore/bathing water. Deliberately narrow — a sensor is
// not a beach, and a ranked shortlist a human can check beats a long list
// of coordinates nobody trusts.
const swimOpportunities = gaps.filter((g) => g.swimRelevance === 'probable_swim_water');

function localityFromMetadata(station) {
  // Only what the provider already told us. Never invented.
  const name = station.name || '';
  const inst = station.metadata?.institution || station.metadata?.owner || null;
  const m = name.match(/,\s*([A-Z]{2})\b/);              // "…, CA (201)"
  return {
    fromStationName: name.replace(/\s*\(\d+\)\s*$/, '').trim() || null,
    regionCode: m ? m[1] : null,
    institution: inst,
  };
}

// ── Phase 7: auto-approval dry run ──────────────────────────────────────────
const autoMatches = classified
  .filter((c) => c.nearestEligibleSpot && c.nearestEligibleDistanceKm != null
    && c.nearestEligibleDistanceKm <= COVERAGE_CONFIG.searchKm)
  .map((c) => {
    const spotLinks = (linksBySpot.get(c.nearestEligibleSpot.id) || []);
    const competing = classified
      .filter((o) => o !== c && o.nearestEligibleSpot?.id === c.nearestEligibleSpot.id && o.suitabilityScore != null)
      .map((o) => o.suitabilityScore);
    return {
      spot: c.nearestEligibleSpot,
      station: c.station,
      distanceKm: c.nearestEligibleDistanceKm,
      suitabilityScore: c.suitabilityScore ?? 0,
      existingLinks: spotLinks,
      competingScores: competing,
    };
  });
const autoDryRun = dryRunAutoApproval(autoMatches, { now: NOW });

// ── Phase 8: is the suitability score actually working? ─────────────────────
const decided = [];
for (const l of linksRaw) {
  if (l.status !== 'approved' && l.status !== 'rejected') continue;
  const st = stationById.get(l.station_id);
  const spot = spots.find((s) => s.id === l.spot_id);
  if (!st || !spot) continue;
  const enriched = stations.find((s) => s.id === st.id);
  decided.push({
    status: l.status,
    isPrimary: l.is_primary,
    spot: spot.name,
    station: st.external_id,
    provider: enriched.providerCode,
    distanceKm: Number(l.distance_km),
    storedScore: l.suitability_score == null ? null : Number(l.suitability_score),
    // Recomputed with today's freshness — the stored score was computed at
    // match time, so a gap between them is expected and is itself a signal.
    liveScore: suitabilityScore({
      distanceKm: Number(l.distance_km),
      stationType: enriched.stationType,
      sensorDepthM: enriched.sensorDepthM,
      lastObservationAt: enriched.latestTempAt,
    }, { waterType: spot.water_type }, { now: NOW }),
    sensorDepthM: enriched.sensorDepthM,
    stationType: enriched.stationType,
  });
}
const approvedScores = decided.filter((d) => d.status === 'approved' && d.storedScore != null).map((d) => d.storedScore);
const rejectedScores = decided.filter((d) => d.status === 'rejected' && d.storedScore != null).map((d) => d.storedScore);
const scoring = {
  approved: { n: approvedScores.length, min: min(approvedScores), max: max(approvedScores), mean: mean(approvedScores) },
  rejected: { n: rejectedScores.length, min: min(rejectedScores), max: max(rejectedScores), mean: mean(rejectedScores) },
  // The headline test: did any rejected match outrank an approved one?
  overlap: rejectedScores.length && approvedScores.length
    ? rejectedScores.filter((r) => r > min(approvedScores)).length : 0,
  decisions: decided.sort((a, b) => (b.storedScore ?? 0) - (a.storedScore ?? 0)),
};

// ── Phase 9/10: named geographic cases ──────────────────────────────────────
const WATCH_AREAS = [
  ['Brighton', 50.8198, -0.1372], ['Bournemouth/Poole', 50.7192, -1.8808], ['Dover', 51.1231, 1.3238],
  ['Torbay', 50.4565, -3.5007], ['Plymouth', 50.3597, -4.1426], ['Cornwall (Falmouth)', 50.1531, -5.0663],
  ['Dublin Bay / Forty Foot', 53.2895, -6.1137], ['Galway / Salthill', 53.2570, -9.0923],
  ['Cork / Kinsale', 51.6771, -8.5243],
  ['La Jolla / San Diego', 32.8569, -117.2571], ['San Francisco', 37.8074, -122.4230],
  ['Santa Monica / LA', 34.0090, -118.4973], ['Honolulu, Hawaii', 21.2760, -157.8270],
  ['Seattle', 47.6062, -122.3321], ['New York / Long Island', 40.5795, -73.9707],
  ['Boston', 42.3601, -71.0589], ['Chicago (Great Lakes)', 41.8781, -87.6298],
  ['Vancouver', 49.2864, -123.1642], ['Victoria BC', 48.4284, -123.3656], ['Toronto', 43.6532, -79.3832],
];
const { haversineKm } = await import('../api/seo-utils.js');
const watchAreas = WATCH_AREAS.map(([name, lat, lon]) => {
  const near = classified
    .map((c) => ({ c, d: haversineKm(lat, lon, c.station.latitude, c.station.longitude) }))
    .filter((x) => x.d <= 30)
    .sort((a, b) => a.d - b.d);
  const usable = near.filter((x) => x.c.usability.usable);
  return {
    area: name,
    stationsWithin30km: near.length,
    usableStations: usable.length,
    best: usable.slice(0, 3).map((x) => ({
      station: x.c.station.externalId, name: x.c.station.name, provider: x.c.station.providerCode,
      distanceFromAreaKm: Math.round(x.d * 10) / 10, tempC: x.c.station.latestTempC,
      ageHours: Math.round((x.c.usability.ageHours || 0) * 10) / 10, group: x.c.group,
      nearestSpot: x.c.nearestSpot?.name || null, nearestSpotKm: x.c.nearestDistanceKm,
    })),
    verdict: usable.length === 0
      ? (near.length ? 'stations present but none currently usable' : 'no station in catalogue')
      : 'usable station(s) present',
  };
});

// Watch cases carried from the previous increment.
const riviera = classified.find((c) => c.station.externalId === 'GL_TS_MO_6100022');
const dublinFerryBox = classified.filter((c) => /Stena|_FB_/i.test(c.station.externalId));
const watchCases = {
  riviera: riviera ? {
    station: riviera.station.externalId, name: riviera.station.name,
    lastObservationAt: riviera.station.lastObservationAt,
    storedTemperatureObservations: riviera.station.latestTempC == null ? 0 : 1,
    group: riviera.group, usable: riviera.usability.usable, reason: riviera.usability.reason,
    approvedLinks: (linksByStation.get(riviera.station.externalId) || []).filter((l) => l.status === 'approved').length,
  } : 'not in catalogue',
  dublinFerryBox: dublinFerryBox.length ? dublinFerryBox.map((c) => ({
    station: c.station.externalId, group: c.group, reason: c.usability.reason,
  })) : 'not in catalogue — CMEMS adapter ingests fixed moorings (_MO_) only, so the Stena FerryBoxes (_FB_) were never imported',
};

// ── Write outputs ───────────────────────────────────────────────────────────
mkdirSync('out', { recursive: true });
const json = {
  summary, spotCoverage, opportunities, gaps, gapClusters, swimOpportunities,
  autoApproval: {
    config: AUTO_APPROVE_CONFIG,
    evaluated: autoMatches.length,
    wouldApprove: autoDryRun.would.map((w) => ({
      spot: w.match.spot.name, station: w.match.station.externalId,
      distanceKm: w.match.distanceKm, score: w.match.suitabilityScore, passed: w.verdict.passed,
    })),
    agreement: {
      humanApprovedCount: autoDryRun.agreement.humanApprovedCount,
      humanApprovedThatRulesAgree: autoDryRun.agreement.humanApprovedThatRulesAgree,
      humanRejectedCount: autoDryRun.agreement.humanRejectedCount,
      humanRejectedThatRulesWouldApprove: autoDryRun.agreement.humanRejectedThatRulesWouldApprove,
    },
    blockerHistogram: histogram(autoDryRun.wouldNot.flatMap((w) => w.verdict.blockers.map(normaliseBlocker))),
  },
  scoring, watchAreas, watchCases,
};
writeFileSync('out/observation-coverage.json', JSON.stringify(json, null, 2));

if (!process.argv.includes('--json-only')) {
  writeFileSync('out/observation-coverage.md', renderMarkdown(json));
}
console.log('\nWrote out/observation-coverage.json' + (process.argv.includes('--json-only') ? '' : ' and out/observation-coverage.md'));
console.log(`  A approved ${summary.groups.A_approved} · B high-confidence ${summary.groups.B_highConfidence} · C review ${summary.groups.C_reviewRequired} · D gaps ${summary.groups.D_coverageGap} · E unusable ${summary.groups.E_unusable}`);
console.log(`  spots: ${summary.spotCoverage.live_measured} live measured, ${summary.spotCoverage.candidate_only} candidate-only, ${summary.spotCoverage.no_measured_source} without a source`);
console.log(`  auto-approval dry run: ${autoDryRun.would.length} would qualify (agreement: ${autoDryRun.agreement.humanRejectedThatRulesWouldApprove} human rejections would have been overridden — must be 0)`);

// ── helpers ─────────────────────────────────────────────────────────────────
function min(a) { return a.length ? Math.min(...a) : null; }
function max(a) { return a.length ? Math.max(...a) : null; }
function mean(a) { return a.length ? Math.round((a.reduce((x, y) => x + y, 0) / a.length) * 10) / 10 : null; }
function histogram(items) {
  const h = {};
  for (const i of items) h[i] = (h[i] || 0) + 1;
  return Object.fromEntries(Object.entries(h).sort((a, b) => b[1] - a[1]));
}
function normaliseBlocker(b) {
  return b.replace(/\d+(\.\d+)?/g, 'N');   // group "3.2 km exceeds…" with "9 km exceeds…"
}

function renderMarkdown(j) {
  const t = j.summary.totals;
  const L = [];
  L.push('# Observation coverage report', '');
  L.push(`Generated ${j.summary.generatedAt} — read-only analysis, nothing approved or created.`, '');
  L.push('## Catalogue', '');
  L.push('| Metric | Count |', '|---|---|');
  L.push(`| Providers (enabled) | ${t.providers} (${t.providersEnabled}) |`);
  L.push(`| Stations | ${t.stations} |`);
  L.push(`| Active stations | ${t.stationsActive} |`);
  L.push(`| Temperature-capable | ${t.temperatureCapable} |`);
  L.push(`| Temperature in last 3h | ${t.temperatureIn3h} |`);
  L.push(`| Temperature in last 12h | ${t.temperatureIn12h} |`);
  L.push(`| Temperature in last 48h | ${t.temperatureIn48h} |`);
  L.push(`| SwimLoading spots (active) | ${t.spots} |`);
  L.push('');
  L.push('## Classification', '');
  L.push('| Group | Meaning | Count |', '|---|---|---|');
  L.push(`| A | ${COVERAGE_GROUPS.A} | ${j.summary.groups.A_approved} |`);
  L.push(`| B | ${COVERAGE_GROUPS.B} | ${j.summary.groups.B_highConfidence} |`);
  L.push(`| C | ${COVERAGE_GROUPS.C} | ${j.summary.groups.C_reviewRequired} |`);
  L.push(`| D | ${COVERAGE_GROUPS.D} | ${j.summary.groups.D_coverageGap} |`);
  L.push(`| E | ${COVERAGE_GROUPS.E} | ${j.summary.groups.E_unusable} |`);
  L.push('');
  L.push('## Spot coverage', '');
  L.push('| State | Spots |', '|---|---|');
  for (const [k, v] of Object.entries(j.summary.spotCoverage)) L.push(`| ${k} | ${v} |`);
  L.push('');
  L.push('## Top existing-spot opportunities', '');
  L.push('| # | Spot | Country | Provider | Station | km | Temp | Age h | Score | Recommendation |');
  L.push('|---|---|---|---|---|---|---|---|---|---|');
  j.opportunities.forEach((o, i) => L.push(
    `| ${i + 1} | ${o.spot} | ${o.country || '—'} | ${o.provider} | ${o.station} | ${o.distanceKm} | ${o.latestTempC ?? '—'} | ${o.observationAgeHours ?? '—'} | ${o.suitabilityScore} | ${o.recommendation} |`));
  L.push('');
  L.push('## Coverage gaps (usable station, no SwimLoading spot in range)', '');
  L.push('| # | Provider | Station | Name | Temp | Age h | Nearest spot | km | Swim relevance |');
  L.push('|---|---|---|---|---|---|---|---|---|');
  j.gaps.forEach((g, i) => L.push(
    `| ${i + 1} | ${g.provider} | ${g.station} | ${(g.stationName || '').slice(0, 40)} | ${g.latestTempC ?? '—'} | ${g.observationAgeHours ?? '—'} | ${g.nearestSpot || '—'} | ${g.nearestSpotDistanceKm ?? '—'} | ${g.swimRelevance} |`));
  L.push('');
  L.push('## Coverage-gap clusters (where the map is empty)', '');
  L.push(`${j.gapClusters.length} geographic clusters hold the ${j.summary.groups.D_coverageGap} gap stations.`, '');
  L.push('| # | Centroid | Stations | Probable swim water | Best station | Locality hints |');
  L.push('|---|---|---|---|---|---|');
  j.gapClusters.slice(0, 25).forEach((c, i) => L.push(
    `| ${i + 1} | ${c.centroid.latitude}, ${c.centroid.longitude} | ${c.stationCount} | ${c.probableSwimWaterCount} | ${c.bestStation.externalId} (${c.bestStation.latestTempC ?? '—'}°C) | ${c.localityHints.slice(0, 3).join(' · ').slice(0, 70)} |`));
  L.push('');
  L.push('## Probable swim-location opportunities', '');
  L.push('Gaps whose own station metadata points at shore or bathing water. Heuristic — for human review, never auto-created.', '');
  if (!j.swimOpportunities.length) L.push('_None met the bar._');
  j.swimOpportunities.forEach((g, i) => L.push(
    `${i + 1}. **${g.stationName || g.station}** (${g.provider}) — ${g.latestTempC}°C, ${g.observationAgeHours}h old, at ${g.latitude.toFixed(3)}, ${g.longitude.toFixed(3)}. Nearest spot: ${g.nearestSpot || 'none'} ${g.nearestSpotDistanceKm ?? ''}km. Signals: ${g.swimSignals.join('; ')}.`));
  L.push('');
  L.push('## Auto-approval dry run', '');
  L.push(`Evaluated ${j.autoApproval.evaluated} in-range matches. **${j.autoApproval.wouldApprove.length} would auto-approve.**`, '');
  L.push(`Agreement with human decisions: rules agree with ${j.autoApproval.agreement.humanApprovedThatRulesAgree}/${j.autoApproval.agreement.humanApprovedCount} approvals; ` +
    `**${j.autoApproval.agreement.humanRejectedThatRulesWouldApprove}/${j.autoApproval.agreement.humanRejectedCount} human rejections would have been overridden (must be 0)**.`, '');
  L.push('Most common blockers:', '');
  for (const [b, n] of Object.entries(j.autoApproval.blockerHistogram).slice(0, 12)) L.push(`- ${n} × ${b}`);
  L.push('');
  L.push('## Suitability scoring vs human decisions', '');
  L.push(`Approved: n=${j.scoring.approved.n}, range ${j.scoring.approved.min}–${j.scoring.approved.max}, mean ${j.scoring.approved.mean}.`);
  L.push(`Rejected: n=${j.scoring.rejected.n}, range ${j.scoring.rejected.min}–${j.scoring.rejected.max}, mean ${j.scoring.rejected.mean}.`);
  L.push(`Rejected matches scoring above the lowest approved match: ${j.scoring.overlap}.`, '');
  L.push('## Watch areas', '');
  L.push('| Area | Stations ≤30km | Usable | Verdict |', '|---|---|---|---|');
  j.watchAreas.forEach((w) => L.push(`| ${w.area} | ${w.stationsWithin30km} | ${w.usableStations} | ${w.verdict} |`));
  L.push('');
  return L.join('\n') + '\n';
}
