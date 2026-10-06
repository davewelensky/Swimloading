// The report's pictures (squares, force fans, hand paths, progress line, ruler) and where they appear. Synthetic data only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { squaresSVG, fansSVG, handPathSVG, progressSVG, rulerSVG } from '../aquasharks-lab/analysis/visuals.js';
import { parseEoExport } from '../aquasharks-lab/analysis/parser/eo-export.js';
import { applyEoExport } from '../aquasharks-lab/analysis/export-apply.js';
import { baselineFrom, historyEntry, combinedShare } from '../aquasharks-lab/analysis/progress.js';
import { emptyAnalysis } from '../aquasharks-lab/analysis/model.js';
import { analyse } from '../aquasharks-lab/analysis/engine.js';
import { renderReport } from '../aquasharks-lab/analysis/report-view.js';
import { buildExportZip } from './lab-export-builders.js';
import { testSwimmerA as A } from '../aquasharks-lab/analysis/fixtures/test-swimmer-a-200m.js';

const sec = (r, id) => r.report.sections.find((s) => s.id === id);
const clone = (x) => JSON.parse(JSON.stringify(x));
const count = (s, re) => (s.match(re) || []).length;
const fan = (peakDeg) => Array.from({ length: 360 }, (_, a) => { const d = Math.min(Math.abs(a - peakDeg), 360 - Math.abs(a - peakDeg)); return d < 20 ? 50 * (1 - d / 20) : 0; });
async function importedAnalysis(name = 'Test Swimmer') { const a = emptyAnalysis(name); applyEoExport(a, await parseEoExport(new Uint8Array(buildExportZip()))); return a; }

test('squares: 100 of them, as many forward as the share says, clamped, never NaN', () => {
  for (const [pct, n] of [[35.7, 36], [0, 0], [100, 100], [120, 100], [-5, 0]]) { const s = squaresSVG(pct); assert.equal(count(s, /<rect /g), 100); assert.equal(count(s, /class="vq-f"/g), n, String(pct)); assert.doesNotMatch(s, /NaN|undefined/); }
  assert.match(squaresSVG(36), /36 of every 100 units/);
});
test('fans: the left hand fans out to the left of the centre line, the right hand to the right, on one scale', () => {
  const s = fansSVG(fan(147), fan(224)), x = (cls) => { const d = new RegExp(`class="${cls}" d="([^"]+)"`).exec(s)[1]; const pts = [...d.matchAll(/L([\d.]+),([\d.]+)/g)].map((m) => [+m[1], +m[2]]); return pts.reduce((best, p) => (Math.hypot(p[0] - 200, p[1] - 235) > Math.hypot(best[0] - 200, best[1] - 235) ? p : best)); };
  assert.ok(x('vf-left')[0] < 200 && x('vf-left')[1] < 235, 'left wedge reaches up and to the left');
  assert.ok(x('vf-right')[0] > 200 && x('vf-right')[1] < 235, 'right wedge reaches up and to the right');
  const half = fansSVG(fan(147), fan(224).map((v) => v / 2)), r = (t, c) => Math.hypot(...x2(t, c));
  function x2(t, c) { const d = new RegExp(`class="${c}" d="([^"]+)"`).exec(t)[1]; const pts = [...d.matchAll(/L([\d.]+),([\d.]+)/g)].map((m) => [+m[1] - 200, 235 - +m[2]]); return pts.reduce((b, p) => (Math.hypot(...p) > Math.hypot(...b) ? p : b)); }
  assert.ok(r(half, 'vf-right') < r(half, 'vf-left') * 0.75, 'a hand that sends half the force is drawn smaller: one common scale');
  assert.equal(fansSVG(null, fan(1)), ''); assert.equal(fansSVG([1, 2], [1, 2]), '', 'bad input draws nothing');
});
test('hand paths: from above and from the side, one line per stroke, nothing drawn without strokes', () => {
  const stroke = (lat) => ({ lateral: Array.from({ length: 24 }, (_, i) => lat + i), fwd: Array.from({ length: 24 }, (_, i) => 60 - i * 5), depth: Array.from({ length: 24 }, (_, i) => -Math.sin((i / 23) * Math.PI) * 70) });
  const s = handPathSVG([stroke(-40), stroke(-38)], [stroke(30)]);
  assert.equal(count(s, /class="vp-left"/g), 4); assert.equal(count(s, /class="vp-right"/g), 2); assert.match(s, /FROM ABOVE/); assert.match(s, /FROM THE SIDE/); assert.match(s, /CENTRE LINE/); assert.doesNotMatch(s, /NaN/);
  assert.equal(handPathSVG([], [stroke(1)]), ''); assert.equal(handPathSVG(null, null), '');
});
test('progress line: needs two sessions, draws both lines, labels the ends, ruler marks last time, now and the goal', () => {
  assert.equal(progressSVG([{ label: 'a', forward: 30, down: 40 }]), '');
  const s = progressSVG([{ label: '15 Jun', forward: 30, down: 48 }, { label: '20 Jul', forward: 33, down: 44 }, { label: '17 Aug', forward: 35.7, down: 37.3 }]);
  assert.equal(count(s, /<circle class="vg-fwd-dot"/g), 3); assert.equal(count(s, /<circle class="vg-down-dot"/g), 3); assert.match(s, />35\.7</); assert.match(s, />48</); assert.match(s, /17 Aug/); assert.doesNotMatch(s, /NaN/);
  const r = rulerSVG({ then: 2.8, now: 2.95, goal: 3 }); assert.match(r, /Last time 2\.80 m/); assert.match(r, /Now 2\.95 m/); assert.match(r, /vr-goal/); assert.doesNotMatch(rulerSVG({ then: null, now: 2.9, goal: null }), /Last time|vr-goal/);
});

test('export keeps six real underwater strokes per hand, cropped to the pull', async () => {
  const ex = await parseEoExport(new Uint8Array(buildExportZip()));
  for (const h of ['left', 'right']) { const sm = ex.handPath[h].samples; assert.ok(sm.length >= 1 && sm.length <= 6); for (const p of sm) { assert.equal(p.depth.length, 24); assert.ok(Math.min(...p.depth) < -20, 'a real pull is below the surface'); } }
});
test('report: squares in "where your power goes", fans in "each hand", real paths in "your hands, underwater"; juniors still get pictures', async () => {
  const a = await importedAnalysis(); a.forceDistribution.overall = clone(A.forceDistribution.overall);
  const r = analyse(a, 'PERFORMANCE'), html = renderReport(r.report);
  assert.equal(sec(r, 'POWER').data.squares, Math.round(a.forceDistribution.overall.propulsivePct.value));
  assert.match(html, /class="rv-squares"/); assert.match(html, /class="rv-fans"/); assert.match(html, /class="rv-path"/);
  assert.ok(sec(r, 'HANDPATH').data.facts[0], 'a plain fact comes with the picture');
  assert.match(sec(r, 'HANDPATH').data.facts.join(' '), /crosses the centre line by about 5 cm/);
  const j = renderReport(analyse(a, 'JUNIOR').report); assert.match(j, /class="rv-path"/); assert.doesNotMatch(sec(analyse(a, 'JUNIOR'), 'HANDPATH').data.facts.join(' '), /below the surface|sweeps inward/);
  const idx = r.report.sections.map((s) => s.id); assert.ok(idx.indexOf('HANDS') < idx.indexOf('HANDPATH') && idx.indexOf('PROGRESS') < idx.indexOf('FOCUS'));
  const none = await importedAnalysis(); none.eoExport.handPath.left.samples = []; assert.equal(sec(analyse(none, 'PERFORMANCE'), 'HANDPATH').status, 'MISSING');
});

test('the swimmer\'s line grows with each report: history is carried forward, tiles are facts, nothing is drawn from one session', async () => {
  const a1 = await importedAnalysis(); a1.session.date.value = '2026-06-15';
  const a2 = clone(a1); a2.session.date.value = '2026-07-20'; a2.baseline = baselineFrom(a1); a2.metrics.propulsivePct.value = 40; a2.metrics.strokeRate.value = 29.5;
  const a3 = clone(a1); a3.session.date.value = '2026-08-17'; a3.baseline = baselineFrom(a2); a3.metrics.propulsivePct.value = 44;
  assert.equal(a2.baseline.history.length, 1); assert.equal(a3.baseline.history.length, 2); assert.deepEqual(a3.baseline.history.map((h) => h.date), ['2026-06-15', '2026-07-20']);
  const p = sec(analyse(a3, 'PERFORMANCE'), 'PROGRESS').data;
  assert.deepEqual(p.chart.map((x) => x.label), ['15 Jun', '20 Jul', '17 Aug']);
  assert.ok(p.tiles.some((t) => /force going forward/.test(t.label)), JSON.stringify(p.tiles)); assert.match(renderReport(analyse(a3, 'PERFORMANCE').report), /class="rv-progress-chart"/);
  const two = sec(analyse(a2, 'PERFORMANCE'), 'PROGRESS').data; assert.equal(two.chart.length, 2);
  assert.equal(sec(analyse(a1, 'PERFORMANCE'), 'PROGRESS').status, 'MISSING', 'no earlier session, no progress picture');
  assert.equal(historyEntry(a1).date, '2026-06-15');
});
test('without the EO report the combined shares are rebuilt from the two hands, weighted by force; with it, EO\'s own are used', async () => {
  const a = await importedAnalysis(); const v = combinedShare(a, 'downwardPct'); assert.ok(v > 24.2 && v < 44.1);
  const lw = a.eoExport.forceField.left.mean.fpsN, rw = a.eoExport.forceField.right.mean.fpsN;
  assert.equal(v, Math.round(((a.eoExport.forceField.left.mean.downward * lw + a.eoExport.forceField.right.mean.downward * rw) / (lw + rw)) * 10) / 10);
  a.forceDistribution.overall = clone(A.forceDistribution.overall); assert.equal(combinedShare(a, 'downwardPct'), A.forceDistribution.overall.downwardPct.value);
});
