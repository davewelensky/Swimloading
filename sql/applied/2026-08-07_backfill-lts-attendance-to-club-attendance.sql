-- ================================================================
-- SwimLoading — Migration Template
-- Copy this header into EVERY new migration file.
-- The safety block hard-fails if you are in the wrong project.
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
-- Migration: 2026-08-07_backfill-lts-attendance-to-club-attendance.sql
-- Process:   see MIGRATIONS.md — no section below may be left empty
-- ================================================================

-- Purpose:
--   Backfill club_attendance for the LTS marks (Ellen/Kaisea, Aquasharks
--   "Learn to Swim & Stroke") that coach.html's markLTSSlot() wrote to
--   club_lts_attendance between 30 Jul and 6 Aug 2026, before the same-day
--   fix (commit e390b7d) started mirroring new marks into club_attendance
--   too. club_attendance is what every admin-facing view actually reads
--   (Attendance tab, Weekly Report, session cards) — without this backfill
--   that week of real, correct coach marks stays invisible to Britt.

-- Requested by:
--   Dave (on Britt's behalf, Aquasharks) — "Kaisea and Ellen are marking
--   attendance but I'm not seeing it"

-- ----------------------------------------------------------------
-- PRE-CHECKS — run on the READ-ONLY connection BEFORE applying.
-- Must include affected-row counts for any UPDATE/DELETE.
-- ----------------------------------------------------------------
-- Marks with no matching club_attendance row yet:
-- SELECT count(*) FROM club_lts_attendance la
-- WHERE la.session_date >= '2026-07-30'
--   AND NOT EXISTS (
--     SELECT 1 FROM club_sessions cs JOIN club_attendance ca
--       ON ca.session_id = cs.id AND ca.roster_id = la.roster_id
--     WHERE cs.session_date = la.session_date
--       AND cs.squad_id = (SELECT squad_id FROM club_squad_sessions WHERE id = la.squad_session_id)
--   );
-- -- expect: 55
--
-- Distinct (date, coach) session instances that will be created if missing:
-- SELECT la.session_date, css.coach_name, count(*) FROM club_lts_attendance la
-- JOIN club_squad_sessions css ON css.id = la.squad_session_id
-- WHERE la.session_date >= '2026-07-30'
-- GROUP BY 1,2 ORDER BY 1;
-- -- expect: 10 rows (Ellen/Kaisea, 30 Jul-6 Aug)

-- ----------------------------------------------------------------
-- BACKUP — required before any DELETE / UPDATE / DROP / TRUNCATE.
-- ----------------------------------------------------------------
-- Pure INSERT (no existing rows touched, no UPDATE/DELETE) — no backup table
-- needed. Idempotent: ON CONFLICT DO NOTHING on club_attendance, and the
-- club_sessions insert is guarded by NOT EXISTS, so re-running is a no-op.

-- ----------------------------------------------------------------
-- MIGRATION — applied only after Dave types "apply".
-- ----------------------------------------------------------------
BEGIN;

-- Step 1: create any missing club_sessions rows for the (date, squad, start_time,
-- coach) combos this gap needs.
INSERT INTO club_sessions (club_id, session_date, squad_id, session_type, start_time, coach_name, notes)
SELECT DISTINCT
  sq.club_id,
  la.session_date,
  css.squad_id,
  sq.name,
  css.start_time,
  css.coach_name,
  'Backfilled from club_lts_attendance — coach/admin attendance bridge gap, fixed 7 Aug 2026'
FROM club_lts_attendance la
JOIN club_squad_sessions css ON css.id = la.squad_session_id
JOIN club_squads sq ON sq.id = css.squad_id
WHERE la.session_date >= '2026-07-30'
  AND NOT EXISTS (
    SELECT 1 FROM club_sessions cs
    WHERE cs.session_date = la.session_date
      AND cs.squad_id = css.squad_id
      AND cs.start_time = css.start_time
      AND cs.coach_name = css.coach_name
  );

-- Step 2: insert the attendance marks themselves, now that a matching
-- club_sessions row is guaranteed to exist.
INSERT INTO club_attendance (session_id, roster_id, status)
SELECT
  cs.id,
  la.roster_id,
  CASE WHEN la.attended THEN 'present' ELSE 'away' END
FROM club_lts_attendance la
JOIN club_squad_sessions css ON css.id = la.squad_session_id
JOIN club_sessions cs
  ON cs.session_date = la.session_date
 AND cs.squad_id     = css.squad_id
 AND cs.start_time   = css.start_time
 AND cs.coach_name   = css.coach_name
WHERE la.session_date >= '2026-07-30'
ON CONFLICT (session_id, roster_id) DO NOTHING;

COMMIT;

-- ----------------------------------------------------------------
-- ROLLBACK — exact SQL to undo, or state:
-- "irreversible — restore from _bak_YYYYMMDD_tablename"
-- ----------------------------------------------------------------
-- DELETE FROM club_attendance ca USING club_sessions cs
--   WHERE ca.session_id = cs.id AND cs.notes = 'Backfilled from club_lts_attendance — coach/admin attendance bridge gap, fixed 7 Aug 2026';
-- DELETE FROM club_sessions
--   WHERE notes = 'Backfilled from club_lts_attendance — coach/admin attendance bridge gap, fixed 7 Aug 2026';

-- ----------------------------------------------------------------
-- VERIFY — run on the READ-ONLY connection AFTER applying.
-- State the expected result next to each query.
-- ----------------------------------------------------------------
-- SELECT count(*) FROM club_lts_attendance la
-- WHERE la.session_date >= '2026-07-30'
--   AND NOT EXISTS (
--     SELECT 1 FROM club_sessions cs JOIN club_attendance ca
--       ON ca.session_id = cs.id AND ca.roster_id = la.roster_id
--     WHERE cs.session_date = la.session_date
--       AND cs.squad_id = (SELECT squad_id FROM club_squad_sessions WHERE id = la.squad_session_id)
--   );
-- -- expect: 0
