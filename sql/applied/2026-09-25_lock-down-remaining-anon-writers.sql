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
-- Migration: 2026-09-25_lock-down-remaining-anon-writers.sql
-- Process:   see MIGRATIONS.md — no section below may be left empty
-- ================================================================

-- Purpose:
--   Follow-up to 2026-09-25_lock-down-challenge-scoring-functions.sql. Closes
--   the remaining public-API holes found in the same audit:
--     A. snapshot_monthly_leaderboard(p_month) — anyone with the anon key can
--        DELETE and rebuild any month's saved winner snapshot (April: Ysie,
--        May: Eish). No app or API caller; it is run by hand in the SQL
--        editor. -> revoke from PUBLIC, anon, authenticated (SQL editor and
--        service_role keep it).
--     B. join_campaign(p_campaign_id, p_user_id) — enrols ANY user in a
--        campaign. -> caller must be p_user_id; revoke from PUBLIC, anon.
--     C. award_campaign_location(p_campaign_id, p_user_id, p_log_id) — runs
--        for ANY user (only credits their real logs, but no reason to be
--        open). -> caller must be p_user_id; revoke from PUBLIC, anon.
--     D. profiles.is_admin can be set on INSERT. protect_profile_admin_fields
--        is BEFORE UPDATE only, and the "Users can insert own profile" policy
--        lets a signed-in user with no profile row create one with
--        is_admin = true. Every is_admin guard in the database depends on
--        closing this. -> trigger also fires BEFORE INSERT and refuses
--        is_admin = true, same as the existing UPDATE rule.
--     E. v_challenge_audit (NEWLY FOUND while checking D's neighbours) — a
--        view owned by postgres, so it bypasses RLS, that selects
--        auth.users.email. anon and authenticated have SELECT on it: the
--        public anon key reads 204 rows of participant emails (confirmed
--        with a count-only HEAD request, no row data fetched). No app or API
--        code uses it. -> revoke all from PUBLIC, anon, authenticated.
--
--   No app code changes: every legitimate caller already passes its own
--   user id (app-uk-challenge.js:177, :205), and nothing inserts profiles
--   with is_admin (app.js:742 sends id + display_name only).

-- Requested by:
--   Dave (security audit follow-up, 25 Sep 2026)

-- ----------------------------------------------------------------
-- PRE-CHECKS — run on the READ-ONLY connection BEFORE applying.
-- Must include affected-row counts for any UPDATE/DELETE.
-- ----------------------------------------------------------------
-- No table rows are UPDATEd or DELETEd. Changes are two function bodies, one
-- trigger function body, one trigger's timing, and grants. Dry-run results
-- (25 Sep 2026) noted under each query.
--
-- P1. Exposure today:
-- SELECT p.proname, p.proacl::text FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--  WHERE n.nspname = 'public' AND p.proname IN
--    ('snapshot_monthly_leaderboard','join_campaign','award_campaign_location');
-- result: all three {=X/postgres,postgres=X,anon=X,authenticated=X,service_role=X}
-- SELECT relacl FROM pg_class WHERE oid = 'public.v_challenge_audit'::regclass;
-- result: anon=arwdDxtm, authenticated=arwdDxtm (security_invoker off, owner postgres)
-- SELECT pg_get_triggerdef(oid) FROM pg_trigger
--  WHERE tgrelid = 'public.profiles'::regclass AND tgname = 'protect_profile_admin_fields';
-- result: CREATE TRIGGER protect_profile_admin_fields BEFORE UPDATE ON public.profiles
--         FOR EACH ROW EXECUTE FUNCTION protect_profile_admin_fields()
--
-- P2. Drift fingerprints of the 3 bodies this file re-creates (checked again
--     inside the transaction; the migration aborts if any changed):
--   join_campaign                  f96762b511796ba3c7ec877b54abe010
--   award_campaign_location        d6c9218620891fd48668c4239cb045d5
--   protect_profile_admin_fields   4694acea9f7d9f2381b17508893d8716
--
-- P3. Callers (repo grep + pg_proc.prosrc + pg_views; pg_cron not installed):
--   snapshot_monthly_leaderboard  <- none (manual SQL; last snapshot 2026-05-01)
--   join_campaign                 <- app-uk-challenge.js:177, p_user_id = currentUser.id
--   award_campaign_location       <- app-uk-challenge.js:205, p_user_id = currentUser.id
--   v_challenge_audit             <- none
--   protect_profile_admin_fields  <- trigger on profiles only
--   Profile inserts: handle_new_user (is_admin not set -> default false) and
--   app.js:742 (id, display_name). Nothing inserts is_admin = true.
--
-- P4. Live impact: UK campaign (the only campaigns row) ran 2026-08-01..08-31
--     and is over — 1 participant, 0 credits, 0 events in 7 days.
--     Admins today: 1 (Dave). Profile-less auth users: 37, all unconfirmed,
--     none has ever signed in (so D is not being exploited today).
--
-- P5. API logs, last 24h (the retention the log tool allows): the only
--     request to v_challenge_audit was the count-only probe on 25 Sep 14:20
--     UTC. Earlier access can't be ruled in or out.
--
-- P6. Objects this file creates must not already exist:
--   _bak_20260925_anon_writers_security: false

-- ----------------------------------------------------------------
-- BACKUP — required before any DELETE / UPDATE / DROP / TRUNCATE.
-- ----------------------------------------------------------------
-- No row data changes. This migration DROPs and re-creates one trigger and
-- REPLACEs function bodies, so the exact pre-migration definitions and ACLs
-- are kept for the rollback. RLS on, no policies, no API grants.
CREATE TABLE _bak_20260925_anon_writers_security AS
SELECT 'function'::text            AS kind,
       p.oid::regprocedure::text   AS name,
       pg_get_functiondef(p.oid)   AS definition,
       p.proacl::text              AS acl
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public'
   AND p.proname IN ('snapshot_monthly_leaderboard','join_campaign',
                     'award_campaign_location','protect_profile_admin_fields')
UNION ALL
SELECT 'trigger', t.tgname::text, pg_get_triggerdef(t.oid), NULL
  FROM pg_trigger t
 WHERE t.tgrelid = 'public.profiles'::regclass
   AND t.tgname = 'protect_profile_admin_fields'
UNION ALL
SELECT 'view', 'v_challenge_audit', NULL, c.relacl::text
  FROM pg_class c
 WHERE c.oid = 'public.v_challenge_audit'::regclass;

ALTER TABLE _bak_20260925_anon_writers_security ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON _bak_20260925_anon_writers_security FROM PUBLIC, anon, authenticated;

-- ----------------------------------------------------------------
-- MIGRATION — applied only after Dave types "apply".
-- ----------------------------------------------------------------
BEGIN;

-- Drift guard: abort if any body changed since the dry-run, or the backup is
-- incomplete (4 functions + 1 trigger + 1 view).
DO $$
DECLARE
  v_bad text;
  v_bak integer;
BEGIN
  SELECT string_agg(p.proname, ', ') INTO v_bad
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND (p.proname, md5(p.prosrc)) NOT IN (
       ('join_campaign',                'f96762b511796ba3c7ec877b54abe010'),
       ('award_campaign_location',      'd6c9218620891fd48668c4239cb045d5'),
       ('protect_profile_admin_fields', '4694acea9f7d9f2381b17508893d8716'))
     AND p.proname IN ('join_campaign','award_campaign_location','protect_profile_admin_fields');
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'Function bodies changed since dry-run: %. Re-read them and redo the dry-run.', v_bad;
  END IF;

  SELECT count(*) INTO v_bak FROM _bak_20260925_anon_writers_security;
  IF v_bak <> 6 THEN
    RAISE EXCEPTION 'Backup has % rows, expected 6. Aborting.', v_bak;
  END IF;
END $$;

-- ── A. Leaderboard snapshots: SQL editor / service role only ──────────────
REVOKE EXECUTE ON FUNCTION public.snapshot_monthly_leaderboard(date) FROM PUBLIC, anon, authenticated;

-- ── B. join_campaign: callers may only join themselves ────────────────────
CREATE OR REPLACE FUNCTION public.join_campaign(p_campaign_id uuid, p_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_display_name text;
BEGIN
  IF auth.uid() IS NULL OR p_user_id IS DISTINCT FROM auth.uid() THEN
    RETURN jsonb_build_object('joined', false, 'reason', 'not_authorized');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM campaigns WHERE id = p_campaign_id AND enabled = true) THEN
    RETURN jsonb_build_object('joined', false, 'reason', 'campaign_not_active');
  END IF;

  INSERT INTO campaign_participants (campaign_id, user_id)
  VALUES (p_campaign_id, p_user_id)
  ON CONFLICT (campaign_id, user_id) DO NOTHING;

  SELECT display_name INTO v_display_name FROM profiles WHERE id = p_user_id;

  INSERT INTO campaign_events (campaign_id, user_id, display_name, action_type, points)
  VALUES (p_campaign_id, p_user_id, v_display_name, 'joined', 0);

  RETURN jsonb_build_object('joined', true);
EXCEPTION WHEN others THEN
  RAISE WARNING 'join_campaign error user=%: %', p_user_id, SQLERRM;
  RETURN jsonb_build_object('joined', false, 'reason', 'internal_error', 'error', SQLERRM);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.join_campaign(uuid, uuid) FROM PUBLIC, anon;

-- ── C. award_campaign_location: callers may only credit themselves ────────
CREATE OR REPLACE FUNCTION public.award_campaign_location(p_campaign_id uuid, p_user_id uuid, p_log_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_campaign  campaigns%ROWTYPE;
  v_log       temp_logs%ROWTYPE;
  v_spot      spots%ROWTYPE;
  v_spot_id   uuid;
  v_credit_id uuid;
  v_display_name text;
  v_log_date  date;
BEGIN
  IF auth.uid() IS NULL OR p_user_id IS DISTINCT FROM auth.uid() THEN
    RETURN jsonb_build_object('awarded', false, 'reason', 'not_authorized');
  END IF;

  SELECT * INTO v_campaign FROM campaigns WHERE id = p_campaign_id;
  IF NOT FOUND OR NOT v_campaign.enabled THEN
    RETURN jsonb_build_object('awarded', false, 'reason', 'campaign_not_active');
  END IF;

  SELECT * INTO v_log FROM temp_logs WHERE id = p_log_id AND user_id = p_user_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('awarded', false, 'reason', 'log_not_found');
  END IF;

  v_log_date := COALESCE(v_log.logged_at, v_log.created_at) AT TIME ZONE 'UTC';
  IF NOT v_campaign.test_mode THEN
    IF v_log_date < v_campaign.launch_date OR v_log_date > v_campaign.end_date THEN
      RETURN jsonb_build_object('awarded', false, 'reason', 'outside_challenge_window');
    END IF;
  END IF;

  IF EXISTS (
    SELECT 1 FROM campaign_admin_flags
    WHERE campaign_id = p_campaign_id AND user_id = p_user_id AND disqualified = true
  ) THEN
    RETURN jsonb_build_object('awarded', false, 'reason', 'disqualified');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM campaign_participants
    WHERE campaign_id = p_campaign_id AND user_id = p_user_id
  ) THEN
    RETURN jsonb_build_object('awarded', false, 'reason', 'not_joined');
  END IF;

  v_spot_id := COALESCE(v_log.spot_id, v_log.gps_spot_id);
  IF v_spot_id IS NULL THEN
    RETURN jsonb_build_object('awarded', false, 'reason', 'no_spot_attached');
  END IF;

  SELECT * INTO v_spot FROM spots WHERE id = v_spot_id AND active = true;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('awarded', false, 'reason', 'spot_not_found');
  END IF;

  IF v_spot.country_code IS DISTINCT FROM v_campaign.eligible_country_code
     OR NOT (v_spot.water_type = ANY(v_campaign.eligible_water_types)) THEN
    RETURN jsonb_build_object('awarded', false, 'reason', 'not_eligible_location');
  END IF;

  SELECT display_name INTO v_display_name FROM profiles WHERE id = p_user_id;

  INSERT INTO campaign_location_credits
    (campaign_id, user_id, spot_id, first_qualifying_log_id, points_awarded)
  VALUES
    (p_campaign_id, p_user_id, v_spot_id, p_log_id, v_campaign.points_per_unique_location)
  ON CONFLICT (campaign_id, user_id, spot_id) DO NOTHING
  RETURNING id INTO v_credit_id;

  IF v_credit_id IS NOT NULL THEN
    INSERT INTO campaign_events
      (campaign_id, user_id, display_name, action_type, points, spot_id, spot_name)
    VALUES
      (p_campaign_id, p_user_id, v_display_name, 'location_earned',
       v_campaign.points_per_unique_location, v_spot_id, v_spot.name);

    RETURN jsonb_build_object(
      'awarded', true,
      'points', v_campaign.points_per_unique_location,
      'spot_name', v_spot.name
    );
  ELSE
    INSERT INTO campaign_events
      (campaign_id, user_id, display_name, action_type, points, spot_id, spot_name)
    VALUES
      (p_campaign_id, p_user_id, v_display_name, 'swim_logged_repeat', 0, v_spot_id, v_spot.name);

    RETURN jsonb_build_object(
      'awarded', false,
      'reason', 'already_credited_this_spot',
      'spot_name', v_spot.name
    );
  END IF;
EXCEPTION WHEN others THEN
  RAISE WARNING 'award_campaign_location error user=% log=%: %', p_user_id, p_log_id, SQLERRM;
  RETURN jsonb_build_object('awarded', false, 'reason', 'internal_error', 'error', SQLERRM);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.award_campaign_location(uuid, uuid, uuid) FROM PUBLIC, anon;

-- ── D. is_admin can't be set on INSERT either ─────────────────────────────
-- The UPDATE rule is unchanged. INSERT gets the same rule: nobody sets
-- is_admin = true through a profile write (new admins are granted by a
-- migration that disables this trigger for the one statement, as before).
CREATE OR REPLACE FUNCTION public.protect_profile_admin_fields()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.is_admin IS TRUE THEN
      RAISE EXCEPTION 'is_admin cannot be set through profile inserts';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.is_admin IS DISTINCT FROM OLD.is_admin THEN
    RAISE EXCEPTION 'is_admin cannot be modified through profile updates';
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER protect_profile_admin_fields ON public.profiles;
CREATE TRIGGER protect_profile_admin_fields
  BEFORE INSERT OR UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION protect_profile_admin_fields();

-- ── E. Participant emails off the public API ──────────────────────────────
REVOKE ALL ON public.v_challenge_audit FROM PUBLIC, anon, authenticated;

COMMIT;

-- ----------------------------------------------------------------
-- ROLLBACK — exact SQL to undo, or state:
-- "irreversible — restore from _bak_YYYYMMDD_tablename"
-- ----------------------------------------------------------------
-- Rolling back REOPENS every hole above.
--
-- BEGIN;
-- DO $$
-- DECLARE r record;
-- BEGIN
--   FOR r IN SELECT definition FROM _bak_20260925_anon_writers_security WHERE kind = 'function' LOOP
--     EXECUTE r.definition;
--   END LOOP;
-- END $$;
-- GRANT EXECUTE ON FUNCTION
--   public.snapshot_monthly_leaderboard(date),
--   public.join_campaign(uuid, uuid),
--   public.award_campaign_location(uuid, uuid, uuid)
--   TO PUBLIC, anon, authenticated;
-- DROP TRIGGER protect_profile_admin_fields ON public.profiles;
-- CREATE TRIGGER protect_profile_admin_fields BEFORE UPDATE ON public.profiles
--   FOR EACH ROW EXECUTE FUNCTION protect_profile_admin_fields();
-- GRANT ALL ON public.v_challenge_audit TO anon, authenticated;
-- COMMIT;

-- ----------------------------------------------------------------
-- VERIFY — run on the READ-ONLY connection AFTER applying.
-- State the expected result next to each query.
-- ----------------------------------------------------------------
-- V1. Grants:
-- SELECT p.proname,
--        has_function_privilege('anon', p.oid, 'EXECUTE')          AS anon_exec,
--        has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth_exec,
--        p.prosrc LIKE '%IS DISTINCT FROM auth.uid()%'              AS self_guard
--   FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--  WHERE n.nspname = 'public'
--    AND p.proname IN ('snapshot_monthly_leaderboard','join_campaign','award_campaign_location')
--  ORDER BY 1;
-- expect: anon_exec false x3; auth_exec true on join_campaign and
--         award_campaign_location, false on snapshot_monthly_leaderboard;
--         self_guard true on join_campaign and award_campaign_location.
--
-- V2. View:
-- SELECT has_table_privilege('anon', 'public.v_challenge_audit', 'SELECT'),
--        has_table_privilege('authenticated', 'public.v_challenge_audit', 'SELECT');
-- expect: false, false
--
-- V3. Trigger:
-- SELECT pg_get_triggerdef(oid) FROM pg_trigger
--  WHERE tgrelid = 'public.profiles'::regclass AND tgname = 'protect_profile_admin_fields';
-- expect: ... BEFORE INSERT OR UPDATE ON public.profiles FOR EACH ROW ...
--
-- V4. Attacker's view, end to end, anon key only:
--   HEAD /rest/v1/v_challenge_audit?select=status        expect 401, no count
--   POST /rest/v1/rpc/snapshot_monthly_leaderboard {"p_month":"1900-01-01"}
--   POST /rest/v1/rpc/join_campaign {"p_campaign_id":<nil uuid>,"p_user_id":<nil uuid>}
--   POST /rest/v1/rpc/award_campaign_location {<nil uuids>}
--   expect: each refused with 401, code 42501. (Chosen so that even if a call
--   got through, it would touch nothing: month 1900 has no snapshot, the nil
--   campaign does not exist.)
--
-- V5. Nothing else moved:
-- SELECT (SELECT count(*) FROM profiles WHERE is_admin)            AS admins,
--        (SELECT count(*) FROM monthly_leaderboard)               AS snapshot_rows,
--        (SELECT count(*) FROM campaign_participants)             AS campaign_participants;
-- expect: 1, 9, 1 (unchanged from dry-run)
--
-- APPLIED 2026-09-25 ~14:35 UTC via supabase-admin apply_migration
-- (2026_09_25_lock_down_remaining_anon_writers), after Dave typed "apply".
-- V1 pass (anon false x3; authenticated true on join_campaign /
-- award_campaign_location with self_guard, false on the snapshot fn). V2 pass
-- (false, false). V3 pass (BEFORE INSERT OR UPDATE). V4 pass: HEAD
-- v_challenge_audit -> 401 with no row count; the three RPCs -> 401, code
-- 42501. V5 pass: 1, 9, 1. Live bodies md5-match this file.
