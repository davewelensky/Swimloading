// POST /api/send-test-newsletter
// Admin-only. Sends a real test copy of a generated newsletter via Resend to
// the caller's own address (never a bulk send — there is no bulk-send
// integration in this codebase; Dave pastes the final HTML into Brevo himself,
// per his explicit instruction).
//
// Body: { subject: string, html: string }

import { Resend } from 'resend';
import { getUserId } from './strava/token-helper.js';

const SUPABASE_URL   = process.env.SUPABASE_URL || 'https://szgkzuswelntnevobnoh.supabase.co';
const SERVICE_KEY    = process.env.SUPABASE_SERVICE_KEY;
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM_ADDRESS   = 'SwimLoading <no-reply@swimloading.com>';
const ADMIN_EMAIL    = 'dave.welensky@gmail.com'; // same hardcoded gate as admin.html:802

export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const userId = await getUserId(req.headers['authorization']);
    if (!userId) return res.status(401).json({ error: 'Not authenticated' });

    const authRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${userId}`, {
        headers: { 'apikey': SERVICE_KEY, 'Authorization': `Bearer ${SERVICE_KEY}` },
    });
    const authUser = authRes.ok ? await authRes.json() : null;
    if (!authUser || authUser.email !== ADMIN_EMAIL) {
        return res.status(403).json({ error: 'Admin only' });
    }

    if (!RESEND_API_KEY) return res.status(500).json({ error: 'email_not_configured' });

    const { subject, html } = req.body || {};
    if (!subject || !html) return res.status(400).json({ error: 'subject and html required' });

    const resend = new Resend(RESEND_API_KEY);
    const { data, error } = await resend.emails.send({
        from: FROM_ADDRESS,
        to: [ADMIN_EMAIL],
        subject: `[TEST] ${subject}`,
        html,
    });

    if (error) {
        console.error('[send-test-newsletter] Resend error:', error.message);
        return res.status(502).json({ sent: false, error: error.message });
    }

    return res.status(200).json({ sent: true, id: data?.id });
}
