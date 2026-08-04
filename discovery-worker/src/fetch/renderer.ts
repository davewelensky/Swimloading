// Headless-browser rendering, for pages whose content only exists after
// JavaScript runs.
//
// Why this is needed at all: Swimming South Africa's calendar serves
// "Fetching batch 1... (0 events loaded)" and fills itself from an API;
// Oceanman's race pages are a 5KB shell with zero body text. Both are
// findable and neither is readable without a browser. This is now the
// normal shape of a modern race site, not an edge case.
//
// It is deliberately the SLOW PATH: rendering costs roughly a second and
// ~200MB of RAM per page against a few milliseconds for plain fetch, so
// crawl-source only calls it after deterministic extraction has already
// failed on the fetched HTML. Politeness is unchanged — the page was
// already fetched once through the robots-checked, rate-limited client,
// and rendering re-requests the same URL the site already served us.
//
// Playwright is an OPTIONAL dependency, imported lazily. A worker
// without the browser binaries installed keeps running and simply
// reports rendering as unavailable, rather than failing to boot.

export interface RendererOptions {
  userAgent: string;
  timeoutMs: number;
  maxBytes: number;
  // Extra settle time after the network goes quiet, for apps that render
  // a frame or two after their last XHR resolves.
  settleMs?: number;
}

export interface RenderResult {
  html: string | null;
  errorMessage: string | null;
}

// Subresources that never carry event data. Blocking them cuts memory,
// bandwidth and load on the organiser's server — a politeness win as
// much as a performance one.
const BLOCKED_RESOURCE_TYPES = new Set(['image', 'media', 'font']);

export class PageRenderer {
  private browser: unknown = null;
  private launchFailed: string | null = null;

  constructor(private readonly options: RendererOptions) {}

  // True once we know the browser cannot be launched, so callers can stop
  // attempting renders for the rest of the run instead of paying the
  // launch timeout on every page.
  get unavailableReason(): string | null {
    return this.launchFailed;
  }

  private async ensureBrowser(): Promise<unknown> {
    if (this.browser) return this.browser;
    if (this.launchFailed) throw new Error(this.launchFailed);

    let chromium: { launch: (opts: unknown) => Promise<unknown> };
    try {
      ({ chromium } = (await import('playwright')) as unknown as {
        chromium: { launch: (opts: unknown) => Promise<unknown> };
      });
    } catch (err) {
      this.launchFailed =
        'Playwright is not installed in this environment. Run "npm install playwright && npx playwright install chromium".';
      throw new Error(this.launchFailed);
    }

    try {
      this.browser = await chromium.launch({
        headless: true,
        // --disable-dev-shm-usage matters in containers: Chrome's default
        // /dev/shm is tiny on Railway and it crashes without this.
        args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.launchFailed = `Could not launch headless Chromium: ${message}. Browser binaries may be missing — run "npx playwright install chromium".`;
      throw new Error(this.launchFailed);
    }
    return this.browser;
  }

  async render(url: string): Promise<RenderResult> {
    let context: any = null;
    try {
      const browser = (await this.ensureBrowser()) as any;
      context = await browser.newContext({
        userAgent: this.options.userAgent,
        // A realistic viewport: some sites render nothing at 0x0, and
        // mobile layouts occasionally omit listings entirely.
        viewport: { width: 1280, height: 900 },
        javaScriptEnabled: true,
      });

      const page = await context.newPage();
      await page.route('**/*', (route: any) => {
        const type = route.request().resourceType();
        if (BLOCKED_RESOURCE_TYPES.has(type)) return route.abort();
        return route.continue();
      });

      // 'networkidle' is the right signal here: these pages are defined by
      // the XHR that populates them, and domcontentloaded fires long
      // before the events arrive.
      await page.goto(url, { waitUntil: 'networkidle', timeout: this.options.timeoutMs });
      if (this.options.settleMs && this.options.settleMs > 0) {
        await page.waitForTimeout(this.options.settleMs);
      }

      const html: string = await page.content();
      if (html.length > this.options.maxBytes) {
        return { html: null, errorMessage: `Rendered document of ${html.length} bytes exceeds cap ${this.options.maxBytes}` };
      }
      return { html, errorMessage: null };
    } catch (err) {
      return { html: null, errorMessage: err instanceof Error ? err.message : String(err) };
    } finally {
      // The context owns the page; closing it releases the tab's memory.
      // The browser itself is reused across the run and closed by close().
      if (context) await context.close().catch(() => {});
    }
  }

  async close(): Promise<void> {
    if (!this.browser) return;
    await (this.browser as any).close().catch(() => {});
    this.browser = null;
  }
}
