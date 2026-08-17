// NOAA NDBC provider adapter.
//
// Three upstream artefacts, all plain text/XML, no API key:
//   activestations.xml            — the station catalogue (~1,350 stations)
//   data/latest_obs/latest_obs.txt — one newest observation per reporting station
//   data/realtime2/<ID>.txt       — 45 days of observations for one station
//
// Everything returned here is normalized via normalize.js; nothing NDBC-
// specific escapes this file. NDBC's missing-value marker is 'MM'.
//
// Realtime feeds are described at https://www.ndbc.noaa.gov/faq/rt_data_access.shtml
// NOAA data are US Government work (public domain); attribution requested.

import {
  validStationOrNull, validObservationOrNull, OBSERVATION_USER_AGENT,
} from '../normalize.js';

export const NDBC_BASE = 'https://www.ndbc.noaa.gov';

const FEET_TO_METRES = 0.3048;

async function fetchText(url, { fetchImpl = fetch, timeoutMs = 20000 } = {}) {
  const res = await fetchImpl(url, {
    headers: { 'User-Agent': OBSERVATION_USER_AGENT },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`ndbc upstream ${res.status} for ${url}`);
  return res.text();
}

// ── Catalogue ────────────────────────────────────────────────────────────────

/**
 * Parse activestations.xml. The document is a flat list of self-closing
 * <station .../> elements with only attributes, so an attribute scan is
 * robust without an XML dependency (the repo has none).
 * @returns {import('../normalize.js').NormalizedStation[]}
 */
export function parseActiveStationsXml(xml) {
  const stations = [];
  if (typeof xml !== 'string') return stations;
  const tags = xml.match(/<station\b[^>]*\/>/g) || [];
  for (const tag of tags) {
    const attr = (name) => {
      const m = tag.match(new RegExp(`\\b${name}="([^"]*)"`));
      return m ? m[1] : null;
    };
    const station = validStationOrNull({
      externalId: attr('id') ? attr('id').toUpperCase() : null,
      name: attr('name') || null,
      latitude: attr('lat'),
      longitude: attr('lon'),
      stationType: attr('type') || null,
      // NDBC's catalogue does not state the water body; leaving it null is
      // honest and the match engine treats null as "cannot distinguish".
      waterBody: null,
      sensorDepthM: null,
      capabilities: {
        // The XML's met flag under-reports (many IOOS partner buoys with
        // water temp carry met="n"), so real capabilities are learned from
        // observed data during ingestion. Everything starts false here.
        temperature: false, waveHeight: false, wavePeriod: false, wind: false, tide: false,
      },
      metadata: {
        owner: attr('owner') || null,
        program: attr('pgm') || null,
        met_flag: attr('met') || null,
      },
    });
    if (station) stations.push(station);
  }
  return stations;
}

export async function fetchStationCatalogue(opts = {}) {
  const xml = await fetchText(`${NDBC_BASE}/activestations.xml`, opts);
  return parseActiveStationsXml(xml);
}

// ── Observations ─────────────────────────────────────────────────────────────

function mmToNumber(v) {
  if (v == null || v === 'MM' || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function rowToObservation(stationId, cols, values, rawLine) {
  const get = (name) => {
    const i = cols.indexOf(name);
    return i === -1 ? null : mmToNumber(values[i]);
  };
  const yy = get('#YY') ?? get('YY') ?? get('YYYY');
  const mo = get('MM'), dd = get('DD'), hh = get('hh'), mn = get('mm');
  if (yy == null || mo == null || dd == null || hh == null || mn == null) return null;
  const year = yy < 100 ? 2000 + yy : yy;
  const observedAt = new Date(Date.UTC(year, mo - 1, dd, hh, mn));

  const tideFt = get('TIDE');
  return validObservationOrNull({
    externalStationId: stationId,
    observedAt,
    waterTemperatureC: get('WTMP'),
    waveHeightM: get('WVHT'),
    // Dominant period preferred; average period is the stated fallback.
    wavePeriodS: get('DPD') ?? get('APD'),
    windSpeedMs: get('WSPD'),
    windDirectionDeg: get('WDIR'),
    tideHeightM: tideFt == null ? null : round2(tideFt * FEET_TO_METRES),
    qualityCode: 'ndbc_realtime',
    raw: { line: rawLine },
  });
}

function round2(n) { return Math.round(n * 100) / 100; }

/**
 * Parse a realtime2/<ID>.txt feed: '#'-prefixed header naming the columns,
 * '#'-prefixed units line, then whitespace-separated rows, newest first.
 * Header-driven on purpose — NDBC column sets vary by station, and a feed
 * whose columns shifted must degrade to nulls, not mis-assign values.
 * @returns {import('../normalize.js').NormalizedObservation[]}
 */
export function parseRealtimeText(stationId, text, { maxAgeHours = null, now = new Date() } = {}) {
  if (typeof text !== 'string' || !text.trim()) return [];
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const headerLine = lines.find((l) => l.startsWith('#') && /\bWTMP\b|\bWVHT\b|\bWSPD\b/.test(l));
  if (!headerLine) return [];
  const cols = headerLine.replace(/^#/, '#').split(/\s+/);

  const out = [];
  const cutoff = maxAgeHours == null ? null : now.getTime() - maxAgeHours * 3_600_000;
  for (const line of lines) {
    if (line.startsWith('#')) continue;
    const values = line.split(/\s+/);
    const obs = rowToObservation(stationId, cols, values, line);
    if (!obs) continue;
    if (cutoff != null && obs.observedAt.getTime() < cutoff) continue;
    out.push(obs);
  }
  return out;
}

export async function fetchStationObservations(externalId, opts = {}) {
  const { maxAgeHours = 24 } = opts;
  const text = await fetchText(`${NDBC_BASE}/data/realtime2/${encodeURIComponent(externalId)}.txt`, opts);
  return parseRealtimeText(externalId, text, { maxAgeHours, now: opts.now });
}

/**
 * Parse latest_obs.txt — one row per station currently reporting, with the
 * station id and coordinates inline. One fetch covers the whole network,
 * which is what lets the hourly job stay at a handful of requests.
 * @returns {import('../normalize.js').NormalizedObservation[]}
 */
export function parseLatestObsText(text) {
  if (typeof text !== 'string' || !text.trim()) return [];
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const headerLine = lines.find((l) => l.startsWith('#STN'));
  if (!headerLine) return [];
  const cols = headerLine.replace(/^#/, '').split(/\s+/); // STN LAT LON YYYY MM DD hh mm ...
  const idx = Object.fromEntries(cols.map((c, i) => [c, i]));

  const out = [];
  for (const line of lines) {
    if (line.startsWith('#')) continue;
    const v = line.split(/\s+/);
    const stationId = (v[idx.STN] || '').toUpperCase();
    if (!stationId) continue;
    const num = (name) => (idx[name] == null ? null : mmToNumber(v[idx[name]]));
    const year = num('YYYY');
    const mo = num('MM'), dd = num('DD'), hh = num('hh'), mn = num('mm');
    if (year == null || mo == null || dd == null || hh == null || mn == null) continue;
    const tideFt = num('TIDE');
    const obs = validObservationOrNull({
      externalStationId: stationId,
      observedAt: new Date(Date.UTC(year, mo - 1, dd, hh, mn)),
      waterTemperatureC: num('WTMP'),
      waveHeightM: num('WVHT'),
      wavePeriodS: num('DPD') ?? num('APD'),
      windSpeedMs: num('WSPD'),
      windDirectionDeg: num('WDIR'),
      tideHeightM: tideFt == null ? null : round2(tideFt * FEET_TO_METRES),
      qualityCode: 'ndbc_realtime',
      raw: { line },
    });
    if (obs) out.push(obs);
  }
  return out;
}

export async function fetchLatestObservations(opts = {}) {
  const text = await fetchText(`${NDBC_BASE}/data/latest_obs/latest_obs.txt`, opts);
  return parseLatestObsText(text);
}

/** The adapter object the generic ingestion runner consumes. */
export const ndbcProvider = {
  code: 'ndbc',
  fetchCatalogue: fetchStationCatalogue,
  fetchBulkObservations: fetchLatestObservations,
  fetchStationObservations,
};
