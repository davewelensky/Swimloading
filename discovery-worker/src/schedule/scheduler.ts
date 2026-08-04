// Pure scheduling decisions over discovery_sources rows — separated from
// all I/O so due-selection and next-run arithmetic are unit-testable.

export interface SchedulableSource {
  id: string;
  name: string;
  base_url: string;
  parser_type: string;
  enabled: boolean;
  crawl_frequency: string;
  next_run_at: string | null;
  language_codes: string[] | null;
  consecutive_failure_count: number;
  // Curated context passed into extraction: source_type corroborates
  // classification when a page's own wording is inconclusive, and
  // country_code fills in a location the page never stated.
  source_type: string | null;
  country_code: string | null;
}

// Parser types this worker can actually execute today. 'manual' sources
// are still crawlable — in verification-only mode (re-fetch known URLs,
// no listing discovery). 'playwright' needs a capability that does not
// exist yet and is skipped rather than half-attempted.
const EXECUTABLE_PARSERS = new Set(['jsonld', 'html', 'jsonld_html', 'manual']);

export function isDue(source: SchedulableSource, now: Date): boolean {
  if (!source.enabled) return false;
  if (!EXECUTABLE_PARSERS.has(source.parser_type)) return false;
  if (source.next_run_at === null) return true;
  return new Date(source.next_run_at).getTime() <= now.getTime();
}

export function selectDueSources(sources: SchedulableSource[], now: Date): SchedulableSource[] {
  return sources
    .filter((s) => isDue(s, now))
    .sort((a, b) => {
      // Never-run sources first, then oldest due first.
      const at = a.next_run_at === null ? -Infinity : new Date(a.next_run_at).getTime();
      const bt = b.next_run_at === null ? -Infinity : new Date(b.next_run_at).getTime();
      return at - bt;
    });
}

const FREQUENCY_MS: Record<string, number> = {
  hourly: 60 * 60 * 1000,
  daily: 24 * 60 * 60 * 1000,
  weekly: 7 * 24 * 60 * 60 * 1000,
  monthly: 30 * 24 * 60 * 60 * 1000,
};

// Next run for a source, from the END of the run it just had. 'manual'
// never reschedules itself. A failing source backs off: the interval
// doubles per consecutive failure, capped at 4x the base frequency, so a
// broken site degrades to occasional checks instead of hammering.
export function computeNextRunAt(
  crawlFrequency: string,
  consecutiveFailureCount: number,
  now: Date
): string | null {
  const baseMs = FREQUENCY_MS[crawlFrequency];
  if (baseMs === undefined) return null; // 'manual'
  const multiplier = Math.min(2 ** Math.max(consecutiveFailureCount, 0), 4);
  return new Date(now.getTime() + baseMs * multiplier).toISOString();
}

// Health from what actually happened in a run.
export function deriveHealthStatus(outcome: {
  robotsBlockedEverything: boolean;
  pagesAttempted: number;
  pagesSucceeded: number;
  consecutiveFailureCount: number;
}): 'healthy' | 'degraded' | 'failing' | 'blocked' {
  if (outcome.robotsBlockedEverything) return 'blocked';
  if (outcome.consecutiveFailureCount >= 3) return 'failing';
  if (outcome.pagesAttempted > 0 && outcome.pagesSucceeded === 0) return 'failing';
  if (outcome.pagesSucceeded < outcome.pagesAttempted) return 'degraded';
  return 'healthy';
}
