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
-- Migration: 2026-08-13_caramoan-venue-coordinates.sql
-- Process:   see MIGRATIONS.md
-- ================================================================

-- Purpose:
--   Give the Swimjunkie Caramoan venue the coordinate of its actual start,
--   replacing the town-centre point the geocoder produces for it, and
--   replace a marketing tagline stored as the venue name.
--
--   WHY THE GEOCODER GETS THIS ONE WRONG. active.com states the location as
--   "Caramoan Islands, Pili, Camarines Sur, Philippines". Pili is where you
--   register; the swim is ~75 km away on the Caramoan peninsula. OSM has no
--   feature called "Caramoan Islands", so scripts/geocode-venues.mjs
--   narrows to the city and returns 13.5562, 123.2741 — a point on
--   Maharlika Highway in Pili. Every guard in that script passes: right
--   country, acceptable feature class, one unambiguous candidate. It is not
--   a bad match, it is a correct match to the wrong field, so no
--   result-filtering can catch it. (Withholding the city fallback was tried
--   on 2026-08-12 and reverted — it cannot tell a street address from a
--   distant place name, and it sent Sage Beach to Ketchikan and Voula Beach
--   to central Athens while fixing only this one. See the note in that
--   script.)
--
--   EVIDENCE FOR THE COORDINATE — not invented, and not a guess at
--   "Caramoan" generally. The organiser's own page names the start four
--   times:
--     "5Km swimmers start from Gota Beach, hydrate on two other island
--      beaches, and return to Gota."
--     "October 4, 5:00am (20Km Swim), Gota Beach"
--     "October 4, 5:30am (15K Island swim), Gota Beach"
--     "Briefing: October 3, 5pm, Gota Village Resort, Caramoan"
--   OpenStreetMap resolves "Gota Beach, Caramoan, Philippines" to
--   13.8035175, 123.8841808, category natural/beach, display name
--   "Gota Beach, Ilawod, Caramoan, Camarines Sur, Bicol Region, Philippines".
--   Stamped coordinates_source='manual' so it is never confused with an
--   automatic geocode.
--
--   PART 2 (separable — drop it if you disagree): display_name is currently
--   "Four Beaches. Three Coral Fields. One Amazing Swim." That is
--   active.com's marketing tagline sitting in schema.org Place.name, which
--   the extractor takes at face value. It reads as the venue on the event
--   page.

-- Requested by:
--   Dave, 2026-08-13, after asking why Caramoan was not shown on the map.

-- ----------------------------------------------------------------
-- PRE-CHECKS — run on the READ-ONLY connection BEFORE applying.
-- ----------------------------------------------------------------
-- SELECT id, display_name, city, region, country_code,
--        latitude, longitude, coordinates_source, location_text
--   FROM public.event_venues
--  WHERE id = '5e271ff8-d773-490d-af0a-546ae7af201a';
-- expect: exactly 1 row, country_code = 'PH', location_text =
--   'Caramoan Islands, Pili, Camarines Sur, Philippines'.
--   latitude is either NULL (geocoder not yet run) or 13.5562 with
--   coordinates_source='geocoded' (the Pili point this migration replaces).
--   If it is anything else, STOP — someone has set it deliberately.

-- ----------------------------------------------------------------
-- BACKUP — required: this UPDATEs an existing row.
-- ----------------------------------------------------------------
-- CREATE TABLE _bak_20260813_caramoan_venue AS
--   SELECT * FROM public.event_venues
--    WHERE id = '5e271ff8-d773-490d-af0a-546ae7af201a';

-- ----------------------------------------------------------------
-- MIGRATION — applied only after Dave types "apply".
-- ----------------------------------------------------------------
BEGIN;

-- Part 1 — the coordinate.
UPDATE public.event_venues
   SET latitude             = 13.8035175,
       longitude            = 123.8841808,
       coordinates_source   = 'manual',
       geocoded_at          = now(),
       geocode_matched_name = 'Gota Beach, Ilawod, Caramoan, Camarines Sur, Bicol Region, Philippines'
 WHERE id = '5e271ff8-d773-490d-af0a-546ae7af201a';

-- Part 2 — the name (separable; delete this statement to skip it).
UPDATE public.event_venues
   SET display_name = 'Gota Beach, Caramoan'
 WHERE id = '5e271ff8-d773-490d-af0a-546ae7af201a'
   AND display_name = 'Four Beaches. Three Coral Fields. One Amazing Swim.';

COMMIT;

-- ----------------------------------------------------------------
-- ROLLBACK
-- ----------------------------------------------------------------
-- UPDATE public.event_venues v
--    SET latitude = b.latitude, longitude = b.longitude,
--        coordinates_source = b.coordinates_source, geocoded_at = b.geocoded_at,
--        geocode_matched_name = b.geocode_matched_name, display_name = b.display_name
--   FROM _bak_20260813_caramoan_venue b
--  WHERE v.id = b.id;

-- ----------------------------------------------------------------
-- VERIFY — run on the READ-ONLY connection AFTER applying.
-- ----------------------------------------------------------------
-- SELECT display_name, latitude, longitude, coordinates_source, geocode_matched_name
--   FROM public.event_venues
--  WHERE id = '5e271ff8-d773-490d-af0a-546ae7af201a';
-- expect: Gota Beach, Caramoan | 13.8035175 | 123.8841808 | manual | Gota Beach, Ilawod, ...
--
-- The swim should now be ON the map (both coordinates non-null):
-- SELECT e.title, v.latitude, v.longitude
--   FROM event_editions e JOIN public.event_venues v ON v.id = e.venue_id
--  WHERE e.slug LIKE 'swimjunkie-challenge-caramoan%';
-- expect: 1 row with both coordinates set
