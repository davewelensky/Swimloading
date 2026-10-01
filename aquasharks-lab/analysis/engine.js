// @ts-check
/**
 * analyse(analysis, profile?) -> { findings, priorities, quality, report, profile }
 * Pure: the input analysis is never modified. Pipeline:
 *   SOURCE fields -> rules -> coach review applied -> priorities -> quality -> report model
 */
import { runRules } from './rules.js';
import { buildPriorities } from './priorities.js';
import { assessQuality } from './quality.js';
import { buildReport } from './report-model.js';
import { PROFILES } from './profiles.js';

/** Apply coach decisions. Suppress, edit swimmer text, confirm a technical interpretation. Never changes MEASURED data. */
export function applyReview(findings, coachReview) {
  const rv = (coachReview && coachReview.findings) || {};
  return findings.map((f) => {
    const r = rv[f.id];
    if (!r) return f;
    const g = { ...f, review: { ...f.review, ...r }, text: { ...f.text }, coachConfirmation: { ...f.coachConfirmation } };
    if (r.editedText && r.status !== 'SUPPRESSED') { g.text.JUNIOR = r.editedText; g.text.PERFORMANCE = r.editedText; g.text.MASTERS_OPEN_WATER = r.editedText; }
    if (r.technicalConfirmed && g.classification === 'COACH_CONFIRMATION_REQUIRED') { g.classification = 'INFERRED'; g.coachConfirmation = { required: false }; }
    return g;
  });
}

/** @param {import('./types').SwimAnalysis} a @param {import('./types').ProfileId} [profileId] */
export function analyse(a, profileId) {
  const profile = PROFILES[profileId || (profileId = a.swimmer.communicationProfile)] || PROFILES.PERFORMANCE;
  const findings = applyReview(runRules(a), a.coachReview);
  const priorities = buildPriorities(a, findings, profile);
  const quality = assessQuality(a, findings.filter((f) => f.review.status !== 'SUPPRESSED'), priorities);
  const report = buildReport(a, findings, priorities, quality, profile);
  return { findings, priorities, quality, report, profile };
}

/** A copy of the analysis with the derived layers filled in, ready to persist. Source fields are untouched. */
export function withDerived(a, profileId) {
  const r = analyse(a, profileId);
  return { ...a, aquaSharksFindings: r.findings, priorities: r.priorities };
}
