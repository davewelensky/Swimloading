# Prepared (not implemented): `club_roster` RLS remediation

Per Step 8 — investigation and proposal only. **No changes made.** This
mirrors the `profiles` fix in shape but is a separate, unapplied piece of
work requiring its own review and approval phrase before anything is
touched.

## Current policy

Four policies on `club_roster` (RLS enabled):

| Policy | Command | Rule |
|---|---|---|
| `"Public can read club_roster"` | SELECT | `USING (true)` — **the unsafe one, identical shape to the profiles issue** |
| `club_roster_delete_by_coach` | DELETE | Caller must be a coach (`club_coaches`) for that row's `club_id` |
| `club_roster_insert_by_admin` / `club_roster_insert_by_coach` | INSERT | (no `USING`, insert-only checks) |
| `club_roster_update_by_admin` | UPDATE | Caller must be a `club_admins` row with `role IN ('admin','moderator')` for that `club_id` |

**The write side is already correctly scoped to admins/coaches.** Only the
read side has the `USING (true)` gap — same shape as `profiles`, smaller
fix surface.

## Affected fields

21 columns. Sensitive: `phone`, `date_of_birth`, `gender`, plus
operational-but-still-club-private fields (`fee_paid`, `fee_due_date`,
`is_trial`, `trial_start_date`/`trial_end_date`). `display_name`,
`category`, `squad_id`, `member_number` are more club-internal-directory
than personally sensitive, but still shouldn't be world-readable —
`club_roster` includes youth squad members (Aquasharks has both youth and
adult squads per CLAUDE.md), which raises the bar versus `profiles` (adult
members only, self-registered).

## Row count

**962 total rows, 925 marked `is_active`.** Larger than `profiles`' 645 —
`club_roster` includes both linked (has `user_id`, an app account exists)
and unlinked (imported swimmer records, no account yet) members, so the
count doesn't map 1:1 to app users.

## Legitimate access (found via repo search, not fully line-traced like the profiles pass)

Referenced in `app-nav.js`, `join.html`, `club-admin.html` (heaviest use —
roster management, editing, squad assignment), `app-club.js`, `coach.html`
(attendance marking, roster entry creation), and `galas.html` (already
recommended RETIRE — see `docs/refactor/ROUTE_INVESTIGATION.md`, so its
`club_roster` dependency is moot). All of `club-admin.html` and `coach.html`
are already gated pages (per CLAUDE.md, these require a club admin/coach
login) — their *reads* are legitimate, but currently rely entirely on the
unsafe table-level policy plus page-level gating, exactly the same "no
data-layer enforcement" gap `admin.html` had for `profiles`.

**Key difference from `profiles`:** a roster row isn't "owned" by a single
auth user the way a profile is — many rows have no `user_id` at all
(unlinked/imported). "Own-row" (`auth.uid() = user_id`) doesn't cover the
common case. The right model is closer to **club-membership-scoped read**:
a club's own admins/coaches can read their full roster (mirrors
`is_club_manager()`); a linked member can plausibly see their own row and
maybe teammates' names (not decided here — needs a product decision on how
much roster visibility regular members should have, which `profiles` never
had to answer since profile visibility was purely self-scoped).

## Proposed RLS (outline, not final SQL)

1. `DROP POLICY "Public can read club_roster"` (remove the `USING (true)` gap).
2. New `club_roster_select_own` — `USING (auth.uid() = user_id)` for members who are linked to their own roster row.
3. New `club_roster_select_managers` — `USING (is_club_manager(club_id))`, reusing the existing function, for admins/coaches to see their full club's roster (covers `club-admin.html`/`coach.html`'s legitimate need).
4. **Open product question, not a technical one:** should ordinary linked members see *other* members' roster entries (e.g. a squad list with names, for team spirit) with sensitive fields (phone/DOB/gender/fee status) stripped? If yes, a `club_roster_public` view (mirroring `public_profiles`) exposing only `id, display_name, category, squad_id` would be the shape — needs your input before drafting, same as the "should `public_profiles` include `avatar_url`" open question wasn't decided unilaterally for `profiles`.

## Migration outline (file not yet created)

Would follow the identical MIGRATIONS.md template + pattern as
`sql/2026-07-19_fix-profiles-rls.sql`: safety block, pre-checks (confirm
`USING (true)` still present, row count ~962, target policies don't
already exist), `DROP`/`CREATE POLICY` in a transaction, optional new view,
post-checks, explicit (discouraged) rollback. Proposed filename:
`sql/YYYY-MM-DD_fix-club-roster-rls.sql` (dated when actually drafted, not
today, since it isn't written yet).

## Expected application impact

Once fixed, `club-admin.html` and `coach.html` reads should be **unaffected**
in practice — both are already used exclusively by authenticated club
admins/coaches, who would be covered by `club_roster_select_managers`. The
main app's "my club" widgets (`app-nav.js`, `app-club.js`) and `join.html`'s
onboarding flow need their exact `.eq()`/`.in()` filters checked the same
way the `profiles` dependency matrix was built, before any policy change —
**not done in this pass**, flagged as the first step of the actual
remediation work whenever it's approved to proceed.
