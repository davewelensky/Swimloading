// @ts-check
/**
 * Reads an EO SwimBETTER data export (the "FullSwim" zip: SwimSummary, ForceField, HandPathConsistency, Phases, FPvsTime workbooks)
 * and computes what the report needs. These are EO's own numbers (per lap, per hand, per stroke, hand coordinates every 10 ms), so
 * nothing here is estimated from a chart. Every figure is either copied from the export or a plain statistic of it (median, standard
 * deviation, mean of laps); no threshold is applied here. Interpretation happens in the rules.
 *
 * Conventions taken from the data: hand-path values are metres; depth is negative below the surface; lateral is negative on the
 * left of EO's centreline and positive on the right (the left hand's lateral values are all negative, the right hand's all positive).
 * FPvsTime (the 100 Hz force series) is not read yet: nothing in the report depends on it.
 */
import { readZip, utf8 } from './zip.js';
import { readXlsx } from './xlsx.js';

export const EXPORT_PARSER_VERSION = '0.1.0';
const KINDS = { SwimSummary: 'summary', ForceField: 'forceField', HandPathConsistency: 'handPath', Phases: 'phases', FPvsTime: 'fpvt' };

const num = (v) => { if (typeof v === 'number') return isFinite(v) ? v : null; if (typeof v === 'string' && v.trim() !== '') { const n = Number(v); return isFinite(n) ? n : null; } return null; };
const r1 = (n) => (n == null ? null : Math.round(n * 10) / 10);
const r2 = (n) => (n == null ? null : Math.round(n * 100) / 100);
const median = (a) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
const sd = (a) => { if (a.length < 2) return null; const m = /** @type {number} */ (mean(a)); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / a.length); };
/** @param {number[]} a */
const stats = (a) => (a.length ? { n: a.length, median: r1(median(a)), min: r1(Math.min(...a)), max: r1(Math.max(...a)), sd: r1(sd(a)) } : null);
const lapNo = (name) => { const m = /^lap0*(\d+)$/i.exec(name); return m ? +m[1] : null; };

/** @param {(string|number|null)[][]} rows header + data rows -> label -> values */
function labelled(rows) { /** @type {Record<string, (string|number|null)[]>} */ const o = {}; for (const r of rows) if (typeof r[0] === 'string' && r[0]) o[r[0]] = r; return o; }

/**
 * @param {Uint8Array} bytes the export zip
 * @param {{ filename?: string | null }} [opts]
 */
export async function parseEoExport(bytes, opts = {}) {
  const zip = readZip(bytes);
  /** @type {Record<string, string>} */ const files = {};
  for (const n of zip.names) { const m = /_([A-Za-z]+)\.xlsx$/.exec(n); if (m && KINDS[m[1]]) files[KINDS[m[1]]] = n; }
  if (!files.summary || !files.forceField || !files.handPath || !files.phases) throw Object.assign(new Error('This zip is not an EO SwimBETTER data export: it needs the SwimSummary, ForceField, HandPathConsistency and Phases workbooks.'), { code: 'export_unrecognised' });
  const open = async (kind, only) => { const b = await zip.read(files[kind]); if (!b) throw new Error('missing ' + files[kind]); return readXlsx(b, only ? { only } : {}); };
  const swimId = (/^([0-9a-f-]{36})_/i.exec(files.summary.split('/').pop() || '') || [])[1] || (/([0-9a-f]{8}-[0-9a-f-]{27})/i.exec(opts.filename || '') || [])[1] || null;

  // ---- summary and per-lap table
  const sm = await open('summary', ['summary', 'laps']);
  const kv = {}; for (const r of sm.sheet('summary') || []) if (typeof r[0] === 'string') kv[r[0]] = r[1];
  const lapRows = (sm.sheet('laps') || []).slice(1).filter((r) => num(r[0]) != null);
  const laps = lapRows.map((r) => ({
    lap: /** @type {number} */ (num(r[0])),
    left: { fpsN: num(r[1]), propN: num(r[2]), ppsW: num(r[3]), propW: num(r[4]), rate: num(r[5]) },
    right: { fpsN: num(r[6]), propN: num(r[7]), ppsW: num(r[8]), propW: num(r[9]), rate: num(r[10]) },
  }));
  if (!laps.length) throw Object.assign(new Error('The export has no per-lap table.'), { code: 'export_unrecognised' });
  const summary = {
    date: typeof kv.Date === 'string' ? kv.Date : null, time: typeof kv.Time === 'string' ? kv.Time : null, stroke: typeof kv.Stroke === 'string' ? kv.Stroke : null,
    distanceM: num(kv.Distance), duration: typeof kv.Duration === 'string' ? kv.Duration : null, laps: num(kv.Laps), location: typeof kv.Location === 'string' ? kv.Location : null,
    strokesLeft: num(kv['Strokes Left']), strokesRight: num(kv['Strokes Right']), avgStrokeRate: num(kv['Avg. Stroke Rate']), avgDps: num(kv['Avg. DPS']),
    avgFpsN: num(kv['Avg. FPS']), avgPpsW: num(kv['Avg. PPS']), workKj: num(kv.Work), propulsivePct: num(kv.Propulsive),
  };

  // ---- force field: each hand's own shares per lap, and the polar force profile (the "fan")
  const ffx = await open('forceField');
  const SHARE = { 'Propulsive [%]': 'propulsive', 'Leftward [%]': 'leftward', 'Rightward [%]': 'rightward', 'Upward [%]': 'upward', 'Downward [%]': 'downward', 'Hand Drag [%]': 'handDrag', 'AvgPPS [W]': 'ppsW', 'AvgFPS [N]': 'fpsN' };
  /** @type {Record<'left'|'right', any[]>} */ const ffLaps = { left: [], right: [] };
  /** @type {Record<'left'|'right', number[][]>} */ const fanLaps = { left: [], right: [] };
  for (const name of ffx.names) {
    const lap = lapNo(name), rows = ffx.sheet(name); if (lap == null || !rows) continue;
    const lab = labelled(rows);
    for (const [hand, col] of /** @type {const} */ ([['left', 1], ['right', 2]])) {
      const o = { lap }; let any = false;
      for (const [label, key] of Object.entries(SHARE)) { const v = lab[label] ? num(lab[label][col]) : null; o[key] = v; if (v != null) any = true; }
      if (any) ffLaps[hand].push(o);
    }
    const ai = rows.findIndex((r) => r[0] === 'Angle');
    if (ai >= 0) for (const [hand, col] of /** @type {const} */ ([['left', 1], ['right', 2]])) {
      const arr = new Array(360).fill(0); let ok = false;
      for (const r of rows.slice(ai + 1)) { const a = num(r[0]), v = num(r[col]); if (a != null && a >= 0 && a < 360 && v != null) { arr[a] = v; ok = true; } }
      if (ok) fanLaps[hand].push(arr);
    }
  }
  const keys = ['propulsive', 'leftward', 'rightward', 'upward', 'downward', 'handDrag'];
  const handFF = (hand) => {
    const byLap = ffLaps[hand].sort((a, b) => a.lap - b.lap);
    /** @type {Record<string, number|null>} */ const avg = {};
    for (const k of [...keys, 'ppsW', 'fpsN']) avg[k] = r1(mean(byLap.map((l) => l[k]).filter((v) => v != null)));
    const fl = fanLaps[hand], fan = fl.length ? Array.from({ length: 360 }, (_, i) => r2(/** @type {number} */ (mean(fl.map((a) => a[i]))))) : null;
    return { byLap, mean: avg, fan };
  };

  // ---- hand path: per stroke, then statistics across strokes (cm)
  const hx = await open('handPath');
  /** @type {Record<'left'|'right', { depth: number[], far: number[], near: number[], cross: number[], sweep: number[], byLap: any[] }>} */
  const hp = { left: { depth: [], far: [], near: [], cross: [], sweep: [], byLap: [] }, right: { depth: [], far: [], near: [], cross: [], sweep: [], byLap: [] } };
  for (const name of hx.names) {
    const lap = lapNo(name), rows = hx.sheet(name); if (lap == null || !rows || rows.length < 2) continue;
    const hdr = rows[0], data = rows.slice(1);
    /** @type {Map<string, {hand: 'left'|'right', depth?: number, lat?: number}>} */ const cols = new Map();
    hdr.forEach((h, ci) => { const m = /^(Left|Right) (Depth|Lateral) (\d+) \[m\]$/.exec(String(h || '')); if (m) { const key = m[1] + m[3]; const e = cols.get(key) || { hand: /** @type {'left'|'right'} */ (m[1].toLowerCase()) }; e[m[2] === 'Depth' ? 'depth' : 'lat'] = ci; cols.set(key, e); } });
    /** @type {Record<'left'|'right', {depth: number[], far: number[]}>} */ const lapAcc = { left: { depth: [], far: [] }, right: { depth: [], far: [] } };
    for (const e of cols.values()) {
      if (e.depth == null || e.lat == null) continue;
      const depth = data.map((r) => num(r[/** @type {number} */ (e.depth)])).filter((v) => v != null), lat = data.map((r) => num(r[/** @type {number} */ (e.lat)])).filter((v) => v != null);
      if (depth.length < 5 || lat.length < 5) continue;
      const maxDepth = -Math.min(...depth) * 100, lo = Math.min(...lat) * 100, hi = Math.max(...lat) * 100;
      const sign = e.hand === 'left' ? -1 : 1, far = e.hand === 'left' ? -lo : hi, near = e.hand === 'left' ? -hi : lo;   // distance from the centreline: widest and closest point
      const t = hp[e.hand]; t.depth.push(maxDepth); t.far.push(far); t.near.push(near); t.cross.push(Math.max(0, -near)); t.sweep.push(far - near);
      lapAcc[e.hand].depth.push(maxDepth); lapAcc[e.hand].far.push(far); void sign;
    }
    for (const hand of /** @type {const} */ (['left', 'right'])) if (lapAcc[hand].depth.length) hp[hand].byLap.push({ lap, depthCm: r1(median(lapAcc[hand].depth)), widthCm: r1(median(lapAcc[hand].far)) });
  }
  const handPath = (hand) => { const t = hp[hand]; return { strokes: t.depth.length, depthCm: stats(t.depth), widthCm: stats(t.far), nearestCm: stats(t.near), crossingCm: t.cross.length ? { median: r1(median(t.cross)), max: r1(Math.max(...t.cross)), strokesCrossing: t.cross.filter((c) => c > 0).length } : null, inwardSweepCm: stats(t.sweep), byLap: t.byLap.sort((a, b) => a.lap - b.lap) }; };

  // ---- phases: lap averages as a share of the whole stroke
  const phx = await open('phases');
  /** @type {Record<'left'|'right', any[]>} */ const phases = { left: [], right: [] };
  for (const name of phx.names) {
    const lap = lapNo(name), rows = phx.sheet(name); if (lap == null || !rows || rows.length < 2) continue;
    const hdr = rows[0].map((h) => String(h || '')), at = (re) => hdr.findIndex((h) => re.test(h));
    for (const hand of /** @type {const} */ (['left', 'right'])) {
      const H = hand === 'left' ? 'Left' : 'Right', ci = { g: at(new RegExp(`^${H} Glide`)), p: at(new RegExp(`^${H} Pull`)), r: at(new RegExp(`^${H} Recovery`)), s: at(new RegExp(`^${H} Stroke Rate`)) };
      if (Object.values(ci).some((i) => i < 0)) continue;
      const body = rows.slice(1).filter((r) => num(r[0]) != null);
      const g = body.map((r) => num(r[ci.g])).filter((v) => v != null), p = body.map((r) => num(r[ci.p])).filter((v) => v != null), rc = body.map((r) => num(r[ci.r])).filter((v) => v != null);
      const tot = (g.reduce((a, b) => a + b, 0)) + (p.reduce((a, b) => a + b, 0)) + (rc.reduce((a, b) => a + b, 0));
      if (g.length && p.length && rc.length && tot > 0) phases[hand].push({ lap, strokes: body.length, glidePct: r1(100 * g.reduce((a, b) => a + b, 0) / tot), pullPct: r1(100 * p.reduce((a, b) => a + b, 0) / tot), recoveryPct: r1(100 * rc.reduce((a, b) => a + b, 0) / tot), rate: r2(mean(body.map((r) => num(r[ci.s])).filter((v) => v != null))) });
    }
  }
  for (const h of /** @type {const} */ (['left', 'right'])) phases[h].sort((a, b) => a.lap - b.lap);

  // ---- stroke-to-stroke power variability, per hand (coefficient of variation of each stroke's average power), from the per-lap stroke tables
  const smx = await open('summary', laps.map((l) => 'lap' + String(l.lap).padStart(3, '0')));
  /** @type {Record<'left'|'right', number[]>} */ const strokeW = { left: [], right: [] };
  for (const l of laps) { const rows = smx.sheet('lap' + String(l.lap).padStart(3, '0')); if (!rows) continue; for (const r of rows.slice(1)) { const a = num(r[3]), b = num(r[9]); if (a != null) strokeW.left.push(a); if (b != null) strokeW.right.push(b); } }
  const cv = (a) => (a.length > 1 && mean(a) ? r1(100 * /** @type {number} */ (sd(a)) / /** @type {number} */ (mean(a))) : null);

  return {
    version: EXPORT_PARSER_VERSION, swimId, filename: opts.filename || null, summary, laps,
    forceField: { left: handFF('left'), right: handFF('right') },
    handPath: { left: handPath('left'), right: handPath('right') },
    phases, strokePowerCvPct: { left: cv(strokeW.left), right: cv(strokeW.right), strokes: { left: strokeW.left.length, right: strokeW.right.length } },
  };
}
