# Incident: `profiles` table publicly readable, unauthenticated

## Issue description

The `profiles` table has an active Row Level Security policy —
`"Public profiles are viewable by everyone"`, `SELECT`, `USING (true)`,
no role restriction — that permits any request bearing only the public
`anon` API key (no user login, no session) to read every column of every
row, including fields added long after the table's original creation:
phone number, date of birth, full street address, city, postal code, and
emergency contact name/phone.

A second, separate `SELECT` policy (`"Authenticated users can view
profiles"`, `USING (auth.role() = 'authenticated')`) is also broader than
needed — it lets *any* logged-in user read *any other* user's full profile,
not just their own — but the `USING (true)` policy makes that second policy
moot for the anon case: RLS policies are OR'd together, so the narrower
issue is dominated by the wide-open one.

## Date discovered

2026-07-19, during this refactor's Step 6 RLS sweep (flagged by Dave from a
report; confirmed in this session).

## Affected table

`public.profiles` — 645 rows (confirmed via `Content-Range` response header,
not a row-returning query).

## Potentially exposed field categories

Confirmed present and readable (see "Current evidence" below): identity
(`full_name`, `display_name`, `email`), contact (`phone`), demographic
(`date_of_birth`), location (`address_line1`, `address_line2`, `city`,
`postal_code`, `last_known_lat`, `last_known_lng`), safety-critical
(`emergency_contact_name`, `emergency_contact_phone`), and account metadata
(`terms_accepted_at`, `privacy_accepted_at`, `waiver_accepted_at`,
`onboarding_completed_at`, `is_admin`, `home_domain`).

## Estimated affected row count

**645** — every row in the table, confirmed via `Content-Range: 0-0/645`
on a `Range: 0-0` request (count only, no rows fetched).

## Exposure mechanism

Direct, unauthenticated HTTP requests to the standard Supabase PostgREST
REST endpoint (`https://szgkzuswelntnevobnoh.supabase.co/rest/v1/profiles`)
using only the public `anon` API key — the same key embedded client-side in
essentially every page of the site (`app.js`, `dave.html`, dozens of
others). No authentication, no session, no special access was required.
This is not a web-route bug (no page on swimloading.com displays this data
improperly) — it's a database-layer policy gap reachable directly against
Supabase's API, bypassing the web app entirely.

## When the unsafe policy was introduced

**Cannot be precisely dated.** The policy is not present in any file under
`sql/applied/` — every tracked migration that touches `profiles` either adds
a column (`add_emergency_contacts.sql`, `add_address_line2.sql`,
`add_home_domain.sql`, `add_notify_new_swims.sql`, `backfill_email_and_trigger.sql`)
or adds an *admin-gated* policy on a *different* table that references
`profiles.is_admin` — none of them create or modify the `SELECT` policies on
`profiles` itself. The earliest entries in `sql/applied/` date to a bulk
"organize project" commit on 2026-02-17, which is a reorganization date, not
necessarily each file's true creation date.

The policy's exact wording — `"Public profiles are viewable by everyone"` /
`"Users can insert own profile"` / `"Users can update own profile"` — matches
Supabase's own default starter-template policy names for a `profiles` table
verbatim. This strongly suggests the policy originated at initial project
scaffolding (before any tracked migration history existed) and was never
revisited as the table grew to hold sensitive fields. `add_emergency_contacts.sql`
(2026-02-17) and `add_address_line2.sql` (2026-06-16) both added sensitive
columns to the table *without* any accompanying tightening of the read
policy — meaning the exposure's severity grew over roughly four months
without the original gap ever being revisited.

## Whether logs can show actual external access

**Not determined in this session — requires Supabase dashboard access this
environment doesn't have.** Supabase's Logs & Analytics (Postgres logs /
API logs, under Project → Logs) can show historical REST API request
history including source IPs and query patterns, if log retention covers
the relevant period. **This needs Dave to check directly** — recommend
filtering API logs for `GET .../rest/v1/profiles` requests bearing the
`anon` key (not a user JWT) with anything beyond a `select=id,display_name`
pattern, which would indicate a request for the sensitive columns
specifically. This session has no way to query those logs.

## Current evidence

Verified in this session, safely (counts and field-presence only, zero
personal values printed, retained, or logged anywhere in this
conversation):

1. **Row count:** `anon` key → `Content-Range: 0-0/645` (645 total rows).
2. **Non-sensitive field access:** `anon` key → `select=id` → HTTP 200.
3. **Sensitive field access:** `anon` key → `select=id,display_name,phone,date_of_birth,address_line1,city,postal_code,emergency_contact_name,emergency_contact_phone&limit=1` → HTTP 200, all 9 fields present and non-null on the sampled row.
4. **Arbitrary user targeting:** fetched one row's `id` into a shell variable (never displayed), re-queried filtering by that exact id for `phone` and `emergency_contact_phone` → matched, both fields present. Confirms this isn't limited to "the first row of a default listing" — any specific user can be targeted directly by id.

## Containment status

**Not contained yet.** This report intentionally stops short of applying any
fix — per the explicit instruction, production RLS is not to be altered
until access paths are fully understood (Step 2, this session) and Dave has
reviewed the proposed replacement policies. The proposed migration
(`sql/2026-07-19_fix-profiles-rls.sql`) is written and ready but **NOT
applied**. **The exposure remains live in production right now.**

## Remediation plan

See `docs/refactor/PROFILES_RLS_REMEDIATION.md` for the full field
classification, dependency matrix, and policy design. Summary: replace both
broad `SELECT` policies with `USING (auth.uid() = id)` (own-row only);
add a `public_profiles` view exposing only `id, display_name` for the
member-directory-style reads that don't need more; preserve `admin.html`'s
full-roster read via a `SECURITY DEFINER` RPC gated on `profiles.is_admin`
(the same flag `admin.html` already conceptually relies on, just not
currently enforced at the data layer).

## Residual risk

- **`club_roster` has the identical policy shape** and is at least as
  severe (includes minors' data) — see `docs/refactor/RLS_AUDIT.md`. Not
  addressed by this incident's fix. Needs its own migration, recommended as
  the immediate next priority.
- Whether any external party actually harvested this data is unknown
  without Supabase's access logs (see above) — this report does not claim
  and cannot claim that occurred, only that it was possible and, by this
  session's own verification, actively demonstrated (by an authorized
  party, for the explicit purpose of confirming the report).
- Once fixed, any client code that was silently relying on the broad read
  (rather than a scoped query) will start receiving empty results instead
  of an error — see `PROFILES_RLS_REMEDIATION.md`'s dependency matrix for
  which pages need a code change alongside the policy change, not after it.

## Decisions required

1. Approve or amend the proposed replacement policies (`PROFILES_RLS_REMEDIATION.md` + `sql/2026-07-19_fix-profiles-rls.sql`).
2. Whether to fix `club_roster` in the same pass or as an immediate follow-up.
3. Whether to check Supabase's access logs for historical anomalies before or after applying the fix (fixing first stops ongoing exposure regardless of what the logs show).
4. The literal approval phrase **"APPLY PROFILES RLS FIX"** to proceed with the migration once reviewed.
