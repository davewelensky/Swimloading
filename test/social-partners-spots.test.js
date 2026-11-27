// All 11 partners are current (Dave, 27 Nov 2026), and the spot-logbook series. No network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { partnerCards, jakedAngles, evergreenBlurb, spotLogbook, publishableLog } from '../api/_lib/social/series.js';
import { buildCaptions } from '../api/_lib/social/captions.js';
import { visualCopy } from '../api/_lib/social/templates.js';
import { validatePost, ungroundedNumbers } from '../api/_lib/social/validate.js';

const NOW = new Date('2026-11-27T08:00:00Z');
// production blurbs, 27 Nov 2026
const ROWS = [
  ['Maurten × Art of Endurance', 'live', 'active', 'Precision sports nutrition: gels and drinks engineered to fuel long open water swims without GI distress.'],
  ['Science in Sport (SiS)', 'live', 'active', 'Science in Sport: evidence-based nutrition trusted by elite athletes. Gels, hydration and recovery for every swim.'],
  ['eo SwimBETTER', 'soon', 'active', '"The missing link between swimming harder and swimming faster is knowing what to change." Used by Kyle Chalmers, 14 national federations and 50+ NCAA colleges.'],
  ['BlueSeventy UK', 'live', 'active', 'Member Benefit Partner: 15% off goggles, training wetsuits and open water gear for members in the UK & Channel Islands.'],
  ['Blu Smooth', 'live', 'active', 'Blu Smooth wetsuits designed for open water swimmers. Warm, fast and built for South African conditions.'],
  ['THEMAGIC5', 'live', 'active', 'Custom-fit goggles built from a 3D scan of your face. No more leaks, no more pressure, no more compromises.'],
  ['FORM', 'soon', 'coming_soon', 'Smart swim goggles with a heads-up display: your pace, distance and stroke metrics in your line of sight. Member discounts and a Smart Swim 2 prize on the way.'],
  ['TRIHARD', 'soon', 'coming_soon', 'Pre- and post-swim skincare built for open water athletes: chlorine protection, sun defence and salt recovery. Presenting sponsor of The Great UK Swim Spot Challenge.'],
  ['JAKED', 'live', 'coming_soon', 'Italian performance swimwear.'],
  ['Get Stoked', 'live', 'active', 'The official Therabody importer and distributor in South Africa. SwimLoading members get 10% off all products on therabody.co.za.'],
  ['Zero BS', 'live', 'active', 'South African tallow-based skincare. Zero BS Shade samples go into the Langebaan Express goodie bags, with sports packs as prizes.'],
].map(([name, chip_state, section, blurb], i) => ({ id: `p${i}`, name, chip_state, section, blurb, hero_page: `/partners/x${i}`, logo_url: null }));

test('all 11 partners get posts: 10 partner cards plus the JAKED angles', () => {
  const cards = partnerCards(ROWS.filter((r) => !/jaked/i.test(r.name)));
  assert.equal(cards.length, 10);
  assert.equal(jakedAngles(ROWS).posts.length, 5);
});
test('time-bound sentences (challenges, prizes, coming soon) never reach a post; standing descriptions and member benefits stay', () => {
  for (const c of partnerCards(ROWS)) { const t = buildCaptions(c).facebook; assert.ok(!/challenge|prize|goodie|on the way|coming soon|presenting sponsor/i.test(t), t); assert.notEqual(validatePost(c, { now: NOW }).risk, 'BLOCKED'); assert.equal(validatePost(c, { now: NOW }).risk, 'AUTO_ELIGIBLE', c.partner.name); }
  assert.equal(evergreenBlurb(ROWS[10].blurb), 'South African tallow-based skincare.');
  assert.match(evergreenBlurb(ROWS[3].blurb), /15% off/);
  assert.equal(evergreenBlurb('Win a wetsuit in our November challenge!'), '');
  assert.equal(partnerCards([{ ...ROWS[0], blurb: 'Win a prize soon.' }]).length, 0, 'nothing evergreen to say: no post');
});

const SPOT = { id: 's1', name: 'Camps Bay', water_type: 'OCEAN', area: null, country_code: 'ZA', latitude: -33.95, longitude: 18.37 };
const log = (i, o = {}) => ({ spot_id: 's1', user_id: `u${i % 4}`, temp_c: 10 + (i % 8), logged_at: new Date(Date.UTC(2026, i % 10, 5)).toISOString(), created_at: '2026-01-01', notes: null, location_source: 'manual', ...o });
const many = (n, o) => Array.from({ length: n }, (_, i) => log(i, o));

test('spot logbook: builds from enough readings by enough people, with every figure dated', () => {
  const [p] = spotLogbook(many(14), [SPOT], { now: NOW });
  assert.equal(p.sourceKey, 'spotlog:s1'); assert.equal(p.logCount, 14);
  const c = buildCaptions(p);
  assert.match(c.facebook, /Coldest recorded: 10°C \(\w+ 2026\)/); assert.match(c.facebook, /Warmest recorded: 17°C/); assert.match(c.facebook, /14 water temperature readings/);
  assert.deepEqual(ungroundedNumbers(c.instagram, p.facts), []);
  assert.ok(!/current|today|right now/i.test(c.facebook), 'history is never presented as the current temperature');
  assert.deepEqual(visualCopy(p), { headline: 'Camps Bay', sub: '10°C to 17°C recorded', chip: '14 readings' });
  assert.equal(validatePost(p, { now: NOW }).risk, 'AUTO_ELIGIBLE'); assert.ok(p.geo);
});
test('spot logbook privacy: too few readings or too few people means no post; a sensor spot needs no loggers', () => {
  assert.equal(spotLogbook(many(9), [SPOT], { now: NOW }).length, 0);
  assert.equal(spotLogbook(many(40, { user_id: 'only-one' }), [SPOT], { now: NOW }).length, 0, 'one person\'s totals are traceable to them');
  assert.equal(spotLogbook(many(12, { user_id: 'sensor-bot', location_source: 'sensor' }), [SPOT], { now: NOW }).length, 1);
});
test('NEVER PUBLISHED: Big Bay SwimOps entries, Derrick\'s accounts, Strava imports and sensor garbage', () => {
  assert.equal(publishableLog(log(1, { notes: 'Dawn swim (via Big Bay SwimOps)' })), false);
  assert.equal(publishableLog(log(1, { notes: 'Imported from Strava: Morning Swim' })), false);
  assert.equal(publishableLog(log(1), new Set(['u1'])), false);
  assert.equal(publishableLog(log(1, { temp_c: 99 })), false); assert.equal(publishableLog(log(1, { temp_c: null })), false);
  assert.equal(publishableLog(log(1)), true);
  assert.equal(spotLogbook(many(30, { notes: '(via Big Bay SwimOps)' }), [SPOT], { now: NOW }).length, 0);
});
test('old data omits the "most recent reading" line', () => {
  const [p] = spotLogbook(many(12), [SPOT], { now: new Date('2027-06-01T00:00:00Z') });
  assert.ok(!p.facts.some((f) => f.key === 'latest'));
});

test('school, club and squad venues are never promoted', () => {
  for (const name of ['Camps Bay Primary K8/Aqua Sharks', 'DUC', 'Milnerton High School', 'Reddam College Pool', 'Aqua Sharks pool', 'Swim Club Pool'])
    assert.equal(spotLogbook(many(40), [{ ...SPOT, name }], { now: NOW }).length, 0, name);
  for (const name of ['Camps Bay', 'Tooting Bec Lido', 'Highcliffe Beach', 'Clubhouse Reef'])
    assert.equal(spotLogbook(many(40), [{ ...SPOT, name }], { now: NOW }).length, name === 'Clubhouse Reef' ? 1 : 1, name);
});
