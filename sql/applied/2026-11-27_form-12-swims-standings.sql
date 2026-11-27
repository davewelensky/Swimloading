-- ================================================================
-- SwimLoading — Migration
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
-- Migration: 2026-11-27_form-12-swims-standings.sql
-- Process:   see MIGRATIONS.md
-- ================================================================

-- Purpose:
--   Standings for "The 12 Swims of Christmas" (FORM Smart Swim 2, 1 Dec 2026 to
--   6 Jan 2027), counted straight from temp_logs so no swim can be missed by a
--   client call, and the FORM homepage card moved from "Coming Soon" to live.

-- Requested by:
--   Dave — 27 Nov 2026.

-- Rules encoded (must match partners/form.html and app-june.js):
--   * One swim day per calendar date. Manual log: counts on the day it is logged
--     (SAST), backdated entries do not count. Strava import: counts on the local
--     date of the activity.
--   * Logged by midnight SAST at the end of 6 January.
--   * Sensor readings and the Big Bay SwimOps watch feed never count.
--   * 12 days = 1 entry; +1 for a 25 December swim; +1 for a 1 January swim.
--   * Disqualified accounts get no entry. Organiser exclusions are applied by
--     scripts/draw-monthly-winner.mjs, not here (the public pool shows everyone).
--   * SA delivery is checked when the winner is contacted, not here.

-- ----------------------------------------------------------------
-- PRE-CHECKS — read-only, before applying.
-- ----------------------------------------------------------------
-- SELECT count(*) FROM pg_proc WHERE proname = 'get_form_challenge_standings';  -- expect: 0
-- SELECT count(*) FROM partner_pages WHERE id = 'b4e89ab1-d468-423f-b369-37158a6df883' AND name = 'FORM';  -- expect: 1

-- ----------------------------------------------------------------
-- BACKUP — the one UPDATE below.
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS _bak_20261127_partner_pages_form AS
  SELECT * FROM partner_pages WHERE id = 'b4e89ab1-d468-423f-b369-37158a6df883';
ALTER TABLE _bak_20261127_partner_pages_form ENABLE ROW LEVEL SECURITY;

-- ----------------------------------------------------------------
-- MIGRATION — applied only after Dave types "apply".
-- ----------------------------------------------------------------
BEGIN;

CREATE OR REPLACE FUNCTION public.get_form_challenge_standings()
RETURNS TABLE(
  user_id uuid, display_name text, avatar_url text, total_points integer, draw_entries integer,
  active_days integer, temp_logs_rewarded integer, swims_joined_rewarded integer,
  swims_created_rewarded integer, shares_rewarded integer, streak_bonuses integer,
  suspicious_flags integer, qualified_for_draw boolean, disqualified boolean,
  christmas_swim boolean, new_year_swim boolean)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH rules AS (
    SELECT date '2026-12-01' AS first_day, date '2027-01-06' AS last_day,
           date '2026-12-25' AS christmas, date '2027-01-01' AS new_year, 12 AS target
  ),
  dated AS (
    SELECT t.user_id,
      CASE
        WHEN EXISTS (SELECT 1 FROM strava_imports si WHERE si.imported_to_log_id = t.id)
          THEN (COALESCE(t.logged_at, t.created_at) AT TIME ZONE 'UTC')::date
        WHEN (COALESCE(t.logged_at, t.created_at) AT TIME ZONE 'Africa/Johannesburg')::date
             = (t.created_at AT TIME ZONE 'Africa/Johannesburg')::date
          THEN (t.created_at AT TIME ZONE 'Africa/Johannesburg')::date
      END AS swim_date
    FROM temp_logs t
    WHERE t.user_id IS NOT NULL
      AND t.location_source IS DISTINCT FROM 'sensor'
      AND COALESCE(t.notes, '') NOT ILIKE '%via Big Bay SwimOps%'
      AND t.created_at >= timestamptz '2026-11-29 00:00+02'
      AND t.created_at <  timestamptz '2027-01-07 00:00+02'
  ),
  per_user AS (
    SELECT d.user_id,
           count(DISTINCT d.swim_date)::integer   AS days,
           bool_or(d.swim_date = r.christmas)     AS christmas,
           bool_or(d.swim_date = r.new_year)      AS new_year
    FROM dated d CROSS JOIN rules r
    WHERE d.swim_date BETWEEN r.first_day AND r.last_day
    GROUP BY d.user_id
  ),
  flags AS (
    SELECT f.user_id,
           count(*) FILTER (WHERE f.status = 'open')::integer AS open_flags,
           bool_or(f.disqualified)                            AS is_disqualified
    FROM challenge_admin_flags f
    WHERE f.challenge_id = 1
    GROUP BY f.user_id
  ),
  scored AS (
    SELECT u.*, COALESCE(f.open_flags, 0) AS open_flags,
           COALESCE(f.is_disqualified, false) AS is_disqualified,
           (u.days >= r.target AND NOT COALESCE(f.is_disqualified, false)) AS qualified
    FROM per_user u
    CROSS JOIN rules r
    LEFT JOIN flags f ON f.user_id = u.user_id
  )
  SELECT s.user_id, p.display_name, p.avatar_url,
         s.days,
         CASE WHEN s.qualified THEN 1 + s.christmas::integer + s.new_year::integer ELSE 0 END,
         s.days, s.days, 0, 0, 0, 0,
         s.open_flags, s.qualified, s.is_disqualified,
         s.christmas, s.new_year
  FROM scored s
  LEFT JOIN profiles p ON p.id = s.user_id
  ORDER BY s.qualified DESC, s.days DESC, p.display_name;
$function$;

REVOKE ALL ON FUNCTION public.get_form_challenge_standings() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_form_challenge_standings() TO authenticated, service_role;

UPDATE partner_pages
   SET section    = 'active',
       chip_state = 'live',
       chip_label = '12 Swims of Christmas',
       cta_label  = 'See the challenge',
       blurb      = 'Smart swim goggles with a heads-up display: your pace, distance and stroke metrics in your line of sight. Win a Smart Swim 2 in our 12 Swims of Christmas challenge.',
       status_note = 'Smart Swim 2 prize received Nov 2026. 12 Swims of Christmas 1 Dec 2026 to 6 Jan 2027, draw 7 Jan. Member discount still to confirm with Timmy',
       updated_at = now()
 WHERE id = 'b4e89ab1-d468-423f-b369-37158a6df883';

COMMIT;

-- ----------------------------------------------------------------
-- ROLLBACK
-- ----------------------------------------------------------------
-- DROP FUNCTION IF EXISTS public.get_form_challenge_standings();
-- UPDATE partner_pages p SET section=b.section, chip_state=b.chip_state, chip_label=b.chip_label,
--        cta_label=b.cta_label, blurb=b.blurb, status_note=b.status_note, updated_at=b.updated_at
--   FROM _bak_20261127_partner_pages_form b WHERE p.id = b.id;

-- ----------------------------------------------------------------
-- VERIFY — read-only, after applying.
-- ----------------------------------------------------------------
-- SELECT count(*) FROM get_form_challenge_standings();                    -- expect: 0 before 1 Dec
-- SELECT has_function_privilege('anon', 'public.get_form_challenge_standings()', 'execute');          -- expect: false
-- SELECT has_function_privilege('authenticated', 'public.get_form_challenge_standings()', 'execute'); -- expect: true
-- SELECT section, chip_state, chip_label FROM partner_pages WHERE name = 'FORM';  -- expect: active, live, 12 Swims of Christmas
