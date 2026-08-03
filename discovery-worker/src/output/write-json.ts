import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { CandidateEvent } from '../domain/candidate-event.js';
import type { ClassificationResult } from '../extract/classify.js';
import type { ConfidenceBreakdown } from '../confidence/score.js';
import type { ValidationResult } from '../domain/validation.js';
import type { DuplicateMatchResult } from '../dedupe/match.js';

export interface PossibleDuplicateEntry {
  comparedTo: string;
  result: DuplicateMatchResult;
}

export interface FixtureOutput {
  fixturePath: string;
  candidate: CandidateEvent;
  classification: ClassificationResult;
  confidence: ConfidenceBreakdown;
  validation: ValidationResult;
  possibleDuplicates: PossibleDuplicateEntry[];
}

export async function writeFixtureOutput(outDir: string, fixtureName: string, output: FixtureOutput): Promise<string> {
  await mkdir(outDir, { recursive: true });
  const outPath = path.join(outDir, `${fixtureName}.json`);
  await writeFile(outPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
  return outPath;
}
