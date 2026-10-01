// Shared helpers for the lab-analysis tests (not a test file itself: the glob only runs *.test.js).
import { emptyAnalysis, emptyComparison, overlay, num, rng, obs, lapRef, phaseSet, P } from '../aquasharks-lab/analysis/model.js';
import testSwimmerA from '../aquasharks-lab/analysis/fixtures/test-swimmer-a-200m.js';
import testSwimmerB from '../aquasharks-lab/analysis/fixtures/test-swimmer-b-sprint.js';
import { pctChange, asymmetry } from '../aquasharks-lab/analysis/calc.js';

export { emptyAnalysis, emptyComparison, overlay, num, rng, obs, lapRef, phaseSet, P, testSwimmerA, testSwimmerB };
export const clone = (x) => JSON.parse(JSON.stringify(x));
export const SWIMMER = ['JUNIOR', 'PERFORMANCE', 'MASTERS_OPEN_WATER'];
export const ALL_PROFILES = [...SWIMMER, 'COACH'];
export const stripTags = (html) => html.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<style[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, ' ').replace(/&[a-z#0-9]+;/g, ' ');

/** Every number the analysis contains, plus the arithmetic the engine is allowed to do on them. */
export function allowedNumbers(a) {
  const out = new Set([1, 2, 3, 4, 5, 6, 7, 8]);
  (function walk(o) {
    if (!o || typeof o !== 'object') return;
    if ('status' in o && 'provenance' in o) {
      if (typeof o.value === 'number') out.add(o.value);
      if (o.range) o.range.forEach((v) => out.add(Math.abs(v)));
      (o.alternates || []).forEach((x) => out.add(x.value));
      return;
    }
    if (Array.isArray(o)) { o.forEach(walk); return; }
    for (const k of Object.keys(o)) if (!['aquaSharksFindings', 'priorities', 'eoObservations', 'eoRecommendations', 'sourceIssues', 'coachReview'].includes(k)) walk(o[k]);
  })(a);
  const o = a.forceDistribution.overall, g = (m) => (m && m.value != null ? m.value : null);
  const L = g(o.leftwardPct), R = g(o.rightwardPct), U = g(o.upwardPct), H = g(o.handDragPct);
  if (L != null && R != null) out.add(L + R);
  if (U != null && H != null) out.add(U + H);
  for (const c of a.lapComparisons) {
    if (g(c.strokeRate.from) != null && g(c.strokeRate.to) != null) out.add(Math.abs(pctChange(g(c.strokeRate.from), g(c.strokeRate.to))));
    c.from.laps.concat(c.to.laps).forEach((n) => out.add(n));
    if (c.from.distanceM) { out.add(c.from.distanceM.to - c.from.distanceM.from); }
  }
  for (const k of ['left', 'right']) { const s = a.powerProfile[k].doublePeakPctByLap; out.add(s.filter((m) => m.value > 0).length); out.add(s.length); }
  for (const k of ['left', 'right']) for (const x of a.strokePhases[k].lapAverages) { out.add(x.lap); }
  const pl = g(a.leftRight.avgPowerW.left), pr = g(a.leftRight.avgPowerW.right);
  if (pl != null && pr != null) out.add(asymmetry(pl, pr).differencePctOfLower);
  return out;
}

/** All swimmer-facing strings the engine produced for one profile. */
export function swimmerStrings(result, profileId) {
  const out = [];
  for (const f of result.findings) if (f.review.status !== 'SUPPRESSED') out.push(f.text[profileId]);
  for (const p of result.priorities.filter((x) => x.included)) out.push(p.title, p.why[profileId], p.feel, p.cue, p.drill && p.drill.what, p.drill && p.drill.feel, p.drill && p.drill.why);
  for (const s of result.report.sections) {
    const d = s.data; if (!d) continue;
    if (s.id === 'HERO') out.push(...d.headline);
    if (s.id === 'POWER') out.push(d.whatThisMeans);
    if (s.id === 'COMPARISON') out.push(d.finding, d.interpretation, d.refNote, d.headline);
    if (s.id === 'ARMS') out.push(d.opportunity, d.summary, ...d.left.points, ...d.right.points, ...d.left.timing, ...d.right.timing);
  }
  return out.filter(Boolean);
}
