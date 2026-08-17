// The public conditions service + the conditions card language contract.
//
// The language rule this file exists to enforce: stale data is NEVER
// described as Live / Current / Today, and STALE observations render
// nothing at all. This is the observation-platform version of the same
// truth rule the spot titles learned in increment 5.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getObservationState, FRESHNESS_THRESHOLDS } from '../api/_lib/temperature-freshness.js';
import { getSpotConditions } from '../api/_lib/observations/conditions.js';
import { renderConditionsCard, formatAge, windDirectionLabel } from '../api/_lib/observations/render.js';

const NOW = new Date('2026-08-17T07:00:00Z');
const SPOT_ID = '27ab125b-5e62-4bda-b1fc-73ea4e86be9e';

const hoursAgo = (h) => new Date(NOW.getTime() - h * 3_600_000).toISOString();

// ── freshness states (single source of truth) ───────────────────────────────

test('observation states derive from the central thresholds', () => {
  assert.equal(getObservationState(hoursAgo(1), { now: NOW }).state, 'LIVE');
  assert.equal(getObservationState(hoursAgo(FRESHNESS_THRESHOLDS.liveHours), { now: NOW }).state, 'LIVE');
  assert.equal(getObservationState(hoursAgo(FRESHNESS_THRESHOLDS.liveHours + 0.1), { now: NOW }).state, 'RECENT');
  assert.equal(getObservationState(hoursAgo(FRESHNESS_THRESHOLDS.recentHours + 0.1), { now: NOW }).state, 'LAST_READING');
  assert.equal(getObservationState(hoursAgo(FRESHNESS_THRESHOLDS.lastReadingDays * 24 + 1), { now: NOW }).state, 'STALE');
  assert.equal(getObservationState(null, { now: NOW }), null);
  assert.equal(getObservationState('not a date', { now: NOW }), null);
});

test('only LIVE may say live', () => {
  assert.equal(getObservationState(hoursAgo(1), { now: NOW }).canSayLive, true);
  assert.equal(getObservationState(hoursAgo(12), { now: NOW }).canSayLive, false);
  assert.equal(getObservationState(hoursAgo(100), { now: NOW }).canSayLive, false);
});

// ── getSpotConditions ───────────────────────────────────────────────────────

function fetchReturning(rows, status = 200) {
  return async () => ({ ok: status >= 200 && status < 300, status, json: async () => rows });
}

const viewRow = (over = {}) => ({
  spot_id: SPOT_ID, station_id: 'st-1', is_primary: true, distance_km: 1.2,
  station_name: 'Scripps Nearshore', station_type: 'buoy', sensor_depth_m: null,
  water_body: null, provider_code: 'ndbc', provider_name: 'NOAA National Data Buoy Center',
  attribution: 'Data: NOAA National Data Buoy Center',
  observed_at: hoursAgo(0.4), water_temperature_c: '16.4', wave_height_m: '0.8',
  wave_period_s: '11', wind_speed_ms: null, wind_direction_deg: null,
  tide_height_m: null, quality_code: 'ndbc_realtime',
  ...over,
});

test('conditions: normalizes a live view row', async () => {
  const c = await getSpotConditions(SPOT_ID, { now: NOW, fetchImpl: fetchReturning([viewRow()]) });
  assert.equal(c.status, 'LIVE');
  assert.equal(c.temperatureC, 16.4);
  assert.equal(c.ageMinutes, 24);
  assert.equal(c.sourceType, 'nearby_measurement');
  assert.equal(c.station.name, 'Scripps Nearshore');
  assert.equal(c.station.distanceKm, 1.2);
  assert.equal(c.waveHeightM, 0.8);
  assert.equal(c.windSpeedMs, null);
});

test('conditions: never throws — every failure path returns null', async () => {
  assert.equal(await getSpotConditions(SPOT_ID, { fetchImpl: fetchReturning(null, 500) }), null);
  assert.equal(await getSpotConditions(SPOT_ID, { fetchImpl: fetchReturning([], 200) }), null);
  assert.equal(await getSpotConditions(SPOT_ID, { fetchImpl: async () => { throw new Error('network down'); } }), null);
  assert.equal(await getSpotConditions('not-a-uuid', { fetchImpl: fetchReturning([viewRow()]) }), null);
  // A row without a temperature is not conditions:
  assert.equal(await getSpotConditions(SPOT_ID, {
    now: NOW, fetchImpl: fetchReturning([viewRow({ water_temperature_c: null })]),
  }), null);
});

// ── the card's language contract ────────────────────────────────────────────

async function cardFor(observedAtHoursAgo) {
  const c = await getSpotConditions(SPOT_ID, {
    now: NOW, fetchImpl: fetchReturning([viewRow({ observed_at: hoursAgo(observedAtHoursAgo) })]),
  });
  return { conditions: c, html: renderConditionsCard(c) };
}

test('card: LIVE says Live measurement', async () => {
  const { html } = await cardFor(0.4);
  assert.match(html, /Live measurement/);
  assert.match(html, /16\.4/);
  assert.match(html, /Nearby measured water temperature/);
  assert.match(html, /Scripps Nearshore/);
  assert.match(html, /1\.2 km away/);
  assert.match(html, /NOAA/);
});

test('card: RECENT never says Live, Current, or Today', async () => {
  const { html } = await cardFor(12);
  assert.match(html, /Recent measurement/);
  assert.doesNotMatch(html, /\blive\b/i);
  assert.doesNotMatch(html, /\bcurrent\b/i);
  assert.doesNotMatch(html, /\btoday\b/i);
});

test('card: LAST_READING never says Live, Current, or Today', async () => {
  const { html } = await cardFor(3 * 24);
  assert.match(html, /Last reading/);
  assert.doesNotMatch(html, /\blive\b/i);
  assert.doesNotMatch(html, /\bcurrent\b/i);
  assert.doesNotMatch(html, /\btoday\b/i);
});

test('card: STALE renders nothing at all', async () => {
  const { conditions, html } = await cardFor(10 * 24);
  assert.equal(conditions.status, 'STALE');
  assert.equal(html, '');
});

test('card: null conditions render nothing (spot without a station)', () => {
  assert.equal(renderConditionsCard(null), '');
});

test('card: only fields that exist are shown — no placeholders', async () => {
  const c = await getSpotConditions(SPOT_ID, {
    now: NOW,
    fetchImpl: fetchReturning([viewRow({ wave_height_m: null, wave_period_s: null })]),
  });
  const html = renderConditionsCard(c);
  assert.doesNotMatch(html, /Swell/);
  assert.doesNotMatch(html, /Period/);
  assert.doesNotMatch(html, /—/); // no dash placeholders
});

test('card: on-site sensors do not use the "nearby" wording', async () => {
  const c = await getSpotConditions(SPOT_ID, {
    now: NOW, fetchImpl: fetchReturning([viewRow({ distance_km: 0.1 })]),
  });
  const html = renderConditionsCard(c);
  assert.match(html, /Measured water temperature/);
  assert.doesNotMatch(html, /Nearby measured/);
});

test('card: attribution is present', async () => {
  const { html } = await cardFor(1);
  assert.match(html, /Data: NOAA National Data Buoy Center/);
});

// ── helpers ─────────────────────────────────────────────────────────────────

test('formatAge covers minutes, hours, days', () => {
  assert.equal(formatAge(24), '24 minutes ago');
  assert.equal(formatAge(90), '2 hours ago');
  assert.equal(formatAge(60 * 24 * 3), '3 days ago');
  assert.equal(formatAge(NaN), '');
});

test('windDirectionLabel maps compass sectors', () => {
  assert.equal(windDirectionLabel(0), 'N');
  assert.equal(windDirectionLabel(225), 'SW');
  assert.equal(windDirectionLabel(359), 'N');
  assert.equal(windDirectionLabel(NaN), null);
});
