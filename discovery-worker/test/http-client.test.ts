import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PoliteHttpClient, type FetchLike } from '../src/fetch/http-client.js';

// A minimal Response-alike covering exactly what the client reads.
function makeResponse(opts: {
  status?: number;
  body?: string | Uint8Array;
  headers?: Record<string, string>;
  url?: string;
}): Response {
  const status = opts.status ?? 200;
  const bytes = typeof opts.body === 'string' ? new TextEncoder().encode(opts.body) : opts.body ?? new Uint8Array();
  return {
    status,
    ok: status >= 200 && status < 300,
    url: opts.url ?? '',
    headers: new Headers({ 'content-type': 'text/html; charset=utf-8', ...(opts.headers ?? {}) }),
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    text: async () => new TextDecoder().decode(bytes),
  } as unknown as Response;
}

interface ClientHarness {
  client: PoliteHttpClient;
  requests: string[];
  sleeps: number[];
}

function makeClient(fetchImpl: FetchLike, overrides: Partial<ConstructorParameters<typeof PoliteHttpClient>[0]> = {}): ClientHarness {
  const requests: string[] = [];
  const sleeps: number[] = [];
  const client = new PoliteHttpClient({
    userAgent: 'SwimLoadingDiscoveryBot/1.0 (+test)',
    timeoutMs: 1000,
    maxRetries: 2,
    minHostDelayMs: 5000,
    maxCrawlDelayMs: 30000,
    maxResponseBytes: 1024 * 1024,
    fetchImpl: async (url, init) => {
      requests.push(url);
      return fetchImpl(url, init);
    },
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    ...overrides,
  });
  return { client, requests, sleeps };
}

const NO_ROBOTS = (url: string): Response | null => (url.endsWith('/robots.txt') ? makeResponse({ status: 404 }) : null);

test('fetches a page, checking robots.txt first, and decodes the body', async () => {
  const { client, requests } = makeClient(async (url) => {
    return NO_ROBOTS(url) ?? makeResponse({ body: '<html lang="en"><h1>Race</h1></html>', url });
  });
  const result = await client.fetchPage('https://example.com/races/one', 'en');
  assert.equal(result.ok, true);
  assert.equal(result.status, 200);
  assert.match(result.html ?? '', /Race/);
  assert.deepEqual(requests, ['https://example.com/robots.txt', 'https://example.com/races/one']);
});

test('sends the identifiable UA and Accept-Language', async () => {
  let seenHeaders: Record<string, string> | undefined;
  const { client } = makeClient(async (url, init) => {
    if (!url.endsWith('/robots.txt')) seenHeaders = init.headers as Record<string, string>;
    return NO_ROBOTS(url) ?? makeResponse({ body: 'ok' });
  });
  await client.fetchPage('https://example.com/x', 'it, en;q=0.9');
  assert.match(seenHeaders!['User-Agent']!, /^SwimLoadingDiscoveryBot\//);
  assert.equal(seenHeaders!['Accept-Language'], 'it, en;q=0.9');
});

test('robots disallow prevents the page request entirely', async () => {
  const { client, requests } = makeClient(async (url) => {
    if (url.endsWith('/robots.txt')) return makeResponse({ body: 'User-agent: *\nDisallow: /private/' });
    return makeResponse({ body: 'should never be fetched' });
  });
  const result = await client.fetchPage('https://example.com/private/page', 'en');
  assert.equal(result.ok, false);
  assert.equal(result.errorCode, 'robots_disallowed');
  assert.deepEqual(requests, ['https://example.com/robots.txt']);
});

test('unreachable robots.txt skips the host', async () => {
  const { client } = makeClient(async (url) => {
    if (url.endsWith('/robots.txt')) return makeResponse({ status: 500 });
    return makeResponse({ body: 'nope' });
  });
  const result = await client.fetchPage('https://example.com/page', 'en');
  assert.equal(result.ok, false);
  assert.equal(result.errorCode, 'robots_unreachable');
});

test('retries on 500 with backoff, then succeeds', async () => {
  let pageCalls = 0;
  const { client, sleeps } = makeClient(async (url) => {
    const robots = NO_ROBOTS(url);
    if (robots) return robots;
    pageCalls++;
    return pageCalls < 3 ? makeResponse({ status: 500 }) : makeResponse({ body: 'finally' });
  });
  const result = await client.fetchPage('https://example.com/flaky', 'en');
  assert.equal(result.ok, true);
  assert.equal(result.retries, 2);
  assert.equal(pageCalls, 3);
  assert.equal(sleeps.filter((ms) => ms >= 1000).length >= 2, true); // two backoff waits
});

test('does NOT retry a 404 — a missing page is a fact', async () => {
  let pageCalls = 0;
  const { client } = makeClient(async (url) => {
    const robots = NO_ROBOTS(url);
    if (robots) return robots;
    pageCalls++;
    return makeResponse({ status: 404 });
  });
  const result = await client.fetchPage('https://example.com/gone', 'en');
  assert.equal(result.ok, false);
  assert.equal(result.status, 404);
  assert.equal(pageCalls, 1);
});

test('429 honours Retry-After', async () => {
  let pageCalls = 0;
  const { client, sleeps } = makeClient(async (url) => {
    const robots = NO_ROBOTS(url);
    if (robots) return robots;
    pageCalls++;
    return pageCalls === 1
      ? makeResponse({ status: 429, headers: { 'retry-after': '7' } })
      : makeResponse({ body: 'ok now' });
  });
  const result = await client.fetchPage('https://example.com/limited', 'en');
  assert.equal(result.ok, true);
  assert.equal(sleeps.includes(7000), true);
});

test('rejects non-HTML content types and oversized bodies', async () => {
  const { client } = makeClient(async (url) => {
    const robots = NO_ROBOTS(url);
    if (robots) return robots;
    if (url.endsWith('.json')) return makeResponse({ body: '{}', headers: { 'content-type': 'application/json' } });
    return makeResponse({ body: 'x'.repeat(2048) });
  }, { maxResponseBytes: 1024 });

  const json = await client.fetchPage('https://example.com/feed.json', 'en');
  assert.equal(json.errorCode, 'not_html');

  const big = await client.fetchPage('https://example.com/huge', 'en');
  assert.equal(big.errorCode, 'too_large');
});

test('enforces a minimum delay between requests to the same host', async () => {
  const { client, sleeps } = makeClient(async (url) => NO_ROBOTS(url) ?? makeResponse({ body: 'ok' }));
  await client.fetchPage('https://example.com/a', 'en');
  await client.fetchPage('https://example.com/b', 'en');
  assert.equal(sleeps.some((ms) => ms > 4000 && ms <= 5000), true);
});

test('a redirect to a robots-disallowed host discards the body', async () => {
  const { client } = makeClient(async (url) => {
    if (url === 'https://a.com/robots.txt') return makeResponse({ status: 404 });
    if (url === 'https://b.com/robots.txt') return makeResponse({ body: 'User-agent: *\nDisallow: /' });
    return makeResponse({ body: 'landed', url: 'https://b.com/landing' });
  });
  const result = await client.fetchPage('https://a.com/start', 'en');
  assert.equal(result.ok, false);
  assert.equal(result.errorCode, 'redirect_disallowed');
  assert.equal(result.html, null);
});

test('decodes a non-UTF-8 page via its Content-Type charset', async () => {
  const iso = new Uint8Array([...new TextEncoder().encode('<h1>Gij'), 0xf3, ...new TextEncoder().encode('n</h1>')]);
  const { client } = makeClient(async (url) =>
    NO_ROBOTS(url) ?? makeResponse({ body: iso, headers: { 'content-type': 'text/html; charset=iso-8859-1' } })
  );
  const result = await client.fetchPage('https://example.com/es', 'es, en;q=0.9');
  assert.equal(result.ok, true);
  assert.match(result.html ?? '', /Gijón/);
});
