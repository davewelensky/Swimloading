// GET /api/strava/callback
// Strava redirects here after user approves (or denies) OAuth.
// Validates signed state, exchanges code for tokens, stores in strava_connections.

import crypto from 'crypto';

function verifyState(state) {
    try {
        const decoded = Buffer.from(state, 'base64url').toString('utf8');
        const parts   = decoded.split('|');
        if (parts.length !== 3) return null;

        const [userId, ts, receivedHmac] = parts;

        // Reject states older than 10 minutes
        if (Date.now() - parseInt(ts) > 10 * 60 * 1000) return null;

        const expectedHmac = crypto
            .createHmac('sha256', process.env.STRAVA_CLIENT_SECRET)
            .update(`${userId}|${ts}`)
            .digest('hex');

        if (!crypto.timingSafeEqual(
            Buffer.from(receivedHmac, 'hex'),
            Buffer.from(expectedHmac, 'hex')
        )) return null;

        return userId;
    } catch {
        return null;
    }
}

export default async function handler(req, res) {
    const { code, state, error, scope } = req.query;

    // User denied Strava permission
    if (error === 'access_denied') {
        return res.redirect(302, '/app?strava=denied');
    }

    // Validate state
    const userId = verifyState(state);
    if (!userId) {
        return res.redirect(302, '/app?strava=error&reason=invalid_state');
    }

    // Check scope includes activity:read
    if (!scope || !scope.includes('activity:read')) {
        return res.redirect(302, '/app?strava=error&reason=missing_scope');
    }

    // Exchange code for tokens
    let tokenData;
    try {
        const tokenRes = await fetch('https://www.strava.com/oauth/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                client_id:     process.env.STRAVA_CLIENT_ID,
                client_secret: process.env.STRAVA_CLIENT_SECRET,
                code,
                grant_type:    'authorization_code',
            }),
        });

        if (!tokenRes.ok) {
            console.error('[strava/callback] token exchange failed:', await tokenRes.text());
            return res.redirect(302, '/app?strava=error&reason=token_exchange');
        }

        tokenData = await tokenRes.json();
    } catch (err) {
        console.error('[strava/callback] token exchange error:', err.message);
        return res.redirect(302, '/app?strava=error&reason=token_exchange');
    }

    const { athlete, access_token, refresh_token, expires_at } = tokenData;

    // Store tokens in strava_connections (upsert — user may reconnect)
    const supabaseUrl = process.env.SUPABASE_URL;
    const serviceKey  = process.env.SUPABASE_SERVICE_KEY;

    try {
        const upsertRes = await fetch(`${supabaseUrl}/rest/v1/strava_connections`, {
            method: 'POST',
            headers: {
                'Content-Type':  'application/json',
                'apikey':        serviceKey,
                'Authorization': `Bearer ${serviceKey}`,
                'Prefer':        'resolution=merge-duplicates,return=minimal',
            },
            body: JSON.stringify({
                user_id:           userId,
                strava_athlete_id: athlete.id,
                access_token,
                refresh_token,
                expires_at,
                scope,
                updated_at:        new Date().toISOString(),
            }),
        });

        if (!upsertRes.ok) {
            const errText = await upsertRes.text();
            console.error('[strava/callback] DB upsert failed:', errText);
            return res.redirect(302, '/app?strava=error&reason=db_write');
        }
    } catch (err) {
        console.error('[strava/callback] DB error:', err.message);
        return res.redirect(302, '/app?strava=error&reason=db_write');
    }

    // Success — back to app, JS will detect strava=connected and show a toast
    return res.redirect(302, '/app?strava=connected');
}
