import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import type { SupabaseClient } from '@supabase/supabase-js';
import { assertConfigSafe, loadConfig, type DiscoveryConfig } from './config.js';
import { PoliteHttpClient } from './fetch/http-client.js';
import { extractSameSiteLinks } from './fetch/links.js';
import { discoverUrlsFromSitemaps, scoreEventUrl } from './fetch/sitemap.js';
import { PageRenderer } from './fetch/renderer.js';
import { crawlSource, type CrawlPorts, type CrawlSummary } from './jobs/crawl-source.js';
import { processPage, shouldPersistDiscoveredPage } from './jobs/process-page.js';
import { selectDueSources, type SchedulableSource } from './schedule/scheduler.js';
import { createServiceRoleClient } from './db/supabaseClient.js';
import {
  finishRun,
  persistCandidate,
  persistDedupeLinks,
  recordPageFetch,
  startRun,
} from './db/persist.js';
import { completePastEditions, publishEligibleCandidates, retirePastCandidates } from './db/publish.js';
import {
  fetchEnabledSources,
  fetchExistingCandidatesForDedupe,
  fetchKnownEventUrls,
  fetchSeenUrls,
  fetchSourceById,
  updateSourceAfterRun,
} from './db/sources.js';

// The live-crawl entry point (the fixtures entry point is src/index.ts).
//
//   npm run crawl                 one pass over due sources, then exit
//   npm run crawl:loop            long-running scheduler (Railway mode)
//   npm run crawl -- --source ID  crawl one source now, ignoring next_run_at
//   npm run crawl:url -- <url>    ad-hoc single page -> out/, never the DB
//
// Requires DISCOVERY_LIVE_FETCH_ENABLED=true. With DISCOVERY_WRITE_ENABLED
// =false the scheduler modes still fetch (politely) but write extraction
// results to out/ instead of Supabase — a full shakedown mode.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, '..', 'out');

interface CliArgs {
  loop: boolean;
  sourceId: string | null;
  url: string | null;
  probe: string | null;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { loop: false, sourceId: null, url: null, probe: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--loop') args.loop = true;
    else if (arg === '--once') args.loop = false;
    else if (arg === '--source') { args.sourceId = argv[++i] ?? null; }
    else if (arg === '--url') { args.url = argv[++i] ?? null; }
    else if (arg === '--probe') { args.probe = argv[++i] ?? null; }
    else if (arg && !arg.startsWith('--') && !args.url && !args.probe && /^https?:\/\//.test(arg)) args.url = arg;
  }
  return args;
}

// Null when rendering is switched off, so the whole feature — including
// the Playwright import — stays inert unless explicitly enabled.
function buildRenderer(config: DiscoveryConfig): PageRenderer | null {
  if (!config.playwrightEnabled) return null;
  return new PageRenderer({
    userAgent: config.userAgent,
    timeoutMs: config.renderTimeoutMs,
    maxBytes: config.maxResponseBytes,
    settleMs: config.renderSettleMs,
  });
}

function buildHttpClient(config: DiscoveryConfig): PoliteHttpClient {
  return new PoliteHttpClient({
    userAgent: config.userAgent,
    timeoutMs: config.fetchTimeoutMs,
    maxRetries: config.fetchMaxRetries,
    minHostDelayMs: config.minHostDelayMs,
    maxCrawlDelayMs: config.maxCrawlDelayMs,
    maxResponseBytes: config.maxResponseBytes,
  });
}

function slugForUrl(url: string): string {
  return url.replace(/^https?:\/\//, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'page';
}

async function writeCrawlOutput(url: string, payload: unknown): Promise<string> {
  await mkdir(OUT_DIR, { recursive: true });
  const outPath = path.join(OUT_DIR, `crawl-${slugForUrl(url)}.json`);
  await writeFile(outPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  return outPath;
}

function buildPorts(
  source: SchedulableSource,
  http: PoliteHttpClient,
  config: DiscoveryConfig,
  db: SupabaseClient,
  runType: 'scheduled' | 'manual',
  renderer: PageRenderer | null
): CrawlPorts {
  const write = config.writeEnabled;
  return {
    ...(renderer ? { renderPage: (url: string) => renderer.render(url) } : {}),
    fetchPage: (url, acceptLanguage) => http.fetchPage(url, acceptLanguage),
    startRun: write ? () => startRun(db, source.id, runType) : async () => null,
    finishRun: write
      ? (runId, counters) => (runId ? finishRun(db, runId, counters) : Promise.resolve())
      : async () => {},
    recordPageFetch: write ? (record) => recordPageFetch(db, source.id, record) : async () => null,
    fetchKnownEventUrls: () => fetchKnownEventUrls(db, source.id),
    fetchSeenUrls: () => fetchSeenUrls(db, source.id),
    sitemapsFor: (url) => http.sitemapsFor(url),
    fetchXml: (url) => http.fetchXml(url),
    persistCandidate: write
      ? async (processed, sourcePageId) => {
          const result = await persistCandidate(db, processed.candidate, processed.confidence, source.id, sourcePageId);
          return { candidateId: result.candidateId };
        }
      : async (processed) => {
          const outPath = await writeCrawlOutput(processed.url, {
            url: processed.url,
            pageLanguage: processed.pageLanguage,
            candidate: processed.candidate,
            classification: processed.classification,
            confidence: processed.confidence,
            validation: processed.validation,
          });
          console.log(`    dry run -> ${path.relative(process.cwd(), outPath)}`);
          return null;
        },
    fetchExistingCandidatesForDedupe: write ? () => fetchExistingCandidatesForDedupe(db, source.id) : async () => [],
    persistDedupeLinks: write ? (candidateId, links) => persistDedupeLinks(db, candidateId, links) : async () => 0,
    updateSourceAfterRun: write ? (update) => updateSourceAfterRun(db, source.id, update) : async () => {},
    log: (message) => console.log(message),
  };
}

function printSummary(summary: CrawlSummary): void {
  console.log(
    `  done: ${summary.pagesFetched}/${summary.pagesRequested} pages fetched, ` +
      `${summary.pagesChanged} changed, ${summary.candidatesPersisted} candidate(s), ` +
      `${summary.pagesSkippedByGate} skipped by gate, ${summary.fetchFailures} fetch failure(s)` +
      (summary.robotsBlockedEverything ? ' — BLOCKED by robots.txt' : '')
  );
  if (summary.urlsFromLinks || summary.urlsFromSitemap || summary.urlsDeferredByBudget) {
    console.log(
      `  discovery: ${summary.urlsFromLinks} new via links, ${summary.urlsFromSitemap} via sitemap, ` +
        `${summary.urlsDeferredByBudget} deferred to next run`
    );
  }
}

async function runAdhocUrl(url: string, config: DiscoveryConfig): Promise<void> {
  const http = buildHttpClient(config);
  console.log(`Fetching ${url} (ad-hoc, never written to the database)...`);
  const fetched = await http.fetchPage(url, 'en');
  if (!fetched.ok || fetched.html === null) {
    throw new Error(`Fetch failed: ${fetched.errorCode}: ${fetched.errorMessage}`);
  }
  let processed = processPage('adhoc', url, fetched.html);

  // Same fallback the crawler uses, so an ad-hoc check reflects what a
  // real crawl would actually get from this page.
  const renderer = buildRenderer(config);
  if (renderer && !shouldPersistDiscoveredPage(processed).persist) {
    console.log('  plain fetch yielded no event shape — retrying with headless rendering...');
    const rendered = await renderer.render(url);
    if (rendered.html) {
      const reprocessed = processPage('adhoc', url, rendered.html);
      const before = fetched.html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().length;
      const after = rendered.html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().length;
      console.log(`  rendered: visible text ${before} -> ${after} chars`);
      if (shouldPersistDiscoveredPage(reprocessed).persist) {
        console.log('  rendering RESCUED this page');
        processed = reprocessed;
      } else {
        console.log('  still no event shape after rendering');
      }
    } else {
      console.log(`  render failed: ${rendered.errorMessage}`);
    }
    await renderer.close();
  }
  const outPath = await writeCrawlOutput(url, {
    url,
    charset: fetched.charset,
    pageLanguage: processed.pageLanguage,
    candidate: processed.candidate,
    classification: processed.classification,
    confidence: processed.confidence,
    validation: processed.validation,
  });
  console.log(
    `  -> ${path.relative(process.cwd(), outPath)}  (confidence ${processed.confidence.totalScore}, ` +
      `${processed.confidence.recommendation}${processed.pageLanguage ? `, lang=${processed.pageLanguage}` : ''})`
  );
}

// Evaluates a CANDIDATE source without adding it to the database: how
// many pages both discovery channels reach, and how event-like they look.
// The point is to answer "is this worth enabling?" before committing a
// discovery_sources row to a weekly crawl. Writes nothing anywhere.
async function runProbe(baseUrl: string, config: DiscoveryConfig): Promise<void> {
  const http = buildHttpClient(config);
  console.log(`Probing ${baseUrl} as a candidate source (read-only, nothing written)...\n`);

  const declared = await http.sitemapsFor(baseUrl);
  console.log(declared.length > 0
    ? `robots.txt declares ${declared.length} sitemap(s):\n${declared.map((s) => `    ${s}`).join('\n')}`
    : 'robots.txt declares no sitemap — will probe /sitemap.xml');

  const listing = await http.fetchPage(baseUrl, 'en');
  let linkCount = 0;
  if (listing.ok && listing.html !== null) {
    linkCount = extractSameSiteLinks(listing.html, listing.finalUrl ?? baseUrl).links.length;
    const hasJsonLd = /application\/ld\+json/i.test(listing.html);
    const textLen = listing.html.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().length;
    console.log(
      `\nlisting page: HTTP ${listing.status}, ${linkCount} same-site link(s), ` +
        `JSON-LD ${hasJsonLd ? 'PRESENT' : 'absent'}, ${textLen} chars of visible text, charset ${listing.charset}`
    );

    // Rendering comparison: the number that decides whether a source is
    // reachable deterministically or needs the browser every time.
    const renderer = buildRenderer(config);
    if (renderer) {
      const rendered = await renderer.render(baseUrl);
      if (rendered.html) {
        const renderedLinks = extractSameSiteLinks(rendered.html, baseUrl).links.length;
        const renderedText = rendered.html.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().length;
        console.log(
          `rendered:     ${renderedLinks} same-site link(s), ${renderedText} chars of visible text` +
            (renderedLinks > linkCount || renderedText > textLen * 1.5 ? '  <-- rendering REQUIRED for this source' : '')
        );
        linkCount = Math.max(linkCount, renderedLinks);
      } else {
        console.log(`rendered:     FAILED (${rendered.errorMessage})`);
      }
      await renderer.close();
    }
  } else {
    console.log(`\nlisting page: FAILED (${listing.errorCode}: ${listing.errorMessage})`);
  }

  const sitemapUrls = await discoverUrlsFromSitemaps(baseUrl, declared, {
    fetchXml: async (url) => {
      const res = await http.fetchXml(url);
      if (!res.ok) console.log(`  sitemap ${url}: unavailable (${res.errorCode}: ${res.errorMessage})`);
      return res.ok ? res.html : null;
    },
    maxSitemapsToFollow: config.maxSitemapsToFollow,
    maxUrls: config.maxSitemapUrls,
    log: (m) => console.log(m),
  });

  const eventLike = sitemapUrls.filter((u) => scoreEventUrl(u) >= 3);
  console.log(
    `\nsitemap discovery: ${sitemapUrls.length} URL(s) total, ${eventLike.length} scoring as event-like`
  );
  for (const url of eventLike.slice(0, 15)) console.log(`    [${scoreEventUrl(url)}] ${url}`);
  if (eventLike.length > 15) console.log(`    … and ${eventLike.length - 15} more`);

  const reach = Math.max(linkCount, eventLike.length);
  console.log(
    `\nverdict: reachable pages ~${reach}. ` +
      (reach >= 20
        ? 'Strong candidate — worth enabling.'
        : reach >= 5
          ? 'Modest candidate — enable if the events are ones we want.'
          : 'Weak via deterministic crawling — likely needs the Playwright or AI phase.')
  );
}

async function runPass(config: DiscoveryConfig, db: SupabaseClient, onlySourceId: string | null): Promise<void> {
  const http = buildHttpClient(config);
  const renderer = buildRenderer(config);

  let sources: SchedulableSource[];
  let runType: 'scheduled' | 'manual';
  if (onlySourceId) {
    const source = await fetchSourceById(db, onlySourceId);
    if (!source) throw new Error(`No discovery_sources row with id ${onlySourceId}`);
    if (!source.enabled) throw new Error(`Source "${source.name}" is disabled — enable it before crawling.`);
    sources = [source];
    runType = 'manual';
  } else {
    sources = selectDueSources(await fetchEnabledSources(db), new Date()).slice(0, config.maxSourcesPerPass);
    runType = 'scheduled';
  }

  if (sources.length === 0) {
    console.log('No sources due. Nothing to do.');
    return;
  }
  console.log(`${sources.length} source(s) due${config.writeEnabled ? '' : ' — DRY RUN, writing to out/ only'}:`);

  try {
    for (const source of sources) {
      console.log(`\nCrawling "${source.name}" (${source.parser_type === 'manual' ? 'verification-only' : 'listing + verification'})...`);
      try {
        const summary = await crawlSource(source, buildPorts(source, http, config, db, runType, renderer), {
          maxPagesPerRun: config.maxPagesPerRun,
          runType,
          maxSitemapsToFollow: config.maxSitemapsToFollow,
          maxSitemapUrls: config.maxSitemapUrls,
          maxRenderedPagesPerRun: config.maxRenderedPagesPerRun,
        });
        printSummary(summary);
      } catch (err) {
        // One broken source must not stop the pass — its failure is already
        // recorded in discovery_runs and its health/backoff updated.
        console.error(`  crawl failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  } finally {
    // Always release the browser: a leaked Chromium would survive the
    // pass and, in loop mode, accumulate one per pass until the container
    // is killed for memory.
    if (renderer) await renderer.close();
  }

  // Publish whatever became eligible. Eligibility is decided in SQL (see
  // auto_publish_eligible_candidates) so a worker bug cannot widen what
  // reaches the public site; this only invokes it. Never fatal — a crawl
  // that found events is still a success if publishing hiccups.
  if (config.writeEnabled) {
    // Clear dead candidates out of the review queue first, so what a
    // human sees is only what still needs a decision.
    try {
      const retired = await retirePastCandidates(db);
      if (retired > 0) console.log(`\nRetired ${retired} past-dated candidate(s) from the review queue.`);
      const completed = await completePastEditions(db);
      if (completed > 0) console.log(`Marked ${completed} past edition(s) completed — the catalogue only shows upcoming swims.`);
    } catch (err) {
      console.error(`Queue cleanup failed: ${err instanceof Error ? err.message : String(err)}`);
    }

    try {
      const published = await publishEligibleCandidates(db);
      if (published.length > 0) {
        console.log(`\nPublished ${published.length} event(s) to the public catalogue:`);
        for (const p of published.slice(0, 10)) console.log(`  ${p.event_name}`);
        if (published.length > 10) console.log(`  … and ${published.length - 10} more`);
      } else {
        console.log('\nNothing newly eligible to publish.');
      }
    } catch (err) {
      console.error(`Publish sweep failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

async function main(): Promise<void> {
  const config = loadConfig();
  assertConfigSafe(config);
  if (!config.liveFetchEnabled) {
    throw new Error(
      'DISCOVERY_LIVE_FETCH_ENABLED is not true — the crawler refuses to make network requests without the flag. ' +
        'Set it in discovery-worker/.env (or the Railway environment) once the source rows are enabled.'
    );
  }

  const args = parseArgs(process.argv.slice(2));

  if (args.url) {
    await runAdhocUrl(args.url, config);
    return;
  }

  if (args.probe) {
    await runProbe(args.probe, config);
    return;
  }

  // Scheduler modes read discovery_sources, which needs credentials even
  // in dry-run mode (reads only, in that case).
  const db = createServiceRoleClient();

  if (!args.loop) {
    await runPass(config, db, args.sourceId);
    return;
  }

  let stopping = false;
  const stop = (signal: string) => {
    console.log(`\n${signal} received — finishing the current pass, then exiting.`);
    stopping = true;
  };
  process.on('SIGTERM', () => stop('SIGTERM'));
  process.on('SIGINT', () => stop('SIGINT'));

  console.log(`Scheduler loop: one pass every ${config.schedulerIntervalSeconds}s. Ctrl-C / SIGTERM to stop.`);
  while (!stopping) {
    try {
      await runPass(config, db, null);
    } catch (err) {
      console.error(`Pass failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (stopping) break;
    await new Promise((resolve) => setTimeout(resolve, config.schedulerIntervalSeconds * 1000));
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
