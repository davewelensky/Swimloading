// Shared cron authentication — Vercel Cron always invokes with GET and injects
// Authorization: Bearer <CRON_SECRET>. Call requireCronAuth(req, res) FIRST in
// every cron handler, before creating any Supabase client, reading any service
// key, or doing any other privileged work.
//
// Returns true if the request is authorised — caller should proceed.
// Returns false if not — a response has already been sent; caller must
// `return` immediately without doing further work.
//
// Never logs the secret, the service-role key, or the raw Authorization
// header value — only generic pass/fail messages.
export function requireCronAuth(req, res, label) {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return false;
  }

  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    console.error(`${label}: CRON_SECRET not configured — refusing to run`);
    res.status(500).json({ error: 'CRON_SECRET not configured' });
    return false;
  }

  const authHeader = req.headers['authorization'] || '';
  if (authHeader !== `Bearer ${cronSecret}`) {
    res.status(401).json({ error: 'Unauthorised' });
    return false;
  }

  return true;
}
