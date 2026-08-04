// ── Marine water temperature for EVENT venues → venue_water_readings ──────────
// Called by Vercel Cron every 6 hours (see vercel.json `crons`).
//
// Deliberately a SEPARATE endpoint from marine-temps.js rather than an extra
// loop inside it. That cron feeds spot_water_readings, which the live app shows
// to 652 real users; a bug in event-venue fetching must not be able to break
// their spot temperatures. Same API, same shape of logic, isolated blast radius.
//
// Coverage: Open-Meteo Marine models oceans and seas only. Rather than trying to
// guess which venues are coastal — most crawled venues have water_body_type
// 'unknown' because organiser pages rarely state it — every venue with
// coordinates is offered to the model and the marine grid itself acts as the
// filter. A venue on a lake or up a river simply returns no SST and is skipped,
// which is why inland events show no temperature rather than a fabricated one.
//
// Security: Vercel injects Authorization: Bearer <CRON_SECRET> on cron calls.
// Upserts use SUPABASE_SERVICE_KEY to bypass RLS (no user context).

import { createClient } from '@supabase/supabase-js';
import { requireCronAuth } from './_auth.js';

const MARINE_BASE = 'https://marine-api.open-meteo.com/v1/marine';
const BATCH_SIZE  = 20;   // Open-Meteo bulk 400s above ~20 coords
const SOURCE      = 'open_meteo';

export default async function handler(req, res) {
  if (!requireCronAuth(req, res, 'venue-marine-temps')) return;

  const supabaseUrl = process.env.SUPABASE_URL || 'https://szgkzuswelntnevobnoh.supabase.co';
  const serviceKey  = process.env.SUPABASE_SERVICE_KEY;
  if (!serviceKey) return res.status(503).json({ error: 'SUPABASE_SERVICE_KEY not set' });

  const sb = createClient(supabaseUrl, serviceKey);
  const dryRun = req.query?.dry === '1';

  // Only venues that actually host an upcoming event — there is no point
  // modelling water for a venue whose only edition has been and gone.
  const { data: venues, error: vErr } = await sb
    .from('event_venues')
    .select('id, display_name, latitude, longitude, spot_id, event_editions!inner(id, start_date, status)')
    .not('latitude', 'is', null)
    .not('longitude', 'is', null)
    .gte('event_editions.start_date', new Date().toISOString().slice(0, 10))
    .not('event_editions.status', 'in', '("cancelled","completed")');

  if (vErr) return res.status(500).json({ error: 'venues query failed', detail: vErr.message });

  // A venue already linked to a spot inherits that spot's blended estimate
  // (which can include real swimmer readings), so modelling it again here
  // would be duplicate work for a worse number.
  const seen = new Set();
  const targets = (venues || []).filter(v => {
    if (v.spot_id) return false;
    if (seen.has(v.id)) return false;   // a venue with several editions appears repeatedly
    seen.add(v.id);
    return true;
  });

  if (targets.length === 0) {
    return res.status(200).json({ ok: true, fetched: 0, note: 'no unlinked venues with upcoming events' });
  }

  const rows = [];
  const summary = { venues: targets.length, withSst: 0, nullSst: 0, batches: 0, errors: [] };

  async function fetchMarine(batch) {
    const lats = batch.map(v => Number(v.latitude).toFixed(4)).join(',');
    const lngs = batch.map(v => Number(v.longitude).toFixed(4)).join(',');
    const url  = `${MARINE_BASE}?latitude=${lats}&longitude=${lngs}`
               + `&current=sea_surface_temperature,wave_height`
               + `&hourly=sea_surface_temperature&forecast_days=1&timezone=UTC`;
    const r = await fetch(url, { signal: AbortSignal.timeout(20000) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const json = await r.json();
    return Array.isArray(json) ? json : [json];
  }

  function toRow(venue, p) {
    if (!p) return null;
    let sst = p.current?.sea_surface_temperature;
    let obs = p.current?.time;
    const wave = p.current?.wave_height ?? null;
    if ((sst === null || sst === undefined) && p.hourly?.sea_surface_temperature?.length) {
      sst = p.hourly.sea_surface_temperature[0];
      obs = p.hourly.time?.[0];
    }
    if (sst === null || sst === undefined) return null;   // not on the marine grid
    return {
      venue_id: venue.id,
      source: SOURCE,
      sst_c: sst,
      wave_height_m: (wave === undefined ? null : wave),
      observed_at: obs ? new Date(obs + (obs.length === 16 ? ':00Z' : 'Z')).toISOString()
                       : new Date().toISOString(),
      raw: { sst_c: sst, wave_height_m: wave, model_time: obs },
    };
  }

  function collect(venue, p) {
    const row = toRow(venue, p);
    if (row) { rows.push(row); summary.withSst++; }
    else summary.nullSst++;
  }

  // One off-grid coordinate makes Open-Meteo 400 the WHOLE bulk request, and
  // inland venues are common here, so a failed batch retries per venue and only
  // the genuinely uncovered ones are dropped.
  for (let i = 0; i < targets.length; i += BATCH_SIZE) {
    const batch = targets.slice(i, i + BATCH_SIZE);
    summary.batches++;

    let payloads = null;
    try {
      payloads = await fetchMarine(batch);
    } catch (e) {
      summary.errors.push(`batch ${i} bulk failed (${e.message}) — falling back per-venue`);
    }

    if (payloads) {
      batch.forEach((venue, idx) => collect(venue, payloads[idx]));
    } else {
      for (const venue of batch) {
        try {
          const one = await fetchMarine([venue]);
          collect(venue, one[0]);
        } catch (e) {
          summary.nullSst++;   // inland or off-grid — stays without a temperature
        }
      }
    }
  }

  if (dryRun) {
    return res.status(200).json({ ok: true, dryRun: true, ...summary, sample: rows.slice(0, 3) });
  }

  let upserted = 0;
  if (rows.length) {
    const { error: upErr, count } = await sb
      .from('venue_water_readings')
      .upsert(rows, { onConflict: 'venue_id,source,observed_at', count: 'exact', ignoreDuplicates: false });
    if (upErr) return res.status(500).json({ error: 'upsert failed', detail: upErr.message, ...summary });
    upserted = count ?? rows.length;
  }

  return res.status(200).json({ ok: true, upserted, ...summary });
}
