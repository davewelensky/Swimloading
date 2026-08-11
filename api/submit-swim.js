// POST /api/submit-swim — the organiser submission endpoint, behind Cloudflare Turnstile.
//
// WHY THIS EXISTS. /list-your-swim originally called the Supabase RPC
// straight from the browser with the anon key. That is fine for a form
// nobody is attacking and useless against anyone who is: the per-email
// rate limit in submit_organiser_event() keys on an email the submitter
// types, so a script varies it per request and walks through. The blast
// radius was never data — anon cannot read or write the table, and nothing
// publishes without review — it was a flooded review queue, which is the
// one thing Dave has already said is unmanageable.
//
// Turnstile needs a server, because the token has to be verified against
// Cloudflare with a SECRET key. A browser cannot hold that secret, so the
// submission moves behind this route.
//
// THE PART THAT IS EASY TO GET WRONG: putting a widget on the form does
// nothing on its own while the RPC is still callable by anon. Anyone can
// skip the page and POST to Supabase directly. Turnstile is only real once
// the anon EXECUTE grant is revoked and this route — holding the service
// key — is the only way in. That revocation is a separate migration,
// applied AFTER this is verified working, so the live form is never broken
// in between.
//
// ENV, both set in Vercel:
//   TURNSTILE_SITE_KEY    public, served to the page by the GET below
//   TURNSTILE_SECRET_KEY  secret, never leaves the server
//   SUPABASE_SERVICE_KEY  already present

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://szgkzuswelntnevobnoh.supabase.co';
const VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

export default async function handler(req, res) {
  const siteKey = process.env.TURNSTILE_SITE_KEY || null;
  const secret = process.env.TURNSTILE_SECRET_KEY || null;

  // The page asks whether Turnstile is switched on. Answering honestly is
  // what lets this ship before the keys exist: with no keys the form keeps
  // its current direct-to-Supabase path and nothing breaks, and the moment
  // the keys are set it routes through here instead — no code change, no
  // window where the form is down.
  if (req.method === 'GET') {
    return res.status(200).json({ enabled: Boolean(siteKey && secret), siteKey });
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const serviceKey = process.env.SUPABASE_SERVICE_KEY;
  if (!serviceKey) return res.status(500).json({ error: 'SUPABASE_SERVICE_KEY not set' });

  // Fail CLOSED. If this route is reachable but unconfigured, refusing is
  // right: the alternative is a route that looks protected and is not,
  // which is worse than one that is plainly off. The form only sends here
  // when GET said enabled, so this should be unreachable in practice.
  if (!secret) {
    return res.status(503).json({
      error: 'Spam protection is not configured on the server. Please email support@swimloading.com and we will add your swim.',
    });
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { return res.status(400).json({ error: 'Malformed request.' }); }
  }
  if (!body || typeof body !== 'object') return res.status(400).json({ error: 'Malformed request.' });

  const token = body.turnstileToken;
  if (!token) return res.status(400).json({ error: 'Please complete the spam check and try again.' });

  // Cloudflare wants form encoding here, not JSON.
  let verdict;
  try {
    const form = new URLSearchParams({ secret, response: String(token) });
    // The connecting IP strengthens the check. Vercel sets x-forwarded-for;
    // it is optional to Cloudflare, so a missing header is not fatal.
    const ip = (req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for'] || '')
      .toString().split(',')[0].trim();
    if (ip) form.set('remoteip', ip);

    const r = await fetch(VERIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
    });
    verdict = await r.json();
  } catch (err) {
    // Cloudflare unreachable. Refuse rather than wave it through — a
    // network blip is not a reason to drop the only control that
    // distinguishes a person from a script.
    console.error('submit-swim: turnstile verify failed:', err && err.message);
    return res.status(502).json({ error: 'Could not complete the spam check. Please try again in a moment.' });
  }

  if (!verdict || verdict.success !== true) {
    console.warn('submit-swim: turnstile rejected:', verdict && verdict['error-codes']);
    return res.status(403).json({ error: 'That spam check did not pass. Please reload the page and try again.' });
  }

  // Verified. Call the RPC with the service key. Every argument is passed
  // explicitly and the function validates all of them again server-side —
  // this route adds a spam gate, it does not become a second place where
  // submission rules live.
  const args = {
    p_event_name:       str(body.event_name),
    p_start_date:       str(body.start_date),
    p_location_text:    str(body.location_text),
    p_official_url:     str(body.official_url),
    p_organiser_name:   str(body.organiser_name),
    p_contact_email:    str(body.contact_email),
    p_end_date:         str(body.end_date),
    p_country_code:     str(body.country_code),
    p_registration_url: str(body.registration_url),
    p_distances_text:   str(body.distances_text),
    p_notes:            str(body.notes),
  };

  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/submit_organiser_event`, {
      method: 'POST',
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(args),
    });
    const data = await r.json();
    if (!r.ok) {
      // The RPC raises messages written for the organiser ("That date has
      // already passed"), so pass them through rather than replacing them
      // with something generic.
      const msg = (data && (data.message || data.hint)) || 'Could not save that submission.';
      return res.status(400).json({ error: String(msg).replace(/^[A-Z0-9]+:\s*/, '') });
    }
    return res.status(200).json({ id: data });
  } catch (err) {
    console.error('submit-swim: rpc failed:', err && err.message);
    return res.status(502).json({ error: 'Could not save that submission. Please try again shortly.' });
  }
}

const str = (v) => {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
};
