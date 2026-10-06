// @ts-check
/**
 * Progress from one session to the next. A swimmer's earlier assessment becomes `baseline` on the new one.
 * Only four numbers are compared, and each has an obvious direction: more distance per stroke and more force going
 * forward are better; less force going down and less hand drag are better. "Better" and "same" are decided on the
 * numbers as printed (to the precision they are shown at); no tolerance is invented.
 */
import { present } from './model.js';
import { round } from './calc.js';

/** key, label, unit, decimals, which way is better */
/** @type {[string, string, string, number, 'up' | 'down'][]} */
export const PROGRESS_METRICS = [
  ['distancePerStrokeM', 'Distance per stroke', 'm', 2, 'up'],
  ['propulsivePct', 'Force going forward', '%', 1, 'up'],
  ['downwardPct', 'Force going down', '%', 1, 'down'],
  ['handDragPct', 'Hand drag', '%', 1, 'down'],
];

/** The current value of a progress metric in an analysis, or null. @param {any} a @param {string} key */
export function currentValue(a, key) {
  const m = key === 'distancePerStrokeM' ? a.metrics.distancePerStrokeM : key === 'propulsivePct' ? (present(a.forceDistribution.overall.propulsivePct) ? a.forceDistribution.overall.propulsivePct : a.metrics.propulsivePct) : a.forceDistribution.overall[key];
  return present(m) ? m.value : null;
}

/** Build a baseline from an earlier SwimAnalysis. @param {any} prev */
export function baselineFrom(prev) {
  /** @type {Record<string, number>} */ const metrics = {};
  for (const [key] of PROGRESS_METRICS) { const v = currentValue(prev, key); if (v != null) metrics[key] = v; }
  return {
    capturedOn: prev.session && prev.session.date && prev.session.date.value ? prev.session.date.value : null, metrics,
    context: { stroke: present(prev.session.stroke) ? prev.session.stroke.value : null, distanceM: present(prev.session.distanceM) ? prev.session.distanceM.value : null },
  };
}

/** Reasons the two swims may not be like for like. Shown to the coach; never blocks. @param {any} a */
export function comparability(a) {
  const c = a.baseline && a.baseline.context, out = [];
  if (!c) return out;
  if (c.stroke && present(a.session.stroke) && c.stroke.toLowerCase() !== a.session.stroke.value.toLowerCase()) out.push(`The earlier swim was ${c.stroke.toLowerCase()} and this one is ${a.session.stroke.value.toLowerCase()}. Stroke changes the numbers, so this is not a like-for-like comparison.`);
  if (c.distanceM != null && present(a.session.distanceM) && c.distanceM !== a.session.distanceM.value) out.push(`The earlier swim was ${c.distanceM} m and this one is ${a.session.distanceM.value} m.`);
  return out;
}

/** Rows for the report: last time, now, and whether it moved the right way. @param {any} a */
export function progressRows(a) {
  const b = a.baseline && a.baseline.context ? a.baseline.metrics : null, rows = [];
  if (!b) return rows;
  for (const [key, label, unit, dp, better] of PROGRESS_METRICS) {
    const then = b[key], now = currentValue(a, key);
    if (typeof then !== 'number' || now == null) continue;
    const t = /** @type {number} */ (round(then, dp)), n = /** @type {number} */ (round(now, dp));
    const verdict = t === n ? 'SAME' : (better === 'up' ? n > t : n < t) ? 'BETTER' : 'NOT_YET';
    rows.push({ key, label, unit, dp, then: t, now: n, verdict });
  }
  return rows;
}
