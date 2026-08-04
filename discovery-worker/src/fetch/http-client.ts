import { decodeBody, type DecodedBody } from './decode.js';
import { RobotsCache, type RobotsDecision } from './robots.js';

// The polite HTTP front door of the crawler. Every page fetch goes
// through here, and this is the only place in the worker that performs a
// network request. Guarantees, in order:
//
//   * robots.txt is checked before EVERY page request (cached per origin)
//   * one request at a time per host, with a minimum delay between them
//     (the larger of our own floor and the site's Crawl-delay, capped)
//   * a real, identifiable User-Agent with a contact route — never a
//     disguised browser string
//   * bounded retries with exponential backoff, only on transient
//     failures (429/5xx/network); a 403/404 is a fact, not a flake
//   * bounded response size and HTML-only content types
//
// fetchImpl is injectable so every behaviour above is testable without a
// network.

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export interface HttpClientOptions {
  userAgent: string;
  timeoutMs: number;
  maxRetries: number;
  minHostDelayMs: number;
  maxCrawlDelayMs: number;
  maxResponseBytes: number;
  fetchImpl?: FetchLike;
  sleep?: (ms: number) => Promise<void>;
}

export interface PageFetchResult {
  ok: boolean;
  url: string;
  finalUrl: string | null;
  status: number | null;
  errorCode:
    | null
    | 'robots_disallowed'
    | 'robots_unreachable'
    | 'http_error'
    | 'network_error'
    | 'timeout'
    | 'too_large'
    | 'not_html'
    | 'redirect_disallowed';
  errorMessage: string | null;
  html: string | null;
  charset: string | null;
  etag: string | null;
  lastModified: string | null;
  contentType: string | null;
  retries: number;
  robots: RobotsDecision | null;
}

const HTML_CONTENT_TYPES = /^(text\/html|application\/xhtml\+xml|text\/xml|application\/xml)\b/i;

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function failure(url: string, code: NonNullable<PageFetchResult['errorCode']>, message: string, partial?: Partial<PageFetchResult>): PageFetchResult {
  return {
    ok: false,
    url,
    finalUrl: null,
    status: null,
    errorCode: code,
    errorMessage: message,
    html: null,
    charset: null,
    etag: null,
    lastModified: null,
    contentType: null,
    retries: 0,
    robots: null,
    ...partial,
  };
}

export class PoliteHttpClient {
  private readonly fetchImpl: FetchLike;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly robots: RobotsCache;
  // Per-host serialisation: the stored promise is the tail of that host's
  // queue; each new request chains behind it and becomes the new tail.
  private readonly hostQueues = new Map<string, Promise<void>>();
  private readonly hostLastRequestAt = new Map<string, number>();

  constructor(private readonly options: HttpClientOptions) {
    this.fetchImpl = options.fetchImpl ?? ((url, init) => fetch(url, init));
    this.sleep = options.sleep ?? defaultSleep;
    this.robots = new RobotsCache(
      async (robotsUrl) => {
        try {
          const response = await this.rawRequest(robotsUrl, 'en');
          return { status: response.status, text: response.status < 300 ? await response.text() : '' };
        } catch (err) {
          return { networkError: err instanceof Error ? err.message : String(err) };
        }
      },
      // The robots matching token is the product name, without version.
      options.userAgent.split('/')[0] ?? options.userAgent
    );
  }

  // Sitemap URLs this origin declares in robots.txt (empty when it
  // declares none). Fetching robots is cached, so this is free once the
  // origin has been checked.
  async sitemapsFor(url: string): Promise<string[]> {
    try {
      return await this.robots.sitemapsFor(url);
    } catch {
      return [];
    }
  }

  async fetchPage(url: string, acceptLanguage: string): Promise<PageFetchResult> {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return failure(url, 'network_error', `Not a valid URL: ${url}`);
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return failure(url, 'network_error', `Unsupported protocol: ${parsed.protocol}`);
    }

    return this.enqueueForHost(parsed.host, async () => {
      const robots = await this.robots.check(url);
      if (robots.availability === 'unreachable') {
        return failure(url, 'robots_unreachable', 'robots.txt unreachable (5xx/network) — host skipped this run', { robots });
      }
      if (!robots.allowed) {
        return failure(url, 'robots_disallowed', `Disallowed by robots.txt (${robots.matchedRule ?? 'rule'})`, { robots });
      }

      await this.respectHostDelay(parsed.host, robots.crawlDelaySeconds);
      const result = await this.fetchWithRetries(url, acceptLanguage);
      result.robots = robots;

      // A redirect can land on a different host whose robots we never
      // consulted. Check it after the fact and discard the body if that
      // host forbids the final path.
      if (result.ok && result.finalUrl) {
        const finalHost = new URL(result.finalUrl).host;
        if (finalHost !== parsed.host) {
          const finalRobots = await this.robots.check(result.finalUrl);
          if (!finalRobots.allowed || finalRobots.availability === 'unreachable') {
            return failure(url, 'redirect_disallowed', `Redirected to ${result.finalUrl}, which robots.txt disallows`, {
              status: result.status,
              finalUrl: result.finalUrl,
              robots: finalRobots,
            });
          }
        }
      }
      return result;
    });
  }

  private enqueueForHost<T>(host: string, task: () => Promise<T>): Promise<T> {
    const tail = this.hostQueues.get(host) ?? Promise.resolve();
    const run = tail.then(task);
    // The queue tail must survive a failed task, so swallow errors on the
    // stored chain only — callers still see them via `run`.
    this.hostQueues.set(host, run.then(() => undefined, () => undefined));
    return run;
  }

  private async respectHostDelay(host: string, crawlDelaySeconds: number | null): Promise<void> {
    const delayMs = Math.max(
      this.options.minHostDelayMs,
      Math.min((crawlDelaySeconds ?? 0) * 1000, this.options.maxCrawlDelayMs)
    );
    const last = this.hostLastRequestAt.get(host);
    if (last !== undefined) {
      const waitMs = last + delayMs - Date.now();
      if (waitMs > 0) await this.sleep(waitMs);
    }
  }

  private async fetchWithRetries(url: string, acceptLanguage: string): Promise<PageFetchResult> {
    let lastError: PageFetchResult | null = null;
    for (let attempt = 0; attempt <= this.options.maxRetries; attempt++) {
      if (attempt > 0) {
        const backoffMs = Math.min(2000 * 2 ** (attempt - 1), 30_000) * (0.5 + Math.random() * 0.5);
        const retryAfterMs = lastError?.status === 429 || lastError?.status === 503 ? this.retryAfterMs(lastError) : null;
        await this.sleep(retryAfterMs ?? backoffMs);
      }

      let response: Response;
      this.hostLastRequestAt.set(new URL(url).host, Date.now());
      try {
        response = await this.rawRequest(url, acceptLanguage);
      } catch (err) {
        const isTimeout = err instanceof Error && err.name === 'AbortError';
        lastError = failure(url, isTimeout ? 'timeout' : 'network_error', err instanceof Error ? err.message : String(err), {
          retries: attempt,
        });
        continue; // network errors and timeouts are retryable
      }

      if (response.status === 429 || response.status >= 500) {
        lastError = failure(url, 'http_error', `HTTP ${response.status}`, {
          status: response.status,
          finalUrl: response.url || url,
          retries: attempt,
        });
        (lastError as PageFetchResult & { retryAfterHeader?: string | null }).retryAfterHeader =
          response.headers.get('retry-after');
        continue;
      }

      if (!response.ok) {
        // 4xx other than 429: definitive, never retried.
        return failure(url, 'http_error', `HTTP ${response.status}`, {
          status: response.status,
          finalUrl: response.url || url,
          retries: attempt,
        });
      }

      const contentType = response.headers.get('content-type');
      if (contentType && !HTML_CONTENT_TYPES.test(contentType)) {
        return failure(url, 'not_html', `Content-Type ${contentType} is not an HTML type`, {
          status: response.status,
          finalUrl: response.url || url,
          contentType,
          retries: attempt,
        });
      }

      const declaredLength = Number(response.headers.get('content-length') ?? '0');
      if (Number.isFinite(declaredLength) && declaredLength > this.options.maxResponseBytes) {
        return failure(url, 'too_large', `Content-Length ${declaredLength} exceeds cap ${this.options.maxResponseBytes}`, {
          status: response.status,
          finalUrl: response.url || url,
          retries: attempt,
        });
      }

      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.byteLength > this.options.maxResponseBytes) {
        return failure(url, 'too_large', `Body of ${bytes.byteLength} bytes exceeds cap ${this.options.maxResponseBytes}`, {
          status: response.status,
          finalUrl: response.url || url,
          retries: attempt,
        });
      }

      const decoded: DecodedBody = decodeBody(bytes, contentType);
      return {
        ok: true,
        url,
        finalUrl: response.url || url,
        status: response.status,
        errorCode: null,
        errorMessage: null,
        html: decoded.text,
        charset: decoded.charset,
        etag: response.headers.get('etag'),
        lastModified: response.headers.get('last-modified'),
        contentType,
        retries: attempt,
        robots: null,
      };
    }
    return lastError ?? failure(url, 'network_error', 'Exhausted retries with no recorded error');
  }

  private retryAfterMs(result: PageFetchResult): number | null {
    const header = (result as PageFetchResult & { retryAfterHeader?: string | null }).retryAfterHeader;
    if (!header) return null;
    const seconds = Number(header);
    if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, 60_000);
    return null;
  }

  private async rawRequest(url: string, acceptLanguage: string): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.options.timeoutMs);
    try {
      return await this.fetchImpl(url, {
        method: 'GET',
        redirect: 'follow',
        signal: controller.signal,
        headers: {
          'User-Agent': this.options.userAgent,
          Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5',
          'Accept-Language': acceptLanguage,
        },
      });
    } finally {
      clearTimeout(timer);
    }
  }
}
