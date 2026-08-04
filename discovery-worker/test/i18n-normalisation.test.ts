import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCandidateKey, normaliseForKey } from '../src/domain/candidate-key.js';
import { jaccardSimilarity, nameTokens, normalizeName } from '../src/dedupe/normalize-name.js';
import { AMBIGUOUS_MONTH_TOKENS, parseFreeTextDate, parseYearlessDate } from '../src/normalize/date.js';
import { parseDistanceToMetres } from '../src/normalize/distance.js';

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

// ─────────────────────────────────────────────────────────────────────────
// Multilingual dates and distances, added 2026-08-04.
//
// These are regressions, not hypotheticals. The AI extractor was run
// end-to-end against the live French federation calendar and every event
// came back wrong in two ways at once: "09 août 2026" became 1 January
// 2026 marked CONFIRMED (the month table was English-only, so parsing fell
// through to the year-only branch with no warning), and "2.4 Kms" parsed
// as null (the unit regex required a word boundary straight after "m",
// which a plural "s" prevents). Both would have published silently wrong
// data at scale, across 32 non-English sources.
// ─────────────────────────────────────────────────────────────────────────

test('a full date is read in every language we crawl, not just English', () => {
  const cases: [string, string][] = [
    ['09 août 2026', '2026-08-09'],           // French — the one that broke
    ['15 maart 2026', '2026-03-15'],           // Dutch
    ['9 sierpnia 2026', '2026-08-09'],         // Polish (genitive)
    ['15. elokuuta 2026', '2026-08-15'],       // Finnish (genitive + trailing period)
    ['15. August 2026', '2026-08-15'],         // German (trailing period)
    ['9 Ağustos 2026', '2026-08-09'],          // Turkish
    ['3 marzo 2026', '2026-03-03'],            // Italian / Spanish
    ['12 Οκτωβρίου 2026', '2026-10-12'],       // Greek (own script, genitive)
    ['2026年8月15日', '2026-08-15'],            // Japanese (numeric, no month word)
    ['15. studenog 2026', '2026-11-15'],       // Croatian
  ];
  for (const [text, expected] of cases) {
    const result = parseFreeTextDate(text);
    assert.equal(result.startDate, expected, `${text} should parse to ${expected}`);
    assert.equal(result.datePrecision, 'exact', `${text} should be exact, not degraded`);
    assert.equal(result.dateConfirmed, true);
  }
});

test('a month name two languages disagree about is refused, not guessed', () => {
  // "listopad" is November in Polish and October in Croatian, and both are
  // live sources. Half a chance of being a month wrong is not a date.
  assert.ok(AMBIGUOUS_MONTH_TOKENS.has('listopad'));

  const result = parseFreeTextDate('listopad 2026');
  assert.equal(result.startDate, null);
  assert.equal(result.dateConfirmed, false);
  assert.match(result.warnings.join(' '), /different months in different languages/);
});

test('a year-only fallback says so when the text clearly stated more', () => {
  // The silent version of this is how "09 août 2026" reached a reviewer
  // looking like a clean year-precision date.
  const result = parseFreeTextDate('09 quelquechose 2026');
  assert.equal(result.datePrecision, 'year');
  assert.match(result.warnings.join(' '), /appears to state a fuller date/);

  // A genuine year-only date stays clean — no warning to cry wolf with.
  assert.deepEqual(parseFreeTextDate('2026').warnings, []);
});

test('a non-English weekday still verifies the year', () => {
  // The weekday is what makes a yearless date checkable rather than
  // assumed; without local weekday names every foreign calendar row could
  // only ever be unconfirmed.
  const fi = parseYearlessDate('lauantai 14 helmikuuta', 2026);
  assert.equal(fi.startDate, '2026-02-14');
  assert.equal(fi.dateConfirmed, true);

  const it = parseYearlessDate('sabato 14 febbraio', 2026);
  assert.equal(it.startDate, '2026-02-14');
  assert.equal(it.dateConfirmed, true);
});

test('distances parse in the forms real organisers actually print', () => {
  const cases: [string, number | null][] = [
    ['1 Kms', 1000],              // French federation — the one that broke
    ['2.4 Kms', 2400],
    ['250 mètres', 250],
    ['2,4 km', 2400],             // European decimal comma
    ['5 kilómetros', 5000],       // Spanish
    ['10 kilometrów', 10000],     // Polish
    ['3 キロ', 3000],              // Japanese
    ['1.2 miles', 1931],
    ['750m', 750],
    ['3800', 3800],               // bare, unit-less data attribute
    ['half mile', null],          // no number — null, never a guess
  ];
  for (const [text, expected] of cases) {
    assert.equal(parseDistanceToMetres(text), expected, `${text} should parse to ${expected}`);
  }
});

test('kilometres are never read as metres', () => {
  // Ordering bug class: "5 km" contains an "m", so a metre-first parser
  // returns 5 instead of 5000 — a swim listed 1000x short.
  assert.equal(parseDistanceToMetres('5 km'), 5000);
  assert.equal(parseDistanceToMetres('5 m'), 5);
});
