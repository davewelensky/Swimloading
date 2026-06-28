-- June Challenge v2 — Functions and views
-- Steps 4-7: award_challenge_points, calculate_challenge_streak,
--            get_challenge_leaders, challenge_unusual_activity
-- Run AFTER june_challenge_v2_tables.sql

-- ── Step 4: Core points-awarding function ───────────────────────────────────

CREATE OR REPLACE FUNCTION award_challenge_points(
  p_user_id          uuid,
  p_action_type      text,
  p_source_table     text    DEFAULT NULL,
  p_source_record_id text    DEFAULT NULL,
  p_metadata         jsonb   DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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

  -- temp_log: one per SPOT per calendar day — logging multiple spots on the same day all score
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

  -- 7. Insert awarded audit record ─────────────────────────────────────────────
  INSERT INTO challenge_points_audit
    (challenge_id, user_id, action_type, source_table, source_record_id,
     points_awarded, points_status, metadata)
  VALUES
    (1, p_user_id, p_action_type, p_source_table, p_source_record_id,
     v_points, 'awarded', p_metadata);

  -- 8. Insert into june_challenge_events for live feed ─────────────────────────
  INSERT INTO june_challenge_events
    (user_id, display_name, action_type, points, spot_id, spot_name, ref_id, metadata)
  VALUES
    (p_user_id, v_display_name, p_action_type, v_points,
     v_spot_id, v_spot_name, p_source_record_id, p_metadata);

  -- 9. For join_swim: award creator_bonus to the swim creator (inline, non-recursive) ─
  IF p_action_type = 'join_swim' AND v_creator_id IS NOT NULL AND v_creator_id != p_user_id THEN
    -- Skip if creator is disqualified
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

  -- 10. Trigger streak calculation after temp_log or join_swim awards ──────────
  IF p_action_type IN ('temp_log', 'join_swim') THEN
    PERFORM calculate_challenge_streak(p_user_id);
  END IF;

  -- 11. Return total points and draw entries ──────────────────────────────────
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
$$;

-- ── Step 5: Streak calculation function ─────────────────────────────────────

CREATE OR REPLACE FUNCTION calculate_challenge_streak(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
    PERFORM award_challenge_points(p_user_id, 'streak_7day', NULL, NULL, '{}'::jsonb);
    v_streak_7_awarded := true;
  END IF;

  -- Award streak_3day if earned and not yet awarded
  IF v_max_streak >= 3 AND NOT v_streak_3_awarded THEN
    PERFORM award_challenge_points(p_user_id, 'streak_3day', NULL, NULL, '{}'::jsonb);
    v_streak_3_awarded := true;
  END IF;

  RETURN jsonb_build_object(
    'current_streak',      v_current_streak,
    'max_streak',          v_max_streak,
    'streak_3day_awarded', v_streak_3_awarded,
    'streak_7day_awarded', v_streak_7_awarded
  );
END;
$$;

-- ── Step 6: Replace get_challenge_leaders ───────────────────────────────────
-- Drops the old function and creates a new one reading from challenge_points_audit.
-- Keeps compatible signature (p_month_start, p_month_end) but ignores them —
-- the challenge window comes from june_challenge_config.

DROP FUNCTION IF EXISTS get_challenge_leaders(timestamptz, timestamptz);

CREATE OR REPLACE FUNCTION get_challenge_leaders(
  p_month_start timestamptz DEFAULT NULL,
  p_month_end   timestamptz DEFAULT NULL
)
RETURNS TABLE (
  user_id                uuid,
  display_name           text,
  avatar_url             text,
  total_points           integer,
  draw_entries           integer,
  active_days            integer,
  temp_logs_rewarded     integer,
  swims_joined_rewarded  integer,
  swims_created_rewarded integer,
  shares_rewarded        integer,
  streak_bonuses         integer,
  suspicious_flags       integer,
  qualified_for_draw     boolean,
  disqualified           boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_config june_challenge_config%ROWTYPE;
BEGIN
  SELECT * INTO v_config FROM june_challenge_config WHERE id = 1;

  RETURN QUERY
  WITH awarded AS (
    SELECT
      a.user_id,
      SUM(a.points_awarded)::integer                                                    AS total_points,
      COUNT(DISTINCT (a.awarded_at AT TIME ZONE 'UTC')::date)::integer                  AS active_days,
      COUNT(*) FILTER (WHERE a.action_type = 'temp_log')::integer                       AS temp_logs_rewarded,
      COUNT(*) FILTER (WHERE a.action_type = 'join_swim')::integer                      AS swims_joined_rewarded,
      COUNT(*) FILTER (WHERE a.action_type = 'create_swim')::integer                    AS swims_created_rewarded,
      COUNT(*) FILTER (WHERE a.action_type = 'whatsapp_share')::integer                 AS shares_rewarded,
      COUNT(*) FILTER (WHERE a.action_type IN ('streak_3day', 'streak_7day'))::integer  AS streak_bonuses
    FROM challenge_points_audit a
    WHERE a.challenge_id = 1
      AND a.points_status = 'awarded'
    GROUP BY a.user_id
  ),
  open_flags AS (
    SELECT
      f.user_id,
      COUNT(*) FILTER (WHERE f.status = 'open')::integer AS open_flag_count,
      BOOL_OR(f.disqualified)                             AS is_disqualified
    FROM challenge_admin_flags f
    WHERE f.challenge_id = 1
    GROUP BY f.user_id
  )
  SELECT
    p.id                                              AS user_id,
    p.display_name,
    p.avatar_url,
    COALESCE(aw.total_points,            0)           AS total_points,
    LEAST(COALESCE(aw.total_points, 0), v_config.draw_entry_cap)
                                                      AS draw_entries,
    COALESCE(aw.active_days,             0)           AS active_days,
    COALESCE(aw.temp_logs_rewarded,      0)           AS temp_logs_rewarded,
    COALESCE(aw.swims_joined_rewarded,   0)           AS swims_joined_rewarded,
    COALESCE(aw.swims_created_rewarded,  0)           AS swims_created_rewarded,
    COALESCE(aw.shares_rewarded,         0)           AS shares_rewarded,
    COALESCE(aw.streak_bonuses,          0)           AS streak_bonuses,
    COALESCE(fl.open_flag_count,         0)           AS suspicious_flags,
    (
      COALESCE(aw.active_days,           0) >= v_config.qualify_min_active_days
      AND COALESCE(aw.temp_logs_rewarded,0) >= v_config.qualify_min_temp_logs
      AND COALESCE(aw.swims_joined_rewarded, 0) >= v_config.qualify_min_joined_swims
      AND COALESCE(fl.open_flag_count,   0) = 0
      AND NOT COALESCE(fl.is_disqualified, false)
    )                                                 AS qualified_for_draw,
    COALESCE(fl.is_disqualified, false)               AS disqualified
  FROM profiles p
  JOIN awarded aw ON aw.user_id = p.id
  LEFT JOIN open_flags fl ON fl.user_id = p.id
  ORDER BY aw.total_points DESC;
END;
$$;

-- ── Step 7: Unusual activity detection ──────────────────────────────────────

-- View surfaces suspicious patterns for admin review
CREATE OR REPLACE VIEW challenge_unusual_activity AS

-- A: High burst — >5 awarded actions in any 10-minute window (severity: medium)
SELECT
  user_id,
  'high_burst'::text                          AS flag_type,
  'medium'::text                              AS severity,
  MAX(window_count)                           AS related_action_count,
  MIN(awarded_at)                             AS first_seen_at,
  MAX(awarded_at)                             AS last_seen_at,
  'User awarded >5 points in a 10-min window' AS description
FROM (
  SELECT
    user_id,
    awarded_at,
    COUNT(*) OVER (
      PARTITION BY user_id
      ORDER BY awarded_at
      RANGE BETWEEN INTERVAL '10 minutes' PRECEDING AND CURRENT ROW
    ) AS window_count
  FROM challenge_points_audit
  WHERE challenge_id = 1 AND points_status = 'awarded'
) sub
WHERE window_count > 5
GROUP BY user_id

UNION ALL

-- B: Repeated pair — same joiner/creator pair > 3 times (severity: medium)
SELECT
  joiner.user_id,
  'repeated_pair'::text                               AS flag_type,
  'medium'::text                                      AS severity,
  COUNT(*)::integer                                   AS related_action_count,
  MIN(joiner.awarded_at)                              AS first_seen_at,
  MAX(joiner.awarded_at)                              AS last_seen_at,
  'Same creator/joiner pair interacted >3 times in 7 days' AS description
FROM challenge_points_audit joiner
JOIN challenge_points_audit bonus
  ON  bonus.challenge_id     = joiner.challenge_id
  AND bonus.action_type      = 'creator_bonus'
  AND bonus.source_record_id = joiner.source_record_id
  AND bonus.points_status    = 'awarded'
WHERE joiner.challenge_id  = 1
  AND joiner.action_type   = 'join_swim'
  AND joiner.points_status = 'awarded'
  AND joiner.awarded_at    >= now() - INTERVAL '7 days'
GROUP BY joiner.user_id, bonus.user_id
HAVING COUNT(*) > 3

UNION ALL

-- C: Excessive rejections — >5 rejected in one calendar day (severity: low)
SELECT
  user_id,
  'excessive_rejections'::text                       AS flag_type,
  'low'::text                                        AS severity,
  COUNT(*)::integer                                  AS related_action_count,
  MIN(awarded_at)                                    AS first_seen_at,
  MAX(awarded_at)                                    AS last_seen_at,
  'User had >5 rejected attempts in a single day'    AS description
FROM challenge_points_audit
WHERE challenge_id = 1 AND points_status = 'rejected'
GROUP BY user_id, (awarded_at AT TIME ZONE 'UTC')::date
HAVING COUNT(*) > 5

UNION ALL

-- D: Too many share attempts — >3 whatsapp_share attempts in one day (severity: low)
SELECT
  user_id,
  'too_many_shares'::text                            AS flag_type,
  'low'::text                                        AS severity,
  COUNT(*)::integer                                  AS related_action_count,
  MIN(awarded_at)                                    AS first_seen_at,
  MAX(awarded_at)                                    AS last_seen_at,
  'User attempted >3 WhatsApp shares in one day'     AS description
FROM challenge_points_audit
WHERE challenge_id = 1 AND action_type = 'whatsapp_share'
GROUP BY user_id, (awarded_at AT TIME ZONE 'UTC')::date
HAVING COUNT(*) > 3

UNION ALL

-- E: Last-minute surge — >30% of total monthly points in final 48h (severity: high)
SELECT
  all_pts.user_id,
  'last_minute_surge'::text                              AS flag_type,
  'high'::text                                           AS severity,
  recent.recent_count                                    AS related_action_count,
  recent.first_seen_at,
  recent.last_seen_at,
  'User earned >30% of total challenge points in final 48h' AS description
FROM (
  SELECT user_id, SUM(points_awarded) AS total_pts
  FROM challenge_points_audit
  WHERE challenge_id = 1 AND points_status = 'awarded'
  GROUP BY user_id
) all_pts
JOIN (
  SELECT
    a.user_id,
    SUM(a.points_awarded) AS recent_pts,
    COUNT(*)::integer     AS recent_count,
    MIN(a.awarded_at)     AS first_seen_at,
    MAX(a.awarded_at)     AS last_seen_at
  FROM challenge_points_audit a
  CROSS JOIN june_challenge_config cfg
  WHERE a.challenge_id    = 1
    AND a.points_status   = 'awarded'
    AND cfg.id            = 1
    AND a.awarded_at >= (cfg.end_date::timestamptz + INTERVAL '1 day' - INTERVAL '48 hours')
  GROUP BY a.user_id
) recent ON recent.user_id = all_pts.user_id
WHERE all_pts.total_pts > 0
  AND (recent.recent_pts::numeric / all_pts.total_pts::numeric) > 0.30;

-- Function to upsert suspicious patterns into challenge_admin_flags
-- Call this from the admin panel to refresh flags
CREATE OR REPLACE FUNCTION detect_challenge_flags()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row   record;
  v_count integer := 0;
BEGIN
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
$$;

-- Admin action functions ──────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION admin_dismiss_flag(p_flag_id uuid, p_notes text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE challenge_admin_flags
  SET status = 'dismissed', admin_notes = COALESCE(p_notes, admin_notes), updated_at = now()
  WHERE id = p_flag_id;
  INSERT INTO challenge_points_audit (challenge_id, user_id, action_type, points_awarded, points_status, metadata)
  SELECT challenge_id, user_id, 'admin_action', 0, 'awarded',
    jsonb_build_object('action', 'dismiss_flag', 'flag_id', p_flag_id, 'notes', p_notes)
  FROM challenge_admin_flags WHERE id = p_flag_id;
END;
$$;

CREATE OR REPLACE FUNCTION admin_confirm_flag(p_flag_id uuid, p_notes text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE challenge_admin_flags
  SET status = 'confirmed', admin_notes = COALESCE(p_notes, admin_notes), updated_at = now()
  WHERE id = p_flag_id;
  INSERT INTO challenge_points_audit (challenge_id, user_id, action_type, points_awarded, points_status, metadata)
  SELECT challenge_id, user_id, 'admin_action', 0, 'awarded',
    jsonb_build_object('action', 'confirm_flag', 'flag_id', p_flag_id)
  FROM challenge_admin_flags WHERE id = p_flag_id;
END;
$$;

CREATE OR REPLACE FUNCTION admin_disqualify_user(p_user_id uuid, p_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO challenge_admin_flags
    (challenge_id, user_id, flag_type, severity, description, disqualified, status)
  VALUES
    (1, p_user_id, 'manual_disqualification', 'high', p_reason, true, 'confirmed')
  ON CONFLICT (challenge_id, user_id, flag_type) DO UPDATE
  SET disqualified = true, description = EXCLUDED.description, status = 'confirmed', updated_at = now();
  INSERT INTO challenge_points_audit (challenge_id, user_id, action_type, points_awarded, points_status, metadata)
  VALUES (1, p_user_id, 'admin_action', 0, 'awarded', jsonb_build_object('action', 'disqualify', 'reason', p_reason));
END;
$$;

CREATE OR REPLACE FUNCTION admin_reinstate_user(p_user_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE challenge_admin_flags
  SET disqualified = false, status = 'dismissed', updated_at = now()
  WHERE challenge_id = 1 AND user_id = p_user_id;
  INSERT INTO challenge_points_audit (challenge_id, user_id, action_type, points_awarded, points_status, metadata)
  VALUES (1, p_user_id, 'admin_action', 0, 'awarded', jsonb_build_object('action', 'reinstate'));
END;
$$;

CREATE OR REPLACE FUNCTION admin_reverse_points(p_audit_id uuid, p_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_row challenge_points_audit%ROWTYPE;
BEGIN
  SELECT * INTO v_row FROM challenge_points_audit WHERE id = p_audit_id;
  IF NOT FOUND THEN RETURN; END IF;
  UPDATE challenge_points_audit SET points_status = 'reversed', updated_at = now() WHERE id = p_audit_id;
  INSERT INTO challenge_points_audit (challenge_id, user_id, action_type, points_awarded, points_status, metadata)
  VALUES (1, v_row.user_id, 'admin_reversal', 0, 'awarded',
    jsonb_build_object('reversed_audit_id', p_audit_id, 'original_action', v_row.action_type,
                       'original_points', v_row.points_awarded, 'reason', p_reason));
END;
$$;
