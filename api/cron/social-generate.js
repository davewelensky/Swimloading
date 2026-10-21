// Daily autopilot job for the Social Content Engine (see api/_lib/social/autopilot.js and docs/social-engine/AUTOPILOT.md).
// Refills the next 2 weeks of Tue/Thu/Sat slots from real data. Runs daily (not weekly) because measured-conditions posts are
// only built when their slot is within 30 h; every other run is idempotent (dedupe + occupied slots).
// SHIPS DORMANT: not listed in vercel.json crons, and without SOCIAL_AUTOPILOT_ENABLED=true (or with ?dry=1) it only returns the plan.
// It never turns publishing on: social_settings.paused and SOCIAL_PUBLISH_ENABLED still gate posting.
import { requireCronAuth } from './_auth.js';
import { createStore } from '../_lib/social/store.js';
import { runWeekly, formatPlan } from '../_lib/social/autopilot-run.js';

async function notifyDave(subject, text) {
  if (!process.env.RESEND_API_KEY) return;
  try {
    const { Resend } = await import('resend');
    await new Resend(process.env.RESEND_API_KEY).emails.send({ from: 'SwimLoading <no-reply@swimloading.com>', to: 'dave.welensky@gmail.com', subject: `[Social] ${subject}`, text });
  } catch (e) { console.error('social-generate: notify failed', e.message); }
}

export default async function handler(req, res) {
  if (!requireCronAuth(req, res, 'social-generate')) return;
  if (!process.env.SUPABASE_SERVICE_KEY) return res.status(503).json({ error: 'SUPABASE_SERVICE_KEY not set' });
  try {
    const store = createStore();
    const dry = req.query?.dry === '1' || process.env.SOCIAL_AUTOPILOT_ENABLED !== 'true';
    const r = await runWeekly({ store, dry });
    const empty = r.plan.filter((p) => p.action === 'left-empty');
    if (!dry && (r.reserves.shortfall || empty.length)) {
      await notifyDave(r.reserves.shortfall ? 'Reserve queue could not be refilled' : 'A slot was left empty', formatPlan(r));
    }
    return res.status(200).json({ dry, scheduled: r.plan.filter((p) => p.action === 'schedule').length, held: r.plan.filter((p) => p.action === 'held-for-conditions').length,
      review: r.plan.filter((p) => p.action === 'pending-review').length, empty: empty.length, reserves: r.reserves, notes: r.notes, plan: r.plan });
  } catch (e) {
    if (/PGRST205|42P01|HTTP 404/.test(e.message)) return res.status(200).json({ status: 'not-initialised', note: 'social_* tables not created yet' });
    console.error('social-generate failed', e.message);
    await notifyDave('Autopilot run failed', e.message);
    return res.status(500).json({ error: 'social-generate failed' });
  }
}
