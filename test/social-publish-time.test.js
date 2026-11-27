// Regressions from 17-27 Nov 2026: JAKED posts were built and then rejected at publish time, silently; and a photo that
// lives in the repository was missing from the Vercel bundle ("storage download sl-hero-underwater: HTTP 400").
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { jakedAngles, partnerCards, partnerMayPost } from '../api/_lib/social/series.js';
import { makeRecheck } from '../api/_lib/social/recheck.js';
import { runPublisher } from '../api/_lib/social/publisher.js';
import { loadCatalogue } from '../api/_lib/social/media.js';

const NOW = new Date('2026-11-28T08:30:00Z');
// the rows exactly as they are in production (27 Nov 2026)
const JAKED = { id: 'eb8644d9-28d2-4d08-87f1-4230da07e1c5', name: 'JAKED', chip_state: 'live', section: 'coming_soon', hero_page: '/partners/jaked', blurb: 'b', logo_url: '/icons/jaked-logo.png' };
const MAURTEN = { id: '052b1209-03ae-4ba4-97d0-cf335df90b05', name: 'Maurten × Art of Endurance', chip_state: 'live', section: 'active', hero_page: '/partners/maurten', blurb: 'b' };
const restFor = (rows) => async (path) => (path.startsWith('partner_pages') ? rows.map(({ id, chip_state, section }) => ({ id, chip_state, section })) : []);
/** A candidate as the publisher sees it: a database row with source_key and facts. */
const asRow = (c) => ({ id: 'p', source_key: c.sourceKey, facts: c.facts, created_at: '2026-11-20T10:00:00Z' });

test('BUILDER AND PUBLISH-TIME CHECK AGREE: every JAKED post that can be built also passes at publish time', async () => {
  const { posts } = jakedAngles([JAKED]);
  assert.equal(posts.length, 5);
  for (const c of posts) { const v = await makeRecheck(restFor([JAKED]))(asRow(c), NOW); assert.equal(v.ok, true, `${c.sourceKey}: ${v.reason}`); }
});
test('every ordinary partner card that can be built also passes at publish time', async () => {
  const cards = partnerCards([MAURTEN, { ...MAURTEN, id: 'x', name: 'Soon Co', section: 'coming_soon' }]);
  assert.deepEqual(cards.map((c) => c.partner.name), ['Maurten'], 'ordinary partners still need the active section');
  for (const c of cards) assert.equal((await makeRecheck(restFor([MAURTEN]))(asRow(c), NOW)).ok, true);
});
test('a partner that stops being live is still refused at publish time, with the reason', async () => {
  const c = jakedAngles([JAKED]).posts[0];
  for (const row of [{ ...JAKED, chip_state: 'soon' }, { ...JAKED, section: 'ended' }]) {
    const v = await makeRecheck(restFor([row]))(asRow(c), NOW);
    assert.equal(v.ok, false); assert.match(v.reason, /chip_state .*section/);
  }
  assert.equal((await makeRecheck(restFor([]))(asRow(c), NOW)).ok, false, 'row deleted');
  assert.equal(partnerMayPost({ ...MAURTEN, section: 'coming_soon' }), false);
});
test('a post replaced by a reserve at publish time ALWAYS emails', async () => {
  const rows = new Map([['p1', { id: 'p1', source_key: 'jaked:about', status: 'SCHEDULED', scheduled_for: '2026-11-28T08:00:00+00:00', image_paths: ['a.jpg'], fb_caption: 'x' }],
    ['r1', { id: 'r1', source_key: 'region:x', status: 'APPROVED', is_reserve: true, risk: 'AUTO_ELIGIBLE', image_paths: ['r.jpg'], fb_caption: 'y' }]]);
  const store = { getSettings: async () => ({ paused: false }), listPublishable: async () => [...rows.values()].filter((p) => ['APPROVED', 'SCHEDULED'].includes(p.status) && p.scheduled_for),
    listReserves: async () => [rows.get('r1')].filter((r) => r.is_reserve), update: async (id, patch) => Object.assign(rows.get(id), patch), claim: async () => true };
  const sent = [];
  await runPublisher({ store, meta: { publishFacebook: async () => ({ externalId: 'fb' }) }, recheck: async (p) => (p.id === 'p1' ? { ok: false, reason: 'partner is no longer live' } : { ok: true }),
    notify: async (s, t) => sent.push({ s, t }), now: NOW, publicUrl: (p) => p, platforms: ['fb'] });
  const m = sent.find((x) => /replaced at publish time/.test(x.s));
  assert.ok(m, 'an email was sent'); assert.match(m.t, /jaked:about.*partner is no longer live.*region:x/s);
});
test('BUNDLE: every photo that lives in the repository is shipped with the generator function', () => {
  const include = JSON.parse(readFileSync('vercel.json', 'utf8')).functions['api/cron/social-generate.js'].includeFiles.replace(/^\{|\}$/g, '').split(',');
  const re = include.map((g) => new RegExp('^' + g.replace(/[.+^$()|[\]\\]/g, '\\$&').replace(/\*\*/g, '\u0000').replace(/\*/g, '[^/]*').replace(/\u0000/g, '.*') + '$'));
  const repoPhotos = loadCatalogue().filter((a) => a.source !== 'google-photos-export');
  assert.ok(repoPhotos.length >= 12);
  for (const a of repoPhotos) { assert.ok(existsSync(a.file), a.file); assert.ok(re.some((r) => r.test(a.file)), `${a.id}: ${a.file} is not in includeFiles, so Vercel cannot render it`); }
});
test('a photo that cannot be loaded skips that candidate instead of crashing the run', async () => {
  const { runWeekly } = await import('../api/_lib/social/autopilot-run.js');
  const src = readFileSync('api/_lib/social/autopilot-run.js', 'utf8');
  assert.match(src, /try \{ r = await renderPost\(/); assert.match(src, /catch \(e\) \{[^}]*return \{ ok: false, reason: `render failed/);
  assert.equal(typeof runWeekly, 'function');
});
