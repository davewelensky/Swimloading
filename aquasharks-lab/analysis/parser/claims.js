// @ts-check
/**
 * Claim classification for EO prose. This is NOT deterministic extraction: it is a rule-based first pass that FAILS CLOSED.
 * Anything with interpretive wording, or with no clear measurement, is treated as a diagnostic claim (kept out of evidence).
 * Only a sentence that states a number and contains no interpretive wording is a measurement statement. A coach can override.
 */

const STRONG = /\b(likely|suggests?|suggesting|indicat\w+|strongly|culprit|because|due to|caus\w+|forcing|cascad\w+|robbing|compound\w+|implies|means your)\b/i;
const SOFT = /\b(inefficien\w*|wasted?|issues?|problems?|limiter|breakdown|mechanic\w*|techniques?|weakness|weak|deteriorat\w*|should|need to|must|ideal|thresholds?|substantial|significant\w*|severe|poor|excellent|good news|dominan\w*|fatigue\w*|structural|rather than|clean|efficient|proper|loses|working against)\b/i;

/** @returns {{claimType: 'MEASUREMENT_STATEMENT'|'DIAGNOSTIC_INTERPRETATION', basis: 'RULE', confidence: 'HIGH'|'MODERATE'|'LOW'}} */
export function classifyClaim(sentence) {
  const s = String(sentence || '');
  const hasNumber = /\d/.test(s);
  if (STRONG.test(s)) return { claimType: 'DIAGNOSTIC_INTERPRETATION', basis: 'RULE', confidence: 'HIGH' };
  if (SOFT.test(s)) return { claimType: 'DIAGNOSTIC_INTERPRETATION', basis: 'RULE', confidence: 'MODERATE' };
  if (hasNumber) return { claimType: 'MEASUREMENT_STATEMENT', basis: 'RULE', confidence: 'HIGH' };
  return { claimType: 'DIAGNOSTIC_INTERPRETATION', basis: 'RULE', confidence: 'LOW' };   // fail closed
}

/** Clinical or sensitive advice must never be auto-surfaced to a swimmer or parent. */
export function classifyAudience(text) {
  return /\b(physio\w*|referral|consult|impingement|neuromuscular|medical|doctor|clinical|injur\w+|diagnos\w+|pain)\b/i.test(text) ? 'COACH_ONLY' : 'SWIMMER';
}
/** A paragraph that ends without terminal punctuation is probably cut off in the source. */
export const isTruncated = (text) => !/[.!?”"')]\s*$/.test(String(text || '').trim());
