import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { ClassificationResult } from '../extract/classify.js';
import type { ConfidenceBreakdown } from '../confidence/score.js';
import type { ValidationResult } from '../domain/validation.js';
import { makeFixtureSourceRecord } from '../domain/source-record.js';
import type { CandidateEvent } from '../domain/candidate-event.js';
import { runExtractionPipeline } from './extract-pipeline.js';

export interface ProcessedFixture {
  fixturePath: string;
  fixtureName: string;
  candidate: CandidateEvent;
  classification: ClassificationResult;
  confidence: ConfidenceBreakdown;
  validation: ValidationResult;
}

// The fixture entry point into the shared extraction pipeline
// (extract-pipeline.ts): read a checked-in HTML file off disk and run it
// through the same extract -> classify -> normalise -> score -> validate
// steps the live crawler uses. No network call, no database write.
export async function processFixture(fixturePath: string): Promise<ProcessedFixture> {
  const html = await readFile(fixturePath, 'utf8');
  const fixtureName = path.basename(fixturePath, path.extname(fixturePath));
  const sourceUrl = `https://example-organiser.invalid/fixtures/${fixtureName}`;
  const source = makeFixtureSourceRecord(fixturePath, html, sourceUrl);

  const { candidate, classification, confidence, validation } = runExtractionPipeline(source);
  return { fixturePath, fixtureName, candidate, classification, confidence, validation };
}
