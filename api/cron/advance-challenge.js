// ── Monthly challenge auto-advance ─────────────────────────────────────────
// Runs daily at 22:00 UTC via Vercel Cron (see vercel.json).
// 22:00 UTC = midnight South Africa Standard Time (SAST = UTC+2).
//
// On the last day of each month, 22:00 UTC is midnight SAST on the 1st —
// so we check: is tomorrow (UTC) the 1st of a new month?
// If yes, flip june_challenge_config to cover the new calendar month.
//
// This means the challenge UI and point-awarding trigger both switch at
// exactly midnight SAST with zero manual intervention each month.
//
// Security: Vercel injects Authorization: Bearer <CRON_SECRET> on cron calls.

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL         = process.env.SUPABASE_URL         || 'https://szgkzuswelntnevobnoh.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
const CRON_SECRET          = process.env.CRON_SECRET;

export default async function handler(req, res) {
  // Auth check — reject missing or invalid secret before any privileged work
  if (!CRON_SECRET) {
    console.error('advance-challenge: CRON_SECRET not configured — refusing to run');
    return res.status(500).json({ error: 'CRON_SECRET not configured' });
  }
  const auth = req.headers['authorization'] || '';
  if (auth !== `Bearer ${CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorised' });
  }

  // Work out what "tomorrow SAST" looks like.
  // At 22:00 UTC, SAST is already 00:00 the next day — so tomorrowUTC === tomorrowSAST.
  const nowUtc      = new Date();
  const tomorrowUtc = new Date(nowUtc.getTime() + 24 * 60 * 60 * 1000);

  // Is tomorrow the 1st of a new month?
  if (tomorrowUtc.getUTCDate() !== 1) {
    return res.status(200).json({ skipped: true, reason: 'Not month-end', tomorrowUtc });
  }

  // Build the full month range for tomorrow's month
  const year  = tomorrowUtc.getUTCFullYear();
  const month = tomorrowUtc.getUTCMonth() + 1; // 1-based

  const pad        = n => String(n).padStart(2, '0');
  const launchDate = `${year}-${pad(month)}-01`;

  // Last day of the month: day 0 of month+1
  const lastDay  = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const endDate  = `${year}-${pad(month)}-${pad(lastDay)}`;

  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  const { error } = await sb
    .from('june_challenge_config')
    .update({ launch_date: launchDate, end_date: endDate })
    .eq('id', 1);

  if (error) {
    console.error('advance-challenge: update failed', error);
    return res.status(500).json({ error: error.message });
  }

  console.log(`advance-challenge: flipped to ${launchDate} → ${endDate}`);
  return res.status(200).json({ ok: true, launchDate, endDate });
}
