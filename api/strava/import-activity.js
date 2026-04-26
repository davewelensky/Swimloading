// POST /api/strava/import-activity
// Creates a SwimLoading temp_log from a selected Strava import.
// User must supply water temperature, conditions, and spot.

import { getUserId } from './token-helper.js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;

async function supabasePost(path, body, prefer = 'return=representation') {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
        method:  'POST',
        headers: {
            'Content-Type':  'application/json',
            'apikey':        SERVICE_KEY,
            'Authorization': `Bearer ${SERVICE_KEY}`,
            'Prefer':        prefer,
        },
        body: JSON.stringify(body),
    });
    const text = await res.text();
    return { ok: res.ok, status: res.status, body: text ? JSON.parse(text) : null };
}

async function supabasePatch(path, body) {
    return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
        method:  'PATCH',
        headers: {
            'Content-Type':  'application/json',
            'apikey':        SERVICE_KEY,
            'Authorization': `Bearer ${SERVICE_KEY}`,
            'Prefer':        'return=minimal',
        },
        body: JSON.stringify(body),
    });
}

export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const userId = await getUserId(req.headers['authorization']);
    if (!userId) return res.status(401).json({ error: 'Not authenticated' });

    const {
        strava_activity_id,
        spot_id,
        temperature,
        conditions,
        hazards,
        notes,
    } = req.body || {};

    // Validate required fields
    if (!strava_activity_id)          return res.status(400).json({ error: 'strava_activity_id required' });
    if (!spot_id)                      return res.status(400).json({ error: 'spot_id required' });
    if (temperature === undefined || temperature === null || temperature === '')
                                       return res.status(400).json({ error: 'temperature required' });
    if (!conditions)                   return res.status(400).json({ error: 'conditions required' });

    // Load the strava_import row — verify it belongs to this user
    const importRes = await fetch(
        `${SUPABASE_URL}/rest/v1/strava_imports?user_id=eq.${userId}&strava_activity_id=eq.${strava_activity_id}&limit=1`,
        { headers: { 'apikey': SERVICE_KEY, 'Authorization': `Bearer ${SERVICE_KEY}` } }
    );
    const imports = importRes.ok ? await importRes.json() : [];
    if (imports.length === 0) return res.status(404).json({ error: 'strava_import_not_found' });

    const stravaImport = imports[0];
    if (stravaImport.imported_to_log_id) {
        return res.status(409).json({ error: 'already_imported' });
    }

    // Build the temp_log row
    const logData = {
        user_id:         userId,
        spot_id,
        temp_c:          parseFloat(temperature),
        conditions:      Array.isArray(conditions) ? conditions[0] : conditions,
        hazards:         Array.isArray(hazards) ? hazards : (hazards ? [hazards] : []),
        notes:           notes
            ? `${notes}\n\nImported from Strava: ${stravaImport.name || 'activity'}`
            : `Imported from Strava: ${stravaImport.name || 'activity'}`,
        location_source: 'manual',
        logged_at:       stravaImport.start_date_local || stravaImport.start_date,
    };

    const { ok, body: logRows } = await supabasePost('temp_logs', logData);
    if (!ok || !logRows || logRows.length === 0) {
        console.error('[strava/import-activity] temp_log insert failed:', logRows);
        return res.status(500).json({ error: 'log_insert_failed' });
    }

    const logId = logRows[0].id;

    // Mark the strava_import as imported
    await supabasePatch(
        `strava_imports?user_id=eq.${userId}&strava_activity_id=eq.${strava_activity_id}`,
        { imported_to_log_id: logId }
    );

    return res.status(200).json({ log_id: logId, success: true });
}
