// GET /api/strava/activities
// Returns recent Strava swim activities for the logged-in user.
// Upserts into strava_imports, matches to SwimLoading spots by GPS.

import { getUserId, getValidStravaToken } from './token-helper.js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;
const SWIM_TYPES   = new Set(['Swim', 'OpenWaterSwim', 'VirtualSwim']);
const MATCH_RADIUS_KM = 1.5;

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

    const userId = await getUserId(req.headers['authorization']);
    if (!userId) return res.status(401).json({ error: 'Not authenticated' });

    const token = await getValidStravaToken(userId);
    if (!token) return res.status(400).json({ error: 'strava_not_connected' });

    // Fetch recent activities from Strava
    const stravaRes = await fetch(
        'https://www.strava.com/api/v3/athlete/activities?per_page=30',
        { headers: { 'Authorization': `Bearer ${token}` } }
    );

    if (stravaRes.status === 429) {
        return res.status(429).json({ error: 'strava_rate_limited' });
    }
    if (!stravaRes.ok) {
        console.error('[strava/activities] Strava fetch failed:', await stravaRes.text());
        return res.status(502).json({ error: 'strava_fetch_failed' });
    }

    const all = await stravaRes.json();
    const swims = all.filter(a => SWIM_TYPES.has(a.sport_type || a.type));

    if (swims.length === 0) {
        return res.status(200).json({ activities: [] });
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
        const alreadyImported = importedMap.has(a.id);

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
            start_latlng:          a.start_latlng ? JSON.stringify(a.start_latlng) : null,
            end_latlng:            a.end_latlng   ? JSON.stringify(a.end_latlng)   : null,
            map_summary_polyline:  a.map?.summary_polyline || null,
            matched_spot_id:       matchedSpot?.id || null,
            raw_payload:           JSON.stringify(a),
        });

        activities.push({
            id:                  null, // filled after upsert if needed
            strava_activity_id:  a.id,
            name:                a.name,
            sport_type:          a.sport_type || a.type,
            start_date_local:    a.start_date_local,
            distance_m:          a.distance,
            elapsed_time_seconds: a.elapsed_time,
            matched_spot_id:     matchedSpot?.id || null,
            matched_spot_name:   matchedSpot?.name || null,
            already_imported:    alreadyImported,
            imported_to_log_id:  importedMap.get(a.id) || null,
        });
    }

    // Upsert into strava_imports (fire-and-forget, don't block response)
    fetch(`${SUPABASE_URL}/rest/v1/strava_imports`, {
        method:  'POST',
        headers: {
            'Content-Type':  'application/json',
            'apikey':        SERVICE_KEY,
            'Authorization': `Bearer ${SERVICE_KEY}`,
            'Prefer':        'resolution=merge-duplicates,return=minimal',
        },
        body: JSON.stringify(upsertRows),
    }).catch(err => console.error('[strava/activities] upsert error:', err.message));

    res.status(200).json({ activities });
}
