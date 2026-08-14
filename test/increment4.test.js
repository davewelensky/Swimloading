// Increment 4 — analytics payloads, nearby-content relevance, Explore
// context, the event quality gate, and the distance/temperature label
// semantics.
//
// These are the rules that decide what a swimmer is TOLD, so they are
// tested as pure functions rather than through a rendered page: a label
// that says "current" over a seasonal average, or a "nearby" list built
// from a pool 200 km inland, is a correctness bug and should fail here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isPublicPageIndexable, robotsFor, INDEXABILITY_RULES } from '../api/_lib/indexability.js';
import { waterTemperatureLabel } from '../api/_lib/temperature-freshness.js';
import { crossingEventPayload, CROSSING_EVENTS, ATTRIBUTION_KEY, crossingAnalyticsScript } from '../api/_lib/public-analytics.js';
import {
  boundingBox, isRelevantSpot, rankNearbySpots, rankRelatedCrossings,
  exploreUrlForCrossing, exploreCtaText, crossingAnchor,
  nearbySpotsQuery, nearbyEventsQuery, SPOT_RELEVANCE_TIERS,
} from '../api/_lib/nearby.js';

const NOW = new Date('2026-08-14T09:00:00Z');

const CROSSING = {
  id: 'c-1', slug: 'false-bay', name: 'False Bay Crossing',
  connects: 'South Africa — Simon’s Town ↔ Gordon’s Bay', country_code: 'ZA',
  anchor_lat: -34.23, anchor_lng: 18.47,
  start_location: "Miller's Point (Simon's Town)", end_location: "Gordon's Bay",
};

// ── analytics payloads ─────────────────────────────────────────────────

test('crossing event payload carries the identifiers a report needs', () => {
  const p = crossingEventPayload(CROSSING);
  assert.equal(p.crossing_id, 'c-1');
  assert.equal(p.slug, 'false-bay');
  assert.equal(p.crossing_name, 'False Bay Crossing');
  assert.equal(p.country, 'ZA');
  assert.equal(p.region, CROSSING.connects);
});

test('unknown properties are omitted, never sent as null or empty', () => {
  // An empty string in a GA4 dimension is indistinguishable from a real
  // value later, which quietly poisons the evidence for the next increment.
  const p = crossingEventPayload({ id: 'c-2', slug: 'x', name: 'X' }, { referrer: '', landing_page: undefined });
  assert.ok(!('country' in p));
  assert.ok(!('region' in p));
  assert.ok(!('referrer' in p));
  assert.ok(!('landing_page' in p));
  for (const v of Object.values(p)) assert.ok(v !== null && v !== '' && v !== undefined);
});

test('extra properties are merged over the base payload', () => {
  const p = crossingEventPayload(CROSSING, { landing_page: '/crossings/false-bay', cta_location: 'nav' });
  assert.equal(p.landing_page, '/crossings/false-bay');
  assert.equal(p.cta_location, 'nav');
});

test('the four crossing events are named and stable', () => {
  assert.equal(CROSSING_EVENTS.pageView, 'crossing_page_view');
  assert.equal(CROSSING_EVENTS.exploreClick, 'crossing_explore_click');
  assert.equal(CROSSING_EVENTS.signupClick, 'crossing_signup_click');
  assert.equal(CROSSING_EVENTS.loginClick, 'crossing_login_click');
});

test('the analytics script guards gtag and never blocks a click', () => {
  const s = crossingAnalyticsScript(CROSSING);
  assert.match(s, /typeof gtag === 'function'/);
  // Every send path is wrapped; a thrown analytics error must not swallow
  // navigation, so preventDefault must appear nowhere.
  assert.ok(!s.includes('preventDefault'));
  assert.match(s, /catch/);
  // The app reads this exact key at signup.
  assert.ok(s.includes(ATTRIBUTION_KEY));
});

// ── temperature semantics ──────────────────────────────────────────────

test('a seasonal range is labelled typical, never current', () => {
  const l = waterTemperatureLabel({ hasTypicalRange: true });
  assert.equal(l.label, 'Typical water temperature');
  assert.equal(l.isCurrent, false);
  assert.equal(l.state, 'typical');
});

test('a fresh reading still beats the typical label', () => {
  const l = waterTemperatureLabel({ observedAt: new Date(NOW.getTime() - 3600_000), hasTypicalRange: true, now: NOW });
  assert.equal(l.state, 'live');
  assert.equal(l.isCurrent, true);
});

test('a stale reading is never called current even with no typical range', () => {
  const l = waterTemperatureLabel({ observedAt: new Date(NOW.getTime() - 30 * 86_400_000), now: NOW });
  assert.equal(l.isCurrent, false);
  assert.match(l.label, /Last recorded/);
});

test('no reading and no range says so rather than inventing a label', () => {
  assert.equal(waterTemperatureLabel({}).state, 'unavailable');
});

// ── nearby relevance ───────────────────────────────────────────────────

test('pools are excluded from an open-water crossing, not merely ranked last', () => {
  // A gym pool is often the CLOSEST water to a coastal crossing, which is
  // exactly why proximity alone is the wrong rule.
  assert.equal(isRelevantSpot({ name: 'Virgin Active Claremont', water_type: 'POOL', latitude: -34.2, longitude: 18.5 }, CROSSING), false);
  assert.ok(!('POOL' in SPOT_RELEVANCE_TIERS));
});

test('the crossing’s own endpoints are not offered back as discoveries', () => {
  assert.equal(isRelevantSpot({ name: 'Gordons Bay', water_type: 'OCEAN' }, CROSSING), false);
  assert.equal(isRelevantSpot({ name: 'Millers Point', water_type: 'OCEAN' }, CROSSING), false);
});

test('ocean outranks lake even when the lake is closer', () => {
  const ranked = rankNearbySpots([
    { name: 'Nearer Lake', water_type: 'LAKE', latitude: -34.24, longitude: 18.47 },
    { name: 'Further Ocean', water_type: 'OCEAN', latitude: -34.40, longitude: 18.47 },
  ], CROSSING, crossingAnchor(CROSSING));
  assert.equal(ranked[0].name, 'Further Ocean');
});

test('spots beyond the radius are dropped', () => {
  const ranked = rankNearbySpots([
    { name: 'Durban Surf', water_type: 'OCEAN', latitude: -29.85, longitude: 31.04 },
  ], CROSSING, crossingAnchor(CROSSING));
  assert.equal(ranked.length, 0);
});

test('a bounding box widens with latitude so high-latitude spots are not missed', () => {
  const equator = boundingBox(0, 0, 100);
  const dover = boundingBox(51.1, 1.3, 100);
  const lngSpan = (b) => b.maxLng - b.minLng;
  assert.ok(lngSpan(dover) > lngSpan(equator));
});

test('an anchor of 0,0 is treated as missing, not as a point in the Atlantic', () => {
  assert.equal(crossingAnchor({ anchor_lat: 0, anchor_lng: 0 }), null);
  assert.equal(crossingAnchor({}), null);
  assert.deepEqual(crossingAnchor(CROSSING), { lat: -34.23, lng: 18.47 });
});

test('related crossings prefer the same country and never include self', () => {
  const all = [
    { slug: 'false-bay', name: 'False Bay Crossing', country_code: 'ZA', intro: 'x' },
    { slug: 'robben-island', name: 'Robben Island', country_code: 'ZA', intro: 'x' },
    { slug: 'cook-strait', name: 'Cook Strait', country_code: 'NZ', intro: 'x' },
  ];
  const r = rankRelatedCrossings(all, CROSSING);
  assert.ok(!r.some((x) => x.slug === 'false-bay'));
  assert.equal(r[0].slug, 'robben-island');
});

test('crossings with no page content are never suggested', () => {
  const r = rankRelatedCrossings([{ slug: 'custom-marathon-swim', name: 'Custom', intro: null }], CROSSING);
  assert.equal(r.length, 0);
});

// ── Explore context ────────────────────────────────────────────────────

test('the Explore link carries country and label using Explore’s own contract', () => {
  const url = exploreUrlForCrossing(CROSSING);
  assert.match(url, /^\/explore\?/);
  const q = new URLSearchParams(url.split('?')[1]);
  assert.equal(q.get('country'), 'ZA');
  assert.equal(q.get('place_label'), CROSSING.connects);
});

test('a crossing with no country gets bare /explore, never country=null', () => {
  // A link carrying the literal string "null" searches for a country named
  // "null" and returns nothing — a failure this codebase has had before.
  const url = exploreUrlForCrossing({ slug: 'x', name: 'X' });
  assert.equal(url, '/explore');
  assert.ok(!url.includes('null'));
  assert.ok(!url.includes('undefined'));
});

test('the Explore CTA reads as a place, not as a filter', () => {
  assert.equal(exploreCtaText(CROSSING), `Explore swims around ${CROSSING.connects}`);
});

// ── nearby queries are DB-side ─────────────────────────────────────────

test('an anchored crossing queries by bounding box, not by fetching everything', () => {
  const q = nearbySpotsQuery(CROSSING);
  assert.match(q, /latitude=gte\./);
  assert.match(q, /longitude=lte\./);
  assert.match(q, /water_type=in\./);
  assert.match(q, /limit=/);
});

test('an unanchored crossing falls back to country, and one with neither queries nothing', () => {
  const q = nearbySpotsQuery({ slug: 'x', name: 'X', country_code: 'JP' });
  assert.match(q, /country_code=eq\.JP/);
  assert.equal(nearbySpotsQuery({ slug: 'x', name: 'X' }), null);
  assert.equal(nearbyEventsQuery({ slug: 'x', name: 'X' }), null);
});

test('nearby events ask only for upcoming, indexable listings', () => {
  const q = nearbyEventsQuery(CROSSING, '2026-08-14');
  assert.match(q, /is_indexable=eq\.true/);
  assert.match(q, /start_date=gte\.2026-08-14/);
});

// ── event quality gate ─────────────────────────────────────────────────

const GOOD_EVENT = {
  slug: 'midmar-mile-2027', title: 'Midmar Mile', start_date: '2027-02-13',
  date_precision: 'exact', status: 'announced', discipline: 'open_water',
  verification_tier: 'listed', is_indexable: true,
  venue: { country_code: 'ZA', latitude: -29.5, longitude: 30.2 },
};

test('a complete, upcoming, verified event is indexable', () => {
  const v = isPublicPageIndexable(GOOD_EVENT, 'event', { now: NOW });
  assert.equal(v.indexable, true);
  assert.equal(robotsFor(v), 'index,follow');
});

test('a raw discovery candidate is never indexed', () => {
  const v = isPublicPageIndexable({ ...GOOD_EVENT, verification_tier: 'unverified' }, 'event', { now: NOW });
  assert.equal(v.indexable, false);
  assert.match(v.reasons.join(' '), /verification tier/);
});

test('a date too vague to act on fails the gate', () => {
  for (const p of ['month', 'year']) {
    assert.equal(isPublicPageIndexable({ ...GOOD_EVENT, date_precision: p }, 'event', { now: NOW }).indexable, false);
  }
  // A multi-day festival is still actionable.
  assert.equal(isPublicPageIndexable({ ...GOOD_EVENT, date_precision: 'range' }, 'event', { now: NOW }).indexable, true);
});

test('an event with no location fails, however good the rest is', () => {
  const v = isPublicPageIndexable({ ...GOOD_EVENT, venue: {}, venue_id: null }, 'event', { now: NOW });
  assert.equal(v.indexable, false);
  assert.match(v.missing.join(' '), /location/);
});

test('cancelled and finished events are excluded', () => {
  assert.equal(isPublicPageIndexable({ ...GOOD_EVENT, status: 'cancelled' }, 'event', { now: NOW }).indexable, false);
  const past = { ...GOOD_EVENT, start_date: '2026-08-01', end_date: '2026-08-02' };
  assert.equal(isPublicPageIndexable(past, 'event', { now: NOW }).indexable, false);
});

test('a festival running across today is still indexable', () => {
  // Compared on end_date, so a multi-day event is not dropped on its
  // middle morning.
  const spanning = { ...GOOD_EVENT, start_date: '2026-08-13', end_date: '2026-08-16' };
  assert.equal(isPublicPageIndexable(spanning, 'event', { now: NOW }).indexable, true);
});

test('an explicit editorial opt-out always wins', () => {
  assert.equal(isPublicPageIndexable({ ...GOOD_EVENT, is_indexable: false }, 'event', { now: NOW }).indexable, false);
});

test('failing the event gate is noindex,FOLLOW — the page still passes link equity', () => {
  const v = isPublicPageIndexable({ ...GOOD_EVENT, verification_tier: 'unverified' }, 'event', { now: NOW });
  assert.equal(robotsFor(v), 'noindex,follow');
});

test('the event rules are declared, not scattered through the code', () => {
  assert.deepEqual(INDEXABILITY_RULES.event.usableDatePrecision, ['exact', 'range']);
  assert.ok(INDEXABILITY_RULES.event.excludedVerificationTiers.includes('unverified'));
});
