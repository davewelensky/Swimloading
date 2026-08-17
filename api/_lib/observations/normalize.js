// The provider contract for the Global Observation Platform.
//
// Every provider adapter (NDBC today; ERDDAP/EMODnet/IMOS later) reduces its
// upstream format to exactly two shapes — NormalizedStation and
// NormalizedObservation — so that ingestion, matching, and the public
// conditions service never contain provider-specific code. If a provider
// cannot fill a field, the field is null; nothing downstream may invent it.
//
// See docs/GLOBAL_OBSERVATIONS.md for the full architecture.

/**
 * @typedef {object} NormalizedStation
 * @property {string} externalId       provider's own station id ('46254', 'LJAC1', '4kq1')
 * @property {string|null} name
 * @property {number} latitude
 * @property {number} longitude
 * @property {string|null} stationType 'buoy' | 'fixed' | 'lido_sensor' | ...
 * @property {string|null} waterBody   only when the provider actually states it
 * @property {number|null} sensorDepthM
 * @property {{temperature:boolean, waveHeight:boolean, wavePeriod:boolean, wind:boolean, tide:boolean}} capabilities
 * @property {object} metadata         provider-specific extras, stored as jsonb
 */

/**
 * @typedef {object} NormalizedObservation
 * @property {string} externalStationId
 * @property {Date} observedAt
 * @property {number|null} waterTemperatureC
 * @property {number|null} waveHeightM
 * @property {number|null} wavePeriodS
 * @property {number|null} windSpeedMs
 * @property {number|null} windDirectionDeg
 * @property {number|null} tideHeightM
 * @property {string|null} qualityCode
 * @property {object|null} raw         the upstream row, for audit/debug
 */

/**
 * A station is storable only when it can be placed on the map — everything
 * else is optional. Returns null (not a throw) for a bad station so one
 * malformed catalogue row never fails a provider run.
 * @returns {NormalizedStation|null}
 */
export function validStationOrNull(s) {
  if (!s || typeof s.externalId !== 'string' || !s.externalId.trim()) return null;
  const lat = Number(s.latitude);
  const lon = Number(s.longitude);
  if (!Number.isFinite(lat) || lat < -90 || lat > 90) return null;
  if (!Number.isFinite(lon) || lon < -180 || lon > 180) return null;
  return {
    externalId: s.externalId.trim(),
    name: s.name ?? null,
    latitude: lat,
    longitude: lon,
    stationType: s.stationType ?? null,
    waterBody: s.waterBody ?? null,
    sensorDepthM: numOrNull(s.sensorDepthM),
    capabilities: {
      temperature: !!s.capabilities?.temperature,
      waveHeight: !!s.capabilities?.waveHeight,
      wavePeriod: !!s.capabilities?.wavePeriod,
      wind: !!s.capabilities?.wind,
      tide: !!s.capabilities?.tide,
    },
    metadata: s.metadata && typeof s.metadata === 'object' ? s.metadata : {},
  };
}

/**
 * An observation is storable only with a station id, a real timestamp, and
 * at least one measured value. A row of all-missing values is upstream
 * noise, not data. Returns null rather than throwing — same isolation rule
 * as stations.
 * @returns {NormalizedObservation|null}
 */
export function validObservationOrNull(o) {
  if (!o || typeof o.externalStationId !== 'string' || !o.externalStationId.trim()) return null;
  const at = o.observedAt instanceof Date ? o.observedAt : new Date(o.observedAt);
  if (Number.isNaN(at.getTime())) return null;
  // Reject timestamps absurdly far in the future — a provider clock fault
  // must not become "the newest reading" and pin the freshness state.
  if (at.getTime() - Date.now() > 6 * 3_600_000) return null;

  const out = {
    externalStationId: o.externalStationId.trim(),
    observedAt: at,
    waterTemperatureC: plausible(o.waterTemperatureC, -5, 45),
    waveHeightM: plausible(o.waveHeightM, 0, 30),
    wavePeriodS: plausible(o.wavePeriodS, 0, 60),
    windSpeedMs: plausible(o.windSpeedMs, 0, 120),
    windDirectionDeg: plausible(o.windDirectionDeg, 0, 360),
    tideHeightM: plausible(o.tideHeightM, -15, 15),
    qualityCode: o.qualityCode ?? null,
    raw: o.raw ?? null,
  };
  const hasValue = out.waterTemperatureC != null || out.waveHeightM != null
    || out.wavePeriodS != null || out.windSpeedMs != null
    || out.windDirectionDeg != null || out.tideHeightM != null;
  return hasValue ? out : null;
}

function numOrNull(v) {
  // Number(null) is 0 — a missing value must never become a reading of 0°C.
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// A value outside physical plausibility is a sensor or parse fault; storing
// it as null keeps the row's good fields without poisoning averages.
function plausible(v, min, max) {
  const n = numOrNull(v);
  if (n === null) return null;
  return n >= min && n <= max ? n : null;
}

/** Run async fn over items with at most `limit` in flight. Results keep
 * order; a rejection becomes an {error} entry instead of failing the map —
 * one slow or broken station must never sink the provider run. */
export async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      try {
        results[i] = { ok: true, value: await fn(items[i], i) };
      } catch (err) {
        results[i] = { ok: false, error: err?.message || String(err) };
      }
    }
  }
  const workers = Array.from({ length: Math.min(limit, items.length) || 1 }, worker);
  await Promise.all(workers);
  return results;
}

// Every upstream request identifies us, per NOAA/ERDDAP etiquette.
export const OBSERVATION_USER_AGENT =
  'SwimLoading/1.0 (+https://www.swimloading.com; observation ingestion)';
