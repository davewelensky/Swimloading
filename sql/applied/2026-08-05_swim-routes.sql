-- ================================================================
-- SwimLoading — Migration
-- ================================================================

DO $safety$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM _project_identity WHERE key='project_name' AND value='swimloading') THEN
    RAISE EXCEPTION E'\n WRONG PROJECT — MIGRATION ABORTED. Expected swimloading / szgkzuswelntnevobnoh';
  END IF;
END $safety$;

-- ================================================================
-- Migration: 2026-08-05_swim-routes.sql
-- STATUS:    ✅ APPLIED 2026-08-05. Verified: 11 'operates' + 3 'supports';
--            zero booking links on non-operated routes; anon can SELECT;
--            Dassen 8700m; Robben Island Single carries 920 logged swims,
--            91-311 min, 14.3C avg; 8 routes bound to spots.
--            The safety constraint was proven, not assumed: an attempt to
--            set booking_url on 'english-channel' was REJECTED with
--            swim_routes_booking_needs_operator.
-- ================================================================

-- Purpose:
--   Swims you can BOOK, as opposed to races you enter on a fixed date.
--
--   A traveller planning Cape Town in February can only find a dated race
--   if one happens to fall that week. A bookable route answers the question
--   they actually have: "I am here for ten days — what can I swim, and who
--   do I call?" Nobody else answers it.
--
--   WHY A SEPARATE TABLE AND NOT event_editions. A route has no date; it
--   runs when the weather allows. Putting one in event_editions means
--   either inventing a date — which the schema rightly forbids — or a
--   dateless row polluting "upcoming swims". The two are different kinds of
--   thing and are modelled as such.
--
--   THE SAFETY-CRITICAL COLUMN IS operator_role. Big Bay OPERATES the Cape
--   routes: you book the swim with them. Big Bay does NOT operate the
--   English Channel, North Channel or Loch Awe — those are booked through
--   the sanctioning pilots, and Derrick travels to the UK for about six
--   weeks a year to SUPPORT South African swimmers on them. Publishing a
--   "book with Big Bay" link on the English Channel would be a factual
--   error a swimmer could act on and lose money over, so 'operates' and
--   'supports' are distinct values and the UI must never render a booking
--   call-to-action for 'supports'.

-- Requested by:
--   Dave — 2026-08-05: "I wanted the explore to be more than formal races,
--   but also to include swims or options to book a swim", and confirming
--   "only the cape routes are big bay ... Derrick from big bay goes to the
--   uk for 6 weeks to support SA swimmers on those routes".

-- ----------------------------------------------------------------
-- SOURCE OF EVERY FACT
-- ----------------------------------------------------------------
--   All route data — Dave, pasted from Big Bay SwimOps on 2026-08-05.
--   Dassen Island distance — 8.7 km, confirmed by Dave against
--   SwimLoading's own /dassen page, which states it nine times. SwimOps
--   listed no distance for it and an initial figure of 35 km was withdrawn
--   after the straight line came out at ~10 km.
--
--   The "based on N real swims" figures are OPERATIONAL DATA FROM SWIMOPS,
--   a separate product with its own database. Dave's explicit instruction
--   was to keep them decoupled, so these are a DATED SNAPSHOT copied on
--   2026-08-05 — evidence_as_at records that. They do not update
--   themselves and must not be presented as live.

-- ----------------------------------------------------------------
-- PRE-CHECKS (read-only)
-- ----------------------------------------------------------------
-- 1. Table must not exist (expect 0):
--      SELECT count(*) FROM information_schema.tables
--       WHERE table_schema='public' AND table_name='swim_routes';
-- 2. Big Bay organiser must exist, from the calendar migration (expect 1):
--      SELECT count(*) FROM event_organisers WHERE canonical_name='big bay events';
-- 3. The spots these link to (expect 8):
--      SELECT count(*) FROM spots WHERE code IN
--       ('RBNI','bigbay','LB_PREEKSTOEL','LB_MYKONOS','CAPE_POINT','MACLEAR_BEACH','WC_YZER','FB_MILLERS_POINT');

-- ----------------------------------------------------------------
-- BACKUP — not required. Creates one new table and seeds it; no existing
-- row, column or policy is touched.
-- ----------------------------------------------------------------

BEGIN;

CREATE TABLE IF NOT EXISTS public.swim_routes (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug                   text NOT NULL UNIQUE,
  name                   text NOT NULL,
  route_type             text NOT NULL CHECK (route_type IN ('island','coastal','crossing','river','lake')),

  -- Who you deal with, and in what capacity. See the header: conflating
  -- these two would put a booking link on a swim the operator does not run.
  operator_id            uuid REFERENCES public.event_organisers(id) ON DELETE SET NULL,
  operator_role          text CHECK (operator_role IN ('operates','supports')),
  sanctioning_body       text,
  booking_url            text,

  -- Start and finish, bound to SwimLoading spots where one exists so the
  -- route inherits real coordinates and the temperature pipeline.
  start_point            text,
  finish_point           text,
  start_spot_id          uuid REFERENCES public.spots(id) ON DELETE SET NULL,
  finish_spot_id         uuid REFERENCES public.spots(id) ON DELETE SET NULL,

  distance_metres        integer CHECK (distance_metres IS NULL OR distance_metres > 0),
  difficulty             text CHECK (difficulty IN ('medium','high','extreme')),

  -- Season as MONTHS, not dates: a route has no fixed day, and a date range
  -- would imply one. 1-12, inclusive, may wrap (e.g. 11..3 for a summer in
  -- the southern hemisphere).
  season_start_month     smallint CHECK (season_start_month BETWEEN 1 AND 12),
  season_end_month       smallint CHECK (season_end_month BETWEEN 1 AND 12),

  typical_temp_min_c     numeric(4,1),
  typical_temp_max_c     numeric(4,1),
  requires_observer      boolean NOT NULL DEFAULT false,
  requires_support_boat  boolean NOT NULL DEFAULT false,
  qualifying_swim_minutes integer,
  qualifying_max_temp_c  numeric(4,1),

  -- Evidence from real swims. A dated SNAPSHOT copied from SwimOps, which
  -- is a separate product with its own database and is deliberately not
  -- joined to. evidence_as_at exists so nobody mistakes it for live.
  logged_swims           integer,
  duration_min_minutes   integer,
  duration_max_minutes   integer,
  observed_temp_avg_c    numeric(4,1),
  observed_temp_min_c    numeric(4,1),
  observed_temp_max_c    numeric(4,1),
  evidence_as_at         date,
  evidence_source        text,

  summary                text,
  notes                  text,
  is_public              boolean NOT NULL DEFAULT true,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),

  -- A booking link only means something when someone actually runs the
  -- swim. Enforced rather than trusted to the UI, because this is the
  -- distinction that could cost a swimmer money.
  CONSTRAINT swim_routes_booking_needs_operator
    CHECK (booking_url IS NULL OR operator_role = 'operates')
);

COMMENT ON TABLE public.swim_routes IS
  'Swims you can book rather than races you enter: escorted crossings and '
  'coastal routes that run when conditions allow. No dates by design — see '
  'season_start_month/season_end_month. operator_role distinguishes an '
  'operator who RUNS the swim from one who SUPPORTS swimmers on someone '
  'else''s route; only ''operates'' may carry a booking_url.';

COMMENT ON COLUMN public.swim_routes.evidence_as_at IS
  'Date the logged_swims / duration / observed-temperature figures were '
  'copied from Big Bay SwimOps. SwimOps is a separate product with its own '
  'database and is deliberately NOT joined to, so these are a snapshot and '
  'do not update themselves. Never present them as live.';

CREATE INDEX IF NOT EXISTS swim_routes_public_idx   ON public.swim_routes (is_public) WHERE is_public;
CREATE INDEX IF NOT EXISTS swim_routes_operator_idx ON public.swim_routes (operator_id);
CREATE INDEX IF NOT EXISTS swim_routes_distance_idx ON public.swim_routes (distance_metres);
CREATE INDEX IF NOT EXISTS swim_routes_start_spot_idx ON public.swim_routes (start_spot_id);

-- ── RLS ───────────────────────────────────────────────────────────────
ALTER TABLE public.swim_routes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS swim_routes_public_read ON public.swim_routes;
CREATE POLICY swim_routes_public_read ON public.swim_routes
  FOR SELECT TO anon, authenticated USING (is_public);

DROP POLICY IF EXISTS swim_routes_admin_all ON public.swim_routes;
CREATE POLICY swim_routes_admin_all ON public.swim_routes
  FOR ALL TO authenticated
  USING      (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.is_admin))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.is_admin));

-- ── Seed: the eleven Cape routes Big Bay operates ─────────────────────
INSERT INTO swim_routes (
  slug, name, route_type, operator_id, operator_role, booking_url, sanctioning_body,
  start_point, finish_point, start_spot_id, finish_spot_id,
  distance_metres, difficulty, season_start_month, season_end_month,
  typical_temp_min_c, typical_temp_max_c, requires_observer, requires_support_boat,
  qualifying_swim_minutes, qualifying_max_temp_c,
  logged_swims, duration_min_minutes, duration_max_minutes,
  observed_temp_avg_c, observed_temp_min_c, observed_temp_max_c,
  evidence_as_at, evidence_source, summary, notes)
SELECT
  r.slug, r.name, r.route_type, o.id, 'operates', 'https://bigbayevents.co.za/', r.sanctioning,
  r.start_pt, r.finish_pt, ss.id, fs.id,
  r.dist, r.difficulty, r.season_start, r.season_end,
  r.tmin, r.tmax, r.observer, r.boat, r.qual_mins, r.qual_temp,
  r.swims, r.dur_min, r.dur_max, r.obs_avg, r.obs_min, r.obs_max,
  DATE '2026-08-05', 'Big Bay SwimOps (snapshot)', r.summary, r.notes
FROM (VALUES
  ('robben-island-single', 'Robben Island Single (Island Escape)', 'island', NULL,
   'Robben Island', 'Big Bay, Cape Town', 'RBNI', 'bigbay',
   7400, 'medium', 10::smallint, 5::smallint, 12.0, 16.0, true, true, 120, 14.0,
   920, 91, 311, 14.3, 10.0, 19.0,
   'Table Bay crossing from Robben Island to Big Bay. Cold Atlantic water, strong currents and swells.',
   'The Island Escape product — always Robben Island to Big Bay, fixed direction, not conditions-dependent like the multi-crossing swims. Peak season Mar-Apr and Dec. Coldest Oct-Apr (~13.5C), warmest Jan/Feb/Nov (~14.8C); temperature variation is low, so plan for 10-15C year-round.'),

  ('robben-island-double', 'Robben Island Double', 'island', NULL,
   'Robben Island', 'Big Bay, Cape Town', 'RBNI', 'bigbay',
   15000, 'high', 10::smallint, 5::smallint, 12.0, 16.0, true, true, 120, 14.0,
   187, 238, 627, 14.9, 11.5, 17.5,
   'Double Robben Island crossing, roughly twice the standard distance.',
   'Launch point depends on conditions on the day and is not fixed. Higher operational risk than the single.'),

  ('robben-island-triple', 'Robben Island Triple', 'island', NULL,
   'Robben Island', 'Big Bay, Cape Town', 'RBNI', 'bigbay',
   22200, 'extreme', 10::smallint, 5::smallint, 12.0, 16.0, true, true, 120, 14.0,
   NULL, NULL, NULL, NULL, NULL, NULL,
   'Triple Robben Island crossing, roughly three times the standard distance.',
   'Launch point depends on conditions on the day. Very high operational risk — extended cold exposure.'),

  ('robben-island-quad', 'Robben Island Quad', 'island', NULL,
   'Robben Island', 'Big Bay, Cape Town', 'RBNI', 'bigbay',
   29600, 'extreme', 10::smallint, 5::smallint, 12.0, 16.0, true, true, 120, 14.0,
   NULL, NULL, NULL, NULL, NULL, NULL,
   'Quadruple Robben Island crossing, roughly four times the standard distance.',
   'Launch point depends on conditions on the day. Extreme operational risk — extended cold exposure, typically attempted as an extension of an in-progress swim.'),

  ('dassen-island', 'Dassen Island', 'island', NULL,
   'Dassen Island', 'Yzerfontein', NULL, 'WC_YZER',
   8700, 'high', 11::smallint, 4::smallint, NULL, NULL, false, true, NULL, NULL,
   NULL, NULL, NULL, NULL, NULL, NULL,
   'Boat out to Dassen Island, touch the rocks to start, then swim back to Yzerfontein on the mainland.',
   'Offshore route with poor mobile signal and safety considerations. Cold Atlantic, open ocean swell. Confirm the finish point with the skipper before departure — it is easy to drift north or south of Yzerfontein.'),

  ('cape-point', 'Cape Point', 'coastal', NULL,
   'False Bay side approach', 'Buffels Bay', NULL, NULL,
   8000, 'high', 11::smallint, 4::smallint, NULL, NULL, false, true, NULL, NULL,
   10, 180, 360, 16.0, 13.0, 19.0,
   'False Bay side approach to Cape Point, finishing at Buffels Bay.',
   'Shorter than Three Capes. Limited exit points along the rocky coastline; support boat required. No mobile signal — check-in every 15 minutes.'),

  ('three-capes', 'Three Capes', 'coastal', 'CLDSA',
   'Cape Maclear', 'Cape Point', 'MACLEAR_BEACH', 'CAPE_POINT',
   10200, 'extreme', 11::smallint, 4::smallint, NULL, NULL, false, true, NULL, NULL,
   8, 198, 355, 15.0, 15.0, 15.0,
   'CLDSA-ratified Cape Triple Crown leg, rounding Cape Maclear, the Cape of Good Hope and Cape Point.',
   'Sheer cliffs with very limited exit points — a support flotilla is strictly required. Complex cross-currents, heavy Atlantic swells, dense kelp. The start may shift to Diaz Beach depending on surf. No mobile signal.'),

  ('false-bay-east-west', 'False Bay — East to West', 'crossing', NULL,
   'Eastern shore, False Bay', 'Western shore, False Bay', NULL, NULL,
   33000, 'high', 11::smallint, 4::smallint, 14.0, 20.0, false, true, 360, 18.0,
   32, 448, 975, 17.8, 14.0, 19.0,
   '33 km crossing of False Bay. Warmer than the Atlantic swims but unpredictable.',
   'The Cape Doctor creates significant chop. Long-duration crossing with increased safety complexity.'),

  ('false-bay-west-east', 'False Bay — West to East', 'crossing', NULL,
   'Western shore, False Bay', 'Eastern shore, False Bay', NULL, NULL,
   33000, 'high', 11::smallint, 4::smallint, 14.0, 20.0, false, true, 360, 18.0,
   32, 448, 975, 17.8, 14.0, 19.0,
   '33 km crossing of False Bay in the reverse direction.',
   'The Cape Doctor creates significant chop. Long-duration crossing with increased safety complexity.'),

  ('preekstoel-mykonos', 'Preekstoel to Mykonos', 'coastal', NULL,
   'Preekstoel, Langebaan', 'Mykonos, Langebaan', 'LB_PREEKSTOEL', 'LB_MYKONOS',
   13000, 'medium', 10::smallint, 4::smallint, NULL, NULL, false, true, NULL, NULL,
   9, 236, 265, 18.2, 15.0, 19.0,
   'Common West Coast route down the Langebaan lagoon.',
   'Partial mobile signal along the route.'),

  ('preekstoel-mykonos-preekstoel', 'Preekstoel to Mykonos and back', 'coastal', NULL,
   'Preekstoel, Langebaan', 'Preekstoel, Langebaan', 'LB_PREEKSTOEL', 'LB_PREEKSTOEL',
   26000, 'high', 10::smallint, 4::smallint, NULL, NULL, false, true, NULL, NULL,
   21, 320, 465, 16.0, 14.0, 18.0,
   'Longer out-and-back West Coast route.',
   'Partial mobile signal along the route.')
) AS r(slug, name, route_type, sanctioning, start_pt, finish_pt, start_code, finish_code,
       dist, difficulty, season_start, season_end, tmin, tmax, observer, boat,
       qual_mins, qual_temp, swims, dur_min, dur_max, obs_avg, obs_min, obs_max, summary, notes)
CROSS JOIN (SELECT id FROM event_organisers WHERE canonical_name='big bay events') o
LEFT JOIN spots ss ON ss.code = r.start_code
LEFT JOIN spots fs ON fs.code = r.finish_code
WHERE NOT EXISTS (SELECT 1 FROM swim_routes x WHERE x.slug = r.slug);

-- ── Seed: reference routes Big Bay SUPPORTS but does NOT operate ──────
-- operator_role = 'supports' and booking_url NULL, enforced by the CHECK
-- above. These are booked through their sanctioning bodies; Derrick travels
-- to the UK for about six weeks a year to support South African swimmers on
-- them. The UI must say so and must not offer a booking button.
INSERT INTO swim_routes (
  slug, name, route_type, operator_id, operator_role, sanctioning_body,
  start_point, finish_point, distance_metres, difficulty,
  season_start_month, season_end_month, typical_temp_min_c, typical_temp_max_c,
  requires_observer, requires_support_boat, qualifying_swim_minutes, qualifying_max_temp_c,
  summary, notes)
SELECT r.slug, r.name, r.route_type, o.id, 'supports', r.sanctioning,
       r.start_pt, r.finish_pt, r.dist, r.difficulty,
       r.season_start, r.season_end, r.tmin, r.tmax,
       r.observer, true, r.qual_mins, r.qual_temp, r.summary, r.notes
FROM (VALUES
  ('english-channel', 'English Channel', 'crossing', 'Channel Swimming Association / CS&PF',
   'Shakespeare Beach, Dover', 'Cap Gris-Nez, France', 33800, 'extreme',
   6::smallint, 9::smallint, 14.0, 18.0, true, 360, 16.0,
   'The world''s most iconic open water crossing — 33.8 km across the Strait of Dover.',
   'Straight-line distance is ~33.8 km; the distance actually swum is significantly higher because of tidal sweep, an S-curve track running NE on the flood and SW on the ebb. Most crossings start between 2am and 6am from Shakespeare Beach. Spring tides sweep harder and risk overshooting Cap Gris-Nez, a rocky headland; neap tides give a gentler, more predictable landing and are preferred for slower swimmers. The pilot may divert to Cap Blanc-Nez if conditions deteriorate on approach. Often called "Dover to Calais", but Cap Gris-Nez is the headland actually used, about 10 km from Calais. Booked through the CSA or CS&PF, not through Big Bay.'),

  ('north-channel', 'North Channel', 'crossing', 'Irish Long Distance Swimming Association',
   'Donaghadee, Northern Ireland', 'Portpatrick, Scotland', 34500, 'extreme',
   7::smallint, 9::smallint, 10.0, 14.0, true, 360, 12.0,
   'The coldest of the Oceans Seven — 34.5 km at 10-14°C, with lion''s mane jellyfish.',
   'Cold year-round relative to the English Channel: 10-14C is typical even in the swim season. Lion''s mane jellyfish are a known hazard. Qualifying swim is 6 hours at or below 12C. Booked through the sanctioning body, not through Big Bay.'),

  ('loch-awe', 'Loch Awe', 'crossing', NULL,
   'North end, Loch Awe', 'South end, Loch Awe', 41000, 'extreme',
   6::smallint, 9::smallint, NULL, NULL, false, NULL, NULL,
   'Scotland''s longest freshwater loch — 41 km end to end.',
   'Average width 1 km, maximum depth 93.6 m. Freshwater and non-tidal, so there are no tide or sea-state considerations — only wind and water temperature matter. Not part of any marathon-swim governing body catalogue, unlike the English or North Channel, so there is no standardised qualifying rule.')
) AS r(slug, name, route_type, sanctioning, start_pt, finish_pt, dist, difficulty,
       season_start, season_end, tmin, tmax, observer, qual_mins, qual_temp, summary, notes)
CROSS JOIN (SELECT id FROM event_organisers WHERE canonical_name='big bay events') o
WHERE NOT EXISTS (SELECT 1 FROM swim_routes x WHERE x.slug = r.slug);

COMMIT;

-- ----------------------------------------------------------------
-- ROLLBACK
-- ----------------------------------------------------------------
-- BEGIN;
-- DROP TABLE IF EXISTS public.swim_routes;
-- COMMIT;
-- Nothing else references it, so the drop is clean.

-- ----------------------------------------------------------------
-- VERIFY (read-only)
-- ----------------------------------------------------------------
-- 1. Fourteen routes: 11 operated, 3 supported.
--      SELECT operator_role, count(*) FROM swim_routes GROUP BY 1;
--      -- expect operates 11, supports 3
--
-- 2. THE SAFETY CHECK — no booking link on a route Big Bay does not run:
--      SELECT count(*) FROM swim_routes
--       WHERE booking_url IS NOT NULL AND operator_role <> 'operates';   -- expect 0
--      -- and the constraint makes it impossible:
--      -- UPDATE swim_routes SET booking_url='x' WHERE slug='english-channel';
--      --   -> violates swim_routes_booking_needs_operator
--
-- 3. Anonymous visitors can read them (no login to browse):
--      SELECT has_table_privilege('anon','swim_routes','SELECT');        -- expect true
--
-- 4. Spots are linked where one exists:
--      SELECT slug, start_spot_id IS NOT NULL AS start_linked,
--             finish_spot_id IS NOT NULL AS finish_linked FROM swim_routes ORDER BY slug;
--
-- 5. Evidence is present and dated for the routes that have it:
--      SELECT slug, logged_swims, duration_min_minutes, duration_max_minutes,
--             observed_temp_avg_c, evidence_as_at
--        FROM swim_routes WHERE logged_swims IS NOT NULL ORDER BY logged_swims DESC;
--      -- expect Robben Island Single at 920, evidence_as_at 2026-08-05
--
-- 6. Dassen is 8.7 km, not the withdrawn 35 km:
--      SELECT distance_metres FROM swim_routes WHERE slug='dassen-island';  -- expect 8700
