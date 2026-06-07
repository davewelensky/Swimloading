// POST /api/audit-log
// Receives action data from the client, enriches with IP/geo/UA from Vercel
// headers, writes to activity_audit via service role (so IP is never exposed
// to the client — only the server side sees it).
//
// Body: { userId?, actionType, path?, metadata? }

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://szgkzuswelntnevobnoh.supabase.co';
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;

export default async function handler(req, res) {
  // Only accept POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const body = req.body || {};
    const { userId, actionType, path, metadata } = body;

    if (!actionType) {
      return res.status(400).json({ error: 'actionType required' });
    }

    // Extract IP — Vercel sets x-forwarded-for on all requests
    const forwarded = req.headers['x-forwarded-for'] || '';
    const ip = forwarded.split(',')[0].trim() || req.socket?.remoteAddress || null;

    // Vercel automatically injects geo headers on the edge
    const country    = req.headers['x-vercel-ip-country']      || null;
    const city       = req.headers['x-vercel-ip-city']         || null;
    const userAgent  = req.headers['user-agent']               || null;

    const row = {
      user_id:     userId || null,
      action_type: actionType,
      ip_address:  ip,
      country,
      city,
      user_agent:  userAgent,
      path:        path || null,
      metadata:    metadata || null,
    };

    const response = await fetch(`${SUPABASE_URL}/rest/v1/activity_audit`, {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'apikey':        SERVICE_KEY,
        'Authorization': `Bearer ${SERVICE_KEY}`,
        'Prefer':        'return=minimal',
      },
      body: JSON.stringify(row),
    });

    if (!response.ok) {
      const err = await response.text();
      console.error('audit-log insert failed:', err);
      return res.status(500).json({ error: 'Failed to write audit log' });
    }

    // Always return 200 — never let logging block the user action
    return res.status(200).json({ ok: true });

  } catch (e) {
    console.error('audit-log error:', e.message);
    // Silent fail — logging should never break the app
    return res.status(200).json({ ok: true });
  }
}
