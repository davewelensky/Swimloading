-- ================================================================
-- SwimLoading — Migration Template
-- ================================================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM _project_identity WHERE key = 'project_name' AND value = 'swimloading') THEN
    RAISE EXCEPTION 'WRONG PROJECT — MIGRATION ABORTED';
  END IF;
END $$;

-- ================================================================
-- Migration: 2026-09-23b_bluefin-name-correction.sql
-- ================================================================

-- Purpose:
--   Correct "Blue Fin" (two words) to "Bluefin" (one word) in the club
--   record. Dave checked the actual logo/letterhead — the brand mark
--   reads "BLUEFIN" as one word, "SWIM CLUB" below it. The public
--   website's own <title> tag says "Blue Fin" (inconsistent with its
--   own logo), which is what I'd matched originally — the logo is the
--   more authoritative source.

-- Requested by:
--   Dave, with a screenshot of the actual logo

-- ----------------------------------------------------------------
-- PRE-CHECKS
-- ----------------------------------------------------------------
-- SELECT name, description FROM clubs WHERE slug='bluefin';
--   -> name = 'Blue Fin Swim Club', description also contains "Blue Fin Swim Club"
-- Single row, matched by slug — no ambiguity.

-- ----------------------------------------------------------------
-- BACKUP
-- ----------------------------------------------------------------
-- Already covered by _bak_20260922d_clubs_bluefin (same row, same day range).

-- ----------------------------------------------------------------
-- MIGRATION
-- ----------------------------------------------------------------
BEGIN;
UPDATE clubs
SET name = 'Bluefin Swim Club',
    description = 'Bluefin Swim Club is a Masters lane and bay swim club based at Reddam House Constantia, Cape Town. Squad sessions run Monday, Wednesday and Friday mornings in the pool, with open water swimming at Fish Hoek, Glencairn or Simon''s Town on Tuesdays. The club also runs a 16-week Robben Island training programme and trains members toward events including the Langebaan Express.'
WHERE slug = 'bluefin';
COMMIT;

-- ----------------------------------------------------------------
-- ROLLBACK
-- ----------------------------------------------------------------
-- UPDATE clubs SET name = 'Blue Fin Swim Club',
--   description = 'Blue Fin Swim Club is a Masters lane and bay swim club...' -- (restore from _bak_20260922d_clubs_bluefin)
-- WHERE slug = 'bluefin';

-- ----------------------------------------------------------------
-- VERIFY
-- ----------------------------------------------------------------
-- SELECT name, description FROM clubs WHERE slug='bluefin';
--   -- expect: name = 'Bluefin Swim Club', description starts "Bluefin Swim Club is..."
