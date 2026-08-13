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
-- Migration: 2026-08-13_backfill-page-text-distances.sql
-- Process:   see MIGRATIONS.md
-- ================================================================

-- Purpose:
--   58 distance rows across 19 live editions that state their distances in
--   the page's own headings and nowhere else. Produced by
--   scripts/backfill-distances.ts running the REAL extraction pipeline
--   (processPage) over each page's own bytes — nothing here was typed.
--
--   These events had no distances because we only ever read JSON-LD and
--   fixed CSS selectors on an event page. oceanswims.com prints "8km" and
--   "400m, 800m & 2km" as headings, with JSON-LD offers that say only
--   "General Admission". distancesFromTextLines now reads those headings,
--   gated to pages describing exactly ONE event and to lines that are a
--   distance and nothing else.
--
--   ALSO fixes one title the dedupe migration earlier today missed: the
--   Bluff to Bar survivor got the clean slug but kept the raw page title.
--
--   REVIEWED, not assumed. Every set was checked against what the page
--   states — Newport's "400m, 800m & 2km", Magnetic Island's 8km,
--   Christiansborg Rundt's 1/2/10km. Aguas Abiertas Catemaco returns eight
--   distances up to 21 km, which looked like a running half-marathon
--   bleeding in; the page was fetched and inspected directly and prints
--   "1 km / 1.3 km / 3 km / 5 km / 7 km / 10 km / 16 km / 21 km" as
--   standalone lines. It is a genuine open-water ladder.

-- Requested by:
--   Dave, 2026-08-13 — "fix the ai_fallback distances". The AI path turned
--   out not to be at fault (the listing pages do not state distances); this
--   reads them from the per-event pages instead.

-- ----------------------------------------------------------------
-- PRE-CHECKS — run on the READ-ONLY connection BEFORE applying.
-- ----------------------------------------------------------------
-- SELECT count(*) FROM public.event_distances;   -- record this number
--
-- All 19 target editions are live and have NO distances today:
-- SELECT count(DISTINCT edition_id) FROM (VALUES
--   ('12bb92db-1213-428e-9f37-aefd38a8a9f4'::uuid)) v(edition_id);  -- see the INSERTs below for the full set
-- SELECT count(*) FROM event_editions e
--  WHERE e.is_searchable AND e.id IN (SELECT DISTINCT edition_id FROM public.event_distances) ;
--
-- Simplest form — expect 0 rows for every edition named below:
-- SELECT d.edition_id, count(*) FROM public.event_distances d
--  WHERE d.edition_id IN (
--    '12bb92db-1213-428e-9f37-aefd38a8a9f4','47395c49-eae9-41d1-9a7b-f5e7f6275323',
--    'd6a99991-8f33-4901-a574-6f32083c0b14','e6ce50c7-03d2-4301-9a85-6734c59432d1',
--    'c9b2f99b-ea90-455b-b089-a1dde93a120b','296e80af-f083-4ba7-9df6-56d3c118cc4c',
--    '7b8405eb-43d4-40df-b711-76e679e3c543','7a6e90eb-f0f4-4c47-b65d-87666b41c6ff',
--    '436396e0-3e97-4295-8144-7d341b37b1a9','57a05d6a-1266-458b-8e26-ca6807a841d3',
--    '39881277-a7cf-4efd-a555-852e7dc3d629','450640a8-3846-490d-ab10-9cf00cbbd916',
--    '28f442bf-f9c0-45d2-a079-0b79f9233727','357b98b2-d30c-4769-b9b2-6b0576976f50',
--    '9bf2aed9-f795-49a9-8f73-82bd7fbc124d')
--  GROUP BY 1;
-- expect: no rows

-- ----------------------------------------------------------------
-- BACKUP — not required for the INSERTs (they add rows only). The single
-- UPDATE below is backed up.
-- ----------------------------------------------------------------
-- CREATE TABLE _bak_20260813_bluff_title AS
--   SELECT id, title FROM event_editions WHERE id = '357b98b2-d30c-4769-b9b2-6b0576976f50';

-- ----------------------------------------------------------------
-- MIGRATION — applied only after Dave types "apply".
-- Each INSERT is guarded per (edition, label, metres), so re-running is a
-- no-op. NOTE: the guard was wrong twice before review caught it —
-- per-edition and then per-label both silently dropped sibling rows when
-- one heading states several distances ("500m, 3km & 5km").
-- ----------------------------------------------------------------
BEGIN;

-- The title the dedupe migration left behind: slug was fixed, title was not.
UPDATE event_editions
   SET title = 'Bluff to Bar'
 WHERE id = '357b98b2-d30c-4769-b9b2-6b0576976f50'
   AND title = 'Bluff to Bar – Ocean Swim in Alex Surf Club | oceanswims.com';

INSERT INTO public.event_distances (edition_id, original_label, distance_metres, category, registration_url)
  SELECT '12bb92db-1213-428e-9f37-aefd38a8a9f4', '500m, 3km & 5km', 500, NULL, NULL
  WHERE NOT EXISTS (SELECT 1 FROM public.event_distances x
                     WHERE x.edition_id = '12bb92db-1213-428e-9f37-aefd38a8a9f4' AND x.original_label = '500m, 3km & 5km'
                       AND x.distance_metres IS NOT DISTINCT FROM 500);
INSERT INTO public.event_distances (edition_id, original_label, distance_metres, category, registration_url)
  SELECT '12bb92db-1213-428e-9f37-aefd38a8a9f4', '500m, 3km & 5km', 3000, NULL, NULL
  WHERE NOT EXISTS (SELECT 1 FROM public.event_distances x
                     WHERE x.edition_id = '12bb92db-1213-428e-9f37-aefd38a8a9f4' AND x.original_label = '500m, 3km & 5km'
                       AND x.distance_metres IS NOT DISTINCT FROM 3000);
INSERT INTO public.event_distances (edition_id, original_label, distance_metres, category, registration_url)
  SELECT '12bb92db-1213-428e-9f37-aefd38a8a9f4', '500m, 3km & 5km', 5000, NULL, NULL
  WHERE NOT EXISTS (SELECT 1 FROM public.event_distances x
                     WHERE x.edition_id = '12bb92db-1213-428e-9f37-aefd38a8a9f4' AND x.original_label = '500m, 3km & 5km'
                       AND x.distance_metres IS NOT DISTINCT FROM 5000);
INSERT INTO public.event_distances (edition_id, original_label, distance_metres, category, registration_url)
  SELECT '47395c49-eae9-41d1-9a7b-f5e7f6275323', '200m, 300m, 600m, 1.2km & 2.5km', 200, NULL, NULL
  WHERE NOT EXISTS (SELECT 1 FROM public.event_distances x
                     WHERE x.edition_id = '47395c49-eae9-41d1-9a7b-f5e7f6275323' AND x.original_label = '200m, 300m, 600m, 1.2km & 2.5km'
                       AND x.distance_metres IS NOT DISTINCT FROM 200);
INSERT INTO public.event_distances (edition_id, original_label, distance_metres, category, registration_url)
  SELECT '47395c49-eae9-41d1-9a7b-f5e7f6275323', '200m, 300m, 600m, 1.2km & 2.5km', 300, NULL, NULL
  WHERE NOT EXISTS (SELECT 1 FROM public.event_distances x
                     WHERE x.edition_id = '47395c49-eae9-41d1-9a7b-f5e7f6275323' AND x.original_label = '200m, 300m, 600m, 1.2km & 2.5km'
                       AND x.distance_metres IS NOT DISTINCT FROM 300);
INSERT INTO public.event_distances (edition_id, original_label, distance_metres, category, registration_url)
  SELECT '47395c49-eae9-41d1-9a7b-f5e7f6275323', '200m, 300m, 600m, 1.2km & 2.5km', 600, NULL, NULL
  WHERE NOT EXISTS (SELECT 1 FROM public.event_distances x
                     WHERE x.edition_id = '47395c49-eae9-41d1-9a7b-f5e7f6275323' AND x.original_label = '200m, 300m, 600m, 1.2km & 2.5km'
                       AND x.distance_metres IS NOT DISTINCT FROM 600);
INSERT INTO public.event_distances (edition_id, original_label, distance_metres, category, registration_url)
  SELECT '47395c49-eae9-41d1-9a7b-f5e7f6275323', '200m, 300m, 600m, 1.2km & 2.5km', 1200, NULL, NULL
  WHERE NOT EXISTS (SELECT 1 FROM public.event_distances x
                     WHERE x.edition_id = '47395c49-eae9-41d1-9a7b-f5e7f6275323' AND x.original_label = '200m, 300m, 600m, 1.2km & 2.5km'
                       AND x.distance_metres IS NOT DISTINCT FROM 1200);
INSERT INTO public.event_distances (edition_id, original_label, distance_metres, category, registration_url)
  SELECT '47395c49-eae9-41d1-9a7b-f5e7f6275323', '200m, 300m, 600m, 1.2km & 2.5km', 2500, NULL, NULL
  WHERE NOT EXISTS (SELECT 1 FROM public.event_distances x
                     WHERE x.edition_id = '47395c49-eae9-41d1-9a7b-f5e7f6275323' AND x.original_label = '200m, 300m, 600m, 1.2km & 2.5km'
                       AND x.distance_metres IS NOT DISTINCT FROM 2500);
INSERT INTO public.event_distances (edition_id, original_label, distance_metres, category, registration_url)
  SELECT 'd6a99991-8f33-4901-a574-6f32083c0b14', '800m, 1km & 2.4km', 800, NULL, NULL
  WHERE NOT EXISTS (SELECT 1 FROM public.event_distances x
                     WHERE x.edition_id = 'd6a99991-8f33-4901-a574-6f32083c0b14' AND x.original_label = '800m, 1km & 2.4km'
                       AND x.distance_metres IS NOT DISTINCT FROM 800);
INSERT INTO public.event_distances (edition_id, original_label, distance_metres, category, registration_url)
  SELECT 'd6a99991-8f33-4901-a574-6f32083c0b14', '800m, 1km & 2.4km', 1000, NULL, NULL
  WHERE NOT EXISTS (SELECT 1 FROM public.event_distances x
                     WHERE x.edition_id = 'd6a99991-8f33-4901-a574-6f32083c0b14' AND x.original_label = '800m, 1km & 2.4km'
                       AND x.distance_metres IS NOT DISTINCT FROM 1000);
INSERT INTO public.event_distances (edition_id, original_label, distance_metres, category, registration_url)
  SELECT 'd6a99991-8f33-4901-a574-6f32083c0b14', '800m, 1km & 2.4km', 2400, NULL, NULL
  WHERE NOT EXISTS (SELECT 1 FROM public.event_distances x
                     WHERE x.edition_id = 'd6a99991-8f33-4901-a574-6f32083c0b14' AND x.original_label = '800m, 1km & 2.4km'
                       AND x.distance_metres IS NOT DISTINCT FROM 2400);
INSERT INTO public.event_distances (edition_id, original_label, distance_metres, category, registration_url)
  SELECT 'e6ce50c7-03d2-4301-9a85-6734c59432d1', '300m, 800m & 1.5km', 300, NULL, NULL
  WHERE NOT EXISTS (SELECT 1 FROM public.event_distances x
                     WHERE x.edition_id = 'e6ce50c7-03d2-4301-9a85-6734c59432d1' AND x.original_label = '300m, 800m & 1.5km'
                       AND x.distance_metres IS NOT DISTINCT FROM 300);
INSERT INTO public.event_distances (edition_id, original_label, distance_metres, category, registration_url)
  SELECT 'e6ce50c7-03d2-4301-9a85-6734c59432d1', '300m, 800m & 1.5km', 800, NULL, NULL
  WHERE NOT EXISTS (SELECT 1 FROM public.event_distances x
                     WHERE x.edition_id = 'e6ce50c7-03d2-4301-9a85-6734c59432d1' AND x.original_label = '300m, 800m & 1.5km'
                       AND x.distance_metres IS NOT DISTINCT FROM 800);
INSERT INTO public.event_distances (edition_id, original_label, distance_metres, category, registration_url)
  SELECT 'e6ce50c7-03d2-4301-9a85-6734c59432d1', '300m, 800m & 1.5km', 1500, NULL, NULL
  WHERE NOT EXISTS (SELECT 1 FROM public.event_distances x
                     WHERE x.edition_id = 'e6ce50c7-03d2-4301-9a85-6734c59432d1' AND x.original_label = '300m, 800m & 1.5km'
                       AND x.distance_metres IS NOT DISTINCT FROM 1500);
INSERT INTO public.event_distances (edition_id, original_label, distance_metres, category, registration_url)
  SELECT 'c9b2f99b-ea90-455b-b089-a1dde93a120b', '8km', 8000, NULL, NULL
  WHERE NOT EXISTS (SELECT 1 FROM public.event_distances x
                     WHERE x.edition_id = 'c9b2f99b-ea90-455b-b089-a1dde93a120b' AND x.original_label = '8km'
                       AND x.distance_metres IS NOT DISTINCT FROM 8000);
INSERT INTO public.event_distances (edition_id, original_label, distance_metres, category, registration_url)
  SELECT '296e80af-f083-4ba7-9df6-56d3c118cc4c', '400m, 1.2km & 2.5km', 400, NULL, NULL
  WHERE NOT EXISTS (SELECT 1 FROM public.event_distances x
                     WHERE x.edition_id = '296e80af-f083-4ba7-9df6-56d3c118cc4c' AND x.original_label = '400m, 1.2km & 2.5km'
                       AND x.distance_metres IS NOT DISTINCT FROM 400);
INSERT INTO public.event_distances (edition_id, original_label, distance_metres, category, registration_url)
  SELECT '296e80af-f083-4ba7-9df6-56d3c118cc4c', '400m, 1.2km & 2.5km', 1200, NULL, NULL
  WHERE NOT EXISTS (SELECT 1 FROM public.event_distances x
                     WHERE x.edition_id = '296e80af-f083-4ba7-9df6-56d3c118cc4c' AND x.original_label = '400m, 1.2km & 2.5km'
                       AND x.distance_metres IS NOT DISTINCT FROM 1200);
INSERT INTO public.event_distances (edition_id, original_label, distance_metres, category, registration_url)
  SELECT '296e80af-f083-4ba7-9df6-56d3c118cc4c', '400m, 1.2km & 2.5km', 2500, NULL, NULL
  WHERE NOT EXISTS (SELECT 1 FROM public.event_distances x
                     WHERE x.edition_id = '296e80af-f083-4ba7-9df6-56d3c118cc4c' AND x.original_label = '400m, 1.2km & 2.5km'
                       AND x.distance_metres IS NOT DISTINCT FROM 2500);
INSERT INTO public.event_distances (edition_id, original_label, distance_metres, category, registration_url)
  SELECT '296e80af-f083-4ba7-9df6-56d3c118cc4c', '4km', 4000, NULL, NULL
  WHERE NOT EXISTS (SELECT 1 FROM public.event_distances x
                     WHERE x.edition_id = '296e80af-f083-4ba7-9df6-56d3c118cc4c' AND x.original_label = '4km'
                       AND x.distance_metres IS NOT DISTINCT FROM 4000);
INSERT INTO public.event_distances (edition_id, original_label, distance_metres, category, registration_url)
  SELECT '7b8405eb-43d4-40df-b711-76e679e3c543', '600m, 1.4km & 3.8km', 600, NULL, NULL
  WHERE NOT EXISTS (SELECT 1 FROM public.event_distances x
                     WHERE x.edition_id = '7b8405eb-43d4-40df-b711-76e679e3c543' AND x.original_label = '600m, 1.4km & 3.8km'
                       AND x.distance_metres IS NOT DISTINCT FROM 600);
INSERT INTO public.event_distances (edition_id, original_label, distance_metres, category, registration_url)
  SELECT '7b8405eb-43d4-40df-b711-76e679e3c543', '600m, 1.4km & 3.8km', 1400, NULL, NULL
  WHERE NOT EXISTS (SELECT 1 FROM public.event_distances x
                     WHERE x.edition_id = '7b8405eb-43d4-40df-b711-76e679e3c543' AND x.original_label = '600m, 1.4km & 3.8km'
                       AND x.distance_metres IS NOT DISTINCT FROM 1400);
INSERT INTO public.event_distances (edition_id, original_label, distance_metres, category, registration_url)
  SELECT '7b8405eb-43d4-40df-b711-76e679e3c543', '600m, 1.4km & 3.8km', 3800, NULL, NULL
  WHERE NOT EXISTS (SELECT 1 FROM public.event_distances x
                     WHERE x.edition_id = '7b8405eb-43d4-40df-b711-76e679e3c543' AND x.original_label = '600m, 1.4km & 3.8km'
                       AND x.distance_metres IS NOT DISTINCT FROM 3800);
INSERT INTO public.event_distances (edition_id, original_label, distance_metres, category, registration_url)
  SELECT '2cb4ec28-2f03-4001-b562-d6621aede667', '1 km', 1000, NULL, NULL
  WHERE NOT EXISTS (SELECT 1 FROM public.event_distances x
                     WHERE x.edition_id = '2cb4ec28-2f03-4001-b562-d6621aede667' AND x.original_label = '1 km'
                       AND x.distance_metres IS NOT DISTINCT FROM 1000);
INSERT INTO public.event_distances (edition_id, original_label, distance_metres, category, registration_url)
  SELECT '2cb4ec28-2f03-4001-b562-d6621aede667', '1.3 km', 1300, NULL, NULL
  WHERE NOT EXISTS (SELECT 1 FROM public.event_distances x
                     WHERE x.edition_id = '2cb4ec28-2f03-4001-b562-d6621aede667' AND x.original_label = '1.3 km'
                       AND x.distance_metres IS NOT DISTINCT FROM 1300);
INSERT INTO public.event_distances (edition_id, original_label, distance_metres, category, registration_url)
  SELECT '2cb4ec28-2f03-4001-b562-d6621aede667', '3 km', 3000, NULL, NULL
  WHERE NOT EXISTS (SELECT 1 FROM public.event_distances x
                     WHERE x.edition_id = '2cb4ec28-2f03-4001-b562-d6621aede667' AND x.original_label = '3 km'
                       AND x.distance_metres IS NOT DISTINCT FROM 3000);
INSERT INTO public.event_distances (edition_id, original_label, distance_metres, category, registration_url)
  SELECT '2cb4ec28-2f03-4001-b562-d6621aede667', '5 km', 5000, NULL, NULL
  WHERE NOT EXISTS (SELECT 1 FROM public.event_distances x
                     WHERE x.edition_id = '2cb4ec28-2f03-4001-b562-d6621aede667' AND x.original_label = '5 km'
                       AND x.distance_metres IS NOT DISTINCT FROM 5000);
INSERT INTO public.event_distances (edition_id, original_label, distance_metres, category, registration_url)
  SELECT '2cb4ec28-2f03-4001-b562-d6621aede667', '7 km', 7000, NULL, NULL
  WHERE NOT EXISTS (SELECT 1 FROM public.event_distances x
                     WHERE x.edition_id = '2cb4ec28-2f03-4001-b562-d6621aede667' AND x.original_label = '7 km'
                       AND x.distance_metres IS NOT DISTINCT FROM 7000);
INSERT INTO public.event_distances (edition_id, original_label, distance_metres, category, registration_url)
  SELECT '2cb4ec28-2f03-4001-b562-d6621aede667', '10 km', 10000, NULL, NULL
  WHERE NOT EXISTS (SELECT 1 FROM public.event_distances x
                     WHERE x.edition_id = '2cb4ec28-2f03-4001-b562-d6621aede667' AND x.original_label = '10 km'
                       AND x.distance_metres IS NOT DISTINCT FROM 10000);
INSERT INTO public.event_distances (edition_id, original_label, distance_metres, category, registration_url)
  SELECT '2cb4ec28-2f03-4001-b562-d6621aede667', '16 km', 16000, NULL, NULL
  WHERE NOT EXISTS (SELECT 1 FROM public.event_distances x
                     WHERE x.edition_id = '2cb4ec28-2f03-4001-b562-d6621aede667' AND x.original_label = '16 km'
                       AND x.distance_metres IS NOT DISTINCT FROM 16000);
INSERT INTO public.event_distances (edition_id, original_label, distance_metres, category, registration_url)
  SELECT '2cb4ec28-2f03-4001-b562-d6621aede667', '21 km', 21000, NULL, NULL
  WHERE NOT EXISTS (SELECT 1 FROM public.event_distances x
                     WHERE x.edition_id = '2cb4ec28-2f03-4001-b562-d6621aede667' AND x.original_label = '21 km'
                       AND x.distance_metres IS NOT DISTINCT FROM 21000);
INSERT INTO public.event_distances (edition_id, original_label, distance_metres, category, registration_url)
  SELECT '7a6e90eb-f0f4-4c47-b65d-87666b41c6ff', '200m & 3.1kM', 200, NULL, NULL
  WHERE NOT EXISTS (SELECT 1 FROM public.event_distances x
                     WHERE x.edition_id = '7a6e90eb-f0f4-4c47-b65d-87666b41c6ff' AND x.original_label = '200m & 3.1kM'
                       AND x.distance_metres IS NOT DISTINCT FROM 200);
INSERT INTO public.event_distances (edition_id, original_label, distance_metres, category, registration_url)
  SELECT '7a6e90eb-f0f4-4c47-b65d-87666b41c6ff', '200m & 3.1kM', 3100, NULL, NULL
  WHERE NOT EXISTS (SELECT 1 FROM public.event_distances x
                     WHERE x.edition_id = '7a6e90eb-f0f4-4c47-b65d-87666b41c6ff' AND x.original_label = '200m & 3.1kM'
                       AND x.distance_metres IS NOT DISTINCT FROM 3100);
INSERT INTO public.event_distances (edition_id, original_label, distance_metres, category, registration_url)
  SELECT '436396e0-3e97-4295-8144-7d341b37b1a9', '1.2km', 1200, NULL, NULL
  WHERE NOT EXISTS (SELECT 1 FROM public.event_distances x
                     WHERE x.edition_id = '436396e0-3e97-4295-8144-7d341b37b1a9' AND x.original_label = '1.2km'
                       AND x.distance_metres IS NOT DISTINCT FROM 1200);
INSERT INTO public.event_distances (edition_id, original_label, distance_metres, category, registration_url)
  SELECT '57a05d6a-1266-458b-8e26-ca6807a841d3', '300m, 800m & 1.8km', 300, NULL, NULL
  WHERE NOT EXISTS (SELECT 1 FROM public.event_distances x
                     WHERE x.edition_id = '57a05d6a-1266-458b-8e26-ca6807a841d3' AND x.original_label = '300m, 800m & 1.8km'
                       AND x.distance_metres IS NOT DISTINCT FROM 300);
INSERT INTO public.event_distances (edition_id, original_label, distance_metres, category, registration_url)
  SELECT '57a05d6a-1266-458b-8e26-ca6807a841d3', '300m, 800m & 1.8km', 800, NULL, NULL
  WHERE NOT EXISTS (SELECT 1 FROM public.event_distances x
                     WHERE x.edition_id = '57a05d6a-1266-458b-8e26-ca6807a841d3' AND x.original_label = '300m, 800m & 1.8km'
                       AND x.distance_metres IS NOT DISTINCT FROM 800);
INSERT INTO public.event_distances (edition_id, original_label, distance_metres, category, registration_url)
  SELECT '57a05d6a-1266-458b-8e26-ca6807a841d3', '300m, 800m & 1.8km', 1800, NULL, NULL
  WHERE NOT EXISTS (SELECT 1 FROM public.event_distances x
                     WHERE x.edition_id = '57a05d6a-1266-458b-8e26-ca6807a841d3' AND x.original_label = '300m, 800m & 1.8km'
                       AND x.distance_metres IS NOT DISTINCT FROM 1800);
INSERT INTO public.event_distances (edition_id, original_label, distance_metres, category, registration_url)
  SELECT '39881277-a7cf-4efd-a555-852e7dc3d629', '400m, 800m & 2km', 400, NULL, NULL
  WHERE NOT EXISTS (SELECT 1 FROM public.event_distances x
                     WHERE x.edition_id = '39881277-a7cf-4efd-a555-852e7dc3d629' AND x.original_label = '400m, 800m & 2km'
                       AND x.distance_metres IS NOT DISTINCT FROM 400);
INSERT INTO public.event_distances (edition_id, original_label, distance_metres, category, registration_url)
  SELECT '39881277-a7cf-4efd-a555-852e7dc3d629', '400m, 800m & 2km', 800, NULL, NULL
  WHERE NOT EXISTS (SELECT 1 FROM public.event_distances x
                     WHERE x.edition_id = '39881277-a7cf-4efd-a555-852e7dc3d629' AND x.original_label = '400m, 800m & 2km'
                       AND x.distance_metres IS NOT DISTINCT FROM 800);
INSERT INTO public.event_distances (edition_id, original_label, distance_metres, category, registration_url)
  SELECT '39881277-a7cf-4efd-a555-852e7dc3d629', '400m, 800m & 2km', 2000, NULL, NULL
  WHERE NOT EXISTS (SELECT 1 FROM public.event_distances x
                     WHERE x.edition_id = '39881277-a7cf-4efd-a555-852e7dc3d629' AND x.original_label = '400m, 800m & 2km'
                       AND x.distance_metres IS NOT DISTINCT FROM 2000);
INSERT INTO public.event_distances (edition_id, original_label, distance_metres, category, registration_url)
  SELECT '450640a8-3846-490d-ab10-9cf00cbbd916', '500m, 1.2km, 2.5km, 5km, 10km', 500, NULL, NULL
  WHERE NOT EXISTS (SELECT 1 FROM public.event_distances x
                     WHERE x.edition_id = '450640a8-3846-490d-ab10-9cf00cbbd916' AND x.original_label = '500m, 1.2km, 2.5km, 5km, 10km'
                       AND x.distance_metres IS NOT DISTINCT FROM 500);
INSERT INTO public.event_distances (edition_id, original_label, distance_metres, category, registration_url)
  SELECT '450640a8-3846-490d-ab10-9cf00cbbd916', '500m, 1.2km, 2.5km, 5km, 10km', 1200, NULL, NULL
  WHERE NOT EXISTS (SELECT 1 FROM public.event_distances x
                     WHERE x.edition_id = '450640a8-3846-490d-ab10-9cf00cbbd916' AND x.original_label = '500m, 1.2km, 2.5km, 5km, 10km'
                       AND x.distance_metres IS NOT DISTINCT FROM 1200);
INSERT INTO public.event_distances (edition_id, original_label, distance_metres, category, registration_url)
  SELECT '450640a8-3846-490d-ab10-9cf00cbbd916', '500m, 1.2km, 2.5km, 5km, 10km', 2500, NULL, NULL
  WHERE NOT EXISTS (SELECT 1 FROM public.event_distances x
                     WHERE x.edition_id = '450640a8-3846-490d-ab10-9cf00cbbd916' AND x.original_label = '500m, 1.2km, 2.5km, 5km, 10km'
                       AND x.distance_metres IS NOT DISTINCT FROM 2500);
INSERT INTO public.event_distances (edition_id, original_label, distance_metres, category, registration_url)
  SELECT '450640a8-3846-490d-ab10-9cf00cbbd916', '500m, 1.2km, 2.5km, 5km, 10km', 5000, NULL, NULL
  WHERE NOT EXISTS (SELECT 1 FROM public.event_distances x
                     WHERE x.edition_id = '450640a8-3846-490d-ab10-9cf00cbbd916' AND x.original_label = '500m, 1.2km, 2.5km, 5km, 10km'
                       AND x.distance_metres IS NOT DISTINCT FROM 5000);
INSERT INTO public.event_distances (edition_id, original_label, distance_metres, category, registration_url)
  SELECT '450640a8-3846-490d-ab10-9cf00cbbd916', '7.5km Ocean Swim', 7500, NULL, NULL
  WHERE NOT EXISTS (SELECT 1 FROM public.event_distances x
                     WHERE x.edition_id = '450640a8-3846-490d-ab10-9cf00cbbd916' AND x.original_label = '7.5km Ocean Swim'
                       AND x.distance_metres IS NOT DISTINCT FROM 7500);
INSERT INTO public.event_distances (edition_id, original_label, distance_metres, category, registration_url)
  SELECT '450640a8-3846-490d-ab10-9cf00cbbd916', '500m, 1.2km, 2.5km, 5km, 10km', 10000, NULL, NULL
  WHERE NOT EXISTS (SELECT 1 FROM public.event_distances x
                     WHERE x.edition_id = '450640a8-3846-490d-ab10-9cf00cbbd916' AND x.original_label = '500m, 1.2km, 2.5km, 5km, 10km'
                       AND x.distance_metres IS NOT DISTINCT FROM 10000);
INSERT INTO public.event_distances (edition_id, original_label, distance_metres, category, registration_url)
  SELECT '28f442bf-f9c0-45d2-a079-0b79f9233727', '500m, 2km & 2km', 500, NULL, NULL
  WHERE NOT EXISTS (SELECT 1 FROM public.event_distances x
                     WHERE x.edition_id = '28f442bf-f9c0-45d2-a079-0b79f9233727' AND x.original_label = '500m, 2km & 2km'
                       AND x.distance_metres IS NOT DISTINCT FROM 500);
INSERT INTO public.event_distances (edition_id, original_label, distance_metres, category, registration_url)
  SELECT '28f442bf-f9c0-45d2-a079-0b79f9233727', '500m, 2km & 2km', 2000, NULL, NULL
  WHERE NOT EXISTS (SELECT 1 FROM public.event_distances x
                     WHERE x.edition_id = '28f442bf-f9c0-45d2-a079-0b79f9233727' AND x.original_label = '500m, 2km & 2km'
                       AND x.distance_metres IS NOT DISTINCT FROM 2000);
INSERT INTO public.event_distances (edition_id, original_label, distance_metres, category, registration_url)
  SELECT '357b98b2-d30c-4769-b9b2-6b0576976f50', '1.2km', 1200, NULL, NULL
  WHERE NOT EXISTS (SELECT 1 FROM public.event_distances x
                     WHERE x.edition_id = '357b98b2-d30c-4769-b9b2-6b0576976f50' AND x.original_label = '1.2km'
                       AND x.distance_metres IS NOT DISTINCT FROM 1200);
INSERT INTO public.event_distances (edition_id, original_label, distance_metres, category, registration_url)
  SELECT 'cd4dbb29-ba41-4aed-b065-f941323c043a', '13 km', 13000, NULL, NULL
  WHERE NOT EXISTS (SELECT 1 FROM public.event_distances x
                     WHERE x.edition_id = 'cd4dbb29-ba41-4aed-b065-f941323c043a' AND x.original_label = '13 km'
                       AND x.distance_metres IS NOT DISTINCT FROM 13000);
INSERT INTO public.event_distances (edition_id, original_label, distance_metres, category, registration_url)
  SELECT '94e0f846-908e-46c8-a2e1-3df845566e65', '1 km, 3,2 km, 5,4 km, 11 km', 1000, NULL, NULL
  WHERE NOT EXISTS (SELECT 1 FROM public.event_distances x
                     WHERE x.edition_id = '94e0f846-908e-46c8-a2e1-3df845566e65' AND x.original_label = '1 km, 3,2 km, 5,4 km, 11 km'
                       AND x.distance_metres IS NOT DISTINCT FROM 1000);
INSERT INTO public.event_distances (edition_id, original_label, distance_metres, category, registration_url)
  SELECT '94e0f846-908e-46c8-a2e1-3df845566e65', '1 km, 3,2 km, 5,4 km, 11 km', 3200, NULL, NULL
  WHERE NOT EXISTS (SELECT 1 FROM public.event_distances x
                     WHERE x.edition_id = '94e0f846-908e-46c8-a2e1-3df845566e65' AND x.original_label = '1 km, 3,2 km, 5,4 km, 11 km'
                       AND x.distance_metres IS NOT DISTINCT FROM 3200);
INSERT INTO public.event_distances (edition_id, original_label, distance_metres, category, registration_url)
  SELECT '94e0f846-908e-46c8-a2e1-3df845566e65', '1 km, 3,2 km, 5,4 km, 11 km', 5400, NULL, NULL
  WHERE NOT EXISTS (SELECT 1 FROM public.event_distances x
                     WHERE x.edition_id = '94e0f846-908e-46c8-a2e1-3df845566e65' AND x.original_label = '1 km, 3,2 km, 5,4 km, 11 km'
                       AND x.distance_metres IS NOT DISTINCT FROM 5400);
INSERT INTO public.event_distances (edition_id, original_label, distance_metres, category, registration_url)
  SELECT '94e0f846-908e-46c8-a2e1-3df845566e65', '1 km, 3,2 km, 5,4 km, 11 km', 11000, NULL, NULL
  WHERE NOT EXISTS (SELECT 1 FROM public.event_distances x
                     WHERE x.edition_id = '94e0f846-908e-46c8-a2e1-3df845566e65' AND x.original_label = '1 km, 3,2 km, 5,4 km, 11 km'
                       AND x.distance_metres IS NOT DISTINCT FROM 11000);
INSERT INTO public.event_distances (edition_id, original_label, distance_metres, category, registration_url)
  SELECT 'a6b2a79c-4d77-42c4-bc0d-64549e225e31', '2000 meter, 1000 meter, 10000 meter', 1000, NULL, NULL
  WHERE NOT EXISTS (SELECT 1 FROM public.event_distances x
                     WHERE x.edition_id = 'a6b2a79c-4d77-42c4-bc0d-64549e225e31' AND x.original_label = '2000 meter, 1000 meter, 10000 meter'
                       AND x.distance_metres IS NOT DISTINCT FROM 1000);
INSERT INTO public.event_distances (edition_id, original_label, distance_metres, category, registration_url)
  SELECT 'a6b2a79c-4d77-42c4-bc0d-64549e225e31', '2000 meter, 1000 meter, 10000 meter', 2000, NULL, NULL
  WHERE NOT EXISTS (SELECT 1 FROM public.event_distances x
                     WHERE x.edition_id = 'a6b2a79c-4d77-42c4-bc0d-64549e225e31' AND x.original_label = '2000 meter, 1000 meter, 10000 meter'
                       AND x.distance_metres IS NOT DISTINCT FROM 2000);
INSERT INTO public.event_distances (edition_id, original_label, distance_metres, category, registration_url)
  SELECT 'a6b2a79c-4d77-42c4-bc0d-64549e225e31', '2000 meter, 1000 meter, 10000 meter', 10000, NULL, NULL
  WHERE NOT EXISTS (SELECT 1 FROM public.event_distances x
                     WHERE x.edition_id = 'a6b2a79c-4d77-42c4-bc0d-64549e225e31' AND x.original_label = '2000 meter, 1000 meter, 10000 meter'
                       AND x.distance_metres IS NOT DISTINCT FROM 10000);
INSERT INTO public.event_distances (edition_id, original_label, distance_metres, category, registration_url)
  SELECT '9bf2aed9-f795-49a9-8f73-82bd7fbc124d', '500m & 1.6km', 500, NULL, NULL
  WHERE NOT EXISTS (SELECT 1 FROM public.event_distances x
                     WHERE x.edition_id = '9bf2aed9-f795-49a9-8f73-82bd7fbc124d' AND x.original_label = '500m & 1.6km'
                       AND x.distance_metres IS NOT DISTINCT FROM 500);
INSERT INTO public.event_distances (edition_id, original_label, distance_metres, category, registration_url)
  SELECT '9bf2aed9-f795-49a9-8f73-82bd7fbc124d', '500m & 1.6km', 1600, NULL, NULL
  WHERE NOT EXISTS (SELECT 1 FROM public.event_distances x
                     WHERE x.edition_id = '9bf2aed9-f795-49a9-8f73-82bd7fbc124d' AND x.original_label = '500m & 1.6km'
                       AND x.distance_metres IS NOT DISTINCT FROM 1600);

COMMIT;

-- ----------------------------------------------------------------
-- ROLLBACK
-- ----------------------------------------------------------------
-- DELETE FROM public.event_distances WHERE edition_id IN (
--    '12bb92db-1213-428e-9f37-aefd38a8a9f4','47395c49-eae9-41d1-9a7b-f5e7f6275323',
--    'd6a99991-8f33-4901-a574-6f32083c0b14','e6ce50c7-03d2-4301-9a85-6734c59432d1',
--    'c9b2f99b-ea90-455b-b089-a1dde93a120b','296e80af-f083-4ba7-9df6-56d3c118cc4c',
--    '7b8405eb-43d4-40df-b711-76e679e3c543','7a6e90eb-f0f4-4c47-b65d-87666b41c6ff',
--    '436396e0-3e97-4295-8144-7d341b37b1a9','57a05d6a-1266-458b-8e26-ca6807a841d3',
--    '39881277-a7cf-4efd-a555-852e7dc3d629','450640a8-3846-490d-ab10-9cf00cbbd916',
--    '28f442bf-f9c0-45d2-a079-0b79f9233727','357b98b2-d30c-4769-b9b2-6b0576976f50',
--    '9bf2aed9-f795-49a9-8f73-82bd7fbc124d');
-- UPDATE event_editions e SET title = b.title FROM _bak_20260813_bluff_title b WHERE e.id = b.id;

-- ----------------------------------------------------------------
-- VERIFY — run on the READ-ONLY connection AFTER applying.
-- ----------------------------------------------------------------
-- SELECT count(*) FROM public.event_distances;   -- expect: pre-check number + 58
--
-- Every edition got ALL its distances, not just the first (this is what the
-- earlier guards broke):
-- SELECT e.title, count(*) AS n, string_agg(d.distance_metres::text, '/' ORDER BY d.distance_metres) AS metres
--   FROM public.event_distances d JOIN event_editions e ON e.id = d.edition_id
--  WHERE d.edition_id IN ('12bb92db-1213-428e-9f37-aefd38a8a9f4','450640a8-3846-490d-ab10-9cf00cbbd916')
--  GROUP BY e.title;
-- expect: Darwin -> 3 rows 500/3000/5000;  Victorian champs -> 6 rows 500/1200/2500/5000/7500/10000
--
-- SELECT title FROM event_editions WHERE id = '357b98b2-d30c-4769-b9b2-6b0576976f50';
-- expect: Bluff to Bar
--
-- Editions still without distances should fall 96 -> 77:
-- SELECT count(*) FROM event_editions e
--  WHERE e.is_searchable AND e.start_date >= current_date AND e.status <> 'cancelled'
--    AND e.discipline = 'open_water'
--    AND NOT EXISTS (SELECT 1 FROM public.event_distances d WHERE d.edition_id = e.id);
-- expect: 77
