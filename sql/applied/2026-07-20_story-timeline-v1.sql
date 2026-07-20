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
-- Migration: 2026-07-20_story-timeline-v1.sql
-- Process:   see MIGRATIONS.md — no section below may be left empty
-- ================================================================

-- Purpose:
--   Release 2 Phase 2.2 — Story Timeline (read layer only). Additive-only:
--   a separate story_timeline_v1 feature flag (Dave-only, off globally —
--   deliberately NOT the same flag as story_engine_v1, so the engine can
--   keep generating events for Dave regardless of whether the timeline UI
--   is visible to him) and one read-only RPC, get_my_story_timeline_v1,
--   that returns the caller's own swimmer_story_events, paginated by a
--   deterministic 3-column keyset cursor. Does not touch story-generation
--   logic, swimmer_story_events schema, or any existing row.
--
--   SIGNATURE DEVIATION FROM THE ORIGINAL BRIEF, documented here because
--   it's a correctness call, not a preference: the brief's "suggested"
--   signature was get_my_story_timeline_v1(p_limit, p_before_created_at
--   timestamptz, p_story_types) — but the brief's own Pagination section
--   requires ordering (and therefore cursor) by story_date DESC,
--   created_at DESC, id DESC, and explicitly says "do not use created_at
--   alone because several events may be generated for the same swim." A
--   single timestamptz cursor cannot represent that 3-column keyset
--   without ties breaking incorrectly (e.g. two events sharing the same
--   created_at, or a backdated event with a story_date far from its
--   created_at). p_before_created_at is therefore replaced with
--   p_cursor jsonb default null, holding {story_date, created_at, id} —
--   the exact structure the Pagination section itself specifies. p_limit
--   and p_story_types are unchanged from the brief.

-- Requested by:
--   Dave (SwimLoading Release 2: Living Story, Phase 2.2 kickoff, 2026-07-20)

-- ----------------------------------------------------------------
-- PRE-CHECKS — run on the READ-ONLY connection BEFORE applying.
-- Must include affected-row counts for any UPDATE/DELETE.
-- ----------------------------------------------------------------
-- No UPDATE/DELETE anywhere — additive only. Pre-checks confirm none of
-- the new objects already exist:
-- SELECT count(*) FROM feature_flags WHERE key='story_timeline_v1';
--   -- expect: 0
-- SELECT count(*) FROM pg_proc WHERE proname IN
--   ('get_my_story_timeline_v1','story_timeline_flag_enabled');
--   -- expect: 0

-- ----------------------------------------------------------------
-- BACKUP — required before any DELETE / UPDATE / DROP / TRUNCATE.
-- ----------------------------------------------------------------
-- Not required: additive only (one feature_flags row, two functions,
-- grants). Does not alter swimmer_story_events schema/rows, the story
-- evaluation functions, temp_logs, user_stats, identity tables, badges,
-- challenges, Strava tables, or public_profiles.

-- ----------------------------------------------------------------
-- MIGRATION — applied only after Dave types "apply".
-- ----------------------------------------------------------------
BEGIN;

-- ── 1. Feature flag ──────────────────────────────────────────────
-- story_timeline_v1: OFF globally, enabled for Dave only. Deliberately a
-- SEPARATE flag from story_engine_v1 — the engine keeps generating
-- events for Dave (or anyone else story_engine_v1 is later widened to)
-- independently of whether this UI is visible to them.
INSERT INTO feature_flags (key, enabled_global, allowed_user_ids)
VALUES ('story_timeline_v1', false, ARRAY['df137255-3add-4153-b368-32e06e2be188']::uuid[])
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.story_timeline_flag_enabled(p_user uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT enabled_global OR p_user = ANY(allowed_user_ids)
       FROM feature_flags WHERE key = 'story_timeline_v1'),
    false);
$$;

REVOKE ALL ON FUNCTION public.story_timeline_flag_enabled(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.story_timeline_flag_enabled(uuid) TO authenticated;

-- ── 2. get_my_story_timeline_v1 — read-only, own-rows-only RPC ──
-- SECURITY INVOKER (not DEFINER — not required here): swimmer_story_events
-- already has an RLS policy (sse_select_own: auth.uid() = user_id) that
-- permits exactly the read this function performs, and spots has a
-- permissive authenticated SELECT policy (spots_read_all) for the
-- spot-name join. Running as invoker means this function can never read
-- more than the calling role's own RLS-granted rows even if its WHERE
-- clause were ever edited incorrectly — the explicit `user_id = auth.uid()`
-- filter below is defense-in-depth on top of that, not the only guard.
--
-- auth.uid() IS NULL (anonymous) and a disabled/not-yet-allowed flag both
-- RAISE EXCEPTION rather than silently returning empty — PostgREST turns
-- a raised exception into a real HTTP error the client can distinguish
-- from "you have zero events".
CREATE OR REPLACE FUNCTION public.get_my_story_timeline_v1(
  p_limit integer DEFAULT 20,
  p_cursor jsonb DEFAULT NULL,
  p_story_types text[] DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_limit             int;
  v_cursor_story_date date;
  v_cursor_created_at timestamptz;
  v_cursor_id         uuid;
  v_events            jsonb;
  v_has_more          boolean;
  v_next_cursor       jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '28000';
  END IF;

  IF NOT story_timeline_flag_enabled(auth.uid()) THEN
    RAISE EXCEPTION 'feature_disabled' USING ERRCODE = '42501';
  END IF;

  -- Max page size 50, default 20. A null/zero/negative/absurd p_limit
  -- clamps to a sane value rather than erroring.
  v_limit := LEAST(GREATEST(COALESCE(p_limit, 20), 1), 50);

  IF p_cursor IS NOT NULL THEN
    v_cursor_story_date := (p_cursor ->> 'story_date')::date;
    v_cursor_created_at := (p_cursor ->> 'created_at')::timestamptz;
    v_cursor_id         := (p_cursor ->> 'id')::uuid;
  END IF;

  -- p_story_types is used as-is in `= ANY(...)`. Garbage/invalid story
  -- types (values outside the CHECK constraint's set) are handled safely
  -- by construction — they simply never match any row, returning zero
  -- events rather than erroring. No allowlist validation needed.
  WITH page AS (
    SELECT
      sse.id, sse.story_type, sse.story_date, sse.title, sse.summary,
      sse.primary_value, sse.secondary_value, sse.unit,
      sse.spot_id, sp.name AS spot_name,
      sse.metadata, sse.verification_status, sse.created_at,
      row_number() OVER (
        ORDER BY sse.story_date DESC, sse.created_at DESC, sse.id DESC
      ) AS rn
    FROM swimmer_story_events sse
    LEFT JOIN spots sp ON sp.id = sse.spot_id
    WHERE sse.user_id = auth.uid()
      AND (p_story_types IS NULL OR sse.story_type = ANY(p_story_types))
      AND (
        p_cursor IS NULL
        OR (sse.story_date, sse.created_at, sse.id)
           < (v_cursor_story_date, v_cursor_created_at, v_cursor_id)
      )
    ORDER BY sse.story_date DESC, sse.created_at DESC, sse.id DESC
    LIMIT v_limit + 1
  )
  SELECT
    COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'id', id, 'story_type', story_type, 'story_date', story_date,
          'title', title, 'summary', summary,
          'primary_value', primary_value, 'secondary_value', secondary_value,
          'unit', unit, 'spot_id', spot_id, 'spot_name', spot_name,
          'metadata', metadata, 'verification_status', verification_status,
          'created_at', created_at
        ) ORDER BY rn
      ) FILTER (WHERE rn <= v_limit),
      '[]'::jsonb
    ),
    COALESCE(bool_or(rn = v_limit + 1), false),
    (SELECT jsonb_build_object('story_date', story_date, 'created_at', created_at, 'id', id)
       FROM page WHERE rn = v_limit)
  INTO v_events, v_has_more, v_next_cursor
  FROM page;

  IF NOT v_has_more THEN
    v_next_cursor := NULL;
  END IF;

  RETURN jsonb_build_object('events', v_events, 'next_cursor', v_next_cursor, 'has_more', v_has_more);
END;
$$;

COMMENT ON FUNCTION public.get_my_story_timeline_v1(integer, jsonb, text[]) IS
  'Phase 2.2 — read-only, own-rows-only, cursor-paginated fetch of the '
  'authenticated caller''s swimmer_story_events. Never accepts a target '
  'user_id; never returns dedupe_key, temp_log_id, or user_id. Does not '
  'generate or alter story events — see evaluate_swim_story_events_v1 for '
  'that (Phase 2.1, untouched by this migration).';

REVOKE ALL ON FUNCTION public.get_my_story_timeline_v1(integer, jsonb, text[]) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.get_my_story_timeline_v1(integer, jsonb, text[]) TO authenticated;

COMMIT;

-- ----------------------------------------------------------------
-- ROLLBACK — exact SQL to undo, or state:
-- "irreversible — restore from _bak_YYYYMMDD_tablename"
-- ----------------------------------------------------------------
-- BEGIN;
-- DROP FUNCTION IF EXISTS public.get_my_story_timeline_v1(integer, jsonb, text[]);
-- DROP FUNCTION IF EXISTS public.story_timeline_flag_enabled(uuid);
-- DELETE FROM feature_flags WHERE key = 'story_timeline_v1';
--   -- Safe only if no other Phase-2.2+ code has started reading this flag
--   -- key by the time of rollback. Does NOT touch story_engine_v1,
--   -- identity_layer_v1, or any other flag row.
-- COMMIT;
--
-- This rollback does NOT alter: swimmer_story_events schema or rows,
-- evaluate_swim_story_events_v1 / evaluate_swim_story_events_internal_v1 /
-- trigger_evaluate_swim_story_events_v1, temp_logs, user_stats, identity
-- tables, badges, challenges, Strava tables, or public_profiles.

-- ----------------------------------------------------------------
-- VERIFY — run on the READ-ONLY connection AFTER applying.
-- State the expected result next to each query.
-- ----------------------------------------------------------------
-- SELECT key, enabled_global, allowed_user_ids FROM feature_flags WHERE key='story_timeline_v1';
--   -- expect: 1 row, story_timeline_v1, false, {df137255-3add-4153-b368-32e06e2be188}
-- SELECT key, enabled_global FROM feature_flags WHERE key='story_engine_v1';
--   -- expect: UNCHANGED — still false, still Dave-only
-- SELECT proname FROM pg_proc WHERE proname IN
--   ('get_my_story_timeline_v1','story_timeline_flag_enabled');
--   -- expect: 2 rows
-- SELECT count(*) FROM swimmer_story_events;
--   -- expect: UNCHANGED from before this migration (this migration writes no rows)
