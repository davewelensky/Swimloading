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
-- Migration: 2026-08-13_hot-chocolate-swim.sql
-- Process:   see MIGRATIONS.md
-- ================================================================

-- Purpose:
--   Add Cape Town's Hot Chocolate swim to recurring_swims, and add the
--   `notes` column its provenance needs.
--
--   WHY A notes COLUMN NOW. PodSquad came from a page we fetched, so
--   source_url + last_verified_at record where every field came from. This
--   one came from Dave, who swims in Cape Town. That is a good source — but
--   source_url would be NULL and a future reader of the row would have no
--   way to tell "nobody has verified this" from "a person with direct
--   knowledge told us on 13 Aug 2026". swim_routes already carries both
--   summary and notes for the same reason; this brings the two tables into
--   line.
--
--   WHAT IS STATED, AND WHAT IS NOT. Dave gave: Camps Bay, in front of Café
--   Caprice, every Sunday 9:00am "without fail", around 1.6 km. So:
--     * start_time IS 09:00 here — unlike PodSquad, the time was stated.
--     * typical_distance_metres is 1600, and notes records that this is
--       "around" 1.6 km rather than a measured course.
--     * is_free is NULL, not true. These swims usually are, but "usually"
--       is not "stated", and the column exists to hold a fact.
--     * safety_note is NULL. PodSquad's page states its own safety
--       position; nobody has stated this one's, and inventing a safety
--       claim is the worst possible field to guess at.
--     * No coordinates. Café Caprice has a real position, but nobody
--       supplied one and this table does not geocode by guess.

-- Requested by:
--   Dave, 2026-08-13: "cape town has the sunday at 9:00am Hot chocolate
--   swim in Camps Bay, its a swim and takes place every Sunday infront of
--   Cafe Caprice without fail distance around 1.6km"

-- ----------------------------------------------------------------
-- PRE-CHECKS — run on the READ-ONLY connection BEFORE applying.
-- ----------------------------------------------------------------
-- SELECT count(*) FROM public.recurring_swims;   -- expect: 1 (PodSquad)
-- SELECT count(*) FROM information_schema.columns
--  WHERE table_schema='public' AND table_name='recurring_swims' AND column_name='notes';
-- expect: 0

-- ----------------------------------------------------------------
-- BACKUP — not required: adds a nullable column and inserts one row.
-- ----------------------------------------------------------------

-- ----------------------------------------------------------------
-- MIGRATION — applied only after Dave types "apply".
-- ----------------------------------------------------------------
BEGIN;

ALTER TABLE public.recurring_swims ADD COLUMN IF NOT EXISTS notes text;

COMMENT ON COLUMN public.recurring_swims.notes IS
  'Provenance and caveats in plain words — who told us, how precise a figure is, '
  'what has not been verified. Distinct from summary, which is swimmer-facing copy.';

INSERT INTO public.recurring_swims (
  slug, name, group_name,
  location_text, meeting_point, city, region, country_code,
  schedule_text, days_of_week, start_time,
  typical_distance_metres, is_free,
  summary, notes, last_verified_at, is_public
) VALUES (
  'hot-chocolate-swim-camps-bay',
  'Hot Chocolate Swim',
  NULL,
  'Camps Bay Beach, Cape Town, Western Cape',
  'In front of Café Caprice, Camps Bay beach',
  'Cape Town', 'Western Cape', 'ZA',
  'Every Sunday, 9:00am',
  ARRAY[0]::smallint[],                       -- 0 = Sunday, matching getDay()
  TIME '09:00',
  1600,
  NULL,                                       -- not stated; see notes
  'A standing Sunday morning swim off Camps Bay, starting in front of Café Caprice. Runs every week.',
  'Supplied by Dave Welensky 2026-08-13 from direct local knowledge, not from a published page — '
  'there is no organiser website to verify against. Distance is "around 1.6km" as described, not a '
  'measured course. Whether it is free and what its safety arrangements are were not stated and are '
  'deliberately left NULL rather than assumed.',
  DATE '2026-08-13',
  true
);

COMMIT;

-- ----------------------------------------------------------------
-- ROLLBACK
-- ----------------------------------------------------------------
-- DELETE FROM public.recurring_swims WHERE slug = 'hot-chocolate-swim-camps-bay';
-- ALTER TABLE public.recurring_swims DROP COLUMN notes;

-- ----------------------------------------------------------------
-- VERIFY — run on the READ-ONLY connection AFTER applying.
-- ----------------------------------------------------------------
-- SELECT name, city, schedule_text, start_time, typical_distance_metres, is_free, safety_note
--   FROM public.recurring_swims ORDER BY name;
-- expect: 2 rows.
--   Hot Chocolate Swim | Cape Town | Every Sunday, 9:00am | 09:00:00 | 1600 | NULL | NULL
--   PodSquad North Cottesloe | Perth | Every day of the year | NULL | 2000 | true | (safety text)
--
-- Both are readable by anon (this is what /explore uses):
-- SET LOCAL ROLE anon; SELECT count(*) FROM public.recurring_swims; RESET ROLE;
-- expect: 2
