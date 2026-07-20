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
-- Migration: 2026-07-20_story-engine-v1-1-threshold-crossed.sql
-- Process:   see MIGRATIONS.md — no section below may be left empty
-- ================================================================

-- Purpose:
--   Corrective follow-up to 2026-07-20_story-engine-v1.sql. Replaces ONLY
--   evaluate_swim_story_events_internal_v1 — the function body, nothing
--   else. Changes every permanent-milestone check from "threshold reached"
--   (attempt every threshold <= the current count, forever, on every later
--   swim) to "threshold crossed by this exact log" (attempt only the one
--   threshold this log's count exactly equals). The trigger
--   (trigger_evaluate_swim_story_events_v1) and the public RPC
--   (evaluate_swim_story_events_v1) are untouched — both already delegate
--   all logic to this one function and needed no change.
--
--   PROBLEM this fixes: with "reached" logic, once a swimmer passed e.g.
--   swim_count_10, EVERY subsequent swim re-attempted that insert, hit the
--   unique conflict, and got reported back as `suppressed` — so
--   app-story.js fired story_event_duplicate_suppressed on effectively
--   every swim a veteran user ever logged again, for every milestone
--   they'd already earned. Not a data-integrity bug (no duplicate rows
--   were ever possible — the unique constraint always held) but real,
--   unbounded analytics noise, confirmed during Phase 2.1 review testing.
--
--   FIX: exact-match guards (count = ANY(thresholds)) for swim_count_
--   milestone / spots_explored_milestone / spot_visit_milestone /
--   streak_milestone — each now attempts at most ONE insert per call,
--   only when the just-written log is the one that made the count equal
--   a threshold. first_pool_swim / first_open_water_swim now guard on
--   "count of same-classification swims for this user, including this
--   one, = 1" (previously unguarded — attempted on literally every pool/
--   open-water swim ever). first_sub_16/13/10/7/5 now additionally
--   require the swimmer's prior coldest (excluding this log) to NOT
--   already be below that threshold — so each fires exactly once, on the
--   first log that ever crosses it, using a value the function already
--   computes (v_prior_coldest) rather than a new query.
--
--   TRADEOFF, explicit and accepted per Dave's instruction: exact-match
--   guards mean a threshold CAN be silently skipped if a bulk/historical
--   import inserts logs such that a user's count jumps past a threshold
--   between two evaluator invocations that don't happen to land exactly
--   on it (e.g. a batch import script that computes counts differently,
--   or any future write path that doesn't fire this trigger per row).
--   This migration does NOT add reconciliation/catch-up logic for that —
--   seeing every already-earned milestone re-flagged as duplicate-
--   suppressed forever was judged worse than an unlikely missed
--   milestone. If catch-up ever becomes a real problem, that is separate,
--   explicitly-approved work — see BACKFILL SEPARATION below.
--
--   new_coldest_swim / new_warmest_swim are UNCHANGED — they were never
--   part of this bug (dedupe_key already includes temp_log_id, so they
--   were already log-specific and correctly repeatable across history)
--   and keep the wording fixed in the original migration ("Your coldest/
--   warmest recorded swim").
--
--   BACKFILL SEPARATION: evaluate_swim_story_events_v1 (and the internal
--   function it wraps) is a LIVE INCREMENTAL evaluator. It only ever
--   reasons about the swim log that was just written (NEW.id from the
--   trigger, or p_temp_log_id from the RPC) plus the swimmer's current
--   aggregate state. It is explicitly NOT a historical reconstruction
--   engine — it does not, and after this migration still does not, walk
--   a swimmer's full log history to backfill missed milestones. Any
--   future backfill (e.g. to retroactively generate story events for
--   users who logged swims before story_engine_v1 existed, or to recover
--   from a genuinely skipped threshold) must be its own separate,
--   explicitly-approved function with full-history logic — it is not
--   created or run by this migration.

-- Requested by:
--   Dave (SwimLoading Release 2: Living Story, Phase 2.1 — corrective
--   follow-up after the applied migration's own review-testing surfaced
--   the duplicate-suppressed analytics noise, 2026-07-20)

-- ----------------------------------------------------------------
-- PRE-CHECKS — run on the READ-ONLY connection BEFORE applying.
-- Must include affected-row counts for any UPDATE/DELETE.
-- ----------------------------------------------------------------
-- No UPDATE/DELETE anywhere — this migration only CREATE OR REPLACEs one
-- existing function. Pre-checks confirm the baseline being replaced:
-- SELECT count(*) FROM pg_proc WHERE proname = 'evaluate_swim_story_events_internal_v1';
--   -- expect: 1 (the version from 2026-07-20_story-engine-v1.sql)
-- SELECT count(*) FROM swimmer_story_events;
--   -- expect: 0 (flag is still off; no production data exists yet — this
--   -- migration changes behaviour going forward only, nothing to reconcile)
-- SELECT key, enabled_global, allowed_user_ids FROM feature_flags WHERE key = 'story_engine_v1';
--   -- expect: story_engine_v1, false, {df137255-3add-4153-b368-32e06e2be188}

-- ----------------------------------------------------------------
-- BACKUP — required before any DELETE / UPDATE / DROP / TRUNCATE.
-- ----------------------------------------------------------------
-- Not required: CREATE OR REPLACE FUNCTION only, on a function with zero
-- production rows generated under it so far (flag has never been on
-- globally). Does not touch swimmer_story_events schema/rows, temp_logs,
-- identity tables, badges, challenges, Strava tables, or feature-flag
-- state.

-- ----------------------------------------------------------------
-- MIGRATION — applied only after Dave types "apply".
-- ----------------------------------------------------------------
BEGIN;

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
  v_class_swims    int;
  v_prior_coldest  numeric;
  v_prior_warmest  numeric;
  v_streak         int := 0;
  v_events         jsonb := '[]'::jsonb;
  v_suppressed     jsonb := '[]'::jsonb;
  v_row            swimmer_story_events%ROWTYPE;
  v_found          boolean;
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

  -- Authoritative counts — always recomputed from temp_logs, never read
  -- from a cached counter the caller could have influenced.
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
  -- Already exact-match by construction: v_total_logs can equal 1 for
  -- exactly one log, ever, per user. No change from the prior version.
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
  -- THRESHOLD-CROSSED (not threshold-reached): fires only when this log
  -- is the one that made the count exactly equal a threshold. Generates
  -- at most one event per call — never loops through lower thresholds
  -- the swimmer already passed. 1 is deliberately not in this list —
  -- a swimmer's first log fires first_swim only.
  IF v_total_logs = ANY(ARRAY[10,25,50,100,250,500,1000]) THEN
    INSERT INTO swimmer_story_events
      (user_id, temp_log_id, story_type, story_date, title, summary,
       primary_value, unit, spot_id, metadata, dedupe_key)
    VALUES
      (p_user_id, p_temp_log_id, 'swim_count_milestone', v_story_date,
       v_total_logs || ' swims recorded',
       'You have now recorded ' || v_total_logs || ' swims on SwimLoading.',
       v_total_logs, 'swims', v_log.spot_id,
       jsonb_build_object('total_logs', v_total_logs, 'threshold', v_total_logs),
       'swim_count_' || v_total_logs)
    ON CONFLICT (user_id, dedupe_key) DO NOTHING
    RETURNING * INTO v_row;
    GET DIAGNOSTICS v_found = ROW_COUNT;
    IF v_found THEN
      v_events := v_events || to_jsonb(v_row);
    ELSE
      v_suppressed := v_suppressed || jsonb_build_object('story_type', 'swim_count_milestone', 'dedupe_key', 'swim_count_' || v_total_logs);
    END IF;
  END IF;

  -- ── EXPLORATION: first_spot_visit ──────────────────────────────
  -- Already exact-match by construction (v_spot_visits = 1 happens once
  -- per user per spot). No change from the prior version.
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
  -- THRESHOLD-CROSSED — see swim_count_milestone comment above.
  IF v_spots_explored = ANY(ARRAY[5,10,25,50,100]) THEN
    INSERT INTO swimmer_story_events
      (user_id, temp_log_id, story_type, story_date, title, summary,
       primary_value, unit, spot_id, metadata, dedupe_key)
    VALUES
      (p_user_id, p_temp_log_id, 'spots_explored_milestone', v_story_date,
       v_spots_explored || ' spots explored',
       'You have now swum at ' || v_spots_explored || ' different spots.',
       v_spots_explored, 'spots', v_log.spot_id,
       jsonb_build_object('spots_explored', v_spots_explored, 'threshold', v_spots_explored),
       'spots_explored_' || v_spots_explored)
    ON CONFLICT (user_id, dedupe_key) DO NOTHING
    RETURNING * INTO v_row;
    GET DIAGNOSTICS v_found = ROW_COUNT;
    IF v_found THEN
      v_events := v_events || to_jsonb(v_row);
    ELSE
      v_suppressed := v_suppressed || jsonb_build_object('story_type', 'spots_explored_milestone', 'dedupe_key', 'spots_explored_' || v_spots_explored);
    END IF;
  END IF;

  -- ── EXPLORATION: spot_visit_milestone ──────────────────────────
  -- THRESHOLD-CROSSED — see swim_count_milestone comment above.
  IF v_has_spot AND v_spot_visits = ANY(ARRAY[10,25,50,100]) THEN
    INSERT INTO swimmer_story_events
      (user_id, temp_log_id, story_type, story_date, title, summary,
       primary_value, unit, spot_id, metadata, dedupe_key)
    VALUES
      (p_user_id, p_temp_log_id, 'spot_visit_milestone', v_story_date,
       v_spot_visits || ' visits to ' || v_spot.name,
       'You have logged ' || v_spot_visits || ' swims at ' || v_spot.name || '.',
       v_spot_visits, 'visits', v_log.spot_id,
       jsonb_build_object('spot_name', v_spot.name, 'visits', v_spot_visits, 'threshold', v_spot_visits),
       'spot_visit_' || v_spot_visits || ':' || v_log.spot_id)
    ON CONFLICT (user_id, dedupe_key) DO NOTHING
    RETURNING * INTO v_row;
    GET DIAGNOSTICS v_found = ROW_COUNT;
    IF v_found THEN
      v_events := v_events || to_jsonb(v_row);
    ELSE
      v_suppressed := v_suppressed || jsonb_build_object('story_type', 'spot_visit_milestone', 'dedupe_key', 'spot_visit_' || v_spot_visits || ':' || v_log.spot_id);
    END IF;
  END IF;

  -- ── TEMPERATURE: new_coldest_swim / new_warmest_swim ───────────
  -- UNCHANGED — dedupe_key includes temp_log_id, so these were already
  -- log-specific and correctly repeatable across a swimmer's history; not
  -- part of the permanent-milestone noise bug. "Recorded" wording is
  -- deliberate — see the comment on this function in the original
  -- migration re: backdating and currently-stored-history semantics.
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

  -- ── TEMPERATURE: first_sub_* ────────────────────────────────────
  -- THRESHOLD-CROSSED: a log qualifies for first_sub_X only when it is
  -- below X AND no prior log (v_prior_coldest, already computed above)
  -- was already below X. Once any log has ever gone below a threshold,
  -- v_prior_coldest for every later log will be <= that value, so the
  -- second half of this condition becomes permanently false — each
  -- first_sub_X can only ever be attempted once, on the log that first
  -- crossed it. No new query needed; reuses v_prior_coldest.
  FOR v_sub_type, v_sub_threshold IN
    SELECT * FROM (VALUES
      ('first_sub_16', 16.0), ('first_sub_13', 13.0), ('first_sub_10', 10.0),
      ('first_sub_7', 7.0), ('first_sub_5', 5.0)
    ) AS t(k, thresh)
  LOOP
    IF v_log.temp_c < v_sub_threshold
       AND (v_prior_coldest IS NULL OR v_prior_coldest >= v_sub_threshold) THEN
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
  -- THRESHOLD-CROSSED (new guard — this was previously unguarded and
  -- attempted on EVERY pool/open-water swim ever, the worst offender for
  -- suppressed-analytics noise). v_class_swims is the count of this
  -- user's same-classification swims INCLUDING this one; = 1 means this
  -- log is, by count, the first one ever of that classification.
  -- Classified from spots.water_type only (the authoritative, populated
  -- column) — never from temp_logs.location_type, which is mostly NULL
  -- in production today. A log with no resolvable spot is still skipped
  -- rather than guessed.
  IF v_has_spot THEN
    IF v_spot.water_type = 'POOL' THEN
      SELECT count(*) INTO v_class_swims
        FROM temp_logs t JOIN spots s ON s.id = t.spot_id
        WHERE t.user_id = p_user_id AND s.water_type = 'POOL';
      IF v_class_swims = 1 THEN
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
      END IF;
    ELSE
      SELECT count(*) INTO v_class_swims
        FROM temp_logs t JOIN spots s ON s.id = t.spot_id
        WHERE t.user_id = p_user_id AND s.water_type <> 'POOL';
      IF v_class_swims = 1 THEN
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
  END IF;

  -- ── CONSISTENCY: streak_milestone ──────────────────────────────
  -- THRESHOLD-CROSSED — see swim_count_milestone comment above. Still
  -- reads user_stats.current_streak (never recomputed here) — see
  -- ordering guarantee comment on trg_zz_evaluate_swim_story_events_v1
  -- in the original migration; unaffected by this change.
  IF v_streak = ANY(ARRAY[7,14,30,50,100]) THEN
    INSERT INTO swimmer_story_events
      (user_id, temp_log_id, story_type, story_date, title, summary,
       primary_value, unit, spot_id, metadata, dedupe_key)
    VALUES
      (p_user_id, p_temp_log_id, 'streak_milestone', v_story_date,
       v_streak || '-day streak',
       'You have logged a swim for ' || v_streak || ' days in a row.',
       v_streak, 'days', v_log.spot_id,
       jsonb_build_object('current_streak', v_streak, 'threshold', v_streak),
       'streak_' || v_streak)
    ON CONFLICT (user_id, dedupe_key) DO NOTHING
    RETURNING * INTO v_row;
    GET DIAGNOSTICS v_found = ROW_COUNT;
    IF v_found THEN
      v_events := v_events || to_jsonb(v_row);
    ELSE
      v_suppressed := v_suppressed || jsonb_build_object('story_type', 'streak_milestone', 'dedupe_key', 'streak_' || v_streak);
    END IF;
  END IF;

  RETURN jsonb_build_object('status', 'ok', 'events', v_events, 'suppressed', v_suppressed);
END;
$$;

REVOKE ALL ON FUNCTION public.evaluate_swim_story_events_internal_v1(uuid, uuid) FROM public, anon, authenticated;

COMMIT;

-- ----------------------------------------------------------------
-- ROLLBACK — restores the PREVIOUS (threshold-reached) evaluator body
-- exactly as applied by 2026-07-20_story-engine-v1.sql. Only this one
-- function is touched; nothing else in this migration or its rollback
-- alters swimmer_story_events schema/rows, temp_logs, identity tables,
-- badges, challenges, Strava tables, or feature-flag state.
-- ----------------------------------------------------------------
-- BEGIN;
-- CREATE OR REPLACE FUNCTION public.evaluate_swim_story_events_internal_v1(p_user_id uuid, p_temp_log_id uuid)
-- RETURNS jsonb
-- LANGUAGE plpgsql SECURITY DEFINER
-- SET search_path = public
-- AS $$
-- DECLARE
--   v_log            temp_logs%ROWTYPE;
--   v_spot           spots%ROWTYPE;
--   v_has_spot       boolean := false;
--   v_story_date     date;
--   v_total_logs     int;
--   v_spots_explored int;
--   v_spot_visits    int := 0;
--   v_prior_coldest  numeric;
--   v_prior_warmest  numeric;
--   v_streak         int := 0;
--   v_events         jsonb := '[]'::jsonb;
--   v_suppressed     jsonb := '[]'::jsonb;
--   v_row            swimmer_story_events%ROWTYPE;
--   v_found          boolean;
--   v_threshold      int;
--   v_sub_threshold  numeric;
--   v_sub_type       text;
-- BEGIN
--   IF NOT story_engine_flag_enabled(p_user_id) THEN
--     RETURN jsonb_build_object('error', 'feature_disabled');
--   END IF;
--   SELECT * INTO v_log FROM temp_logs WHERE id = p_temp_log_id AND user_id = p_user_id;
--   IF NOT FOUND THEN
--     RETURN jsonb_build_object('error', 'log_not_found');
--   END IF;
--   v_story_date := COALESCE(v_log.logged_at, v_log.created_at)::date;
--   IF v_log.spot_id IS NOT NULL THEN
--     SELECT * INTO v_spot FROM spots WHERE id = v_log.spot_id;
--     v_has_spot := FOUND;
--   END IF;
--   SELECT count(*) INTO v_total_logs FROM temp_logs WHERE user_id = p_user_id;
--   SELECT count(DISTINCT spot_id) INTO v_spots_explored
--     FROM temp_logs WHERE user_id = p_user_id AND spot_id IS NOT NULL;
--   IF v_has_spot THEN
--     SELECT count(*) INTO v_spot_visits
--       FROM temp_logs WHERE user_id = p_user_id AND spot_id = v_log.spot_id;
--   END IF;
--   SELECT min(temp_c) INTO v_prior_coldest FROM temp_logs WHERE user_id = p_user_id AND id <> p_temp_log_id;
--   SELECT max(temp_c) INTO v_prior_warmest FROM temp_logs WHERE user_id = p_user_id AND id <> p_temp_log_id;
--   SELECT current_streak INTO v_streak FROM user_stats WHERE user_id = p_user_id;
--   v_streak := COALESCE(v_streak, 0);
--   IF v_total_logs = 1 THEN
--     INSERT INTO swimmer_story_events
--       (user_id, temp_log_id, story_type, story_date, title, summary, spot_id, metadata, dedupe_key)
--     VALUES
--       (p_user_id, p_temp_log_id, 'first_swim', v_story_date,
--        'Your first recorded swim', 'This is the start of your SwimLoading story.',
--        v_log.spot_id, jsonb_build_object('total_logs', v_total_logs), 'first_swim')
--     ON CONFLICT (user_id, dedupe_key) DO NOTHING
--     RETURNING * INTO v_row;
--     GET DIAGNOSTICS v_found = ROW_COUNT;
--     IF v_found THEN v_events := v_events || to_jsonb(v_row);
--     ELSE v_suppressed := v_suppressed || jsonb_build_object('story_type', 'first_swim', 'dedupe_key', 'first_swim'); END IF;
--   END IF;
--   FOREACH v_threshold IN ARRAY ARRAY[10,25,50,100,250,500,1000] LOOP
--     IF v_total_logs >= v_threshold THEN
--       INSERT INTO swimmer_story_events
--         (user_id, temp_log_id, story_type, story_date, title, summary,
--          primary_value, unit, spot_id, metadata, dedupe_key)
--       VALUES
--         (p_user_id, p_temp_log_id, 'swim_count_milestone', v_story_date,
--          v_threshold || ' swims recorded',
--          'You have now recorded ' || v_threshold || ' swims on SwimLoading.',
--          v_threshold, 'swims', v_log.spot_id,
--          jsonb_build_object('total_logs', v_total_logs, 'threshold', v_threshold),
--          'swim_count_' || v_threshold)
--       ON CONFLICT (user_id, dedupe_key) DO NOTHING
--       RETURNING * INTO v_row;
--       GET DIAGNOSTICS v_found = ROW_COUNT;
--       IF v_found THEN v_events := v_events || to_jsonb(v_row);
--       ELSE v_suppressed := v_suppressed || jsonb_build_object('story_type', 'swim_count_milestone', 'dedupe_key', 'swim_count_' || v_threshold); END IF;
--     END IF;
--   END LOOP;
--   IF v_has_spot AND v_spot_visits = 1 THEN
--     INSERT INTO swimmer_story_events
--       (user_id, temp_log_id, story_type, story_date, title, summary, spot_id, metadata, dedupe_key)
--     VALUES
--       (p_user_id, p_temp_log_id, 'first_spot_visit', v_story_date,
--        'A new swim location', 'Your first recorded swim at ' || v_spot.name || '.',
--        v_log.spot_id, jsonb_build_object('spot_name', v_spot.name), 'spot_first_visit:' || v_log.spot_id)
--     ON CONFLICT (user_id, dedupe_key) DO NOTHING
--     RETURNING * INTO v_row;
--     GET DIAGNOSTICS v_found = ROW_COUNT;
--     IF v_found THEN v_events := v_events || to_jsonb(v_row);
--     ELSE v_suppressed := v_suppressed || jsonb_build_object('story_type', 'first_spot_visit', 'dedupe_key', 'spot_first_visit:' || v_log.spot_id); END IF;
--   END IF;
--   FOREACH v_threshold IN ARRAY ARRAY[5,10,25,50,100] LOOP
--     IF v_spots_explored >= v_threshold THEN
--       INSERT INTO swimmer_story_events
--         (user_id, temp_log_id, story_type, story_date, title, summary,
--          primary_value, unit, spot_id, metadata, dedupe_key)
--       VALUES
--         (p_user_id, p_temp_log_id, 'spots_explored_milestone', v_story_date,
--          v_threshold || ' spots explored',
--          'You have now swum at ' || v_threshold || ' different spots.',
--          v_threshold, 'spots', v_log.spot_id,
--          jsonb_build_object('spots_explored', v_spots_explored, 'threshold', v_threshold),
--          'spots_explored_' || v_threshold)
--       ON CONFLICT (user_id, dedupe_key) DO NOTHING
--       RETURNING * INTO v_row;
--       GET DIAGNOSTICS v_found = ROW_COUNT;
--       IF v_found THEN v_events := v_events || to_jsonb(v_row);
--       ELSE v_suppressed := v_suppressed || jsonb_build_object('story_type', 'spots_explored_milestone', 'dedupe_key', 'spots_explored_' || v_threshold); END IF;
--     END IF;
--   END LOOP;
--   IF v_has_spot THEN
--     FOREACH v_threshold IN ARRAY ARRAY[10,25,50,100] LOOP
--       IF v_spot_visits >= v_threshold THEN
--         INSERT INTO swimmer_story_events
--           (user_id, temp_log_id, story_type, story_date, title, summary,
--            primary_value, unit, spot_id, metadata, dedupe_key)
--         VALUES
--           (p_user_id, p_temp_log_id, 'spot_visit_milestone', v_story_date,
--            v_threshold || ' visits to ' || v_spot.name,
--            'You have logged ' || v_threshold || ' swims at ' || v_spot.name || '.',
--            v_threshold, 'visits', v_log.spot_id,
--            jsonb_build_object('spot_name', v_spot.name, 'visits', v_spot_visits, 'threshold', v_threshold),
--            'spot_visit_' || v_threshold || ':' || v_log.spot_id)
--         ON CONFLICT (user_id, dedupe_key) DO NOTHING
--         RETURNING * INTO v_row;
--         GET DIAGNOSTICS v_found = ROW_COUNT;
--         IF v_found THEN v_events := v_events || to_jsonb(v_row);
--         ELSE v_suppressed := v_suppressed || jsonb_build_object('story_type', 'spot_visit_milestone', 'dedupe_key', 'spot_visit_' || v_threshold || ':' || v_log.spot_id); END IF;
--       END IF;
--     END LOOP;
--   END IF;
--   IF v_prior_coldest IS NULL OR v_log.temp_c < v_prior_coldest THEN
--     INSERT INTO swimmer_story_events
--       (user_id, temp_log_id, story_type, story_date, title, summary,
--        primary_value, unit, spot_id, metadata, dedupe_key)
--     VALUES
--       (p_user_id, p_temp_log_id, 'new_coldest_swim', v_story_date,
--        'Your coldest recorded swim',
--        'You recorded ' || v_log.temp_c || '°C at ' || COALESCE(v_spot.name, 'an unnamed spot') || '.',
--        v_log.temp_c, '°C', v_log.spot_id,
--        jsonb_build_object('prior_coldest', v_prior_coldest, 'evaluated_against', 'currently_stored_history'),
--        'new_coldest:' || p_temp_log_id)
--     ON CONFLICT (user_id, dedupe_key) DO NOTHING
--     RETURNING * INTO v_row;
--     GET DIAGNOSTICS v_found = ROW_COUNT;
--     IF v_found THEN v_events := v_events || to_jsonb(v_row);
--     ELSE v_suppressed := v_suppressed || jsonb_build_object('story_type', 'new_coldest_swim', 'dedupe_key', 'new_coldest:' || p_temp_log_id); END IF;
--   END IF;
--   IF v_prior_warmest IS NULL OR v_log.temp_c > v_prior_warmest THEN
--     INSERT INTO swimmer_story_events
--       (user_id, temp_log_id, story_type, story_date, title, summary,
--        primary_value, unit, spot_id, metadata, dedupe_key)
--     VALUES
--       (p_user_id, p_temp_log_id, 'new_warmest_swim', v_story_date,
--        'Your warmest recorded swim',
--        'You recorded ' || v_log.temp_c || '°C at ' || COALESCE(v_spot.name, 'an unnamed spot') || '.',
--        v_log.temp_c, '°C', v_log.spot_id,
--        jsonb_build_object('prior_warmest', v_prior_warmest, 'evaluated_against', 'currently_stored_history'),
--        'new_warmest:' || p_temp_log_id)
--     ON CONFLICT (user_id, dedupe_key) DO NOTHING
--     RETURNING * INTO v_row;
--     GET DIAGNOSTICS v_found = ROW_COUNT;
--     IF v_found THEN v_events := v_events || to_jsonb(v_row);
--     ELSE v_suppressed := v_suppressed || jsonb_build_object('story_type', 'new_warmest_swim', 'dedupe_key', 'new_warmest:' || p_temp_log_id); END IF;
--   END IF;
--   FOR v_sub_type, v_sub_threshold IN
--     SELECT * FROM (VALUES
--       ('first_sub_16', 16.0), ('first_sub_13', 13.0), ('first_sub_10', 10.0),
--       ('first_sub_7', 7.0), ('first_sub_5', 5.0)
--     ) AS t(k, thresh)
--   LOOP
--     IF v_log.temp_c < v_sub_threshold THEN
--       INSERT INTO swimmer_story_events
--         (user_id, temp_log_id, story_type, story_date, title, summary,
--          primary_value, unit, spot_id, metadata, dedupe_key)
--       VALUES
--         (p_user_id, p_temp_log_id, v_sub_type, v_story_date,
--          'Your first swim below ' || v_sub_threshold::int || '°C',
--          'You recorded ' || v_log.temp_c || '°C at ' || COALESCE(v_spot.name, 'an unnamed spot') || '.',
--          v_log.temp_c, '°C', v_log.spot_id,
--          jsonb_build_object('threshold_c', v_sub_threshold), v_sub_type)
--       ON CONFLICT (user_id, dedupe_key) DO NOTHING
--       RETURNING * INTO v_row;
--       GET DIAGNOSTICS v_found = ROW_COUNT;
--       IF v_found THEN v_events := v_events || to_jsonb(v_row);
--       ELSE v_suppressed := v_suppressed || jsonb_build_object('story_type', v_sub_type, 'dedupe_key', v_sub_type); END IF;
--     END IF;
--   END LOOP;
--   IF v_has_spot THEN
--     IF v_spot.water_type = 'POOL' THEN
--       INSERT INTO swimmer_story_events
--         (user_id, temp_log_id, story_type, story_date, title, summary, spot_id, metadata, dedupe_key)
--       VALUES
--         (p_user_id, p_temp_log_id, 'first_pool_swim', v_story_date,
--          'Your first pool swim', 'Logged at ' || v_spot.name || '.',
--          v_log.spot_id,
--          jsonb_build_object('spot_name', v_spot.name, 'water_type', v_spot.water_type, 'classification_source', 'spot_water_type'),
--          'first_pool_swim')
--       ON CONFLICT (user_id, dedupe_key) DO NOTHING
--       RETURNING * INTO v_row;
--       GET DIAGNOSTICS v_found = ROW_COUNT;
--       IF v_found THEN v_events := v_events || to_jsonb(v_row);
--       ELSE v_suppressed := v_suppressed || jsonb_build_object('story_type', 'first_pool_swim', 'dedupe_key', 'first_pool_swim'); END IF;
--     ELSE
--       INSERT INTO swimmer_story_events
--         (user_id, temp_log_id, story_type, story_date, title, summary, spot_id, metadata, dedupe_key)
--       VALUES
--         (p_user_id, p_temp_log_id, 'first_open_water_swim', v_story_date,
--          'Your first open water swim', 'Logged at ' || v_spot.name || '.',
--          v_log.spot_id,
--          jsonb_build_object('spot_name', v_spot.name, 'water_type', v_spot.water_type, 'classification_source', 'spot_water_type'),
--          'first_open_water_swim')
--       ON CONFLICT (user_id, dedupe_key) DO NOTHING
--       RETURNING * INTO v_row;
--       GET DIAGNOSTICS v_found = ROW_COUNT;
--       IF v_found THEN v_events := v_events || to_jsonb(v_row);
--       ELSE v_suppressed := v_suppressed || jsonb_build_object('story_type', 'first_open_water_swim', 'dedupe_key', 'first_open_water_swim'); END IF;
--     END IF;
--   END IF;
--   FOREACH v_threshold IN ARRAY ARRAY[7,14,30,50,100] LOOP
--     IF v_streak >= v_threshold THEN
--       INSERT INTO swimmer_story_events
--         (user_id, temp_log_id, story_type, story_date, title, summary,
--          primary_value, unit, spot_id, metadata, dedupe_key)
--       VALUES
--         (p_user_id, p_temp_log_id, 'streak_milestone', v_story_date,
--          v_threshold || '-day streak',
--          'You have logged a swim for ' || v_threshold || ' days in a row.',
--          v_threshold, 'days', v_log.spot_id,
--          jsonb_build_object('current_streak', v_streak, 'threshold', v_threshold),
--          'streak_' || v_threshold)
--       ON CONFLICT (user_id, dedupe_key) DO NOTHING
--       RETURNING * INTO v_row;
--       GET DIAGNOSTICS v_found = ROW_COUNT;
--       IF v_found THEN v_events := v_events || to_jsonb(v_row);
--       ELSE v_suppressed := v_suppressed || jsonb_build_object('story_type', 'streak_milestone', 'dedupe_key', 'streak_' || v_threshold); END IF;
--     END IF;
--   END LOOP;
--   RETURN jsonb_build_object('status', 'ok', 'events', v_events, 'suppressed', v_suppressed);
-- END;
-- $$;
-- REVOKE ALL ON FUNCTION public.evaluate_swim_story_events_internal_v1(uuid, uuid) FROM public, anon, authenticated;
-- COMMIT;

-- ----------------------------------------------------------------
-- VERIFY — run on the READ-ONLY connection AFTER applying.
-- State the expected result next to each query.
-- ----------------------------------------------------------------
-- SELECT prosrc FROM pg_proc WHERE proname = 'evaluate_swim_story_events_internal_v1';
--   -- expect: body contains "= ANY(ARRAY[10,25,50,100,250,500,1000])" for
--   -- swim_count_milestone, not "FOREACH v_threshold IN ARRAY ... >= v_threshold"
-- SELECT key, enabled_global, allowed_user_ids FROM feature_flags WHERE key='story_engine_v1';
--   -- expect: story_engine_v1, false, {df137255-3add-4153-b368-32e06e2be188} — UNCHANGED
-- SELECT count(*) FROM swimmer_story_events;  -- expect: 0 — UNCHANGED
-- SELECT tgname FROM pg_trigger WHERE tgrelid = 'temp_logs'::regclass AND NOT tgisinternal ORDER BY tgname;
--   -- expect: same 5 triggers as before (enforce_no_backdating,
--   -- trg_award_temp_log_points, trg_remove_temp_log_points,
--   -- trg_zz_evaluate_swim_story_events_v1, trigger_update_stats_on_log) — UNCHANGED
