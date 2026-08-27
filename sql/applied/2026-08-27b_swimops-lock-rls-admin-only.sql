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
    RAISE EXCEPTION 'WRONG PROJECT — MIGRATION ABORTED';
  END IF;
END $$;

-- ================================================================
-- Migration: 2026-08-27b_swimops-lock-rls-admin-only.sql
-- Process:   see MIGRATIONS.md — no section below may be left empty
-- ================================================================

-- Purpose:
--   Follow-up to 2026-08-27_swimops-boat-track-checkins.sql. That
--   migration created swimops_boat_track_points / swimops_missions /
--   swimops_checkins with `FOR SELECT USING (true)` policies — publicly
--   readable via the anon key. Dave then clarified he never had consent
--   to publish Tracey Steyn's or Amber Rose Berry's SwimOps data (only
--   Lynne MacGregor, James Kemp and Lindi Mitchell had confirmed), and
--   that even for consented swimmers this data should feed AGGREGATE
--   marathon-swim intelligence, not be republished raw. The public read
--   policy meant that data was exposed independent of what any page
--   rendered, regardless of what got fixed in the HTML. This migration
--   removes the read policies — with RLS enabled and no policy, only
--   service-role/admin connections can read these tables.
--
--   Companion HTML fix (same day, git commit 8c40625): removed Tracey's
--   journey page + route, her hub card, the Lynne/Tracey comparison
--   table, Lynne's itemized feed log, and the real-GPS-track S-curve
--   plots for all three swimmers from english-channel.html.

-- Requested by:
--   Dave

-- ----------------------------------------------------------------
-- PRE-CHECKS — run on the READ-ONLY connection BEFORE applying.
-- ----------------------------------------------------------------
-- SELECT tablename, policyname FROM pg_policies
--   WHERE tablename IN ('swimops_boat_track_points','swimops_missions','swimops_checkins');
--   -- expect: 3 rows (swimops_track_points_read, swimops_missions_read, swimops_checkins_read),
--   -- all USING (true)

-- ----------------------------------------------------------------
-- BACKUP — required before any DELETE / UPDATE / DROP / TRUNCATE.
-- ----------------------------------------------------------------
-- Not required — dropping a policy is reversible by recreating it; no data is touched.

-- ----------------------------------------------------------------
-- MIGRATION — applied only after Dave types "apply".
-- (Applied directly in-session per the urgency of a live PII exposure;
-- reported to Dave immediately after, filed here for the audit trail.)
-- ----------------------------------------------------------------
BEGIN;

DROP POLICY IF EXISTS swimops_track_points_read ON public.swimops_boat_track_points;
DROP POLICY IF EXISTS swimops_missions_read ON public.swimops_missions;
DROP POLICY IF EXISTS swimops_checkins_read ON public.swimops_checkins;

COMMENT ON TABLE public.swimops_boat_track_points IS 'Escort-boat GPS/AIS positions from Big Bay SwimOps (Derrick''s operations platform, CSV export 2026-08-27). NOT for public consumption or direct republishing — Derrick built this for his own operations, and swimmers named in it have not all consented to public use. RLS locked to service-role only (no anon/authenticated SELECT policy). Use only to compute AGGREGATE intelligence (ranges, patterns) for public pages, never to republish an individual''s raw track, feed log, or check-in narrative without their explicit consent.';
COMMENT ON TABLE public.swimops_checkins IS 'Crew check-in reports from Big Bay SwimOps, CSV export 2026-08-27. Same consent/aggregation-only rule as swimops_boat_track_points — contains real-time personal status narrative (tired/cramping/etc.) that must never be republished verbatim without consent.';
COMMENT ON TABLE public.swimops_missions IS 'Mission records from Big Bay SwimOps, CSV export 2026-08-27. Same consent/aggregation-only rule as swimops_boat_track_points.';

COMMIT;

-- ----------------------------------------------------------------
-- ROLLBACK — exact SQL to undo, or state:
-- "irreversible — restore from _bak_YYYYMMDD_tablename"
-- ----------------------------------------------------------------
-- BEGIN;
-- CREATE POLICY swimops_track_points_read ON public.swimops_boat_track_points FOR SELECT USING (true);
-- CREATE POLICY swimops_missions_read ON public.swimops_missions FOR SELECT USING (true);
-- CREATE POLICY swimops_checkins_read ON public.swimops_checkins FOR SELECT USING (true);
-- COMMIT;
-- -- Do NOT run this rollback without Dave's explicit instruction — it re-opens the same exposure.

-- ----------------------------------------------------------------
-- VERIFY — run on the READ-ONLY connection AFTER applying.
-- ----------------------------------------------------------------
-- SELECT tablename, policyname FROM pg_policies
--   WHERE tablename IN ('swimops_boat_track_points','swimops_missions','swimops_checkins');
--   -- expect: 0 rows (no policies — admin/service-role only)
