import { extractJsonLd } from '../extract/jsonld.js';
import { extractHtml } from '../extract/html.js';
import { classifyEvent, type ClassificationResult } from '../extract/classify.js';
import { buildCandidateEvent } from '../normalize/event.js';
import { scoreCandidate, type ConfidenceBreakdown } from '../confidence/score.js';
import { validateCandidateEvent, type ValidationResult } from '../domain/validation.js';
import type { SourceRecord } from '../domain/source-record.js';
import type { CandidateEvent } from '../domain/candidate-event.js';

export interface PipelineResult {
  candidate: CandidateEvent;
  classification: ClassificationResult;
  confidence: ConfidenceBreakdown;
  validation: ValidationResult;
}

// What the discovery_sources row tells us about where this page came
// from. Curated by an admin when the source was enabled, so it counts as
// corroboration rather than inference — but it is only ever a fallback,
// never allowed to override what the page itself says.
export interface SourceContext {
  sourceType?: string | null;
  countryCode?: string | null;
}

function pathOf(url: string): string | null {
  try {
    return decodeURIComponent(new URL(url).pathname);
  } catch {
    return null;
  }
}

// The extraction pipeline for one already-retrieved page, shared by the
// fixture runner and the live crawler: extract (JSON-LD + HTML) ->
// classify -> normalise -> score -> validate. Pure local computation —
// no network call, no database write.
export function runExtractionPipeline(source: SourceRecord, context: SourceContext = {}): PipelineResult {
  const jsonld = extractJsonLd(source.html);
  const htmlExtraction = extractHtml(source.html);

  // Real pages never carry the fixture-style data-category attribute, so
  // the classifier is also given the page's own words and the source's
  // curated type. Without these every live candidate classified as
  // 'unclassified', which scoreCandidate treats as a hard veto — good
  // events with perfect dates and JSON-LD were being force-rejected.
  const classification = classifyEvent({
    categoryHint: htmlExtraction.categoryHint,
    waterBodyHint: htmlExtraction.waterBodyHint,
    hasSeparateSwimEntry: htmlExtraction.hasSeparateSwimEntry,
    titleText: htmlExtraction.titleText,
    descriptionText: htmlExtraction.descriptionText,
    urlPath: pathOf(source.sourceUrl),
    sourceType: context.sourceType ?? null,
  });

  const candidate = buildCandidateEvent({ source, jsonld, html: htmlExtraction, classification });

  // Country fallback. A venue with no parseable address leaves city and
  // country null, which costs 10 points for "no city or country" even
  // when we know perfectly well which country the source publishes for.
  // Only fills the gap, never overrides an extracted value, and records
  // that it was inferred from the source rather than read off the page.
  if (!candidate.countryCode && context.countryCode) {
    candidate.countryCode = context.countryCode;
    candidate.rawSourceValues = { ...candidate.rawSourceValues, countryFromSource: context.countryCode };
    candidate.warnings.push(
      `Country ${context.countryCode} taken from the source's own country, not from the page — confirm before publishing`
    );
  }

  const confidence = scoreCandidate(candidate, classification);
  candidate.confidenceScore = confidence.totalScore;
  candidate.confidenceReasons = confidence.reasons;

  const validation = validateCandidateEvent(candidate);
  return { candidate, classification, confidence, validation };
}
