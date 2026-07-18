// Cron: daily purge of activity_audit records older than 7 days
// Scheduled in vercel.json: "0 3 * * *" (3am UTC)
//
// Security: Vercel injects Authorization: Bearer <CRON_SECRET> on cron calls.
// The same token must be set as CRON_SECRET in Vercel environment variables.

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://szgkzuswelntnevobnoh.supabase.co';
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;
const CRON_SECRET  = process.env.CRON_SECRET;

export default async function handler(req, res) {
  // ── Auth — reject missing or invalid secret before any privileged work ──────
  if (!CRON_SECRET) {
    console.error('purge-audit: CRON_SECRET not configured — refusing to run');
    return res.status(500).json({ error: 'CRON_SECRET not configured' });
  }
  const authHeader = req.headers['authorization'] || '';
  if (authHeader !== `Bearer ${CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorised' });
  }

  const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const response = await fetch(
    `${SUPABASE_URL}/rest/v1/activity_audit?created_at=lt.${cutoff}`,
    {
      method: 'DELETE',
      headers: {
        'apikey':        SERVICE_KEY,
        'Authorization': `Bearer ${SERVICE_KEY}`,
        'Prefer':        'return=minimal',
      },
    }
  );

  if (!response.ok) {
    console.error('purge-audit failed:', await response.text());
    return res.status(500).json({ ok: false });
  }

  console.log(`purge-audit: deleted records older than ${cutoff}`);
  return res.status(200).json({ ok: true, cutoff });
}
