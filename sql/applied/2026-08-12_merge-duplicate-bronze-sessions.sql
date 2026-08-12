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
-- Migration: 2026-08-12_merge-duplicate-bronze-sessions.sql
-- Process:   see MIGRATIONS.md
-- ================================================================

-- Purpose:
--   Merge duplicate club_sessions rows for Aquasharks Bronze Squad on
--   3 Aug and 7 Aug 2026, created by the coach_name-exact-match session
--   fragmentation bug fixed in commit 1d5a586 (Noah Arelisky covering
--   Tarryn's slot got a second, empty club_sessions row under his own
--   name instead of joining hers). His real marks were never lost —
--   they're already correctly attached to the "Tarryn"-named rows; this
--   migration just removes the empty duplicate shells and folds the one
--   extra 1-mark "Tarryn" row on Aug 3 into the canonical row so each
--   date has exactly one club_sessions row for Bronze Squad, matching
--   every other squad/date.
--
--   Coach attribution is left as-is (coach_name stays "Tarryn" on both
--   surviving rows) — this is a pure de-duplication, not a re-attribution
--   of who actually ran the session. Flag if you'd rather the merged
--   rows show "Noah Arelisky" instead.

-- Requested by:
--   Dave (relaying Britt/Tarryn — Noah's Bronze Squad marks looked lost)

-- ----------------------------------------------------------------
-- PRE-CHECKS — run on the READ-ONLY connection BEFORE applying.
-- ----------------------------------------------------------------
-- Current state (verified 12 Aug 2026):
--   Aug 3, Bronze Squad, 15:30 — 3 rows for one slot:
--     ab3371cd-bfa4-4130-813c-71cba265881b  Noah Arelisky   0 marks  (empty — DELETE)
--     12c5493d-66ae-434f-9608-f59f57a4ddf0  Tarryn          5 marks  (CANONICAL — keep)
--     d1bd9210-dbc9-4b38-bd0e-3c69c1df2bc3  Tarryn          1 mark   (roster_id 510f95de-a016-4667-b58b-413bdf299c5f, status no_contact — REASSIGN then DELETE)
--   Aug 7, Bronze Squad, 14:45 — 2 rows for one slot:
--     d46114e7-b25f-4f49-9271-be8cfbd11bcf  Noah Arelisky   0 marks  (empty — DELETE)
--     8e728728-03de-49f7-9ee5-fc9acda6854d  Tarryn          5 marks  (CANONICAL — keep)
--
-- Verified before writing this migration:
--   * No roster_id overlap between 12c5493d and d1bd9210's attendance rows
--     (5 + 1 = 6 distinct swimmers after merge — reassign is conflict-free).
--   * No other table references any of these 5 club_sessions ids:
--       club_group_rsvps.session_id      — 0 rows
--       club_session_assignments.session_id — 0 rows (this table's session_id
--         actually points at club_squad_sessions templates, not club_sessions
--         instances, but checked directly against these ids anyway)
--
-- SELECT cs.id, cs.session_date, cs.coach_name,
--        (select count(*) from club_attendance ca where ca.session_id = cs.id) as marks
-- FROM club_sessions cs
-- JOIN club_squads sq ON sq.id = cs.squad_id
-- WHERE sq.name = 'Bronze Squad' AND cs.session_date IN ('2026-08-03','2026-08-07');
-- -- expect: exactly the 5 rows listed above

-- ----------------------------------------------------------------
-- BACKUP — required before any DELETE / UPDATE.
-- ----------------------------------------------------------------
CREATE TABLE _bak_20260812_club_sessions_bronze_dup AS
SELECT * FROM club_sessions WHERE id IN (
  'ab3371cd-bfa4-4130-813c-71cba265881b',
  '12c5493d-66ae-434f-9608-f59f57a4ddf0',
  'd1bd9210-dbc9-4b38-bd0e-3c69c1df2bc3',
  'd46114e7-b25f-4f49-9271-be8cfbd11bcf',
  '8e728728-03de-49f7-9ee5-fc9acda6854d'
);

CREATE TABLE _bak_20260812_club_attendance_bronze_dup AS
SELECT * FROM club_attendance WHERE session_id IN (
  'ab3371cd-bfa4-4130-813c-71cba265881b',
  '12c5493d-66ae-434f-9608-f59f57a4ddf0',
  'd1bd9210-dbc9-4b38-bd0e-3c69c1df2bc3',
  'd46114e7-b25f-4f49-9271-be8cfbd11bcf',
  '8e728728-03de-49f7-9ee5-fc9acda6854d'
);

-- ----------------------------------------------------------------
-- MIGRATION — applied only after Dave types "apply".
-- ----------------------------------------------------------------
BEGIN;

-- Fold the Aug 3 stray 1-mark "Tarryn" row into the canonical 5-mark row.
UPDATE club_attendance
SET session_id = '12c5493d-66ae-434f-9608-f59f57a4ddf0'
WHERE session_id = 'd1bd9210-dbc9-4b38-bd0e-3c69c1df2bc3';

-- Remove the now-empty duplicate/fragment club_sessions rows.
DELETE FROM club_sessions WHERE id IN (
  'ab3371cd-bfa4-4130-813c-71cba265881b',  -- Aug 3, Noah, empty
  'd1bd9210-dbc9-4b38-bd0e-3c69c1df2bc3',  -- Aug 3, Tarryn, marks just moved out
  'd46114e7-b25f-4f49-9271-be8cfbd11bcf'   -- Aug 7, Noah, empty
);

COMMIT;

-- ----------------------------------------------------------------
-- ROLLBACK
-- ----------------------------------------------------------------
-- Restore from backups:
--   INSERT INTO club_sessions SELECT * FROM _bak_20260812_club_sessions_bronze_dup;
--   -- club_attendance rows for d1bd9210 were moved, not deleted — restore their
--   -- original session_id from the backup:
--   UPDATE club_attendance ca
--   SET session_id = bak.session_id
--   FROM _bak_20260812_club_attendance_bronze_dup bak
--   WHERE ca.id = bak.id AND bak.session_id = 'd1bd9210-dbc9-4b38-bd0e-3c69c1df2bc3';

-- ----------------------------------------------------------------
-- VERIFY — run on the READ-ONLY connection AFTER applying.
-- ----------------------------------------------------------------
-- SELECT cs.id, cs.session_date, cs.coach_name,
--        (select count(*) from club_attendance ca where ca.session_id = cs.id) as marks
-- FROM club_sessions cs
-- JOIN club_squads sq ON sq.id = cs.squad_id
-- WHERE sq.name = 'Bronze Squad' AND cs.session_date IN ('2026-08-03','2026-08-07');
-- -- expect: exactly 2 rows —
-- --   12c5493d..., 2026-08-03, Tarryn, 6 marks
-- --   8e728728..., 2026-08-07, Tarryn, 5 marks
