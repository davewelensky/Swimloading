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

/**
 * The swimmer's combined share for one force direction. EO's report prints it; without the report, the two hands' own shares are combined weighted by
 * each hand's force (this reproduced EO's printed downward share exactly on the test swim). Null when neither exists.
 * @param {any} a @param {'propulsivePct'|'downwardPct'|'handDragPct'} key
 */
export function combinedShare(a, key) {
  const m = key === 'propulsivePct' && !present(a.forceDistribution.overall.propulsivePct) ? a.metrics.propulsivePct : a.forceDistribution.overall[key];
  if (present(m)) return m.value;
  const ff = a.eoExport && a.eoExport.forceField, map = { propulsivePct: 'propulsive', downwardPct: 'downward', handDragPct: 'handDrag' };
  if (!ff || !ff.left || !ff.right || !ff.left.mean || !ff.right.mean) return null;
  const k = map[key], lv = ff.left.mean[k], rv = ff.right.mean[k], lw = ff.left.mean.fpsN, rw = ff.right.mean.fpsN;
  if (lv == null || rv == null || !(lw > 0) || !(rw > 0)) return null;
  return Math.round(((lv * lw + rv * rw) / (lw + rw)) * 10) / 10;
}

/** The current value of a progress metric in an analysis, or null. @param {any} a @param {string} key */
export function currentValue(a, key) {
  if (key === 'distancePerStrokeM') return present(a.metrics.distancePerStrokeM) ? a.metrics.distancePerStrokeM.value : null;
  if (key === 'propulsivePct' || key === 'downwardPct' || key === 'handDragPct') return combinedShare(a, key);
  const m = a.forceDistribution.overall[key];
  return present(m) ? m.value : null;
}

/** One point on the swimmer's line: what this session measured. @param {any} a */
export function historyEntry(a) {
  return {
    date: a.session && a.session.date && a.session.date.value ? a.session.date.value : null,
    forward: currentValue(a, 'propulsivePct'), down: currentValue(a, 'downwardPct'), handDrag: currentValue(a, 'handDragPct'),
    dps: currentValue(a, 'distancePerStrokeM'), rate: present(a.metrics.strokeRate) ? a.metrics.strokeRate.value : null,
  };
}

/** Build a baseline from an earlier SwimAnalysis. @param {any} prev */
export function baselineFrom(prev) {
  /** @type {Record<string, number>} */ const metrics = {};
  for (const [key] of PROGRESS_METRICS) { const v = currentValue(prev, key); if (v != null) metrics[key] = v; }
  // the swimmer's line so far: everything the earlier report already carried, then that session itself
  const history = [...((prev.baseline && prev.baseline.history) || []), historyEntry(prev)].slice(-12);
  return {
    history,
    capturedOn: prev.session && prev.session.date && prev.session.date.value ? prev.session.date.value : null, metrics,
    context: { stroke: present(prev.session.stroke) ? prev.session.stroke.value : null, distanceM: present(prev.session.distanceM) ? prev.session.distanceM.value : null, poolLengthM: present(prev.session.poolLengthM) ? prev.session.poolLengthM.value : null, swimmerType: (prev.eoReferenceContext && prev.eoReferenceContext.swimmerType) || (prev.source && prev.source.analysisContext && prev.source.analysisContext.swimmerType) || null },
  };
}

/** Reasons the two swims may not be like for like. Shown to the coach; never blocks. @param {any} a */
export function comparability(a) {
  const c = a.baseline && a.baseline.context, out = [];
  if (!c) return out;
  if (c.stroke && present(a.session.stroke) && c.stroke.toLowerCase() !== a.session.stroke.value.toLowerCase()) out.push(`The earlier swim was ${c.stroke.toLowerCase()} and this one is ${a.session.stroke.value.toLowerCase()}. Stroke changes the numbers, so this is not a like-for-like comparison.`);
  if (c.distanceM != null && present(a.session.distanceM) && c.distanceM !== a.session.distanceM.value) out.push(`The earlier swim was ${c.distanceM} m and this one is ${a.session.distanceM.value} m.`);
  if (c.poolLengthM != null && present(a.session.poolLengthM) && c.poolLengthM !== a.session.poolLengthM.value) out.push(`The earlier swim was in a ${c.poolLengthM} m pool and this one is ${a.session.poolLengthM.value} m. Turns change the numbers, so compare like with like.`);
  const cur = (a.eoReferenceContext && a.eoReferenceContext.swimmerType) || (a.source && a.source.analysisContext && a.source.analysisContext.swimmerType) || null;
  if (c.swimmerType && cur && String(c.swimmerType).toLowerCase() !== String(cur).toLowerCase()) out.push(`The earlier report was judged against EO's ${c.swimmerType.toLowerCase()} targets and this one against ${cur.toLowerCase()} targets. The numbers still compare, but a target on one report is not the target on the other.`);
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

// ---------------------------------------------------------------------------------------------
// Finding the swimmer's previous report. Britt should not have to hunt: the builder proposes the most recent earlier session of the
// same swimmer that is like for like (same stroke, distance and pool length), and links it with one click.

const norm = (s) => String(s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z\s'-]/g, ' ').replace(/\s+/g, ' ').trim();
/** Edit distance, small strings only. */
function lev(a, b) { const m = a.length, n = b.length; let prev = Array.from({ length: n + 1 }, (_, j) => j); for (let i = 1; i <= m; i++) { const cur = [i]; for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); prev = cur; } return prev[n]; }
/**
 * Same swimmer? Identical names, or a one-letter spelling difference in BOTH the first name and the surname ("Johan" / "Johann" Smith).
 * A shared first name alone is never a match (the club rule), and a single-word name only matches itself exactly.
 */
export function sameSwimmer(a, b) {
  const x = norm(a), y = norm(b); if (!x || !y) return false; if (x === y) return true;
  const tx = x.split(' '), ty = y.split(' '); if (tx.length < 2 || ty.length < 2) return false;
  const close = (p, q) => p === q || (Math.min(p.length, q.length) >= 4 && lev(p, q) <= 1);
  return close(tx[0], ty[0]) && close(tx[tx.length - 1], ty[ty.length - 1]);
}

/** @param {any} session an analysis `session` object @returns {{stroke: string|null, distanceM: number|null, poolLengthM: number|null}} */
export function sessionKey(session) {
  const v = (m) => (m && m.value != null && m.status !== 'MISSING' ? m.value : null);
  const stroke = v(session && session.stroke);
  return { stroke: stroke ? String(stroke).toLowerCase() : null, distanceM: v(session && session.distanceM), poolLengthM: v(session && session.poolLengthM) };
}

/**
 * Rank earlier sessions of the same swimmer, best first.
 * @param {any[]} rows rows from the list action: { id, swimmer_name, session_date, status, exportId, session }
 * @param {{ id?: string|null, name: string, date?: string|null, session: any, exportId?: string|null }} cur the swim being reported
 * @returns {{ candidates: any[], duplicateOf: any|null }}
 */
export function rankPrevious(rows, cur) {
  const ck = sessionKey(cur.session);
  const same = (rows || []).filter((r) => r && r.id !== cur.id && sameSwimmer(r.swimmer_name, cur.name));
  const duplicateOf = cur.exportId ? same.find((r) => r.exportId && r.exportId === cur.exportId) || null : null;
  const out = [];
  for (const r of same) {
    if (r === duplicateOf) continue;
    if (cur.date && r.session_date && r.session_date >= cur.date) continue;          // only earlier days: two efforts on one morning are not "last time"
    const k = sessionKey(r.session), strokeOk = !!ck.stroke && ck.stroke === k.stroke, distOk = ck.distanceM != null && ck.distanceM === k.distanceM, poolOk = ck.poolLengthM != null && ck.poolLengthM === k.poolLengthM;
    const likeForLike = strokeOk && distOk && poolOk;
    const differs = [!strokeOk && k.stroke && ck.stroke ? `${k.stroke} (this one is ${ck.stroke})` : null, !distOk && k.distanceM != null && ck.distanceM != null ? `${k.distanceM} m (this one is ${ck.distanceM} m)` : null, !poolOk && k.poolLengthM != null && ck.poolLengthM != null ? `${k.poolLengthM} m pool (this one is ${ck.poolLengthM} m)` : null].filter(Boolean);
    out.push({ ...r, likeForLike, differs, score: (likeForLike ? 100 : 0) + (strokeOk ? 30 : 0) + (distOk ? 20 : 0) + (poolOk ? 10 : 0) + (r.status === 'published' ? 5 : 0) });
  }
  out.sort((a, b) => b.score - a.score || String(b.session_date || '').localeCompare(String(a.session_date || '')));
  return { candidates: out, duplicateOf };
}
