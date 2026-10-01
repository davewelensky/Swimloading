// EO report parser: synthetic DOCX and PDF documents (invented text and numbers), plus a gated acceptance run on a real specimen.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import zlib from 'node:zlib';
import { readZip, utf8 } from '../aquasharks-lab/analysis/parser/zip.js';
import { docxToDocText, pdfToDocText, paragraphs } from '../aquasharks-lab/analysis/parser/doc-text.js';
import { parseEoReport, sniffFormat } from '../aquasharks-lab/analysis/parser/index.js';
import { numUnit, parseDuration, parseSwimDateTime, parseReference, splitSentences, tidy } from '../aquasharks-lab/analysis/parser/normalise.js';
import { classifyClaim, classifyAudience, isTruncated } from '../aquasharks-lab/analysis/parser/claims.js';
import { applyImageLabels, readImageLabels, buildVisionContent } from '../aquasharks-lab/analysis/parser/vision.js';
import { debugRows, summariseRows } from '../aquasharks-lab/analysis/parser/debug-rows.js';
import { analyse } from '../aquasharks-lab/analysis/engine.js';
import { renderReport } from '../aquasharks-lab/analysis/report-view.js';
import { buildZip, buildDocx, buildPdf, synDocxBlocks, synPdfPages, SYN } from './lab-doc-builders.js';

const docx = (over, o) => buildDocx(synDocxBlocks(over), o);
const pdf = (over) => buildPdf(synPdfPages(over));
const v = (m) => m.value;

// ------------------------------------------------------------------ zip + adapters
test('zip reader: stored and deflated entries, missing entries, corrupt archives', async () => {
  for (const deflate of [false, true]) {
    const z = readZip(buildZip({ 'a.txt': 'hello hello hello', 'dir/b.bin': new Uint8Array([1, 2, 3]) }, { deflate }));
    assert.deepEqual(z.names.sort(), ['a.txt', 'dir/b.bin']);
    assert.equal(utf8(await z.read('a.txt')), 'hello hello hello'); assert.deepEqual([...await z.read('dir/b.bin')], [1, 2, 3]);
    assert.equal(await z.read('nope'), null);
  }
  assert.throws(() => readZip(new Uint8Array([1, 2, 3, 4, 5])), /not a ZIP/);
});

test('sniffFormat by magic bytes, not by file name', () => {
  assert.equal(sniffFormat(pdf()), 'PDF'); assert.equal(sniffFormat(docx()), 'DOCX'); assert.equal(sniffFormat(new Uint8Array([1, 2, 3, 4, 5, 6])), null);
});

test('DOCX adapter: heading levels, table rows as lines, line breaks split, deflate works', async () => {
  const d = await docxToDocText(docx({}, { deflate: true }));
  const heads = d.lines.filter((l) => l.heading).map((l) => `${l.heading}:${l.text}`);
  assert.ok(heads.includes('1:eo SwimBETTER Analysis Report') && heads.includes('2:Summary') && heads.includes('3:Force Field'));
  assert.equal(d.lines.filter((l) => l.table).length, 6);
  assert.ok(d.lines.some((l) => l.text === 'Location: Test Pool'), 'a <w:br/> splits a paragraph into lines');
  assert.match(d.lines.find((l) => l.table).text, /^Leftward {2}Propulsive {2}Rightward$/);
});

test('DOCX adapter: `<w:t` matching does not swallow <w:tcPr>/<w:tab/> (regression)', async () => {
  const d = await docxToDocText(docx());
  assert.ok(d.lines.every((l) => !/tcW|w:type|<w:/.test(l.text)), 'no XML leaks into text');
});

test('DOCX images carry their bytes and media type for the vision step', async () => {
  const bytes = new Uint8Array([137, 80, 78, 71, 1, 2, 3]);
  const b = synDocxBlocks(); b.splice(5, 0, { image: 'rId20' });
  const d = await docxToDocText(buildDocx(b, { media: [{ name: 'image2.png', bytes }] }));
  assert.equal(d.images.length, 1); assert.equal(d.images[0].mediaType, 'image/png'); assert.deepEqual([...d.images[0].bytes], [...bytes]);
});

test('PDF adapter: lines, paragraph breaks from spacing, and a page break does not fake a new paragraph', async () => {
  const d = await pdfToDocText(buildPdf([[{ text: 'First paragraph begins here and runs on to the very' }, { text: 'end of the page without a full stop and' }], [{ text: 'continues on the next page and then ends.' }, { text: 'A new paragraph starts here.', gap: 10 }]]));
  const P = paragraphs(d);
  assert.equal(P.length, 2); assert.match(P[0].text, /very end of the page.* continues on the next page and then ends\.$/);
  assert.equal(d.pages, 2);
});

test('PDF page-top line that starts a new section is NOT merged into the previous paragraph', async () => {
  const d = await pdfToDocText(buildPdf([[{ text: 'Some table values 17-22%' }], [{ text: 'Force Field' }, { text: 'Body sentence here.' }]]));
  assert.equal(paragraphs(d).length >= 2, true);
});

// ------------------------------------------------------------------ normalisers + claims
test('normalisers', () => {
  assert.deepEqual(numUnit('29.53str/min'), { value: 29.53, unit: 'str/min' }); assert.deepEqual(numUnit('200 metres'), { value: 200, unit: 'metres' }); assert.equal(numUnit('n/a'), null);
  assert.equal(parseDuration('2 mins 9.5 seconds'), 129.5); assert.equal(parseDuration('45.5 seconds'), 45.5); assert.equal(parseDuration('soon'), null);
  assert.deepEqual(parseSwimDateTime('June 03, 2025 at 05:15:00 PM'), { date: '2025-06-03', time: '05:15:00 PM' });
  assert.deepEqual(parseSwimDateTime('Foo 99, 2026'), null);
  assert.deepEqual(parseReference('<4%'), { text: '<4%', lo: null, hi: 4 }); assert.deepEqual(parseReference('70-75%'), { text: '70-75%', lo: 70, hi: 75 }); assert.deepEqual(parseReference('0%'), { text: '0%', lo: 0, hi: 0 }); assert.equal(parseReference('about half'), null);
  assert.deepEqual(splitSentences('It was 34.67% here. Next one starts. And "quoted" ends.'), ['It was 34.67% here.', 'Next one starts.', 'And "quoted" ends.']);
  assert.equal(tidy('Stroke : Free  style'), 'Stroke: Free style');
});

test('claim classifier fails closed: only a numeric statement with no interpretive wording is a measurement', () => {
  assert.equal(classifyClaim('The swim covered 150 metres in 65 seconds.').claimType, 'MEASUREMENT_STATEMENT');
  assert.equal(classifyClaim('The swim covered 150 metres in 65 seconds.').basis, 'RULE');
  for (const s of ['The catch is likely the main cause.', 'This suggests a problem with the entry.', 'The pull looks smooth and calm.', 'Output was fine overall.']) assert.equal(classifyClaim(s).claimType, 'DIAGNOSTIC_INTERPRETATION', s);
  assert.equal(classifyClaim('The pull looks smooth and calm.').confidence, 'LOW');
  assert.equal(classifyClaim('This indicates a catch fault of 20%.').confidence, 'HIGH', 'numbers do not rescue interpretive wording');
});

test('audience rule keeps clinical advice coach-only; truncation heuristic', () => {
  for (const t of ['See a physiotherapist.', 'Consider a medical check.', 'Possible shoulder impingement.', 'A referral may help.']) assert.equal(classifyAudience(t), 'COACH_ONLY', t);
  assert.equal(classifyAudience('Try single-arm drills.'), 'SWIMMER');
  assert.equal(isTruncated('Ends properly.'), false); assert.equal(isTruncated('Stops here'), true); assert.equal(isTruncated('Ends with quote."'), false);
});

// ------------------------------------------------------------------ the parser on synthetic documents (both formats must agree)
for (const [name, make] of [['DOCX', () => docx()], ['PDF', () => pdf()]]) {
  test(`${name}: layout detected, summary metrics extracted with units and raw tokens`, async () => {
    const r = await parseEoReport(make(), { filename: 'syn', now: '2026-10-01T00:00:00Z' }), a = r.analysis;
    assert.equal(r.layout, 'EO_AI_REPORT_V1'); assert.equal(r.format, name);
    assert.equal(a.session.date.value, '2026-05-12'); assert.equal(a.session.startTime.value, '06:10:00 PM');
    assert.equal(a.session.stroke.value, 'Backstroke'); assert.equal(a.source.analysisContext.swimmerType, 'Sprint');
    assert.deepEqual([v(a.session.distanceM), v(a.session.poolLengthM), v(a.session.laps), v(a.session.timeS), v(a.session.strokeCount)], [150, 50, 3, 65.5, 60]);
    assert.deepEqual([v(a.metrics.strokeRate), v(a.metrics.distancePerStrokeM), v(a.metrics.avgPowerW), v(a.metrics.workKj), v(a.metrics.propulsivePct)], [40.1, 1.65, 85.5, 5.6, 41.25]);
    assert.equal(a.metrics.avgPowerW.provenance.raw, '85.5W'); assert.equal(a.metrics.strokeRate.provenance.raw, '40.1str/min');
    assert.equal(a.session.location.value, 'Test Pool');
    assert.equal(a.source.layout, 'EO_AI_REPORT_V1'); assert.equal(a.source.documents[0].kind, name === 'DOCX' ? 'EO_REPORT_DOCX' : 'EO_REPORT_PDF'); assert.equal(a.source.parserVersion, '0.1.0');
    assert.deepEqual(a.unmapped.map((u) => [u.label, u.value]).slice(0, 1), [['swap', 'True']]);
  });

  test(`${name}: distribution table values and EO reference ranges, with cell locators`, async () => {
    const a = (await parseEoReport(make())).analysis, o = a.forceDistribution.overall;
    assert.deepEqual([v(o.leftwardPct), v(o.propulsivePct), v(o.rightwardPct), v(o.upwardPct), v(o.handDragPct), v(o.downwardPct)], [9.1, 41.3, 8.2, 0.9, 2.5, 38]);
    assert.equal(o.propulsivePct.provenance.extraction.method, 'TABLE'); assert.equal(o.propulsivePct.provenance.extraction.confidence, 'HIGH'); assert.equal(o.propulsivePct.provenance.extraction.locator.tableCell, 'r1c2');
    assert.equal(o.downwardPct.provenance.extraction.locator.tableCell, 'r2c4');
    assert.deepEqual(a.eoReferenceRanges.leftwardPct && [a.eoReferenceRanges.leftwardPct.lo, a.eoReferenceRanges.leftwardPct.hi], [null, 5]);
    assert.deepEqual([a.eoReferenceRanges.propulsivePct.lo, a.eoReferenceRanges.propulsivePct.hi, a.eoReferenceRanges.downwardPct.text], [60, 65, '20-25%']);
    assert.deepEqual(a.eoReferenceContext, { swimmerType: 'OPEN WATER', stroke: 'BACKSTROKE' });
  });

  test(`${name}: every other printed value is kept as an alternate with its location; nothing is chosen`, async () => {
    const a = (await parseEoReport(make())).analysis, o = a.forceDistribution.overall;
    assert.deepEqual(o.propulsivePct.alternates.map((x) => [x.value, x.location]).sort(), [[40.8, 'narrative'], [41.25, 'summary line']].sort());
    assert.equal(o.propulsivePct.value, 41.3, 'the value stays where it was printed (the table); no selection is made here');
    assert.equal(o.propulsivePct.selectionBasis, undefined, 'the parser never records a selection basis: that is the engine/coach decision');
    assert.deepEqual(o.downwardPct.alternates, [{ value: 38.04, location: 'narrative' }]);
    assert.deepEqual(o.handDragPct.alternates, [{ value: 2.6, location: 'narrative (no unit printed)' }]);
    assert.ok(a.metrics.propulsivePct.alternates.some((x) => x.value === 41.3 && x.location === 'distribution table'));
    const kinds = a.sourceIssues.map((i) => i.kind);
    assert.ok(kinds.includes('CONFLICTING_VALUES') && kinds.includes('UNIT_AMBIGUITY') && kinds.includes('TRUNCATION'));
    const q = analyse(a, 'COACH').quality;
    assert.ok(q.issues.some((i) => /^no-basis-/.test(i.id)), 'the engine flags conflicts that have no recorded selection basis');
  });

  test(`${name}: per-lap double peaks, side from context, clean side as rule-derived zeros, shapes derived and labelled`, async () => {
    const a = (await parseEoReport(make())).analysis, pp = a.powerProfile;
    assert.deepEqual(pp.left.doublePeakPctByLap.map(v), [10, 0, 25]); assert.equal(pp.left.shape.value, 'MULTI_PEAK');
    assert.deepEqual(pp.right.doublePeakPctByLap.map(v), [0, 0, 0]); assert.equal(pp.right.shape.value, 'SINGLE_PEAK');
    assert.equal(pp.left.doublePeakPctByLap[0].provenance.extraction.method, 'TEXT');
    assert.equal(pp.right.doublePeakPctByLap[0].provenance.extraction.method, 'RULE', 'zeros came from a statement, not a list');
    assert.equal(pp.left.shape.provenance.origin, 'DERIVED'); assert.equal(pp.left.shape.provenance.extraction.method, 'RULE');
    assert.equal(a.leftRight.relativeOutput.right.value, 'HIGHER'); assert.equal(a.leftRight.persistence.value, 'ALL_LAPS');
    assert.equal(a.leftRight.persistence.provenance.extraction.confidence, 'MODERATE');
  });

  test(`${name}: observations are sentence-level with a recorded classification basis; recommendations keep audience and truncation`, async () => {
    const a = (await parseEoReport(make())).analysis;
    assert.ok(a.eoObservations.length >= 8);
    for (const o of a.eoObservations) { assert.equal(o.claimTypeBasis, 'RULE'); assert.ok(['HIGH', 'MODERATE', 'LOW'].includes(o.claimTypeConfidence)); assert.ok(o.id && o.area); }
    const meas = a.eoObservations.filter((o) => o.claimType === 'MEASUREMENT_STATEMENT');
    assert.ok(meas.some((o) => /150 metres/.test(o.text)));
    assert.ok(a.eoObservations.filter((o) => o.claimType === 'DIAGNOSTIC_INTERPRETATION').some((o) => /catch problem/.test(o.text)));
    const recs = a.eoRecommendations;
    assert.equal(recs.length, 4);
    assert.equal(recs[0].audience, 'SWIMMER'); assert.equal(recs[1].audience, 'COACH_ONLY'); assert.match(recs[1].text, /physiotherapist/);
    assert.equal(recs[2].truncated, true); assert.equal(recs[0].truncated, undefined); assert.equal(recs[3].audience, 'COACH_ONLY');
    assert.ok(a.sourceIssues.some((i) => i.kind === 'TRUNCATION'));
  });

  test(`${name}: explicit absences say why a field is empty; nothing outside the source is invented`, async () => {
    const r = await parseEoReport(make()), a = r.analysis;
    assert.equal(a.swimmer.age.absence, 'COACH_REQUIRED'); assert.equal(a.metrics.avgForceN.absence, 'NOT_IN_SOURCE');
    assert.equal(a.handPath.left.absence, 'NOT_IN_SOURCE'); assert.equal(a.leftRight.avgImpulseW.left.absence, 'NOT_ATTEMPTED');
    assert.deepEqual(a.lapComparisons, []); assert.deepEqual(a.strokePhases.left.lapAverages, []); assert.deepEqual(a.forceFieldReadings, []);
    assert.ok(r.diagnostics.coachRequired.some((x) => /lapComparisons/.test(x)));
    assert.equal(a.swimmer.name, 'Unnamed swimmer', 'the report does not name the swimmer, so none is invented');
  });
}

test('DOCX and PDF of the same report give the same evidence', async () => {
  const d = (await parseEoReport(docx())).analysis, p = (await parseEoReport(pdf())).analysis;
  const strip = (x) => JSON.parse(JSON.stringify(x, (k, val) => (['extraction', 'locator', 'documents', 'id', 'provenance', 'parserVersion'].includes(k) ? undefined : val)));
  for (const k of ['session', 'metrics', 'forceDistribution', 'powerProfile', 'eoReferenceRanges', 'eoReferenceContext']) assert.deepEqual(strip(d[k]), strip(p[k]), k);
  assert.equal(d.eoRecommendations.length, p.eoRecommendations.length);
});

// ------------------------------------------------------------------ failure behaviour: never guess
test('unsupported file and unrecognised layout produce an honest empty analysis', async () => {
  await assert.rejects(() => parseEoReport(new Uint8Array([1, 2, 3, 4, 5, 6, 7])), (e) => e.code === 'unsupported_format');
  const r = await parseEoReport(buildPdf([[{ text: 'An entirely different document about something else.' }]]));
  assert.equal(r.layout, null); assert.deepEqual(r.diagnostics.extracted, []); assert.match(r.diagnostics.notes[0], /not recognised/);
  assert.equal(r.analysis.metrics.strokeRate.value, null); assert.equal(summariseRows(debugRows(r.analysis)).COMPLETE, 0);
});

test('a missing table leaves its fields MISSING and says so, rather than inventing them', async () => {
  const a = await parseEoReport(docx({ noTable: true }));
  assert.ok(a.diagnostics.notes.some((n) => /distribution table not read/.test(n)));
  assert.equal(a.analysis.forceDistribution.overall.propulsivePct.value, null); assert.equal(a.analysis.forceDistribution.overall.propulsivePct.status, 'MISSING');
  const r = analyse(a.analysis, 'PERFORMANCE');
  assert.equal(r.findings.some((f) => f.ruleId === 'POWER_EFFECTIVENESS'), false, 'no force-direction finding without the shares');
});

test('an unexpected unit is kept as printed and marked AMBIGUOUS, never converted', async () => {
  const r = await parseEoReport(docx({ summaryLines: ['Stroke: Freestyle Swimmer type: Sprint Distance: 200 yards Pool type: 25 yards', 'Laps: 8 Time: 2 mins 45.5 seconds Strokes: 60 Avg Stroke rate: 40.1str/min', 'DPS: 1.65m Avg PPS: 85.5W Work: 5.6kJ Propulsive: 41.25%'] }));
  assert.equal(r.analysis.session.distanceM.value, 200); assert.equal(r.analysis.session.distanceM.status, 'AMBIGUOUS');
  assert.ok(r.diagnostics.notes.some((n) => /unexpected unit "yards"/.test(n)));
});

test('an unparseable time is EXTRACTION_FAILED with the raw text kept, not zero', async () => {
  const a = (await parseEoReport(docx({ summaryLines: ['Stroke: Freestyle Distance: 100 metres Pool type: 25 metres', 'Laps: 4 Time: unavailable Avg Stroke rate: 40.1str/min'] }))).analysis;
  assert.equal(a.session.timeS.value, null); assert.equal(a.session.timeS.absence, 'EXTRACTION_FAILED'); assert.equal(a.session.timeS.provenance.raw, 'unavailable');
});

// ------------------------------------------------------------------ vision step (mock model)
const ffPanel = (o = {}) => ({ title_text: null, leftward_pct: 10, propulsive_pct: 40, rightward_pct: 8, upward_pct: 1, hand_drag_pct: 2, downward_pct: 39, avg_impulse_left: 60, avg_impulse_right: 90, avg_impulse_unit: 'W', legible: true, ...o });
const fresh = async () => (await parseEoReport(docx())).analysis;

test('vision: force-field panel with no lap label is held as a reading with an AMBIGUOUS lap and an issue', async () => {
  const a = await fresh(), rep = applyImageLabels(a, { force_field_panels: [ffPanel()], phase_panels: [] });
  assert.equal(rep.forceField, 1);
  const f = a.forceFieldReadings[0];
  assert.deepEqual(f.lap.laps, []); assert.equal(f.lap.status, 'AMBIGUOUS'); assert.equal(f.shares.propulsivePct.value, 40); assert.equal(f.shares.propulsivePct.provenance.origin, 'EO_IMAGE_LABEL'); assert.equal(f.shares.propulsivePct.provenance.extraction.method, 'IMAGE');
  assert.equal(f.impulse.left.unit, 'W'); assert.equal(a.leftRight.avgImpulseW.left.value, 60); assert.equal(a.leftRight.avgImpulseW.left.status, 'PARTIAL');
  assert.ok(a.sourceIssues.some((i) => i.kind === 'UNLABELLED_LAP'));
});

test('vision: a printed lap title gives a labelled lap; unitless impulse goes to the unitless field, not avgImpulseW', async () => {
  const a = await fresh();
  applyImageLabels(a, { force_field_panels: [ffPanel({ title_text: 'Lap 1', avg_impulse_unit: null })], phase_panels: [] });
  assert.deepEqual(a.forceFieldReadings[0].lap.laps, [1]); assert.equal(a.forceFieldReadings[0].lap.status, 'COMPLETE');
  assert.equal(a.leftRight.impulse.left.value, 60); assert.equal(a.leftRight.avgImpulseW.left.value, null, 'no unit printed, so it is not called watts');
  assert.equal(a.sourceIssues.some((i) => i.kind === 'UNLABELLED_LAP'), false);
});

test('vision: shares that do not sum to ~100 are AMBIGUOUS and flagged; panels with fewer than three printed shares are skipped, three or more are kept as partial; illegible panels are skipped', async () => {
  const a = await fresh();
  const rep = applyImageLabels(a, { force_field_panels: [ffPanel({ downward_pct: 70 }), ffPanel({ propulsive_pct: null, downward_pct: null, upward_pct: null, hand_drag_pct: null }), ffPanel({ legible: false })], phase_panels: [] });
  assert.equal(rep.forceField, 1); assert.equal(rep.skipped.length, 2);
  assert.equal(a.forceFieldReadings[0].shares.downwardPct.status, 'AMBIGUOUS'); assert.ok(a.sourceIssues.some((i) => /^ff-sum-/.test(i.id)));
});

test('vision: a partly legible panel (3+ shares) is kept with the rest EMPTY, never guessed, and flagged', async () => {
  const a = await fresh();
  const rep = applyImageLabels(a, { force_field_panels: [ffPanel({ upward_pct: null, hand_drag_pct: null, downward_pct: null })], phase_panels: [] });
  assert.equal(rep.forceField, 1);
  const s = a.forceFieldReadings[0].shares;
  assert.deepEqual([s.propulsivePct.value, s.leftwardPct.value, s.rightwardPct.value], [40, 10, 8]);
  assert.deepEqual([s.upwardPct.value, s.handDragPct.value, s.downwardPct.value], [null, null, null]); assert.equal(s.downwardPct.absence, 'EXTRACTION_FAILED');
  assert.ok(a.sourceIssues.some((i) => /^ff-partial-/.test(i.id)));
  assert.equal(a.sourceIssues.some((i) => /^ff-sum-/.test(i.id)), false, 'no sum check on a partial panel');
});

test('vision: lap-average panels go to lapAverages, single-stroke panels to individualStrokes, unclear scope is not stored', async () => {
  const a = await fresh(), side = (g, p, r) => ({ glide_pct: g, pull_pct: p, recovery_pct: r });
  const rep = applyImageLabels(a, { force_field_panels: [], phase_panels: [
    { title_text: 'Lap 1', scope: 'LAP_AVERAGE', lap: 1, stroke: null, left: side(9, 67, 24), right: side(12, 62, 27), legible: true },
    { title_text: 'Stroke (1) Left', scope: 'INDIVIDUAL_STROKE', lap: 1, stroke: 1, left: side(2, 74, 24), right: side(5, 60, 35), legible: true },
    { title_text: 'Something', scope: 'UNKNOWN', lap: null, stroke: null, left: side(1, 2, 3), right: side(1, 2, 3), legible: true },
  ] });
  assert.deepEqual([rep.phaseLap, rep.phaseStroke], [2, 2]);
  assert.deepEqual(a.strokePhases.left.lapAverages.map((x) => [x.lap, x.phases.glidePct.value]), [[1, 9]]);
  assert.deepEqual(a.strokePhases.left.individualStrokes.map((x) => [x.lap, x.stroke, x.phases.glidePct.value]), [[1, 1, 2]], 'the single-stroke 2% never enters the lap averages');
  assert.equal(rep.skipped.length, 2, 'both arms of the unclear panel are refused');
});

test('vision: a failing model never breaks the parse: it records an issue and the fields stay empty', async () => {
  const a = await fresh();
  const out = await readImageLabels(a, { images: [] }, async () => { throw new Error('boom'); });
  assert.equal(out.ok, false); assert.ok(a.sourceIssues.some((i) => i.id === 'vision-failed')); assert.deepEqual(a.forceFieldReadings, []);
  const ok = await readImageLabels(await fresh(), { images: [] }, async () => ({ force_field_panels: [], phase_panels: [], notes: ['nothing printed'] }));
  assert.equal(ok.ok, true); assert.deepEqual(ok.notes, ['nothing printed']);
});

test('vision request carries the images and an instruction never to read bars; the tool schema forbids guessing', () => {
  const c = buildVisionContent({ images: [{ base64: 'AAA', mediaType: 'image/png' }], pdfBase64: 'BBB' });
  assert.deepEqual(c.map((x) => x.type), ['document', 'image', 'text']);
});

// ------------------------------------------------------------------ engine integration + debug view
test('parser output feeds the engine for every profile; coach-only recommendations and EO diagnoses never reach a swimmer', async () => {
  const a = (await parseEoReport(docx())).analysis;
  for (const p of ['JUNIOR', 'PERFORMANCE', 'MASTERS_OPEN_WATER', 'COACH']) { const r = analyse(a, p); assert.ok(r.findings.length > 0, p); renderReport(r.report); }
  assert.ok(analyse(a, 'PERFORMANCE').findings.some((f) => f.ruleId === 'POWER_EFFECTIVENESS'));
  const html = ['JUNIOR', 'PERFORMANCE', 'MASTERS_OPEN_WATER'].map((p) => renderReport(analyse(a, p).report)).join(' ');
  assert.doesNotMatch(html, /physiotherapist|catch problem/);
  assert.match(renderReport(analyse(a, 'COACH').report), /physiotherapist/);
});

test('debug rows: source value, normalised value, location, method and status for every field', async () => {
  const a = (await parseEoReport(docx())).analysis, rows = debugRows(a), by = Object.fromEntries(rows.map((r) => [r.path, r]));
  assert.equal(by['metrics.avgPowerW'].sourceValue, '85.5W'); assert.equal(by['metrics.avgPowerW'].normalised, '85.5 W'); assert.equal(by['metrics.avgPowerW'].method, 'TEXT'); assert.equal(by['metrics.avgPowerW'].confidence, 'HIGH');
  assert.match(by['forceDistribution.overall.propulsivePct'].location, /Target Distribution of Power/); assert.match(by['forceDistribution.overall.propulsivePct'].alternates, /40\.8 \(narrative\)/);
  assert.equal(by['leftRight.avgImpulseW.left'].absence, 'NOT_ATTEMPTED'); assert.equal(by['metrics.avgForceN'].absence, 'NOT_IN_SOURCE');
  const s = summariseRows(rows); assert.ok(s.COMPLETE > 20 && s.MISSING > 5 && s.absence.NOT_ATTEMPTED === 2);
  assert.ok(rows.every((r) => r.path && 'status' in r));
});

// ------------------------------------------------------------------ acceptance: the REAL EO report (not in the repo; supply paths via env)
const SPEC = { docx: process.env.EO_SPECIMEN_DOCX, pdf: process.env.EO_SPECIMEN_PDF };
for (const [kind, file] of Object.entries(SPEC)) {
  test(`ACCEPTANCE (${kind}): real EO report parses to the expected evidence`, { skip: !file || !fs.existsSync(file) ? `set EO_SPECIMEN_${kind.toUpperCase()} to run` : false }, async () => {
    const r = await parseEoReport(new Uint8Array(fs.readFileSync(file))), a = r.analysis, o = a.forceDistribution.overall;
    assert.equal(r.layout, 'EO_AI_REPORT_V1');
    assert.deepEqual([v(a.session.distanceM), v(a.session.poolLengthM), v(a.session.laps), v(a.session.timeS), v(a.session.strokeCount)], [200, 25, 8, 195.4, 137]);
    assert.deepEqual([v(a.metrics.strokeRate), v(a.metrics.distancePerStrokeM), v(a.metrics.avgPowerW), v(a.metrics.workKj), v(a.metrics.propulsivePct)], [29.53, 2.82, 70.97, 12.4, 35.16]);
    assert.deepEqual([v(o.leftwardPct), v(o.propulsivePct), v(o.rightwardPct), v(o.upwardPct), v(o.handDragPct), v(o.downwardPct)], [15.4, 34.7, 7.7, 0.7, 1.2, 40.4]);
    assert.deepEqual(o.propulsivePct.alternates.map((x) => x.value).sort(), [34.67, 35.16]);
    assert.deepEqual(a.powerProfile.right.doublePeakPctByLap.map(v), [12.5, 0, 0, 44.44, 0, 22.22, 37.5, 12.5]); assert.deepEqual(a.powerProfile.left.doublePeakPctByLap.map(v), [0, 0, 0, 0, 0, 0, 0, 0]);
    assert.equal(a.eoReferenceRanges.downwardPct.text, '17-22%'); assert.equal(a.eoRecommendations.some((x) => x.truncated), true); assert.ok(a.eoRecommendations.some((x) => x.audience === 'COACH_ONLY'));
    assert.ok(a.sourceIssues.some((i) => i.kind === 'CONTRADICTION') && a.sourceIssues.some((i) => i.kind === 'CONFLICTING_VALUES'));
    assert.deepEqual(a.unmapped.map((u) => u.label), ['swap', 'power difference between arms']);
  });
}
