// Shared helper — get a valid Strava access token for a user.
// Refreshes automatically if token is within 10 minutes of expiry.

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://szgkzuswelntnevobnoh.supabase.co';
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;

// A hung fetch here (Supabase or Strava's OAuth token endpoint) never throws — it
// just never resolves, and Vercel eventually kills the whole invoking function
// with a bare 502 that no caller's try/catch can ever see, no matter how well
// THEY wrap their own code. Root-caused 2026-09-05: activities.js already had its
// own fetches timeout-protected and a top-level try/catch, and DaveW's requests
// were STILL dying as an empty 502 — before checkStravaBanner even opened a
// modal, i.e. inside getValidStravaToken(), called from here, completely
// unprotected. Every fetch in this shared helper needed the same treatment.
async function fetchWithTimeout(url, opts = {}, timeoutMs = 8000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        return await fetch(url, { ...opts, signal: controller.signal });
    } finally {
        clearTimeout(timer);
    }
}

async function dbGet(path) {
    const res = await fetchWithTimeout(`${SUPABASE_URL}/rest/v1/${path}`, {
        headers: { 'apikey': SERVICE_KEY, 'Authorization': `Bearer ${SERVICE_KEY}` },
    });
    return res.ok ? res.json() : null;
}

async function dbPatch(path, body) {
    return fetchWithTimeout(`${SUPABASE_URL}/rest/v1/${path}`, {
        method: 'PATCH',
        headers: {
            'Content-Type':  'application/json',
            'apikey':        SERVICE_KEY,
            'Authorization': `Bearer ${SERVICE_KEY}`,
            'Prefer':        'return=minimal',
        },
        body: JSON.stringify(body),
    });
}

export async function getValidStravaToken(userId) {
    const rows = await dbGet(`strava_connections?user_id=eq.${userId}&select=access_token,refresh_token,expires_at&limit=1`);
    if (!rows || rows.length === 0) return null;

    const conn = rows[0];
    const tenMinutes = 10 * 60;

    // Token still valid
    if (conn.expires_at > Math.floor(Date.now() / 1000) + tenMinutes) {
        return conn.access_token;
    }

    // Refresh
    const tokenRes = await fetchWithTimeout('https://www.strava.com/oauth/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            client_id:     process.env.STRAVA_CLIENT_ID,
            client_secret: process.env.STRAVA_CLIENT_SECRET,
            grant_type:    'refresh_token',
            refresh_token: conn.refresh_token,
        }),
    });

    if (!tokenRes.ok) {
        console.error('[strava/token-helper] refresh failed:', await tokenRes.text());
        return null;
    }

    const { access_token, refresh_token, expires_at } = await tokenRes.json();

    await dbPatch(`strava_connections?user_id=eq.${userId}`, {
        access_token,
        refresh_token,
        expires_at,
        updated_at: new Date().toISOString(),
    });

    return access_token;
}

// Validate Supabase JWT and return user_id, or null if invalid.
export async function getUserId(authHeader) {
    const token = (authHeader || '').replace('Bearer ', '').trim();
    if (!token) return null;

    const res = await fetchWithTimeout(`${SUPABASE_URL}/auth/v1/user`, {
        headers: { 'Authorization': `Bearer ${token}`, 'apikey': SERVICE_KEY },
    });
    if (!res.ok) return null;

    const { id } = await res.json();
    return id || null;
}
