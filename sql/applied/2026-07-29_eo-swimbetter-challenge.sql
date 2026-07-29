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
-- Migration: 2026-07-29_eo-swimbetter-challenge.sql
-- Process:   see MIGRATIONS.md — no section below may be left empty
-- ================================================================

-- Purpose:
--   Builds the eo SwimBETTER Performance Challenge tracking system —
--   nothing existed for this before this migration (confirmed by
--   grep + schema search 2026-07-29). Launches 1 Aug 2026, same day as
--   the July/August newsletter announcing it, so this must be ready.
--
--   Scoring rules confirmed directly by Dave 2026-07-29:
--     - "Active day" = 1+ real (non-sensor, real user_id) temp log that day
--     - Winner = ranked by total active days across Aug 1 - Oct 31 (primary),
--       longest single streak as tiebreaker
--     - Automatic — no opt-in/join step, matches the June/July engine
--       pattern (not the UK Swim Spot Challenge's opt-in pattern)
--
--   Distinct from campaigns (unique-location scoring) and
--   june_challenge_* (points/draw-entry scoring) — this is a new
--   mechanic (active-day/streak ranking), hence new tables rather than
--   extending either existing system.

-- Requested by:
--   Dave — 2026-07-29, "these results need to be audited and correct"

-- ----------------------------------------------------------------
-- PRE-CHECKS — run on the READ-ONLY connection BEFORE applying.
-- Must include affected-row counts for any UPDATE/DELETE.
-- ----------------------------------------------------------------
-- SELECT to_regclass('public.eo_challenge_config'), to_regclass('public.eo_challenge_active_days');
-- -- expect: both NULL (tables do not exist yet)

-- ----------------------------------------------------------------
-- BACKUP — required before any DELETE / UPDATE / DROP / TRUNCATE.
-- ----------------------------------------------------------------
-- Not required — new tables only, no existing data touched.

-- ----------------------------------------------------------------
-- MIGRATION — applied only after Dave types "apply".
-- ----------------------------------------------------------------
BEGIN;

-- ── eo_challenge_config — single row, same shape as june_challenge_config ──
CREATE TABLE IF NOT EXISTS eo_challenge_config (
  id           integer PRIMARY KEY DEFAULT 1,
  enabled      boolean NOT NULL DEFAULT false,
  test_mode    boolean NOT NULL DEFAULT true,
  launch_date  date    NOT NULL,
  end_date     date    NOT NULL,
  CONSTRAINT eo_challenge_config_singleton CHECK (id = 1)
);

INSERT INTO eo_challenge_config (id, enabled, test_mode, launch_date, end_date)
VALUES (1, true, false, '2026-08-01', '2026-10-31')
ON CONFLICT (id) DO UPDATE SET
  enabled = EXCLUDED.enabled, test_mode = EXCLUDED.test_mode,
  launch_date = EXCLUDED.launch_date, end_date = EXCLUDED.end_date;

-- ── eo_challenge_active_days — the ledger: one row per user per active day ──
CREATE TABLE IF NOT EXISTS eo_challenge_active_days (
  user_id      uuid NOT NULL REFERENCES profiles(id),
  active_date  date NOT NULL,
  source_log_id uuid REFERENCES temp_logs(id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, active_date)
);

CREATE INDEX IF NOT EXISTS idx_eo_active_days_user ON eo_challenge_active_days(user_id);

ALTER TABLE eo_challenge_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE eo_challenge_active_days ENABLE ROW LEVEL SECURITY;

CREATE POLICY "eo_config_public_read" ON eo_challenge_config FOR SELECT USING (true);
CREATE POLICY "eo_active_days_own_read" ON eo_challenge_active_days
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "eo_active_days_admin_read" ON eo_challenge_active_days
  FOR SELECT USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true));

-- ── record_eo_active_day() — SECURITY DEFINER, called from app.js right ──
-- after a temp_logs insert (same call site as jcAwardPoints/ukChallengeAwardLocation).
-- Re-derives the log's own user_id and date server-side rather than trusting
-- client input, and only records real user swims — a temp_log with
-- user_id IS NULL (the UK lido sensor-import cron) can never match
-- p_user_id = t.user_id, so sensor rows are structurally excluded.
CREATE OR REPLACE FUNCTION record_eo_active_day(p_user_id uuid, p_log_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_config eo_challenge_config%ROWTYPE;
  v_log_date date;
BEGIN
  SELECT * INTO v_config FROM eo_challenge_config WHERE id = 1;
  IF NOT FOUND OR NOT v_config.enabled THEN
    RETURN jsonb_build_object('recorded', false, 'reason', 'challenge_not_enabled');
  END IF;

  SELECT (COALESCE(logged_at, created_at) AT TIME ZONE 'Africa/Johannesburg')::date
    INTO v_log_date
  FROM temp_logs
  WHERE id = p_log_id AND user_id = p_user_id;

  IF v_log_date IS NULL THEN
    RETURN jsonb_build_object('recorded', false, 'reason', 'log_not_found_or_not_yours');
  END IF;
  IF v_log_date < v_config.launch_date OR v_log_date > v_config.end_date THEN
    RETURN jsonb_build_object('recorded', false, 'reason', 'outside_challenge_window');
  END IF;

  INSERT INTO eo_challenge_active_days (user_id, active_date, source_log_id)
  VALUES (p_user_id, v_log_date, p_log_id)
  ON CONFLICT (user_id, active_date) DO NOTHING;

  RETURN jsonb_build_object('recorded', true, 'active_date', v_log_date);
END;
$$;

REVOKE ALL ON FUNCTION record_eo_active_day(uuid, uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION record_eo_active_day(uuid, uuid) TO authenticated;

-- ── get_eo_challenge_leaders() — total active days (primary) + longest ──
-- streak (tiebreaker), classic "gaps and islands" streak calc via
-- date - row_number() producing a constant grouping key per consecutive run.
CREATE OR REPLACE FUNCTION get_eo_challenge_leaders()
RETURNS TABLE (
  user_id           uuid,
  display_name      text,
  avatar_url        text,
  total_active_days integer,
  longest_streak    integer,
  first_active_date date,
  last_active_date  date
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  WITH grouped AS (
    SELECT user_id, active_date,
           active_date - (ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY active_date))::integer AS grp
    FROM eo_challenge_active_days
  ),
  streaks AS (
    SELECT user_id, grp, count(*) AS streak_len
    FROM grouped GROUP BY user_id, grp
  ),
  per_user AS (
    SELECT user_id,
           count(*) AS total_active_days,
           max(active_date) AS last_active_date,
           min(active_date) AS first_active_date
    FROM eo_challenge_active_days GROUP BY user_id
  ),
  longest AS (
    SELECT user_id, max(streak_len) AS longest_streak FROM streaks GROUP BY user_id
  )
  SELECT p.user_id, pr.display_name, pr.avatar_url,
         p.total_active_days::integer, COALESCE(l.longest_streak, 0)::integer,
         p.first_active_date, p.last_active_date
  FROM per_user p
  JOIN longest l ON l.user_id = p.user_id
  JOIN profiles pr ON pr.id = p.user_id
  ORDER BY p.total_active_days DESC, l.longest_streak DESC;
$$;

REVOKE ALL ON FUNCTION get_eo_challenge_leaders() FROM public, anon;
GRANT EXECUTE ON FUNCTION get_eo_challenge_leaders() TO authenticated;

COMMIT;

-- ----------------------------------------------------------------
-- ROLLBACK — exact SQL to undo, or state:
-- "irreversible — restore from _bak_YYYYMMDD_tablename"
-- ----------------------------------------------------------------
-- DROP FUNCTION IF EXISTS get_eo_challenge_leaders();
-- DROP FUNCTION IF EXISTS record_eo_active_day(uuid, uuid);
-- DROP TABLE IF EXISTS eo_challenge_active_days;
-- DROP TABLE IF EXISTS eo_challenge_config;

-- ----------------------------------------------------------------
-- VERIFY — run on the READ-ONLY connection AFTER applying.
-- State the expected result next to each query.
-- ----------------------------------------------------------------
-- SELECT * FROM eo_challenge_config WHERE id = 1;
-- -- expect: enabled=true, test_mode=false, launch_date=2026-08-01, end_date=2026-10-31
-- SELECT to_regclass('public.eo_challenge_active_days');
-- -- expect: 'eo_challenge_active_days'
-- SELECT * FROM get_eo_challenge_leaders();
-- -- expect: 0 rows (no active days recorded yet — challenge hasn't started)
