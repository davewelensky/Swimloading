// POST /api/strava/streams { strava_activity_id }
// Fetches per-second streams for one of the signed-in swimmer's own long swims
// (2 hours or more), turns them into an hour-by-hour summary, and stores only the
// summary. Strava's terms allow showing a user's data only to that user, so the
// stored row is readable by its owner alone.

import { getUserId, getValidStravaToken } from './token-helper.js';
import { analyseSwimStreams } from '../_lib/strava-streams.js';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://szgkzuswelntnevobnoh.supabase.co';
const ANON_KEY = process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InN6Z2t6dXN3ZWxudG5ldm9ibm9oIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjgxODY1NTUsImV4cCI6MjA4Mzc2MjU1NX0.UfKqj2OZ-XeyzCy-MZYZqsDWjn_4EKrhgCFR8eIK2NA';
const MIN_SECONDS = 2 * 3600;
const KEYS = 'time,distance,heartrate,cadence,velocity_smooth,temp,moving';

async function withTimeout(fetchImpl, url, opts = {}, ms = 15000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ms);
    try { return await fetchImpl(url, { ...opts, signal: controller.signal }); } finally { clearTimeout(timer); }
}

export function createStreamsHandler(deps = {}) {
    const fetchImpl = deps.fetch || globalThis.fetch;
    const userIdOf = deps.getUserId || getUserId;
    const tokenOf = deps.getValidStravaToken || getValidStravaToken;

    const asUser = (path, jwt, opts = {}) => withTimeout(fetchImpl, `${SUPABASE_URL}/rest/v1/${path}`, {
        ...opts,
        headers: { apikey: ANON_KEY, Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json', ...(opts.headers || {}) },
    });

    return async function handler(req, res) {
        res.setHeader('Cache-Control', 'no-store');
        if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
        try {
            const jwt = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
            const userId = jwt ? await userIdOf(req.headers.authorization) : null;
            if (!userId) return res.status(401).json({ error: 'sign_in_required' });

            const activityId = String(req.body?.strava_activity_id || '');
            if (!/^\d{1,20}$/.test(activityId)) return res.status(400).json({ error: 'bad_activity_id' });

            const own = await asUser(`strava_imports?select=moving_time_seconds&user_id=eq.${userId}&strava_activity_id=eq.${activityId}&limit=1`, jwt);
            const rows = own.ok ? await own.json() : [];
            if (!rows.length) return res.status(404).json({ error: 'not_your_activity' });
            if ((rows[0].moving_time_seconds || 0) < MIN_SECONDS) return res.status(400).json({ error: 'too_short' });

            if (!req.body?.refresh) {
                const cached = await asUser(`strava_swim_analyses?select=summary&user_id=eq.${userId}&strava_activity_id=eq.${activityId}&limit=1`, jwt);
                const hit = cached.ok ? await cached.json() : [];
                if (hit.length) return res.status(200).json({ status: 'ok', cached: true, summary: hit[0].summary });
            }

            const token = await tokenOf(userId);
            if (!token) return res.status(409).json({ error: 'strava_not_connected' });

            const sr = await withTimeout(fetchImpl, `https://www.strava.com/api/v3/activities/${activityId}/streams?keys=${KEYS}&key_by_type=true`, {
                headers: { Authorization: `Bearer ${token}` },
            });
            if (sr.status === 429) return res.status(503).json({ error: 'strava_busy' });
            if (!sr.ok) {
                console.error('[strava/streams] Strava returned', sr.status);
                return res.status(502).json({ error: 'strava_error' });
            }
            const summary = analyseSwimStreams(await sr.json());
            if (!summary) return res.status(422).json({ error: 'no_streams' });

            const save = await asUser('strava_swim_analyses?on_conflict=user_id,strava_activity_id', jwt, {
                method: 'POST',
                headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
                body: JSON.stringify({ user_id: userId, strava_activity_id: Number(activityId), summary, fetched_at: new Date().toISOString() }),
            });
            if (!save.ok) console.error('[strava/streams] save failed', save.status);
            return res.status(200).json({ status: 'ok', cached: false, summary });
        } catch (err) {
            console.error('[strava/streams] failed', err?.name);
            return res.status(500).json({ error: 'failed' });
        }
    };
}

export default createStreamsHandler();
