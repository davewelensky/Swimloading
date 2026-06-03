// ── Hourly sensor import: my-water.live → temp_logs ───────────────────────────
// Called by Vercel Cron every hour (see vercel.json `crons`).
// Fetches live water temps for London lidos and inserts rows into temp_logs
// so they flow naturally into the dashboard, Trends tab, and conditions feed.
//
// Security: Vercel injects Authorization: Bearer <CRON_SECRET> on cron calls.
// The same token must be set as CRON_SECRET in Vercel environment variables.
// Inserts use SUPABASE_SERVICE_KEY to bypass RLS (no user context for sensors).

import { VENUE_MAP, MW_API_BASE } from '../mywaterlive-config.js';
import { createClient } from '@supabase/supabase-js';

// Spot IDs in the SwimLoading Supabase DB (matches `spots` table)
const SPOT_IDS = {
  'tooting-bec-lido': '27ab125b-5e62-4bda-b1fc-73ea4e86be9e',
  'brockwell-lido':   'd5efa9c9-55a7-410c-bec2-b0a422a5c1e1',
};

// Only insert a new row if the last sensor log for this spot is older than this.
// my-water.live refreshes roughly every 15–30 min; we run hourly.
const MIN_INSERT_GAP_MINUTES = 50;

export default async function handler(req, res) {
  // ── Auth ────────────────────────────────────────────────────────────────────
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const authHeader = req.headers['authorization'] || '';
    if (authHeader !== `Bearer ${cronSecret}`) {
      return res.status(401).json({ error: 'Unauthorised' });
    }
  }

  const apiKey     = process.env.MYWATERLIVE_API_KEY;
  const supabaseUrl = process.env.SUPABASE_URL || 'https://szgkzuswelntnevobnoh.supabase.co';
  const serviceKey  = process.env.SUPABASE_SERVICE_KEY;

  if (!apiKey)     return res.status(503).json({ error: 'MYWATERLIVE_API_KEY not set' });
  if (!serviceKey) return res.status(503).json({ error: 'SUPABASE_SERVICE_KEY not set' });

  const sb = createClient(supabaseUrl, serviceKey);
  const results = [];
  const cutoff = new Date(Date.now() - MIN_INSERT_GAP_MINUTES * 60 * 1000).toISOString();

  for (const slug of Object.keys(VENUE_MAP)) {
    const spotId = SPOT_IDS[slug];
    if (!spotId) continue; // venue in config but no DB spot yet — skip

    const venue = VENUE_MAP[slug];
    const result = { slug, spotId, action: null };

    try {
      // ── Fetch live reading ─────────────────────────────────────────────────
      const upstream = await fetch(`${MW_API_BASE}/${venue.id}`, {
        headers: { 'x-api-key': apiKey },
        signal: AbortSignal.timeout(8000),
      });

      if (!upstream.ok) {
        result.action = `skip:upstream_${upstream.status}`;
        results.push(result);
        continue;
      }

      const raw = await upstream.json();
      const tempC     = raw.water?.temperature ?? null;
      const sensorTs  = raw.water?.timestamp   ?? null; // ISO8601 from sensor

      if (tempC == null) {
        result.action = 'skip:no_temperature';
        results.push(result);
        continue;
      }

      // ── Dedup: skip if we already have a recent sensor log ────────────────
      const { data: recent } = await sb
        .from('temp_logs')
        .select('id, created_at, notes')
        .eq('spot_id', spotId)
        .eq('location_source', 'sensor')
        .gte('created_at', cutoff)
        .limit(1);

      if (recent && recent.length > 0) {
        result.action = `skip:recent_log_exists (${recent[0].created_at})`;
        results.push(result);
        continue;
      }

      // ── Insert sensor log ──────────────────────────────────────────────────
      const { error: insertErr } = await sb.from('temp_logs').insert({
        spot_id:         spotId,
        user_id:         null,            // sensor log — no user
        temp_c:          tempC,
        location_source: 'sensor',
        notes:           sensorTs ? `Sensor reading at ${sensorTs}` : 'my-water.live sensor',
        logged_at:       sensorTs || new Date().toISOString(),
      });

      if (insertErr) {
        result.action = `error: ${insertErr.message}`;
      } else {
        result.action = `inserted: ${tempC}°C`;
      }

    } catch (err) {
      result.action = `error: ${err.message}`;
    }

    results.push(result);
  }

  return res.status(200).json({ ok: true, results });
}
