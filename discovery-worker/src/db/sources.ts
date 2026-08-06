import type { SupabaseClient } from '@supabase/supabase-js';
import type { SchedulableSource } from '../schedule/scheduler.js';
import { FIXTURE_SOURCE_ID } from './persist.js';

function fail(context: string, error: { message: string } | null): void {
  if (error) throw new Error(`${context}: ${error.message}`);
}

// Every enabled source. Due-ness is decided in pure code
// (schedule/scheduler.ts), not SQL, so it is unit-testable; the fixture
// pseudo-source is excluded here as a hard rule regardless of its flags.
export async function fetchEnabledSources(db: SupabaseClient): Promise<SchedulableSource[]> {
  const { data, error } = await db
    .from('discovery_sources')
    .select('id, name, base_url, parser_type, enabled, crawl_frequency, next_run_at, language_codes, consecutive_failure_count, source_type, country_code, expand_url_pattern')
    .eq('enabled', true)
    .neq('id', FIXTURE_SOURCE_ID);
  fail('fetchEnabledSources', error);
  return (data ?? []) as SchedulableSource[];
}

export async function fetchSourceById(db: SupabaseClient, sourceId: string): Promise<SchedulableSource | null> {
  const { data, error } = await db
    .from('discovery_sources')
    .select('id, name, base_url, parser_type, enabled, crawl_frequency, next_run_at, language_codes, consecutive_failure_count, source_type, country_code, expand_url_pattern')
    .eq('id', sourceId)
    .maybeSingle();
  fail('fetchSourceById', error);
  return (data as SchedulableSource | null) ?? null;
}

function isCrawlableUrl(u: string): boolean {
  try {
    const host = new URL(u).host;
    return host !== 'example-organiser.invalid' && !host.endsWith('swimloading.com');
  } catch {
    return false;
  }
}

// The VERIFICATION worklist: pages that actually produced an event, plus
// the source_url of every existing candidate. Re-fetching these is what
// turns content_hash/last_verified_at into a real change-monitoring loop.
//
// Deliberately excludes page_type 'unknown' — a page we fetched and found
// no event on. Re-checking those every week would consume the entire page
// budget on known dead ends and starve discovery of new URLs. They are
// still remembered (see fetchSeenUrls) so they are not re-discovered
// either; a site that later publishes an event at that URL is picked up
// when its listing or sitemap surfaces it again as new.
export async function fetchKnownEventUrls(db: SupabaseClient, sourceId: string): Promise<string[]> {
  const urls = new Set<string>();

  const { data: pages, error: pagesErr } = await db
    .from('discovery_source_pages')
    .select('canonical_url')
    .eq('source_id', sourceId)
    .eq('page_type', 'event_detail');
  fail('fetchKnownEventUrls/pages', pagesErr);
  for (const row of pages ?? []) urls.add(row.canonical_url as string);

  const { data: candidates, error: candErr } = await db
    .from('discovery_candidate_events')
    .select('source_url')
    .eq('source_id', sourceId);
  fail('fetchKnownEventUrls/candidates', candErr);
  for (const row of candidates ?? []) urls.add(row.source_url as string);

  return [...urls].filter(isCrawlableUrl);
}

// URLs this source already has AI-read candidates for. Used to stop an
// unchanged page being sent to the model — and billed — a second time.
// Reads the candidates rather than a dedicated bookkeeping table, so the
// answer can never drift from what was actually written.
export async function fetchAiExtractedUrls(db: SupabaseClient, sourceId: string): Promise<string[]> {
  const { data, error } = await db
    .from('discovery_candidate_events')
    .select('source_url')
    .eq('source_id', sourceId)
    .eq('extraction_method', 'ai_fallback');
  fail('fetchAiExtractedUrls', error);
  return (data ?? []).map((row) => row.source_url as string);
}

// Every URL this source has EVER been fetched at, whatever the outcome.
// Used to subtract already-seen pages from freshly discovered ones, so a
// site's dead ends are not rediscovered and re-fetched on every run —
// without this, discovery on a large site never advances past the first
// budget's worth of URLs.
export async function fetchSeenUrls(db: SupabaseClient, sourceId: string): Promise<string[]> {
  const { data, error } = await db
    .from('discovery_source_pages')
    .select('canonical_url')
    .eq('source_id', sourceId);
  fail('fetchSeenUrls', error);
  return (data ?? []).map((row) => row.canonical_url as string);
}

// Minimal shape needed by dedupe/match.ts to score a new candidate
// against what is already in the database for cross-run duplicate
// detection. Distances are deliberately omitted (their signal is worth 5
// points and needs a join); the strong signals — name, date, place — are
// all here.
export interface ExistingCandidateForDedupe {
  id: string;
  canonicalName: string | null;
  organiserName: string | null;
  city: string | null;
  countryCode: string | null;
  latitude: number | null;
  longitude: number | null;
  startDate: string | null;
  endDate: string | null;
}

export async function fetchExistingCandidatesForDedupe(
  db: SupabaseClient,
  sourceId: string
): Promise<ExistingCandidateForDedupe[]> {
  const { data, error } = await db
    .from('discovery_candidate_events')
    .select('id, canonical_name, organiser_name, city, country_code, latitude, longitude, start_date, end_date')
    .eq('source_id', sourceId);
  fail('fetchExistingCandidatesForDedupe', error);
  return (data ?? []).map((row) => ({
    id: row.id as string,
    canonicalName: row.canonical_name as string | null,
    organiserName: row.organiser_name as string | null,
    city: row.city as string | null,
    countryCode: row.country_code as string | null,
    latitude: row.latitude === null ? null : Number(row.latitude),
    longitude: row.longitude === null ? null : Number(row.longitude),
    startDate: row.start_date as string | null,
    endDate: row.end_date as string | null,
  }));
}

export interface SourceRunUpdate {
  ranAt: string;
  succeeded: boolean;
  nextRunAt: string | null;
  healthStatus: 'healthy' | 'degraded' | 'failing' | 'blocked' | 'unknown';
  consecutiveFailureCount: number;
  robotsCheckedAt: string | null;
}

export async function updateSourceAfterRun(db: SupabaseClient, sourceId: string, update: SourceRunUpdate): Promise<void> {
  const patch: Record<string, unknown> = {
    last_run_at: update.ranAt,
    next_run_at: update.nextRunAt,
    health_status: update.healthStatus,
    consecutive_failure_count: update.consecutiveFailureCount,
    updated_at: new Date().toISOString(),
  };
  if (update.succeeded) patch.last_success_at = update.ranAt;
  if (update.robotsCheckedAt) patch.robots_checked_at = update.robotsCheckedAt;

  const { error } = await db.from('discovery_sources').update(patch).eq('id', sourceId);
  fail('updateSourceAfterRun', error);
}
