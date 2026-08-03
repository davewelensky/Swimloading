import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyEvent } from '../src/extract/classify.js';

test('classifies a recognised event-type hint as eligible', () => {
  const result = classifyEvent({ categoryHint: 'marathon_swim', waterBodyHint: 'sea', hasSeparateSwimEntry: null });
  assert.equal(result.classification, 'marathon_swim');
  assert.equal(result.eligible, true);
});

test('rejects a pool-only event regardless of category hint', () => {
  const result = classifyEvent({ categoryHint: 'official_race', waterBodyHint: 'pool', hasSeparateSwimEntry: null });
  assert.equal(result.classification, 'pool_only');
  assert.equal(result.eligible, false);
  assert.ok(result.reasons.some((r) => r.toLowerCase().includes('pool')));
});

test('rejects a triathlon page with no separately enterable swim leg', () => {
  const result = classifyEvent({ categoryHint: 'triathlon', waterBodyHint: 'lake', hasSeparateSwimEntry: false });
  assert.equal(result.classification, 'triathlon_only');
  assert.equal(result.eligible, false);
});

test('accepts a triathlon page whose swim leg IS separately enterable', () => {
  const result = classifyEvent({ categoryHint: 'triathlon', waterBodyHint: 'lake', hasSeparateSwimEntry: true });
  assert.equal(result.eligible, true);
  assert.notEqual(result.classification, 'triathlon_only');
});

test('treats an unspecified separate-swim-entry flag as ineligible (conservative default) with a warning', () => {
  const result = classifyEvent({ categoryHint: 'triathlon', waterBodyHint: 'lake', hasSeparateSwimEntry: null });
  assert.equal(result.eligible, false);
  assert.ok(result.warnings.length > 0);
});

test('rejects a historical race-result article', () => {
  const result = classifyEvent({ categoryHint: 'historical_result', waterBodyHint: 'lake', hasSeparateSwimEntry: null });
  assert.equal(result.classification, 'historical_result');
  assert.equal(result.eligible, false);
});

test('rejects a general tourism page', () => {
  const result = classifyEvent({ categoryHint: 'tourism', waterBodyHint: null, hasSeparateSwimEntry: null });
  assert.equal(result.classification, 'general_tourism_page');
  assert.equal(result.eligible, false);
});

test('rejects a page that mentions swimming but offers no actual opportunity', () => {
  const result = classifyEvent({ categoryHint: 'no_opportunity', waterBodyHint: null, hasSeparateSwimEntry: null });
  assert.equal(result.classification, 'no_actual_opportunity');
  assert.equal(result.eligible, false);
});

test('returns "unclassified" and ineligible when there is no usable signal at all', () => {
  const result = classifyEvent({ categoryHint: null, waterBodyHint: null, hasSeparateSwimEntry: null });
  assert.equal(result.classification, 'unclassified');
  assert.equal(result.eligible, false);
  assert.ok(result.warnings.some((w) => w.includes('no category hint')));
});

test('returns "unclassified" for an unrecognised category hint rather than guessing', () => {
  const result = classifyEvent({ categoryHint: 'something-unexpected', waterBodyHint: 'sea', hasSeparateSwimEntry: null });
  assert.equal(result.classification, 'unclassified');
  assert.equal(result.eligible, false);
});
