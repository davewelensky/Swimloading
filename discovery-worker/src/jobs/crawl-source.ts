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
import { processTablePage } from './process-table-page.js';
import type { AiPageResult } from './process-ai-page.js';

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
  // Fetches an XML document, transparently handling gzipped sitemaps.
  fetchXml(url: string): Promise<PageFetchResult>;
  // Renders a page in a headless browser, returning the post-JavaScript
  // HTML. Null when rendering is disabled or unavailable — the crawl then
  // proceeds exactly as it did before rendering existed.
  renderPage?(url: string): Promise<{ html: string | null; errorMessage: string | null }>;
  // Reads an unstructured page with a language model, as the last resort
  // after JSON-LD, tables, selectors and rendering have all found nothing.
  // Absent when AI extraction is disabled, which is the default — the
  // crawl then behaves exactly as it did before this existed.
  extractWithAi?(url: string, html: string): Promise<AiPageResult>;
  // URLs this source has already had read by the model. Without this a
  // page deferred by the per-run AI cap would be recorded as fetched,
  // count as unchanged on the next run, and never be read at all.
  fetchAiExtractedUrls?(): Promise<string[]>;
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
  // Per-run cap on headless renders. Rendering is the expensive fallback,
  // so a source full of unreadable pages spends a bounded amount of time
  // and memory on them rather than stalling the whole pass.
  maxRenderedPagesPerRun?: number;
  // Cap on rows taken from one tabular calendar per run. Ray's Notebook
  // alone is 338 rows; the rest carry over to the next run.
  maxTableRowsPerPage?: number;
  // Hard per-run ceiling on AI calls. This is the only part of the
  // pipeline that costs money per page, so the budget is enforced here
  // rather than trusted to the caller. Zero disables AI for the run.
  maxAiCallsPerRun?: number;
  // Minimum scoreEventUrl() a DISCOVERED page must reach before an AI call
  // is spent on it. Listing pages and known event URLs bypass it — see
  // runAiFallback. Undefined means no filter.
  minAiUrlScore?: number;
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
  // Rendering telemetry: how often the fallback was needed, and how often
  // it actually rescued a page. A source with high attempts and low
  // rescues is one to reconsider rather than keep paying for.
  pagesRendered: number;
  pagesRescuedByRendering: number;
  // Candidates produced from tabular calendars, which the
  // single-candidate path cannot reach at all.
  tableRowsExtracted: number;
  // AI telemetry. Token counts are the ACTUAL usage reported by the API,
  // not an estimate — multiply by the model's per-token price for the
  // run's spend. Kept per-run so a source that quietly starts costing
  // more is visible before the invoice is.
  aiCallsMade: number;
  aiPagesRescued: number;
  aiCandidates: number;
  aiInputTokens: number;
  aiOutputTokens: number;
  // Pages the URL-score filter kept away from the model. Counted, not
  // silent: a threshold set too high looks exactly like "AI found nothing"
  // unless the skips are visible.
  aiSkippedByUrlScore: number;
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
    pagesRendered: 0,
    pagesRescuedByRendering: 0,
    tableRowsExtracted: 0,
    aiCallsMade: 0,
    aiPagesRescued: 0,
    aiCandidates: 0,
    aiInputTokens: 0,
    aiOutputTokens: 0,
    aiSkippedByUrlScore: 0,
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

    // Declared before the listing fetch: the listing page can itself be a
    // tabular calendar that produces candidates, and dedupe needs them all.
    const newlyPersisted: { candidateId: string; candidate: CandidateEvent }[] = [];

    // AI-extraction budget and history. The budget is a hard per-run
    // ceiling because this is the only step that costs money per page;
    // the history stops an unchanged page being re-read (and re-billed)
    // every week for an answer we already have.
    const aiBudget = options.maxAiCallsPerRun ?? 0;
    const aiExtractedKeys = new Set(
      ports.fetchAiExtractedUrls ? (await ports.fetchAiExtractedUrls()).map(urlKey) : []
    );

    // Last resort for a page nothing deterministic could read. Returns the
    // number of candidates written, so the caller can tell a rescue from a
    // genuine "there is nothing on this page".
    async function runAiFallback(
      url: string,
      html: string,
      sourcePageId: string | null,
      changed: boolean,
      // True for the listing page and for URLs this source already has a
      // candidate for. Both are exempt from the URL-score filter: the
      // listing IS the calendar and is the single highest-value page on
      // any source, and a known URL has already proved it holds an event
      // whatever its path happens to look like.
      alwaysWorthReading = false
    ): Promise<number> {
      if (!ports.extractWithAi || summary.aiCallsMade >= aiBudget) return 0;
      if (!changed && aiExtractedKeys.has(urlKey(url))) return 0;

      // Don't pay a model to read a page whose own URL says it is not an
      // event. Japan's source made 18 calls for 0 candidates on 2026-08-04
      // — 62% of that sweep's entire token spend — because its calendar is
      // a table the deterministic parser already handled, so every AI call
      // went on a same-site page that was never going to be a race.
      //
      // This gates SPEND ONLY. A page below the bar has already been
      // fetched and extracted deterministically for free; all that is
      // withheld is the paid second opinion.
      const minScore = options.minAiUrlScore;
      if (!alwaysWorthReading && minScore !== undefined) {
        const score = scoreEventUrl(url);
        if (score < minScore) {
          summary.aiSkippedByUrlScore++;
          return 0;
        }
      }

      const result = await ports.extractWithAi(url, html);
      for (const w of result.warnings) ports.log(`  ${url}: ${w}`);
      // A page too thin to be worth reading never reaches the API, so it
      // must not count against the budget or the token totals.
      if (!result.called) return 0;

      summary.aiCallsMade++;
      summary.aiInputTokens += result.usage?.inputTokens ?? 0;
      summary.aiOutputTokens += result.usage?.outputTokens ?? 0;
      aiExtractedKeys.add(urlKey(url));

      let written = 0;
      for (const entry of result.pages) {
        const persisted = await ports.persistCandidate(entry, sourcePageId);
        if (persisted) {
          written++;
          newlyPersisted.push({ candidateId: persisted.candidateId, candidate: entry.candidate });
        }
      }
      summary.aiCandidates += written;
      summary.candidatesPersisted += written;
      if (written > 0) summary.aiPagesRescued++;

      ports.log(
        `  ${url}: AI read ${result.rowsReturned} event(s), ${result.rowsUsable} usable, ${written} written ` +
          `(${result.usage?.inputTokens ?? 0} in / ${result.usage?.outputTokens ?? 0} out tokens, ${result.model ?? 'unknown model'})`
      );
      return written;
    }

    let listingMode = source.parser_type !== 'manual';
    if (listingMode) {
      try {
        const host = new URL(source.base_url).host;
        if (host === 'example-organiser.invalid' || host.endsWith('swimloading.com')) listingMode = false;
      } catch {
        listingMode = false;
      }
    }

    // A source's scope. Link discovery has no idea what a source is FOR:
    // any same-site link and any sitemap URL is a candidate page. That is
    // right for a single-sport organiser and wrong for a multi-sport
    // calendar, where the nav bar leads to running, cycling and skiing
    // listings. Lopplistan is configured to its swim page and still
    // published two running races, because the crawler walked to
    // /sverige/alla/ and the homepage on its own.
    //
    // An unusable pattern stops discovery rather than falling back to
    // "allow everything": falling back would silently restore the exact
    // behaviour the pattern was added to prevent, and a smaller crawl is
    // recoverable in a way a wrong published event is not.
    let inScope: (url: string) => boolean = () => true;
    if (source.expand_url_pattern) {
      try {
        const re = new RegExp(source.expand_url_pattern);
        inScope = (url) => re.test(url);
      } catch (err) {
        ports.log(
          `  scope pattern is not valid regex (${err instanceof Error ? err.message : String(err)}) — ` +
            `discovery disabled for this run; only ${source.base_url} will be crawled`
        );
        inScope = () => false;
      }
    }
    let outOfScope = 0;

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
        // The listing page may itself BE the calendar. Ray's Notebook is
        // exactly this: base_url is one table holding the whole season,
        // and treating it only as a set of links to follow finds nothing,
        // because the events never have their own pages.
        const listingTable = processTablePage(
          source.id,
          listing.finalUrl ?? source.base_url,
          listing.html,
          { sourceType: source.source_type, countryCode: source.country_code },
          options.maxTableRowsPerPage ?? 400
        );
        if (listingTable.pages.length >= 2) {
          for (const w of listingTable.warnings) ports.log(`  listing: ${w}`);
          let written = 0;
          for (const entry of listingTable.pages) {
            const persisted = await ports.persistCandidate(entry, outcome?.pageId ?? null);
            if (persisted) {
              written++;
              newlyPersisted.push({ candidateId: persisted.candidateId, candidate: entry.candidate });
            }
          }
          summary.candidatesPersisted += written;
          summary.tableRowsExtracted += listingTable.rowsUsable;
          ports.log(
            `  listing is a tabular calendar — ${listingTable.rowsFound} row(s), ${written} candidate(s) written`
          );
        } else {
          // The highest-value AI target on the whole site. A federation
          // calendar is usually ONE page listing the season as <div>s —
          // no JSON-LD, no <table>, and often no per-event pages to crawl
          // afterwards. If this page is unreadable, the source yields
          // nothing at all, which is exactly what 32 of the 36 sources
          // seeded on 2026-08-04 did.
          await runAiFallback(
            listing.finalUrl ?? source.base_url,
            listing.html,
            outcome?.pageId ?? null,
            outcome?.changed ?? true,
            true // the listing is the calendar — never filtered out
          );
        }

        const { links, warnings } = extractSameSiteLinks(listing.html, listing.finalUrl ?? source.base_url);
        for (const w of warnings) ports.log(`  listing: ${w}`);
        for (const link of links) {
          const key = urlKey(link);
          if (!knownKeys.has(key) && !seenKeys.has(key)) {
            if (!inScope(link)) { outOfScope++; continue; }
            discovered.push(link);
            seenKeys.add(key);
          }
        }
        summary.urlsFromLinks = discovered.length;
        ports.log(
          `  listing ${source.base_url}: ${links.length} same-site link(s), ${discovered.length} new` +
            (outOfScope > 0 ? `, ${outOfScope} out of scope` : '')
        );
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
            const res = await ports.fetchXml(url);
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
            if (!inScope(url)) { outOfScope++; continue; }
            discovered.push(url);
            seenKeys.add(key);
            summary.urlsFromSitemap++;
          }
        }
        if (outOfScope > 0) ports.log(`  ${outOfScope} discovered URL(s) outside this source's scope`);
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
      const sourceContext = { sourceType: source.source_type, countryCode: source.country_code };

      // Tabular calendars first. A season table is many events on one
      // page, which the single-candidate path cannot see at all — Ray's
      // Notebook is 338 swims in one table, with coordinates and start
      // times per row. Only treated as a table when it yields at least
      // two rows, so a one-row layout table never hijacks a normal
      // organiser page.
      const table = processTablePage(source.id, url, fetched.html, sourceContext, options.maxTableRowsPerPage ?? 400);
      if (table.pages.length >= 2) {
        for (const w of table.warnings) ports.log(`  ${url}: ${w}`);
        const outcome = await ports.recordPageFetch({
          url,
          canonicalUrl: fetched.finalUrl ?? url,
          pageType: 'calendar',
          ok: true,
          httpStatus: fetched.status,
          contentHash: contentHash(fetched.html),
          etag: fetched.etag,
          lastModified: fetched.lastModified,
          errorMessage: null,
        });
        if (outcome?.changed) summary.pagesChanged++;

        let written = 0;
        for (const entry of table.pages) {
          const persisted = await ports.persistCandidate(entry, outcome?.pageId ?? null);
          if (persisted) {
            written++;
            newlyPersisted.push({ candidateId: persisted.candidateId, candidate: entry.candidate });
          }
        }
        summary.candidatesPersisted += written;
        summary.tableRowsExtracted += table.rowsUsable;
        ports.log(
          `  ${url}: tabular calendar — ${table.rowsFound} row(s), ${table.rowsUsable} candidate(s)` +
            (written === table.pages.length ? '' : `, ${written} written`)
        );
        continue;
      }

      let processed = processPage(source.id, url, fetched.html, sourceContext);

      // Headless-render fallback. Only for pages whose fetched HTML
      // yielded nothing extractable — the modern SPA case, where the
      // server sends a shell and the events arrive by XHR (Swimming
      // South Africa literally serves "Fetching batch 1... (0 events
      // loaded)"). Never used when plain extraction already worked, so
      // the common path stays fast and cheap.
      const renderBudget = options.maxRenderedPagesPerRun ?? 10;
      if (
        ports.renderPage &&
        summary.pagesRendered < renderBudget &&
        !shouldPersistDiscoveredPage(processed).persist
      ) {
        summary.pagesRendered++;
        const rendered = await ports.renderPage(url);
        if (rendered.html) {
          const reprocessed = processPage(source.id, url, rendered.html, sourceContext);
          if (shouldPersistDiscoveredPage(reprocessed).persist) {
            // Record HOW the content was obtained, so a reviewer can see
            // that this candidate only exists because of rendering, and
            // so a later regression is attributable.
            reprocessed.candidate.rawSourceValues = {
              ...reprocessed.candidate.rawSourceValues,
              renderedWithHeadlessBrowser: true,
            };
            processed = reprocessed;
            summary.pagesRescuedByRendering++;
            ports.log(`  ${url}: rescued by headless rendering`);
          }
        } else if (rendered.errorMessage) {
          ports.log(`  ${url}: render failed (${rendered.errorMessage})`);
        }
      }
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
        // Everything deterministic has now been tried on this page, plus
        // rendering. This is the point where a model earns its cost — and
        // the only point, so a page the pipeline could already read never
        // generates a call. The page_type recorded above stays 'unknown'
        // for a rescued discovered page, which is harmless: writing a
        // candidate makes the URL known via fetchKnownEventUrls, so it is
        // re-verified on later runs regardless.
        const aiWritten = await runAiFallback(url, fetched.html, outcome?.pageId ?? null, outcome?.changed ?? true, isKnown);
        if (aiWritten > 0) continue;

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
        pagesRendered: summary.pagesRendered,
        pagesRescuedByRendering: summary.pagesRescuedByRendering,
        tableRowsExtracted: summary.tableRowsExtracted,
        aiCallsMade: summary.aiCallsMade,
        aiPagesRescued: summary.aiPagesRescued,
        aiCandidates: summary.aiCandidates,
        aiInputTokens: summary.aiInputTokens,
        aiOutputTokens: summary.aiOutputTokens,
        aiSkippedByUrlScore: summary.aiSkippedByUrlScore,
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
        // Metrics on the FAILURE path too. Without this a crash silently
        // discards every counter the run accumulated — including the AI
        // token usage, which is the only record of what the run actually
        // cost. A run that spends money and then dies is precisely the one
        // whose spend you need to see.
        metrics: {
          pagesSkippedByGate: summary.pagesSkippedByGate,
          fetchFailures: summary.fetchFailures,
          dedupeLinksWritten: summary.dedupeLinksWritten,
          urlsFromLinks: summary.urlsFromLinks,
          urlsFromSitemap: summary.urlsFromSitemap,
          urlsDeferredByBudget: summary.urlsDeferredByBudget,
          sitemapRequests: summary.sitemapRequests,
          sitemapFetched: summary.sitemapFetched,
          pagesRendered: summary.pagesRendered,
          pagesRescuedByRendering: summary.pagesRescuedByRendering,
          tableRowsExtracted: summary.tableRowsExtracted,
          aiCallsMade: summary.aiCallsMade,
          aiPagesRescued: summary.aiPagesRescued,
          aiCandidates: summary.aiCandidates,
          aiInputTokens: summary.aiInputTokens,
          aiOutputTokens: summary.aiOutputTokens,
          aiSkippedByUrlScore: summary.aiSkippedByUrlScore,
        },
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
