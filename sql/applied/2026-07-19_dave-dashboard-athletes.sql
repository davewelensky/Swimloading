-- ================================================================
-- SwimLoading — Migration Template
-- ================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM _project_identity
    WHERE key = 'project_name' AND value = 'swimloading'
  ) THEN
    RAISE EXCEPTION 'WRONG PROJECT — MIGRATION ABORTED (expected swimloading / szgkzuswelntnevobnoh)';
  END IF;
  RAISE NOTICE '✅ Project identity confirmed: swimloading (szgkzuswelntnevobnoh)';
END $$;

-- ================================================================
-- Migration: 2026-07-19_dave-dashboard-athletes.sql
-- ================================================================

-- Purpose:
--   /dave (Control Centre) hardcoded its "Athletes" section as static
--   HTML link cards. Lynne MacGregor's journey/dashboard already existed
--   but was never added — the hardcoding itself was the bug. This table
--   gives /dave a live source to render from instead of hand-edited HTML.
--   No existing table (crossing_targets, crossing_attempts) has any row
--   for Lindi/James/Lynne, so there is no derivable signal — this table
--   IS the signal: one row per swimmer Dave has built a journey page +
--   crossing-prep dashboard for.

-- Requested by:
--   Dave, 2026-07-19 — "we have offered 3 swimmers access to this,
--   let's make it worth it" (Lindi, James, Lynne)

-- ----------------------------------------------------------------
-- PRE-CHECKS
-- ----------------------------------------------------------------
-- SELECT count(*) FROM information_schema.tables
--   WHERE table_name='dave_dashboard_athletes';  -- expect: 0

-- ----------------------------------------------------------------
-- BACKUP
-- ----------------------------------------------------------------
-- Not required — new table only, no existing data touched.

-- ----------------------------------------------------------------
-- MIGRATION
-- ----------------------------------------------------------------
BEGIN;

CREATE TABLE dave_dashboard_athletes (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id      uuid REFERENCES profiles(id) ON DELETE SET NULL,
  display_name    text NOT NULL,
  crossing_name   text NOT NULL DEFAULT 'English Channel',
  meta_note       text,                    -- e.g. "logging conditions" (James); null = show profile email
  journey_slug    text NOT NULL,           -- /journeys/<slug>
  dashboard_uid   uuid NOT NULL,           -- /crossing-prep?uid=<dashboard_uid>
  sort_order      int NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE dave_dashboard_athletes IS
  'One row per swimmer featured on /dave Control Centre — the athlete has an existing /journeys/<slug> page and a /crossing-prep?uid=<dashboard_uid> dashboard. Add a row here when building a new athlete journey page instead of hand-editing dave.html.';

ALTER TABLE dave_dashboard_athletes ENABLE ROW LEVEL SECURITY;

-- Dave-only, matching the existing admin_read_analytics pattern.
CREATE POLICY dda_dave_all ON dave_dashboard_athletes
  FOR ALL USING (auth.email() = 'dave.welensky@gmail.com')
  WITH CHECK (auth.email() = 'dave.welensky@gmail.com');

INSERT INTO dave_dashboard_athletes (profile_id, display_name, crossing_name, meta_note, journey_slug, dashboard_uid, sort_order) VALUES
  ('392a8281-3c91-4022-b6bb-1d8acf9e5ea0', 'Lindi Mitchell',   'English Channel', 'lindi@mitchell.co.za', 'lindi-english-channel', '392a8281-3c91-4022-b6bb-1d8acf9e5ea0', 1),
  ('6f003f40-1919-4ea6-98b0-efd5013e48eb', 'James',            'English Channel', 'logging conditions',   'james-english-channel', '6f003f40-1919-4ea6-98b0-efd5013e48eb', 2),
  ('3b871129-8d84-4b22-ab2f-f95449447e9f', 'Lynne MacGregor',  'English Channel', 'lm0303@hotmail.com',   'lynne-english-channel', '3b871129-8d84-4b22-ab2f-f95449447e9f', 3);

COMMIT;

-- ----------------------------------------------------------------
-- ROLLBACK
-- ----------------------------------------------------------------
-- DROP TABLE IF EXISTS dave_dashboard_athletes;

-- ----------------------------------------------------------------
-- VERIFY
-- ----------------------------------------------------------------
-- SELECT display_name, journey_slug, dashboard_uid FROM dave_dashboard_athletes ORDER BY sort_order;
--   -- expect: 3 rows, Lindi/James/Lynne, matching prior hardcoded dave.html values
