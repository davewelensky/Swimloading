-- ⚠️  SAFETY CHECK
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM _project_identity WHERE key='project_name' AND value='swimloading') THEN
    RAISE EXCEPTION 'WRONG PROJECT — MIGRATION ABORTED. Expected swimloading (szgkzuswelntnevobnoh).'
    USING HINT = 'Check the project ref in your Supabase dashboard URL';
  END IF;
  RAISE NOTICE '✅ Project identity confirmed: swimloading';
END $$;

-- ================================================================
-- Migration: 2026-08-22_add-hjallerup-open-water.sql
-- ================================================================

-- Purpose:
--   Add a third regular group swim: 24 timer i Hjallerup Open Water, from the
--   bathing jetty at Lindholm Strandpark on the Limfjord, Nørresundby.
--   recurring_swims holds two rows today, which is why the Regular group
--   swims mode is thin.

-- Requested by:
--   Dave, 22 Aug 2026, from https://www.24timerihjallerup.dk/open-water/
--   He supplied his own English translation of the Danish source and it
--   matches the reading below field for field.

-- PROVENANCE — every value traced to the source, in the club's own words:
--
--   "Fra 1. Maj og frem til udgangen af September"
--       → season_start_month = 5, season_end_month = 9
--   "vil der løbende være muligt at komme ud og svømme"   (løbende = ongoing)
--   "Vi svømmer fast fra badebroen ved Lindholm Strandpark"
--       → meeting_point
--   "En typisk svømmetur er på ca. 2 km"
--       → typical_distance_metres = 2000
--   "Det er gratis at deltage, men vi håber at man har et aktivt medlemskab"
--       → is_free = true, requires_membership = FALSE. They HOPE for
--         membership; they do not require it. Recording it as required would
--         turn a welcome into a barrier.
--   "...følge med i hvor og hvornår vi svømmer" (on Facebook)
--       → days_of_week and start_time stay NULL. The club states plainly
--         that where and when is announced on Facebook, so there is no
--         weekly slot to record. Inventing "Saturdays 9am" would send
--         somebody to an empty jetty.
--
-- NOT from the source, and marked as such:
--   * latitude/longitude — reused from our own event_venues row for Lindholm
--     Strandpark (the Tour De Egholm venue, ~1.5 km from the Isbjørnen
--     sensor). The page gives no coordinates.
--   * region 'Nordjylland' — geography of Nørresundby, not a claim by them.
--   * safety_note — OUR standard wording for an informal swim, identical to
--     the other two rows. The page says nothing about safety; this is a
--     caveat we add, not something they told us.
--
-- DELIBERATELY NULL:
--   contact_url — the page names two Facebook groups ("24 timer i Hjallerup
--   Open Water" and "Spring i Baljen med 24 timer i Hjallerup") but the three
--   Facebook links in the markup cannot be matched to those names with any
--   confidence. A wrong group link is worse than none.

-- ----------------------------------------------------------------
-- PRE-CHECKS — read-only, before applying.
-- ----------------------------------------------------------------
--   SELECT count(*) FROM recurring_swims;                      -- expect 2
--   SELECT count(*) FROM recurring_swims
--    WHERE slug = 'hjallerup-open-water-lindholm-strandpark';  -- expect 0

-- ----------------------------------------------------------------
-- BACKUP — not required: this is a single INSERT of a new row and
-- modifies nothing. Rollback is a DELETE of that one slug.
-- ----------------------------------------------------------------

-- ----------------------------------------------------------------
-- MIGRATION — applied only after Dave types "apply".
-- ----------------------------------------------------------------
BEGIN;

INSERT INTO recurring_swims (
  slug, name, group_name, website_url, contact_url,
  location_text, meeting_point, city, region, country_code,
  latitude, longitude, spot_id,
  schedule_text, days_of_week, start_time,
  season_start_month, season_end_month,
  typical_distance_metres, route_description,
  is_free, requires_membership,
  summary, safety_note, source_url, last_verified_at, is_public, notes
) VALUES (
  'hjallerup-open-water-lindholm-strandpark',
  '24 timer i Hjallerup Open Water',
  '24 Timer i Hjallerup',
  'https://www.24timerihjallerup.dk/open-water/',
  NULL,
  'Lindholm Strandpark, Nørresundby, Limfjorden',
  'The bathing jetty at Lindholm Strandpark',
  'Nørresundby',
  'Nordjylland',
  'DK',
  57.063291, 9.905267,
  NULL,
  'From 1 May to the end of September. No fixed day or time — the club posts where and when they swim on Facebook.',
  NULL,
  NULL,
  5, 9,
  2000,
  NULL,
  true,
  false,
  'A free open-water swim from the bathing jetty at Lindholm Strandpark on the Limfjord, run by the charity 24 Timer i Hjallerup. A typical swim is about 2 km. Anyone who wants to swim is welcome to join the trips and events arranged through the summer; the club hopes participants hold an active membership of the association.',
  'Informal swim — there is no water safety on hand, so everyone swims at their own risk. Only swim in conditions you feel capable and confident in.',
  'https://www.24timerihjallerup.dk/open-water/',
  '2026-08-22',
  true,
  'Coordinates reused from our event_venues row for Lindholm Strandpark (Tour De Egholm venue); the page gives none. The same page displays a live water temperature from api.thermit.dk (department 2941, sensor owned by Vikingeklubben Isbjørnen, Vestre Fjordpark, Aalborg, ~1.5 km across the Limfjord) — a candidate measured source, not yet integrated and not to be used without asking Thermit.'
);

COMMIT;

-- ----------------------------------------------------------------
-- ROLLBACK
-- ----------------------------------------------------------------
--   DELETE FROM recurring_swims WHERE slug = 'hjallerup-open-water-lindholm-strandpark';

-- ----------------------------------------------------------------
-- VERIFY — read-only, after applying.
-- ----------------------------------------------------------------
--   -- Three rows now, and the new one reads correctly (expect 3):
--   SELECT slug, name, city, country_code, schedule_text,
--          season_start_month, season_end_month, typical_distance_metres,
--          is_free, requires_membership, days_of_week, start_time
--     FROM recurring_swims ORDER BY country_code, name;
--
--   -- Nothing was assumed: day and time are NULL because the source gives none
--   SELECT slug FROM recurring_swims
--    WHERE slug = 'hjallerup-open-water-lindholm-strandpark'
--      AND days_of_week IS NULL AND start_time IS NULL;   -- expect 1 row
