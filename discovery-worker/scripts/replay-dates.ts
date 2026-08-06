// Read-only dry run: replays the CURRENT date parser over the stored
// original_date_text of every candidate that landed on 1 January, and
// reports what it would read now.
//
// Unchanged pages are never re-extracted, so a parser fix does not reach
// rows already stored. This answers the only question worth asking before
// backfilling them: given the text we already captured, does the fixed
// parser produce the right date? It writes nothing.
//
//   npx tsx scripts/replay-dates.ts
//   npx tsx scripts/replay-dates.ts --sql

import { createClient } from '@supabase/supabase-js';
import { dayFirstForCountry, parseFreeTextDate } from '../src/normalize/date.js';

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_KEY;
if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_KEY are required');
const db = createClient(url, key, { auth: { persistSession: false } });

// PostgREST caps a response at 1000 rows and says nothing about it. There
// are 1141 candidates with a date, so an unpaged select silently dropped
// 6 of the 136 rows this script exists to find — the same trap that made
// --only-missing look at 19 venues instead of 83. Page explicitly.
const PAGE = 500;
const data: Record<string, unknown>[] = [];
for (let from = 0; ; from += PAGE) {
  const { data: page, error } = await db
    .from('discovery_candidate_events')
    .select('id, canonical_name, start_date, end_date, original_date_text, candidate_status, promoted_edition_id, source_id, discovery_sources(name, country_code)')
    .not('start_date', 'is', null)
    .order('id')
    .range(from, from + PAGE - 1);
  if (error) throw new Error(error.message);
  data.push(...((page ?? []) as Record<string, unknown>[]));
  if (!page || page.length < PAGE) break;
}
console.log(`scanned ${data.length} candidates with a date\n`);

const today = new Date().toISOString().slice(0, 10);
const jan1 = data.filter((r) => /-01-01$/.test(r.start_date as string));

let fixed = 0;
let stillUnread = 0;
const rows: Array<[string, string, string | null]> = [];
const bySource = new Map<string, { fixed: number; unread: number; future: number }>();

for (const r of jan1) {
  const src = (r.discovery_sources ?? {}) as { name?: string; country_code?: string | null };
  const parsed = parseFreeTextDate(r.original_date_text as string, {
    dayFirst: dayFirstForCountry(src.country_code ?? null),
  });
  const label = src.name ?? 'unknown';
  if (!bySource.has(label)) bySource.set(label, { fixed: 0, unread: 0, future: 0 });
  const tally = bySource.get(label)!;

  if (parsed.startDate && parsed.dateConfirmed) {
    fixed += 1;
    tally.fixed += 1;
    if (parsed.startDate >= today) tally.future += 1;
    rows.push([r.id as string, parsed.startDate, parsed.endDate]);
    console.log(
      `  ${String(r.original_date_text).padEnd(30)} ${r.start_date} -> ${parsed.startDate}` +
        `${parsed.endDate ? `..${parsed.endDate}` : ''}  [${label.slice(0, 32)}]` +
        `${parsed.startDate >= today ? '  UPCOMING' : ''}`
    );
  } else {
    stillUnread += 1;
    tally.unread += 1;
    console.log(`  ${String(r.original_date_text).padEnd(30)} ${r.start_date} -> still unread  [${label.slice(0, 32)}]`);
  }
}

console.log(`\n${fixed} of ${jan1.length} recovered, ${stillUnread} still unread\n`);
console.log('by source (fixed / unread / of which upcoming):');
for (const [name, t] of [...bySource.entries()].sort((a, b) => b[1].fixed - a[1].fixed)) {
  console.log(`  ${name.slice(0, 46).padEnd(48)} ${t.fixed} / ${t.unread} / ${t.future}`);
}

// Nothing here should already be public: a wrong date that published is a
// different and much worse problem than a wrong date sitting in the queue.
const published = jan1.filter((r) => r.promoted_edition_id);
console.log(`\npublished with a 1-January date: ${published.length}`);

if (process.argv.includes('--sql')) {
  console.log('\n-- candidate_id, start_date, end_date');
  for (const [id, start, end] of rows) {
    console.log(`  ('${id}'::uuid, '${start}'::date, ${end ? `'${end}'::date` : 'NULL'}),`);
  }
}
