// @ts-check
/**
 * Flatten a SwimAnalysis into rows for the parser debug view:
 *   SOURCE VALUE (as printed) | NORMALISED VALUE | SOURCE LOCATION | EXTRACTION STATUS
 */
import { present } from '../model.js';

const fmt = (m) => (m.range ? `${m.range[0]} to ${m.range[1]}${m.unit || ''}` : m.value === null || m.value === undefined ? '' : `${m.approximate ? '~' : ''}${m.value}${m.unit ? (m.unit === '%' ? '%' : ' ' + m.unit) : ''}`);
const loc = (p) => (p ? [p.location, p.extraction && p.extraction.locator && p.extraction.locator.tableCell, p.extraction && p.extraction.locator && p.extraction.locator.paragraph != null ? '¶' + p.extraction.locator.paragraph : null].filter(Boolean).join(' ') : '');

/** @returns {{path:string, sourceValue:string, normalised:string, location:string, method:string, confidence:string, status:string, absence:string, alternates:string}[]} */
export function debugRows(a) {
  const rows = [];
  (function walk(o, path) {
    if (!o || typeof o !== 'object') return;
    if (['aquaSharksFindings', 'priorities', 'coachReview', 'coachNotes'].includes(path.split('.')[0])) return;
    if ('status' in o && 'provenance' in o && typeof o.status === 'string') {
      rows.push({
        path, sourceValue: (o.provenance && o.provenance.raw) || '', normalised: present(o) ? fmt(o) || String(o.value) : '', location: loc(o.provenance),
        method: (o.provenance && o.provenance.extraction && o.provenance.extraction.method) || (o.provenance && o.provenance.origin) || '', confidence: (o.provenance && o.provenance.extraction && o.provenance.extraction.confidence) || '',
        status: o.status, absence: o.absence || '', alternates: (o.alternates || []).map((x) => `${x.value} (${x.location})`).join('; '),
      });
      return;
    }
    if (Array.isArray(o)) { o.forEach((x, i) => walk(x, `${path}.${i}`)); return; }
    for (const k of Object.keys(o)) walk(o[k], path ? `${path}.${k}` : k);
  })({ session: a.session, metrics: a.metrics, forceDistribution: a.forceDistribution, leftRight: a.leftRight, lapComparisons: a.lapComparisons, handPath: a.handPath, consistency: a.consistency, strokePhases: a.strokePhases, powerProfile: a.powerProfile, swimmer: { age: a.swimmer.age } }, '');
  for (const [k, r] of Object.entries(a.eoReferenceRanges)) rows.push({ path: `eoReferenceRanges.${k}`, sourceValue: (r.provenance && r.provenance.raw) || '', normalised: `${r.lo ?? ''}${r.lo !== null && r.hi !== null ? ' to ' : r.hi !== null ? '<' : '>'}${r.hi ?? ''}`, location: loc(r.provenance), method: (r.provenance.extraction && r.provenance.extraction.method) || '', confidence: (r.provenance.extraction && r.provenance.extraction.confidence) || '', status: 'COMPLETE', absence: '', alternates: '' });
  return rows;
}
export function summariseRows(rows) {
  const c = { COMPLETE: 0, PARTIAL: 0, AMBIGUOUS: 0, MISSING: 0, absence: { NOT_IN_SOURCE: 0, EXTRACTION_FAILED: 0, COACH_REQUIRED: 0, NOT_ATTEMPTED: 0, unspecified: 0 } };
  for (const r of rows) { c[r.status]++; if (r.status === 'MISSING') c.absence[r.absence || 'unspecified']++; }
  return c;
}
