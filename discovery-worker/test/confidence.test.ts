import { test } from 'node:test';
import assert from 'node:assert/strict';
import { blankCandidateEvent, type CandidateEvent } from '../src/domain/candidate-event.js';
import type { ClassificationResult } from '../src/extract/classify.js';
import { scoreCandidate } from '../src/confidence/score.js';

const FIXED_NOW = new Date('2026-08-03T00:00:00Z');

function eligibleClassification(classification: ClassificationResult['classification'] = 'official_race'): ClassificationResult {
  return { classification, eligible: true, discipline: 'open_water' as const, reasons: [], warnings: [] };
}

function ineligibleClassification(classification: ClassificationResult['classification']): ClassificationResult {
  return { classification, eligible: false, discipline: 'open_water' as const, reasons: [], warnings: [] };
}

function candidate(overrides: Partial<CandidateEvent> = {}): CandidateEvent {
  return { ...blankCandidateEvent('test-source', 'https://organiser.example/event'), ...overrides };
}

test('a well-specified candidate scores highly and is recommended high_confidence', () => {
  const c = candidate({
    officialUrl: 'https://organiser.example/official',
    registrationUrl: 'https://organiser.example/register',
    organiserName: 'Test Swim Club',
    city: 'Testville',
    countryCode: 'GB',
    startDate: '2027-06-01',
    datePrecision: 'exact',
    dateConfirmed: true,
    extractionMethod: 'jsonld',
    distances: [
      { originalLabel: '5km', distanceMetres: 5000, category: null, startTime: null, registrationUrl: null, wetsuitPolicy: null, qualificationRequired: null },
    ],
  });
  const result = scoreCandidate(c, eligibleClassification(), { now: FIXED_NOW });
  assert.equal(result.totalScore, 80);
  assert.equal(result.recommendation, 'high_confidence');
});

test('a missing year is penalised and leaves the candidate unconfirmed', () => {
  const c = candidate({ dateConfirmed: false, datePrecision: 'unknown', startDate: null });
  const result = scoreCandidate(c, eligibleClassification(), { now: FIXED_NOW });
  assert.ok(result.reasons.some((r) => r.includes('missing or unconfirmed')));
  assert.ok(result.reasons.some((r) => r.startsWith('-20')));
});

test('a confirmed date safely in the past is penalised as a historical page', () => {
  const c = candidate({ startDate: '2019-01-01', datePrecision: 'exact', dateConfirmed: true });
  const result = scoreCandidate(c, eligibleClassification(), { now: FIXED_NOW });
  assert.ok(result.reasons.some((r) => r.includes('historical page')));
});

test('a confirmed future date is NOT penalised as historical', () => {
  const c = candidate({ startDate: '2027-01-01', datePrecision: 'exact', dateConfirmed: true });
  const result = scoreCandidate(c, eligibleClassification(), { now: FIXED_NOW });
  assert.ok(!result.reasons.some((r) => r.includes('historical page')));
});

test('an aggregator-only source URL is penalised', () => {
  const aggregatorSource = { ...blankCandidateEvent('agg', 'https://swim-events-aggregator.example/listing/123') };
  const result = scoreCandidate(aggregatorSource, eligibleClassification(), { now: FIXED_NOW });
  assert.ok(result.reasons.some((r) => r.includes('aggregator')));
});

test('conflicting dates (recorded as a warning) are penalised', () => {
  const c = candidate({ warnings: ['Conflicting dates found: structured data says 2027-06-01, page text implies 2027-06-02'] });
  const result = scoreCandidate(c, eligibleClassification(), { now: FIXED_NOW });
  assert.ok(result.reasons.some((r) => r.includes('conflicting dates')));
});

test('unknown location (no city, no country) is penalised', () => {
  const c = candidate({ city: null, countryCode: null });
  const result = scoreCandidate(c, eligibleClassification(), { now: FIXED_NOW });
  assert.ok(result.reasons.some((r) => r.includes('no city or country')));
});

test('classification uncertainty is penalised', () => {
  const c = candidate();
  const result = scoreCandidate(c, eligibleClassification('unclassified'), { now: FIXED_NOW });
  // "unclassified" is never actually `eligible: true` in real usage (classify.ts
  // always pairs it with eligible:false) — this test exercises the scoring
  // rule for the classification value alone, independent of the eligibility gate.
  assert.ok(result.reasons.some((r) => r.includes('classification could not be determined')));
});

test('ineligible classifications are always recommended "rejected", regardless of score', () => {
  const c = candidate({
    officialUrl: 'https://organiser.example/official',
    registrationUrl: 'https://organiser.example/register',
    organiserName: 'Test Swim Club',
    city: 'Testville',
    countryCode: 'GB',
    startDate: '2027-06-01',
    datePrecision: 'exact',
    dateConfirmed: true,
    extractionMethod: 'jsonld',
  });
  const result = scoreCandidate(c, ineligibleClassification('pool_only'), { now: FIXED_NOW });
  assert.equal(result.recommendation, 'rejected');
});

test('scores never go below 0 or above 100', () => {
  const emptyCandidate = candidate({ dateConfirmed: false, city: null, countryCode: null });
  const result = scoreCandidate(emptyCandidate, ineligibleClassification('pool_only'), { now: FIXED_NOW });
  assert.ok(result.totalScore >= 0 && result.totalScore <= 100);
});
