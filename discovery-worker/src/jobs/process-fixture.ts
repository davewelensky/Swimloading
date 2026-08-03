import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { extractJsonLd } from '../extract/jsonld.js';
import { extractHtml } from '../extract/html.js';
import { classifyEvent, type ClassificationResult } from '../extract/classify.js';
import { buildCandidateEvent } from '../normalize/event.js';
import { scoreCandidate, type ConfidenceBreakdown } from '../confidence/score.js';
import { validateCandidateEvent, type ValidationResult } from '../domain/validation.js';
import { makeFixtureSourceRecord } from '../domain/source-record.js';
import type { CandidateEvent } from '../domain/candidate-event.js';

export interface ProcessedFixture {
  fixturePath: string;
  fixtureName: string;
  candidate: CandidateEvent;
  classification: ClassificationResult;
  confidence: ConfidenceBreakdown;
  validation: ValidationResult;
}

// The full local pipeline for one fixture: read -> extract (JSON-LD +
// HTML) -> classify -> normalise into a CandidateEvent -> score
// confidence -> validate. No network call, no database write — `html` is
// always read from a checked-in fixture file on disk.
export async function processFixture(fixturePath: string): Promise<ProcessedFixture> {
  const html = await readFile(fixturePath, 'utf8');
  const fixtureName = path.basename(fixturePath, path.extname(fixturePath));
  const sourceUrl = `https://example-organiser.invalid/fixtures/${fixtureName}`;
  const source = makeFixtureSourceRecord(fixturePath, html, sourceUrl);

  const jsonld = extractJsonLd(html);
  const htmlExtraction = extractHtml(html);
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

  return { fixturePath, fixtureName, candidate, classification, confidence, validation };
}
