import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCandidateKey, normaliseForKey } from '../src/domain/candidate-key.js';
import { jaccardSimilarity, nameTokens, normalizeName } from '../src/dedupe/normalize-name.js';

// The pre-Unicode rule, kept here verbatim as the compatibility contract:
// for pure-ASCII names the new normaliser must produce byte-identical
// output, so every existing ASCII-named candidate keeps its stored key.
function legacyAsciiNormalise(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
}

test('normaliseForKey is byte-identical to the legacy rule for ASCII names', () => {
  const asciiNames = [
    'Chillswim Coniston 5.25',
    'Rottnest Channel Swim 2027',
    "The Organiser's Big Swim — 10km!",
    'GO SWIM Windermere',
  ];
  for (const name of asciiNames) {
    assert.equal(normaliseForKey(name), legacyAsciiNormalise(name));
  }
});

test('diacritics fold instead of splitting the token', () => {
  assert.equal(normaliseForKey('Oceanman Gijón'), 'oceanman gijon');
  assert.equal(normaliseForKey('Traversée du Lac d’Annecy'), 'traversee du lac d annecy');
  assert.equal(normaliseForKey('aQuellé Midmar Mile'), 'aquelle midmar mile');
  // Turkish letters with combining decompositions fold (ğ→g, ç→c, ü→u)…
  assert.equal(normaliseForKey('Boğaziçi Yüzme'), 'bogazici yuzme');
  // …but dotless ı is its own letter (no decomposition) and is preserved,
  // not transliterated — stable and non-empty is the contract here.
  assert.equal(normaliseForKey('Kıtalararası'), 'kıtalararası');
});

test('non-Latin scripts survive normalisation instead of collapsing to empty', () => {
  assert.notEqual(normaliseForKey('Διάπλους Τορωναίου Κόλπου'), '');
  assert.notEqual(normaliseForKey('Заплыв через Волгу'), '');
  assert.notEqual(normaliseForKey('大阪オープンウォーター'), '');
  assert.notEqual(normaliseForKey('การแข่งขันว่ายน้ำ'), '');
});

test('two different Greek events on one page get different keys', () => {
  const shared = { sourceUrl: 'https://example.gr/events', startDate: '2027-07-01', dateConfirmed: true };
  const a = buildCandidateKey({ ...shared, name: 'Διάπλους Τορωναίου Κόλπου' });
  const b = buildCandidateKey({ ...shared, name: 'Κολύμβηση Ανοιχτής Θάλασσας' });
  assert.notEqual(a, b);
});

test('accented and unaccented spellings of one event share a key', () => {
  const shared = { sourceUrl: 'https://oceanmanswim.com/races/gijon', startDate: '2027-09-12', dateConfirmed: true };
  assert.equal(
    buildCandidateKey({ ...shared, name: 'Oceanman Gijón' }),
    buildCandidateKey({ ...shared, name: 'Oceanman Gijon' })
  );
});

test('dedupe name matching works across accents and non-Latin scripts', () => {
  const accented = nameTokens('Traversée du Lac');
  const plain = nameTokens('Traversee du Lac');
  assert.equal(jaccardSimilarity(accented, plain), 1);

  assert.notEqual(normalizeName('Заплыв через Волгу'), '');
  assert.equal(
    jaccardSimilarity(nameTokens('Заплыв через Волгу'), nameTokens('Заплыв через Волгу 2027')) > 0.5,
    true
  );
});
