// POST /api/lab-enquiry
// Takes a booking enquiry from /aquasharks-lab, writes it to
// swim_lab_enquiries with the service key, then emails whoever runs the lab.
//
// The form used to POST straight to Supabase from the browser, which worked
// but meant a lead landed in the table and nowhere else. A parent scanning
// the poolside QR on a Saturday got a friendly confirmation while the
// enquiry sat unseen until somebody ran a query. This endpoint closes that.
//
// The insert is what matters. If Resend is down or misconfigured we still
// return success, because losing the lead is far worse than losing the
// notification, and the row is recoverable from the admin list either way.

import { Resend } from 'resend';

const SUPABASE_URL   = process.env.SUPABASE_URL || 'https://szgkzuswelntnevobnoh.supabase.co';
const SERVICE_KEY    = process.env.SUPABASE_SERVICE_KEY;
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM_ADDRESS   = 'SwimLoading <no-reply@swimloading.com>';

// Comma-separated in Vercel, e.g. "dave@…,britt@…". Falls back to Dave alone
// so a missing env var still reaches a human.
const NOTIFY_TO = (process.env.LAB_NOTIFY_TO || 'dave.welensky@gmail.com')
    .split(',').map(s => s.trim()).filter(Boolean);

const PACKAGE_LABELS = {
    full:    'Full session analysis',
    monthly: 'Multi-session progress tracking',
};

const clean = (v, max) =>
    typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null;

const esc = (v) => String(v == null ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

function buildHtml(row) {
    const line = (k, v) => v
        ? `<tr><td style="padding:6px 14px 6px 0;color:#64748b;font:13px system-ui;white-space:nowrap">${esc(k)}</td>
             <td style="padding:6px 0;color:#0f172a;font:15px system-ui"><b>${esc(v)}</b></td></tr>`
        : '';
    return `<div style="font-family:system-ui,sans-serif;max-width:560px">
  <p style="font-size:15px;color:#0f172a">New Aquasharks Lab enquiry.</p>
  <table style="border-collapse:collapse;margin:14px 0">
    ${line('Name', row.contact_name)}
    ${line('Swimmer', row.swimmer_name)}
    ${line('Email', row.email)}
    ${line('Phone', row.phone)}
    ${line('Squad', row.squad)}
    ${line('Wants', PACKAGE_LABELS[row.package] || row.package)}
  </table>
  ${row.notes ? `<p style="font-size:14px;color:#334155;background:#f1f5f9;padding:12px 14px;border-radius:8px;white-space:pre-wrap">${esc(row.notes)}</p>` : ''}
  <p style="font-size:13px;color:#64748b">Reply straight to this message to reach them, or open the enquiries list in club admin.</p>
</div>`;
}

function buildText(row) {
    return [
        'New Aquasharks Lab enquiry.',
        '',
        `Name:    ${row.contact_name}`,
        row.swimmer_name ? `Swimmer: ${row.swimmer_name}` : null,
        `Email:   ${row.email}`,
        row.phone ? `Phone:   ${row.phone}` : null,
        row.squad ? `Squad:   ${row.squad}` : null,
        row.package ? `Wants:   ${PACKAGE_LABELS[row.package] || row.package}` : null,
        row.notes ? `\nNotes:\n${row.notes}` : null,
    ].filter(Boolean).join('\n');
}

export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    if (!SERVICE_KEY) {
        console.error('[lab-enquiry] SUPABASE_SERVICE_KEY not configured');
        return res.status(500).json({ error: 'not_configured' });
    }

    const b = req.body && typeof req.body === 'object' ? req.body : {};

    // Bots fill every field they find. A human never sees this one.
    if (clean(b.website, 200)) return res.status(200).json({ ok: true });

    const contact_name = clean(b.contact_name, 120);
    const email        = clean(b.email, 254);
    if (!contact_name) return res.status(400).json({ error: 'name_required' });
    if (!email || !/^\S+@\S+\.\S+$/.test(email)) return res.status(400).json({ error: 'email_invalid' });

    const row = {
        club_slug:    clean(b.club_slug, 80) || 'aqua-sharks-atlantic',
        source:       clean(b.source, 80)    || 'aquasharks-lab',
        contact_name,
        swimmer_name: clean(b.swimmer_name, 120),
        email,
        phone:        clean(b.phone, 40),
        squad:        clean(b.squad, 120),
        package:      ['full', 'monthly'].includes(b.package) ? b.package : null,
        notes:        clean(b.notes, 2000),
    };

    const ins = await fetch(`${SUPABASE_URL}/rest/v1/swim_lab_enquiries`, {
        method: 'POST',
        headers: {
            'Content-Type':  'application/json',
            'apikey':        SERVICE_KEY,
            'Authorization': `Bearer ${SERVICE_KEY}`,
            'Prefer':        'return=representation',
        },
        body: JSON.stringify(row),
    });

    if (!ins.ok) {
        console.error('[lab-enquiry] insert failed', ins.status, await ins.text());
        return res.status(500).json({ error: 'insert_failed' });
    }
    const [saved] = await ins.json();

    // Notification is best effort. The lead is already safe either way, but
    // report the outcome so a silent mail failure is visible rather than
    // buried in a log nobody reads.
    let notified = false;
    let notifyError = null;

    if (!RESEND_API_KEY) {
        notifyError = 'no_resend_key';
    } else if (!NOTIFY_TO.length) {
        notifyError = 'no_recipients';
    } else {
        try {
            const resend = new Resend(RESEND_API_KEY);
            const { data, error } = await resend.emails.send({
                from: FROM_ADDRESS,
                to: NOTIFY_TO,
                replyTo: email,
                subject: `Aquasharks Lab enquiry: ${contact_name}`,
                html: buildHtml(row),
                text: buildText(row),
            }, { idempotencyKey: `lab-enquiry/${saved.id}` });
            if (error) {
                notifyError = `${error.name || 'resend_error'}: ${error.message || ''}`.slice(0, 200);
                console.error('[lab-enquiry] resend error', error);
            } else {
                notified = true;
                console.log('[lab-enquiry] notified', NOTIFY_TO.join(','), data && data.id);
            }
        } catch (e) {
            notifyError = `threw: ${(e && e.message) || e}`.slice(0, 200);
            console.error('[lab-enquiry] notify threw', e);
        }
    }

    return res.status(200).json({
        ok: true,
        id: saved.id,
        notified,
        notifyError,
        recipients: NOTIFY_TO.length,
    });
}
