// Read-only dry run: re-fetches the source page of every live edition that
// has no distances, runs the CURRENT extractor over it, and reports what it
// would store. Writes nothing — it emits SQL for review.
//
// Why this one re-fetches when the country and date replays did not: the
// raw JSON-LD `offers` array was never kept in raw_source_values, and no
// raw HTML is stored anywhere (discovery_source_pages holds only a content
// hash). So there is nothing to replay against and the bytes must be
// fetched again. buildCandidateEvent now records `jsonLdOffers`, so the
// next distance fix will be a replay rather than a crawl.
//
//   npx tsx scripts/backfill-distances.ts
//   npx tsx scripts/backfill-distances.ts --sql ../sql/2026-08-12_backfill.sql
//
// Fetches are made through PoliteHttpClient, so robots.txt and per-host
// delays are respected exactly as in a normal crawl.

import { writeFile } from 'node:fs/promises';
import { createClient } from '@supabase/supabase-js';
import { loadConfig } from '../src/config.js';
import { PoliteHttpClient } from '../src/fetch/http-client.js';
import { extractJsonLd } from '../src/extract/jsonld.js';
import { extractHtml } from '../src/extract/html.js';
import { distanceOptionsFromOffers, normaliseDistances } from '../src/normalize/distance.js';
import type { DistanceOption } from '../src/domain/candidate-event.js';

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_KEY;
if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_KEY are required');

const sqlArgIndex = process.argv.indexOf('--sql');
const sqlPath = sqlArgIndex === -1 ? null : process.argv[sqlArgIndex + 1] ?? null;

const db = createClient(url, key, { auth: { persistSession: false } });
const config = loadConfig();
const http = new PoliteHttpClient({
  userAgent: config.userAgent,
  timeoutMs: config.fetchTimeoutMs,
  maxRetries: config.fetchMaxRetries,
  minHostDelayMs: config.minHostDelayMs,
  maxCrawlDelayMs: config.maxCrawlDelayMs,
  maxResponseBytes: config.maxResponseBytes,
});

// PostgREST caps an unpaged select at 1000 rows and says nothing about it —
// this has produced three separate wrong answers on this project already.
async function fetchAll<T>(build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const page = 500;
  const out: T[] = [];
  for (let from = 0; ; from += page) {
    const { data, error } = await build(from, from + page - 1);
    if (error) throw new Error(error.message);
    const batch = data ?? [];
    out.push(...batch);
    if (batch.length < page) return out;
  }
}

interface Row {
  id: string;
  title: string;
  start_date: string;
  discovery_candidate_events: { source_url: string; extraction_method: string | null }[] | null;
}

const withDistances = new Set(
  (
    await fetchAll<{ edition_id: string }>((from, to) =>
      db.from('event_distances').select('edition_id').range(from, to)
    )
  ).map((r) => r.edition_id)
);

const today = new Date().toISOString().slice(0, 10);
const editions = (
  await fetchAll<Row>((from, to) =>
    db
      .from('event_editions')
      .select('id, title, start_date, discovery_candidate_events!promoted_edition_id(source_url, extraction_method)')
      .eq('is_searchable', true)
      .eq('discipline', 'open_water')
      .neq('status', 'cancelled')
      .gte('start_date', today)
      .range(from, to)
  )
).filter((e) => !withDistances.has(e.id) && (e.discovery_candidate_events?.[0]?.source_url ?? null) !== null);

console.log(`${editions.length} live editions with no distances and a source URL\n`);

const sqlLines: string[] = [];
let recovered = 0;
let unreadable = 0;
const failures: string[] = [];

function q(s: string): string {
  return `'${s.replace(/'/g, "''")}'`;
}

for (const [i, e] of editions.entries()) {
  const sourceUrl = e.discovery_candidate_events?.[0]?.source_url as string;
  const label = `[${i + 1}/${editions.length}] ${e.title.slice(0, 58)}`;
  const page = await http.fetchPage(sourceUrl, 'en');
  if (!page.ok || !page.html) {
    failures.push(`${e.title.slice(0, 50)} — ${page.errorCode ?? 'unknown'}`);
    console.log(`${label}\n    fetch failed: ${page.errorCode}`);
    continue;
  }

  const jsonld = extractJsonLd(page.html);
  const html = extractHtml(page.html);
  const node = jsonld.events[0] ?? null;
  let distances: DistanceOption[] = normaliseDistances(html.distances);
  let via = 'html_selector';
  if (distances.length === 0 && node) {
    distances = distanceOptionsFromOffers(node.offers);
    via = 'jsonld offers';
  }

  if (distances.length === 0) {
    console.log(`${label}\n    nothing`);
    continue;
  }

  recovered += 1;
  unreadable += distances.filter((d) => d.distanceMetres === null).length;
  console.log(
    `${label}\n    ${distances.length} via ${via}: ` +
      distances.map((d) => (d.distanceMetres === null ? `?(${d.originalLabel.slice(0, 24)})` : `${d.distanceMetres}m`)).join(', ')
  );

  for (const d of distances) {
    sqlLines.push(
      `INSERT INTO public.event_distances (edition_id, original_label, distance_metres, category, registration_url)\n` +
        `  SELECT ${q(e.id)}, ${q(d.originalLabel)}, ${d.distanceMetres ?? 'NULL'}, ` +
        `${d.category ? q(d.category) : 'NULL'}, ${d.registrationUrl ? q(d.registrationUrl) : 'NULL'}\n` +
        // Guarded per LABEL, not per edition: an edition-wide guard would
        // let the first distance in and silently block every sibling.
        `  WHERE NOT EXISTS (SELECT 1 FROM public.event_distances x\n` +
        `                     WHERE x.edition_id = ${q(e.id)} AND x.original_label = ${q(d.originalLabel)});`
    );
  }
}

console.log(`\n${'─'.repeat(64)}`);
console.log(`editions with distances recovered : ${recovered} of ${editions.length}`);
console.log(`distance rows to insert           : ${sqlLines.length}`);
console.log(`  of which length unknown         : ${unreadable}`);
console.log(`fetch failures                    : ${failures.length}`);
for (const f of failures) console.log(`    ${f}`);

if (sqlPath && sqlLines.length > 0) {
  await writeFile(sqlPath, `${sqlLines.join('\n')}\n`, 'utf8');
  console.log(`\nSQL written to ${sqlPath} — review before applying.`);
} else if (!sqlPath) {
  console.log(`\n(dry run — pass --sql <path> to write the statements)`);
}
