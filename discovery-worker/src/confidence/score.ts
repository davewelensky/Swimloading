import type { CandidateEvent } from '../domain/candidate-event.js';
import type { PublicationRecommendation } from '../domain/enums.js';
import type { ClassificationResult } from '../extract/classify.js';
import { ALL_RULES, type ConfidenceContext } from './rules.js';

export interface ConfidenceBreakdown {
  totalScore: number;
  reasons: string[];
  recommendation: PublicationRecommendation;
}

// Deterministic rule-based scoring — every point on the score is
// traceable to a named rule in confidence/rules.ts. No LLM involvement.
// Ineligible classifications (pool_only, triathlon_only, historical_result,
// etc.) are always forced to "rejected" regardless of the numeric score —
// eligibility is a hard gate, not something a high score can override.
export function scoreCandidate(
  candidate: CandidateEvent,
  classification: ClassificationResult,
  ctx: ConfidenceContext = { now: new Date() }
): ConfidenceBreakdown {
  let rawTotal = 0;
  const reasons: string[] = [];

  for (const rule of ALL_RULES) {
    const outcome = rule.evaluate(candidate, classification, ctx);
    if (!outcome) continue;
    rawTotal += outcome.points;
    const sign = outcome.points >= 0 ? '+' : '';
    reasons.push(`${sign}${outcome.points} ${outcome.reason}`);
  }

  const totalScore = Math.max(0, Math.min(100, rawTotal));

  // "rejected" means we know this shouldn't be published — either the
  // classifier says so (a hard veto, regardless of score) or there is
  // almost nothing usable in the extraction. A merely under-specified but
  // otherwise legitimate candidate (e.g. missing only a confirmed year)
  // is "insufficient_evidence", not "rejected" — it needs more/better
  // source data, not outright dismissal.
  let recommendation: PublicationRecommendation;
  if (!classification.eligible) {
    recommendation = 'rejected';
  } else if (totalScore >= 75) {
    recommendation = 'high_confidence';
  } else if (totalScore >= 50) {
    recommendation = 'manual_review';
  } else if (totalScore >= 15) {
    recommendation = 'insufficient_evidence';
  } else {
    recommendation = 'rejected';
  }

  return { totalScore, reasons, recommendation };
}
