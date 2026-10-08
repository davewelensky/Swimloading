import test from 'node:test';
import assert from 'node:assert/strict';
import '../test-programme-lib.js';

const L = globalThis.TestProgramme;

// ── fixtures: a tiny programme, built only from rows a swimmer could have logged ──
const BLADE = { id: 'p-blade', name: 'Blade', category: 'wetsuit', status: 'early_testing', sort_order: 1 };
const C1 = { id: 'p-c1', name: 'Costume 01', group_label: 'Training Swimwear', category: 'training_swimwear', status: 'active_testing', sort_order: 2 };
const C2 = { id: 'p-c2', name: 'Costume 02', group_label: 'Training Swimwear', category: 'training_swimwear', status: 'active_testing', sort_order: 3 };
const GOG = { id: 'p-gog', name: 'Goggles', category: 'goggles', status: 'available', sort_order: 4 };
const RACE = { id: 'p-race', name: 'Racing Suit', category: 'racing_swimwear', status: 'awaiting_product', sort_order: 5 };
const REF = { id: 'p-ref', name: 'Other Suit', category: 'wetsuit', status: 'active_testing', is_reference: true, sort_order: 6 };
const PRODUCTS = [BLADE, C1, C2, GOG, RACE, REF];

const rating = (s, p, criterion, score, visibility = 'private') => ({ session_id: s, product_id: p, kind: 'rating', criterion, score, visibility });
const issue = (s, p, criterion, visibility = 'private') => ({ session_id: s, product_id: p, kind: 'issue', criterion, score: null, visibility });
const note = (s, p, text, visibility = 'private') => ({ session_id: s, product_id: p, kind: 'note', criterion: 'athlete_note', note: text, visibility });

function data() {
  const sessions = [
    { id: 's1', session_date: '2026-10-04', environment: 'sea', distance_km: 2, duration_seconds: 3600, water_temp_c: 14, conditions: 'flat', rpe: 5 },
    { id: 's2', session_date: '2026-10-06', environment: 'sea', distance_km: 3, duration_seconds: 5400, water_temp_c: 15, conditions: 'light_chop', rpe: 6 },
    { id: 's3', session_date: '2026-10-07', environment: 'pool', distance_km: 5, duration_seconds: 5400, water_temp_c: null, rpe: 7 },
  ];
  const sessionProducts = [
    { session_id: 's1', product_id: 'p-blade' }, { session_id: 's2', product_id: 'p-blade' },
    { session_id: 's1', product_id: 'p-gog' }, { session_id: 's3', product_id: 'p-c1' }, { session_id: 's3', product_id: 'p-gog' },
  ];
  return { sessions, sessionProducts, observations: [] };
}

test('every category: unique keys, labelled endpoints on every rating, safe issue keys', () => {
  for (const [name, cat] of Object.entries(L.CATEGORIES)) {
    const keys = cat.ratings.map((r) => r.key);
    assert.equal(new Set(keys).size, keys.length, `${name}: duplicate rating key`);
    for (const r of cat.ratings) {
      assert.match(r.key, /^[a-z0-9_]{2,40}$/, `${name}.${r.key} must satisfy the DB criterion check`);
      assert.ok(r.low && r.high && r.label, `${name}.${r.key} needs endpoint labels so 1 vs 5 is never ambiguous`);
    }
    for (const i of cat.issues) assert.match(i.key, /^[a-z0-9_]{2,40}$/);
    assert.ok(cat.ratings.some((r) => r.core), `${name} needs at least one core question`);
  }
  assert.equal(L.CATEGORIES.racing_swimwear.noPerformanceClaims, true);
  // the five categories Dave listed all exist
  ['wetsuit', 'training_swimwear', 'goggles', 'cap', 'racing_swimwear'].forEach((c) => assert.ok(L.CATEGORIES[c], c));
});

test('different products do not share one questionnaire', () => {
  const wet = L.CATEGORIES.wetsuit.ratings.map((r) => r.key), cap = L.CATEGORIES.cap.ratings.map((r) => r.key);
  assert.ok(wet.includes('shoulder_freedom') && !cap.includes('shoulder_freedom'));
  assert.ok(L.CATEGORIES.training_swimwear.ratings.some((r) => r.key === 'shape_retention'));
  assert.ok(L.CATEGORIES.goggles.ratings.some((r) => r.key === 'fogging'));
  assert.ok(L.CATEGORIES.cap.ratings.length <= 6, 'the cap stays lightweight');
});

test('"None" is exclusive in the issue toggles', () => {
  assert.deepEqual(L.toggleIssue([], 'neck_chafing'), ['neck_chafing']);
  assert.deepEqual(L.toggleIssue(['neck_chafing', 'cold'], 'none'), ['none']);
  assert.deepEqual(L.toggleIssue(['none'], 'cold'), ['cold']);
  assert.deepEqual(L.toggleIssue(['none'], 'none'), []);
  assert.deepEqual(L.toggleIssue(['cold'], 'cold'), []);
});

test('validation: a first-impression session can be saved partial, bad numbers cannot', () => {
  const first = L.validateSession({ products: [{ product_id: 'p-blade', ratings: [{ criterion: 'fit', score: 5 }] }] });
  assert.equal(first.ok, true);
  assert.equal(first.dataStatus, 'partial');
  assert.match(first.warnings[0], /Still to add: date, distance/);
  const bad = L.validateSession({ products: [{ ratings: [{ criterion: 'fit', score: 6 }] }], water_temp_c: 99, rpe: 11, distance_km: -1 });
  assert.equal(bad.ok, false);
  assert.ok(bad.errors.length >= 4);
  assert.equal(L.validateSession({ products: [] }).ok, false, 'a session needs a product');
  assert.equal(L.validateSession({ products: [{ ratings: [{ score: 3.5 }] }] }).ok, false, 'whole numbers only');
  const full = L.validateSession({ session_date: '2026-10-04', environment: 'sea', distance_km: 2, water_temp_c: 14, products: [{ ratings: [] }] });
  assert.equal(full.dataStatus, 'complete');
});

test('one session counts toward every product used, without duplicating the swim', () => {
  const d = data();
  const blade = L.productUsage('p-blade', d), gog = L.productUsage('p-gog', d), c1 = L.productUsage('p-c1', d);
  assert.equal(blade.uses, 2); assert.equal(blade.km, 5); assert.equal(blade.hours, 2.5);
  assert.equal(gog.uses, 2); assert.equal(gog.km, 7);
  assert.equal(c1.uses, 1); assert.equal(c1.pool, 1); assert.equal(c1.chlorineExposures, 1); assert.equal(c1.seaExposures, 0);
  assert.equal(blade.tempMin, 14); assert.equal(blade.tempMax, 15); assert.equal(blade.longestKm, 3);
  const prog = L.programmeSummary(PRODUCTS, d);
  assert.equal(prog.sessions, 3, 'three swims, not eight product-uses');
  assert.equal(prog.km, 10);
  assert.equal(prog.pool, 1); assert.equal(prog.openWater, 2);
});

test('per-product usage override beats the session total (e.g. wetsuit for part of a swim)', () => {
  const d = data(); d.sessionProducts[0] = { session_id: 's1', product_id: 'p-blade', usage_km: 1.2, usage_seconds: 1800 };
  const u = L.productUsage('p-blade', d);
  assert.equal(u.km, 4.2); assert.equal(u.hours, 2);
});

test('missing distance is not counted as zero: totals say how many uses they are based on', () => {
  const d = data(); d.sessions[1].distance_km = null;
  const u = L.productUsage('p-blade', d);
  assert.equal(u.uses, 2); assert.equal(u.km, 2); assert.equal(u.kmKnownOn, 1);
});

test('no average is shown until there are enough sessions; consistency is only claimed with evidence', () => {
  const d = data();
  d.observations = [rating('s1', 'p-blade', 'shoulder_freedom', 5), rating('s2', 'p-blade', 'shoulder_freedom', 5)];
  assert.equal(L.ratingSummary('p-blade', d).shoulder_freedom.avg, null);
  assert.equal(L.ratingSummary('p-blade', d).shoulder_freedom.consistent, false);
  d.sessions.push({ id: 's4' }); d.observations.push(rating('s4', 'p-blade', 'shoulder_freedom', 4));
  const r = L.ratingSummary('p-blade', d).shoulder_freedom;
  assert.equal(r.n, 3); assert.equal(r.avg, 4.7); assert.equal(r.consistent, true);
});

test('issues: an unanswered session is NOT counted as "no issues"', () => {
  const d = data();
  d.observations = [issue('s1', 'p-blade', 'none')];   // s2 was never answered
  let inc = L.issueIncidence('p-blade', d);
  assert.equal(inc.sessionsAnswered, 1);
  assert.equal(inc.kmAnswered, 2);
  assert.match(L.incidenceLine(L.productProfile(BLADE, d), ['neck_chafing', 'underarm_chafing'], 'chafing'), /^0 chafing incidents across 1 answered session \(2 km\)$/);
  d.observations.push(issue('s2', 'p-blade', 'neck_chafing'));
  inc = L.issueIncidence('p-blade', d);
  assert.equal(inc.counts.neck_chafing, 1); assert.equal(inc.sessionsAnswered, 2);
  assert.equal(L.incidenceLine(L.productProfile({ ...BLADE }, { sessions: [], sessionProducts: [], observations: [] }), ['neck_chafing'], 'chafing'), null, 'no answers means no claim at all');
});

test('findings: nothing is concluded from too little evidence, and nothing positive is invented', () => {
  const d = data();
  d.observations = [rating('s1', 'p-blade', 'fit', 5), rating('s2', 'p-blade', 'fit', 5)];
  const f = L.findings(L.productProfile(BLADE, d));
  assert.equal(f.enough, false);
  assert.match(f.statement, /Not enough evidence yet/);
  assert.deepEqual(f.positives, []);
});

test('findings: positives and concerns both surface once there is enough evidence', () => {
  const d = data(); d.sessions.push({ id: 's4' });
  ['s1', 's2', 's4'].forEach((s) => { d.sessionProducts.push(...(s === 's4' ? [{ session_id: 's4', product_id: 'p-blade' }] : [])); });
  d.observations = ['s1', 's2', 's4'].flatMap((s) => [rating(s, 'p-blade', 'shoulder_freedom', 5), rating(s, 'p-blade', 'warmth', 2), issue(s, 'p-blade', s === 's2' ? 'water_ingress' : 'none')]);
  const f = L.findings(L.productProfile(BLADE, d));
  assert.equal(f.enough, true);
  assert.ok(f.positives.some((p) => /Shoulder freedom averages 5.0 \/ 5 across 3 swims \(consistent\)/.test(p.text)));
  assert.ok(f.observations.some((o) => /Warmth averages 2.0/.test(o.text)), 'low scores are recorded, not hidden');
  assert.ok(f.observations.some((o) => /Water ingress reported in 1 of 3 sessions/.test(o.text)));
});

test('publishable report contains ONLY admin-published observations; private notes never leak', () => {
  const d = data(); d.sessions.push({ id: 's4' }); d.sessionProducts.push({ session_id: 's4', product_id: 'p-blade' });
  d.sessions[0].athlete_note = 'PRIVATE SESSION NOTE';
  d.observations = ['s1', 's2', 's4'].flatMap((s) => [rating(s, 'p-blade', 'fit', 5, 'publishable'), rating(s, 'p-blade', 'warmth', 2, 'private'), note(s, 'p-blade', 'secret criticism ' + s, 'private')]);
  d.observations.push(note('s1', 'p-blade', 'ok to share', 'publishable'));
  const pub = L.buildReport(PRODUCTS, d, 'publishable'), priv = L.buildReport(PRODUCTS, d, 'private');
  const bladePub = pub.sections.find((s) => s.name === 'Blade'), bladePriv = priv.sections.find((s) => s.name === 'Blade');
  assert.ok(bladePub.profile.ratings.fit, 'published rating present');
  assert.equal(bladePub.profile.ratings.warmth, undefined, 'private rating absent from the publishable report');
  assert.deepEqual(bladePub.profile.notes.map((n) => n.note), ['ok to share']);
  assert.ok(bladePriv.profile.ratings.warmth, 'the private report is candid');
  assert.equal(bladePriv.profile.notes.length, 4);
  assert.doesNotMatch(JSON.stringify(pub), /PRIVATE SESSION NOTE|secret criticism/);
});

test('garage: the five costumes collapse into one card; reference suits are not in the garage', () => {
  const g = L.garage(PRODUCTS);
  assert.deepEqual(g.map((x) => x.name), ['Blade', 'Training Swimwear', 'Goggles', 'Racing Suit']);
  const costumes = g.find((x) => x.isGroup);
  assert.deepEqual(costumes.ids, ['p-c1', 'p-c2']);
  const d = data(); d.sessionProducts.push({ session_id: 's1', product_id: 'p-c2' });
  assert.equal(L.productProfile(costumes, d).usage.uses, 2, 'group usage sums its members');
});

test('evidence stage: costumes follow 1 / 10 / 25 / 50 uses; wetsuit needs a long swim before "Distance"', () => {
  const stage = (uses, extra = {}) => L.evidenceStage(C1, { uses, longestKm: null, ...extra }, false).label;
  assert.equal(stage(0), 'Not yet tested'); assert.equal(stage(1), '1 use'); assert.equal(stage(10), '10 uses'); assert.equal(stage(26), '25 uses'); assert.equal(stage(50), '50 uses');
  const w = (uses, longestKm, cmp = false) => L.evidenceStage(BLADE, { uses, longestKm }, cmp).label;
  assert.equal(w(1, 2), 'First impression'); assert.equal(w(3, 2), 'Familiarisation'); assert.equal(w(8, 3), 'Familiarisation');
  assert.equal(w(8, 6), 'Distance'); assert.equal(w(8, 6, true), 'Controlled comparison');
});

test('next priorities come from what has NOT been tested', () => {
  const d = data();
  const pr = L.nextPriorities(L.productProfile(BLADE, d), d);
  assert.ok(pr.some((x) => /longer swim than 3 km/i.test(x)));
  assert.ok(pr.some((x) => /Colder water than 14/.test(x)));
  assert.ok(pr.some((x) => /race-intensity/i.test(x)), 'max RPE logged is 6');
  assert.ok(pr.some((x) => /controlled comparison/i.test(x)));
  d.sessions[0].comparison_group_id = 'g1';
  assert.ok(!L.nextPriorities(L.productProfile(BLADE, d), d).some((x) => /controlled comparison/i.test(x)));
  assert.deepEqual(L.nextPriorities(L.productProfile(RACE, d), d), ['Awaiting product. Testing starts when it is received.']);
  assert.deepEqual(L.nextPriorities(L.productProfile(GOG, { sessions: [], sessionProducts: [], observations: [] }), d), ['No use logged yet. Log a first session.']);
});

test('controlled comparison: observed vs perception are separate, and unlike-for-like is flagged', () => {
  const d = { sessions: [
    { id: 'a', comparison_group_id: 'g', session_date: '2026-10-10', location: 'Clifton', distance_km: 2, water_temp_c: 14, conditions: 'flat', avg_pace_sec_per_100m: 105, vs_expectation: 'better', confidence: 'high', athlete_note: 'felt great' },
    { id: 'b', comparison_group_id: 'g', session_date: '2026-10-12', location: 'Clifton', distance_km: 2, water_temp_c: 14.5, conditions: 'flat', avg_pace_sec_per_100m: 107 },
  ], sessionProducts: [{ session_id: 'a', product_id: 'p-blade' }, { session_id: 'b', product_id: 'p-ref' }], observations: [rating('a', 'p-blade', 'shoulder_freedom', 5), rating('b', 'p-ref', 'shoulder_freedom', 3)] };
  const c = L.compareGroup('g', PRODUCTS, d);
  assert.equal(c.likeForLike, true);
  assert.equal(c.arms[0].observed.pace_sec_per_100m, 105);
  assert.equal(c.arms[0].perception.ratings['p-blade'].shoulder_freedom, 5);
  assert.equal(c.arms[0].observed.ratings, undefined, 'perception never sits inside observed data');
  assert.deepEqual(c.arms.map((a) => a.suits), [['Blade'], ['Other Suit']]);
  assert.match(c.caution, /not evidence/);
  d.sessions[1].water_temp_c = 18; d.sessions[1].conditions = 'rough'; d.sessions[1].location = 'Muizenberg';
  const bad = L.compareGroup('g', PRODUCTS, d);
  assert.equal(bad.likeForLike, false);
  assert.ok(bad.warnings.some((w) => /Water temperature differs by 4/.test(w)));
  assert.ok(bad.warnings.some((w) => /conditions differ/i.test(w)));
  assert.ok(bad.warnings.some((w) => /Location differs/.test(w)));
  assert.match(L.compareGroup('missing', PRODUCTS, d).warnings[0], /at least two sessions/);
});

test('market evidence is its own stream and never touches product numbers', () => {
  const m = L.marketSummary([{ signal_type: 'where_to_buy', count: 3 }, { signal_type: 'where_to_buy', count: 2 }, { signal_type: 'sizing_question', count: 1 }]);
  assert.equal(m.byType.where_to_buy, 5); assert.equal(m.byType.club_enquiry, 0); assert.equal(m.total, 6);
  const before = JSON.stringify(L.programmeSummary(PRODUCTS, data()));
  L.marketSummary([{ signal_type: 'page_views', count: 999 }]);
  assert.equal(JSON.stringify(L.programmeSummary(PRODUCTS, data())), before);
});

test('strava draft: local date, pace from moving time, never a water temperature, no guessed environment', () => {
  const d = L.stravaToDraft({ id: 'imp1', start_date: '2026-10-04T22:30:00Z', start_date_local: '2026-10-05T00:30:00Z', distance_m: 2500, moving_time_seconds: 3000, elapsed_time_seconds: 3300, average_heartrate: 141.6, average_temp: 21 });
  assert.equal(d.session_date, '2026-10-05', 'local date, not UTC');
  assert.equal(d.distance_km, 2.5); assert.equal(d.duration_seconds, 3000); assert.equal(d.avg_pace_sec_per_100m, 120); assert.equal(d.avg_hr, 142);
  assert.equal(d.water_temp_c, undefined, 'a device temperature is not the water temperature');
  assert.equal(d.environment, undefined);
  assert.equal(L.stravaToDraft({ id: 'x', distance_m: 1000, moving_time_seconds: 1200 }, { name: 'Clifton 4th', type: 'OCEAN' }).environment, 'sea');
  assert.equal(L.stravaToDraft({ id: 'x' }, { name: 'Pool', type: 'POOL' }).environment, 'pool');
  assert.equal(L.stravaToDraft(null), null);
});

test('formatters and parsers', () => {
  assert.equal(L.fmtPace(105), '1:45'); assert.equal(L.fmtPace(119.6), '2:00'); assert.equal(L.fmtPace(null), null);
  assert.equal(L.fmtDuration(3900), '1h 05m'); assert.equal(L.fmtDuration(600), '10m');
  assert.equal(L.parseDuration('1:05:30'), 3930); assert.equal(L.parseDuration('45:10'), 2710); assert.equal(L.parseDuration('45'), 2700); assert.equal(L.parseDuration('abc'), null); assert.equal(L.parseDuration(''), null);
  assert.equal(L.parsePace('1:45'), 105); assert.equal(L.parsePace('105'), null);
});

test('programme summary on an empty programme is honest zeros and nulls, never invented', () => {
  const s = L.programmeSummary(PRODUCTS, { sessions: [], sessionProducts: [], observations: [] });
  assert.equal(s.sessions, 0); assert.equal(s.km, 0); assert.equal(s.tempMin, null); assert.equal(s.longestKm, null);
  assert.equal(s.productsInTest, 2, 'Blade + the costume group are in test by status; goggles/cap/racing are not');
});
