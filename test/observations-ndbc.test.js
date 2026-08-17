// NOAA NDBC adapter: parsing, MM handling, malformed feeds, extraction.
// Fixtures under test/fixtures/ndbc/ are real downloads (2026-08-17), trimmed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  parseActiveStationsXml, parseRealtimeText, parseLatestObsText,
} from '../api/_lib/observations/providers/ndbc.js';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'ndbc');
const fx = (name) => readFileSync(join(FIXTURES, name), 'utf8');

// Pin "now" near the fixture capture time so age filtering is deterministic.
const NOW = new Date('2026-08-17T07:00:00Z');

test('catalogue: parses real activestations.xml sample', () => {
  const stations = parseActiveStationsXml(fx('activestations_sample.xml'));
  assert.equal(stations.length, 6);
  // NDBC lists C-MAN/NOS ids in lowercase in the catalogue but serves
  // realtime2 feeds under uppercase names — the parser normalizes up.
  const laJolla = stations.find((s) => s.externalId === 'LJAC1');
  assert.equal(laJolla.stationType, 'fixed');
  assert.equal(laJolla.name, '9410230 - La Jolla, CA');
  const scripps = stations.find((s) => s.externalId === '46254');
  assert.equal(scripps.name, 'SCRIPPS Nearshore, CA (201)');
  assert.equal(scripps.latitude, 32.868);
  assert.equal(scripps.longitude, -117.267);
  assert.equal(scripps.stationType, 'buoy');
  assert.equal(scripps.metadata.owner, 'SCRIPPS');
  // Capabilities start false — they are learned from observed data, because
  // the catalogue's met flag under-reports (46237 has water temp, met="n").
  assert.equal(scripps.capabilities.temperature, false);
});

test('catalogue: garbage in, empty out — never throws', () => {
  assert.deepEqual(parseActiveStationsXml(''), []);
  assert.deepEqual(parseActiveStationsXml('<html>upstream error page</html>'), []);
  assert.deepEqual(parseActiveStationsXml(null), []);
  assert.deepEqual(parseActiveStationsXml('<station id="X" lat="999" lon="0"/>'), []); // bad lat dropped
});

test('realtime: parses WTMP/WVHT/DPD from a real wave-buoy feed', () => {
  const obs = parseRealtimeText('46254', fx('realtime-46254.txt'), { now: NOW });
  assert.ok(obs.length > 10);
  const first = obs[0];
  assert.equal(first.externalStationId, '46254');
  assert.equal(first.waterTemperatureC, 21.0);
  assert.equal(first.waveHeightM, 0.8);
  assert.equal(first.wavePeriodS, 15); // DPD preferred over APD
  assert.equal(first.observedAt.toISOString(), '2026-08-17T05:56:00.000Z');
  // 46254's wind columns are all MM — missing must be null, not 0.
  assert.equal(first.windSpeedMs, null);
  assert.equal(first.windDirectionDeg, null);
});

test('realtime: MM values become null, never 0 (the 0°C regression)', () => {
  // PXSC1-shaped feed: WTMP is MM while ATMP/DEWP have values. The
  // original parser turned null into Number(null)=0 and reported 0.0°C
  // water in San Francisco in August.
  const text = [
    '#YY  MM DD hh mm WDIR WSPD GST  WVHT   DPD   APD MWD   PRES  ATMP  WTMP  DEWP  VIS PTDY  TIDE',
    '#yr  mo dy hr mn degT m/s  m/s     m   sec   sec degT   hPa  degC  degC  degC  nmi  hPa    ft',
    '2026 08 17 06 30  MM   MM   MM    MM    MM    MM  MM     MM  14.5    MM  14.5  5.9   MM    MM',
  ].join('\n');
  const obs = parseRealtimeText('PXSC1', text, { now: NOW });
  // Row has no storable measurement fields → dropped entirely.
  assert.equal(obs.length, 0);
});

test('realtime: wind-only station keeps wind, nulls the rest', () => {
  const obs = parseRealtimeText('LJAC1', fx('realtime-LJAC1.txt'), { now: NOW });
  const first = obs[0];
  assert.equal(first.windSpeedMs, 1.5);
  assert.equal(first.windDirectionDeg, 340);
  assert.equal(first.waterTemperatureC, 21.0);
  assert.equal(first.waveHeightM, null);
});

test('realtime: maxAgeHours filters old rows', () => {
  const all = parseRealtimeText('46254', fx('realtime-46254.txt'), { now: NOW });
  const recent = parseRealtimeText('46254', fx('realtime-46254.txt'), { now: NOW, maxAgeHours: 2 });
  assert.ok(recent.length > 0);
  assert.ok(recent.length < all.length);
  for (const o of recent) {
    assert.ok(NOW.getTime() - o.observedAt.getTime() <= 2 * 3_600_000);
  }
});

test('realtime: malformed feeds degrade to empty, never throw', () => {
  assert.deepEqual(parseRealtimeText('X', ''), []);
  assert.deepEqual(parseRealtimeText('X', '<html>503</html>'), []);
  assert.deepEqual(parseRealtimeText('X', '#YY MM\n#yr mo\ngarbage row here'), []);
  assert.deepEqual(parseRealtimeText('X', null), []);
});

test('realtime: TIDE feet converted to metres', () => {
  const text = [
    '#YY  MM DD hh mm WDIR WSPD GST  WVHT   DPD   APD MWD   PRES  ATMP  WTMP  DEWP  VIS PTDY  TIDE',
    '#yr  mo dy hr mn degT m/s  m/s     m   sec   sec degT   hPa  degC  degC  degC  nmi  hPa    ft',
    '2026 08 17 06 00 300  2.0  3.0   1.1    15   6.4 200 1017.8    MM  14.8    MM   MM   MM   3.28',
  ].join('\n');
  const [o] = parseRealtimeText('46026', text, { now: NOW });
  assert.equal(o.tideHeightM, 1.0); // 3.28 ft ≈ 1.00 m
});

test('realtime: a far-future timestamp is rejected as a clock fault', () => {
  const text = [
    '#YY  MM DD hh mm WTMP',
    '#yr  mo dy hr mn degC',
    '2027 08 17 06 00 15.0',
  ].join('\n');
  assert.deepEqual(parseRealtimeText('X', text, { now: NOW }), []);
});

test('realtime: physically implausible values are nulled, not stored', () => {
  const text = [
    '#YY  MM DD hh mm WTMP WVHT',
    '#yr  mo dy hr mn degC    m',
    '2026 08 17 06 00 99.9  1.2',
  ].join('\n');
  const [o] = parseRealtimeText('X', text, { now: NOW });
  assert.equal(o.waterTemperatureC, null); // 99.9°C is a fault, not water
  assert.equal(o.waveHeightM, 1.2);        // the good field survives
});

test('latest_obs: parses the whole-network bulk file', () => {
  const obs = parseLatestObsText(fx('latest_obs_sample.txt'));
  assert.ok(obs.length > 0);
  const first = obs.find((o) => o.externalStationId === '15009');
  assert.equal(first.waterTemperatureC, 25.5);
  assert.equal(first.observedAt.toISOString(), '2026-08-17T06:00:00.000Z');
});

test('latest_obs: malformed input degrades to empty', () => {
  assert.deepEqual(parseLatestObsText(''), []);
  assert.deepEqual(parseLatestObsText('no header at all\n1 2 3'), []);
  assert.deepEqual(parseLatestObsText(null), []);
});
