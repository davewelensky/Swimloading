import { detectPageLanguage } from '../fetch/decode.js';
import { makeLiveSourceRecord } from '../domain/source-record.js';
import type { CandidateEvent } from '../domain/candidate-event.js';
import type { ClassificationResult } from '../extract/classify.js';
import type { ConfidenceBreakdown } from '../confidence/score.js';
import type { ValidationResult } from '../domain/validation.js';
import { runExtractionPipeline } from './extract-pipeline.js';

export interface ProcessedPage {
  url: string;
  pageLanguage: string | null;
  candidate: CandidateEvent;
  classification: ClassificationResult;
  confidence: ConfidenceBreakdown;
  validation: ValidationResult;
}

// One live-fetched page through the shared extraction pipeline, plus the
// live-only annotations: the page's declared language is recorded on the
// candidate, and a non-English page gets an explicit reviewer warning —
// deterministic extraction is English-tuned, so a thin result on an
// Italian or Turkish page is expected and must be visible as such rather
// than looking like a bad source.
export function processPage(sourceId: string, url: string, html: string): ProcessedPage {
  const source = makeLiveSourceRecord(sourceId, url, html);
  const { candidate, classification, confidence, validation } = runExtractionPipeline(source);

  const pageLanguage = detectPageLanguage(html);
  candidate.rawSourceValues = { ...candidate.rawSourceValues, pageLanguage };
  if (pageLanguage && pageLanguage !== 'en') {
    candidate.warnings.push(
      `Page language is "${pageLanguage}" — deterministic extraction is English-tuned beyond JSON-LD; review extracted text fields carefully`
    );
  }

  return { url, pageLanguage, candidate, classification, confidence, validation };
}

// Persistence gate for pages DISCOVERED via listing links (as opposed to
// already-known event URLs, which always persist so change monitoring
// works). A listing crawl fetches structurally-filtered links in any
// language, so plenty of non-event pages arrive here; a page earns a
// review-queue row only if extraction found an actual event shape.
// Language plays no part in this gate — a Thai event page with JSON-LD
// passes exactly like an English one.
export function shouldPersistDiscoveredPage(processed: ProcessedPage): { persist: boolean; reason: string } {
  const { candidate, classification } = processed;
  if (!candidate.canonicalName) {
    return { persist: false, reason: 'no event name extracted' };
  }
  const hasEventShape = candidate.startDate !== null || candidate.distances.length > 0;
  if (!hasEventShape) {
    return { persist: false, reason: 'no date and no distances extracted — not an event page' };
  }
  if (!classification.eligible && classification.classification === 'unclassified') {
    // Explicitly-rejected classifications (pool_only, triathlon_only,
    // historical_result…) ARE persisted — the review queue and approval
    // RPC handle them, and they document why a page was excluded. Only a
    // page with no classification signal at all and nothing but a
    // name+date is held back… and even then the date earns it a row.
    return { persist: true, reason: 'unclassified but has event shape — persisted for review' };
  }
  return { persist: true, reason: 'extracted event shape' };
}
