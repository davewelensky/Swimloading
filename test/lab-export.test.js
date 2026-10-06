// EO data export (the "FullSwim" zip): spreadsheet reader, parser, merge into an analysis, and the swimmer-facing "each hand" section. Synthetic data only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readXlsx } from '../aquasharks-lab/analysis/parser/xlsx.js';
import { parseEoExport } from '../aquasharks-lab/analysis/parser/eo-export.js';
import { applyEoExport, isoFromExportDate, secondsFromDuration } from '../aquasharks-lab/analysis/export-apply.js';
import { emptyAnalysis, overlay, num, obs, P } from '../aquasharks-lab/analysis/model.js';
import { analyse } from '../aquasharks-lab/analysis/engine.js';
import { renderReport } from '../aquasharks-lab/analysis/report-view.js';
import { parseUpload } from '../api/_lib/lab-report/workflow.js';
import { testSwimmerA as A } from '../aquasharks-lab/analysis/fixtures/test-swimmer-a-200m.js';
import { buildXlsx, buildExportZip, SWIM_ID } from './lab-export-builders.js';

const sec = (r, id) => r.report.sections.find((s) => s.id === id);
const clone = (x) => JSON.parse(JSON.stringify(x));
const zip = () => new Uint8Array(buildExportZip());

test('xlsx reader: numbers, inline and shared strings, empty cells, columns past Z', async () => {
  const rows = [['a', 1.5, null, 'b'], [], ...Array.from({ length: 2 }, () => [])]; rows[2][27] = 'AB'; rows[2][1] = 7;
  for (const shared of [false, true]) {
    const x = await readXlsx(new Uint8Array(buildXlsx([{ name: 'one', rows }, { name: 'two', rows: [['x']] }], { shared })));
    assert.deepEqual(x.names, ['one', 'two']); const s = x.sheet('one');
    assert.equal(s[0][0], 'a'); assert.equal(s[0][1], 1.5); assert.equal(s[0][2] ?? null, null); assert.equal(s[0][3], 'b'); assert.equal(s[2][27], 'AB'); assert.equal(s[2][1], 7);
  }
  const only = await readXlsx(new Uint8Array(buildXlsx([{ name: 'one', rows: [['x']] }, { name: 'two', rows: [['y']] }])), { only: ['two'] });
  assert.equal(only.sheet('one'), null); assert.equal(only.sheet('two')[0][0], 'y');
});

test('export parser: summary, per-lap table, each hand\'s own force field, hand path in cm, phases', async () => {
  const ex = await parseEoExport(zip(), { filename: 'f.zip' });
  assert.equal(ex.swimId, SWIM_ID); assert.equal(ex.laps.length, 3);
  assert.deepEqual([ex.summary.stroke, ex.summary.distanceM, ex.summary.laps, ex.summary.strokesLeft, ex.summary.strokesRight, ex.summary.avgDps], ['Freestyle', 75, 3, 24, 26, 1.5]);
  assert.deepEqual(ex.laps[0].left, { fpsN: 40, propN: 14, ppsW: 120, propW: 40, rate: 30 });
  const L = ex.forceField.left, R = ex.forceField.right;
  assert.equal(L.byLap[0].downward, 55); assert.equal(R.byLap[0].leftward, 34); assert.equal(L.mean.downward, 50, 'mean of 55, 50, 45');
  assert.equal(L.fan.length, 360); assert.equal(L.fan[0], 1.5); assert.equal(R.fan[2], 1);
  const hl = ex.handPath.left, hr = ex.handPath.right;
  assert.equal(hl.strokes, 6); assert.deepEqual([hl.depthCm.median, hl.depthCm.max], [75, 80]); assert.deepEqual([hl.widthCm.median, hl.widthCm.max], [52, 54]);
  assert.equal(hl.crossingCm.median, 5, 'the left hand passes the centreline by 5 cm in every stroke'); assert.equal(hl.crossingCm.strokesCrossing, 6);
  assert.equal(hr.crossingCm.median, 0); assert.equal(hr.crossingCm.strokesCrossing, 0); assert.equal(hr.nearestCm.median, 10);
  assert.deepEqual([ex.phases.left[0].glidePct, ex.phases.left[0].pullPct, ex.phases.left[0].recoveryPct], [10, 50, 40]);
  assert.equal(ex.phases.right[0].pullPct, 55);
});
test('export parser refuses what is not an EO export, and says why', async () => {
  await assert.rejects(parseEoExport(new Uint8Array(buildExportZip({ omit: ['ForceField'] }))), (e) => e.code === 'export_unrecognised' && /not an EO SwimBETTER data export/.test(e.message));
  await assert.rejects(parseEoExport(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22])), /ZIP/);
});

test('dates and durations are read by hand, not through toISOString', () => {
  assert.equal(isoFromExportDate('Aug 17, 2026'), '2026-08-17'); assert.equal(isoFromExportDate('Jan 3, 2027'), '2027-01-03'); assert.equal(isoFromExportDate('nonsense'), null);
  assert.equal(secondsFromDuration('03:09.60'), 189.6); assert.equal(secondsFromDuration('1:02:03.5'), 3723.5); assert.equal(secondsFromDuration('x'), null);
});

async function imported(a) { const ex = await parseEoExport(zip(), { filename: 'f.zip' }); const r = applyEoExport(a || emptyAnalysis('Test Swimmer'), ex); return { ex, r }; }
test('merge: fills the session, metrics, per-lap hand power, lap comparison, phases and hand path with origin EO_EXPORT', async () => {
  const a = emptyAnalysis('Test Swimmer'); const { r } = await imported(a);
  assert.equal(a.session.date.value, '2026-08-17'); assert.equal(a.session.timeS.value, 80.5); assert.equal(a.session.poolLengthM.value, 25); assert.equal(a.session.strokeCount.value, 50, 'left plus right, as EO prints it');
  assert.equal(a.metrics.avgPowerW.value, 87); assert.equal(a.session.stroke.provenance.origin, 'EO_EXPORT');
  assert.deepEqual(a.leftRight.byLap.map((b) => [b.lap, b.leftW.value, b.rightW.value, b.higher.value]), [[1, 120, 60, 'LEFT'], [2, 110, 58, 'LEFT'], [3, 100, 54, 'LEFT']]);
  assert.equal(a.leftRight.avgImpulseW.left.value, 110); assert.equal(a.leftRight.avgImpulseW.right.value, 57.3);
  const c = a.lapComparisons[0]; assert.equal(c.kind, 'ENDPOINT_CHANGE'); assert.deepEqual([c.from.laps, c.to.laps], [[1], [3]]); assert.equal(c.pullPower.change.value, -14.4, '(120+60)/2=90 to (100+54)/2=77'); assert.equal(c.propulsivePower.change.value, -17.7, '(40+22)/2=31 to (32+19)/2=25.5');
  assert.equal(a.strokePhases.left.lapAverages.length, 3); assert.equal(a.handPathReading.left.maxDepthCm.range.join(), '75,80'); assert.equal(a.handPathReading.left.maxDepthCm.approximate, false);
  assert.equal(a.handPathReading.crossesMidline.value, 'YES'); assert.equal(a.source.exportId, SWIM_ID); assert.ok(r.applied.includes('lapComparisons'));
});
test('merge: a value the EO report already gave is kept; a disagreement over 1% is flagged, a match is silent', async () => {
  const a = emptyAnalysis('Test Swimmer'); a.metrics.avgPowerW = num(87, 'W', P.eo('Summary')); a.metrics.distancePerStrokeM = num(1.8, 'm', P.eo('Summary')); a.session.date = obs('2026-01-01', P.eo('header'));
  const { r } = await imported(a);
  assert.equal(a.metrics.avgPowerW.value, 87); assert.equal(a.metrics.distancePerStrokeM.value, 1.8, 'the report\'s value is not overwritten'); assert.equal(a.session.date.value, '2026-01-01');
  assert.equal(r.issues.length, 1); assert.match(r.issues[0], /metrics\.distancePerStrokeM.*1\.8.*1\.5/); assert.ok(a.sourceIssues.some((i) => i.kind === 'CONFLICTING_VALUES'));
});
test('crossing the centreline is a measurement: YES only when the typical stroke of a hand passes it', async () => {
  const a = emptyAnalysis('T'); await imported(a); assert.equal(a.handPathReading.crossesMidline.value, 'YES');
  const ex = await parseEoExport(zip()); ex.handPath.left.crossingCm = { median: 0, max: 2, strokesCrossing: 1 };
  const b = emptyAnalysis('T'); applyEoExport(b, ex); assert.equal(b.handPathReading.crossesMidline.value, 'NO', 'one stroke over the line is not the typical stroke');
});

test('report from the export alone: lap comparison and left against right are exact; force direction waits for the EO report', async () => {
  const a = emptyAnalysis('Test Swimmer'); await imported(a);
  const r = analyse(a, 'PERFORMANCE');
  assert.match(r.findings.find((f) => f.ruleId === 'LAP_COMPARISON').title, /Propulsive power falls more than stroke rhythm, lap 1 to lap 3/);
  assert.equal(sec(r, 'POWER').status, 'MISSING', 'combined force shares and targets come from the EO report'); assert.equal(sec(r, 'HANDS').status, 'COMPLETE');
  assert.equal(sec(r, 'ARMS').data.lr.left, 110); assert.equal(sec(r, 'ARMS').data.lr.right, 57.3);
});
test('"each hand": per-hand shares with EO targets when the report printed them, words only for juniors, a trend line for the coach and swimmer', async () => {
  const a = clone(A); a.eoReferenceRanges = { downwardPct: { text: '17-22%', lo: 17, hi: 22, provenance: {} }, propulsivePct: { text: '70-75%', lo: 70, hi: 75, provenance: {} }, leftwardPct: { text: '<4%', lo: null, hi: 4, provenance: {} }, rightwardPct: { text: '<4%', lo: null, hi: 4, provenance: {} } };
  const ex = await parseEoExport(zip()); applyEoExport(a, ex);
  const h = sec(analyse(a, 'PERFORMANCE'), 'HANDS').data, left = h.hands[0], right = h.hands[1];
  assert.deepEqual(left.rows.map((x) => [x.id, x.value, x.target, x.status]), [['forward', 32, '70–75%', 'BELOW'], ['down', 50, '17–22%', 'ABOVE'], ['inward', 16, 'under 4%', 'ABOVE']]);
  assert.equal(right.rows[2].value, 38, 'the right hand\'s inward force is its leftward force (34, 38, 42)');
  assert.match(h.trend[0], /Inward force, lap 1 to lap 3: left hand 13\.0% to 19\.0%, right hand 34\.0% to 42\.0%/);
  const html = renderReport(analyse(a, 'PERFORMANCE').report); assert.match(html, /data-sec="HANDS"/); assert.match(html, /LEFT HAND/);
  const j = sec(analyse(a, 'JUNIOR'), 'HANDS').data; assert.equal(j.simple, true); assert.deepEqual(j.trend, []);
  assert.doesNotMatch(renderReport(analyse(a, 'JUNIOR').report).replace(/<[^>]+>/g, ' '), /\b34\.0\b/, 'juniors get words, not each hand\'s percentages');
  const none = clone(a); none.eoReferenceRanges = {}; assert.equal(sec(analyse(none, 'PERFORMANCE'), 'HANDS').data.hands[0].rows[1].target, null, 'no printed target, no target claim');
});
test('the coach sees the measured hand path (cm, spread, sweep) and it is never shown to a swimmer', async () => {
  const a = emptyAnalysis('Test Swimmer'); await imported(a);
  const f = analyse(a, 'COACH').findings.find((x) => x.ruleId === 'HAND_PATH_FACTS'); assert.ok(f); const t = f.measurement.join(' | ');
  assert.match(t, /Left hand, deepest point: 75 to 80 cm \(typical stroke to deepest stroke\)/); assert.match(t, /sweeps inward by/); assert.match(t, /Stroke-to-stroke power varies/);
  assert.doesNotMatch(renderReport(analyse(a, 'PERFORMANCE').report).replace(/<[^>]+>/g, ' '), /deepest point|\b75 to 80\b/);
  assert.ok(analyse(a, 'COACH').findings.some((x) => x.ruleId === 'HAND_FORCE_FIELD'));
});

test('upload: an export alone works (no model call), an export with the report merges, and both missing or a wrong zip is refused', async () => {
  let calls = 0; const model = async () => { calls++; return {}; }, b64 = (u8) => Buffer.from(u8).toString('base64');
  const only = await parseUpload({ exportBase64: b64(zip()), exportFilename: 'x.zip', swimmerName: 'Test Swimmer' }, { callModel: model });
  assert.equal(calls, 0); assert.equal(only.layout, null); assert.equal(only.exportInfo.laps, 3); assert.equal(only.exportInfo.strokesLeft, 24); assert.equal(only.analysis.swimmer.name, 'Test Swimmer'); assert.match(only.diagnostics.notes.join(' '), /EO report/);
  await assert.rejects(parseUpload({}), (e) => e.code === 'file_missing');
  await assert.rejects(parseUpload({ exportBase64: b64(new Uint8Array(buildExportZip({ omit: ['Phases'] }))) }), (e) => e.code === 'export_unrecognised' && e.status === 400);
});
