// my-water.live compatibility adapter.
//
// The Tooting Bec / Brockwell feed ALREADY works: api/cron/sensor-import.js
// writes hourly rows into temp_logs and the sensor-venue page layout reads
// the live proxy at /api/mywaterlive. Increment 1 does not touch any of
// that (zero public regression is the requirement).
//
// This adapter exists so the lido sensors are representable in the new
// provider model the moment we choose to route them through it: the
// 'mywaterlive' provider row is seeded DISABLED by the migration, and a
// later increment can enable it and call this from the generic runner
// without rewriting the working feed first.

import { validStationOrNull, validObservationOrNull, OBSERVATION_USER_AGENT } from '../normalize.js';
import { VENUE_MAP, MW_API_BASE } from '../../../mywaterlive-config.js';

// Coordinates come from the spots table at runtime normally; these mirrors
// exist so the adapter is self-contained for catalogue purposes.
const VENUE_COORDS = {
  'tooting-bec-lido': { latitude: 51.4306, longitude: -0.1538 },
  'brockwell-lido':   { latitude: 51.4530367, longitude: -0.1064701 },
};

export function listStations() {
  return Object.entries(VENUE_MAP)
    .map(([slug, venue]) => validStationOrNull({
      externalId: venue.id,
      name: venue.label,
      latitude: VENUE_COORDS[slug]?.latitude,
      longitude: VENUE_COORDS[slug]?.longitude,
      stationType: 'lido_sensor',
      waterBody: 'pool',
      sensorDepthM: 0.5, // poolside probe, near-surface
      capabilities: { temperature: true, waveHeight: false, wavePeriod: false, wind: false, tide: false },
      metadata: { slug, venue_url: venue.url },
    }))
    .filter(Boolean);
}

/** Normalize one /v3/now payload. Exported for tests. */
export function normalizeNowPayload(externalId, raw) {
  return validObservationOrNull({
    externalStationId: externalId,
    observedAt: raw?.water?.timestamp ?? null,
    waterTemperatureC: raw?.water?.temperature ?? null,
    waveHeightM: null,
    wavePeriodS: null,
    windSpeedMs: null,
    windDirectionDeg: null,
    tideHeightM: null,
    qualityCode: 'mywaterlive_sensor',
    raw,
  });
}

export async function fetchStationObservations(externalId, opts = {}) {
  const apiKey = opts.apiKey ?? process.env.MYWATERLIVE_API_KEY;
  if (!apiKey) throw new Error('MYWATERLIVE_API_KEY not set');
  const fetchImpl = opts.fetchImpl ?? fetch;
  const res = await fetchImpl(`${MW_API_BASE}/${encodeURIComponent(externalId)}`, {
    headers: { 'x-api-key': apiKey, 'User-Agent': OBSERVATION_USER_AGENT },
    signal: AbortSignal.timeout(opts.timeoutMs ?? 8000),
  });
  if (!res.ok) throw new Error(`mywaterlive upstream ${res.status}`);
  const obs = normalizeNowPayload(externalId, await res.json());
  return obs ? [obs] : [];
}

export const mywaterliveProvider = {
  code: 'mywaterlive',
  fetchCatalogue: async () => listStations(),
  fetchBulkObservations: null, // no bulk endpoint — per-station only
  fetchStationObservations,
};
