-- ================================================================
-- SwimLoading — Migration Template
-- ================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM _project_identity
    WHERE key = 'project_name' AND value = 'swimloading'
  ) THEN
    RAISE EXCEPTION 'WRONG PROJECT — MIGRATION ABORTED. Expected ref: szgkzuswelntnevobnoh';
  END IF;
END $$;

-- ================================================================
-- Migration: 2026-07-21_push-subscriptions-update-policy.sql
-- Process:   see MIGRATIONS.md
-- ================================================================

-- Purpose:
--   Second half of the push-notification fix. push_subscriptions has RLS
--   enabled with SELECT / INSERT / DELETE own-row policies, but NO UPDATE
--   policy — so Postgres denies every UPDATE from an authenticated user.
--   The client's updatePushPref() (toggle temp/swim/new-member) and
--   saveNotifLocs() (change preferred regions) both .update() this table
--   with the user's JWT, so both were silently blocked: a toggle moves
--   visually then snaps back on re-render, and region changes never
--   persist. The send-push edge function was unaffected because it uses
--   the service role, which bypasses RLS — which is why this stayed
--   hidden.
--
--   Adds the missing own-row UPDATE policy. USING restricts which rows a
--   user may update to their own; WITH CHECK prevents reassigning a row
--   to another user_id. Mirrors the existing SELECT/DELETE policies.

-- Requested by:
--   Dave (2026-07-21) — "it won't let me toggle the new swim posts and
--   water temp logs off or on."

-- ----------------------------------------------------------------
-- PRE-CHECKS
-- ----------------------------------------------------------------
-- SELECT policyname, cmd FROM pg_policies
--  WHERE schemaname='public' AND tablename='push_subscriptions';
--   -- expect: SELECT/INSERT/DELETE present, NO UPDATE

-- ----------------------------------------------------------------
-- BACKUP — not required. Adds a policy; touches no data.
-- ----------------------------------------------------------------

-- ----------------------------------------------------------------
-- MIGRATION — applied only after Dave types "apply".
-- ----------------------------------------------------------------
BEGIN;

CREATE POLICY "Users can update own subscriptions" ON public.push_subscriptions
  FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

COMMIT;

-- ----------------------------------------------------------------
-- ROLLBACK
-- ----------------------------------------------------------------
-- DROP POLICY IF EXISTS "Users can update own subscriptions" ON public.push_subscriptions;
-- Reverting re-blocks toggle/region persistence; no data affected.

-- ----------------------------------------------------------------
-- VERIFY
-- ----------------------------------------------------------------
-- SELECT policyname, cmd, qual, with_check FROM pg_policies
--  WHERE schemaname='public' AND tablename='push_subscriptions' AND cmd='UPDATE';
--   -- expect: 1 row, USING (auth.uid() = user_id), CHECK (auth.uid() = user_id)
