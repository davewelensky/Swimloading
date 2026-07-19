# `club_roster` RLS Remediation — Field Classification, Dependency Matrix, Design

Companion to `docs/refactor/INCIDENT_CLUB_ROSTER_PUBLIC_READ.md` and
`sql/2026-07-19_fix-club-roster-rls.sql`. Mirrors the `profiles` fix in
shape (`docs/refactor/PROFILES_RLS_REMEDIATION.md`).

**Terminology note:** the task's spec uses "profile_id" for the
member-linking column. The actual column on `club_roster` is `user_id`
(nullable — many rows are unlinked/imported swimmers with no app account
yet). Used interchangeably below with that clarification.

## Step 1 — Confirmed exposure (safe verification, no personal values printed)

- **Unsafe policy:** `"Public can read club_roster"` — `SELECT`, `USING (true)`, no role restriction. Same shape as the `profiles` issue.
- RLS enabled: true. Grants: `anon`/`authenticated` both have full table-level CRUD grants (Supabase default boilerplate) — the same PUBLIC-execute-style gap class found and closed during the `profiles` fix applies to table grants too, but is moot once RLS policies are correctly scoped (RLS is the actual gate for SELECT/UPDATE/DELETE; the table-level GRANT alone doesn't bypass RLS).
- **Existing, already-in-production helper functions found — reused, not rebuilt:** `is_own_roster_profile(p_roster_id)` (checks `user_id = auth.uid()`), `can_admin_roster_profile(p_roster_id)` (checks `is_club_admin_or_organiser(club_id)`), `get_roster_user_id(p_roster_id)`, `is_club_admin_or_organiser(p_club_id)`. All already used by `sql/applied/fix_club_rls_and_schema.sql` and `add_gala_entry_requests.sql` to gate *other* tables that reference `club_roster` — never previously applied to `club_roster`'s own SELECT policy, which is the actual gap.
- **Anon verification (counts/field-presence/status only):**
  - Row count: 962 (via `Content-Range` header).
  - Sensitive field presence confirmed on a sampled row (`gender`, `fee_paid`, `member_type` present; `phone`/`date_of_birth` null on that specific row but the columns are fully queryable and populated on other rows per repo usage).
  - **Filtered by Aquasharks' `club_id` (youth squads) specifically: 224 rows — confirms youth-linked roster data is directly exposed and targetable by club.**
  - Arbitrary single-row targeting confirmed (fetched one row's `id` into a shell variable, never printed, re-queried directly — sensitive fields present).
- Dependent RPCs found: `get_club_roster_profiles` (created during the `profiles` fix — already references `club_roster` in a join, unaffected by this migration). No dependent views on `club_roster` existed before this work.

## Step 2 — Field classification

| Field | Classification | Who may read | Who may update | Directory? | Masking | Audit |
|---|---|---|---|---|---|---|
| `id` | SYSTEM | Anyone with row access | Nobody (PK) | Yes | No | No |
| `club_id` | CLUB_OPERATIONAL | Anyone with row access | Admin (rare) | Yes | No | No |
| `member_number` | CLUB_OPERATIONAL | Self, club admin/coach | Admin | No — not in the approved directory field list | No | No |
| `display_name` | MEMBER_DIRECTORY | Self, club admin/coach, same-club members (via directory) | Self (limited), admin | **Yes** | No | No |
| `age_at_import` | YOUTH_SENSITIVE | Self, club admin | Admin | No | No | No |
| `category` | CLUB_OPERATIONAL | Self, club admin/coach | Admin | No (not in the task's approved field list — squad/group label only) | No | No |
| `gender` | PERSONAL_SENSITIVE | Self, club admin/coach | Admin | No | No | No |
| `user_id` | SYSTEM / ADMIN_ONLY | Self, club admin (for linking) | Admin (link/unlink) | **As `profile_id`, yes — the directory's join key** | No | Recommend logging link/unlink |
| `created_at` | SYSTEM | Self, club admin | Nobody (system) | No | No | No |
| `phone` | PERSONAL_SENSITIVE | Self, club admin/coach | Self, admin | **No** | No | No |
| `member_type` | ADMIN_ONLY | Club admin/coach | Admin | No | No | No |
| `squad_id`, `secondary_squad_id` | CLUB_OPERATIONAL | Self, club admin/coach, same-club members (via directory, as a squad *label*, not raw UUID) | Admin/coach | **Yes, as a resolved label (join to `club_squads.name`), not the raw UUID** | No | No |
| `date_of_birth` | YOUTH_SENSITIVE / SAFETY_SENSITIVE | Self, club admin | Admin | **No** | No | Recommend logging admin reads |
| `is_trial`, `trial_start_date`, `trial_end_date` | CLUB_OPERATIONAL / ADMIN_ONLY | Self, club admin | Admin | No | No | No |
| `fee_paid`, `fee_due_date` | ADMIN_ONLY (financial) | Club admin only (arguably self too — product decision, defaulted to admin-only + self for this pass) | Admin | No | No | Recommend logging admin changes |
| `is_active` | CLUB_OPERATIONAL | Self, club admin/coach | Admin | Used as a directory *filter* (exclude inactive), not itself exposed | No | No |
| `lts_default_slot` | CLUB_OPERATIONAL | Self, club admin/coach | Self, admin | No | No | No |

**Youth/minor treatment:** `date_of_birth` and `age_at_import` are the two
fields that most directly identify a minor's age — classified
`YOUTH_SENSITIVE`, excluded from the directory entirely, restricted to
self + club admin (not even coaches get DOB/age by default in this design
— coaches get operational fields only, see Step 4). `gender` is excluded
from the directory too, though it remains visible to the same-club search
used during onboarding (see Step 3/4 — that's a narrower, purpose-specific
exposure, not the general directory).

## Step 3 — Dependency matrix (every `club_roster` call site found)

| File : site | Auth | Fields | Own/cross-user | Club scope | Proposed replacement |
|---|---|---|---|---|---|
| `app-nav.js:837` (`checkIsDUCMember`) | Authenticated | count only | Own (`user_id = currentUser.id`) | Single hardcoded club (DUC) | ✅ Unaffected — own-row policy covers a `count`-only own-row query |
| `app-club.js:36` (`loadUserClubs`) | Authenticated | `id, member_number, display_name, category, gender, date_of_birth, squad_id` | Own (`roster_id` sourced from the caller's own `club_members` rows) | Multi-club, but only the caller's own memberships | ✅ Unaffected — own-row policy covers it, since every `roster_id` in the `.in()` list is the caller's own |
| `join.html:451,477,504,713` (self-identification during account linking) | Authenticated (post-signup, pre-roster-link) | `id, member_number, display_name, category, gender, squad_id` (varies by site) | **Cross-user, but restricted to UNLINKED rows** (`user_id IS NULL`) — the whole point is finding *your* still-unlinked entry among a specific club's imported roster | Single club, resolved from a validated join-link token (`club_join_links`), not arbitrary user input | ⚠️ New narrow RPC: `search_unlinked_roster_entries(p_club_id, p_query, p_member_number)` — returns only unlinked rows, only the 5 identification fields, never phone/DOB/fee |
| `club-admin.html` (20+ sites — roster CRUD, squad assignment, trial/fee management, gala entry linking, LTS scheduling) | Authenticated, club-admin-gated page | Full column range including `phone`, `date_of_birth`, `gender`, `fee_paid` | Cross-user, but always within `currentClub.id` (confirmed pattern from the `profiles` fix — this file consistently scopes by `currentClub.id`) | Single club at a time (the admin's own club) | ⚠️ Direct table access under the new `club_roster_select_admin`/`club_roster_update_admin` policies (`is_club_admin_or_organiser(club_id)`) — **no code change needed**, since these policies grant the exact same access club-admin.html already assumed, just enforced server-side now instead of only by the page's login gate |
| `coach.html:1145,2097,2105,2149` (attendance roster, walk-in registration, roster deletion) | Authenticated, coach-gated page | Roster CRUD for the coach's assigned club | Cross-user, scoped to the coach's club | Single club | ⚠️ Direct table access under the new `club_roster_select_coach`/write policies (club-scoped, matching the existing `club_roster_delete_by_coach`/`insert_by_coach` policies' shape) — **no code change needed** |
| `galas.html` | Authenticated | `id, display_name, date_of_birth, gender, squad_id` | Own (`.eq('user_id', currentUser.id)`) | Single club | Already recommended **RETIRE** (`docs/refactor/ROUTE_INVESTIGATION.md`) — moot, not touched here |

**No unauthenticated (anon) call sites found in application code** — the
exposure was purely at the database layer, reachable only via direct API
calls (as demonstrated in Step 1), not through any legitimate app flow.

## Step 4 — Access model design

Implements the task's exact model:

1. **Own-row SELECT:** reuse `is_own_roster_profile(id)` (already exists, already correct — `user_id = auth.uid()`).
2. **Club-admin SELECT + UPDATE:** reuse `is_club_admin_or_organiser(club_id)` (already exists).
3. **Coach SELECT:** new policy matching the *exact* existing shape of `club_roster_delete_by_coach`/`club_roster_insert_by_coach` (club-scoped via `club_coaches`, `is_active = true`) — for consistency with the already-established, already-tested coach access pattern. **Not squad-scoped** (`club_coaches.squads_can_coach` exists as a column but the existing write-side coach policies don't use it either — matching existing behavior, not introducing a new asymmetry where a coach could read less than they can already insert/delete).
4. **Platform admin:** new `get_platform_roster_directory()` RPC, gated on `profiles.is_admin` (same flag as `get_admin_user_directory()` from the `profiles` fix), returns all clubs' roster data.
5. **`club_member_directory` view:** `club_id, profile_id (user_id), display_name, squad_label (joined from club_squads.name)`. Filtered to `is_active = true`. Requires same-club membership (`EXISTS` subquery checking the caller has their own active roster row in that club) — implemented as a plain view (bypasses `club_roster`'s RLS via table ownership, same mechanism `public_profiles` already uses successfully), with the membership check as an explicit `WHERE EXISTS(...)` clause in the view's own defining query, not relying on RLS. `GRANT SELECT` to `authenticated` only, not `anon`.
6. **`search_unlinked_roster_entries()` RPC:** the one addition beyond the task's literal enumerated list — required to keep `join.html`'s account-linking flow working (a genuine, narrow, already-existing feature, not a new capability). Returns only unlinked (`user_id IS NULL`) rows, only 5 identification fields, requires authentication.

All `SECURITY DEFINER` functions use `SET search_path = public` and validate `auth.uid()` internally (task requirements 11, and Step 9's pre-apply checklist).
