import { test } from 'node:test';
import assert from 'node:assert/strict';
import { blankCandidateEvent, type CandidateEvent } from '../src/domain/candidate-event.js';
import { computeDuplicateScore } from '../src/dedupe/match.js';
import { jaccardSimilarity, nameTokens, normalizeName } from '../src/dedupe/normalize-name.js';

function candidate(overrides: Partial<CandidateEvent> = {}): CandidateEvent {
  return { ...blankCandidateEvent('test-source', 'https://organiser.example/event'), ...overrides };
}

test('normalizeName strips generic stopwords but keeps distinctive category words', () => {
  const normalized = normalizeName('The Official Windermere Open Water Swim Race Day');
  assert.ok(normalized.includes('windermere'));
  assert.ok(normalized.includes('open'));
  assert.ok(normalized.includes('water'));
  assert.ok(!normalized.includes('the'));
  assert.ok(!normalized.includes('official'));
});

test('jaccardSimilarity is 1 for identical token sets and 0 for disjoint sets', () => {
  assert.equal(jaccardSimilarity(nameTokens('Windermere Swim'), nameTokens('Windermere Swim')), 1);
  assert.equal(jaccardSimilarity(nameTokens('Windermere Swim'), nameTokens('Brighton Dash')), 0);
});

test('two pages describing the same event under different names score as a possible duplicate', () => {
  const a = candidate({
    canonicalName: 'Windermere Great Swim',
    organiserName: 'Lakeland Events Ltd',
    city: 'Bowness-on-Windermere',
    countryCode: 'GB',
    startDate: '2027-06-12',
    endDate: null,
    latitude: 54.3667,
    longitude: -2.9167,
    distances: [{ originalLabel: '3.8km', distanceMetres: 3800, category: null, startTime: null, registrationUrl: null, wetsuitPolicy: null, qualificationRequired: null }],
  });
  const b = candidate({
    canonicalName: 'The Great Windermere Open Water Challenge',
    organiserName: 'Lakeland Events',
    city: 'Bowness-on-Windermere',
    countryCode: 'GB',
    startDate: '2027-06-12',
    endDate: '2027-06-13',
    latitude: 54.367,
    longitude: -2.916,
    distances: [{ originalLabel: '3.8km', distanceMetres: 3800, category: null, startTime: null, registrationUrl: null, wetsuitPolicy: null, qualificationRequired: null }],
  });

  const result = computeDuplicateScore(a, b);
  assert.equal(result.possibleDuplicate, true);
  assert.ok(result.score >= 50);
  assert.ok(result.matchingSignals.length > 0);
});

test('a hard country conflict vetoes possibleDuplicate even with a very similar name', () => {
  const a = candidate({ canonicalName: 'Windermere Great Swim', countryCode: 'GB', startDate: '2027-06-12' });
  const b = candidate({ canonicalName: 'Windermere Great Swim', countryCode: 'ZA', startDate: '2027-06-12' });

  const result = computeDuplicateScore(a, b);
  assert.equal(result.possibleDuplicate, false);
  assert.ok(result.conflictingSignals.some((s) => s.includes('different country')));
});

test('two unrelated events score low and are not flagged as a possible duplicate', () => {
  const a = candidate({ canonicalName: 'Windermere Great Swim', city: 'Bowness-on-Windermere', countryCode: 'GB', startDate: '2027-06-12' });
  const b = candidate({ canonicalName: 'Brighton Coastal Swim', city: 'Brighton', countryCode: 'GB', startDate: '2027-09-01' });

  const result = computeDuplicateScore(a, b);
  assert.equal(result.possibleDuplicate, false);
  assert.ok(result.score < 50);
});

test('duplicate matching never merges records — it only returns a score for a human to review', () => {
  const a = candidate({ canonicalName: 'Windermere Great Swim' });
  const b = candidate({ canonicalName: 'Windermere Great Swim' });
  const before = JSON.stringify(a);
  computeDuplicateScore(a, b);
  assert.equal(JSON.stringify(a), before);
});
