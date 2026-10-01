// Pure calculations: percentage change, early/late, left/right asymmetry, conservative comparison, cross-check, confidence.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as calc from '../aquasharks-lab/analysis/calc.js';
import { bounds, pctChange, pointChange, round, changeOf, largerMagnitude, asymmetry, directionOf, corroborate, printedValues, hasRealConflict, confidenceOf, shareSum } from '../aquasharks-lab/analysis/calc.js';
import { num, rng, missing, obs, P, emptyAnalysis, present } from '../aquasharks-lab/analysis/model.js';
import { span, lapLabel, lapName } from '../aquasharks-lab/analysis/language.js';

const prov = P.coach('t');

test('pctChange: signed, relative to the starting value, null when it cannot be computed', () => {
  assert.equal(round(pctChange(30.5, 28.9), 2), -5.25);
  assert.equal(pctChange(100, 150), 50);
  assert.equal(pctChange(0, 5), null, 'divide by zero is null, not Infinity');
  assert.equal(pctChange(null, 5), null);
  assert.equal(pctChange(5, undefined), null);
  assert.equal(pointChange(37.7, 32.1) !== null && round(pointChange(37.7, 32.1), 1), -5.6);
  assert.equal(pointChange(null, 3), null);
});

test('round never returns -0 and handles non-numbers', () => {
  assert.equal(Object.is(round(-0.04, 1), 0), true);
  assert.equal(round(NaN), null);
  assert.equal(round(null), null);
  assert.equal(round(-5.25, 1), -5.3, 'half away from zero');
});

test('bounds: point, range, missing', () => {
  assert.deepEqual(bounds(num(5, '', prov)), [5, 5]);
  assert.deepEqual(bounds(rng([-25, -23], '%', prov)), [-25, -23]);
  assert.deepEqual(bounds(rng([-23, -25], '%', prov)), [-25, -23], 'range ends are sorted');
  assert.equal(bounds(missing('%')), null);
});

test('changeOf: uses the reported change; derives from early/late only when both are real values; never invents', () => {
  const reported = { from: missing(), to: missing(), change: rng([-39, -33], '%', prov), changeUnit: 'pct' };
  assert.deepEqual(changeOf(reported), { lo: -39, hi: -33, via: 'REPORTED', approximate: true });
  const derived = { from: num(30.5, '', prov), to: num(28.9, '', prov), change: missing('%'), changeUnit: 'pct' };
  const d = changeOf(derived);
  assert.equal(d.via, 'DERIVED'); assert.equal(round(d.lo, 2), -5.25); assert.equal(d.lo, d.hi);
  assert.equal(changeOf({ from: num(30.5, '', prov), to: missing(), change: missing('%'), changeUnit: 'pct' }), null, 'one side only is not enough');
  assert.equal(changeOf({ from: missing(), to: missing(), change: missing('%'), changeUnit: 'pct' }), null);
  assert.equal(changeOf({ from: rng([1, 2], '', prov), to: num(3, '', prov), change: missing('%'), changeUnit: 'pct' }), null, 'a range is never collapsed to a midpoint to derive a change');
});

test('largerMagnitude is conservative: overlapping ranges are UNCLEAR', () => {
  assert.equal(largerMagnitude({ lo: -39, hi: -33 }, { lo: -5.25, hi: -5.25 }), 'A');
  assert.equal(largerMagnitude({ lo: -5, hi: -5 }, { lo: -39, hi: -33 }), 'B');
  assert.equal(largerMagnitude({ lo: -6, hi: -3 }, { lo: -5.25, hi: -5.25 }), 'UNCLEAR');
  assert.equal(largerMagnitude({ lo: -10, hi: -5 }, { lo: -8, hi: -4 }), 'UNCLEAR');
});

test('asymmetry: direction, ratio, difference and symmetry index; equal and invalid inputs', () => {
  const x = asymmetry(67, 101);
  assert.equal(x.higher, 'RIGHT');
  assert.equal(round(x.ratio, 3), 1.507);
  assert.equal(round(x.differencePctOfLower, 1), 50.7);
  assert.equal(round(x.symmetryIndexPct, 1), 40.5);
  const y = asymmetry(101, 67);
  assert.equal(y.higher, 'LEFT'); assert.equal(round(y.symmetryIndexPct, 1), -40.5, 'sign flips with the higher arm');
  assert.equal(asymmetry(50, 50).higher, 'EQUAL'); assert.equal(asymmetry(50, 50).differencePctOfLower, 0);
  assert.equal(asymmetry(0, 50), null, 'a zero arm cannot give a ratio');
  assert.equal(asymmetry(null, 50), null);
});

test('no multiplicative propulsive-power equation exists: corroboration compares DIRECTION only', () => {
  assert.equal(calc.crossCheckPropulsivePower, undefined, 'the unsupported equation is not exported');
  assert.equal(Object.keys(calc).some((k) => /cross.?check|predict|expected/i.test(k)), false);
  assert.equal(directionOf({ lo: -25, hi: -23 }), 'DOWN');
  assert.equal(directionOf({ lo: 3, hi: 5 }), 'UP');
  assert.equal(directionOf({ lo: -2, hi: 4 }), 'UNCLEAR', 'a range crossing zero has no clear direction');
  assert.equal(directionOf(null), 'UNCLEAR');
  const s = (...d) => d.map((direction, i) => ({ id: 's' + i, label: 's' + i, direction }));
  assert.equal(corroborate(s('DOWN', 'DOWN', 'DOWN')).status, 'CORROBORATED');
  assert.equal(corroborate(s('DOWN', 'DOWN')).status, 'CORROBORATED');
  assert.equal(corroborate(s('DOWN')).status, 'PARTIAL', 'one signal corroborates nothing');
  assert.equal(corroborate(s('DOWN', 'UNCLEAR')).status, 'PARTIAL');
  assert.equal(corroborate(s('DOWN', 'UP')).status, 'CONFLICTING');
  assert.equal(corroborate([]).status, 'NOT_TESTABLE');
});

test('printedValues keeps every printed value with its location; rounding-level variants are not real conflicts', () => {
  const m = num(34.7, '%', P.eo('table'), { alternates: [{ value: 35.16, location: 'summary' }, { value: 34.67, location: 'narrative' }] });
  const v = printedValues(m);
  assert.deepEqual(v.map((x) => x.value), [34.7, 35.16, 34.67]);
  assert.deepEqual(v.map((x) => x.used), [true, false, false]);
  assert.deepEqual(v.map((x) => x.location), ['table', 'summary', 'narrative']);
  assert.equal(hasRealConflict(m), true, '35.16 vs 34.7 is a real disagreement');
  assert.equal(hasRealConflict(num(34.7, '%', prov, { alternates: [{ value: 34.67, location: 'x' }] })), false, '34.67 vs 34.7 is precision only');
  assert.deepEqual(printedValues(missing('%')), []);
});

test('lapLabel/lapName come from real lap identifiers, never from the words early/late', () => {
  assert.equal(lapLabel({ laps: [1], distanceM: { from: 0, to: 25 } }, 200), 'FIRST 25 m');
  assert.equal(lapLabel({ laps: [8], distanceM: { from: 175, to: 200 } }, 200), 'LAST 25 m');
  assert.equal(lapLabel({ laps: [4], distanceM: { from: 75, to: 100 } }, 200), 'LAP 4', 'a middle lap is just a lap');
  assert.equal(lapLabel({ laps: [3, 4, 5], distanceM: null }, 200), 'LAPS 3-5');
  assert.equal(lapLabel({ laps: [8], distanceM: null }, 200), 'LAP 8', 'without distances it cannot claim "last 25 m"');
  assert.equal(lapLabel({ laps: [], distanceM: null }, 200), '');
  assert.equal(lapName({ laps: [1] }), 'lap 1'); assert.equal(lapName({ laps: [2, 5] }), 'laps 2-5');
});

test('confidenceOf: HIGH only for exact complete values; approximate/ranged/conflicting cap at MODERATE; ambiguous or missing is LOW', () => {
  assert.equal(confidenceOf([num(1, '', prov), num(2, '', prov)]), 'HIGH');
  assert.equal(confidenceOf([num(1, '', prov), num(2, '', prov, { approximate: true })]), 'MODERATE');
  assert.equal(confidenceOf([rng([1, 2], '', prov)]), 'MODERATE');
  assert.equal(confidenceOf([num(1, '', prov, { status: 'PARTIAL' })]), 'MODERATE');
  assert.equal(confidenceOf([num(1, '', prov, { alternates: [{ value: 1.5, location: 'x' }] })]), 'MODERATE', 'conflicting printed values');
  assert.equal(confidenceOf([num(1, '', prov, { alternates: [{ value: 1.02, location: 'x' }] })]), 'HIGH', 'rounding-level alternates do not cap');
  assert.equal(confidenceOf([num(1, '', prov, { status: 'AMBIGUOUS' })]), 'LOW');
  assert.equal(confidenceOf([num(1, '', prov), missing()]), 'LOW', 'any missing input is LOW');
});

test('shareSum ignores missing and ranged shares', () => {
  const a = emptyAnalysis('x'); a.forceDistribution.overall.propulsivePct = num(30, '%', prov); a.forceDistribution.overall.downwardPct = num(40, '%', prov);
  assert.deepEqual(shareSum(a.forceDistribution.overall, ['propulsivePct', 'downwardPct', 'upwardPct']), { sum: 70, n: 2 });
});

test('span orders by magnitude so declines read naturally', () => {
  assert.equal(span(-25, -23), '−23 to −25');
  assert.equal(span(-39, -33), '−33 to −39');
  assert.equal(span(-5.25, -5.25, 1), '−5.3');
  assert.equal(present(obs('X', prov, 'MISSING')), false, 'a MISSING status is never treated as present, even if a value is attached');
  assert.equal(present(obs('X', prov, 'COMPLETE')), true);
});
