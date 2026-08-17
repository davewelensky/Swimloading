// Generic ERDDAP adapter: CSV parsing, unit conversion, catalogue
// derivation, empty-window semantics, malformed feeds, ingest integration.
// The fixture is a real IWBNetwork download (2026-08-17).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  parseErddapCsv, datasetCsvToObservations, datasetCsvToStations,
  createErddapProvider, irelandMarineInstituteProvider,
} from '../api/_lib/observations/providers/erddap.js';
import { runProviderIngestion } from '../api/_lib/observations/ingest.js';

const FIXTURE = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'erddap', 'iwb-network.csv'), 'utf8');

const IWB = irelandMarineInstituteProvider.datasets[0];

test('erddap: parses the real IWBNetwork CSV (header + units + rows)', () => {
  const { columns, units, rows } = parseErddapCsv(FIXTURE);
  assert.equal(columns[0], 'station_id');
  assert.equal(units[4], 'degrees_C');
  assert.ok(rows.length >= 10);
});

test('erddap: observations extract with dataset-prefixed ids and knots→m/s', () => {
  const obs = datasetCsvToObservations(IWB, FIXTURE);
  assert.ok(obs.length >= 10);
  const m2 = obs.find((o) => o.externalStationId === 'IWBNetwork:M2');
  assert.ok(m2);
  assert.ok(m2.waterTemperatureC > 10 && m2.waterTemperatureC < 25);
  assert.ok(m2.waveHeightM >= 0);
  // First fixture row: WindSpeed 12.523 knots → 6.44 m/s
  const first = obs[0];
  assert.ok(Math.abs(first.windSpeedMs - 12.523 * 0.514444) < 0.01, `knots converted, got ${first.windSpeedMs}`);
  assert.equal(first.qualityCode, 'imi_realtime');
});

test('erddap: stations derive from the data with newest position winning', () => {
  const stations = datasetCsvToStations(IWB, FIXTURE);
  const ids = stations.map((s) => s.externalId).sort();
  assert.ok(ids.includes('IWBNetwork:M2'));
  assert.ok(ids.every((id) => id.startsWith('IWBNetwork:')));
  const m2 = stations.find((s) => s.externalId === 'IWBNetwork:M2');
  assert.ok(Math.abs(m2.latitude - 53.4836) < 0.01);
  assert.equal(m2.capabilities.temperature, true);
  assert.equal(m2.capabilities.tide, false);
  assert.equal(m2.stationType, 'buoy');
});

test('erddap: NaN and empty cells become null, never 0', () => {
  const text = [
    'station_id,time,longitude,latitude,SeaTemperature,WaveHeight,WavePeriod,WindSpeed,WindDirection',
    ',UTC,degrees_east,degrees_north,degrees_C,meters,seconds,knots,degrees true',
    'M9,2026-08-17T07:00:00Z,-5.4,53.4,NaN,0.5,,NaN,',
  ].join('\n');
  const [o] = datasetCsvToObservations(IWB, text);
  assert.equal(o.waterTemperatureC, null);
  assert.equal(o.waveHeightM, 0.5);
  assert.equal(o.wavePeriodS, null);
  assert.equal(o.windSpeedMs, null);
});

test('erddap: malformed and error payloads degrade to empty', () => {
  assert.deepEqual(datasetCsvToObservations(IWB, ''), []);
  assert.deepEqual(datasetCsvToObservations(IWB, 'Error {\n code=404;\n}'), []);
  assert.deepEqual(datasetCsvToObservations(IWB, '<html>tomcat 400</html>'), []);
  assert.deepEqual(datasetCsvToObservations(IWB, 'a,b\n1,2'), []); // wrong columns
  assert.deepEqual(datasetCsvToStations(IWB, null), []);
});

test('erddap: empty result window (ERDDAP 404 nRows=0) is empty, not an error', async () => {
  const provider = createErddapProvider({
    code: 'x', baseUrl: 'https://example.test/erddap',
    datasets: [IWB],
  });
  const fetchImpl = async () => ({ ok: false, status: 404, text: async () => 'Error { nRows = 0 }' });
  const obs = await provider.fetchBulkObservations({ fetchImpl });
  assert.deepEqual(obs, []);
});

test('erddap: a real upstream failure DOES throw (the runner isolates it)', async () => {
  const provider = createErddapProvider({
    code: 'x', baseUrl: 'https://example.test/erddap', datasets: [IWB],
  });
  const fetchImpl = async () => ({ ok: false, status: 503, text: async () => 'down' });
  await assert.rejects(() => provider.fetchBulkObservations({ fetchImpl }), /503/);
});

test('erddap: constraint operators are URL-encoded in request urls', async () => {
  const seen = [];
  const provider = createErddapProvider({
    code: 'x', baseUrl: 'https://example.test/erddap', datasets: [IWB],
  });
  const fetchImpl = async (url) => { seen.push(url); return { ok: true, status: 200, text: async () => FIXTURE }; };
  await provider.fetchBulkObservations({ fetchImpl });
  await provider.fetchStationObservations('IWBNetwork:M2', { fetchImpl });
  for (const url of seen) {
    assert.ok(!/time>/.test(url), 'raw > must not appear (Tomcat rejects it)');
    assert.ok(/time%3E=/.test(url));
  }
  assert.ok(/station_id=%22M2%22/.test(seen[1]), 'station filter quoted + encoded');
});

test('erddap: full ingest through the generic runner (integration)', async () => {
  const state = { stations: new Map(), observations: new Map(), successes: [] };
  const store = {
    async getProvider() { return { id: 'p1', code: 'ireland_mi', enabled: true }; },
    async upsertStations(_pid, stations) {
      const map = new Map();
      for (const s of stations) { const id = `st-${s.externalId}`; state.stations.set(s.externalId, s); map.set(s.externalId, id); }
      return map;
    },
    async insertObservations(rows) {
      let n = 0;
      for (const r of rows) { const k = `${r.station_id}|${r.observed_at}`; if (!state.observations.has(k)) { state.observations.set(k, r); n++; } }
      return n;
    },
    async getLinkedExternalIds() { return []; },
    async markStationSuccess(id, info) { state.successes.push({ id, ...info }); },
    async markStationError() {},
    async markProviderRun() {},
  };
  const provider = createErddapProvider({
    code: 'ireland_mi', baseUrl: 'https://example.test/erddap', datasets: [IWB],
  });
  const fetchImpl = async () => ({ ok: true, status: 200, text: async () => FIXTURE });
  const summary = await runProviderIngestion({ provider, store, fetchOpts: { fetchImpl } });
  assert.equal(summary.error, null);
  assert.ok(summary.observationsInserted >= 10);
  assert.ok(state.stations.has('IWBNetwork:M2'));
  const m2success = state.successes.find((s) => state.stations.get('IWBNetwork:M2') && s.capabilities.temperature);
  assert.ok(m2success, 'temperature capability learned from data');
});
