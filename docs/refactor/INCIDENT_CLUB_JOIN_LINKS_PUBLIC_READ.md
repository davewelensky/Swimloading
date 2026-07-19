# Incident: `club_join_links.code` publicly readable, unauthenticated

## ✅ RESOLVED — 2026-07-19

- **App-code compatibility deployed:** commit `b1a1e6e`, Vercel deployment `2rMMP5TWPbE3w5oyDXhPip4P7aP1` — verified success, zero console errors across `/clubs`, `/join/<code>`, `/club-admin/duc`, both before and after the migration.
- **Migration applied:** `fix_club_join_links_rls` (via `supabase-admin` `apply_migration`), same session, immediately after compatibility code confirmed live.
- **Post-fix verification:** `scripts/test-club-join-links-rls.mjs --mode=production-safe` — 5/5 pass (up from 1/5 pre-fix). Live redemption flow tested end-to-end via session-simulated transaction (rolled back, zero real data changed) — valid code → `joined`, duplicate attempt → `already_member`, invalid code → `invalid_code`, exactly 1 membership + 1 audit row created.
- **Invite codes were technically exposed and could have enabled unauthorised enrolment.** Actual unauthorised joins are unconfirmed — see "Evidence of actual misuse" below.

---

## Exact unsafe policy

`"join_links_public_read"` — `FOR SELECT USING (true)`.

## Exposure mechanism

Same as `profiles`/`club_roster`: direct unauthenticated HTTP requests to
the Supabase PostgREST endpoint using the public `anon` key. Reachable
regardless of the application's own UI flow.

## Affected row count

**6 rows.**

## Whether active codes were enumerable

**Yes, confirmed.** All 6 rows were `is_active = true`, 0 expired, and the
full table (including `code`, `club_id`, `use_count`, `max_uses`,
`created_by`) was readable by anyone with only the public anon key —
no login, no club membership, no invitation required.

## Code entropy and storage assessment

**Severe.** Code lengths ranged 3–20 characters across the 6 rows, no
consistent format — a 3-character code is trivially brute-forceable even
without reading the table at all. Root cause traced to
`club-admin.html`'s `generateNewLink()`, which used
`Math.random().toString(36).slice(2,7)` (not cryptographically secure,
combined with a predictable public club-slug prefix). **Fixed for future
codes** (commit `b1a1e6e`) — a proper `crypto.getRandomValues()`-based
generator, 10 characters over a 32-symbol alphabet. **The 6 existing
codes were NOT regenerated in this migration** — see "Decisions
required" below; this was a deliberate scope decision (regenerating live
codes invalidates any already-distributed link), not an oversight.

Storage remains plaintext. Migrating to hashed storage was assessed and
deliberately deferred — see `CLUB_JOIN_LINKS_RLS_REMEDIATION.md` and
"Residual risk" below for why (club admins currently need to view/re-copy
their club's live code from the admin UI; hash-only storage would require
a show-once-at-creation redesign, out of scope for this pass). At
minimum, direct table access is now fully blocked, which is the primary
mitigation.

## Potential impact

A harvested code could have been used to self-enrol in any club,
including Aquasharks (youth squads), bypassing whatever informal vetting
a club intends for its join flow. This is an access-control risk, not
only a data-privacy one.

## Migration time

Applied this session, 2026-07-19, immediately after the compatibility
deployment (`b1a1e6e`) was verified live and all pre-apply checks passed
(unsafe policy present, 6 rows, target objects didn't already exist,
write-side policy count unchanged at 4).

## Compatibility deployment SHA

`b1a1e6e` → Vercel `2rMMP5TWPbE3w5oyDXhPip4P7aP1`.

## Policies removed

`"join_links_public_read"` (the only unrestricted policy).

## Policies created

`"join_links_select_admin_organiser"` (reuses `is_club_admin_or_organiser()`,
same function used for `club_roster`, chosen over the schema's other,
slightly weaker `is_club_admin()` already used by this table's untouched
write-side policies — flagged as a residual inconsistency, not resolved
in this pass). Write-side policies (3 individual + 1 `ALL`) intentionally
untouched — already correctly scoped.

## RPCs created

`validate_join_code(p_code)` (anon-callable by design — confirmed via
investigation that `join.html` checks a code before the login screen),
`get_club_active_join_code(p_club_id)` (anon-callable by design — the
public "Join this club" banner on `clubs.html`), `redeem_club_join_code(p_code, p_roster_id)`
(authenticated-only, atomic membership creation + validation + audit).
New `club_join_redemptions` table for durable redemption audit.

## Verification results

- Metadata: unsafe policy count 0, exactly the expected SELECT policy, write-policy count unchanged at 4, RLS enabled, audit table + all 3 RPCs exist.
- Live: `scripts/test-club-join-links-rls.mjs` 5/5 — anon blocked on direct SELECT, count enumeration; `validate_join_code` correctly rejects a bogus probe without leaking anything; `redeem_club_join_code` rejects anon outright (401, not the 200-with-empty gap from the first incident — this migration proactively `REVOKE`d `FROM PUBLIC` from the start); `get_club_active_join_code` works for a real club (by-design public).
- Live redemption flow (session-simulated, transaction rolled back, zero real data changed): valid code → `joined`, immediate re-attempt by the same user → `already_member`, bogus code → `invalid_code`. Exactly 1 `club_members` row and 1 `club_join_redemptions` row created within the transaction, confirmed by re-checking as an unrestricted role before rollback.
- Club-admin scope: a DUC-only admin sees DUC's 2 links, 0 Aquasharks links.
- Application: `/clubs`, `/join/<code>`, `/club-admin/duc` all reload clean pre- and post-migration — zero console errors.
- `expired`/`exhausted`/`roster_mismatch` branches verified via code review (straightforward independent conditional checks in the function body), not separately live-executed — the three branches that were live-tested (valid/duplicate/invalid) already exercise the same lookup-and-branch structure.

## Evidence of actual unauthorised access

**None found or claimed.** Consistent with the `profiles` and
`club_roster` incidents: the exposure existed and unauthenticated access
was technically possible (demonstrated by this session's own authorised
verification, using count/status checks only — no code was ever printed
or exfiltrated). Whether a real unauthorised join occurred using a
harvested code is unknown without Supabase access-log review, which
remains outstanding for all three incidents.

## Residual risk

- **The 6 existing codes remain live and low-entropy** (3–20 chars). Regenerating them is recommended but deliberately not done in this pass — needs your confirmation (see Decisions required).
- **`is_club_admin()` vs `is_club_admin_or_organiser()`** — two different admin-check functions exist in the schema with slightly different semantics (the former omits the `club_admins` table fallback and the `is_active` requirement). Not reconciled in this pass; flagged as a residual schema inconsistency worth its own look.
- **Codes remain stored in plaintext**, not hashed — deferred, see above.
- Same public-repo fact as the prior two incidents — this report is published after the fix is live, not before.

## Decisions required

1. Whether to regenerate the 6 existing join codes now that high-entropy generation exists — trades off invalidating any currently-distributed link against closing the weak-entropy gap for those specific codes.
2. Whether to reconcile `is_club_admin()` and `is_club_admin_or_organiser()` into one function.
3. Whether hashed code storage is worth a dedicated follow-up (requires a show-once-at-creation UX change in club-admin.html).
