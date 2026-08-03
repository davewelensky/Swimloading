import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildCandidateKey,
  editionYearForKey,
  normaliseForKey,
  normaliseUrlForKey,
  type CandidateKeyInput,
} from '../src/domain/candidate-key.js';
import { processFixture } from '../src/jobs/process-fixture.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixture = (name: string) => path.join(__dirname, '..', 'fixtures', name);

const base: CandidateKeyInput = {
  sourceUrl: 'https://organiser.example/events/great-swim',
  name: 'Great Bay Swim Festival',
  startDate: '2027-07-18',
  dateConfirmed: true,
};

test('the key is deterministic — same input always yields the same key', () => {
  assert.equal(buildCandidateKey(base), buildCandidateKey({ ...base }));
});

test('the key changes when the event name changes', () => {
  assert.notEqual(buildCandidateKey(base), buildCandidateKey({ ...base, name: 'A Different Swim' }));
});

test('the key changes when the source page changes', () => {
  assert.notEqual(
    buildCandidateKey(base),
    buildCandidateKey({ ...base, sourceUrl: 'https://organiser.example/events/other-swim' })
  );
});

test('a NEW YEAR of the same annual event gets its own key — history is never overwritten', () => {
  const y2027 = buildCandidateKey(base);
  const y2028 = buildCandidateKey({ ...base, startDate: '2028-07-18' });
  assert.notEqual(y2027, y2028);
});

test('a date CORRECTION within the same year keeps the same key — so it updates, not duplicates', () => {
  const original = buildCandidateKey(base);
  const corrected = buildCandidateKey({ ...base, startDate: '2027-07-19' });
  assert.equal(original, corrected);
});

test('an unconfirmed date never contributes a guessed year', () => {
  const unconfirmed = buildCandidateKey({ ...base, startDate: null, dateConfirmed: false });
  const confirmed = buildCandidateKey(base);
  assert.notEqual(unconfirmed, confirmed);
  // Two unconfirmed candidates from the same page and name are the same
  // candidate — they must not multiply on every run.
  assert.equal(unconfirmed, buildCandidateKey({ ...base, startDate: null, dateConfirmed: false }));
});

test('a startDate present but flagged unconfirmed is still treated as year-unknown', () => {
  const a = buildCandidateKey({ ...base, dateConfirmed: false });
  const b = buildCandidateKey({ ...base, startDate: null, dateConfirmed: false });
  assert.equal(a, b);
});

test('URL normalisation ignores query strings, fragments and trailing slashes', () => {
  assert.equal(
    normaliseUrlForKey('https://Organiser.example/events/great-swim/'),
    normaliseUrlForKey('https://organiser.example/events/great-swim?utm_source=x#top')
  );
});

test('URL normalisation falls back gracefully on an unparseable value', () => {
  assert.doesNotThrow(() => normaliseUrlForKey('not a url at all'));
  assert.equal(normaliseUrlForKey('not a url at all'), 'not a url at all');
});

test('name normalisation is faithful — it does NOT strip stopwords like the dedupe normaliser does', () => {
  // "The" is dropped by dedupe/normalize-name.ts on purpose; for a key it
  // must be kept, or two distinct events on one page could collide.
  assert.notEqual(normaliseForKey('The Sprint'), normaliseForKey('Sprint'));
});

test('name normalisation is case- and punctuation-insensitive', () => {
  assert.equal(normaliseForKey('Great Bay Swim!'), normaliseForKey('great  bay   swim'));
});

test('editionYearForKey returns null rather than inventing a year', () => {
  assert.equal(editionYearForKey(null, false), null);
  assert.equal(editionYearForKey('2027-07-18', false), null);
  assert.equal(editionYearForKey('2027-07-18', true), 2027);
});

test('every fixture produces a non-empty candidateKey', async () => {
  const names = ['valid-single-event.html', 'missing-year.html', 'cancelled-event.html', 'partial-date.html'];
  for (const name of names) {
    const result = await processFixture(fixture(name));
    assert.ok(result.candidate.candidateKey.length > 0, `${name} produced an empty key`);
    assert.equal(result.candidate.candidateKey.length, 32);
  }
});

test('re-processing the same fixture produces an identical key (idempotent upsert guarantee)', async () => {
  const a = await processFixture(fixture('valid-multiple-distances.html'));
  const b = await processFixture(fixture('valid-multiple-distances.html'));
  assert.equal(a.candidate.candidateKey, b.candidate.candidateKey);
});

test('the two duplicate-event fixtures get DIFFERENT keys — they are separate candidates, linked by dedupe not collapsed by the key', async () => {
  const a = await processFixture(fixture('duplicate-event-a.html'));
  const b = await processFixture(fixture('duplicate-event-b.html'));
  assert.notEqual(a.candidate.candidateKey, b.candidate.candidateKey);
});
