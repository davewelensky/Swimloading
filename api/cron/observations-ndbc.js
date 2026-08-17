// ── Hourly observation ingestion: NOAA NDBC → observations ──────────────────
// Called by Vercel Cron every hour (see vercel.json `crons`).
//
// One provider job covers the whole network (never one cron per station):
//   1. activestations.xml  → observation_stations catalogue upsert
//   2. latest_obs.txt      → one newest observation per reporting station
//   3. realtime2/<ID>.txt  → 24h history, but ONLY for stations linked to a
//                            SwimLoading spot (candidate/approved), so we
//                            stay at a handful of upstream requests.
//
// A failed station records last_error on its row and never fails the run.
// Public /spots/* pages never wait on any of this — they read our tables.
//
// Security: same contract as every cron here — requireCronAuth first,
// service key only after auth passes.

import { createClient } from '@supabase/supabase-js';
import { requireCronAuth } from './_auth.js';
import { ndbcProvider } from '../_lib/observations/providers/ndbc.js';
import { runProviderIngestion, createSupabaseStore } from '../_lib/observations/ingest.js';

export default async function handler(req, res) {
  if (!requireCronAuth(req, res, 'observations-ndbc')) return;

  const supabaseUrl = process.env.SUPABASE_URL || 'https://szgkzuswelntnevobnoh.supabase.co';
  const serviceKey = process.env.SUPABASE_SERVICE_KEY;
  if (!serviceKey) return res.status(503).json({ error: 'SUPABASE_SERVICE_KEY not set' });

  const sb = createClient(supabaseUrl, serviceKey);
  const store = createSupabaseStore(sb);

  const summary = await runProviderIngestion({ provider: ndbcProvider, store });

  // The run itself reporting an error (catalogue unreachable, provider
  // disabled) is still a 200: cron delivery worked, and the summary says
  // what happened. Alerting reads the payload, not the status code.
  return res.status(200).json({ ok: !summary.error, ...summary });
}
