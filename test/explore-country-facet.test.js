// The country facet on /explore counts the same swims the list does. It can
// only do that while explore_country_facet() applies the same filters as
// search_events_v2() — two function bodies that must be changed together and
// that nothing in Postgres forces to agree.
//
// So this test reads both out of the migrations and compares their predicates.
// It is deliberately offline: nothing else in test/ touches the network, and a
// facet that silently disagrees with the search is a correctness bug that
// should fail in CI rather than at a swimmer.
//
// If this fails, the fix is almost never to edit the expectations here — it is
// to copy the new predicate across so the two functions filter alike.
//
// History worth keeping: the first version of this test compared a block of
// SQL marked by ↓↓ / ↑↑ comments. That rotted within two days —
// 2026-08-20_distance-filter-includes-unknown.sql redefined BOTH functions
// correctly and in step, and quite reasonably did not re-paste a decorative
// comment block, which failed the check for a migration that was right. A
// drift check that only works while someone maintains its decoration is not a
// check. It now extracts the bodies structurally, so it needs nothing of the
// author except that they keep the two functions honest.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Predicates the facet omits ON PURPOSE. A facet must not filter by its own
// dimension: given p_country it could only ever return the country already
// chosen, which is the one the swimmer does not need to be told about.
// p_region is a sub-dimension of country and goes with it.
const DELIBERATELY_ABSENT = ['p_country', 'p_region'];

/** Every migration that defines `name`, oldest first by filename. */
function allMigrationsDefining(name) {
  const dirs = [path.join(ROOT, 'sql'), path.join(ROOT, 'sql/applied')];
  const hits = [];
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith('.sql')) continue;
      const body = fs.readFileSync(path.join(dir, f), 'utf8');
      if (new RegExp(`CREATE OR REPLACE FUNCTION public\\.${name}\\b`).test(body)) {
        hits.push({ file: f, body });
      }
    }
  }
  assert.ok(hits.length > 0, `no migration defines ${name}`);
  hits.sort((a, b) => a.file.localeCompare(b.file));
  return hits;
}

/**
 * The body of `name` as most recently defined — what the database runs today.
 * Filenames are dated, so the last one alphabetically is the newest.
 */
function latestBodyOf(name) {
  const hits = allMigrationsDefining(name);
  const { file, body } = hits[hits.length - 1];

  // A migration may define several functions; take the last definition of
  // THIS one in the file.
  const marker = `CREATE OR REPLACE FUNCTION public.${name}`;
  const at = body.lastIndexOf(marker);
  assert.notEqual(at, -1, `could not locate ${name} in ${file}`);

  // Bodies are dollar-quoted: AS $fn$ … $fn$ (or $function$).
  const rest = body.slice(at);
  const opened = rest.match(/AS\s+(\$[A-Za-z_]*\$)/);
  assert.ok(opened, `could not find the body delimiter of ${name} in ${file}`);
  const tag = opened[1];
  const start = rest.indexOf(tag, opened.index) + tag.length;
  const end = rest.indexOf(tag, start);
  assert.ok(end > start, `unterminated body for ${name} in ${file}`);

  return { file, sql: rest.slice(start, end) };
}

/**
 * The predicates of the MAIN WHERE block — the one that decides which editions
 * exist at all. Both functions open it with `WHERE e.is_searchable`.
 *
 * Scoped rather than "every line starting with AND", because search_events_v2
 * also has correlated subqueries in its SELECT list:
 *
 *     (SELECT min(d.distance_metres) FROM event_distances d
 *       WHERE d.edition_id = e.id
 *         AND (p_min_distance_m IS NULL OR …)) AS matched_distance_m
 *
 * That AND belongs to a value the facet has no reason to compute — it counts
 * rows, it does not report a matched distance — so treating it as a missing
 * filter reported drift that did not exist.
 */
function predicateLines(sql) {
  const lines = sql.split('\n').map((l) => l.replace(/--.*$/, ''));
  const from = lines.findIndex((l) => /^\s*WHERE\s+e\.is_searchable/.test(l));
  assert.notEqual(from, -1, 'could not find the main WHERE block (WHERE e.is_searchable)');

  const out = [];
  for (let i = from + 1; i < lines.length; i++) {
    const raw = lines[i];
    const t = raw.trim();
    if (!t) continue;
    // The CTE closes with a `)` at the start of a line — end of this WHERE.
    if (/^\s{0,4}\)/.test(raw)) break;
    if (/^AND\b/i.test(t)) out.push(t.replace(/\s+/g, ' '));
  }
  return out;
}

test('explore_country_facet applies every search_events_v2 filter', () => {
  const v2 = latestBodyOf('search_events_v2');
  const facet = latestBodyOf('explore_country_facet');

  const wanted = predicateLines(v2.sql);
  const got = new Set(predicateLines(facet.sql));

  assert.ok(wanted.length >= 8,
    `expected search_events_v2 to have real predicates, found ${wanted.length} in ${v2.file}`);

  const missing = wanted.filter(
    (p) => !got.has(p) && !DELIBERATELY_ABSENT.some((n) => p.includes(n)),
  );

  assert.deepEqual(missing, [],
    `explore_country_facet (${facet.file}) is missing filters that ` +
    `search_events_v2 (${v2.file}) applies. The facet would report more swims ` +
    `in a country than the list can show. Copy these across:\n  ` +
    missing.join('\n  '));
});

test('explore_country_facet omits its own dimension', () => {
  const hits = allMigrationsDefining('explore_country_facet');
  const { file, body } = hits[hits.length - 1];
  const at = body.lastIndexOf('CREATE OR REPLACE FUNCTION public.explore_country_facet');
  const signature = body.slice(at, body.indexOf('RETURNS TABLE', at));
  for (const param of DELIBERATELY_ABSENT) {
    assert.ok(!signature.includes(param),
      `explore_country_facet (${file}) must not take ${param}: a facet filtered ` +
      `by its own dimension can only ever return the value already selected.`);
  }
});

test('explore_country_facet grants execute to the anon role', () => {
  // ANY definition, not the newest. CREATE OR REPLACE preserves privileges, so
  // only the migration that first created the function has to grant them —
  // verified live on 2026-08-22: after the 08-20 redefinition, which contains
  // no GRANT, has_function_privilege('anon', …, 'EXECUTE') was still true.
  // Requiring it of every definition failed a correct migration.
  const defs = allMigrationsDefining('explore_country_facet');
  const granted = defs.some((d) =>
    /GRANT EXECUTE ON FUNCTION public\.explore_country_facet TO [^;]*\banon\b/.test(d.body));
  assert.ok(granted,
    '/explore reads with the anon key; without a grant in some migration the ' +
    'facet 500s for every visitor. Checked across: ' + defs.map((d) => d.file).join(', '));
});
