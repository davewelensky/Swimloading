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
-- Migration: 2026-08-13_recurring-swims.sql
-- Process:   see MIGRATIONS.md
-- ================================================================

-- Purpose:
--   A place for swims that have no date because they happen ALL the time.
--   PodSquad North Cottesloe swims at North Cott "every day of the year";
--   Cape Town's hot-chocolate swims are the same shape. The catalogue has
--   nowhere to put them, so today they simply do not exist to a swimmer
--   looking for somewhere to swim tomorrow morning.
--
--   WHY NOT swim_routes, which already holds dateless swims. Because that
--   table is a MARATHON CROSSING table wearing a general name. Its 14 rows
--   are Robben Island, the English Channel, False Bay, Cape Point. Its
--   CHECKs say so out loud:
--       route_type  IN (island, coastal, crossing, river, lake)
--       difficulty  IN (medium, high, extreme)
--       booking_url only allowed when operator_role = 'operates'
--   A free daily 2 km social swim is none of those types, is not 'medium'
--   difficulty, and has no operator. Forcing it in would file it beside
--   the Channel and quietly corrupt what swim_routes means. Two different
--   things that happen to share "no date" are still two different things.
--
--   WHAT THIS TABLE REFUSES TO INVENT:
--     * schedule_text is NOT NULL and holds the source's own words. The
--       structured days_of_week is a convenience for filtering, never the
--       record of truth. Where a page says "every day of the year", that is
--       what is stored.
--     * start_time is NULLABLE and is NULL for PodSquad, because their page
--       does not state one. A plausible 6:30am would be a fabrication a
--       swimmer could turn up for.
--     * latitude/longitude are NULL. The page names a meeting point in
--       words ("the wooden benches under the PodSquad sign") and gives no
--       coordinate. Same rule as everywhere else here: never invent one.
--     * is_public DEFAULT false. Nothing appears on /explore by being
--       inserted.
--
--   day_of_week is 0=Sun..6=Sat, matching JS getDay() and the existing
--   club_squad_sessions convention — deliberately the same so nobody has to
--   remember two.

-- Requested by:
--   Dave, 2026-08-13, after Yolanda Carstens asked what happens to
--   "regular swims that happen every day e.g. hot chocolate", citing
--   podsquadnorthcott.com.au as the Australian equivalent.

-- ----------------------------------------------------------------
-- PRE-CHECKS — run on the READ-ONLY connection BEFORE applying.
-- ----------------------------------------------------------------
-- SELECT to_regclass('public.recurring_swims');   -- expect: NULL (does not exist yet)
-- SELECT count(*) FROM public.swim_routes;        -- expect: 14, unchanged by this migration

-- ----------------------------------------------------------------
-- BACKUP — not required: creates a new table, touches no existing data.
-- ----------------------------------------------------------------

-- ----------------------------------------------------------------
-- MIGRATION — applied only after Dave types "apply".
-- ----------------------------------------------------------------
BEGIN;

CREATE TABLE public.recurring_swims (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug                    text NOT NULL UNIQUE,
  name                    text NOT NULL,

  -- who
  group_name              text,
  website_url             text,
  contact_url             text,

  -- where. Words first: a meeting point is how a swimmer actually finds
  -- the group, and it is usually not a coordinate.
  location_text           text NOT NULL,
  meeting_point           text,
  city                    text,
  region                  text,
  country_code            text,
  latitude                numeric,
  longitude               numeric,
  spot_id                 uuid REFERENCES public.spots(id) ON DELETE SET NULL,

  -- when — the whole reason this table exists
  schedule_text           text NOT NULL,
  days_of_week            smallint[],
  start_time              time,
  season_start_month      smallint,
  season_end_month        smallint,

  -- what
  typical_distance_metres integer,
  route_description       text,
  is_free                 boolean,
  requires_membership     boolean,
  summary                 text,
  -- Carried deliberately. An informal swim with no water safety is a fact
  -- a swimmer must be told BEFORE they walk down to the beach.
  safety_note             text,

  -- provenance
  source_url              text,
  last_verified_at        date,

  is_public               boolean NOT NULL DEFAULT false,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT recurring_swims_country_code_check
    CHECK (country_code IS NULL OR country_code ~ '^[A-Z]{2}$'),
  CONSTRAINT recurring_swims_coords_paired
    CHECK ((latitude IS NULL) = (longitude IS NULL)),
  CONSTRAINT recurring_swims_latitude_range
    CHECK (latitude IS NULL OR (latitude >= -90 AND latitude <= 90)),
  CONSTRAINT recurring_swims_longitude_range
    CHECK (longitude IS NULL OR (longitude >= -180 AND longitude <= 180)),
  CONSTRAINT recurring_swims_distance_check
    CHECK (typical_distance_metres IS NULL OR typical_distance_metres > 0),
  CONSTRAINT recurring_swims_season_start_check
    CHECK (season_start_month IS NULL OR (season_start_month BETWEEN 1 AND 12)),
  CONSTRAINT recurring_swims_season_end_check
    CHECK (season_end_month IS NULL OR (season_end_month BETWEEN 1 AND 12)),
  -- 0=Sun..6=Sat, same as JS getDay() and club_squad_sessions.
  CONSTRAINT recurring_swims_days_of_week_check
    CHECK (days_of_week IS NULL OR (
      array_length(days_of_week, 1) BETWEEN 1 AND 7
      AND days_of_week <@ ARRAY[0,1,2,3,4,5,6]::smallint[]))
);

CREATE INDEX recurring_swims_public_idx  ON public.recurring_swims (is_public) WHERE is_public;
CREATE INDEX recurring_swims_country_idx ON public.recurring_swims (country_code);

ALTER TABLE public.recurring_swims ENABLE ROW LEVEL SECURITY;

-- Mirrors swim_routes exactly: anon reads only what is published; admins
-- do everything; the worker uses the service key and bypasses RLS.
CREATE POLICY recurring_swims_public_read ON public.recurring_swims
  FOR SELECT USING (is_public);

CREATE POLICY recurring_swims_admin_all ON public.recurring_swims
  FOR ALL
  USING      (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.is_admin))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.is_admin));

GRANT SELECT ON public.recurring_swims TO anon, authenticated;

-- The first row. Every value below is stated on podsquadnorthcott.com.au;
-- nothing is inferred. Quoted phrases are theirs.
INSERT INTO public.recurring_swims (
  slug, name, group_name, website_url,
  location_text, meeting_point, city, region, country_code,
  schedule_text, days_of_week, start_time,
  typical_distance_metres, route_description, is_free, requires_membership,
  summary, safety_note, source_url, last_verified_at, is_public
) VALUES (
  'podsquad-north-cottesloe',
  'PodSquad North Cottesloe',
  'PodSquad',
  'https://podsquadnorthcott.com.au/',
  'North Cottesloe Beach, Perth, Western Australia',
  'The wooden benches under the PodSquad sign on the ocean side of the North Cottesloe Surf Club',
  'Perth', 'WA', 'AU',
  'Every day of the year',
  ARRAY[0,1,2,3,4,5,6]::smallint[],
  NULL,                       -- the page states no start time
  2000,                       -- "North Cott to the Cottesloe groyne and back — a distance of 2km"
  'North Cottesloe to the Cottesloe groyne and back',
  true,                       -- "Even better — it''s free!"
  false,
  'A friendly crew of like-minded people who swim at North Cottesloe every day of the year. Everyone is welcome, whether new to ocean swimming or experienced. After three swims you are presented with your own PodSquad cap.',
  'Informal swim — there is no water safety on hand, so everyone swims at their own risk. Only swim in conditions you feel capable and confident in.',
  'https://podsquadnorthcott.com.au/',
  DATE '2026-08-13',
  true
);

COMMIT;

-- ----------------------------------------------------------------
-- ROLLBACK
-- ----------------------------------------------------------------
-- DROP TABLE public.recurring_swims;

-- ----------------------------------------------------------------
-- VERIFY — run on the READ-ONLY connection AFTER applying.
-- ----------------------------------------------------------------
-- SELECT name, schedule_text, typical_distance_metres, is_free, start_time, latitude
--   FROM public.recurring_swims;
-- expect: 1 row — PodSquad North Cottesloe, 'Every day of the year', 2000, true,
--         start_time NULL and latitude NULL (neither is stated by the source)
--
-- RLS is on and anon can read only published rows:
-- SELECT relrowsecurity FROM pg_class WHERE relname = 'recurring_swims';   -- expect: true
-- SELECT count(*) FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
--  WHERE c.relname = 'recurring_swims';                                     -- expect: 2
--
-- swim_routes is untouched:
-- SELECT count(*) FROM public.swim_routes;   -- expect: 14
