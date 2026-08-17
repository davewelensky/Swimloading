// Match engine: distance, suitability scoring, structural eligibility,
// candidate generation. All pure functions, all pinned to a fixed clock.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { haversineKm } from '../api/seo-utils.js';
import {
  suitabilityScore, matchEligibility, generateCandidates, MATCH_CONFIG,
} from '../api/_lib/observations/matching.js';

const NOW = new Date('2026-08-17T07:00:00Z');

// ── distance ────────────────────────────────────────────────────────────────

test('haversine: La Jolla Shores to LJAC1 is ~1.1 km', () => {
  const d = haversineKm(32.8569, -117.2571, 32.8669, -117.2571);
  assert.ok(d > 1.0 && d < 1.2, `got ${d}`);
});

test('haversine: zero distance for identical points', () => {
  assert.equal(haversineKm(51.4306, -0.1538, 51.4306, -0.1538), 0);
});

test('haversine: Cape Town to Durban is ~1270 km (sanity, long range)', () => {
  const d = haversineKm(-33.9249, 18.4241, -29.8587, 31.0218);
  assert.ok(d > 1200 && d < 1350, `got ${d}`);
});

// ── suitability score ───────────────────────────────────────────────────────

const baseStation = {
  distanceKm: 1.0,
  stationType: 'fixed',
  sensorDepthM: 1,
  lastObservationAt: new Date(NOW.getTime() - 30 * 60000), // 30 min ago
};
const oceanSpot = { waterType: 'OCEAN' };

test('score: close, fresh, shallow, fixed station scores near the top', () => {
  const s = suitabilityScore(baseStation, oceanSpot, { now: NOW });
  assert.ok(s > 90, `got ${s}`);
});

test('score: distance dominates — same station further away scores lower', () => {
  const near = suitabilityScore(baseStation, oceanSpot, { now: NOW });
  const far = suitabilityScore({ ...baseStation, distanceKm: 20 }, oceanSpot, { now: NOW });
  assert.ok(far < near - 30, `near=${near} far=${far}`);
});

test('score: beyond the search radius is a hard 0', () => {
  assert.equal(suitabilityScore({ ...baseStation, distanceKm: 26 }, oceanSpot, { now: NOW }), 0);
  assert.equal(suitabilityScore({ ...baseStation, distanceKm: -1 }, oceanSpot, { now: NOW }), 0);
});

test('score: a silent station ranks below a reporting one at equal distance', () => {
  const fresh = suitabilityScore(baseStation, oceanSpot, { now: NOW });
  const silent = suitabilityScore({ ...baseStation, lastObservationAt: null }, oceanSpot, { now: NOW });
  const week = suitabilityScore(
    { ...baseStation, lastObservationAt: new Date(NOW.getTime() - 6 * 86400000) }, oceanSpot, { now: NOW });
  assert.ok(silent < week && week < fresh, `fresh=${fresh} week=${week} silent=${silent}`);
});

test('score: deep sensor ranks below surface sensor', () => {
  const surface = suitabilityScore(baseStation, oceanSpot, { now: NOW });
  const deep = suitabilityScore({ ...baseStation, sensorDepthM: 20 }, oceanSpot, { now: NOW });
  const unknown = suitabilityScore({ ...baseStation, sensorDepthM: null }, oceanSpot, { now: NOW });
  assert.ok(deep < unknown && unknown < surface);
});

test('score: unknown station type ranks below buoy ranks below fixed', () => {
  const fixed = suitabilityScore(baseStation, oceanSpot, { now: NOW });
  const buoy = suitabilityScore({ ...baseStation, stationType: 'buoy' }, oceanSpot, { now: NOW });
  const unknown = suitabilityScore({ ...baseStation, stationType: null }, oceanSpot, { now: NOW });
  assert.ok(unknown < buoy && buoy < fixed);
});

// ── structural eligibility ──────────────────────────────────────────────────

test('eligibility: pools and inland spots never match a marine station', () => {
  for (const waterType of ['POOL', 'LAKE', 'DAM', 'RIVER', 'TIDAL_POOL']) {
    const r = matchEligibility({}, { waterType });
    assert.equal(r.ok, false, waterType);
  }
  assert.equal(matchEligibility({}, { waterType: 'OCEAN' }).ok, true);
  assert.equal(matchEligibility({}, { waterType: 'LAGOON' }).ok, true);
});

test('eligibility: a station with a stated non-coastal water body is refused', () => {
  assert.equal(matchEligibility({ waterBody: 'lake' }, { waterType: 'OCEAN' }).ok, false);
  assert.equal(matchEligibility({ waterBody: 'pool' }, { waterType: 'OCEAN' }).ok, false);
  // Unknown water body cannot be used to refuse — it goes to a human instead.
  assert.equal(matchEligibility({ waterBody: null }, { waterType: 'OCEAN' }).ok, true);
});

// ── candidate generation ────────────────────────────────────────────────────

const laJolla = { id: 'spot-1', name: 'La Jolla Shores', water_type: 'OCEAN', latitude: 32.8569, longitude: -117.2571 };
const pool = { id: 'spot-2', name: 'Some Pool', water_type: 'POOL', latitude: 32.86, longitude: -117.25 };
const stations = [
  { externalId: 'LJAC1', name: 'La Jolla', latitude: 32.867, longitude: -117.257, stationType: 'fixed', temperatureAvailable: true, active: true, lastObservationAt: new Date(NOW.getTime() - 3600000) },
  { externalId: 'FAR01', name: 'Far Buoy', latitude: 34.0, longitude: -119.0, stationType: 'buoy', temperatureAvailable: true, active: true },
  { externalId: 'NOTMP', name: 'No Temp', latitude: 32.86, longitude: -117.26, stationType: 'buoy', temperatureAvailable: false, active: true },
  { externalId: 'DEAD1', name: 'Inactive', latitude: 32.86, longitude: -117.26, stationType: 'buoy', temperatureAvailable: true, active: false },
];

test('candidates: only in-range, active, temperature stations for coastal spots', () => {
  const { candidates } = generateCandidates([laJolla, pool], stations, { now: NOW });
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].station.externalId, 'LJAC1');
  assert.equal(candidates[0].spot.id, 'spot-1');
  assert.equal(candidates[0].status, 'candidate'); // never anything else here
  assert.ok(candidates[0].distanceKm < 1.5);
});

test('candidates: nothing is ever auto-primary, ranked by score desc', () => {
  const more = [...stations,
    { externalId: 'NEAR2', name: 'Second', latitude: 32.9, longitude: -117.26, stationType: 'buoy', temperatureAvailable: true, active: true }];
  const { candidates } = generateCandidates([laJolla], more, { now: NOW });
  assert.equal(candidates.length, 2);
  assert.ok(candidates[0].suitabilityScore >= candidates[1].suitabilityScore);
  for (const c of candidates) {
    assert.equal(c.status, 'candidate');
    assert.equal('isPrimary' in c, false);
  }
});

test('candidates: structural refusals are reported, not silently dropped', () => {
  const lakeStation = [{ externalId: 'LK1', name: 'Lake st', latitude: 32.86, longitude: -117.26, stationType: 'fixed', waterBody: 'lake', temperatureAvailable: true, active: true }];
  const { candidates, rejected } = generateCandidates([laJolla], lakeStation, { now: NOW });
  assert.equal(candidates.length, 0);
  assert.equal(rejected.length, 1);
  assert.match(rejected[0].reason, /water body/);
});
