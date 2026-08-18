// Coverage analysis, gap→discovery conversion, and the auto-approval
// framework. All pure functions, pinned clock, no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  stationUsability, nearestSpots, classifyStation, swimRelevance,
  rankCoverageGaps, clusterGaps, COVERAGE_CONFIG,
} from '../api/_lib/observations/coverage.js';
import {
  gapToSuggestion, buildGapSuggestions, gapCandidateKey,
} from '../api/_lib/observations/gap-discovery.js';
import {
  isAutoApprovableStationMatch, dryRunAutoApproval,
} from '../api/_lib/observations/auto-approve.js';

const NOW = new Date('2026-08-18T12:00:00Z');
const hoursAgo = (h) => new Date(NOW.getTime() - h * 3_600_000);

const SPOT_OCEAN = { id: 'spot-ocean', name: 'Test Beach', water_type: 'OCEAN', latitude: 50.7199, longitude: -1.8338, country_code: 'GB' };
const SPOT_POOL = { id: 'spot-pool', name: 'Test Lido', water_type: 'POOL', latitude: 51.4306, longitude: -0.1538, country_code: 'GB' };
const SPOTS = [SPOT_OCEAN, SPOT_POOL];

const station = (over = {}) => ({
  id: 'st-1', externalId: 'TEST1', providerCode: 'ndbc', name: 'Test Nearshore Buoy',
  latitude: 50.7211, longitude: -1.8398, stationType: 'buoy', waterBody: null,
  sensorDepthM: null, temperatureAvailable: true, active: true, metadata: {},
  latestTempAt: hoursAgo(1), latestTempC: 18.4, ...over,
});

const context = (over = {}) => ({
  spots: SPOTS,
  linksByStation: new Map(),
  spotsWithApprovedPrimary: new Set(),
  ...over,
});

// ── usability ───────────────────────────────────────────────────────────────

test('usability: recent temperature is usable', () => {
  const u = stationUsability(station(), { now: NOW });
  assert.equal(u.usable, true);
  assert.ok(u.ageHours < 2);
});

test('usability: a capability flag without data is NOT usable', () => {
  const u = stationUsability(station({ latestTempC: null, latestTempAt: null }), { now: NOW });
  assert.equal(u.usable, false);
  assert.match(u.reason, /capability flag only/);
});

test('usability: stale observation is not usable', () => {
  const u = stationUsability(station({ latestTempAt: hoursAgo(100) }), { now: NOW });
  assert.equal(u.usable, false);
  assert.match(u.reason, /stale/);
});

test('usability: inactive station is not usable', () => {
  assert.equal(stationUsability(station({ active: false }), { now: NOW }).usable, false);
});

// ── nearest spot ────────────────────────────────────────────────────────────

test('nearest: finds the closest spot and the closest ELIGIBLE spot separately', () => {
  // A station beside the pool: nearest is the pool, but a marine station may
  // never serve a pool, so nearestEligible must skip it.
  const poolside = station({ latitude: 51.4306, longitude: -0.1540 });
  const r = nearestSpots(poolside, SPOTS);
  assert.equal(r.nearest.spot.id, 'spot-pool');
  assert.equal(r.nearestEligible.spot.id, 'spot-ocean');
  assert.equal(r.withinSearch, false);
});

test('nearest: distance is real (station ~0.7 km from the beach)', () => {
  const r = nearestSpots(station(), SPOTS);
  assert.equal(r.nearest.spot.id, 'spot-ocean');
  assert.ok(r.nearest.distanceKm < 1, `got ${r.nearest.distanceKm}`);
});

// ── classification A–E ──────────────────────────────────────────────────────

test('classify A: an approved station is group A', () => {
  const links = new Map([['TEST1', [{ spot_id: 'spot-ocean', status: 'approved', is_primary: true }]]]);
  const c = classifyStation(station(), context({ linksByStation: links }), { now: NOW });
  assert.equal(c.group, 'A');
});

test('classify E: no temperature data is group E, whatever the flag says', () => {
  const c = classifyStation(station({ latestTempC: null, latestTempAt: null }), context(), { now: NOW });
  assert.equal(c.group, 'E');
});

test('classify E: stale station is group E', () => {
  const c = classifyStation(station({ latestTempAt: hoursAgo(200) }), context(), { now: NOW });
  assert.equal(c.group, 'E');
});

test('classify B: close, fresh, spot with no source is high confidence', () => {
  const c = classifyStation(station(), context(), { now: NOW });
  assert.equal(c.group, 'B');
  assert.ok(c.suitabilityScore >= COVERAGE_CONFIG.highConfidenceScore);
});

test('classify C: a spot that already has a primary downgrades to review', () => {
  const c = classifyStation(station(), context({ spotsWithApprovedPrimary: new Set(['spot-ocean']) }), { now: NOW });
  assert.equal(c.group, 'C');
  assert.match(c.reason, /already has an approved primary/);
});

test('classify C: a manually rejected pairing is never re-proposed', () => {
  const links = new Map([['TEST1', [{ spot_id: 'spot-ocean', status: 'rejected', is_primary: false }]]]);
  const c = classifyStation(station(), context({ linksByStation: links }), { now: NOW });
  assert.equal(c.group, 'C');
  assert.match(c.reason, /manually rejected/);
});

test('classify D: usable station with no eligible spot in range is a coverage gap', () => {
  const far = station({ latitude: 10, longitude: 10 });
  const c = classifyStation(far, context(), { now: NOW });
  assert.equal(c.group, 'D');
  assert.match(c.reason, /beyond the|no eligible/);
});

test('classify D: a marine station beside a POOL spot is a gap, not a match', () => {
  // The pool is 0.02 km away but structurally ineligible — the station has
  // no spot it may serve, which is a coverage gap.
  const poolside = station({ latitude: 51.4306, longitude: -0.1540 });
  const c = classifyStation(poolside, context(), { now: NOW });
  assert.equal(c.group, 'D');
});

// ── swim relevance ──────────────────────────────────────────────────────────

test('relevance: a name-based signal is required for probable_swim_water', () => {
  assert.equal(swimRelevance({ name: 'Boscombe Beach Buoy', stationType: 'buoy' }).verdict, 'probable_swim_water');
  // Shore-mounted alone must NOT qualify — that describes most C-MAN
  // stations, on breakwaters and light towers nobody swims at.
  const typeOnly = swimRelevance({ name: 'Station 44099', stationType: 'fixed' });
  assert.equal(typeOnly.verdict, 'observation_only');
  assert.equal(typeOnly.nameSignals, 0);
});

test('relevance: an offshore distance in the name beats a "Bay" in the name', () => {
  // Real catalogue entries that fooled an earlier version of this heuristic.
  for (const name of [
    'BAY OF CAMPECHE - 214 NM NE of Veracruz, MX',
    'HALF MOON BAY - 24NM SSW of San Francisco, CA',
    'ORANGE BEACH - 44 NM SE of Mobile, AL',
    'DELAWARE BAY 26 NM Southeast of Cape May, NJ',
  ]) {
    assert.equal(swimRelevance({ name, stationType: 'buoy' }).verdict, 'offshore_or_industrial', name);
  }
});

test('relevance: industrial installations are excluded', () => {
  assert.equal(swimRelevance({ name: 'Oakland Berth 34, CA', stationType: 'fixed' }).verdict, 'offshore_or_industrial');
});

// ── gap ranking and clustering ──────────────────────────────────────────────

function gap({ station: stationOver = {}, ...over } = {}) {
  const st = station({ latitude: 10, longitude: 10, ...stationOver });
  return {
    station: st, group: 'D',
    usability: stationUsability(st, { now: NOW }),
    nearestSpot: SPOT_OCEAN, nearestDistanceKm: 900,
    nearestEligibleSpot: SPOT_OCEAN, nearestEligibleDistanceKm: 900,
    ...over,
  };
}

test('clusterGaps: nearby stations form one cluster, distant ones do not', () => {
  const gaps = rankCoverageGaps([
    gap({ station: { id: 'a', externalId: 'A', name: 'Erie Beach Buoy', latitude: 42.15, longitude: -80.14 } }),
    gap({ station: { id: 'b', externalId: 'B', name: 'Erie Pier', latitude: 42.16, longitude: -80.10 } }),
    gap({ station: { id: 'c', externalId: 'C', name: 'Far Away Beach', latitude: 10, longitude: 100 } }),
  ]);
  const clusters = clusterGaps(gaps);
  assert.equal(clusters.length, 2);
  assert.equal(clusters[0].stationCount, 2);
  assert.ok(clusters[0].localityHints.length >= 2);
});

// ── gap → discovery candidate ───────────────────────────────────────────────

test('discovery: a swim-signal gap becomes a pending suggestion', () => {
  const g = { ...gap({ station: { id: 'st-x', externalId: 'BEACH1', name: 'Edgewater Beach Buoy' } }) };
  g.relevance = swimRelevance(g.station);
  const row = gapToSuggestion(g);
  assert.ok(row);
  assert.equal(row.status, 'pending');
  assert.equal(row.source, 'observation_gap');
  assert.equal(row.observation_station_id, 'st-x');
  assert.equal(row.spot_name, 'Edgewater Beach Buoy');
  // Nothing invented: no country guessed from coordinates.
  assert.equal(row.country_code, null);
  // The reviewer is told what the sensor does and does not prove.
  assert.match(row.description, /NOT VERIFIED/);
  // Crucially it is not a spot, and carries no user.
  assert.equal(row.user_id, undefined);
});

test('discovery: a gap with no swim signal is not proposed', () => {
  const g = gap({ station: { id: 'st-y', externalId: 'X', name: 'Station 44099' } });
  g.relevance = swimRelevance(g.station);
  assert.equal(gapToSuggestion(g), null);
});

test('discovery: a station close to an existing spot is a matching question, not discovery', () => {
  const g = gap({ station: { id: 'st-z', name: 'Nice Beach Buoy' }, nearestDistanceKm: 2 });
  g.relevance = swimRelevance(g.station);
  assert.equal(gapToSuggestion(g), null);
});

test('discovery: the same station never produces a duplicate candidate', () => {
  const g = gap({ station: { id: 'st-dup', externalId: 'D1', name: 'Sunset Beach Nearshore' } });
  g.relevance = swimRelevance(g.station);

  const first = buildGapSuggestions([g], new Set());
  assert.equal(first.rows.length, 1);

  // Second run, with the station already suggested — the deterministic key.
  const second = buildGapSuggestions([g], new Set(['st-dup']));
  assert.equal(second.rows.length, 0);
  assert.equal(second.skipped.alreadySuggested, 1);
});

test('discovery: candidate key is stable and station-scoped', () => {
  const k = gapCandidateKey({ providerCode: 'ndbc', externalId: 'ABC' });
  assert.equal(k, 'observation_gap:ndbc:ABC');
  assert.equal(k, gapCandidateKey({ providerCode: 'ndbc', externalId: 'ABC' }));
});

// ── auto-approval (dry run framework) ───────────────────────────────────────

const autoMatch = (over = {}) => ({
  spot: SPOT_OCEAN,
  station: station({ stationType: 'fixed', sensorDepthM: 1, waterBody: 'coastal', latestTempAt: hoursAgo(0.5) }),
  distanceKm: 1.2,
  suitabilityScore: 92,
  existingLinks: [],
  competingScores: [],
  ...over,
});

test('auto-approve: a textbook match qualifies', () => {
  const v = isAutoApprovableStationMatch(autoMatch(), { now: NOW });
  assert.equal(v.autoApprovable, true, v.blockers.join('; '));
});

test('auto-approve: NEVER resurrects a manually rejected pairing', () => {
  const v = isAutoApprovableStationMatch(autoMatch({
    existingLinks: [{ station_external_id: 'TEST1', status: 'rejected', is_primary: false }],
  }), { now: NOW });
  assert.equal(v.autoApprovable, false);
  assert.match(v.blockers.join(' '), /REJECTED/);
});

test('auto-approve: NEVER displaces a manually approved primary', () => {
  const v = isAutoApprovableStationMatch(autoMatch({
    existingLinks: [{ station_external_id: 'OTHER', status: 'approved', is_primary: true }],
  }), { now: NOW });
  assert.equal(v.autoApprovable, false);
  assert.match(v.blockers.join(' '), /never displace/);
});

test('auto-approve: an already-approved pairing is a no-op, not a re-approval', () => {
  const v = isAutoApprovableStationMatch(autoMatch({
    existingLinks: [{ station_external_id: 'TEST1', status: 'approved', is_primary: true }],
  }), { now: NOW });
  assert.equal(v.autoApprovable, false);
});

test('auto-approve: a competing station of similar quality blocks it', () => {
  const v = isAutoApprovableStationMatch(autoMatch({ competingScores: [88] }), { now: NOW });
  assert.equal(v.autoApprovable, false);
  assert.match(v.blockers.join(' '), /competing/);
});

test('auto-approve: unknown metadata blocks — unknown is never permission', () => {
  for (const [field, patch] of [
    ['depth', { sensorDepthM: null }],
    ['water body', { waterBody: null }],
    ['station type', { stationType: null }],
  ]) {
    const v = isAutoApprovableStationMatch(autoMatch({ station: station({
      stationType: 'fixed', sensorDepthM: 1, waterBody: 'coastal', latestTempAt: hoursAgo(0.5), ...patch }) }), { now: NOW });
    assert.equal(v.autoApprovable, false, `${field} unknown should block`);
  }
});

test('auto-approve: a non-coastal water body cannot auto-approve', () => {
  const v = isAutoApprovableStationMatch(autoMatch({ station: station({
    stationType: 'fixed', sensorDepthM: 1, waterBody: 'lake', latestTempAt: hoursAgo(0.5) }) }), { now: NOW });
  assert.equal(v.autoApprovable, false);
  assert.match(v.blockers.join(' '), /not coastal/);
});

test('auto-approve: distance, score, staleness and untrusted providers each block', () => {
  assert.equal(isAutoApprovableStationMatch(autoMatch({ distanceKm: 9 }), { now: NOW }).autoApprovable, false);
  assert.equal(isAutoApprovableStationMatch(autoMatch({ suitabilityScore: 60 }), { now: NOW }).autoApprovable, false);
  assert.equal(isAutoApprovableStationMatch(autoMatch({ station: station({
    stationType: 'fixed', sensorDepthM: 1, waterBody: 'coastal', latestTempAt: hoursAgo(30) }) }), { now: NOW }).autoApprovable, false);
  assert.equal(isAutoApprovableStationMatch(autoMatch({ station: station({
    stationType: 'fixed', sensorDepthM: 1, waterBody: 'coastal', latestTempAt: hoursAgo(0.5),
    providerCode: 'brand_new_provider' }) }), { now: NOW }).autoApprovable, false);
});

test('auto-approve dry run: reports agreement and never overrides a human no', () => {
  // Shaped like the real rejections in production (Ocean Beach ← SF Bay
  // stations): plausible on a map, 8–19 km away, mid-range score. Run blind,
  // the rules must independently decline them.
  const rejected = autoMatch({
    distanceKm: 14.7,
    suitabilityScore: 63,
    existingLinks: [{ station_external_id: 'TEST1', status: 'rejected', is_primary: false }],
  });
  const result = dryRunAutoApproval([autoMatch(), rejected], { now: NOW });
  assert.equal(result.would.length, 1);
  assert.equal(result.agreement.humanRejectedCount, 1);
  // The headline safety number: the rules, run blind, must not approve a
  // pairing a human rejected. If this is ever non-zero, auto-approval is
  // miscalibrated and must not be enabled.
  assert.equal(result.agreement.humanRejectedThatRulesWouldApprove, 0);
});

test('auto-approve dry run: a human rejection the rules WOULD approve is surfaced, not hidden', () => {
  // The calibration alarm itself must work. A textbook-perfect match that a
  // human nonetheless rejected means the rules are missing something the
  // human could see — exactly the signal that keeps auto-approval off.
  const perfectButRejected = autoMatch({
    existingLinks: [{ station_external_id: 'TEST1', status: 'rejected', is_primary: false }],
  });
  const result = dryRunAutoApproval([perfectButRejected], { now: NOW });
  assert.equal(result.agreement.humanRejectedThatRulesWouldApprove, 1);
});

// ── cross-provider station identity ─────────────────────────────────────────

test('physical key: the same instrument from two providers resolves to one id', async () => {
  const { physicalStationKey } = await import('../api/_lib/observations/matching.js');
  // Real pairs from the catalogue — NDBC and Copernicus both publish these.
  assert.equal(physicalStationKey('GL_TS_MO_TIBC1'), physicalStationKey('TIBC1'));
  assert.equal(physicalStationKey('GL_TS_MO_46254'), physicalStationKey('46254'));
  assert.equal(physicalStationKey('NO_TS_MO_6201008'), '6201008');
  assert.equal(physicalStationKey('MO_TS_MO_61499'), '61499');
  // Distinct stations stay distinct.
  assert.notEqual(physicalStationKey('46254'), physicalStationKey('46266'));
  assert.equal(physicalStationKey(null), '');
});

test('classify: a rejection follows the instrument across providers', async () => {
  // The defect this guards: Dave rejected TIBC1 for Ocean Beach; the
  // Copernicus copy of the same gauge then came back as a fresh candidate.
  const cmemsTwin = station({ externalId: 'GL_TS_MO_TEST1', providerCode: 'cmems_insitu' });
  const ctx = context({
    rejectedPhysicalKeys: new Set([`${SPOT_OCEAN.id}|TEST1`]),
  });
  const c = classifyStation(cmemsTwin, ctx, { now: NOW });
  assert.equal(c.group, 'C');
  assert.match(c.reason, /manually rejected/);
});

// ── country is mandatory when the caller enforces it ────────────────────────

test('discovery: a suggestion without a country can be refused', async () => {
  // The 2026-08-18 incident: suggestions filed with country_code NULL became
  // spots whose domain defaulted to South Africa's ATLANTIC, putting sixteen
  // US beaches on the Cape Town page.
  const { gapToSuggestion, GAP_DISCOVERY_CONFIG } = await import('../api/_lib/observations/gap-discovery.js');
  const g = gap({ station: { id: 'st-c', externalId: 'C1', name: 'Somewhere Beach' } });
  g.relevance = swimRelevance(g.station);
  const strict = { config: { ...GAP_DISCOVERY_CONFIG, requireCountry: true } };

  assert.equal(gapToSuggestion(g, strict), null, 'no country → refused');
  const withCountry = gapToSuggestion(g, { ...strict, countryCode: 'US', country: 'United States' });
  assert.ok(withCountry);
  assert.equal(withCountry.country_code, 'US');
});
