// Social Content Engine: rules that must hold before anything is ever auto-published.
// Pure logic only (no network): every rule here is a way the engine could embarrass SwimLoading.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextSlots, RISK, CATEGORIES } from '../api/_lib/social/config.js';
import { fact, fmtDate } from '../api/_lib/social/facts.js';
import { eventIneligibility, NOT_OPEN_WATER_TITLE, partnerFromPage } from '../api/_lib/social/sources.js';
import { validatePost, revalidateEvents, ungroundedNumbers, derivedNumbers } from '../api/_lib/social/validate.js';
import { buildCaptions } from '../api/_lib/social/captions.js';
import { renderHtml } from '../api/_lib/social/templates.js';

const NOW = new Date('2026-10-18T08:00:00Z');
const goodEdition = (o = {}) => ({
  id: 'e1', title: 'Narrabeen Beach Challenge', status: 'announced', date_confirmed: true, start_date: '2026-11-01',
  verification_tier: 'listed', discipline: 'open_water', official_url: 'https://example.org/e',
  event_venues: { city: 'Narrabeen', country_code: 'AU' }, ...o,
});

test('schedule: Tue/Thu/Sat 10:00 SAST is 08:00 UTC, in order, after `from`', () => {
  const s = nextSlots(new Date('2026-10-18T09:00:00Z'), 3); // Sunday
  assert.deepEqual(s, ['2026-10-20T08:00:00.000Z', '2026-10-22T08:00:00.000Z', '2026-10-24T08:00:00.000Z']);
});
test('schedule: a slot already passed today is skipped', () => {
  const s = nextSlots(new Date('2026-10-20T08:00:01Z'), 1); // Tuesday just after 10:00 SAST
  assert.equal(s[0], '2026-10-22T08:00:00.000Z');
});
test('schedule is configurable', () => {
  assert.deepEqual(nextSlots(NOW, 1, [{ day: 1, hour: 6, minute: 30 }]), ['2026-10-19T04:30:00.000Z']);
});

test('dates are formatted from the calendar date, never shifted by timezone', () => {
  assert.equal(fmtDate('2026-11-01'), 'Sun 1 Nov');
  assert.equal(fmtDate('2026-10-23'), 'Fri 23 Oct');
  assert.equal(fmtDate('nonsense'), null);
});

test('event eligibility: a clean listed open-water edition passes', () => {
  assert.equal(eventIneligibility(goodEdition()), null);
});
for (const [name, patch, re] of [
  ['cancelled', { status: 'cancelled' }, /cancelled/],
  ['postponed', { status: 'postponed' }, /postponed/],
  ['unconfirmed date', { date_confirmed: false }, /date/],
  ['unverified tier', { verification_tier: 'unverified' }, /tier/],
  ['no venue', { event_venues: null }, /venue/],
  ['no country', { event_venues: { city: 'X', country_code: null } }, /venue|country/],
  ['no source URL', { official_url: null }, /source/],
  ['triathlon leg', { discipline: 'multisport_swim_leg' }, /not open water/],
  ['pool meet mis-tagged open_water', { title: 'Winter Blast 2026 (25m)' }, /pool/],
  ['swim-team season listed as an event', { title: 'Lakewood Rangers Swim Team Winter 26-27' }, /pool|non-open/],
  ['artistic swimming mis-tagged', { title: 'PANAMERICANO MASTER – ARTISTICA' }, /pool|non-open/],
]) test(`event eligibility: ${name} is held back`, () => assert.match(eventIneligibility(goodEdition(patch)), re));

test('event eligibility: past event and recently changed edition are held back', () => {
  assert.match(eventIneligibility(goodEdition(), new Set(), '2026-11-02'), /past/);
  assert.match(eventIneligibility(goodEdition(), new Set(['e1'])), /change/);
});
test('open water titles are not caught by the pool filter', () => {
  for (const t of ['Cruce de Bahía San Carlos 2026', 'Narrabeen Beach Challenge', 'Highland Lakes Challenge 1', 'Aquaman- SOMABAY 2026']) assert.ok(!NOT_OPEN_WATER_TITLE.test(t), t);
});

const basePost = (o = {}) => ({
  category: CATEGORIES.SWIM_SPOTLIGHT, sourceKey: 'spot:1', sourceUrl: 'https://www.swimloading.com/spots/x',
  facts: [fact('name', 'X', { table: 'spots', row: '1' })], image: { url: null, licenceVerified: true }, ...o,
});

test('validate: sourced evergreen post is auto-eligible', () => assert.equal(validatePost(basePost(), { now: NOW }).risk, RISK.AUTO));
test('validate: no facts / no source URL block', () => {
  assert.equal(validatePost(basePost({ facts: [] }), { now: NOW }).risk, RISK.BLOCKED);
  assert.equal(validatePost(basePost({ sourceUrl: '' }), { now: NOW }).risk, RISK.BLOCKED);
});
test('validate: a quoted fact whose text left the source file blocks the post', () => {
  const f = fact('claim', 'x', { file: 'partners/maurten.html', quote: 'this sentence is not on the page' });
  assert.equal(validatePost(basePost({ facts: [f] }), { now: NOW }).risk, RISK.BLOCKED);
});
test('validate: unverified photo licence, and share-alike notes, need review', () => {
  assert.equal(validatePost(basePost({ image: { url: 'u', licenceVerified: false } }), { now: NOW }).risk, RISK.REVIEW);
  assert.equal(validatePost(basePost({ image: { url: 'u', licenceVerified: true, reviewNote: 'sa' } }), { now: NOW }).risk, RISK.REVIEW);
});
test('validate: partner that is not live needs review; live passes', () => {
  assert.equal(validatePost(basePost({ partner: { chipState: 'soon' } }), { now: NOW }).risk, RISK.REVIEW);
  assert.equal(validatePost(basePost({ partner: { chipState: 'live' } }), { now: NOW }).risk, RISK.AUTO);
  assert.equal(validatePost(basePost({ partner: { chipState: 'live' } }), { now: NOW, partnerShare: 0.4 }).risk, RISK.REVIEW);
});
test('validate: thin content goes to review, not auto', () => assert.equal(validatePost(basePost({ richness: 'thin' }), { now: NOW }).risk, RISK.REVIEW));
test('validate: same source inside 90 days is blocked, outside is fine', () => {
  assert.equal(validatePost(basePost(), { now: NOW, recentSourceKeys: { 'spot:1': '2026-09-01T00:00:00Z' } }).risk, RISK.BLOCKED);
  assert.equal(validatePost(basePost(), { now: NOW, recentSourceKeys: { 'spot:1': '2026-06-01T00:00:00Z' } }).risk, RISK.AUTO);
});
test('validate: events in the past block; stale verification needs review', () => {
  const ev = (o) => basePost({ events: [{ title: 'E', isoDate: '2026-11-01', tier: 'listed', lastVerifiedAt: '2026-10-01T00:00:00Z', ...o }] });
  assert.equal(validatePost(ev({}), { now: NOW }).risk, RISK.AUTO);
  assert.equal(validatePost(ev({ isoDate: '2026-10-10' }), { now: NOW }).risk, RISK.BLOCKED);
  assert.equal(validatePost(ev({ lastVerifiedAt: '2026-01-01T00:00:00Z' }), { now: NOW }).risk, RISK.REVIEW);
  assert.equal(validatePost(ev({ tier: 'unverified' }), { now: NOW }).risk, RISK.REVIEW);
});

test('publish-time re-check: cancelled, rescheduled or vanished events suppress the post', () => {
  const post = { events: [{ id: 'e1', title: 'A' }, { id: 'e2', title: 'B' }] };
  assert.equal(revalidateEvents(post, [goodEdition({ id: 'e1' }), goodEdition({ id: 'e2' })], [], NOW).action, 'PUBLISH');
  const cancelled = revalidateEvents(post, [goodEdition({ id: 'e1', status: 'cancelled' }), goodEdition({ id: 'e2' })], [], NOW);
  assert.equal(cancelled.action, 'SUPPRESS_AND_REPLACE_FROM_RESERVE'); assert.equal(cancelled.dropped[0].title, 'A');
  const moved = revalidateEvents(post, [goodEdition({ id: 'e1' }), goodEdition({ id: 'e2' })], [{ edition_id: 'e2', change_type: 'date_changed' }], NOW);
  assert.equal(moved.ok, false);
  assert.equal(revalidateEvents(post, [goodEdition({ id: 'e1' })], [], NOW).dropped[0].reason, 'edition no longer public');
});

test('grounding: numbers in a caption must come from facts', () => {
  const facts = [fact('d', '33.8 km', { table: 't' })];
  assert.deepEqual(ungroundedNumbers('The route is 33.8 km', facts), []);
  assert.deepEqual(ungroundedNumbers('The route is 34 km and 12 hours', facts), ['34', '12']);
});

test('traceability: partner claims are found on the real partner page, and a missing one throws', () => {
  const ok = partnerFromPage({ name: 'Maurten', file: 'partners/maurten.html', url: '/partners/maurten', logo: 'x',
    quotes: [['claim', 'No sweeteners. No flavours. No additives.']] });
  assert.equal(ok.facts.length, 1);
  assert.throws(() => partnerFromPage({ name: 'Maurten', file: 'partners/maurten.html', url: '/', logo: 'x', quotes: [['c', 'Clinically proven to add 20% speed']] }), /not found/);
});

const POSTS = {
  spot: { category: CATEGORIES.SWIM_SPOTLIGHT, sourceUrl: 'https://www.swimloading.com/spots/a', facts: [
    fact('name', 'A Lido', { table: 's' }), fact('country', 'England', { table: 's' }), fact('area', 'London', { table: 's' }), fact('water_type', 'Pool', { table: 's' }),
    fact('region', 'Atlantic Seaboard', { table: 's' })] },
  discovers: { category: CATEGORIES.DISCOVERS, sourceUrl: 'https://www.swimloading.com/spots/uk', region: 'London', facts: [fact('r', 'London', { table: 's' })],
    spots: [{ name: 'A', type: 'Pool', area: 'N' }, { name: 'B', type: 'Lake', area: null }, { name: 'C', type: 'Pool', area: 'S' }] },
  week: { category: CATEGORIES.THIS_WEEK, sourceUrl: 'https://www.swimloading.com/explore', windowDays: 7, facts: [fact('e', 'E', { table: 'e' })],
    events: [{ date: 'Sun 1 Nov', title: 'Swim', place: 'Cape Town, South Africa', distance: '5 km' }, { date: 'Mon 2 Nov', title: 'Swim 2', place: 'X, Y', distance: null }] },
};
const ASSETS = { logo: 'data:,', photo: null, partnerLogo: 'data:,' };
test('captions: no em dashes, no emojis, hashtags 3 to 5, Instagram has no raw URL', () => {
  for (const p of Object.values(POSTS)) {
    const c = buildCaptions(p);
    for (const t of [c.facebook, c.instagram]) { assert.ok(!/—|–/.test(t), 'em/en dash'); assert.ok(!/\p{Extended_Pictographic}/u.test(t), 'emoji'); }
    assert.ok(c.hashtags.length >= 3 && c.hashtags.length <= 5);
    assert.ok(!/https?:\/\//.test(c.instagram), 'IG caption links are not clickable');
    assert.match(c.facebook, /https:\/\/www\.swimloading\.com\/.*utm_source=social/);
  }
});
test('captions: the series name matches the real window', () => {
  assert.match(buildCaptions(POSTS.week).instagram, /^This week in open water/);
  assert.match(buildCaptions({ ...POSTS.week, windowDays: 14 }).instagram, /^Coming up in open water, next 14 days/);
});
test('templates render every category, one slide per event plus a cover, without "undefined"', () => {
  assert.equal(renderHtml(POSTS.spot, ASSETS).length, 1);
  assert.equal(renderHtml(POSTS.discovers, ASSETS).length, 1);
  assert.equal(renderHtml(POSTS.week, ASSETS).length, 3);
  for (const p of Object.values(POSTS)) for (const h of renderHtml(p, ASSETS)) { assert.ok(!/undefined|null/.test(h.replace(/<style>[\s\S]*?<\/style>/, ''))); assert.ok(!/\p{Extended_Pictographic}/u.test(h)); }
});

test('an events caption may state the number of listed swims and the window, because both are counted from the post', () => {
  const post = { category: CATEGORIES.THIS_WEEK, sourceUrl: 'https://www.swimloading.com/explore', windowDays: 14,
    facts: [fact('e0.title', 'Swim A', { table: 'event_editions', row: 'x' })],
    events: [{ date: 'Sun 1 Nov', title: 'Swim A', place: 'Cape Town, South Africa', distance: null }, { date: 'Mon 2 Nov', title: 'Swim B', place: 'X, Y', distance: null }, { date: 'Tue 3 Nov', title: 'C', place: 'P, Q', distance: null }, { date: 'Wed 4 Nov', title: 'D', place: 'R, S', distance: null }] };
  const c = buildCaptions(post);
  assert.deepEqual(derivedNumbers(post), ['14', '4']);
  const stray = ungroundedNumbers(c.instagram, post.facts, derivedNumbers(post)).filter((n) => !/^(1|2|3|4)$/.test(n));
  assert.deepEqual(stray, [], 'only the dates in the list remain, and those come from the event rows');
  assert.ok(ungroundedNumbers(c.instagram, post.facts, []).includes('4'), 'without the derived numbers the same caption is still refused');
});
