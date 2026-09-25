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
-- Migration: 2026-09-25_lock-down-challenge-scoring-functions.sql
-- Process:   see MIGRATIONS.md — no section below may be left empty
-- ================================================================

-- Purpose:
--   Close the monthly-challenge (app-june.js engine) scoring holes found in
--   the 25 Sep 2026 public-function audit. The September Maurten challenge is
--   LIVE (june_challenge_config: enabled, 2026-09-01..09-30, test_mode off),
--   and get_challenge_leaders() reads june_challenge_events for points AND
--   draw entries, so every hole below writes straight onto the prize board.
--
--   Holes (all SECURITY DEFINER, all EXECUTE-able by anon via PUBLIC + anon
--   grants, none checks who is calling):
--     1. award_challenge_points — awards any p_user_id. Also trusts the
--        client's p_source_record_id and p_metadata.spot_id, so even a
--        logged-in user awarding THEMSELVES can mint unlimited points and
--        draw entries (fresh random ref per join_swim; fresh random spot_id
--        per temp_log; direct streak_3day/7day/creator_bonus calls).
--     2. admin_reinstate_user   — anyone un-disqualifies anyone.
--     3. admin_disqualify_user  — anyone disqualifies anyone (worse: knocks a
--        real swimmer out of the live draw).
--     4. admin_reverse_points   — anyone reverses any audit row.
--     5. admin_confirm_flag / admin_dismiss_flag / detect_challenge_flags —
--        anyone edits the admin flag queue.
--     6. calculate_challenge_streak / fn_check_streak_bonus — internal
--        helpers, anon-callable for any user id (only award earned streaks,
--        but have no reason to be public).
--   Plus one RLS hole on the same board:
--     7. june_challenge_events policy jce_insert_own lets ANY logged-in user
--        INSERT their own rows directly with any action_type and any points.
--        Only legitimate use: the admin "Seed Test" button (app-june.js
--        jcSeedTestData, test_mode only).
--
--   Fix:
--     A. Split award_challenge_points into
--          _award_challenge_points_core  (the existing body, plus source-record
--                                         verification; NOT callable by clients)
--          award_challenge_points        (public wrapper: auth.uid() must be
--                                         p_user_id; only temp_log / create_swim
--                                         / join_swim / whatsapp_share)
--        calculate_challenge_streak now calls the core, so streak awards keep
--        working while direct streak/creator_bonus calls are refused.
--     B. is_admin guard (same test as admin_reinstate_campaign_user) on the six
--        admin/flag functions; acting admin id recorded in the audit metadata.
--     C. REVOKE EXECUTE from PUBLIC + anon everywhere; also from authenticated
--        on the three internal helpers.
--     D. jce_insert_own -> admin-only, test_mode-only insert policy.
--
--   Unchanged on purpose: the temp_logs trigger path (fn_award_temp_log_points,
--   SECURITY DEFINER, runs as owner) that gives almost all real temp_log points;
--   all scoring rules, points values and dedup rules; function signatures and
--   return shapes (no app.js / app-june.js / app-strava.js change needed).

-- Requested by:
--   Dave (security audit, 25 Sep 2026)

-- ----------------------------------------------------------------
-- PRE-CHECKS — run on the READ-ONLY connection BEFORE applying.
-- Must include affected-row counts for any UPDATE/DELETE.
-- ----------------------------------------------------------------
-- No table rows are UPDATEd or DELETEd. Changes are function bodies, grants
-- and one RLS policy. Dry-run results (25 Sep 2026) noted under each query.
--
-- P1. Exposure today — every one of these is anon-executable:
-- SELECT p.proname, has_function_privilege('anon', p.oid, 'EXECUTE') anon_exec,
--        has_function_privilege('authenticated', p.oid, 'EXECUTE') auth_exec,
--        pg_get_userbyid(p.proowner) owner
--   FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--  WHERE n.nspname = 'public' AND p.proname IN
--    ('award_challenge_points','calculate_challenge_streak','fn_check_streak_bonus',
--     'admin_reinstate_user','admin_disqualify_user','admin_reverse_points',
--     'admin_confirm_flag','admin_dismiss_flag','detect_challenge_flags');
-- result: 9 rows, all anon_exec = true, auth_exec = true, owner = postgres
--
-- P2. Drift fingerprint of the 8 bodies this file re-creates (the migration
--     aborts if this changes between dry-run and apply):
-- SELECT md5(string_agg(p.prosrc, '|' ORDER BY p.proname))
--   FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--  WHERE n.nspname = 'public' AND p.proname IN
--    ('award_challenge_points','calculate_challenge_streak','admin_reinstate_user',
--     'admin_disqualify_user','admin_reverse_points','admin_confirm_flag',
--     'admin_dismiss_flag','detect_challenge_flags');
-- result: ff9847035b59123671ae888bdfc50150
--
-- P3. Callers (repo grep + pg_proc.prosrc search):
--   award_challenge_points   <- app-june.js:122 jcAwardPoints (authenticated,
--                               always p_user_id = currentUser.id), fed by
--                               app.js:8596 temp_log, app.js:3664 create_swim,
--                               app.js:4998 join_swim (status 'approved' only),
--                               app-strava.js:602 temp_log, app-june.js:210
--                               whatsapp_share; and calculate_challenge_streak
--                               (streak_3day / streak_7day). No trigger, no
--                               api/ route, no service-role caller.
--   calculate_challenge_streak <- award_challenge_points only.
--   fn_check_streak_bonus    <- trigger fn fn_award_temp_log_points only.
--   admin_confirm_flag / admin_dismiss_flag / detect_challenge_flags
--                            <- app-june.js:846-868 admin debug panel (Dave).
--   admin_reinstate_user / admin_disqualify_user / admin_reverse_points
--                            <- no caller anywhere (admin.html uses the
--                               *_campaign_user variants, already guarded).
--   june_challenge_events INSERT from a client <- app-june.js:700
--                               jcSeedTestData only (refuses unless test_mode).
--
-- P4. Only admin today: SELECT id, display_name FROM profiles WHERE is_admin;
-- result: 1 row — df137255-3add-4153-b368-32e06e2be188 (KGB / Dave)
--
-- P5. Has any of this been abused? (all-time)
--   - challenge_points_audit admin_action / admin_reversal rows: 0
--     (no disqualify / reinstate / reversal has ever run, by anyone)
--   - challenge_admin_flags rows: 0
--   - non-trigger june_challenge_events whose ref is not the user's own
--     temp_log / approved join / created swim: 0
--   - September non-trigger events: 12 — 10 temp_log for KGB (own logs; KGB
--     is in tester_ids so the trigger skips him and the RPC awards him),
--     1 join_swim (Yalsha Moodley, real approved join), 1 creator_bonus
--     (Steve Evans, creator of that swim). All legitimate.
--   - One June 2026 creator_bonus event (Tunnan, 10 pts, real swim + real
--     creator) has no matching audit row. Consistent with the legitimate
--     inline path; not explained further. June is closed.
--
-- P6. Objects this file creates must not already exist:
--   _award_challenge_points_core: false; _bak_20260925_challenge_fn_security: false
--
-- P7. Dependencies for the new insert policy: profiles_select_own
--     (auth.uid() = id) and jcc_read_all (true) exist for authenticated;
--     june_challenge_events FORCE RLS = false and postgres rolbypassrls = true,
--     so SECURITY DEFINER writers are unaffected by the policy change.

-- ----------------------------------------------------------------
-- BACKUP — required before any DELETE / UPDATE / DROP / TRUNCATE.
-- ----------------------------------------------------------------
-- No row data changes. This migration DROPs one policy and REPLACEs function
-- bodies, so the exact pre-migration definitions and ACLs are kept here for
-- the rollback. RLS on, no policies, no API grants: invisible to clients.
CREATE TABLE _bak_20260925_challenge_fn_security AS
SELECT 'function'::text                 AS kind,
       p.oid::regprocedure::text        AS name,
       pg_get_functiondef(p.oid)        AS definition,
       p.proacl::text                   AS acl
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public'
   AND p.proname IN ('award_challenge_points','calculate_challenge_streak',
                     'fn_check_streak_bonus','admin_reinstate_user',
                     'admin_disqualify_user','admin_reverse_points',
                     'admin_confirm_flag','admin_dismiss_flag',
                     'detect_challenge_flags')
UNION ALL
SELECT 'policy', pol.polname,
       pg_get_expr(pol.polwithcheck, pol.polrelid),
       pol.polroles::regrole[]::text
  FROM pg_policy pol
 WHERE pol.polrelid = 'public.june_challenge_events'::regclass
   AND pol.polname = 'jce_insert_own';

ALTER TABLE _bak_20260925_challenge_fn_security ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON _bak_20260925_challenge_fn_security FROM PUBLIC, anon, authenticated;

-- ----------------------------------------------------------------
-- MIGRATION — applied only after Dave types "apply".
-- ----------------------------------------------------------------
BEGIN;

-- Drift guard: abort if any body changed since the dry-run, or if the backup
-- did not capture all 9 functions + the policy.
DO $$
DECLARE
  v_md5 text;
  v_bak integer;
BEGIN
  SELECT md5(string_agg(p.prosrc, '|' ORDER BY p.proname)) INTO v_md5
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname IN
     ('award_challenge_points','calculate_challenge_streak','admin_reinstate_user',
      'admin_disqualify_user','admin_reverse_points','admin_confirm_flag',
      'admin_dismiss_flag','detect_challenge_flags');
  IF v_md5 IS DISTINCT FROM 'ff9847035b59123671ae888bdfc50150' THEN
    RAISE EXCEPTION 'Challenge function bodies changed since dry-run (md5 %). Re-read them and redo the dry-run.', v_md5;
  END IF;

  SELECT count(*) INTO v_bak FROM _bak_20260925_challenge_fn_security;
  IF v_bak <> 10 THEN
    RAISE EXCEPTION 'Backup has % rows, expected 10 (9 functions + 1 policy). Aborting.', v_bak;
  END IF;
END $$;

-- ── A1. Core scoring function (previous award_challenge_points body + 4b) ──
-- Not callable by clients (grants revoked below). Reached only through the
-- award_challenge_points wrapper and calculate_challenge_streak.
CREATE FUNCTION public._award_challenge_points_core(p_user_id uuid, p_action_type text, p_source_table text DEFAULT NULL::text, p_source_record_id text DEFAULT NULL::text, p_metadata jsonb DEFAULT '{}'::jsonb)
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
  INSERT INTO june_challenge_events
    (user_id, display_name, action_type, points, spot_id, spot_name, ref_id, metadata)
  VALUES
    (p_user_id, v_display_name, p_action_type, v_points,
     v_spot_id, v_spot_name, p_source_record_id, p_metadata);

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

        INSERT INTO june_challenge_events
          (user_id, display_name, action_type, points, ref_id, metadata)
        VALUES
          (v_creator_id, v_creator_name, 'creator_bonus', v_creator_pts, p_source_record_id,
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

-- ── A2. Public wrapper — same signature and return shape as before ────────
-- app-june.js jcAwardPoints calls this. Callers may only award THEMSELVES,
-- and only for things they do in the app. creator_bonus and streak_* are
-- awarded internally (core step 9, calculate_challenge_streak).
CREATE OR REPLACE FUNCTION public.award_challenge_points(p_user_id uuid, p_action_type text, p_source_table text DEFAULT NULL::text, p_source_record_id text DEFAULT NULL::text, p_metadata jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('awarded', false, 'reason', 'not_authenticated');
  END IF;

  IF p_user_id IS DISTINCT FROM auth.uid() THEN
    RETURN jsonb_build_object('awarded', false, 'reason', 'not_authorized');
  END IF;

  IF p_action_type IS NULL
     OR p_action_type NOT IN ('temp_log', 'create_swim', 'join_swim', 'whatsapp_share') THEN
    RETURN jsonb_build_object('awarded', false, 'reason', 'not_client_awardable');
  END IF;

  RETURN _award_challenge_points_core(p_user_id, p_action_type, p_source_table,
                                      p_source_record_id, p_metadata);
END;
$function$;

-- ── A3. Streaks go through the core (only change: two PERFORM targets) ────
CREATE OR REPLACE FUNCTION public.calculate_challenge_streak(p_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_config           june_challenge_config%ROWTYPE;
  v_dates            date[];
  v_prev_date        date;
  v_d                date;
  v_current_streak   integer := 1;
  v_max_streak       integer := 0;
  v_streak_3_awarded boolean := false;
  v_streak_7_awarded boolean := false;
BEGIN
  SELECT * INTO v_config FROM june_challenge_config WHERE id = 1;
  IF NOT FOUND OR NOT v_config.enabled THEN
    RETURN jsonb_build_object('current_streak', 0, 'max_streak', 0);
  END IF;

  -- Check which streak awards already exist for this user this challenge
  SELECT EXISTS (
    SELECT 1 FROM challenge_points_audit
    WHERE challenge_id = 1 AND user_id = p_user_id
      AND action_type = 'streak_3day' AND points_status = 'awarded'
  ) INTO v_streak_3_awarded;

  SELECT EXISTS (
    SELECT 1 FROM challenge_points_audit
    WHERE challenge_id = 1 AND user_id = p_user_id
      AND action_type = 'streak_7day' AND points_status = 'awarded'
  ) INTO v_streak_7_awarded;

  -- Get distinct awarded temp_log days in challenge window
  SELECT ARRAY_AGG(DISTINCT log_date ORDER BY log_date ASC) INTO v_dates
  FROM (
    SELECT (awarded_at AT TIME ZONE 'UTC')::date AS log_date
    FROM challenge_points_audit
    WHERE challenge_id = 1
      AND user_id = p_user_id
      AND action_type = 'temp_log'
      AND points_status = 'awarded'
      AND (awarded_at AT TIME ZONE 'UTC')::date >= v_config.launch_date
      AND (awarded_at AT TIME ZONE 'UTC')::date <= v_config.end_date
  ) t;

  IF v_dates IS NULL OR array_length(v_dates, 1) = 0 THEN
    RETURN jsonb_build_object(
      'current_streak',      0,
      'max_streak',          0,
      'streak_3day_awarded', v_streak_3_awarded,
      'streak_7day_awarded', v_streak_7_awarded
    );
  END IF;

  -- Walk dates to find max consecutive streak
  v_prev_date := NULL;
  v_current_streak := 1;
  v_max_streak := 1;

  FOREACH v_d IN ARRAY v_dates LOOP
    IF v_prev_date IS NOT NULL THEN
      IF v_d = v_prev_date + 1 THEN
        v_current_streak := v_current_streak + 1;
      ELSE
        v_current_streak := 1;
      END IF;
      IF v_current_streak > v_max_streak THEN
        v_max_streak := v_current_streak;
      END IF;
    END IF;
    v_prev_date := v_d;
  END LOOP;

  -- Award streak_7day first (higher value) if earned and not yet awarded
  IF v_max_streak >= 7 AND NOT v_streak_7_awarded THEN
    PERFORM _award_challenge_points_core(p_user_id, 'streak_7day', NULL, NULL, '{}'::jsonb);
    v_streak_7_awarded := true;
  END IF;

  -- Award streak_3day if earned and not yet awarded
  IF v_max_streak >= 3 AND NOT v_streak_3_awarded THEN
    PERFORM _award_challenge_points_core(p_user_id, 'streak_3day', NULL, NULL, '{}'::jsonb);
    v_streak_3_awarded := true;
  END IF;

  RETURN jsonb_build_object(
    'current_streak',      v_current_streak,
    'max_streak',          v_max_streak,
    'streak_3day_awarded', v_streak_3_awarded,
    'streak_7day_awarded', v_streak_7_awarded
  );
END;
$function$;

-- ── B. is_admin guard on the admin / flag functions ───────────────────────
-- Same check as admin_reinstate_campaign_user. These return void, so a
-- refusal RAISEs (the app-june.js buttons already surface `error` in a toast).

CREATE OR REPLACE FUNCTION public.admin_reinstate_user(p_user_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;

  UPDATE challenge_admin_flags
  SET disqualified = false, status = 'dismissed', updated_at = now()
  WHERE challenge_id = 1 AND user_id = p_user_id;
  INSERT INTO challenge_points_audit (challenge_id, user_id, action_type, points_awarded, points_status, metadata)
  VALUES (1, p_user_id, 'admin_action', 0, 'awarded', jsonb_build_object('action', 'reinstate', 'admin_id', auth.uid()));
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_disqualify_user(p_user_id uuid, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;

  INSERT INTO challenge_admin_flags
    (challenge_id, user_id, flag_type, severity, description, disqualified, status)
  VALUES
    (1, p_user_id, 'manual_disqualification', 'high', p_reason, true, 'confirmed')
  ON CONFLICT (challenge_id, user_id, flag_type) DO UPDATE
  SET disqualified = true, description = EXCLUDED.description, status = 'confirmed', updated_at = now();
  INSERT INTO challenge_points_audit (challenge_id, user_id, action_type, points_awarded, points_status, metadata)
  VALUES (1, p_user_id, 'admin_action', 0, 'awarded', jsonb_build_object('action', 'disqualify', 'reason', p_reason, 'admin_id', auth.uid()));
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_reverse_points(p_audit_id uuid, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_row challenge_points_audit%ROWTYPE;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_row FROM challenge_points_audit WHERE id = p_audit_id;
  IF NOT FOUND THEN RETURN; END IF;
  UPDATE challenge_points_audit SET points_status = 'reversed', updated_at = now() WHERE id = p_audit_id;
  INSERT INTO challenge_points_audit (challenge_id, user_id, action_type, points_awarded, points_status, metadata)
  VALUES (1, v_row.user_id, 'admin_reversal', 0, 'awarded',
    jsonb_build_object('reversed_audit_id', p_audit_id, 'original_action', v_row.action_type,
                       'original_points', v_row.points_awarded, 'reason', p_reason,
                       'admin_id', auth.uid()));
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_confirm_flag(p_flag_id uuid, p_notes text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;

  UPDATE challenge_admin_flags
  SET status = 'confirmed', admin_notes = COALESCE(p_notes, admin_notes), updated_at = now()
  WHERE id = p_flag_id;
  INSERT INTO challenge_points_audit (challenge_id, user_id, action_type, points_awarded, points_status, metadata)
  SELECT challenge_id, user_id, 'admin_action', 0, 'awarded',
    jsonb_build_object('action', 'confirm_flag', 'flag_id', p_flag_id, 'admin_id', auth.uid())
  FROM challenge_admin_flags WHERE id = p_flag_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_dismiss_flag(p_flag_id uuid, p_notes text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;

  UPDATE challenge_admin_flags
  SET status = 'dismissed', admin_notes = COALESCE(p_notes, admin_notes), updated_at = now()
  WHERE id = p_flag_id;
  INSERT INTO challenge_points_audit (challenge_id, user_id, action_type, points_awarded, points_status, metadata)
  SELECT challenge_id, user_id, 'admin_action', 0, 'awarded',
    jsonb_build_object('action', 'dismiss_flag', 'flag_id', p_flag_id, 'notes', p_notes, 'admin_id', auth.uid())
  FROM challenge_admin_flags WHERE id = p_flag_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.detect_challenge_flags()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_row   record;
  v_count integer := 0;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;

  FOR v_row IN SELECT * FROM challenge_unusual_activity LOOP
    INSERT INTO challenge_admin_flags
      (challenge_id, user_id, flag_type, severity, description,
       related_action_count, first_seen_at, last_seen_at, status)
    VALUES
      (1, v_row.user_id, v_row.flag_type, v_row.severity, v_row.description,
       v_row.related_action_count, v_row.first_seen_at, v_row.last_seen_at, 'open')
    ON CONFLICT (challenge_id, user_id, flag_type) DO UPDATE SET
      related_action_count = EXCLUDED.related_action_count,
      last_seen_at         = EXCLUDED.last_seen_at,
      severity             = EXCLUDED.severity,
      updated_at           = now();
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END;
$function$;

-- ── C. Grants ─────────────────────────────────────────────────────────────
-- PUBLIC must be revoked too: the old ACLs carry "=X/postgres", which anon
-- inherits even without its own grant. authenticated keeps its explicit grant
-- on the wrapper and the admin functions (the body now does the gating).
REVOKE EXECUTE ON FUNCTION public.award_challenge_points(uuid, text, text, text, jsonb) FROM PUBLIC, anon;

REVOKE EXECUTE ON FUNCTION public._award_challenge_points_core(uuid, text, text, text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.calculate_challenge_streak(uuid)                            FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_check_streak_bonus(uuid)                                 FROM PUBLIC, anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.admin_reinstate_user(uuid)       FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_disqualify_user(uuid, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_reverse_points(uuid, text)  FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_confirm_flag(uuid, text)    FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_dismiss_flag(uuid, text)    FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.detect_challenge_flags()          FROM PUBLIC, anon;

-- ── D. Direct inserts into the points table: admin test seeding only ──────
DROP POLICY jce_insert_own ON public.june_challenge_events;

CREATE POLICY jce_insert_admin_test_seed ON public.june_challenge_events
  FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = user_id
    AND EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin)
    AND EXISTS (SELECT 1 FROM june_challenge_config WHERE id = 1 AND test_mode)
  );

COMMIT;

-- ----------------------------------------------------------------
-- ROLLBACK — exact SQL to undo, or state:
-- "irreversible — restore from _bak_YYYYMMDD_tablename"
-- ----------------------------------------------------------------
-- Rolling back REOPENS every hole above. Only do it if the new code breaks
-- live scoring, and re-fix the same day.
--
-- BEGIN;
-- DO $$
-- DECLARE r record;
-- BEGIN
--   FOR r IN SELECT definition FROM _bak_20260925_challenge_fn_security WHERE kind = 'function' LOOP
--     EXECUTE r.definition;
--   END LOOP;
-- END $$;
-- DROP FUNCTION IF EXISTS public._award_challenge_points_core(uuid, text, text, text, jsonb);
-- GRANT EXECUTE ON FUNCTION
--   public.award_challenge_points(uuid, text, text, text, jsonb),
--   public.calculate_challenge_streak(uuid),
--   public.fn_check_streak_bonus(uuid),
--   public.admin_reinstate_user(uuid),
--   public.admin_disqualify_user(uuid, text),
--   public.admin_reverse_points(uuid, text),
--   public.admin_confirm_flag(uuid, text),
--   public.admin_dismiss_flag(uuid, text),
--   public.detect_challenge_flags()
--   TO PUBLIC, anon, authenticated;
-- DROP POLICY IF EXISTS jce_insert_admin_test_seed ON public.june_challenge_events;
-- CREATE POLICY jce_insert_own ON public.june_challenge_events
--   FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
-- COMMIT;

-- ----------------------------------------------------------------
-- VERIFY — run on the READ-ONLY connection AFTER applying.
-- State the expected result next to each query.
-- ----------------------------------------------------------------
-- V1. Grants:
-- SELECT p.proname,
--        has_function_privilege('anon', p.oid, 'EXECUTE')          AS anon_exec,
--        has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth_exec,
--        pg_get_userbyid(p.proowner)                                AS owner
--   FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--  WHERE n.nspname = 'public' AND p.proname IN
--    ('award_challenge_points','_award_challenge_points_core','calculate_challenge_streak',
--     'fn_check_streak_bonus','admin_reinstate_user','admin_disqualify_user',
--     'admin_reverse_points','admin_confirm_flag','admin_dismiss_flag','detect_challenge_flags')
--  ORDER BY 1;
-- expect: 10 rows, anon_exec = false on ALL;
--         auth_exec = false on _award_challenge_points_core,
--         calculate_challenge_streak, fn_check_streak_bonus;
--         auth_exec = true on the other 7; owner = postgres on all 10
--         (the wrapper and calculate_challenge_streak reach the core as owner).
--
-- V2. Guards / wiring present:
-- SELECT p.proname,
--        p.prosrc LIKE '%is_admin%'                                   AS has_admin_guard,
--        p.prosrc LIKE '%IS DISTINCT FROM auth.uid()%'                AS has_self_guard,
--        p.prosrc LIKE '%PERFORM _award_challenge_points_core%'      AS streak_uses_core,
--        p.prosrc LIKE '%source_not_verified%'                       AS verifies_source
--   FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--  WHERE n.nspname = 'public' AND p.proname IN
--    ('award_challenge_points','_award_challenge_points_core','calculate_challenge_streak',
--     'admin_reinstate_user','admin_disqualify_user','admin_reverse_points',
--     'admin_confirm_flag','admin_dismiss_flag','detect_challenge_flags')
--  ORDER BY 1;
-- expect: has_admin_guard true on the 6 admin_* / detect_*; has_self_guard true
--         on award_challenge_points; streak_uses_core true on
--         calculate_challenge_streak; verifies_source true on the core.
--
-- V3. Policies on the points table:
-- SELECT polname, polcmd::text, pg_get_expr(polwithcheck, polrelid)
--   FROM pg_policy WHERE polrelid = 'public.june_challenge_events'::regclass ORDER BY 1;
-- expect: jce_insert_admin_test_seed (a, admin + test_mode check) and
--         jce_read_all (r). jce_insert_own gone.
--
-- V4. Attacker's view, end to end: POST to the REST RPC endpoint with ONLY the
--     public anon key (no user session), nil uuid so nothing real is touched:
--       /rest/v1/rpc/award_challenge_points  {"p_user_id":"00000000-0000-0000-0000-000000000000","p_action_type":"join_swim","p_source_record_id":"00000000-0000-0000-0000-000000000000"}
--       /rest/v1/rpc/admin_reinstate_user    {"p_user_id":"00000000-0000-0000-0000-000000000000"}
--       /rest/v1/rpc/admin_disqualify_user   {"p_user_id":"00000000-0000-0000-0000-000000000000","p_reason":"verify"}
-- expect: all three refused with 401/403, code 42501 (permission denied).
--
-- V5. No new audit/event rows from the V4 probes:
-- SELECT count(*) FROM challenge_points_audit WHERE user_id = '00000000-0000-0000-0000-000000000000';
-- expect: 0
--
-- V6. Live scoring still flows (run a few hours after apply, and again
--     tomorrow). Baseline at dry-run: September trigger temp_log events = 204,
--     KGB RPC temp_log awards = 10.
-- SELECT e.source, e.action_type, count(*)
--   FROM june_challenge_events e
--  WHERE e.created_at >= '2026-09-01 00:00+02'
--  GROUP BY 1, 2 ORDER BY 1, 2;
-- expect: trigger temp_log count keeps rising as people log; KGB's next temp
--         log adds a 'client' temp_log row (he is in tester_ids, so his points
--         come through the RPC path).
-- SELECT rejection_reason, count(*) FROM challenge_points_audit
--  WHERE awarded_at > '2026-09-25 14:10:00+00' AND points_status = 'rejected' GROUP BY 1;
-- expect: no 'source_not_verified' from real app use (any row here means a
--         legitimate path is being refused; investigate before the draw).
--
-- V7. Standing reconciliation (should ALWAYS be 0; re-run before the draw):
-- SELECT count(*) FROM june_challenge_events e
--  WHERE e.created_at >= '2026-09-01 00:00+02' AND e.source <> 'trigger' AND (
--       (e.action_type = 'temp_log'    AND NOT EXISTS (SELECT 1 FROM temp_logs t WHERE t.id::text = e.ref_id AND t.user_id = e.user_id))
--    OR (e.action_type = 'join_swim'   AND NOT EXISTS (SELECT 1 FROM swim_participants sp WHERE sp.swim_event_id::text = e.ref_id AND sp.user_id = e.user_id))
--    OR (e.action_type = 'create_swim' AND NOT EXISTS (SELECT 1 FROM swim_events se WHERE se.id::text = e.ref_id AND se.created_by = e.user_id)));
-- expect: 0
--
-- V8. Dave (as KGB, logged in): app admin debug panel -> "Detect Flags"
--     still succeeds (toast "Flag detection complete").
--
-- APPLIED 2026-09-25 ~14:10 UTC via supabase-admin apply_migration
-- (2026_09_25_lock_down_challenge_scoring_functions), after Dave typed "apply".
-- V1 pass (anon false x10; authenticated false on core/streak helpers, true on
-- the other 7; owner postgres x10). V2 pass. V3 pass. Live bodies md5-match
-- this file for all 9 functions. V4 pass: all six probed RPCs -> HTTP 401,
-- code 42501 "permission denied". V5: 0. V7: 0. V6 baseline at apply:
-- trigger temp_log 204, client temp_log 10, client join_swim 1, client
-- creator_bonus 1, trigger streak_3day 9, streak_7day 1. V6 and V8 pending
-- real activity.
