import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mergeLocations,
  parseJsonLdPlace,
  parseLocationText,
} from '../src/normalize/location.js';

// ─────────────────────────────────────────────────────────────────────────
// Regression, 2026-08-05. Six of the seven active.com venues published
// with no country_code at all, so Caramoan sat in the database while the
// Philippines read zero events — invisible to country chips, country hubs
// and country search.
//
// The cause was NOT that the pages omitted the country. Both gaps below
// were in our own parsing.
// ─────────────────────────────────────────────────────────────────────────

// Verbatim from https://www.active.com/miami-fl/.../swim-miami-27-2027 —
// note addressCountry is an empty string, not a missing key.
const SWIM_MIAMI_PLACE = {
  '@type': 'Place',
  name: 'Miami Marine Stadium',
  address: {
    '@type': 'PostalAddress',
    streetAddress: '3501 Rickenbacker Causeway',
    addressLocality: 'Miami',
    postalCode: '33149',
    addressRegion: 'FL',
    addressCountry: '',
  },
};

const CARAMOAN_PLACE = {
  '@type': 'Place',
  name: 'Four Beaches. Three Coral Fields. One Amazing Swim.',
  address: {
    '@type': 'PostalAddress',
    streetAddress: 'Caramoan Islands',
    addressLocality: 'Pili',
    addressRegion: 'Camarines Sur',
    addressCountry: 'Philippines',
  },
};

test('Gap A: a spelled-out country outside the old twelve-name list resolves', () => {
  // "Philippines" was on the page all along. The lookup was twelve
  // hand-typed entries and had never heard of it.
  assert.equal(parseJsonLdPlace(CARAMOAN_PLACE).countryCode, 'PH');

  // The other one that got away, plus a spread of shapes the generated
  // list has to handle: diacritics, "&" vs "and", "St." vs "Saint".
  assert.equal(parseLocationText('Voula, Athens, Greece').countryCode, 'GR');
  assert.equal(parseLocationText('Split, Croatia').countryCode, 'HR');
  assert.equal(parseLocationText('Abidjan, Côte d’Ivoire').countryCode, 'CI');
  assert.equal(parseLocationText('Castries, Saint Lucia').countryCode, 'LC');
  assert.equal(parseLocationText('Castries, St. Lucia').countryCode, 'LC');
  assert.equal(parseLocationText('Scarborough, Trinidad & Tobago').countryCode, 'TT');
  assert.equal(parseLocationText('Istanbul, Turkey').countryCode, 'TR');
  assert.equal(parseLocationText('Amsterdam, The Netherlands').countryCode, 'NL');

  // Still no invention where there is genuinely nothing to read.
  assert.equal(parseLocationText('Somewhere, Nowhereland').countryCode, null);
});

test('Gap A: a two-letter string is a country code only if ISO assigned it', () => {
  assert.equal(parseLocationText('Lisbon, PT').countryCode, 'PT');
  // "UK" is not an ISO code — GB is. It resolves by name, not by shape.
  assert.equal(parseLocationText('Plymouth, UK').countryCode, 'GB');
  // "XX" merely looks like one. Storing it would invent a country.
  assert.equal(parseLocationText('Nowhere, XX').countryCode, null);
});

test('Gap A: "Georgia" is resolved from a country field, refused from free text', () => {
  // A field that explicitly means country can be taken at its word.
  assert.equal(
    parseJsonLdPlace({ address: { addressCountry: 'Georgia', addressLocality: 'Batumi' } })
      .countryCode,
    'GE'
  );
  // A trailing comma segment cannot: Atlanta is not in the Caucasus.
  const atlanta = parseLocationText('Atlanta, Georgia');
  assert.equal(atlanta.countryCode, null);
  assert.ok(atlanta.warnings.some((w) => w.startsWith('Could not resolve a country')));
});

test('Gap B: the JSON-LD path infers the country from an explicit subdivision', () => {
  // addressRegion means "subdivision", so a state code in it is better
  // founded than the same code at the end of a comma-separated string —
  // but parseJsonLdPlace never consulted the lookup parseLocationText
  // already had. Four US venues published countryless because of it.
  const miami = parseJsonLdPlace(SWIM_MIAMI_PLACE, { utcOffset: '-04:00' });
  assert.equal(miami.countryCode, 'US');
  assert.equal(miami.city, 'Miami');
  assert.equal(miami.region, 'FL');

  assert.equal(
    parseJsonLdPlace({ address: { addressRegion: 'AK', addressLocality: 'SITKA' } }).countryCode,
    'US'
  );
  assert.equal(
    parseJsonLdPlace({ address: { addressRegion: 'BC', addressLocality: 'Kelowna' } }).countryCode,
    'CA'
  );

  // A stated country always wins over the inference.
  assert.equal(
    parseJsonLdPlace({ address: { addressRegion: 'CA', addressCountry: 'Italy' } }).countryCode,
    'IT'
  );
});

test('Gap B: the event’s own timezone stops Italian provinces becoming US states', () => {
  // Italy abbreviates its provinces exactly like US states — Como is
  // "CO", Milano "MI", Palermo "PA". Without a guard, an Italian swim
  // would publish as United States. The US and Canada are at a negative
  // UTC offset all year, so the event's own timestamp settles it.
  const como = parseJsonLdPlace(
    { address: { addressRegion: 'CO', addressLocality: 'Como' } },
    { utcOffset: '+02:00' }
  );
  assert.equal(como.countryCode, null);
  assert.ok(como.warnings.some((w) => w.includes('puts it elsewhere')));

  // Colorado, same code, plausible offset.
  assert.equal(
    parseJsonLdPlace(
      { address: { addressRegion: 'CO', addressLocality: 'Boulder' } },
      { utcOffset: '-06:00' }
    ).countryCode,
    'US'
  );

  // The same guard applies to free text — and having refused "CO" as
  // Colorado, it must not then read it as Colombia. Same guess, different
  // route.
  assert.equal(parseLocationText('Como, CO', { utcOffset: '+02:00' }).countryCode, null);
  assert.equal(parseLocationText('Boulder, CO', { utcOffset: '-06:00' }).countryCode, 'US');

  // The acknowledged cost: Morocco is refused too, because "MA" at
  // UTC+01:00 fits neither reading well enough to publish. Unset and
  // warned, never wrong.
  const casablanca = parseLocationText('Casablanca, MA', { utcOffset: '+01:00' });
  assert.equal(casablanca.countryCode, null);
  assert.ok(casablanca.warnings.some((w) => w.includes('fits neither reading')));

  // No offset on the page keeps the old behaviour rather than losing
  // every source that publishes no timezone.
  assert.equal(parseLocationText('Clearwater, FL').countryCode, 'US');
});

test('the JSON-LD path warns when it cannot resolve a country, instead of failing silently', () => {
  // The silence is why six countryless venues shipped unnoticed.
  const mystery = parseJsonLdPlace({ address: { addressLocality: 'Atlantis' } });
  assert.equal(mystery.countryCode, null);
  assert.ok(mystery.warnings.some((w) => w.startsWith('Could not resolve a country')));

  // And it stays quiet when it succeeds.
  assert.deepEqual(parseJsonLdPlace(CARAMOAN_PLACE).warnings, []);
});

test('merging drops a stale “could not resolve” warning once the country is known', () => {
  // A warning that contradicts the value actually stored trains people to
  // ignore warnings.
  const merged = mergeLocations(
    parseJsonLdPlace(CARAMOAN_PLACE),
    parseLocationText('Caramoan Islands')
  );
  assert.equal(merged.countryCode, 'PH');
  assert.equal(
    merged.warnings.some((w) => w.startsWith('Could not resolve a country')),
    false
  );

  // Still reported when neither parser worked it out.
  const stuck = mergeLocations(
    parseJsonLdPlace({ address: { addressLocality: 'Atlantis' } }),
    parseLocationText('Atlantis')
  );
  assert.equal(stuck.countryCode, null);
  assert.ok(stuck.warnings.some((w) => w.startsWith('Could not resolve a country')));
});
