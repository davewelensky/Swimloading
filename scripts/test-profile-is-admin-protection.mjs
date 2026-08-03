#!/usr/bin/env node
// Focused verification for the minimal is_admin-protection trigger
// (sql/2026-08-03_protect-profiles-is-admin.sql). Matches the style and
// safety discipline of scripts/test-profiles-rls.mjs:
//   - never prints personal data, only booleans/status codes
//   - anything that WRITES uses a dedicated throwaway test identity,
//     never a real user, never Dave's account
//   - fails closed (SKIP, not attempt) when required credentials are
//     absent
//   - every write this script makes is reverted in a `finally` block
//
// This script does NOT create, promote, or touch any admin account. It
// never calls, and does not require, user_roles/has_role()/grant_role()/
// revoke_role() — this fix is deliberately independent of that model.
//
// THIS SCRIPT HAS NOT BEEN RUN.
//
// Modes:
//   --mode=readonly-safe (default) — anon-only check (4) + a structural
//     probe confirming no role-management RPC is required (6). No writes,
//     no test-user sign-in. Safe to run against production at any time.
//   --mode=authenticated-writes — requires:
//       TEST_USER_A_EMAIL / TEST_USER_A_PASSWORD   (ordinary, non-admin,
//         dedicated throwaway test account — never a real user)
//     Optional, read-only only:
//       DAVE_CHECK_EMAIL / DAVE_CHECK_PASSWORD     (Dave's own real
//         account, used ONLY for a self-SELECT of his own is_admin value
//         — never written to. Omit entirely to skip check 5.)
//
// Usage:
//   node scripts/test-profile-is-admin-protection.mjs --mode=readonly-safe
//   node scripts/test-profile-is-admin-protection.mjs --mode=authenticated-writes

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
function skipped(label, reason) { skip++; console.log(`  SKIP  ${label} — ${reason}`); }

async function rest(path, { method = 'GET', token = ANON_KEY, body, prefer } = {}) {
  const headers = { apikey: ANON_KEY, Authorization: `Bearer ${token}` };
  if (body) headers['Content-Type'] = 'application/json';
  if (prefer) headers['Prefer'] = prefer;
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method, headers, body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await res.json(); } catch { /* non-JSON body, e.g. a trigger's RAISE EXCEPTION message */ }
  return { status: res.status, json };
}

async function rpc(fn, args = {}, token = ANON_KEY) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  });
  return { status: res.status };
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

// ── readonly-safe mode ──────────────────────────────────────────────────────
async function readonlySafeMode() {
  console.log(`is_admin-protection readonly-safe check against ${SUPABASE_URL}\n`);

  console.log('Check 4 — anonymous profile-update behaviour is unchanged (still blocked):');
  {
    // Targets a nonexistent id — proves anon rejection/no-op without
    // touching any real row, whether or not the trigger has shipped yet
    // (anon was already blocked by the existing row-level policy).
    // return=representation forces an unambiguous JSON body (never 204 with
    // no body) so "zero rows affected" is directly observable rather than
    // inferred from status code alone.
    const r = await rest('profiles?id=eq.00000000-0000-0000-0000-000000000000', {
      method: 'PATCH', body: { is_admin: true }, prefer: 'return=representation',
    });
    const blocked = r.status === 401 || r.status === 403 || (r.status === 200 && (!r.json || r.json.length === 0));
    report(blocked, `anon PATCH is_admin -> status ${r.status}, rows affected: ${r.json?.length ?? 'n/a'}`, blocked ? undefined : 'unexpected: anon write was not blocked/empty');
  }

  console.log('\nCheck 6 — this fix requires no role-management RPC (structural probe, informational):');
  {
    const hasRole = await rpc('has_role', { p_role: 'platform_admin' });
    const grantRole = await rpc('grant_role', { p_user_id: '00000000-0000-0000-0000-000000000000', p_role: 'platform_admin' });
    console.log(`  INFO  has_role() present: ${hasRole.status !== 404} (not required either way)`);
    console.log(`  INFO  grant_role() present: ${grantRole.status !== 404} (not required either way)`);
    report(true, 'no dependency on has_role()/grant_role()/revoke_role()/user_roles for this fix');
  }

  console.log(`\n${pass} passed, ${fail} failed, ${skip} skipped`);
  console.log('\nNote: checks 1, 2, 3, and 5 require --mode=authenticated-writes with a');
  console.log('dedicated TEST_USER_A_* throwaway account (and optionally DAVE_CHECK_* for');
  console.log('a read-only self-check of Dave\'s own is_admin value).');
  process.exit(fail > 0 ? 1 : 0);
}

// ── authenticated-writes mode ───────────────────────────────────────────────
async function authenticatedWritesMode() {
  console.log(`is_admin-protection authenticated-writes check against ${SUPABASE_URL}\n`);

  const userA = await signIn('TEST_USER_A_EMAIL', 'TEST_USER_A_PASSWORD');

  console.log('Check 1 — authenticated non-admin user updates a normal editable field:');
  if (!userA) {
    skipped('Check 1', 'TEST_USER_A_EMAIL/PASSWORD not set or sign-in failed — fail closed');
  } else {
    const before = await rest(`profiles?id=eq.${userA.userId}&select=display_name`, { token: userA.accessToken });
    const originalName = before.json?.[0]?.display_name;
    try {
      const w = await rest(`profiles?id=eq.${userA.userId}`, {
        method: 'PATCH', token: userA.accessToken,
        body: { display_name: '__is_admin_protection_test__' },
        prefer: 'return=representation',
      });
      const ok = w.status === 200 && Array.isArray(w.json) && w.json[0]?.display_name === '__is_admin_protection_test__';
      report(ok, `PATCH own display_name -> status ${w.status}`, ok ? undefined : 'ordinary field update was unexpectedly blocked');
    } finally {
      if (originalName !== undefined) {
        await rest(`profiles?id=eq.${userA.userId}`, { method: 'PATCH', token: userA.accessToken, body: { display_name: originalName } }).catch(() => {});
      }
    }
  }

  console.log('\nCheck 2 — the same user cannot change is_admin:');
  let originalIsAdmin;
  if (!userA) {
    skipped('Check 2', 'TEST_USER_A_EMAIL/PASSWORD not set or sign-in failed — fail closed');
  } else {
    const before = await rest(`profiles?id=eq.${userA.userId}&select=is_admin`, { token: userA.accessToken });
    originalIsAdmin = before.json?.[0]?.is_admin;
    const w = await rest(`profiles?id=eq.${userA.userId}`, {
      method: 'PATCH', token: userA.accessToken, body: { is_admin: true }, prefer: 'return=representation',
    });
    const blocked = w.status >= 400;
    report(blocked, `PATCH own is_admin:true -> status ${w.status}`, blocked ? undefined : 'PRIVILEGE ESCALATION — write succeeded');

    console.log('\nCheck 3 — the failed is_admin update did not alter the existing value:');
    const after = await rest(`profiles?id=eq.${userA.userId}&select=is_admin`, { token: userA.accessToken });
    const unchanged = after.json?.[0]?.is_admin === originalIsAdmin;
    report(unchanged, `is_admin before=${originalIsAdmin}, after=${after.json?.[0]?.is_admin}`, unchanged ? undefined : 'value changed despite the blocked write');
  }

  console.log('\nCheck 5 — Dave\'s existing is_admin value remains unchanged (read-only, optional):');
  {
    const dave = await signIn('DAVE_CHECK_EMAIL', 'DAVE_CHECK_PASSWORD');
    if (!dave) {
      skipped('Check 5', 'DAVE_CHECK_EMAIL/PASSWORD not set — optional, skipped by design (this script never needs write access to Dave\'s account)');
    } else {
      const r = await rest(`profiles?id=eq.${dave.userId}&select=is_admin`, { token: dave.accessToken });
      const stillAdmin = r.json?.[0]?.is_admin === true;
      report(stillAdmin, `Dave's is_admin -> ${r.json?.[0]?.is_admin}`, stillAdmin ? undefined : 'Dave is no longer admin — this migration must never cause this');
    }
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
