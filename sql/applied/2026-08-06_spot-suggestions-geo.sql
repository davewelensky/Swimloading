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
-- Migration: 2026-08-06_spot-suggestions-geo.sql
-- Process:   see MIGRATIONS.md — no section below may be left empty
-- ================================================================

-- Purpose:
--   Extend spot_suggestions so user-submitted spots carry real coordinates
--   and location metadata (from the new geocoded "Add missing spot" flow),
--   and so admin review can record merge/approve outcomes properly.
--   Additive only — no existing column is changed or dropped, existing
--   free-text suggestions keep working unchanged.

-- Requested by:
--   Dave, 2026-08-06 — Spot Contribution system V1 (admin geocoded add-spot,
--   user missing-spot submission, admin approve/merge/reject queue).

-- ----------------------------------------------------------------
-- PRE-CHECKS — run on the READ-ONLY connection BEFORE applying.
-- Must include affected-row counts for any UPDATE/DELETE.
-- ----------------------------------------------------------------
-- SELECT count(*) FROM spot_suggestions;                      -- baseline row count (no rows modified by this migration)
-- SELECT column_name FROM information_schema.columns
--   WHERE table_name='spot_suggestions' AND column_name IN
--   ('latitude','longitude','locality','admin_area','country','country_code',
--    'source','matched_spot_id','created_spot_id','reviewed_at');
--   -- expect: 0 rows (none of these columns exist yet)
-- SELECT pg_get_constraintdef(oid) FROM pg_constraint
--   WHERE conname='spot_suggestions_status_check';
--   -- expect: CHECK status IN ('pending','approved','rejected')

-- ----------------------------------------------------------------
-- BACKUP — required before any DELETE / UPDATE / DROP / TRUNCATE.
-- ----------------------------------------------------------------
-- Additive ALTERs only — no data is modified. The status CHECK constraint
-- is replaced with a strictly wider one (adds 'merged'), which cannot
-- invalidate any existing row. No backup table required.

-- ----------------------------------------------------------------
-- MIGRATION — applied only after Dave types "apply".
-- ----------------------------------------------------------------
BEGIN;

ALTER TABLE spot_suggestions
  ADD COLUMN latitude        double precision,
  ADD COLUMN longitude       double precision,
  ADD COLUMN locality        text,             -- city/suburb from geocoder
  ADD COLUMN admin_area      text,             -- state/province/region from geocoder
  ADD COLUMN country         text,             -- country display name from geocoder
  ADD COLUMN country_code    text,             -- ISO alpha-2, uppercased
  ADD COLUMN source          text NOT NULL DEFAULT 'user_submission',
  ADD COLUMN matched_spot_id uuid REFERENCES spots(id),  -- set on merge: the existing spot this duplicates
  ADD COLUMN created_spot_id uuid REFERENCES spots(id),  -- set on approve: the canonical spot created from this
  ADD COLUMN reviewed_at     timestamptz;

-- Widen status to include 'merged' (suggestion resolved to an existing spot,
-- no new canonical spot created).
ALTER TABLE spot_suggestions DROP CONSTRAINT spot_suggestions_status_check;
ALTER TABLE spot_suggestions ADD CONSTRAINT spot_suggestions_status_check
  CHECK (status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text, 'merged'::text]));

-- Sanity range check on coordinates (both-or-neither, and on Earth).
ALTER TABLE spot_suggestions ADD CONSTRAINT spot_suggestions_coords_valid
  CHECK (
    (latitude IS NULL AND longitude IS NULL)
    OR (latitude BETWEEN -90 AND 90 AND longitude BETWEEN -180 AND 180)
  );

-- Future-proofing note (NOT implemented now): `source` is text, so a later
-- automatic GPS-discovery phase can insert source='gps_detected' rows through
-- the same review pipeline without schema change.

COMMIT;

-- ----------------------------------------------------------------
-- ROLLBACK — exact SQL to undo, or state:
-- "irreversible — restore from _bak_YYYYMMDD_tablename"
-- ----------------------------------------------------------------
-- BEGIN;
-- ALTER TABLE spot_suggestions
--   DROP CONSTRAINT spot_suggestions_coords_valid,
--   DROP COLUMN latitude, DROP COLUMN longitude, DROP COLUMN locality,
--   DROP COLUMN admin_area, DROP COLUMN country, DROP COLUMN country_code,
--   DROP COLUMN source, DROP COLUMN matched_spot_id, DROP COLUMN created_spot_id,
--   DROP COLUMN reviewed_at;
-- ALTER TABLE spot_suggestions DROP CONSTRAINT spot_suggestions_status_check;
-- ALTER TABLE spot_suggestions ADD CONSTRAINT spot_suggestions_status_check
--   CHECK (status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text]));
-- COMMIT;
-- (Only safe while no row has status='merged'.)

-- ----------------------------------------------------------------
-- VERIFY — run on the READ-ONLY connection AFTER applying.
-- State the expected result next to each query.
-- ----------------------------------------------------------------
-- SELECT count(*) FROM information_schema.columns
--   WHERE table_name='spot_suggestions' AND column_name IN
--   ('latitude','longitude','locality','admin_area','country','country_code',
--    'source','matched_spot_id','created_spot_id','reviewed_at');
--   -- expect: 10
-- SELECT pg_get_constraintdef(oid) FROM pg_constraint
--   WHERE conname='spot_suggestions_status_check';
--   -- expect: includes 'merged'
-- SELECT count(*) FROM spot_suggestions;   -- expect: same as pre-check baseline
