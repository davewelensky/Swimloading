import path from 'node:path';
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { assertPhaseOneSafe, loadConfig } from './config.js';
import { processFixture, type ProcessedFixture } from './jobs/process-fixture.js';
import { writeFixtureOutput, type PossibleDuplicateEntry } from './output/write-json.js';
import { computeDuplicateScore } from './dedupe/match.js';
import { createServiceRoleClient } from './db/supabaseClient.js';
import {
  ensureFixtureSource,
  finishRun,
  persistCandidate,
  persistDedupeLinks,
  startRun,
  upsertSourcePage,
} from './db/persist.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = path.join(__dirname, '..', 'fixtures');
const OUT_DIR = path.join(__dirname, '..', 'out');

interface CliArgs {
  all: boolean;
  fixture: string | null;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { all: false, fixture: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--all') {
      args.all = true;
    } else if (argv[i] === '--fixture') {
      args.fixture = argv[i + 1] ?? null;
      i++;
    }
  }
  return args;
}

async function resolveFixturePaths(args: CliArgs): Promise<string[]> {
  if (args.all) {
    const files = await readdir(FIXTURES_DIR);
    return files
      .filter((f) => f.endsWith('.html'))
      .map((f) => path.join(FIXTURES_DIR, f))
      .sort();
  }
  if (args.fixture) {
    return [path.isAbsolute(args.fixture) ? args.fixture : path.resolve(process.cwd(), args.fixture)];
  }
  throw new Error('Usage: npm run dev -- --fixture <path>   OR   npm run process:fixtures');
}

async function main(): Promise<void> {
  const config = loadConfig();
  assertPhaseOneSafe(config);

  const args = parseArgs(process.argv.slice(2));
  const fixturePaths = await resolveFixturePaths(args);

  const processed: ProcessedFixture[] = [];
  for (const fixturePath of fixturePaths) {
    console.log(`Processing ${path.relative(process.cwd(), fixturePath)}...`);
    processed.push(await processFixture(fixturePath));
  }

  // Dedupe pass — only meaningful across a batch, compares every pair
  // processed in this run. There is no database to compare against yet;
  // this is strictly within-run matching (see README's next phase).
  for (let i = 0; i < processed.length; i++) {
    const current = processed[i];
    if (!current) continue;

    const possibleDuplicates: PossibleDuplicateEntry[] = [];
    for (let j = 0; j < processed.length; j++) {
      if (i === j) continue;
      const other = processed[j];
      if (!other) continue;
      const result = computeDuplicateScore(current.candidate, other.candidate);
      if (result.possibleDuplicate) {
        possibleDuplicates.push({ comparedTo: other.fixtureName, result });
      }
    }

    const outPath = await writeFixtureOutput(OUT_DIR, current.fixtureName, {
      fixturePath: current.fixturePath,
      candidate: current.candidate,
      classification: current.classification,
      confidence: current.confidence,
      validation: current.validation,
      possibleDuplicates,
    });

    console.log(
      `  -> ${path.relative(process.cwd(), outPath)}  (confidence ${current.confidence.totalScore}, ${current.confidence.recommendation})`
    );
    if (!current.validation.valid) {
      console.warn(`     validation errors: ${current.validation.errors.join('; ')}`);
    }
    if (possibleDuplicates.length > 0) {
      console.warn(`     possible duplicate of: ${possibleDuplicates.map((d) => d.comparedTo).join(', ')}`);
    }
  }

  console.log(`\nProcessed ${processed.length} fixture(s). Output written to ${path.relative(process.cwd(), OUT_DIR)}/`);

  if (!config.writeEnabled) {
    console.log('DISCOVERY_WRITE_ENABLED=false — dry run, nothing written to the database.');
    return;
  }

  await persistAll(processed);
}

// Writes every processed candidate to Supabase. Only reached when
// DISCOVERY_WRITE_ENABLED=true and credentials are present (config.ts
// already refused to start otherwise).
async function persistAll(processed: ProcessedFixture[]): Promise<void> {
  console.log('\nDISCOVERY_WRITE_ENABLED=true — writing candidates to Supabase...');
  const db = createServiceRoleClient();
  const sourceId = await ensureFixtureSource(db);
  const runId = await startRun(db, sourceId);

  let written = 0;
  try {
    // Pass 1 — write every candidate, remembering its database id.
    const idByFixture = new Map<string, string>();
    for (const item of processed) {
      const html = await readFile(item.fixturePath, 'utf8');
      const sourcePageId = await upsertSourcePage(db, sourceId, item.candidate.sourceUrl, html);
      const result = await persistCandidate(db, item.candidate, item.confidence, sourceId, sourcePageId);
      idByFixture.set(item.fixtureName, result.candidateId);
      written++;
      console.log(
        `  wrote ${item.fixtureName}  key=${result.candidateKey.slice(0, 12)}…  ` +
          `${result.distancesWritten} distance(s), ${result.evidenceWritten} evidence row(s)`
      );
    }

    // Pass 2 — duplicate findings, which need BOTH sides' ids and so can
    // only be written once every candidate exists.
    let linksWritten = 0;
    for (let i = 0; i < processed.length; i++) {
      const current = processed[i];
      if (!current) continue;
      const currentId = idByFixture.get(current.fixtureName);
      if (!currentId) continue;

      const links = [];
      for (let j = 0; j < processed.length; j++) {
        if (i === j) continue;
        const other = processed[j];
        if (!other) continue;
        const match = computeDuplicateScore(current.candidate, other.candidate);
        if (!match.possibleDuplicate) continue;
        const otherId = idByFixture.get(other.fixtureName);
        if (!otherId) continue;
        links.push({
          matchingCandidateId: otherId,
          similarityScore: match.score,
          possibleDuplicate: match.possibleDuplicate,
          matchingSignals: match.matchingSignals,
          conflictingSignals: match.conflictingSignals,
        });
      }
      linksWritten += await persistDedupeLinks(db, currentId, links);
    }
    if (linksWritten > 0) {
      console.log(`  wrote ${linksWritten} unresolved duplicate link(s) — these block approval until reviewed`);
    }

    await finishRun(db, runId, {
      pagesFetched: processed.length,
      candidatesFound: written,
      status: 'succeeded',
    });
    console.log(`\nWrote ${written} candidate(s). Run ${runId} marked succeeded.`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Record the failure against the run before rethrowing, so a partial
    // write is visible in discovery_runs rather than looking like a run
    // that never happened.
    await finishRun(db, runId, {
      pagesFetched: processed.length,
      candidatesFound: written,
      status: written > 0 ? 'partial' : 'failed',
      errorMessage: message,
    }).catch(() => { /* the original error matters more than this bookkeeping */ });
    throw err;
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
