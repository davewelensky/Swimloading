import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { deriveCanonicalName } from '../src/normalize/text.js';

// Regression tests for 2026-08-05, when listing-site furniture became the
// event NAME and therefore the SLUG — a permanent URL.

test('site domain suffixes are removed', () => {
  assert.equal(
    deriveCanonicalName('Lorne Pier to Pub – Ocean Swim in Lorne VIC | oceanswims.com'),
    'Lorne Pier to Pub'
  );
});

test('a trailing location and date are both removed', () => {
  assert.equal(
    deriveCanonicalName('Swimjunkie Challenge: CARAMOAN 2026 Year10 - Pili, Camarines Sur October 04, 2026'),
    'Swimjunkie Challenge: CARAMOAN 2026 Year10'
  );
  assert.equal(
    deriveCanonicalName('SWIM MIAMI 27 - Miami, FL April 11, 2027'),
    'SWIM MIAMI 27'
  );
  assert.equal(
    deriveCanonicalName('XTERRA Greece Open Water Swimming Challenge 2026 - Voula, Athens October 09 - 11, 2026'),
    'XTERRA Greece Open Water Swimming Challenge 2026'
  );
});

// PRECISION OVER RECALL. Over-trimming silently renames a real swim, and a
// wrong name is harder to spot than a verbose one.
test('a bare trailing year is part of the name and survives', () => {
  // "Woda Bydgoska 2026" is what the organiser calls it. Only a full
  // month+day+year is a date; a lone year is not.
  assert.equal(deriveCanonicalName('Woda Bydgoska 2026'), 'Woda Bydgoska 2026');
  assert.equal(deriveCanonicalName('Puchar Jeziora Lusowskiego 2026'), 'Puchar Jeziora Lusowskiego 2026');
});

test('hyphens and pipes inside real names are left alone', () => {
  const untouched = [
    'Bosphorus Cross-Continental Swim',
    'Preekstoel - Mykonos',
    'Robben Island Single (Island Escape)',
    'Baltimore Wet Weekend 2026 - 2K Sherkin Island Swim',
    '760 Freedom Swim',
    'Chapman\'s Peak Meander',
    '20. Grand Prix Wielkopolski w Pływaniu na Wodach Otwartych Finał',
  ];
  for (const name of untouched) {
    assert.equal(deriveCanonicalName(name), name, `"${name}" must not be altered`);
  }
});

test('a name that is ONLY furniture is not stripped to nothing', () => {
  // The guard: if a rule would eat almost the whole name, the name was not
  // what the rule assumed. Better verbose than mangled.
  const r = deriveCanonicalName('Swim - Miami, FL');
  assert.ok(r && r.length >= 4, `got ${JSON.stringify(r)}`);
});
