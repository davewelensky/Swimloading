# Incident: `club_roster` table publicly readable, unauthenticated

## ✅ RESOLVED — 2026-07-19

- **Discovery date:** 2026-07-19, found during the Step 6 targeted RLS sweep that followed the `profiles` RLS fix (same session, same class of finding).
- **App-code compatibility deployed:** commit `189ca13`, Vercel deployment `GaVBJe2ySz24XsbtPhT8iQ3HMoq3` — verified success, zero console errors across homepage/`/app`/`/clubs`/`/club-admin/duc`/`/coach/aqua-sharks-atlantic`, both before and after the migration.
- **Migration applied:** `fix_club_roster_rls` (via `supabase-admin` `apply_migration`), same session, immediately after compatibility code was confirmed live and all pre-apply checks passed.
- **Post-fix verification:** `scripts/test-club-roster-rls.mjs --mode=production-safe` — 7/7 pass (up from 2/7 pre-fix). Anon confirmed unable to read `club_roster` (0 rows, 0 count), unable to filter by the Aquasharks (youth-squad) `club_id` specifically, unable to reach sensitive fields, unable to reach `club_member_directory`, and both new RPCs correctly reject anon outright with 401 (not the 200-with-empty gap found and patched mid-stream during the `profiles` fix — this migration proactively included `REVOKE ... FROM PUBLIC` from the start, learning from that incident).

## Issue description

The `club_roster` table had an active RLS policy — `"Public can read
club_roster"`, `SELECT`, `USING (true)`, no role restriction — identical
in shape to the already-fixed `profiles` issue. Any request bearing only
the public `anon` API key could read every column of every row.

## Unsafe policy

`"Public can read club_roster"` — `FOR SELECT USING (true)`.

## Affected row count and field categories

**962 rows** (925 marked `is_active`). Exposed fields included `phone`,
`date_of_birth`, `gender` (all classified `PERSONAL_SENSITIVE` or
`YOUTH_SENSITIVE`), plus financial/operational fields (`fee_paid`,
`fee_due_date`, `is_trial`) classified `ADMIN_ONLY`. Full classification:
`docs/refactor/CLUB_ROSTER_RLS_REMEDIATION.md`.

## Youth/minor exposure assessment

**Confirmed.** Filtering by Aquasharks' `club_id` specifically (a club
with youth squads per `CLAUDE.md`) returned 224 rows via the anon key
during Step 1 verification — youth-squad roster data, including
`date_of_birth` and `gender`, was directly targetable by club, not just
theoretically exposed in the aggregate. This was treated as the
highest-severity finding in this remediation, consistent with the task's
explicit "youth/minor data receives the most restrictive treatment by
default" instruction — `date_of_birth`/`age_at_import` are excluded from
every directory/search path built in this fix, restricted to self + club
admin only.

## Exposure mechanism

Identical to `profiles`: direct unauthenticated HTTP requests to the
Supabase PostgREST endpoint, using the public `anon` key already embedded
client-side across the site. Not a web-route bug — reachable directly
against the database API, bypassing the application entirely.

## Compatibility deployment SHA

`189ca13` — `Vercel GaVBJe2ySz24XsbtPhT8iQ3HMoq3`.

## Migration execution time

Applied via `supabase-admin apply_migration` this session (2026-07-19),
immediately following the compatibility deployment's verification and all
Step 9 pre-apply checks (unsafe policy present, row count 962, target
objects didn't already exist, RLS enabled, write-side policy count
unchanged at 4).

## Policies removed

`"Public can read club_roster"` (the only SELECT policy that existed).

## Policies created

`club_roster_select_own` (reuses existing `is_own_roster_profile()`),
`club_roster_select_admin_organiser` (reuses existing
`is_club_admin_or_organiser()`), `club_roster_select_coach` (new, matches
the existing coach-check shape from `club_roster_delete_by_coach`/
`club_roster_insert_by_coach` exactly). **Write-side policies (4) were
intentionally left untouched** — already correctly scoped (admin/
moderator/coach for INSERT, admin/moderator for UPDATE, coach for
DELETE), confirmed via direct policy inspection before this migration.

## Views/RPCs created

`club_member_directory` view (`club_id, profile_id, display_name,
squad_label` — only for authenticated users with their own active roster
row in the same club). `get_platform_roster_directory()` (platform-admin
gated, mirrors `get_admin_user_directory()` from the `profiles` fix).
`search_roster_entries_for_linking()` (replaces `join.html`'s 4 direct
roster searches — narrow fields, requires authentication, requires at
least one specific filter to prevent unbounded listing).

## Post-fix verification

- Metadata: unsafe policy count 0, exactly the 3 expected SELECT
  policies, write-policy count unchanged at 4, RLS still enabled, view +
  both RPCs exist.
- Live: `scripts/test-club-roster-rls.mjs` 7/7 pass — anon blocked on
  direct SELECT, count enumeration, the Aquasharks-specific filter,
  sensitive-field selection, `club_member_directory`, and both RPCs
  (401 outright, not empty-with-200).
- Application: homepage, `/app`, `/clubs`, `/club-admin/duc`,
  `/coach/aqua-sharks-atlantic` all reload clean pre- and post-migration
  — zero console errors.
- **Member/club-admin/coach positive-path access was not independently
  live-tested with real credentials in this session** (same limitation as
  the `profiles` fix — no synthetic test users were created, per the
  "prepare tests, don't run destructive setup" scope boundary). Correctness
  is guaranteed by the policy logic itself (`is_own_roster_profile`,
  `is_club_admin_or_organiser`, and the coach `EXISTS` check are all
  already-proven functions/patterns reused from existing, working code —
  not new, unverified logic), not by an empirical positive-path test.
  `scripts/test-club-roster-rls.mjs --mode=synthetic` documents the
  procedure for whenever synthetic test users are set up.

## Evidence of actual unauthorised access

**None found or claimed.** Consistent with the `profiles` incident:
roster data was publicly accessible, and unauthenticated access was
technically possible and actively demonstrated (by this session, for the
explicit purpose of confirming and then closing this report) — those are
the only two claims made here. Actual third-party access is unconfirmed;
proving or disproving it would require Supabase access-log review, which
remains outstanding for both incidents (no dashboard access this
session) — see `docs/refactor/VERCEL_MANUAL_CHECKLIST.md`.

## Residual risk

- Same repo-visibility fact as the `profiles` incident — this report is
  published on the public GitHub repo after the fix is live, not before
  (mirroring the deliberate sequencing used for the `profiles` report).
- `club_member_directory` excludes `member_number`, `category`, and other
  operational fields the task's approved field list didn't include —
  if a future feature needs those in the directory, that's a deliberate
  scope decision to revisit with Dave, not an oversight.
- `search_roster_entries_for_linking()` is not restricted to unlinked
  rows (see `CLUB_ROSTER_RLS_REMEDIATION.md` Step 3/4 for why — the
  parent-linking flow needs to find already-linked children too). This
  is a intentionally slightly broader surface than a pure "unlinked only"
  design would have been, traded off against not breaking a legitimate
  flow — still authenticated-only, club-scoped, narrow-field, and
  requires an exact/partial match filter (no blind listing).
- `club_coaches.squads_can_coach` (squad-level scoping) exists in the
  schema but is not used by the new coach SELECT policy — matches the
  existing write-side coach policies' club-level (not squad-level) scope,
  so this isn't a new gap, but squad-level coach scoping remains a
  possible future tightening if ever desired.
