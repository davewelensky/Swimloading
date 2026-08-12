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
-- Migration: 2026-08-12_delete-my-temp-log-rpc.sql
-- Process:   see MIGRATIONS.md — no section below may be left empty
-- ================================================================

-- Purpose:
--   One atomic, safe path for a swimmer to delete their own temp log:
--   delete_my_temp_log(p_log_id) removes the log AND voids any monthly
--   challenge points event that log earned (june_challenge_events has no
--   user DELETE policy — by design — so this must be SECURITY DEFINER).
--   Without the void, a swimmer could log (+10 pts), delete, re-log (+10)
--   to farm points, since the 1-hour duplicate check only sees live rows.
--   eo active days + UK location credits already cascade via FK
--   (2026-08-12_challenge-log-fk-cascade.sql).

-- Requested by:
--   Dave, 2026-08-12 — "Edit/Delete on recent logs" feature (spec approved).

-- ----------------------------------------------------------------
-- PRE-CHECKS — run on the READ-ONLY connection BEFORE applying.
-- Must include affected-row counts for any UPDATE/DELETE.
-- ----------------------------------------------------------------
-- SELECT count(*) FROM pg_proc WHERE proname = 'delete_my_temp_log';  -- expect: 0
-- (Function creation only — zero existing rows touched by applying this.)

-- ----------------------------------------------------------------
-- BACKUP — required before any DELETE / UPDATE / DROP / TRUNCATE.
-- ----------------------------------------------------------------
-- CREATE FUNCTION only — no data modified by the migration itself.

-- ----------------------------------------------------------------
-- MIGRATION — applied only after Dave types "apply".
-- ----------------------------------------------------------------
BEGIN;

CREATE OR REPLACE FUNCTION delete_my_temp_log(p_log_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owner uuid;
  v_points_voided integer := 0;
BEGIN
  -- Ownership check — the caller may only delete their own log.
  SELECT user_id INTO v_owner FROM temp_logs WHERE id = p_log_id;
  IF v_owner IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'log_not_found');
  END IF;
  IF v_owner <> auth.uid() THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_your_log');
  END IF;

  -- Void the monthly-challenge points this log earned (ref_id stores the
  -- temp_logs id as text). Scoped to the caller's own events only.
  DELETE FROM june_challenge_events
  WHERE user_id = auth.uid() AND ref_id = p_log_id::text;
  GET DIAGNOSTICS v_points_voided = ROW_COUNT;

  -- Delete the log. FK cascades remove the eo active day and UK location
  -- credit derived from it.
  DELETE FROM temp_logs WHERE id = p_log_id AND user_id = auth.uid();

  RETURN jsonb_build_object('ok', true, 'points_voided', v_points_voided);
END;
$$;

REVOKE ALL ON FUNCTION delete_my_temp_log(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION delete_my_temp_log(uuid) TO authenticated;

COMMIT;

-- ----------------------------------------------------------------
-- ROLLBACK — exact SQL to undo, or state:
-- "irreversible — restore from _bak_YYYYMMDD_tablename"
-- ----------------------------------------------------------------
-- DROP FUNCTION IF EXISTS delete_my_temp_log(uuid);
-- (App falls back to direct .delete() which RLS already allows — minus the
-- points void.)

-- ----------------------------------------------------------------
-- VERIFY — run on the READ-ONLY connection AFTER applying.
-- State the expected result next to each query.
-- ----------------------------------------------------------------
-- SELECT proname, prosecdef FROM pg_proc WHERE proname = 'delete_my_temp_log';
--   -- expect: 1 row, prosecdef = true
