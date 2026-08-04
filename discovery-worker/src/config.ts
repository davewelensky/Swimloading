export interface DiscoveryConfig {
  writeEnabled: boolean;
  liveFetchEnabled: boolean;
  playwrightEnabled: boolean;
  aiEnabled: boolean;
  maxPagesPerRun: number;
  maxAiCallsPerRun: number;
  // Live-crawl behaviour. All defaults are deliberately conservative —
  // this bot's reputation is a product asset.
  userAgent: string;
  fetchTimeoutMs: number;
  fetchMaxRetries: number;
  minHostDelayMs: number;
  maxCrawlDelayMs: number;
  maxResponseBytes: number;
  maxSourcesPerPass: number;
  schedulerIntervalSeconds: number;
  maxSitemapsToFollow: number;
  maxSitemapUrls: number;
  // Headless rendering. Deliberately small by default: rendering costs
  // ~1s and ~200MB per page against milliseconds for a plain fetch, so
  // it is a fallback for pages deterministic extraction already failed
  // on, not a default path.
  maxRenderedPagesPerRun: number;
  renderTimeoutMs: number;
  renderSettleMs: number;
  // AI-assisted extraction. The only part of the pipeline that costs
  // money per page, so it is capped per run and never the first thing
  // tried — see extract/ai.ts for why it exists and what it is allowed
  // to do.
  aiModel: string;
  aiEffort: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  aiMaxInputChars: number;
}

function parseBoolEnv(name: string, defaultValue: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined) return defaultValue;
  return raw.trim().toLowerCase() === 'true';
}

function parseIntEnv(name: string, defaultValue: number): number {
  const raw = process.env[name];
  if (raw === undefined) return defaultValue;
  const n = Number(raw);
  return Number.isFinite(n) ? n : defaultValue;
}

const EFFORT_LEVELS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
type Effort = (typeof EFFORT_LEVELS)[number];

function parseEffortEnv(name: string, defaultValue: Effort): Effort {
  const raw = process.env[name]?.trim().toLowerCase();
  if (!raw) return defaultValue;
  return (EFFORT_LEVELS as readonly string[]).includes(raw) ? (raw as Effort) : defaultValue;
}

export const DEFAULT_USER_AGENT =
  'SwimLoadingDiscoveryBot/1.0 (+https://www.swimloading.com/explore; contact: dave.welensky@gmail.com)';

export function loadConfig(): DiscoveryConfig {
  return {
    writeEnabled: parseBoolEnv('DISCOVERY_WRITE_ENABLED', false),
    liveFetchEnabled: parseBoolEnv('DISCOVERY_LIVE_FETCH_ENABLED', false),
    playwrightEnabled: parseBoolEnv('DISCOVERY_PLAYWRIGHT_ENABLED', false),
    aiEnabled: parseBoolEnv('DISCOVERY_AI_ENABLED', false),
    maxPagesPerRun: parseIntEnv('DISCOVERY_MAX_PAGES_PER_RUN', 5),
    maxAiCallsPerRun: parseIntEnv('DISCOVERY_MAX_AI_CALLS_PER_RUN', 0),
    userAgent: process.env.DISCOVERY_USER_AGENT?.trim() || DEFAULT_USER_AGENT,
    fetchTimeoutMs: parseIntEnv('DISCOVERY_FETCH_TIMEOUT_MS', 20_000),
    fetchMaxRetries: parseIntEnv('DISCOVERY_FETCH_MAX_RETRIES', 3),
    minHostDelayMs: parseIntEnv('DISCOVERY_MIN_HOST_DELAY_MS', 5_000),
    maxCrawlDelayMs: parseIntEnv('DISCOVERY_MAX_CRAWL_DELAY_MS', 30_000),
    maxResponseBytes: parseIntEnv('DISCOVERY_MAX_RESPONSE_BYTES', 5 * 1024 * 1024),
    maxSourcesPerPass: parseIntEnv('DISCOVERY_MAX_SOURCES_PER_PASS', 10),
    schedulerIntervalSeconds: parseIntEnv('DISCOVERY_SCHEDULER_INTERVAL_SECONDS', 900),
    maxSitemapsToFollow: parseIntEnv('DISCOVERY_MAX_SITEMAPS_TO_FOLLOW', 5),
    maxSitemapUrls: parseIntEnv('DISCOVERY_MAX_SITEMAP_URLS', 500),
    maxRenderedPagesPerRun: parseIntEnv('DISCOVERY_MAX_RENDERED_PAGES_PER_RUN', 10),
    renderTimeoutMs: parseIntEnv('DISCOVERY_RENDER_TIMEOUT_MS', 30_000),
    renderSettleMs: parseIntEnv('DISCOVERY_RENDER_SETTLE_MS', 1_500),
    aiModel: process.env.DISCOVERY_AI_MODEL?.trim() || 'claude-opus-5',
    aiEffort: parseEffortEnv('DISCOVERY_AI_EFFORT', 'low'),
    // ~60k characters is roughly four times the largest page measured
    // across the seeded sources (17k), so truncation should be rare —
    // and when it happens it is reported rather than hidden.
    aiMaxInputChars: parseIntEnv('DISCOVERY_AI_MAX_INPUT_CHARS', 60_000),
  };
}

// Safety gate. Every capability — fixture extraction, database writes,
// live HTTP fetching, headless rendering and AI-assisted extraction — is
// implemented, and every flag still defaults to false, so the default run
// remains a pure dry-run that touches nothing but out/.
//
// Each mode fails CLOSED without its prerequisites. Refusing at startup
// beats discovering mid-pass that there was no API key, having already
// spent an hour politely crawling.
export function assertConfigSafe(config: DiscoveryConfig): void {
  const problems: string[] = [];
  // Implemented modes fail closed without their prerequisites: better to
  // refuse at startup than to process everything and only then discover
  // there was nowhere to write.
  if (config.writeEnabled) {
    const missing: string[] = [];
    if (!process.env.SUPABASE_URL) missing.push('SUPABASE_URL');
    if (!process.env.SUPABASE_SERVICE_KEY) missing.push('SUPABASE_SERVICE_KEY');
    if (missing.length > 0) {
      problems.push(
        `DISCOVERY_WRITE_ENABLED=true but ${missing.join(' and ')} not set — refusing to start in write mode without credentials.`
      );
    }
  }
  if (config.aiEnabled) {
    if (!process.env.ANTHROPIC_API_KEY) {
      problems.push(
        'DISCOVERY_AI_ENABLED=true but ANTHROPIC_API_KEY not set — refusing to start with AI extraction enabled and no key.'
      );
    }
    // A cap of 0 with AI enabled is the single most expensive kind of
    // silent no-op: the operator believes AI extraction is running, every
    // call is skipped, and the sources stay empty for another week. Say so.
    if (config.maxAiCallsPerRun <= 0) {
      problems.push(
        'DISCOVERY_AI_ENABLED=true but DISCOVERY_MAX_AI_CALLS_PER_RUN=' +
          `${config.maxAiCallsPerRun} — that disables every AI call. Set a positive cap (25 is a sensible start, ` +
          'roughly $2.50 per run) or set DISCOVERY_AI_ENABLED=false.'
      );
    }
  }

  if (problems.length > 0) {
    throw new Error(
      [
        'discovery-worker refuses to start:',
        ...problems.map((p) => `  - ${p}`),
        'See discovery-worker/README.md, "What is deliberately not implemented".',
      ].join('\n')
    );
  }
}

// Backwards-compatible alias — the fixtures entry point predates live
// fetch being implemented.
export const assertPhaseOneSafe = assertConfigSafe;
