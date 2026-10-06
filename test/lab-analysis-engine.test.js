// Rule engine behaviour on the synthetic fixtures and on deliberately broken/thin variants.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as calc from '../aquasharks-lab/analysis/calc.js';
import { analyse, applyReview, withDerived } from '../aquasharks-lab/analysis/engine.js';
import { runRules } from '../aquasharks-lab/analysis/rules.js';
import { renderReport } from '../aquasharks-lab/analysis/report-view.js';
import { languageViolations, ungroundedNumbers } from '../aquasharks-lab/analysis/language.js';
import { emptyAnalysis, emptyComparison, overlay, num, rng, obs, lapRef, phaseSet, P, testSwimmerA as A, testSwimmerB as B, clone, SWIMMER, ALL_PROFILES, stripTags, allowedNumbers, swimmerStrings } from './lab-analysis-helpers.js';

const by = (r, id) => r.findings.find((f) => f.ruleId === id);
const sec = (r, id) => r.report.sections.find((s) => s.id === id);

// ------------------------------------------------------------------ the fixture, as the engine sees it
test('Test Swimmer A: findings, classifications and confidence come from the data, not from thresholds', () => {
  const r = analyse(A, 'PERFORMANCE');
  assert.deepEqual(r.findings.map((f) => f.ruleId), ['POWER_EFFECTIVENESS', 'LAP_COMPARISON', 'ASYMMETRY_PROFILE', 'POSSIBLE_TECHNICAL_OPPORTUNITY', 'OUTPUT_SUMMARY']);
  const pe = by(r, 'POWER_EFFECTIVENESS'), lc = by(r, 'LAP_COMPARISON'), as = by(r, 'ASYMMETRY_PROFILE'), to = by(r, 'POSSIBLE_TECHNICAL_OPPORTUNITY');
  assert.equal(pe.title, "Force direction is off EO's target on 5 of 6 measures", 'EO prints targets for this swimmer, so the finding is a comparison with them');
  assert.equal(pe.classification, 'MEASURED'); assert.equal(pe.confidence, 'MODERATE', 'the propulsive share is printed three ways, so it cannot be HIGH');
  assert.equal(lc.title, 'Propulsive power falls more than stroke rhythm, lap 1 to lap 8');
  assert.equal(lc.classification, 'MEASURED'); assert.equal(lc.confidence, 'MODERATE', 'approximate / ranged inputs cap at MODERATE');
  assert.equal(lc.corroboration.status, 'CORROBORATED');
  assert.equal(as.classification, 'MEASURED'); assert.equal(as.confidence, 'MODERATE', 'the lap behind the left/right power figures is not labelled');
  assert.equal(to.classification, 'COACH_CONFIRMATION_REQUIRED'); assert.equal(to.confidence, 'LOW');
});

test('priorities: ranked by classification x confidence x impact; ties by rule order; max 3 to a swimmer', () => {
  const r = analyse(A, 'PERFORMANCE');
  assert.deepEqual(r.priorities.map((p) => p.ruleId), ['POWER_EFFECTIVENESS', 'LAP_COMPARISON', 'ASYMMETRY_PROFILE', 'POSSIBLE_TECHNICAL_OPPORTUNITY']);
  assert.deepEqual(r.priorities.map((p) => p.included), [true, true, true, false]);
  // three things to work on, for every swimmer profile: a report that asks for more is not a report a child will use
  for (const prof of SWIMMER) assert.ok(analyse(A, prof).priorities.filter((p) => p.included).length <= 3, prof + ' shows at most 3');
  const j = analyse(A, 'JUNIOR');
  assert.equal(j.priorities.filter((p) => p.included).length, 3);
  assert.equal(j.priorities[3].swimmerFacing, false, 'the technical opportunity still waits for the coach');
});

// ------------------------------------------------------------------ lap comparison: explicit, endpoint, never a trend
test('the comparison keeps the real lap identifiers and distances (lap 1 vs lap 8, first 25 m vs last 25 m)', () => {
  const c = A.lapComparisons[0];
  assert.equal(c.kind, 'ENDPOINT_CHANGE');
  assert.deepEqual(c.from.laps, [1]); assert.deepEqual(c.to.laps, [8]);
  assert.deepEqual(c.from.distanceM, { from: 0, to: 25 }); assert.deepEqual(c.to.distanceM, { from: 175, to: 200 });
  const r = analyse(A, 'PERFORMANCE'), lc = by(r, 'LAP_COMPARISON');
  assert.ok(lc.evidence.every((e) => e.startsWith('lapComparisons.0.')), 'evidence points at the comparison, not at generic early/late fields');
  assert.equal(lc.meta.fromLap, 'lap 1'); assert.equal(lc.meta.toLap, 'lap 8');
  assert.equal(lc.meta.fromLabel, 'FIRST 25 m'); assert.equal(lc.meta.toLabel, 'LAST 25 m');
  assert.equal(sec(r, 'COMPARISON').data.headline, 'FIRST 25 m → LAST 25 m');
  assert.match(lc.meta.remeasure.map((x) => x.label).join(' | '), /lap 1 to lap 8/);
});

test('"first" and "last" are never assumed: other laps are labelled as the laps they are', () => {
  const a = clone(A);
  a.lapComparisons[0].from = lapRef([2], { from: 25, to: 50 }, P.coach('t')); a.lapComparisons[0].to = lapRef([6], { from: 125, to: 150 }, P.coach('t'));
  const lc = by(analyse(a, 'PERFORMANCE'), 'LAP_COMPARISON');
  assert.equal(lc.meta.fromLabel, 'LAP 2'); assert.equal(lc.meta.toLabel, 'LAP 6');
  assert.match(lc.title, /lap 2 to lap 6/);
  const text = lc.text.PERFORMANCE + lc.text.MASTERS_OPEN_WATER + lc.text.COACH;
  assert.doesNotMatch(text, /first 25|last 25|first lap|last lap/i);
  const nodist = clone(A); nodist.lapComparisons[0].to.distanceM = null; nodist.lapComparisons[0].from.distanceM = null;
  assert.equal(by(analyse(nodist, 'COACH'), 'LAP_COMPARISON').meta.toLabel, 'LAP 8', 'without distances it cannot claim "last 25 m"');
});

test('an endpoint comparison is never called a trend, a fade or fatigue in swimmer-facing language', () => {
  const lc = by(analyse(A, 'COACH'), 'LAP_COMPARISON');
  assert.equal(lc.meta.comparisonKind, 'ENDPOINT_CHANGE');
  assert.match(lc.caveats.join(' '), /not a trend/);
  assert.match(lc.relationships.join(' '), /not a trend/i);
  const banned = /\b(trend\w*|fatigue\w*|fade\w*|fading|tir(e|ed|ing)|deteriorat\w*|declin\w*)\b/i;
  assert.doesNotMatch(lc.title, banned);
  for (const prof of SWIMMER) {
    const r = analyse(A, prof);
    for (const s of swimmerStrings(r, prof)) assert.doesNotMatch(s, banned, `${prof}: "${s}"`);
    assert.doesNotMatch(renderReport(r.report), /WHAT HAPPENS WHEN YOU TIRE|early to late/i, prof);
  }
});

test('a MULTI_LAP_TREND comparison is recorded but not analysed, and nothing is then described as a trend', () => {
  const a = clone(A); a.lapComparisons[0].kind = 'MULTI_LAP_TREND';
  const r = analyse(a, 'COACH');
  assert.equal(by(r, 'LAP_COMPARISON'), undefined);
  assert.ok(r.quality.issues.some((i) => i.id === 'trend-unsupported'));
  assert.equal(sec(r, 'COMPARISON').status, 'MISSING');
  assert.doesNotMatch(swimmerStrings(analyse(a, 'PERFORMANCE'), 'PERFORMANCE').join(' '), /trend/i);
});

test('a comparison with unconfirmed lap identity is AMBIGUOUS and says so', () => {
  const a = clone(A); a.lapComparisons[0].from.status = 'AMBIGUOUS';
  const r = analyse(a, 'PERFORMANCE');
  assert.equal(sec(r, 'COMPARISON').status, 'AMBIGUOUS');
  assert.match(by(r, 'LAP_COMPARISON').caveats.join(' '), /not fully established/);
  assert.equal(sec(r, 'COMPARISON').data.refNote, 'The laps behind this comparison are not fully established.');
});

test('the confirmed Test Swimmer A comparison is COMPLETE', () => assert.equal(sec(analyse(A, 'COACH'), 'COMPARISON').status, 'COMPLETE'));

// ------------------------------------------------------------------ the removed equation
test('there is no pull-power x forward-share = propulsive-power equation anywhere; signals are corroborated by direction only', () => {
  assert.equal(calc.crossCheckPropulsivePower, undefined);
  const r = analyse(A, 'COACH');
  for (const f of r.findings) {
    assert.equal(f.crossCheck, undefined, f.id);
    assert.doesNotMatch(JSON.stringify([f.text, f.measurement, f.caveats, f.relationships, f.corroboration]), /predict|expected change|multipl|formula links/i.test('') ? /$^/ : /predict\w*|expected (propulsive|change)|\bx\b.*share/i, f.id);
  }
  const co = by(r, 'LAP_COMPARISON').corroboration;
  assert.equal(co.status, 'CORROBORATED');
  assert.deepEqual(co.signals.map((s) => [s.id, s.direction]), [['pullPower', 'DOWN'], ['forwardShare', 'DOWN'], ['propulsivePower', 'DOWN']]);
  assert.match(co.detail, /No formula links these measures/);
  assert.match(renderReport(r.report), /Corroboration/); assert.doesNotMatch(renderReport(r.report), /Cross-check|predicts a propulsive/i);
});

test('figures that would have satisfied the old equation are NOT treated as agreeing if their directions conflict', () => {
  const a = clone(A); a.lapComparisons[0].propulsivePower.change = rng([5, 12], '%', P.coach('t'));        // up, while pull power and forward share are down
  const lc = by(analyse(a, 'COACH'), 'LAP_COMPARISON');
  assert.equal(lc.corroboration.status, 'CONFLICTING'); assert.equal(lc.confidence, 'LOW');
  assert.equal(lc.coachConfirmation.required, true);
});

// ------------------------------------------------------------------ source conflicts
test('conflicting printed values are all preserved with provenance; the selection is a recorded decision, not truth', () => {
  const m = A.forceDistribution.overall.propulsivePct;
  assert.equal(m.value, 34.7);
  assert.deepEqual(m.alternates.map((x) => [x.value, x.location]), [[35.16, 'summary line'], [34.67, 'force-field narrative']]);
  assert.match(m.selectionBasis, /sum to 100\.1%/);
  assert.equal(m.provenance.location, 'force-distribution table');
  const s = A.metrics.propulsivePct;
  assert.equal(s.value, 35.16); assert.deepEqual(s.alternates.map((x) => x.value), [34.67, 34.7]);
  const q = analyse(A, 'COACH').quality;
  const c = q.conflicts.find((x) => x.path === 'forceDistribution.overall.propulsivePct');
  assert.deepEqual(c.values.map((v) => v.value), [34.7, 35.16, 34.67]);
  assert.deepEqual(c.values.map((v) => v.used), [true, false, false]);
  assert.equal(c.groundTruth, false); assert.equal(c.realConflict, true); assert.ok(c.selectionBasis);
  assert.ok(q.conflicts.find((x) => x.path === 'metrics.propulsivePct'));
});

test('conflicts are surfaced in the Coach view and not in swimmer reports', () => {
  const coach = renderReport(analyse(A, 'COACH').report);
  assert.match(coach, /Source conflicts/); assert.match(coach, /35\.16/); assert.match(coach, /34\.67/); assert.match(coach, /34\.7/);
  assert.match(coach, /source-selection decision, not established ground truth/); assert.match(coach, /force-distribution table/);
  for (const prof of SWIMMER) assert.doesNotMatch(renderReport(analyse(A, prof).report), /Source conflicts|35\.16|34\.67/, prof);
  const caveat = by(analyse(A, 'COACH'), 'POWER_EFFECTIVENESS').caveats.join(' ');
  assert.match(caveat, /34\.7% \(force-distribution table\) used/); assert.match(caveat, /35\.16% \(summary line\)/); assert.match(caveat, /34\.67% \(force-field narrative\)/);
});

test('a quantity with several printed values but no recorded selection basis is flagged', () => {
  const a = clone(A); delete a.forceDistribution.overall.propulsivePct.selectionBasis;
  assert.ok(analyse(a, 'COACH').quality.issues.some((i) => i.id === 'no-basis-forceDistribution.overall.propulsivePct'));
});

test('source contradictions are preserved as typed flags and never reconciled into one claim', () => {
  const issues = analyse(A, 'COACH').quality.issues.filter((i) => i.origin === 'SOURCE');
  const kinds = new Set(issues.map((i) => i.kind));
  for (const k of ['CONFLICTING_VALUES', 'CONTRADICTION', 'TRUNCATION', 'UNIT_AMBIGUITY', 'UNLABELLED_LAP']) assert.ok(kinds.has(k), k);
  assert.equal(issues.filter((i) => i.kind === 'CONTRADICTION').length >= 3, true);
  assert.deepEqual(A.leftRight.avgImpulseW.left.value, 67, 'the contradicting 20.44% figure was not used to overwrite measured power');
});

// ------------------------------------------------------------------ ranges
test('source ranges stay ranges end to end: no midpoint is ever invented', () => {
  const c = A.lapComparisons[0];
  assert.deepEqual(c.pullPower.change.range, [-25, -23]); assert.equal(c.pullPower.change.value, null);
  assert.deepEqual(c.propulsivePower.change.range, [-39, -33]); assert.equal(c.propulsivePower.change.value, null);
  const lc = by(analyse(A, 'COACH'), 'LAP_COMPARISON');
  const row = (id) => lc.meta.rows.find((r) => r.id === id);
  assert.deepEqual([row('pullPower').lo, row('pullPower').hi], [-25, -23]); assert.deepEqual([row('propulsivePower').lo, row('propulsivePower').hi], [-39, -33]);
  const html = renderReport(analyse(A, 'PERFORMANCE').report).match(/data-sec="COMPARISON"[\s\S]*?<\/section>/)[0];
  assert.match(html, /−23<small> to <\/small>−25%/); assert.match(html, /−33<small> to <\/small>−39%/);
  assert.doesNotMatch(html, /[−-]\s?(24|36)(\.0)?%/, 'no -24% or -36% midpoint appears');
  assert.match(lc.text.PERFORMANCE, /33 to 39%/);
});

// ------------------------------------------------------------------ stroke phases
test('lap-average stroke phases are MEASURED evidence in the arm finding; the bars are drawn in the coach view only (a swimmer report stays simple)', () => {
  const r = analyse(A, 'PERFORMANCE'), as = by(r, 'ASYMMETRY_PROFILE');
  assert.equal(as.classification, 'MEASURED');
  assert.deepEqual(as.meta.phases.left, [{ lap: 1, glide: 9, pull: 67, recovery: 24 }, { lap: 8, glide: 15, pull: 66, recovery: 19 }]);
  assert.deepEqual(as.meta.phases.right, [{ lap: 1, glide: 12, pull: 62, recovery: 27 }, { lap: 8, glide: 12, pull: 59, recovery: 29 }]);
  assert.match(as.measurement.join(' | '), /Left Lap 1 → lap 8: glide 9% → 15%, pull 67% → 66%, recovery 24% → 19%/);
  assert.match(as.measurement.join(' | '), /Right Lap 1 → lap 8: glide 12% → 12%, pull 62% → 59%, recovery 27% → 29%/);
  const arms = sec(r, 'ARMS').data;
  assert.match(arms.left.timing.join(' '), /glide 9% → 15%/); assert.match(arms.right.timing.join(' '), /recovery 27% → 29%/);
  assert.ok(as.evidence.includes('strokePhases.left.lapAverages'));
  assert.deepEqual(sec(analyse(A, 'JUNIOR'), 'ARMS').data.left.timing, [], 'JUNIOR gets no phase arithmetic');
  assert.doesNotMatch(renderReport(r.report), /rv-pseg/, 'swimmers do not get glide/pull/recovery bars');
  assert.match(renderReport(analyse(A, 'COACH').report), /rv-pseg/, 'the coach view draws them from the lap averages');
});

test('individual-stroke data can never replace lap averages', () => {
  const stroke = (lap, g, p, r) => ({ lap, stroke: 1, phases: phaseSet(g, p, r, P.eo('single-stroke panel')) });
  const onlyStrokes = clone(A);
  onlyStrokes.strokePhases.left = { lapAverages: [], individualStrokes: [stroke(1, 2, 74, 24), stroke(8, 3, 70, 27)] };
  onlyStrokes.strokePhases.right = { lapAverages: [], individualStrokes: [stroke(1, 5, 60, 35), stroke(8, 6, 58, 36)] };
  const r = analyse(onlyStrokes, 'COACH'), as = by(r, 'ASYMMETRY_PROFILE');
  assert.equal(as.meta.phases.left, null); assert.equal(as.meta.phases.right, null);
  assert.deepEqual(as.meta.timing, { left: [], right: [] }, 'no timing conclusion is drawn from single strokes');
  assert.doesNotMatch(as.measurement.join(' '), /glide/); assert.doesNotMatch(renderReport(r.report), /rv-pseg/);
  const coachOnly = sec(r, 'ARMS').data.left.coachOnly.join(' ');
  assert.match(coachOnly, /Only individual-stroke phase readings/); assert.match(coachOnly, /not lap averages/);
  for (const prof of SWIMMER) assert.doesNotMatch(swimmerStrings(analyse(onlyStrokes, prof), prof).join(' '), /74%|\b70%|lap averages/);

  const both = clone(A);
  both.strokePhases.left.individualStrokes = [stroke(1, 2, 74, 24)];
  const b = by(analyse(both, 'COACH'), 'ASYMMETRY_PROFILE');
  assert.deepEqual(b.meta.phases.left[0], { lap: 1, glide: 9, pull: 67, recovery: 24 }, 'the lap average (9% glide) wins over the single stroke (2%)');
  assert.doesNotMatch(b.measurement.join(' '), /glide 2%/);
  assert.match(sec(analyse(both, 'COACH'), 'ARMS').data.left.coachOnly.join(' '), /diagnostic only and never replace the lap averages/);
});

test('phase timing needs lap averages from two laps on BOTH arms before it counts as a swimmer-facing dimension', () => {
  const oneLap = clone(A); oneLap.strokePhases.left.lapAverages = oneLap.strokePhases.left.lapAverages.slice(0, 1);
  assert.equal(by(analyse(oneLap, 'COACH'), 'ASYMMETRY_PROFILE').meta.phases.left, null);
  assert.equal(by(analyse(oneLap, 'COACH'), 'ASYMMETRY_PROFILE').meta.phases.right !== null, true);
  assert.equal(sec(analyse(oneLap, 'PERFORMANCE'), 'ARMS').data.phases, null, 'bars need both arms');
});

// ------------------------------------------------------------------ EO diagnoses stay out of swimmer reports
test('an inferred technical diagnosis can never masquerade as MEASURED, and never reaches a swimmer unconfirmed', () => {
  const r = analyse(A, 'COACH');
  for (const f of r.findings) if (f.interpretation) assert.notEqual(f.interpretation.classification, 'MEASURED', f.id);
  const to = by(r, 'POSSIBLE_TECHNICAL_OPPORTUNITY');
  assert.equal(to.coachConfirmation.required, true);
  assert.ok(to.coachConfirmation.evidenceNeeded.length >= 2, 'lists the evidence that would settle it');
  assert.match(to.caveats.join(' '), /does not by itself identify/i);
  const p = r.priorities.find((x) => x.ruleId === 'POSSIBLE_TECHNICAL_OPPORTUNITY');
  assert.equal(p.swimmerFacing, false); assert.equal(p.included, false); assert.equal(p.coachOnlyReason, 'Awaiting coach confirmation');
  for (const prof of SWIMMER) assert.doesNotMatch(renderReport(analyse(A, prof).report), /Possible technical opportunity/, prof);
});

test('coach confirmation promotes the finding to INFERRED (never MEASURED) and lets it through', () => {
  const a = clone(A);
  a.coachReview = { findings: { 'possible-technical-opportunity': { status: 'APPROVED', technicalConfirmed: true } } };
  const r = analyse(a, 'PERFORMANCE');
  const to = by(r, 'POSSIBLE_TECHNICAL_OPPORTUNITY');
  assert.equal(to.classification, 'INFERRED'); assert.equal(to.coachConfirmation.required, false);
  assert.equal(r.priorities.find((x) => x.ruleId === 'POSSIBLE_TECHNICAL_OPPORTUNITY').swimmerFacing, true);
  assert.deepEqual(languageViolations(to.text.PERFORMANCE), [], 'even confirmed, swimmer wording stays observational');
});

test('EO diagnoses, referral advice and contradictory claims are preserved for the coach and absent from every swimmer report', () => {
  const swimmerHtml = SWIMMER.map((p) => renderReport(analyse(A, p).report)).join(' ');
  assert.doesNotMatch(swimmerHtml, /elbow (drop|fault)|dropped elbow|referral|clinical|physio|impingement|neuromuscular|technique breakdown|structural/i, 'a drill may say "in front of your elbow"; a diagnosis may not');
  const coachHtml = renderReport(analyse(A, 'COACH').report);
  assert.match(coachHtml, /elbow fault/i, 'the coach sees EO\'s claim, paraphrased');
  assert.match(coachHtml, /EO inference, not adopted/); assert.match(coachHtml, /clinical referral/); assert.match(coachHtml, /Truncated in source/);
  assert.match(coachHtml, /CONTRADICTION/);
  assert.ok(A.eoObservations.some((o) => /elbow/.test(o.text)), 'source observations are not overwritten');
});

// ------------------------------------------------------------------ language and grounding
test('unsupported inference prevention: no swimmer-facing string diagnoses, blames a cause, labels an arm good/bad or says physio', () => {
  for (const fx of [A, B]) for (const prof of SWIMMER) {
    const r = analyse(fx, prof);
    for (const s of swimmerStrings(r, prof)) assert.deepEqual(languageViolations(s), [], `${fx.swimmer.name}/${prof}: "${s}"`);
  }
});

test('language guard itself: allowed phrasing passes, banned phrasing is caught', () => {
  assert.deepEqual(languageViolations('The right-side force pattern is less smooth.'), []);
  assert.deepEqual(languageViolations('Left arm shows a simpler force-delivery pattern.'), []);
  for (const bad of ['Your dropped elbow causes this.', 'Elbow drop is the problem.', 'The left arm is efficient.', 'Your good arm and bad arm differ.', 'Because of your catch breakdown', 'You have a technique fault in the left arm', 'consult a physiotherapist']) assert.notDeepEqual(languageViolations(bad), [], bad);
});

test('every number a swimmer reads is in the data or is arithmetic on it (nothing invented)', () => {
  for (const fx of [A, B]) {
    const allowed = allowedNumbers(fx);
    for (const prof of SWIMMER) for (const s of swimmerStrings(analyse(fx, prof), prof)) assert.deepEqual(ungroundedNumbers(s, allowed), [], `${fx.swimmer.name}/${prof}: "${s}"`);
  }
});

// ------------------------------------------------------------------ missing data
test('a swimmer with NO data gets no findings, no priorities, no numbers and no fake placeholders', () => {
  const a = emptyAnalysis('Nobody');
  for (const prof of ALL_PROFILES) {
    const r = analyse(a, prof);
    assert.deepEqual(r.findings, [], prof); assert.deepEqual(r.priorities, [], prof);
    for (const s of r.report.sections.filter((x) => !['HERO', 'EVIDENCE', 'DATA_QUALITY', 'SOURCE'].includes(x.id))) assert.equal(s.status, 'MISSING', `${prof} ${s.id}`);
    const html = renderReport(r.report);
    const body = html.replace(/<section[^>]*data-sec="DATA_QUALITY"[\s\S]*?<\/section>/, '');
    const text = stripTags(body).replace(/AQUA SHARKS LAB|Aqua Sharks Lab|EO Labs SwimBETTER|SwimBETTER|SWIMBETTER/gi, '');
    assert.doesNotMatch(text, /\d/, `${prof}: no digit may appear when the source has none`);
    assert.doesNotMatch(html, /NaN|undefined|null|Infinity/, prof);
  }
});

test('the thin source adapts: sections without evidence are omitted, not faked', () => {
  const r = analyse(B, 'PERFORMANCE');
  assert.equal(sec(r, 'COMPARISON').status, 'MISSING'); assert.equal(sec(r, 'COMPARISON').data, null);
  assert.equal(by(r, 'LAP_COMPARISON'), undefined);
  assert.equal(sec(r, 'HERO').data.sessionLine, 'Freestyle', 'only what the source printed: no distance, time, laps or pool are invented');
  assert.deepEqual(sec(r, 'HERO').data.keyMetrics, []);
  const html = renderReport(r.report);
  assert.doesNotMatch(html, /data-sec="COMPARISON"/); assert.match(html, /data-sec="POWER"/);
  assert.match(html, /Smooth out|Look at both arms/i, 'asymmetry still reports from the qualitative evidence');
  const as = by(r, 'ASYMMETRY_PROFILE');
  assert.equal(as.confidence, 'LOW', 'only one dimension of left/right evidence'); assert.match(as.caveats.join(' '), /Only one dimension/);
  assert.equal(sec(r, 'ARMS').data.phases, null, 'no stroke-phase data, so no phase bars');
});

test('force direction with only forward and down: only those categories are shown', () => {
  const a = overlay(emptyAnalysis('X'), { forceDistribution: { overall: { propulsivePct: num(30, '%', P.coach('t')), downwardPct: num(45, '%', P.coach('t')) } } });
  const r = analyse(a, 'PERFORMANCE');
  assert.deepEqual(sec(r, 'POWER').data.categories.map((c) => c.id), ['forward', 'down']);
  assert.doesNotMatch(by(r, 'POWER_EFFECTIVENESS').text.PERFORMANCE, /sideways/);
  assert.equal(sec(r, 'POWER').status, 'PARTIAL');
});

test('only one of forward/down present: the force-direction rule does not fire', () => {
  const a = overlay(emptyAnalysis('X'), { forceDistribution: { overall: { propulsivePct: num(30, '%', P.coach('t')) } } });
  assert.equal(by(analyse(a, 'COACH'), 'POWER_EFFECTIVENESS'), undefined);
});

const lc2 = (patch) => overlay(emptyAnalysis('X'), { lapComparisons: [overlay(emptyComparison('c'), { from: lapRef([1], null, P.coach('t')), to: lapRef([8], null, P.coach('t')), ...patch })] });

test('a lap comparison needs two quantified measures; one is not enough, and no laps means no comparison', () => {
  assert.equal(by(analyse(lc2({ strokeRate: { from: num(30, '', P.coach('t')), to: num(28, '', P.coach('t')) } }), 'COACH'), 'LAP_COMPARISON'), undefined);
  assert.ok(by(analyse(lc2({ strokeRate: { from: num(30, '', P.coach('t')), to: num(28, '', P.coach('t')) }, propulsivePower: { change: rng([-40, -30], '%', P.coach('t')) } }), 'COACH'), 'LAP_COMPARISON'));
  const noLaps = lc2({ strokeRate: { from: num(30, '', P.coach('t')), to: num(28, '', P.coach('t')) }, propulsivePower: { change: rng([-40, -30], '%', P.coach('t')) } });
  noLaps.lapComparisons[0].from.laps = [];
  assert.equal(by(analyse(noLaps, 'COACH'), 'LAP_COMPARISON'), undefined, 'lap identity is required, never assumed');
});

test('removing the lap-8 shares drops the share rows and the remainder', () => {
  const a = clone(A); a.lapComparisons[0].forceShares.to = emptyComparison('x').forceShares.to;
  const f = by(analyse(a, 'COACH'), 'LAP_COMPARISON');
  assert.ok(f); assert.equal(f.meta.rows.some((r) => r.id === 'forwardShare'), false); assert.equal(f.meta.remainder, null);
  assert.equal(f.corroboration.signals.some((s) => s.id === 'forwardShare'), false);
});

// ------------------------------------------------------------------ percentage changes
test('comparison rows: ranges stay ranges, derived changes are labelled derived, shares are percentage points', () => {
  const f = by(analyse(A, 'COACH'), 'LAP_COMPARISON');
  const row = (id) => f.meta.rows.find((r) => r.id === id);
  assert.equal(row('strokeRate').via, 'DERIVED'); assert.equal(Math.round(row('strokeRate').lo * 100) / 100, -5.25);
  assert.equal(row('forwardShare').kind, 'points'); assert.equal(Math.round(row('forwardShare').lo * 10) / 10, -5.6);
  assert.equal(Math.round(row('downwardShare').lo * 10) / 10, 0.7);
  assert.equal(Math.round(f.meta.remainder.from * 10) / 10, 22.5); assert.equal(Math.round(f.meta.remainder.to * 10) / 10, 27.4); assert.equal(f.meta.remainder.derived, true);
});

test('title is only "falls more" when it holds at the least favourable end of the range', () => {
  const a = clone(A); a.lapComparisons[0].propulsivePower.change = rng([-6, -3], '%', P.coach('t'));
  const f = by(analyse(a, 'COACH'), 'LAP_COMPARISON');
  assert.doesNotMatch(f.title, /falls more/); assert.equal(f.meta.headlineKey, 'GENERIC');
});

test('exact, complete inputs earn HIGH confidence (it is not capped for no reason)', () => {
  const t = P.eo('x');
  const a = lc2({ strokeRate: { from: num(30, '', t), to: num(28, '', t) }, pullPower: { change: num(-24, '%', t) }, propulsivePower: { change: num(-36, '%', t) },
    forceShares: { from: { propulsivePct: num(40, '%', t), downwardPct: num(40, '%', t) }, to: { propulsivePct: num(34, '%', t), downwardPct: num(40, '%', t) } } });
  const f = by(analyse(a, 'COACH'), 'LAP_COMPARISON');
  assert.equal(f.confidence, 'HIGH'); assert.equal(f.corroboration.status, 'CORROBORATED');
});

// ------------------------------------------------------------------ left / right
test('asymmetry: arms are identified from the data, so swapping the values swaps the arms', () => {
  const a = clone(A);
  [a.leftRight.avgImpulseW.left, a.leftRight.avgImpulseW.right] = [a.leftRight.avgImpulseW.right, a.leftRight.avgImpulseW.left];
  a.powerProfile = { left: A.powerProfile.right, right: A.powerProfile.left };
  a.strokePhases = { left: A.strokePhases.right, right: A.strokePhases.left };
  const as = by(analyse(a, 'COACH'), 'ASYMMETRY_PROFILE');
  assert.equal(as.meta.multiArm, 'left'); assert.equal(as.meta.outputGap.higher, 'LEFT'); assert.match(as.title, /left-side/);
  assert.deepEqual(as.meta.phases.left[0], { lap: 1, glide: 12, pull: 62, recovery: 27 }, 'phases swap with the arms');
});

test('asymmetry: equal power and no other evidence produces no left/right finding', () => {
  const t = P.coach('t');
  const a = overlay(emptyAnalysis('X'), { leftRight: { avgImpulseW: { left: num(80, 'W', t), right: num(80, 'W', t) } } });
  assert.equal(by(analyse(a, 'COACH'), 'ASYMMETRY_PROFILE'), undefined);
});

test('asymmetry never labels an arm good/bad and never says a gap is a fault by itself', () => {
  const as = by(analyse(A, 'COACH'), 'ASYMMETRY_PROFILE');
  assert.match(as.meta.opportunity, /not automatically a fault/);
  const left = as.meta.arms.left.points.join(' '), right = as.meta.arms.right.points.join(' ');
  assert.match(left, /Lower output/); assert.match(left, /Simpler force-delivery/); assert.match(right, /Higher output/); assert.match(right, /Less smooth/);
  assert.doesNotMatch(left + right, /\b(good|bad|efficient|inefficient|weak|dominant)\b/i);
});

// ------------------------------------------------------------------ coach review
test('suppressed finding disappears from the swimmer report and from priorities, but the coach still sees it flagged', () => {
  const a = clone(A); a.coachReview = { findings: { 'lap-comparison': { status: 'SUPPRESSED' } } };
  const r = analyse(a, 'PERFORMANCE');
  assert.equal(sec(r, 'COMPARISON').status, 'MISSING');
  assert.equal(r.priorities.find((p) => p.ruleId === 'LAP_COMPARISON').included, false);
  assert.doesNotMatch(renderReport(r.report), /FIRST 25 m|Keep your forward power|data-sec="COMPARISON"/);
  const c = analyse(a, 'COACH');
  assert.match(renderReport(c.report), /Suppressed/);
  assert.ok(sec(c, 'EVIDENCE').data.findings.find((f) => f.ruleId === 'LAP_COMPARISON'));
  assert.equal(sec(c, 'FOCUS').data.priorities.find((p) => p.findingId === 'lap-comparison').suppressed, true);
});

test('coach can reorder priorities, edit swimmer wording and pick a drill; MEASURED data is untouched', () => {
  const a = clone(A);
  a.coachReview = { priorityOrder: ['asymmetry-profile'], findings: { 'power-effectiveness': { status: 'EDITED', editedText: 'Coach wording.' } }, drillChoice: { 'asymmetry-profile': 'paddles-snorkel' } };
  const r = analyse(a, 'PERFORMANCE');
  assert.equal(r.priorities[0].ruleId, 'ASYMMETRY_PROFILE'); assert.equal(r.priorities[0].drillId, 'paddles-snorkel');
  const pe = by(r, 'POWER_EFFECTIVENESS');
  assert.equal(pe.text.PERFORMANCE, 'Coach wording.'); assert.equal(pe.text.COACH.includes('Coach wording'), false);
  assert.equal(pe.classification, 'MEASURED'); assert.deepEqual(pe.measurement, by(analyse(A, 'PERFORMANCE'), 'POWER_EFFECTIVENESS').measurement);
});

test('applyReview does not mutate its inputs', () => {
  const fs = runRules(A); const before = JSON.stringify(fs);
  applyReview(fs, { findings: { 'lap-comparison': { status: 'EDITED', editedText: 'x' } } });
  assert.equal(JSON.stringify(fs), before);
});

// ------------------------------------------------------------------ profiles
test('one engine, four profiles: same findings, different presentation', () => {
  const runs = Object.fromEntries(ALL_PROFILES.map((p) => [p, analyse(A, p)]));
  const ids = (r) => r.findings.map((f) => f.id).join();
  for (const p of ALL_PROFILES) assert.equal(ids(runs[p]), ids(runs.COACH), `${p} finds the same things`);
  assert.equal(sec(runs.JUNIOR, 'HERO').data.keyMetrics.length, 2); assert.equal(sec(runs.PERFORMANCE, 'HERO').data.keyMetrics.length, 3);
  assert.deepEqual(sec(runs.JUNIOR, 'POWER').data.categories.map((c) => c.id), ['forward', 'down', 'side'], 'JUNIOR drops the "other" slice');
  assert.deepEqual(sec(runs.PERFORMANCE, 'POWER').data.categories.map((c) => c.id), ['forward', 'down', 'side', 'other']);
  assert.equal(sec(runs.JUNIOR, 'COMPARISON').data.rows.every((r) => ['strokeRate', 'propulsivePower'].includes(r.id)), true);
  for (const p of SWIMMER) assert.deepEqual(runs[p].report.sections.map((s) => s.id).filter((i) => ['EVIDENCE', 'DATA_QUALITY', 'SOURCE'].includes(i)), [], p);
  assert.deepEqual(runs.COACH.report.sections.map((s) => s.id).slice(-3), ['EVIDENCE', 'DATA_QUALITY', 'SOURCE']);
  assert.notEqual(by(runs.JUNIOR, 'POWER_EFFECTIVENESS').text.JUNIOR, by(runs.PERFORMANCE, 'POWER_EFFECTIVENESS').text.PERFORMANCE);
});

test('JUNIOR report shows no force numbers on the comparison rows and COACH shows classification + confidence', () => {
  const junior = renderReport(analyse(A, 'JUNIOR').report);
  assert.doesNotMatch(junior, /rv-ffromto/); assert.match(junior, /LOWER/);
  const coach = renderReport(analyse(A, 'COACH').report);
  assert.match(coach, /Coach confirmation required/); assert.match(coach, /rv-conf-moderate/); assert.match(coach, /rv-class-measured/);
  assert.match(coach, /EO reference ranges/); assert.match(coach, /not adopted as Aqua Sharks thresholds/); assert.match(coach, /ENDPOINT_CHANGE/);
});

test('JUNIOR arm cards carry no figures; PERFORMANCE keeps them', () => {
  const j = sec(analyse(A, 'JUNIOR'), 'ARMS').data, p = sec(analyse(A, 'PERFORMANCE'), 'ARMS').data;
  assert.doesNotMatch(JSON.stringify([j.left.points, j.right.points, j.left.timing, j.right.timing]), /\d/);
  assert.match(JSON.stringify([p.left.points, p.right.points]), /67 W/);
  assert.deepEqual(j.doublePeaks, p.doublePeaks, 'the per-lap bars are a picture, so they stay');
  assert.equal(j.phases.showNumbers, false); assert.equal(p.phases.showNumbers, true);
});

test('EO target ranges are compared as printed in the report, never hardcoded', () => {
  const rows = by(analyse(A, 'COACH'), 'POWER_EFFECTIVENESS').meta.targetRows;
  assert.equal(rows.find((r) => r.key === 'propulsivePct').status, 'BELOW');
  assert.equal(rows.find((r) => r.key === 'propulsivePct').target, '70\u201375%');
  // the report's own range decides: widen it and the same swimmer is no longer below target
  const wide = clone(A); wide.eoReferenceRanges.propulsivePct.lo = 30;
  assert.equal(by(analyse(wide, 'COACH'), 'POWER_EFFECTIVENESS').meta.targetRows.find((r) => r.key === 'propulsivePct').status, 'ON_TARGET');
  // no printed range, no target talk
  const none = clone(A); none.eoReferenceRanges = {};
  const f = by(analyse(none, 'COACH'), 'POWER_EFFECTIVENESS');
  assert.deepEqual(f.meta.targetRows, []); assert.doesNotMatch(JSON.stringify(f.measurement) + f.text.PERFORMANCE, /target/i);
  assert.equal(f.title, 'More of your force goes down than forward');
});

// ------------------------------------------------------------------ data quality
test('data quality: share sum, conflicts and unlabelled laps are surfaced', () => {
  const r = analyse(A, 'COACH'), ids = r.quality.issues.map((i) => i.id);
  assert.ok(ids.includes('si-propulsive') && ids.includes('si-arm-gap') && ids.includes('si-truncated') && ids.includes('si-lap-image'));
  assert.equal(ids.includes('share-sum'), false, 'the table values do sum to about 100');
  const bad = clone(A); bad.forceDistribution.overall.downwardPct.value = 20;
  assert.ok(analyse(bad, 'COACH').quality.issues.some((i) => i.id === 'share-sum'));
  assert.ok(r.quality.counts.MISSING > 0 && r.quality.counts.COMPLETE > 0);
  assert.ok(r.quality.fieldStatuses.every((f) => f.status !== 'COMPLETE'));
});

test('analyse() is pure: the analysis is not mutated, and withDerived fills only the derived layers', () => {
  const a = clone(A); const before = JSON.stringify(a);
  analyse(a, 'COACH');
  assert.equal(JSON.stringify(a), before);
  const d = withDerived(a, 'COACH');
  assert.ok(d.aquaSharksFindings.length > 0 && d.priorities.length > 0);
  assert.deepEqual({ ...d, aquaSharksFindings: [], priorities: [] }, a);
  assert.equal(A.aquaSharksFindings.length, 0, 'fixture stays source-only');
});

test('every non-missing source value in the fixtures carries provenance', () => {
  for (const fx of [A, B]) (function walk(o, path) {
    if (!o || typeof o !== 'object') return;
    if ('status' in o && 'provenance' in o) { if (o.status !== 'MISSING') assert.ok(o.provenance && o.provenance.origin, `${fx.swimmer.name} ${path}`); return; }
    if (Array.isArray(o)) { o.forEach((x, i) => walk(x, `${path}.${i}`)); return; }
    for (const k of Object.keys(o)) walk(o[k], `${path}.${k}`);
  })(fx, '');
});

test('coach evidence list summarises from/to groups with their values', () => {
  const ev = sec(analyse(A, 'COACH'), 'EVIDENCE').data.findings.find((f) => f.ruleId === 'LAP_COMPARISON').resolved;
  const sr = ev.find((e) => e.ref === 'lapComparisons.0.strokeRate');
  assert.match(sr.text, /from ~30\.5 \u2192 to ~28\.9/);
  assert.match(ev.find((e) => e.ref === 'lapComparisons.0.propulsivePower').text, /−33 to −39%/);
  assert.doesNotMatch(sr.text, /n\/a%/);
});

test('arrows are drawn as SVG, never typed: no arrow glyph survives into the report HTML (fonts without it print a box)', () => {
  for (const p of ['JUNIOR', 'PERFORMANCE', 'MASTERS_OPEN_WATER', 'COACH']) {
    const html = renderReport(analyse(A, p).report);
    assert.doesNotMatch(html, /[\u2192\u2190\u2194]/, p);
  }
  const perf = renderReport(analyse(A, 'PERFORMANCE').report);
  assert.match(perf, /class="rv-arr"/); assert.match(perf, /FIRST 25 m\s*<svg class="rv-arr"/);
});
