// Hourly publish job for the Social Content Engine (see api/_lib/social/publisher.js for the rules).
// SHIPS DORMANT: social_settings.paused defaults to true, so every run returns {status:'paused'} until Dave turns
// it off. Without Meta credentials, or with ?dry=1, it only reports what it would do and changes nothing.
import { requireCronAuth } from './_auth.js';
import { createStore, publicUrl } from '../_lib/social/store.js';
import { metaFromEnv } from '../_lib/social/meta.js';
import { runPublisher, eventIdsOf } from '../_lib/social/publisher.js';
import { revalidateEvents } from '../_lib/social/validate.js';

const FRESH = 'id,title,discipline,status,date_confirmed,start_date,verification_tier,official_url,event_venues(display_name,city,country_code)';

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
    const { configured, client } = metaFromEnv();
    const dry = req.query?.dry === '1' || !configured;
    const meta = dry ? metaFromEnv({ dry: true }).client : client;
    // Event posts must be re-validated against live data immediately before they go out.
    const recheck = async (post) => {
      const ids = eventIdsOf(post);
      if (!ids.length) return { ok: true };
      const fresh = await store.rest(`event_editions?select=${FRESH}&id=in.(${ids.join(',')})`);
      const changes = await store.rest(`event_change_log?select=edition_id,change_type&edition_id=in.(${ids.join(',')})&change_type=in.(date_changed,venue_changed,cancelled,postponed)&changed_at=gt.${encodeURIComponent(post.created_at)}`);
      const v = revalidateEvents({ events: ids.map((id) => ({ id, title: id })) }, fresh, changes);
      return v.ok ? { ok: true } : { ok: false, reason: `event check: ${JSON.stringify(v.dropped)}` };
    };
    const result = await runPublisher({ store, meta, recheck, notify: notifyDave, dry, publicUrl });
    return res.status(200).json({ ...result, metaConfigured: configured });
  } catch (e) {
    if (/PGRST205|42P01|HTTP 404/.test(e.message)) return res.status(200).json({ status: 'not-initialised', note: 'social_* tables not created yet' });
    console.error('social-publish failed', e.message);
    return res.status(500).json({ error: 'social-publish failed' });
  }
}
