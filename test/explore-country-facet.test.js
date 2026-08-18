// The country facet on /explore counts the same swims the list does. It can
// only do that because explore_country_facet() carries a verbatim copy of
// search_events_v2()'s filter predicate — and a copy is exactly the kind of
// thing that rots the first time someone adds a filter to one of them.
//
// So this test reads both migrations and asserts the predicates still agree.
// It is deliberately offline: nothing else in test/ touches the network, and
// a facet that silently disagrees with the search is a correctness bug that
// should fail in CI rather than at a swimmer.
//
// If this fails, the fix is almost never to edit the expectations here — it
// is to copy the new predicate across so the two functions filter alike.

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

/** The newest migration that defines `name`, so a future redefinition wins. */
function latestMigrationDefining(name) {
  const dirs = [path.join(ROOT, 'sql'), path.join(ROOT, 'sql/applied')];
  const hits = [];
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith('.sql')) continue;
      const full = path.join(dir, f);
      const body = fs.readFileSync(full, 'utf8');
      if (new RegExp(`CREATE OR REPLACE FUNCTION public\\.${name}\\b`).test(body)) {
        hits.push({ file: f, body });
      }
    }
  }
  assert.ok(hits.length > 0, `no migration defines ${name}`);
  hits.sort((a, b) => a.file.localeCompare(b.file));
  return hits[hits.length - 1];
}

/** Every `AND (...)`/`AND x` line of a WHERE block, normalised for comparison. */
function predicateLines(sql) {
  return sql
    .split('\n')
    .map((l) => l.replace(/--.*$/, '').trim())     // strip trailing comments
    .filter((l) => /^AND\b/i.test(l))
    .map((l) => l.replace(/\s+/g, ' '));
}

/** The base WHERE of search_events_v2: from `WHERE e.is_searchable` to `),`. */
function v2BaseWhere(body) {
  const start = body.indexOf('WHERE e.is_searchable');
  assert.notEqual(start, -1, 'search_events_v2 base WHERE not found');
  const end = body.indexOf('\n  ),', start);
  assert.notEqual(end, -1, 'end of search_events_v2 base CTE not found');
  return body.slice(start, end);
}

/** The explicitly marked copied block inside explore_country_facet. */
function facetCopiedBlock(body) {
  const open = body.indexOf('↓↓');
  const close = body.indexOf('↑↑');
  assert.ok(open !== -1 && close !== -1 && close > open,
    'explore_country_facet has lost its copied-block markers — restore them, ' +
    'they are what makes this drift check possible');
  return body.slice(open, close);
}

test('explore_country_facet copies every search_events_v2 filter', () => {
  const v2 = latestMigrationDefining('search_events_v2');
  const facet = latestMigrationDefining('explore_country_facet');

  const wanted = predicateLines(v2BaseWhere(v2.body));
  const got = new Set(predicateLines(facetCopiedBlock(facet.body)));

  assert.ok(wanted.length >= 8, `expected v2 to have real predicates, got ${wanted.length}`);

  const missing = wanted.filter(
    (p) => !got.has(p) && !DELIBERATELY_ABSENT.some((n) => p.includes(n)),
  );

  assert.deepEqual(missing, [],
    `explore_country_facet is missing filters that search_events_v2 applies.\n` +
    `The facet would report more swims in a country than the list can show.\n` +
    `Copy these across (${facet.file}):\n  ` + missing.join('\n  '));
});

test('explore_country_facet omits its own dimension', () => {
  const facet = latestMigrationDefining('explore_country_facet');
  const signature = facet.body.slice(
    facet.body.indexOf('CREATE OR REPLACE FUNCTION public.explore_country_facet'),
    facet.body.indexOf('RETURNS TABLE'),
  );
  for (const param of DELIBERATELY_ABSENT) {
    assert.ok(!signature.includes(param),
      `explore_country_facet must not take ${param}: a facet filtered by its ` +
      `own dimension can only ever return the value already selected.`);
  }
});

test('explore_country_facet grants execute to the anon role', () => {
  const facet = latestMigrationDefining('explore_country_facet');
  assert.match(facet.body, /GRANT EXECUTE ON FUNCTION public\.explore_country_facet TO [^;]*\banon\b/,
    '/explore reads with the anon key; without this grant the facet 500s for every visitor');
});
