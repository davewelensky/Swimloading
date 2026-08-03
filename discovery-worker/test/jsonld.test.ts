import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractJsonLd } from '../src/extract/jsonld.js';

test('extracts a single JSON-LD Event object', () => {
  const html = `<script type="application/ld+json">
    {"@context":"https://schema.org","@type":"SportsEvent","name":"Test Swim","startDate":"2027-01-01"}
  </script>`;
  const result = extractJsonLd(html);
  assert.equal(result.events.length, 1);
  const event = result.events[0];
  assert.ok(event);
  assert.equal(event.name, 'Test Swim');
  assert.equal(result.warnings.length, 0);
});

test('malformed JSON-LD produces a warning rather than crashing the pipeline', () => {
  const html = `<script type="application/ld+json">{ this is not valid json </script>`;
  assert.doesNotThrow(() => extractJsonLd(html));
  const result = extractJsonLd(html);
  assert.equal(result.events.length, 0);
  assert.ok(result.warnings.some((w) => w.includes('Malformed JSON-LD')));
});

test('one malformed block does not prevent extraction from a later valid block', () => {
  const html = `
    <script type="application/ld+json">{ not valid </script>
    <script type="application/ld+json">{"@type":"Event","name":"Still Works","startDate":"2027-05-01"}</script>
  `;
  const result = extractJsonLd(html);
  assert.equal(result.events.length, 1);
  assert.ok(result.warnings.some((w) => w.includes('Malformed JSON-LD')));
});

test('extracts an Event node nested inside @graph', () => {
  const html = `<script type="application/ld+json">
    {"@context":"https://schema.org","@graph":[
      {"@type":"Organization","name":"Org"},
      {"@type":"SportsEvent","name":"Graph Swim","startDate":"2027-02-02"}
    ]}
  </script>`;
  const result = extractJsonLd(html);
  assert.equal(result.events.length, 1);
  const event = result.events[0];
  assert.ok(event);
  assert.equal(event.name, 'Graph Swim');
});

test('extracts multiple Event objects from a top-level array', () => {
  const html = `<script type="application/ld+json">
    [
      {"@type":"SportsEvent","name":"Swim One","startDate":"2027-03-01"},
      {"@type":"SportsEvent","name":"Swim Two","startDate":"2027-04-01"}
    ]
  </script>`;
  const result = extractJsonLd(html);
  assert.equal(result.events.length, 2);
});

test('resolves @id references (e.g. location) to sibling nodes within @graph', () => {
  const html = `<script type="application/ld+json">
    {"@graph":[
      {"@type":"Place","@id":"#venue","name":"Test Venue"},
      {"@type":"SportsEvent","name":"Ref Swim","location":{"@id":"#venue"}}
    ]}
  </script>`;
  const result = extractJsonLd(html);
  const event = result.events[0];
  assert.ok(event);
  const location = event.location as { name?: unknown };
  assert.equal(location.name, 'Test Venue');
});

test('warns when no JSON-LD script blocks are present at all', () => {
  const result = extractJsonLd('<html><body>no jsonld here</body></html>');
  assert.equal(result.events.length, 0);
  assert.ok(result.warnings.some((w) => w.includes('No application/ld+json')));
});

test('warns when JSON-LD is present but contains no Event/SportsEvent node', () => {
  const html = `<script type="application/ld+json">{"@type":"Organization","name":"Not An Event"}</script>`;
  const result = extractJsonLd(html);
  assert.equal(result.events.length, 0);
  assert.ok(result.warnings.some((w) => w.includes('no Event or SportsEvent node')));
});
