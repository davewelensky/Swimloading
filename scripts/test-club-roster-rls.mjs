#!/usr/bin/env node
// Non-destructive RLS verification for club_roster (and club_member_directory
// once created). NEVER prints personal data — counts/status/field-presence
// only. Mirrors scripts/test-profiles-rls.mjs.
//
// Usage:
//   node scripts/test-club-roster-rls.mjs --mode=production-safe
//   node scripts/test-club-roster-rls.mjs --mode=synthetic

const SUPABASE_URL = 'https://szgkzuswelntnevobnoh.supabase.co';
const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InN6Z2t6dXN3ZWxudG5ldm9ibm9oIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjgxODY1NTUsImV4cCI6MjA4Mzc2MjU1NX0.UfKqj2OZ-XeyzCy-MZYZqsDWjn_4EKrhgCFR8eIK2NA';
const AQUASHARKS_CLUB_ID = '385e2c9d-b32e-47d1-bb1d-1e042523de23'; // youth squads present

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

async function anonSelect(path) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` },
  });
  let rowCount = null, keys = null;
  try {
    const body = await res.json();
    if (Array.isArray(body)) {
      rowCount = body.length;
      if (body.length) keys = Object.keys(body[0]);
    }
  } catch { /* non-JSON, not inspected */ }
  return { status: res.status, rowCount, keys };
}

async function productionSafeMode() {
  console.log(`Production-safe club_roster RLS check against ${SUPABASE_URL}\n`);

  console.log('ANON — cannot SELECT club_roster:');
  {
    const r = await anonSelect('club_roster?select=id&limit=5');
    const blocked = r.status !== 200 || r.rowCount === 0;
    report(blocked, `GET /club_roster?select=id -> status ${r.status}, rows: ${r.rowCount ?? 'n/a'}`, blocked ? undefined : 'anon can still read rows');
  }

  console.log('\nANON — cannot enumerate row count:');
  {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/club_roster?select=id&limit=1`, {
      headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}`, Prefer: 'count=exact' },
    });
    const cr = res.headers.get('content-range') || '';
    const total = (cr.match(/\/(\d+)$/) || [])[1];
    const blocked = total === '0' || total === undefined;
    report(blocked, `GET /club_roster (count) -> status ${res.status}, total visible: ${total ?? 'n/a'}`, blocked ? undefined : `anon sees a nonzero count (${total})`);
  }

  console.log('\nANON — cannot filter by club_id (youth-squad club specifically):');
  {
    const r = await anonSelect(`club_roster?club_id=eq.${AQUASHARKS_CLUB_ID}&select=id&limit=5`);
    const blocked = r.status !== 200 || r.rowCount === 0;
    report(blocked, `GET /club_roster?club_id=eq.<aquasharks> -> status ${r.status}, rows: ${r.rowCount ?? 'n/a'}`, blocked ? undefined : 'anon can still read youth-squad club rows');
  }

  console.log('\nANON — cannot access sensitive fields (phone/DOB/gender):');
  {
    const r = await anonSelect('club_roster?select=phone,date_of_birth,gender&limit=1');
    const blocked = r.status !== 200 || r.rowCount === 0;
    report(blocked, `GET /club_roster?select=phone,date_of_birth,gender -> status ${r.status}, rows: ${r.rowCount ?? 'n/a'}`, blocked ? undefined : 'sensitive fields reachable');
  }

  console.log('\nANON — cannot access club_member_directory:');
  {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/club_member_directory?select=*&limit=1`, {
      headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` },
    });
    if (res.status === 404 || res.status === 400) {
      report(false, 'GET /club_member_directory', `does not exist yet (status ${res.status}) — expected before migration`);
    } else {
      const body = await res.json().catch(() => null);
      const rows = Array.isArray(body) ? body.length : null;
      report(res.status !== 200 || rows === 0, `GET /club_member_directory -> status ${res.status}, rows: ${rows ?? 'n/a'}`, rows > 0 ? 'anon can read the directory' : undefined);
    }
  }

  console.log('\nANON — get_platform_roster_directory() rejected outright:');
  {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/get_platform_roster_directory`, {
      method: 'POST', headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}`, 'Content-Type': 'application/json' }, body: '{}',
    });
    report(res.status === 401 || res.status === 404, `POST rpc/get_platform_roster_directory -> ${res.status}`, (res.status !== 401 && res.status !== 404) ? 'not rejected outright' : undefined);
  }

  console.log('\nANON — search_roster_entries_for_linking() requires authentication (internal check):');
  {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/search_roster_entries_for_linking`, {
      method: 'POST', headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_club_id: AQUASHARKS_CLUB_ID, p_query: 'a' }),
    });
    if (res.status === 401 || res.status === 404) {
      report(true, `POST rpc/search_roster_entries_for_linking -> ${res.status} (rejected outright)`);
    } else {
      const body = await res.json().catch(() => null);
      const rows = Array.isArray(body) ? body.length : null;
      report(rows === 0, `POST rpc/search_roster_entries_for_linking -> ${res.status}, rows: ${rows ?? 'n/a'}`, rows > 0 ? 'anon got data from an authenticated-only function' : undefined);
    }
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
}

function syntheticModeInstructions() {
  console.log(`
--mode=synthetic is not automated — see scripts/test-profiles-rls.mjs's
synthetic-mode instructions for the general pattern. For club_roster
specifically, on a LOCAL/PREVIEW project only:

1. Create 2 test clubs (A, B), each with one roster row linked to a
   throwaway test user, one club_admins row (club A only), one
   club_coaches row (club B only).
2. MEMBER: sign in as club A's roster user. Confirm:
   a. can SELECT own roster row directly.
   b. cannot SELECT club B's roster row.
   c. club_member_directory returns only same-club rows, only the 4
      approved columns, and only for is_active=true rows.
3. CLUB ADMIN: sign in as club A's admin. Confirm:
   a. can SELECT all of club A's roster.
   b. cannot SELECT club B's roster.
   c. approved UPDATE (e.g. category) succeeds; confirm no unrelated field
      was silently allowed beyond what club_roster_update_by_admin already permitted (unchanged by this migration).
4. COACH: sign in as club B's coach. Confirm:
   a. can SELECT club B's roster.
   b. cannot SELECT club A's roster.
5. PLATFORM ADMIN: sign in as a profiles.is_admin=true user. Confirm
   get_platform_roster_directory() returns rows from BOTH clubs.
6. YOUTH DATA: confirm club_member_directory's output for any row never
   contains phone/date_of_birth/gender/fee_paid/is_trial keys at all
   (not just null-valued — the columns themselves must be absent).
7. Tear down test clubs/users when done.
`);
}

if (MODE === 'production-safe') productionSafeMode();
else if (MODE === 'synthetic') syntheticModeInstructions();
else { console.error(`Unknown --mode="${MODE}"`); process.exit(1); }
