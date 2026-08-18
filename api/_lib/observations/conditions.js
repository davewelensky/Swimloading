// The ONE public conditions service.
//
// getSpotConditions(spotId) is the only way a page obtains measured water
// conditions for a spot. It reads exactly one thing — SwimLoading's own
// spot_conditions_live view — and NEVER an external provider: NOAA/ERDDAP
// outages are the ingestion cron's problem, invisible to public requests.
//
// It also never throws. A missing view (migration not applied), an RLS
// misconfiguration, a network fault — every failure path returns null, and
// a null renders as "no conditions block", not a 500. That guarantee is
// load-bearing: the spot page's production incident history is template
// exceptions, and this module must not add a new source of them.

import { getObservationState } from '../temperature-freshness.js';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://szgkzuswelntnevobnoh.supabase.co';
const ANON_KEY = process.env.SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InN6Z2t6dXN3ZWxudG5ldm9ibm9oIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjgxODY1NTUsImV4cCI6MjA4Mzc2MjU1NX0.UfKqj2OZ-XeyzCy-MZYZqsDWjn_4EKrhgCFR8eIK2NA';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * @param {string} spotId  spots.id (uuid)
 * @param {{ now?: Date, fetchImpl?: typeof fetch }} [opts]  injectable for tests
 * @returns {Promise<null | {
 *   status: 'LIVE'|'RECENT'|'LAST_READING'|'STALE',
 *   temperatureC: number,
 *   observedAt: string,
 *   ageMinutes: number,
 *   sourceType: string,
 *   station: { name: string|null, distanceKm: number|null, provider: string, attribution: string },
 *   waveHeightM: number|null,
 *   wavePeriodS: number|null,
 *   windSpeedMs: number|null,
 *   windDirectionDeg: number|null,
 * }>}
 */
export async function getSpotConditions(spotId, opts = {}) {
  if (typeof spotId !== 'string' || !UUID_RE.test(spotId)) return null;
  const fetchImpl = opts.fetchImpl || fetch;

  let rows;
  try {
    const res = await fetchImpl(
      `${SUPABASE_URL}/rest/v1/spot_conditions_live?spot_id=eq.${spotId}&is_primary=eq.true&limit=1`,
      {
        headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}`, Accept: 'application/json' },
        signal: AbortSignal.timeout(4000),
      },
    );
    if (!res.ok) return null;
    rows = await res.json();
  } catch {
    return null;
  }

  const row = Array.isArray(rows) ? rows[0] : null;
  if (!row || row.water_temperature_c == null || !row.observed_at) return null;

  const observation = getObservationState(row.observed_at, { now: opts.now });
  if (!observation) return null;

  return {
    status: observation.state,
    // The station that produced this reading — so a caller (the history
    // chart) can ask for more of its data without re-resolving the link.
    stationId: row.station_id || null,
    temperatureC: num(row.water_temperature_c),
    observedAt: row.observed_at,
    ageMinutes: observation.ageMinutes,
    // A nearby buoy measures the water NEAR the spot, not the water at the
    // swimmer's feet. sourceType keeps that distinction machine-readable.
    sourceType: Number(row.distance_km) <= 0.5 ? 'on_site_measurement' : 'nearby_measurement',
    station: {
      name: row.station_name || null,
      distanceKm: num(row.distance_km),
      provider: row.provider_name || row.provider_code || 'unknown',
      attribution: row.attribution || '',
    },
    waveHeightM: num(row.wave_height_m),
    wavePeriodS: num(row.wave_period_s),
    windSpeedMs: num(row.wind_speed_ms),
    windDirectionDeg: num(row.wind_direction_deg),
  };
}

function num(v) {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
