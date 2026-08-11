import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { SupabaseClient } from '@supabase/supabase-js';
import { blankCandidateEvent } from '../src/domain/candidate-event.js';
import { buildCandidateKey, unknownYearKeyFor } from '../src/domain/candidate-key.js';
import type { ConfidenceBreakdown } from '../src/confidence/score.js';
import { persistCandidate } from '../src/db/persist.js';

// Regression cover for the orphan bug of August 2026: a parser fix made
// 302 previously-dateless candidates readable, their keys moved from
// 'unknown-year' to a real year, and the upsert inserted twins instead of
// updating — stranding every original as `pending` forever.

const SOURCE_ID = '11111111-1111-4111-8111-111111111111';
const SOURCE_URL = 'https://organiser.example/events/bay-swim';
const NAME = 'Great Bay Swim';

interface Row {
  id: string;
  source_id: string;
  candidate_key: string;
  candidate_status: string;
  start_date: string | null;
  [k: string]: unknown;
}

// Minimal in-memory stand-in for the PostgREST chain persist.ts uses:
// .select().eq().eq().maybeSingle(), .update().eq(), .upsert().select().single(),
// .delete().eq(), .insert(). Only the shapes actually exercised are modelled.
function fakeDb(seed: Row[]) {
  const rows: Row[] = seed.map((r) => ({ ...r }));
  let nextId = rows.length + 1;

  const table = (name: string) => {
    if (name !== 'discovery_candidate_events') {
      // distances / evidence children — accept and ignore.
      return {
        delete: () => ({ eq: async () => ({ error: null }) }),
        insert: async () => ({ error: null }),
      };
    }
    return {
      select: (_cols: string) => {
        const filters: Array<[string, unknown]> = [];
        const api = {
          eq(col: string, val: unknown) {
            filters.push([col, val]);
            return api;
          },
          async maybeSingle() {
            const hit = rows.find((r) => filters.every(([c, v]) => r[c] === v));
            return { data: hit ?? null, error: null };
          },
        };
        return api;
      },
      update: (patch: Record<string, unknown>) => ({
        async eq(col: string, val: unknown) {
          for (const r of rows) if (r[col] === val) Object.assign(r, patch);
          return { error: null };
        },
      }),
      upsert: (row: Record<string, unknown>, _opts: unknown) => ({
        select: (_c: string) => ({
          async single() {
            const existing = rows.find(
              (r) => r.source_id === row.source_id && r.candidate_key === row.candidate_key
            );
            if (existing) {
              // The real upsert never writes candidate_status.
              const { candidate_status: _ignored, ...rest } = row as Record<string, unknown>;
              Object.assign(existing, rest);
              return { data: { id: existing.id }, error: null };
            }
            const created = {
              ...(row as unknown as Row),
              id: `new-${nextId++}`,
              candidate_status: 'pending',
            } as Row;
            rows.push(created);
            return { data: { id: created.id }, error: null };
          },
        }),
      }),
      delete: () => ({ eq: async () => ({ error: null }) }),
      insert: async () => ({ error: null }),
    };
  };

  return { db: { from: table } as unknown as SupabaseClient, rows };
}

const confidence: ConfidenceBreakdown = {
  totalScore: 50,
  reasons: [],
  recommendation: 'manual_review',
};

// A candidate whose date has just become readable.
function datedCandidate() {
  const c = blankCandidateEvent(SOURCE_ID, SOURCE_URL);
  c.canonicalName = NAME;
  c.startDate = '2026-09-12';
  c.dateConfirmed = true;
  c.datePrecision = 'exact';
  c.candidateKey = buildCandidateKey({
    sourceUrl: SOURCE_URL,
    name: NAME,
    startDate: '2026-09-12',
    dateConfirmed: true,
  });
  return c;
}

const unknownKey = unknownYearKeyFor({ sourceUrl: SOURCE_URL, name: NAME });

test('a dateless predecessor is re-keyed in place, not duplicated', async () => {
  const { db, rows } = fakeDb([
    {
      id: 'orphan-1',
      source_id: SOURCE_ID,
      candidate_key: unknownKey,
      candidate_status: 'pending',
      start_date: null,
    },
  ]);

  const c = datedCandidate();
  const result = await persistCandidate(db, c, confidence, SOURCE_ID, null);

  assert.equal(result.unknownYearRow, 'reclaimed');
  assert.equal(rows.length, 1, 'no twin row was created');
  const survivor = rows[0]!;
  assert.equal(survivor.id, 'orphan-1', 'the original row survived, keeping its id');
  assert.equal(survivor.candidate_key, c.candidateKey);
  assert.equal(survivor.start_date, '2026-09-12', 'the recovered date landed on it');
});

test('reclaiming preserves a review decision already made on the row', async () => {
  const { db, rows } = fakeDb([
    {
      id: 'orphan-2',
      source_id: SOURCE_ID,
      candidate_key: unknownKey,
      candidate_status: 'approved',
      start_date: null,
    },
  ]);

  await persistCandidate(db, datedCandidate(), confidence, SOURCE_ID, null);

  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.candidate_status, 'approved', 'the human verdict was not reset');
});

test('when a dated row already exists, the dateless twin is retired as duplicate', async () => {
  const c = datedCandidate();
  const { db, rows } = fakeDb([
    {
      id: 'orphan-3',
      source_id: SOURCE_ID,
      candidate_key: unknownKey,
      candidate_status: 'pending',
      start_date: null,
    },
    {
      id: 'dated-3',
      source_id: SOURCE_ID,
      candidate_key: c.candidateKey,
      candidate_status: 'approved',
      start_date: '2026-09-12',
    },
  ]);

  const result = await persistCandidate(db, c, confidence, SOURCE_ID, null);

  assert.equal(result.unknownYearRow, 'retired');
  assert.equal(rows.find((r) => r.id === 'orphan-3')!.candidate_status, 'duplicate');
  assert.equal(rows.find((r) => r.id === 'dated-3')!.candidate_status, 'approved');
});

test('a decided twin is never overwritten, even when redundant', async () => {
  const c = datedCandidate();
  const { db, rows } = fakeDb([
    {
      id: 'orphan-4',
      source_id: SOURCE_ID,
      candidate_key: unknownKey,
      candidate_status: 'rejected',
      start_date: null,
    },
    {
      id: 'dated-4',
      source_id: SOURCE_ID,
      candidate_key: c.candidateKey,
      candidate_status: 'pending',
      start_date: '2026-09-12',
    },
  ]);

  const result = await persistCandidate(db, c, confidence, SOURCE_ID, null);

  assert.equal(result.unknownYearRow, 'none');
  assert.equal(rows.find((r) => r.id === 'orphan-4')!.candidate_status, 'rejected');
});

test('a still-dateless candidate touches nothing — the key has not moved', async () => {
  const c = blankCandidateEvent(SOURCE_ID, SOURCE_URL);
  c.canonicalName = NAME;
  c.candidateKey = unknownKey;

  const { db, rows } = fakeDb([
    {
      id: 'orphan-5',
      source_id: SOURCE_ID,
      candidate_key: unknownKey,
      candidate_status: 'pending',
      start_date: null,
    },
  ]);

  const result = await persistCandidate(db, c, confidence, SOURCE_ID, null);

  assert.equal(result.unknownYearRow, 'none');
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.candidate_status, 'pending');
});

test('a genuinely new annual edition does not cannibalise the previous year', async () => {
  // 2027's listing must NOT reclaim 2026's row: both are real editions.
  const key2026 = buildCandidateKey({
    sourceUrl: SOURCE_URL,
    name: NAME,
    startDate: '2026-09-12',
    dateConfirmed: true,
  });
  const { db, rows } = fakeDb([
    {
      id: 'edition-2026',
      source_id: SOURCE_ID,
      candidate_key: key2026,
      candidate_status: 'approved',
      start_date: '2026-09-12',
    },
  ]);

  const c = datedCandidate();
  c.startDate = '2027-09-11';
  c.candidateKey = buildCandidateKey({
    sourceUrl: SOURCE_URL,
    name: NAME,
    startDate: '2027-09-11',
    dateConfirmed: true,
  });

  const result = await persistCandidate(db, c, confidence, SOURCE_ID, null);

  assert.equal(result.unknownYearRow, 'none');
  assert.equal(rows.length, 2, 'both editions exist');
  assert.equal(rows.find((r) => r.id === 'edition-2026')!.start_date, '2026-09-12');
});
