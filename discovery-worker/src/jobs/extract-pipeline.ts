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

// The extraction pipeline for one already-retrieved page, shared by the
// fixture runner and the live crawler: extract (JSON-LD + HTML) ->
// classify -> normalise -> score -> validate. Pure local computation —
// no network call, no database write.
export function runExtractionPipeline(source: SourceRecord): PipelineResult {
  const jsonld = extractJsonLd(source.html);
  const htmlExtraction = extractHtml(source.html);
  const classification = classifyEvent({
    categoryHint: htmlExtraction.categoryHint,
    waterBodyHint: htmlExtraction.waterBodyHint,
    hasSeparateSwimEntry: htmlExtraction.hasSeparateSwimEntry,
  });

  const candidate = buildCandidateEvent({ source, jsonld, html: htmlExtraction, classification });

  const confidence = scoreCandidate(candidate, classification);
  candidate.confidenceScore = confidence.totalScore;
  candidate.confidenceReasons = confidence.reasons;

  const validation = validateCandidateEvent(candidate);
  return { candidate, classification, confidence, validation };
}
