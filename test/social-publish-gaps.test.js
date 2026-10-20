// Gap-closing rules added on top of the publishing step: Facebook-only mode, token pre-check, and the
// "nothing scheduled" / "reserve low" alerts (each at most once a day). No network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runPublisher } from '../api/_lib/social/publisher.js';
import { metaFromEnv } from '../api/_lib/social/meta.js';
import { createStore } from '../api/_lib/social/store.js';
import { recentSlots } from '../api/_lib/social/config.js';

const SLOT = '2026-10-20T08:00:00.000Z';
const NOW = new Date('2026-10-20T08:30:00Z');
const URL_ = (p) => `https://img.test/${p}`;
const post = (o = {}) => ({ id: 'p1', source_key: 'spot:1', status: 'SCHEDULED', risk: 'AUTO_ELIGIBLE', scheduled_for: SLOT, image_paths: ['d/a.jpg'], fb_caption: 'fb', ig_caption: 'ig', ...o });
function mk(posts = [], { reserves = 6, published = null, settings = {} } = {}) {
  const rows = new Map(posts.map((p) => [p.id, { ...p }]));
  const alerts = new Set();
  return { rows, alerts,
    getSettings: async () => ({ paused: false, reserve_min: 6, ...settings }),
    listPublishable: async () => [...rows.values()].filter((p) => ['APPROVED', 'SCHEDULED'].includes(p.status) && p.scheduled_for),
    listReserves: async () => Array.from({ length: reserves }, (_, i) => ({ id: `r${i}` })),
    update: async (id, patch) => Object.assign(rows.get(id), patch),
    claim: async () => true,
    alertOnce: async (k) => { if (alerts.has(k)) return false; alerts.add(k); return true; },
    publishedForSlot: async () => published };
}
const mkMeta = () => { const n = { fb: 0, ig: 0 }; return { n, publishFacebook: async () => ({ externalId: `fb${++n.fb}` }), publishInstagram: async () => { n.ig++; throw new Error('Instagram must not be called'); } }; };
const notifier = () => { const sent = []; return { sent, notify: async (s, t) => { sent.push({ s, t }); } }; };

test('FACEBOOK ONLY: Instagram is never called and the post completes as PUBLISHED', async () => {
  const store = mk([post()]), meta = mkMeta(), { notify, sent } = notifier();
  const r = await runPublisher({ store, meta, notify, now: NOW, publicUrl: URL_, platforms: ['fb'] });
  assert.equal(r.status, 'published'); assert.equal(meta.n.fb, 1); assert.equal(meta.n.ig, 0);
  assert.equal(store.rows.get('p1').status, 'PUBLISHED'); assert.equal(store.rows.get('p1').ig_result, undefined);
  assert.equal(sent.length, 0);
});
test('with both platforms enabled (the old default) an Instagram failure still keeps the post open', async () => {
  const store = mk([post()]), meta = mkMeta();
  const r = await runPublisher({ store, meta, now: NOW, publicUrl: URL_, platforms: ['fb', 'ig'] });
  assert.equal(r.status, 'scheduled'); assert.equal(meta.n.ig, 1);
});
test('metaFromEnv: Facebook-only is configured without an Instagram id; both-platform mode still needs it', () => {
  const keep = { ...process.env };
  process.env.META_PAGE_ID = 'P'; process.env.META_PAGE_TOKEN = 'T'; delete process.env.META_IG_USER_ID;
  try {
    assert.equal(metaFromEnv({}, ['fb']).configured, true);
    assert.equal(metaFromEnv({}, ['fb', 'ig']).configured, false);
    process.env.META_IG_USER_ID = 'I'; assert.equal(metaFromEnv({}, ['fb', 'ig']).configured, true);
  } finally { process.env = keep; }
});

test('TOKEN PRE-CHECK: a bad token alerts once per day, publishes nothing, and does not burn the post', async () => {
  const store = mk([post()]), meta = mkMeta(), { notify, sent } = notifier();
  const preflight = async () => ({ ok: false, message: 'Page token is invalid or expired' });
  const a = await runPublisher({ store, meta, notify, now: NOW, publicUrl: URL_, platforms: ['fb'], preflight });
  const b = await runPublisher({ store, meta, notify, now: new Date('2026-10-20T09:30:00Z'), publicUrl: URL_, platforms: ['fb'], preflight });
  assert.equal(a.status, 'token-problem'); assert.equal(b.status, 'token-problem');
  assert.equal(meta.n.fb, 0); assert.equal(store.rows.get('p1').status, 'SCHEDULED');
  assert.equal(sent.filter((m) => /token/i.test(m.s)).length, 1, 'one email, not one per hourly run');
});
test('a healthy token does not block publishing; a dry run never runs the pre-check', async () => {
  const store = mk([post()]), meta = mkMeta();
  assert.equal((await runPublisher({ store, meta, now: NOW, publicUrl: URL_, platforms: ['fb'], preflight: async () => ({ ok: true }) })).status, 'published');
  let called = 0;
  await runPublisher({ store: mk([post()]), meta: mkMeta(), now: NOW, dry: true, publicUrl: URL_, platforms: ['fb'], preflight: async () => { called++; return { ok: false, message: 'x' }; } });
  assert.equal(called, 0);
});

test('NO CONTENT FOR A SLOT: alert once when a slot started with nothing scheduled; none if it was already published or is not near a slot', async () => {
  const { notify, sent } = notifier();
  const empty = mk([]);
  const r = await runPublisher({ store: empty, meta: mkMeta(), notify, now: NOW, publicUrl: URL_, platforms: ['fb'] });
  await runPublisher({ store: empty, meta: mkMeta(), notify, now: new Date('2026-10-20T09:00:00Z'), publicUrl: URL_, platforms: ['fb'] });
  assert.equal(r.status, 'nothing-due');
  assert.equal(sent.filter((m) => /Nothing was scheduled/.test(m.s)).length, 1);
  const n2 = notifier();
  await runPublisher({ store: mk([], { published: { id: 'x' } }), meta: mkMeta(), notify: n2.notify, now: NOW, publicUrl: URL_, platforms: ['fb'] });
  await runPublisher({ store: mk([]), meta: mkMeta(), notify: n2.notify, now: new Date('2026-10-21T08:30:00Z'), publicUrl: URL_, platforms: ['fb'] });   // Wednesday
  await runPublisher({ store: mk([]), meta: mkMeta(), notify: n2.notify, now: new Date('2026-10-20T11:30:00Z'), publicUrl: URL_, platforms: ['fb'] });   // 3.5h after the slot
  assert.equal(n2.sent.filter((m) => /Nothing was scheduled/.test(m.s)).length, 0);
});
test('reserve queue low: one alert per day; none when healthy', async () => {
  const { notify, sent } = notifier();
  const low = mk([post()], { reserves: 2 });
  await runPublisher({ store: low, meta: mkMeta(), notify, now: NOW, publicUrl: URL_, platforms: ['fb'] });
  await runPublisher({ store: low, meta: mkMeta(), notify, now: new Date('2026-10-20T09:30:00Z'), publicUrl: URL_, platforms: ['fb'] });
  assert.equal(sent.filter((m) => /reserve queue is low/.test(m.s)).length, 1);
  const ok = notifier();
  await runPublisher({ store: mk([post()], { reserves: 6 }), meta: mkMeta(), notify: ok.notify, now: NOW, publicUrl: URL_, platforms: ['fb'] });
  assert.equal(ok.sent.length, 0);
});
test('alerts are not sent during a dry run, and a paused run does nothing at all', async () => {
  const { notify, sent } = notifier();
  await runPublisher({ store: mk([], { reserves: 0 }), meta: mkMeta(), notify, now: NOW, dry: true, publicUrl: URL_, platforms: ['fb'] });
  const paused = await runPublisher({ store: mk([post()], { settings: { paused: true } }), meta: mkMeta(), notify, now: NOW, publicUrl: URL_, platforms: ['fb'] });
  assert.equal(sent.length, 0); assert.equal(paused.status, 'paused');
});

test('store.alertOnce: first caller wins, a 409 means already alerted, other errors surface', async () => {
  const mkStoreHttp = (status) => createStore({ key: 'k', fetchImpl: async () => ({ ok: status < 400, status, text: async () => '' }) });
  assert.equal(await mkStoreHttp(201).alertOnce('x'), true);
  assert.equal(await mkStoreHttp(409).alertOnce('x'), false);
  await assert.rejects(mkStoreHttp(500).alertOnce('x'), /HTTP 500/);
});
test('cadence: Tue, Thu and Sat 10:00 SAST are the only slots', () => {
  const found = [];
  for (let d = 0; d < 7; d++) for (const h of [7, 8, 9]) { const s = recentSlots(new Date(Date.UTC(2026, 9, 19 + d, h, 5)), 1); if (s.length) found.push(...s); }
  assert.deepEqual(found, ['2026-10-20T08:00:00.000Z', '2026-10-22T08:00:00.000Z', '2026-10-24T08:00:00.000Z']);
});

test('NO DUPLICATES AFTER A CRASH: an in-flight marker makes the next run look for the post on the Page first', async () => {
  const meta = { ...mkMeta(), findFacebookPost: async () => ({ id: 'P_landed' }) };
  const store = mk([post({ fb_result: { inflight: true, lastAttemptAt: '2026-10-20T07:00:00Z' } })]);
  const r = await runPublisher({ store, meta, now: NOW, publicUrl: URL_, platforms: ['fb'] });
  assert.equal(meta.n.fb, 0, 'must not post a second time');
  assert.equal(store.rows.get('p1').fb_result.externalId, 'P_landed'); assert.equal(store.rows.get('p1').status, 'PUBLISHED'); assert.equal(r.status, 'published');
});
test('in-flight marker with no matching post on the Page: it posts normally', async () => {
  const meta = { ...mkMeta(), findFacebookPost: async () => null };
  const store = mk([post({ fb_result: { inflight: true } })]);
  await runPublisher({ store, meta, now: NOW, publicUrl: URL_, platforms: ['fb'] });
  assert.equal(meta.n.fb, 1);
});
test('the in-flight marker is written BEFORE the Facebook call, and cleared by success', async () => {
  const store = mk([post()]); let seenDuring;
  const meta = { publishFacebook: async () => { seenDuring = store.rows.get('p1').fb_result; return { externalId: 'fb1' }; }, findFacebookPost: async () => null };
  await runPublisher({ store, meta, now: NOW, publicUrl: URL_, platforms: ['fb'] });
  assert.equal(seenDuring?.inflight, true);
  assert.equal(store.rows.get('p1').fb_result.inflight, undefined); assert.equal(store.rows.get('p1').fb_result.externalId, 'fb1');
});
test('the first ever attempt does not look for an existing post (no needless Graph call)', async () => {
  let looked = 0;
  const meta = { ...mkMeta(), findFacebookPost: async () => { looked++; return null; } };
  await runPublisher({ store: mk([post()]), meta, now: NOW, publicUrl: URL_, platforms: ['fb'] });
  assert.equal(looked, 0);
});
