-- ================================================================
-- SwimLoading — Migration Template
-- ================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM _project_identity
    WHERE key = 'project_name' AND value = 'swimloading'
  ) THEN
    RAISE EXCEPTION 'WRONG PROJECT — MIGRATION ABORTED';
  END IF;
  RAISE NOTICE '✅ Project identity confirmed: swimloading';
END $$;

-- ================================================================
-- Migration: 2026-08-01_eo-challenge-activity-feed.sql
-- Process:   see MIGRATIONS.md
-- ================================================================

-- Purpose:
--   New read-only RPC for the eo SwimBETTER Board-tab section: a recent
--   activity feed (who just logged an active day) so the 3-month challenge
--   feels alive from day one, not just a lone progress bar. Additive only —
--   no schema change to existing tables, no data touched.

-- Requested by:
--   Dave, 1 Aug 2026 — "figure out how to showcase" the Board tab for all
--   three live challenges (Maurten, eo, UK).

-- ----------------------------------------------------------------
-- PRE-CHECKS
-- ----------------------------------------------------------------
-- SELECT count(*) FROM eo_challenge_active_days;  -- sanity check table has rows

-- ----------------------------------------------------------------
-- BACKUP — not applicable, purely additive (one new function).
-- ----------------------------------------------------------------

-- ----------------------------------------------------------------
-- MIGRATION
-- ----------------------------------------------------------------
BEGIN;

CREATE OR REPLACE FUNCTION public.get_eo_challenge_activity(p_limit integer DEFAULT 8)
RETURNS TABLE(user_id uuid, display_name text, spot_name text, active_date date, created_at timestamptz)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT a.user_id, pr.display_name, s.name AS spot_name, a.active_date, a.created_at
  FROM eo_challenge_active_days a
  JOIN profiles pr ON pr.id = a.user_id
  LEFT JOIN temp_logs t ON t.id = a.source_log_id
  LEFT JOIN spots s ON s.id = t.spot_id
  ORDER BY a.created_at DESC
  LIMIT p_limit;
$function$;

COMMIT;

-- ----------------------------------------------------------------
-- ROLLBACK
-- ----------------------------------------------------------------
-- DROP FUNCTION public.get_eo_challenge_activity(integer);

-- ----------------------------------------------------------------
-- VERIFY
-- ----------------------------------------------------------------
-- SELECT * FROM get_eo_challenge_activity(5);  -- expect: up to 5 rows, most recent active day first
