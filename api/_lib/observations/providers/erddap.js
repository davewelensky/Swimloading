// Generic ERDDAP tabledap adapter.
//
// ERDDAP is the same server software everywhere — Marine Institute Ireland,
// EMODnet, CIOOS Canada, IMOS Australia all run it — so ONE adapter serves
// them all: each provider is just a base URL plus a list of dataset configs
// mapping that dataset's column names onto the normalized observation shape.
// This is the provider-independence the platform exists for.
//
// tabledap request shape (constraint operators MUST be URL-encoded — Tomcat
// rejects a raw '>' in the request line with a 400 before ERDDAP sees it):
//   <base>/tabledap/<dataset>.csv?col1,col2&time%3E=now-24hours
// CSV response: row 1 = column names, row 2 = units, then data rows.
// Missing values arrive as empty fields or NaN.
//
// Station external ids are '<datasetId>:<stationId>' so one provider can
// carry several datasets without collision.

import {
  validStationOrNull, validObservationOrNull, OBSERVATION_USER_AGENT,
} from '../normalize.js';

const KNOTS_TO_MS = 0.514444;

/**
 * @typedef {object} ErddapDatasetConfig
 * @property {string} datasetId          e.g. 'IWBNetwork'
 * @property {string} stationIdColumn    e.g. 'station_id'
 * @property {object} columns            normalized field → column name, or
 *                                       {column, unit} where unit ∈ 'knots'
 * @property {string} [stationType]      default 'buoy'
 * @property {string} [qualityCode]
 * @property {number} [catalogueWindowHours]  how far back to look when
 *                                       deriving the station list (default 72)
 */

export function parseErddapCsv(text) {
  if (typeof text !== 'string' || !text.trim()) return { columns: [], units: [], rows: [] };
  // An ERDDAP error is a text/HTML blob, not CSV — treat as empty.
  if (text.trimStart().startsWith('Error') || text.trimStart().startsWith('<')) {
    return { columns: [], units: [], rows: [] };
  }
  const lines = text.split('\n').map((l) => l.replace(/\r$/, '')).filter((l) => l.length);
  if (lines.length < 2) return { columns: [], units: [], rows: [] };
  const columns = splitCsvLine(lines[0]);
  const units = splitCsvLine(lines[1]);
  const rows = lines.slice(2).map(splitCsvLine).filter((r) => r.length === columns.length);
  return { columns, units, rows };
}

// ERDDAP CSV quotes fields containing commas; a minimal quote-aware split.
function splitCsvLine(line) {
  const out = [];
  let cur = '', inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') { inQ = !inQ; continue; }
    if (ch === ',' && !inQ) { out.push(cur); cur = ''; continue; }
    cur += ch;
  }
  out.push(cur);
  return out;
}

function cellNumber(v) {
  if (v == null || v === '' || v === 'NaN') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function columnSpec(spec) {
  if (!spec) return null;
  return typeof spec === 'string' ? { column: spec } : spec;
}

function convert(value, unit) {
  if (value == null) return null;
  if (unit === 'knots') return Math.round(value * KNOTS_TO_MS * 100) / 100;
  return value;
}

const FIELD_KEYS = ['waterTemperatureC', 'waveHeightM', 'wavePeriodS', 'windSpeedMs', 'windDirectionDeg', 'tideHeightM'];

/** Turn one dataset's CSV into NormalizedObservation[]. Exported for tests. */
export function datasetCsvToObservations(config, text) {
  const { columns, rows } = parseErddapCsv(text);
  if (!columns.length) return [];
  const idx = Object.fromEntries(columns.map((c, i) => [c, i]));
  const idIdx = idx[config.stationIdColumn];
  const timeIdx = idx[columnSpec(config.columns.time)?.column ?? 'time'];
  if (idIdx == null || timeIdx == null) return [];

  const out = [];
  for (const row of rows) {
    const stationId = (row[idIdx] || '').trim();
    if (!stationId) continue;
    const obs = { externalStationId: `${config.datasetId}:${stationId}`, observedAt: row[timeIdx], qualityCode: config.qualityCode ?? null, raw: null };
    for (const key of FIELD_KEYS) {
      const spec = columnSpec(config.columns[key]);
      obs[key] = spec && idx[spec.column] != null
        ? convert(cellNumber(row[idx[spec.column]]), spec.unit)
        : null;
    }
    const valid = validObservationOrNull(obs);
    if (valid) out.push(valid);
  }
  return out;
}

/** Derive the station list from recent data (ERDDAP has no station endpoint
 *  common to all servers; the data itself is the catalogue). */
export function datasetCsvToStations(config, text) {
  const { columns, rows } = parseErddapCsv(text);
  if (!columns.length) return [];
  const idx = Object.fromEntries(columns.map((c, i) => [c, i]));
  const idIdx = idx[config.stationIdColumn];
  const latIdx = idx[columnSpec(config.columns.latitude)?.column ?? 'latitude'];
  const lonIdx = idx[columnSpec(config.columns.longitude)?.column ?? 'longitude'];
  if (idIdx == null || latIdx == null || lonIdx == null) return [];

  const byId = new Map();
  for (const row of rows) {
    const stationId = (row[idIdx] || '').trim();
    if (!stationId) continue;
    // Last row wins — a drifting buoy's newest position is its position.
    byId.set(stationId, row);
  }
  const tempSpec = columnSpec(config.columns.waterTemperatureC);
  const out = [];
  for (const [stationId, row] of byId) {
    const station = validStationOrNull({
      externalId: `${config.datasetId}:${stationId}`,
      name: config.stationNamePrefix ? `${config.stationNamePrefix} ${stationId}` : stationId,
      latitude: cellNumber(row[latIdx]),
      longitude: cellNumber(row[lonIdx]),
      stationType: config.stationType ?? 'buoy',
      waterBody: config.waterBody ?? null,
      sensorDepthM: config.sensorDepthM ?? null,
      capabilities: {
        temperature: !!(tempSpec && idx[tempSpec.column] != null),
        waveHeight: !!columnSpec(config.columns.waveHeightM),
        wavePeriod: !!columnSpec(config.columns.wavePeriodS),
        wind: !!columnSpec(config.columns.windSpeedMs),
        tide: !!columnSpec(config.columns.tideHeightM),
      },
      metadata: { dataset: config.datasetId },
    });
    if (station) out.push(station);
  }
  return out;
}

function datasetUrl(baseUrl, config, sinceHours, stationId = null) {
  const cols = new Set([config.stationIdColumn]);
  for (const key of ['time', 'latitude', 'longitude', ...FIELD_KEYS]) {
    const spec = columnSpec(config.columns[key] ?? (key === 'time' ? 'time' : key === 'latitude' ? 'latitude' : key === 'longitude' ? 'longitude' : null));
    if (spec) cols.add(spec.column);
  }
  let url = `${baseUrl}/tabledap/${config.datasetId}.csv?${[...cols].join(',')}` +
    `&time%3E=now-${Math.max(1, Math.round(sinceHours))}hours`;
  if (stationId != null) {
    url += `&${config.stationIdColumn}=%22${encodeURIComponent(stationId)}%22`;
  }
  return url;
}

async function fetchText(url, { fetchImpl = fetch, timeoutMs = 25000 } = {}) {
  const res = await fetchImpl(url, {
    headers: { 'User-Agent': OBSERVATION_USER_AGENT },
    signal: AbortSignal.timeout(timeoutMs),
  });
  // ERDDAP answers an empty result window with 404 "nRows = 0" — that is a
  // valid empty answer, not an outage.
  if (res.status === 404) return '';
  if (!res.ok) throw new Error(`erddap upstream ${res.status} for ${url}`);
  return res.text();
}

/**
 * Build a provider adapter (the same interface ndbc.js exports) from an
 * ERDDAP base URL + dataset configs.
 */
export function createErddapProvider({ code, baseUrl, datasets }) {
  return {
    code,
    baseUrl,
    datasets,

    async fetchCatalogue(opts = {}) {
      const stations = [];
      for (const config of datasets) {
        const text = await fetchText(
          datasetUrl(baseUrl, config, config.catalogueWindowHours ?? 72), opts);
        stations.push(...datasetCsvToStations(config, text));
      }
      return stations;
    },

    // One request per dataset covers every station in it — that IS the bulk.
    async fetchBulkObservations(opts = {}) {
      const observations = [];
      for (const config of datasets) {
        const text = await fetchText(datasetUrl(baseUrl, config, 3), opts);
        observations.push(...datasetCsvToObservations(config, text));
      }
      return observations;
    },

    async fetchStationObservations(externalId, opts = {}) {
      const sep = externalId.indexOf(':');
      if (sep === -1) return [];
      const datasetId = externalId.slice(0, sep);
      const stationId = externalId.slice(sep + 1);
      const config = datasets.find((d) => d.datasetId === datasetId);
      if (!config) return [];
      const text = await fetchText(
        datasetUrl(baseUrl, config, opts.maxAgeHours ?? 24, stationId), opts);
      return datasetCsvToObservations(config, text);
    },
  };
}

// ── Provider instances ───────────────────────────────────────────────────────

// Marine Institute Ireland. IWBNetwork = the offshore weather buoy network
// (M2–M6), hourly, live. The ICTempNetwork coastal dataset was checked on
// 2026-08-17 and is dormant (no rows in 14 days) — revisit before adding.
// Wind arrives in KNOTS (see the units row) — converted here, nowhere else.
export const irelandMarineInstituteProvider = createErddapProvider({
  code: 'ireland_mi',
  baseUrl: 'https://erddap.marine.ie/erddap',
  datasets: [{
    datasetId: 'IWBNetwork',
    stationIdColumn: 'station_id',
    stationNamePrefix: 'Irish Weather Buoy',
    stationType: 'buoy',
    qualityCode: 'imi_realtime',
    columns: {
      time: 'time',
      latitude: 'latitude',
      longitude: 'longitude',
      waterTemperatureC: 'SeaTemperature',
      waveHeightM: 'WaveHeight',
      wavePeriodS: 'WavePeriod',
      windSpeedMs: { column: 'WindSpeed', unit: 'knots' },
      windDirectionDeg: 'WindDirection',
    },
  }],
});

// EMODnet Physics — registered DISABLED. Probed 2026-08-17: their ERDDAP
// servers expose climatologies and sea-level NRT only; near-real-time water
// temperature is not published there (it sits behind the CMEMS/Copernicus
// INSITU service, which needs credentials — the existing Copernicus Phase 3
// plan). When a usable dataset exists, add its config here and enable the
// provider row; no other code changes are required.
export const emodnetProvider = createErddapProvider({
  code: 'emodnet',
  baseUrl: 'https://prod-erddap.emodnet-physics.eu/erddap',
  datasets: [],
});

export const ERDDAP_PROVIDERS = [irelandMarineInstituteProvider, emodnetProvider];
