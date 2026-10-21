// Social autopilot: series builders, planner rules and the dry-run guarantee. No network: data is fixtures, fetch is stubbed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SOCIAL_DEFAULTS, CATEGORIES, MIX_GROUP } from '../api/_lib/social/config.js';
import { conditionsWeekly, conditionsRecheck, regionalUnits, regionalMap, crossingAngles, partnerCards } from '../api/_lib/social/series.js';
import { runAutopilot, pickGroup, partnerAllowed, recentKeyMap, loadLedgerKeys, buildPool, windowCounts, recentEventIds } from '../api/_lib/social/autopilot.js';
import { runWeekly } from '../api/_lib/social/autopilot-run.js';
import { buildCaptions } from '../api/_lib/social/captions.js';
import { renderHtml, visualCopy } from '../api/_lib/social/templates.js';
import { validatePost, ungroundedNumbers } from '../api/_lib/social/validate.js';
import { fontCss } from '../api/_lib/social/fonts.js';

const NOW = new Date('2026-10-21T09:00:00Z');
const hoursAgo = (h, from = NOW) => new Date(from.getTime() - h * 3600e3).toISOString();
const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/u;

// ── fixtures ───────────────────────────────────────────────────────────────
const spot = (id, name, cc, o = {}) => ({ id, name, country_code: cc, area: o.area ?? 'Somewhere', water_type: o.type || 'OCEAN', domain: o.domain || 'USA', latitude: o.lat ?? 34, longitude: o.lng ?? -118, ...o });
const reading = (spotId, o = {}) => ({ spot_id: spotId, water_temperature_c: '18.04', observed_at: hoursAgo(2), provider_code: 'ndbc', provider_name: 'NOAA National Data Buoy Center', station_name: 'Station 1', distance_km: '2', is_primary: true, quality_code: 'ndbc_realtime', ...o });
const SPOTS = [spot('s1', 'Alpha Beach', 'US'), spot('s2', 'Bravo Cove', 'CA', { lat: 49, lng: -123 }), spot('s3', 'Charlie Bay', 'IE', { lat: 53, lng: -6 }), spot('s4', 'Delta Pier', 'US', { lat: 33, lng: -117 })];
const ROWS = [reading('s1'), reading('s2', { water_temperature_c: '11.3' }), reading('s3', { water_temperature_c: '14.56' }), reading('s4', { water_temperature_c: '19.9' })];

// ── (b) conditions ─────────────────────────────────────────────────────────
test('conditions: measured readings only, with reading, source, station and observation time on every fact', () => {
  const p = conditionsWeekly(ROWS, SPOTS, { now: NOW, slotIso: '2026-10-22T08:00:00.000Z' });
  assert.equal(p.category, CATEGORIES.OPEN_WATER_INTEL);
  assert.ok(p.graphicOnly, 'data table is a designed graphic, never text over a photo');
  assert.ok(p.readings.length >= 3);
  const r = p.readings.find((x) => x.spot === 'Alpha Beach');
  assert.equal(r.temp, '18.0 C'); assert.equal(r.source, 'NOAA National Data Buoy Center'); assert.equal(r.station, 'Station 1'); assert.match(r.observed, /^21 Oct \d\d:\d\d UTC$/);
  for (const f of p.facts.filter((x) => x.source.table === 'spot_conditions_live')) { assert.equal(f.kind, 'time_sensitive'); assert.ok(f.observedAt); }
  const cap = buildCaptions(p);
  assert.match(cap.facebook, /observed 21 Oct/); assert.match(cap.facebook, /NOAA National Data Buoy Center/); assert.match(cap.facebook, /not forecasts/);
  assert.deepEqual(ungroundedNumbers(cap.facebook.replace(/https?:\/\/\S+/g, ''), p.facts, []), [], 'every number in the caption is in a fact');
  assert.ok(validatePost(p, { now: NOW }).risk === 'AUTO_ELIGIBLE');
});
test('conditions: modelled, non-primary, distant and stale readings never qualify', () => {
  const rows = [reading('s1', { quality_code: 'cmems_analysis_forecast', provider_code: 'cmems_model' }), reading('s2', { is_primary: false }), reading('s3', { distance_km: '50.2' }), reading('s4', { observed_at: hoursAgo(60) })];
  const p = conditionsWeekly(rows, SPOTS, { now: NOW, slotIso: NOW.toISOString() });
  assert.ok(p.gap, 'no readings left, so no post');
});
test('conditions: a reading must still be inside the 48 h ceiling at the slot, so the allowed age shrinks with lead time', () => {
  const rows = ROWS.map((r) => ({ ...r, observed_at: hoursAgo(30) }));
  assert.ok(!conditionsWeekly(rows, SPOTS, { now: NOW, slotIso: hoursAgo(-10) }).gap, '30 h old + 10 h lead = 40 h: fine');
  assert.ok(conditionsWeekly(rows, SPOTS, { now: NOW, slotIso: hoursAgo(-25) }).gap, '30 h old + 25 h lead = 55 h: refused');
});
test('conditions: fewer than three readings is a gap, never padded; one spot per country first', () => {
  assert.ok(conditionsWeekly(ROWS.slice(0, 2), SPOTS, { now: NOW }).gap);
  const p = conditionsWeekly(ROWS, SPOTS, { now: NOW });
  assert.equal(new Set(p.readings.map((r) => r.spotId)).size, p.readings.length);
  const countries = p.readings.slice(0, 3).map((r) => SPOTS.find((s) => s.id === r.spotId).country_code);
  assert.equal(new Set(countries).size, 3, 'first three come from three different countries');
});
test('conditions publish-time recheck: stale, retired station, corrected value fail; a newer reading is fine', () => {
  const p = conditionsWeekly(ROWS, SPOTS, { now: NOW, slotIso: '2026-10-22T08:00:00.000Z' });
  const fresh = (o = {}) => ROWS.map((r) => ({ ...r, ...o }));
  assert.ok(conditionsRecheck(p, fresh(), new Date('2026-10-22T08:00:00Z')).ok);
  assert.ok(conditionsRecheck(p, fresh({ observed_at: hoursAgo(-3) }), new Date('2026-10-22T08:00:00Z')).ok, 'newer reading on record is fine');
  assert.ok(!conditionsRecheck(p, fresh(), new Date('2026-10-24T08:00:00Z')).ok, 'older than 48 h at publish');
  assert.ok(!conditionsRecheck(p, ROWS.slice(1), new Date('2026-10-22T08:00:00Z')).ok, 'station stopped reporting');
  assert.ok(!conditionsRecheck(p, fresh({ water_temperature_c: '25.0' }), new Date('2026-10-22T08:00:00Z')).ok, 'value corrected');
});

// ── (c) regional maps ──────────────────────────────────────────────────────
const mk = (n, cc, domain, o = {}) => Array.from({ length: n }, (_, i) => spot(`${cc}${domain}${i}`, `${cc} ${domain} ${String.fromCharCode(65 + i)}`, cc, { domain, lat: 50 + i * 0.01, lng: 1 + i * 0.01, ...o }));
test('regional units: a country/region needs 3+ active spots WITH coordinates; single-sex ponds excluded; ZA splits by region', () => {
  const spots = [...mk(3, 'FR', 'FRANCE'), ...mk(2, 'IT', 'EUROPE'), ...mk(5, 'ZA', 'ATLANTIC'), ...mk(4, 'ZA', 'KZN'), ...mk(3, 'GB', 'UK', { latitude: null, longitude: null }),
    spot('m1', 'Hampstead Mens Pond', 'GB', { domain: 'UK' }), spot('m2', 'Hampstead Ladies Pond', 'GB', { domain: 'UK' }), spot('x1', 'No country', null, {})];
  const units = regionalUnits(spots);
  assert.deepEqual(units.map((u) => u.key).sort(), ['FR', 'ZA:ATLANTIC', 'ZA:KZN']);
  assert.equal(units.find((u) => u.key === 'ZA:ATLANTIC').label, 'Atlantic Seaboard');
});
test('regional map: pages are disjoint, capped, keyed per page, and refuse a span too wide for one map', () => {
  const unit = regionalUnits(mk(9, 'FR', 'FRANCE'))[0];
  const pages = [0, 1, 2, 3].map((p) => regionalMap(unit, p));
  assert.ok(!pages[0].gap && !pages[1].gap && !pages[2].gap); assert.ok(pages[3].gap, 'page cap');
  const ids = pages.slice(0, 3).flatMap((p) => p.spots.map((s) => s.id));
  assert.equal(new Set(ids).size, 9);
  assert.equal(pages[0].sourceKey, 'region:FR:france:p1'); assert.equal(pages[0].geo.points.length, 3);
  const wide = regionalUnits([spot('a', 'A', 'US', { lat: 25, lng: -80 }), spot('b', 'B', 'US', { lat: 47, lng: -122 }), spot('c', 'C', 'US', { lat: 34, lng: -118 })])[0];
  assert.match(regionalMap(wide, 0).gap, /too wide/);
  const cap = buildCaptions(pages[0]);
  assert.ok(!/Swipe/.test(cap.facebook) && !EMOJI.test(cap.facebook) && !/\u2014/.test(cap.facebook));
});

// ── (d) crossings ──────────────────────────────────────────────────────────
const EC = { id: 'ec1', slug: 'english-channel', name: 'English Channel', is_active: true, distance_km: '33.8', start_location: 'Shakespeare Beach, Dover', end_location: 'Cap Gris-Nez, France', start_lat: '51.1172', start_lng: '1.3', end_lat: '50.87', end_lng: '1.58', qualifying_duration_minutes: 360, qualifying_temp_limit_c: '16', requires_observer: true, season_start_month: 6, season_end_month: 9, governing_body: 'Channel Swimming Association / CS&PF' };
test('crossings: qualifying (legacy key), season and route from DB columns; the conflicting temperature limit is never used', () => {
  const posts = crossingAngles(EC);
  assert.deepEqual(posts.map((p) => p.angle), ['qualifying-swim', 'season', 'route']);
  assert.equal(posts[0].sourceKey, 'crossing:ec1', 'keeps the key of the post already published on 20 Oct');
  assert.ok(posts[2].geo.route && posts[2].geo.points.length === 2);
  for (const p of posts) { assert.ok(!p.facts.some((f) => /1?6\s?(C|°)|temperature/i.test(f.text)), `${p.angle} mentions no temperature`); for (const f of p.facts) assert.ok(f.source.table === 'crossings'); }
  assert.match(posts[1].facts.find((f) => f.key === 'season').text, /June to September/);
  for (const p of posts) { const c = buildCaptions(p); assert.ok(!EMOJI.test(c.facebook) && !/\u2014/.test(c.facebook)); assert.deepEqual(ungroundedNumbers(c.facebook.replace(/https?:\/\/\S+/g, ''), p.facts, []), []); }
});
test('crossings: only populated rows produce posts; thin or empty rows produce nothing', () => {
  assert.deepEqual(crossingAngles({ id: 'x', slug: 'custom-marathon-swim', name: 'Custom', is_active: true }), []);
  const onlySeason = crossingAngles({ id: 'm', slug: 'manhattan', name: 'Manhattan', is_active: true, distance_km: 48, season_start_month: 6, season_end_month: 9, governing_body: 'MIMS' });
  assert.deepEqual(onlySeason.map((p) => p.angle), ['season']);
  assert.deepEqual(crossingAngles({ id: 'n', slug: 'n', name: 'Thin', is_active: true, distance_km: 20, season_start_month: 6, season_end_month: 9 }), [], 'name + distance + season alone is too thin');
  const robben = crossingAngles({ id: 'r', slug: 'robben-island', name: 'Robben Island', is_active: true, distance_km: 7.5, qualifying_duration_minutes: 120, requires_observer: false });
  assert.equal(robben[0].facts.find((f) => f.key === 'qualifying').text, 'A 2 hour qualifying swim is listed');
  assert.ok(!robben[0].facts.some((f) => f.key === 'observer'), 'observer only when the column says so');
});

// ── (e) partners ───────────────────────────────────────────────────────────
const PP = [
  { id: 'p1', name: 'Maurten × Art of Endurance', hero_page: '/partners/maurten', section: 'active', chip_state: 'live', logo_url: '/icons/Maurten logo.jpg', blurb: 'Precision sports nutrition: gels and drinks engineered to fuel long open water swims without GI distress.', status_note: 'Active partner, 9-month commitment confirmed' },
  { id: 'p2', name: 'FORM', hero_page: '/partners/form', section: 'coming_soon', chip_state: 'soon', blurb: 'Smart swim goggles.' },
  { id: 'p3', name: 'eo SwimBETTER', hero_page: '/partners/eolab', section: 'active', chip_state: 'soon', blurb: 'Quote.' },
  { id: 'p4', name: 'Zero BS', hero_page: '/partners/zerobs', section: 'active', chip_state: 'live', logo_url: null, blurb: 'South African tallow-based skincare.', status_note: 'products only. No member discount agreed.' },
];
test('partners: only live + active; the blurb is quoted verbatim; internal status notes never reach a post', () => {
  const cards = partnerCards(PP);
  assert.deepEqual(cards.map((c) => c.sourceKey), ['partner:maurten', 'partner:zero-bs']);
  const m = cards[0];
  assert.equal(m.facts.find((f) => f.key === 'blurb').text, PP[0].blurb);
  assert.equal(m.facts.find((f) => f.key === 'blurb').source.table, 'partner_pages');
  assert.ok(!JSON.stringify(m).includes('9-month') && !JSON.stringify(cards[1]).includes('discount agreed'));
  const cap = buildCaptions(m);
  assert.ok(cap.facebook.includes(PP[0].blurb) && !EMOJI.test(cap.facebook) && !/\u2014/.test(cap.facebook));
  assert.equal(validatePost(m, { now: NOW }).risk, 'AUTO_ELIGIBLE');
});

// ── rendering inputs ───────────────────────────────────────────────────────
test('fonts are bundled: no Google Fonts request anywhere in the templates, files present, @font-face embedded', () => {
  const src = readFileSync(new URL('../api/_lib/social/templates.js', import.meta.url), 'utf8');
  assert.ok(!/googleapis|gstatic/.test(src));
  assert.ok(existsSync(new URL('../api/_lib/social/fonts/BebasNeue-latin.woff2', import.meta.url)) && existsSync(new URL('../api/_lib/social/fonts/DMSans-latin.woff2', import.meta.url)));
  const css = fontCss(); assert.match(css, /font-family:'Bebas Neue'/); assert.match(css, /font-family:'DM Sans'/); assert.match(css, /data:font\/woff2;base64,/);
  const post = conditionsWeekly(ROWS, SPOTS, { now: NOW });
  assert.match(renderHtml(post, { logo: 'data:,' })[0], /@font-face/);
});
test('every new series renders a legacy graphic and visual copy without throwing', () => {
  const posts = [conditionsWeekly(ROWS, SPOTS, { now: NOW }), regionalMap(regionalUnits(mk(3, 'FR', 'FRANCE'))[0], 0), ...crossingAngles(EC), ...partnerCards(PP)];
  for (const p of posts) { assert.ok(renderHtml(p, { logo: 'data:,', partnerLogo: null })[0].length > 500, p.sourceKey); assert.ok(visualCopy(p).headline, p.sourceKey); }
});

// ── planner ────────────────────────────────────────────────────────────────
const cand = (group, key, o = {}) => ({ group, key, evergreen: o.evergreen ?? true, lateBinding: !!o.late, generator: !!o.generator, build: async () => o.post ?? post(group, key, o) });
const CAT = { explore: CATEGORIES.THIS_WEEK, locations: CATEGORIES.DISCOVERS, crossings: CATEGORIES.CROSSING_INTELLIGENCE, ocean: CATEGORIES.OPEN_WATER_INTEL, partners: CATEGORIES.BEHIND_THE_BRAND };
function post(group, key, o = {}) {
  return { category: CAT[group], angle: 'x', sourceKey: key, sourceUrl: 'https://www.swimloading.com/x', facts: [{ key: 'name', text: key, source: { table: 'spots' }, kind: 'evergreen', observedAt: null }],
    ...(group === 'partners' ? { partner: { name: key, chipState: 'live' } } : {}), ...(o.review ? { richness: 'thin' } : {}), image: { url: null, licenceVerified: true } };
}
const pool = (spec) => { const p = { explore: [], locations: [], crossings: [], ocean: [], partners: [], clubsAndPlatform: [] }; for (const [g, list] of Object.entries(spec)) p[g] = list; return p; };
const many = (g, n, o) => Array.from({ length: n }, (_, i) => cand(g, `${g}-${i}`, o));
const run = (spec, over = {}) => runAutopilot({ pool: pool(spec), posts: [], now: NOW, ...over });

test('planner: nothing is written without realise (dry run), and the plan covers only the next 14 days of Tue/Thu/Sat slots', async () => {
  const r = await run({ locations: many('locations', 12), crossings: many('crossings', 12), explore: many('explore', 12) });
  const slots = r.plan.map((p) => p.slot);
  assert.ok(slots.length >= 5 && slots.length <= 6);
  for (const s of slots) { const d = new Date(new Date(s).getTime() + 2 * 3600e3); assert.ok([2, 4, 6].includes(d.getUTCDay()) && d.getUTCHours() === 10); assert.ok(new Date(s) - NOW <= 14 * 86400e3); }
});
test('planner: follows the configured mix over a window (30/25/15/10/10/10) and redistributes the share of an empty group', async () => {
  assert.equal(pickGroup({}, SOCIAL_DEFAULTS.mix, new Set(['explore', 'locations', 'crossings'])), 'explore');
  const c = { explore: 3, locations: 3, crossings: 1, ocean: 1, partners: 1, clubsAndPlatform: 0 };
  assert.equal(pickGroup(c, SOCIAL_DEFAULTS.mix, new Set(['explore', 'locations', 'crossings', 'ocean', 'partners', 'clubsAndPlatform'])), 'clubsAndPlatform');
  assert.equal(pickGroup(c, SOCIAL_DEFAULTS.mix, new Set(['explore', 'locations', 'crossings', 'ocean', 'partners'])), 'crossings', 'with no clubs supply the next-most-owed group is chosen');
  // simulate 20 slots: counts stay within one post of target
  let counts = {}; const avail = new Set(['explore', 'locations', 'crossings', 'ocean', 'partners', 'clubsAndPlatform']);
  for (let i = 0; i < 20; i++) { const g = pickGroup(counts, SOCIAL_DEFAULTS.mix, avail); counts[g] = (counts[g] || 0) + 1; }
  for (const [g, share] of Object.entries(SOCIAL_DEFAULTS.mix)) assert.ok(Math.abs((counts[g] || 0) - share * 20) <= 1, `${g}: ${counts[g]} vs ${share * 20}`);
});
test('planner: 90-day dedupe against social_posts AND the manual Facebook ledger; rejected rows do not count', async () => {
  const posts = [{ source_key: 'locations-0', status: 'SCHEDULED', created_at: hoursAgo(24 * 30), scheduled_for: hoursAgo(-24 * 3), category: CAT.locations },
    { source_key: 'locations-1', status: 'REJECTED', created_at: hoursAgo(24 * 10), category: CAT.locations },
    { source_key: 'locations-3', status: 'PUBLISHED', created_at: hoursAgo(24 * 200), scheduled_for: hoursAgo(24 * 100), category: CAT.locations }];
  const r = await run({ locations: many('locations', 5) }, { posts, ledgerKeys: { 'locations-2': hoursAgo(24 * 5) } });
  const keys = r.plan.filter((p) => p.action === 'schedule').map((p) => p.key);
  assert.ok(!keys.includes('locations-0') && !keys.includes('locations-2'), 'recent DB row and ledger entry are not reused');
  assert.ok(keys.includes('locations-1') || keys.includes('locations-3'), 'rejected, and older than 90 days, are usable again');
});
test('ledger: publish-ledger ids are mapped to source keys through posts.json', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ledger-'));
  writeFileSync(join(dir, 'publish-ledger.json'), JSON.stringify({ 'fb:3-crossing-english-channel': { facebookId: 'x', at: '2026-10-20T17:18:10.428Z' } }));
  writeFileSync(join(dir, 'posts.json'), JSON.stringify({ posts: [{ id: '3-crossing-english-channel', sourceKey: 'crossing:8c08' }] }));
  assert.deepEqual(loadLedgerKeys(dir), { 'crossing:8c08': '2026-10-20T17:18:10.428Z' });
  assert.deepEqual(loadLedgerKeys(join(dir, 'nope')), {});
  const m = recentKeyMap([], loadLedgerKeys(dir)); assert.ok(m['crossing:8c08']);
});
test('planner: partner cap, no un-capped partner posts', async () => {
  assert.ok(!partnerAllowed({ explore: 1, partners: 1 }), '1 of 3 = 33%: refused');
  assert.ok(partnerAllowed({ explore: 5, locations: 4, crossings: 3, ocean: 1, partners: 0 }));
  assert.ok(!partnerAllowed({ explore: 9, locations: 9, partners: 2 }), '(2+1)/(20+1) > 10%');
  const full = Array.from({ length: 12 }, (_, i) => ({ source_key: `k${i}`, status: 'PUBLISHED', category: i < 2 ? CAT.partners : CAT.locations, created_at: hoursAgo(24 * (i + 1)), scheduled_for: hoursAgo(24 * (i + 1)) }));
  const r = await run({ partners: many('partners', 4, { evergreen: false }), locations: many('locations', 4) }, { posts: full });
  assert.ok(!r.plan.some((p) => p.group === 'partners' && p.action === 'schedule'), 'already at the cap: no more partner posts');
});
test('planner: never pads. With no usable content a slot stays empty', async () => {
  const r = await run({}, {});
  assert.ok(r.plan.length > 0 && r.plan.every((p) => p.action === 'left-empty'));
  const gaps = await run({ locations: [cand('locations', 'g1', { post: { gap: 'thin' } })] });
  assert.ok(gaps.plan.every((p) => p.action === 'left-empty'));
});
test('planner: REVIEW_REQUIRED goes to review and never takes a slot; another candidate fills it', async () => {
  const made = [];
  const realise = async (p, o) => { made.push({ key: p.sourceKey, ...o }); return { ok: true }; };
  const r = await run({ locations: [cand('locations', 'a-thin', { post: post('locations', 'a-thin', { review: true }) }), ...many('locations', 3)] }, { realise });
  const review = r.plan.filter((p) => p.action === 'pending-review');
  assert.equal(review.length, 1); assert.equal(review[0].key, 'a-thin');
  assert.ok(made.find((m) => m.key === 'a-thin').review && made.find((m) => m.key === 'a-thin').slotIso === null);
  assert.ok(r.plan.filter((p) => p.action === 'schedule').length >= 1, 'schedule is not blocked');
  assert.ok(!r.plan.some((p) => p.action === 'schedule' && p.key === 'a-thin'));
});
test('planner: review items per run are capped', async () => {
  const thin = Array.from({ length: 8 }, (_, i) => cand('locations', `t-${i}`, { post: post('locations', `t-${i}`, { review: true }) }));
  const r = await run({ locations: thin });
  assert.ok(r.plan.filter((p) => p.action === 'pending-review').length <= SOCIAL_DEFAULTS.autopilot.reviewPerRun);
});
test('planner: conditions are late-bound: held while the slot is >30 h away, built once it is inside the window', async () => {
  const ocean = [cand('ocean', 'conditions:generator', { late: true, generator: true, evergreen: false, post: { ...post('ocean', 'conditions:2026-W43'), facts: [{ key: 'r0.temp', text: '18.0 C', source: { table: 'spot_conditions_live' }, kind: 'time_sensitive', observedAt: hoursAgo(1) }] } })];
  const only = { ocean };
  const far = await run(only, { cfg: { ...SOCIAL_DEFAULTS, mix: { ...SOCIAL_DEFAULTS.mix, ocean: 1 } } });
  assert.ok(far.plan.some((p) => p.action === 'held-for-conditions'));
  const near = await run(only, { now: new Date('2026-10-23T08:00:00Z'), cfg: { ...SOCIAL_DEFAULTS, mix: { ...SOCIAL_DEFAULTS.mix, ocean: 1 } } });   // Fri; Sat slot is 26 h away
  const first = near.plan[0];
  assert.equal(first.slot, '2026-10-24T08:00:00.000Z'); assert.equal(first.action, 'schedule'); assert.equal(first.group, 'ocean');
});
test('planner: occupied slots (any DB timestamp format) are respected; approved-but-unslotted posts are slotted first', async () => {
  const posts = [{ source_key: 'booked', status: 'SCHEDULED', created_at: '2026-10-20 10:00:00+00', scheduled_for: '2026-10-22 08:00:00+00', category: CAT.explore },
    { id: 'w1', source_key: 'waiting', status: 'APPROVED', is_reserve: false, scheduled_for: null, created_at: '2026-10-19T10:00:00Z', expires_at: null, category: CAT.crossings }];
  const assigned = [];
  const r = await run({ locations: many('locations', 5) }, { posts, assignExisting: async (p, s) => assigned.push([p.id, s]) });
  assert.ok(!r.plan.some((p) => p.slot === '2026-10-22T08:00:00.000Z'), 'booked slot not touched');
  assert.equal(r.plan[0].action, 'assign-existing'); assert.equal(assigned[0][0], 'w1'); assert.equal(assigned[0][1], r.plan[0].slot);
});
test('planner: reserves are topped up to the minimum from evergreen content, never from partners, and a shortfall is reported', async () => {
  const built = [];
  const realise = async (p, o) => { if (o.reserve) built.push(p.sourceKey); return { ok: true }; };
  const r = await run({ locations: many('locations', 10), crossings: many('crossings', 10), partners: many('partners', 5, { evergreen: false }) }, { realise });
  assert.equal(r.reserves.have, 0);
  assert.equal(built.length, 6); assert.ok(!built.some((k) => k.startsWith('partners')));
  assert.equal(r.reserves.shortfall, 0);
  const poor = await run({ locations: many('locations', 1) }, { posts: [] });
  assert.ok(poor.reserves.shortfall > 0 && poor.notes.some((n) => /Reserve queue/.test(n)));
  const enough = await run({ locations: many('locations', 6) }, { posts: Array.from({ length: 6 }, (_, i) => ({ source_key: `res${i}`, status: 'APPROVED', is_reserve: true, risk: 'AUTO_ELIGIBLE', created_at: hoursAgo(5), category: CAT.locations })) });
  assert.equal(enough.reserves.needed, 0);
});
test('planner: a candidate that throws becomes a reported gap, not a crash', async () => {
  const bad = { group: 'locations', key: 'boom', evergreen: true, generator: false, lateBinding: false, build: async () => { throw new Error('fact needs key and text'); } };
  const r = await run({ locations: [bad, ...many('locations', 3)] });
  assert.ok(r.plan.some((p) => p.action === 'schedule'));
});
test('explore events already in a recent post are excluded from the next one', () => {
  const posts = [{ status: 'SCHEDULED', created_at: hoursAgo(24), scheduled_for: hoursAgo(-24), facts: [{ source: { table: 'event_editions', row: 'e1' } }] }, { status: 'REJECTED', created_at: hoursAgo(24), facts: [{ source: { table: 'event_editions', row: 'e2' } }] }, { status: 'PUBLISHED', created_at: hoursAgo(24 * 40), scheduled_for: hoursAgo(24 * 40), facts: [{ source: { table: 'event_editions', row: 'e3' } }] }];
  assert.deepEqual([...recentEventIds(posts, NOW)], ['e1']);
});
test('every category the engine can produce belongs to a mix group', () => {
  for (const c of [CATEGORIES.THIS_WEEK, CATEGORIES.SWIM_SPOTLIGHT, CATEGORIES.DISCOVERS, CATEGORIES.CROSSING_INTELLIGENCE, CATEGORIES.OPEN_WATER_INTEL, CATEGORIES.BEHIND_THE_BRAND]) assert.ok(MIX_GROUP[c], c);
  assert.deepEqual(Object.keys(SOCIAL_DEFAULTS.mix).sort(), [...new Set(Object.values(MIX_GROUP))].sort());
});

test('buildPool: supply per group from fixtures (no network, nothing built yet)', async () => {
  const data = { spots: async () => [...mk(9, 'FR', 'FRANCE'), ...mk(3, 'CH', 'EUROPE')], conditionSpots: async () => [], conditions: async () => [], crossings: async () => [EC], partners: async () => PP };
  const p = await buildPool(data, { now: NOW });
  assert.equal(p.locations.filter((c) => c.key.startsWith('region:')).length, 4);       // FR 3 pages + CH 1
  assert.equal(p.crossings.length, 3); assert.equal(p.partners.length, 2); assert.ok(p.explore.length === 1 && p.ocean.length === 1);
  assert.equal(p.clubsAndPlatform.length, 0);
});

test('DRY RUN against a fake store writes nothing and uses no network', async () => {
  const realFetch = globalThis.fetch; let calls = 0;
  globalThis.fetch = async () => { calls++; throw new Error('no network in tests'); };
  try {
    const writes = [];
    const store = { rest: async (path, init = {}) => { if (init.method && init.method !== 'GET') writes.push(path); return []; }, update: async () => { writes.push('update'); } };
    const snapshot = { spots: [...mk(6, 'FR', 'FRANCE')], crossings: [EC], partner_pages: PP, conditions: [], social_posts: [] };
    const r = await runWeekly({ store, snapshot, dry: true, now: NOW, ledgerDir: '/nonexistent' });
    assert.equal(r.dry, true); assert.deepEqual(writes, []);
    assert.ok(r.plan.some((p) => p.action === 'schedule'));
  } finally { globalThis.fetch = realFetch; }
});
test('the autopilot cron is not registered in vercel.json (ships dormant) but has maxDuration set', () => {
  const v = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));
  assert.ok(!v.crons.some((c) => /social-generate/.test(c.path)));
  assert.ok(v.functions['api/cron/social-generate.js'].maxDuration >= 120);
  assert.match(v.functions['api/cron/social-generate.js'].includeFiles, /chromium/);
});
