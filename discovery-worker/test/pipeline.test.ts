import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { processFixture } from '../src/jobs/process-fixture.js';
import { validateCandidateEvent } from '../src/domain/validation.js';
import { computeDuplicateScore } from '../src/dedupe/match.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = path.join(__dirname, '..', 'fixtures');
const fixture = (name: string) => path.join(FIXTURES_DIR, name);

test('a valid single-event fixture (JSON-LD only) produces a high-confidence, eligible, valid candidate', async () => {
  const result = await processFixture(fixture('valid-single-event.html'));
  assert.equal(result.classification.eligible, true);
  assert.equal(result.classification.classification, 'official_race');
  assert.equal(result.candidate.extractionMethod, 'jsonld+html');
  assert.equal(result.candidate.dateConfirmed, true);
  assert.equal(result.candidate.datePrecision, 'exact');
  assert.equal(result.confidence.recommendation, 'high_confidence');
  assert.equal(result.validation.valid, true);
});

test('a multi-distance fixture normalises every distance option with its own facts', async () => {
  const result = await processFixture(fixture('valid-multiple-distances.html'));
  assert.equal(result.candidate.distances.length, 3);
  const elite = result.candidate.distances.find((d) => d.distanceMetres === 10000);
  assert.ok(elite);
  assert.equal(elite.qualificationRequired, true);
  assert.equal(elite.wetsuitPolicy, 'mandatory');
  assert.equal(result.validation.valid, true);
});

test('a JSON-LD @graph fixture resolves the Event node correctly', async () => {
  const result = await processFixture(fixture('valid-jsonld-graph.html'));
  assert.equal(result.candidate.originalName, 'Brighton Coastal Swim');
  assert.equal(result.candidate.organiserName, 'Coastal Swim Series');
  assert.equal(result.candidate.city, 'Brighton');
  assert.equal(result.validation.valid, true);
});

test('a month-and-year-only fixture is confirmed at month precision, not exact', async () => {
  const result = await processFixture(fixture('partial-date.html'));
  assert.equal(result.candidate.datePrecision, 'month');
  assert.equal(result.candidate.dateConfirmed, true);
});

test('a fixture with no year in its date text is never resolved to a guessed year', async () => {
  const result = await processFixture(fixture('missing-year.html'));
  assert.equal(result.candidate.startDate, null);
  assert.equal(result.candidate.dateConfirmed, false);
  assert.equal(result.confidence.recommendation, 'insufficient_evidence');
});

test('a historical race-result page is rejected regardless of how complete its data is', async () => {
  const result = await processFixture(fixture('historical-event.html'));
  assert.equal(result.classification.eligible, false);
  assert.equal(result.classification.classification, 'historical_result');
  assert.equal(result.confidence.recommendation, 'rejected');
});

test('a pool-only event is rejected even though it has a confirmed future date', async () => {
  const result = await processFixture(fixture('pool-only-event.html'));
  assert.equal(result.candidate.waterBodyType, 'pool');
  assert.equal(result.classification.classification, 'pool_only');
  assert.equal(result.confidence.recommendation, 'rejected');
});

test('a triathlon page with no standalone swim entry is rejected', async () => {
  const result = await processFixture(fixture('triathlon-only-event.html'));
  assert.equal(result.classification.classification, 'triathlon_only');
  assert.equal(result.confidence.recommendation, 'rejected');
});

test('a cancelled event is captured with status "cancelled"', async () => {
  const result = await processFixture(fixture('cancelled-event.html'));
  assert.equal(result.candidate.status, 'cancelled');
  assert.equal(result.classification.eligible, true);
});

test('every fixture in the corpus produces a structurally valid candidate', async () => {
  const fixtures = [
    'valid-single-event.html',
    'valid-multiple-distances.html',
    'valid-jsonld-graph.html',
    'partial-date.html',
    'missing-year.html',
    'historical-event.html',
    'pool-only-event.html',
    'triathlon-only-event.html',
    'cancelled-event.html',
    'duplicate-event-a.html',
    'duplicate-event-b.html',
  ];
  for (const name of fixtures) {
    const result = await processFixture(fixture(name));
    const validation = validateCandidateEvent(result.candidate);
    assert.equal(validation.valid, true, `${name}: ${validation.errors.join('; ')}`);
  }
});

test('the two duplicate-event fixtures are flagged as a possible duplicate of each other', async () => {
  const a = await processFixture(fixture('duplicate-event-a.html'));
  const b = await processFixture(fixture('duplicate-event-b.html'));
  const match = computeDuplicateScore(a.candidate, b.candidate);
  assert.equal(match.possibleDuplicate, true);
  assert.ok(match.matchingSignals.length >= 2);
});

test('an unrelated valid-event fixture is NOT flagged as a duplicate of the duplicate-event pair', async () => {
  const unrelated = await processFixture(fixture('valid-single-event.html'));
  const a = await processFixture(fixture('duplicate-event-a.html'));
  const match = computeDuplicateScore(unrelated.candidate, a.candidate);
  assert.equal(match.possibleDuplicate, false);
});
