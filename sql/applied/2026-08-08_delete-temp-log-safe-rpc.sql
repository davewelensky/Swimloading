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
-- Migration: 2026-08-08_delete-temp-log-safe-rpc.sql
-- Process:   see MIGRATIONS.md — no section below may be left empty
-- ================================================================

-- Purpose:
--   Users cannot delete their own temp logs when the log is the source
--   of an eo SwimBETTER active-day row: the app's raw
--   DELETE FROM temp_logs fails with FK violation
--   eo_challenge_active_days_source_log_id_fkey (seen live by Ysie,
--   2026-08-08, deleting a mis-located 14°C log — screenshot from Dave).
--   Knock-on: because the delete fails, strava_imports.imported_to_log_id
--   keeps pointing at the bad log, so the Strava activity stays greyed
--   out as "Imported" and the user cannot re-log it at the right spot.
--   The admin panel's raw delete (admin.html deleteLog) has the same
--   unhandled FK. The admin VOID flow was already fixed on 2026-08-07
--   via release_temp_log_refs(); this migration exposes the same
--   cleanup through one RPC both user-facing delete paths can call:
--   delete_temp_log_safe(p_log_id) — allowed for the log's owner or an
--   admin, releases FK refs, deletes the log, returns rows deleted.
--   Deliberately unchanged behaviour: june_challenge_events rows are
--   NOT touched (they don't block the delete today and self-delete has
--   never removed them); strava_imports needs nothing (FK is
--   ON DELETE SET NULL, so the activity becomes re-importable).

-- Requested by:
--   Dave (user "Ysie" stuck with a wrong-location log they cannot
--   delete; Strava re-log blocked as a consequence)

-- ----------------------------------------------------------------
-- PRE-CHECKS — run on the READ-ONLY connection BEFORE applying.
-- Must include affected-row counts for any UPDATE/DELETE.
-- ----------------------------------------------------------------
-- release_temp_log_refs exists (created 2026-08-07):
-- SELECT proname FROM pg_proc WHERE proname = 'release_temp_log_refs';
--   -- expect: 1 row
-- No function with the new name yet:
-- SELECT proname FROM pg_proc WHERE proname = 'delete_temp_log_safe';
--   -- expect: 0 rows
-- profiles.is_admin exists (used for the admin arm of the auth check):
-- SELECT column_name FROM information_schema.columns
-- WHERE table_name = 'profiles' AND column_name = 'is_admin';
--   -- expect: 1 row

-- ----------------------------------------------------------------
-- BACKUP — required before any DELETE / UPDATE / DROP / TRUNCATE.
-- ----------------------------------------------------------------
-- Not required: applying this migration only creates a function; no
-- data rows are touched. (The function itself deletes a single log,
-- but only when its owner or an admin explicitly clicks Delete —
-- the same action the raw delete performs today.)

-- ----------------------------------------------------------------
-- MIGRATION — applied only after Dave types "apply".
-- ----------------------------------------------------------------
BEGIN;

CREATE OR REPLACE FUNCTION public.delete_temp_log_safe(p_log_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_owner uuid;
  v_deleted integer;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authorised';
  END IF;

  SELECT user_id INTO v_owner FROM temp_logs WHERE id = p_log_id;
  IF v_owner IS NULL THEN
    RETURN 0;  -- already gone — treat as success, delete is idempotent
  END IF;

  IF v_owner <> auth.uid()
     AND NOT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin) THEN
    RAISE EXCEPTION 'Not authorised';
  END IF;

  -- Repoints/removes eo_challenge_active_days rows and removes
  -- campaign_location_credits sourced from this log (2026-08-07 helper),
  -- so the DELETE below cannot hit an FK violation.
  PERFORM release_temp_log_refs(p_log_id);

  DELETE FROM temp_logs WHERE id = p_log_id;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$function$;

REVOKE ALL ON FUNCTION public.delete_temp_log_safe(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.delete_temp_log_safe(uuid) TO authenticated;

COMMIT;

-- ----------------------------------------------------------------
-- ROLLBACK — exact SQL to undo, or state:
-- "irreversible — restore from _bak_YYYYMMDD_tablename"
-- ----------------------------------------------------------------
-- DROP FUNCTION public.delete_temp_log_safe(uuid);
-- (The app falls back to the raw delete automatically if the RPC is
-- missing, so dropping the function reverts to pre-migration behaviour.)

-- ----------------------------------------------------------------
-- VERIFY — run on the READ-ONLY connection AFTER applying.
-- State the expected result next to each query.
-- ----------------------------------------------------------------
-- SELECT proname, prosecdef FROM pg_proc WHERE proname = 'delete_temp_log_safe';
--   -- expect: 1 row, prosecdef = true
-- SELECT has_function_privilege('authenticated',
--        'public.delete_temp_log_safe(uuid)', 'EXECUTE');
--   -- expect: true
-- SELECT has_function_privilege('anon',
--        'public.delete_temp_log_safe(uuid)', 'EXECUTE');
--   -- expect: false
-- Then Ysie (or Dave impersonating via the app) re-taps Del on the
-- stuck 14°C log — expect success toast, and the matching Strava
-- activity shows a "Log" button again (imported_to_log_id auto-nulled
-- by its ON DELETE SET NULL FK).
