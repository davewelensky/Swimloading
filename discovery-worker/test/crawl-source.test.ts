import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crawlSource, type CrawlPorts } from '../src/jobs/crawl-source.js';
import type { PageFetchResult } from '../src/fetch/http-client.js';
import type { SchedulableSource } from '../src/schedule/scheduler.js';
import type { PageFetchRecord, DedupeLinkInput } from '../src/db/persist.js';
import type { SourceRunUpdate, ExistingCandidateForDedupe } from '../src/db/sources.js';
import type { ProcessedPage } from '../src/jobs/process-page.js';

function okFetch(url: string, html: string): PageFetchResult {
  return {
    ok: true,
    url,
    finalUrl: url,
    status: 200,
    errorCode: null,
    errorMessage: null,
    html,
    charset: 'utf-8',
    etag: null,
    lastModified: null,
    contentType: 'text/html',
    retries: 0,
    robots: { allowed: true, availability: 'ok', crawlDelaySeconds: null, matchedRule: null },
  };
}

function failFetch(url: string, errorCode: PageFetchResult['errorCode'], status: number | null = null): PageFetchResult {
  return {
    ok: false,
    url,
    finalUrl: null,
    status,
    errorCode,
    errorMessage: String(errorCode),
    html: null,
    charset: null,
    etag: null,
    lastModified: null,
    contentType: null,
    retries: 0,
    robots: {
      allowed: errorCode !== 'robots_disallowed',
      availability: errorCode === 'robots_unreachable' ? 'unreachable' : 'ok',
      crawlDelaySeconds: null,
      matchedRule: null,
    },
  };
}

function eventPage(name: string, date: string): string {
  return `<html lang="en"><head><script type="application/ld+json">
    {"@type":"SportsEvent","name":"${name}","startDate":"${date}","location":{"@type":"Place","name":"Lake"}}
  </script></head><body><h1>${name}</h1></body></html>`;
}

const JUNK_PAGE = '<html lang="en"><body><h1>About our club</h1><p>No event here.</p></body></html>';

interface Recorded {
  fetched: string[];
  pageRecords: PageFetchRecord[];
  persisted: ProcessedPage[];
  dedupeCalls: { candidateId: string; links: DedupeLinkInput[] }[];
  finish: unknown[];
  sourceUpdates: SourceRunUpdate[];
}

function makePorts(
  pages: Record<string, PageFetchResult | ((url: string) => PageFetchResult)>,
  options: {
    knownUrls?: string[];
    seenUrls?: string[];
    sitemaps?: string[];
    existingForDedupe?: ExistingCandidateForDedupe[];
  } = {}
): { ports: CrawlPorts; recorded: Recorded } {
  const recorded: Recorded = { fetched: [], pageRecords: [], persisted: [], dedupeCalls: [], finish: [], sourceUpdates: [] };
  let nextId = 0;
  const ports: CrawlPorts = {
    fetchPage: async (url) => {
      recorded.fetched.push(url);
      const entry = pages[url];
      if (!entry) return failFetch(url, 'http_error', 404);
      return typeof entry === 'function' ? entry(url) : entry;
    },
    startRun: async () => 'run-1',
    finishRun: async (_runId, counters) => {
      recorded.finish.push(counters);
    },
    recordPageFetch: async (record) => {
      recorded.pageRecords.push(record);
      return { pageId: `page-${record.canonicalUrl}`, changed: record.ok };
    },
    fetchKnownEventUrls: async () => options.knownUrls ?? [],
    fetchSeenUrls: async () => options.seenUrls ?? [],
    sitemapsFor: async () => options.sitemaps ?? [],
    persistCandidate: async (processed) => {
      recorded.persisted.push(processed);
      return { candidateId: `cand-${nextId++}` };
    },
    fetchExistingCandidatesForDedupe: async () => options.existingForDedupe ?? [],
    persistDedupeLinks: async (candidateId, links) => {
      recorded.dedupeCalls.push({ candidateId, links });
      return links.length;
    },
    updateSourceAfterRun: async (update) => {
      recorded.sourceUpdates.push(update);
    },
    log: () => {},
  };
  return { ports, recorded };
}

function makeSource(overrides: Partial<SchedulableSource>): SchedulableSource {
  return {
    id: 'src-1',
    name: 'Test source',
    base_url: 'https://example.com/races',
    parser_type: 'jsonld_html',
    enabled: true,
    crawl_frequency: 'weekly',
    next_run_at: null,
    language_codes: ['en'],
    consecutive_failure_count: 0,
    ...overrides,
  };
}

test('listing mode: discovers links, verifies known URLs first, gates junk pages', async () => {
  const listingHtml = `<html><body>
    <a href="/races/alpha">Alpha</a>
    <a href="/races/junk">Junk</a>
  </body></html>`;
  const { ports, recorded } = makePorts(
    {
      'https://example.com/races': okFetch('https://example.com/races', listingHtml),
      'https://example.com/races/known': okFetch('https://example.com/races/known', eventPage('Known Swim', '2027-06-12')),
      'https://example.com/races/alpha': okFetch('https://example.com/races/alpha', eventPage('Alpha Swim', '2027-07-01')),
      'https://example.com/races/junk': okFetch('https://example.com/races/junk', JUNK_PAGE),
    },
    { knownUrls: ['https://example.com/races/known'] }
  );

  const summary = await crawlSource(makeSource({}), ports, { maxPagesPerRun: 10, runType: 'scheduled' });

  // Listing first, then the sitemap probe (no robots declaration here, so
  // the conventional path is tried and returns nothing), then the known
  // URL ahead of discovered ones.
  assert.deepEqual(recorded.fetched, [
    'https://example.com/races',
    'https://example.com/sitemap.xml',
    'https://example.com/races/known',
    'https://example.com/races/alpha',
    'https://example.com/races/junk',
  ]);
  assert.equal(summary.pagesFetched, 4);
  assert.equal(summary.candidatesPersisted, 2); // known + alpha; junk gated
  assert.equal(summary.pagesSkippedByGate, 1);
  assert.equal(recorded.persisted.map((p) => p.candidate.canonicalName).join(','), 'Known Swim,Alpha Swim');
  // The listing page is recorded as such, junk page recorded but 'unknown'.
  assert.equal(recorded.pageRecords[0]!.pageType, 'listing');
  assert.equal(recorded.pageRecords.find((r) => r.url.endsWith('/junk'))!.pageType, 'unknown');
  // Health: everything fetched -> healthy, weekly reschedule set.
  const update = recorded.sourceUpdates[0]!;
  assert.equal(update.healthStatus, 'healthy');
  assert.equal(update.succeeded, true);
  assert.equal(update.consecutiveFailureCount, 0);
  assert.notEqual(update.nextRunAt, null);
});

test('verification mode (parser_type manual): no listing fetch, known URLs only', async () => {
  const { ports, recorded } = makePorts(
    {
      'https://midmarmile.example/': okFetch('https://midmarmile.example/', eventPage('Midmar Mile', '2027-02-13')),
    },
    { knownUrls: ['https://midmarmile.example/'] }
  );
  const source = makeSource({ parser_type: 'manual', base_url: 'https://swimloading.com/research' });
  const summary = await crawlSource(source, ports, { maxPagesPerRun: 10, runType: 'scheduled' });

  assert.deepEqual(recorded.fetched, ['https://midmarmile.example/']);
  assert.equal(summary.candidatesPersisted, 1);
});

test('page budget is enforced and deferred URLs are not fetched', async () => {
  const pages: Record<string, PageFetchResult> = {};
  const known: string[] = [];
  for (let i = 0; i < 6; i++) {
    const url = `https://example.com/races/${i}`;
    known.push(url);
    pages[url] = okFetch(url, eventPage(`Race ${i}`, '2027-05-01'));
  }
  const { ports, recorded } = makePorts(pages, { knownUrls: known });
  const source = makeSource({ parser_type: 'manual', base_url: 'https://swimloading.com/research' });
  const summary = await crawlSource(source, ports, { maxPagesPerRun: 3, runType: 'scheduled' });

  assert.equal(recorded.fetched.length, 3);
  assert.equal(summary.pagesRequested, 3);
});

test('a failing page is recorded, run is partial, and the source degrades', async () => {
  const { ports, recorded } = makePorts(
    {
      'https://example.com/races/ok': okFetch('https://example.com/races/ok', eventPage('OK Swim', '2027-03-03')),
      'https://example.com/races/broken': failFetch('https://example.com/races/broken', 'http_error', 500),
    },
    { knownUrls: ['https://example.com/races/ok', 'https://example.com/races/broken'] }
  );
  const source = makeSource({ parser_type: 'manual', base_url: 'https://swimloading.com/research' });
  const summary = await crawlSource(source, ports, { maxPagesPerRun: 10, runType: 'scheduled' });

  assert.equal(summary.fetchFailures, 1);
  const failureRecord = recorded.pageRecords.find((r) => r.url.endsWith('/broken'))!;
  assert.equal(failureRecord.ok, false);
  assert.equal(failureRecord.httpStatus, 500);
  const finish = recorded.finish[0] as { status: string };
  assert.equal(finish.status, 'partial');
  assert.equal(recorded.sourceUpdates[0]!.healthStatus, 'degraded');
});

test('robots blocking everything marks the source blocked', async () => {
  const { ports, recorded } = makePorts(
    {
      'https://example.com/races': failFetch('https://example.com/races', 'robots_disallowed'),
    },
    { knownUrls: [] }
  );
  const summary = await crawlSource(makeSource({}), ports, { maxPagesPerRun: 10, runType: 'scheduled' });
  assert.equal(summary.robotsBlockedEverything, true);
  assert.equal(recorded.sourceUpdates[0]!.healthStatus, 'blocked');
  assert.equal(recorded.sourceUpdates[0]!.consecutiveFailureCount, 1);
});

test('cross-run dedupe writes links against similar existing candidates', async () => {
  const { ports, recorded } = makePorts(
    {
      'https://example.com/races/lake': okFetch('https://example.com/races/lake', eventPage('Big Lake Swim', '2027-06-12')),
    },
    {
      knownUrls: ['https://example.com/races/lake'],
      existingForDedupe: [
        {
          id: 'existing-1',
          canonicalName: 'The Big Lake Swim',
          organiserName: null,
          city: null,
          countryCode: null,
          latitude: null,
          longitude: null,
          startDate: '2027-06-12',
          endDate: null,
        },
        {
          id: 'existing-2',
          canonicalName: 'Completely Different Event',
          organiserName: null,
          city: null,
          countryCode: null,
          latitude: null,
          longitude: null,
          startDate: '2026-01-01',
          endDate: null,
        },
      ],
    }
  );
  const source = makeSource({ parser_type: 'manual', base_url: 'https://swimloading.com/research' });
  const summary = await crawlSource(source, ports, { maxPagesPerRun: 10, runType: 'scheduled' });

  assert.equal(summary.dedupeLinksWritten, 1);
  assert.equal(recorded.dedupeCalls.length, 1);
  assert.equal(recorded.dedupeCalls[0]!.links[0]!.matchingCandidateId, 'existing-1');
});

test('a known URL with no extractable event shape tracks its hash but writes no candidate', async () => {
  const { ports, recorded } = makePorts(
    { 'https://example.com/': okFetch('https://example.com/', JUNK_PAGE) },
    { knownUrls: ['https://example.com/'] }
  );
  const source = makeSource({ parser_type: 'manual', base_url: 'https://swimloading.com/research' });
  const summary = await crawlSource(source, ports, { maxPagesPerRun: 10, runType: 'scheduled' });

  assert.equal(summary.candidatesPersisted, 0);
  assert.equal(summary.pagesSkippedByGate, 1);
  // The page fetch is still recorded (change monitoring), and a known
  // URL keeps its event_detail page type even when extraction was thin.
  assert.equal(recorded.pageRecords.length, 1);
  assert.equal(recorded.pageRecords[0]!.pageType, 'event_detail');
  assert.notEqual(recorded.pageRecords[0]!.contentHash, null);
});

test('non-English pages are annotated with their language and a reviewer warning', async () => {
  const italian = `<html lang="it"><head><script type="application/ld+json">
    {"@type":"SportsEvent","name":"Traversata del Lago","startDate":"2027-07-20"}
  </script></head><body><h1>Traversata del Lago</h1></body></html>`;
  const { ports, recorded } = makePorts(
    { 'https://example.it/gare/lago': okFetch('https://example.it/gare/lago', italian) },
    { knownUrls: ['https://example.it/gare/lago'] }
  );
  const source = makeSource({ parser_type: 'manual', base_url: 'https://swimloading.com/research', language_codes: ['it'] });
  await crawlSource(source, ports, { maxPagesPerRun: 10, runType: 'scheduled' });

  const persisted = recorded.persisted[0]!;
  assert.equal(persisted.pageLanguage, 'it');
  assert.equal(persisted.candidate.rawSourceValues.pageLanguage, 'it');
  assert.equal(persisted.candidate.canonicalName, 'Traversata del Lago');
  assert.equal(
    persisted.candidate.warnings.some((w) => w.includes('Page language is "it"')),
    true
  );
});
