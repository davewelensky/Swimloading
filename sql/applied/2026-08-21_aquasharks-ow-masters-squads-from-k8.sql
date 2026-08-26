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
-- Migration: 2026-08-21_aquasharks-ow-masters-squads-from-k8.sql
-- Process:   see MIGRATIONS.md — no section below may be left empty
-- ================================================================

-- Purpose:
--   Britt is combining K8 Coaching into Aquasharks: add three OW Masters
--   squads (6-7, 7-8, 8-9) to Aquasharks and recreate K8's nine Mon/Wed/Fri
--   timetable sessions under them. Purely additive — K8's own squads,
--   sessions, roster and attendance are NOT touched by this migration.

-- Requested by:
--   Britt (via Dave, 21 Aug 2026) — for Aquasharks (aqua-sharks-atlantic)

-- ----------------------------------------------------------------
-- PRE-CHECKS — run on the READ-ONLY connection BEFORE applying.
-- Must include affected-row counts for any UPDATE/DELETE.
-- ----------------------------------------------------------------
-- 1. No Aquasharks squad already named like these (expect: 0 rows)
-- SELECT name FROM club_squads
-- WHERE club_id = '385e2c9d-b32e-47d1-bb1d-1e042523de23'
--   AND name IN ('OW Masters 6-7','OW Masters 7-8','OW Masters 8-9');
--
-- 2. Source K8 sessions to mirror (expect: 9 rows — 06/07/08 groups × Mon/Wed/Fri,
--    each 1h, coach Britt, no capacity/notes/multisquad)
-- SELECT sq.name, ss.day_of_week, ss.start_time, ss.end_time, ss.coach_name
-- FROM club_squad_sessions ss JOIN club_squads sq ON sq.id = ss.squad_id
-- WHERE sq.club_id = 'de64faab-c3d2-4997-a6bb-904ab989650c'
--   AND sq.type = 'masters' AND ss.is_active
-- ORDER BY sq.sort_order, ss.day_of_week;
--
-- 3. Aquasharks sort_order 8-10 free (expect: 0 rows)
-- SELECT name, sort_order FROM club_squads
-- WHERE club_id = '385e2c9d-b32e-47d1-bb1d-1e042523de23' AND sort_order BETWEEN 8 AND 10;

-- ----------------------------------------------------------------
-- BACKUP — required before any DELETE / UPDATE / DROP / TRUNCATE.
-- ----------------------------------------------------------------
-- Not required — INSERT-only migration, no destructive statements.

-- ----------------------------------------------------------------
-- MIGRATION — applied only after Dave types "apply".
-- ----------------------------------------------------------------
BEGIN;

-- Three OW Masters squads for Aquasharks, mirroring K8's masters groups
-- (max_members carried over from K8: 06:00=25, 07:00=30, 08:00=30).
-- sort_order 8-10 places them after the existing core squads (1-7),
-- before the private/nippers block (100+).
INSERT INTO club_squads (club_id, name, type, sort_order, max_members, is_active) VALUES
  ('385e2c9d-b32e-47d1-bb1d-1e042523de23', 'OW Masters 6-7', 'masters',  8, 25, true),
  ('385e2c9d-b32e-47d1-bb1d-1e042523de23', 'OW Masters 7-8', 'masters',  9, 30, true),
  ('385e2c9d-b32e-47d1-bb1d-1e042523de23', 'OW Masters 8-9', 'masters', 10, 30, true);

-- Nine sessions: each squad Mon(1)/Wed(3)/Fri(5), one hour, coach Britt —
-- exact mirror of K8's club_squad_sessions rows (day_of_week 0=Sun…6=Sat).
INSERT INTO club_squad_sessions (squad_id, day_of_week, start_time, end_time, coach_name, is_active)
SELECT s.id, d.dow,
       (s.name_start || ':00:00')::time,
       (s.name_end   || ':00:00')::time,
       'Britt', true
FROM (
  SELECT id, '06' AS name_start, '07' AS name_end FROM club_squads
    WHERE club_id = '385e2c9d-b32e-47d1-bb1d-1e042523de23' AND name = 'OW Masters 6-7'
  UNION ALL
  SELECT id, '07', '08' FROM club_squads
    WHERE club_id = '385e2c9d-b32e-47d1-bb1d-1e042523de23' AND name = 'OW Masters 7-8'
  UNION ALL
  SELECT id, '08', '09' FROM club_squads
    WHERE club_id = '385e2c9d-b32e-47d1-bb1d-1e042523de23' AND name = 'OW Masters 8-9'
) s
CROSS JOIN (VALUES (1), (3), (5)) AS d(dow);

COMMIT;

-- ----------------------------------------------------------------
-- ROLLBACK — exact SQL to undo, or state:
-- "irreversible — restore from _bak_YYYYMMDD_tablename"
-- ----------------------------------------------------------------
-- BEGIN;
-- DELETE FROM club_squad_sessions WHERE squad_id IN (
--   SELECT id FROM club_squads
--   WHERE club_id = '385e2c9d-b32e-47d1-bb1d-1e042523de23'
--     AND name IN ('OW Masters 6-7','OW Masters 7-8','OW Masters 8-9'));
-- DELETE FROM club_squads
-- WHERE club_id = '385e2c9d-b32e-47d1-bb1d-1e042523de23'
--   AND name IN ('OW Masters 6-7','OW Masters 7-8','OW Masters 8-9');
-- COMMIT;

-- ----------------------------------------------------------------
-- VERIFY — run on the READ-ONLY connection AFTER applying.
-- State the expected result next to each query.
-- ----------------------------------------------------------------
-- SELECT name, type, sort_order, max_members FROM club_squads
-- WHERE club_id = '385e2c9d-b32e-47d1-bb1d-1e042523de23' AND sort_order BETWEEN 8 AND 10
-- ORDER BY sort_order;
--   -- expect: 3 rows — OW Masters 6-7 (masters, 8, 25), 7-8 (masters, 9, 30), 8-9 (masters, 10, 30)
--
-- SELECT sq.name, ss.day_of_week, ss.start_time, ss.end_time, ss.coach_name
-- FROM club_squad_sessions ss JOIN club_squads sq ON sq.id = ss.squad_id
-- WHERE sq.club_id = '385e2c9d-b32e-47d1-bb1d-1e042523de23' AND sq.name LIKE 'OW Masters %'
-- ORDER BY sq.sort_order, ss.day_of_week;
--   -- expect: 9 rows — each squad on days 1/3/5, 06-07/07-08/08-09, coach Britt
--
-- K8 untouched (expect: 9 — same as pre-check 2)
-- SELECT count(*) FROM club_squad_sessions ss JOIN club_squads sq ON sq.id = ss.squad_id
-- WHERE sq.club_id = 'de64faab-c3d2-4997-a6bb-904ab989650c' AND sq.type = 'masters' AND ss.is_active;
