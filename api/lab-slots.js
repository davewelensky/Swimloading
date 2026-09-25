// /api/lab-slots
//
//   GET  ?club=aqua-sharks-atlantic   list open days and their slots
//   POST { slot_id, contact_name, email, ... }   book one slot
//
// Backs the Saturday slot picker on /aquasharks-lab. The point of the whole
// feature is that Britt never negotiates a time over WhatsApp: she opens a
// morning, parents take the slots themselves.
//
// PRIVACY. Slots carry a child's name and a parent's phone number, so there is
// deliberately no anonymous SELECT policy on swim_lab_slots. This endpoint
// reads with the service key and returns only id, starts_at and status, so a
// visitor sees "09:30 taken" and never who took it.
//
// RACE. Booking is UPDATE ... WHERE id = $1 AND status = 'open', which is
// atomic in Postgres. Two parents tapping the same slot means the second
// update matches zero rows and that person is told it has gone, rather than
// both being told yes and one being turned away at the pool.

import { Resend } from 'resend';

const SUPABASE_URL   = process.env.SUPABASE_URL || 'https://szgkzuswelntnevobnoh.supabase.co';
const SERVICE_KEY    = process.env.SUPABASE_SERVICE_KEY;
const RESEND_API_KEY = process.env.RESEND_API_KEY;

const FROM_ADDRESS = 'SwimLoading <support@swimloading.com>';
const REPLY_TO     = 'dave@apploading.co';
const NOTIFY_TO    = (process.env.LAB_NOTIFY_TO || 'dave.welensky@gmail.com')
  .split(',').map((s) => s.trim()).filter(Boolean);

const VENUE = 'Camps Bay Primary School, Cape Town';
const TZ    = 'Africa/Johannesburg';

const clean = (v, max) =>
  typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null;

const esc = (v) => String(v == null ? '' : v)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Always format in SAST. Never build a date string from toISOString(), which
// silently shifts to the previous day for us.
function fmt(iso, opts) {
  return new Date(iso).toLocaleString('en-ZA', { timeZone: TZ, ...opts });
}
const slotDay  = (iso) => fmt(iso, { weekday: 'long', day: 'numeric', month: 'long' });
const slotTime = (iso) => fmt(iso, { hour: '2-digit', minute: '2-digit', hour12: false });

async function db(path, init) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      ...(init && init.headers),
    },
  });
  if (!res.ok) throw new Error(`db ${res.status} ${await res.text()}`);
  return res.status === 204 ? null : res.json();
}

async function listDays(club) {
  const today = fmt(Date.now(), { year: 'numeric', month: '2-digit', day: '2-digit' })
    .split('/').reverse().join('-');   // en-ZA gives dd/mm/yyyy

  const days = await db(
    `swim_lab_days?club_slug=eq.${encodeURIComponent(club)}&is_open=is.true` +
    `&session_date=gte.${today}&order=session_date.asc&select=id,session_date,start_time,slot_minutes,note`
  );
  if (!days.length) return [];

  const ids = days.map((d) => d.id).join(',');
  const slots = await db(
    `swim_lab_slots?day_id=in.(${ids})&order=starts_at.asc&select=id,day_id,starts_at,status`
  );

  return days.map((d) => {
    const mine = slots.filter((s) => s.day_id === d.id);
    return {
      id: d.id,
      date: d.session_date,
      label: mine.length ? slotDay(mine[0].starts_at) : null,
      note: d.note,
      minutes: d.slot_minutes,
      // only these three fields ever leave the server
      slots: mine.map((s) => ({ id: s.id, time: slotTime(s.starts_at), status: s.status })),
      openCount: mine.filter((s) => s.status === 'open').length,
    };
  });
}

function notifyHtml(slot, row) {
  const line = (k, v) => v ? `<tr><td style="padding:5px 14px 5px 0;color:#64748b;font:13px system-ui">${esc(k)}</td><td style="padding:5px 0;color:#0f172a;font:15px system-ui"><b>${esc(v)}</b></td></tr>` : '';
  return `<div style="font-family:system-ui,sans-serif;max-width:560px">
  <p style="font-size:15px;color:#0f172a">Slot booked: <b>${esc(slotDay(slot.starts_at))} at ${esc(slotTime(slot.starts_at))}</b></p>
  <table style="border-collapse:collapse;margin:12px 0">
    ${line('Name', row.contact_name)}${line('Swimmer', row.swimmer_name)}
    ${line('Email', row.email)}${line('Phone', row.phone)}${line('Squad', row.squad)}
  </table>
  ${row.notes ? `<p style="font-size:14px;color:#334155;background:#f1f5f9;padding:12px 14px;border-radius:8px;white-space:pre-wrap">${esc(row.notes)}</p>` : ''}
  <p style="font-size:13px;color:#64748b">Reply to reach them, or open Lab Sessions in club admin.</p>
</div>`;
}

function confirmHtml(slot, row) {
  return `<div style="font-family:system-ui,sans-serif;max-width:560px;color:#0f172a">
  <p style="font-size:16px">Hi ${esc((row.contact_name || '').split(' ')[0] || 'there')}, your slot is booked.</p>
  <p style="font-size:20px;font-weight:700;margin:18px 0 6px">${esc(slotDay(slot.starts_at))}, ${esc(slotTime(slot.starts_at))}</p>
  <p style="font-size:15px;color:#475569;margin:0 0 18px">${esc(VENUE)}<br>About 30 minutes in the water.</p>
  <p style="font-size:15px;color:#475569">Bring a costume, goggles and a towel. Nothing else. We will put the sensors in your hands at the pool.</p>
  <p style="font-size:15px;color:#475569">Your report reaches you within 24 hours of the session.</p>
  <p style="font-size:14px;color:#64748b;margin-top:22px">Need to change or cancel? Just reply to this email.</p>
</div>`;
}

export default async function handler(req, res) {
  if (!SERVICE_KEY) return res.status(500).json({ error: 'not_configured' });

  if (req.method === 'GET') {
    const club = clean(req.query.club, 80) || 'aqua-sharks-atlantic';
    try {
      return res.status(200).json({ days: await listDays(club) });
    } catch (e) {
      console.error('[lab-slots] list failed', e);
      return res.status(500).json({ error: 'list_failed' });
    }
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const b = req.body && typeof req.body === 'object' ? req.body : {};
  if (clean(b.website, 200)) return res.status(200).json({ ok: true });   // honeypot

  const slotId = clean(b.slot_id, 64);
  const row = {
    contact_name: clean(b.contact_name, 120),
    swimmer_name: clean(b.swimmer_name, 120),
    email:        clean(b.email, 254),
    phone:        clean(b.phone, 40),
    squad:        clean(b.squad, 120),
    notes:        clean(b.notes, 2000),
  };
  if (!slotId) return res.status(400).json({ error: 'slot_required' });
  if (!row.contact_name) return res.status(400).json({ error: 'name_required' });
  if (!row.email || !/^\S+@\S+\.\S+$/.test(row.email)) return res.status(400).json({ error: 'email_invalid' });

  let booked;
  try {
    // The status filter is the whole race guard. If someone got here first
    // this matches nothing and we return taken, rather than overwriting them.
    const updated = await db(
      `swim_lab_slots?id=eq.${encodeURIComponent(slotId)}&status=eq.open` +
      `&select=id,starts_at,day_id`,
      {
        method: 'PATCH',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify({ ...row, status: 'booked', booked_at: new Date().toISOString() }),
      }
    );
    if (!updated || !updated.length) return res.status(409).json({ error: 'slot_taken' });
    booked = updated[0];
  } catch (e) {
    console.error('[lab-slots] booking failed', e);
    return res.status(500).json({ error: 'booking_failed' });
  }

  // Mail is best effort. The slot is already held, and losing the booking
  // would be far worse than losing a notification.
  let notified = false, confirmed = false, mailError = null;
  if (RESEND_API_KEY) {
    const resend = new Resend(RESEND_API_KEY);
    try {
      const a = await resend.emails.send({
        from: FROM_ADDRESS, to: NOTIFY_TO, replyTo: row.email,
        subject: `Lab slot booked: ${slotDay(booked.starts_at)} ${slotTime(booked.starts_at)}`,
        html: notifyHtml(booked, row),
      }, { idempotencyKey: `lab-slot-notify/${booked.id}` });
      notified = !a.error;
      if (a.error) mailError = `${a.error.name}: ${a.error.message}`.slice(0, 160);

      const c = await resend.emails.send({
        from: FROM_ADDRESS, to: [row.email], replyTo: REPLY_TO,
        subject: `Your Aquasharks Lab slot: ${slotDay(booked.starts_at)}, ${slotTime(booked.starts_at)}`,
        html: confirmHtml(booked, row),
      }, { idempotencyKey: `lab-slot-confirm/${booked.id}` });
      confirmed = !c.error;
    } catch (e) {
      mailError = String(e.message || e).slice(0, 160);
      console.error('[lab-slots] mail threw', e);
    }
  } else {
    mailError = 'no_resend_key';
  }

  return res.status(200).json({
    ok: true,
    slot: { id: booked.id, day: slotDay(booked.starts_at), time: slotTime(booked.starts_at) },
    notified, confirmed, mailError,
  });
}
