// Cron: daily purge of activity_audit records older than 7 days
// Scheduled in vercel.json: "0 3 * * *" (3am UTC)

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://szgkzuswelntnevobnoh.supabase.co';
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;

export default async function handler(req, res) {
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
