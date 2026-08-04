import type { CandidateEvent } from '../domain/candidate-event.js';
import type { Classification, PublicationRecommendation } from '../domain/enums.js';
import type { ClassificationResult } from '../extract/classify.js';
import { ALL_RULES, type ConfidenceContext } from './rules.js';

// Classifications that are POSITIVE evidence the page is not an
// open-water opportunity. These veto publication whatever the score.
//
// 'unclassified' is deliberately NOT in this list. It means "we could not
// tell", which is absence of evidence rather than evidence of absence —
// treating it as a veto force-rejected genuine events that had a name, an
// exact date, a registration URL and JSON-LD, purely because the page did
// not spell out what kind of swim it was. Those now fall through to the
// numeric score and reach a human, which is the whole point of a review
// queue.
const HARD_VETO_CLASSIFICATIONS = new Set<Classification>([
  'pool_only',
  'triathlon_only',
  'historical_result',
  'general_tourism_page',
  'no_actual_opportunity',
]);

export interface ConfidenceBreakdown {
  totalScore: number;
  reasons: string[];
  recommendation: PublicationRecommendation;
}

// Deterministic rule-based scoring — every point on the score is
// traceable to a named rule in confidence/rules.ts. No LLM involvement.
//
// Thresholds lean towards putting things IN FRONT OF A REVIEWER rather
// than silently discarding them (product decision, 2026-08-04): the
// catalogue carries an explicit "confirm with the organiser before you
// travel" disclaimer, a listing is not a warranty, and a missed real
// swim costs more than a candidate a human takes five seconds to reject.
// Only positive evidence of ineligibility (see HARD_VETO_CLASSIFICATIONS)
// rejects outright.
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
  if (HARD_VETO_CLASSIFICATIONS.has(classification.classification)) {
    recommendation = 'rejected';
  } else if (totalScore >= 75) {
    recommendation = 'high_confidence';
  } else if (totalScore >= 40) {
    recommendation = 'manual_review';
  } else if (totalScore >= 10) {
    recommendation = 'insufficient_evidence';
  } else {
    recommendation = 'rejected';
  }

  return { totalScore, reasons, recommendation };
}
