import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCandidateKey, normaliseForKey } from '../src/domain/candidate-key.js';
import { jaccardSimilarity, nameTokens, normalizeName } from '../src/dedupe/normalize-name.js';
import { AMBIGUOUS_MONTH_TOKENS, dayFirstForCountry, findDateLikeStrings, parseFreeTextDate, parseYearlessDate } from '../src/normalize/date.js';
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

test('a date we could not read is refused, not stored as 1 January', () => {
  // This used to return year precision with a warning attached. Warning
  // and storing are not the same thing: a warning does not stop
  // publication, dateConfirmed does, and 136 candidates across nine
  // sources were stored on 1 January this way (2026-08-06). Every one
  // then looked like a past event, which is why Finland and the
  // Netherlands read as zero swims while their federations were
  // publishing full calendars.
  const result = parseFreeTextDate('09 quelquechose 2026');
  assert.equal(result.startDate, null);
  assert.equal(result.dateConfirmed, false);
  assert.equal(result.datePrecision, 'unknown');
  assert.match(result.warnings.join(' '), /refused rather than stored as 1 January/);

  // A genuine year-only date is still a real, if coarse, fact and is kept
  // — nothing else in the text was lost. No warning to cry wolf with.
  const yearOnly = parseFreeTextDate('2026');
  assert.equal(yearOnly.startDate, '2026-01-01');
  assert.equal(yearOnly.datePrecision, 'year');
  assert.deepEqual(yearOnly.warnings, []);
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

// ─────────────────────────────────────────────────────────────────────────
// Regression, 2026-08-06. Nine sources published nothing at all because
// their dates were wholly numeric — no month name for the tables above to
// look up — or written month-first. All fell through to the year-only
// branch and were stored as 1 January.
// ─────────────────────────────────────────────────────────────────────────

test('wholly numeric dates are read, dots and slashes alike', () => {
  const fi = { dayFirst: dayFirstForCountry('FI') };
  // Finland's federation: "3.10.2026" is 3 October, and was 1 January.
  assert.equal(parseFreeTextDate('3.10.2026', fi).startDate, '2026-10-03');
  assert.equal(parseFreeTextDate('23.05.2026', fi).startDate, '2026-05-23');
  // A weekday in any language sits in front of it harmlessly.
  assert.equal(parseFreeTextDate('sunnuntai 16.8.2026', fi).startDate, '2026-08-16');

  const range = parseFreeTextDate('10.8.2026 - 16.8.2026', fi);
  assert.equal(range.startDate, '2026-08-10');
  assert.equal(range.endDate, '2026-08-16');
  assert.equal(range.datePrecision, 'range');

  // A trailing TIME is not a second date — the Dutch agenda prints both.
  const nl = { dayFirst: dayFirstForCountry('NL') };
  const withTime = parseFreeTextDate('08/08/2026 - 00:00 t/m 23:45', nl);
  assert.equal(withTime.startDate, '2026-08-08');
  assert.equal(withTime.endDate, null);
  assert.equal(parseFreeTextDate('11/08/2026 - 19:30', nl).startDate, '2026-08-11');
});

test('day-first and month-first are decided by the source, never guessed', () => {
  // The numbers settle it themselves when one cannot be a month, whatever
  // the country: the 21st is the 21st everywhere.
  assert.equal(parseFreeTextDate('21/02/2026', {}).startDate, '2026-02-21');
  assert.equal(parseFreeTextDate('02/21/2026', {}).startDate, '2026-02-21');

  // When both readings are possible, the source's own country decides.
  assert.equal(parseFreeTextDate('10/07/2026', { dayFirst: dayFirstForCountry('AR') }).startDate, '2026-07-10');
  assert.equal(parseFreeTextDate('10/07/2026', { dayFirst: dayFirstForCountry('US') }).startDate, '2026-10-07');

  // And when nothing does, it is refused. A wrong date is published as
  // fact and nobody re-reads the source page.
  const orphan = parseFreeTextDate('10/07/2026', {});
  assert.equal(orphan.startDate, null);
  assert.equal(orphan.dateConfirmed, false);
  assert.match(orphan.warnings.join(' '), /day-first and month-first cannot be told apart/);

  assert.equal(dayFirstForCountry('US'), false);
  assert.equal(dayFirstForCountry('FI'), true);
  assert.equal(dayFirstForCountry(null), null);
});

test('month-first English dates are read', () => {
  // US Masters Swimming — the largest open-water body in the country that
  // supplies 44% of the catalogue — published zero events because every
  // pattern expected the day first.
  assert.equal(parseFreeTextDate('Saturday, Sep. 19, 2026', {}).startDate, '2026-09-19');
  assert.equal(parseFreeTextDate('Sunday, Oct. 18, 2026', {}).startDate, '2026-10-18');
  assert.equal(parseFreeTextDate('August 30th, 2026', {}).startDate, '2026-08-30');

  const range = parseFreeTextDate('March 6–8, 2026', {});
  assert.equal(range.startDate, '2026-03-06');
  assert.equal(range.endDate, '2026-03-08');

  // Day-first with a month name still works — these are additions, not
  // replacements, and "09 août 2026" is the case that started all this.
  assert.equal(parseFreeTextDate('09 août 2026', {}).startDate, '2026-08-09');
  assert.equal(parseFreeTextDate('12 September 2027', {}).startDate, '2027-09-12');
});

test('a yearless date is still refused, numeric or not', () => {
  // The oldest rule in this file: never infer a missing year.
  const nz = parseFreeTextDate('Thursday, 1 January', { dayFirst: dayFirstForCountry('NZ') });
  assert.equal(nz.startDate, null);
  assert.equal(nz.dateConfirmed, false);
  assert.equal(parseFreeTextDate('3.10.', {}).startDate, null);
});

test('a yearless month-first date with an ordinal is read', () => {
  // "Sunday August 9th" matched nothing while "Sunday 9th August" was read
  // fine: the month-first pattern ended in \b, and there is no word
  // boundary between "9" and "th". The whole EPIC Lakes Swim series sat
  // dateless in the queue because of it (found 2026-08-06 by Dave reading
  // the list, not by any test).
  //
  // The weekday is what confirms these — 9 August 2026 really is a Sunday,
  // so the year comes from the page and the date is checked, not assumed.
  for (const [text, expected] of [
    ['Sunday August 9th', '2026-08-09'],
    ['Saturday June 27th', '2026-06-27'],
    ['Sunday June 7th', '2026-06-07'],
  ] as [string, string][]) {
    const result = parseYearlessDate(text, 2026);
    assert.equal(result.startDate, expected, `${text} should resolve to ${expected}`);
    assert.equal(result.dateConfirmed, true);
  }

  // Day-first with an ordinal keeps working — this is an addition.
  assert.equal(parseYearlessDate('Sunday 9th August', 2026).startDate, '2026-08-09');
});

// ─────────────────────────────────────────────────────────────────────────
// Regression, 2026-08-06. Three more countries read as zero dated events
// for punctuation reasons alone: a comma before the year, and the "de"
// that Portuguese and Spanish put between the day and the month.
// ─────────────────────────────────────────────────────────────────────────

test('a comma before the year does not lose the date', () => {
  // NOWW publishes "zaterdag, 29 augustus, 2026". The pattern demanded
  // whitespace between month and year, so all 53 Dutch events were
  // dateless and the Netherlands read as zero swims.
  assert.equal(parseFreeTextDate('zaterdag, 29 augustus, 2026', {}).startDate, '2026-08-29');
  assert.equal(parseFreeTextDate('zondag, 6 september, 2026', {}).startDate, '2026-09-06');
  assert.equal(parseFreeTextDate('30 Agosto, 2026', {}).startDate, '2026-08-30');
  // Without the comma still works — this is an addition.
  assert.equal(parseFreeTextDate('09 août 2026', {}).startDate, '2026-08-09');
});

test('the Portuguese and Spanish "de" between day and month is read', () => {
  // "13 de Abril" — Brazil's whole calendar, 97 events, none with a date.
  assert.equal(parseYearlessDate('13 de Abril', 2026).startDate, '2026-04-13');
  assert.equal(parseYearlessDate('26 de abril', 2026).startDate, '2026-04-26');
  assert.equal(parseFreeTextDate('13 de Abril 2026', {}).startDate, '2026-04-13');
});

test('a multi-day row starts on the FIRST day, not the last', () => {
  // The plain day-first pattern skips "19 a " and matches "21 de Março",
  // which would publish a three-day event as starting on its final day —
  // a wrong date, which is worse than no date. Checked first for that
  // reason, in every connector these calendars use.
  assert.equal(parseYearlessDate('19 a 21 de Março', 2026).startDate, '2026-03-19');
  assert.equal(parseYearlessDate('05 e 06 de Abril', 2026).startDate, '2026-04-05');
  assert.equal(parseYearlessDate('12 a 15 de Março', 2026).startDate, '2026-03-12');
  assert.equal(parseYearlessDate('30 de Junho a 05 de Julho', 2026).startDate, '2026-06-30');

  // With a year, both ends are kept.
  const es = parseFreeTextDate('11 al 13 Septiembre, 2026', {});
  assert.equal(es.startDate, '2026-09-11');
  assert.equal(es.endDate, '2026-09-13');

  // A single day is untouched by the range pattern.
  assert.equal(parseYearlessDate('13 de Abril', 2026).endDate, null);
});

test('findDateLikeStrings separates "states no dates" from "we missed them"', () => {
  // Those are different questions and conflating them nearly cost us a
  // working Hong Kong source: probe-sources.ts reported NO DATES for a page
  // whose HTML plainly reads "24th MAY 2026". The probe runs only the
  // deterministic extractors, and the date sat in a div no selector reaches.
  const page =
    'Middle Island Challenge Deep Water Bay 24th MAY 2026 entries close ' +
    'Registration 3.10.2026 also 2026年8月15日 and March 6, 2026 — see you there';
  const found = findDateLikeStrings(page);
  assert.equal(found.length, 4, 'all four date shapes are spotted, including the Chinese one');

  const parsed = found.map((s) => parseFreeTextDate(s, {}).startDate).filter(Boolean).sort();
  // Three parse. "3.10.2026" is spotted but REFUSED, because with no source
  // country to break the tie it is either 3 October or 10 March. Finding a
  // candidate and resolving it stay separate steps, and the ambiguity guard
  // still applies to whatever this turns up.
  assert.deepEqual(parsed, ['2026-03-06', '2026-05-24', '2026-08-15']);
  assert.ok(found.includes('3.10.2026'));

  // Prose with no dates in it must stay empty — a false positive here turns
  // "genuinely undated" into "seed it and spend AI budget".
  assert.deepEqual(findDateLikeStrings('Our guided swims run when conditions allow. Book anytime.'), []);
  assert.deepEqual(findDateLikeStrings('Distances: 3.8 km, 1.5 km and 400 m'), []);
});
