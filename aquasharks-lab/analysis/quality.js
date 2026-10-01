// @ts-check
/** Data quality: per-section status and field-level issues. Never fills a value; only reports what is or is not there. */
import { present } from './model.js';
import { shareSum, printedValues, hasRealConflict } from './calc.js';

const SHARE_KEYS = ['propulsivePct', 'downwardPct', 'upwardPct', 'leftwardPct', 'rightwardPct', 'handDragPct'];

/** Collect every Measured/Observed leaf that is not COMPLETE. */
export function fieldStatuses(root) {
  const out = [], counts = { COMPLETE: 0, PARTIAL: 0, AMBIGUOUS: 0, MISSING: 0 };
  (function walk(o, path) {
    if (!o || typeof o !== 'object') return;
    if (path.startsWith('aquaSharksFindings') || path.startsWith('priorities') || path.startsWith('coachReview')) return;
    if ('status' in o && 'provenance' in o && typeof o.status === 'string') { counts[o.status]++; if (o.status !== 'COMPLETE') out.push({ path, status: o.status }); return; }
    if (Array.isArray(o)) { o.forEach((x, i) => walk(x, `${path}.${i}`)); return; }
    for (const k of Object.keys(o)) walk(o[k], path ? `${path}.${k}` : k);
  })(root, '');
  return { fields: out, counts };
}

export function assessQuality(a, findings, priorities) {
  const by = (id) => findings.find((f) => f.ruleId === id);
  const o = a.forceDistribution.overall;
  const sections = {};

  sections.HERO = present(a.session.timeS) || present(a.session.distanceM) ? 'COMPLETE' : 'PARTIAL';

  const allShares = SHARE_KEYS.every((k) => present(o[k]));
  sections.POWER = !present(o.propulsivePct) || !present(o.downwardPct) ? 'MISSING' : (allShares ? 'COMPLETE' : 'PARTIAL');

  const cmp = by('LAP_COMPARISON');
  const cmpRefsOk = cmp ? (() => { const c = a.lapComparisons[cmp.meta.comparisonIndex]; return c.from.status === 'COMPLETE' && c.to.status === 'COMPLETE'; })() : false;
  sections.COMPARISON = !cmp ? 'MISSING' : (cmpRefsOk ? (cmp.meta.rows.length >= 2 ? 'COMPLETE' : 'PARTIAL') : 'AMBIGUOUS');

  const arms = by('ASYMMETRY_PROFILE');
  const pathKnown = present(a.handPath.left) || present(a.handPath.right) || present(a.consistency.left) || present(a.consistency.right);
  sections.ARMS = !arms ? 'MISSING' : (pathKnown && a.handPathAndPower.status === 'COMPLETE' ? 'COMPLETE' : 'PARTIAL');

  sections.FOCUS = priorities.some((p) => p.included) ? 'COMPLETE' : 'MISSING';
  const hasRemeasure = priorities.some((p) => p.included && findings.find((f) => f.id === p.findingIds[0]).meta.remeasure.length);
  sections.NEXT = hasRemeasure || Object.keys(a.baseline.metrics).length ? 'COMPLETE' : 'MISSING';

  // ---- issues: what the coach should know before trusting the report ----
  const issues = a.sourceIssues.map((i) => ({ ...i, origin: 'SOURCE' }));
  const sum = shareSum(o, SHARE_KEYS);
  if (sum.n === SHARE_KEYS.length && Math.abs(sum.sum - 100) > 0.5) issues.push({ id: 'share-sum', severity: 'WARN', kind: 'UNRECONCILED_FIGURE', fields: ['forceDistribution.overall'], origin: 'ENGINE', message: `The six whole-swim force shares add to ${sum.sum.toFixed(1)}%, not 100%.` });

  // Source conflicts: every quantity printed with more than one value, with where each was printed.
  const conflicts = [];
  (function walk(o, path) {
    if (!o || typeof o !== 'object') return;
    if ('status' in o && 'provenance' in o) {
      const vals = printedValues(o);
      if (vals.length > 1) conflicts.push({ path, unit: o.unit || '', values: vals, selectionBasis: o.selectionBasis || null, realConflict: hasRealConflict(o), groundTruth: false });
      return;
    }
    if (Array.isArray(o)) { o.forEach((x, i) => walk(x, `${path}.${i}`)); return; }
    for (const k of Object.keys(o)) if (!['aquaSharksFindings', 'priorities', 'coachReview'].includes(k)) walk(o[k], path ? `${path}.${k}` : k);
  })(a, '');
  for (const c of conflicts) if (!c.selectionBasis) issues.push({ id: 'no-basis-' + c.path, severity: 'WARN', kind: 'CONFLICTING_VALUES', fields: [c.path], origin: 'ENGINE', message: `${c.path} has several printed values but no recorded selection basis.` });

  if (cmp && !cmpRefsOk) issues.push({ id: 'lap-ref', severity: 'INFO', kind: 'UNLABELLED_LAP', fields: ['lapComparisons'], origin: 'ENGINE', message: 'A lap comparison endpoint is not fully established; the comparison carries a caveat.' });
  for (const c of a.lapComparisons) if (c.kind === 'MULTI_LAP_TREND') issues.push({ id: 'trend-unsupported', severity: 'INFO', kind: 'UNRECONCILED_FIGURE', fields: ['lapComparisons'], origin: 'ENGINE', message: 'Multi-lap trends are recorded but not analysed yet. Nothing is described as a trend.' });
  const fs = fieldStatuses(a);
  return { sections, issues, conflicts, fieldStatuses: fs.fields, counts: fs.counts };
}
