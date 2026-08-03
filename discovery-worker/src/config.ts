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
  };
}

// Safety gate. Fixture extraction, database writes and live HTTP fetching
// are implemented; Playwright and AI extraction are NOT, and enabling
// them refuses to start rather than silently no-op'ing.
//
// Every capability flag still defaults to false — the default run remains
// a pure dry-run that touches nothing but out/.
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
  if (config.playwrightEnabled) {
    problems.push('DISCOVERY_PLAYWRIGHT_ENABLED=true — Playwright extraction is not implemented in this phase.');
  }
  if (config.aiEnabled) {
    problems.push('DISCOVERY_AI_ENABLED=true — AI-assisted extraction is not implemented in this phase.');
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
