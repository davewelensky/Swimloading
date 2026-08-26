-- ================================================================
-- SwimLoading — Migration Template
-- ================================================================

-- ⚠️  SAFETY CHECK — runs first, aborts everything if wrong project
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM _project_identity
    WHERE key = 'project_name' AND value = 'swimloading'
  ) THEN
    RAISE EXCEPTION
      E'\n\n'
      '╔══════════════════════════════════════════════════════════╗\n'
      '║  WRONG PROJECT — MIGRATION ABORTED                       ║\n'
      '║                                                          ║\n'
      '║  This migration is for: SwimLoading                     ║\n'
      '║  Expected project ref:  szgkzuswelntnevobnoh            ║\n'
      '║                                                          ║\n'
      '║  You are connected to a DIFFERENT Supabase project.     ║\n'
      '║  No changes have been made. Check your browser URL.     ║\n'
      '╚══════════════════════════════════════════════════════════╝'
    USING HINT = 'Check the project ref in your Supabase dashboard URL';
  END IF;
  RAISE NOTICE '✅ Project identity confirmed: swimloading (szgkzuswelntnevobnoh)';
END $$;

-- ================================================================
-- Migration: 2026-08-26_migrate-k8-swimmers-to-aquasharks.sql
-- Process:   see MIGRATIONS.md
-- ================================================================

-- Purpose:
--   Britt requested merging K8 Coaching into Aquasharks so she doesn't
--   have to switch between two club-admin instances. A prior migration
--   (2026-08-21_aquasharks-ow-masters-squads-from-k8.sql) already
--   scaffolded 3 new Aquasharks squads (OW Masters 6-7/7-8/8-9) mirroring
--   K8's 06:00/07:00/08:00 Groups, with their Mon/Wed/Fri session
--   templates — but data-only, zero swimmers moved yet.
--
--   This migration does the actual move:
--     * All 108 club_roster rows (98 active + 10 inactive/historical)
--       under K8, across all 4 of its squads, move to Aquasharks —
--       club_id changes, squad_id remaps to the matching Aquasharks squad.
--     * "Senior Squad (ASA)" (21 active + 2 inactive) merges into
--       Aquasharks' REAL, pre-existing "Senior Squad" — per Dave: these
--       are the same swimmers (the school's senior squad), not a
--       separate group. Confirmed via dry-run: no session-date collision
--       between ASA's one historical session (5 Jun) and Aquasharks'
--       own Senior Squad history.
--     * K8's 54 club_sessions rows (669 attendance marks) for these 4
--       squads move too (club_id + squad_id remapped) — Dave asked to
--       migrate history, not leave it archived at K8. club_attendance
--       rows themselves need no change (they key off session_id/
--       roster_id, both preserved).
--     * K8's own 9 session templates + all 4 squads get is_active=false
--       (dormant, not deleted) — Britt keeps using Aquasharks going
--       forward, K8 stays structurally intact but unused.
--     * Feature flags (K8 has hasLeague/hasTempChallenge, Aquasharks
--       doesn't) are deliberately NOT touched — club-wide flags, out of
--       scope for this pass per Dave ("leave league etc for now").
--     * The K8 club record itself is left as-is (dormant), not archived.

-- Requested by:
--   Dave, relaying Britt (K8 admin + Aquasharks admin, same login)

-- ----------------------------------------------------------------
-- PRE-CHECKS — run on the READ-ONLY connection BEFORE applying.
-- ----------------------------------------------------------------
-- Verified before writing this migration:
--   * club_roster.club_id + member_number is UNIQUE — Aquasharks'
--     member_number range (0-313) overlaps K8's (1-108), so a plain
--     club_id swap would violate the constraint. Renumbering K8's rows
--     to 314+ (in original member_number order) avoids this.
--   * All 108 K8 roster rows have squad_id in exactly the 4 K8 squads
--     (no nulls, no other squads) — 1:1 mapping covers every row.
--   * 0 rows have secondary_squad_id set — no extra remap needed there.
--   * 0 parent_roster_links rows reference any K8 roster_id — no parent
--     portal cleanup needed despite Aquasharks having hasParentLanguage.
--   * 0 club_session_assignments rows reference any of the 4 K8 squads'
--     session templates — nothing orphaned by deactivating them.
--   * club_sessions has no unique constraint (PK only) — remapping
--     club_id/squad_id can't hit a DB-level conflict — but checked
--     manually anyway: ASA's one historical session (2026-06-05 06:00)
--     doesn't collide with any existing Aquasharks Senior Squad session
--     on that date. The 3 Masters squads' new squad_ids are brand new
--     (created 21 Aug, never used) — zero prior history to collide with.
--   * Aquasharks' real Senior Squad has max_members=23, 22 active today
--     — adding 21 more (43 total) needs the cap raised; bumping to 45.
--
-- SELECT count(*) FROM club_roster WHERE club_id = 'de64faab-c3d2-4997-a6bb-904ab989650c';
-- -- expect: 108
-- SELECT count(*) FROM club_sessions WHERE club_id = 'de64faab-c3d2-4997-a6bb-904ab989650c'
--   AND squad_id IN ('8e6e5a94-cfdb-4e8f-9b80-c4ee376a1565','f72db6ba-1f30-4c52-92cf-3c41fd1cf16d','552840c8-aa71-4c3b-a882-3cfb83f99a2e','25701c2d-33f0-47fc-875f-b3b18b1fa971');
-- -- expect: 54

-- ----------------------------------------------------------------
-- BACKUP — required before any DELETE / UPDATE.
-- ----------------------------------------------------------------
CREATE TABLE _bak_20260826_club_roster_k8 AS
SELECT * FROM club_roster WHERE club_id = 'de64faab-c3d2-4997-a6bb-904ab989650c';

CREATE TABLE _bak_20260826_club_sessions_k8 AS
SELECT * FROM club_sessions WHERE club_id = 'de64faab-c3d2-4997-a6bb-904ab989650c'
  AND squad_id IN ('8e6e5a94-cfdb-4e8f-9b80-c4ee376a1565','f72db6ba-1f30-4c52-92cf-3c41fd1cf16d','552840c8-aa71-4c3b-a882-3cfb83f99a2e','25701c2d-33f0-47fc-875f-b3b18b1fa971');

CREATE TABLE _bak_20260826_club_squad_sessions_k8 AS
SELECT * FROM club_squad_sessions
  WHERE squad_id IN ('8e6e5a94-cfdb-4e8f-9b80-c4ee376a1565','f72db6ba-1f30-4c52-92cf-3c41fd1cf16d','552840c8-aa71-4c3b-a882-3cfb83f99a2e','25701c2d-33f0-47fc-875f-b3b18b1fa971');

CREATE TABLE _bak_20260826_club_squads_k8 AS
SELECT * FROM club_squads
  WHERE id IN ('8e6e5a94-cfdb-4e8f-9b80-c4ee376a1565','f72db6ba-1f30-4c52-92cf-3c41fd1cf16d','552840c8-aa71-4c3b-a882-3cfb83f99a2e','25701c2d-33f0-47fc-875f-b3b18b1fa971');

CREATE TABLE _bak_20260826_club_squads_senior_cap AS
SELECT * FROM club_squads WHERE id = 'a1000001-0000-0000-0000-000000000007';

-- ----------------------------------------------------------------
-- MIGRATION — applied only after Dave types "apply".
-- ----------------------------------------------------------------
BEGIN;

-- 1. Move + renumber + remap all 108 K8 roster rows onto Aquasharks.
WITH renumbered AS (
  SELECT id, 313 + row_number() OVER (ORDER BY member_number) AS new_number
  FROM club_roster
  WHERE club_id = 'de64faab-c3d2-4997-a6bb-904ab989650c'
)
UPDATE club_roster r
SET
  club_id = '385e2c9d-b32e-47d1-bb1d-1e042523de23',
  member_number = renumbered.new_number,
  squad_id = CASE r.squad_id
    WHEN '8e6e5a94-cfdb-4e8f-9b80-c4ee376a1565' THEN '993bf5d1-4980-4eaf-8b36-a68b434a6d09'  -- 06:00 Group -> OW Masters 6-7
    WHEN 'f72db6ba-1f30-4c52-92cf-3c41fd1cf16d' THEN '5d78be26-cddc-46e8-9d97-69b1d90cb880'  -- 07:00 Group -> OW Masters 7-8
    WHEN '552840c8-aa71-4c3b-a882-3cfb83f99a2e' THEN 'f807af8e-fb21-41a0-ad46-802da504a214'  -- 08:00 Group -> OW Masters 8-9
    WHEN '25701c2d-33f0-47fc-875f-b3b18b1fa971' THEN 'a1000001-0000-0000-0000-000000000007'  -- Senior Squad (ASA) -> Aquasharks Senior Squad
  END
FROM renumbered
WHERE r.id = renumbered.id;

-- 2. Move + remap historical club_sessions (club_attendance follows via session_id, untouched).
UPDATE club_sessions cs
SET
  club_id = '385e2c9d-b32e-47d1-bb1d-1e042523de23',
  squad_id = CASE cs.squad_id
    WHEN '8e6e5a94-cfdb-4e8f-9b80-c4ee376a1565' THEN '993bf5d1-4980-4eaf-8b36-a68b434a6d09'
    WHEN 'f72db6ba-1f30-4c52-92cf-3c41fd1cf16d' THEN '5d78be26-cddc-46e8-9d97-69b1d90cb880'
    WHEN '552840c8-aa71-4c3b-a882-3cfb83f99a2e' THEN 'f807af8e-fb21-41a0-ad46-802da504a214'
    WHEN '25701c2d-33f0-47fc-875f-b3b18b1fa971' THEN 'a1000001-0000-0000-0000-000000000007'
  END
WHERE cs.club_id = 'de64faab-c3d2-4997-a6bb-904ab989650c'
  AND cs.squad_id IN ('8e6e5a94-cfdb-4e8f-9b80-c4ee376a1565','f72db6ba-1f30-4c52-92cf-3c41fd1cf16d','552840c8-aa71-4c3b-a882-3cfb83f99a2e','25701c2d-33f0-47fc-875f-b3b18b1fa971');

-- 3. Deactivate K8's own session templates for these squads (dormant, not deleted).
UPDATE club_squad_sessions
SET is_active = false
WHERE squad_id IN ('8e6e5a94-cfdb-4e8f-9b80-c4ee376a1565','f72db6ba-1f30-4c52-92cf-3c41fd1cf16d','552840c8-aa71-4c3b-a882-3cfb83f99a2e','25701c2d-33f0-47fc-875f-b3b18b1fa971');

-- 4. Deactivate the 4 K8 squads themselves (dormant, not deleted).
UPDATE club_squads
SET is_active = false
WHERE id IN ('8e6e5a94-cfdb-4e8f-9b80-c4ee376a1565','f72db6ba-1f30-4c52-92cf-3c41fd1cf16d','552840c8-aa71-4c3b-a882-3cfb83f99a2e','25701c2d-33f0-47fc-875f-b3b18b1fa971');

-- 5. Raise Aquasharks' Senior Squad capacity to fit the incoming 21 ASA swimmers (22+21=43).
UPDATE club_squads
SET max_members = 45
WHERE id = 'a1000001-0000-0000-0000-000000000007';

COMMIT;

-- ----------------------------------------------------------------
-- ROLLBACK
-- ----------------------------------------------------------------
-- UPDATE club_roster r SET club_id = bak.club_id, squad_id = bak.squad_id, member_number = bak.member_number
--   FROM _bak_20260826_club_roster_k8 bak WHERE r.id = bak.id;
-- UPDATE club_sessions cs SET club_id = bak.club_id, squad_id = bak.squad_id
--   FROM _bak_20260826_club_sessions_k8 bak WHERE cs.id = bak.id;
-- UPDATE club_squad_sessions css SET is_active = bak.is_active
--   FROM _bak_20260826_club_squad_sessions_k8 bak WHERE css.id = bak.id;
-- UPDATE club_squads sq SET is_active = bak.is_active, max_members = bak.max_members
--   FROM _bak_20260826_club_squads_k8 bak WHERE sq.id = bak.id;
-- UPDATE club_squads SET max_members = 23 WHERE id = 'a1000001-0000-0000-0000-000000000007';

-- ----------------------------------------------------------------
-- VERIFY — run on the READ-ONLY connection AFTER applying.
-- ----------------------------------------------------------------
-- SELECT count(*) FROM club_roster WHERE club_id = 'de64faab-c3d2-4997-a6bb-904ab989650c';
-- -- expect: 0
-- SELECT sq.name, count(r.id) FILTER (WHERE r.is_active) AS active
-- FROM club_squads sq LEFT JOIN club_roster r ON r.squad_id = sq.id
-- WHERE sq.id IN ('993bf5d1-4980-4eaf-8b36-a68b434a6d09','5d78be26-cddc-46e8-9d97-69b1d90cb880','f807af8e-fb21-41a0-ad46-802da504a214','a1000001-0000-0000-0000-000000000007')
-- GROUP BY sq.name;
-- -- expect: OW Masters 6-7=25, OW Masters 7-8=24, OW Masters 8-9=28, Senior Squad=43
-- SELECT count(*) FROM club_sessions WHERE club_id = 'de64faab-c3d2-4997-a6bb-904ab989650c';
-- -- expect: 0 (all moved)
