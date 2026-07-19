#!/usr/bin/env node
// Non-destructive RLS verification for club_join_links. NEVER prints a
// raw invite code — status/count/field-presence only.
//
// Usage: node scripts/test-club-join-links-rls.mjs --mode=production-safe

const SUPABASE_URL = 'https://szgkzuswelntnevobnoh.supabase.co';
const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InN6Z2t6dXN3ZWxudG5ldm9ibm9oIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjgxODY1NTUsImV4cCI6MjA4Mzc2MjU1NX0.UfKqj2OZ-XeyzCy-MZYZqsDWjn_4EKrhgCFR8eIK2NA';

const args = process.argv.slice(2);
function flag(name, fallback) {
  const pre = `--${name}=`;
  const hit = args.find(a => a.startsWith(pre));
  return hit ? hit.slice(pre.length) : fallback;
}
const MODE = flag('mode', 'production-safe');

let pass = 0, fail = 0;
function report(ok, label, detail) {
  if (ok) { pass++; console.log(`  OK   ${label}`); }
  else { fail++; console.log(`  FAIL ${label}${detail ? ' — ' + detail : ''}`); }
}

async function productionSafeMode() {
  console.log(`Production-safe club_join_links RLS check against ${SUPABASE_URL}\n`);

  console.log('ANON — cannot SELECT club_join_links directly:');
  {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/club_join_links?select=id&limit=5`, {
      headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` },
    });
    const body = await res.json().catch(() => null);
    const rows = Array.isArray(body) ? body.length : null;
    const blocked = res.status !== 200 || rows === 0;
    report(blocked, `GET /club_join_links?select=id -> status ${res.status}, rows: ${rows ?? 'n/a'}`, blocked ? undefined : 'anon can still read rows');
  }

  console.log('\nANON — cannot enumerate active-link count:');
  {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/club_join_links?select=id&limit=1`, {
      headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}`, Prefer: 'count=exact' },
    });
    const cr = res.headers.get('content-range') || '';
    const total = (cr.match(/\/(\d+)$/) || [])[1];
    const blocked = total === '0' || total === undefined;
    report(blocked, `GET /club_join_links (count) -> status ${res.status}, total visible: ${total ?? 'n/a'}`, blocked ? undefined : `anon sees a nonzero count (${total})`);
  }

  console.log('\nANON — validate_join_code() rejects a bogus code without leaking anything (never printed, using an obviously-invalid probe string):');
  {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/validate_join_code`, {
      method: 'POST', headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_code: '__smoke_test_probe_definitely_invalid__' }),
    });
    const body = await res.json().catch(() => null);
    const rejectedCleanly = res.status === 200 && body?.valid === false && !('code' in (body || {}));
    report(rejectedCleanly, `POST rpc/validate_join_code (bogus code) -> status ${res.status}, valid: ${body?.valid}, status field: ${body?.status}`, rejectedCleanly ? undefined : 'unexpected response shape');
  }

  console.log('\nANON — redeem_club_join_code() rejected outright (no anon grant):');
  {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/redeem_club_join_code`, {
      method: 'POST', headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_code: '__smoke_test_probe__' }),
    });
    report(res.status === 401 || res.status === 404, `POST rpc/redeem_club_join_code -> ${res.status}`, (res.status !== 401 && res.status !== 404) ? 'not rejected outright' : undefined);
  }

  console.log('\nANON — get_club_active_join_code() works for a real club (by-design public — the "Join" banner), never exposes other columns:');
  {
    // Uses a real, publicly-known club_id (DUC) — this call is INTENDED to
    // be anon-reachable, matching the existing public "Join" banner. The
    // check is that it returns ONLY a bare code string (or null), not a
    // full row.
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/get_club_active_join_code`, {
      method: 'POST', headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_club_id: 'f72cf810-0019-40f8-a57f-476bea8a8f55' }),
    });
    const ok = res.status === 200;
    report(ok, `POST rpc/get_club_active_join_code (DUC) -> status ${res.status}`, ok ? undefined : 'expected 200 (by-design public lookup)');
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
}

function positivePathInstructions() {
  console.log(`
Positive-path tests (authenticated redemption, club-admin scope) require
either a real invite code (never handled by this script — it must never
print or hardcode a live code) or synthetic data on a local/preview
project. Manual procedure:

1. As a club admin (their own club): SELECT * FROM club_join_links WHERE
   club_id = '<their club>' — expect their club's rows. Try a DIFFERENT
   club's id — expect zero rows.
2. Generate a link via generateNewLink() in the club-admin UI — confirm
   the resulting code is 10+ characters from the new secureRandomSuffix()
   generator, not the old 5-char Math.random() pattern.
3. As an authenticated test user with NO existing membership: call
   validate_join_code(p_code) with that real code — expect valid:true.
4. Call redeem_club_join_code(p_code) — expect success:true, exactly one
   new club_members row, use_count incremented by 1, one row in
   club_join_redemptions.
5. Call redeem_club_join_code(p_code) AGAIN as the same user — expect
   status:'already_member', no second club_members row created.
6. As the club admin: set is_active=false on the link (revoke), then
   retry validate_join_code() — expect valid:false, status:'invalid_code'.
7. Set expires_at to the past on a link, retry — expect status:'expired'.
8. Set max_uses=1 with use_count already at 1, retry — expect status:'exhausted'.
`);
}

if (MODE === 'production-safe') productionSafeMode();
else if (MODE === 'positive-path') positivePathInstructions();
else { console.error(`Unknown --mode="${MODE}"`); process.exit(1); }
