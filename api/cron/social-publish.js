// Hourly publish job for the Social Content Engine (see api/_lib/social/publisher.js for the rules).
// SHIPS DORMANT: social_settings.paused defaults to true, so every run returns {status:'paused'} until Dave turns
// it off. Without Meta credentials, or with ?dry=1, it only reports what it would do and changes nothing.
import { requireCronAuth } from './_auth.js';
import { createStore, publicUrl } from '../_lib/social/store.js';
import { metaFromEnv } from '../_lib/social/meta.js';
import { runPublisher } from '../_lib/social/publisher.js';
import { makeRecheck } from '../_lib/social/recheck.js';
import { verifyPage, PublishError } from '../_lib/social/facebook.js';

async function notifyDave(subject, text) {
  if (!process.env.RESEND_API_KEY) return;
  try {
    const { Resend } = await import('resend');
    await new Resend(process.env.RESEND_API_KEY).emails.send({ from: 'SwimLoading <no-reply@swimloading.com>', to: 'dave.welensky@gmail.com', subject: `[Social] ${subject}`, text });
  } catch (e) { console.error('social-publish: notify failed', e.message); }
}

export default async function handler(req, res) {
  if (!requireCronAuth(req, res, 'social-publish')) return;
  if (!process.env.SUPABASE_SERVICE_KEY) return res.status(503).json({ error: 'SUPABASE_SERVICE_KEY not set' });
  try {
    const store = createStore();
    // Facebook only until Instagram is connected: SOCIAL_PLATFORMS=fb (default). Set "fb,ig" later.
    const platforms = (process.env.SOCIAL_PLATFORMS || 'fb').split(',').map((x) => x.trim()).filter(Boolean);
    const { configured, client } = metaFromEnv({}, platforms);
    // Second lock: even with the DB switch off (paused=false), nothing is posted unless SOCIAL_PUBLISH_ENABLED=true on Vercel.
    const live = process.env.SOCIAL_PUBLISH_ENABLED === 'true';
    const dry = req.query?.dry === '1' || !configured || !live;
    const meta = dry ? metaFromEnv({ dry: true }, platforms).client : client;
    const preflight = async () => {
      try { const v = await verifyPage({ pageId: process.env.META_PAGE_ID, token: process.env.META_PAGE_TOKEN }); return v.ok ? { ok: true } : { ok: false, message: `Token belongs to a different Page (${v.name}).` }; }
      catch (e) { return { ok: false, message: e instanceof PublishError && e.kind === 'token' ? e.message : `Could not verify the Facebook token: ${e.message}` }; }
    };
    // Time-sensitive posts (Explore events, measured temperatures) and partner posts are re-validated immediately before they go out.
    const recheck = makeRecheck(store.rest);
    const result = await runPublisher({ store, meta, recheck, notify: notifyDave, dry, publicUrl, platforms, preflight });
    return res.status(200).json({ ...result, metaConfigured: configured, platforms, live });
  } catch (e) {
    if (/PGRST205|42P01|HTTP 404/.test(e.message)) return res.status(200).json({ status: 'not-initialised', note: 'social_* tables not created yet' });
    console.error('social-publish failed', e.message);
    return res.status(500).json({ error: 'social-publish failed' });
  }
}
