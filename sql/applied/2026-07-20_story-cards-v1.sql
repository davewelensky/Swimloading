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
-- Migration: 2026-07-20_story-cards-v1.sql
-- Process:   see MIGRATIONS.md — no section below may be left empty
-- ================================================================

-- Purpose:
--   Release 2 Phase 2.3 — Story Cards (read layer only). Additive-only:
--   a separate story_cards_v1 feature flag (Dave-only, off globally —
--   independent of story_engine_v1 and story_timeline_v1) and one
--   read-only RPC, get_my_story_events_for_log_v1, that returns the
--   caller's own stored swimmer_story_events for one specific temp_log,
--   pre-ordered by the card-selection priority so the client never
--   recomputes milestone significance. Does not touch story-generation
--   logic, swimmer_story_events schema, get_my_story_timeline_v1, or any
--   existing row.
--
--   WHY A NEW RPC INSTEAD OF REUSING evaluate_swim_story_events_v1:
--   evaluate_swim_story_events_v1's `events` array only contains rows
--   THIS SPECIFIC CALL inserted — everything the trigger already created
--   (the normal case, since the trigger runs synchronously inside the
--   same INSERT transaction, before any client code executes) comes back
--   in `suppressed` instead. A naive card-post-log flow built on that
--   function would therefore almost always see an empty `events` array
--   and never show a card for the very swims that most deserve one. This
--   migration adds a plain read, scoped by (user_id, temp_log_id), that
--   returns whatever is actually stored regardless of which caller
--   created it — see app-story-card.js for the full architectural note.
--
--   PRIORITY ORDERING lives entirely in this RPC's ORDER BY (a static
--   CASE lookup over story_type/primary_value, not a recomputation of
--   any milestone logic) — the client trusts events[0] as the lead event
--   and never re-derives significance itself.

-- Requested by:
--   Dave (SwimLoading Release 2: Living Story, Phase 2.3 kickoff, 2026-07-20)

-- ----------------------------------------------------------------
-- PRE-CHECKS — run on the READ-ONLY connection BEFORE applying.
-- Must include affected-row counts for any UPDATE/DELETE.
-- ----------------------------------------------------------------
-- No UPDATE/DELETE anywhere — additive only. Pre-checks confirm none of
-- the new objects already exist:
-- SELECT count(*) FROM feature_flags WHERE key='story_cards_v1';
--   -- expect: 0
-- SELECT count(*) FROM pg_proc WHERE proname IN
--   ('get_my_story_events_for_log_v1','story_cards_flag_enabled');
--   -- expect: 0

-- ----------------------------------------------------------------
-- BACKUP — required before any DELETE / UPDATE / DROP / TRUNCATE.
-- ----------------------------------------------------------------
-- Not required: additive only (one feature_flags row, two functions,
-- grants). Does not alter swimmer_story_events schema/rows, the story
-- evaluation functions, get_my_story_timeline_v1, temp_logs, user_stats,
-- identity tables, badges, challenges, Strava tables, or public_profiles.

-- ----------------------------------------------------------------
-- MIGRATION — applied only after Dave types "apply".
-- ----------------------------------------------------------------
BEGIN;

-- ── 1. Feature flag ──────────────────────────────────────────────
-- story_cards_v1: OFF globally, enabled for Dave only. Independent of
-- story_engine_v1 and story_timeline_v1 — either can be widened without
-- affecting this one.
INSERT INTO feature_flags (key, enabled_global, allowed_user_ids)
VALUES ('story_cards_v1', false, ARRAY['df137255-3add-4153-b368-32e06e2be188']::uuid[])
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.story_cards_flag_enabled(p_user uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT enabled_global OR p_user = ANY(allowed_user_ids)
       FROM feature_flags WHERE key = 'story_cards_v1'),
    false);
$$;

REVOKE ALL ON FUNCTION public.story_cards_flag_enabled(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.story_cards_flag_enabled(uuid) TO authenticated;

-- ── 2. get_my_story_events_for_log_v1 — read-only, own-log-only RPC ──
-- SECURITY INVOKER: swimmer_story_events already has sse_select_own RLS
-- (auth.uid() = user_id) permitting exactly this read; temp_logs' own
-- SELECT policies are broader than "owner only" (authenticated users can
-- read all temp_logs, for community-feed purposes elsewhere in the app),
-- so the explicit `WHERE tl.user_id = auth.uid()` predicate below — not
-- temp_logs' RLS — is what actually enforces "only your own log" here.
--
-- Returns a plain jsonb array (not wrapped in an object — no pagination
-- metadata is needed for a single log's events). Anonymous callers and a
-- log that isn't found/isn't the caller's both resolve to the same safe
-- empty array or explicit anonymous rejection — never a state that
-- reveals whether a given temp_log_id exists for someone else.
CREATE OR REPLACE FUNCTION public.get_my_story_events_for_log_v1(p_temp_log_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_owns_log boolean;
  v_events   jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '28000';
  END IF;

  IF NOT story_cards_flag_enabled(auth.uid()) THEN
    RAISE EXCEPTION 'feature_disabled' USING ERRCODE = '42501';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM temp_logs tl WHERE tl.id = p_temp_log_id AND tl.user_id = auth.uid()
  ) INTO v_owns_log;

  IF NOT v_owns_log THEN
    RETURN '[]'::jsonb; -- not found, not yours, or never existed — identical, safe response
  END IF;

  -- Card-selection priority (see the migration header note above for why
  -- this lives here and not in the client): category rank first, then a
  -- within-category rank. first_sub_* is ranked by an explicit CASE
  -- because primary_value there stores the swimmer's ACTUAL recorded
  -- temperature, not the threshold crossed — a colder recorded temp does
  -- not necessarily mean a "more significant" threshold in story terms
  -- (e.g. 4.9°C crossing first_sub_5 outranks 15.9°C crossing
  -- first_sub_16 regardless of which specific decimal was recorded).
  -- The four threshold-milestone types (swim_count / spots_explored /
  -- spot_visit / streak) instead sort by primary_value DESC, because
  -- primary_value there IS the exact threshold crossed (10, 25, 50...).
  WITH ranked AS (
    SELECT
      sse.id, sse.story_type, sse.story_date, sse.title, sse.summary,
      sse.primary_value, sse.secondary_value, sse.unit,
      sse.spot_id, sp.name AS spot_name, sse.verification_status, sse.created_at,
      CASE sse.story_type
        WHEN 'first_swim' THEN 1
        WHEN 'swim_count_milestone' THEN 2
        WHEN 'first_sub_16' THEN 3 WHEN 'first_sub_13' THEN 3 WHEN 'first_sub_10' THEN 3
        WHEN 'first_sub_7' THEN 3 WHEN 'first_sub_5' THEN 3
        WHEN 'new_coldest_swim' THEN 4 WHEN 'new_warmest_swim' THEN 4
        WHEN 'spots_explored_milestone' THEN 5
        WHEN 'spot_visit_milestone' THEN 6
        WHEN 'streak_milestone' THEN 7
        WHEN 'first_pool_swim' THEN 8 WHEN 'first_open_water_swim' THEN 8
        WHEN 'first_spot_visit' THEN 9
        ELSE 99
      END AS category_rank,
      CASE sse.story_type
        WHEN 'first_sub_5' THEN 1 WHEN 'first_sub_7' THEN 2 WHEN 'first_sub_10' THEN 3
        WHEN 'first_sub_13' THEN 4 WHEN 'first_sub_16' THEN 5
        ELSE 0
      END AS sub_rank
    FROM swimmer_story_events sse
    LEFT JOIN spots sp ON sp.id = sse.spot_id
    WHERE sse.user_id = auth.uid()
      AND sse.temp_log_id = p_temp_log_id
  )
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', id, 'story_type', story_type, 'story_date', story_date,
      'title', title, 'summary', summary,
      'primary_value', primary_value, 'secondary_value', secondary_value, 'unit', unit,
      'spot_id', spot_id, 'spot_name', spot_name,
      'verification_status', verification_status, 'created_at', created_at
    ) ORDER BY category_rank ASC, sub_rank ASC, primary_value DESC NULLS LAST, id DESC
  ), '[]'::jsonb)
  INTO v_events
  FROM ranked;

  RETURN v_events;
END;
$$;

COMMENT ON FUNCTION public.get_my_story_events_for_log_v1(uuid) IS
  'Phase 2.3 — read-only, own-log-only fetch of the stored story events '
  'for one temp_log, pre-ordered by card-selection priority. Never '
  'accepts a target user_id; never returns dedupe_key, temp_log_id, '
  'user_id, coordinates, or raw metadata. Does not generate or alter '
  'story events.';

REVOKE ALL ON FUNCTION public.get_my_story_events_for_log_v1(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.get_my_story_events_for_log_v1(uuid) TO authenticated;

COMMIT;

-- ----------------------------------------------------------------
-- ROLLBACK — exact SQL to undo, or state:
-- "irreversible — restore from _bak_YYYYMMDD_tablename"
-- ----------------------------------------------------------------
-- BEGIN;
-- DROP FUNCTION IF EXISTS public.get_my_story_events_for_log_v1(uuid);
-- DROP FUNCTION IF EXISTS public.story_cards_flag_enabled(uuid);
-- DELETE FROM feature_flags WHERE key = 'story_cards_v1';
--   -- Safe only if no other Phase-2.3+ code has started reading this
--   -- flag key by the time of rollback. Does NOT touch story_engine_v1,
--   -- story_timeline_v1, identity_layer_v1, or any other flag row.
-- COMMIT;
--
-- This rollback does NOT alter: swimmer_story_events schema or rows,
-- evaluate_swim_story_events_v1 / evaluate_swim_story_events_internal_v1 /
-- trigger_evaluate_swim_story_events_v1, get_my_story_timeline_v1,
-- temp_logs, user_stats, identity tables, badges, challenges, Strava
-- tables, or public_profiles.

-- ----------------------------------------------------------------
-- VERIFY — run on the READ-ONLY connection AFTER applying.
-- State the expected result next to each query.
-- ----------------------------------------------------------------
-- SELECT key, enabled_global, allowed_user_ids FROM feature_flags WHERE key='story_cards_v1';
--   -- expect: 1 row, story_cards_v1, false, {df137255-3add-4153-b368-32e06e2be188}
-- SELECT key, enabled_global FROM feature_flags WHERE key IN ('story_engine_v1','story_timeline_v1');
--   -- expect: UNCHANGED — both still false, still Dave-only
-- SELECT proname FROM pg_proc WHERE proname IN
--   ('get_my_story_events_for_log_v1','story_cards_flag_enabled');
--   -- expect: 2 rows
-- SELECT count(*) FROM swimmer_story_events;
--   -- expect: UNCHANGED from before this migration (writes no rows)
