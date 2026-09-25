-- ================================================================
-- SwimLoading — Migration
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
-- Migration: 2026-09-25_public-swimmer-count-rpc.sql
-- Process:   see MIGRATIONS.md — no section below may be left empty
-- Applied:   2026-09-25 via supabase-admin MCP after Dave typed "apply".
--            Verified: anon REST call → 744 (= count(*) profiles); direct
--            anon profiles count still */0; ACL anon/authenticated/service_role.
-- ================================================================

-- Purpose:
--   Give logged-out visitors the true swimmer total for [data-sync="swimmers"].
--   site-sync.js counted `profiles` with the anon key, but profiles RLS only
--   allows admin + own-row SELECT, so anon sees 0 rows (verified 25 Sep 2026:
--   `set local role anon; select count(*) from profiles` → 0, real total 744).
--   This SECURITY DEFINER function returns the aggregate only — no rows, no
--   columns — using the same definition /admin uses (all profiles; see
--   get_admin_user_directory, which returns every profiles row to admins).
--   Additive only: no existing object or RLS policy is changed.

-- Requested by:
--   Dave (site-sync live stats — follow-up from the data-sync audit)

-- ----------------------------------------------------------------
-- PRE-CHECKS — run on the READ-ONLY connection BEFORE applying.
-- ----------------------------------------------------------------
-- SELECT to_regprocedure('public.public_swimmer_count()');   -- expect: NULL (name free)   [25 Sep: NULL]
-- SELECT count(*) FROM public.profiles;                       -- the number the RPC must return [25 Sep: 744]
-- No UPDATE/DELETE — nothing to count or back up.

-- ----------------------------------------------------------------
-- BACKUP — not required: additive CREATE FUNCTION + GRANT only.
-- ----------------------------------------------------------------

-- ----------------------------------------------------------------
-- MIGRATION — applied only after Dave types "apply".
-- ----------------------------------------------------------------
BEGIN;

CREATE FUNCTION public.public_swimmer_count()
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT count(*)::int FROM public.profiles;
$function$;

COMMENT ON FUNCTION public.public_swimmer_count() IS
  'Total registered swimmers (all profiles) for public [data-sync="swimmers"] spans. Aggregate only — returns no rows. Called by site-sync.js with the anon key.';

-- Supabase default privileges grant EXECUTE to PUBLIC on new functions; make
-- the intended audience explicit instead of relying on that.
REVOKE ALL ON FUNCTION public.public_swimmer_count() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.public_swimmer_count() TO anon, authenticated, service_role;

COMMIT;

-- ----------------------------------------------------------------
-- ROLLBACK
-- ----------------------------------------------------------------
-- DROP FUNCTION public.public_swimmer_count();
-- (site-sync.js falls back to the site-config.js number if the RPC 404s.)

-- ----------------------------------------------------------------
-- VERIFY — run on the READ-ONLY connection AFTER applying.
-- ----------------------------------------------------------------
-- SELECT public.public_swimmer_count() = (SELECT count(*) FROM public.profiles);
--   -- expect: true
-- SELECT has_function_privilege('anon', 'public.public_swimmer_count()', 'EXECUTE');
--   -- expect: true
-- BEGIN; SET LOCAL ROLE anon; SELECT public.public_swimmer_count(); ROLLBACK;
--   -- expect: the full total (744 on 25 Sep), NOT 0
-- BEGIN; SET LOCAL ROLE anon; SELECT count(*) FROM public.profiles; ROLLBACK;
--   -- expect: 0 — profiles rows are still hidden from anon (RLS untouched)
