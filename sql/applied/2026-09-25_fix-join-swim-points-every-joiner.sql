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
-- Migration: 2026-09-25_fix-join-swim-points-every-joiner.sql
-- Process:   see MIGRATIONS.md — no section below may be left empty
-- ================================================================

-- Purpose:
--   Fix monthly-challenge join points so EVERY joiner of a swim is recorded,
--   not just the first. june_challenge_events is UNIQUE (ref_id, action_type)
--   and _award_challenge_points_core wrote join_swim and creator_bonus events
--   with ref_id = the swim id. The second joiner of any swim therefore hit a
--   unique violation; the function's EXCEPTION handler swallowed it and
--   rolled back, so that swimmer silently got no points or draw entry, and
--   the swim creator's creator_bonus (cap 3 per swim) could never exceed 1.
--   Fix: key those two event types per joiner — ref_id = '<swim id>:<joiner id>'.
--   Scoring rules, points values and the audit trail (challenge_points_audit,
--   which keeps source_record_id = swim id and does the dedup) are unchanged.
--
--   Forward fix ONLY. It does not award points for joins already lost; see
--   P3 for the one September case. Backfilling that is a separate decision.

-- Requested by:
--   Dave (25 Sep 2026, follow-up to the challenge security audit)

-- ----------------------------------------------------------------
-- PRE-CHECKS — run on the READ-ONLY connection BEFORE applying.
-- Must include affected-row counts for any UPDATE/DELETE.
-- ----------------------------------------------------------------
-- No table rows are UPDATEd or DELETEd. One function body is replaced.
--
-- P1. Drift fingerprint of the body this file re-creates (checked again
--     inside the transaction):
-- SELECT md5(prosrc) FROM pg_proc WHERE proname = '_award_challenge_points_core';
-- result: 129a77f99da5618cb41ea5edab207495 (as applied earlier today)
--
-- P2. Nothing else reads join_swim / creator_bonus ref_ids. Every DB function
--     and view that joins june_challenge_events.ref_id (void_challenge_log,
--     fn_remove_temp_log_points, delete_my_temp_log, fn_award_temp_log_points,
--     fn_check_streak_bonus, v_challenge_audit, v_challenge_travel_anomalies,
--     v_challenge_temp_outliers) matches temp_log rows only; no app/admin JS
--     reads ref_id at all. get_challenge_leaders counts rows, not ref_ids.
--
-- P3. Impact this month (approved, non-creator joins since 1 Sep):
--   2 joins, both on the recurring monthly "DUC League Swim"
--   (e71f9ce1-5b22-4c4e-a808-b3ebec19f24b, creator Steve Evans):
--     Yalsha Moodley, 3 Sep  -> recorded (+20, +1 draw entry; Steve +10)
--     Deon Odendaal,  19 Sep -> LOST by this bug (auto-approve path, so the
--                               app did call the award; it collided). Missing:
--                               Deon +20 pts / +1 draw entry, Steve +10 pts.
--   (Deon and Steve's July 31 backup/void concerned two July temp_log events,
--   not joins — unrelated.)
--
-- P4. Objects this file creates must not already exist:
--   _bak_20260925_core_before_join_fix: false

-- ----------------------------------------------------------------
-- BACKUP — required before any DELETE / UPDATE / DROP / TRUNCATE.
-- ----------------------------------------------------------------
-- No row data changes. The exact current definition + ACL is kept for the
-- rollback. RLS on, no policies, no API grants.
CREATE TABLE _bak_20260925_core_before_join_fix AS
SELECT p.oid::regprocedure::text AS name,
       pg_get_functiondef(p.oid) AS definition,
       p.proacl::text            AS acl
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public' AND p.proname = '_award_challenge_points_core';

ALTER TABLE _bak_20260925_core_before_join_fix ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON _bak_20260925_core_before_join_fix FROM PUBLIC, anon, authenticated;

-- ----------------------------------------------------------------
-- MIGRATION — applied only after Dave types "apply".
-- ----------------------------------------------------------------
BEGIN;

DO $$
BEGIN
  IF (SELECT md5(p.prosrc) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND p.proname = '_award_challenge_points_core')
     IS DISTINCT FROM '129a77f99da5618cb41ea5edab207495' THEN
    RAISE EXCEPTION '_award_challenge_points_core changed since dry-run. Re-read it and redo the dry-run.';
  END IF;
  IF (SELECT count(*) FROM _bak_20260925_core_before_join_fix) <> 1 THEN
    RAISE EXCEPTION 'Backup missing. Aborting.';
  END IF;
END $$;

-- Same function, same signature; only steps 8 and 9 change (event ref_id).
-- CREATE OR REPLACE keeps the existing grants (no anon / authenticated).
CREATE OR REPLACE FUNCTION public._award_challenge_points_core(p_user_id uuid, p_action_type text, p_source_table text DEFAULT NULL::text, p_source_record_id text DEFAULT NULL::text, p_metadata jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_config          june_challenge_config%ROWTYPE;
  v_points          integer;
  v_display_name    text;
  v_spot_id         uuid;
  v_spot_name       text;
  v_total_points    integer;
  v_draw_entries    integer;
  v_count           integer;
  v_creator_id      uuid;
  v_creator_name    text;
  v_creator_pts     integer;
  v_creator_count   integer;
  v_ref             uuid;
  v_verified        boolean;
  v_log_spot_id     uuid;
BEGIN
  -- 1. Load config
  SELECT * INTO v_config FROM june_challenge_config WHERE id = 1;
  IF NOT FOUND OR NOT v_config.enabled THEN
    RETURN jsonb_build_object('awarded', false, 'reason', 'challenge_not_active');
  END IF;

  -- 2. Check date window (test_mode bypasses window check)
  IF NOT v_config.test_mode THEN
    IF CURRENT_DATE < v_config.launch_date OR CURRENT_DATE > v_config.end_date THEN
      RETURN jsonb_build_object('awarded', false, 'reason', 'outside_challenge_window');
    END IF;
  END IF;

  -- 3. Check disqualification
  IF EXISTS (
    SELECT 1 FROM challenge_admin_flags
    WHERE challenge_id = 1 AND user_id = p_user_id AND disqualified = true
  ) THEN
    INSERT INTO challenge_points_audit
      (challenge_id, user_id, action_type, source_table, source_record_id,
       points_awarded, points_status, rejection_reason, metadata)
    VALUES
      (1, p_user_id, p_action_type, p_source_table, p_source_record_id,
       0, 'rejected', 'disqualified', p_metadata);
    RETURN jsonb_build_object('awarded', false, 'reason', 'disqualified');
  END IF;

  -- 4. Resolve points for action type
  v_points := CASE p_action_type
    WHEN 'temp_log'       THEN v_config.pts_temp_log
    WHEN 'create_swim'    THEN v_config.pts_create_swim
    WHEN 'join_swim'      THEN v_config.pts_join_swim
    WHEN 'creator_bonus'  THEN v_config.pts_creator_bonus
    WHEN 'whatsapp_share' THEN v_config.pts_whatsapp_share
    WHEN 'streak_3day'    THEN v_config.pts_streak_3day
    WHEN 'streak_7day'    THEN v_config.pts_streak_7day
    ELSE NULL
  END;

  IF v_points IS NULL THEN
    RETURN jsonb_build_object('awarded', false, 'reason', 'unknown_action_type');
  END IF;

  -- 4b. Verify the source record is real and belongs to p_user_id (added
  --     2026-09-25). Before this, p_source_record_id and p_metadata.spot_id
  --     came from the client unchecked, so a fresh random id per call minted
  --     unlimited join_swim / temp_log points and draw entries.
  IF p_action_type IN ('temp_log', 'create_swim', 'join_swim') THEN
    BEGIN
      v_ref := p_source_record_id::uuid;
    EXCEPTION WHEN invalid_text_representation THEN
      v_ref := NULL;
    END;

    v_verified := false;
    IF v_ref IS NOT NULL THEN
      IF p_action_type = 'temp_log' THEN
        SELECT t.spot_id INTO v_log_spot_id
        FROM temp_logs t
        WHERE t.id = v_ref AND t.user_id = p_user_id
          AND t.created_at > now() - interval '1 day';
        v_verified := FOUND;
        IF v_verified THEN
          -- The per-spot-per-day rule below must use the log's real spot.
          p_metadata := COALESCE(p_metadata, '{}'::jsonb) || jsonb_build_object('spot_id', v_log_spot_id);
        END IF;
      ELSIF p_action_type = 'create_swim' THEN
        v_verified := EXISTS (
          SELECT 1 FROM swim_events se
          WHERE se.id = v_ref AND se.created_by = p_user_id
            AND se.created_at > now() - interval '1 day');
      ELSIF p_action_type = 'join_swim' THEN
        v_verified := EXISTS (
          SELECT 1 FROM swim_participants sp
          WHERE sp.swim_event_id = v_ref AND sp.user_id = p_user_id
            AND sp.status = 'approved');
      END IF;
    END IF;

    IF NOT v_verified THEN
      INSERT INTO challenge_points_audit
        (challenge_id, user_id, action_type, source_table, source_record_id,
         points_awarded, points_status, rejection_reason, metadata)
      VALUES
        (1, p_user_id, p_action_type, p_source_table, p_source_record_id,
         0, 'rejected', 'source_not_verified', p_metadata);
      RETURN jsonb_build_object('awarded', false, 'reason', 'source_not_verified');
    END IF;
  END IF;

  -- 5. Resolve display name + spot info
  SELECT display_name INTO v_display_name FROM profiles WHERE id = p_user_id;

  IF p_metadata ? 'spot_id' AND p_metadata->>'spot_id' IS NOT NULL THEN
    BEGIN
      v_spot_id := (p_metadata->>'spot_id')::uuid;
      SELECT name INTO v_spot_name FROM spots WHERE id = v_spot_id;
    EXCEPTION WHEN others THEN
      v_spot_id := NULL;
      v_spot_name := p_metadata->>'spot_name';
    END;
  ELSE
    v_spot_name := p_metadata->>'spot_name';
  END IF;

  -- 6. Anti-gaming rules per action type ──────────────────────────────────────

  -- temp_log: one point per SPOT per calendar day (UTC) — multiple spots = multiple points
  IF p_action_type = 'temp_log' THEN
    SELECT COUNT(*) INTO v_count
    FROM challenge_points_audit
    WHERE challenge_id = 1
      AND user_id = p_user_id
      AND action_type = 'temp_log'
      AND points_status = 'awarded'
      AND (awarded_at AT TIME ZONE 'UTC')::date = (now() AT TIME ZONE 'UTC')::date
      AND COALESCE(metadata->>'spot_id', '') = COALESCE(p_metadata->>'spot_id', '');

    IF v_count > 0 THEN
      INSERT INTO challenge_points_audit
        (challenge_id, user_id, action_type, source_table, source_record_id,
         points_awarded, points_status, rejection_reason, metadata)
      VALUES
        (1, p_user_id, p_action_type, p_source_table, p_source_record_id,
         0, 'rejected', 'already_earned_today_this_spot', p_metadata);
      RETURN jsonb_build_object('awarded', false, 'reason', 'already_earned_today_this_spot');
    END IF;
  END IF;

  -- create_swim and whatsapp_share: one per day
  IF p_action_type IN ('create_swim', 'whatsapp_share') THEN
    SELECT COUNT(*) INTO v_count
    FROM challenge_points_audit
    WHERE challenge_id = 1
      AND user_id = p_user_id
      AND action_type = p_action_type
      AND points_status = 'awarded'
      AND (awarded_at AT TIME ZONE 'UTC')::date = (now() AT TIME ZONE 'UTC')::date;

    IF v_count > 0 THEN
      INSERT INTO challenge_points_audit
        (challenge_id, user_id, action_type, source_table, source_record_id,
         points_awarded, points_status, rejection_reason, metadata)
      VALUES
        (1, p_user_id, p_action_type, p_source_table, p_source_record_id,
         0, 'rejected', 'already_earned_today', p_metadata);
      RETURN jsonb_build_object('awarded', false, 'reason', 'already_earned_today');
    END IF;
  END IF;

  -- join_swim rules: not own swim, not already joined this swim
  IF p_action_type = 'join_swim' THEN
    SELECT created_by INTO v_creator_id
    FROM swim_events WHERE id = p_source_record_id::uuid;

    IF v_creator_id = p_user_id THEN
      INSERT INTO challenge_points_audit
        (challenge_id, user_id, action_type, source_table, source_record_id,
         points_awarded, points_status, rejection_reason, metadata)
      VALUES
        (1, p_user_id, p_action_type, p_source_table, p_source_record_id,
         0, 'rejected', 'own_swim', p_metadata);
      RETURN jsonb_build_object('awarded', false, 'reason', 'own_swim');
    END IF;

    SELECT COUNT(*) INTO v_count
    FROM challenge_points_audit
    WHERE challenge_id = 1
      AND user_id = p_user_id
      AND action_type = 'join_swim'
      AND source_record_id = p_source_record_id
      AND points_status = 'awarded';

    IF v_count > 0 THEN
      INSERT INTO challenge_points_audit
        (challenge_id, user_id, action_type, source_table, source_record_id,
         points_awarded, points_status, rejection_reason, metadata)
      VALUES
        (1, p_user_id, p_action_type, p_source_table, p_source_record_id,
         0, 'rejected', 'already_joined', p_metadata);
      RETURN jsonb_build_object('awarded', false, 'reason', 'already_joined');
    END IF;
  END IF;

  -- creator_bonus: cap per swim, joiner != creator
  IF p_action_type = 'creator_bonus' THEN
    IF (p_metadata->>'joining_user_id')::uuid = p_user_id THEN
      INSERT INTO challenge_points_audit
        (challenge_id, user_id, action_type, source_table, source_record_id,
         points_awarded, points_status, rejection_reason, metadata)
      VALUES
        (1, p_user_id, p_action_type, p_source_table, p_source_record_id,
         0, 'rejected', 'self_join', p_metadata);
      RETURN jsonb_build_object('awarded', false, 'reason', 'self_join');
    END IF;

    SELECT COUNT(*) INTO v_count
    FROM challenge_points_audit
    WHERE challenge_id = 1
      AND user_id = p_user_id
      AND action_type = 'creator_bonus'
      AND source_record_id = p_source_record_id
      AND points_status = 'awarded';

    IF v_count >= v_config.pts_creator_bonus_cap THEN
      INSERT INTO challenge_points_audit
        (challenge_id, user_id, action_type, source_table, source_record_id,
         points_awarded, points_status, rejection_reason, metadata)
      VALUES
        (1, p_user_id, p_action_type, p_source_table, p_source_record_id,
         0, 'rejected', 'creator_bonus_cap_reached', p_metadata);
      RETURN jsonb_build_object('awarded', false, 'reason', 'creator_bonus_cap_reached');
    END IF;
  END IF;

  -- streak awards: once per challenge period
  IF p_action_type IN ('streak_3day', 'streak_7day') THEN
    SELECT COUNT(*) INTO v_count
    FROM challenge_points_audit
    WHERE challenge_id = 1
      AND user_id = p_user_id
      AND action_type = p_action_type
      AND points_status = 'awarded';

    IF v_count > 0 THEN
      RETURN jsonb_build_object('awarded', false, 'reason', 'streak_already_awarded');
    END IF;
  END IF;

  -- 7. Insert awarded audit record
  INSERT INTO challenge_points_audit
    (challenge_id, user_id, action_type, source_table, source_record_id,
     points_awarded, points_status, metadata)
  VALUES
    (1, p_user_id, p_action_type, p_source_table, p_source_record_id,
     v_points, 'awarded', p_metadata);

  -- 8. Insert into june_challenge_events for live feed
  --    join_swim is keyed per joiner (swim:user). The table is UNIQUE
  --    (ref_id, action_type), so keying by the swim alone meant only the FIRST
  --    joiner of each swim was ever recorded; later joiners hit a unique
  --    violation, fell into the EXCEPTION handler and lost their points
  --    silently (fixed 2026-09-25).
  INSERT INTO june_challenge_events
    (user_id, display_name, action_type, points, spot_id, spot_name, ref_id, metadata)
  VALUES
    (p_user_id, v_display_name, p_action_type, v_points,
     v_spot_id, v_spot_name,
     CASE WHEN p_action_type = 'join_swim'
          THEN p_source_record_id || ':' || p_user_id::text
          ELSE p_source_record_id END,
     p_metadata);

  -- 9. For join_swim: award creator_bonus to the swim creator (inline, non-recursive)
  IF p_action_type = 'join_swim' AND v_creator_id IS NOT NULL AND v_creator_id != p_user_id THEN
    IF NOT EXISTS (
      SELECT 1 FROM challenge_admin_flags
      WHERE challenge_id = 1 AND user_id = v_creator_id AND disqualified = true
    ) THEN
      SELECT COUNT(*) INTO v_creator_count
      FROM challenge_points_audit
      WHERE challenge_id = 1
        AND user_id = v_creator_id
        AND action_type = 'creator_bonus'
        AND source_record_id = p_source_record_id
        AND points_status = 'awarded';

      IF v_creator_count < v_config.pts_creator_bonus_cap THEN
        v_creator_pts := v_config.pts_creator_bonus;
        SELECT display_name INTO v_creator_name FROM profiles WHERE id = v_creator_id;

        INSERT INTO challenge_points_audit
          (challenge_id, user_id, action_type, source_table, source_record_id,
           points_awarded, points_status, metadata)
        VALUES
          (1, v_creator_id, 'creator_bonus', 'swim_events', p_source_record_id,
           v_creator_pts, 'awarded', jsonb_build_object('joining_user_id', p_user_id));

        -- One creator_bonus event per (swim, joiner), same reason as step 8.
        INSERT INTO june_challenge_events
          (user_id, display_name, action_type, points, ref_id, metadata)
        VALUES
          (v_creator_id, v_creator_name, 'creator_bonus', v_creator_pts,
           p_source_record_id || ':' || p_user_id::text,
           jsonb_build_object('joining_user_id', p_user_id));
      ELSE
        INSERT INTO challenge_points_audit
          (challenge_id, user_id, action_type, source_table, source_record_id,
           points_awarded, points_status, rejection_reason, metadata)
        VALUES
          (1, v_creator_id, 'creator_bonus', 'swim_events', p_source_record_id,
           0, 'rejected', 'creator_bonus_cap_reached', jsonb_build_object('joining_user_id', p_user_id));
      END IF;
    END IF;
  END IF;

  -- 10. Trigger streak calculation after temp_log or join_swim awards
  IF p_action_type IN ('temp_log', 'join_swim') THEN
    PERFORM calculate_challenge_streak(p_user_id);
  END IF;

  -- 11. Return total points and draw entries
  SELECT COALESCE(SUM(points_awarded), 0) INTO v_total_points
  FROM challenge_points_audit
  WHERE challenge_id = 1
    AND user_id = p_user_id
    AND points_status = 'awarded';

  v_draw_entries := LEAST(v_total_points, v_config.draw_entry_cap);

  RETURN jsonb_build_object(
    'awarded',        true,
    'points',         v_points,
    'total_points',   v_total_points,
    'draw_entries',   v_draw_entries
  );

EXCEPTION WHEN others THEN
  RAISE WARNING 'award_challenge_points error user=% action=%: %', p_user_id, p_action_type, SQLERRM;
  RETURN jsonb_build_object('awarded', false, 'reason', 'internal_error', 'error', SQLERRM);
END;
$function$;

COMMIT;

-- ----------------------------------------------------------------
-- ROLLBACK — exact SQL to undo, or state:
-- "irreversible — restore from _bak_YYYYMMDD_tablename"
-- ----------------------------------------------------------------
-- Restores the first-joiner-only behaviour. Any join events written in the
-- new '<swim>:<user>' format stay valid rows (they still count on the board).
--
-- DO $$ BEGIN
--   EXECUTE (SELECT definition FROM _bak_20260925_core_before_join_fix);
-- END $$;

-- ----------------------------------------------------------------
-- VERIFY — run on the READ-ONLY connection AFTER applying.
-- State the expected result next to each query.
-- ----------------------------------------------------------------
-- V1. New keying present, grants unchanged:
-- SELECT (length(prosrc) - length(replace(prosrc, 'p_source_record_id || '':'' || p_user_id::text', '')))
--          / length('p_source_record_id || '':'' || p_user_id::text') AS per_joiner_keys,
--        has_function_privilege('anon', oid, 'EXECUTE')          AS anon_exec,
--        has_function_privilege('authenticated', oid, 'EXECUTE') AS auth_exec
--   FROM pg_proc WHERE proname = '_award_challenge_points_core';
-- expect: 2, false, false
--
-- V2. Live: the next time a SECOND person joins a swim this month, both a
--     join_swim event (ref '<swim>:<joiner>') and, if the creator is under
--     the cap of 3, a creator_bonus event appear:
-- SELECT action_type, ref_id, user_id, created_at FROM june_challenge_events
--  WHERE action_type IN ('join_swim','creator_bonus') AND created_at >= '2026-09-25'
--  ORDER BY created_at;
--
-- V3. Standing reconciliation, updated for the new ref format (should be 0):
-- SELECT count(*) FROM june_challenge_events e
--  WHERE e.created_at >= '2026-09-01 00:00+02' AND e.source <> 'trigger'
--    AND e.action_type = 'join_swim'
--    AND NOT EXISTS (SELECT 1 FROM swim_participants sp
--                     WHERE sp.swim_event_id::text = split_part(e.ref_id, ':', 1)
--                       AND sp.user_id = e.user_id);
-- expect: 0
--
-- APPLIED 2026-09-25 ~14:36 UTC via supabase-admin apply_migration
-- (2026_09_25_fix_join_swim_points_every_joiner), after Dave typed "apply".
-- Applied WITHOUT a backfill: Deon Odendaal's 19 Sep join (+20 / +1 entry)
-- and Steve Evans' matching creator bonus (+10) remain unrecorded unless Dave
-- decides otherwise. V1 pass (2, false, false); live body md5
-- 079dcc20c6608d46e3664a831c286742 = this file. V3 pass (0). V2 pending the
-- next second-joiner of a swim.
