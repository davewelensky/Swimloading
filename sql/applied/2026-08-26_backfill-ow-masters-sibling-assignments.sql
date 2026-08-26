-- ================================================================
-- SwimLoading — Migration Template
-- ================================================================

-- ⚠️  SAFETY CHECK
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM _project_identity
    WHERE key = 'project_name' AND value = 'swimloading'
  ) THEN
    RAISE EXCEPTION 'WRONG PROJECT — MIGRATION ABORTED';
  END IF;
END $$;

-- ================================================================
-- Migration: 2026-08-26_backfill-ow-masters-sibling-assignments.sql
-- ================================================================

-- Purpose:
--   Dave/Britt: the 3 OW Masters squads (6-7/7-8/8-9) always run the same
--   set together, but K8's calendar history only ever assigned it to the
--   06:00 Group (now OW Masters 6-7) after the first day (8 June — the
--   one day all 3 got it). Backfills the 21 missing historical dates onto
--   OW Masters 7-8 and 8-9 too, copying set_id/session_date/session_slot/
--   delivering_coach from OW Masters 6-7's existing rows. Uses
--   ON CONFLICT DO NOTHING on (squad_id, session_date, session_slot) so
--   the 8 June date (already present on all 3) is skipped automatically.

-- Requested by:
--   Dave/Britt, 26 Aug 2026.

-- ----------------------------------------------------------------
-- BACKUP — none needed, this only INSERTs new rows, never touches
-- existing ones (ON CONFLICT DO NOTHING).
-- ----------------------------------------------------------------

-- ----------------------------------------------------------------
-- MIGRATION — applied only after Dave types "apply".
-- ----------------------------------------------------------------
BEGIN;

INSERT INTO club_set_assignments (club_id, set_id, squad_id, session_date, session_slot, delivering_coach, created_by)
SELECT club_id, set_id, '5d78be26-cddc-46e8-9d97-69b1d90cb880'::uuid, session_date, session_slot, delivering_coach, created_by
FROM club_set_assignments
WHERE club_id = '385e2c9d-b32e-47d1-bb1d-1e042523de23'::uuid
  AND squad_id = '993bf5d1-4980-4eaf-8b36-a68b434a6d09'::uuid
ON CONFLICT (squad_id, session_date, session_slot) DO NOTHING;

INSERT INTO club_set_assignments (club_id, set_id, squad_id, session_date, session_slot, delivering_coach, created_by)
SELECT club_id, set_id, 'f807af8e-fb21-41a0-ad46-802da504a214'::uuid, session_date, session_slot, delivering_coach, created_by
FROM club_set_assignments
WHERE club_id = '385e2c9d-b32e-47d1-bb1d-1e042523de23'::uuid
  AND squad_id = '993bf5d1-4980-4eaf-8b36-a68b434a6d09'::uuid
ON CONFLICT (squad_id, session_date, session_slot) DO NOTHING;

COMMIT;

-- ----------------------------------------------------------------
-- ROLLBACK
-- ----------------------------------------------------------------
-- DELETE FROM club_set_assignments
-- WHERE squad_id IN ('5d78be26-cddc-46e8-9d97-69b1d90cb880','f807af8e-fb21-41a0-ad46-802da504a214')
--   AND session_date < '2026-08-26' AND session_date > '2026-06-08';

-- ----------------------------------------------------------------
-- VERIFY
-- ----------------------------------------------------------------
-- SELECT squad_id, count(*) FROM club_set_assignments
-- WHERE club_id = '385e2c9d-b32e-47d1-bb1d-1e042523de23'
--   AND squad_id IN ('993bf5d1-4980-4eaf-8b36-a68b434a6d09','5d78be26-cddc-46e8-9d97-69b1d90cb880','f807af8e-fb21-41a0-ad46-802da504a214')
-- GROUP BY squad_id;
-- -- expect: all three = 22
