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
-- Migration: 2026-08-07_void-log-eo-challenge-fk.sql
-- Process:   see MIGRATIONS.md — no section below may be left empty
-- ================================================================

-- Purpose:
--   Admin "Void" button fails with FK violation
--   (eo_challenge_active_days_source_log_id_fkey) when the voided
--   temp_log is the source of an eo SwimBETTER active-day row.
--   void_challenge_log/void_campaign_log delete the temp_logs row
--   (since 2026-07-19) but the eo challenge (2026-07-29) added a plain
--   FK to temp_logs with no delete handling. campaign_location_credits
--   has the same unhandled FK. Fix: a shared release_temp_log_refs()
--   helper that repoints an active day to another same-day log by the
--   same user (credit legitimately stands) or deletes it (the voided
--   log was its only support), and removes campaign credits sourced
--   from the log; both void functions call it before DELETE.
--   Confirmed live: Dave voiding rodhols' Bakoven log
--   (65af19b7-8307-491f-ae1c-14a1684118af, 14°C, 2026-08-04) errored;
--   both his Bakoven logs are eo active-day sources.

-- Requested by:
--   Dave (rodhols mis-logged a Bakoven temp; void failed in admin)

-- ----------------------------------------------------------------
-- PRE-CHECKS — run on the READ-ONLY connection BEFORE applying.
-- Must include affected-row counts for any UPDATE/DELETE.
-- ----------------------------------------------------------------
-- All FKs referencing temp_logs (expect 5; only eo_challenge_active_days
-- and campaign_location_credits lack ON DELETE SET NULL):
-- SELECT conrelid::regclass, pg_get_constraintdef(oid)
-- FROM pg_constraint WHERE contype='f' AND confrelid='temp_logs'::regclass;
--
-- rodhols' blocked log has an eo row, and he has another log the same
-- SAST day (so his active day will be repointed, not lost):
-- SELECT a.active_date, a.source_log_id,
--        (SELECT count(*) FROM temp_logs t2, temp_logs t
--         WHERE t.id = a.source_log_id AND t2.user_id = a.user_id
--           AND t2.id <> a.source_log_id
--           AND (COALESCE(t2.logged_at,t2.created_at) AT TIME ZONE 'Africa/Johannesburg')::date = a.active_date)
--        AS other_logs_same_day
-- FROM eo_challenge_active_days a
-- WHERE a.source_log_id = '65af19b7-8307-491f-ae1c-14a1684118af';
--   -- expect: 1 row, other_logs_same_day = 1 (Virgin Active Table View)

-- ----------------------------------------------------------------
-- BACKUP — required before any DELETE / UPDATE / DROP / TRUNCATE.
-- ----------------------------------------------------------------
-- Not required: migration only CREATE OR REPLACEs functions; no data
-- rows are touched by applying it. (The void action itself deletes
-- data, but only when an admin clicks Void — unchanged behaviour.)

-- ----------------------------------------------------------------
-- MIGRATION — applied only after Dave types "apply".
-- ----------------------------------------------------------------
BEGIN;

-- Shared cleanup called by both void functions just before they
-- DELETE FROM temp_logs. Handles every FK into temp_logs that has no
-- ON DELETE action. If a future table references temp_logs without
-- ON DELETE SET NULL/CASCADE, add it here.
CREATE OR REPLACE FUNCTION public.release_temp_log_refs(p_log_id uuid)
RETURNS void
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  -- eo SwimBETTER challenge: an active day sourced from the voided log
  -- is deleted only when no other log by that user exists on the same
  -- SAST date; otherwise it is repointed to the earliest other log, so
  -- a genuinely-active day survives the void.
  DELETE FROM eo_challenge_active_days a
  WHERE a.source_log_id = p_log_id
    AND NOT EXISTS (
      SELECT 1 FROM temp_logs t2
      WHERE t2.user_id = a.user_id AND t2.id <> p_log_id
        AND (COALESCE(t2.logged_at, t2.created_at)
             AT TIME ZONE 'Africa/Johannesburg')::date = a.active_date
    );

  UPDATE eo_challenge_active_days a
  SET source_log_id = (
    SELECT t2.id FROM temp_logs t2
    WHERE t2.user_id = a.user_id AND t2.id <> p_log_id
      AND (COALESCE(t2.logged_at, t2.created_at)
           AT TIME ZONE 'Africa/Johannesburg')::date = a.active_date
    ORDER BY COALESCE(t2.logged_at, t2.created_at)
    LIMIT 1
  )
  WHERE a.source_log_id = p_log_id;

  -- UK Swim Spot campaigns: a location credit whose first qualifying
  -- log is voided loses the credit (matches void_campaign_log's intent,
  -- extended to every campaign so no FK can block the delete).
  DELETE FROM campaign_location_credits
  WHERE first_qualifying_log_id = p_log_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.release_temp_log_refs(uuid) FROM public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.void_challenge_log(p_log_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_deleted integer;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM june_challenge_config
                 WHERE id = 1 AND tester_ids @> ARRAY[auth.uid()]::uuid[]) THEN
    RAISE EXCEPTION 'Not authorised to void logs';
  END IF;

  DELETE FROM june_challenge_events
  WHERE ref_id = p_log_id::text AND action_type = 'temp_log';
  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  PERFORM release_temp_log_refs(p_log_id);

  DELETE FROM temp_logs WHERE id = p_log_id;

  RETURN v_deleted;
END;
$function$;

CREATE OR REPLACE FUNCTION public.void_campaign_log(p_campaign_id uuid, p_log_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_deleted_count integer;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_authorized');
  END IF;

  DELETE FROM campaign_location_credits
  WHERE campaign_id = p_campaign_id AND first_qualifying_log_id = p_log_id;
  GET DIAGNOSTICS v_deleted_count = ROW_COUNT;

  PERFORM release_temp_log_refs(p_log_id);

  DELETE FROM temp_logs WHERE id = p_log_id;

  RETURN jsonb_build_object('ok', true, 'credits_removed', v_deleted_count);
END;
$function$;

COMMIT;

-- ----------------------------------------------------------------
-- ROLLBACK — exact SQL to undo, or state:
-- "irreversible — restore from _bak_YYYYMMDD_tablename"
-- ----------------------------------------------------------------
-- DROP FUNCTION public.release_temp_log_refs(uuid);
-- then re-apply sql/applied/2026-07-19_void-log-functions-delete-temp-log.sql
-- (restores both void functions without the PERFORM line).

-- ----------------------------------------------------------------
-- VERIFY — run on the READ-ONLY connection AFTER applying.
-- State the expected result next to each query.
-- ----------------------------------------------------------------
-- SELECT proname FROM pg_proc
-- WHERE proname IN ('release_temp_log_refs','void_challenge_log','void_campaign_log');
--   -- expect: 3 rows
-- SELECT prosrc LIKE '%release_temp_log_refs%' FROM pg_proc WHERE proname='void_challenge_log';
--   -- expect: true
-- Then Dave re-clicks Void on rodhols' Bakoven log in /admin — expect
-- success, and:
-- SELECT active_date, source_log_id FROM eo_challenge_active_days
-- WHERE user_id = (SELECT id FROM profiles WHERE display_name='rodhols')
--   AND active_date = '2026-08-04';
--   -- expect: 1 row, source_log_id = 3d86dc07-... (Virgin Active log)
