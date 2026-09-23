// GET /api/backfill-emails?segment=recent|cldsa[&send=1][&limit=N]
//
// One-off backfill for people who never received a welcome email, because
// RESEND_API_KEY was absent from Vercel from the day the feature shipped
// (29 Jul 2026) until 23 Sep 2026. At that point welcome_email_sent_at was
// NULL for all 743 profiles: it had literally never sent.
//
// Two audiences, deliberately different copy:
//
//   segment=recent  People who onboarded in the last 30 days and have been
//                   using the app. Owns the gap, then asks how they are
//                   finding it. ~23 people.
//   segment=cldsa   People who created an account purely to play the CLDSA
//                   Awards Challenge quiz at the 2026 AGM. Most never
//                   onboarded, so they get an actual introduction rather
//                   than a "welcome back". ~77 people.
//
// Anyone in both is treated as cldsa, since the quiz context is more specific.
//
// SAFETY
//   - Dry run by default. Without send=1 it reports who WOULD receive what and
//     sends nothing.
//   - welcome_email_sent_at is stamped per person immediately after their send
//     succeeds, so a re-run can never double-email anyone.
//   - Sends are paced. swimloading.com has sent almost nothing historically and
//     a 100-message burst from a cold domain is how you land in spam.
//   - Guarded by CRON_SECRET, same as the cron handlers.
//
// Auth: Authorization: Bearer <CRON_SECRET>

import { Resend } from 'resend';
import { requireCronAuth } from './cron/_auth.js';
import { buildBackfillHtml, buildBackfillText } from './_lib/welcome-backfill-template.js';
import { buildCldsaIntroHtml, buildCldsaIntroText } from './_lib/cldsa-intro-template.js';

const SUPABASE_URL   = process.env.SUPABASE_URL || 'https://szgkzuswelntnevobnoh.supabase.co';
const SERVICE_KEY    = process.env.SUPABASE_SERVICE_KEY;
const RESEND_API_KEY = process.env.RESEND_API_KEY;

const FROM_ADDRESS = 'SwimLoading <support@swimloading.com>';
const REPLY_TO     = 'dave@apploading.co';
const GAP_MS       = 1200;   // pace, protects sender reputation

// Timing: 77 recipients x (1.2s gap + ~0.3s send) is roughly 2 minutes, which
// fits inside Vercel's 300s function limit with room to spare. If a segment
// ever grows past ~150 people, run it in batches with &limit=N rather than
// reaching for a durable workflow: welcome_email_sent_at is stamped per person
// as each send succeeds, so re-running simply picks up where it stopped.

const SEGMENTS = {
  recent: {
    subject: 'How are you finding SwimLoading?',
    html: buildBackfillHtml,
    text: buildBackfillText,
  },
  cldsa: {
    subject: 'You played our quiz at the CLDSA awards',
    html: buildCldsaIntroHtml,
    text: buildCldsaIntroText,
  },
};

async function db(path) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
  });
  if (!res.ok) throw new Error(`db ${res.status} ${await res.text()}`);
  return res.json();
}

async function stampSent(id) {
  return fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${id}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      Prefer: 'return=minimal',
    },
    body: JSON.stringify({ welcome_email_sent_at: new Date().toISOString() }),
  });
}

const firstNameOf = (p) =>
  (p.full_name || p.display_name || '').trim().split(/\s+/)[0] || null;

async function recipientsFor(segment) {
  // Everyone who played the quiz, whatever their onboarding state.
  const players = await db('live_quiz_participants?select=user_id');
  const quizIds = new Set(players.map((p) => p.user_id).filter(Boolean));

  const cols = 'id,email,full_name,display_name,created_at,onboarding_completed_at,welcome_email_sent_at';

  if (segment === 'cldsa') {
    if (!quizIds.size) return [];
    const ids = [...quizIds].join(',');
    const rows = await db(`profiles?id=in.(${ids})&welcome_email_sent_at=is.null&select=${cols}`);
    return rows.filter((r) => r.email);
  }

  // recent: onboarded in the last 30 days, never emailed, and NOT a quiz player
  // (those get the cldsa copy instead, so nobody receives both).
  const since = new Date(Date.now() - 30 * 864e5).toISOString();
  const rows = await db(
    `profiles?onboarding_completed_at=not.is.null&welcome_email_sent_at=is.null` +
    `&created_at=gt.${since}&select=${cols}`
  );
  return rows.filter((r) => r.email && !quizIds.has(r.id));
}

export default async function handler(req, res) {
  if (!requireCronAuth(req, res, 'backfill-emails')) return;
  if (!SERVICE_KEY) return res.status(500).json({ error: 'SUPABASE_SERVICE_KEY not configured' });

  const segment = String(req.query.segment || '');
  const cfg = SEGMENTS[segment];
  if (!cfg) return res.status(400).json({ error: 'segment must be recent or cldsa' });

  const live  = req.query.send === '1';
  const limit = Math.min(parseInt(req.query.limit, 10) || 500, 500);

  let people;
  try {
    people = (await recipientsFor(segment)).slice(0, limit);
  } catch (e) {
    console.error('[backfill] lookup failed', e);
    return res.status(500).json({ error: 'lookup_failed', detail: String(e.message || e) });
  }

  if (!live) {
    return res.status(200).json({
      dryRun: true,
      segment,
      subject: cfg.subject,
      from: FROM_ADDRESS,
      replyTo: REPLY_TO,
      wouldSend: people.length,
      recipients: people.map((p) => ({ email: p.email, firstName: firstNameOf(p) })),
    });
  }

  if (!RESEND_API_KEY) return res.status(500).json({ error: 'RESEND_API_KEY not configured' });
  const resend = new Resend(RESEND_API_KEY);

  const sent = [], failed = [];
  for (const p of people) {
    const first = firstNameOf(p);
    try {
      const { error } = await resend.emails.send({
        from: FROM_ADDRESS,
        to: [p.email],
        replyTo: REPLY_TO,
        subject: cfg.subject,
        html: cfg.html(first),
        text: cfg.text(first),
      }, { idempotencyKey: `backfill/${segment}/${p.id}` });

      if (error) {
        failed.push({ email: p.email, error: `${error.name || 'error'}: ${error.message || ''}`.slice(0, 160) });
      } else {
        // Stamp immediately, so an interrupted run never re-sends to this person.
        await stampSent(p.id);
        sent.push(p.email);
      }
    } catch (e) {
      failed.push({ email: p.email, error: String(e.message || e).slice(0, 160) });
    }
    if (GAP_MS) await new Promise((r) => setTimeout(r, GAP_MS));
  }

  console.log(`[backfill] ${segment}: sent ${sent.length}, failed ${failed.length}`);
  return res.status(200).json({ dryRun: false, segment, sent: sent.length, failed: failed.length, failures: failed });
}
