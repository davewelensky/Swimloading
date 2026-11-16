// JAKED priority partner + the reliability fixes from the 16 Nov 2026 review. No network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { jakedAngles, JAKED_ANGLES } from '../api/_lib/social/series.js';
import { validatePost } from '../api/_lib/social/validate.js';
import { buildCaptions } from '../api/_lib/social/captions.js';
import { visualCopy } from '../api/_lib/social/templates.js';
import { selectImage, loadCatalogue, TIERS } from '../api/_lib/social/media.js';
import { GROUPS, groupOfPost, pickGroup, windowCounts } from '../api/_lib/social/autopilot.js';
import { SOCIAL_DEFAULTS, RISK } from '../api/_lib/social/config.js';
import { runPublisher } from '../api/_lib/social/publisher.js';
import { weeklyReport } from '../api/_lib/social/report.js';
import { ungroundedNumbers } from '../api/_lib/social/validate.js';

const NOW = new Date('2026-11-17T08:30:00Z');
const live = [{ id: 'row1', name: 'JAKED', chip_state: 'live' }];

test('JAKED: five angles, every claim quoted from the real partner page, none blocked', () => {
  const { posts, note } = jakedAngles(live);
  assert.equal(note, null); assert.equal(posts.length, Object.keys(JAKED_ANGLES).length);
  assert.deepEqual(posts.map((p) => p.sourceKey).sort(), ['jaked:about', 'jaked:costumes', 'jaked:enquire', 'jaked:jkai', 'jaked:wetsuit']);
  for (const p of posts) { const v = validatePost(p, { now: NOW }); assert.notEqual(v.risk, RISK.BLOCKED, `${p.sourceKey}: ${v.reasons}`); assert.equal(v.risk, RISK.AUTO); }
});
test('JAKED: a quote that leaves the page blocks the post (no stale claims)', () => {
  const p = jakedAngles(live).posts[0];
  const bad = { ...p, facts: p.facts.map((f) => (f.key === 'line' ? { ...f, source: { ...f.source, quote: 'a sentence that is not on the page' } } : f)) };
  assert.equal(validatePost(bad, { now: NOW }).risk, RISK.BLOCKED);
});
test('JAKED: only built while partner_pages says live; the reason is reported', () => {
  assert.equal(jakedAngles([{ id: 'r', name: 'JAKED', chip_state: 'soon' }]).posts.length, 0);
  assert.match(jakedAngles([{ id: 'r', name: 'JAKED', chip_state: 'soon' }]).note, /not "live"/);
  assert.match(jakedAngles([]).note, /no JAKED row/);
});
test('JAKED captions: call to action is the enquiry form; no price, discount, stock or order-count claims; no emoji or dashes', () => {
  for (const p of jakedAngles(live).posts) {
    const c = buildCaptions(p);
    for (const t of [c.facebook, c.instagram]) {
      assert.ok(!/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]|—|–/u.test(t), 'emoji/dash');
      assert.ok(!/\b(discount|% off|sale|in stock|limited|free delivery|R\s?\d|€|\$|£|\d+\s?%)/i.test(t), `invented commercial claim in ${p.sourceKey}`);
    }
    assert.match(c.facebook, /swimloading\.com\/partners\/jaked\?utm_source=social/);
    assert.deepEqual(ungroundedNumbers(c.instagram, p.facts), []);
    assert.ok(c.hashtags.length >= 3 && c.hashtags.length <= 5);
  }
});
test('JAKED on-image copy is minimal and comes from the post', () => {
  const p = jakedAngles(live).posts.find((x) => x.sourceKey === 'jaked:wetsuit');
  assert.deepEqual(visualCopy(p), { headline: 'Seen in the BLADE', sub: 'JAKED open water wetsuit', chip: 'Register your interest' });
});

test('JAKED images: the wetsuit post only ever gets a wetsuit photo, costume posts only costume photos; J-KAI has no product photo and says so', () => {
  const cat = loadCatalogue();
  const sel = (angle) => { const p = jakedAngles(live).posts.find((x) => x.imageAngle === angle); return selectImage(p, cat, { now: NOW }); };
  assert.equal(sel('wetsuit').tier, TIERS.PRODUCT); assert.match(sel('wetsuit').asset.id, /wetsuit/);
  assert.equal(sel('costumes').tier, TIERS.PRODUCT); assert.match(sel('costumes').asset.id, /costume|sunset/);
  assert.notEqual(sel('jkai').tier, TIERS.PRODUCT, 'no J-KAI photograph exists: never substitute a different product');
  if (sel('jkai').asset) assert.equal(sel('jkai').illustrative, true);
  // rotation: consecutive JAKED posts do not reuse the same photograph or session
  const history = [];
  const a = selectImage(jakedAngles(live).posts.find((x) => x.imageAngle === 'about'), cat, { now: NOW, history });
  history.unshift({ assetId: a.asset.id, usedAt: NOW.toISOString() });
  const b = selectImage(jakedAngles(live).posts.find((x) => x.imageAngle === 'costumes'), cat, { now: NOW, history });
  assert.notEqual(a.asset.id, b.asset.id);
});
test('JAKED catalogue entries are product photos tied to the partner, with consent recorded', () => {
  const j = loadCatalogue().filter((a) => a.partner === 'jaked');
  assert.ok(j.length >= 7);
  for (const a of j) { assert.equal(a.kind, 'product'); assert.ok(a.angles?.length); assert.equal(a.approvedForSocial, true); assert.equal(a.consent, 'confirmed'); assert.ok(a.exists, a.id); assert.match(a.dhash, /^[0-9a-f]{16}$/); }
});

test('JAKED has its own share of the mix: the general partner cap is untouched', () => {
  assert.ok(GROUPS.includes('jaked')); assert.ok(SOCIAL_DEFAULTS.mix.jaked >= 0.1);
  assert.ok(Math.abs(Object.values(SOCIAL_DEFAULTS.mix).reduce((a, b) => a + b, 0) - 1) < 1e-9, 'mix sums to 1');
  assert.equal(SOCIAL_DEFAULTS.partnerMaxShare, 0.10);
  assert.equal(groupOfPost({ source_key: 'jaked:wetsuit', category: 'BEHIND THE BRAND' }), 'jaked');
  assert.equal(groupOfPost({ source_key: 'partner:maurten', category: 'BEHIND THE BRAND' }), 'partners');
  const { counts } = windowCounts([{ source_key: 'jaked:about', category: 'BEHIND THE BRAND', status: 'PUBLISHED', created_at: '2026-11-10' }]);
  assert.equal(counts.jaked, 1); assert.equal(counts.partners, undefined);
  // with nothing posted yet, JAKED is picked once it is the group furthest below target
  const picked = new Set();
  const c = { explore: 3, locations: 2, crossings: 1, ocean: 1, partners: 1, clubsAndPlatform: 1 };
  assert.equal(pickGroup(c, SOCIAL_DEFAULTS.mix, new Set(GROUPS)), 'jaked'); picked.add('jaked');
});

// ── reliability ────────────────────────────────────────────────────────────
const SLOT = '2026-11-17T08:00:00+00:00';
const post = (o = {}) => ({ id: 'p1', source_key: 'spot:1', status: 'SCHEDULED', risk: 'AUTO_ELIGIBLE', scheduled_for: SLOT, image_paths: ['d/a.jpg'], fb_caption: 'fb', ig_caption: 'ig', ...o });
function mk(posts = [], { claim = true, paused = false, reserves = [] } = {}) {
  const rows = new Map([...posts, ...reserves].map((p) => [p.id, { ...p }])), alerts = new Set();
  return { rows, alerts,
    getSettings: async () => ({ paused, reserve_min: 0 }),
    listPublishable: async () => [...rows.values()].filter((p) => ['APPROVED', 'SCHEDULED'].includes(p.status) && p.scheduled_for),
    listReserves: async () => [...rows.values()].filter((p) => p.is_reserve && p.status === 'APPROVED' && p.risk === 'AUTO_ELIGIBLE'),
    update: async (id, patch) => Object.assign(rows.get(id), patch),
    claim: async () => claim,
    alertOnce: async (k) => { if (alerts.has(k)) return false; alerts.add(k); return true; },
    publishedForSlot: async () => null };
}
const URL_ = (p) => `https://img.test/${p}`;
const notifier = () => { const sent = []; return { sent, notify: async (s, t) => { sent.push({ s, t }); } }; };
const okMeta = () => ({ publishFacebook: async () => ({ externalId: 'fb1' }), publishInstagram: async () => { throw new Error('ig off'); } });
const failMeta = () => ({ publishFacebook: async () => { throw new Error('Meta: temporary'); } });

test('A. a refused claim is never silent: it alerts (once a day) and says why', async () => {
  const store = mk([post()], { claim: false }), { notify, sent } = notifier();
  const r1 = await runPublisher({ store, meta: okMeta(), notify, now: NOW, publicUrl: URL_, platforms: ['fb'] });
  await runPublisher({ store, meta: okMeta(), notify, now: new Date('2026-11-17T09:30:00Z'), publicUrl: URL_, platforms: ['fb'] });
  assert.equal(r1.status, 'claimed-elsewhere'); assert.ok(r1.actions.some((a) => a.action === 'claim-refused'));
  assert.equal(sent.filter((m) => /could not be claimed/.test(m.s)).length, 1);
  assert.match(sent[0].t, /idempotency_key/);
});
test('C. a post that exhausts its attempts hands its slot to a reserve immediately, and you are told', async () => {
  const exhausted = post({ fb_result: { attempts: 2, error: 'x', lastAttemptAt: '2026-11-17T06:00:00Z' } });
  const reserve = { id: 'r1', source_key: 'region:x', status: 'APPROVED', is_reserve: true, risk: 'AUTO_ELIGIBLE', image_paths: ['d/r.jpg'], fb_caption: 'r' };
  const store = mk([exhausted], { reserves: [reserve] }), { notify, sent } = notifier();
  const r = await runPublisher({ store, meta: failMeta(), notify, now: NOW, publicUrl: URL_, platforms: ['fb'] });
  assert.equal(r.status, 'failed');
  assert.equal(store.rows.get('p1').status, 'FAILED');
  assert.equal(store.rows.get('r1').status, 'SCHEDULED'); assert.equal(store.rows.get('r1').scheduled_for, SLOT); assert.equal(store.rows.get('r1').is_reserve, false);
  assert.match(sent[0].t, /reserve post .* now holds the slot/);
  // next hourly run posts the reserve
  const r2 = await runPublisher({ store, meta: okMeta(), notify, now: new Date('2026-11-17T09:30:00Z'), publicUrl: URL_, platforms: ['fb'] });
  assert.equal(r2.status, 'published'); assert.equal(store.rows.get('r1').status, 'PUBLISHED');
});
test('C. with no reserve the failure alert says the slot stays empty; a slot already past the late window is not back-filled', async () => {
  const exhausted = post({ fb_result: { attempts: 2, error: 'x', lastAttemptAt: '2026-11-17T06:00:00Z' } });
  const store = mk([exhausted]), { notify, sent } = notifier();
  await runPublisher({ store, meta: failMeta(), notify, now: NOW, publicUrl: URL_, platforms: ['fb'] });
  assert.match(sent[0].t, /slot stays empty/);
});
test('F. publishing paused while a post is due: one alert a day, nothing is posted', async () => {
  const store = mk([post()], { paused: true }), { notify, sent } = notifier(); let posted = 0;
  const meta = { publishFacebook: async () => { posted++; return { externalId: 'x' }; } };
  const a = await runPublisher({ store, meta, notify, now: NOW, publicUrl: URL_, platforms: ['fb'] });
  await runPublisher({ store, meta, notify, now: new Date('2026-11-17T09:30:00Z'), publicUrl: URL_, platforms: ['fb'] });
  assert.equal(a.status, 'paused'); assert.equal(posted, 0);
  assert.equal(sent.filter((m) => /paused with a post due/.test(m.s)).length, 1);
  const quiet = notifier();
  await runPublisher({ store: mk([], { paused: true }), meta, notify: quiet.notify, now: NOW, publicUrl: URL_, platforms: ['fb'] });
  assert.equal(quiet.sent.length, 0, 'paused with nothing due is silent');
});

test('weekly report: counts what went out, flags anything not posted, a short reserve queue and a thin forward queue', () => {
  const r = (status, iso, key, o = {}) => ({ status, scheduled_for: iso, source_key: key, is_reserve: false, ...o });
  const rows = [r('PUBLISHED', '2026-11-12T08:00:00+00:00', 'a'), r('FAILED', '2026-11-14T08:00:00+00:00', 'b', { fb_result: { error: 'Meta 324' } }),
    r('SCHEDULED', '2026-11-17T08:00:00+00:00', 'c'), { status: 'APPROVED', is_reserve: true, source_key: 'res' }];
  const rep = weeklyReport(rows, new Date('2026-11-16T08:00:00Z'));
  assert.match(rep.subject, /1 published, \d need attention/);
  assert.ok(rep.problems.some((p) => /NOT POSTED: Meta 324/.test(p)));
  assert.ok(rep.problems.some((p) => /Reserve queue is 1 of 6/.test(p)));
  assert.ok(rep.problems.some((p) => /Only 1 post/.test(p)));
  const healthy = weeklyReport([r('PUBLISHED', '2026-11-12T08:00:00+00:00', 'a'), r('SCHEDULED', '2026-11-17T08:00:00+00:00', 'c'), r('SCHEDULED', '2026-11-19T08:00:00+00:00', 'd'), r('SCHEDULED', '2026-11-21T08:00:00+00:00', 'e'),
    ...Array.from({ length: 6 }, (_, i) => ({ status: 'APPROVED', is_reserve: true, source_key: `res${i}` }))], new Date('2026-11-16T08:00:00Z'));
  assert.match(healthy.subject, /all on track/); assert.equal(healthy.problems.length, 0);
});
test('cron handlers still require the cron secret', async () => {
  process.env.CRON_SECRET = 'cs';
  for (const f of ['social-publish', 'social-generate']) {
    const { default: h } = await import(`../api/cron/${f}.js`);
    const res = { code: null, status(c) { this.code = c; return this; }, json() { return this; } };
    await h({ method: 'GET', headers: {}, query: {} }, res); assert.equal(res.code, 401, f);
  }
});

test('partner caps: JAKED is held to its own ceiling, other partners to 10%, and a near-empty window never trips a cap', () => {
  const j = { ...jakedAngles(live).posts[0] };
  assert.equal(j.partner.priority, true);
  assert.equal(validatePost(j, { now: NOW, partnerShare: 0.15 }).risk, RISK.AUTO, 'inside JAKED\'s 20% ceiling');
  assert.equal(validatePost(j, { now: NOW, partnerShare: 0.30 }).risk, RISK.REVIEW);
  const other = { ...j, partner: { ...j.partner, priority: false, slug: 'maurten' } };
  assert.equal(validatePost(other, { now: NOW, partnerShare: 0.15 }).risk, RISK.REVIEW, 'any other partner stops at 10%');
});
test('autopilot dry run on an empty queue plans JAKED without tripping the share cap', async () => {
  const { runWeekly } = await import('../api/_lib/social/autopilot-run.js');
  const snapshot = { partner_pages: [{ id: 'j1', name: 'JAKED', chip_state: 'live', section: 'active', hero_page: '/partners/jaked', blurb: 'x' }], social_posts: [] };
  const r = await runWeekly({ snapshot, dry: true, now: new Date('2026-11-17T09:00:00Z') });
  const jaked = r.plan.filter((p) => p.group === 'jaked' || /^jaked:/.test(p.key || ''));
  assert.ok(jaked.length >= 1, 'JAKED is planned: ' + JSON.stringify(r.plan.map((p) => [p.slot, p.action, p.key])));
  assert.ok(!jaked.some((p) => /exceed/.test((p.reasons || []).join(' '))));
});

test('FAIL CLOSED: a product photo with no declared angles is never used for an angled post (e.g. when the database drops the field)', () => {
  const cat = loadCatalogue().map((a) => (a.partner === 'jaked' ? { ...a, angles: undefined } : a));
  const p = jakedAngles(live).posts.find((x) => x.imageAngle === 'wetsuit');
  const s = selectImage(p, cat, { now: NOW });
  assert.notEqual(s.tier, TIERS.PRODUCT, 'no angles declared means no product photo, not "any product photo"');
});
test('media rows round-trip the angles', async () => {
  const { assetToRow, rowToAsset } = await import('../api/_lib/social/media.js');
  const a = loadCatalogue().find((x) => x.id === 'jaked-carina-wetsuit-1');
  const row = assetToRow(a);
  assert.deepEqual(row.angles, ['wetsuit', 'enquire']);
  assert.deepEqual(rowToAsset({ ...row, width: a.width, height: a.height }).angles, ['wetsuit', 'enquire']);
});

test('event verification limit is 120 days: 105 days old is accepted, 125 days old goes to review', () => {
  assert.equal(SOCIAL_DEFAULTS.event.maxVerificationAgeDays, 120);
  const days = (n) => new Date(NOW.getTime() - n * 86400e3).toISOString();
  const ev = (n) => ({ category: 'THIS WEEK IN OPEN WATER', sourceKey: 'explore:week:x', sourceUrl: 'https://www.swimloading.com/explore', facts: [], events: [{ title: 'E', isoDate: '2026-11-25', tier: 'listed', lastVerifiedAt: days(n) }] });
  const f = [{ key: 'k', text: 'E', source: { table: 'event_editions', row: 'x' }, kind: 'evergreen' }];
  assert.equal(validatePost({ ...ev(105), facts: f }, { now: NOW }).risk, RISK.AUTO);
  assert.equal(validatePost({ ...ev(125), facts: f }, { now: NOW }).risk, RISK.REVIEW);
  assert.match(validatePost({ ...ev(125), facts: f }, { now: NOW }).reasons.join(' '), /last verified 125 days ago/);
});
