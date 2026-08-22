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
-- Migration: 2026-08-22_locate-regular-group-swims.sql
-- ================================================================

-- Purpose:
--   Give the two original regular group swims coordinates, so they appear on
--   the map. markersForMode() already plots this mode correctly; both rows
--   simply had latitude and longitude NULL, so there was nothing to draw.
--   Reported by Dave, 22 Aug 2026: "the regular group swims, it doesn't show
--   when selected on the map".

-- Also links each to the spot it swims at, which is worth more than the
-- coordinates alone: a linked spot carries a blended temperature
-- (spot_temp_estimate), including real swimmer readings.

-- COORDINATES — supplied by Dave, 22 Aug 2026, and they are the MEETING
-- POINTS, not the spot centres. That distinction is why they are worth having:
--
--     podsquad-north-cottesloe      -31.989151376768643, 115.75181501323412
--     hot-chocolate-swim-camps-bay  -33.9505641069856,    18.378382758493377
--
--   Checked against the spots they sit on, and both land where the club's own
--   description says they should:
--     * PodSquad is 761 m NORTH of the Cottesloe Beach spot centre — the club
--       swims at NORTH Cottesloe, and we hold no separate spot for it.
--     * Hot Chocolate is 466 m north of the Camps Bay spot centre — the swim
--       starts in front of Café Caprice, at that end of the beach.
--
--   An earlier draft of this migration used the SPOT centres instead. These
--   are better: a pin a swimmer can walk to rather than a pin on the right
--   beach.
--
-- SPOT LINK — kept, and for a different reason than the coordinates. A linked
--   spot carries a blended temperature (spot_temp_estimate) including real
--   swimmer readings. Both swims are a few hundred metres from their spot on
--   the same stretch of water, so the temperature is honest; the coordinate no
--   longer depends on it. meeting_point remains the club's own words.

-- ----------------------------------------------------------------
-- PRE-CHECKS — read-only, before applying.
-- ----------------------------------------------------------------
--   -- Two rows unplottable (expect 2):
--   SELECT count(*) FROM recurring_swims WHERE is_public AND latitude IS NULL;
--
--   -- Both target spots exist, are active and are the OCEAN ones (expect 2):
--   SELECT id, name, water_type FROM spots
--    WHERE id IN ('28b8542c-65af-4cd2-b214-58ccafb11637',
--                 '37eb8c47-9d2b-4eff-8c55-807ee55ab27d') AND active;

-- ----------------------------------------------------------------
-- BACKUP — required: this migration contains an UPDATE.
-- ----------------------------------------------------------------
BEGIN;

CREATE TABLE IF NOT EXISTS _bak_20260822_recurring_swims_location AS
SELECT id, slug, latitude, longitude, spot_id, now() AS backed_up_at
  FROM recurring_swims;

UPDATE recurring_swims r
   SET spot_id    = v.spot_id,
       latitude   = v.lat,
       longitude  = v.lng,
       updated_at = now()
  FROM (VALUES
    ('hot-chocolate-swim-camps-bay', -33.9505641069856,   18.378382758493377, '28b8542c-65af-4cd2-b214-58ccafb11637'::uuid),
    ('podsquad-north-cottesloe',     -31.989151376768643, 115.75181501323412, '37eb8c47-9d2b-4eff-8c55-807ee55ab27d'::uuid)
  ) AS v(slug, lat, lng, spot_id)
 WHERE r.slug = v.slug
   AND r.latitude IS NULL
   AND EXISTS (SELECT 1 FROM spots s WHERE s.id = v.spot_id AND s.active);

COMMIT;

-- ----------------------------------------------------------------
-- ROLLBACK
-- ----------------------------------------------------------------
--   UPDATE recurring_swims r
--      SET latitude = b.latitude, longitude = b.longitude, spot_id = b.spot_id
--     FROM _bak_20260822_recurring_swims_location b WHERE r.id = b.id;
--   -- then: DROP TABLE _bak_20260822_recurring_swims_location;

-- ----------------------------------------------------------------
-- VERIFY — read-only, after applying.
-- ----------------------------------------------------------------
--   -- All three now plottable, and two carry a spot link (expect 3, 2):
--   SELECT count(*) FILTER (WHERE latitude IS NOT NULL) AS plottable,
--          count(*) FILTER (WHERE spot_id IS NOT NULL)  AS linked_to_a_spot
--     FROM recurring_swims WHERE is_public;
--
--   -- Each landed on the right spot, in the right country:
--   SELECT r.slug, r.city, r.country_code, s.name AS spot, s.water_type,
--          r.latitude, r.longitude
--     FROM recurring_swims r LEFT JOIN spots s ON s.id = r.spot_id
--    WHERE r.is_public ORDER BY r.name;
--
--   -- Nothing else was touched (expect 0):
--   SELECT count(*) FROM recurring_swims r
--     JOIN _bak_20260822_recurring_swims_location b ON b.id = r.id
--    WHERE b.latitude IS NOT NULL
--      AND (r.latitude, r.longitude, r.spot_id) IS DISTINCT FROM (b.latitude, b.longitude, b.spot_id);
