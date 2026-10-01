// @ts-check
/**
 * Vision step: read TEXT PRINTED INSIDE IMAGES (force-field labels, stroke-phase panels).
 * The model is a transcriber. It must never estimate a value from the height of a bar or the shape of a line:
 * those are CHART reads, which are coach-entered, never auto-filled.
 *
 * The model call is injected (`callModel`), so this module has no network dependency and is testable with a mock.
 */
import { num, missing, lapRef, phaseSet, X } from '../model.js';

const pct = { type: ['number', 'null'] };
const side = { type: 'object', properties: { glide_pct: pct, pull_pct: pct, recovery_pct: pct, glide_s: pct, pull_s: pct, recovery_s: pct, stroke_rate: pct } };

export const VISION_TOOL = {
  name: 'record_image_labels',
  description: 'Record the numbers and titles PRINTED as text inside the report images. Null for anything not printed.',
  input_schema: {
    type: 'object', required: ['force_field_panels', 'phase_panels'],
    properties: {
      force_field_panels: { type: 'array', description: 'Each "Distribution of Power" style graphic with printed percentage labels.', items: { type: 'object', properties: {
        title_text: { type: ['string', 'null'], description: 'Any lap/stroke label printed on or next to the graphic, exactly as printed (e.g. "Lap 1"). Null if none.' },
        leftward_pct: pct, propulsive_pct: pct, rightward_pct: pct, upward_pct: pct, hand_drag_pct: pct, downward_pct: pct,
        avg_impulse_left: { type: ['number', 'null'] }, avg_impulse_right: { type: ['number', 'null'] },
        avg_impulse_unit: { type: ['string', 'null'], description: 'The unit printed beside the impulse numbers (e.g. "W"), or null if none is printed.' },
        legible: { type: 'boolean' } } } },
      phase_panels: { type: 'array', description: 'Each stroke-phase panel (glide / pull / recovery) with printed percentages.', items: { type: 'object', properties: {
        title_text: { type: ['string', 'null'], description: 'The panel title exactly as printed (e.g. "Lap 1", "Stroke (1) Left").' },
        scope: { type: 'string', enum: ['LAP_AVERAGE', 'INDIVIDUAL_STROKE', 'UNKNOWN'], description: 'LAP_AVERAGE only if the panel is titled as a lap; INDIVIDUAL_STROKE if it is titled as a single stroke; otherwise UNKNOWN.' },
        lap: { type: ['integer', 'null'] }, stroke: { type: ['integer', 'null'] },
        left: side, right: side, legible: { type: 'boolean' } } } },
      notes: { type: 'array', items: { type: 'string' } },
    },
  },
};
export const VISION_SYSTEM = `You transcribe text that is PRINTED inside images from an EO Labs swim analysis report.
- Record only numbers and titles that appear as text. Never estimate from bar heights, line positions or the shape of a plot. If a chart has no printed value, record nothing for it.
- Percent fields are plain numbers (37.7, not 0.377). Keep the unit exactly as printed; if no unit is printed beside a number, say so by returning null for the unit.
- A panel titled as a lap is a LAP_AVERAGE. A panel titled as a single stroke is an INDIVIDUAL_STROKE. Never relabel one as the other. If unsure, UNKNOWN.
- Orange is usually the left arm and blue the right arm; if that is all you have to go on for an assignment, still record it, and mention it in notes.
- If a panel is not clearly legible, set legible false.`;

/** @param {{ pdfBase64?: string, images?: { base64: string, mediaType: string }[] }} src */
export function buildVisionContent(src) {
  const content = [];
  if (src.pdfBase64) content.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: src.pdfBase64 } });
  for (const im of src.images || []) content.push({ type: 'image', source: { type: 'base64', media_type: im.mediaType, data: im.base64 } });
  content.push({ type: 'text', text: 'Transcribe the printed labels in every image. Null for anything not printed.' });
  return content;
}

/** @param {any} v @param {import('../types').SwimAnalysis} a */
export function applyImageLabels(a, v) {
  const report = { forceField: 0, phaseLap: 0, phaseStroke: 0, skipped: /** @type {string[]} */ ([]) };
  const SHARES = ['propulsive_pct', 'downward_pct', 'upward_pct', 'leftward_pct', 'rightward_pct', 'hand_drag_pct'];
  (v.force_field_panels || []).forEach((p, i) => {
    if (!p.legible && p.legible !== undefined) { report.skipped.push(`force-field panel ${i + 1} not legible`); return; }
    const present = SHARES.filter((k) => typeof p[k] === 'number');
    if (present.length < 4) { report.skipped.push(`force-field panel ${i + 1}: fewer than four printed shares`); return; }
    const sum = present.reduce((s, k) => s + p[k], 0);
    const where = { image: i + 1 };
    const mk = (key, val) => (typeof val === 'number' ? num(val, '%', X.from('IMAGE', 'MODERATE', where, String(val), 'EO_IMAGE_LABEL'), { status: Math.abs(sum - 100) > 1.5 ? 'AMBIGUOUS' : 'COMPLETE' }) : missing('%', 'EXTRACTION_FAILED'));
    const lapNum = /(?:lap)\s*(\d+)/i.exec(p.title_text || '');
    const lap = lapNum ? lapRef([+lapNum[1]], null, X.from('IMAGE', 'MODERATE', where, p.title_text, 'EO_IMAGE_LABEL')) : { laps: [], distanceM: null, status: /** @type {any} */ ('AMBIGUOUS'), provenance: X.from('IMAGE', 'LOW', where, undefined, 'EO_IMAGE_LABEL') };
    const unit = p.avg_impulse_unit || '';
    const imp = (val) => (typeof val === 'number' ? num(val, unit, X.from('IMAGE', 'MODERATE', where, `${val}${unit}`, 'EO_IMAGE_LABEL'), { status: lapNum ? 'COMPLETE' : 'PARTIAL' }) : missing(unit, 'EXTRACTION_FAILED'));
    a.forceFieldReadings.push({ id: 'ff-' + (i + 1), image: i + 1, lap, provenance: X.from('IMAGE', 'MODERATE', where, undefined, 'EO_IMAGE_LABEL'),
      shares: { propulsivePct: mk('propulsive', p.propulsive_pct), downwardPct: mk('downward', p.downward_pct), upwardPct: mk('upward', p.upward_pct), leftwardPct: mk('leftward', p.leftward_pct), rightwardPct: mk('rightward', p.rightward_pct), handDragPct: mk('hand_drag', p.hand_drag_pct) },
      impulse: { left: imp(p.avg_impulse_left), right: imp(p.avg_impulse_right) } });
    if (Math.abs(sum - 100) > 1.5) a.sourceIssues.push({ id: `ff-sum-${i + 1}`, severity: 'WARN', kind: 'UNRECONCILED_FIGURE', fields: [`forceFieldReadings.${a.forceFieldReadings.length - 1}`], message: `The force-field image ${i + 1} shares add to ${sum.toFixed(1)}%, not 100%.` });
    if (!lapNum) a.sourceIssues.push({ id: `ff-lap-${i + 1}`, severity: 'INFO', kind: 'UNLABELLED_LAP', fields: [`forceFieldReadings.${a.forceFieldReadings.length - 1}`], message: `Force-field image ${i + 1} carries no lap label. A coach must say which lap it shows before it is used in a comparison.` });
    // per-arm impulse (first panel only populates the headline field; each reading keeps its own copy)
    if (!report.forceField) {
      if (unit.toUpperCase() === 'W') a.leftRight.avgImpulseW = { left: imp(p.avg_impulse_left), right: imp(p.avg_impulse_right) };
      else a.leftRight.impulse = { left: imp(p.avg_impulse_left), right: imp(p.avg_impulse_right) };
    }
    report.forceField++;
  });
  for (const [i, p] of (v.phase_panels || []).entries()) {
    if (p.legible === false) { report.skipped.push(`phase panel ${i + 1} not legible`); continue; }
    const where = { image: i + 1 };
    for (const arm of ['left', 'right']) {
      const s = p[arm]; if (!s || [s.glide_pct, s.pull_pct, s.recovery_pct].some((x) => typeof x !== 'number')) continue;
      const set = phaseSet(s.glide_pct, s.pull_pct, s.recovery_pct, X.from('IMAGE', 'MODERATE', where, p.title_text, 'EO_IMAGE_LABEL'));
      const bucket = /** @type {any} */ (a.strokePhases)[arm];
      if (p.scope === 'LAP_AVERAGE' && p.lap) { bucket.lapAverages.push({ lap: p.lap, phases: set }); report.phaseLap++; }
      else if (p.scope === 'INDIVIDUAL_STROKE' && p.lap != null) { bucket.individualStrokes.push({ lap: p.lap, stroke: p.stroke || 1, phases: set }); report.phaseStroke++; }
      else report.skipped.push(`phase panel ${i + 1} (${arm}): scope unclear, not stored as evidence`);
    }
  }
  a.source.documents.forEach((d) => { if (!d.views.includes('STROKE_PHASES') && (report.phaseLap || report.phaseStroke)) d.views.push('STROKE_PHASES'); });
  return report;
}

/** Run the vision step with an injected model call. Returns what was applied; never throws on a bad model answer. */
export async function readImageLabels(a, src, callModel) {
  try {
    const out = await callModel({ system: VISION_SYSTEM, tool: VISION_TOOL, content: buildVisionContent(src) });
    return { ok: true, ...applyImageLabels(a, out || {}), notes: (out && out.notes) || [] };
  } catch (e) {
    a.sourceIssues.push({ id: 'vision-failed', severity: 'WARN', kind: 'UNRECONCILED_FIGURE', fields: ['forceFieldReadings'], message: 'The image-label step failed; per-arm figures and stroke-phase panels were not read. Enter them manually or retry.' });
    return { ok: false, error: String(e && e.message || e), forceField: 0, phaseLap: 0, phaseStroke: 0, skipped: [] };
  }
}
