export interface DiscoveryConfig {
  writeEnabled: boolean;
  liveFetchEnabled: boolean;
  playwrightEnabled: boolean;
  aiEnabled: boolean;
  maxPagesPerRun: number;
  maxAiCallsPerRun: number;
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

export function loadConfig(): DiscoveryConfig {
  return {
    writeEnabled: parseBoolEnv('DISCOVERY_WRITE_ENABLED', false),
    liveFetchEnabled: parseBoolEnv('DISCOVERY_LIVE_FETCH_ENABLED', false),
    playwrightEnabled: parseBoolEnv('DISCOVERY_PLAYWRIGHT_ENABLED', false),
    aiEnabled: parseBoolEnv('DISCOVERY_AI_ENABLED', false),
    maxPagesPerRun: parseIntEnv('DISCOVERY_MAX_PAGES_PER_RUN', 5),
    maxAiCallsPerRun: parseIntEnv('DISCOVERY_MAX_AI_CALLS_PER_RUN', 0),
  };
}

// Safety gate. Fixture-only extraction and (as of the write-path phase)
// database writes are implemented; live fetch, Playwright and AI are NOT,
// and enabling them refuses to start rather than silently no-op'ing.
//
// DISCOVERY_WRITE_ENABLED is now SUPPORTED, but still defaults to false —
// the default run remains a pure dry-run that touches nothing but out/.
export function assertPhaseOneSafe(config: DiscoveryConfig): void {
  const problems: string[] = [];
  // Write mode is implemented, but fails closed without credentials:
  // better to refuse at startup than to process every fixture and only
  // then discover there was nowhere to write them.
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
  if (config.liveFetchEnabled) {
    problems.push('DISCOVERY_LIVE_FETCH_ENABLED=true — live network fetching is not implemented in this phase.');
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
