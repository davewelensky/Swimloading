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
-- Migration: 2026-08-12_backfill-offer-distances.sql
-- Process:   see MIGRATIONS.md
-- ================================================================

-- Purpose:
--   Backfill the 14 entry distances that were extracted but never stored,
--   for 4 live editions that show no distances at all today. Produced by
--   scripts/backfill-distances.ts re-running the FIXED extractor over each
--   page's own bytes — no distance here was typed by hand or inferred.
--
--   Root cause: buildCandidateEvent read distances only from HTML
--   selectors, on the belief that "schema.org Event has no clean
--   multi-distance shape". True of the Event node, but its `offers` array
--   IS that shape — a registration platform emits one offer per entry
--   category, and for a swim the entry category is the distance. Fixed in
--   distanceOptionsFromOffers(); this migration repairs rows already
--   published before that fix.
--
--   Note on 'SWIM DISTANCE - MARATHON 20': distance_metres is deliberately
--   NULL. The page body says 20 km, but the offer name says only "20", and
--   the extractor only sees the offer. The label is recorded; the number is
--   left unknown rather than guessed at.

-- Requested by:
--   Dave, 2026-08-12 ("do 1 and 2" — fix the JSON-LD distance fallback and
--   backfill Caramoan), after asking why we had no Swimjunkie events in the
--   Philippines.

-- ----------------------------------------------------------------
-- PRE-CHECKS — run on the READ-ONLY connection BEFORE applying.
-- ----------------------------------------------------------------
-- Both must hold, or STOP and re-run the backfill script:
--
-- 1. All 4 target editions exist, are live, and have ZERO distances.
--    This is what makes the rollback below exact.
-- SELECT e.id, e.title, count(d.id) AS existing_distances
--   FROM event_editions e
--   LEFT JOIN public.event_distances d ON d.edition_id = e.id
--  WHERE e.id IN (
--    '2772f8e5-ed81-4455-9961-9319964a0656',  -- XTERRA Greece Open Water Swimming Challenge 2026
    '52e49ca8-fd4c-488e-a478-7b39700e51c9',  -- Swimjunkie Challenge: CARAMOAN 2026 Year10
    '806f386f-0b2f-4dae-ac06-0cca06b07f60',  -- Baltimore Wet Weekend 2K Sherkin Island Swim
    'e360c3d8-2300-48b7-a364-637a7408a755'   -- SWIM MIAMI 27
--  )
--  GROUP BY e.id, e.title;
-- expect: 4 rows, existing_distances = 0 for every one
--
-- 2. Nothing else changed underneath: total distance rows before.
-- SELECT count(*) FROM public.event_distances;   -- record this number

-- ----------------------------------------------------------------
-- BACKUP — not required: this migration is INSERT-only. It updates
-- nothing and deletes nothing. The rollback below is exact.
-- ----------------------------------------------------------------

-- ----------------------------------------------------------------
-- MIGRATION — applied only after Dave types "apply".
-- Each INSERT is guarded per (edition_id, original_label), so re-running
-- this file is a no-op rather than a duplicate.
-- ----------------------------------------------------------------
BEGIN;

INSERT INTO public.event_distances (edition_id, original_label, distance_metres, category, registration_url)
  SELECT '806f386f-0b2f-4dae-ac06-0cca06b07f60', 'Swim Sherkin Island Swim 2000m 26th Sept. - Individual Age group/open', 2000, NULL, 'https://www.active.com/baltimore-cork/water-sports/swimming/baltimore-wet-weekend-2k-sherkin-island-swim-2026'
  WHERE NOT EXISTS (SELECT 1 FROM public.event_distances x
                     WHERE x.edition_id = '806f386f-0b2f-4dae-ac06-0cca06b07f60' AND x.original_label = 'Swim Sherkin Island Swim 2000m 26th Sept. - Individual Age group/open');
INSERT INTO public.event_distances (edition_id, original_label, distance_metres, category, registration_url)
  SELECT '52e49ca8-fd4c-488e-a478-7b39700e51c9', 'SWIM DISTANCE - 2Km Swim', 2000, NULL, 'https://www.active.com/pili-camarinessur/water-sports/swimming-races/swimjunkie-challenge-caramoan-year10-2026'
  WHERE NOT EXISTS (SELECT 1 FROM public.event_distances x
                     WHERE x.edition_id = '52e49ca8-fd4c-488e-a478-7b39700e51c9' AND x.original_label = 'SWIM DISTANCE - 2Km Swim');
INSERT INTO public.event_distances (edition_id, original_label, distance_metres, category, registration_url)
  SELECT '52e49ca8-fd4c-488e-a478-7b39700e51c9', 'SWIM DISTANCE - 5KM Island Swim', 5000, NULL, 'https://www.active.com/pili-camarinessur/water-sports/swimming-races/swimjunkie-challenge-caramoan-year10-2026'
  WHERE NOT EXISTS (SELECT 1 FROM public.event_distances x
                     WHERE x.edition_id = '52e49ca8-fd4c-488e-a478-7b39700e51c9' AND x.original_label = 'SWIM DISTANCE - 5KM Island Swim');
INSERT INTO public.event_distances (edition_id, original_label, distance_metres, category, registration_url)
  SELECT '52e49ca8-fd4c-488e-a478-7b39700e51c9', 'SWIM DISTANCE - 10KM Island Swim', 10000, NULL, 'https://www.active.com/pili-camarinessur/water-sports/swimming-races/swimjunkie-challenge-caramoan-year10-2026'
  WHERE NOT EXISTS (SELECT 1 FROM public.event_distances x
                     WHERE x.edition_id = '52e49ca8-fd4c-488e-a478-7b39700e51c9' AND x.original_label = 'SWIM DISTANCE - 10KM Island Swim');
INSERT INTO public.event_distances (edition_id, original_label, distance_metres, category, registration_url)
  SELECT '52e49ca8-fd4c-488e-a478-7b39700e51c9', 'SWIM DISTANCE - 15Km Island Swim', 15000, NULL, 'https://www.active.com/pili-camarinessur/water-sports/swimming-races/swimjunkie-challenge-caramoan-year10-2026'
  WHERE NOT EXISTS (SELECT 1 FROM public.event_distances x
                     WHERE x.edition_id = '52e49ca8-fd4c-488e-a478-7b39700e51c9' AND x.original_label = 'SWIM DISTANCE - 15Km Island Swim');
INSERT INTO public.event_distances (edition_id, original_label, distance_metres, category, registration_url)
  SELECT '52e49ca8-fd4c-488e-a478-7b39700e51c9', 'SWIM DISTANCE - MARATHON 20', NULL, NULL, 'https://www.active.com/pili-camarinessur/water-sports/swimming-races/swimjunkie-challenge-caramoan-year10-2026'
  WHERE NOT EXISTS (SELECT 1 FROM public.event_distances x
                     WHERE x.edition_id = '52e49ca8-fd4c-488e-a478-7b39700e51c9' AND x.original_label = 'SWIM DISTANCE - MARATHON 20');
INSERT INTO public.event_distances (edition_id, original_label, distance_metres, category, registration_url)
  SELECT '2772f8e5-ed81-4455-9961-9319964a0656', 'Open water swim-10k - Individual Age group/open', 10000, NULL, 'https://www.active.com/voula-athens/water-sports/swimming-races/xterra-greece-open-water-swimming-challenge-2026'
  WHERE NOT EXISTS (SELECT 1 FROM public.event_distances x
                     WHERE x.edition_id = '2772f8e5-ed81-4455-9961-9319964a0656' AND x.original_label = 'Open water swim-10k - Individual Age group/open');
INSERT INTO public.event_distances (edition_id, original_label, distance_metres, category, registration_url)
  SELECT '2772f8e5-ed81-4455-9961-9319964a0656', 'Open water swim-5 km - Individual Age group/open', 5000, NULL, 'https://www.active.com/voula-athens/water-sports/swimming-races/xterra-greece-open-water-swimming-challenge-2026'
  WHERE NOT EXISTS (SELECT 1 FROM public.event_distances x
                     WHERE x.edition_id = '2772f8e5-ed81-4455-9961-9319964a0656' AND x.original_label = 'Open water swim-5 km - Individual Age group/open');
INSERT INTO public.event_distances (edition_id, original_label, distance_metres, category, registration_url)
  SELECT '2772f8e5-ed81-4455-9961-9319964a0656', 'Open water swim-2,5k - Individual Age group/open', 2500, NULL, 'https://www.active.com/voula-athens/water-sports/swimming-races/xterra-greece-open-water-swimming-challenge-2026'
  WHERE NOT EXISTS (SELECT 1 FROM public.event_distances x
                     WHERE x.edition_id = '2772f8e5-ed81-4455-9961-9319964a0656' AND x.original_label = 'Open water swim-2,5k - Individual Age group/open');
INSERT INTO public.event_distances (edition_id, original_label, distance_metres, category, registration_url)
  SELECT '2772f8e5-ed81-4455-9961-9319964a0656', 'Open water swim-1 km - Individual Age group/open', 1000, NULL, 'https://www.active.com/voula-athens/water-sports/swimming-races/xterra-greece-open-water-swimming-challenge-2026'
  WHERE NOT EXISTS (SELECT 1 FROM public.event_distances x
                     WHERE x.edition_id = '2772f8e5-ed81-4455-9961-9319964a0656' AND x.original_label = 'Open water swim-1 km - Individual Age group/open');
INSERT INTO public.event_distances (edition_id, original_label, distance_metres, category, registration_url)
  SELECT '2772f8e5-ed81-4455-9961-9319964a0656', 'Open water swim-0,2k super sprint - Individual Age group/open', 200, NULL, 'https://www.active.com/voula-athens/water-sports/swimming-races/xterra-greece-open-water-swimming-challenge-2026'
  WHERE NOT EXISTS (SELECT 1 FROM public.event_distances x
                     WHERE x.edition_id = '2772f8e5-ed81-4455-9961-9319964a0656' AND x.original_label = 'Open water swim-0,2k super sprint - Individual Age group/open');
INSERT INTO public.event_distances (edition_id, original_label, distance_metres, category, registration_url)
  SELECT 'e360c3d8-2300-48b7-a364-637a7408a755', 'The Corporate 800 Meter Swim - The Corporate 800 Meter Swim', 800, NULL, 'https://www.active.com/miami-fl/water-sports/swimming-races/swim-miami-27-2027'
  WHERE NOT EXISTS (SELECT 1 FROM public.event_distances x
                     WHERE x.edition_id = 'e360c3d8-2300-48b7-a364-637a7408a755' AND x.original_label = 'The Corporate 800 Meter Swim - The Corporate 800 Meter Swim');
INSERT INTO public.event_distances (edition_id, original_label, distance_metres, category, registration_url)
  SELECT 'e360c3d8-2300-48b7-a364-637a7408a755', 'The 5km Swim - The 5km Swim', 5000, NULL, 'https://www.active.com/miami-fl/water-sports/swimming-races/swim-miami-27-2027'
  WHERE NOT EXISTS (SELECT 1 FROM public.event_distances x
                     WHERE x.edition_id = 'e360c3d8-2300-48b7-a364-637a7408a755' AND x.original_label = 'The 5km Swim - The 5km Swim');
INSERT INTO public.event_distances (edition_id, original_label, distance_metres, category, registration_url)
  SELECT 'e360c3d8-2300-48b7-a364-637a7408a755', 'The 10km Swim - The 10km Swim', 10000, NULL, 'https://www.active.com/miami-fl/water-sports/swimming-races/swim-miami-27-2027'
  WHERE NOT EXISTS (SELECT 1 FROM public.event_distances x
                     WHERE x.edition_id = 'e360c3d8-2300-48b7-a364-637a7408a755' AND x.original_label = 'The 10km Swim - The 10km Swim');

COMMIT;

-- ----------------------------------------------------------------
-- ROLLBACK
-- Exact: all 4 editions had zero distance rows before this migration
-- (asserted in pre-check 1), so removing every row for them restores the
-- prior state precisely.
-- ----------------------------------------------------------------
-- DELETE FROM public.event_distances
--  WHERE edition_id IN (
--    '2772f8e5-ed81-4455-9961-9319964a0656',  -- XTERRA Greece Open Water Swimming Challenge 2026
    '52e49ca8-fd4c-488e-a478-7b39700e51c9',  -- Swimjunkie Challenge: CARAMOAN 2026 Year10
    '806f386f-0b2f-4dae-ac06-0cca06b07f60',  -- Baltimore Wet Weekend 2K Sherkin Island Swim
    'e360c3d8-2300-48b7-a364-637a7408a755'   -- SWIM MIAMI 27
--  );

-- ----------------------------------------------------------------
-- VERIFY — run on the READ-ONLY connection AFTER applying.
-- ----------------------------------------------------------------
-- SELECT e.title, d.distance_metres, d.original_label
--   FROM public.event_distances d
--   JOIN event_editions e ON e.id = d.edition_id
--  WHERE d.edition_id IN (
--    '2772f8e5-ed81-4455-9961-9319964a0656',  -- XTERRA Greece Open Water Swimming Challenge 2026
    '52e49ca8-fd4c-488e-a478-7b39700e51c9',  -- Swimjunkie Challenge: CARAMOAN 2026 Year10
    '806f386f-0b2f-4dae-ac06-0cca06b07f60',  -- Baltimore Wet Weekend 2K Sherkin Island Swim
    'e360c3d8-2300-48b7-a364-637a7408a755'   -- SWIM MIAMI 27
--  )
--  ORDER BY e.title, d.distance_metres NULLS LAST;
-- expect: 14 rows.
--   Caramoan   -> 2000, 5000, 10000, 15000, NULL (MARATHON 20)
--   XTERRA     -> 200, 1000, 2500, 5000, 10000
--   Swim Miami -> 800, 5000, 10000
--   Baltimore  -> 2000
--
-- SELECT count(*) FROM public.event_distances;
-- expect: pre-check 2's number + 14
--
-- Explore-visible editions still lacking any distance should fall 118 -> 114:
-- SELECT count(*) FROM event_editions e
--  WHERE e.is_searchable AND e.start_date >= current_date
--    AND e.status <> 'cancelled' AND e.discipline = 'open_water'
--    AND NOT EXISTS (SELECT 1 FROM public.event_distances d WHERE d.edition_id = e.id);
-- expect: 114
