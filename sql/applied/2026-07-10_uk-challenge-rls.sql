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
-- Migration: 2026-07-10_uk-challenge-rls.sql
-- Process:   see MIGRATIONS.md — no section below may be left empty
-- Run AFTER 2026-07-10_uk-challenge-tables.sql and -functions.sql
-- ================================================================

-- Purpose:
--   Enable RLS + policies on all 6 new UK Swim Spot Challenge tables.
--   Every admin-facing policy uses profiles.is_admin (a real, existing
--   column) rather than the hardcoded-email or hardcoded-UUID patterns
--   used elsewhere in this codebase (analytics_events, spot_suggestions).
--   Scoring tables have NO client write policy at all — every write goes
--   through the SECURITY DEFINER RPCs in the -functions.sql migration.

-- Requested by:
--   Dave

-- ----------------------------------------------------------------
-- PRE-CHECKS — run on the READ-ONLY connection BEFORE applying.
-- ----------------------------------------------------------------
-- SELECT relname, relrowsecurity FROM pg_class WHERE relname IN
--   ('campaigns','campaign_participants','campaign_location_credits',
--    'campaign_events','campaign_admin_flags','campaign_location_proposals');
--   -- expect: 6 rows, relrowsecurity = false (not yet enabled)

-- ----------------------------------------------------------------
-- BACKUP — required before any DELETE / UPDATE / DROP / TRUNCATE.
-- ----------------------------------------------------------------
-- Not applicable — RLS/policy changes only, no data touched.

-- ----------------------------------------------------------------
-- MIGRATION — applied only after Dave types "apply".
-- ----------------------------------------------------------------
BEGIN;

-- ── campaigns — public read (marketing page needs anon access too) ──────
ALTER TABLE campaigns ENABLE ROW LEVEL SECURITY;
CREATE POLICY "campaigns_public_read" ON campaigns
  FOR SELECT USING (true);

-- ── campaign_participants — users see only their own row ────────────────
ALTER TABLE campaign_participants ENABLE ROW LEVEL SECURITY;
CREATE POLICY "participants_own_read" ON campaign_participants
  FOR SELECT USING (auth.uid() = user_id);
-- No INSERT policy — joining goes through join_campaign() (SECURITY DEFINER).

-- ── campaign_location_credits — users see only their own credits ────────
-- (Public leaderboard/map reads happen via get_campaign_leaders(), which
-- is SECURITY DEFINER and bypasses RLS — no need for a public policy here.)
ALTER TABLE campaign_location_credits ENABLE ROW LEVEL SECURITY;
CREATE POLICY "credits_own_read" ON campaign_location_credits
  FOR SELECT USING (auth.uid() = user_id);
-- No INSERT/UPDATE/DELETE policy — all writes via award_campaign_location(),
-- recalc_campaign_scores(), void_campaign_log(), resolve_campaign_location_proposal().

-- ── campaign_events — public read (live feed shown on the public campaign
--    page to visitors who aren't logged in yet, same as temp_logs' public
--    read pattern) ──────────────────────────────────────────────────────
ALTER TABLE campaign_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "events_public_read" ON campaign_events
  FOR SELECT USING (true);
-- No INSERT policy — all writes via join_campaign()/award_campaign_location().

-- ── campaign_admin_flags — users see their own; admins see all ──────────
ALTER TABLE campaign_admin_flags ENABLE ROW LEVEL SECURITY;
CREATE POLICY "flags_own_read" ON campaign_admin_flags
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "flags_admin_read" ON campaign_admin_flags
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin)
  );
-- No client INSERT/UPDATE — all writes via admin_disqualify_campaign_user()/
-- admin_reinstate_campaign_user() (SECURITY DEFINER, is_admin-checked internally).

-- ── campaign_location_proposals — users manage their own; admins read all ─
ALTER TABLE campaign_location_proposals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "proposals_own_read" ON campaign_location_proposals
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "proposals_own_insert" ON campaign_location_proposals
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "proposals_admin_read" ON campaign_location_proposals
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin)
  );
-- No UPDATE policy — status changes go through resolve_campaign_location_proposal()
-- (SECURITY DEFINER, is_admin-checked internally).

COMMIT;

-- ----------------------------------------------------------------
-- ROLLBACK — exact SQL to undo, or state:
-- "irreversible — restore from _bak_YYYYMMDD_tablename"
-- ----------------------------------------------------------------
-- ALTER TABLE campaigns DISABLE ROW LEVEL SECURITY;
-- ALTER TABLE campaign_participants DISABLE ROW LEVEL SECURITY;
-- ALTER TABLE campaign_location_credits DISABLE ROW LEVEL SECURITY;
-- ALTER TABLE campaign_events DISABLE ROW LEVEL SECURITY;
-- ALTER TABLE campaign_admin_flags DISABLE ROW LEVEL SECURITY;
-- ALTER TABLE campaign_location_proposals DISABLE ROW LEVEL SECURITY;
-- (Dropping the individual CREATE POLICY statements achieves the same —
-- either approach is safe; no data touched.)

-- ----------------------------------------------------------------
-- VERIFY — run on the READ-ONLY connection AFTER applying.
-- ----------------------------------------------------------------
-- SELECT tablename, policyname, cmd FROM pg_policies WHERE tablename IN
--   ('campaigns','campaign_participants','campaign_location_credits',
--    'campaign_events','campaign_admin_flags','campaign_location_proposals')
--   ORDER BY tablename, policyname;
--   -- expect: 11 policies total, all SELECT/INSERT — zero UPDATE/DELETE
--   -- policies anywhere (all mutations are RPC-only, matching the plan).
-- SELECT relname, relrowsecurity FROM pg_class WHERE relname IN
--   ('campaigns','campaign_participants','campaign_location_credits',
--    'campaign_events','campaign_admin_flags','campaign_location_proposals');
--   -- expect: 6 rows, relrowsecurity = true
