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
-- Migration: 2026-07-10_uk-challenge-functions.sql
-- Process:   see MIGRATIONS.md — no section below may be left empty
-- Run AFTER 2026-07-10_uk-challenge-tables.sql
-- ================================================================

-- Purpose:
--   RPCs for the UK Swim Spot Challenge: nearest-spot lookup for dedup,
--   join, unique-location scoring, leaderboard, and admin moderation
--   (void log / recalc / disqualify / reinstate / resolve proposal).
--   All scoring writes are SECURITY DEFINER — no client INSERT/UPDATE
--   policy exists on the scoring tables (see the RLS migration).
--   Admin-only functions check profiles.is_admin internally (not just
--   relying on admin.html's client-side gate) — a deliberate hardening
--   vs. the existing june_challenge_* admin functions, which do not.

-- Requested by:
--   Dave

-- ----------------------------------------------------------------
-- PRE-CHECKS — run on the READ-ONLY connection BEFORE applying.
-- ----------------------------------------------------------------
-- SELECT count(*) FROM campaigns WHERE slug = 'uk_swim_spot_challenge'; -- expect: 1
-- SELECT extname FROM pg_extension WHERE extname IN ('cube','earthdistance'); -- expect: 0 rows (confirmed absent)

-- ----------------------------------------------------------------
-- BACKUP — required before any DELETE / UPDATE / DROP / TRUNCATE.
-- ----------------------------------------------------------------
-- Not applicable — CREATE FUNCTION only, no existing data touched.

-- ----------------------------------------------------------------
-- MIGRATION — applied only after Dave types "apply".
-- ----------------------------------------------------------------
BEGIN;

-- ── find_nearest_spot: haversine proximity lookup, public read-only ─────
-- Used by the "propose a new UK location" flow to dedupe against `spots`
-- before creating a spot_suggestions row. No extension dependency.
CREATE OR REPLACE FUNCTION find_nearest_spot(
  p_lat          double precision,
  p_lng          double precision,
  p_country_code text    DEFAULT 'GB',
  p_radius_km    numeric DEFAULT 1.0
)
RETURNS TABLE (spot_id uuid, name text, distance_km numeric)
LANGUAGE sql
STABLE
AS $$
  SELECT
    s.id,
    s.name,
    ROUND(
      (6371 * acos(
        LEAST(1.0, GREATEST(-1.0,
          cos(radians(p_lat)) * cos(radians(s.latitude)) *
          cos(radians(s.longitude) - radians(p_lng)) +
          sin(radians(p_lat)) * sin(radians(s.latitude))
        ))
      ))::numeric, 3
    ) AS distance_km
  FROM spots s
  WHERE s.active = true
    AND s.country_code = p_country_code
    AND s.latitude IS NOT NULL
    AND s.longitude IS NOT NULL
  ORDER BY distance_km ASC
  LIMIT 5;
$$;

-- Filter to radius in a second step (keeps the LIMIT 5 candidate list even
-- when nothing is within radius, useful for admin's "did you mean" UI).
COMMENT ON FUNCTION find_nearest_spot IS
  'Returns up to 5 nearest spots to a coordinate, closest first. Caller filters by distance_km <= desired radius.';

-- ── join_campaign: explicit consent join (no silent auto-join) ──────────
CREATE OR REPLACE FUNCTION join_campaign(p_campaign_id uuid, p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_display_name text;
BEGIN
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
$$;

-- ── award_campaign_location: the core unique-location scoring RPC ───────
-- Called once per temp_logs insert, alongside (not instead of) the
-- existing jcAwardPoints('temp_log', ...) call for the unrelated monthly
-- challenge. Never client-computed — the UNIQUE constraint on
-- campaign_location_credits is what actually enforces "unique location".
CREATE OR REPLACE FUNCTION award_campaign_location(
  p_campaign_id uuid,
  p_user_id     uuid,
  p_log_id      uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_campaign  campaigns%ROWTYPE;
  v_log       temp_logs%ROWTYPE;
  v_spot      spots%ROWTYPE;
  v_spot_id   uuid;
  v_credit_id uuid;
  v_display_name text;
  v_log_date  date;
BEGIN
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
$$;

-- ── get_campaign_leaders: read-only leaderboard/stats, never client-computed ─
CREATE OR REPLACE FUNCTION get_campaign_leaders(p_campaign_id uuid)
RETURNS TABLE (
  user_id             uuid,
  display_name        text,
  avatar_url          text,
  unique_locations    integer,
  total_points        integer,
  total_swims_logged  integer,
  disqualified        boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH credits AS (
    SELECT c.user_id,
           COUNT(*)::integer                  AS unique_locations,
           SUM(c.points_awarded)::integer     AS total_points
    FROM campaign_location_credits c
    WHERE c.campaign_id = p_campaign_id
    GROUP BY c.user_id
  ),
  swims AS (
    SELECT e.user_id, COUNT(*)::integer AS total_swims_logged
    FROM campaign_events e
    WHERE e.campaign_id = p_campaign_id
      AND e.action_type IN ('location_earned', 'swim_logged_repeat')
    GROUP BY e.user_id
  ),
  flags AS (
    SELECT f.user_id, BOOL_OR(f.disqualified) AS is_disqualified
    FROM campaign_admin_flags f
    WHERE f.campaign_id = p_campaign_id
    GROUP BY f.user_id
  )
  SELECT
    p.id                                     AS user_id,
    p.display_name,
    p.avatar_url,
    COALESCE(cr.unique_locations, 0)         AS unique_locations,
    COALESCE(cr.total_points, 0)             AS total_points,
    COALESCE(sw.total_swims_logged, 0)       AS total_swims_logged,
    COALESCE(fl.is_disqualified, false)      AS disqualified
  FROM profiles p
  JOIN credits cr ON cr.user_id = p.id
  LEFT JOIN swims sw ON sw.user_id = p.id
  LEFT JOIN flags fl ON fl.user_id = p.id
  ORDER BY cr.unique_locations DESC, cr.total_points DESC;
END;
$$;

-- ── Admin-only functions: all check profiles.is_admin internally ────────

CREATE OR REPLACE FUNCTION void_campaign_log(p_campaign_id uuid, p_log_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_deleted_count integer;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_authorized');
  END IF;

  DELETE FROM campaign_location_credits
  WHERE campaign_id = p_campaign_id AND first_qualifying_log_id = p_log_id;
  GET DIAGNOSTICS v_deleted_count = ROW_COUNT;

  RETURN jsonb_build_object('ok', true, 'credits_removed', v_deleted_count);
END;
$$;

CREATE OR REPLACE FUNCTION recalc_campaign_scores(p_campaign_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_campaign campaigns%ROWTYPE;
  v_inserted integer;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_authorized');
  END IF;

  SELECT * INTO v_campaign FROM campaigns WHERE id = p_campaign_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'campaign_not_found');
  END IF;

  -- Defensive bulk backfill: earliest qualifying log per user+spot becomes
  -- the credit (DISTINCT ON ordered by logged_at). Does not backfill
  -- campaign_events history — this repairs the scoring ledger, not the
  -- historical live feed.
  WITH qualifying AS (
    SELECT DISTINCT ON (t.user_id, COALESCE(t.spot_id, t.gps_spot_id))
      t.user_id,
      COALESCE(t.spot_id, t.gps_spot_id) AS spot_id,
      t.id AS log_id
    FROM temp_logs t
    JOIN spots s ON s.id = COALESCE(t.spot_id, t.gps_spot_id) AND s.active = true
    JOIN campaign_participants cp
      ON cp.campaign_id = p_campaign_id AND cp.user_id = t.user_id
    WHERE s.country_code = v_campaign.eligible_country_code
      AND s.water_type = ANY(v_campaign.eligible_water_types)
      AND (
        v_campaign.test_mode
        OR (COALESCE(t.logged_at, t.created_at) AT TIME ZONE 'UTC')::date
           BETWEEN v_campaign.launch_date AND v_campaign.end_date
      )
      AND NOT EXISTS (
        SELECT 1 FROM campaign_admin_flags f
        WHERE f.campaign_id = p_campaign_id AND f.user_id = t.user_id AND f.disqualified = true
      )
    ORDER BY t.user_id, COALESCE(t.spot_id, t.gps_spot_id), COALESCE(t.logged_at, t.created_at) ASC
  )
  INSERT INTO campaign_location_credits (campaign_id, user_id, spot_id, first_qualifying_log_id, points_awarded)
  SELECT p_campaign_id, q.user_id, q.spot_id, q.log_id, v_campaign.points_per_unique_location
  FROM qualifying q
  ON CONFLICT (campaign_id, user_id, spot_id) DO NOTHING;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  RETURN jsonb_build_object('ok', true, 'credits_added', v_inserted);
END;
$$;

CREATE OR REPLACE FUNCTION admin_disqualify_campaign_user(p_campaign_id uuid, p_user_id uuid, p_reason text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_authorized');
  END IF;

  INSERT INTO campaign_admin_flags
    (campaign_id, user_id, flag_type, severity, description, disqualified, status)
  VALUES
    (p_campaign_id, p_user_id, 'manual_disqualification', 'high', p_reason, true, 'confirmed')
  ON CONFLICT (campaign_id, user_id, flag_type) DO UPDATE
  SET disqualified = true, description = EXCLUDED.description, status = 'confirmed', updated_at = now();

  RETURN jsonb_build_object('ok', true);
END;
$$;

CREATE OR REPLACE FUNCTION admin_reinstate_campaign_user(p_campaign_id uuid, p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_authorized');
  END IF;

  UPDATE campaign_admin_flags
  SET disqualified = false, status = 'dismissed', updated_at = now()
  WHERE campaign_id = p_campaign_id AND user_id = p_user_id;

  RETURN jsonb_build_object('ok', true);
END;
$$;

-- ── resolve_campaign_location_proposal: approve/reject/merge a pending
--    new-location proposal. Does NOT create the spots row itself — the
--    admin UI drives the existing resolveSpotSuggestion() flow first (or
--    picks an existing spot for "merge"), then calls this to close the
--    loop and retroactively award credit for any predating qualifying logs.
CREATE OR REPLACE FUNCTION resolve_campaign_location_proposal(
  p_proposal_id     uuid,
  p_status          text, -- 'approved' | 'rejected' | 'merged_to_existing'
  p_resolved_spot_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_campaign_id uuid;
  v_user_id     uuid;
  v_campaign    campaigns%ROWTYPE;
  v_log_id      uuid;
  v_spot        spots%ROWTYPE;
  v_credit_id   uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_authorized');
  END IF;

  UPDATE campaign_location_proposals
  SET status = p_status, resolved_spot_id = p_resolved_spot_id, resolved_at = now()
  WHERE id = p_proposal_id
  RETURNING campaign_id, user_id INTO v_campaign_id, v_user_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'proposal_not_found');
  END IF;

  IF p_status IN ('approved', 'merged_to_existing') AND p_resolved_spot_id IS NOT NULL THEN
    SELECT * INTO v_campaign FROM campaigns WHERE id = v_campaign_id;
    SELECT * INTO v_spot FROM spots WHERE id = p_resolved_spot_id;

    -- Retroactively credit the earliest qualifying log this user already
    -- has at the resolved spot, if any (they may have logged there before
    -- the spot/proposal was approved).
    SELECT t.id INTO v_log_id
    FROM temp_logs t
    WHERE t.user_id = v_user_id
      AND COALESCE(t.spot_id, t.gps_spot_id) = p_resolved_spot_id
      AND (
        v_campaign.test_mode
        OR (COALESCE(t.logged_at, t.created_at) AT TIME ZONE 'UTC')::date
           BETWEEN v_campaign.launch_date AND v_campaign.end_date
      )
    ORDER BY COALESCE(t.logged_at, t.created_at) ASC
    LIMIT 1;

    IF v_log_id IS NOT NULL THEN
      INSERT INTO campaign_location_credits
        (campaign_id, user_id, spot_id, first_qualifying_log_id, points_awarded)
      VALUES
        (v_campaign_id, v_user_id, p_resolved_spot_id, v_log_id, v_campaign.points_per_unique_location)
      ON CONFLICT (campaign_id, user_id, spot_id) DO NOTHING
      RETURNING id INTO v_credit_id;

      IF v_credit_id IS NOT NULL THEN
        INSERT INTO campaign_events
          (campaign_id, user_id, action_type, points, spot_id, spot_name)
        VALUES
          (v_campaign_id, v_user_id, 'location_earned', v_campaign.points_per_unique_location,
           p_resolved_spot_id, v_spot.name);
      END IF;
    END IF;
  END IF;

  RETURN jsonb_build_object('ok', true, 'retroactive_credit', v_credit_id IS NOT NULL);
END;
$$;

COMMIT;

-- ----------------------------------------------------------------
-- ROLLBACK — exact SQL to undo, or state:
-- "irreversible — restore from _bak_YYYYMMDD_tablename"
-- ----------------------------------------------------------------
-- DROP FUNCTION IF EXISTS resolve_campaign_location_proposal(uuid, text, uuid);
-- DROP FUNCTION IF EXISTS admin_reinstate_campaign_user(uuid, uuid);
-- DROP FUNCTION IF EXISTS admin_disqualify_campaign_user(uuid, uuid, text);
-- DROP FUNCTION IF EXISTS recalc_campaign_scores(uuid);
-- DROP FUNCTION IF EXISTS void_campaign_log(uuid, uuid);
-- DROP FUNCTION IF EXISTS get_campaign_leaders(uuid);
-- DROP FUNCTION IF EXISTS award_campaign_location(uuid, uuid, uuid);
-- DROP FUNCTION IF EXISTS join_campaign(uuid, uuid);
-- DROP FUNCTION IF EXISTS find_nearest_spot(double precision, double precision, text, numeric);
-- (Safe / fully reversible — no existing data touched.)

-- ----------------------------------------------------------------
-- VERIFY — run on the READ-ONLY connection AFTER applying.
-- ----------------------------------------------------------------
-- SELECT proname FROM pg_proc WHERE proname IN
--   ('find_nearest_spot','join_campaign','award_campaign_location',
--    'get_campaign_leaders','void_campaign_log','recalc_campaign_scores',
--    'admin_disqualify_campaign_user','admin_reinstate_campaign_user',
--    'resolve_campaign_location_proposal');
--   -- expect: 9 rows
-- SELECT * FROM find_nearest_spot(53.5, -3.0, 'GB', 5); -- expect: runs without error, returns 0-5 rows
