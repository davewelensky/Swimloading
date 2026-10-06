// @ts-check
/**
 * Applies a parsed EO data export (parser/eo-export.js) to a SwimAnalysis. The export holds EO's own per-lap and per-hand numbers, so
 * these fields are exact, not estimated. Rules of the merge:
 *   - a value the EO report already gave is never overwritten; if the export disagrees by more than 1% the difference is recorded as a source issue;
 *   - the per-hand, per-lap and hand-path numbers fill the fields that exist for them, with origin EO_EXPORT;
 *   - nothing is judged here (no thresholds): rules and the coach do that.
 */
import { present, num, rng, obs, lapRef, phaseSet, emptyComparison, overlay, X } from './model.js';

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
/** "Aug 17, 2026" -> "2026-08-17". Parsed by hand: toISOString shifts the day in SAST. */
export function isoFromExportDate(s) {
  const m = /^([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2}),\s*(\d{4})$/.exec(String(s || '').trim()); if (!m || !MONTHS[m[1].toLowerCase()]) return null;
  return `${m[3]}-${String(MONTHS[m[1].toLowerCase()]).padStart(2, '0')}-${String(+m[2]).padStart(2, '0')}`;
}
/** "03:09.60" -> 189.6 seconds. */
export function secondsFromDuration(s) { const m = /^(?:(\d+):)?(\d{1,2}):(\d{2}(?:\.\d+)?)$/.exec(String(s || '').trim()); return m ? (+(m[1] || 0)) * 3600 + (+m[2]) * 60 + parseFloat(m[3]) : null; }

/** @param {any} a the analysis (mutated) @param {any} ex the parsed export @returns {{ applied: string[], issues: string[] }} */
export function applyEoExport(a, ex) {
  const applied = [], issues = [];
  const where = { section: 'EO data export' };
  const P = (raw) => X.from('TABLE', 'HIGH', where, raw, 'EO_EXPORT');
  const D = (note) => ({ origin: /** @type {const} */ ('DERIVED'), location: 'EO data export', note, extraction: { method: /** @type {const} */ ('RULE'), confidence: /** @type {const} */ ('HIGH') } });
  const s = ex.summary;
  const set = (path, make, compare) => {
    const keys = path.split('.'), leaf = keys.pop(), parent = keys.reduce((o, k) => o[k], a), cur = parent[leaf], v = make();
    if (v == null) return;
    if (present(cur)) { if (compare != null && cur.value != null && Math.abs(cur.value - compare) > Math.max(0.01, Math.abs(compare) * 0.01)) issues.push(`${path}: the EO report says ${cur.value} and the data export says ${compare}. The report's value is kept.`); return; }
    parent[leaf] = v; applied.push(path);
  };
  const iso = isoFromExportDate(s.date), secs = secondsFromDuration(s.duration), poolM = (/\((\d+)\s*m\)/.exec(s.location || '') || [])[1];
  if (iso) set('session.date', () => obs(iso, P(s.date)));
  if (s.time) set('session.startTime', () => obs(s.time, P(s.time)));
  if (s.stroke) set('session.stroke', () => obs(s.stroke, P(s.stroke)));
  if (s.distanceM != null) set('session.distanceM', () => num(s.distanceM, 'm', P(String(s.distanceM))), s.distanceM);
  if (secs != null) set('session.timeS', () => num(secs, 's', P(s.duration)), secs);
  if (s.laps != null) set('session.laps', () => num(s.laps, '', P(String(s.laps))), s.laps);
  if (poolM) set('session.poolLengthM', () => num(+poolM, 'm', P(s.location)), +poolM);
  if (s.strokesLeft != null && s.strokesRight != null) set('session.strokeCount', () => num(s.strokesLeft + s.strokesRight, '', P(`${s.strokesLeft} L, ${s.strokesRight} R`)), s.strokesLeft + s.strokesRight);
  const m = (key, path, unit) => { if (s[key] != null) set(path, () => num(s[key], unit, P(String(s[key]))), s[key]); };
  m('avgStrokeRate', 'metrics.strokeRate', 'str/min'); m('avgDps', 'metrics.distancePerStrokeM', 'm'); m('avgFpsN', 'metrics.avgForceN', 'N');
  m('avgPpsW', 'metrics.avgPowerW', 'W'); m('workKj', 'metrics.workKj', 'kJ'); m('propulsivePct', 'metrics.propulsivePct', '%');

  const laps = ex.laps, first = laps[0], last = laps[laps.length - 1], avg = (arr) => arr.reduce((x, y) => x + y, 0) / arr.length, r1 = (n) => Math.round(n * 10) / 10;
  // left and right power: whole swim (mean of EO's per-lap figures) and lap by lap
  const lw = laps.map((l) => l.left.ppsW).filter((v) => v != null), rw = laps.map((l) => l.right.ppsW).filter((v) => v != null);
  if (lw.length && rw.length && !present(a.leftRight.avgImpulseW.left)) { a.leftRight.avgImpulseW = { left: num(r1(avg(lw)), 'W', D('mean of the per-lap left-hand power in the EO export')), right: num(r1(avg(rw)), 'W', D('mean of the per-lap right-hand power in the EO export')) }; applied.push('leftRight.avgImpulseW'); }
  a.leftRight.byLap = laps.filter((l) => l.left.ppsW != null && l.right.ppsW != null).map((l) => ({
    lap: l.lap, leftW: num(l.left.ppsW, 'W', P(String(l.left.ppsW))), rightW: num(l.right.ppsW, 'W', P(String(l.right.ppsW))),
    higher: obs(/** @type {'LEFT'|'RIGHT'|'EQUAL'} */ (l.left.ppsW > l.right.ppsW ? 'LEFT' : l.right.ppsW > l.left.ppsW ? 'RIGHT' : 'EQUAL'), D('which hand has the higher power in this lap, from the two EO figures')),
  }));
  applied.push('leftRight.byLap');

  // first lap against last lap. Power is the mean of the two hands, which is how EO's own Avg PPS is formed (here 83.25 W).
  if (laps.length >= 2 && !a.lapComparisons.some((c) => c.kind === 'ENDPOINT_CHANGE')) {
    const both = (l, k) => (l.left[k] != null && l.right[k] != null ? (l.left[k] + l.right[k]) / 2 : null);
    const pct = (k) => { const x = both(first, k), y = both(last, k); return x && y != null ? r1(((y - x) / x) * 100) : null; };
    const pool = present(a.session.poolLengthM) ? a.session.poolLengthM.value : null, dist = (n) => (pool ? { from: (n - 1) * pool, to: n * pool } : null);
    const patch = { from: lapRef([first.lap], dist(first.lap), P('lap ' + first.lap)), to: lapRef([last.lap], dist(last.lap), P('lap ' + last.lap)), strokeRate: {}, pullPower: {}, propulsivePower: {} };
    if (first.left.rate != null && last.left.rate != null) patch.strokeRate = { from: num(first.left.rate, 'str/min', P(String(first.left.rate))), to: num(last.left.rate, 'str/min', P(String(last.left.rate))) };
    if (pct('ppsW') != null) patch.pullPower = { change: num(/** @type {number} */ (pct('ppsW')), '%', D('change in the mean of the two hands\' power, first lap to last lap')) };
    if (pct('propW') != null) patch.propulsivePower = { change: num(/** @type {number} */ (pct('propW')), '%', D('change in the mean of the two hands\' propulsive power, first lap to last lap')) };
    a.lapComparisons = [overlay(emptyComparison(`lap${first.lap}-vs-lap${last.lap}`, 'ENDPOINT_CHANGE'), patch)]; applied.push('lapComparisons');
  }

  // stroke phases: lap averages, each hand, as a share of the stroke
  for (const hand of /** @type {const} */ (['left', 'right'])) {
    const rows = ex.phases[hand] || []; if (!rows.length) continue;
    a.strokePhases[hand].lapAverages = rows.map((p) => ({ lap: p.lap, phases: phaseSet(p.glidePct, p.pullPct, p.recoveryPct, P(`lap ${p.lap}`)) })); applied.push('strokePhases.' + hand);
  }

  // hand path, measured from the coordinates: typical stroke to the most extreme stroke, in cm
  const hpm = (st) => (st ? { ...rng([st.median, st.max], 'cm', P('median stroke to most extreme stroke')), approximate: false } : null);
  /** @type {any} */ const hr = a.handPathReading || (a.handPathReading = /** @type {any} */ ({}));
  for (const hand of /** @type {const} */ (['left', 'right'])) {
    const h = ex.handPath[hand]; if (!h || !h.strokes) continue;
    const arm = hr[hand] || (hr[hand] = {});
    const d = hpm(h.depthCm), w = hpm(h.widthCm); if (d) arm.maxDepthCm = d; if (w) arm.maxWidthCm = w;
    arm.depthSdCm = h.depthCm ? h.depthCm.sd : null; arm.widthSdCm = h.widthCm ? h.widthCm.sd : null; arm.inwardSweepCm = h.inwardSweepCm ? h.inwardSweepCm.median : null; arm.strokes = h.strokes;
    applied.push('handPathReading.' + hand);
  }
  const crossing = ['left', 'right'].map((k) => ex.handPath[k] && ex.handPath[k].crossingCm).filter(Boolean);
  if (crossing.length) { hr.crossesMidline = obs(/** @type {'YES'|'NO'|'UNSURE'} */ (crossing.some((c) => c.median > 0) ? 'YES' : 'NO'), D('computed from the hand coordinates: YES only if the typical stroke of a hand passes the centreline')); applied.push('handPathReading.crossesMidline'); }

  a.eoExport = { version: ex.version, swimId: ex.swimId, laps: ex.laps, forceField: ex.forceField, handPath: ex.handPath, phases: ex.phases, strokePowerCvPct: ex.strokePowerCvPct, summary: ex.summary };
  a.source.exportId = ex.swimId;
  a.source.documents.push({ kind: 'EO_EXPORT', filename: ex.filename, sha256: null, views: ['STROKE_RATE_POWER', 'FORCE_FIELD', 'HAND_PATH', 'STROKE_PHASES'] });
  for (const i of issues) a.sourceIssues.push({ id: 'export-mismatch-' + a.sourceIssues.length, severity: 'WARN', kind: 'CONFLICTING_VALUES', fields: [], message: i });
  return { applied, issues };
}
