# `profiles` RLS Remediation — Dependency Matrix, Field Classification, Design

Companion to `docs/refactor/INCIDENT_PROFILES_PUBLIC_READ.md` and
`sql/2026-07-19_fix-profiles-rls.sql`. **Nothing here has been applied.**

## Step 2 — Dependency matrix (every `profiles` read/write found in the repo)

| File : line(s) | Auth context | Fields selected | Reads own or other's row | Purpose | Needs after fix |
|---|---|---|---|---|---|
| `app.js:358` | Authenticated | `terms_accepted_at, avatar_url, display_name, phone, onboarding_completed_at, home_domain` | **Own** (`.eq('id', currentUser.id)`) | Boot-time profile load | ✅ Unaffected — own-row policy covers this |
| `app.js:519` | Authenticated | INSERT | Own | Onboarding profile creation | ✅ Unaffected — own-row INSERT policy covers this |
| `app.js:1147` | Authenticated | `count only, head: true` | N/A (aggregate) | New-signup stats (7-day count) | ⚠️ Needs an aggregate-safe path — a `count`-only query with `head:true` doesn't return rows, but still needs a policy that permits *counting* across all rows. Own-row-only RLS would return 0/1, not the real count. **Needs a `SECURITY DEFINER` RPC or a permissive-but-column-free count policy.** |
| `app.js:1220`, `2250` | Authenticated | `id, display_name` | Other (`.in('id', userIds)`) | Attribution — show names of other members who logged temps / created something | ⚠️ Needs `public_profiles` view (id + display_name only) |
| `app.js:2697`, `3479` | Authenticated | `id, display_name` | Other | Same pattern (leaderboard/creator attribution) | ⚠️ Needs `public_profiles` view |
| `app.js:3208` | Authenticated | `display_name` | Own | Push notification content | ✅ Unaffected |
| `app.js:3209` | Authenticated | `id` where `notify_new_swims=true` | **Other, filtered** | Building the fan-out list for new-member push notifications | ⚠️ Needs a `SECURITY DEFINER` RPC (fan-out list, not a general read) |
| `app.js:6557` (from prior session's notes) | Authenticated | `id` where `is_admin=true` | Other | Admin fan-out for new-signup in-app notices | ⚠️ Same — needs an RPC, not a general read |
| `app-nav.js:1317,1556,1588,1739` | Authenticated | `notify_new_swims` (read+write) | Own | Notification preference toggle | ✅ Unaffected |
| `app-trends.js:756` | Authenticated | `id, display_name` | Other | Trends attribution | ⚠️ Needs `public_profiles` view |
| `join.html:629` | Authenticated | `full_name, date_of_birth, phone` | Own | Onboarding completion check | ✅ Unaffected |
| `join.html:667` | Authenticated | UPDATE | Own | Onboarding save | ✅ Unaffected |
| `coach.html:1092` | Authenticated | `display_name` | Own | Coach's own display name | ✅ Unaffected |
| `clubs.html:699` | Authenticated | `id, display_name` | Other (club member list) | Public club roster names on the club directory page | ⚠️ Needs `public_profiles` view |
| `crossing-prep.html:1983,2607` | Authenticated (admin-gated `uidOverride`) | `display_name, email` | Other, **but only when `session.user.id === DAVE_ID`** (hardcoded, existing gate) | Admin "view as" feature for Channel-prep dashboards | ⚠️ Needs a scoped RPC even though today's client-side gate limits who reaches it — the underlying table read shouldn't rely on that gate alone (Step 3/9 requirement) |
| `admin.html:1099` | Authenticated (weak client gate: `user.email === ADMIN_EMAIL`) | **`id, email, display_name, phone, emergency_contact_name, onboarding_completed_at, created_at, address_line1, city, postal_code`** — ALL 645 rows, no filter | Other — **every user** | Admin dashboard's user list (location breakdown, contact info, onboarding status) | 🔴 **The one genuinely hard case.** This is a legitimate, necessary admin feature that needs broad read access to sensitive fields. Must move to a `SECURITY DEFINER` RPC gated on `profiles.is_admin`, not a table-level policy — see Step 4 design below. |
| `admin.html:1583` | Same admin gate | `city` (all rows) | Other | City breakdown for a chart | 🔴 Same RPC as above should cover this |
| `admin.html:1720,1811,2141` | Same admin gate | `id, display_name` | Other | Attribution in admin views | ⚠️ Needs `public_profiles` view (these don't need sensitive fields) |
| `club-admin.html:2379` | Authenticated (club-admin gated) | `id, display_name, email, phone` | Other (`.in('id', allUserIds)` — pre-filtered to club roster IDs client-side) | Club roster contact list | ⚠️ Needs a scoped RPC (`get_club_member_profiles(club_id)`) checking `is_club_manager()`, not a client-side ID filter as the only gate |
| `club-admin.html:5646,5708,5754,5797,7794,7887,8630` | Authenticated (club-admin gated) | Mix of `id, display_name, email` | Other | Roster linking, parent linking, member search-by-email | ⚠️ Same — needs scoped RPC(s); the `.ilike('email', email)` search pattern specifically should become a `SECURITY DEFINER` function that only returns `id, display_name` (never the searched-for user's other fields) to prevent using it as a general email→profile lookup |
| `club-admin.html:5993` | Authenticated | `id` by exact email | Other | Email→id resolution for linking | ⚠️ Same RPC as above |

## Step 3 — Field classification

| Field | Classification | Who may read | Who may update | Public view? | Retention | Masking | Audit |
|---|---|---|---|---|---|---|---|
| `id` | SYSTEM | Anyone (it's a UUID, not identifying alone) | Nobody (PK) | Yes | N/A | No | No |
| `display_name` | MEMBER_VISIBLE | Any authenticated user (needed for leaderboards/rosters/attribution) | Self only | Yes (`public_profiles`) | Standard | No | No |
| `full_name` | PERSONAL_SENSITIVE | Self, admin | Self only | **No** | Standard | No | No |
| `avatar_url` | MEMBER_VISIBLE | Any authenticated user | Self only | Could be added to `public_profiles` later — not included in the first pass to keep scope minimal | Standard | No | No |
| `email` | PERSONAL_SENSITIVE | Self, admin, club managers (for linking their own club's members only) | Self only (system-synced on signup) | **No** | Standard | No — but access should be scoped/RPC-only | Recommend logging admin/club-manager reads |
| `phone` | SAFETY_SENSITIVE | Self, admin, club managers (their club's roster only) | Self only | **No** | Standard | No | Recommend logging admin/club-manager reads |
| `date_of_birth` | PERSONAL_SENSITIVE | Self, admin (age-eligibility checks) | Self only | **No** | Standard | Consider age-only derivation for any future feature that needs "is this person a minor" without needing the full DOB | No |
| `address_line1`, `address_line2`, `city`, `postal_code` | SAFETY_SENSITIVE | Self, admin | Self only | **No** | Standard | No | Recommend logging admin reads |
| `emergency_contact_name`, `emergency_contact_phone` | SAFETY_SENSITIVE | Self, admin | Self only | **No** | Standard | No | **Recommend logging every admin read — this is the most safety-critical field pair, but also the most privacy-sensitive; access should be traceable** |
| `last_known_lat`, `last_known_lng` | SAFETY_SENSITIVE | Self, admin (in a real emergency context) | Self / system | **No** | Standard | No | Recommend logging admin reads |
| `home_beach_id`, `home_domain`, `experience_level`, `preferred_suit`, `cold_tolerance_min_c`, `pool_1km_time_seconds`, `ocean_1km_time_seconds` | MEMBER_VISIBLE / OPERATIONAL | Self; some (experience level) plausibly fine for `public_profiles` later, not included now | Self only | Not in first pass | Standard | No | No |
| `notify_new_swims` | OPERATIONAL | Self, system (notification fan-out) | Self, system | No | Standard | No | No |
| `terms_accepted_at`, `privacy_accepted_at`, `waiver_accepted_at`, `data_consent_at`, `onboarding_completed_at` | ADMIN_ONLY / OPERATIONAL | Self, admin (compliance verification) | Self, system | No | **Should be retained — these are the actual proof of consent** | No | No |
| `is_admin` | ADMIN_ONLY | Self (to know their own status), admin | Nobody via the API (should only ever be set via a trusted server-side/manual path) | No | Standard | No | Recommend logging any change |
| `created_at` | OPERATIONAL | Self, admin | Nobody (system-set) | Could be public but not needed | Standard | No | No |

## Step 4 — Remediation design (least-privilege model)

**Objects proposed:**

1. **`profiles`** (existing table) — policies replaced so only
   `auth.uid() = id` grants SELECT/UPDATE. `anon` gets no direct SELECT at
   all. This satisfies principles 1–3.
2. **`public_profiles`** (new view) — `SELECT id, display_name FROM profiles`,
   granted to `authenticated` only (not `anon` — nothing in the dependency
   matrix above needs anonymous access to even names). Satisfies principle 4.
   Deliberately minimal: just the two columns every current "attribution"
   use case (`app.js`, `app-trends.js`, `clubs.html`, `admin.html`'s
   attribution reads) actually needs. Not exposing `avatar_url` or anything
   else in this first pass — smallest safe change, per the instruction not
   to over-engineer.
3. **`get_admin_user_directory()`** (new `SECURITY DEFINER` RPC) — returns
   the exact column set `admin.html:1099` currently selects (`id, email,
   display_name, phone, emergency_contact_name, onboarding_completed_at,
   created_at, address_line1, city, postal_code`), for all rows, but
   **only** if `has_role`-equivalent check passes. Since `user_roles`
   (from the paused prior-session work) isn't applied, this RPC checks
   `profiles.is_admin = true` for the caller directly (the same flag
   `admin.html` already conceptually relies on, now actually enforced at
   the data layer instead of only in client-side JS). Satisfies principle 7.
4. **`get_club_roster_profiles(p_club_id uuid)`** (new `SECURITY DEFINER`
   RPC) — returns `id, display_name, email, phone` **only** for user ids
   that are actually on that club's roster (join against `club_roster`
   internally), and only if the caller passes `is_club_manager(p_club_id)`.
   Satisfies principle 5 — club managers get exactly their club's data, not
   a client-trusted ID list they could tamper with.
5. **`search_profile_by_email(p_email text)`** (new `SECURITY DEFINER` RPC)
   — replaces the `.ilike('email', email)` pattern in `club-admin.html`.
   Returns only `id, display_name` (never phone/email-confirmation/other
   fields) for a matched row, and only callable by an authenticated user
   (any club admin can look up *whether* an email belongs to a user, to
   link them, without being able to fish for other people's contact info).
6. **`get_signup_notification_targets()`** (new `SECURITY DEFINER` RPC) —
   replaces the two ad-hoc "who gets notified" queries in `app.js`
   (`notify_new_swims=true` fan-out, `is_admin=true` fan-out). Returns only
   `id`. Not admin-gated (any authenticated action that completes onboarding
   needs to trigger this), but scoped to exactly the two boolean flags it
   needs — never returns phone/address/etc.
7. **New-signup count** (`app.js:1147`) — a `SECURITY DEFINER` RPC
   `count_new_signups_since(p_since timestamptz)` returning a bare integer,
   or (simpler) leave this specific call reading via `public_profiles`
   with a `created_at` column added to that view — **not decided here,
   flagged as a small open design choice for whoever applies this.**

**Principles satisfied:**
- ✅ 1 (own full profile) — direct policy.
- ✅ 2 (anon blocked) — no anon grant/policy at all after the fix.
- ✅ 3 (authenticated can't read arbitrary others' full profile) — own-row-only policy; all "need someone else's data" cases move to scoped RPCs/views.
- ✅ 4 (public view, approved fields only) — `public_profiles`, 2 columns.
- ✅ 5 (club managers scoped) — `get_club_roster_profiles()` joins against actual roster membership, doesn't trust a client-supplied ID list.
- ✅ 6 (emergency/address data not exposed via general queries) — never in `public_profiles`, only reachable via the admin RPC.
- ✅ 7 (admin access server-side/role-gated) — `get_admin_user_directory()`, checked against `profiles.is_admin` inside the function (not just the client's `ADMIN_EMAIL` check).
- ✅ 8 (service-role stays backend-only) — nothing here changes service-role usage; it already wasn't exposed client-side.
- ✅ 9 (no hardcoded email/ID allow-lists in the new policies) — the RPCs check `is_admin`/`is_club_manager()`, not a literal list. (Note: `admin.html`'s *own* client-side gate still uses a hardcoded `ADMIN_EMAIL` — that's a separate, already-documented issue from the earlier phase's `ACCESS_MATRIX.md`, not reintroduced here.)
- ✅ 10 (cross-user access scope-based, auditable) — every RPC above is a named, individually-grantable function; auditing "who called `get_admin_user_directory()`" is a small additive change (a logging line inside the function) if Dave wants it, not implemented in this pass to keep the change minimal, but structurally trivial to add later since it's already a single function.

**What this deliberately does NOT do (smallest safe change):**
- Does not touch `user_roles` (paused, per this task's explicit stop-work instruction).
- Does not add `avatar_url` or other MEMBER_VISIBLE-but-not-yet-needed fields to `public_profiles`.
- Does not add access logging to the new RPCs yet — recommended as a fast follow, not bundled in.
- Does not touch `club_roster`'s identical issue — separate migration, see `RLS_AUDIT.md`.
