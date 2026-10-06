// The simple, positive report for school swimmers: EO targets, what is going well, coach-approved EO wording,
// a note from the coach, which arm leads each lap, and progress since the last session. Synthetic data only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseEoReport } from '../aquasharks-lab/analysis/parser/index.js';
import { analyse } from '../aquasharks-lab/analysis/engine.js';
import { renderReport } from '../aquasharks-lab/analysis/report-view.js';
import { baselineFrom, comparability, progressRows } from '../aquasharks-lab/analysis/progress.js';
import { cleanForStorage } from '../api/_lib/lab-report/workflow.js';
import { testSwimmerA as A } from '../aquasharks-lab/analysis/fixtures/test-swimmer-a-200m.js';
import { buildDocx, synDocxBlocks } from './lab-doc-builders.js';

const clone = (x) => JSON.parse(JSON.stringify(x));
const sec = (r, id) => r.report.sections.find((s) => s.id === id);
const text = (html) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

// ------------------------------------------------------------------ parser: lap leads and per-lap double-peak statements
test('parser: "lap 1 favouring the left, lap 2 favouring the right" becomes a per-lap lead, rule-read at MODERATE', async () => {
  const a = (await parseEoReport(buildDocx(synDocxBlocks({ srp: ['A reversal occurs between laps, with lap 1 favouring the left side and lap 2 heavily favouring the right side.'] })))).analysis;
  assert.deepEqual(a.leftRight.byLap.map((b) => [b.lap, b.higher.value]), [[1, 'LEFT'], [2, 'RIGHT']]);
  assert.equal(a.leftRight.byLap[0].higher.provenance.extraction.method, 'RULE'); assert.equal(a.leftRight.byLap[0].higher.provenance.extraction.confidence, 'MODERATE');
  assert.equal(a.leftRight.byLap[0].leftW.absence, 'COACH_REQUIRED', 'no per-lap watts are invented');
});
test('parser: one percentage quoted for every lap, and a stated clean side, give per-lap series', async () => {
  const a = (await parseEoReport(buildDocx(synDocxBlocks({ pvt: ['The right side displays occasional double peaks in isolated strokes (22.5% occurrence in both laps 1 and 2), a small amount.', 'The left side demonstrates consistently clean single-peak power.'] })))).analysis, pp = a.powerProfile;
  assert.deepEqual(pp.right.doublePeakPctByLap.map((m) => m.value), [22.5, 22.5, 22.5]); assert.equal(pp.right.shape.value, 'MULTI_PEAK');
  assert.deepEqual(pp.left.doublePeakPctByLap.map((m) => m.value), [0, 0, 0]); assert.equal(pp.left.shape.value, 'SINGLE_PEAK');
});

// ------------------------------------------------------------------ the arms: the stronger arm swapping between laps
function withLaps(extra) { const a = clone(A); const base = { provenance: { origin: 'EO_REPORT' } }; a.leftRight.byLap = [1, 2].map((lap, i) => ({ lap, higher: { value: ['LEFT', 'RIGHT'][i], status: 'COMPLETE', ...base }, leftW: { value: null, status: 'MISSING', ...base }, rightW: { value: null, status: 'MISSING', ...base } })); return Object.assign(a, extra || {}); }
test('a lap swap is chips plus one sentence and the two power numbers; the coach view keeps the detail; laps that agree add nothing', () => {
  const sw = analyse(withLaps(), 'PERFORMANCE'), co = analyse(withLaps(), 'COACH');
  assert.deepEqual(sec(sw, 'ARMS').data.lapLeads.map((x) => x.higher), ['LEFT', 'RIGHT'], 'the swimmer sees the swap as two chips and one sentence');
  assert.equal(sec(sw, 'ARMS').data.lr.left, 67); assert.equal(sec(sw, 'ARMS').data.lr.right, 101);
  const prio = sw.priorities.find((p) => p.ruleId === 'ASYMMETRY_PROFILE');
  assert.match(prio.why.PERFORMANCE, /stronger arm changes between laps: left arm in lap 1, right arm in lap 2/);
  assert.deepEqual(sec(co, 'ARMS').data.lapLeads.map((x) => [x.lap, x.higher]), [[1, 'LEFT'], [2, 'RIGHT']]);
  const same = withLaps(); same.leftRight.byLap[1].higher.value = 'LEFT';
  assert.deepEqual(sec(analyse(same, 'COACH'), 'ARMS').data.lapLeads, []);
});
test('coach-entered per-lap watts override the wording, and are never invented', () => {
  const a = withLaps(); for (const [i, [l, r]] of [[60, 70], [80, 50]].entries()) { a.leftRight.byLap[i].leftW = { value: l, unit: 'W', status: 'COMPLETE', provenance: { origin: 'COACH_SUPPLIED' } }; a.leftRight.byLap[i].rightW = { value: r, unit: 'W', status: 'COMPLETE', provenance: { origin: 'COACH_SUPPLIED' } }; }
  assert.deepEqual(analyse(a, 'COACH').findings.find((f) => f.ruleId === 'ASYMMETRY_PROFILE').meta.lapLeads.map((x) => x.higher), ['RIGHT', 'LEFT']);
});

// ------------------------------------------------------------------ what is going well comes from on-target numbers only
test('"what is going well" uses EO\'s own on-target ranges and smooth force delivery; nothing is praised without data', () => {
  const a = clone(A); a.forceDistribution.overall.leftwardPct.value = 2.1; a.forceDistribution.overall.rightwardPct.value = 1.8;
  const good = sec(analyse(a, 'PERFORMANCE'), 'STRENGTHS');
  assert.equal(good.status, 'COMPLETE'); assert.ok(good.data.items.some((i) => /sideways push is balanced/.test(i.title)));
  const none = clone(A); none.eoReferenceRanges = {}; none.powerProfile.left.shape = { value: 'MULTI_PEAK', status: 'COMPLETE', provenance: { origin: 'DERIVED' } }; none.powerProfile.right.shape = none.powerProfile.left.shape;
  assert.equal(sec(analyse(none, 'PERFORMANCE'), 'STRENGTHS').status, 'MISSING', 'no on-target numbers and no smooth arm: the section is left out, not filled');
});
test('target rows show only what is off target, as You then Target, and juniors get words instead of numbers', () => {
  const p = sec(analyse(A, 'PERFORMANCE'), 'POWER').data, j = sec(analyse(A, 'JUNIOR'), 'POWER').data;
  assert.ok(p.targets.rows.length <= 3 && p.targets.rows.every((r) => r.status !== 'ON_TARGET'));
  assert.equal(j.targets.simple, true);
  const html = text(renderReport(analyse(A, 'JUNIOR').report));
  assert.match(html, /a bit (low|high)/);
});

// ------------------------------------------------------------------ EO's wording reaches a swimmer only if the coach shows it
function withObs() {
  const a = clone(A);
  const ob = (id, para, t) => ({ id, area: 'FORCE_FIELD', text: t, claimType: 'DIAGNOSTIC_INTERPRETATION', claimTypeBasis: 'RULE', claimTypeConfidence: 'HIGH', provenance: { origin: 'EO_REPORT', extraction: { method: 'STRUCT', confidence: 'HIGH', locator: { paragraph: para } } } });
  a.eoObservations = [ob('eo-obs-1', 1, 'Your hand drag is delaying the catch.'), ob('eo-obs-2', 1, 'Second sentence of the same point.'), ob('eo-obs-3', 2, 'Your balanced left-right power is a genuine strength.')];
  return a;
}
test('EO diagnostic sentences are hidden until approved; approved shows EO text, edited shows the coach\'s own words, hidden stays hidden', () => {
  const a = withObs(), cands = analyse(a, 'COACH').findings.find((f) => f.ruleId === 'POWER_EFFECTIVENESS').meta.explanationCandidates;
  assert.deepEqual(cands.map((c) => c.id), ['eo-obs-1', 'eo-obs-3'], 'only the headline sentence of each EO point is offered');
  assert.deepEqual(sec(analyse(a, 'PERFORMANCE'), 'POWER').data.explanations, []);
  assert.equal(sec(analyse(a, 'PERFORMANCE'), 'STRENGTHS').data.items.some((i) => i.eo), false);
  a.coachReview.eoClaims = { 'eo-obs-1': { status: 'EDITED', editedText: 'Keep the hand ready as it enters.' }, 'eo-obs-3': { status: 'APPROVED' } };
  const r = analyse(a, 'PERFORMANCE');
  assert.deepEqual(sec(r, 'POWER').data.explanations, ['Keep the hand ready as it enters.']);
  assert.ok(sec(r, 'STRENGTHS').data.items.some((i) => i.eo && /balanced left-right/.test(i.detail)), 'a positive EO point goes under what is going well');
  a.coachReview.eoClaims['eo-obs-1'] = { status: 'HIDDEN' };
  assert.deepEqual(sec(analyse(a, 'PERFORMANCE'), 'POWER').data.explanations, []);
});
test('storage keeps only known claim statuses and bounded text, and the coach note', () => {
  const a = withObs(); a.coachReview = { findings: {}, eoClaims: { 'eo-obs-1': { status: 'EDITED', editedText: 'x'.repeat(2000) }, 'eo-obs-2': { status: 'EVIL' }, '../x': { status: 'APPROVED' } }, coachNote: 'n'.repeat(5000) };
  const c = cleanForStorage(Object.assign(a, { swimmer: { ...a.swimmer, name: 'Test' } })).coachReview;
  assert.deepEqual(Object.keys(c.eoClaims), ['eo-obs-1']); assert.equal(c.eoClaims['eo-obs-1'].editedText.length, 600); assert.equal(c.coachNote.length, 1200);
});

// ------------------------------------------------------------------ the coach's note
test('the note appears only when written, is signed, and is escaped', () => {
  const a = clone(A);
  assert.equal(sec(analyse(a, 'PERFORMANCE'), 'NOTE').status, 'MISSING');
  assert.doesNotMatch(renderReport(analyse(a, 'PERFORMANCE').report), /data-sec="NOTE"/);
  a.coachReview.coachNote = 'Great swim <b>today</b>.';
  const html = renderReport(analyse(a, 'PERFORMANCE').report);
  assert.match(html, /data-sec="NOTE"/); assert.match(html, /Great swim &lt;b&gt;today&lt;\/b&gt;/); assert.match(html, /Britt, Aqua Sharks/);
});

// ------------------------------------------------------------------ three things, for every swimmer
test('no swimmer report asks for more than three focuses; EO is credited on the first page', () => {
  for (const p of ['JUNIOR', 'PERFORMANCE', 'MASTERS_OPEN_WATER']) {
    const r = analyse(A, p); assert.ok(r.priorities.filter((x) => x.included).length <= 3, p);
    assert.match(text(renderReport(r.report)), /builds on your EO Labs SwimBETTER analysis/);
  }
});

// ------------------------------------------------------------------ progress since the last session
function earlier(over) { const p = clone(A); over(p); return p; }
test('progress: better / same / not yet from the numbers as shown; no invented tolerance', () => {
  const a = clone(A);
  a.baseline = baselineFrom(earlier((p) => { p.metrics.distancePerStrokeM.value = 2.5; p.forceDistribution.overall.propulsivePct.value = 34.7; p.forceDistribution.overall.downwardPct.value = 38; p.forceDistribution.overall.handDragPct.value = 1.2; }));
  const rows = Object.fromEntries(progressRows(a).map((r) => [r.key, r.verdict]));
  assert.deepEqual(rows, { distancePerStrokeM: 'BETTER', propulsivePct: 'SAME', downwardPct: 'NOT_YET', handDragPct: 'SAME' });
  const r = analyse(a, 'PERFORMANCE'), p = sec(r, 'PROGRESS');
  assert.equal(p.status, 'COMPLETE'); assert.equal(p.data.summary, '1 of 4 numbers moved the right way.');
  assert.match(text(renderReport(r.report)), /SINCE LAST TIME|Since last time/i);
});
test('progress: absent without a linked session, never invented, and a stroke change is flagged', () => {
  assert.equal(sec(analyse(A, 'PERFORMANCE'), 'PROGRESS').status, 'MISSING');
  const a = clone(A); a.baseline = baselineFrom(earlier((p) => { p.session.stroke.value = 'Backstroke'; }));
  assert.equal(comparability(a).length, 1); assert.match(comparability(a)[0], /not a like-for-like/);
  const lone = clone(A); lone.baseline = baselineFrom(earlier((p) => { p.metrics.distancePerStrokeM = { value: null, status: 'MISSING', provenance: { origin: 'EO_REPORT' } }; }));
  assert.equal(progressRows(lone).some((r) => r.key === 'distancePerStrokeM'), false);
});

// ------------------------------------------------------------------ the come-back section and the practice plan
import { buildPlan, retestDate, retestWeeks, pullCount, BOOK_URL } from '../aquasharks-lab/analysis/plan.js';
const F = (t) => ({ title: t, cue: 'cue ' + t, drill: { name: 'Drill ' + t, what: 'Do ' + t + '.' } });
test('plan: weeks are shared across the focuses in rank order, then a final week to put it together', () => {
  const show = (n, w) => buildPlan(['A', 'B', 'C'].slice(0, n).map(F), w).map((s) => `${s.weeks}:${s.title}`);
  assert.deepEqual(show(3, 6), ['Weeks 1–2:A', 'Weeks 3–4:B', 'Week 5:C', 'Week 6:Put it together']);
  assert.deepEqual(show(2, 6), ['Weeks 1–3:A', 'Weeks 4–5:B', 'Week 6:Put it together']);
  assert.deepEqual(show(1, 4), ['Weeks 1–3:A', 'Week 4:Put it together']);
  assert.deepEqual(buildPlan([], 6), [], 'no focuses, no plan: nothing is invented');
  const last = buildPlan([F('A')], 6).at(-1); assert.equal(last.drill, null);
});
test('plan: retest date is calendar maths on the session date, with no time-zone drift; weeks fall back to 6', () => {
  assert.equal(retestDate('2026-10-06', 6), '17 November 2026'); assert.equal(retestDate('2026-12-20', 4), '17 January 2027'); assert.equal(retestDate(null, 6), null);
  assert.deepEqual([retestWeeks(4), retestWeeks('8'), retestWeeks(5), retestWeeks(undefined)], [4, 8, 6, 6]);
});
test('plan: strokes per length is in EO\'s sense (a stroke is a full cycle; the printed count is left plus right), absent unless both were printed', () => {
  const a = clone(A); a.session.strokeCount.value = 35; a.session.laps.value = 2; assert.equal(pullCount(a), 8.8, '35 strokes in 2 lengths: 8.75 full cycles a length, not 17.5');
  a.session.strokeCount.value = 132; a.session.laps.value = 8; assert.equal(pullCount(a), 8.3, 'EO shows 64 left and 68 right over 8 laps: about 8.25 a length');
  a.session.laps = { value: null, status: 'MISSING', provenance: { origin: 'EO_REPORT' } }; assert.equal(pullCount(a), null);
});
test('report: the plan uses only this report\'s focuses and drills; the retest, date and booking link close the report', () => {
  const a = clone(A); a.session.date = { value: '2026-10-06', status: 'COMPLETE', provenance: { origin: 'EO_REPORT' } };
  const r = analyse(a, 'PERFORMANCE'), plan = sec(r, 'PLAN').data, next = sec(r, 'NEXT').data, inc = r.priorities.filter((p) => p.included);
  assert.deepEqual(plan.steps.filter((s) => s.kind === 'FOCUS').map((s) => s.title), inc.map((p) => p.title));
  assert.equal(plan.weeks, 6); assert.equal(plan.check.perLength, 8.6);
  assert.equal(next.retest.date, '17 November 2026'); assert.equal(next.book.url, BOOK_URL); assert.ok(next.remeasure.length <= 3, 'three numbers to beat, not a list');
  a.coachReview.retestWeeks = 8; assert.equal(sec(analyse(a, 'PERFORMANCE'), 'PLAN').data.steps.at(-1).weeks, 'Week 8');
  const html = renderReport(r.report);
  assert.match(html, /data-sec="PLAN"/); assert.match(html, /Book your retest/); assert.match(html, /href="https:\/\/www\.swimloading\.com\/aquasharks-lab#book"/);
});
test('report: swimmers with no focuses get no plan and no invented weeks; storage bounds the retest weeks', () => {
  const none = emptyAnalysisFor();
  assert.equal(sec(analyse(none, 'PERFORMANCE'), 'PLAN').status, 'MISSING');
  const a = clone(A); a.coachReview = { findings: {}, retestWeeks: 99 };
  assert.equal(cleanForStorage(a).coachReview.retestWeeks, 6);
});
import { emptyAnalysis } from '../aquasharks-lab/analysis/model.js';
function emptyAnalysisFor() { return emptyAnalysis('Nobody'); }

// ------------------------------------------------------------------ value added from EO's Technical Error Index
test('upward force under 3% is negligible (EO guidance): on target, not a miss; 3% and over still counts', () => {
  const a = clone(A); a.forceDistribution.overall.upwardPct.value = 2.9;
  assert.equal(analyse(a, 'COACH').findings.find((f) => f.ruleId === 'POWER_EFFECTIVENESS').meta.targetRows.find((r) => r.key === 'upwardPct').status, 'ON_TARGET');
  a.forceDistribution.overall.upwardPct.value = 3.4;
  assert.equal(analyse(a, 'COACH').findings.find((f) => f.ruleId === 'POWER_EFFECTIVENESS').meta.targetRows.find((r) => r.key === 'upwardPct').status, 'ABOVE');
});
test('progress: a different pool length is flagged like stroke and distance, and the plan carries EO\'s one-thing-at-a-time, slow-it-down advice', () => {
  const a = clone(A); a.baseline = baselineFrom(earlier((p) => { p.session.poolLengthM.value = 50; }));
  assert.ok(comparability(a).some((x) => /50 m pool/.test(x)));
  assert.match(sec(analyse(A, 'PERFORMANCE'), 'PLAN').data.tip, /One thing at a time\. Slow it down/);
});

// ------------------------------------------------------------------ what the sales page promises
test('left against right is shown as two plain numbers (words only for juniors), whether or not the arm that leads changes', () => {
  const a = clone(A), p = sec(analyse(a, 'PERFORMANCE'), 'ARMS').data, j = sec(analyse(a, 'JUNIOR'), 'ARMS').data;
  assert.deepEqual([p.lr.left, p.lr.right, p.lr.higher, p.lr.gapW, p.lr.simple], [67, 101, 'RIGHT', 34, false]); assert.equal(j.lr.simple, true);
  const html = text(renderReport(analyse(a, 'PERFORMANCE').report)); assert.match(html, /LEFT 67 W RIGHT 101 W/); assert.match(html, /Right is 34 W higher/);
  assert.doesNotMatch(text(renderReport(analyse(a, 'JUNIOR').report)), /\b101\s*W/, 'juniors get words, not watts');
});
test('distance per stroke leads every swimmer report, juniors included, and a goal appears only if the coach set one', () => {
  for (const p of ['JUNIOR', 'PERFORMANCE', 'MASTERS_OPEN_WATER']) assert.equal(sec(analyse(A, p), 'HERO').data.keyMetrics[0].label, 'DISTANCE PER STROKE', p);
  assert.equal(sec(analyse(A, 'PERFORMANCE'), 'HERO').data.keyMetrics.some((m) => m.goal), false);
  const a = clone(A); a.coachReview.dpsGoalM = 2.95;
  const r = analyse(a, 'PERFORMANCE'); assert.equal(sec(r, 'HERO').data.keyMetrics[0].goal, 'Next goal 2.95 m');
  assert.deepEqual(sec(r, 'NEXT').data.remeasure[0], { label: 'Distance per stroke', current: '2.82 m', target: '2.95 m' });
  for (const bad of [0.1, 9, '2.9', NaN]) { const b = clone(A); b.coachReview.dpsGoalM = bad; assert.equal(sec(analyse(b, 'PERFORMANCE'), 'HERO').data.keyMetrics.some((m) => m.goal), false, String(bad)); }
  const c = clone(A); c.swimmer.name = 'T'; c.coachReview = { findings: {}, dpsGoalM: 2.956 }; assert.equal(cleanForStorage(c).coachReview.dpsGoalM, 2.96); c.coachReview.dpsGoalM = 40; assert.equal(cleanForStorage(c).coachReview.dpsGoalM, undefined);
});
