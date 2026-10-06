// The Aquasharks Lab report workflow, independent of HTTP and of the database:
//   parseUpload -> (coach review in the browser) -> cleanForStorage -> readiness -> buildSnapshot -> publish
import crypto from 'node:crypto';
import { parseEoReport } from '../../../aquasharks-lab/analysis/parser/index.js';
import { readImageLabels } from '../../../aquasharks-lab/analysis/parser/vision.js';
import { analyse } from '../../../aquasharks-lab/analysis/engine.js';
import { hasRealConflict } from '../../../aquasharks-lab/analysis/calc.js';

export const SWIMMER_PROFILES = ['JUNIOR', 'PERFORMANCE', 'MASTERS_OPEN_WATER'];
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
export const MAX_ANALYSIS_BYTES = 2 * 1024 * 1024;

const fail = (code, status = 400, detail) => Object.assign(new Error(detail || code), { code, status });

/**
 * @param {{ fileBase64: string, filename?: string, pageImages?: {base64: string, mediaType: string}[], swimmerName?: string }} input
 * @param {{ callModel?: Function | null, now?: () => string }} deps
 */
export async function parseUpload(input, deps = {}) {
  const b64 = typeof input.fileBase64 === 'string' ? input.fileBase64 : '';
  if (!b64) throw fail('file_missing');
  if (b64.length > MAX_UPLOAD_BYTES * 1.4) throw fail('file_too_large', 413);
  const bytes = new Uint8Array(Buffer.from(b64, 'base64'));
  const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
  let r;
  try { r = await parseEoReport(bytes, { filename: input.filename || null, sha256, now: (deps.now || (() => new Date().toISOString()))() }); }
  catch (e) { throw fail(e.code || 'parse_failed', 400, e.message); }

  let vision = null;
  if (r.layout && deps.callModel) {
    let src = null;
    if (r.format === 'DOCX') src = r.imageData && r.imageData.length ? { images: r.imageData.map((x) => ({ base64: Buffer.from(x.bytes).toString('base64'), mediaType: x.mediaType })) } : null;
    else if (input.pageImages && input.pageImages.length) src = { images: input.pageImages.slice(0, 12).map((p) => ({ base64: p.base64, mediaType: p.mediaType || 'image/jpeg' })) };
    else src = { pdfBase64: b64 };
    if (src) vision = await readImageLabels(r.analysis, src, deps.callModel);
  }
  if (input.swimmerName && input.swimmerName.trim()) r.analysis.swimmer.name = input.swimmerName.trim().slice(0, 120);
  return { analysis: r.analysis, diagnostics: r.diagnostics, layout: r.layout, format: r.format, sha256, vision };
}

/** Validate what the browser sends back and strip derived layers (they are recomputed from source + coach review). */
export function cleanForStorage(analysis) {
  if (!analysis || typeof analysis !== 'object' || analysis.schemaVersion !== 3) throw fail('analysis_invalid', 400, 'expected a SwimAnalysis v3 object');
  const a = JSON.parse(JSON.stringify(analysis));
  const name = a.swimmer && typeof a.swimmer.name === 'string' ? a.swimmer.name.trim() : '';
  if (!name) throw fail('swimmer_name_required');
  a.swimmer.name = name.slice(0, 120);
  a.aquaSharksFindings = []; a.priorities = [];
  const rv = a.coachReview && typeof a.coachReview === 'object' ? a.coachReview : {};
  /** Which of EO's sentences the coach let through, and her edits. Only known statuses and bounded strings are kept. */
  const eoClaims = {};
  for (const [id, c] of Object.entries(rv.eoClaims && typeof rv.eoClaims === 'object' ? rv.eoClaims : {})) {
    if (!c || !['APPROVED', 'EDITED', 'HIDDEN'].includes(c.status) || !/^eo-obs-\d{1,4}$/.test(id)) continue;
    eoClaims[id] = c.status === 'EDITED' ? { status: 'EDITED', editedText: String(c.editedText || '').slice(0, 600) } : { status: c.status };
  }
  a.coachReview = { findings: rv.findings || {}, priorityOrder: rv.priorityOrder, drillChoice: rv.drillChoice, eoClaims, coachNote: typeof rv.coachNote === 'string' ? rv.coachNote.slice(0, 1200) : '', retestWeeks: [4, 6, 8].includes(Number(rv.retestWeeks)) ? Number(rv.retestWeeks) : 6, dpsGoalM: typeof rv.dpsGoalM === 'number' && rv.dpsGoalM > 0.5 && rv.dpsGoalM < 5 ? Math.round(rv.dpsGoalM * 100) / 100 : undefined };
  if (JSON.stringify(a).length > MAX_ANALYSIS_BYTES) throw fail('analysis_too_large', 413);
  return a;
}

/**
 * What stands between this analysis and publication.
 * blockers: must be fixed. warnings: publishing needs the coach's explicit acknowledgement.
 */
export function readiness(analysis, profile) {
  const blockers = [], warnings = [];
  if (!analysis.swimmer || !String(analysis.swimmer.name || '').trim()) blockers.push('Enter the swimmer’s name.');
  if (!SWIMMER_PROFILES.includes(profile)) blockers.push('Choose a swimmer-facing profile (Junior, Performance or Masters / Open water).');
  const r = analyse(analysis, SWIMMER_PROFILES.includes(profile) ? profile : 'PERFORMANCE');
  const content = r.report.sections.filter((s) => ['POWER', 'COMPARISON', 'ARMS', 'FOCUS'].includes(s.id) && s.status !== 'MISSING');
  if (!content.length) blockers.push('There is not enough evidence to build a swimmer report yet.');
  const unresolved = r.quality.conflicts.filter((c) => c.realConflict && !c.selectionBasis);
  if (unresolved.length) warnings.push(`${unresolved.length} quantity(ies) have conflicting printed values with no recorded selection basis: ${unresolved.map((c) => c.path).join(', ')}.`);
  const pending = r.findings.filter((f) => f.review.status === 'PENDING' && f.kind === 'OPPORTUNITY' && f.classification !== 'COACH_CONFIRMATION_REQUIRED').length;
  if (pending) warnings.push(`${pending} finding(s) have not been approved.`);
  return { blockers, warnings, sections: r.report.sections.map((s) => [s.id, s.status]), priorities: r.priorities.filter((p) => p.included).length };
}

/** The swimmer-facing report, frozen at publish time. Never contains the coach view, conflicts or coach-only items. The only EO wording that can appear is a sentence the coach approved or rewrote. */
export function buildSnapshot(analysis, profile) {
  const p = SWIMMER_PROFILES.includes(profile) ? profile : 'PERFORMANCE';
  const report = analyse(analysis, p).report;
  return { model: report, profile: p };
}

export const newToken = () => crypto.randomBytes(24).toString('base64url');
export const isToken = (t) => typeof t === 'string' && /^[A-Za-z0-9_-]{32,64}$/.test(t);
export { hasRealConflict };
