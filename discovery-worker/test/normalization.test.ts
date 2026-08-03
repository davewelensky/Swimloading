import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFreeTextDate, parseStructuredDates, reconcileDates } from '../src/normalize/date.js';
import { parseDistanceToMetres } from '../src/normalize/distance.js';
import { parseLocationText } from '../src/normalize/location.js';

test('parses a full confirmed date', () => {
  const result = parseFreeTextDate('12 September 2027');
  assert.equal(result.startDate, '2027-09-12');
  assert.equal(result.endDate, null);
  assert.equal(result.datePrecision, 'exact');
  assert.equal(result.dateConfirmed, true);
});

test('parses an explicit date range', () => {
  const result = parseFreeTextDate('12-14 September 2027');
  assert.equal(result.startDate, '2027-09-12');
  assert.equal(result.endDate, '2027-09-14');
  assert.equal(result.datePrecision, 'range');
  assert.equal(result.dateConfirmed, true);
});

test('parses "to"-worded and en-dash ranges the same way', () => {
  const toResult = parseFreeTextDate('12 to 14 September 2027');
  assert.equal(toResult.datePrecision, 'range');
  const dashResult = parseFreeTextDate('12–14 September 2027');
  assert.equal(dashResult.datePrecision, 'range');
});

test('parses month-and-year-only as month precision, confirmed', () => {
  const result = parseFreeTextDate('September 2027');
  assert.equal(result.datePrecision, 'month');
  assert.equal(result.dateConfirmed, true);
  assert.equal(result.startDate, '2027-09-01');
  assert.equal(result.endDate, '2027-09-30');
});

test('parses year-only as year precision, confirmed', () => {
  const result = parseFreeTextDate('Sometime in 2027, exact dates TBC');
  assert.equal(result.datePrecision, 'year');
  assert.equal(result.dateConfirmed, true);
  assert.equal(result.startDate, '2027-01-01');
  assert.equal(result.endDate, '2027-12-31');
});

test('date text with no year is left unconfirmed — the year is never inferred', () => {
  const result = parseFreeTextDate('Meets every 14 September');
  assert.equal(result.startDate, null);
  assert.equal(result.endDate, null);
  assert.equal(result.datePrecision, 'unknown');
  assert.equal(result.dateConfirmed, false);
  assert.ok(result.warnings.some((w) => w.includes('no year')));
});

test('a historical (past) full date still parses as exact/confirmed — being in the past is a confidence concern, not a parsing one', () => {
  const result = parseFreeTextDate('14 September 2019');
  assert.equal(result.startDate, '2019-09-14');
  assert.equal(result.datePrecision, 'exact');
  assert.equal(result.dateConfirmed, true);
});

test('unparseable text produces an unknown, unconfirmed result with a warning', () => {
  const result = parseFreeTextDate('Coming soon!');
  assert.equal(result.dateConfirmed, false);
  assert.equal(result.datePrecision, 'unknown');
  assert.ok(result.warnings.length > 0);
});

test('structured (JSON-LD) startDate/endDate spanning multiple days yields range precision', () => {
  const result = parseStructuredDates('2027-07-10', '2027-07-12');
  assert.equal(result.startDate, '2027-07-10');
  assert.equal(result.endDate, '2027-07-12');
  assert.equal(result.datePrecision, 'range');
});

test('structured startDate with no endDate (or an identical endDate) yields exact precision', () => {
  const result = parseStructuredDates('2027-07-10', '2027-07-10');
  assert.equal(result.datePrecision, 'exact');
  assert.equal(result.endDate, null);
});

test('reconcileDates flags a conflict when structured and free-text dates disagree, and marks it unconfirmed', () => {
  const structured = parseStructuredDates('2027-07-10', null);
  const freeText = parseFreeTextDate('11 July 2027');
  const resolved = reconcileDates(structured, freeText);
  assert.equal(resolved.dateConfirmed, false);
  assert.ok(resolved.warnings.some((w) => w.toLowerCase().includes('conflicting dates')));
});

test('reconcileDates prefers structured data when both agree', () => {
  const structured = parseStructuredDates('2027-07-10', null);
  const freeText = parseFreeTextDate('10 July 2027');
  const resolved = reconcileDates(structured, freeText);
  assert.equal(resolved.dateConfirmed, true);
  assert.equal(resolved.startDate, '2027-07-10');
});

test('converts kilometres to metres', () => {
  assert.equal(parseDistanceToMetres('10km'), 10000);
  assert.equal(parseDistanceToMetres('1.5 km'), 1500);
});

test('converts miles to metres', () => {
  const metres = parseDistanceToMetres('1.2 miles');
  assert.ok(metres !== null && Math.abs(metres - 1931) < 2);
});

test('treats a bare metre value as already-metres', () => {
  assert.equal(parseDistanceToMetres('3800m'), 3800);
  assert.equal(parseDistanceToMetres('3800'), 3800);
});

test('returns null for unrecognisable distance text rather than guessing', () => {
  assert.equal(parseDistanceToMetres('a long way'), null);
  assert.equal(parseDistanceToMetres(null), null);
});

test('parses comma-separated location text into city/region/country', () => {
  const result = parseLocationText('Plymouth, Devon, United Kingdom');
  assert.equal(result.city, 'Plymouth');
  assert.equal(result.region, 'Devon');
  assert.equal(result.countryCode, 'GB');
});

test('location text with an unrecognised country segment warns rather than guessing a code', () => {
  const result = parseLocationText('Somewhere, Nowhereland');
  assert.equal(result.countryCode, null);
  assert.ok(result.warnings.length > 0);
});
