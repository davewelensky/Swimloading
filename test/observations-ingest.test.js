// Ingestion runner: duplicate protection, per-station failure isolation,
// provider outage containment, capability learning, bookkeeping order.
// Uses an in-memory store double implementing the same interface as
// createSupabaseStore, so every branch is exercised without a network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runProviderIngestion } from '../api/_lib/observations/ingest.js';

const NOW = new Date('2026-08-17T07:00:00Z');

function memoryStore({ provider = { id: 'prov-1', code: 'ndbc', enabled: true }, linked = [] } = {}) {
  const state = {
    provider,
    stations: new Map(),       // external_id → row
    observations: new Map(),   // `${station_id}|${observed_at}` → row
    successes: [],
    errors: [],
    linked,
  };
  return {
    state,
    async getProvider(code) { return code === provider.code ? provider : null; },
    async upsertStations(providerId, stations) {
      const map = new Map();
      for (const s of stations) {
        const id = `st-${s.externalId}`;
        state.stations.set(s.externalId, { id, ...s });
        map.set(s.externalId, id);
      }
      return map;
    },
    async insertObservations(rows) {
      let inserted = 0;
      for (const r of rows) {
        const key = `${r.station_id}|${r.observed_at}`;
        if (!state.observations.has(key)) { state.observations.set(key, r); inserted++; }
      }
      return inserted;
    },
    async getLinkedExternalIds() { return state.linked; },
    async markStationSuccess(stationId, info) { state.successes.push({ stationId, ...info }); },
    async markStationError(stationId, info) { state.errors.push({ stationId, ...info }); },
    async markProviderRun() {},
  };
}

const CATALOGUE = [
  { externalId: 'AAA', name: 'A', latitude: 1, longitude: 1, stationType: 'buoy', capabilities: {}, metadata: {} },
  { externalId: 'BBB', name: 'B', latitude: 2, longitude: 2, stationType: 'fixed', capabilities: {}, metadata: {} },
];

function obs(stationId, isoAt, temp) {
  return {
    externalStationId: stationId,
    observedAt: new Date(isoAt),
    waterTemperatureC: temp,
    waveHeightM: null, wavePeriodS: null, windSpeedMs: null,
    windDirectionDeg: null, tideHeightM: null,
    qualityCode: 'test', raw: null,
  };
}

test('ingest: happy path stores observations and marks success after storage', async () => {
  const store = memoryStore({ linked: ['AAA'] });
  const provider = {
    code: 'ndbc',
    fetchCatalogue: async () => CATALOGUE,
    fetchBulkObservations: async () => [obs('BBB', '2026-08-17T06:00:00Z', 18.2)],
    fetchStationObservations: async () => [obs('AAA', '2026-08-17T06:30:00Z', 21.0)],
  };
  const summary = await runProviderIngestion({ provider, store, now: NOW });
  assert.equal(summary.error, null);
  assert.equal(summary.observationsInserted, 2);
  assert.equal(store.state.observations.size, 2);
  // capability learned from data:
  const successA = store.state.successes.find((s) => s.stationId === 'st-AAA');
  assert.equal(successA.capabilities.temperature, true);
  assert.equal(successA.capabilities.waveHeight, false);
});

test('ingest: re-running the same feed inserts nothing new (duplicate protection)', async () => {
  const store = memoryStore({ linked: [] });
  const provider = {
    code: 'ndbc',
    fetchCatalogue: async () => CATALOGUE,
    fetchBulkObservations: async () => [obs('AAA', '2026-08-17T06:00:00Z', 20)],
    fetchStationObservations: async () => [],
  };
  const first = await runProviderIngestion({ provider, store, now: NOW });
  const second = await runProviderIngestion({ provider, store, now: NOW });
  assert.equal(first.observationsInserted, 1);
  assert.equal(second.observationsInserted, 0);
  assert.equal(store.state.observations.size, 1);
});

test('ingest: one failing station is recorded and does not fail the run', async () => {
  const store = memoryStore({ linked: ['AAA', 'BBB'] });
  const provider = {
    code: 'ndbc',
    fetchCatalogue: async () => CATALOGUE,
    fetchBulkObservations: null,
    fetchStationObservations: async (id) => {
      if (id === 'AAA') throw new Error('upstream 404');
      return [obs('BBB', '2026-08-17T06:00:00Z', 17)];
    },
  };
  const summary = await runProviderIngestion({ provider, store, now: NOW });
  assert.equal(summary.error, null);                      // the RUN succeeded
  assert.equal(summary.observationsInserted, 1);          // BBB's data landed
  assert.equal(summary.stationErrors.length, 1);
  assert.equal(summary.stationErrors[0].station, 'AAA');
  assert.equal(store.state.errors.length, 1);             // recorded on the row
  assert.equal(store.state.errors[0].stationId, 'st-AAA');
});

test('ingest: bulk failure falls back to the per-station pass', async () => {
  const store = memoryStore({ linked: ['AAA'] });
  const provider = {
    code: 'ndbc',
    fetchCatalogue: async () => CATALOGUE,
    fetchBulkObservations: async () => { throw new Error('latest_obs 503'); },
    fetchStationObservations: async () => [obs('AAA', '2026-08-17T06:00:00Z', 19)],
  };
  const summary = await runProviderIngestion({ provider, store, now: NOW });
  assert.equal(summary.error, null);
  assert.equal(summary.observationsInserted, 1);
  assert.ok(summary.stationErrors.some((e) => e.station === '*bulk*'));
});

test('ingest: catalogue outage aborts cleanly — nothing written, error reported', async () => {
  const store = memoryStore();
  const provider = {
    code: 'ndbc',
    fetchCatalogue: async () => { throw new Error('activestations.xml unreachable'); },
    fetchBulkObservations: async () => [obs('AAA', '2026-08-17T06:00:00Z', 20)],
    fetchStationObservations: async () => [],
  };
  const summary = await runProviderIngestion({ provider, store, now: NOW });
  assert.match(summary.error, /catalogue/);
  assert.equal(store.state.observations.size, 0);
  assert.equal(store.state.successes.length, 0);
});

test('ingest: a disabled provider refuses to run', async () => {
  const store = memoryStore({ provider: { id: 'p', code: 'mywaterlive', enabled: false } });
  const provider = { code: 'mywaterlive', fetchCatalogue: async () => [], fetchStationObservations: async () => [] };
  const summary = await runProviderIngestion({ provider, store, now: NOW });
  assert.match(summary.error, /disabled/);
});

test('ingest: observations for stations missing from the catalogue are skipped, not fatal', async () => {
  const store = memoryStore({ linked: [] });
  const provider = {
    code: 'ndbc',
    fetchCatalogue: async () => CATALOGUE,
    fetchBulkObservations: async () => [obs('GHOST', '2026-08-17T06:00:00Z', 15)],
    fetchStationObservations: async () => [],
  };
  const summary = await runProviderIngestion({ provider, store, now: NOW });
  assert.equal(summary.error, null);
  assert.equal(summary.observationsInserted, 0);
});
