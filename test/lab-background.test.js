// What the coach knows beyond the numbers (recent swims, a break, an injury): stored bounded, never shown unless she writes it,
// and a swimmer coming back gets an easing-in plan and an 8 week retest. Synthetic data only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyse } from '../aquasharks-lab/analysis/engine.js';
import { renderReport } from '../aquasharks-lab/analysis/report-view.js';
import { buildPlan, retestWeeks } from '../aquasharks-lab/analysis/plan.js';
import { cleanForStorage, cleanBackground } from '../api/_lib/lab-report/workflow.js';
import { testSwimmerA as A } from '../aquasharks-lab/analysis/fixtures/test-swimmer-a-200m.js';

const clone = (x) => JSON.parse(JSON.stringify(x));
const sec = (r, id) => r.report.sections.find((s) => s.id === id);
const F = [{ title: 'One', cue: 'c1', drill: null }, { title: 'Two', cue: 'c2', drill: null }, { title: 'Three', cue: 'c3', drill: null }];

test('nothing the coach knows reaches the swimmer unless she writes the swimmer wording', () => {
  const a = clone(A);
  a.coachReview.background = { injuryStatus: 'SORE', injurySides: ['LEFT'], injuryNote: 'Left shoulder, seen a physio', recentSwims: 'Channel', returning: true };
  const r = analyse(a, 'PERFORMANCE');
  assert.equal(sec(r, 'BACKGROUND').status, 'MISSING');
  const html = renderReport(r.report);
  assert.doesNotMatch(html, /data-sec="BACKGROUND"/); assert.doesNotMatch(html, /physio|shoulder|Channel/i);
});

test('the swimmer wording appears as "Where you are starting from", escaped and signed off by being written', () => {
  const a = clone(A);
  a.coachReview.background = { swimmerText: 'Coming back <b>slowly</b>.' };
  const html = renderReport(analyse(a, 'PERFORMANCE').report);
  assert.match(html, /data-sec="BACKGROUND"/); assert.match(html, /STARTING FROM/); assert.match(html, /Coming back &lt;b&gt;slowly&lt;\/b&gt;/);
});

test('a swimmer coming back gets an easing-in plan; a long plan keeps every focus at least a week; a short one skips the lead', () => {
  const p8 = buildPlan(F, 8, { returning: true });
  assert.deepEqual(p8.map((x) => [x.kind, x.weeks]), [['EASE_IN', 'Weeks 1–2'], ['FOCUS', 'Weeks 3–4'], ['FOCUS', 'Weeks 5–6'], ['FOCUS', 'Week 7'], ['TOGETHER', 'Week 8']]);
  const p4 = buildPlan(F, 4, { returning: true });
  assert.ok(!p4.some((x) => x.kind === 'EASE_IN'), 'no room for a lead without starving a focus');
  assert.deepEqual(p4.map((x) => x.weeks), ['Week 1', 'Week 2', 'Week 3', 'Week 4'], 'every focus keeps a whole week');
  assert.deepEqual(buildPlan(F, 6), buildPlan(F, 6, { returning: false }), 'unchanged for everyone else');
  assert.equal(buildPlan(F, 6).some((x) => x.kind === 'EASE_IN'), false);
});

test('returning defaults the retest to 8 weeks but the coach choice wins', () => {
  assert.equal(retestWeeks(undefined, true), 8); assert.equal(retestWeeks(undefined, false), 6); assert.equal(retestWeeks(4, true), 4);
  const a = clone(A); delete a.coachReview.retestWeeks; a.coachReview.background = { returning: true };
  const r = analyse(a, 'PERFORMANCE');
  assert.equal(sec(r, 'PLAN').data.weeks, 8); assert.equal(sec(r, 'PLAN').data.steps[0].kind, 'EASE_IN');
  assert.match(renderReport(r.report), /easy, comfortable pace/);
});

test('storage keeps only bounded, known background values and drops an empty one', () => {
  const big = cleanBackground({ recentSwims: 'x'.repeat(2000), swimmerText: 'y'.repeat(5000), injuryStatus: 'EVIL', injurySides: ['LEFT', 'UP', 'RIGHT'], returning: 'yes' });
  assert.equal(big.recentSwims.length, 500); assert.equal(big.swimmerText.length, 800); assert.equal(big.injuryStatus, ''); assert.deepEqual(big.injurySides, ['LEFT', 'RIGHT']); assert.equal(big.returning, false);
  assert.equal(cleanBackground({}), undefined); assert.equal(cleanBackground(null), undefined);
  const a = clone(A); a.swimmer.name = 'Test'; a.coachReview = { findings: {}, background: { goal: 'Build back', injurySides: ['RIGHT'] } };
  const c = cleanForStorage(a).coachReview; assert.equal(c.background.goal, 'Build back'); assert.equal(c.retestWeeks, undefined, 'an unset retest stays unset so returning can default it');
});

test('breathing side changes the "why" offered for one arm leading: both sides makes breathing a less likely reason', () => {
  const asym = (breathing) => { const a = clone(A); a.leftRight.byLap = [1, 2].map((lap) => ({ lap, higher: { value: 'RIGHT', status: 'COMPLETE', provenance: { origin: 'EO_REPORT' } }, leftW: { value: null, status: 'MISSING', absence: 'COACH_REQUIRED' }, rightW: { value: null, status: 'MISSING', absence: 'COACH_REQUIRED' } })); a.coachReview.background = breathing ? { breathing } : undefined; return analyse(a, 'COACH').findings.find((f) => f.ruleId === 'ASYMMETRY_PROFILE'); };
  const none = asym(''), both = asym('BOTH'), left = asym('LEFT');
  assert.ok(none.meta.persistent, 'the fixture must produce the persistent case for this to mean anything');
  assert.match(none.text.COACH, /which side you breathe to, from strength, or from timing/);
  assert.match(both.text.COACH, /from strength or from timing\. Because you breathe to both sides, breathing is less likely to be the reason/);
  assert.doesNotMatch(both.text.COACH, /which side you breathe to/);
  assert.match(left.text.COACH, /breathing to the left, from strength, or from timing/);
});
test('breathing is stored only as a known value', () => {
  assert.equal(cleanBackground({ breathing: 'BOTH' }).breathing, 'BOTH'); assert.equal(cleanBackground({ breathing: 'BOTH', goal: 'x' }).breathing, 'BOTH');
  assert.equal(cleanBackground({ breathing: 'EVIL', goal: 'x' }).breathing, '');
});
