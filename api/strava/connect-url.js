// GET /api/strava/connect-url
// Validates the user's Supabase session, returns a signed Strava OAuth URL.
// The signed state lets the callback recover user_id without a DB lookup.

import crypto from 'crypto';

export default async function handler(req, res) {
    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    // Validate Supabase session from Authorization header
    const authHeader = req.headers['authorization'] || '';
    const token = authHeader.replace('Bearer ', '').trim();
    if (!token) {
        return res.status(401).json({ error: 'Not authenticated' });
    }

    const supabaseUrl = process.env.SUPABASE_URL;
    const serviceKey  = process.env.SUPABASE_SERVICE_KEY;

    // Verify JWT and get user_id via Supabase
    const userRes = await fetch(`${supabaseUrl}/auth/v1/user`, {
        headers: {
            'Authorization': `Bearer ${token}`,
            'apikey': serviceKey,
        },
    });

    if (!userRes.ok) {
        return res.status(401).json({ error: 'Invalid session' });
    }

    const { id: userId } = await userRes.json();
    if (!userId) {
        return res.status(401).json({ error: 'Could not identify user' });
    }

    // Build signed state: userId|timestamp|hmac
    // HMAC prevents tampering — callback verifies before trusting user_id
    const ts    = Date.now().toString();
    const raw   = `${userId}|${ts}`;
    const hmac  = crypto
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

    const url = `https://www.strava.com/oauth/authorize?${params}`;
    res.status(200).json({ url });
}
