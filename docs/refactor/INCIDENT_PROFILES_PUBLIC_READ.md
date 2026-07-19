# Incident: `profiles` table publicly readable, unauthenticated

## ✅ RESOLVED — 2026-07-19

- **App-code compatibility deployed:** commit `cd462bd`, Vercel deployment `91EanCfqeiokoSNkgo6qMq8Ls9B6` — verified success, zero console errors across homepage/`/app`/`/clubs`/`/admin`/`/club-admin/duc`.
- **Migration applied:** `fix_profiles_rls` (via `supabase-admin` `apply_migration`), same session, immediately after compatibility code was confirmed live. Unsafe policy removed; own-row policies, `public_profiles` view, and 4 `SECURITY DEFINER` RPCs created.
- **Follow-up hardening applied same session:** `revoke_public_execute_profiles_rpcs` — see "Residual risk, now closed" below.
- **Post-fix verification:** `scripts/test-profiles-rls.mjs --mode=production-safe` — 4/4 pass. Anon confirmed unable to read `profiles` (0 rows, 0 count), `public_profiles` confirmed to expose only `id`/`display_name`, all 4 RPCs confirmed to reject anon outright (401/404).
- **Data was technically exposed for an unknown duration (likely since project scaffolding — see "When the unsafe policy was introduced" below). Actual unauthorised third-party access has NOT been confirmed — no evidence of a breach exists or is claimed here. This distinction is deliberate: exposure existed and was technically possible (demonstrated by this session's own authorised verification); whether anyone else exploited it is unknown without Supabase access-log review, which remains outstanding — see "Decisions required."**

---

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

**✅ Contained.** `fix_profiles_rls` applied 2026-07-19. The unsafe
`USING (true)` policy is removed; `profiles` now permits `SELECT`/`UPDATE`
only where `auth.uid() = id`. Anon confirmed unable to read any row (0
rows, 0 count, all sensitive-field-presence checks negative). App code
compatible with the new access model was deployed *before* the migration
ran (commit `cd462bd`, verified live, zero console errors), per the
required ordering.

## Remediation plan (implemented)

See `docs/refactor/PROFILES_RLS_REMEDIATION.md` for the full field
classification and dependency matrix. Implemented: own-row-only
`SELECT`/`UPDATE` policies; `public_profiles` view (`id, display_name`,
granted to `anon` + `authenticated` — broadened from the original
authenticated-only design after `welcome.html`'s public "contributor name"
feature was found during the app-code compatibility sweep);
`get_admin_user_directory()` (gated on `profiles.is_admin`, broadened
scope for `admin.html`'s full directory read); `get_club_roster_profiles()`
(gated on `is_club_manager()`, broadened during implementation to cover
club admins/coaches/parents, not just roster swimmers, once club-admin.html's
real dependencies were mapped); `search_profile_by_email()`;
`get_signup_notification_targets()`.

## Residual risk

- **`club_roster` has the identical policy shape** and is at least as
  severe (includes minors' data) — see `docs/refactor/RLS_AUDIT.md`. **Not
  addressed by this fix — explicitly out of scope for this task, prepared
  only (see Step 8 below), not implemented.** Still the top recommended
  next priority.
- Whether any external party actually harvested this data before the fix
  is unknown without Supabase's access logs — **this report does not claim
  and cannot claim a breach occurred.** What is confirmed: the exposure
  existed, and unauthenticated access was technically possible and was
  actively demonstrated (by this session, for the explicit purpose of
  confirming and then closing the report) — those are the only two claims
  this document makes. Checking Supabase's access logs for the exposure
  window remains outstanding and unactioned in this session (no dashboard
  access) — see `docs/refactor/VERCEL_MANUAL_CHECKLIST.md`-style manual
  follow-up.
- Two intentional, documented feature degradations remain open (not
  security issues — both fail safely to empty results): the swim-event
  group participant list no longer shows other participants' phone/
  emergency contact (needs a properly scoped RPC to restore, checking the
  caller is themselves a participant/organiser); the "notify opted-in
  users about a new swim" fan-out currently sends to nobody (needs its own
  small RPC, deliberately not merged into `get_signup_notification_targets()`
  since that would have caused admin-notification spam on every swim
  creation). Both flagged in `app.js` code comments at the relevant sites.
- The dashboard's "New Members this week" stat (`app.js:1147`) now
  undercounts (0 or 1, not the true site-wide weekly figure) — not a
  security issue (RLS filters, doesn't error), just an accuracy
  regression, flagged in-code, needs a small aggregate-count RPC as a
  follow-up if the accurate figure matters.
- **Found and closed within this same session, not left open:** the
  original migration granted `EXECUTE` on the 4 new RPCs to `authenticated`
  and revoked from `anon` specifically, but Postgres grants `EXECUTE` to
  `PUBLIC` by default on function creation — `REVOKE ... FROM anon` alone
  doesn't remove access anon still has via the `PUBLIC` grant. Anon could
  therefore *invoke* the functions (confirmed via live testing to receive
  zero rows — no data leaked, the internal `auth.uid()`/`is_admin`/
  `is_club_manager()` checks correctly returned nothing) rather than being
  rejected outright. Closed via a same-session follow-up migration
  (`revoke_public_execute_profiles_rpcs`) — re-verified anon now gets
  401/404 on all 4 functions.
- The repository is public (`github.com/davewelensky/Swimloading`) — this
  incident report (including the confirmed exposure mechanism) is
  published there now, after the fix was live. Noted for completeness;
  not re-litigated here — see the prior session's flag on this and Dave's
  explicit instruction to continue regardless.

## Decisions required

1. ~~Approve or amend the proposed replacement policies~~ — **done, applied.**
2. **`club_roster` fix — prepared (Step 8 below), not implemented. Needs your review and a separate approval phrase before applying, per the same process used here.**
3. Whether to check Supabase's access logs for historical anomalies on the exposure window — still outstanding, needs dashboard access.
4. Whether to prioritise the two documented feature-degradation follow-ups (group-swim emergency contacts, swim-notification fan-out) or leave them as-is for now.
