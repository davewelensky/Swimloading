// The tide place list is shared by the cron that fetches and the route that
// serves. Two copies of a list like that is how a place ends up fetched but
// never served — the same drift that broke the explore facet check earlier
// this month — so these tests hold the single definition to its contract.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TIDE_PLACES, TIDE_PLACE_KEYS, tidePlace, staleAfterHours } from '../api/_lib/tide-places.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('every place has coordinates, a window and a label', () => {
  assert.ok(TIDE_PLACE_KEYS.length >= 4);
  for (const [key, p] of Object.entries(TIDE_PLACES)) {
    assert.match(key, /^[a-z0-9-]+$/, `${key} must be URL-safe — it is a query parameter`);
    assert.ok(Number.isFinite(p.lat) && p.lat >= -90 && p.lat <= 90, `${key} latitude`);
    assert.ok(Number.isFinite(p.lon) && p.lon >= -180 && p.lon <= 180, `${key} longitude`);
    assert.ok(Number.isInteger(p.days) && p.days > 0 && p.days <= 14,
      `${key} days must be 1-14 — WorldTides charges per call and a wider window is a dearer call`);
    assert.ok(p.label && p.label.length > 2, `${key} label`);
  }
});

// The security property the whole route rests on. If lookup ever became
// permissive — an arbitrary lat/lon, or a default place — the proxy would be
// no safer than the public API key it replaced.
test('an unknown place resolves to null, never a default', () => {
  for (const bad of ['nope', '', null, undefined, 'BIG-BAY-XYZ', '../dover', '-33.7,18.4', 0, {}]) {
    assert.equal(tidePlace(bad), null, `${JSON.stringify(bad)} must not resolve`);
  }
});

test('lookup is case-insensitive, because a query string is user input', () => {
  assert.equal(tidePlace('BIG-BAY'), TIDE_PLACES['big-bay']);
  assert.equal(tidePlace('Dover'), TIDE_PLACES.dover);
});

test('staleness is derived from the window, never fixed', () => {
  // A 2-day place must be refreshed with time in hand; a 14-day place has
  // days of slack. A single fixed TTL would be wrong at one end or the other.
  assert.ok(staleAfterHours(TIDE_PLACES['big-bay']) <= 24 * TIDE_PLACES['big-bay'].days,
    'a place must go stale before its window runs out');
  assert.ok(staleAfterHours(TIDE_PLACES.dover) > staleAfterHours(TIDE_PLACES['big-bay']),
    'a wider window should tolerate a longer gap');
  assert.ok(staleAfterHours(TIDE_PLACES['big-bay']) >= 24,
    'never below a day — the cron runs daily and needs more than one chance');
});

// The reason this module exists. If either consumer stops importing it,
// someone has started a second list.
test('both the cron and the route read the shared definition', () => {
  for (const f of ['api/cron/tides.js', 'api/tides.js']) {
    const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
    assert.match(src, /from '\.\.?\/(_lib\/)?_?lib?\/?tide-places\.js'|tide-places\.js'/,
      `${f} must import the shared place list rather than keep its own`);
    assert.ok(!/lat:\s*-?\d+\.\d+\s*,\s*lon:/.test(src),
      `${f} must not define coordinates of its own — that is the drift this file prevents`);
  }
});

test('no hardcoded WorldTides key anywhere in the tree', () => {
  // The key lived in four public HTML files and was served to every visitor.
  // It is rotated and server-side now; this makes sure it never comes back.
  const skip = new Set(['node_modules', '.git', 'graphify-out', 'out', 'device', '.claude']);
  const offenders = [];
  (function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (skip.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { walk(full); continue; }
      if (!/\.(html|js|mjs|ts)$/.test(entry.name)) continue;
      const src = fs.readFileSync(full, 'utf8');
      // A key assigned to a constant, or pasted into a WorldTides URL.
      if (/WORLDTIDES_KEY\s*=\s*['"][0-9a-f]{8}-/.test(src) ||
          /worldtides\.info\/api[^'"`]*key=[0-9a-f]{8}-/.test(src)) {
        offenders.push(path.relative(ROOT, full));
      }
    }
  })(ROOT);
  assert.deepEqual(offenders, [],
    'a WorldTides key is hardcoded in these files — it must come from ' +
    'WORLDTIDES_API_KEY on the server, never be shipped to a browser');
});
