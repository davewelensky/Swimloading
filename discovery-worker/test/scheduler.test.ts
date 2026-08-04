import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeNextRunAt,
  deriveHealthStatus,
  isDue,
  selectDueSources,
  type SchedulableSource,
} from '../src/schedule/scheduler.js';

const NOW = new Date('2026-08-03T12:00:00Z');

function source(overrides: Partial<SchedulableSource>): SchedulableSource {
  return {
    id: '00000000-0000-4000-8000-00000000abcd',
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

test('isDue: enabled + never-run is due; future next_run_at is not', () => {
  assert.equal(isDue(source({}), NOW), true);
  assert.equal(isDue(source({ next_run_at: '2026-08-03T11:00:00Z' }), NOW), true);
  assert.equal(isDue(source({ next_run_at: '2026-08-04T00:00:00Z' }), NOW), false);
  assert.equal(isDue(source({ enabled: false }), NOW), false);
});

test('isDue: playwright sources are skipped, manual parser sources are crawlable', () => {
  assert.equal(isDue(source({ parser_type: 'playwright' }), NOW), false);
  assert.equal(isDue(source({ parser_type: 'manual' }), NOW), true);
});

test('selectDueSources orders never-run first, then oldest due', () => {
  const a = source({ id: 'a', next_run_at: '2026-08-03T10:00:00Z' });
  const b = source({ id: 'b', next_run_at: null });
  const c = source({ id: 'c', next_run_at: '2026-08-03T09:00:00Z' });
  const d = source({ id: 'd', next_run_at: '2026-09-01T00:00:00Z' }); // not due
  assert.deepEqual(selectDueSources([a, b, c, d], NOW).map((s) => s.id), ['b', 'c', 'a']);
});

test('computeNextRunAt: base frequency, failure backoff capped at 4x, manual never reschedules', () => {
  const weekly = new Date(computeNextRunAt('weekly', 0, NOW)!).getTime() - NOW.getTime();
  assert.equal(weekly, 7 * 24 * 60 * 60 * 1000);

  const backedOff = new Date(computeNextRunAt('daily', 1, NOW)!).getTime() - NOW.getTime();
  assert.equal(backedOff, 2 * 24 * 60 * 60 * 1000);

  const capped = new Date(computeNextRunAt('daily', 10, NOW)!).getTime() - NOW.getTime();
  assert.equal(capped, 4 * 24 * 60 * 60 * 1000);

  assert.equal(computeNextRunAt('manual', 0, NOW), null);
});

test('deriveHealthStatus covers all outcomes', () => {
  assert.equal(
    deriveHealthStatus({ robotsBlockedEverything: true, pagesAttempted: 3, pagesSucceeded: 0, consecutiveFailureCount: 1 }),
    'blocked'
  );
  assert.equal(
    deriveHealthStatus({ robotsBlockedEverything: false, pagesAttempted: 3, pagesSucceeded: 0, consecutiveFailureCount: 1 }),
    'failing'
  );
  assert.equal(
    deriveHealthStatus({ robotsBlockedEverything: false, pagesAttempted: 3, pagesSucceeded: 3, consecutiveFailureCount: 3 }),
    'failing'
  );
  assert.equal(
    deriveHealthStatus({ robotsBlockedEverything: false, pagesAttempted: 3, pagesSucceeded: 2, consecutiveFailureCount: 0 }),
    'degraded'
  );
  assert.equal(
    deriveHealthStatus({ robotsBlockedEverything: false, pagesAttempted: 3, pagesSucceeded: 3, consecutiveFailureCount: 0 }),
    'healthy'
  );
});
