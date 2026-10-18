// Publishing step: Meta request shapes, and every rule that stops a bad or duplicate post. No network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMeta } from '../api/_lib/social/meta.js';
import { runPublisher, isDue, eventIdsOf, PUBLISH_RULES } from '../api/_lib/social/publisher.js';

const NOW = new Date('2026-10-20T08:00:00Z');
const URL_ = (p) => `https://img.test/${p}`;
const mkStore = (posts, { paused = false, reserves = [] } = {}) => {
  const rows = new Map([...posts, ...reserves].map((p) => [p.id, { ...p }]));
  const calls = [];
  return { rows, calls,
    getSettings: async () => ({ paused }),
    listPublishable: async () => [...rows.values()].filter((p) => ['APPROVED', 'SCHEDULED'].includes(p.status) && p.scheduled_for),
    listReserves: async () => [...rows.values()].filter((p) => p.is_reserve && p.status === 'APPROVED' && p.risk === 'AUTO_ELIGIBLE'),
    update: async (id, patch) => { calls.push(['update', id, patch]); Object.assign(rows.get(id), patch); },
    claim: async (post, k) => { const r = rows.get(post.id); if (r.idempotency_key && r.idempotency_key !== k) return false; r.idempotency_key = k; return true; } };
};
const post = (o = {}) => ({ id: 'p1', source_key: 'spot:1', status: 'SCHEDULED', risk: 'AUTO_ELIGIBLE', scheduled_for: '2026-10-20T08:00:00Z', image_paths: ['d/a.jpg'], fb_caption: 'fb', ig_caption: 'ig', facts: [], is_reserve: false, ...o });
const okMeta = () => { const n = { fb: 0, ig: 0 }; return { n, publishFacebook: async () => ({ externalId: `fb${++n.fb}` }), publishInstagram: async () => ({ externalId: `ig${++n.ig}` }) }; };

test('paused (the shipped default) does nothing at all', async () => {
  const store = mkStore([post()], { paused: true }), meta = okMeta();
  const r = await runPublisher({ store, meta, now: NOW, publicUrl: URL_ });
  assert.equal(r.status, 'paused'); assert.equal(meta.n.fb + meta.n.ig, 0); assert.equal(store.calls.length, 0);
});
test('dry run reports and changes nothing', async () => {
  const store = mkStore([post()]), meta = okMeta();
  const r = await runPublisher({ store, meta, now: NOW, dry: true, publicUrl: URL_ });
  assert.equal(r.status, 'dry-run'); assert.equal(store.calls.length, 0);
});
test('publishes both platforms once, then never again', async () => {
  const store = mkStore([post()]), meta = okMeta();
  assert.equal((await runPublisher({ store, meta, now: NOW, publicUrl: URL_ })).status, 'published');
  assert.deepEqual([meta.n.fb, meta.n.ig], [1, 1]);
  assert.equal(store.rows.get('p1').status, 'PUBLISHED');
  assert.equal((await runPublisher({ store, meta, now: NOW, publicUrl: URL_ })).status, 'nothing-due');
  assert.deepEqual([meta.n.fb, meta.n.ig], [1, 1]);
});
test('a platform that succeeded is never re-posted when the other fails; only the failed one is retried, with backoff', async () => {
  const store = mkStore([post()]); let igOk = false; const n = { fb: 0, ig: 0 };
  const meta = { publishFacebook: async () => ({ externalId: `fb${++n.fb}` }), publishInstagram: async () => { n.ig++; if (!igOk) throw new Error('boom'); return { externalId: 'ig1' }; } };
  await runPublisher({ store, meta, now: NOW, publicUrl: URL_ });
  assert.equal(store.rows.get('p1').status, 'SCHEDULED');
  assert.equal(store.rows.get('p1').ig_result.attempts, 1);
  await runPublisher({ store, meta, now: new Date(NOW.getTime() + 5 * 60e3), publicUrl: URL_ });   // inside the 15 min backoff
  assert.equal(n.ig, 1, 'backoff respected');
  igOk = true;
  const r = await runPublisher({ store, meta, now: new Date(NOW.getTime() + 20 * 60e3), publicUrl: URL_ });
  assert.equal(r.status, 'published'); assert.equal(n.fb, 1, 'facebook never re-posted'); assert.equal(n.ig, 2);
});
test('after maxAttempts the post is FAILED, Dave is notified, and it is not retried further', async () => {
  const store = mkStore([post()]); const notes = []; let calls = 0;
  const meta = { publishFacebook: async () => ({ externalId: 'fb1' }), publishInstagram: async () => { calls++; throw new Error('nope'); } };
  let t = NOW.getTime();
  for (let i = 0; i < 6; i++) { await runPublisher({ store, meta, now: new Date(t), notify: async (s) => notes.push(s), publicUrl: URL_ }); t += 5 * 3600e3; }
  assert.equal(calls, PUBLISH_RULES.maxAttempts); assert.equal(store.rows.get('p1').status, 'FAILED'); assert.equal(notes.length, 1);
});
test('a slot missed by more than 12h is un-slotted and not posted late', async () => {
  const store = mkStore([post({ scheduled_for: '2026-10-19T08:00:00Z' })]), meta = okMeta();
  const r = await runPublisher({ store, meta, now: NOW, publicUrl: URL_ });
  assert.equal(r.status, 'nothing-due'); assert.equal(meta.n.fb, 0); assert.equal(store.rows.get('p1').scheduled_for, null);
});
test('one post per run, earliest first', async () => {
  const store = mkStore([post({ id: 'b', scheduled_for: '2026-10-20T07:30:00Z' }), post({ id: 'a', scheduled_for: '2026-10-20T07:00:00Z' })]), meta = okMeta();
  await runPublisher({ store, meta, now: NOW, publicUrl: URL_ });
  assert.equal(store.rows.get('a').status, 'PUBLISHED'); assert.equal(store.rows.get('b').status, 'SCHEDULED');
});
test('failed publish-time check swaps in an approved reserve for the same slot', async () => {
  const reserve = post({ id: 'r1', is_reserve: true, status: 'APPROVED', scheduled_for: null });
  const store = mkStore([post()], { reserves: [reserve] }), meta = okMeta(), notes = [];
  const r = await runPublisher({ store, meta, now: NOW, publicUrl: URL_, recheck: async (p) => p.id === 'p1' ? { ok: false, reason: 'event cancelled' } : { ok: true } });
  assert.equal(r.status, 'published');
  assert.equal(store.rows.get('p1').status, 'REJECTED'); assert.match(store.rows.get('p1').review_reasons[0], /event cancelled/);
  assert.equal(store.rows.get('r1').status, 'PUBLISHED'); assert.equal(store.rows.get('r1').is_reserve, false);
});
test('failed check with no reserve holds the post for review and publishes nothing', async () => {
  const store = mkStore([post()]), meta = okMeta(), notes = [];
  const r = await runPublisher({ store, meta, now: NOW, publicUrl: URL_, notify: async (s) => notes.push(s), recheck: async () => ({ ok: false, reason: 'stale' }) });
  assert.equal(r.status, 'held'); assert.equal(store.rows.get('p1').status, 'PENDING_REVIEW'); assert.equal(meta.n.fb + meta.n.ig, 0); assert.equal(notes.length, 1);
});
test('an expired post is never published', async () => {
  const store = mkStore([post({ expires_at: '2026-10-20T07:00:00Z' })]), meta = okMeta();
  assert.equal((await runPublisher({ store, meta, now: NOW, publicUrl: URL_ })).status, 'held');
  assert.equal(meta.n.fb, 0);
});
test('another run already owns the slot: skip', async () => {
  const store = mkStore([post({ idempotency_key: 'someone-else' })]), meta = okMeta();
  assert.equal((await runPublisher({ store, meta, now: NOW, publicUrl: URL_ })).status, 'claimed-elsewhere');
  assert.equal(meta.n.fb, 0);
});
test('event ids come from the facts; isDue classifies', () => {
  assert.deepEqual(eventIdsOf({ facts: [{ source: { table: 'event_editions', row: 'e1' } }, { source: { table: 'event_editions', row: 'e1' } }, { source: { table: 'spots', row: 's' } }] }), ['e1']);
  assert.equal(isDue(post(), NOW), 'due'); assert.equal(isDue(post({ scheduled_for: '2026-10-20T09:00:00Z' }), NOW), 'not-due');
  assert.equal(isDue(post({ status: 'PENDING_REVIEW' }), NOW), 'not-due');
});

test('Meta: request shapes for single/carousel on both platforms; token only in body and scrubbed from errors', async () => {
  const dry = createMeta({ pageId: 'PAGE', igUserId: 'IG', token: 'SECRET', dry: true });
  await dry.publishFacebook({ caption: 'c', imageUrls: ['u1'] });
  await dry.publishFacebook({ caption: 'c', imageUrls: ['u1', 'u2'] });
  await dry.publishInstagram({ caption: 'c', imageUrls: ['u1'] });
  await dry.publishInstagram({ caption: 'c', imageUrls: ['u1', 'u2'] });
  const paths = dry.planned.map((x) => x.path);
  assert.deepEqual(paths, ['PAGE/photos', 'PAGE/photos', 'PAGE/photos', 'PAGE/feed', 'IG/media', 'IG/media_publish', 'IG/media', 'IG/media', 'IG/media', 'IG/media_publish']);
  assert.equal(dry.planned[0].params.published, 'true'); assert.equal(dry.planned[1].params.published, 'false');
  assert.match(dry.planned[3].params['attached_media[1]'], /media_fbid/);
  assert.equal(dry.planned[8].params.media_type, 'CAROUSEL');
  assert.ok(!JSON.stringify(dry.planned).includes('SECRET'), 'dry plan never contains the token');
  const live = createMeta({ pageId: 'PAGE', igUserId: 'IG', token: 'SECRET', fetchImpl: async (u, init) => { assert.ok(!String(u).includes('SECRET')); return { ok: false, status: 400, json: async () => ({ error: { message: 'bad token SECRET', code: 190 } }) }; } });
  await assert.rejects(live.publishFacebook({ caption: 'c', imageUrls: ['u'] }), (e) => !e.message.includes('SECRET') && /190/.test(e.message));
  await assert.rejects(createMeta({ pageId: 'P', igUserId: 'I', token: 't', dry: true }).publishInstagram({ caption: 'c', imageUrls: Array(11).fill('u') }), /at most 10/);
});

test('store: an empty 201/204 body (Prefer: return=minimal) is not a JSON error', async () => {
  const { createStore } = await import('../api/_lib/social/store.js');
  const empty = createStore({ key: 'k', fetchImpl: async () => ({ ok: true, status: 201, text: async () => '' }) });
  assert.equal(await empty.update('id1', { status: 'APPROVED' }), null);
  const rows = createStore({ key: 'k', fetchImpl: async () => ({ ok: true, status: 200, text: async () => '[{"paused":true}]' }) });
  assert.equal((await rows.getSettings()).paused, true);
  await assert.rejects(createStore({ key: 'k', fetchImpl: async () => ({ ok: false, status: 401, text: async () => 'Invalid API key' }) }).getSettings(), /HTTP 401/);
});
