// Increment 5 — spot freshness semantics.
//
// The defect these guard against was live for months: every spot page
// title hardcoded the word "Today" and every description hardcoded
// "Live"/"Current", regardless of when the reading was actually taken. On
// 2026-08-14, Simons Town advertised "Water Temperature Today" and "Live
// ocean temperature" over a reading six days old.
//
// The rule is one sentence: a page may only claim freshness the data
// supports. These tests assert it on every surface a claim can appear —
// title, description, and the answers that end up in structured data.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  getTemperatureFreshness, spotTitle, spotMetaDescription, waterTemperatureLabel,
} from '../api/_lib/temperature-freshness.js';
import { isPublicPageIndexable } from '../api/_lib/indexability.js';
import {
  spotEventPayload, spotAnalyticsScript, SPOT_EVENTS, CROSSING_EVENTS, ATTRIBUTION_KEY,
} from '../api/_lib/public-analytics.js';

const NOW = new Date('2026-08-14T09:00:00Z');
const hoursAgo = (h) => new Date(NOW.getTime() - h * 3_600_000);
const fresh = (h) => getTemperatureFreshness(hoursAgo(h), { now: NOW });
const noReading = getTemperatureFreshness(null, { now: NOW });

// ── title semantics ────────────────────────────────────────────────────

test('a live reading earns Today', () => {
  // Tooting Bec on the day of the fix: 0.3 hours old.
  assert.equal(spotTitle('Tooting Bec Lido', fresh(0.3), { isPool: true }),
    'Tooting Bec Lido Pool Temperature Today | SwimLoading');
});

test('a recent-but-not-live reading does NOT say Today', () => {
  // Clifton 4th Beach: 7.3 hours old — useful, but not "today's" water.
  const t = spotTitle('Clifton 4th Beach', fresh(7.3));
  assert.equal(t, 'Clifton 4th Beach Water Temperature & Swimming Conditions | SwimLoading');
  assert.ok(!/Today/.test(t));
});

test('a stale reading does NOT say Today', () => {
  // Simons Town: 149 hours old — the exact page that was lying.
  const t = spotTitle('Simons Town', fresh(149));
  assert.ok(!/Today/.test(t));
  assert.match(t, /Water Temperature & Swimming Conditions/);
});

test('no reading promises no temperature at all', () => {
  // Promising a temperature the page cannot show wastes the click.
  const t = spotTitle('Muizenberg', noReading);
  assert.equal(t, 'Muizenberg Swimming Conditions | SwimLoading');
  assert.ok(!/Today/.test(t));
  assert.ok(!/Temperature/.test(t));
});

test('a missing freshness object is treated as no reading, not as fresh', () => {
  // Defaulting to the strongest claim on absent data is how the original
  // bug behaved. Absence must fail closed.
  assert.ok(!/Today/.test(spotTitle('Anywhere', null)));
  assert.ok(!/Today/.test(spotTitle('Anywhere', undefined)));
});

test('a future timestamp cannot manufacture Today', () => {
  const future = getTemperatureFreshness(new Date(NOW.getTime() + 3_600_000), { now: NOW });
  assert.ok(!/Today/.test(spotTitle('Clock Fault Bay', future)));
});

// ── meta description semantics ─────────────────────────────────────────

const descOpts = { spotName: 'Simons Town', locationLabel: 'False Bay', waterType: 'OCEAN' };

test('the description matches the title’s freshness claim', () => {
  assert.match(spotMetaDescription(fresh(1), descOpts), /^Today's ocean temperature at Simons Town, False Bay\./);
  assert.match(spotMetaDescription(fresh(7.3), descOpts), /^Recent ocean temperature/);
  assert.match(spotMetaDescription(fresh(149), descOpts), /^Last recorded ocean temperature/);
});

test('descriptions never say Live, Current or Today over stale data', () => {
  for (const h of [7.3, 149, 900]) {
    const d = spotMetaDescription(fresh(h), descOpts);
    assert.ok(!/\bLive\b/i.test(d), `"Live" leaked at ${h}h`);
    assert.ok(!/\bCurrent\b/i.test(d), `"Current" leaked at ${h}h`);
    assert.ok(!/\bToday/i.test(d), `"Today" leaked at ${h}h`);
  }
});

test('a spot with no reading describes what it does have', () => {
  const d = spotMetaDescription(noReading, descOpts);
  assert.ok(!/Today|Live|Current|Last recorded/i.test(d));
  assert.match(d, /Swimming conditions, location and water temperature history/);
});

test('a pool description uses pool wording and pool community framing', () => {
  const d = spotMetaDescription(fresh(1), { ...descOpts, spotName: 'Tooting Bec Lido', isPool: true });
  assert.match(d, /Today's pool temperature/);
  assert.match(d, /SwimLoading swimming community/);
});

test('water type changes the noun without changing the freshness rule', () => {
  assert.match(spotMetaDescription(fresh(1), { ...descOpts, waterType: 'LAKE' }), /Today's lake temperature/);
  assert.match(spotMetaDescription(fresh(149), { ...descOpts, waterType: 'LAGOON' }), /Last recorded lagoon temperature/);
});

// ── visible label semantics ────────────────────────────────────────────

test('the visible heading never calls a stale reading current', () => {
  assert.equal(waterTemperatureLabel({ observedAt: hoursAgo(1), now: NOW }).label, 'Water temperature');
  assert.equal(waterTemperatureLabel({ observedAt: hoursAgo(7.3), now: NOW }).label, 'Recent water temperature');
  assert.equal(waterTemperatureLabel({ observedAt: hoursAgo(149), now: NOW }).label, 'Last recorded water temperature');
  for (const h of [7.3, 149]) {
    assert.equal(waterTemperatureLabel({ observedAt: hoursAgo(h), now: NOW }).isCurrent, false);
  }
});

// ── indexability must not depend on a sensor ───────────────────────────

test('a useful spot stays indexable with no temperature at all', () => {
  // Sensor availability is not the same as page usefulness. Boulders
  // Beach with a stale log is still a real named beach with coordinates,
  // an area and a water type — it answers the query it ranks for.
  const noTemp = {
    name: 'Muizenberg', latitude: -34.1, longitude: 18.47, country_code: 'ZA',
    water_type: 'OCEAN', area: 'False Bay', temp_c: null, temp_observed_at: null,
    estimate_c: 14.2, active: true,
  };
  assert.equal(isPublicPageIndexable(noTemp, 'spot', { now: NOW }).indexable, true);
});

test('a spot with neither reading, estimate nor context is still held back', () => {
  const thin = {
    name: 'Unknown Water', latitude: -34.1, longitude: 18.47, country_code: 'ZA',
    water_type: 'OCEAN', temp_c: null, temp_observed_at: null, estimate_c: null,
    area: null, meet_note: null, active: true,
  };
  assert.equal(isPublicPageIndexable(thin, 'spot', { now: NOW }).indexable, false);
});

// ── spot analytics ─────────────────────────────────────────────────────

const SPOT = {
  id: 's-1', slug: 'simons-town', name: 'Simons Town', country_code: 'ZA',
  region: 'false-bay', water_type: 'OCEAN', freshness_state: 'stale',
};

test('the spot payload carries the freshness state we want to measure', () => {
  const p = spotEventPayload(SPOT);
  assert.equal(p.spot_id, 's-1');
  assert.equal(p.slug, 'simons-town');
  assert.equal(p.spot_name, 'Simons Town');
  assert.equal(p.country, 'ZA');
  assert.equal(p.water_type, 'OCEAN');
  // The whole point: can we later compare conversion on stale vs live pages?
  assert.equal(p.temperature_freshness_state, 'stale');
});

test('unknown spot properties are omitted rather than sent empty', () => {
  const p = spotEventPayload({ id: 's-2', slug: 'x', name: 'X' });
  for (const v of Object.values(p)) assert.ok(v !== null && v !== '' && v !== undefined);
  assert.ok(!('country' in p));
});

test('spot events are named consistently with crossing events', () => {
  assert.equal(SPOT_EVENTS.pageView, 'spot_page_view');
  assert.equal(SPOT_EVENTS.exploreClick, 'spot_explore_click');
  assert.equal(SPOT_EVENTS.signupClick, 'spot_signup_click');
  assert.equal(SPOT_EVENTS.loginClick, 'spot_login_click');
  // Same four concepts on both page types, so one report can span them.
  assert.deepEqual(Object.keys(SPOT_EVENTS), Object.keys(CROSSING_EVENTS));
});

test('spots reuse the crossing attribution key — one mechanism, not two', () => {
  const s = spotAnalyticsScript(SPOT);
  assert.ok(s.includes(ATTRIBUTION_KEY));
  assert.match(s, /"src":"spot"/);
  assert.match(s, /spot_page_view/);
  // Same safety contract as increment 4.
  assert.match(s, /typeof gtag === 'function'/);
  assert.ok(!s.includes('preventDefault'));
});

test('first-touch attribution records which spot brought the visitor', () => {
  const s = spotAnalyticsScript(SPOT);
  assert.match(s, /"slug":"simons-town"/);
  // Only written when absent — first touch wins over last.
  assert.match(s, /if \(!localStorage\.getItem\(CFG\.key\)\)/);
});

test('logged history keeps an inland pool indexable when no model covers it', () => {
  // Virgin Active Hillcrest: 17 logged readings, none recent, and pools
  // get no marine model. The page still shows a real temperature history.
  const poolWithHistory = {
    name: 'Virgin Active Hillcrest', latitude: -29.8, longitude: 30.75,
    country_code: 'ZA', water_type: 'POOL', area: null, meet_note: null,
    temp_c: null, temp_observed_at: null, estimate_c: null,
    has_readings: true, active: true,
  };
  const v = isPublicPageIndexable(poolWithHistory, 'spot', { now: NOW });
  assert.equal(v.indexable, true);
  assert.match(v.reasons.join(' '), /history/);
});

test('a null estimate is not treated as an estimate of zero degrees', () => {
  // Number(null) === 0, and 0 is finite — so a spot with no estimate used
  // to pass the gate on a value that did not exist.
  const nothing = {
    name: 'Empty Pool', latitude: -33.9, longitude: 18.4, country_code: 'ZA',
    water_type: 'POOL', area: null, meet_note: null,
    temp_c: null, temp_observed_at: null, estimate_c: null,
    has_readings: false, active: true,
  };
  assert.equal(isPublicPageIndexable(nothing, 'spot', { now: NOW }).indexable, false);
  // ...but a genuine zero-degree estimate must still count.
  assert.equal(isPublicPageIndexable({ ...nothing, estimate_c: 0 }, 'spot', { now: NOW }).indexable, true);
});

// ── spot Explore + nearby events ───────────────────────────────────────

test('a spot Explore link uses Explore’s own contract and its area label', async () => {
  const { exploreUrlForSpot, exploreCtaTextForSpot } = await import('../api/_lib/nearby.js');
  const spot = { name: 'Muizenberg', area: 'False Bay', country_code: 'ZA' };
  const q = new URLSearchParams(exploreUrlForSpot(spot).split('?')[1]);
  assert.equal(q.get('country'), 'ZA');
  assert.equal(q.get('place_label'), 'False Bay');
  assert.equal(exploreCtaTextForSpot(spot), 'Explore swims around False Bay');
});

test('a spot with no country gets bare /explore, never country=null', async () => {
  const { exploreUrlForSpot } = await import('../api/_lib/nearby.js');
  const url = exploreUrlForSpot({ name: 'Nowhere' });
  assert.equal(url, '/explore');
  assert.ok(!/null|undefined/.test(url));
});

test('nearby events for a spot are bounded, upcoming and indexable only', async () => {
  const { nearbyEventsQueryForSpot } = await import('../api/_lib/nearby.js');
  const q = nearbyEventsQueryForSpot({ latitude: -34.1, longitude: 18.47, country_code: 'ZA' }, '2026-08-17');
  assert.match(q, /is_indexable=eq\.true/);
  assert.match(q, /start_date=gte\.2026-08-17/);
  assert.match(q, /event_venues\.latitude=gte\./);
  // A spot page is a "where do I swim this week" page, so its radius is
  // tighter than a crossing's.
  const { NEARBY_LIMITS } = await import('../api/_lib/nearby.js');
  assert.ok(NEARBY_LIMITS.spotEventRadiusKm < NEARBY_LIMITS.eventRadiusKm);
});

test('a spot with neither coordinates nor country queries nothing', async () => {
  const { nearbyEventsQueryForSpot } = await import('../api/_lib/nearby.js');
  assert.equal(nearbyEventsQueryForSpot({ name: 'Unknown' }), null);
  // 0,0 is the Atlantic, not a missing value — treat it as missing.
  assert.equal(nearbyEventsQueryForSpot({ latitude: 0, longitude: 0 }), null);
});

// ── measured readings and freshness ────────────────────────────────────
// A buoy can earn a page its "Today", but only when it is close enough
// that its number describes THIS water.

test('a live local buoy beats a stale swimmer log', async () => {
  const { preferredFreshness } = await import('../api/_lib/temperature-freshness.js');
  // Boscombe, 2026-08-19: swimmer log days old, buoy 1 km away read 4.9h ago.
  // The first version of this rule showed "Swimming Conditions" here.
  const chosen = preferredFreshness(fresh(200), fresh(4.9));
  assert.equal(chosen.canSayToday, true);
});

test('a swimmer in the water outranks a buoy when both are current', async () => {
  const { preferredFreshness } = await import('../api/_lib/temperature-freshness.js');
  const swimmer = fresh(1);
  assert.equal(preferredFreshness(swimmer, fresh(2)), swimmer);
});

test('with no nearby instrument the swimmer verdict stands unchanged', async () => {
  const { preferredFreshness } = await import('../api/_lib/temperature-freshness.js');
  const swimmer = fresh(200);
  assert.equal(preferredFreshness(swimmer, null), swimmer);
});

test('a measured reading is used when there is no swimmer log at all', async () => {
  const { preferredFreshness } = await import('../api/_lib/temperature-freshness.js');
  const measured = fresh(1);
  assert.equal(preferredFreshness(noReading, measured), measured);
});

test('neither current: a present swimmer reading is still preferred', async () => {
  const { preferredFreshness } = await import('../api/_lib/temperature-freshness.js');
  const swimmer = fresh(100);
  assert.equal(preferredFreshness(swimmer, fresh(50)), swimmer);
});

test('the distance threshold excludes offshore buoys from claiming today', async () => {
  const { NEARBY_MEASUREMENT_TODAY_KM } = await import('../api/spots-handler.js');
  // Real link set on 2026-08-19: La Jolla 1.1 km and Aquatic Park 9.6 km
  // describe their beaches; Dover's 15.2 km and English Bay's 14.3 km do not.
  assert.ok(NEARBY_MEASUREMENT_TODAY_KM >= 9.6, 'must keep Aquatic Park');
  assert.ok(NEARBY_MEASUREMENT_TODAY_KM < 14.3, 'must exclude English Bay');
});
