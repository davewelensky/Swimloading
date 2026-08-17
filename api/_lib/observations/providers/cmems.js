// Copernicus Marine INSITU TAC provider (the data EMODnet redistributes).
//
// Probed 2026-08-17: the ARCO (zarr) stores require Copernicus' internal STS
// handshake, but the NATIVE mirror on s3.waw3-1.cloudferro.com is anonymously
// readable — both the file catalogue (index_latest.txt) and the per-platform
// NetCDF files. So ingestion needs no runtime credentials; the SwimLoading
// Copernicus account (registered by Dave, vars in Vercel) satisfies the
// licence's registration requirement, and every reading carries CMEMS
// attribution.
//
// The data files are NetCDF-4/HDF5 — unreadable in pure JS — so this adapter
// uses h5wasm (WebAssembly build of the real libhdf5), lazy-loaded so only
// the ingestion cron ever pays for it.
//
// Scope: fixed MOORINGS (_MO_ files) with TEMP only. Profilers, gliders and
// drifters move; a moving platform is weather, not a spot's water.

import {
  validStationOrNull, validObservationOrNull, OBSERVATION_USER_AGENT,
} from '../normalize.js';

export const CMEMS_NATIVE_BASE =
  'https://s3.waw3-1.cloudferro.com/mdl-native-01/native/INSITU_GLO_PHYBGCWAV_DISCRETE_MYNRT_013_030/cmems_obs-ins_glo_phybgcwav_mynrt_na_irr_202311';

export const CMEMS_ATTRIBUTION = 'Data: E.U. Copernicus Marine Service In Situ TAC';

// TIME in INSITU TAC files is days since this epoch.
const EPOCH_1950_MS = Date.UTC(1950, 0, 1);
// Only near-surface sensors describe a swimmer's water.
const MAX_SENSOR_DEPTH_M = 5;
// INSITU QC flags: 0 = no QC, 1 = good, 2 = probably good.
const ACCEPTABLE_QC = new Set([0, 1, 2]);

let h5wasmPromise = null;
async function getH5() {
  if (!h5wasmPromise) {
    h5wasmPromise = import('h5wasm').then(async (h5) => { await h5.ready; return h5; });
  }
  return h5wasmPromise;
}

async function fetchText(url, { fetchImpl = fetch, timeoutMs = 30000 } = {}) {
  const res = await fetchImpl(url, {
    headers: { 'User-Agent': OBSERVATION_USER_AGENT },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (res.status === 404 || res.status === 403) return null; // absent day-file is normal
  if (!res.ok) throw new Error(`cmems upstream ${res.status} for ${url}`);
  return res.text();
}

async function fetchBytes(url, { fetchImpl = fetch, timeoutMs = 30000 } = {}) {
  const res = await fetchImpl(url, {
    headers: { 'User-Agent': OBSERVATION_USER_AGENT },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (res.status === 404 || res.status === 403) return null;
  if (!res.ok) throw new Error(`cmems upstream ${res.status} for ${url}`);
  return new Uint8Array(await res.arrayBuffer());
}

// ── Catalogue: index_latest.txt ──────────────────────────────────────────────
// Format v3: '#'-prefixed header block, then CSV rows:
// product_id,file_name,lat_min,lat_max,lon_min,lon_max,time_start,time_end,
// institution,date_update,data_mode,parameters
// One row per daily FILE; a platform appears once per day. The newest row
// per platform carries its current position and freshness.

const MO_FILE_RE = /\/([A-Z]{2}_TS_MO_[^/]+)_(\d{8})\.nc$/;

/** Exported for tests. */
export function parseIndexToStations(text) {
  if (typeof text !== 'string' || !text.trim()) return [];
  const byPlatform = new Map();
  for (const line of text.split('\n')) {
    if (!line || line.startsWith('#')) continue;
    const cols = line.split(',');
    if (cols.length < 12) continue;
    const m = MO_FILE_RE.exec(cols[1]);
    if (!m) continue;                       // moorings only
    if (!/\bTEMP\b/.test(cols[11])) continue; // temperature only
    const [, platform, day] = m;
    const prev = byPlatform.get(platform);
    if (prev && prev.day >= day) continue;  // keep the newest row per platform
    byPlatform.set(platform, {
      day,
      latMin: Number(cols[2]), latMax: Number(cols[3]),
      lonMin: Number(cols[4]), lonMax: Number(cols[5]),
      timeEnd: cols[7],
      institution: cols[8],
      parameters: cols[11].trim(),
    });
  }

  const stations = [];
  for (const [platform, row] of byPlatform) {
    // A "fixed" mooring whose daily bounding box spans more than ~0.1° has
    // drifted or is mislabelled — refuse it rather than pin a wrong point.
    if (Math.abs(row.latMax - row.latMin) > 0.1 || Math.abs(row.lonMax - row.lonMin) > 0.1) continue;
    const station = validStationOrNull({
      externalId: platform,
      name: platform.replace(/^[A-Z]{2}_TS_MO_/, '') + ' (mooring)',
      latitude: (row.latMin + row.latMax) / 2,
      longitude: (row.lonMin + row.lonMax) / 2,
      stationType: 'buoy',
      waterBody: null,
      sensorDepthM: null, // learned at parse time from DEPH
      capabilities: {
        temperature: true,
        waveHeight: /\bVHM0\b/.test(row.parameters),
        wavePeriod: /\bVTPK\b|\bVTM02\b/.test(row.parameters),
        wind: /\bWSPD\b/.test(row.parameters),
        tide: false,
      },
      metadata: { institution: row.institution, last_index_day: row.day, source: 'cmems_insitu_nrt' },
    });
    if (station) stations.push(station);
  }
  return stations;
}

export async function fetchStationCatalogue(opts = {}) {
  const text = await fetchText(`${CMEMS_NATIVE_BASE}/index_latest.txt`, { ...opts, timeoutMs: 60000 });
  if (text == null) throw new Error('cmems index_latest.txt unavailable');
  return parseIndexToStations(text);
}

// ── Observations: per-platform daily NetCDF ─────────────────────────────────

function readVar(file, name) {
  if (!file.keys().includes(name)) return null;
  const ds = file.get(name);
  const value = ds.value;
  const fillAttr = ds.attrs?._FillValue?.value;
  const fill = fillAttr != null ? Number(fillAttr[0] ?? fillAttr) : null;
  return { shape: ds.shape, value, fill };
}

function cell(varData, t, d, depthCount) {
  if (!varData) return null;
  const flat = varData.value;
  const idx = varData.shape.length === 2 ? t * depthCount + d : t;
  const v = Number(flat[idx]);
  if (!Number.isFinite(v)) return null;
  if (varData.fill != null && Math.abs(v - varData.fill) < Math.abs(varData.fill) * 1e-6) return null;
  return v;
}

function qcOk(qcData, t, d, depthCount) {
  if (!qcData) return true; // no QC variable — accept, validation still bounds it
  const flag = cell(qcData, t, d, depthCount);
  return flag == null || ACCEPTABLE_QC.has(flag);
}

/**
 * Extract observations from one INSITU TAC NetCDF buffer. Exported for tests.
 * For each timestep: temperature from the SHALLOWEST depth ≤5 m whose QC
 * passes; wave/wind taken when present and QC-clean.
 */
export async function parseInsituNc(externalId, bytes) {
  const h5 = await getH5();
  const path = `/cmems-${Math.abs(hashCode(externalId))}.nc`;
  // h5.FS is Emscripten's in-memory virtual FS (MEMFS) inside the wasm
  // module — not the host filesystem. Nothing is written to disk.
  h5.FS.writeFile(path, bytes);
  const file = new h5.File(path, 'r');
  try {
    const time = readVar(file, 'TIME');
    if (!time) return [];
    const deph = readVar(file, 'DEPH');
    const temp = readVar(file, 'TEMP');
    const tempQc = readVar(file, 'TEMP_QC');
    const vhm0 = readVar(file, 'VHM0');
    const vhm0Qc = readVar(file, 'VHM0_QC');
    const vtpk = readVar(file, 'VTPK') || readVar(file, 'VTM02');
    const wspd = readVar(file, 'WSPD');
    const wdir = readVar(file, 'WDIR');

    const nT = time.shape[0] ?? time.value.length;
    const nD = deph ? (deph.shape[deph.shape.length - 1] ?? 1) : 1;

    const out = [];
    for (let t = 0; t < nT; t++) {
      const days = Number(time.value[t]);
      if (!Number.isFinite(days)) continue;
      const observedAt = new Date(EPOCH_1950_MS + days * 86_400_000);

      let temperature = null;
      for (let d = 0; d < nD; d++) {
        // DEPH can be [depth] or [time, depth]; cell() handles both.
        const depth = deph ? (deph.shape.length === 2 ? cell(deph, t, d, nD) : Number(deph.value[d])) : 0;
        if (depth != null && depth > MAX_SENSOR_DEPTH_M) continue;
        const v = cell(temp, t, d, nD);
        if (v != null && qcOk(tempQc, t, d, nD)) { temperature = v; break; }
      }

      const obs = validObservationOrNull({
        externalStationId: externalId,
        observedAt,
        waterTemperatureC: temperature,
        waveHeightM: qcOk(vhm0Qc, t, 0, nD) ? cell(vhm0, t, 0, nD) : null,
        wavePeriodS: cell(vtpk, t, 0, nD),
        windSpeedMs: cell(wspd, t, 0, nD),
        windDirectionDeg: cell(wdir, t, 0, nD),
        tideHeightM: null,
        qualityCode: 'cmems_insitu_nrt',
        raw: null,
      });
      if (obs) out.push(obs);
    }
    return out;
  } finally {
    file.close();
    try { h5.FS.unlink(path); } catch { /* already gone */ }
  }
}

function hashCode(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}

function utcDayStamp(d) {
  return d.toISOString().slice(0, 10).replace(/-/g, '');
}

export async function fetchStationObservations(externalId, opts = {}) {
  const now = opts.now || new Date();
  // The latest/ tree is one folder per UTC day; today + yesterday covers a
  // 24h window across the midnight boundary.
  const days = [utcDayStamp(new Date(now.getTime() - 86_400_000)), utcDayStamp(now)];
  const out = [];
  for (const day of days) {
    const url = `${CMEMS_NATIVE_BASE}/latest/${day}/${externalId}_${day}.nc`;
    const bytes = await fetchBytes(url, opts);
    if (!bytes) continue; // that day's file not (yet) published — normal
    out.push(...await parseInsituNc(externalId, bytes));
  }
  const cutoff = now.getTime() - (opts.maxAgeHours ?? 24) * 3_600_000;
  return out.filter((o) => o.observedAt.getTime() >= cutoff);
}

export const cmemsProvider = {
  code: 'cmems_insitu',
  fetchCatalogue: fetchStationCatalogue,
  fetchBulkObservations: null, // no bulk endpoint — linked stations only
  fetchStationObservations,
};
