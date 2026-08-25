// ── Tide extremes → tide_predictions ─────────────────────────────────────────
// Called by Vercel Cron once a day (see vercel.json `crons`).
//
// This is the whole point of the tide work: four calls a day, full stop.
// August cost 661 credits because every page load on /robben, /intel and
// /preekstool was its own upstream call. Edge caching alone would not fix it —
// Vercel's cache is per region, so Cape Town, London and US visitors each warm
// a separate copy. Fetching here makes the cost independent of traffic
// entirely: roughly 120 credits a month whatever happens to the pages.
//
// Safe to store because tide extremes are HARMONICS — computed from the moon
// and the coastline, not measured. A stored row is as correct next week as it
// was on arrival. Only the window runs out, which is why this runs daily over
// deliberately overlapping windows.
//
// Security: Vercel injects Authorization: Bearer <CRON_SECRET>. Writes use
// SUPABASE_SERVICE_KEY to bypass RLS (no user context).

import { createClient } from '@supabase/supabase-js';
import { requireCronAuth } from './_auth.js';
import { TIDE_PLACES } from '../_lib/tide-places.js';

const WORLDTIDES_URL = 'https://www.worldtides.info/api/v3';

export default async function handler(req, res) {
  if (!requireCronAuth(req, res, 'tides')) return;

  const key = process.env.WORLDTIDES_API_KEY;
  if (!key) {
    console.error('tides cron: WORLDTIDES_API_KEY not set — refusing to run');
    return res.status(503).json({ error: 'WORLDTIDES_API_KEY not set' });
  }

  const supabaseUrl = process.env.SUPABASE_URL || 'https://szgkzuswelntnevobnoh.supabase.co';
  const serviceKey = process.env.SUPABASE_SERVICE_KEY;
  if (!serviceKey) return res.status(503).json({ error: 'SUPABASE_SERVICE_KEY not set' });

  const sb = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const dryRun = req.query?.dry === '1';

  const summary = { places: 0, fetched: 0, stored: 0, errors: [], dryRun };

  for (const [name, place] of Object.entries(TIDE_PLACES)) {
    summary.places++;
    const url = `${WORLDTIDES_URL}?extremes&lat=${place.lat}&lon=${place.lon}` +
                `&days=${place.days}&datum=LAT&key=${encodeURIComponent(key)}`;

    let json;
    try {
      const upstream = await fetch(url, { headers: { accept: 'application/json' } });
      json = await upstream.json();
      // WorldTides reports "no credits left" as a 200 with an error field at
      // least as often as a 4xx, so both are treated the same.
      if (!upstream.ok || json.error) {
        throw new Error(json.error || `HTTP ${upstream.status}`);
      }
    } catch (err) {
      // One failing place must not abandon the others — a credit shortage or
      // an outage should still leave three places refreshed, and the route
      // keeps serving whatever is already stored.
      console.error(`tides cron: ${name} failed:`, err.message);
      summary.errors.push({ place: name, error: err.message });
      continue;
    }

    const rows = (Array.isArray(json.extremes) ? json.extremes : [])
      .filter((e) => e && e.dt && e.type)
      .map((e) => ({
        place: name,
        extreme_at: new Date(e.dt * 1000).toISOString(),
        // Number(null) is 0, and a 0.000 m tide reads as a real reading
        // rather than a missing one. Explicit null instead.
        height_m: e.height == null ? null : Number(e.height),
        extreme_type: e.type === 'High' ? 'High' : 'Low',
        fetched_at: new Date().toISOString(),
      }));

    summary.fetched += rows.length;
    if (!rows.length || dryRun) continue;

    // Upsert on (place, extreme_at): the daily windows overlap on purpose, so
    // most of what arrives is already held and simply refreshes fetched_at.
    const { error } = await sb
      .from('tide_predictions')
      .upsert(rows, { onConflict: 'place,extreme_at' });

    if (error) {
      console.error(`tides cron: storing ${name} failed:`, error.message);
      summary.errors.push({ place: name, error: error.message });
      continue;
    }
    summary.stored += rows.length;
  }

  // Housekeeping. Past extremes are never read — the route only ever asks for
  // the future — and without this the table grows forever for no reason. A
  // week of history is kept so a failed run has something to fall back on and
  // so anyone debugging can see what was served yesterday.
  if (!dryRun) {
    const cutoff = new Date(Date.now() - 7 * 86400_000).toISOString();
    const { error } = await sb.from('tide_predictions').delete().lt('extreme_at', cutoff);
    if (error) console.warn('tides cron: prune failed:', error.message);
  }

  const ok = summary.errors.length === 0;
  return res.status(ok ? 200 : 207).json(summary);
}
