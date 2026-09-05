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

        const redirectUri = process.env.STRAVA_REDIRECT_URI || 'https://www.swimloading.com/api/strava/callback';

        const params = new URLSearchParams({
            client_id:       process.env.STRAVA_CLIENT_ID,
            redirect_uri:    redirectUri,
            response_type:   'code',
            approval_prompt: 'auto',
            // Reverted 2026-09-05: activity:read_all is one of Strava's "elevated"
            // scopes — an app needs Strava's own approval to actually USE it for real
            // data, separate from a user just granting it in the OAuth screen. This
            // app was never approved for it. Root-caused via Vercel function logs:
            // every user who reconnected and got read_all started getting a clean
            // 403 Forbidden on every /athlete/activities call (~60ms, not a timeout —
            // Strava flatly refusing it), while the 51 users still on plain
            // activity:read kept working fine (just missing "Followers Only"/private
            // activities, the original, much smaller complaint). Confirmed on two
            // accounts (DaveW, Barbara) whose last successful import was the day
            // before they each reconnected. Do not re-request activity:read_all
            // without first confirming with Strava that this app is approved for it.
            scope:           'activity:read',
            state,
        });

        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
        return res.status(200).json({ url: `https://www.strava.com/oauth/authorize?${params}` });
    } catch (err) {
        console.error('[strava/connect-url] unexpected error:', err.message);
        return res.status(500).json({ error: err.message });
    }
}
