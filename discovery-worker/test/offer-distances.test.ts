import { test } from 'node:test';
import assert from 'node:assert/strict';
import { distanceOptionsFromOffers } from '../src/normalize/distance.js';

// Every fixture below is the real `offers` shape from a page we crawl,
// copied from the live JSON-LD. The bug this covers: distances were read
// only from HTML selectors, so an event whose distances live in schema.org
// offers stored none at all.

// active.com, Swimjunkie Challenge Caramoan — the case that surfaced this.
// Five swim distances plus an accommodation bundle in the same array.
const CARAMOAN = [
  { '@type': 'Offer', name: 'SWIM DISTANCE - 2Km Swim', price: 5000, priceCurrency: 'PHP', url: 'https://example.test/reg' },
  { '@type': 'Offer', name: 'SWIM DISTANCE - 5KM Island Swim', price: 6300, priceCurrency: 'PHP', url: 'https://example.test/reg' },
  { '@type': 'Offer', name: 'SWIM DISTANCE - 10KM Island Swim', price: 7500, priceCurrency: 'PHP', url: 'https://example.test/reg' },
  { '@type': 'Offer', name: 'SWIM DISTANCE - 15Km Island Swim', price: 8000, priceCurrency: 'PHP', url: 'https://example.test/reg' },
  { '@type': 'Offer', name: 'SWIM DISTANCE - MARATHON 20', price: 15800, priceCurrency: 'PHP', url: 'https://example.test/reg' },
  {
    '@type': 'Offer',
    name: 'GROUP REGISTERED. Accommodations for those who booked as groups. - Accommodations for 9+1 and 10+1 Registrants',
    price: 0,
    priceCurrency: 'PHP',
    url: 'https://example.test/reg',
  },
];

test('reads swim distances out of schema.org offers', () => {
  const out = distanceOptionsFromOffers(CARAMOAN);
  const metres = out.map((d) => d.distanceMetres);
  assert.deepEqual(metres, [2000, 5000, 10000, 15000, null]);
});

test('keeps an entry option whose distance is unreadable, without guessing it', () => {
  const out = distanceOptionsFromOffers(CARAMOAN);
  const marathon = out.find((d) => d.originalLabel.includes('MARATHON'));
  // The page body says 20 km, but the offer name says only "20". Recording
  // 20000 here would be inventing the unit — the label is kept, the number
  // stays unknown, and buildCandidateEvent warns a reviewer.
  assert.ok(marathon);
  assert.equal(marathon.distanceMetres, null);
});

test('drops offers that are not entry distances', () => {
  const out = distanceOptionsFromOffers(CARAMOAN);
  assert.equal(
    out.some((d) => d.originalLabel.includes('Accommodations')),
    false
  );
});

// oceanswims.com — one offer, and it is not a distance. Before the sibling
// rule this was the shape that made "read the offers" look unsafe.
test('returns nothing when no offer states a distance', () => {
  assert.deepEqual(distanceOptionsFromOffers([{ '@type': 'Offer', name: 'General Admission' }]), []);
});

// active.com, Kukio Blue Water Swim — offers are entry TYPES, not
// distances. No sibling states a distance, so the group is not a menu.
test('does not treat entry types as distances', () => {
  const out = distanceOptionsFromOffers([
    { name: 'Kukio Blue Water Swim - Open' },
    { name: 'Kukio Blue Water Swim - Assist' },
  ]);
  assert.deepEqual(out, []);
});

// active.com, XTERRA Greece — the distance sits in the prefix and the
// suffix is the age category, the mirror image of Caramoan. Combo entries
// ("10k & 0,2k") resolve to a distance already listed and are collapsed.
test('collapses combo and duplicate entries to one row per distance', () => {
  const out = distanceOptionsFromOffers([
    { name: 'Open water swim-10k - Individual Age group/open' },
    { name: 'Open water swim-5 km - Individual Age group/open' },
    { name: 'Open water swim-2,5k - Individual Age group/open' },
    { name: 'Open water swim-10k & 0,2k - Individual Age group/open' },
    { name: 'Open water swim-5k & 0,2k - Individual Age group/open' },
  ]);
  assert.deepEqual(
    out.map((d) => d.distanceMetres),
    [10000, 5000, 2500]
  );
});

test('carries the offer registration url onto each distance', () => {
  const out = distanceOptionsFromOffers(CARAMOAN);
  assert.equal(out[0]?.registrationUrl, 'https://example.test/reg');
});

test('tolerates a single offer object, a missing array, and junk', () => {
  assert.deepEqual(distanceOptionsFromOffers(null), []);
  assert.deepEqual(distanceOptionsFromOffers(undefined), []);
  assert.deepEqual(distanceOptionsFromOffers([]), []);
  assert.deepEqual(distanceOptionsFromOffers(['not an object', 42, null]), []);
  assert.equal(distanceOptionsFromOffers({ name: '5km Swim' }).length, 1);
});
