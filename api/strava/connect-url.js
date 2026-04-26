// GET /api/strava/connect-url
// Validates the user's Supabase session, returns a signed Strava OAuth URL.

import crypto from 'crypto';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://szgkzuswelntnevobnoh.supabase.co';
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;

export default async function handler(req, res) {
    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const token = (req.headers['authorization'] || '').replace('Bearer ', '').trim();
    if (!token) return res.status(401).json({ error: 'Not authenticated' });

    if (!SERVICE_KEY) {
        console.error('[strava/connect-url] SUPABASE_SERVICE_KEY not set');
        return res.status(500).json({ error: 'Server misconfigured' });
    }
    if (!process.env.STRAVA_CLIENT_SECRET) {
        console.error('[strava/connect-url] STRAVA_CLIENT_SECRET not set');
        return res.status(500).json({ error: 'Server misconfigured' });
    }

    try {
        // Verify JWT and get user_id
        const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
            headers: { 'Authorization': `Bearer ${token}`, 'apikey': SERVICE_KEY },
        });

        if (!userRes.ok) return res.status(401).json({ error: 'Invalid session' });

        const { id: userId } = await userRes.json();
        if (!userId) return res.status(401).json({ error: 'Could not identify user' });

        // Signed state: userId|timestamp|hmac — callback verifies before trusting user_id
        const ts   = Date.now().toString();
        const raw  = `${userId}|${ts}`;
        const hmac = crypto
            .createHmac('sha256', process.env.STRAVA_CLIENT_SECRET)
            .update(raw)
            .digest('hex');
        const state = Buffer.from(`${raw}|${hmac}`).toString('base64url');

        const params = new URLSearchParams({
            client_id:       process.env.STRAVA_CLIENT_ID,
            redirect_uri:    process.env.STRAVA_REDIRECT_URI,
            response_type:   'code',
            approval_prompt: 'auto',
            scope:           'activity:read',
            state,
        });

        return res.status(200).json({ url: `https://www.strava.com/oauth/authorize?${params}` });
    } catch (err) {
        console.error('[strava/connect-url] unexpected error:', err.message);
        return res.status(500).json({ error: err.message });
    }
}
