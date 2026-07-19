# `club_join_links` RLS Remediation — Investigation, Design

Companion to `docs/refactor/INCIDENT_CLUB_JOIN_LINKS_PUBLIC_READ.md` and
`sql/2026-07-19_fix-club-join-links-rls.sql`.

## Part B — Investigation

**Schema:** `id, club_id, code (text), created_by, expires_at, max_uses,
use_count (default 0), is_active (default true), created_at`. No
`revoked_at`/`revoked_by` — a link is "revoked" by setting `is_active =
false`, no separate state. No redemption-audit table exists (`use_count`
is the only usage signal).

**RLS status:** enabled. **Policies (before this fix):**

| Policy | Command | Rule |
|---|---|---|
| `join_links_public_read` | SELECT | `USING (true)` — **the unsafe policy** |
| `join_links_club_admins_write` | ALL | `EXISTS (club_admins WHERE club_id=... AND user_id=auth.uid())` |
| `join_links_admin_insert` | INSERT | `is_club_admin(club_id)` |
| `join_links_admin_update` | UPDATE | `is_club_admin(club_id)` |
| `join_links_admin_delete` | DELETE | `is_club_admin(club_id)` |

Write side already correctly scoped (redundantly — two overlapping admin
checks, `club_admins` table directly and via `is_club_admin()`), so
**not touched by this migration**, same approach as `club_roster`.

**Found: `is_club_admin(p_club_id)` is a *different, slightly weaker*
function than `is_club_admin_or_organiser()`** (used for `club_roster`) —
it checks `club_members.role IN ('admin','organiser')` but omits both the
`club_admins` table fallback and the `is_active = true` requirement that
`is_club_admin_or_organiser()` has. Not touched here (write-side is out of
scope, per the same rule as `club_roster`), but flagged as a residual
schema inconsistency worth reconciling in a later pass — see
`INCIDENT_CLUB_JOIN_LINKS_PUBLIC_READ.md` residual risk.

**Anon verification (counts/lengths/booleans only, zero codes printed):**
- Total rows: 6. All 6 `is_active = true`. 0 expired.
- **Code length: min 3, max 20 characters, 6 distinct lengths across 6 rows — no consistent format.** A 3-character code is trivially brute-forceable.
- `max_uses` is `NULL` on all 6 (no usage cap currently set on any link — unlimited-use by design).
- `use_count > 0` on 0 of 6 (none show a tracked redemption yet).

**Root cause of the weak entropy — found in `club-admin.html`'s
`generateNewLink()`:**
```js
const code = currentClub.slug + '-' + Math.random().toString(36).slice(2,7);
```
Two problems: `Math.random()` is not cryptographically secure, and the
club `slug` prefix is public/predictable (e.g. `duc-`), so an attacker
only needs to brute-force the ~5-character random suffix, not the whole
string. **This is a code-generation bug affecting all future codes, not
just a property of the 6 existing rows** — fixed in this pass (see
Application Fix below). The 6 existing codes are NOT regenerated in this
migration (see "Decision: not rotating existing codes" below).

**Repository call sites:**

| File : site | Auth | Reads | Business purpose | Fix |
|---|---|---|---|---|
| `join.html:308` | **Unauthenticated** (runs before the login check) | `select('*, clubs(*)')` by code | Initial code validation + club display, before asking the user to sign in | → `validate_join_code(p_code)` RPC |
| `join.html:608,620` | Authenticated | `INSERT club_members` + `UPDATE club_join_links.use_count` (2 separate, non-atomic client calls) | Completing the join | → `redeem_club_join_code(p_code, p_roster_id)` RPC — atomic, adds validation the client-driven version never had (expiry/exhaustion/duplicate-membership checks) |
| `clubs.html:1907` | **Unauthenticated** (public club directory page) | `select('code')` for one `club_id` | "Join this club" banner button, by design public — self-service enrollment is the point | → `get_club_active_join_code(p_club_id)` RPC — same narrow, by-design-public behavior, but eliminates bulk enumeration and other-column access |
| `club-admin.html` (5 sites: `loadJoinLink`, `loadParentsPage`, `generateNewLink`, `renderJoinLink` support) | Authenticated, club-admin-gated page, always `.eq('club_id', currentClub.id)`-scoped | Full row (`select('*')`), INSERT, UPDATE | Club admin viewing/rotating their own club's join link | **No code change** — covered transparently by the new `join_links_select_admin_organiser` RLS policy, exactly like `club-admin.html`'s `club_roster` reads needed no change |

## Approved access model (implemented)

Matches the task's model exactly:
- **Anon:** no direct table SELECT/INSERT/UPDATE/DELETE at all.
- **Ordinary authenticated user:** no direct table access either — cannot enumerate or filter by club.
- **Club admin/organiser:** direct table SELECT (new policy, reusing `is_club_admin_or_organiser()` for consistency with `club_roster`) — write side already correctly scoped, untouched.
- **Platform admin:** not specifically needed here (no cross-club admin UI exists for join links in the app) — omitted rather than built speculatively.
- **Joining user:** `validate_join_code()` (anon, code→club only, never the row) and `redeem_club_join_code()` (authenticated, atomic, minimal return).
- **Public club page:** `get_club_active_join_code()` (anon, one club's current code only — matches existing by-design public behavior, eliminates bulk read).

## Decision: not rotating the 6 existing codes in this migration

The task explicitly permits deferring storage/entropy changes ("do not
claim hashing is mandatory if the existing flow cannot be migrated safely
in this task"). Regenerating the 6 live codes would invalidate any
already-distributed link (WhatsApp messages, printed QR codes, etc.) —
a real product/communication decision, not a purely technical one, and
none of the 6 show any evidence either way in this session. **Recommended
as an immediate follow-up requiring Dave's confirmation** — see the
incident report's "Decisions required."

## Redemption audit

New `club_join_redemptions` table (`link_id, user_id, club_id,
redeemed_at`), populated directly inside `redeem_club_join_code()` (not a
trigger — a trigger on `club_members` INSERT would also fire for
admin-added/CSV-imported members, which aren't "redemptions"). Provides
the durable audit trail the task asks for, beyond the bare `use_count`.
