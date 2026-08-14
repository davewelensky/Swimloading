import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  getTemperatureFreshness, spotTitle, formatObservedAt, FRESHNESS_THRESHOLDS,
} from '../api/_lib/temperature-freshness.js';
import { isPublicPageIndexable, robotsFor } from '../api/_lib/indexability.js';

const NOW = new Date('2026-08-14T09:00:00Z');
const hoursAgo = (h) => new Date(NOW.getTime() - h * 3_600_000);
const daysAgo  = (d) => new Date(NOW.getTime() - d * 86_400_000);

// ── temperature freshness ──────────────────────────────────────────────
// The rule exists so a page ranking for "tooting lido temperature" never
// calls a month-old reading "current".

test('a reading from this morning is live and may say Today', () => {
  const f = getTemperatureFreshness(hoursAgo(2), { now: NOW });
  assert.equal(f.state, 'live');
  assert.equal(f.canSayToday, true);
  assert.equal(f.label, 'Water temperature');
});

test('a reading from yesterday is recent and may NOT say Today', () => {
  const f = getTemperatureFreshness(hoursAgo(20), { now: NOW });
  assert.equal(f.state, 'recent');
  assert.equal(f.canSayToday, false);
});

test('an old reading is stale and is labelled as a last-recorded value', () => {
  const f = getTemperatureFreshness(daysAgo(9), { now: NOW });
  assert.equal(f.state, 'stale');
  assert.equal(f.canSayToday, false);
  assert.equal(f.label, 'Last recorded water temperature');
});

test('no reading, an empty string and rubbish all report unavailable', () => {
  for (const v of [null, undefined, '', 'not a date']) {
    const f = getTemperatureFreshness(v, { now: NOW });
    assert.equal(f.state, 'unavailable', String(v));
    assert.equal(f.canSayToday, false);
  }
});

test('a future timestamp is a clock fault, and never earns the strongest claim', () => {
  const f = getTemperatureFreshness(new Date(NOW.getTime() + 3_600_000), { now: NOW });
  assert.equal(f.canSayToday, false);
  assert.notEqual(f.state, 'live');
});

test('the boundaries are exactly the published thresholds', () => {
  assert.equal(getTemperatureFreshness(hoursAgo(FRESHNESS_THRESHOLDS.liveHours), { now: NOW }).state, 'live');
  assert.equal(getTemperatureFreshness(hoursAgo(FRESHNESS_THRESHOLDS.liveHours + 0.1), { now: NOW }).state, 'recent');
  assert.equal(getTemperatureFreshness(hoursAgo(FRESHNESS_THRESHOLDS.recentHours), { now: NOW }).state, 'recent');
  assert.equal(getTemperatureFreshness(hoursAgo(FRESHNESS_THRESHOLDS.recentHours + 0.1), { now: NOW }).state, 'stale');
});

// ── title generation ───────────────────────────────────────────────────

test('the title only claims Today when the reading supports it', () => {
  const live  = getTemperatureFreshness(hoursAgo(1), { now: NOW });
  const stale = getTemperatureFreshness(daysAgo(30), { now: NOW });
  assert.equal(spotTitle('Tooting Bec Lido', live),
    'Tooting Bec Lido Water Temperature Today | SwimLoading');
  assert.equal(spotTitle('Tooting Bec Lido', stale),
    'Tooting Bec Lido Water Temperature & Swimming Conditions | SwimLoading');
});

test('a pool says Pool Temperature, not Water Temperature', () => {
  const live = getTemperatureFreshness(hoursAgo(1), { now: NOW });
  assert.match(spotTitle('Tooting Bec Lido', live, { isPool: true }), /Pool Temperature Today/);
});

test('the observation time is rendered, in the spot timezone when known', () => {
  const at = new Date('2026-08-14T07:20:00Z');
  assert.match(formatObservedAt(at, 'Europe/London'), /14 Aug 2026/);
  // An invalid zone must not take the page down over a caption.
  assert.ok(formatObservedAt(at, 'Not/AZone'));
  assert.equal(formatObservedAt(null), null);
});

// ── indexability ───────────────────────────────────────────────────────

const GOOD_SPOT = {
  name: 'Tooting Bec Lido', country_code: 'GB', water_type: 'pool',
  latitude: 51.4272, longitude: -0.1494, active: true,
  temp_c: 16.8, temp_observed_at: hoursAgo(3).toISOString(),
};

test('a spot with geography, water type and a fresh reading is indexable', () => {
  const v = isPublicPageIndexable(GOOD_SPOT, 'spot', { now: NOW });
  assert.equal(v.indexable, true);
  assert.equal(robotsFor(v), 'index,follow');
});

test('a spot missing geography or water type is held back, and says why', () => {
  for (const [field, value] of [['latitude', null], ['country_code', null], ['water_type', null], ['name', '']]) {
    const v = isPublicPageIndexable({ ...GOOD_SPOT, [field]: value }, 'spot', { now: NOW });
    assert.equal(v.indexable, false, field);
    assert.match(v.reasons.join(' '), /thin: missing/, field);
    assert.equal(robotsFor(v), 'noindex,follow');
  }
});

test('a name-only row is never indexable', () => {
  const v = isPublicPageIndexable({ name: 'Somewhere', active: true }, 'spot', { now: NOW });
  assert.equal(v.indexable, false);
});

test('an old reading does not qualify a spot, but descriptive context does', () => {
  const stale = { ...GOOD_SPOT, temp_observed_at: daysAgo(90).toISOString() };
  assert.equal(isPublicPageIndexable(stale, 'spot', { now: NOW }).indexable, false);
  assert.equal(isPublicPageIndexable({ ...stale, area: 'South London' }, 'spot', { now: NOW }).indexable, true);
});

test('0,0 is not a coordinate', () => {
  const v = isPublicPageIndexable({ ...GOOD_SPOT, latitude: 0, longitude: 0 }, 'spot', { now: NOW });
  assert.equal(v.indexable, false);
});

test('an inactive spot is never indexable however complete it is', () => {
  assert.equal(isPublicPageIndexable({ ...GOOD_SPOT, active: false }, 'spot', { now: NOW }).indexable, false);
});

test('a crossing needs a name, a slug and a distance', () => {
  const gib = { slug: 'strait-of-gibraltar', name: 'Strait of Gibraltar', distance_km: 14.4, is_active: true };
  assert.equal(isPublicPageIndexable(gib, 'crossing').indexable, true);
  // "how far is X" is the query; without a distance there is no page.
  assert.equal(isPublicPageIndexable({ ...gib, distance_km: null }, 'crossing').indexable, false);
  assert.equal(isPublicPageIndexable({ ...gib, is_active: false }, 'crossing').indexable, false);
});

test('an unknown kind is refused rather than defaulted to indexable', () => {
  const v = isPublicPageIndexable({ name: 'x' }, 'mystery');
  assert.equal(v.indexable, false);
  assert.match(v.reasons.join(' '), /no indexability rule/);
});
