-- ================================================================
-- SwimLoading — Migration Template
-- ================================================================

-- ⚠️  SAFETY CHECK — runs first, aborts everything if wrong project
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM _project_identity
    WHERE key = 'project_name' AND value = 'swimloading'
  ) THEN
    RAISE EXCEPTION 'WRONG PROJECT — MIGRATION ABORTED (expected swimloading / szgkzuswelntnevobnoh)'
    USING HINT = 'Check the project ref in your Supabase dashboard URL';
  END IF;
  RAISE NOTICE '✅ Project identity confirmed: swimloading (szgkzuswelntnevobnoh)';
END $$;

-- ================================================================
-- Migration: 2026-08-14_crossing-fact-corrections.sql
-- ================================================================

-- Purpose:
--   Increment 4, phase 1. Independent verification of the crossing pages
--   Google actually ranks (Tsugaru, Catalina, Cook Strait) found four
--   wrong records, a geographically impossible route, and one statistic
--   that only ever existed on our own page. Also adds the distance and
--   country columns the search-intent work needs, and backfills
--   country_code from each crossing's OWN already-validated `connects`
--   text (derivation, not invention).
--
--   THE BIG ONES:
--   * Cook Strait's stated route had BOTH endpoints on the North Island
--     (Turakirae Head is a North Island promontory, not South Island).
--   * Cook Strait record was "7h 20m, Philip Rush, 1988" — no source
--     supports this. Rush's eight Cook Strait swims ran 7h51m–9h32m; his
--     1988 swim was a DOUBLE crossing in 18h37m. Real record: 4h 33m 50s,
--     Andy Donaldson, 7 Mar 2023 (NZOWSA-sanctioned, Guinness-ratified).
--   * Catalina record was "7h 11m, Forrest Nelson, 2021" — wrong name,
--     time and year. CCSF's own records page: fastest solo 7h 15m 55s
--     (Penny Lee Dean, 1976); fastest in the usual Catalina→mainland
--     direction 7h 27m 25s (Grace van der Byl, 2012). Nelson holds the
--     men's DOUBLE crossing, 23h 01m 06s (2010).
--   * Tsugaru record was "7h 6m" — no source found. Guinness: 6h 11m 17s,
--     Steven Munatones, 29 Jul 1990.
--   * Catalina "completion rate roughly 65–70%" — REMOVED. CCSF publishes
--     no success rate and every search hit for that figure traced back to
--     swimloading's own page. A number we invented was being cited as if
--     external.
--
--   Sources: CCSF swimcatalina.org (records/basic-swim-information),
--   NZOWSA nzowsa.nz, Guinness World Records (Tsugaru male/female, Cook
--   Strait), WOWSA openwaterswimming.com Tsugaru aspirant briefings,
--   Openwaterpedia, Wikipedia Cook Strait, NZ Herald (Glyn Eason 2023).

-- Requested by:
--   Dave (Increment 4, phase 1 — remaining fact validation)

-- ----------------------------------------------------------------
-- PRE-CHECKS — run on the READ-ONLY connection BEFORE applying.
-- ----------------------------------------------------------------
-- Expect 3 rows carrying the wrong records:
-- SELECT slug, key_facts->3->>'note' FROM public.crossings
--  WHERE slug IN ('cook-strait','catalina-channel','tsugaru-strait');
-- Expect 8 (crossings still missing a country):
-- SELECT count(*) FROM public.crossings WHERE intro IS NOT NULL AND country_code IS NULL;
-- Expect 1 (the invented completion rate):
-- SELECT count(*) FROM public.crossings WHERE key_facts::text LIKE '%65–70%';

-- ----------------------------------------------------------------
-- BACKUP — required: this UPDATEs existing validated content.
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS _bak_20260814d_crossings AS SELECT * FROM public.crossings;

-- ----------------------------------------------------------------
-- MIGRATION — applied only after Dave types "apply".
-- ----------------------------------------------------------------
BEGIN;

-- ── new columns for distance semantics ──────────────────────────────────
-- A crossing page ranks for "<name> swim distance". Answering that well
-- means saying WHICH distance: the recognised point-to-point, or the
-- longer track a swimmer actually covers once the tide has its say. One
-- number labelled "Distance" cannot carry both meanings honestly.
ALTER TABLE public.crossings
  ADD COLUMN IF NOT EXISTS distance_label text,
  ADD COLUMN IF NOT EXISTS distance_swum_text text,
  ADD COLUMN IF NOT EXISTS anchor_lat numeric,
  ADD COLUMN IF NOT EXISTS anchor_lng numeric;

COMMENT ON COLUMN public.crossings.distance_label     IS 'What distance_km MEANS for this crossing: recognised course, straight line, circumnavigation';
COMMENT ON COLUMN public.crossings.distance_swum_text IS 'Validated typical ACTUAL swum distance where a trustworthy figure exists; NULL where none does — never estimated';
COMMENT ON COLUMN public.crossings.anchor_lat         IS 'Geographic anchor for nearby-content queries, derived from a spot we already hold that the crossing names as an endpoint';
COMMENT ON COLUMN public.crossings.anchor_lng         IS 'See anchor_lat';

-- ── country_code, derived from each crossing''s own validated `connects` ──
-- Not invention: `connects` was human-validated in increment 2 and already
-- names the country ("Japan — Honshu ↔ Hokkaido"). country_code stays the
-- sovereign country, per the increment 2 rule.
UPDATE public.crossings SET country_code = 'US' WHERE slug = 'catalina-channel' AND country_code IS NULL;  -- "Catalina Island ↔ California"
UPDATE public.crossings SET country_code = 'NZ' WHERE slug = 'cook-strait'      AND country_code IS NULL;  -- "New Zealand — North ↔ South Island"
UPDATE public.crossings SET country_code = 'ZA' WHERE slug = 'false-bay'        AND country_code IS NULL;  -- "South Africa — Simon's Town ↔ Gordon's Bay"
UPDATE public.crossings SET country_code = 'US' WHERE slug = 'manhattan-island' AND country_code IS NULL;  -- "Manhattan Island circumnavigation, New York"
UPDATE public.crossings SET country_code = 'US' WHERE slug = 'molokai-channel'  AND country_code IS NULL;  -- "Molokai ↔ Oahu, Hawaii"
UPDATE public.crossings SET country_code = 'GB' WHERE slug = 'north-channel'    AND country_code IS NULL;  -- "Northern Ireland ↔ Scotland"
UPDATE public.crossings SET country_code = 'AU' WHERE slug = 'rottnest-channel' AND country_code IS NULL;  -- "Cottesloe ↔ Rottnest Island, Western Australia"
UPDATE public.crossings SET country_code = 'JP' WHERE slug = 'tsugaru-strait'   AND country_code IS NULL;  -- "Japan — Honshu ↔ Hokkaido"

-- ── anchors, derived from spots we already hold ─────────────────────────
-- Only where the crossing NAMES a spot in our own table. Two qualify
-- today; the rest fall back to country-level relevance rather than being
-- given coordinates nobody verified.
UPDATE public.crossings c SET anchor_lat = s.latitude, anchor_lng = s.longitude
  FROM public.spots s WHERE c.slug = 'false-bay'        AND s.name = 'Millers Point'   AND s.active;
UPDATE public.crossings c SET anchor_lat = s.latitude, anchor_lng = s.longitude
  FROM public.spots s WHERE c.slug = 'rottnest-channel' AND s.name = 'Cottesloe Beach' AND s.active;

-- ── distance semantics for every content-bearing crossing ───────────────
UPDATE public.crossings SET distance_label = 'Recognised crossing distance' WHERE intro IS NOT NULL;
UPDATE public.crossings SET distance_label = 'Course distance'         WHERE slug = 'rottnest-channel';  -- measured, consistent annual course
UPDATE public.crossings SET distance_label = 'Circumnavigation distance' WHERE slug = 'manhattan-island';
UPDATE public.crossings SET distance_label = 'Approximate straight-line distance' WHERE slug IN ('north-channel','cook-strait','strait-of-gibraltar');

-- Actual-swum figures, ONLY where a source states one. Tsugaru and
-- Catalina are deliberately left NULL: the only Tsugaru numbers come from
-- FAILED swims pushed off course, and CCSF states "additional miles" with
-- no figure. A template that wants a value does not justify inventing one.
UPDATE public.crossings SET distance_swum_text = '38–45 km' WHERE slug = 'north-channel';
UPDATE public.crossings SET distance_swum_text = '20–25 km' WHERE slug = 'strait-of-gibraltar';
UPDATE public.crossings SET distance_swum_text = '25–30 km' WHERE slug = 'cook-strait';

-- ── COOK STRAIT — route, record, distance, temperature, governing body ──
UPDATE public.crossings SET
  distance_km = 22,
  start_location = 'Ohau Bay / Cape Terawhiti, North Island',
  end_location   = 'Perano Head, Arapaoa Island, Marlborough Sounds, South Island',
  typical_temp_min_c = 14, typical_temp_max_c = 17,
  season_end_month = 4,
  governing_body = 'NZOWSA',
  key_facts = '[
    {"label":"Distance","val":"22 km","note":"Straight-line width at the narrowest point, between Cape Terawhiti on the North Island and Perano Head on Arapaoa Island. Cross-currents mean swimmers typically cover 25–30 km or more; the strait is swum in both directions."},
    {"label":"Water Temperature","val":"14–17°C","note":"Typical range through the January–April swim season. The Southland Current brings cool sub-Antarctic water into the strait, and conditions vary sharply between the two approaches."},
    {"label":"Swim Season","val":"Jan – Apr","note":"Southern hemisphere summer and early autumn. Even within this period swims are highly weather-dependent — days-long waits for a suitable window are common."},
    {"label":"Record","val":"4h 33m 50s","note":"Andy Donaldson (Australia), 7 March 2023, South Island to North Island — NZOWSA-sanctioned and Guinness-ratified. Previous record: Casey Glover, 4h 37m, 2008. Women''s: Denise Anderson, 5h 04m, 1986. Most crossings take 8–14 hours."},
    {"label":"Governing Body","val":"NZOWSA","note":"The New Zealand Open Water Swimming Association ratifies crossings and maintains the official record list. Solo attempts are managed and escorted by Cook Strait Swim, Philip Rush''s operation."},
    {"label":"Difficulty","val":"Extreme","note":"One of the Oceans Seven and among the most weather-affected crossings in the world. The low success rate is primarily due to weather aborts, not swimmer fitness."}
  ]'::jsonb,
  intro = 'The treacherous stretch of water separating New Zealand''s North and South Islands is one of the most unpredictable crossings on earth. Cold water, violent tidal currents, and weather that can change within minutes make Cook Strait one of the hardest Oceans Seven swims.',
  seo_description = 'Complete guide to swimming Cook Strait — 22 km between New Zealand''s North and South Islands, with swimmers typically covering 25–30 km. One of the Oceans Seven, 14–17°C, powerful tidal currents.',
  updated_at = now()
WHERE slug = 'cook-strait';

-- ── CATALINA CHANNEL — distance, record, temperature, season ────────────
UPDATE public.crossings SET
  distance_km = 32.3,
  typical_temp_max_c = 22,
  season_end_month = 9,
  key_facts = '[
    {"label":"Distance","val":"32.3 km (20.2 miles)","note":"Catalina Island to the Palos Verdes / Los Angeles mainland. The Catalina Channel Swimming Federation defines no fixed start and finish, describing the channel as a little over 20 miles at its shortest. Currents add distance, though no typical figure is published."},
    {"label":"Water Temperature","val":"14–22°C","note":"The CCSF gives 58–72°F. Coldest in early season; warmest August–September. Thermocline upwelling can drop temperatures suddenly mid-crossing."},
    {"label":"Swim Season","val":"Jun – Sep","note":"The CCSF season runs June to September, though October crossings do happen. Most attempts start between midnight and 3am to time the currents."},
    {"label":"Record","val":"7h 15m 55s","note":"Penny Lee Dean, 1 September 1976 (mainland to Catalina) — the fastest solo in either direction. In the usual Catalina-to-mainland direction the record is 7h 27m 25s (Grace van der Byl, 2012). Forrest Nelson holds the men''s double crossing at 23h 01m 06s. Most swimmers finish in 11–14 hours."},
    {"label":"Governing Body","val":"CCSF","note":"Catalina Channel Swimming Federation, operating since 1981. All official attempts must be sanctioned and use an approved observer."},
    {"label":"Difficulty","val":"Very Hard","note":"Part of the Triple Crown alongside the English Channel and the Manhattan Island swim. About 93% of crossings are swum island-to-mainland."}
  ]'::jsonb,
  intro = 'One of the original marathon swims and a member of the Triple Crown of Open Water Swimming. The 32.3 km crossing from Catalina Island to the California mainland demands cold water tolerance, shark awareness, and relentless mental fortitude.',
  seo_description = 'Complete guide to swimming the Catalina Channel — 32.3 km (20.2 miles) from Catalina Island to the California mainland. Water temps, season, hazards, and readiness checker.',
  updated_at = now()
WHERE slug = 'catalina-channel';

-- ── TSUGARU STRAIT — record, season, course definition, governing body ──
UPDATE public.crossings SET
  season_start_month = 6, season_end_month = 9,
  key_facts = '[
    {"label":"Distance","val":"19.5 km","note":"Shortest point-to-point, Tappi Misaki on Honshu to Shirakami Misaki on Hokkaido. No unified course definition exists: many Oceans Seven swimmers start further west at Kodomari, a straight line of roughly 30 km, so quoted distances differ by route rather than by measurement."},
    {"label":"Water Temperature","val":"15–20°C","note":"Warmest in July and August. Cold upwelling from the Tsugaru Current can drop the temperature sharply and without warning mid-crossing — the real cold risk here is sudden, not constant."},
    {"label":"Swim Season","val":"Jun – Sep","note":"Swims are held between late June and the end of September, with July and August the recommended months. Outside this, typhoon season and severe currents make the crossing impractical."},
    {"label":"Record","val":"6h 11m 17s","note":"Steven Munatones (USA), 29 July 1990, Cape Tappi to Cape Shirakami — Guinness-ratified. Women''s: 6h 20m 52s, Nora Toledano Cadena and Mariel Hawley Dávila, 2018. Most swimmers take 7–12 hours, against a 14-hour allowance."},
    {"label":"Governing Body","val":"TSSA","note":"The Tsugaru Strait Swimming Association currently sanctions crossings. The earlier Tsugaru Channel Swimming Association, run through Ocean Navi, ceased international operations in 2023."},
    {"label":"Difficulty","val":"Very Hard","note":"One of the Oceans Seven. The difficulty is not the distance but the current variability, the cold upwelling, and the logistical complexity of arranging a sanctioned attempt."}
  ]'::jsonb,
  updated_at = now()
WHERE slug = 'tsugaru-strait';

COMMIT;

-- ----------------------------------------------------------------
-- ROLLBACK
-- ----------------------------------------------------------------
-- BEGIN;
-- UPDATE public.crossings c SET
--   key_facts = b.key_facts, intro = b.intro, seo_description = b.seo_description,
--   distance_km = b.distance_km, start_location = b.start_location, end_location = b.end_location,
--   typical_temp_min_c = b.typical_temp_min_c, typical_temp_max_c = b.typical_temp_max_c,
--   season_start_month = b.season_start_month, season_end_month = b.season_end_month,
--   governing_body = b.governing_body, country_code = b.country_code
--   FROM _bak_20260814d_crossings b WHERE b.slug = c.slug;
-- ALTER TABLE public.crossings
--   DROP COLUMN IF EXISTS distance_label, DROP COLUMN IF EXISTS distance_swum_text,
--   DROP COLUMN IF EXISTS anchor_lat, DROP COLUMN IF EXISTS anchor_lng;
-- COMMIT;

-- ----------------------------------------------------------------
-- VERIFY — read-only, after applying.
-- ----------------------------------------------------------------
-- Expect 0 (the invented completion rate and the wrong records are gone):
-- SELECT count(*) FROM public.crossings
--  WHERE key_facts::text LIKE '%65–70%' OR key_facts::text LIKE '%Forrest Nelson, 2021%';
-- Expect 10 with a country and a distance label:
-- SELECT count(*) FROM public.crossings WHERE intro IS NOT NULL AND country_code IS NOT NULL AND distance_label IS NOT NULL;
-- Expect 2 anchored (false-bay, rottnest-channel):
-- SELECT slug, anchor_lat, anchor_lng FROM public.crossings WHERE anchor_lat IS NOT NULL;
-- Expect Cook Strait endpoints on DIFFERENT islands:
-- SELECT start_location, end_location, distance_km FROM public.crossings WHERE slug='cook-strait';
