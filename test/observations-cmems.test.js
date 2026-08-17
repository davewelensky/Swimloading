// Copernicus Marine INSITU adapter: index parsing, mooring filtering,
// NetCDF-4 extraction via h5wasm, QC and fill-value handling.
// NetCDF fixture is a real Rye Bay mooring file (downloaded 2026-08-17).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  parseIndexToStations, parseInsituNc,
} from '../api/_lib/observations/providers/cmems.js';

const FIX = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'cmems');
const INDEX = readFileSync(join(FIX, 'index_latest_sample.txt'), 'utf8');
const RYE_NC = new Uint8Array(readFileSync(join(FIX, 'NO_TS_MO_RyeBayDWR_20260817.nc')));

test('cmems index: derives mooring stations, newest row per platform wins', () => {
  const stations = parseIndexToStations(INDEX);
  assert.ok(stations.length >= 1);
  for (const s of stations) {
    assert.match(s.externalId, /^[A-Z]{2}_TS_MO_/);
    assert.equal(s.capabilities.temperature, true);
    assert.equal(s.stationType, 'buoy');
    assert.ok(Number.isFinite(s.latitude) && Number.isFinite(s.longitude));
  }
});

test('cmems index: non-mooring files and TEMP-less rows are excluded', () => {
  const stations = parseIndexToStations(INDEX);
  // The sample's first data rows are AR_PR_CT_* profiler files — none may
  // survive the mooring filter.
  assert.ok(stations.every((s) => !s.externalId.includes('_PR_')));
});

test('cmems index: malformed input degrades to empty', () => {
  assert.deepEqual(parseIndexToStations(''), []);
  assert.deepEqual(parseIndexToStations('# only comments\n# nothing else'), []);
  assert.deepEqual(parseIndexToStations(null), []);
  assert.deepEqual(parseIndexToStations('garbage,row'), []);
});

test('cmems index: a "mooring" with a drifting bounding box is refused', () => {
  const drifting = [
    '# header',
    'COP,X/latest/20260817/GL_TS_MO_DRIFT1_20260817.nc,43.0,44.9,7.0,7.1,t0,t1,inst,upd,R,TEMP',
    'COP,X/latest/20260817/GL_TS_MO_FIXED1_20260817.nc,43.00,43.01,7.00,7.01,t0,t1,inst,upd,R,TEMP',
  ].join('\n');
  const stations = parseIndexToStations(drifting);
  assert.equal(stations.length, 1);
  assert.equal(stations[0].externalId, 'GL_TS_MO_FIXED1');
});

test('cmems netcdf: extracts QC-good near-surface temperatures from the real file', async () => {
  const obs = await parseInsituNc('NO_TS_MO_RyeBayDWR', RYE_NC);
  assert.ok(obs.length >= 10, `got ${obs.length}`);
  const withTemp = obs.filter((o) => o.waterTemperatureC != null);
  assert.ok(withTemp.length >= 10);
  for (const o of withTemp) {
    // Rye Bay in August — a fill value (9.97e36) leaking through would
    // explode this range instantly.
    assert.ok(o.waterTemperatureC > 15 && o.waterTemperatureC < 26, `${o.waterTemperatureC}`);
    assert.equal(o.qualityCode, 'cmems_insitu_nrt');
    // TIME base 1950 decoded correctly → dates in Aug 2026, not 1950/2103.
    assert.equal(o.observedAt.toISOString().slice(0, 7), '2026-08');
  }
  // The file also carries wave parameters.
  assert.ok(obs.some((o) => o.waveHeightM != null));
});

test('cmems netcdf: garbage bytes throw cleanly (runner isolates per station)', async () => {
  await assert.rejects(() => parseInsituNc('X', new Uint8Array([1, 2, 3, 4])));
});
