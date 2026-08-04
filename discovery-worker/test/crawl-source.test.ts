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
    fetchXml: async (url) => {
      recorded.fetched.push(url);
      const entry = pages[url];
      if (!entry) return failFetch(url, 'http_error', 404);
      return typeof entry === 'function' ? entry(url) : entry;
    },
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
    source_type: 'club',
    country_code: 'ZA',
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

test('headless rendering rescues a JS-shell page that plain fetch could not read', async () => {
  // The Swimming South Africa / Oceanman shape: server sends a shell, the
  // events arrive by XHR.
  const shell = '<html lang="en"><body><div id="app">Fetching batch 1... (0 events loaded)</div></body></html>';
  const { ports, recorded } = makePorts(
    { 'https://example.com/events': okFetch('https://example.com/events', shell) },
    { knownUrls: ['https://example.com/events'] }
  );
  const rendered: string[] = [];
  ports.renderPage = async (url) => {
    rendered.push(url);
    return { html: eventPage('Rendered Lake Swim', '2027-08-14'), errorMessage: null };
  };

  const source = makeSource({ parser_type: 'manual', base_url: 'https://swimloading.com/research' });
  const summary = await crawlSource(source, ports, { maxPagesPerRun: 10, runType: 'scheduled' });

  assert.deepEqual(rendered, ['https://example.com/events']);
  assert.equal(summary.pagesRendered, 1);
  assert.equal(summary.pagesRescuedByRendering, 1);
  assert.equal(summary.candidatesPersisted, 1);
  assert.equal(recorded.persisted[0]!.candidate.canonicalName, 'Rendered Lake Swim');
  // The reviewer must be able to see this candidate only exists because
  // of rendering.
  assert.equal(recorded.persisted[0]!.candidate.rawSourceValues.renderedWithHeadlessBrowser, true);
});

test('rendering is NOT attempted when plain extraction already worked', async () => {
  const { ports } = makePorts(
    { 'https://example.com/ok': okFetch('https://example.com/ok', eventPage('Readable Swim', '2027-04-04')) },
    { knownUrls: ['https://example.com/ok'] }
  );
  let renderCalls = 0;
  ports.renderPage = async () => {
    renderCalls++;
    return { html: null, errorMessage: null };
  };

  const source = makeSource({ parser_type: 'manual', base_url: 'https://swimloading.com/research' });
  const summary = await crawlSource(source, ports, { maxPagesPerRun: 10, runType: 'scheduled' });

  assert.equal(renderCalls, 0);
  assert.equal(summary.pagesRendered, 0);
  assert.equal(summary.candidatesPersisted, 1);
});

test('the render budget is enforced, and a render failure is not fatal', async () => {
  const shell = '<html lang="en"><body>nothing here</body></html>';
  const pages: Record<string, ReturnType<typeof okFetch>> = {};
  const known: string[] = [];
  for (let i = 0; i < 5; i++) {
    const url = `https://example.com/shell-${i}`;
    known.push(url);
    pages[url] = okFetch(url, shell);
  }
  const { ports } = makePorts(pages, { knownUrls: known });
  let renderCalls = 0;
  ports.renderPage = async () => {
    renderCalls++;
    return { html: null, errorMessage: 'Timeout exceeded' };
  };

  const source = makeSource({ parser_type: 'manual', base_url: 'https://swimloading.com/research' });
  const summary = await crawlSource(source, ports, {
    maxPagesPerRun: 10,
    runType: 'scheduled',
    maxRenderedPagesPerRun: 2,
  });

  assert.equal(renderCalls, 2);
  assert.equal(summary.pagesRendered, 2);
  assert.equal(summary.pagesRescuedByRendering, 0);
  // Every page still fetched and hash-tracked despite the render failures.
  assert.equal(summary.pagesFetched, 5);
  assert.equal(summary.fetchFailures, 0);
});

test('a crawl works unchanged when no renderer is wired at all', async () => {
  const { ports } = makePorts(
    { 'https://example.com/ok': okFetch('https://example.com/ok', eventPage('Plain Swim', '2027-05-05')) },
    { knownUrls: ['https://example.com/ok'] }
  );
  assert.equal(ports.renderPage, undefined);
  const source = makeSource({ parser_type: 'manual', base_url: 'https://swimloading.com/research' });
  const summary = await crawlSource(source, ports, { maxPagesPerRun: 10, runType: 'scheduled' });
  assert.equal(summary.candidatesPersisted, 1);
  assert.equal(summary.pagesRendered, 0);
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

// ─────────────────────────────────────────────────────────────────────────
// The URL-score filter on AI spend, added 2026-08-04.
//
// Japan's source made 18 AI calls for 0 candidates in the first sweep —
// 62% of that run's entire token spend. Its calendar is a <table> the
// deterministic parser already handled, so every call landed on a same-site
// page that was never going to be a race. This gates the paid step by the
// page's own URL, which the sitemap ranker already scores.
// ─────────────────────────────────────────────────────────────────────────

// An empty shell: no JSON-LD, no table, no selectors — so extraction always
// fails and the AI fallback is always reached, which is what we want to
// observe here.
const UNREADABLE_HTML = '<html><body><div id="app"></div></body></html>';

function aiSpyPorts(
  pages: Record<string, PageFetchResult>,
  opts: { knownUrls?: string[] } = {}
): { ports: CrawlPorts; recorded: Recorded; aiUrls: string[] } {
  const { ports, recorded } = makePorts(pages, opts);
  const aiUrls: string[] = [];
  ports.extractWithAi = async (url) => {
    aiUrls.push(url);
    return {
      pages: [],
      rowsReturned: 0,
      rowsUsable: 0,
      usage: { inputTokens: 100, outputTokens: 10, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 },
      model: 'test',
      condensedChars: 5000,
      called: true,
      warnings: [],
    };
  };
  ports.fetchAiExtractedUrls = async () => [];
  return { ports, recorded, aiUrls };
}

test('a page whose own URL says it is not an event never costs an AI call', async () => {
  const { ports, aiUrls } = aiSpyPorts({
    'https://example.com/races': okFetch(
      'https://example.com/races',
      '<html><body><a href="https://example.com/about">About</a>' +
        '<a href="https://example.com/evenements/2026/lac">Une course</a></body></html>'
    ),
    'https://example.com/about': okFetch('https://example.com/about', UNREADABLE_HTML),
    'https://example.com/evenements/2026/lac': okFetch('https://example.com/evenements/2026/lac', UNREADABLE_HTML),
  });

  const summary = await crawlSource(makeSource({}), ports, {
    maxPagesPerRun: 10,
    runType: 'manual',
    maxAiCallsPerRun: 10,
    minAiUrlScore: 2,
  });

  // /about scores 1 (one generic segment); /evenements/2026/lac scores 6
  // (event word +3, year +2, depth +1).
  assert.ok(aiUrls.includes('https://example.com/evenements/2026/lac'), 'the event-like page must be read');
  assert.ok(!aiUrls.includes('https://example.com/about'), '/about must not cost a call');
  assert.equal(summary.aiSkippedByUrlScore, 1);
});

test('the listing page is never filtered out — it is the calendar', async () => {
  // The threshold is set absurdly high on purpose: a source whose calendar
  // lives at a generic URL must still be read, because it is the single
  // highest-value page on the site.
  const { ports, aiUrls } = aiSpyPorts({
    'https://example.com/races': okFetch('https://example.com/races', UNREADABLE_HTML),
  });

  await crawlSource(makeSource({}), ports, {
    maxPagesPerRun: 5,
    runType: 'manual',
    maxAiCallsPerRun: 10,
    minAiUrlScore: 99,
  });

  assert.deepEqual(aiUrls, ['https://example.com/races']);
});

test('a URL already known to hold an event bypasses the filter', async () => {
  // Path shape is not evidence when we already have proof.
  const known = 'https://example.com/x/y';
  const { ports, aiUrls } = aiSpyPorts(
    {
      'https://example.com/races': okFetch('https://example.com/races', '<html><body>no links</body></html>'),
      [known]: okFetch(known, UNREADABLE_HTML),
    },
    { knownUrls: [known] }
  );

  await crawlSource(makeSource({}), ports, {
    maxPagesPerRun: 5,
    runType: 'manual',
    maxAiCallsPerRun: 10,
    minAiUrlScore: 99,
  });

  assert.ok(aiUrls.includes(known));
});

test('the filter withholds spend only — the page is still fetched and extracted for free', async () => {
  const { ports, recorded, aiUrls } = aiSpyPorts({
    'https://example.com/races': okFetch(
      'https://example.com/races',
      '<html><body><a href="https://example.com/about">About</a></body></html>'
    ),
    'https://example.com/about': okFetch('https://example.com/about', UNREADABLE_HTML),
  });

  const summary = await crawlSource(makeSource({}), ports, {
    maxPagesPerRun: 5,
    runType: 'manual',
    maxAiCallsPerRun: 10,
    minAiUrlScore: 2,
  });

  // The listing still gets its call — it is exempt, and it is the page
  // worth paying for. Only the discovered /about page is withheld.
  assert.deepEqual(aiUrls, ['https://example.com/races']);
  assert.equal(summary.aiSkippedByUrlScore, 1);

  // Withheld from the MODEL, not from the pipeline: still fetched, still
  // hashed for change monitoring, still run through deterministic
  // extraction. The filter costs coverage nothing, only spend.
  assert.ok(recorded.fetched.includes('https://example.com/about'));
  assert.ok(recorded.pageRecords.some((r) => r.url === 'https://example.com/about' && r.ok));
});
