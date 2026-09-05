// GET /api/strava/activities
// Returns recent Strava swim activities for the logged-in user.
// Upserts into strava_imports, matches to SwimLoading spots by GPS.

import { getUserId, getValidStravaToken } from './token-helper.js';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://szgkzuswelntnevobnoh.supabase.co';
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;
const SWIM_TYPES   = new Set(['swim', 'openwaterswim', 'openwater', 'virtualswim', 'pool_swim', 'open_water_swim']);
const MATCH_RADIUS_KM = 1.5;

// A hung fetch (Strava's own servers not responding, most likely under real
// rate-limit pressure rather than a clean 429) doesn't throw — it just never
// resolves, and Vercel eventually kills the whole function with a bare 502
// that no try/catch inside the function can ever see. Force every external
// call to fail cleanly and catchably instead. Root-caused 2026-09-05: DaveW's
// requests reached this endpoint (proven by the 401 dummy-token test working)
// but the real, authenticated path always died with an empty 502.
async function fetchWithTimeout(url, opts = {}, timeoutMs = 8000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        return await fetch(url, { ...opts, signal: controller.signal });
    } finally {
        clearTimeout(timer);
    }
}

function haversineKm(lat1, lng1, lat2, lng2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2
        + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

async function matchSpot(startLatlng, spots) {
    if (!startLatlng || startLatlng.length < 2) return null;
    const [lat, lng] = startLatlng;
    let nearest = null;
    let nearestDist = Infinity;
    for (const spot of spots) {
        if (!spot.latitude || !spot.longitude) continue;
        const dist = haversineKm(lat, lng, spot.latitude, spot.longitude);
        if (dist < nearestDist) { nearestDist = dist; nearest = spot; }
    }
    return nearestDist <= MATCH_RADIUS_KM ? nearest : null;
}

export default async function handler(req, res) {
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

    // Nothing below was wrapped in try/catch — any thrown/rejected fetch (Strava's own
    // servers included) crashed the whole function as a bare 502 with no body, which is
    // exactly what DaveW hit on 2026-09-05: consistent, silent, no error surfaced
    // anywhere. This wrapper turns that into a real, visible error instead.
    try {
        return await handleActivities(req, res);
    } catch (err) {
        console.error('[strava/activities] unhandled exception:', err);
        if (err.name === 'AbortError') {
            return res.status(504).json({ error: 'upstream_timeout', message: 'A request to Strava or Supabase did not respond within 8 seconds.' });
        }
        return res.status(500).json({ error: 'unhandled_exception', message: err.message });
    }
}

async function handleActivities(req, res) {
    const userId = await getUserId(req.headers['authorization']);
    if (!userId) return res.status(401).json({ error: 'Not authenticated' });

    const token = await getValidStravaToken(userId);
    if (!token) return res.status(400).json({ error: 'strava_not_connected' });

    // REVERSED 2026-09-05 — this used to flag the narrower activity:read scope as
    // needing an upgrade to activity:read_all. Root-caused via Vercel logs that
    // activity:read_all itself is broken for this app (never approved by Strava for
    // real data access — every call 403s in ~60ms). connect-url.js no longer
    // requests it, but the 21 accounts that already have it are still stuck until
    // they reconnect once more. This now flags THAT stuck state instead.
    const scopeRows = await (async () => {
        const r = await fetchWithTimeout(
            `${SUPABASE_URL}/rest/v1/strava_connections?user_id=eq.${userId}&select=scope`,
            { headers: { 'apikey': SERVICE_KEY, 'Authorization': `Bearer ${SERVICE_KEY}` } }
        );
        return r.ok ? r.json() : [];
    })();
    const hasBrokenScope = (scopeRows[0]?.scope || '').includes('activity:read_all');
    if (hasBrokenScope) {
        // Don't bother calling Strava — we know this token 403s on every activity
        // call, confirmed in production logs 2026-09-05. Skip straight to telling
        // the user to reconnect instead of wasting a call and showing a raw error.
        return res.status(200).json({ activities: [], has_broken_scope: true });
    }

    // Fetch recent swim activities from Strava — two pages of 100 to cast a wide net
    // No sport_type filter param exists on the v3 endpoint; we filter client-side.
    // per_page=100 ensures swims aren't buried behind runs/rides in a mixed-activity feed.
    const [page1Res, page2Res] = await Promise.all([
        fetchWithTimeout('https://www.strava.com/api/v3/athlete/activities?per_page=100&page=1', { headers: { 'Authorization': `Bearer ${token}` } }),
        fetchWithTimeout('https://www.strava.com/api/v3/athlete/activities?per_page=100&page=2', { headers: { 'Authorization': `Bearer ${token}` } }),
    ]);

    // Strava sends X-RateLimit-Limit / X-RateLimit-Usage as "15min,daily" on every
    // response (not just 429s) — app-wide, shared across every SwimLoading user, not
    // per-athlete. Surfacing this is the only way to confirm/deny a rate-limit theory
    // without a Vercel log viewer (added 2026-09-05 debugging DaveW's "no swims found").
    const rateLimitInfo = {
        limit: page1Res.headers.get('x-ratelimit-limit') || null,
        usage: page1Res.headers.get('x-ratelimit-usage') || null,
    };
    console.log('[strava/activities] rate limit (15min,daily) — limit:', rateLimitInfo.limit, 'usage:', rateLimitInfo.usage);

    if (page1Res.status === 429) {
        return res.status(429).json({ error: 'strava_rate_limited', rate_limit: rateLimitInfo });
    }
    if (!page1Res.ok) {
        console.error('[strava/activities] Strava fetch failed:', await page1Res.text());
        return res.status(502).json({ error: 'strava_fetch_failed' });
    }
    const stravaRes = page1Res; // kept for error-handling compat below

    const page1 = await stravaRes.json();
    const page2 = page2Res.ok ? await page2Res.json() : [];
    const all = [...page1, ...page2];
    console.log('[strava/activities] total activities:', all.length,
        '| types:', [...new Set(all.map(a => a.sport_type || a.type))].join(', '),
        '| athlete:', all[0]?.athlete?.id ?? 'unknown');
    // Check sport_type AND type independently — if sport_type is e.g. "Workout" from a
    // Garmin sync it would otherwise shadow a valid "Swim" in the type field.
    const swims = all.filter(a =>
        SWIM_TYPES.has((a.sport_type || '').toLowerCase()) ||
        SWIM_TYPES.has((a.type || '').toLowerCase())
    );
    console.log('[strava/activities] swims after filter:', swims.length);

    if (swims.length === 0) {
        const typesSeenList = [...new Set(all.map(a => a.sport_type || a.type).filter(Boolean))];
        return res.status(200).json({ activities: [], debug_types_seen: typesSeenList, debug_total: all.length, rate_limit: rateLimitInfo });
    }

    // Load all active spots (with GPS) for matching
    const spotsRes = await fetch(
        `${SUPABASE_URL}/rest/v1/spots?select=id,name,code,latitude,longitude&order=name`,
        { headers: { 'apikey': SERVICE_KEY, 'Authorization': `Bearer ${SERVICE_KEY}` } }
    );
    const spots = spotsRes.ok ? await spotsRes.json() : [];

    // Load already-imported activity IDs for this user
    const importedRes = await fetch(
        `${SUPABASE_URL}/rest/v1/strava_imports?user_id=eq.${userId}&select=strava_activity_id,imported_to_log_id`,
        { headers: { 'apikey': SERVICE_KEY, 'Authorization': `Bearer ${SERVICE_KEY}` } }
    );
    const importedRows  = importedRes.ok ? await importedRes.json() : [];
    const importedMap   = new Map(importedRows.map(r => [r.strava_activity_id, r.imported_to_log_id]));

    // Build upsert payload and response
    const upsertRows = [];
    const activities = [];

    for (const a of swims) {
        const matchedSpot = await matchSpot(a.start_latlng, spots);
        const alreadyImported = importedMap.get(a.id) != null;

        upsertRows.push({
            user_id:               userId,
            strava_activity_id:    a.id,
            name:                  a.name,
            sport_type:            a.sport_type || a.type,
            start_date:            a.start_date,
            start_date_local:      a.start_date_local,
            distance_m:            a.distance,
            elapsed_time_seconds:  a.elapsed_time,
            moving_time_seconds:   a.moving_time,
            average_speed:         a.average_speed,
            start_latlng:          a.start_latlng || null,
            end_latlng:            a.end_latlng   || null,
            map_summary_polyline:  a.map?.summary_polyline || null,
            matched_spot_id:       matchedSpot?.id || null,
            average_temp:          a.average_temp ?? null,
            device_name:           a.device_name ?? null,
            average_heartrate:     a.average_heartrate ?? null,
            raw_payload:           a,
        });

        activities.push({
            id:                  null, // filled after upsert if needed
            strava_activity_id:  a.id,
            name:                a.name,
            sport_type:          a.sport_type || a.type,
            has_gps:             !!(a.start_latlng && a.start_latlng.length >= 2),
            start_date_local:    a.start_date_local,
            distance_m:          a.distance,
            elapsed_time_seconds: a.elapsed_time,
            matched_spot_id:     matchedSpot?.id || null,
            matched_spot_name:   matchedSpot?.name || null,
            already_imported:    alreadyImported,
            imported_to_log_id:  importedMap.get(a.id) || null,
            average_temp:        a.average_temp ?? null,
            device_name:         a.device_name ?? null,
            average_heartrate:   a.average_heartrate ?? null,
            is_open_water:       ['openwaterswim', 'openwater', 'open_water_swim'].includes((a.sport_type || a.type || '').toLowerCase()),
        });
    }

    // Upsert into strava_imports — awaited so Vercel doesn't kill the fetch before it completes
    const upsertRes = await fetch(`${SUPABASE_URL}/rest/v1/strava_imports?on_conflict=user_id,strava_activity_id`, {
        method:  'POST',
        headers: {
            'Content-Type':  'application/json',
            'apikey':        SERVICE_KEY,
            'Authorization': `Bearer ${SERVICE_KEY}`,
            'Prefer':        'resolution=merge-duplicates,return=minimal',
        },
        body: JSON.stringify(upsertRows),
    });
    if (!upsertRes.ok) {
        console.error('[strava/activities] upsert failed:', upsertRes.status, await upsertRes.text());
    } else {
        console.log('[strava/activities] upsert ok, rows:', upsertRows.length);
    }

    res.status(200).json({ activities });
}
