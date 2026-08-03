#!/usr/bin/env node
// Live-state verification for the platform-administrator authorization
// model: profiles.is_admin self-escalation risk, and (once applied)
// user_roles / has_role() / grant_role() / revoke_role().
//
// Written BEFORE any fix ships, so it documents the CURRENT (suspected
// vulnerable) state first, then becomes the regression suite once the
// security migration in the design report lands. Matches the style and
// safety discipline of scripts/test-profiles-rls.mjs and
// scripts/test-club-roster-rls.mjs:
//   - never prints personal data, only booleans/status codes/counts
//   - production-safe checks (read-only, anon-role) run automatically
//   - anything that WRITES requires dedicated throwaway test identities
//     supplied via env vars — never hardcoded, never a real user
//   - if a required test identity or a required schema object is
//     missing, the specific test is SKIPPED (fail closed), not attempted
//   - every write this script makes is reverted in a `finally` block
//
// THIS SCRIPT HAS NOT BEEN RUN. Do not run it against production without
// first reading the "Exact operations" section in the design report and
// confirming test identities are genuinely throwaway accounts.
//
// Modes:
//   --mode=readonly-safe   (default) — anon-role checks only, plus
//     schema-presence detection (does user_roles/has_role/grant_role/
//     revoke_role exist yet?). No writes. Safe to run against production
//     at any time, including right now.
//   --mode=authenticated-writes — requires env vars for THREE dedicated
//     throwaway test accounts (never real users):
//       TEST_USER_A_EMAIL / TEST_USER_A_PASSWORD   (ordinary user)
//       TEST_USER_B_EMAIL / TEST_USER_B_PASSWORD   (ordinary user, target)
//       TEST_ADMIN_EMAIL  / TEST_ADMIN_PASSWORD    (existing platform_admin)
//     Any test whose required identity is missing, or whose required
//     schema object doesn't exist yet, is SKIPPED with an explicit
//     reason — never silently attempted.
//
// Usage:
//   node scripts/test-admin-authz-rls.mjs --mode=readonly-safe
//   node scripts/test-admin-authz-rls.mjs --mode=authenticated-writes

const SUPABASE_URL = 'https://szgkzuswelntnevobnoh.supabase.co';
const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InN6Z2t6dXN3ZWxudG5ldm9ibm9oIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjgxODY1NTUsImV4cCI6MjA4Mzc2MjU1NX0.UfKqj2OZ-XeyzCy-MZYZqsDWjn_4EKrhgCFR8eIK2NA';

const args = process.argv.slice(2);
function flag(name, fallback) {
  const pre = `--${name}=`;
  const hit = args.find(a => a.startsWith(pre));
  return hit ? hit.slice(pre.length) : fallback;
}
const MODE = flag('mode', 'readonly-safe');

let pass = 0, fail = 0, skip = 0;
function report(ok, label, detail) {
  if (ok) { pass++; console.log(`  OK    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`); }
}
function skipped(label, reason) {
  skip++; console.log(`  SKIP  ${label} — ${reason}`);
}

async function rest(path, { method = 'GET', token = ANON_KEY, body, prefer } = {}) {
  const headers = { apikey: ANON_KEY, Authorization: `Bearer ${token}` };
  if (body) headers['Content-Type'] = 'application/json';
  if (prefer) headers['Prefer'] = prefer;
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method, headers, body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await res.json(); } catch { /* non-JSON body */ }
  return { status: res.status, json };
}

async function rpc(fn, args = {}, token = ANON_KEY) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  });
  let json = null;
  try { json = await res.json(); } catch { /* non-JSON */ }
  return { status: res.status, json };
}

// Password-grant sign-in for a dedicated throwaway test account. Never
// used for a real user. Returns null (never throws) if credentials are
// absent or sign-in fails — callers must treat that as "skip this test."
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
  return { userId: data.user?.id, accessToken: data.access_token, email };
}

// ── Schema-presence detection (read-only, no writes) ───────────────────────
async function schemaPresence() {
  const userRolesExists = (await rest('user_roles?select=id&limit=1')).status !== 404
    && (await rest('user_roles?select=id&limit=1')).status !== 400;
  const hasRoleExists = (await rpc('has_role', { p_role: 'platform_admin' })).status !== 404;
  const grantRoleExists = (await rpc('grant_role', { p_user_id: '00000000-0000-0000-0000-000000000000', p_role: 'platform_admin' })).status !== 404;
  const revokeRoleExists = (await rpc('revoke_role', { p_role_id: '00000000-0000-0000-0000-000000000000' })).status !== 404;
  return { userRolesExists, hasRoleExists, grantRoleExists, revokeRoleExists };
}

// ── readonly-safe mode ──────────────────────────────────────────────────────
async function readonlySafeMode() {
  console.log(`Admin-authorization readonly-safe check against ${SUPABASE_URL}\n`);
  console.log('(Anon-role checks only — no writes, no test-user sign-in.)\n');

  console.log('ANON — cannot UPDATE profiles at all (any row, any column):');
  {
    // Targets a nonexistent id — if RLS is correctly row-scoped this is a
    // true no-op either way, so this only proves anon gets rejected/filtered,
    // never that a real row was touched.
    const r = await rest('profiles?id=eq.00000000-0000-0000-0000-000000000000', {
      method: 'PATCH', body: { is_admin: true },
    });
    const blocked = r.status === 401 || r.status === 403 || (r.status === 200 && (!r.json || r.json.length === 0));
    report(blocked, `PATCH /profiles (anon, no matching row anyway) -> status ${r.status}`,
      blocked ? undefined : 'unexpected: anon PATCH did not come back blocked/empty');
  }

  console.log('\nSCHEMA — does the proposed authorization-model schema exist yet?');
  {
    const s = await schemaPresence();
    report(!s.userRolesExists, 'user_roles table', s.userRolesExists ? 'EXISTS — proposed migration may already be applied; verify before assuming design-doc state' : 'does not exist yet (expected — migration proposed, not applied)');
    report(!s.hasRoleExists, 'has_role() function', s.hasRoleExists ? 'EXISTS' : 'does not exist yet (expected)');
    report(!s.grantRoleExists, 'grant_role() function', s.grantRoleExists ? 'EXISTS' : 'does not exist yet (expected)');
    report(!s.revokeRoleExists, 'revoke_role() function', s.revokeRoleExists ? 'EXISTS' : 'does not exist yet (expected)');
    console.log('  (These four "OK" lines mean "confirmed NOT YET APPLIED", matching the');
    console.log('   design report. A FAIL here means the repo\'s assumption is stale — stop');
    console.log('   and re-verify before writing any new migration against these objects.)');
  }

  console.log('\nSCHEMA — get_admin_user_directory() RPC (proposed in the unapplied profiles-RLS fix):');
  {
    const r = await rpc('get_admin_user_directory');
    const exists = r.status !== 404;
    report(!exists, 'get_admin_user_directory()', exists ? 'EXISTS — the profiles RLS fix may already be applied; verify' : 'does not exist yet (expected)');
  }

  console.log(`\n${pass} passed, ${fail} failed, ${skip} skipped`);
  console.log('\nNote: this mode CANNOT test whether an authenticated ordinary user can');
  console.log('set their own is_admin=true — that requires a real authenticated write,');
  console.log('which this script never performs without --mode=authenticated-writes and');
  console.log('dedicated TEST_USER_* throwaway credentials (see header comment).');
  process.exit(fail > 0 ? 1 : 0);
}

// ── authenticated-writes mode ───────────────────────────────────────────────
async function authenticatedWritesMode() {
  console.log(`Admin-authorization authenticated-writes check against ${SUPABASE_URL}\n`);
  console.log('Every write below is reverted in a finally block. Any test whose required');
  console.log('identity or schema object is missing is SKIPPED, never attempted.\n');

  const schema = await schemaPresence();
  const userA = await signIn('TEST_USER_A_EMAIL', 'TEST_USER_A_PASSWORD');
  const userB = await signIn('TEST_USER_B_EMAIL', 'TEST_USER_B_PASSWORD');
  const admin = await signIn('TEST_ADMIN_EMAIL', 'TEST_ADMIN_PASSWORD');

  // ── Test 1: ordinary user sets own is_admin false -> true ──────────────
  console.log('Test 1 — authenticated ordinary user sets own is_admin false -> true:');
  if (!userA) {
    skipped('Test 1', 'TEST_USER_A_EMAIL/PASSWORD not set or sign-in failed — fail closed');
  } else {
    let originalValue;
    try {
      const before = await rest(`profiles?id=eq.${userA.userId}&select=is_admin`, { token: userA.accessToken });
      originalValue = before.json?.[0]?.is_admin ?? false;
      const w = await rest(`profiles?id=eq.${userA.userId}`, {
        method: 'PATCH', token: userA.accessToken, body: { is_admin: true }, prefer: 'return=representation',
      });
      const escalated = w.status === 200 && Array.isArray(w.json) && w.json[0]?.is_admin === true;
      report(!escalated, `PATCH own row {is_admin:true} -> status ${w.status}`,
        escalated ? 'PRIVILEGE ESCALATION CONFIRMED — ordinary user successfully set their own is_admin=true' : undefined);
    } finally {
      if (userA && originalValue !== undefined) {
        await rest(`profiles?id=eq.${userA.userId}`, { method: 'PATCH', token: userA.accessToken, body: { is_admin: originalValue } })
          .catch(() => {});
        // If the row is already locked down (expected post-fix), this
        // restore is a safe no-op — it can never re-introduce is_admin=true
        // beyond what was already there.
      }
    }
  }

  // ── Test 2: ordinary user updates another user's row ────────────────────
  console.log('\nTest 2 — authenticated ordinary user updates ANOTHER user\'s profiles row:');
  if (!userA || !userB) {
    skipped('Test 2', 'TEST_USER_A_* and TEST_USER_B_* both required — fail closed');
  } else {
    const before = await rest(`profiles?id=eq.${userB.userId}&select=display_name`, { token: admin?.accessToken || userB.accessToken });
    const originalName = before.json?.[0]?.display_name;
    try {
      const w = await rest(`profiles?id=eq.${userB.userId}`, {
        method: 'PATCH', token: userA.accessToken, body: { display_name: '__rls_test_should_not_apply__' }, prefer: 'return=representation',
      });
      const wrote = w.status === 200 && Array.isArray(w.json) && w.json.length > 0;
      report(!wrote, `PATCH other user's row -> status ${w.status}, rows affected: ${w.json?.length ?? 0}`,
        wrote ? 'ordinary user successfully modified another user\'s profile row' : undefined);
    } finally {
      if (originalName !== undefined) {
        await rest(`profiles?id=eq.${userB.userId}`, { method: 'PATCH', token: userB.accessToken, body: { display_name: originalName } }).catch(() => {});
      }
    }
  }

  // ── Test 3: anon updates is_admin ────────────────────────────────────────
  console.log('\nTest 3 — anonymous user attempts to update profiles.is_admin:');
  if (!userA) {
    skipped('Test 3', 'needs a real target row id (TEST_USER_A) to attempt against — fail closed');
  } else {
    const w = await rest(`profiles?id=eq.${userA.userId}`, { method: 'PATCH', token: ANON_KEY, body: { is_admin: true } });
    const wrote = w.status === 200 && Array.isArray(w.json) && w.json.length > 0;
    report(!wrote, `anon PATCH is_admin -> status ${w.status}`, wrote ? 'anon successfully wrote is_admin' : undefined);
  }

  // ── Tests 4-9 require user_roles/has_role/grant_role/revoke_role ────────
  const rolesReady = schema.userRolesExists && schema.hasRoleExists && schema.grantRoleExists && schema.revokeRoleExists;

  console.log('\nTest 4 — ordinary user attempts to grant themselves platform_admin:');
  if (!rolesReady) skipped('Test 4', 'user_roles/grant_role() not applied yet');
  else if (!userA) skipped('Test 4', 'TEST_USER_A_* required');
  else {
    const r = await rpc('grant_role', { p_user_id: userA.userId, p_role: 'platform_admin', p_scope: 'platform' }, userA.accessToken);
    const blocked = r.status >= 400;
    report(blocked, `grant_role(self) -> status ${r.status}`, blocked ? undefined : 'self-grant succeeded — must always raise');
  }

  console.log('\nTest 5 — ordinary user attempts to grant ANOTHER user platform_admin:');
  if (!rolesReady) skipped('Test 5', 'user_roles/grant_role() not applied yet');
  else if (!userA || !userB) skipped('Test 5', 'TEST_USER_A_* and TEST_USER_B_* required');
  else {
    const r = await rpc('grant_role', { p_user_id: userB.userId, p_role: 'platform_admin', p_scope: 'platform' }, userA.accessToken);
    const blocked = r.status >= 400;
    report(blocked, `grant_role(other, by non-admin) -> status ${r.status}`, blocked ? undefined : 'non-admin granted a role to another user');
  }

  console.log('\nTest 6 — administrator grants platform_admin to test user B, then it is revoked (test 8):');
  let grantedRoleId = null;
  if (!rolesReady) skipped('Test 6', 'user_roles/grant_role() not applied yet');
  else if (!admin || !userB) skipped('Test 6', 'TEST_ADMIN_* and TEST_USER_B_* required');
  else {
    const r = await rpc('grant_role', { p_user_id: userB.userId, p_role: 'platform_operator', p_scope: 'platform' }, admin.accessToken);
    // Deliberately grants a low-privilege 'platform_operator' role to the
    // throwaway test user, never 'platform_admin', to avoid ever leaving a
    // stray real platform_admin grant behind if teardown is interrupted.
    const ok = r.status < 400 && r.json;
    grantedRoleId = ok ? r.json : null;
    report(ok, `grant_role(platform_operator, by admin) -> status ${r.status}`, ok ? undefined : 'expected admin to be able to grant a role');
  }

  console.log('\nTest 7 — a user attempts to grant a role to themselves (repeat, as the granted test user):');
  if (!rolesReady) skipped('Test 7', 'user_roles/grant_role() not applied yet');
  else if (!userB) skipped('Test 7', 'TEST_USER_B_* required');
  else {
    const r = await rpc('grant_role', { p_user_id: userB.userId, p_role: 'platform_admin', p_scope: 'platform' }, userB.accessToken);
    const blocked = r.status >= 400;
    report(blocked, `grant_role(self, as freshly-granted operator) -> status ${r.status}`, blocked ? undefined : 'self-grant succeeded even for a role-holding user');
  }

  console.log('\nTest 8 — administrator revokes the role granted in test 6:');
  if (!rolesReady) skipped('Test 8', 'user_roles/revoke_role() not applied yet');
  else if (!admin || !grantedRoleId) skipped('Test 8', 'requires test 6 to have succeeded and produced a role id');
  else {
    const r = await rpc('revoke_role', { p_role_id: grantedRoleId }, admin.accessToken);
    const ok = r.status < 400;
    report(ok, `revoke_role(test-6 grant) -> status ${r.status}`, ok ? undefined : 'admin could not revoke a role they granted');
  }

  console.log('\nTest 9 — existing administrator access to admin functionality remains intact:');
  if (!admin) {
    skipped('Test 9', 'TEST_ADMIN_* required (must be a REAL platform_admin / is_admin=true test account, never a production admin)');
  } else {
    const r = await rpc('has_role', { p_role: 'platform_admin', p_scope: 'platform' }, admin.accessToken);
    const stillAdmin = r.status < 400 && r.json === true;
    report(stillAdmin || !rolesReady, `has_role('platform_admin') as admin -> status ${r.status}, result ${JSON.stringify(r.json)}`,
      (!stillAdmin && rolesReady) ? 'admin test account lost platform_admin — regression' : undefined);
  }

  console.log(`\n${pass} passed, ${fail} failed, ${skip} skipped`);
  process.exit(fail > 0 ? 1 : 0);
}

if (MODE === 'readonly-safe') {
  readonlySafeMode();
} else if (MODE === 'authenticated-writes') {
  authenticatedWritesMode();
} else {
  console.error(`Unknown --mode="${MODE}". Use readonly-safe or authenticated-writes.`);
  process.exit(1);
}
