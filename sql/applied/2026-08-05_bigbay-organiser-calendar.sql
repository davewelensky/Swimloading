-- ================================================================
-- SwimLoading — Migration (organiser-supplied data)
-- ================================================================

DO $safety$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM _project_identity WHERE key='project_name' AND value='swimloading') THEN
    RAISE EXCEPTION E'\n WRONG PROJECT — MIGRATION ABORTED. Expected swimloading / szgkzuswelntnevobnoh';
  END IF;
END $safety$;

-- ================================================================
-- Migration: 2026-08-05_bigbay-organiser-calendar.sql
-- STATUS:    ✅ APPLIED 2026-08-05. Verified: 9 editions, 15 distances,
--            South Africa upcoming 7 -> 16, nearest swim to Cape Town
--            1,220km -> 13km, Freedom Swim stored with NULL date /
--            date_confirmed=false / is_indexable=false as the schema
--            requires, and 5 of 6 venues carrying coordinates copied from
--            their spot (Chapman's Peak has none, by design).
--            NOTE: the first apply attempt FAILED on the organiser_type
--            CHECK — 'organiser' is not a permitted value. Allowed are
--            club/commercial/charity/governing_body/community_group/
--            individual/unknown. Nothing was written on that attempt.
-- ================================================================

-- Purpose:
--   Add Big Bay Events' 2026/27 swim calendar — nine Cape Town and West
--   Coast swims — from the organiser's own published calendar.
--
--   This is the first ORGANISER-SUPPLIED data in the catalogue. No crawler,
--   no language model, no inference: Dave supplied Big Bay's calendar and
--   confirmed every date and distance directly. That is the strongest
--   provenance the system has, and it is exactly the route recommended when
--   bigbayevents.co.za turned out to publish no machine-readable dates at
--   all (see sql/applied/2026-08-05_sa-sources-bigbay-cldsa.sql).
--
--   It also closes the gap Dave opened this session: the nearest upcoming
--   swim to Cape Town was 1,220 km away, in a city that is SwimLoading's
--   home market. After this it is nine swims on its own doorstep.
--
--   EVERY venue is linked to an EXISTING SwimLoading spot, so these events
--   inherit real coordinates and the water-temperature pipeline rather than
--   carrying invented ones. The single exception is Chapman's Peak, which
--   has no spot — see the note on it below.

-- Requested by:
--   Dave — 2026-08-05, supplying the Big Bay Events 2026/27 calendar and
--   confirming dates, venues and distances by hand.

-- ----------------------------------------------------------------
-- SOURCE OF EVERY FACT — so a reviewer can audit this without the chat.
-- ----------------------------------------------------------------
--   Dates (all nine)          — organiser's published 2026/27 calendar
--   Spring Equinox distances  — Dave, confirmed: 800m / 1600m / 3200m
--   Shipwrecked              — Dave: 5 km, Milnerton to Big Bay
--   Chapmans Peak distances   — Dave: 800m / 1600m / 5000m
--   Mad Dash                  — Dave: night swim, Preekstoel to Pearly's or
--                               Friday Island, 6 km or 10 km
--   Langebaan Express         — bigbayevents.co.za: 6 km to Pearly's,
--                               12 km to Mykonos
--   Around the Rocks          — bigbayevents.co.za: "around 2500m ... the
--                               swell size determining the exact distance"
--   Around the Island        — Dave, confirmed: 1600m / 3200m
--   Roman Rock               — Dave, confirmed: 5400m
--   Freedom Swim             — NO distance supplied, so none is stored.
--                              Not guessed. (The classic Robben Island
--                              crossing is ~7.4 km, but that is knowledge
--                              about the water, not a statement about THIS
--                              race, so it stays out until Derrick says.)
--
--   The Mad Dash artwork on the calendar is a 2023 poster showing 7km/12km
--   and 2023 prices. Those figures are DELIBERATELY NOT USED — Dave gave
--   the current 6 km / 10 km.

-- ----------------------------------------------------------------
-- PRE-CHECKS — run on the READ-ONLY connection BEFORE applying.
-- ----------------------------------------------------------------
-- 1. The seven spots this links to must all exist (expect 7):
--      SELECT count(*) FROM spots WHERE code IN
--        ('LB_PREEKSTOEL','LB_ISLAND','LB_PEARLYS','LB_MYKONOS','RBNI','ROMAN_ROCK','bigbay');
--
-- 2. No Big Bay organiser yet (expect 0):
--      SELECT count(*) FROM event_organisers WHERE canonical_name ILIKE '%big bay%';
--
-- 3. Baseline counts:
--      SELECT count(*) FROM event_editions;                                        -- 271
--      SELECT count(*) FROM event_editions e JOIN event_venues v ON v.id=e.venue_id
--       WHERE v.country_code='ZA' AND e.start_date >= current_date;                -- 7
--
-- 4. ⚠️ POSSIBLE DUPLICATE, for a human to judge — do not auto-merge:
--      SELECT id, display_name FROM event_series WHERE canonical_name ILIKE '%freedom%';
--      -- "Liberty to Freedom Swim" already exists. The Robben Island crossing
--      -- has run under several sponsor names, so this MAY be the same race as
--      -- Big Bay's "760 Freedom Swim". It is inserted separately here rather
--      -- than merged on a guess; if they are the same, merge by hand.

-- ----------------------------------------------------------------
-- BACKUP — required: inserts into live catalogue tables.
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS _bak_20260805d_event_editions AS
  SELECT id, title, start_date, now() AS backed_up_at FROM event_editions;

-- ----------------------------------------------------------------
-- MIGRATION — applied only after Dave types "apply".
-- ----------------------------------------------------------------
BEGIN;

-- ── 1. Organiser ──────────────────────────────────────────────────────
INSERT INTO event_organisers (canonical_name, display_name, organiser_type, official_url, country_code, status)
-- 'commercial', not 'organiser': organiser_type permits only
-- club/commercial/charity/governing_body/community_group/individual/unknown.
-- Big Bay is a water-safety and event-management business, so commercial
-- is both valid and accurate. (First apply attempt failed on this CHECK.)
SELECT 'big bay events', 'Big Bay Events', 'commercial', 'https://bigbayevents.co.za/', 'ZA', 'active'
WHERE NOT EXISTS (SELECT 1 FROM event_organisers WHERE canonical_name = 'big bay events');

-- ── 2. Venues, each bound to an existing SwimLoading spot ─────────────
-- Coordinates are COPIED from the spot rather than typed, so the two can
-- never disagree and the venue inherits the temperature pipeline.
INSERT INTO event_venues (canonical_name, display_name, location_text, city, region, country_code,
                          latitude, longitude, timezone, water_body_type, spot_id)
SELECT v.canonical, v.display, v.loc, v.city, 'Western Cape', 'ZA',
       s.latitude, s.longitude, 'Africa/Johannesburg', 'sea', s.id
FROM (VALUES
  ('langebaan preekstoel', 'Langebaan — Preekstoel', 'Kraalbaai / Preekstoel, Langebaan Lagoon', 'Langebaan', 'LB_PREEKSTOEL'),
  ('langebaan the island', 'Langebaan — Schaapen Island', 'Schaapen Island, Langebaan Lagoon', 'Langebaan', 'LB_ISLAND'),
  ('big bay bloubergstrand', 'Big Bay, Bloubergstrand', 'Big Bay, Bloubergstrand, Cape Town', 'Cape Town', 'bigbay'),
  ('robben island crossing', 'Robben Island', 'Robben Island to the mainland, Table Bay', 'Cape Town', 'RBNI'),
  ('roman rock simons town', 'Roman Rock, Simon''s Town', 'Roman Rock Lighthouse, False Bay', 'Simon''s Town', 'ROMAN_ROCK')
) AS v(canonical, display, loc, city, spot_code)
JOIN spots s ON s.code = v.spot_code
WHERE NOT EXISTS (SELECT 1 FROM event_venues ev WHERE ev.canonical_name = v.canonical);

-- Chapman's Peak has NO spot, so it gets NO coordinates. It will therefore
-- be listed but will not appear as a pin on the map. That is the honest
-- outcome: a made-up coordinate would put a swim on the wrong beach, which
-- is worse than an absent pin. Add a spot for it and backfill to fix.
INSERT INTO event_venues (canonical_name, display_name, location_text, city, region, country_code,
                          timezone, water_body_type)
SELECT 'chapmans peak', 'Chapman''s Peak', 'Chapman''s Peak, Cape Peninsula', 'Cape Town', 'Western Cape', 'ZA',
       'Africa/Johannesburg', 'sea'
WHERE NOT EXISTS (SELECT 1 FROM event_venues WHERE canonical_name = 'chapmans peak');

-- ── 3. Series ─────────────────────────────────────────────────────────
INSERT INTO event_series (canonical_name, display_name, organiser_id, event_type, official_url, status, prominence)
SELECT s.canonical, s.display, o.id, 'official_race', 'https://bigbayevents.co.za/', 'active', s.prominence
FROM (VALUES
  ('spring equinox swim',              'Spring Equinox Swim',              'regional'),
  ('langebaan express',                'Langebaan Express',                'regional'),
  ('760 freedom swim',                 '760 Freedom Swim',                 'major'),
  ('around the rocks extreme swim',    'Around the Rocks Extreme Swim',    'regional'),
  ('langebaan mad dash',               'Langebaan Mad Dash',               'regional'),
  ('langebaan around the island swim', 'Langebaan Around the Island Swim', 'regional'),
  ('shipwrecked swim',                 'Shipwrecked',                      'regional'),
  ('chapmans peak meander',            'Chapman''s Peak Meander',          'regional'),
  ('roman rock swim challenge',        'The Roman Rock Premium Swim Challenge', 'regional')
) AS s(canonical, display, prominence)
CROSS JOIN (SELECT id FROM event_organisers WHERE canonical_name = 'big bay events') o
WHERE NOT EXISTS (SELECT 1 FROM event_series es WHERE es.canonical_name = s.canonical);

-- ── 4. Editions ───────────────────────────────────────────────────────
-- verification_tier 'confirmed' and confidence_score 95: supplied by the
-- organiser and confirmed by hand, which is stronger than anything a crawl
-- produces. officially_claimed stays FALSE — that flag means an organiser
-- claimed the listing through the claim workflow, and Derrick has not; the
-- two must not be conflated.
INSERT INTO event_editions (
  series_id, venue_id, edition_year, title, start_date, end_date,
  date_precision, date_confirmed, status, registration_status,
  official_url, timezone, last_verified_at, discipline,
  verification_tier, confidence_score, is_searchable, is_indexable, is_featured)
SELECT es.id, ev.id, e.yr, e.title, e.start_date, NULL,
       e.precision, e.confirmed, 'announced', 'unknown',
       'https://bigbayevents.co.za/', 'Africa/Johannesburg', now(), 'open_water',
       'confirmed', 95, true, e.confirmed, false
FROM (VALUES
  ('spring equinox swim',              'langebaan preekstoel',   2026::smallint, 'Spring Equinox Swim',              DATE '2026-09-19', 'exact', true),
  ('langebaan express',                'langebaan preekstoel',   2026::smallint, 'Langebaan Express',                DATE '2026-11-07', 'exact', true),
  -- December 2026, day not yet decided. The schema forbids storing an
  -- unconfirmed date, so BOTH date columns are NULL and date_confirmed is
  -- false. It lists under "Date to be confirmed" until Derrick sets a day.
  ('760 freedom swim',                 'robben island crossing', 2026::smallint, '760 Freedom Swim',                 NULL,              'month', false),
  ('around the rocks extreme swim',    'big bay bloubergstrand', 2027::smallint, 'Around the Rocks Extreme Swim',    DATE '2027-01-23', 'exact', true),
  ('langebaan mad dash',               'langebaan preekstoel',   2027::smallint, 'Langebaan Mad Dash',               DATE '2027-02-06', 'exact', true),
  ('langebaan around the island swim', 'langebaan the island',   2027::smallint, 'Langebaan Around the Island Swim', DATE '2027-02-07', 'exact', true),
  ('shipwrecked swim',                 'big bay bloubergstrand', 2027::smallint, 'Shipwrecked',                      DATE '2027-03-06', 'exact', true),
  ('chapmans peak meander',            'chapmans peak',          2027::smallint, 'Chapman''s Peak Meander',          DATE '2027-03-20', 'exact', true),
  ('roman rock swim challenge',        'roman rock simons town', 2027::smallint, 'The Roman Rock Premium Swim Challenge', DATE '2027-04-10', 'exact', true)
) AS e(series_canonical, venue_canonical, yr, title, start_date, precision, confirmed)
JOIN event_series es ON es.canonical_name = e.series_canonical
JOIN event_venues ev ON ev.canonical_name = e.venue_canonical
WHERE NOT EXISTS (
  SELECT 1 FROM event_editions x WHERE x.series_id = es.id AND x.edition_year = e.yr);

-- ── 5. Distances — only where a figure was actually supplied ──────────
INSERT INTO event_distances (edition_id, original_label, distance_metres, category)
SELECT ed.id, d.label, d.metres, d.category
FROM (VALUES
  ('spring equinox swim',           '800m',                 800,   'short'),
  ('spring equinox swim',           '1.6km',                1600,  'short'),
  ('spring equinox swim',           '3.2km',                3200,  'middle'),
  ('langebaan express',             '6km (to Pearly''s)',   6000,  'middle'),
  ('langebaan express',             '12km (to Mykonos)',    12000, 'long'),
  ('around the rocks extreme swim', '~2.5km (swell dependent)', 2500, 'short'),
  ('langebaan mad dash',            '6km (night swim)',     6000,  'middle'),
  ('langebaan mad dash',            '10km (night swim)',    10000, 'long'),
  ('shipwrecked swim',              '5km (Milnerton to Big Bay)', 5000, 'middle'),
  ('chapmans peak meander',         '800m',                 800,   'short'),
  ('chapmans peak meander',         '1.6km',                1600,  'short'),
  ('chapmans peak meander',         '5km',                  5000,  'middle'),
  ('langebaan around the island swim', '1.6km',             1600,  'short'),
  ('langebaan around the island swim', '3.2km',             3200,  'middle'),
  ('roman rock swim challenge',     '5.4km',                5400,  'middle')
) AS d(series_canonical, label, metres, category)
JOIN event_series es ON es.canonical_name = d.series_canonical
JOIN event_editions ed ON ed.series_id = es.id
WHERE NOT EXISTS (
  SELECT 1 FROM event_distances x WHERE x.edition_id = ed.id AND x.distance_metres = d.metres);

-- ── 6. Record the provenance in the change log ────────────────────────
-- source='organiser' is what distinguishes these from everything a crawler
-- produced. notification_required is false — nobody follows them yet, and a
-- newly listed event is not a change to an existing one.
INSERT INTO event_change_log (edition_id, field_name, old_value, new_value, change_type, notification_required, source)
SELECT ed.id, 'listing', NULL,
       'Added from the Big Bay Events 2026/27 calendar supplied by the organiser; dates, venues and distances confirmed by hand.',
       'other', false, 'organiser'
FROM event_editions ed
JOIN event_series es ON es.id = ed.series_id
JOIN event_organisers o ON o.id = es.organiser_id
WHERE o.canonical_name = 'big bay events'
  AND NOT EXISTS (SELECT 1 FROM event_change_log l WHERE l.edition_id = ed.id AND l.source = 'organiser');

COMMIT;

-- ----------------------------------------------------------------
-- ROLLBACK — exact SQL to undo. Order matters (children first).
-- ----------------------------------------------------------------
-- BEGIN;
-- DELETE FROM event_change_log WHERE edition_id IN (
--   SELECT ed.id FROM event_editions ed JOIN event_series es ON es.id=ed.series_id
--    JOIN event_organisers o ON o.id=es.organiser_id WHERE o.canonical_name='big bay events');
-- DELETE FROM event_distances WHERE edition_id IN (
--   SELECT ed.id FROM event_editions ed JOIN event_series es ON es.id=ed.series_id
--    JOIN event_organisers o ON o.id=es.organiser_id WHERE o.canonical_name='big bay events');
-- DELETE FROM event_editions WHERE series_id IN (
--   SELECT es.id FROM event_series es JOIN event_organisers o ON o.id=es.organiser_id
--    WHERE o.canonical_name='big bay events');
-- DELETE FROM event_series WHERE organiser_id = (SELECT id FROM event_organisers WHERE canonical_name='big bay events');
-- DELETE FROM event_venues WHERE canonical_name IN
--   ('langebaan preekstoel','langebaan the island','big bay bloubergstrand',
--    'robben island crossing','roman rock simons town','chapmans peak');
-- DELETE FROM event_organisers WHERE canonical_name='big bay events';
-- COMMIT;

-- ----------------------------------------------------------------
-- VERIFY — run on the READ-ONLY connection AFTER applying.
-- ----------------------------------------------------------------
-- 1. Nine editions, one organiser, nine series:
--      SELECT count(*) FROM event_editions ed JOIN event_series es ON es.id=ed.series_id
--        JOIN event_organisers o ON o.id=es.organiser_id WHERE o.canonical_name='big bay events';  -- 9
--
-- 2. South Africa goes from 7 upcoming to 16 (8 dated + the undated Freedom Swim,
--    which the NULL clause below counts):
--      SELECT count(*) FROM event_editions e JOIN event_venues v ON v.id=e.venue_id
--       WHERE v.country_code='ZA' AND (e.start_date IS NULL OR e.start_date >= current_date);
--
-- 3. Cape Town is no longer 1,220 km from its nearest swim:
--      SELECT title, round(distance_km) AS km FROM search_events_v2(
--        p_lat=>-33.9, p_lng=>18.4, p_radius_km=>150, p_sort=>'distance', p_page_size=>10);
--      -- expect Big Bay / Chapman's Peak / Roman Rock swims within ~40 km
--
-- 4. The Freedom Swim stored no date, as the schema requires:
--      SELECT title, start_date, date_confirmed, is_indexable FROM event_editions
--       WHERE title = '760 Freedom Swim';   -- expect NULL / false / false
--
-- 5. Every venue except Chapman's Peak has coordinates from its spot:
--      SELECT display_name, spot_id IS NOT NULL AS linked, latitude IS NOT NULL AS mapped
--        FROM event_venues WHERE canonical_name IN
--        ('langebaan preekstoel','langebaan the island','big bay bloubergstrand',
--         'robben island crossing','roman rock simons town','chapmans peak');
--
-- 6. Twelve distances, and none invented:
--      SELECT es.display_name, d.original_label, d.distance_metres
--        FROM event_distances d JOIN event_editions ed ON ed.id=d.edition_id
--        JOIN event_series es ON es.id=ed.series_id
--        JOIN event_organisers o ON o.id=es.organiser_id
--       WHERE o.canonical_name='big bay events' ORDER BY 1,3;
--
-- ----------------------------------------------------------------
-- FOLLOW-UPS
-- ----------------------------------------------------------------
-- a) Chapman's Peak has no spot, so it has no coordinates and no map pin.
--    Adding a spot and backfilling venue lat/lng fixes it.
-- b) "Liberty to Freedom Swim" may be the same race as "760 Freedom Swim".
--    Decide by hand and merge if so.
-- c) Ask Derrick for the Freedom Swim date once set, and its distance.
