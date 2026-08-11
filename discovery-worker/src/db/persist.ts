import type { SupabaseClient } from '@supabase/supabase-js';
import type { CandidateEvent } from '../domain/candidate-event.js';
import type { ConfidenceBreakdown } from '../confidence/score.js';
import { editionYearForKey, unknownYearKeyFor } from '../domain/candidate-key.js';
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

export async function startRun(
  db: SupabaseClient,
  sourceId: string,
  runType: 'scheduled' | 'manual' | 'backfill' | 'verification' = 'manual'
): Promise<string> {
  const { data, error } = await db
    .from('discovery_runs')
    .insert({ source_id: sourceId, run_type: runType, status: 'running' })
    .select('id')
    .single();
  fail('startRun', error);
  return data!.id as string;
}

export async function finishRun(
  db: SupabaseClient,
  runId: string,
  counters: {
    pagesFetched: number;
    candidatesFound: number;
    status: 'succeeded' | 'failed' | 'partial';
    errorMessage?: string;
    // Live-crawl counters. Fixture runs omit them: fixtures are read from
    // disk, not requested over HTTP, so requested === fetched there and
    // no change tracking applies.
    pagesRequested?: number;
    pagesChanged?: number;
    metrics?: Record<string, unknown>;
  }
): Promise<void> {
  const { error } = await db
    .from('discovery_runs')
    .update({
      status: counters.status,
      finished_at: new Date().toISOString(),
      pages_requested: counters.pagesRequested ?? counters.pagesFetched,
      pages_fetched: counters.pagesFetched,
      pages_changed: counters.pagesChanged ?? 0,
      candidates_found: counters.candidatesFound,
      error_message: counters.errorMessage ?? null,
      ...(counters.metrics ? { metrics: counters.metrics } : {}),
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

export interface PageFetchRecord {
  url: string;
  canonicalUrl: string;
  pageType: 'listing' | 'event_detail' | 'calendar' | 'results' | 'unknown';
  ok: boolean;
  httpStatus: number | null;
  contentHash: string | null;
  etag: string | null;
  lastModified: string | null;
  errorMessage: string | null;
}

export interface PageFetchOutcome {
  pageId: string;
  // True when this fetch's content hash differs from the stored one (or
  // the page is brand new) — the primitive the verification loop counts.
  changed: boolean;
}

// Records one live fetch against discovery_source_pages, maintaining the
// counters the schema promises: fetch_count, failure_count, last_error,
// and last_changed_at when the content hash moves. Read-modify-write
// rather than a blind upsert because the counters accumulate; at
// crawler request rates (one page per host per several seconds) there is
// no concurrent writer for the same row.
export async function recordPageFetch(
  db: SupabaseClient,
  sourceId: string,
  record: PageFetchRecord
): Promise<PageFetchOutcome> {
  const { data: existing, error: readErr } = await db
    .from('discovery_source_pages')
    .select('id, content_hash, fetch_count, failure_count, page_type')
    .eq('source_id', sourceId)
    .eq('canonical_url', record.canonicalUrl)
    .maybeSingle();
  fail('recordPageFetch/read', readErr);

  const now = new Date().toISOString();
  const changed = record.ok && record.contentHash !== null && record.contentHash !== (existing?.content_hash ?? null);

  const row: Record<string, unknown> = {
    source_id: sourceId,
    url: record.url,
    canonical_url: record.canonicalUrl,
    // Never demote a known page type to 'unknown' on a later fetch.
    page_type: existing && existing.page_type !== 'unknown' && record.pageType === 'unknown' ? existing.page_type : record.pageType,
    http_status: record.httpStatus,
    etag: record.etag,
    last_modified_header: record.lastModified,
    last_fetched_at: now,
    fetch_count: (existing?.fetch_count ?? 0) + 1,
    failure_count: (existing?.failure_count ?? 0) + (record.ok ? 0 : 1),
    last_error: record.ok ? null : record.errorMessage,
    updated_at: now,
  };
  if (record.ok && record.contentHash !== null) {
    row.content_hash = record.contentHash;
    if (changed) row.last_changed_at = now;
  }

  const { data, error } = await db
    .from('discovery_source_pages')
    .upsert(row, { onConflict: 'source_id,canonical_url' })
    .select('id')
    .single();
  fail('recordPageFetch/upsert', error);
  return { pageId: data!.id as string, changed };
}

export interface PersistResult {
  candidateId: string;
  candidateKey: string;
  distancesWritten: number;
  evidenceWritten: number;
  // What happened to the dateless predecessor of this candidate, if it had
  // one. Surfaced so a backfill run can report how many rows it healed
  // rather than leaving the effect invisible.
  unknownYearRow: 'reclaimed' | 'retired' | 'none';
}

// Reunites a candidate with the row it had while its date was unreadable.
//
// See domain/candidate-key.ts: the moment a parser fix makes a date
// readable, the candidate's key changes from 'unknown-year' to the real
// year, so the upsert below would insert a sibling and strand the original
// as `pending` forever. This closes that gap.
//
// Re-keying in place is strongly preferred over inserting-and-retiring:
// the row keeps its id, and with it every review decision, evidence row
// and dedupe link already attached to it. That is safe precisely because
// toCandidateEventRow() does not write candidate_status — an upsert
// refreshes the extracted facts and leaves the human verdict untouched.
async function reclaimUnknownYearRow(
  db: SupabaseClient,
  candidate: CandidateEvent,
  sourceId: string
): Promise<'reclaimed' | 'retired' | 'none'> {
  // Still dateless — there is nothing to reclaim, and the key is unchanged.
  if (editionYearForKey(candidate.startDate, candidate.dateConfirmed) === null) return 'none';

  const unknownKey = unknownYearKeyFor({
    sourceUrl: candidate.sourceUrl,
    name: candidate.canonicalName,
  });
  if (unknownKey === candidate.candidateKey) return 'none';

  const { data: orphan, error: orphanErr } = await db
    .from('discovery_candidate_events')
    .select('id, candidate_status')
    .eq('source_id', sourceId)
    .eq('candidate_key', unknownKey)
    .maybeSingle();
  fail('reclaimUnknownYearRow/findOrphan', orphanErr);
  if (!orphan) return 'none';

  const { data: dated, error: datedErr } = await db
    .from('discovery_candidate_events')
    .select('id')
    .eq('source_id', sourceId)
    .eq('candidate_key', candidate.candidateKey)
    .maybeSingle();
  fail('reclaimUnknownYearRow/findDated', datedErr);

  if (!dated) {
    // No dated row yet: hand this one its new identity. The upsert that
    // follows then UPDATES it instead of inserting a twin.
    const { error: rekeyErr } = await db
      .from('discovery_candidate_events')
      .update({ candidate_key: candidate.candidateKey })
      .eq('id', orphan.id);
    fail('reclaimUnknownYearRow/rekey', rekeyErr);
    return 'reclaimed';
  }

  // A dated row already exists, so the dateless one is genuinely redundant.
  // Retire it — but never overwrite a decision a human already made about
  // it. An approved or rejected row keeps its verdict and is left alone.
  if (orphan.candidate_status !== 'pending' && orphan.candidate_status !== 'needs_review') {
    return 'none';
  }
  const { error: retireErr } = await db
    .from('discovery_candidate_events')
    .update({ candidate_status: 'duplicate', updated_at: new Date().toISOString() })
    .eq('id', orphan.id);
  fail('reclaimUnknownYearRow/retire', retireErr);
  return 'retired';
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

  // Must run BEFORE the upsert: on the reclaim path it re-keys the existing
  // row so that this upsert lands on it rather than inserting a twin.
  const unknownYearRow = await reclaimUnknownYearRow(db, candidate, sourceId);

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
    unknownYearRow,
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
