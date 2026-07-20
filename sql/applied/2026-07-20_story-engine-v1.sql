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
-- Migration: 2026-07-20_story-engine-v1.sql
-- Process:   see MIGRATIONS.md — no section below may be left empty
-- ================================================================

-- Purpose:
--   Release 2 Phase 2.1 — Story Engine. Additive-only: swimmer_story_events
--   table, story_engine_v1 feature flag (Dave-only), ONE shared internal
--   evaluator (evaluate_swim_story_events_internal_v1), invoked from TWO
--   independent callers that share no duplicated logic:
--     1) trigger_evaluate_swim_story_events_v1 — AFTER INSERT on temp_logs,
--        server-authoritative, fires with or without any client code
--        running at all.
--     2) evaluate_swim_story_events_v1(p_user_id, p_temp_log_id) — the
--        authenticated public RPC, used by the client purely as a retry /
--        retrieval / analytics layer (app-story.js), never as the sole
--        source of generation.
--   Client only requests evaluation + reads results — it can never
--   insert/update a story event directly. No display surface is built in
--   this phase (timeline/recap/public profile come later).

-- Requested by:
--   Dave (SwimLoading Release 2: Living Story, Phase 2.1 kickoff, 2026-07-20;
--   revised same day — server-authoritative trigger + wording/metadata
--   corrections per Dave's review of the first draft)

-- ----------------------------------------------------------------
-- PRE-CHECKS — run on the READ-ONLY connection BEFORE applying.
-- Must include affected-row counts for any UPDATE/DELETE.
-- ----------------------------------------------------------------
-- No UPDATE/DELETE in this migration — additive only. Pre-checks confirm
-- none of the new objects already exist:
-- SELECT count(*) FROM information_schema.tables
--   WHERE table_schema='public' AND table_name='swimmer_story_events';
--   -- expect: 0
-- SELECT count(*) FROM feature_flags WHERE key='story_engine_v1';
--   -- expect: 0
-- SELECT count(*) FROM pg_proc WHERE proname IN
--   ('evaluate_swim_story_events_v1','evaluate_swim_story_events_internal_v1',
--    'trigger_evaluate_swim_story_events_v1','story_engine_flag_enabled');
--   -- expect: 0
-- SELECT count(*) FROM pg_trigger WHERE tgname='trg_zz_evaluate_swim_story_events_v1';
--   -- expect: 0

-- ----------------------------------------------------------------
-- BACKUP — required before any DELETE / UPDATE / DROP / TRUNCATE.
-- ----------------------------------------------------------------
-- Not required: migration is strictly additive (CREATE TABLE / CREATE
-- FUNCTION / CREATE TRIGGER / CREATE POLICY / one INSERT into a brand-new
-- feature_flags row). Does NOT touch temp_logs data, user_stats,
-- swimmer_achievements, badges, challenges, or Strava tables in any way.
-- The new AFTER INSERT trigger on temp_logs adds behaviour on future
-- inserts only — it does not run against existing rows and this migration
-- does not backfill.

-- ----------------------------------------------------------------
-- MIGRATION — applied only after Dave types "apply".
-- ----------------------------------------------------------------
BEGIN;

-- ── 1. Feature flag ──────────────────────────────────────────────
-- story_engine_v1: OFF globally, enabled for Dave only.
-- (feature_flags table itself already exists — created by
--  sql/applied/2026-07-19_identity-layer-v1.sql — this only adds a row.)
INSERT INTO feature_flags (key, enabled_global, allowed_user_ids)
VALUES ('story_engine_v1', false, ARRAY['df137255-3add-4153-b368-32e06e2be188']::uuid[])
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.story_engine_flag_enabled(p_user uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT enabled_global OR p_user = ANY(allowed_user_ids)
       FROM feature_flags WHERE key = 'story_engine_v1'),
    false);
$$;

REVOKE ALL ON FUNCTION public.story_engine_flag_enabled(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.story_engine_flag_enabled(uuid) TO authenticated;

-- ── 2. swimmer_story_events ──────────────────────────────────────
CREATE TABLE swimmer_story_events (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  temp_log_id         uuid NULL REFERENCES temp_logs(id) ON DELETE SET NULL,
  story_type          text NOT NULL,
  story_date          date NOT NULL,
  title               text NOT NULL,
  summary             text NULL,
  primary_value       numeric NULL,
  secondary_value     numeric NULL,
  unit                text NULL,
  spot_id             uuid NULL REFERENCES spots(id) ON DELETE SET NULL,
  metadata            jsonb NOT NULL DEFAULT '{}'::jsonb,
  verification_status text NOT NULL DEFAULT 'corroborated',
  visibility          text NOT NULL DEFAULT 'private',
  dedupe_key          text NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT swimmer_story_events_story_type_check CHECK (story_type IN (
    'first_swim', 'swim_count_milestone',
    'first_spot_visit', 'spots_explored_milestone', 'spot_visit_milestone',
    'new_coldest_swim', 'new_warmest_swim',
    'first_sub_16', 'first_sub_13', 'first_sub_10', 'first_sub_7', 'first_sub_5',
    'first_pool_swim', 'first_open_water_swim',
    'streak_milestone'
  )),
  CONSTRAINT swimmer_story_events_verification_status_check CHECK (verification_status IN (
    'corroborated', 'pending_verification', 'rejected'
  )),
  CONSTRAINT swimmer_story_events_visibility_check CHECK (visibility IN (
    'private', 'public'
  )),

  CONSTRAINT swimmer_story_events_user_dedupe_uniq UNIQUE (user_id, dedupe_key)
);

CREATE INDEX swimmer_story_events_user_idx ON swimmer_story_events (user_id, story_date DESC);
CREATE INDEX swimmer_story_events_temp_log_idx ON swimmer_story_events (temp_log_id);

-- updated_at bump on any admin-driven UPDATE (no client UPDATE path exists yet)
CREATE OR REPLACE FUNCTION public.touch_swimmer_story_events_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_touch_swimmer_story_events_updated_at
  BEFORE UPDATE ON swimmer_story_events
  FOR EACH ROW EXECUTE FUNCTION public.touch_swimmer_story_events_updated_at();

ALTER TABLE swimmer_story_events ENABLE ROW LEVEL SECURITY;

-- Authenticated user reads only their own events. No public-profile read
-- policy is added in Phase 2.1 (per spec — that's a later phase).
CREATE POLICY sse_select_own ON swimmer_story_events
  FOR SELECT USING (auth.uid() = user_id);

-- Admin read/update, following the existing swimmer_achievements pattern.
CREATE POLICY sse_admin_select ON swimmer_story_events
  FOR SELECT USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true));
CREATE POLICY sse_admin_update ON swimmer_story_events
  FOR UPDATE USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true))
  WITH CHECK   (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true));
-- Deliberately NO client INSERT/DELETE policy and NO non-admin UPDATE policy:
-- rows are created only by evaluate_swim_story_events_internal_v1 (SECURITY
-- DEFINER, called from the trigger and from the public RPC — never from
-- client SQL). Anonymous (anon role) has no policy at all → RLS
-- default-denies every operation, so anon cannot enumerate any user's
-- story events.

-- ── 3. Shared internal evaluator (no auth check — trusted callers only) ──
-- evaluate_swim_story_events_internal_v1(p_user_id, p_temp_log_id)
-- This is the ONLY place story-type logic lives. Both the AFTER INSERT
-- trigger and the public RPC call this and nothing else — neither
-- reimplements any threshold, dedupe key, or wording.
--
-- Not SECURITY INVOKER-safe to expose directly: it does NOT check
-- auth.uid() itself, because its two callers have different trust
-- contexts (the trigger fires on every insert regardless of role —
-- including future service-role/import paths with no JWT at all — using
-- NEW.user_id/NEW.id straight from the row being written; the public RPC
-- is the one place that must independently prove the caller owns the log
-- before ever reaching this function). It IS still safe to call
-- repeatedly / concurrently: every write is idempotent via
-- ON CONFLICT (user_id, dedupe_key) DO NOTHING.
--
-- IMPORTANT — "coldest/warmest ever" semantics: v_prior_coldest/warmest
-- are computed as MIN/MAX(temp_c) across ALL of the user's OTHER logs,
-- regardless of each log's date. Because a swim can be backdated after
-- the fact, "new coldest/warmest" is evaluated against the swimmer's
-- CURRENTLY STORED history at the moment this function runs, not against
-- strict chronological order of when swims actually happened. A colder
-- backdated swim added later can still trigger this event on the day it's
-- inserted, dated to its (possibly past) story_date. Story titles are
-- worded ("recorded", not "yet"/"so far") specifically so they stay
-- accurate under that behaviour — do not change the wording back to a
-- chronological framing without re-deriving this comment.
CREATE OR REPLACE FUNCTION public.evaluate_swim_story_events_internal_v1(p_user_id uuid, p_temp_log_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_log            temp_logs%ROWTYPE;
  v_spot           spots%ROWTYPE;
  v_has_spot       boolean := false;
  v_story_date     date;
  v_total_logs     int;
  v_spots_explored int;
  v_spot_visits    int := 0;
  v_prior_coldest  numeric;
  v_prior_warmest  numeric;
  v_streak         int := 0;
  v_events         jsonb := '[]'::jsonb;
  v_suppressed     jsonb := '[]'::jsonb;
  v_row            swimmer_story_events%ROWTYPE;
  v_found          boolean;
  v_threshold      int;
  v_sub_threshold  numeric;
  v_sub_type       text;
BEGIN
  IF NOT story_engine_flag_enabled(p_user_id) THEN
    RETURN jsonb_build_object('error', 'feature_disabled');
  END IF;

  SELECT * INTO v_log FROM temp_logs WHERE id = p_temp_log_id AND user_id = p_user_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'log_not_found');
  END IF;

  v_story_date := COALESCE(v_log.logged_at, v_log.created_at)::date;

  IF v_log.spot_id IS NOT NULL THEN
    SELECT * INTO v_spot FROM spots WHERE id = v_log.spot_id;
    v_has_spot := FOUND;
  END IF;

  -- Authoritative counts — always recomputed from temp_logs, never
  -- read from a cached counter the caller could have influenced.
  SELECT count(*) INTO v_total_logs FROM temp_logs WHERE user_id = p_user_id;
  SELECT count(DISTINCT spot_id) INTO v_spots_explored
    FROM temp_logs WHERE user_id = p_user_id AND spot_id IS NOT NULL;
  IF v_has_spot THEN
    SELECT count(*) INTO v_spot_visits
      FROM temp_logs WHERE user_id = p_user_id AND spot_id = v_log.spot_id;
  END IF;
  SELECT min(temp_c) INTO v_prior_coldest FROM temp_logs WHERE user_id = p_user_id AND id <> p_temp_log_id;
  SELECT max(temp_c) INTO v_prior_warmest FROM temp_logs WHERE user_id = p_user_id AND id <> p_temp_log_id;
  SELECT current_streak INTO v_streak FROM user_stats WHERE user_id = p_user_id;
  v_streak := COALESCE(v_streak, 0);

  -- ── PARTICIPATION: first_swim ──────────────────────────────────
  IF v_total_logs = 1 THEN
    INSERT INTO swimmer_story_events
      (user_id, temp_log_id, story_type, story_date, title, summary, spot_id, metadata, dedupe_key)
    VALUES
      (p_user_id, p_temp_log_id, 'first_swim', v_story_date,
       'Your first recorded swim', 'This is the start of your SwimLoading story.',
       v_log.spot_id, jsonb_build_object('total_logs', v_total_logs), 'first_swim')
    ON CONFLICT (user_id, dedupe_key) DO NOTHING
    RETURNING * INTO v_row;
    GET DIAGNOSTICS v_found = ROW_COUNT;
    IF v_found THEN
      v_events := v_events || to_jsonb(v_row);
    ELSE
      v_suppressed := v_suppressed || jsonb_build_object('story_type', 'first_swim', 'dedupe_key', 'first_swim');
    END IF;
  END IF;

  -- ── PARTICIPATION: swim_count_milestone ────────────────────────
  -- 1 is deliberately NOT in this list — a swimmer's first log fires
  -- first_swim only, never both first_swim and swim_count_milestone(1).
  FOREACH v_threshold IN ARRAY ARRAY[10,25,50,100,250,500,1000] LOOP
    IF v_total_logs >= v_threshold THEN
      INSERT INTO swimmer_story_events
        (user_id, temp_log_id, story_type, story_date, title, summary,
         primary_value, unit, spot_id, metadata, dedupe_key)
      VALUES
        (p_user_id, p_temp_log_id, 'swim_count_milestone', v_story_date,
         v_threshold || ' swims recorded',
         'You have now recorded ' || v_threshold || ' swims on SwimLoading.',
         v_threshold, 'swims', v_log.spot_id,
         jsonb_build_object('total_logs', v_total_logs, 'threshold', v_threshold),
         'swim_count_' || v_threshold)
      ON CONFLICT (user_id, dedupe_key) DO NOTHING
      RETURNING * INTO v_row;
      GET DIAGNOSTICS v_found = ROW_COUNT;
      IF v_found THEN
        v_events := v_events || to_jsonb(v_row);
      ELSE
        v_suppressed := v_suppressed || jsonb_build_object('story_type', 'swim_count_milestone', 'dedupe_key', 'swim_count_' || v_threshold);
      END IF;
    END IF;
  END LOOP;

  -- ── EXPLORATION: first_spot_visit ──────────────────────────────
  IF v_has_spot AND v_spot_visits = 1 THEN
    INSERT INTO swimmer_story_events
      (user_id, temp_log_id, story_type, story_date, title, summary, spot_id, metadata, dedupe_key)
    VALUES
      (p_user_id, p_temp_log_id, 'first_spot_visit', v_story_date,
       'A new swim location', 'Your first recorded swim at ' || v_spot.name || '.',
       v_log.spot_id, jsonb_build_object('spot_name', v_spot.name), 'spot_first_visit:' || v_log.spot_id)
    ON CONFLICT (user_id, dedupe_key) DO NOTHING
    RETURNING * INTO v_row;
    GET DIAGNOSTICS v_found = ROW_COUNT;
    IF v_found THEN
      v_events := v_events || to_jsonb(v_row);
    ELSE
      v_suppressed := v_suppressed || jsonb_build_object('story_type', 'first_spot_visit', 'dedupe_key', 'spot_first_visit:' || v_log.spot_id);
    END IF;
  END IF;

  -- ── EXPLORATION: spots_explored_milestone ──────────────────────
  FOREACH v_threshold IN ARRAY ARRAY[5,10,25,50,100] LOOP
    IF v_spots_explored >= v_threshold THEN
      INSERT INTO swimmer_story_events
        (user_id, temp_log_id, story_type, story_date, title, summary,
         primary_value, unit, spot_id, metadata, dedupe_key)
      VALUES
        (p_user_id, p_temp_log_id, 'spots_explored_milestone', v_story_date,
         v_threshold || ' spots explored',
         'You have now swum at ' || v_threshold || ' different spots.',
         v_threshold, 'spots', v_log.spot_id,
         jsonb_build_object('spots_explored', v_spots_explored, 'threshold', v_threshold),
         'spots_explored_' || v_threshold)
      ON CONFLICT (user_id, dedupe_key) DO NOTHING
      RETURNING * INTO v_row;
      GET DIAGNOSTICS v_found = ROW_COUNT;
      IF v_found THEN
        v_events := v_events || to_jsonb(v_row);
      ELSE
        v_suppressed := v_suppressed || jsonb_build_object('story_type', 'spots_explored_milestone', 'dedupe_key', 'spots_explored_' || v_threshold);
      END IF;
    END IF;
  END LOOP;

  -- ── EXPLORATION: spot_visit_milestone ──────────────────────────
  IF v_has_spot THEN
    FOREACH v_threshold IN ARRAY ARRAY[10,25,50,100] LOOP
      IF v_spot_visits >= v_threshold THEN
        INSERT INTO swimmer_story_events
          (user_id, temp_log_id, story_type, story_date, title, summary,
           primary_value, unit, spot_id, metadata, dedupe_key)
        VALUES
          (p_user_id, p_temp_log_id, 'spot_visit_milestone', v_story_date,
           v_threshold || ' visits to ' || v_spot.name,
           'You have logged ' || v_threshold || ' swims at ' || v_spot.name || '.',
           v_threshold, 'visits', v_log.spot_id,
           jsonb_build_object('spot_name', v_spot.name, 'visits', v_spot_visits, 'threshold', v_threshold),
           'spot_visit_' || v_threshold || ':' || v_log.spot_id)
        ON CONFLICT (user_id, dedupe_key) DO NOTHING
        RETURNING * INTO v_row;
        GET DIAGNOSTICS v_found = ROW_COUNT;
        IF v_found THEN
          v_events := v_events || to_jsonb(v_row);
        ELSE
          v_suppressed := v_suppressed || jsonb_build_object('story_type', 'spot_visit_milestone', 'dedupe_key', 'spot_visit_' || v_threshold || ':' || v_log.spot_id);
        END IF;
      END IF;
    END LOOP;
  END IF;

  -- ── TEMPERATURE: new_coldest_swim / new_warmest_swim ───────────
  -- dedupe_key includes temp_log_id — this event type can recur across a
  -- swimmer's history (a new record can be set more than once), it just
  -- can never fire twice for the SAME log on repeat evaluation. See the
  -- function-level comment above re: "recorded" wording and backdating.
  IF v_prior_coldest IS NULL OR v_log.temp_c < v_prior_coldest THEN
    INSERT INTO swimmer_story_events
      (user_id, temp_log_id, story_type, story_date, title, summary,
       primary_value, unit, spot_id, metadata, dedupe_key)
    VALUES
      (p_user_id, p_temp_log_id, 'new_coldest_swim', v_story_date,
       'Your coldest recorded swim',
       'You recorded ' || v_log.temp_c || '°C at ' || COALESCE(v_spot.name, 'an unnamed spot') || '.',
       v_log.temp_c, '°C', v_log.spot_id,
       jsonb_build_object('prior_coldest', v_prior_coldest, 'evaluated_against', 'currently_stored_history'),
       'new_coldest:' || p_temp_log_id)
    ON CONFLICT (user_id, dedupe_key) DO NOTHING
    RETURNING * INTO v_row;
    GET DIAGNOSTICS v_found = ROW_COUNT;
    IF v_found THEN
      v_events := v_events || to_jsonb(v_row);
    ELSE
      v_suppressed := v_suppressed || jsonb_build_object('story_type', 'new_coldest_swim', 'dedupe_key', 'new_coldest:' || p_temp_log_id);
    END IF;
  END IF;

  IF v_prior_warmest IS NULL OR v_log.temp_c > v_prior_warmest THEN
    INSERT INTO swimmer_story_events
      (user_id, temp_log_id, story_type, story_date, title, summary,
       primary_value, unit, spot_id, metadata, dedupe_key)
    VALUES
      (p_user_id, p_temp_log_id, 'new_warmest_swim', v_story_date,
       'Your warmest recorded swim',
       'You recorded ' || v_log.temp_c || '°C at ' || COALESCE(v_spot.name, 'an unnamed spot') || '.',
       v_log.temp_c, '°C', v_log.spot_id,
       jsonb_build_object('prior_warmest', v_prior_warmest, 'evaluated_against', 'currently_stored_history'),
       'new_warmest:' || p_temp_log_id)
    ON CONFLICT (user_id, dedupe_key) DO NOTHING
    RETURNING * INTO v_row;
    GET DIAGNOSTICS v_found = ROW_COUNT;
    IF v_found THEN
      v_events := v_events || to_jsonb(v_row);
    ELSE
      v_suppressed := v_suppressed || jsonb_build_object('story_type', 'new_warmest_swim', 'dedupe_key', 'new_warmest:' || p_temp_log_id);
    END IF;
  END IF;

  -- ── TEMPERATURE: first_sub_* (each fires once ever, on the swim that
  --    first breaks that threshold) ───────────────────────────────
  FOR v_sub_type, v_sub_threshold IN
    SELECT * FROM (VALUES
      ('first_sub_16', 16.0), ('first_sub_13', 13.0), ('first_sub_10', 10.0),
      ('first_sub_7', 7.0), ('first_sub_5', 5.0)
    ) AS t(k, thresh)
  LOOP
    IF v_log.temp_c < v_sub_threshold THEN
      INSERT INTO swimmer_story_events
        (user_id, temp_log_id, story_type, story_date, title, summary,
         primary_value, unit, spot_id, metadata, dedupe_key)
      VALUES
        (p_user_id, p_temp_log_id, v_sub_type, v_story_date,
         'Your first swim below ' || v_sub_threshold::int || '°C',
         'You recorded ' || v_log.temp_c || '°C at ' || COALESCE(v_spot.name, 'an unnamed spot') || '.',
         v_log.temp_c, '°C', v_log.spot_id,
         jsonb_build_object('threshold_c', v_sub_threshold), v_sub_type)
      ON CONFLICT (user_id, dedupe_key) DO NOTHING
      RETURNING * INTO v_row;
      GET DIAGNOSTICS v_found = ROW_COUNT;
      IF v_found THEN
        v_events := v_events || to_jsonb(v_row);
      ELSE
        v_suppressed := v_suppressed || jsonb_build_object('story_type', v_sub_type, 'dedupe_key', v_sub_type);
      END IF;
    END IF;
  END LOOP;

  -- ── ENVIRONMENT: first_pool_swim / first_open_water_swim ───────
  -- Classified from spots.water_type only (the authoritative, populated
  -- column) — never from temp_logs.location_type, which is mostly NULL in
  -- production today. A log with no resolvable spot is skipped rather than
  -- guessed. classification_source is recorded in metadata so any future
  -- second classifier (e.g. an eventual location_type-based one) can be
  -- told apart from this one in the data.
  IF v_has_spot THEN
    IF v_spot.water_type = 'POOL' THEN
      INSERT INTO swimmer_story_events
        (user_id, temp_log_id, story_type, story_date, title, summary, spot_id, metadata, dedupe_key)
      VALUES
        (p_user_id, p_temp_log_id, 'first_pool_swim', v_story_date,
         'Your first pool swim', 'Logged at ' || v_spot.name || '.',
         v_log.spot_id,
         jsonb_build_object('spot_name', v_spot.name, 'water_type', v_spot.water_type, 'classification_source', 'spot_water_type'),
         'first_pool_swim')
      ON CONFLICT (user_id, dedupe_key) DO NOTHING
      RETURNING * INTO v_row;
      GET DIAGNOSTICS v_found = ROW_COUNT;
      IF v_found THEN
        v_events := v_events || to_jsonb(v_row);
      ELSE
        v_suppressed := v_suppressed || jsonb_build_object('story_type', 'first_pool_swim', 'dedupe_key', 'first_pool_swim');
      END IF;
    ELSE
      INSERT INTO swimmer_story_events
        (user_id, temp_log_id, story_type, story_date, title, summary, spot_id, metadata, dedupe_key)
      VALUES
        (p_user_id, p_temp_log_id, 'first_open_water_swim', v_story_date,
         'Your first open water swim', 'Logged at ' || v_spot.name || '.',
         v_log.spot_id,
         jsonb_build_object('spot_name', v_spot.name, 'water_type', v_spot.water_type, 'classification_source', 'spot_water_type'),
         'first_open_water_swim')
      ON CONFLICT (user_id, dedupe_key) DO NOTHING
      RETURNING * INTO v_row;
      GET DIAGNOSTICS v_found = ROW_COUNT;
      IF v_found THEN
        v_events := v_events || to_jsonb(v_row);
      ELSE
        v_suppressed := v_suppressed || jsonb_build_object('story_type', 'first_open_water_swim', 'dedupe_key', 'first_open_water_swim');
      END IF;
    END IF;
  END IF;

  -- ── CONSISTENCY: streak_milestone ──────────────────────────────
  -- Reads user_stats.current_streak, which trigger_update_stats_on_log
  -- (AFTER INSERT on temp_logs) has already recomputed by the time this
  -- runs — never recomputed here, to avoid a second, possibly divergent,
  -- streak implementation. Postgres fires same-event/same-timing triggers
  -- in NAME order, so this only holds because the trigger OBJECT (not
  -- function) is deliberately named 'trg_zz_evaluate_swim_story_events_v1'
  -- — 'zz' sorts after every existing AFTER INSERT trigger on temp_logs
  -- (trg_award_temp_log_points, trigger_update_stats_on_log). If a future
  -- migration adds another AFTER INSERT trigger on temp_logs that must
  -- also run before this one, re-verify it still sorts earlier than 'zz'.
  FOREACH v_threshold IN ARRAY ARRAY[7,14,30,50,100] LOOP
    IF v_streak >= v_threshold THEN
      INSERT INTO swimmer_story_events
        (user_id, temp_log_id, story_type, story_date, title, summary,
         primary_value, unit, spot_id, metadata, dedupe_key)
      VALUES
        (p_user_id, p_temp_log_id, 'streak_milestone', v_story_date,
         v_threshold || '-day streak',
         'You have logged a swim for ' || v_threshold || ' days in a row.',
         v_threshold, 'days', v_log.spot_id,
         jsonb_build_object('current_streak', v_streak, 'threshold', v_threshold),
         'streak_' || v_threshold)
      ON CONFLICT (user_id, dedupe_key) DO NOTHING
      RETURNING * INTO v_row;
      GET DIAGNOSTICS v_found = ROW_COUNT;
      IF v_found THEN
        v_events := v_events || to_jsonb(v_row);
      ELSE
        v_suppressed := v_suppressed || jsonb_build_object('story_type', 'streak_milestone', 'dedupe_key', 'streak_' || v_threshold);
      END IF;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('status', 'ok', 'events', v_events, 'suppressed', v_suppressed);
END;
$$;

REVOKE ALL ON FUNCTION public.evaluate_swim_story_events_internal_v1(uuid, uuid) FROM public, anon, authenticated;
-- No GRANT to authenticated: this function is reachable only through the
-- trigger (owner-privileged) and through evaluate_swim_story_events_v1
-- below (also owner-privileged, SECURITY DEFINER) — never called directly
-- by client SQL.

-- ── 4. Server-authoritative trigger (fires on every insert, no client
--       involvement required) ─────────────────────────────────────
CREATE OR REPLACE FUNCTION public.trigger_evaluate_swim_story_events_v1()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.evaluate_swim_story_events_internal_v1(NEW.user_id, NEW.id);
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- MUST NEVER fail the temp_logs insert. Best-effort failure record only;
  -- if even that insert fails, swallow it too.
  BEGIN
    INSERT INTO analytics_events (event_name, user_id, properties)
    VALUES ('story_event_generation_failed', NEW.user_id,
            jsonb_build_object('temp_log_id', NEW.id, 'source', 'trigger',
                                'sqlstate', SQLSTATE, 'message', SQLERRM));
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_zz_evaluate_swim_story_events_v1
  AFTER INSERT ON temp_logs
  FOR EACH ROW EXECUTE FUNCTION public.trigger_evaluate_swim_story_events_v1();

-- ── 5. Public RPC — retry / retrieval / analytics layer only ────
-- evaluate_swim_story_events_v1(p_user_id, p_temp_log_id)
-- The ONLY place that checks auth.uid(). Delegates all story logic to the
-- shared internal evaluator — this function contains no threshold, dedupe
-- key, or wording of its own. Idempotent (same guarantee as the
-- internal function); safe for the client to call as a retry after a
-- dropped connection, and safe to call purely to retrieve what the
-- trigger already generated (in which case every relevant dedupe_key
-- comes back in `suppressed`, not `events` — that is expected, not an
-- error, since the trigger runs synchronously inside the same INSERT
-- transaction and therefore always gets there first in the normal case).
CREATE OR REPLACE FUNCTION public.evaluate_swim_story_events_v1(p_user_id uuid, p_temp_log_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result jsonb;
BEGIN
  IF auth.uid() IS NULL OR auth.uid() <> p_user_id THEN
    RETURN jsonb_build_object('error', 'not_authenticated');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM temp_logs WHERE id = p_temp_log_id AND user_id = p_user_id) THEN
    RETURN jsonb_build_object('error', 'log_not_found');
  END IF;

  BEGIN
    v_result := public.evaluate_swim_story_events_internal_v1(p_user_id, p_temp_log_id);
  EXCEPTION WHEN OTHERS THEN
    BEGIN
      INSERT INTO analytics_events (event_name, user_id, properties)
      VALUES ('story_event_generation_failed', p_user_id,
              jsonb_build_object('temp_log_id', p_temp_log_id, 'source', 'client_rpc',
                                  'sqlstate', SQLSTATE, 'message', SQLERRM));
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
    RETURN jsonb_build_object('error', 'internal_error');
  END;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.evaluate_swim_story_events_v1(uuid, uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.evaluate_swim_story_events_v1(uuid, uuid) TO authenticated;

COMMIT;

-- ----------------------------------------------------------------
-- ROLLBACK — exact SQL to undo, or state:
-- "irreversible — restore from _bak_YYYYMMDD_tablename"
-- ----------------------------------------------------------------
-- BEGIN;
-- DROP TRIGGER IF EXISTS trg_zz_evaluate_swim_story_events_v1 ON temp_logs;
-- DROP FUNCTION IF EXISTS public.trigger_evaluate_swim_story_events_v1();
-- DROP FUNCTION IF EXISTS public.evaluate_swim_story_events_v1(uuid, uuid);
-- DROP FUNCTION IF EXISTS public.evaluate_swim_story_events_internal_v1(uuid, uuid);
-- DROP TRIGGER IF EXISTS trg_touch_swimmer_story_events_updated_at ON swimmer_story_events;
-- DROP FUNCTION IF EXISTS public.touch_swimmer_story_events_updated_at();
-- DROP TABLE IF EXISTS swimmer_story_events;
-- DROP FUNCTION IF EXISTS public.story_engine_flag_enabled(uuid);
-- DELETE FROM feature_flags WHERE key = 'story_engine_v1';
--   -- Safe only if no other Phase-2.1+ code has started reading this flag
--   -- key by the time of rollback. Does NOT touch identity_layer_v1 or any
--   -- other flag row.
-- -- Defensive cleanup only — these should never exist outside a test's own
-- -- rolled-back transaction, but drop them if somehow left behind:
-- DROP TRIGGER IF EXISTS test_sse_force_fail ON swimmer_story_events;
-- DROP FUNCTION IF EXISTS pg_temp.test_sse_force_fail_fn();
-- COMMIT;
--
-- This rollback does NOT alter: temp_logs data, user_stats,
-- swimmer_achievements, profiles, badges/challenge tables, or any Strava
-- table or trigger. It removes trg_zz_evaluate_swim_story_events_v1 (this
-- migration's own trigger) and nothing else attached to temp_logs —
-- trg_award_temp_log_points and trigger_update_stats_on_log are untouched.

-- ----------------------------------------------------------------
-- VERIFY — run on the READ-ONLY connection AFTER applying.
-- State the expected result next to each query.
-- ----------------------------------------------------------------
-- SELECT key, enabled_global, allowed_user_ids FROM feature_flags WHERE key='story_engine_v1';
--   -- expect: 1 row, story_engine_v1, false, {df137255-3add-4153-b368-32e06e2be188}
-- SELECT count(*) FROM swimmer_story_events;  -- expect: 0
-- SELECT proname FROM pg_proc WHERE proname IN
--   ('evaluate_swim_story_events_v1','evaluate_swim_story_events_internal_v1',
--    'trigger_evaluate_swim_story_events_v1','story_engine_flag_enabled',
--    'touch_swimmer_story_events_updated_at');
--   -- expect: 5 rows
-- SELECT tgname FROM pg_trigger WHERE tgrelid = 'temp_logs'::regclass ORDER BY tgname;
--   -- expect: trg_zz_evaluate_swim_story_events_v1 present ALONGSIDE the
--   -- pre-existing trg_award_temp_log_points and trigger_update_stats_on_log
--   -- (3 total on temp_logs) — none of the pre-existing ones removed/changed
-- SELECT policyname FROM pg_policies WHERE tablename='swimmer_story_events';
--   -- expect: sse_select_own, sse_admin_select, sse_admin_update (3 rows, no INSERT/DELETE policy)
