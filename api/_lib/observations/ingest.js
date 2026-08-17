// Provider-agnostic ingestion runner.
//
// One run = one provider: refresh its station catalogue, pull observations,
// store them, then update per-station bookkeeping. The order is deliberate —
// observations are stored BEFORE last_observation_at moves, so a crash
// between the two can only under-report progress, never claim data we
// don't hold.
//
// Failure containment, from smallest to largest:
//   one bad row        → dropped by normalize.js validation
//   one bad station    → recorded on the station (last_error), run continues
//   provider outage    → run reports ok:false; nothing already stored is lost
// Public pages never call any of this: they read SwimLoading's own tables.

import { mapLimit } from './normalize.js';

const STATION_FETCH_CONCURRENCY = 4;   // polite to upstream, fast enough hourly
const CHUNK = 500;                     // rows per DB write

/**
 * @param {object} args
 * @param {object} args.provider  adapter: {code, fetchCatalogue, fetchBulkObservations?, fetchStationObservations}
 * @param {object} args.store     persistence interface (createSupabaseStore below, or an in-memory test double)
 * @param {Date}   [args.now]
 * @param {object} [args.fetchOpts] passed through to adapter fetches ({fetchImpl, timeoutMs} in tests)
 */
export async function runProviderIngestion({ provider, store, now = new Date(), fetchOpts = {} }) {
  const summary = {
    provider: provider.code,
    catalogueStations: 0,
    bulkObservations: 0,
    stationFeedsFetched: 0,
    observationsInserted: 0,
    stationErrors: [],
    error: null,
  };

  const providerRow = await store.getProvider(provider.code);
  if (!providerRow) { summary.error = `provider ${provider.code} not registered`; return summary; }
  if (!providerRow.enabled) { summary.error = `provider ${provider.code} disabled`; return summary; }

  // ── 1. Catalogue ───────────────────────────────────────────────
  // A catalogue failure aborts the run (we cannot map external ids to
  // station rows without it) but is itself contained: nothing is written.
  let externalToId;
  try {
    const catalogue = await provider.fetchCatalogue(fetchOpts);
    summary.catalogueStations = catalogue.length;
    externalToId = await store.upsertStations(providerRow.id, catalogue);
  } catch (err) {
    summary.error = `catalogue: ${err?.message || err}`;
    return summary;
  }

  // ── 2. Bulk observations (whole network in one request, if offered) ──
  let bulkObs = [];
  if (provider.fetchBulkObservations) {
    try {
      bulkObs = await provider.fetchBulkObservations(fetchOpts);
      summary.bulkObservations = bulkObs.length;
    } catch (err) {
      // Bulk failing is not fatal — the per-station pass still runs.
      summary.stationErrors.push({ station: '*bulk*', error: err?.message || String(err) });
    }
  }

  // ── 3. Per-station history for the stations that matter to spots ──
  // Only stations linked to a SwimLoading spot (candidate or approved) get
  // the full 24h feed; the rest of the network is covered by the bulk pass.
  const linked = await store.getLinkedExternalIds(providerRow.id);
  const results = await mapLimit(linked, STATION_FETCH_CONCURRENCY, (externalId) =>
    provider.fetchStationObservations(externalId, { ...fetchOpts, maxAgeHours: 24, now }));

  const perStationObs = [];
  linked.forEach((externalId, i) => {
    const r = results[i];
    if (r?.ok) {
      summary.stationFeedsFetched++;
      perStationObs.push(...r.value);
    } else if (r) {
      summary.stationErrors.push({ station: externalId, error: r.error });
    }
  });

  // ── 4. Store observations, then bookkeeping ────────────────────
  const byStation = new Map(); // external id → {count, newestAt, capabilities}
  const rows = [];
  for (const obs of [...bulkObs, ...perStationObs]) {
    const stationId = externalToId.get(obs.externalStationId);
    if (!stationId) continue; // observation for a station the catalogue no longer lists
    rows.push({
      station_id: stationId,
      observed_at: obs.observedAt.toISOString(),
      water_temperature_c: obs.waterTemperatureC,
      wave_height_m: obs.waveHeightM,
      wave_period_s: obs.wavePeriodS,
      wind_speed_ms: obs.windSpeedMs,
      wind_direction_deg: obs.windDirectionDeg,
      tide_height_m: obs.tideHeightM,
      quality_code: obs.qualityCode,
      raw: obs.raw,
    });
    const agg = byStation.get(obs.externalStationId)
      || { count: 0, newestAt: null, caps: { temperature: false, waveHeight: false, wavePeriod: false, wind: false, tide: false } };
    agg.count++;
    if (!agg.newestAt || obs.observedAt > agg.newestAt) agg.newestAt = obs.observedAt;
    if (obs.waterTemperatureC != null) agg.caps.temperature = true;
    if (obs.waveHeightM != null) agg.caps.waveHeight = true;
    if (obs.wavePeriodS != null) agg.caps.wavePeriod = true;
    if (obs.windSpeedMs != null) agg.caps.wind = true;
    if (obs.tideHeightM != null) agg.caps.tide = true;
    byStation.set(obs.externalStationId, agg);
  }

  for (let i = 0; i < rows.length; i += CHUNK) {
    const inserted = await store.insertObservations(rows.slice(i, i + CHUNK));
    summary.observationsInserted += inserted;
  }

  // Bookkeeping AFTER the data is safely down.
  for (const [externalId, agg] of byStation) {
    const stationId = externalToId.get(externalId);
    if (!stationId) continue;
    await store.markStationSuccess(stationId, { at: now, newestObservationAt: agg.newestAt, capabilities: agg.caps });
  }
  for (const { station, error } of summary.stationErrors) {
    if (station === '*bulk*') continue;
    const stationId = externalToId.get(station);
    if (stationId) await store.markStationError(stationId, { at: now, error });
  }

  await store.markProviderRun(providerRow.id, { at: now });
  return summary;
}

/** Persistence via a supabase-js client (service role). */
export function createSupabaseStore(sb) {
  return {
    async getProvider(code) {
      const { data, error } = await sb.from('observation_providers')
        .select('id, code, enabled').eq('code', code).maybeSingle();
      if (error) throw new Error(`getProvider: ${error.message}`);
      return data;
    },

    // Upsert the catalogue and return Map(external_id → station uuid).
    // Capability flags are only ever raised here via markStationSuccess —
    // the catalogue upsert must not reset flags learned from real data,
    // so it omits the capability columns entirely.
    async upsertStations(providerId, stations) {
      const map = new Map();
      for (let i = 0; i < stations.length; i += CHUNK) {
        const chunk = stations.slice(i, i + CHUNK).map((s) => ({
          provider_id: providerId,
          external_id: s.externalId,
          name: s.name,
          latitude: s.latitude,
          longitude: s.longitude,
          station_type: s.stationType,
          water_body: s.waterBody,
          sensor_depth_m: s.sensorDepthM,
          metadata: s.metadata,
          updated_at: new Date().toISOString(),
        }));
        const { data, error } = await sb.from('observation_stations')
          .upsert(chunk, { onConflict: 'provider_id,external_id' })
          .select('id, external_id');
        if (error) throw new Error(`upsertStations: ${error.message}`);
        (data || []).forEach((r) => map.set(r.external_id, r.id));
      }
      return map;
    },

    // Duplicate protection is the DB's unique(station_id, observed_at):
    // ignoreDuplicates makes re-ingesting the same upstream rows a no-op.
    async insertObservations(rows) {
      if (!rows.length) return 0;
      const { data, error } = await sb.from('observations')
        .upsert(rows, { onConflict: 'station_id,observed_at', ignoreDuplicates: true })
        .select('id');
      if (error) throw new Error(`insertObservations: ${error.message}`);
      return (data || []).length;
    },

    async getLinkedExternalIds(providerId) {
      const { data, error } = await sb.from('spot_observation_stations')
        .select('status, observation_stations!inner(external_id, provider_id, active)')
        .neq('status', 'rejected')
        .eq('observation_stations.provider_id', providerId)
        .eq('observation_stations.active', true);
      if (error) throw new Error(`getLinkedExternalIds: ${error.message}`);
      return [...new Set((data || []).map((r) => r.observation_stations.external_id))];
    },

    async markStationSuccess(stationId, { at, newestObservationAt, capabilities }) {
      const patch = {
        last_success_at: at.toISOString(),
        last_error: null,
        last_error_at: null,
        updated_at: at.toISOString(),
      };
      if (newestObservationAt) patch.last_observation_at = newestObservationAt.toISOString();
      if (capabilities?.temperature) patch.temperature_available = true;
      if (capabilities?.waveHeight) patch.wave_height_available = true;
      if (capabilities?.wavePeriod) patch.wave_period_available = true;
      if (capabilities?.wind) patch.wind_available = true;
      if (capabilities?.tide) patch.tide_available = true;
      const { error } = await sb.from('observation_stations').update(patch).eq('id', stationId);
      if (error) throw new Error(`markStationSuccess: ${error.message}`);
    },

    async markStationError(stationId, { at, error: message }) {
      const { error } = await sb.from('observation_stations')
        .update({ last_error: String(message).slice(0, 500), last_error_at: at.toISOString(), updated_at: at.toISOString() })
        .eq('id', stationId);
      if (error) throw new Error(`markStationError: ${error.message}`);
    },

    async markProviderRun(providerId, { at }) {
      const { error } = await sb.from('observation_providers')
        .update({ updated_at: at.toISOString() }).eq('id', providerId);
      if (error) throw new Error(`markProviderRun: ${error.message}`);
    },
  };
}
