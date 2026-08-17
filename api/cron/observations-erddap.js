// ── Hourly observation ingestion: ERDDAP providers → observations ───────────
// Called by Vercel Cron every hour (see vercel.json `crons`).
//
// One cron serves EVERY ERDDAP-family provider (Marine Institute Ireland
// today; EMODnet and future CIOOS/IMOS servers when enabled). Which providers
// actually run is decided by the observation_providers.enabled flag in the
// database — the runner skips disabled ones, so enabling a new ERDDAP
// provider is a DB row + a dataset config, with no cron changes.
//
// Same contracts as observations-ndbc.js: requireCronAuth first, per-station
// failure isolation inside the runner, public pages never wait on this.

import { createClient } from '@supabase/supabase-js';
import { requireCronAuth } from './_auth.js';
import { ERDDAP_PROVIDERS } from '../_lib/observations/providers/erddap.js';
import { runProviderIngestion, createSupabaseStore } from '../_lib/observations/ingest.js';

export default async function handler(req, res) {
  if (!requireCronAuth(req, res, 'observations-erddap')) return;

  const supabaseUrl = process.env.SUPABASE_URL || 'https://szgkzuswelntnevobnoh.supabase.co';
  const serviceKey = process.env.SUPABASE_SERVICE_KEY;
  if (!serviceKey) return res.status(503).json({ error: 'SUPABASE_SERVICE_KEY not set' });

  const sb = createClient(supabaseUrl, serviceKey);
  const store = createSupabaseStore(sb);

  const summaries = [];
  for (const provider of ERDDAP_PROVIDERS) {
    // A provider blowing up must not stop its siblings.
    try {
      summaries.push(await runProviderIngestion({ provider, store }));
    } catch (err) {
      summaries.push({ provider: provider.code, error: err?.message || String(err) });
    }
  }

  const ranClean = summaries.every((s) => !s.error || /disabled/.test(s.error));
  return res.status(200).json({ ok: ranClean, providers: summaries });
}
