// @ts-check
/**
 * SUGGESTS hand-path readings from EO chart screenshots (stroke path, consistency, hand path & power). It never writes to an analysis.
 *
 * These charts have no printed values, so a read is an estimate against the chart's own axis ticks. To keep misreads out of a swimmer's report:
 *   1. the model must give a RANGE against printed ticks plus the basis it used, and say UNSURE rather than guess;
 *   2. the chart is read TWICE, independently; a value is suggested only if both reads agree (numeric ranges overlap and are tight enough,
 *      categories are identical and not UNSURE); anything else is reported as a disagreement and left for the coach to enter;
 *   3. the coach confirms each suggestion next to the chart image before any rule can use it (see hand-path.js).
 * The model call is injected, so this module has no network dependency and is testable with a mock.
 */

/** A numeric read wider than this is too imprecise to suggest. Our own accuracy guard, not an EO value. */
export const MAX_RANGE_WIDTH_CM = 20;

const range = { type: ['object', 'null'], properties: { low: { type: 'number' }, high: { type: 'number' }, basis: { type: 'string', description: 'Which printed axis ticks the value sits between.' } } };
const arm = { type: 'object', properties: {
  max_depth_cm: { ...range, description: 'Side on view: depth below the surface (cm, positive number) of the typical stroke (low) and the most extreme stroke (high).' },
  max_width_cm: { ...range, description: 'Overhead view, HORIZONTAL axis: distance from the centreline (cm, positive number) of the typical stroke (low) and the most extreme stroke (high).' },
  spread: { type: 'string', enum: ['TIGHT', 'MODERATE', 'WIDE', 'UNSURE'], description: 'Consistency chart: how widely the overlaid strokes of this hand are dispersed.' },
  wrist_pitch: { type: 'string', enum: ['BROKEN', 'OK', 'UNSURE'], description: 'Hand path & power chart only: BROKEN if maximum downward force coincides with maximum propulsion. UNSURE if that chart is not shown.' },
} };

export const HAND_PATH_TOOL = {
  name: 'record_hand_path_reading',
  description: 'Record what the EO stroke-path charts show, as ranges against the printed axes. UNSURE or null for anything you cannot read with confidence.',
  input_schema: { type: 'object', required: ['axis_legible', 'left', 'right'], properties: {
    axis_legible: { type: 'boolean', description: 'False if the axis ticks or labels are not clearly legible.' },
    crosses_midline: { type: 'string', enum: ['YES', 'NO', 'UNSURE'], description: 'Head-on view: do the two hands cross the centreline during the pull?' },
    left: arm, right: arm, notes: { type: 'array', items: { type: 'string' } },
  } },
};
export const HAND_PATH_SYSTEM = `You read EO Labs SwimBETTER stroke-path charts for a swim coach. Each chart is an overlay of many strokes; orange is usually the left hand and blue the right hand (say so in notes if that is all you have to go on).
Axis definitions (use these exactly; every axis is in cm and printed):
- SIDE ON: the vertical axis is depth, 0 is the water surface and values below it are negative. The depth of a hand is how far BELOW zero its curves reach.
- OVERHEAD: the HORIZONTAL axis is left-right distance from the centreline (0). The vertical axis is distance along the swim direction: do NOT use it for width.
- HEAD ON: the horizontal axis is left-right distance from the centreline, the vertical axis is depth.
Rules:
- Read values ONLY against the printed axis ticks. For max_depth_cm and max_width_cm give a RANGE: low = where the typical stroke of that colour reaches, high = where the single most extreme stroke of that colour reaches. Name the ticks it sits between. Never give one exact number.
- If an axis or a view is not shown or not legible, return null for those values, or UNSURE for categories. UNSURE is always better than a guess.
- crosses_midline (head on): YES if a typical stroke of either hand reaches beyond the vertical zero line into the other hand's side; NO if each hand stays on its own side; otherwise UNSURE.
- spread: judge only from a chart that overlays many strokes. TIGHT means the strokes lie almost on top of each other; WIDE means they visibly fan out.
- Do not interpret, diagnose or coach. Describe only what the chart shows.`;

/** @param {{ images: { base64: string, mediaType: string }[] }} src */
export function buildHandPathContent(src) {
  const content = [];
  for (const im of src.images || []) content.push({ type: 'image', source: { type: 'base64', media_type: im.mediaType, data: im.base64 } });
  content.push({ type: 'text', text: 'Read these EO stroke-path charts. Ranges against the printed axes only; UNSURE or null when you cannot tell.' });
  return content;
}

/** Two numeric reads agree when their ranges overlap; the suggestion is the overlap, and it must be tight. @returns {{ok:true, range:[number,number]}|{ok:false, why:string}} */
export function agreeRange(x, y) {
  const ok = (r) => r && typeof r.low === 'number' && typeof r.high === 'number' && r.high >= r.low;
  if (!ok(x) || !ok(y)) return { ok: false, why: 'one read had no value' };
  const lo = Math.max(x.low, y.low), hi = Math.min(x.high, y.high);
  if (lo > hi) return { ok: false, why: `reads disagree (${x.low}-${x.high} cm against ${y.low}-${y.high} cm)` };
  if (hi - lo > MAX_RANGE_WIDTH_CM) return { ok: false, why: `too imprecise (${lo}-${hi} cm)` };
  return { ok: true, range: [lo, hi] };
}
/** @returns {{ok:true, value:string}|{ok:false, why:string}} */
export function agreeCategory(x, y) {
  if (!x || !y || x === 'UNSURE' || y === 'UNSURE') return { ok: false, why: 'not sure' };
  return x === y ? { ok: true, value: x } : { ok: false, why: `reads disagree (${x} against ${y})` };
}

/**
 * @param {any} r1 @param {any} r2 two independent model reads
 * @returns {{ suggestions: Record<string, any>, undecided: { field: string, why: string }[] }}
 */
export function reconcileReads(r1, r2) {
  /** @type {Record<string, any>} */ const suggestions = {}; /** @type {{field:string, why:string}[]} */ const undecided = [];
  if (!r1 || !r2 || r1.axis_legible === false || r2.axis_legible === false) return { suggestions, undecided: [{ field: 'all', why: 'the chart axes were not legible in both reads' }] };
  const cat = (field, a, b, key) => { const g = agreeCategory(a, b); if (g.ok) suggestions[key] = { value: g.value, basis: 'two independent reads agree' }; else undecided.push({ field, why: g.why }); };
  cat('crosses midline', r1.crosses_midline, r2.crosses_midline, 'crossesMidline');
  for (const side of ['left', 'right']) {
    for (const [f, key] of [['max_depth_cm', 'maxDepthCm'], ['max_width_cm', 'maxWidthCm']]) {
      const g = agreeRange(r1[side] && r1[side][f], r2[side] && r2[side][f]);
      if (g.ok) suggestions[`${side}.${key}`] = { range: g.range, basis: [r1[side][f].basis, r2[side][f].basis].filter(Boolean).join(' / ') }; else undecided.push({ field: `${side} ${f.replace(/_/g, ' ')}`, why: g.why });
    }
    cat(`${side} spread`, r1[side] && r1[side].spread, r2[side] && r2[side].spread, `${side}.spread`);
    cat(`${side} wrist pitch`, r1[side] && r1[side].wrist_pitch, r2[side] && r2[side].wrist_pitch, `${side}.wristPitch`);
  }
  return { suggestions, undecided };
}

/** Read the charts twice and keep only what both reads agree on. Never throws on a bad model answer. */
export async function suggestHandPath(src, callModel) {
  try {
    const content = buildHandPathContent(src);
    const [r1, r2] = await Promise.all([1, 2].map(() => callModel({ system: HAND_PATH_SYSTEM, tool: HAND_PATH_TOOL, content })));
    return { ok: true, ...reconcileReads(r1, r2) };
  } catch (e) {
    return { ok: false, error: String(e && /** @type {any} */ (e).message || e), suggestions: {}, undecided: [{ field: 'all', why: 'the chart read failed; enter the values by hand' }] };
  }
}
