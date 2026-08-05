import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { classifyEvent, type ClassificationInput } from '../src/extract/classify.js';

// The fields every call needs. Kept in one place so a change to
// ClassificationInput breaks this once, not in five separate literals.
const base = {
  categoryHint: null,
  waterBodyHint: null,
  hasSeparateSwimEntry: null,
} satisfies Partial<ClassificationInput>;

// Regression tests for 2026-08-05, when a Fort Worth swimming LESSON reached
// the public catalogue as an open water swim. Its URL said so plainly —
// /water-sports/swimming-classes/summer-event-adapted-luau-2026 — but no
// phrase list matched, and the classifier's fallthrough is "eligible".

test('a swimming class reached only by its URL path is rejected', () => {
  const r = classifyEvent({
    ...base,
    titleText: 'Summer Event - Adapted Luau',
    descriptionText: null,
    urlPath: '/fort-worth-tx/water-sports/swimming-classes/summer-event-adapted-luau-2026',
  });
  assert.equal(r.eligible, false);
  assert.equal(r.classification, 'no_actual_opportunity');
});

test('a class held in open water is still a class', () => {
  // The ordering that matters: an open-water phrase must NOT rescue a
  // lesson. Checked before the open-water signal for exactly this case.
  const r = classifyEvent({
    ...base,
    titleText: 'Open water swim lessons — sea swimming for beginners',
    descriptionText: 'Weekly open water swim lessons in the bay',
    urlPath: '/swim-lessons/open-water-beginners',
  });
  assert.equal(r.eligible, false, 'an open-water lesson is not an event you enter');
});

test('learn-to-swim and multilingual forms are caught', () => {
  for (const [title, path] of [
    ['Learn to Swim programme', '/learn-to-swim'],
    ['Cours de natation adultes', '/cours-de-natation'],
    ['Schwimmkurs für Anfänger', '/schwimmkurs'],
    ['Clases de natacion', '/clases-de-natacion'],
  ] as const) {
    const r = classifyEvent({ ...base, titleText: title, descriptionText: null, urlPath: path });
    assert.equal(r.eligible, false, `${title} should be rejected`);
  }
});

// PRECISION MATTERS MORE THAN RECALL HERE. A false positive silently deletes
// a real swim, which is the failure mode rejectAsEventName() was tuned
// against. These must all survive.
test('real races are not caught by the non-race vocabulary', () => {
  const survivors: Array<[string, string]> = [
    ['Bosphorus Cross-Continental Swim', '/events/bosphorus-cross-continental'],
    ['Swimjunkie Challenge: Caramoan', '/pili-camarinessur/water-sports/swimming-races/caramoan'],
    ['Lorne Pier to Pub', '/event/lorne-pier-to-pub'],
    ['Robben Island Crossing', '/swims/robben-island'],
    ['Midmar Mile', '/events/midmar-mile'],
    // Contains "camp" but is a place name, not a training camp.
    ['Camps Bay Open Water Mile', '/events/camps-bay-mile'],
    // A race that merely MENTIONS a clinic in its description.
    ['Big Bay Open Water Classic', '/events/big-bay-classic'],
  ];
  for (const [title, path] of survivors) {
    const r = classifyEvent({ ...base, titleText: title, descriptionText: null, urlPath: path });
    assert.notEqual(
      r.classification, 'no_actual_opportunity',
      `"${title}" is a real swim and must not be rejected as a class`
    );
  }
});
