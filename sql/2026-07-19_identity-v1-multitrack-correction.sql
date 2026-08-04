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
-- Migration: 2026-07-19_identity-v1-multitrack-correction.sql
-- Process:   see MIGRATIONS.md — no section below may be left empty
-- STATUS:    NOT APPLIED. Prepared for review only. Do not run until
--            Dave types "apply". This file supersedes the cold-only
--            model in sql/applied/2026-07-19_identity-layer-v1.sql.
-- ================================================================

-- Purpose:
--   Correct the Identity Layer V1 product model before any wider
--   rollout. The original migration built ONE numeric cold-water
--   ladder (Cold Water/Deep Cold/Winter/Polar/Ice) and presented it
--   in the UI as the swimmer's overall level. That implies swimmers
--   in warm-water regions (Durban, tropical, inland, pool) cannot
--   progress — unacceptable for an international platform. This
--   migration splits the model into independent tracks:
--     - participation (universal, log-count + active-weeks based,
--       no temperature/distance/Strava dependency, always achievable)
--     - cold_water (specialist, 3 levels not 5, unchanged
--       corroboration logic — peer log or marine model, ±2°C/±24h)
--   The existing table already supports multiple tracks structurally
--   (achievement_type has no CHECK restricting its values, and the
--   uniqueness constraints are scoped per achievement_type+level) —
--   this migration renames columns to unambiguous names and rewrites
--   the evaluation functions; it does not restructure the table.

-- Requested by:
--   Dave (Identity Layer V1 product-model correction, 2026-07-19 —
--   read before rollout: cold water is a specialist track, not the
--   universal SwimLoading progression ladder)

-- ----------------------------------------------------------------
-- PRE-CHECKS — run on the READ-ONLY connection BEFORE applying.
-- Must include affected-row counts for any UPDATE/DELETE.
-- ----------------------------------------------------------------
-- SELECT count(*) FROM swimmer_achievements;
--   -- expect: 0 (confirmed 2026-07-19 — table has never held a real row)
-- SELECT count(*) FROM analytics_events
--   WHERE event_name IN ('cold_level_earned','cold_level_pending_verification');
--   -- expect: 0 (confirmed 2026-07-19 — neither event has ever fired for real usage)
-- SELECT enabled_global, allowed_user_ids FROM feature_flags WHERE key='identity_layer_v1';
--   -- expect: false, {df137255-3add-4153-b368-32e06e2be188} — unchanged by this migration
-- No UPDATE/DELETE on any row — this is a rename + function replacement
-- against a table with zero data, plus two new additive functions.

-- ----------------------------------------------------------------
-- BACKUP — required before any DELETE / UPDATE / DROP / TRUNCATE.
-- ----------------------------------------------------------------
-- Not required: zero rows exist in swimmer_achievements. Column
-- renames and CREATE OR REPLACE FUNCTION do not delete data on any
-- other table. The exact prior function body is captured verbatim
-- in ROLLBACK below (pulled live via pg_get_functiondef), so the old
-- 5-level definition can be restored exactly if needed.

-- ----------------------------------------------------------------
-- MIGRATION — applied only after Dave types "apply".
-- ----------------------------------------------------------------
BEGIN;

-- ── 1. Rename columns to unambiguous, track-agnostic names ──────
-- Postgres propagates column renames through indexes, partial-index
-- predicates, and CHECK constraints automatically — no index/constraint
-- recreation needed. profiles(id) already IS the swimmer's identity key
-- (user_id ≡ "profile_id" in Dave's suggested model) — kept as user_id
-- to avoid rewriting the 3 existing RLS policies for a cosmetic rename.
ALTER TABLE swimmer_achievements RENAME COLUMN achievement_type TO track_type;
ALTER TABLE swimmer_achievements RENAME COLUMN level             TO achievement_order;
ALTER TABLE swimmer_achievements RENAME COLUMN level_key         TO achievement_code;
ALTER TABLE swimmer_achievements RENAME COLUMN level_name        TO achievement_name;
ALTER TABLE swimmer_achievements RENAME COLUMN status             TO verification_status;
ALTER TABLE swimmer_achievements RENAME COLUMN temp_log_id        TO source_log_id;
ALTER TABLE swimmer_achievements RENAME COLUMN corroboration      TO metadata;

ALTER TABLE swimmer_achievements ALTER COLUMN track_type SET DEFAULT 'cold_water';

COMMENT ON COLUMN swimmer_achievements.track_type IS
  'Independent identity track: participation | cold_water. Future: consistency | explorer | endurance | crossings | club | event. No specialist track is the universal rank.';
COMMENT ON COLUMN swimmer_achievements.achievement_order IS
  'Ordinal position WITHIN this track_type only — never compared across tracks.';
COMMENT ON TABLE swimmer_achievements IS
  'Multi-track swimmer identity. A swimmer has exactly one participation milestone and zero-or-more specialist identities. Do not read achievement_order as a global swimmer level.';

-- ── 2. Cold-water specialist — replace 5-level ladder with 3 ────
-- Same corroboration rule as before (peer log or marine-model SST,
-- ±2.0°C within ±24h); only the thresholds and level count change.
-- No Polar/Ice tiers. track_type is now 'cold_water', not 'cold_level'.
CREATE OR REPLACE FUNCTION public.evaluate_cold_achievement(p_log_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_log          temp_logs%ROWTYPE;
  v_when         timestamptz;
  v_order        int;
  v_code         text;
  v_name         text;
  v_have_earned  int;
  v_model        record;
  v_peer         record;
  v_corroborated boolean := false;
  v_evidence     jsonb := '[]'::jsonb;
  v_new_levels   jsonb := '[]'::jsonb;
  v_rows         int;
  r              record;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('error', 'not_authenticated');
  END IF;

  SELECT * INTO v_log FROM temp_logs WHERE id = p_log_id AND user_id = auth.uid();
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'log_not_found');
  END IF;

  IF NOT identity_flag_enabled(auth.uid()) THEN
    RETURN jsonb_build_object('error', 'feature_disabled');
  END IF;

  v_when := COALESCE(v_log.logged_at, v_log.created_at);

  SELECT l.ord, l.code, l.nm INTO v_order, v_code, v_name
  FROM (VALUES
    (3, 'deep_winter',    'Deep Winter',    10.0),
    (2, 'coldwater',      'Coldwater',      15.0),
    (1, 'shoulder_season','Shoulder Season',18.0)
  ) AS l(ord, code, nm, max_c)
  WHERE v_log.temp_c < l.max_c
  ORDER BY l.ord DESC LIMIT 1;

  IF v_order IS NULL THEN
    RETURN jsonb_build_object('status', 'not_earned', 'reason', 'above_threshold',
                              'temp_c', v_log.temp_c);
  END IF;

  SELECT COALESCE(MAX(achievement_order), 0) INTO v_have_earned
  FROM swimmer_achievements
  WHERE user_id = auth.uid() AND track_type = 'cold_water' AND verification_status = 'earned';

  -- Already holds this level or higher — still surface order/code/name so the
  -- client can show the standing specialist identity (quiet, no fanfare)
  -- instead of nothing. new_levels stays empty: this is not a NEW milestone.
  IF v_order <= v_have_earned THEN
    RETURN jsonb_build_object('status', 'earned', 'reason', 'already_at_level',
                              'order', v_order, 'code', v_code, 'name', v_name,
                              'new_levels', '[]'::jsonb, 'current_level', v_have_earned, 'temp_c', v_log.temp_c);
  END IF;

  SELECT sst_c, source, observed_at INTO v_model
  FROM spot_water_readings
  WHERE spot_id = v_log.spot_id
    AND observed_at BETWEEN v_when - interval '24 hours' AND v_when + interval '24 hours'
    AND abs(sst_c - v_log.temp_c) <= 2.0
  ORDER BY abs(extract(epoch FROM observed_at - v_when)) ASC
  LIMIT 1;
  IF FOUND THEN
    v_corroborated := true;
    v_evidence := v_evidence || jsonb_build_object(
      'type', 'model', 'source', v_model.source,
      'sst_c', v_model.sst_c, 'observed_at', v_model.observed_at);
  END IF;

  SELECT id, temp_c INTO v_peer
  FROM temp_logs
  WHERE spot_id = v_log.spot_id
    AND user_id <> v_log.user_id
    AND id <> v_log.id
    AND COALESCE(logged_at, created_at)
        BETWEEN v_when - interval '24 hours' AND v_when + interval '24 hours'
    AND abs(temp_c - v_log.temp_c) <= 2.0
  LIMIT 1;
  IF FOUND THEN
    v_corroborated := true;
    v_evidence := v_evidence || jsonb_build_object(
      'type', 'peer_log', 'log_id', v_peer.id, 'temp_c', v_peer.temp_c);
  END IF;

  IF v_corroborated THEN
    FOR r IN
      SELECT l.ord, l.code, l.nm
      FROM (VALUES
        (1, 'shoulder_season','Shoulder Season'),
        (2, 'coldwater',      'Coldwater'),
        (3, 'deep_winter',    'Deep Winter')
      ) AS l(ord, code, nm)
      WHERE l.ord > v_have_earned AND l.ord <= v_order
      ORDER BY l.ord
    LOOP
      UPDATE swimmer_achievements
         SET verification_status = 'superseded', decided_at = now()
       WHERE user_id = auth.uid() AND track_type = 'cold_water'
         AND achievement_order = r.ord AND verification_status = 'pending_verification';

      INSERT INTO swimmer_achievements
        (user_id, track_type, achievement_order, achievement_code, achievement_name,
         verification_status, temp_c, source_log_id, spot_id, metadata, source)
      VALUES
        (auth.uid(), 'cold_water', r.ord, r.code, r.nm, 'earned',
         v_log.temp_c, v_log.id, v_log.spot_id, v_evidence, 'server_eval')
      ON CONFLICT (user_id, track_type, achievement_order) WHERE verification_status = 'earned'
      DO NOTHING;

      v_new_levels := v_new_levels || jsonb_build_object('order', r.ord, 'code', r.code, 'name', r.nm);
    END LOOP;

    RETURN jsonb_build_object(
      'status', 'earned', 'order', v_order, 'code', v_code, 'name', v_name,
      'new_levels', v_new_levels, 'temp_c', v_log.temp_c, 'corroboration', v_evidence);
  ELSE
    INSERT INTO swimmer_achievements
      (user_id, track_type, achievement_order, achievement_code, achievement_name,
       verification_status, temp_c, source_log_id, spot_id, metadata, source)
    VALUES
      (auth.uid(), 'cold_water', v_order, v_code, v_name, 'pending_verification',
       v_log.temp_c, v_log.id, v_log.spot_id, '[]'::jsonb, 'server_eval')
    ON CONFLICT (user_id, track_type, achievement_order) WHERE verification_status = 'pending_verification'
    DO NOTHING;
    GET DIAGNOSTICS v_rows = ROW_COUNT;

    RETURN jsonb_build_object(
      'status', 'pending_verification', 'order', v_order, 'code', v_code,
      'name', v_name, 'temp_c', v_log.temp_c, 'newly_created', v_rows > 0);
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.evaluate_cold_achievement(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.evaluate_cold_achievement(uuid) TO authenticated;

-- ── 3. Universal participation track (new, additive) ────────────
-- No temperature/distance/climate/Strava dependency, per instruction.
-- Always 'earned' immediately from valid server-side log counts — no
-- verification step exists for this track. "Valid" = any remaining
-- temp_logs row (voided logs are hard-deleted elsewhere in the app,
-- so no extra filter is needed here).
CREATE OR REPLACE FUNCTION public.evaluate_participation_achievement(p_log_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id      uuid;
  v_total_logs   int;
  v_active_weeks int;
  v_order        int;
  v_code         text;
  v_name         text;
  v_have_earned  int;
  v_new_levels   jsonb := '[]'::jsonb;
  r              record;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('error', 'not_authenticated');
  END IF;

  SELECT user_id INTO v_user_id FROM temp_logs WHERE id = p_log_id AND user_id = auth.uid();
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'log_not_found');
  END IF;

  IF NOT identity_flag_enabled(auth.uid()) THEN
    RETURN jsonb_build_object('error', 'feature_disabled');
  END IF;

  SELECT count(*), count(DISTINCT date_trunc('week', COALESCE(logged_at, created_at)))
    INTO v_total_logs, v_active_weeks
  FROM temp_logs WHERE user_id = v_user_id;

  SELECT l.ord, l.code, l.nm INTO v_order, v_code, v_name
  FROM (VALUES
    (1, 'first_swim', 'First Swim',  1,   0),
    (2, 'regular',     'Regular',     1,   4),
    (3, 'committed',   'Committed',   10,  0),
    (4, 'consistent',  'Consistent',  25,  0),
    (5, 'established', 'Established', 50,  0),
    (6, 'centurion',   'Centurion',   100, 0)
  ) AS l(ord, code, nm, min_logs, min_weeks)
  WHERE v_total_logs >= l.min_logs AND v_active_weeks >= l.min_weeks
  ORDER BY l.ord DESC LIMIT 1;

  IF v_order IS NULL THEN
    RETURN jsonb_build_object('status', 'not_earned', 'total_logs', v_total_logs, 'active_weeks', v_active_weeks);
  END IF;

  SELECT COALESCE(MAX(achievement_order), 0) INTO v_have_earned
  FROM swimmer_achievements
  WHERE user_id = v_user_id AND track_type = 'participation' AND verification_status = 'earned';

  -- v_order (highest threshold satisfied by CURRENT totals) is monotonic and
  -- equals v_have_earned exactly when nothing new was crossed, so v_code/v_name
  -- (already looked up for v_order) correctly describe the standing milestone —
  -- the client always has a name to show, never just a bare "unchanged" status.
  IF v_order <= v_have_earned THEN
    RETURN jsonb_build_object('status', 'unchanged', 'order', v_order, 'code', v_code, 'name', v_name,
                              'new_levels', '[]'::jsonb,
                              'total_logs', v_total_logs, 'active_weeks', v_active_weeks);
  END IF;

  FOR r IN
    SELECT l.ord, l.code, l.nm
    FROM (VALUES
      (1, 'first_swim',  'First Swim'),
      (2, 'regular',      'Regular'),
      (3, 'committed',    'Committed'),
      (4, 'consistent',   'Consistent'),
      (5, 'established',  'Established'),
      (6, 'centurion',    'Centurion')
    ) AS l(ord, code, nm)
    WHERE l.ord > v_have_earned AND l.ord <= v_order
    ORDER BY l.ord
  LOOP
    INSERT INTO swimmer_achievements
      (user_id, track_type, achievement_order, achievement_code, achievement_name,
       verification_status, source_log_id, metadata, source)
    VALUES
      (v_user_id, 'participation', r.ord, r.code, r.nm, 'earned',
       p_log_id, jsonb_build_object('total_logs', v_total_logs, 'active_weeks', v_active_weeks),
       'server_eval')
    ON CONFLICT (user_id, track_type, achievement_order) WHERE verification_status = 'earned'
    DO NOTHING;

    v_new_levels := v_new_levels || jsonb_build_object('order', r.ord, 'code', r.code, 'name', r.nm);
  END LOOP;

  RETURN jsonb_build_object(
    'status', 'earned', 'order', v_order, 'code', v_code, 'name', v_name,
    'new_levels', v_new_levels, 'total_logs', v_total_logs, 'active_weeks', v_active_weeks);
END;
$$;

REVOKE ALL ON FUNCTION public.evaluate_participation_achievement(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.evaluate_participation_achievement(uuid) TO authenticated;

-- ── 4. Historical evaluator — created here, NOT run here ────────
-- Idempotent one-time backfill for a single user's EXISTING logs.
-- Guarded to only ever run for whoever the feature flag already
-- allows (today: Dave only) — this function existing does not widen
-- access; it still requires a separate explicit instruction to call.
CREATE OR REPLACE FUNCTION public.backfill_identity_v1(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total_logs   int;
  v_active_weeks int;
  v_participation_order int;
  v_cold_result  jsonb;
  v_log          record;
  v_cold_awarded jsonb := '[]'::jsonb;
BEGIN
  IF auth.uid() IS NULL OR auth.uid() <> p_user_id THEN
    RETURN jsonb_build_object('error', 'not_authorized');
  END IF;
  IF NOT identity_flag_enabled(p_user_id) THEN
    RETURN jsonb_build_object('error', 'feature_disabled');
  END IF;

  -- Participation: compute directly from full history, same thresholds
  -- as evaluate_participation_achievement. Reuses any existing log id
  -- as source_log_id purely for audit; does not require a "trigger log".
  SELECT count(*), count(DISTINCT date_trunc('week', COALESCE(logged_at, created_at)))
    INTO v_total_logs, v_active_weeks
  FROM temp_logs WHERE user_id = p_user_id;

  SELECT max(id) INTO v_log FROM temp_logs WHERE user_id = p_user_id;
  IF v_total_logs > 0 THEN
    PERFORM evaluate_participation_achievement((SELECT id FROM temp_logs WHERE user_id = p_user_id ORDER BY created_at DESC LIMIT 1));
  END IF;

  -- Cold specialist: re-run the same corroboration check historically,
  -- oldest-corroborated-evidence-wins, for every existing log — safe to
  -- re-run any time (ON CONFLICT DO NOTHING inside evaluate_cold_achievement).
  FOR v_log IN
    SELECT id FROM temp_logs WHERE user_id = p_user_id ORDER BY temp_c ASC
  LOOP
    v_cold_result := evaluate_cold_achievement(v_log.id);
    IF v_cold_result->>'status' IN ('earned','pending_verification') THEN
      v_cold_awarded := v_cold_awarded || jsonb_build_object('log_id', v_log.id, 'result', v_cold_result);
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'total_logs', v_total_logs, 'active_weeks', v_active_weeks,
    'cold_evaluations', v_cold_awarded);
END;
$$;

REVOKE ALL ON FUNCTION public.backfill_identity_v1(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.backfill_identity_v1(uuid) TO authenticated;

COMMIT;

-- ----------------------------------------------------------------
-- ROLLBACK — exact SQL to undo, or state:
-- "irreversible — restore from _bak_YYYYMMDD_tablename"
-- ----------------------------------------------------------------
-- BEGIN;
-- DROP FUNCTION IF EXISTS public.backfill_identity_v1(uuid);
-- DROP FUNCTION IF EXISTS public.evaluate_participation_achievement(uuid);
--
-- ALTER TABLE swimmer_achievements RENAME COLUMN track_type         TO achievement_type;
-- ALTER TABLE swimmer_achievements RENAME COLUMN achievement_order  TO level;
-- ALTER TABLE swimmer_achievements RENAME COLUMN achievement_code   TO level_key;
-- ALTER TABLE swimmer_achievements RENAME COLUMN achievement_name   TO level_name;
-- ALTER TABLE swimmer_achievements RENAME COLUMN verification_status TO status;
-- ALTER TABLE swimmer_achievements RENAME COLUMN source_log_id      TO temp_log_id;
-- ALTER TABLE swimmer_achievements RENAME COLUMN metadata           TO corroboration;
-- ALTER TABLE swimmer_achievements ALTER COLUMN achievement_type SET DEFAULT 'cold_level';
--
-- -- Restores the exact original 5-level function (pulled live via
-- -- pg_get_functiondef before this migration was written):
-- CREATE OR REPLACE FUNCTION public.evaluate_cold_achievement(p_log_id uuid)
-- RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
-- AS $function$
-- DECLARE
--   v_log temp_logs%ROWTYPE; v_when timestamptz; v_level int; v_key text; v_name text;
--   v_have_earned int; v_model record; v_peer record; v_corroborated boolean := false;
--   v_evidence jsonb := '[]'::jsonb; v_new_levels jsonb := '[]'::jsonb; v_rows int; r record;
-- BEGIN
--   IF auth.uid() IS NULL THEN RETURN jsonb_build_object('error', 'not_authenticated'); END IF;
--   SELECT * INTO v_log FROM temp_logs WHERE id = p_log_id AND user_id = auth.uid();
--   IF NOT FOUND THEN RETURN jsonb_build_object('error', 'log_not_found'); END IF;
--   IF NOT identity_flag_enabled(auth.uid()) THEN RETURN jsonb_build_object('error', 'feature_disabled'); END IF;
--   v_when := COALESCE(v_log.logged_at, v_log.created_at);
--   SELECT l.lvl, l.k, l.n INTO v_level, v_key, v_name FROM (VALUES
--     (5,'ice','Ice',5.0),(4,'polar','Polar',7.0),(3,'winter','Winter',10.0),
--     (2,'deep_cold','Deep Cold',13.0),(1,'cold_water','Cold Water',16.0)
--   ) AS l(lvl,k,n,max_c) WHERE v_log.temp_c <= l.max_c ORDER BY l.lvl DESC LIMIT 1;
--   IF v_level IS NULL THEN RETURN jsonb_build_object('status','not_earned','reason','above_threshold','temp_c',v_log.temp_c); END IF;
--   SELECT COALESCE(MAX(level),0) INTO v_have_earned FROM swimmer_achievements
--     WHERE user_id=auth.uid() AND achievement_type='cold_level' AND status='earned';
--   IF v_level <= v_have_earned THEN RETURN jsonb_build_object('status','not_earned','reason','already_at_level','current_level',v_have_earned,'temp_c',v_log.temp_c); END IF;
--   SELECT sst_c, source, observed_at INTO v_model FROM spot_water_readings
--     WHERE spot_id=v_log.spot_id AND observed_at BETWEEN v_when - interval '24 hours' AND v_when + interval '24 hours'
--     AND abs(sst_c - v_log.temp_c) <= 2.0 ORDER BY abs(extract(epoch FROM observed_at - v_when)) ASC LIMIT 1;
--   IF FOUND THEN v_corroborated := true; v_evidence := v_evidence || jsonb_build_object('type','model','source',v_model.source,'sst_c',v_model.sst_c,'observed_at',v_model.observed_at); END IF;
--   SELECT id, temp_c INTO v_peer FROM temp_logs WHERE spot_id=v_log.spot_id AND user_id <> v_log.user_id AND id <> v_log.id
--     AND COALESCE(logged_at, created_at) BETWEEN v_when - interval '24 hours' AND v_when + interval '24 hours' AND abs(temp_c - v_log.temp_c) <= 2.0 LIMIT 1;
--   IF FOUND THEN v_corroborated := true; v_evidence := v_evidence || jsonb_build_object('type','peer_log','log_id',v_peer.id,'temp_c',v_peer.temp_c); END IF;
--   IF v_corroborated THEN
--     FOR r IN SELECT l.lvl,l.k,l.n FROM (VALUES (1,'cold_water','Cold Water'),(2,'deep_cold','Deep Cold'),
--       (3,'winter','Winter'),(4,'polar','Polar'),(5,'ice','Ice')) AS l(lvl,k,n)
--       WHERE l.lvl > v_have_earned AND l.lvl <= v_level ORDER BY l.lvl
--     LOOP
--       UPDATE swimmer_achievements SET status='superseded', decided_at=now()
--         WHERE user_id=auth.uid() AND achievement_type='cold_level' AND level=r.lvl AND status='pending_verification';
--       INSERT INTO swimmer_achievements (user_id, achievement_type, level, level_key, level_name, status, temp_c, temp_log_id, spot_id, corroboration, source)
--         VALUES (auth.uid(),'cold_level',r.lvl,r.k,r.n,'earned',v_log.temp_c,v_log.id,v_log.spot_id,v_evidence,'server_eval')
--         ON CONFLICT (user_id, achievement_type, level) WHERE status='earned' DO NOTHING;
--       v_new_levels := v_new_levels || jsonb_build_object('level',r.lvl,'key',r.k,'name',r.n);
--     END LOOP;
--     RETURN jsonb_build_object('status','earned','level',v_level,'level_key',v_key,'level_name',v_name,'new_levels',v_new_levels,'temp_c',v_log.temp_c,'corroboration',v_evidence);
--   ELSE
--     INSERT INTO swimmer_achievements (user_id, achievement_type, level, level_key, level_name, status, temp_c, temp_log_id, spot_id, corroboration, source)
--       VALUES (auth.uid(),'cold_level',v_level,v_key,v_name,'pending_verification',v_log.temp_c,v_log.id,v_log.spot_id,'[]'::jsonb,'server_eval')
--       ON CONFLICT (user_id, achievement_type, level) WHERE status='pending_verification' DO NOTHING;
--     GET DIAGNOSTICS v_rows = ROW_COUNT;
--     RETURN jsonb_build_object('status','pending_verification','level',v_level,'level_key',v_key,'level_name',v_name,'temp_c',v_log.temp_c,'newly_created', v_rows > 0);
--   END IF;
-- END;
-- $function$;
-- COMMIT;

-- ----------------------------------------------------------------
-- VERIFY — run on the READ-ONLY connection AFTER applying.
-- State the expected result next to each query. Numbered against the
-- 19 acceptance tests from the correction spec.
-- ----------------------------------------------------------------

-- Schema sanity
-- SELECT column_name FROM information_schema.columns WHERE table_name='swimmer_achievements' ORDER BY ordinal_position;
--   -- expect: track_type, achievement_order, achievement_code, achievement_name,
--   --         verification_status, source_log_id, metadata present; no achievement_type/level/status/temp_log_id/corroboration
-- SELECT count(*) FROM swimmer_achievements;  -- expect: 0 (still no rows until real evaluation runs)

-- (17) feature flag off retains original share flow — unaffected by this
--      migration; verify by grep of showShareSheet() call site, no SQL needed.
-- (18) no profile becomes public automatically —
-- SELECT count(*) FROM profiles WHERE identity_public;  -- expect: 0

-- Tests 1–9, 14–16, 19 require calling evaluate_participation_achievement /
-- evaluate_cold_achievement / backfill_identity_v1 with real or seeded
-- temp_logs rows and are exercised via the acceptance harness, not raw SQL,
-- because they run as `auth.uid()` inside RLS (SQL Editor sessions run as
-- postgres/service role, which the functions reject via auth.uid() IS NULL).
-- Representative read-only checks once seeded:
-- SELECT track_type, achievement_order, achievement_code, verification_status
--   FROM swimmer_achievements WHERE user_id = :test_user ORDER BY track_type, achievement_order;
--   -- (1) after 1st log:      participation / 1 / first_swim / earned
--   -- (5) after 4 active wks: participation / 2 / regular / earned
--   -- (6) after 10 logs:      participation / 3 / committed / earned
--   -- (7) after 25 logs:      participation / 4 / consistent / earned
--   -- (8) after 50 logs:      participation / 5 / established / earned
--   -- (9) after 100 logs:     participation / 6 / centurion / earned
--   -- (10) verified 17.9°C:   cold_water / 1 / shoulder_season / earned
--   -- (11) verified 14.9°C:   cold_water / 2 / coldwater / earned
--   -- (12) verified 9.9°C:    cold_water / 3 / deep_winter / earned
--   -- (13) unverified cold:   cold_water / N / <code> / pending_verification
-- (19) idempotency — call evaluate_participation_achievement / evaluate_cold_achievement
--   twice with the same log id; expect identical row set both times (no duplicates,
--   enforced by the two partial unique indexes plus ON CONFLICT DO NOTHING).
