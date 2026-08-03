import { EVENT_TYPES, type Classification, type EventType } from '../domain/enums.js';

export interface ClassificationInput {
  categoryHint: string | null;
  waterBodyHint: string | null;
  hasSeparateSwimEntry: boolean | null;
}

export interface ClassificationResult {
  classification: Classification;
  eligible: boolean;
  reasons: string[];
  warnings: string[];
}

const EVENT_TYPE_SET = new Set<string>(EVENT_TYPES);

// Deterministic classification driven entirely by explicit signals
// extracted from the page (see extract/html.ts) — never by inferring
// intent from free-text alone. This is phase-1 scope: a real classifier
// would eventually add keyword/NLP heuristics as a later, separate
// extraction method; here every input is a controlled-vocabulary hint.
export function classifyEvent(input: ClassificationInput): ClassificationResult {
  const reasons: string[] = [];
  const warnings: string[] = [];

  // A pool water body always overrides any other category signal — a
  // pool gala mislabelled upstream as e.g. "official_race" is still not
  // an open-water opportunity.
  if (input.waterBodyHint === 'pool') {
    reasons.push('waterBodyHint is "pool" — indoor/pool events are not open-water swim opportunities');
    return { classification: 'pool_only', eligible: false, reasons, warnings };
  }

  if (input.categoryHint === 'triathlon') {
    if (input.hasSeparateSwimEntry === true) {
      reasons.push('triathlon with a separately enterable swim leg — eligible as a standalone race entry');
      return { classification: 'official_race', eligible: true, reasons, warnings };
    }
    if (input.hasSeparateSwimEntry === null) {
      warnings.push('triathlon page did not declare whether the swim leg is separately enterable — treated as ineligible pending clarification');
    }
    reasons.push('triathlon page with no separately enterable swim leg');
    return { classification: 'triathlon_only', eligible: false, reasons, warnings };
  }

  if (input.categoryHint === 'historical_result') {
    reasons.push('page is a historical race-result article, not a listing for an upcoming opportunity');
    return { classification: 'historical_result', eligible: false, reasons, warnings };
  }

  if (input.categoryHint === 'tourism') {
    reasons.push('page is general beach/tourism content with no specific swim opportunity');
    return { classification: 'general_tourism_page', eligible: false, reasons, warnings };
  }

  if (input.categoryHint === 'no_opportunity') {
    reasons.push('page mentions swimming but offers no actual bookable/enterable opportunity');
    return { classification: 'no_actual_opportunity', eligible: false, reasons, warnings };
  }

  if (input.categoryHint !== null && EVENT_TYPE_SET.has(input.categoryHint)) {
    const eventType = input.categoryHint as EventType;
    reasons.push(`categoryHint matched a known event type: ${eventType}`);
    return { classification: eventType, eligible: true, reasons, warnings };
  }

  warnings.push(input.categoryHint === null ? 'no category hint found on page' : `unrecognized category hint: "${input.categoryHint}"`);
  reasons.push('insufficient signal to classify this page');
  return { classification: 'unclassified', eligible: false, reasons, warnings };
}
