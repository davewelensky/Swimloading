import type { PageFetchResult } from '../fetch/http-client.js';
import { extractSameSiteLinks } from '../fetch/links.js';
import { discoverUrlsFromSitemaps, scoreEventUrl } from '../fetch/sitemap.js';
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
  // Every URL ever fetched for this source, so discovery skips pages
  // already known to be dead ends instead of re-fetching them forever.
  fetchSeenUrls(): Promise<string[]>;
  // Sitemap URLs declared in the origin's robots.txt.
  sitemapsFor(url: string): Promise<string[]>;
  persistCandidate(processed: ProcessedPage, sourcePageId: string | null): Promise<{ candidateId: string } | null>;
  fetchExistingCandidatesForDedupe(): Promise<ExistingCandidateForDedupe[]>;
  persistDedupeLinks(candidateId: string, links: DedupeLinkInput[]): Promise<number>;
  updateSourceAfterRun(update: SourceRunUpdate): Promise<void>;
  log(message: string): void;
}

export interface CrawlOptions {
  maxPagesPerRun: number;
  runType: 'scheduled' | 'manual';
  // Sitemap discovery budget. Sitemaps are cheap relative to what they
  // unlock (a JS-rendered calendar still enumerates every race URL), but
  // a large site's sitemap index must not become an unbounded crawl.
  maxSitemapsToFollow?: number;
  maxSitemapUrls?: number;
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
  // Discovery telemetry — how many NEW URLs each channel surfaced, and
  // how many were deferred by the page budget. Without this, a source
  // that found 400 races looks identical to one that found none.
  urlsFromLinks: number;
  urlsFromSitemap: number;
  urlsDeferredByBudget: number;
  // Sitemap probes are counted separately from content pages and never
  // feed source health: most sites have no sitemap, and a speculative
  // probe returning 404 says nothing about whether the source is working.
  sitemapRequests: number;
  sitemapFetched: number;
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
    urlsFromLinks: 0,
    urlsFromSitemap: 0,
    urlsDeferredByBudget: 0,
    sitemapRequests: 0,
    sitemapFetched: 0,
  };
  let robotsSeen = 0;
  let robotsBlocked = 0;
  let robotsCheckedAt: string | null = null;

  try {
    const knownUrls = await ports.fetchKnownEventUrls();
    const knownKeys = new Set(knownUrls.map(urlKey));
    // Everything ever fetched, so discovery proposes only genuinely new
    // URLs and a big site advances through its inventory run by run.
    const seenKeys = new Set((await ports.fetchSeenUrls()).map(urlKey));

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
          const key = urlKey(link);
          if (!knownKeys.has(key) && !seenKeys.has(key)) {
            discovered.push(link);
            seenKeys.add(key);
          }
        }
        summary.urlsFromLinks = discovered.length;
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

    // Second discovery channel: the sitemap. This is what reaches events
    // on sites whose calendars are JavaScript-rendered — link extraction
    // sees nothing there, but the sitemap still enumerates every race
    // URL, because that is what search engines consume.
    if (listingMode) {
      try {
        const declared = await ports.sitemapsFor(source.base_url);
        const sitemapUrls = await discoverUrlsFromSitemaps(source.base_url, declared, {
          fetchXml: async (url) => {
            summary.sitemapRequests++;
            const res = await ports.fetchPage(url, acceptLanguage);
            if (res.ok && res.html !== null) {
              summary.sitemapFetched++;
              return res.html;
            }
            // Deliberately NOT counted as a fetch failure: most sites
            // publish no sitemap, and a 404 on a speculative probe is a
            // normal outcome rather than evidence the source is broken.
            ports.log(`  sitemap ${url}: unavailable (${res.errorCode})`);
            return null;
          },
          maxSitemapsToFollow: options.maxSitemapsToFollow ?? 5,
          maxUrls: options.maxSitemapUrls ?? 500,
          log: (m) => ports.log(m),
        });
        for (const url of sitemapUrls) {
          const key = urlKey(url);
          if (!knownKeys.has(key) && !seenKeys.has(key)) {
            discovered.push(url);
            seenKeys.add(key);
            summary.urlsFromSitemap++;
          }
        }
        if (summary.urlsFromSitemap > 0) {
          ports.log(`  sitemap discovery: ${summary.urlsFromSitemap} new URL(s), ranked by event-likeness`);
        }
      } catch (err) {
        // A missing or malformed sitemap is normal, never fatal — link
        // discovery already ran and stands on its own.
        ports.log(`  sitemap discovery skipped: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    // Known URLs first — verifying what we already publish beats
    // discovering more. Whatever budget remains goes to new URLs, most
    // event-like first (see scoreEventUrl), so a 500-URL sitemap spends
    // this run's budget on the pages most likely to be races and carries
    // the rest into subsequent runs.
    const budget = Math.max(options.maxPagesPerRun - summary.pagesRequested, 0);
    const rankedDiscovered = [...discovered].sort((a, b) => scoreEventUrl(b) - scoreEventUrl(a));
    const worklist = [...knownUrls, ...rankedDiscovered].slice(0, budget);
    summary.urlsDeferredByBudget = Math.max(knownUrls.length + rankedDiscovered.length - worklist.length, 0);
    if (summary.urlsDeferredByBudget > 0) {
      ports.log(
        `  page budget ${options.maxPagesPerRun}: ${summary.urlsDeferredByBudget} URL(s) deferred to the next run`
      );
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
      // The extraction gate applies to known URLs too: change monitoring
      // lives at the page-hash level (recordPageFetch, just below), so a
      // known page whose extraction found no event shape — a marketing
      // homepage with no JSON-LD — updates its hash and nothing else.
      // Persisting a dateless name-only candidate would only duplicate an
      // already-reviewed event as review-queue noise. The moment the
      // organiser publishes structured data or a date, the same URL
      // starts producing a real candidate again.
      const gate = shouldPersistDiscoveredPage(processed);
      if (!gate.persist && isKnown) {
        gate.reason = `known URL, ${gate.reason} — page hash tracked, no candidate written`;
      }

      const outcome = await ports.recordPageFetch({
        url,
        canonicalUrl: fetched.finalUrl ?? url,
        // A known URL is a known event page even when this fetch's
        // extraction was thin; only discovered pages can be 'unknown'.
        pageType: gate.persist || isKnown ? 'event_detail' : 'unknown',
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
        urlsFromLinks: summary.urlsFromLinks,
        urlsFromSitemap: summary.urlsFromSitemap,
        urlsDeferredByBudget: summary.urlsDeferredByBudget,
        sitemapRequests: summary.sitemapRequests,
        sitemapFetched: summary.sitemapFetched,
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
