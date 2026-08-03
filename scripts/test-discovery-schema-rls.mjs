#!/usr/bin/env node
// RLS + grant verification for the Global Swim Discovery Phase 2 schema
// (sql/2026-08-03_discovery-schema-v1.sql).
//
// Matches the style and safety discipline of scripts/test-profiles-rls.mjs
// and scripts/test-club-roster-rls.mjs:
//   - default mode is READ-ONLY and safe to run against production at any
//     time, before or after the migration is applied
//   - never prints personal data — only status codes, counts and booleans
//   - needs NO worker/service-role credential for the read-only checks
//     (that is itself part of what is being proven)
//   - a mutating mode is DESIGNED but deliberately NOT IMPLEMENTED as an
//     automatic path — see --mode=mutating
//
// Before the migration is applied, the "table exists" checks are expected
// to FAIL and everything else to be reported as SKIP. That is the correct
// pre-migration result, not a problem.
//
// Usage:
//   node scripts/test-discovery-schema-rls.mjs                     (readonly-safe)
//   node scripts/test-discovery-schema-rls.mjs --mode=readonly-safe
//   node scripts/test-discovery-schema-rls.mjs --mode=mutating     (prints the manual procedure, runs nothing)
//
// Optional, for the authenticated-user checks only:
//   TEST_USER_A_EMAIL / TEST_USER_A_PASSWORD  — a dedicated throwaway
//   NON-ADMIN account. Never a real user, never an admin. Omitted => those
//   specific checks SKIP (fail closed), they are never silently assumed.

const SUPABASE_URL = 'https://szgkzuswelntnevobnoh.supabase.co';
const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InN6Z2t6dXN3ZWxudG5ldm9ibm9oIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjgxODY1NTUsImV4cCI6MjA4Mzc2MjU1NX0.UfKqj2OZ-XeyzCy-MZYZqsDWjn_4EKrhgCFR8eIK2NA';

const DISCOVERY_TABLES = [
  'discovery_sources',
  'discovery_source_pages',
  'discovery_runs',
  'discovery_candidate_events',
  'discovery_candidate_distances',
  'discovery_event_evidence',
  'discovery_dedupe_links',
  'discovery_review_decisions',
];

const PUBLISHED_TABLES = [
  'event_organisers',
  'event_venues',
  'event_series',
  'event_editions',
  'event_distances',
];

// The public read surface. event_organisers is deliberately NOT here:
// anon reaches organisers only through the public_organisers view, which
// excludes email/phone and only exposes status='active' rows.
const PUBLIC_READABLE = [
  'public_organisers',
  'event_venues',
  'event_series',
  'event_editions',
  'event_distances',
];

const args = process.argv.slice(2);
function flag(name, fallback) {
  const pre = `--${name}=`;
  const hit = args.find((a) => a.startsWith(pre));
  return hit ? hit.slice(pre.length) : fallback;
}
const MODE = flag('mode', 'readonly-safe');

let pass = 0, fail = 0, skip = 0;
function report(ok, label, detail) {
  if (ok) { pass++; console.log(`  OK    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`); }
}
function skipped(label, reason) { skip++; console.log(`  SKIP  ${label} — ${reason}`); }

async function rest(path, { method = 'GET', token = ANON_KEY, body, prefer } = {}) {
  const headers = { apikey: ANON_KEY, Authorization: `Bearer ${token}` };
  if (body) headers['Content-Type'] = 'application/json';
  if (prefer) headers['Prefer'] = prefer;
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method, headers, body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await res.json(); } catch { /* non-JSON (e.g. 204) */ }
  return { status: res.status, json };
}

async function signIn(emailEnv, passwordEnv) {
  const email = process.env[emailEnv];
  const password = process.env[passwordEnv];
  if (!email || !password) return null;
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (res.status !== 200) return null;
  const data = await res.json();
  return { userId: data.user?.id, accessToken: data.access_token };
}

// A table "exists and is reachable by PostgREST" if it does not 404 with
// the undefined-table code. PostgREST returns 404 + PGRST205 for unknown
// tables, and 401/403/200-empty for known-but-restricted ones.
function looksMissing(r) {
  return r.status === 404 || r.json?.code === 'PGRST205' || r.json?.code === '42P01';
}

// A read is "blocked" if PostgREST refused it (401/403, or a permission
// error code) OR RLS filtered it to zero rows. Both are acceptable — the
// requirement is that no discovery data comes back, not which mechanism
// stopped it.
function readBlocked(r) {
  if (r.status === 401 || r.status === 403) return true;
  if (r.json?.code === '42501') return true; // insufficient_privilege
  if (r.status === 200 && Array.isArray(r.json) && r.json.length === 0) return true;
  return false;
}

async function readonlySafeMode() {
  console.log(`Discovery schema RLS check against ${SUPABASE_URL}\n`);
  console.log('Read-only. No writes attempted. No service-role key used or required.\n');

  // ── 1. Do the expected tables exist? ────────────────────────────────
  console.log('1. Expected objects exist (13 tables + the public_organisers view):');
  let migrationApplied = true;
  for (const table of [...PUBLISHED_TABLES, ...DISCOVERY_TABLES, 'public_organisers']) {
    const r = await rest(`${table}?select=*&limit=1`);
    const missing = looksMissing(r);
    if (missing) migrationApplied = false;
    report(!missing, `${table} reachable (status ${r.status})`,
      missing ? 'table not found — migration not applied yet' : undefined);
  }

  if (!migrationApplied) {
    console.log('\n  NOTE: at least one table is missing, so the migration has not been');
    console.log('  applied yet. That is the expected state until Dave types "apply".');
    console.log('  The remaining checks below still run and report honestly.\n');
  }

  // ── 2. anon cannot read discovery tables ────────────────────────────
  console.log('\n2. ANON cannot read any discovery table:');
  for (const table of DISCOVERY_TABLES) {
    const r = await rest(`${table}?select=id&limit=1`);
    if (looksMissing(r)) { skipped(`anon read ${table}`, 'table does not exist yet'); continue; }
    const blocked = readBlocked(r);
    report(blocked, `anon SELECT ${table} -> status ${r.status}, rows ${Array.isArray(r.json) ? r.json.length : 'n/a'}`,
      blocked ? undefined : 'anon received discovery data');
  }

  // ── 3. anon cannot WRITE anything ───────────────────────────────────
  console.log('\n3. ANON cannot write to discovery or published tables:');
  for (const table of ['discovery_candidate_events', 'event_editions']) {
    const r = await rest(table, { method: 'POST', body: {}, prefer: 'return=representation' });
    if (looksMissing(r)) { skipped(`anon INSERT ${table}`, 'table does not exist yet'); continue; }
    const blocked = r.status >= 400;
    report(blocked, `anon INSERT ${table} -> status ${r.status}`,
      blocked ? undefined : 'anon INSERT was accepted');
  }

  // ── 4. anon CAN read the published catalogue (when rows exist) ──────
  console.log('\n4. ANON can read the published catalogue (structure reachable; rows only if seeded):');
  for (const table of PUBLIC_READABLE) {
    const r = await rest(`${table}?select=id&limit=1`);
    if (looksMissing(r)) { skipped(`anon read ${table}`, 'table/view does not exist yet'); continue; }
    const readable = r.status === 200 && Array.isArray(r.json);
    const rowCount = Array.isArray(r.json) ? r.json.length : 0;
    report(readable, `anon SELECT ${table} -> status ${r.status}, rows ${rowCount}${rowCount === 0 ? ' (empty catalogue — expected before any approval)' : ''}`,
      readable ? undefined : `anon could not read the public catalogue: ${JSON.stringify(r.json)}`);
  }

  // ── 5. anon reaches organisers ONLY via the view ────────────────────
  console.log('\n5. ANON reaches organisers only through public_organisers, never the base table:');
  {
    const base = await rest('event_organisers?select=id&limit=1');
    if (looksMissing(base)) skipped('anon read event_organisers base table', 'table does not exist yet');
    else {
      const blocked = readBlocked(base);
      report(blocked, `anon SELECT event_organisers (base table) -> status ${base.status}`,
        blocked ? undefined : 'anon can read the organiser base table — it should only reach the view');
    }

    const contact = await rest('public_organisers?select=email,phone&limit=1');
    if (looksMissing(contact)) skipped('anon read contact columns via view', 'view does not exist yet');
    else {
      // The view does not define email/phone at all, so PostgREST should
      // reject the column reference outright (400), not return data.
      const blocked = contact.status >= 400;
      report(blocked, `anon SELECT email,phone FROM public_organisers -> status ${contact.status}`,
        blocked ? undefined : 'organiser contact columns are exposed through the view');
    }
  }

  // ── 6. authenticated NON-ADMIN cannot read discovery tables ─────────
  console.log('\n6. AUTHENTICATED non-admin cannot read discovery tables:');
  const userA = await signIn('TEST_USER_A_EMAIL', 'TEST_USER_A_PASSWORD');
  if (!userA) {
    skipped('authenticated non-admin discovery reads',
      'TEST_USER_A_EMAIL/PASSWORD not set — fail closed, never assumed');
  } else {
    for (const table of DISCOVERY_TABLES) {
      const r = await rest(`${table}?select=id&limit=1`, { token: userA.accessToken });
      if (looksMissing(r)) { skipped(`non-admin read ${table}`, 'table does not exist yet'); continue; }
      const blocked = readBlocked(r);
      report(blocked, `non-admin SELECT ${table} -> status ${r.status}, rows ${Array.isArray(r.json) ? r.json.length : 'n/a'}`,
        blocked ? undefined : 'ordinary authenticated user received discovery data');
    }
  }

  // ── 7. authenticated NON-ADMIN cannot write the published catalogue ─
  console.log('\n7. AUTHENTICATED non-admin cannot write the published catalogue:');
  if (!userA) {
    skipped('authenticated non-admin catalogue writes', 'TEST_USER_A_* not set — fail closed');
  } else {
    for (const table of ['event_series', 'event_editions']) {
      const r = await rest(table, {
        method: 'POST', token: userA.accessToken, body: {}, prefer: 'return=representation',
      });
      if (looksMissing(r)) { skipped(`non-admin INSERT ${table}`, 'table does not exist yet'); continue; }
      const blocked = r.status >= 400;
      report(blocked, `non-admin INSERT ${table} -> status ${r.status}`,
        blocked ? undefined : 'ordinary authenticated user wrote to the published catalogue');
    }
  }

  console.log(`\n${pass} passed, ${fail} failed, ${skip} skipped`);
  if (!migrationApplied) {
    console.log('\nMigration not applied yet — the "table exists" failures above are expected.');
  }
  process.exit(fail > 0 ? 1 : 0);
}

function mutatingModeInstructions() {
  console.log(`
--mode=mutating is DESIGNED BUT NOT IMPLEMENTED as an automatic path.

Seeding published catalogue rows requires either the service-role key or
an admin session, and this task's scope explicitly forbids running any
mutating test against production. Automating it here would make it too
easy to run by accident.

Manual procedure, once the migration IS applied and you want to prove the
public-read path end to end:

  1. As Dave (an admin), or via the Supabase SQL editor, insert ONE
     throwaway organiser + venue + series + edition, with the edition's
     status set to 'announced' (NOT 'unconfirmed').
  2. Re-run this script in readonly-safe mode. Check 4 should now report
     rows > 0 for event_editions — proving anon really can read approved
     catalogue data, not just reach an empty table.
  3. Update that same edition to status='unconfirmed'. Re-run. Check 4
     should report rows 0 for event_editions — proving the
     'unconfirmed' rows are correctly hidden from the public.
  4. DELETE the throwaway rows (children first: event_distances, then
     event_editions, event_series, event_venues, event_organisers).

Everything in step 1 and 4 is a deliberate manual action taken by Dave,
not something this script performs.
`);
}

if (MODE === 'readonly-safe') {
  readonlySafeMode();
} else if (MODE === 'mutating') {
  mutatingModeInstructions();
} else {
  console.error(`Unknown --mode="${MODE}". Use readonly-safe or mutating.`);
  process.exit(1);
}
