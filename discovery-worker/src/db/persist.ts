import type { SupabaseClient } from '@supabase/supabase-js';
import type { CandidateEvent } from '../domain/candidate-event.js';
import type { ConfidenceBreakdown } from '../confidence/score.js';
import {
  toCandidateDistanceRows,
  toCandidateEventRow,
  toEvidenceRows,
  toSourcePageRow,
} from './rows.js';

// A fixed, deterministic id for the local-fixture pseudo-source, so
// repeated runs reuse one row instead of creating a new "source" each
// time. Deliberately obvious as synthetic, and always enabled=false so it
// can never be picked up by a future scheduler as a real crawl target.
export const FIXTURE_SOURCE_ID = '00000000-0000-4000-8000-000000000001';

function fail(context: string, error: { message: string } | null): void {
  if (error) throw new Error(`${context}: ${error.message}`);
}

// Upserts the fixture source row. The worker legitimately owns
// discovery_sources maintenance (health, last_run_at, failure counts), so
// writing here is within its remit — but it only ever creates this one
// clearly-labelled, disabled row. Real sources stay an admin action.
export async function ensureFixtureSource(db: SupabaseClient): Promise<string> {
  const { error } = await db.from('discovery_sources').upsert(
    {
      id: FIXTURE_SOURCE_ID,
      name: 'LOCAL FIXTURES (synthetic — not a real source)',
      base_url: 'https://example-organiser.invalid',
      source_type: 'other',
      authority_level: 1,
      parser_type: 'jsonld_html',
      enabled: false,
      health_status: 'unknown',
      crawl_frequency: 'manual',
      notes:
        'Synthetic source representing discovery-worker/fixtures/. Created by the worker in ' +
        'fixture write mode. enabled=false so no scheduler will ever crawl it.',
    },
    { onConflict: 'id' }
  );
  fail('ensureFixtureSource', error);
  return FIXTURE_SOURCE_ID;
}

export async function startRun(db: SupabaseClient, sourceId: string): Promise<string> {
  const { data, error } = await db
    .from('discovery_runs')
    .insert({ source_id: sourceId, run_type: 'manual', status: 'running' })
    .select('id')
    .single();
  fail('startRun', error);
  return data!.id as string;
}

export async function finishRun(
  db: SupabaseClient,
  runId: string,
  counters: { pagesFetched: number; candidatesFound: number; status: 'succeeded' | 'failed' | 'partial'; errorMessage?: string }
): Promise<void> {
  const { error } = await db
    .from('discovery_runs')
    .update({
      status: counters.status,
      finished_at: new Date().toISOString(),
      // Fixtures are read from disk, not requested over HTTP. Counting
      // them as "requested" as well as "fetched" keeps the two columns
      // honest and equal rather than implying network traffic happened.
      pages_requested: counters.pagesFetched,
      pages_fetched: counters.pagesFetched,
      candidates_found: counters.candidatesFound,
      error_message: counters.errorMessage ?? null,
    })
    .eq('id', runId);
  fail('finishRun', error);
}

export async function upsertSourcePage(
  db: SupabaseClient,
  sourceId: string,
  sourceUrl: string,
  html: string
): Promise<string> {
  const row = toSourcePageRow(sourceId, sourceUrl, html);
  const { data, error } = await db
    .from('discovery_source_pages')
    .upsert(row, { onConflict: 'source_id,canonical_url' })
    .select('id')
    .single();
  fail('upsertSourcePage', error);
  return data!.id as string;
}

export interface PersistResult {
  candidateId: string;
  candidateKey: string;
  distancesWritten: number;
  evidenceWritten: number;
}

// Writes one candidate and its children. Idempotent by design:
//   * the candidate upserts on (source_id, candidate_key)
//   * children are deleted then re-inserted, because distances and
//     evidence have no natural key of their own and are wholly derived
//     from the current extraction — replacing them is the correct
//     semantic, and it stops re-runs stacking duplicates.
export async function persistCandidate(
  db: SupabaseClient,
  candidate: CandidateEvent,
  confidence: ConfidenceBreakdown,
  sourceId: string,
  sourcePageId: string | null
): Promise<PersistResult> {
  const row = toCandidateEventRow(candidate, confidence, sourceId, sourcePageId);

  const { data, error } = await db
    .from('discovery_candidate_events')
    .upsert(row, { onConflict: 'source_id,candidate_key' })
    .select('id')
    .single();
  fail(`persistCandidate(${candidate.candidateKey})`, error);
  const candidateId = data!.id as string;

  const { error: delDistErr } = await db
    .from('discovery_candidate_distances')
    .delete()
    .eq('candidate_id', candidateId);
  fail('persistCandidate/clearDistances', delDistErr);

  const distanceRows = toCandidateDistanceRows(candidate, candidateId);
  if (distanceRows.length > 0) {
    const { error: insDistErr } = await db.from('discovery_candidate_distances').insert(distanceRows);
    fail('persistCandidate/insertDistances', insDistErr);
  }

  const { error: delEvErr } = await db
    .from('discovery_event_evidence')
    .delete()
    .eq('candidate_id', candidateId);
  fail('persistCandidate/clearEvidence', delEvErr);

  const evidenceRows = toEvidenceRows(candidate, candidateId, sourcePageId);
  if (evidenceRows.length > 0) {
    const { error: insEvErr } = await db.from('discovery_event_evidence').insert(evidenceRows);
    fail('persistCandidate/insertEvidence', insEvErr);
  }

  return {
    candidateId,
    candidateKey: candidate.candidateKey,
    distancesWritten: distanceRows.length,
    evidenceWritten: evidenceRows.length,
  };
}

export interface DedupeLinkInput {
  matchingCandidateId: string;
  similarityScore: number;
  possibleDuplicate: boolean;
  matchingSignals: string[];
  conflictingSignals: string[];
}

// Persists this run's duplicate findings. Without these rows the approval
// RPC's "unresolved duplicates block approval" guard is inert, and two
// pages describing one real event would both publish as separate editions
// — precisely what duplicate detection exists to prevent.
//
// Written after every candidate exists, because a link needs both sides'
// database ids. Replaced per candidate on each run (same delete-then-insert
// reasoning as distances and evidence): the findings are wholly derived
// from the current extraction.
//
// Note it only ever writes resolution='unresolved' — a resolution is an
// admin decision, and re-running the worker must never quietly undo one.
// That is why resolved links are preserved rather than replaced.
export async function persistDedupeLinks(
  db: SupabaseClient,
  candidateId: string,
  links: DedupeLinkInput[]
): Promise<number> {
  const { error: delErr } = await db
    .from('discovery_dedupe_links')
    .delete()
    .eq('candidate_id', candidateId)
    .eq('resolution', 'unresolved');
  fail('persistDedupeLinks/clear', delErr);

  const rows = links
    // The DB forbids a self-match; guard here too so a bug upstream fails
    // visibly in tests rather than as a constraint violation in production.
    .filter((l) => l.matchingCandidateId !== candidateId)
    .map((l) => ({
      candidate_id: candidateId,
      matching_candidate_id: l.matchingCandidateId,
      matching_edition_id: null,
      similarity_score: Math.max(0, Math.min(100, Math.round(l.similarityScore))),
      possible_duplicate: l.possibleDuplicate,
      matching_signals: l.matchingSignals,
      conflicting_signals: l.conflictingSignals,
      resolution: 'unresolved',
    }));

  if (rows.length === 0) return 0;

  const { error: insErr } = await db.from('discovery_dedupe_links').insert(rows);
  fail('persistDedupeLinks/insert', insErr);
  return rows.length;
}
