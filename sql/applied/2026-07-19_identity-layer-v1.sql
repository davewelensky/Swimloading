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
-- Migration: 2026-07-19_identity-layer-v1.sql
-- Process:   see MIGRATIONS.md — no section below may be left empty
-- ================================================================

-- Purpose:
--   Identity Layer V1 (additive only): feature_flags table (identity_layer_v1,
--   Dave-only), swimmer_achievements table with server-side cold-level
--   evaluation (SECURITY DEFINER RPC — client cannot set level/status),
--   profiles.identity_public opt-in with a trigger that hard-blocks minors
--   and unknown-DOB accounts from ever being public.

-- Requested by:
--   Dave (Identity Layer discovery approval, 2026-07-19 — binding decisions 1–5)

-- ----------------------------------------------------------------
-- PRE-CHECKS — run on the READ-ONLY connection BEFORE applying.
-- Must include affected-row counts for any UPDATE/DELETE.
-- ----------------------------------------------------------------
-- No UPDATE/DELETE in this migration — additive only. Pre-checks confirm
-- none of the new objects already exist and capture the baseline:
-- SELECT count(*) FROM information_schema.tables
--   WHERE table_schema='public' AND table_name IN ('feature_flags','swimmer_achievements');
--   -- expect: 0
-- SELECT count(*) FROM information_schema.columns
--   WHERE table_schema='public' AND table_name='profiles'
--   AND column_name IN ('identity_public','identity_public_enabled_at');
--   -- expect: 0
-- SELECT count(*) FROM profiles;  -- baseline; no profile row is modified by this migration

-- ----------------------------------------------------------------
-- BACKUP — required before any DELETE / UPDATE / DROP / TRUNCATE.
-- ----------------------------------------------------------------
-- Not required: migration is strictly additive (CREATE TABLE / ADD COLUMN /
-- CREATE FUNCTION / CREATE POLICY / one INSERT into a brand-new table).

-- ----------------------------------------------------------------
-- MIGRATION — applied only after Dave types "apply".
-- ----------------------------------------------------------------
BEGIN;

-- ── 1. Feature flags ────────────────────────────────────────────
CREATE TABLE feature_flags (
  key              text PRIMARY KEY,
  enabled_global   boolean NOT NULL DEFAULT false,
  allowed_user_ids uuid[]  NOT NULL DEFAULT '{}',
  config           jsonb,
  updated_at       timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE feature_flags ENABLE ROW LEVEL SECURITY;

CREATE POLICY ff_read_authenticated ON feature_flags
  FOR SELECT TO authenticated USING (true);
-- No INSERT/UPDATE/DELETE policies — flags are changed via SQL/service role only.

-- identity_layer_v1: OFF globally, enabled for Dave only.
INSERT INTO feature_flags (key, enabled_global, allowed_user_ids)
VALUES ('identity_layer_v1', false, ARRAY['df137255-3add-4153-b368-32e06e2be188']::uuid[]);

CREATE OR REPLACE FUNCTION public.identity_flag_enabled(p_user uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT enabled_global OR p_user = ANY(allowed_user_ids)
       FROM feature_flags WHERE key = 'identity_layer_v1'),
    false);
$$;

REVOKE ALL ON FUNCTION public.identity_flag_enabled(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.identity_flag_enabled(uuid) TO authenticated;

-- ── 2. Profile public opt-in (adult-only, server-enforced) ──────
ALTER TABLE profiles ADD COLUMN identity_public boolean NOT NULL DEFAULT false;
ALTER TABLE profiles ADD COLUMN identity_public_enabled_at timestamptz;

-- Trigger guard: identity_public can NEVER be true unless date_of_birth is
-- present and shows the user is 18+. Runs on every insert/update regardless
-- of who writes (client PATCH, RPC, admin), so the client cannot bypass it.
CREATE OR REPLACE FUNCTION public.enforce_identity_public_guard()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.identity_public IS TRUE THEN
    IF NEW.date_of_birth IS NULL
       OR NEW.date_of_birth > (current_date - interval '18 years') THEN
      -- Minor or unknown/invalid DOB → restricted. Force private.
      NEW.identity_public := false;
      NEW.identity_public_enabled_at := NULL;
    ELSIF TG_OP = 'INSERT' THEN
      NEW.identity_public_enabled_at := now();
    ELSIF OLD.identity_public IS DISTINCT FROM true THEN
      NEW.identity_public_enabled_at := now();
    END IF;
  ELSE
    NEW.identity_public_enabled_at := NULL;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_identity_public_guard
  BEFORE INSERT OR UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION public.enforce_identity_public_guard();

-- ── 3. Swimmer achievements (server-awarded only) ───────────────
CREATE TABLE swimmer_achievements (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  achievement_type text NOT NULL DEFAULT 'cold_level',
  level            int  NOT NULL,
  level_key        text NOT NULL,
  level_name       text NOT NULL,
  status           text NOT NULL CHECK (status IN ('earned','pending_verification','rejected','superseded')),
  temp_c           numeric,
  temp_log_id      uuid REFERENCES temp_logs(id) ON DELETE SET NULL,
  spot_id          uuid REFERENCES spots(id) ON DELETE SET NULL,
  corroboration    jsonb,
  source           text NOT NULL DEFAULT 'server_eval',
  created_at       timestamptz NOT NULL DEFAULT now(),
  decided_at       timestamptz,
  decided_by       uuid
);

CREATE UNIQUE INDEX swimmer_achievements_earned_uniq
  ON swimmer_achievements (user_id, achievement_type, level)
  WHERE status = 'earned';
CREATE UNIQUE INDEX swimmer_achievements_pending_uniq
  ON swimmer_achievements (user_id, achievement_type, level)
  WHERE status = 'pending_verification';
CREATE INDEX swimmer_achievements_user_idx ON swimmer_achievements (user_id);

ALTER TABLE swimmer_achievements ENABLE ROW LEVEL SECURITY;

CREATE POLICY sa_select_own ON swimmer_achievements
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY sa_admin_select ON swimmer_achievements
  FOR SELECT USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true));
CREATE POLICY sa_admin_update ON swimmer_achievements
  FOR UPDATE USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true))
  WITH CHECK   (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true));
-- Deliberately NO client INSERT policy: rows are created only by the
-- SECURITY DEFINER evaluation function below. The client can request an
-- evaluation and read the result — it cannot submit level/status/temp.

-- ── 4. Trusted cold-level evaluation (SECURITY DEFINER RPC) ─────
-- Levels: 1 Cold Water ≤16.0 · 2 Deep Cold ≤13.0 · 3 Winter ≤10.0
--         4 Polar ≤7.0 · 5 Ice ≤5.0  (°C)
-- Corroboration (either source, ±2.0°C):
--   a) modelled SST (spot_water_readings) observed within ±24h of the swim
--   b) another swimmer's temp_log at the same spot within ±24h
-- Corroborated qualifying temp  → 'earned' (all newly reached levels)
-- Uncorroborated qualifying temp → 'pending_verification' (no level awarded)
-- Non-qualifying temp            → 'not_earned' (nothing inserted)
CREATE OR REPLACE FUNCTION public.evaluate_cold_achievement(p_log_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_log          temp_logs%ROWTYPE;
  v_when         timestamptz;
  v_level        int;
  v_key          text;
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

  SELECT l.lvl, l.k, l.n INTO v_level, v_key, v_name
  FROM (VALUES
    (5, 'ice',        'Ice',        5.0),
    (4, 'polar',      'Polar',      7.0),
    (3, 'winter',     'Winter',    10.0),
    (2, 'deep_cold',  'Deep Cold', 13.0),
    (1, 'cold_water', 'Cold Water',16.0)
  ) AS l(lvl, k, n, max_c)
  WHERE v_log.temp_c <= l.max_c
  ORDER BY l.lvl DESC LIMIT 1;

  IF v_level IS NULL THEN
    RETURN jsonb_build_object('status', 'not_earned', 'reason', 'above_threshold',
                              'temp_c', v_log.temp_c);
  END IF;

  SELECT COALESCE(MAX(level), 0) INTO v_have_earned
  FROM swimmer_achievements
  WHERE user_id = auth.uid() AND achievement_type = 'cold_level' AND status = 'earned';

  IF v_level <= v_have_earned THEN
    RETURN jsonb_build_object('status', 'not_earned', 'reason', 'already_at_level',
                              'current_level', v_have_earned, 'temp_c', v_log.temp_c);
  END IF;

  -- Corroboration a) modelled sea-surface temp
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

  -- Corroboration b) independent swimmer log, same spot, ±24h, ±2.0°C
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
    -- Award every newly reached level; supersede any pending rows they replace.
    FOR r IN
      SELECT l.lvl, l.k, l.n
      FROM (VALUES
        (1, 'cold_water', 'Cold Water'),
        (2, 'deep_cold',  'Deep Cold'),
        (3, 'winter',     'Winter'),
        (4, 'polar',      'Polar'),
        (5, 'ice',        'Ice')
      ) AS l(lvl, k, n)
      WHERE l.lvl > v_have_earned AND l.lvl <= v_level
      ORDER BY l.lvl
    LOOP
      UPDATE swimmer_achievements
         SET status = 'superseded', decided_at = now()
       WHERE user_id = auth.uid() AND achievement_type = 'cold_level'
         AND level = r.lvl AND status = 'pending_verification';

      INSERT INTO swimmer_achievements
        (user_id, achievement_type, level, level_key, level_name, status,
         temp_c, temp_log_id, spot_id, corroboration, source)
      VALUES
        (auth.uid(), 'cold_level', r.lvl, r.k, r.n, 'earned',
         v_log.temp_c, v_log.id, v_log.spot_id, v_evidence, 'server_eval')
      ON CONFLICT (user_id, achievement_type, level) WHERE status = 'earned'
      DO NOTHING;

      v_new_levels := v_new_levels || jsonb_build_object('level', r.lvl, 'key', r.k, 'name', r.n);
    END LOOP;

    RETURN jsonb_build_object(
      'status', 'earned', 'level', v_level, 'level_key', v_key, 'level_name', v_name,
      'new_levels', v_new_levels, 'temp_c', v_log.temp_c, 'corroboration', v_evidence);
  ELSE
    INSERT INTO swimmer_achievements
      (user_id, achievement_type, level, level_key, level_name, status,
       temp_c, temp_log_id, spot_id, corroboration, source)
    VALUES
      (auth.uid(), 'cold_level', v_level, v_key, v_name, 'pending_verification',
       v_log.temp_c, v_log.id, v_log.spot_id, '[]'::jsonb, 'server_eval')
    ON CONFLICT (user_id, achievement_type, level) WHERE status = 'pending_verification'
    DO NOTHING;
    GET DIAGNOSTICS v_rows = ROW_COUNT;

    RETURN jsonb_build_object(
      'status', 'pending_verification', 'level', v_level, 'level_key', v_key,
      'level_name', v_name, 'temp_c', v_log.temp_c,
      'newly_created', v_rows > 0);
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.evaluate_cold_achievement(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.evaluate_cold_achievement(uuid) TO authenticated;

COMMIT;

-- ----------------------------------------------------------------
-- ROLLBACK — exact SQL to undo, or state:
-- "irreversible — restore from _bak_YYYYMMDD_tablename"
-- ----------------------------------------------------------------
-- BEGIN;
-- DROP FUNCTION IF EXISTS public.evaluate_cold_achievement(uuid);
-- DROP TABLE IF EXISTS swimmer_achievements;
-- DROP TRIGGER IF EXISTS trg_identity_public_guard ON profiles;
-- DROP FUNCTION IF EXISTS public.enforce_identity_public_guard();
-- ALTER TABLE profiles DROP COLUMN IF EXISTS identity_public;
-- ALTER TABLE profiles DROP COLUMN IF EXISTS identity_public_enabled_at;
-- DROP FUNCTION IF EXISTS public.identity_flag_enabled(uuid);
-- DROP TABLE IF EXISTS feature_flags;
-- COMMIT;

-- ----------------------------------------------------------------
-- VERIFY — run on the READ-ONLY connection AFTER applying.
-- State the expected result next to each query.
-- ----------------------------------------------------------------
-- SELECT key, enabled_global, allowed_user_ids FROM feature_flags;
--   -- expect: 1 row, identity_layer_v1, false, {df137255-3add-4153-b368-32e06e2be188}
-- SELECT count(*) FROM swimmer_achievements;              -- expect: 0
-- SELECT count(*) FROM profiles WHERE identity_public;    -- expect: 0 (nobody auto-published)
-- SELECT tgname FROM pg_trigger WHERE tgname='trg_identity_public_guard';  -- expect: 1 row
-- SELECT proname FROM pg_proc WHERE proname IN
--   ('evaluate_cold_achievement','identity_flag_enabled','enforce_identity_public_guard');
--   -- expect: 3 rows
