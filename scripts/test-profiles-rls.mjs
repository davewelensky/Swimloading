#!/usr/bin/env node
// Non-destructive RLS verification for `profiles` (and, once created,
// `public_profiles`). NEVER prints personal data — every check reports a
// boolean/count/key-presence result only, exactly like the manual
// verification in docs/refactor/INCIDENT_PROFILES_PUBLIC_READ.md.
//
// Two modes:
//   --mode=production-safe (default) — anon-role checks only, against
//     whatever is currently live. Safe to run against production at any
//     time, before or after the fix — before the fix, it correctly FAILS
//     (proving the exposure); after the fix, it correctly PASSES.
//   --mode=synthetic — requires two throwaway auth users on a local/
//     preview Supabase project (never production). NOT implemented as an
//     automatic user-creation step in this script — creating auth users is
//     itself a mutation, out of scope for "prepare tests" pre-approval.
//     This mode instead prints the manual procedure and exits.
//
// Usage:
//   node scripts/test-profiles-rls.mjs --mode=production-safe
//   node scripts/test-profiles-rls.mjs --mode=synthetic

const SUPABASE_URL = 'https://szgkzuswelntnevobnoh.supabase.co';
const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InN6Z2t6dXN3ZWxudG5ldm9ibm9oIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjgxODY1NTUsImV4cCI6MjA4Mzc2MjU1NX0.UfKqj2OZ-XeyzCy-MZYZqsDWjn_4EKrhgCFR8eIK2NA';

const args = process.argv.slice(2);
function flag(name, fallback) {
  const pre = `--${name}=`;
  const hit = args.find(a => a.startsWith(pre));
  return hit ? hit.slice(pre.length) : fallback;
}
const MODE = flag('mode', 'production-safe');

let pass = 0;
let fail = 0;
function report(ok, label, detail) {
  if (ok) { pass++; console.log(`  OK   ${label}`); }
  else { fail++; console.log(`  FAIL ${label}${detail ? ' — ' + detail : ''}`); }
}

// Fetches and immediately reduces to a safe summary — the raw body is
// never returned to the caller, only a redacted description of it.
async function anonSelect(path) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` },
  });
  const status = res.status;
  let rowCount = null;
  let sensitiveFieldsPresent = null;
  try {
    const body = await res.json();
    if (Array.isArray(body)) {
      rowCount = body.length;
      if (body.length > 0) {
        const row = body[0];
        const sensitiveKeys = ['phone', 'date_of_birth', 'address_line1', 'city', 'postal_code', 'emergency_contact_name', 'emergency_contact_phone', 'email'];
        sensitiveFieldsPresent = sensitiveKeys.filter(k => k in row && row[k] !== null);
        // row is now out of scope after this block — never returned or logged.
      }
    }
  } catch { /* non-JSON body, e.g. an error message — not inspected further */ }
  return { status, rowCount, sensitiveFieldsPresent };
}

async function productionSafeMode() {
  console.log(`Production-safe RLS check against ${SUPABASE_URL} (anon key only, no personal data printed)\n`);

  console.log('ANON — cannot SELECT profiles:');
  {
    const r = await anonSelect('profiles?select=id&limit=5');
    const blocked = r.status !== 200 || r.rowCount === 0;
    report(blocked, `GET /profiles?select=id -> status ${r.status}, rows returned: ${r.rowCount ?? 'n/a'}`, blocked ? undefined : 'anon can still read rows — fix not applied or not effective');
  }

  console.log('\nANON — cannot select sensitive profile fields:');
  {
    const r = await anonSelect('profiles?select=phone,date_of_birth,emergency_contact_name&limit=1');
    const blocked = r.status !== 200 || r.rowCount === 0;
    report(blocked, `GET /profiles?select=phone,date_of_birth,emergency_contact_name -> status ${r.status}, rows: ${r.rowCount ?? 'n/a'}`, blocked ? undefined : `anon can still read sensitive fields: ${JSON.stringify(r.sensitiveFieldsPresent)}`);
  }

  console.log('\nANON — cannot enumerate users (count check):');
  {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/profiles?select=id&limit=1`, {
      headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}`, Prefer: 'count=exact' },
    });
    const contentRange = res.headers.get('content-range') || '';
    const totalMatch = contentRange.match(/\/(\d+)$/);
    const total = totalMatch ? parseInt(totalMatch[1], 10) : null;
    const blocked = res.status !== 200 && res.status !== 206 || total === 0;
    report(blocked, `GET /profiles (count) -> status ${res.status}, total visible to anon: ${total ?? 'n/a'}`, blocked ? undefined : `anon can see a nonzero count (${total}) — table-level enumeration still possible`);
  }

  console.log('\nPUBLIC VIEW — public_profiles (if it exists) exposes only approved columns:');
  {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/public_profiles?select=*&limit=1`, {
      headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` },
    });
    if (r.status === 404 || r.status === 400) {
      report(false, 'GET /public_profiles', `view does not exist yet (status ${r.status}) — expected before the migration is applied`);
    } else {
      const body = await r.json().catch(() => null);
      if (Array.isArray(body) && body.length > 0) {
        const keys = Object.keys(body[0]);
        const forbidden = ['phone', 'date_of_birth', 'address_line1', 'address_line2', 'city', 'postal_code', 'emergency_contact_name', 'emergency_contact_phone', 'email', 'full_name'];
        const leaked = keys.filter(k => forbidden.includes(k));
        report(leaked.length === 0, `public_profiles columns: ${JSON.stringify(keys)}`, leaked.length ? `forbidden columns present: ${JSON.stringify(leaked)}` : undefined);
      } else {
        report(r.status === 200, `GET /public_profiles -> status ${r.status}, empty or granted-to-authenticated-only (expected if anon is correctly excluded per the design)`);
      }
    }
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  console.log(fail > 0
    ? '\n(A failing "ANON —" check here is EXPECTED before the migration is applied — this proves the incident. It should read all-pass once sql/2026-07-19_fix-profiles-rls.sql ships.)'
    : '\nAll anon-role checks pass — profiles is no longer publicly readable.');
  process.exit(fail > 0 && MODE === 'post-fix-verify' ? 1 : 0);
}

function syntheticModeInstructions() {
  console.log(`
--mode=synthetic is not automated in this script — creating auth users is
a mutation, and this task's scope is "prepare tests," not "run destructive
setup." Manual procedure for local/preview (NEVER production):

1. Create two throwaway users via Supabase Auth (dashboard or
   supabase.auth.admin.createUser on a LOCAL/PREVIEW project only):
   testuser-a@example.invalid, testuser-b@example.invalid
2. Sign in as testuser-a, capture their JWT.
3. AUTHENTICATED USER checks (as testuser-a):
   a. GET /rest/v1/profiles?select=*&id=eq.<own-id> with the JWT
      -> expect 200, exactly 1 row, own data only.
   b. GET /rest/v1/profiles?select=*&id=eq.<testuser-b's id> with
      testuser-a's JWT -> expect 200, ZERO rows (RLS silently filters,
      does not error).
   c. PATCH /rest/v1/profiles?id=eq.<own-id> with a permitted field
      -> expect 200, success.
   d. PATCH /rest/v1/profiles?id=eq.<testuser-b's id> with testuser-a's
      JWT -> expect 200 status but ZERO rows affected (RLS blocks the
      match, PostgREST reports 200 with an empty result rather than 403 —
      confirm the row was NOT actually changed by re-reading testuser-b's
      own row as testuser-b).
4. ADMIN/SERVICE PATH check: set testuser-a's is_admin=true directly via
   the service role (bypassing RLS, as a test setup step only) and confirm
   rpc('get_admin_user_directory') now returns all test rows for
   testuser-a, and returns EMPTY for testuser-b (who is not admin).
5. Tear down: delete both throwaway users when done.

Do this on a local Supabase instance (\`supabase start\`) or a preview
branch — never against the production project.
`);
}

if (MODE === 'production-safe' || MODE === 'post-fix-verify') {
  productionSafeMode();
} else if (MODE === 'synthetic') {
  syntheticModeInstructions();
} else {
  console.error(`Unknown --mode="${MODE}". Use production-safe or synthetic.`);
  process.exit(1);
}
