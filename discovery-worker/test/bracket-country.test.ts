import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  AMBIGUOUS_BRACKET_COUNTRY_NAMES,
  countryFromTrailingBracket,
  parseLocationText,
} from '../src/normalize/location.js';
import { buildFromRow } from '../src/jobs/process-table-page.js';

// ─────────────────────────────────────────────────────────────────────────
// Regression, 2026-09-25. Swimchannel Brasil ("calendário águas abertas",
// discovery_sources country BR, language pt) lists foreign swims as
// "City (Country)" in Portuguese. The English-only country table could not
// read the bracket, so every row fell back to the SOURCE's country and ten
// venues published as Brazil — Razanac, Barcelona, Tenero, Baku, Tashkent,
// Astana, Lima, Abu Dhabi, Santa Fé, Rosário. The homepage's new country
// flags put a Brazilian flag on a Croatian swim. The ten rows were fixed in
// the data by sql/applied/2026-09-25_fix-br-coded-foreign-venues.sql; these
// tests stop the crawler writing the same thing again.
// ─────────────────────────────────────────────────────────────────────────

const PT = ['pt'];

// Verbatim venue strings from that source, and the country each one names.
const SWIMCHANNEL_FOREIGN: ReadonlyArray<[string, string]> = [
  ['Razanac (Croácia)', 'HR'],
  ['Barcelona (Espanha)', 'ES'],
  ['Tenero (Suíça)', 'CH'],
  ['Baku (Azerbaijão)', 'AZ'],
  ['Tashkent (Uzbequistão)', 'UZ'],
  ['Astana (Cazaquistão)', 'KZ'],
  ['Lima (Peru)', 'PE'],
  ['Abu Dhabi (Emirados Árabes Unidos)', 'AE'],
  ['Santa Fé (Argentina)', 'AR'],
  ['Rosário e Santa Fé (Argentina)', 'AR'],
  // Still in the candidate queue on 25 Sep, same fault:
  ['Ibiza (Espanha)', 'ES'],
  ['Córdoba (Argentina)', 'AR'],
  ['Pinamar (Argentina)', 'AR'],
  ['Neuquen a Rio Negro (Argentina)', 'AR'],
];

test('a Portuguese country named in brackets resolves to that country', () => {
  for (const [text, code] of SWIMCHANNEL_FOREIGN) {
    const loc = parseLocationText(text, { languages: PT });
    assert.equal(loc.countryCode, code, text);
    // The page's own text is kept as printed — it is how an existing venue
    // is found again on the next crawl.
    assert.equal(loc.city, text);
    assert.ok(!loc.warnings.some((w) => w.startsWith('Could not resolve a country')), text);
  }
});

test('a Brazilian state in brackets is never read as a country', () => {
  // PE, ES, SC, AL, MA, PA, RS... are Brazilian states AND ISO country codes.
  // Reading them would file Recife under Peru and Vitória under Spain. These
  // stay unresolved here, so the source's own country (BR) fills them in.
  for (const text of [
    'Recife (PE)', 'Vitória (ES)', 'Florianópolis (SC)', 'Maceió (AL)', 'Ilhabela (SP)',
    'Caraguatatuba e Ilhabela (SP)', 'Bertioga e Santos (SP)', 'Brasília (DF)', 'Porto Alegre (RS)',
  ]) {
    assert.equal(parseLocationText(text, { languages: PT }).countryCode, null, text);
  }
});

test('a province written in brackets is not mistaken for a country', () => {
  // Spanish pages write the province in brackets; Granada is also the
  // Spanish and Portuguese name for Grenada.
  assert.equal(countryFromTrailingBracket('Almuñécar (Granada)', ['es']), null);
  assert.equal(countryFromTrailingBracket('Salobreña (Granada)', ['pt']), null);
  // "(Luxembourg)" is also a Belgian province.
  assert.equal(countryFromTrailingBracket('Arlon (Luxembourg)', ['fr']), null);
});

test('only the page\'s own languages are read, plus English', () => {
  assert.equal(countryFromTrailingBracket('Razanac (Croácia)', ['de']), null);
  assert.equal(countryFromTrailingBracket('Split (Kroatien)', ['de']), 'HR');
  assert.equal(countryFromTrailingBracket('Split (Croatia)', null), 'HR');
  assert.equal(countryFromTrailingBracket('Split (Croatia)', ['pt']), 'HR');
  // Regional language tags reduce to the base language.
  assert.equal(countryFromTrailingBracket('Razanac (Croácia)', ['pt-BR']), 'HR');
});

test('only a trailing bracket counts', () => {
  assert.equal(countryFromTrailingBracket('Lagoa (Espanha) Norte', PT), null);
  assert.equal(countryFromTrailingBracket('Barcelona Espanha', PT), null);
  assert.equal(countryFromTrailingBracket('Barcelona ()', PT), null);
});

test('names two languages disagree about are refused, not guessed', () => {
  // Whatever the collision check throws out, none of the names this fix
  // exists for may be among them.
  const refused = new Set(AMBIGUOUS_BRACKET_COUNTRY_NAMES);
  for (const key of ['croacia', 'espanha', 'suica', 'azerbaijao', 'uzbequistao', 'cazaquistao', 'peru', 'emirados arabes unidos', 'argentina']) {
    assert.ok(!refused.has(key), `${key} was refused as ambiguous`);
  }
  for (const key of AMBIGUOUS_BRACKET_COUNTRY_NAMES) {
    assert.equal(countryFromTrailingBracket(`X (${key})`, ['en', 'es', 'pt', 'fr', 'de', 'it', 'nl']), null, key);
  }
});

test('a Swimchannel table row keeps its own country instead of the source\'s', () => {
  const context = { sourceType: 'aggregator', countryCode: 'BR', languageCodes: ['pt'] };
  const row = (locationText: string) => ({
    name: '4ª etapa do Circuito Europeu de Águas Abertas', dateText: '26 de Setembro',
    locationText, distanceText: null, timeText: null, url: null,
    latitude: null, longitude: null, rawCells: {},
  });

  const foreign = buildFromRow('src', 'https://swimchannel.net/br/aguas-abertas-2026/', row('Razanac (Croácia)'), 2026, 'pt', context);
  assert.equal(foreign?.candidate.countryCode, 'HR');
  assert.equal(foreign?.candidate.rawSourceValues?.countryFromSource, undefined);

  // A Brazilian row still takes the source's country, exactly as before.
  const home = buildFromRow('src', 'https://swimchannel.net/br/aguas-abertas-2026/', row('Ilhabela (SP)'), 2026, 'pt', context);
  assert.equal(home?.candidate.countryCode, 'BR');
  assert.equal(home?.candidate.rawSourceValues?.countryFromSource, 'BR');

  // The page language alone is enough when the source has none registered.
  const pageOnly = buildFromRow('src', 'https://x/', row('Tenero (Suíça)'), 2026, 'pt', { countryCode: 'BR' });
  assert.equal(pageOnly?.candidate.countryCode, 'CH');
});
