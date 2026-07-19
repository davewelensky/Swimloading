#!/usr/bin/env node
// Static repository check: fails if runtime code still contains
// unrestricted club_roster reads. Run before every club_roster RLS
// migration and periodically afterward as a regression guard.
//
// Usage: node scripts/check-club-roster-access.mjs

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const SKIP_DIRS = new Set(['node_modules', '.git', '.claude', 'archive', '14files', 'Deploy_SwimLoading']);
const EXTS = new Set(['.html', '.js']);

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (EXTS.has(extname(entry))) out.push(full);
  }
  return out;
}

let failures = 0;

for (const file of walk(ROOT)) {
  const content = readFileSync(file, 'utf8');
  const rel = file.replace(ROOT, '');

  // Rule 1: no .select('*') on club_roster
  if (/from\(['"]club_roster['"]\)[^;]*?select\(\s*['"]\*['"]/s.test(content)) {
    console.log(`FAIL  ${rel} — .select('*') against club_roster`);
    failures++;
  }

  // Rule 2: any .from('club_roster') SELECT/UPDATE/DELETE call must appear
  // with a scoping filter within a reasonable window (id/user_id/club_id).
  // INSERTs are excluded — they're governed by WITH CHECK on the payload
  // (club_id: ... in the insert object), not row-filtering, and are
  // already covered by the existing club_roster_insert_by_admin/coach
  // policies (untouched by this migration). This is a heuristic, not a
  // parser — it flags anything to manually verify, erring toward false
  // positives on the side of SELECT/UPDATE/DELETE.
  const fromMatches = [...content.matchAll(/from\(['"]club_roster['"]\)/g)];
  for (const m of fromMatches) {
    const windowEnd = Math.min(content.length, m.index + 400);
    const window = content.slice(m.index, windowEnd);
    const isInsert = /\.insert\(/.test(content.slice(m.index, Math.min(content.length, m.index + 60)));
    if (isInsert) continue;
    const scoped = /\.eq\(\s*['"](club_id|id|user_id)['"]|\.in\(\s*['"](club_id|id|user_id)['"]/.test(window);
    if (!scoped) {
      const line = content.slice(0, m.index).split('\n').length;
      console.log(`FAIL  ${rel}:${line} — .from('club_roster') with no visible club_id/id/user_id scoping within 400 chars`);
      failures++;
    }
  }
}

if (failures === 0) {
  console.log('OK — no unscoped club_roster reads found.');
  process.exit(0);
} else {
  console.log(`\n${failures} issue(s) found.`);
  process.exit(1);
}
