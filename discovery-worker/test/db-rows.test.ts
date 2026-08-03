import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { processFixture } from '../src/jobs/process-fixture.js';
import {
  contentHash,
  toCandidateDistanceRows,
  toCandidateEventRow,
  toEvidenceRows,
  toSourcePageRow,
} from '../src/db/rows.js';

// Pure row-shape tests: no network, no credentials, no database. These
// assert exactly what WOULD be written, which is the part worth pinning
// down before anything touches production.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixture = (name: string) => path.join(__dirname, '..', 'fixtures', name);
const SOURCE_ID = '00000000-0000-4000-8000-000000000001';
const PAGE_ID = '00000000-0000-4000-8000-0000000000aa';
const CANDIDATE_ID = '00000000-0000-4000-8000-0000000000bb';

test('candidate row carries the key, source and confidence recommendation', async () => {
  const r = await processFixture(fixture('valid-multiple-distances.html'));
  const row = toCandidateEventRow(r.candidate, r.confidence, SOURCE_ID, PAGE_ID);

  assert.equal(row.candidate_key, r.candidate.candidateKey);
  assert.equal(row.source_id, SOURCE_ID);
  assert.equal(row.source_page_id, PAGE_ID);
  assert.equal(row.publication_recommendation, 'high_confidence');
  assert.equal(row.confidence_score, 80);
  assert.equal(row.country_code, 'GB');
  assert.equal(row.date_confirmed, true);
  assert.equal(row.start_date, '2027-07-18');
});

test('candidate row satisfies the anti-inference CHECK: unconfirmed date carries no dates', async () => {
  const r = await processFixture(fixture('missing-year.html'));
  const row = toCandidateEventRow(r.candidate, r.confidence, SOURCE_ID, null);

  assert.equal(row.date_confirmed, false);
  assert.equal(row.start_date, null);
  assert.equal(row.end_date, null);
});

test('candidate row preserves the organiser original date wording in its own column', async () => {
  const r = await processFixture(fixture('partial-date.html'));
  const row = toCandidateEventRow(r.candidate, r.confidence, SOURCE_ID, null);
  assert.ok(row.original_date_text && row.original_date_text.includes('September 2027'));
});

test('coordinates are written paired or not at all (satisfies dce_coords_paired)', async () => {
  for (const name of ['valid-single-event.html', 'missing-year.html', 'partial-date.html']) {
    const r = await processFixture(fixture(name));
    const row = toCandidateEventRow(r.candidate, r.confidence, SOURCE_ID, null);
    assert.equal(row.latitude === null, row.longitude === null, `${name}: coords not paired`);
  }
});

test('confidence_score always lands inside the 0-100 CHECK range', async () => {
  for (const name of ['valid-single-event.html', 'historical-event.html', 'pool-only-event.html']) {
    const r = await processFixture(fixture(name));
    const row = toCandidateEventRow(r.candidate, r.confidence, SOURCE_ID, null);
    assert.ok(row.confidence_score >= 0 && row.confidence_score <= 100, name);
  }
});

test('the event status is preserved (not silently dropped) despite having no dedicated column yet', async () => {
  const r = await processFixture(fixture('cancelled-event.html'));
  const row = toCandidateEventRow(r.candidate, r.confidence, SOURCE_ID, null);
  assert.equal(r.candidate.status, 'cancelled');
  assert.equal(row.raw_source_values.eventStatus, 'cancelled');
  assert.equal((row.raw_payload as { status?: unknown }).status, 'cancelled');
});

test('distances become one row each, never an array or a JSON blob', async () => {
  const r = await processFixture(fixture('valid-multiple-distances.html'));
  const rows = toCandidateDistanceRows(r.candidate, CANDIDATE_ID);

  assert.equal(rows.length, 3);
  assert.ok(rows.every((row) => row.candidate_id === CANDIDATE_ID));
  const elite = rows.find((row) => row.distance_metres === 10000);
  assert.ok(elite);
  assert.equal(elite.qualification_required, true);
  assert.equal(elite.wetsuit_policy, 'mandatory');
  assert.equal(elite.original_label, '10km Elite Wave (qualification required)');
});

test('distance rows never carry a non-positive distance (satisfies dcd_positive_distance)', async () => {
  const r = await processFixture(fixture('valid-multiple-distances.html'));
  const rows = toCandidateDistanceRows(r.candidate, CANDIDATE_ID);
  assert.ok(rows.every((row) => row.distance_metres === null || row.distance_metres > 0));
});

test('evidence rows are field-addressable and use only DB-valid evidence types', async () => {
  const r = await processFixture(fixture('valid-multiple-distances.html'));
  const rows = toEvidenceRows(r.candidate, CANDIDATE_ID, PAGE_ID);

  assert.ok(rows.length > 0);
  const allowed = new Set(['jsonld', 'html_selector', 'meta_tag']);
  assert.ok(rows.every((row) => allowed.has(row.evidence_type)));
  assert.ok(rows.every((row) => typeof row.field_name === 'string' && row.field_name.length > 0));
  assert.ok(rows.some((row) => row.field_name === 'startDate'));
});

test('an unmappable evidence type throws rather than writing an invalid row', async () => {
  const r = await processFixture(fixture('valid-single-event.html'));
  const tampered = {
    ...r.candidate,
    evidence: [{ field: 'x', evidenceType: 'ai_fallback' as never, rawValue: null, selector: null, note: null }],
  };
  assert.throws(() => toEvidenceRows(tampered, CANDIDATE_ID, null), /Unmappable evidence type/);
});

test('source page row hashes content and does not fabricate an HTTP status', () => {
  const row = toSourcePageRow(SOURCE_ID, 'https://organiser.example/e', '<html>abc</html>');
  assert.equal(row.source_id, SOURCE_ID);
  assert.equal(row.canonical_url, 'https://organiser.example/e');
  assert.equal(row.content_hash, contentHash('<html>abc</html>'));
  // Nothing was fetched over HTTP in this phase; a fake 200 would be a
  // lie in the audit trail.
  assert.equal(row.http_status, null);
});

test('content hashing is stable and detects change (the change-monitoring primitive)', () => {
  assert.equal(contentHash('<p>same</p>'), contentHash('<p>same</p>'));
  assert.notEqual(contentHash('<p>a</p>'), contentHash('<p>b</p>'));
});
