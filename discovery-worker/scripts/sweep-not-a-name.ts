// Read-only: runs the CURRENT rejectAsEventName() rules over every
// candidate still awaiting a decision, and reports what they would catch.
//
// The rules only run at extraction time, so tightening them does nothing
// to rows already in the queue — and, more importantly, a rule tuned on a
// handful of examples can be wrong in ways a unit test full of examples
// you thought of yourself will never show. This runs it against the real
// queue instead. Writes nothing.
//
//   npx tsx scripts/sweep-not-a-name.ts
//
// Read the KEPT list as carefully as the matched list: anything published
// showing up here means a rule is too broad and must be narrowed before
// it ships.

import { createClient } from '@supabase/supabase-js';
import { rejectAsEventName } from '../src/normalize/text.js';

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_KEY;
if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_KEY are required');

const db = createClient(url, key, { auth: { persistSession: false } });

const { data, error } = await db
  .from('discovery_candidate_events')
  .select('id, canonical_name, original_name, candidate_status, start_date, promoted_edition_id, source_url')
  .in('candidate_status', ['pending', 'needs_review']);
if (error) throw new Error(error.message);

const rows = data ?? [];
const hits = rows
  .map((r) => ({ r, why: rejectAsEventName((r.original_name as string) || (r.canonical_name as string)) }))
  .filter((x) => x.why);

console.log(`${hits.length} of ${rows.length} undecided candidates match the name rules\n`);

const bySource = new Map<string, typeof hits>();
for (const h of hits) {
  const k = (h.r.source_url as string) || 'unknown';
  if (!bySource.has(k)) bySource.set(k, []);
  bySource.get(k)!.push(h);
}
for (const [src, group] of bySource) {
  console.log(`${src}  (${group.length})`);
  for (const { r, why } of group) {
    console.log(
      `  ${String(r.canonical_name).padEnd(26)} date=${r.start_date ?? 'null'}` +
        `  published=${r.promoted_edition_id ? 'YES — INVESTIGATE' : 'no'}  ${why}`
    );
  }
  console.log('');
}

// A published event matching a name rule means the rule is too broad, or
// something reached the public catalogue that should never have.
const published = hits.filter((h) => h.r.promoted_edition_id);
if (published.length) {
  console.log(`WARNING: ${published.length} matched candidates are PUBLISHED. Do not proceed.`);
}

console.log('IDS:', JSON.stringify(hits.map((h) => h.r.id)));
