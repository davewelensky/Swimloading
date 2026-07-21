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
-- Migration: 2026-07-21_push-notify-columns.sql
-- Process:   see MIGRATIONS.md
-- ================================================================

-- Purpose:
--   Fix a long-standing dead feature: location temp/swim push
--   notifications have NEVER delivered. The send-push edge function
--   filters location broadcasts on push_subscriptions.notify_on_temp /
--   notify_on_swim, the settings screen reads them, and updatePushPref
--   writes them — but the two columns were never created by a
--   migration. Every location broadcast query therefore errors
--   ("column notify_on_temp does not exist"), the function finds no
--   subscribers, and nothing sends. (new_member + individual modes work
--   — they use columns that exist.)
--
--   This adds the two boolean columns with DEFAULT true, which backfills
--   all existing rows, so the edge function's filter immediately matches
--   already-subscribed users. No edge-function redeploy needed — it
--   already references these columns. DEFAULT true matches the client's
--   own `?? true` fallback, so this switches the intended behaviour on
--   rather than changing it.
--
--   Behaviour note (not a code change, a consequence): 42 users hold
--   location subscriptions (Atlantic 21, False Bay 11, KZN 7, others
--   fewer). After this, a temp log at a spot pings everyone subscribed
--   to that spot's domain. Stale endpoints (some date to Feb) are
--   auto-pruned by the function on first send (410/404 handling).

-- Requested by:
--   Dave (2026-07-21) — "I have False Bay set and get no notifications
--   at all."

-- ----------------------------------------------------------------
-- PRE-CHECKS
-- ----------------------------------------------------------------
-- SELECT column_name FROM information_schema.columns
--  WHERE table_schema='public' AND table_name='push_subscriptions'
--    AND column_name IN ('notify_on_temp','notify_on_swim');   -- expect: 0 rows
-- SELECT count(*) FROM push_subscriptions;                     -- 106 (all get default true)

-- ----------------------------------------------------------------
-- BACKUP — not required. Additive columns only; no existing data is
-- read, changed or removed. Rollback is a clean DROP COLUMN.
-- ----------------------------------------------------------------

-- ----------------------------------------------------------------
-- MIGRATION — applied only after Dave types "apply".
-- ----------------------------------------------------------------
BEGIN;

ALTER TABLE push_subscriptions
  ADD COLUMN IF NOT EXISTS notify_on_temp boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS notify_on_swim boolean NOT NULL DEFAULT true;

COMMIT;

-- ----------------------------------------------------------------
-- ROLLBACK
-- ----------------------------------------------------------------
-- BEGIN;
-- ALTER TABLE push_subscriptions
--   DROP COLUMN IF EXISTS notify_on_temp,
--   DROP COLUMN IF EXISTS notify_on_swim;
-- COMMIT;
-- Reverting re-breaks the location broadcast (back to silent), but does
-- not touch endpoints, preferred_locations or notify_on_new_member.

-- ----------------------------------------------------------------
-- VERIFY
-- ----------------------------------------------------------------
-- SELECT column_name, data_type, column_default, is_nullable
--   FROM information_schema.columns
--  WHERE table_schema='public' AND table_name='push_subscriptions'
--    AND column_name IN ('notify_on_temp','notify_on_swim');
--   -- expect: 2 rows, boolean, default true, NOT NULL
-- SELECT count(*) FILTER (WHERE notify_on_temp) AS temp_on,
--        count(*) FILTER (WHERE notify_on_swim) AS swim_on,
--        count(*) AS total
--   FROM push_subscriptions;  -- expect: temp_on = swim_on = total = 106
-- -- The edge function's exact filter should now return rows:
-- SELECT count(*) FROM push_subscriptions
--  WHERE preferred_locations @> ARRAY['FALSE_BAY'] AND notify_on_temp = true;
