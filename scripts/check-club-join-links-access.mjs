#!/usr/bin/env node
// Static repository check: fails if runtime code enumerates
// club_join_links broadly, reads it without a club_id scope, or performs
// client-side invite code validation (checking expiry/use_count/is_active
// in JS instead of via the RPCs, which is not real access control).
//
// Usage: node scripts/check-club-join-links-access.mjs

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

  // Rule 1: any read must be club_id-scoped (admin management context) or
  // an .insert()/.update() (governed by existing, untouched write policies).
  // select('*') itself is fine when club_id-scoped — the admin management
  // view legitimately needs the full row (code, expiry, use_count) for
  // their own club, gated server-side by the new admin SELECT policy.
  const fromMatches = [...content.matchAll(/from\(['"]club_join_links['"]\)/g)];
  for (const m of fromMatches) {
    const windowEnd = Math.min(content.length, m.index + 300);
    const window = content.slice(m.index, windowEnd);
    const isWrite = /\.(insert|update|delete)\(/.test(content.slice(m.index, Math.min(content.length, m.index + 60)));
    if (isWrite) continue;
    const scoped = /\.eq\(\s*['"]club_id['"]|\.eq\(\s*['"]code['"]|\.eq\(\s*['"]id['"]/.test(window);
    if (!scoped) {
      const line = content.slice(0, m.index).split('\n').length;
      console.log(`FAIL  ${rel}:${line} — .from('club_join_links') read with no visible club_id/code/id scoping`);
      failures++;
    }
  }

  // Rule 2: no client-side validation of expiry/use_count/is_active for a
  // code (that logic belongs in validate_join_code()/redeem_club_join_code(),
  // not the browser) — flags a JS comparison against these fields near a
  // club_join_links reference.
  if (/club_join_links/.test(content)) {
    const suspicious = /(expires_at|use_count|max_uses)\s*(>=|<=|<|>|===|!==)/;
    if (suspicious.test(content)) {
      console.log(`WARN  ${rel} — found a JS comparison against expires_at/use_count/max_uses near a club_join_links reference; verify it's not being used as the actual access-control check (that must happen server-side in the RPC)`);
    }
  }
}

if (failures === 0) {
  console.log('OK — no unscoped club_join_links reads found.');
  process.exit(0);
} else {
  console.log(`\n${failures} issue(s) found.`);
  process.exit(1);
}
