// Publish step. Pure orchestration over injected `store`, `meta`, `recheck` and `notify`, so the rules that
// protect the brand (pause switch, re-validation, idempotency, per-platform retry, reserve swap) are unit-tested.
//
// Rules, in order, for each run:
//  1. social_settings.paused (ships ON) -> do nothing.
//  2. At most ONE post per run, the earliest APPROVED/SCHEDULED post whose slot has arrived. A slot missed by more
//     than `lateHours` is not posted late; it is un-slotted and reported.
//  3. Re-validate immediately before posting (expiry, and event re-check for event posts). If it fails, swap in an
//     approved reserve post for the same slot; with no reserve the post goes back to PENDING_REVIEW and Dave is told.
//  4. Facebook and Instagram are separate attempts. A platform that already succeeded is never posted again;
//     only the failed one is retried, with backoff, up to `maxAttempts`, then FAILED + notification.
//  5. Dry run records and changes nothing.

import { recentSlots } from './config.js';

export const PUBLISH_RULES = { lateHours: 12, maxAttempts: 3, backoffMinutes: [15, 60, 240], slotAlertHours: 2 };
const PLATFORMS = [
  { key: 'fb', result: 'fb_result', caption: 'fb_caption', publish: (m, a) => m.publishFacebook(a) },
  { key: 'ig', result: 'ig_result', caption: 'ig_caption', publish: (m, a) => m.publishInstagram(a) },
];

/** Event editions a post depends on, read from its facts (facts[].source.table === 'event_editions'). */
export const eventIdsOf = (post) => [...new Set((post.facts || []).filter((f) => f.source?.table === 'event_editions' && f.source.row).map((f) => f.source.row))];

export function isDue(post, now, rules = PUBLISH_RULES) {
  if (!['APPROVED', 'SCHEDULED'].includes(post.status) || !post.scheduled_for) return 'not-due';
  const t = new Date(post.scheduled_for).getTime();
  if (t > now.getTime()) return 'not-due';
  return now.getTime() - t > rules.lateHours * 3600e3 ? 'missed' : 'due';
}

function retryWait(result, now, rules) {
  if (!result?.attempts || !result.lastAttemptAt) return 0;
  const waitMin = rules.backoffMinutes[Math.min(result.attempts, rules.backoffMinutes.length) - 1];
  return Math.max(0, new Date(result.lastAttemptAt).getTime() + waitMin * 60e3 - now.getTime());
}

export async function runPublisher({ store, meta, recheck = async () => ({ ok: true }), notify = async () => {}, now = new Date(), dry = false, rules = PUBLISH_RULES, publicUrl,
  platforms = ['fb', 'ig'], preflight = null }) {
  const log = { at: now.toISOString(), dry, actions: [] };
  const settings = await store.getSettings();
  if (!settings || settings.paused !== false) return { ...log, status: 'paused' };
  const active = PLATFORMS.filter((p) => platforms.includes(p.key));      // e.g. Facebook only until Instagram is connected
  const day = now.toISOString().slice(0, 10);
  // One email per problem per day (store.alertOnce is insert-if-absent). Never alerts during a dry run.
  const alertOnce = async (key, subject, text) => { if (dry) return; if (store.alertOnce && !(await store.alertOnce(`${key}:${day}`))) return; await notify(subject, text); };

  // 0. Token check before anything is attempted: an expired token is reported once, not as a failed post.
  if (preflight && !dry) {
    const t = await preflight();
    if (!t.ok) { await alertOnce('token', 'Facebook token problem', `${t.message} Publishing was skipped. Create a new Page token (docs/social-engine/FACEBOOK_SETUP.md).`); return { ...log, status: 'token-problem', reason: t.message }; }
  }
  // Reserve queue health (alerted at most once a day).
  const reserveCount = (await store.listReserves()).length;
  if (store.alertOnce && reserveCount < (settings.reserve_min ?? 6)) await alertOnce('reserve-low', 'Social reserve queue is low', `${reserveCount} validated reserve posts (minimum ${settings.reserve_min ?? 6}). Queue more evergreen posts.`);

  const posts = (await store.listPublishable()).sort((a, b) => String(a.scheduled_for).localeCompare(String(b.scheduled_for)));
  for (const p of posts) if (isDue(p, now, rules) === 'missed') {
    log.actions.push({ post: p.id, action: 'missed-slot', slot: p.scheduled_for });
    if (!dry) { await store.update(p.id, { status: 'APPROVED', scheduled_for: null }); await notify(`Social post missed its slot`, `Post ${p.source_key} missed ${p.scheduled_for} and was un-slotted, not posted late.`); }
  }
  let post = posts.find((p) => isDue(p, now, rules) === 'due');
  if (!post) {
    // A cadence slot started and nothing is scheduled for it (and nothing already went out): tell Dave once.
    const slot = recentSlots(now, rules.slotAlertHours, settings.cadence || undefined).at(-1);
    if (slot && store.alertOnce && store.publishedForSlot && !(await store.publishedForSlot(slot))) {
      log.actions.push({ action: 'no-content-for-slot', slot });
      await alertOnce(`nocontent:${slot}`, 'Nothing was scheduled for a posting slot', `No approved post was scheduled for ${slot}, and the reserve queue is not used for empty slots. Run: node scripts/social-queue.mjs schedule`);
    }
    return { ...log, status: 'nothing-due' };
  }

  // 3. Re-validate at publish time.
  const expired = post.expires_at && new Date(post.expires_at) <= now;
  const verdict = expired ? { ok: false, reason: 'expired' } : await recheck(post);
  if (!verdict.ok) {
    const reason = verdict.reason || 'recheck failed';
    const reserves = (await store.listReserves()).filter((r) => r.id !== post.id);
    let swap = null;
    for (const r of reserves) { const v = (r.expires_at && new Date(r.expires_at) <= now) ? { ok: false } : await recheck(r); if (v.ok) { swap = r; break; } }
    log.actions.push({ post: post.id, action: 'recheck-failed', reason, replacedBy: swap?.id || null });
    if (dry) return { ...log, status: 'dry-run' };
    if (!swap) {
      await store.update(post.id, { status: 'PENDING_REVIEW', review_reasons: [...(post.review_reasons || []), `publish-time check failed: ${reason}`] });
      await notify('Social post held back', `Post ${post.source_key} failed its publish-time check (${reason}) and no reserve post was available. Nothing was published.`);
      return { ...log, status: 'held' };
    }
    await store.update(post.id, { status: 'REJECTED', review_reasons: [...(post.review_reasons || []), `publish-time check failed: ${reason}`] });
    await store.update(swap.id, { is_reserve: false, status: 'SCHEDULED', scheduled_for: post.scheduled_for });
    post = { ...swap, is_reserve: false, status: 'SCHEDULED', scheduled_for: post.scheduled_for };
  }

  // 4. Claim the slot, then attempt each platform independently.
  const key = `${post.id}:${post.scheduled_for}`;
  if (!dry && !(await store.claim(post, key))) return { ...log, status: 'claimed-elsewhere' };
  const imageUrls = (post.image_paths || []).map(publicUrl);
  const patch = {}, outcome = {};
  for (const p of active) {
    const prev = post[p.result];
    if (prev?.externalId) { outcome[p.key] = 'already-published'; continue; }
    if ((prev?.attempts || 0) >= rules.maxAttempts) { outcome[p.key] = 'gave-up'; continue; }
    if (retryWait(prev, now, rules) > 0) { outcome[p.key] = 'backoff'; continue; }
    if (!post[p.caption] || !imageUrls.length) { patch[p.result] = { ...prev, attempts: rules.maxAttempts, error: 'missing caption or images', lastAttemptAt: now.toISOString() }; outcome[p.key] = 'invalid'; continue; }
    // A previous attempt may have landed even though we never recorded it (a crash, or a timeout after sending).
    // Before posting again, look for our caption on the Page: never create a duplicate.
    if (p.key === 'fb' && (prev?.inflight || (prev?.attempts || 0) > 0) && meta.findFacebookPost) {
      const hit = await meta.findFacebookPost({ caption: post[p.caption] });
      if (hit) { patch[p.result] = { externalId: hit.id, publishedAt: now.toISOString(), attempts: prev?.attempts || 1, recovered: true }; outcome[p.key] = 'recovered'; continue; }
    }
    if (!dry) await store.update(post.id, { [p.result]: { ...prev, inflight: true, lastAttemptAt: now.toISOString() } });   // marks "a call may be in flight"
    try {
      const r = await p.publish(meta, { caption: post[p.caption], imageUrls });
      patch[p.result] = { externalId: r.externalId, publishedAt: now.toISOString(), attempts: (prev?.attempts || 0) + 1 };
      outcome[p.key] = 'published';
    } catch (e) {
      patch[p.result] = { ...prev, error: String(e.message).slice(0, 300), attempts: (prev?.attempts || 0) + 1, lastAttemptAt: now.toISOString() };
      outcome[p.key] = 'failed';
    }
  }
  const merged = { ...post, ...patch };
  const done = active.every((p) => merged[p.result]?.externalId);
  const exhausted = active.some((p) => !merged[p.result]?.externalId && (merged[p.result]?.attempts || 0) >= rules.maxAttempts);
  patch.status = done ? 'PUBLISHED' : exhausted ? 'FAILED' : 'SCHEDULED';
  log.actions.push({ post: post.id, action: 'publish', outcome, status: patch.status });
  if (!dry) {
    await store.update(post.id, patch);
    if (patch.status === 'FAILED') await notify('Social post failed', `Post ${post.source_key}: ${JSON.stringify(outcome)}. Facebook/Instagram results are recorded on the row; the schedule continues with the next slot.`);
  }
  return { ...log, status: dry ? 'dry-run' : patch.status.toLowerCase() };
}
