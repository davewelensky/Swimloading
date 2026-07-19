// ── Marine water-temperature import: Open-Meteo Marine → spot_water_readings ──
// Called by Vercel Cron every 3 hours (see vercel.json `crons`).
//
// Fetches modelled sea-surface temperature (SST) for coastal spots (OCEAN +
// LAGOON) and upserts into spot_water_readings with source='open_meteo'.
// Kept SEPARATE from swimmer temp_logs — model data must never pollute the
// community feed, the "temps logged" count, or points triggers.
//
// Open-Meteo Marine covers oceans/seas only, so pools + inland (lake/dam/river)
// are intentionally NOT fetched — those stay swimmer-reported.
//
// Security: Vercel injects Authorization: Bearer <CRON_SECRET> on cron calls.
// Upserts use SUPABASE_SERVICE_KEY to bypass RLS (no user context).

import { createClient } from '@supabase/supabase-js';
import { requireCronAuth } from './_auth.js';

const MARINE_BASE   = 'https://marine-api.open-meteo.com/v1/marine';
const COASTAL_TYPES = ['OCEAN', 'LAGOON'];
const BATCH_SIZE    = 20;   // coords per bulk request — Open-Meteo bulk 400s above ~20 coords
const SOURCE        = 'open_meteo';

export default async function handler(req, res) {
  if (!requireCronAuth(req, res, 'marine-temps')) return;

  const supabaseUrl = process.env.SUPABASE_URL || 'https://szgkzuswelntnevobnoh.supabase.co';
  const serviceKey  = process.env.SUPABASE_SERVICE_KEY;
  if (!serviceKey) return res.status(503).json({ error: 'SUPABASE_SERVICE_KEY not set' });

  const sb = createClient(supabaseUrl, serviceKey);
  const dryRun = req.query?.dry === '1';

  // ── Load coastal spots with GPS ──────────────────────────────────────────────
  const { data: spots, error: spotsErr } = await sb
    .from('spots')
    .select('id, name, latitude, longitude, water_type, active')
    .in('water_type', COASTAL_TYPES)
    .not('latitude', 'is', null)
    .not('longitude', 'is', null);

  if (spotsErr) return res.status(500).json({ error: 'spots query failed', detail: spotsErr.message });

  const coastal = (spots || []).filter(s => s.active !== false);
  if (coastal.length === 0) return res.status(200).json({ ok: true, fetched: 0, note: 'no coastal spots' });

  const rows = [];
  const summary = { spots: coastal.length, withSst: 0, nullSst: 0, batches: 0, errors: [] };

  // Fetch marine data for a set of spots. Returns an array of payloads aligned
  // to `batch`, or throws on a non-OK response. Open-Meteo returns an array for
  // multiple coords and a single object for one.
  async function fetchMarine(batch) {
    const lats = batch.map(s => Number(s.latitude).toFixed(4)).join(',');
    const lngs = batch.map(s => Number(s.longitude).toFixed(4)).join(',');
    const url  = `${MARINE_BASE}?latitude=${lats}&longitude=${lngs}`
               + `&current=sea_surface_temperature,wave_height`
               + `&hourly=sea_surface_temperature&forecast_days=1&timezone=UTC`;
    const r = await fetch(url, { signal: AbortSignal.timeout(20000) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const json = await r.json();
    return Array.isArray(json) ? json : [json];
  }

  // Turn one spot + its payload into a row (or null if the model has no SST here).
  function toRow(spot, p) {
    if (!p) return null;
    let sst = p.current?.sea_surface_temperature;
    let obs = p.current?.time;
    const wave = p.current?.wave_height ?? null;
    if ((sst === null || sst === undefined) && p.hourly?.sea_surface_temperature?.length) {
      sst = p.hourly.sea_surface_temperature[0];
      obs = p.hourly.time?.[0];
    }
    if (sst === null || sst === undefined) return null;
    return {
      spot_id: spot.id,
      source: SOURCE,
      sst_c: sst,
      wave_height_m: (wave === undefined ? null : wave),
      observed_at: obs ? new Date(obs + (obs.length === 16 ? ':00Z' : 'Z')).toISOString()
                       : new Date().toISOString(),
      raw: { sst_c: sst, wave_height_m: wave, model_time: obs },
    };
  }

  function collect(spot, p) {
    const row = toRow(spot, p);
    if (row) { rows.push(row); summary.withSst++; }
    else summary.nullSst++;
  }

  // ── Fetch in bulk batches, with per-spot fallback ────────────────────────────
  // One coordinate off the marine grid (e.g. a lagoon too far up an estuary)
  // makes Open-Meteo 400 the WHOLE bulk request — so on a batch failure we retry
  // each spot individually and only drop the genuinely-uncovered ones.
  for (let i = 0; i < coastal.length; i += BATCH_SIZE) {
    const batch = coastal.slice(i, i + BATCH_SIZE);
    summary.batches++;

    let payloads = null;
    try {
      payloads = await fetchMarine(batch);
    } catch (e) {
      summary.errors.push(`batch ${i} bulk failed (${e.message}) — falling back per-spot`);
    }

    if (payloads) {
      batch.forEach((spot, idx) => collect(spot, payloads[idx]));
    } else {
      for (const spot of batch) {
        try {
          const one = await fetchMarine([spot]);
          collect(spot, one[0]);
        } catch (e) {
          summary.nullSst++; // this spot isn't on the marine grid — stays swimmer-only
        }
      }
    }
  }

  if (dryRun) {
    return res.status(200).json({ ok: true, dryRun: true, ...summary, sample: rows.slice(0, 3) });
  }

  // ── Upsert (idempotent on spot_id + source + observed_at) ────────────────────
  let upserted = 0;
  if (rows.length) {
    const { error: upErr, count } = await sb
      .from('spot_water_readings')
      .upsert(rows, { onConflict: 'spot_id,source,observed_at', count: 'exact', ignoreDuplicates: false });
    if (upErr) return res.status(500).json({ error: 'upsert failed', detail: upErr.message, ...summary });
    upserted = count ?? rows.length;
  }

  return res.status(200).json({ ok: true, upserted, ...summary });
}
