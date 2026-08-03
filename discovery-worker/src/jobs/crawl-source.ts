import type { PageFetchResult } from '../fetch/http-client.js';
import { extractSameSiteLinks } from '../fetch/links.js';
import { acceptLanguageFor } from '../fetch/decode.js';
import { contentHash } from '../db/rows.js';
import type { PageFetchOutcome, PageFetchRecord, DedupeLinkInput } from '../db/persist.js';
import type { ExistingCandidateForDedupe, SourceRunUpdate } from '../db/sources.js';
import type { SchedulableSource } from '../schedule/scheduler.js';
import { computeNextRunAt, deriveHealthStatus } from '../schedule/scheduler.js';
import { computeDuplicateScore } from '../dedupe/match.js';
import type { CandidateEvent } from '../domain/candidate-event.js';
import { processPage, shouldPersistDiscoveredPage, type ProcessedPage } from './process-page.js';

// Everything crawlSource needs from the outside world, as an injectable
// port set — the crawl decision flow (worklists, budgets, gating, health
// arithmetic) is then fully testable with in-memory fakes, no network and
// no Supabase shape to mock.
export interface CrawlPorts {
  fetchPage(url: string, acceptLanguage: string): Promise<PageFetchResult>;
  startRun(runType: 'scheduled' | 'manual'): Promise<string | null>;
  finishRun(
    runId: string | null,
    counters: {
      pagesRequested: number;
      pagesFetched: number;
      pagesChanged: number;
      candidatesFound: number;
      status: 'succeeded' | 'failed' | 'partial';
      errorMessage?: string;
      metrics?: Record<string, unknown>;
    }
  ): Promise<void>;
  recordPageFetch(record: PageFetchRecord): Promise<PageFetchOutcome | null>;
  fetchKnownEventUrls(): Promise<string[]>;
  persistCandidate(processed: ProcessedPage, sourcePageId: string | null): Promise<{ candidateId: string } | null>;
  fetchExistingCandidatesForDedupe(): Promise<ExistingCandidateForDedupe[]>;
  persistDedupeLinks(candidateId: string, links: DedupeLinkInput[]): Promise<number>;
  updateSourceAfterRun(update: SourceRunUpdate): Promise<void>;
  log(message: string): void;
}

export interface CrawlOptions {
  maxPagesPerRun: number;
  runType: 'scheduled' | 'manual';
}

export interface CrawlSummary {
  sourceId: string;
  sourceName: string;
  pagesRequested: number;
  pagesFetched: number;
  pagesChanged: number;
  pagesSkippedByGate: number;
  fetchFailures: number;
  candidatesPersisted: number;
  dedupeLinksWritten: number;
  robotsBlockedEverything: boolean;
  errorMessage: string | null;
}

function urlKey(url: string): string {
  try {
    const u = new URL(url);
    return `${u.host}${u.pathname.replace(/\/+$/, '')}${u.search}`;
  } catch {
    return url;
  }
}

// The minimal CandidateEvent-shaped view of a database row, for scoring
// against a freshly-extracted candidate. Only the fields
// computeDuplicateScore reads are populated; distances are empty (their
// signal is small and would need a join).
function pseudoCandidate(row: ExistingCandidateForDedupe): CandidateEvent {
  return {
    canonicalName: row.canonicalName,
    organiserName: row.organiserName,
    city: row.city,
    countryCode: row.countryCode,
    latitude: row.latitude,
    longitude: row.longitude,
    startDate: row.startDate,
    endDate: row.endDate,
    distances: [],
  } as unknown as CandidateEvent;
}

// Crawls one enabled source, in one of two modes:
//
//   * LISTING mode (parser_type != 'manual'): fetch base_url, discover
//     same-site links, then fetch known event URLs first (verification)
//     and newly discovered ones after, within the page budget.
//   * VERIFICATION mode (parser_type = 'manual', e.g. the researched
//     umbrella sources whose base_url is not a crawlable listing): only
//     re-fetch the URLs of pages/candidates this source already has.
//
// Known URLs always persist their re-extraction (change monitoring);
// discovered pages must pass the minimum-extraction gate first.
export async function crawlSource(source: SchedulableSource, ports: CrawlPorts, options: CrawlOptions): Promise<CrawlSummary> {
  const acceptLanguage = acceptLanguageFor(source.language_codes);
  const runId = await ports.startRun(options.runType);
  const startedAt = new Date().toISOString();

  const summary: CrawlSummary = {
    sourceId: source.id,
    sourceName: source.name,
    pagesRequested: 0,
    pagesFetched: 0,
    pagesChanged: 0,
    pagesSkippedByGate: 0,
    fetchFailures: 0,
    candidatesPersisted: 0,
    dedupeLinksWritten: 0,
    robotsBlockedEverything: false,
    errorMessage: null,
  };
  let robotsSeen = 0;
  let robotsBlocked = 0;
  let robotsCheckedAt: string | null = null;

  try {
    const knownUrls = await ports.fetchKnownEventUrls();
    const knownKeys = new Set(knownUrls.map(urlKey));

    let listingMode = source.parser_type !== 'manual';
    if (listingMode) {
      try {
        const host = new URL(source.base_url).host;
        if (host === 'example-organiser.invalid' || host.endsWith('swimloading.com')) listingMode = false;
      } catch {
        listingMode = false;
      }
    }

    const discovered: string[] = [];
    if (listingMode) {
      summary.pagesRequested++;
      const listing = await ports.fetchPage(source.base_url, acceptLanguage);
      if (listing.robots) {
        robotsSeen++;
        robotsCheckedAt = new Date().toISOString();
        if (listing.errorCode === 'robots_disallowed' || listing.errorCode === 'robots_unreachable') robotsBlocked++;
      }
      if (listing.ok && listing.html !== null) {
        summary.pagesFetched++;
        const outcome = await ports.recordPageFetch({
          url: source.base_url,
          canonicalUrl: listing.finalUrl ?? source.base_url,
          pageType: 'listing',
          ok: true,
          httpStatus: listing.status,
          contentHash: contentHash(listing.html),
          etag: listing.etag,
          lastModified: listing.lastModified,
          errorMessage: null,
        });
        if (outcome?.changed) summary.pagesChanged++;
        const { links, warnings } = extractSameSiteLinks(listing.html, listing.finalUrl ?? source.base_url);
        for (const w of warnings) ports.log(`  listing: ${w}`);
        for (const link of links) {
          if (!knownKeys.has(urlKey(link))) discovered.push(link);
        }
        ports.log(`  listing ${source.base_url}: ${links.length} same-site link(s), ${discovered.length} new`);
      } else {
        summary.fetchFailures++;
        await ports.recordPageFetch({
          url: source.base_url,
          canonicalUrl: source.base_url,
          pageType: 'listing',
          ok: false,
          httpStatus: listing.status,
          contentHash: null,
          etag: null,
          lastModified: null,
          errorMessage: listing.errorMessage,
        });
        ports.log(`  listing ${source.base_url}: FAILED (${listing.errorCode}: ${listing.errorMessage})`);
      }
    }

    // Known URLs first — verifying what we already publish beats
    // discovering more. Whatever budget remains goes to new links.
    const budget = Math.max(options.maxPagesPerRun - summary.pagesRequested, 0);
    const worklist = [...knownUrls, ...discovered].slice(0, budget);
    const droppedByBudget = knownUrls.length + discovered.length - worklist.length;
    if (droppedByBudget > 0) {
      ports.log(`  page budget ${options.maxPagesPerRun}: ${droppedByBudget} URL(s) deferred to the next run`);
    }

    const newlyPersisted: { candidateId: string; candidate: CandidateEvent }[] = [];
    for (const url of worklist) {
      const isKnown = knownKeys.has(urlKey(url));
      summary.pagesRequested++;
      const fetched = await ports.fetchPage(url, acceptLanguage);
      if (fetched.robots) {
        robotsSeen++;
        robotsCheckedAt = new Date().toISOString();
        if (fetched.errorCode === 'robots_disallowed' || fetched.errorCode === 'robots_unreachable') robotsBlocked++;
      }

      if (!fetched.ok || fetched.html === null) {
        summary.fetchFailures++;
        await ports.recordPageFetch({
          url,
          canonicalUrl: url,
          pageType: isKnown ? 'event_detail' : 'unknown',
          ok: false,
          httpStatus: fetched.status,
          contentHash: null,
          etag: null,
          lastModified: null,
          errorMessage: fetched.errorMessage,
        });
        ports.log(`  ${url}: FAILED (${fetched.errorCode}: ${fetched.errorMessage})`);
        continue;
      }

      summary.pagesFetched++;
      const processed = processPage(source.id, url, fetched.html);
      const gate = isKnown ? { persist: true, reason: 'known event URL' } : shouldPersistDiscoveredPage(processed);

      const outcome = await ports.recordPageFetch({
        url,
        canonicalUrl: fetched.finalUrl ?? url,
        pageType: gate.persist ? 'event_detail' : 'unknown',
        ok: true,
        httpStatus: fetched.status,
        contentHash: contentHash(fetched.html),
        etag: fetched.etag,
        lastModified: fetched.lastModified,
        errorMessage: null,
      });
      if (outcome?.changed) summary.pagesChanged++;

      if (!gate.persist) {
        summary.pagesSkippedByGate++;
        ports.log(`  ${url}: skipped (${gate.reason})`);
        continue;
      }

      const persisted = await ports.persistCandidate(processed, outcome?.pageId ?? null);
      if (persisted) {
        summary.candidatesPersisted++;
        newlyPersisted.push({ candidateId: persisted.candidateId, candidate: processed.candidate });
        ports.log(
          `  ${url}: candidate "${processed.candidate.canonicalName ?? '(unnamed)'}" ` +
            `(confidence ${processed.confidence.totalScore}, ${processed.confidence.recommendation}` +
            `${processed.pageLanguage && processed.pageLanguage !== 'en' ? `, lang=${processed.pageLanguage}` : ''})`
        );
      }
    }

    // Cross-run duplicate detection: score each newly persisted candidate
    // against everything the source now has (fetched after the writes, so
    // new-vs-new and new-vs-old are both covered), excluding itself.
    if (newlyPersisted.length > 0) {
      const existing = await ports.fetchExistingCandidatesForDedupe();
      for (const entry of newlyPersisted) {
        const links: DedupeLinkInput[] = [];
        for (const row of existing) {
          if (row.id === entry.candidateId) continue;
          const match = computeDuplicateScore(entry.candidate, pseudoCandidate(row));
          if (match.possibleDuplicate) {
            links.push({
              matchingCandidateId: row.id,
              similarityScore: match.score,
              possibleDuplicate: true,
              matchingSignals: match.matchingSignals,
              conflictingSignals: match.conflictingSignals,
            });
          }
        }
        summary.dedupeLinksWritten += await ports.persistDedupeLinks(entry.candidateId, links);
      }
      if (summary.dedupeLinksWritten > 0) {
        ports.log(`  ${summary.dedupeLinksWritten} unresolved duplicate link(s) written — these block approval until reviewed`);
      }
    }

    summary.robotsBlockedEverything = robotsSeen > 0 && robotsBlocked === robotsSeen && summary.pagesFetched === 0;

    const status = summary.fetchFailures === 0 ? 'succeeded' : summary.pagesFetched > 0 ? 'partial' : 'failed';
    await ports.finishRun(runId, {
      pagesRequested: summary.pagesRequested,
      pagesFetched: summary.pagesFetched,
      pagesChanged: summary.pagesChanged,
      candidatesFound: summary.candidatesPersisted,
      status,
      metrics: {
        pagesSkippedByGate: summary.pagesSkippedByGate,
        fetchFailures: summary.fetchFailures,
        dedupeLinksWritten: summary.dedupeLinksWritten,
      },
    });

    const runSucceeded = summary.pagesFetched > 0 || summary.pagesRequested === 0;
    const newFailureCount = runSucceeded ? 0 : source.consecutive_failure_count + 1;
    await ports.updateSourceAfterRun({
      ranAt: startedAt,
      succeeded: runSucceeded,
      nextRunAt: computeNextRunAt(source.crawl_frequency, newFailureCount, new Date()),
      healthStatus: deriveHealthStatus({
        robotsBlockedEverything: summary.robotsBlockedEverything,
        pagesAttempted: summary.pagesRequested,
        pagesSucceeded: summary.pagesFetched,
        consecutiveFailureCount: newFailureCount,
      }),
      consecutiveFailureCount: newFailureCount,
      robotsCheckedAt,
    });

    return summary;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    summary.errorMessage = message;
    // Record the failure before rethrowing, so a crashed crawl is visible
    // in discovery_runs and the source backs off rather than looking
    // like a run that never happened.
    await ports
      .finishRun(runId, {
        pagesRequested: summary.pagesRequested,
        pagesFetched: summary.pagesFetched,
        pagesChanged: summary.pagesChanged,
        candidatesFound: summary.candidatesPersisted,
        status: summary.candidatesPersisted > 0 ? 'partial' : 'failed',
        errorMessage: message,
      })
      .catch(() => {});
    const newFailureCount = source.consecutive_failure_count + 1;
    await ports
      .updateSourceAfterRun({
        ranAt: startedAt,
        succeeded: false,
        nextRunAt: computeNextRunAt(source.crawl_frequency, newFailureCount, new Date()),
        healthStatus: deriveHealthStatus({
          robotsBlockedEverything: summary.robotsBlockedEverything,
          pagesAttempted: Math.max(summary.pagesRequested, 1),
          pagesSucceeded: summary.pagesFetched,
          consecutiveFailureCount: newFailureCount,
        }),
        consecutiveFailureCount: newFailureCount,
        robotsCheckedAt,
      })
      .catch(() => {});
    throw err;
  }
}
