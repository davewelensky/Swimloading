// ── Hourly observation ingestion: Copernicus Marine INSITU → observations ───
// Called by Vercel Cron every hour (see vercel.json `crons`).
//
// Fixed moorings from the Copernicus Marine In Situ TAC (the network EMODnet
// redistributes), read from the anonymously-served native mirror. The
// per-platform files are NetCDF-4, parsed with h5wasm inside this cron only
// — public pages never load the wasm, they read our tables as always.
//
// Same contracts as the other observation crons: requireCronAuth first,
// enabled flag on the provider row decides whether anything runs, station
// failures isolate, public pages never wait on this.

import { createClient } from '@supabase/supabase-js';
import { requireCronAuth } from './_auth.js';
import { cmemsProvider } from '../_lib/observations/providers/cmems.js';
import { runProviderIngestion, createSupabaseStore } from '../_lib/observations/ingest.js';

export default async function handler(req, res) {
  if (!requireCronAuth(req, res, 'observations-cmems')) return;

  const supabaseUrl = process.env.SUPABASE_URL || 'https://szgkzuswelntnevobnoh.supabase.co';
  const serviceKey = process.env.SUPABASE_SERVICE_KEY;
  if (!serviceKey) return res.status(503).json({ error: 'SUPABASE_SERVICE_KEY not set' });

  const sb = createClient(supabaseUrl, serviceKey);
  const store = createSupabaseStore(sb);

  const summary = await runProviderIngestion({ provider: cmemsProvider, store });
  return res.status(200).json({ ok: !summary.error, ...summary });
}
