// Facebook publisher: safety properties, against a mocked Graph API (no network, nothing is ever posted).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { publishToFacebook, verifyPage, PublishError, publishingEnabled } from '../api/_lib/social/facebook.js';

const IMG = (n = 'a.jpg') => ({ name: n, bytes: Buffer.from('x'), mime: 'image/jpeg' });
const ledger = () => { const m = {}; return { get: (k) => m[k], set: (k, v) => { m[k] = v; }, m }; };
const ON = { SOCIAL_PUBLISH_ENABLED: 'true' };
const base = (o) => ({ key: 'fb:1', caption: 'Hello SwimLoading caption that is long enough to match', images: [IMG()], pageId: 'P1', token: 'SECRET_TOKEN', env: ON, backoffMs: 1, ...o });
const reply = (status, body) => ({ ok: status < 400, status, json: async () => body });

test('paused by default: nothing is sent unless SOCIAL_PUBLISH_ENABLED=true', async () => {
  let calls = 0;
  await assert.rejects(publishToFacebook(base({ env: {}, fetchImpl: async () => { calls++; return reply(200, {}); } })), (e) => e.kind === 'paused');
  assert.equal(calls, 0);
  assert.equal(publishingEnabled({}), false);
  assert.equal(publishingEnabled({ SOCIAL_PUBLISH_ENABLED: 'yes' }), false);
});
test('dry run sends nothing and reports what would happen, even when enabled', async () => {
  let calls = 0;
  const r = await publishToFacebook(base({ dryRun: true, fetchImpl: async () => { calls++; } }));
  assert.equal(r.status, 'DRY_RUN'); assert.equal(calls, 0); assert.equal(r.request.endpoint, '/P1/photos');
});
test('single image: one multipart upload to /photos with caption; token in header, not URL', async () => {
  const seen = [];
  const r = await publishToFacebook(base({ fetchImpl: async (url, init) => { seen.push({ url, init }); return reply(200, { id: 'ph1', post_id: 'P1_99' }); } }));
  assert.equal(r.facebookId, 'P1_99');
  assert.equal(seen.length, 1);
  assert.match(seen[0].url, /graph\.facebook\.com\/v\d+\.\d+\/P1\/photos$/);
  assert.ok(!seen[0].url.includes('SECRET_TOKEN'));
  assert.equal(seen[0].init.headers.Authorization, 'Bearer SECRET_TOKEN');
  assert.equal(seen[0].init.body.get('published'), 'true');
  assert.match(seen[0].init.body.get('caption'), /^Hello/);
});
test('carousel: unpublished uploads first, then ONE feed post attaching them all', async () => {
  const seen = []; let n = 0;
  const r = await publishToFacebook(base({ images: [IMG('1'), IMG('2'), IMG('3')], fetchImpl: async (url, init) => {
    seen.push({ url, body: init.body });
    return url.endsWith('/feed') ? reply(200, { id: 'P1_feed' }) : reply(200, { id: 'ph' + ++n });
  } }));
  assert.equal(r.facebookId, 'P1_feed');
  assert.equal(seen.length, 4);
  assert.ok(seen.slice(0, 3).every((s) => s.body.get('published') === 'false' && !s.body.has('caption')));
  const feed = seen[3].body;
  assert.equal(feed.get('message').startsWith('Hello'), true);
  assert.deepEqual([0, 1, 2].map((i) => JSON.parse(feed.get(`attached_media[${i}]`)).media_fbid), ['ph1', 'ph2', 'ph3']);
});
test('IDEMPOTENT: the same key never posts twice', async () => {
  const l = ledger(); let calls = 0;
  const f = async () => { calls++; return reply(200, { id: 'x', post_id: 'P1_1' }); };
  const a = await publishToFacebook(base({ ledger: l, fetchImpl: f }));
  const b = await publishToFacebook(base({ ledger: l, fetchImpl: f }));
  assert.equal(a.status, 'PUBLISHED'); assert.equal(b.status, 'ALREADY_PUBLISHED'); assert.equal(calls, 1);
});
test('transient errors (5xx, rate limit) are retried and then succeed', async () => {
  let calls = 0;
  const r = await publishToFacebook(base({ fetchImpl: async () => { calls++; return calls < 3 ? reply(500, { error: { message: 'oops', code: 2 } }) : reply(200, { id: 'a', post_id: 'ok' }); } }));
  assert.equal(r.facebookId, 'ok'); assert.equal(calls, 3);
});
test('retries stop after 3 attempts', async () => {
  let calls = 0;
  await assert.rejects(publishToFacebook(base({ fetchImpl: async () => { calls++; return reply(503, { error: { code: 1, message: 'x' } }); } })), (e) => e.kind === 'transient');
  assert.equal(calls, 3);
});
test('expired token (190) is never retried and says how to fix it', async () => {
  let calls = 0;
  await assert.rejects(publishToFacebook(base({ fetchImpl: async () => { calls++; return reply(400, { error: { code: 190, message: 'expired' } }); } })), (e) => e.kind === 'token' && /new one/.test(e.message));
  assert.equal(calls, 1);
});
test('permanent errors (bad permission) are not retried', async () => {
  let calls = 0;
  await assert.rejects(publishToFacebook(base({ fetchImpl: async () => { calls++; return reply(403, { error: { code: 200, message: 'no permission' } }); } })), (e) => e.kind === 'permanent');
  assert.equal(calls, 1);
});
test('ambiguous network failure: checks the Page feed and does NOT re-post if the post landed', async () => {
  const seen = [];
  const r = await publishToFacebook(base({ ledger: ledger(), fetchImpl: async (url, init) => {
    seen.push(url);
    if (url.endsWith('/photos')) throw new Error('socket hang up');
    return reply(200, { data: [{ id: 'P1_landed', message: 'Hello SwimLoading caption that is long enough to match' }] });
  } }));
  assert.equal(r.facebookId, 'P1_landed');
  assert.equal(seen.filter((u) => u.endsWith('/photos')).length, 1, 'photo upload attempted exactly once');
});
test('ambiguous failure with no matching post surfaces the error (no blind retry)', async () => {
  await assert.rejects(publishToFacebook(base({ fetchImpl: async (url) => { if (url.endsWith('/photos')) throw new Error('timeout'); return reply(200, { data: [] }); } })), (e) => e.kind === 'ambiguous');
});
test('missing credentials and missing inputs are refused before any request', async () => {
  await assert.rejects(publishToFacebook(base({ token: '', fetchImpl: async () => { throw new Error('no call'); } })), (e) => e.kind === 'config');
  await assert.rejects(publishToFacebook(base({ images: [] })), (e) => e instanceof PublishError && e.kind === 'invalid');
});
test('verifyPage compares the token\'s Page with the expected id', async () => {
  const f = async () => reply(200, { id: 'P1', name: 'SwimLoading' });
  assert.equal((await verifyPage({ pageId: 'P1', token: 't', fetchImpl: f })).ok, true);
  assert.equal((await verifyPage({ pageId: 'OTHER', token: 't', fetchImpl: f })).ok, false);
});
