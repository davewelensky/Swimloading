// Hand-path charts (stroke path, consistency, hand path & power): coach-confirmed chart reads, EO's own mappings, and a double-read suggestion step. Synthetic data.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyse } from '../aquasharks-lab/analysis/engine.js';
import { renderReport } from '../aquasharks-lab/analysis/report-view.js';
import { setHandPathField } from '../aquasharks-lab/analysis/hand-path.js';
import { agreeRange, agreeCategory, reconcileReads, suggestHandPath, MAX_RANGE_WIDTH_CM } from '../aquasharks-lab/analysis/parser/hand-path-vision.js';
import { makeAdminHandler } from '../api/_lib/lab-report/handlers.js';
import { memoryStore } from '../api/_lib/lab-report/store.js';
import { cleanForStorage } from '../api/_lib/lab-report/workflow.js';
import { testSwimmerA as A } from '../aquasharks-lab/analysis/fixtures/test-swimmer-a-200m.js';

const clone = (x) => JSON.parse(JSON.stringify(x));
const by = (r, id) => r.findings.find((f) => f.ruleId === id);
const text = (h) => h.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

// ------------------------------------------------------------------ writing a reading
test('a reading is recorded as a coach-confirmed CHART_READ: ranges stay ranges, bad values are refused', () => {
  const a = clone(A);
  assert.equal(setHandPathField(a, 'left.maxDepthCm', [60, 75]), true);
  const d = a.handPathReading.left.maxDepthCm;
  assert.deepEqual([d.value, d.range, d.approximate, d.provenance.origin], [null, [60, 75], true, 'CHART_READ']);
  assert.match(d.provenance.note, /confirmed by the coach/);
  assert.equal(setHandPathField(a, 'right.maxWidthCm', 62), true); assert.equal(a.handPathReading.right.maxWidthCm.approximate, true, 'a single chart read is still approximate');
  for (const bad of [[75, 60], [-1, 5], [10, 999], 'x', NaN]) assert.equal(setHandPathField(a, 'left.maxWidthCm', bad), false, JSON.stringify(bad));
  assert.equal(setHandPathField(a, 'left.spread', 'TERRIBLE'), false); assert.equal(setHandPathField(a, 'nonsense.field', 1), false);
  assert.equal(setHandPathField(a, 'left.maxDepthCm', null), true); assert.equal(a.handPathReading.left.maxDepthCm.status, 'MISSING');
});

// ------------------------------------------------------------------ EO's mappings, from what the coach recorded
function withPath(fill) { const a = clone(A); for (const [f, v] of Object.entries(fill)) assert.ok(setHandPathField(a, f, v), f); return a; }
test('nothing is found, and nothing is shown, until a coach has recorded a reading', () => {
  const r = analyse(A, 'COACH');
  for (const id of ['HAND_PATH_CROSSOVER', 'HAND_PATH_WRIST', 'HAND_PATH_CONSISTENCY', 'HAND_PATH_FACTS']) assert.equal(by(r, id), undefined, id);
  const old = clone(A); delete old.handPathReading; assert.doesNotThrow(() => analyse(old, 'PERFORMANCE'), 'analyses saved before this existed still work');
});
test('crossing the middle: linked to sideways force when that is above EO\'s target, with the real numbers; a "no" is a strength', () => {
  const a = withPath({ crossesMidline: 'YES' }), r = analyse(a, 'PERFORMANCE'), f = by(r, 'HAND_PATH_CROSSOVER');
  assert.equal(f.classification, 'OBSERVED'); assert.equal(f.confidence, 'MODERATE');
  assert.match(f.text.PERFORMANCE, /left 15\.4% and right 7\.7%/); assert.match(f.text.PERFORMANCE, /under 4%/);
  assert.ok(r.priorities.find((p) => p.ruleId === 'HAND_PATH_CROSSOVER').included || r.priorities.some((p) => p.ruleId === 'HAND_PATH_CROSSOVER'));
  const calm = withPath({ crossesMidline: 'YES' }); calm.forceDistribution.overall.leftwardPct.value = 2; calm.forceDistribution.overall.rightwardPct.value = 2;
  const g = by(analyse(calm, 'PERFORMANCE'), 'HAND_PATH_CROSSOVER'); assert.equal(g.confidence, 'LOW'); assert.doesNotMatch(g.text.PERFORMANCE, /target/);
  const no = analyse(withPath({ crossesMidline: 'NO' }), 'PERFORMANCE');
  assert.equal(by(no, 'HAND_PATH_CROSSOVER'), undefined); assert.ok(no.report.sections.find((s) => s.id === 'STRENGTHS').data.items.some((i) => /own side/.test(i.title)));
});
test('wrist pitch and two-handed inconsistency are swimmer-facing; UNSURE and OK are not findings', () => {
  const r = analyse(withPath({ 'left.wristPitch': 'BROKEN', 'right.wristPitch': 'OK', 'left.spread': 'WIDE', 'right.spread': 'WIDE' }), 'COACH');
  assert.equal(by(r, 'HAND_PATH_WRIST').meta.arms.join(), 'left');
  const c = by(r, 'HAND_PATH_CONSISTENCY'); assert.equal(c.classification, 'OBSERVED'); assert.equal(c.meta.oneSided, false);
  const none = analyse(withPath({ 'left.wristPitch': 'UNSURE', 'right.wristPitch': 'OK', 'left.spread': 'TIGHT', 'right.spread': 'UNSURE' }), 'COACH');
  assert.equal(by(none, 'HAND_PATH_WRIST'), undefined); assert.equal(by(none, 'HAND_PATH_CONSISTENCY'), undefined);
});
test('ONE hand wide: EO says it may not be technique, so it is held for the coach and never reaches a swimmer unconfirmed', () => {
  const a = withPath({ 'left.spread': 'TIGHT', 'right.spread': 'WIDE' }), r = analyse(a, 'PERFORMANCE'), f = by(r, 'HAND_PATH_CONSISTENCY');
  assert.equal(f.classification, 'COACH_CONFIRMATION_REQUIRED'); assert.equal(f.coachConfirmation.required, true);
  assert.match(f.text.COACH, /shoulder/); assert.doesNotMatch(f.text.PERFORMANCE + f.text.JUNIOR, /shoulder|injur|physio|pain/i, 'the swimmer wording is neutral');
  const p = r.priorities.find((x) => x.ruleId === 'HAND_PATH_CONSISTENCY'); assert.equal(p.swimmerFacing, false); assert.equal(p.included, false);
  assert.doesNotMatch(renderReport(r.report), /shoulder/i);
  a.coachReview = { findings: { [f.id]: { status: 'APPROVED', technicalConfirmed: true } } };
  assert.equal(analyse(a, 'PERFORMANCE').priorities.find((x) => x.ruleId === 'HAND_PATH_CONSISTENCY').swimmerFacing, true, 'the coach can confirm it');
});
test('depth and width are coach facts only: reported, never graded, never shown to the swimmer', () => {
  const a = withPath({ 'left.maxDepthCm': [60, 70], 'right.maxDepthCm': [62, 72], 'left.maxWidthCm': 55, 'right.maxWidthCm': 63 });
  const r = analyse(a, 'PERFORMANCE'), f = by(r, 'HAND_PATH_FACTS');
  assert.equal(f.kind, 'CONTEXT'); assert.match(f.measurement.join(' '), /Width differs between hands by 8 cm/); assert.match(f.measurement.join(' '), /No depth target is printed/);
  assert.doesNotMatch(f.measurement.join(' '), /too deep|too wide|should/i);
  const html = renderReport(r.report); assert.doesNotMatch(text(html), /\b(60|70|62|72|63)\s*(to\s*\d+\s*)?cm/i); assert.doesNotMatch(html, /data-sec="EVIDENCE"/);
  assert.ok(r.priorities.every((p) => p.ruleId !== 'HAND_PATH_FACTS'), 'a context finding never becomes a priority');
});
test('swimmer wording passes the language guard', async () => {
  const { languageViolations } = await import('../aquasharks-lab/analysis/language.js');
  const r = analyse(withPath({ crossesMidline: 'YES', 'left.wristPitch': 'BROKEN', 'left.spread': 'WIDE', 'right.spread': 'WIDE' }), 'COACH');
  for (const id of ['HAND_PATH_CROSSOVER', 'HAND_PATH_WRIST', 'HAND_PATH_CONSISTENCY']) for (const k of ['JUNIOR', 'PERFORMANCE', 'MASTERS_OPEN_WATER']) assert.deepEqual(languageViolations(by(r, id).text[k]), [], id + k);
});

// ------------------------------------------------------------------ the suggestion step: two reads, agreement or nothing
test('numeric reads agree only when the ranges overlap and the overlap is tight', () => {
  assert.deepEqual(agreeRange({ low: 55, high: 70 }, { low: 60, high: 75 }), { ok: true, range: [60, 70] });
  assert.equal(agreeRange({ low: 40, high: 50 }, { low: 60, high: 75 }).ok, false, 'disjoint reads disagree');
  assert.equal(agreeRange({ low: 10, high: 90 }, { low: 0, high: 100 }).ok, false, `wider than ${MAX_RANGE_WIDTH_CM} cm is too imprecise`);
  assert.equal(agreeRange(null, { low: 1, high: 2 }).ok, false); assert.equal(agreeRange({ low: 5, high: 4 }, { low: 1, high: 9 }).ok, false);
});
test('category reads agree only when identical and not UNSURE', () => {
  assert.deepEqual(agreeCategory('WIDE', 'WIDE'), { ok: true, value: 'WIDE' });
  for (const [x, y] of [['WIDE', 'TIGHT'], ['WIDE', 'UNSURE'], ['UNSURE', 'UNSURE'], [undefined, 'WIDE']]) assert.equal(agreeCategory(x, y).ok, false, `${x}/${y}`);
});
const read = (o = {}) => ({ axis_legible: true, crosses_midline: 'YES', left: { max_depth_cm: { low: 60, high: 70, basis: 'between the 60 and 80 ticks' }, max_width_cm: { low: 50, high: 58 }, spread: 'WIDE', wrist_pitch: 'UNSURE' }, right: { max_depth_cm: { low: 62, high: 72 }, max_width_cm: null, spread: 'TIGHT', wrist_pitch: 'UNSURE' }, ...o });
test('reconcile: keeps what both reads agree on, lists what they do not, and refuses unreadable charts', () => {
  const { suggestions: s, undecided } = reconcileReads(read(), read({ crosses_midline: 'NO', left: { ...read().left, max_depth_cm: { low: 61, high: 69 }, spread: 'TIGHT' } }));
  assert.deepEqual(s['left.maxDepthCm'].range, [61, 69]); assert.equal(s.crossesMidline, undefined); assert.equal(s['left.spread'], undefined);
  assert.equal(s['right.spread'].value, 'TIGHT'); assert.ok(undecided.some((u) => u.field === 'crosses midline' && /disagree/.test(u.why)));
  assert.ok(undecided.some((u) => u.field === 'right max width cm'), 'a null read is left for the coach'); assert.equal(s['right.wristPitch'], undefined, 'UNSURE is never suggested');
  assert.deepEqual(reconcileReads(read({ axis_legible: false }), read()).suggestions, {});
});
test('suggestHandPath calls the model twice, never writes to an analysis, and survives a failing model', async () => {
  let calls = 0; const seen = [];
  const ok = await suggestHandPath({ images: [{ base64: 'AA', mediaType: 'image/png' }] }, async (req) => { calls++; seen.push(req.content.length); return read(); });
  assert.equal(calls, 2); assert.equal(ok.ok, true); assert.deepEqual(ok.suggestions['left.maxDepthCm'].range, [60, 70]);
  const bad = await suggestHandPath({ images: [] }, async () => { throw new Error('boom'); });
  assert.equal(bad.ok, false); assert.deepEqual(bad.suggestions, {});
});

// ------------------------------------------------------------------ the admin action
function fakeRes() { const r = { statusCode: 200, setHeader() {}, end(b) { r.body = b; } }; return r; }
const call = async (h, body) => { const res = fakeRes(); await h({ method: 'POST', headers: {}, query: {}, body }, res); return { status: res.statusCode, json: JSON.parse(res.body) }; };
test('hand_path action: admin only, validates images, needs the model, and returns suggestions without saving anything', async () => {
  const store = memoryStore(), png = { base64: 'AAAA', mediaType: 'image/png' };
  const h = makeAdminHandler({ store, auth: async () => 'a', callModel: async () => read() });
  assert.equal((await call(makeAdminHandler({ store, auth: async () => null, callModel: async () => read() }), { action: 'hand_path', page_images: [png] })).status, 403);
  assert.equal((await call(makeAdminHandler({ store, auth: async () => 'a' }), { action: 'hand_path', page_images: [png] })).status, 503);
  for (const bad of [[], undefined, Array(7).fill(png), [{ base64: 'A', mediaType: 'application/pdf' }], [{ mediaType: 'image/png' }]]) assert.equal((await call(h, { action: 'hand_path', page_images: bad })).status, 400, JSON.stringify(bad)?.slice(0, 40));
  const ok = await call(h, { action: 'hand_path', page_images: [png] });
  assert.equal(ok.status, 200); assert.ok(ok.json.suggestions['left.maxDepthCm']); assert.equal((await store.list()).length, 0, 'nothing is stored');
});
test('storage keeps the hand-path reading with its CHART_READ provenance', () => {
  const a = clone(A); setHandPathField(a, 'crossesMidline', 'YES'); a.swimmer.name = 'Test';
  assert.equal(cleanForStorage(a).handPathReading.crossesMidline.provenance.origin, 'CHART_READ');
});

// ------------------------------------------------------------------ guard: the builder UI is not covered by unit tests, so check it never calls something it does not define
import fs from 'node:fs';
test('builder app.js: every helper it calls is defined (a deleted panel once broke the review screen)', () => {
  const src = fs.readFileSync(new URL('../aquasharks-lab/report-builder/app.js', import.meta.url), 'utf8');
  const defined = new Set([...src.matchAll(/(?:async\s+)?function\s+(\w+)\s*\(/g)].map((m) => m[1]).concat([...src.matchAll(/(?:const|let)\s+(\w+)\s*=\s*(?:async\s*)?(?:\([^)]*\)|\w+)\s*=>/g)].map((m) => m[1])));
  const called = new Set([...src.matchAll(/\$\{(\w+(?:Panel|Col))\(/g)].map((m) => m[1]).concat([...src.matchAll(/\b(\w+(?:Panel|Col|View))\(\)/g)].map((m) => m[1])));
  const missing = [...called].filter((n) => !defined.has(n));
  assert.deepEqual(missing, [], 'called but not defined: ' + missing.join(', '));
});

// ------------------------------------------------------------------ guard: stale cached modules once blanked the builder
test('the lab\'s many small modules are never pinned by the service worker or the browser cache', () => {
  const sw = fs.readFileSync(new URL('../sw.js', import.meta.url), 'utf8'), v = JSON.parse(fs.readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));
  assert.match(sw, /url\.pathname\.startsWith\('\/aquasharks-lab\/'\)\) return;/, 'service worker leaves /aquasharks-lab/ alone');
  assert.ok(sw.indexOf("startsWith('/aquasharks-lab/')") < sw.indexOf('// Cache-first for static assets'), 'and does so before its cache-first rule');
  const r = v.routes.find((x) => x.src && x.src.includes('aquasharks-lab/.+'));
  assert.ok(r && r.headers['Cache-Control'] === 'no-cache', 'vercel.json serves the lab scripts and styles no-cache');
  for (const f of ['aquasharks-lab/analysis/model.js', 'aquasharks-lab/report-builder/app.js', 'aquasharks-lab/analysis/report-view.css']) assert.ok(new RegExp(r.src).test('/' + f), f);
  assert.equal(new RegExp(r.src).test('/aquasharks-lab/HANDOFF.md'), false);
});
