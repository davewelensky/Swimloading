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
-- Migration: 2026-07-21_new-member-count-rpc.sql
-- Process:   see MIGRATIONS.md
-- ================================================================

-- Purpose:
--   Fix the dashboard "New Members" tile always showing 0. profiles has
--   a single own-row SELECT policy (profiles_select_own: auth.uid()=id),
--   so the client-side head:true count over profiles can only ever see
--   the caller's own row — it returns 0 or 1, never the site-wide weekly
--   count. It fails safely (RLS filters, no error), just wrong. The New
--   Spots and Logs tiles are correct because spots/temp_logs RLS allow
--   the client to read all rows; only profiles is own-row-restricted.
--
--   Adds a SECURITY DEFINER function that counts profiles created in the
--   last 7 days server-side, bypassing RLS. Returns ONLY an integer — no
--   profile rows or PII cross the boundary. Same window ("this week" =
--   rolling 7 days) as the tile's label. The client swaps its blocked
--   profiles count for this RPC; spots/logs stay client-side.

-- Requested by:
--   Dave (2026-07-21) — "the app still shows no new swimmers joined this
--   week, yet I can see 5 joined in the last 4 days."

-- ----------------------------------------------------------------
-- PRE-CHECKS
-- ----------------------------------------------------------------
-- SELECT count(*) FROM pg_proc WHERE proname='get_new_member_count_v1';  -- expect: 0
-- SELECT count(*) FROM profiles WHERE created_at >= now() - interval '7 days';  -- true count

-- ----------------------------------------------------------------
-- BACKUP — not required. Adds one function; touches no data.
-- ----------------------------------------------------------------

-- ----------------------------------------------------------------
-- MIGRATION — applied only after Dave types "apply".
-- ----------------------------------------------------------------
BEGIN;

CREATE OR REPLACE FUNCTION public.get_new_member_count_v1()
RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT count(*)::int FROM profiles WHERE created_at >= now() - interval '7 days';
$$;

COMMENT ON FUNCTION public.get_new_member_count_v1() IS
  'Dashboard "New Members" tile — count of profiles created in the last '
  '7 days. SECURITY DEFINER to bypass the own-row profiles RLS; returns '
  'only an integer, no profile data. Added 2026-07-21.';

REVOKE ALL ON FUNCTION public.get_new_member_count_v1() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.get_new_member_count_v1() TO authenticated;

COMMIT;

-- ----------------------------------------------------------------
-- ROLLBACK
-- ----------------------------------------------------------------
-- DROP FUNCTION IF EXISTS public.get_new_member_count_v1();
-- Reverting returns the tile to its (wrong) client-side 0/1 count.

-- ----------------------------------------------------------------
-- VERIFY
-- ----------------------------------------------------------------
-- SELECT get_new_member_count_v1();  -- expect: the true 7-day new-member count
-- SELECT proname, prosecdef FROM pg_proc WHERE proname='get_new_member_count_v1';
--   -- expect: 1 row, prosecdef = true
