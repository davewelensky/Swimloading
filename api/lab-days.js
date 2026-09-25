// POST /api/lab-days
//
// Opens a morning of Aquasharks Lab slots, or closes one.
//
//   { action:'open',   club, date:'2026-10-04', start:'08:00', slots:6, minutes:30, note? }
//   { action:'close',  day_id }        stop taking new bookings, keep existing
//   { action:'reopen', day_id }
//   { action:'cancel', slot_id }       free a booked slot back to open
//
// Auth: the caller's Supabase access token, checked against club_admins for
// the club being changed. Same rule as the Lab Enquiries tab: this is admin
// work and the rows carry parents' contact details.
//
// TIME ZONES. Slot times are built from an explicit SAST offset,
// `${date}T${start}:00+02:00`, never from a bare new Date(date) or a local
// toISOString() on a date-only string. Both of those land on the previous day
// for us and would put a Saturday 08:00 slot on Friday evening. Verified:
// 2026-10-03 08:00 stores as 06:00Z and reads back as Sat 3 Oct 08:00 SAST.

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://szgkzuswelntnevobnoh.supabase.co';
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;
const ANON_KEY     = process.env.SUPABASE_ANON_KEY;

const clean = (v, max) =>
  typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null;

async function svc(path, init) {
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

// Resolve the bearer token to a user, then confirm they administer this club.
async function adminFor(req, clubSlug) {
  const auth = req.headers['authorization'] || '';
  if (!auth.startsWith('Bearer ')) return null;

  const who = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: ANON_KEY || SERVICE_KEY, Authorization: auth },
  });
  if (!who.ok) return null;
  const user = await who.json();
  if (!user || !user.id) return null;

  const rows = await svc(
    `club_admins?user_id=eq.${user.id}&select=club_id,clubs!inner(slug)`
  );
  const slugs = (rows || []).map((r) => r.clubs && r.clubs.slug).filter(Boolean);
  return slugs.includes(clubSlug) ? user.id : null;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!SERVICE_KEY) return res.status(500).json({ error: 'not_configured' });

  const b = req.body && typeof req.body === 'object' ? req.body : {};
  const action = clean(b.action, 20);

  try {
    if (action === 'open') {
      const club    = clean(b.club, 80) || 'aqua-sharks-atlantic';
      const date    = clean(b.date, 10);
      const start   = clean(b.start, 8);
      const minutes = Math.min(Math.max(parseInt(b.minutes, 10) || 30, 10), 120);
      const count   = Math.min(Math.max(parseInt(b.slots, 10) || 6, 1), 24);
      const note    = clean(b.note, 400);

      if (!await adminFor(req, club)) return res.status(403).json({ error: 'not_an_admin' });
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) return res.status(400).json({ error: 'date_invalid' });
      if (!/^\d{2}:\d{2}$/.test(start || ''))      return res.status(400).json({ error: 'start_invalid' });

      const [day] = await svc('swim_lab_days', {
        method: 'POST',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify({
          club_slug: club, session_date: date, start_time: start,
          slot_minutes: minutes, note,
        }),
      });

      // Explicit +02:00 on the first slot, then plain minute arithmetic.
      // See the time zone note at the top of this file.
      const slots = Array.from({ length: count }, (_, n) => ({
        day_id: day.id,
        starts_at: `${date}T${start}:00+02:00`,   // SAST offset, explicit
        _n: n,
      })).map((s) => {
        const d = new Date(s.starts_at);
        d.setMinutes(d.getMinutes() + s._n * minutes);
        return { day_id: s.day_id, starts_at: d.toISOString() };
      });

      await svc('swim_lab_slots', {
        method: 'POST',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify(slots),
      });

      return res.status(200).json({ ok: true, day_id: day.id, slots: slots.length });
    }

    if (action === 'close' || action === 'reopen') {
      const dayId = clean(b.day_id, 64);
      if (!dayId) return res.status(400).json({ error: 'day_required' });
      const [day] = await svc(`swim_lab_days?id=eq.${dayId}&select=club_slug`);
      if (!day) return res.status(404).json({ error: 'day_not_found' });
      if (!await adminFor(req, day.club_slug)) return res.status(403).json({ error: 'not_an_admin' });

      await svc(`swim_lab_days?id=eq.${dayId}`, {
        method: 'PATCH',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ is_open: action === 'reopen' }),
      });
      return res.status(200).json({ ok: true, is_open: action === 'reopen' });
    }

    if (action === 'cancel') {
      const slotId = clean(b.slot_id, 64);
      if (!slotId) return res.status(400).json({ error: 'slot_required' });
      const [slot] = await svc(`swim_lab_slots?id=eq.${slotId}&select=day_id,swim_lab_days!inner(club_slug)`);
      if (!slot) return res.status(404).json({ error: 'slot_not_found' });
      if (!await adminFor(req, slot.swim_lab_days.club_slug)) return res.status(403).json({ error: 'not_an_admin' });

      // Clearing every booking field matters: the table's CHECK requires a
      // booked slot to carry a name and email, so a partial clear would fail.
      await svc(`swim_lab_slots?id=eq.${slotId}`, {
        method: 'PATCH',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({
          status: 'open', contact_name: null, swimmer_name: null,
          email: null, phone: null, squad: null, notes: null, booked_at: null,
        }),
      });
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ error: 'unknown_action' });
  } catch (e) {
    console.error('[lab-days]', action, e);
    return res.status(500).json({ error: 'failed', detail: String(e.message || e).slice(0, 200) });
  }
}
