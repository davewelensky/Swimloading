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
-- Migration: 2026-07-29_eo-swimbetter-draw-rules.sql
-- Process:   see MIGRATIONS.md — no section below may be left empty
-- ================================================================

-- Purpose:
--   Adds the final-draw qualification rule to eo_challenge_config, and a
--   get_eo_challenge_draw_pool() function, per Dave's confirmed design
--   (2026-07-29): qualify with 30+ active days across Aug 1 - Oct 31
--   (~92 days), pool capped at 20 (top 20 by active days if more than 20
--   qualify; everyone who qualifies if fewer than 20). Equal odds within
--   the pool — the actual random pick itself is a separate script run at
--   the end of October (same pattern as scripts/draw-monthly-winner.mjs),
--   not part of this migration.

-- Requested by:
--   Dave — 2026-07-29, "make it fair... a serious swimmer wanting to improve"

-- ----------------------------------------------------------------
-- PRE-CHECKS — run on the READ-ONLY connection BEFORE applying.
-- Must include affected-row counts for any UPDATE/DELETE.
-- ----------------------------------------------------------------
-- SELECT column_name FROM information_schema.columns WHERE table_name = 'eo_challenge_config';
-- -- expect: id, enabled, test_mode, launch_date, end_date (no qualify columns yet)

-- ----------------------------------------------------------------
-- BACKUP — required before any DELETE / UPDATE / DROP / TRUNCATE.
-- ----------------------------------------------------------------
-- Not required — ADD COLUMN only, single existing row keeps its values
-- via the DEFAULTs below; no existing data is modified or destroyed.

-- ----------------------------------------------------------------
-- MIGRATION — applied only after Dave types "apply".
-- ----------------------------------------------------------------
BEGIN;

ALTER TABLE eo_challenge_config
  ADD COLUMN IF NOT EXISTS qualify_min_active_days integer NOT NULL DEFAULT 30,
  ADD COLUMN IF NOT EXISTS draw_pool_cap           integer NOT NULL DEFAULT 20;

COMMENT ON COLUMN eo_challenge_config.qualify_min_active_days IS 'Minimum active days across the full window to qualify for the final draw (confirmed by Dave: 30 of ~92 days, roughly 2-3x/week)';
COMMENT ON COLUMN eo_challenge_config.draw_pool_cap IS 'Max draw-pool size — if more than this many qualify, only the top N by active days (then longest streak) enter; if fewer, everyone who qualifies enters';

CREATE OR REPLACE FUNCTION get_eo_challenge_draw_pool()
RETURNS TABLE (
  user_id           uuid,
  display_name      text,
  avatar_url        text,
  total_active_days integer,
  longest_streak    integer,
  first_active_date date,
  last_active_date  date
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cap integer;
BEGIN
  SELECT draw_pool_cap INTO v_cap FROM eo_challenge_config WHERE id = 1;
  RETURN QUERY
    SELECT l.user_id, l.display_name, l.avatar_url, l.total_active_days, l.longest_streak,
           l.first_active_date, l.last_active_date
    FROM get_eo_challenge_leaders() l, eo_challenge_config c
    WHERE c.id = 1 AND l.total_active_days >= c.qualify_min_active_days
    ORDER BY l.total_active_days DESC, l.longest_streak DESC
    LIMIT v_cap;
END;
$$;

REVOKE ALL ON FUNCTION get_eo_challenge_draw_pool() FROM public, anon;
GRANT EXECUTE ON FUNCTION get_eo_challenge_draw_pool() TO authenticated;

COMMIT;

-- ----------------------------------------------------------------
-- ROLLBACK — exact SQL to undo, or state:
-- "irreversible — restore from _bak_YYYYMMDD_tablename"
-- ----------------------------------------------------------------
-- DROP FUNCTION IF EXISTS get_eo_challenge_draw_pool();
-- ALTER TABLE eo_challenge_config
--   DROP COLUMN IF EXISTS qualify_min_active_days,
--   DROP COLUMN IF EXISTS draw_pool_cap;

-- ----------------------------------------------------------------
-- VERIFY — run on the READ-ONLY connection AFTER applying.
-- State the expected result next to each query.
-- ----------------------------------------------------------------
-- SELECT qualify_min_active_days, draw_pool_cap FROM eo_challenge_config WHERE id = 1;
-- -- expect: qualify_min_active_days=30, draw_pool_cap=20
-- SELECT * FROM get_eo_challenge_draw_pool();
-- -- expect: 0 rows (nobody has qualified yet — challenge hasn't started)
