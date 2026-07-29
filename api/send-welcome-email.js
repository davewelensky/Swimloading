// POST /api/send-welcome-email
// Server-side, send-once welcome email focused on getting the user to add
// SwimLoading to their home screen. Called from app.js right after
// saveOnboardingPersonal() successfully sets profiles.onboarding_completed_at
// (the existing one-time "onboarding complete" transition — see app.js).
//
// Eligibility is re-checked here server-side (never trust the client):
//   - profile row exists for the authenticated user (proves a verified session)
//   - terms_accepted_at is set (consent step completed)
//   - onboarding_completed_at is set (reached the usable authenticated app)
//   - welcome_email_sent_at IS NULL (never sent before)
// Any missing condition is a silent no-op (200, sent:false) — this endpoint
// is safe to call speculatively and will simply do nothing until eligible.

import { Resend } from 'resend';
import { getUserId } from './strava/token-helper.js';
import { buildWelcomeEmailHtml, buildWelcomeEmailText } from './_lib/welcome-email-template.js';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://szgkzuswelntnevobnoh.supabase.co';
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM_ADDRESS = 'SwimLoading <no-reply@swimloading.com>';

async function dbGet(path) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
        headers: { 'apikey': SERVICE_KEY, 'Authorization': `Bearer ${SERVICE_KEY}` },
    });
    return res.ok ? res.json() : null;
}

async function dbPatch(path, body) {
    return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
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

// Fire-and-forget — mirrors the client-side analytics.track() convention (app.js),
// reused here since this send happens server-side and has no browser session to log from.
function trackEvent(eventName, userId, properties) {
    fetch(`${SUPABASE_URL}/rest/v1/analytics_events`, {
        method: 'POST',
        headers: {
            'Content-Type':  'application/json',
            'apikey':        SERVICE_KEY,
            'Authorization': `Bearer ${SERVICE_KEY}`,
            'Prefer':        'return=minimal',
        },
        body: JSON.stringify({ event_name: eventName, user_id: userId, properties: properties || null }),
    }).catch(() => {});
}

export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const userId = await getUserId(req.headers['authorization']);
    if (!userId) return res.status(401).json({ error: 'Not authenticated' });

    if (!RESEND_API_KEY) {
        console.error('[send-welcome-email] RESEND_API_KEY not configured');
        return res.status(500).json({ error: 'email_not_configured' });
    }

    const rows = await dbGet(
        `profiles?id=eq.${userId}&select=id,email,display_name,full_name,terms_accepted_at,onboarding_completed_at,welcome_email_sent_at`
    );
    const profile = rows && rows[0];
    if (!profile) return res.status(404).json({ error: 'profile_not_found' });

    if (profile.welcome_email_sent_at) {
        return res.status(200).json({ sent: false, reason: 'already_sent' });
    }
    if (!profile.terms_accepted_at) {
        return res.status(200).json({ sent: false, reason: 'consent_not_completed' });
    }
    if (!profile.onboarding_completed_at) {
        return res.status(200).json({ sent: false, reason: 'onboarding_not_completed' });
    }

    // email isn't stored on profiles in every case — fall back to the auth user record
    let email = profile.email;
    if (!email) {
        const authRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${userId}`, {
            headers: { 'apikey': SERVICE_KEY, 'Authorization': `Bearer ${SERVICE_KEY}` },
        });
        if (authRes.ok) {
            const authUser = await authRes.json();
            email = authUser?.email;
        }
    }
    if (!email) return res.status(500).json({ error: 'no_email_on_file' });

    const firstName = (profile.full_name || profile.display_name || '').split(' ')[0] || null;

    const resend = new Resend(RESEND_API_KEY);
    const { data, error } = await resend.emails.send(
        {
            from: FROM_ADDRESS,
            to: [email],
            subject: 'Your SwimLoading account is ready',
            html: buildWelcomeEmailHtml(firstName),
            text: buildWelcomeEmailText(firstName),
        },
        { idempotencyKey: `welcome-email/${userId}` }
    );

    if (error) {
        console.error('[send-welcome-email] Resend error:', error.message);
        await dbPatch(`profiles?id=eq.${userId}`, {
            welcome_email_status: 'failed',
            welcome_email_error: error.message?.slice(0, 500) || 'unknown_error',
        });
        trackEvent('welcome_email_failed', userId, { error: error.message });
        return res.status(502).json({ sent: false, error: 'send_failed' });
    }

    await dbPatch(`profiles?id=eq.${userId}`, {
        welcome_email_sent_at: new Date().toISOString(),
        welcome_email_status: 'sent',
        welcome_email_error: null,
    });
    trackEvent('welcome_email_sent', userId, { resend_id: data?.id || null });

    return res.status(200).json({ sent: true, id: data?.id });
}
