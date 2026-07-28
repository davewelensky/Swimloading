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
-- Migration: 2026-07-28_add-la-jolla-shores-spot.sql
-- Process:   see MIGRATIONS.md — no section below may be left empty
-- ================================================================

-- Purpose:
--   Add "La Jolla Shores" (San Diego, Southern California, USA) as a new
--   spot. USA domain + US country already exist (live international
--   country #7 of 13 — see EXPANDING.md), so this is a pure spot INSERT,
--   no code changes needed. Fulfils spot_suggestions row
--   ffc051f8-adce-4afa-9bb8-eb0737595073, submitted by Joana Rodriguez
--   Rojas (user_id 935b278e-e987-460a-9b04-f1768902625e) 28 Jul 2026 and
--   already marked 'approved' in admin.html (which only flips the status
--   flag + sends a "your spot is now live" notification — it does NOT
--   write to spots — so without this migration the notification is false).

-- Requested by:
--   Joana Rodriguez Rojas (swimmer spot suggestion), approved by Dave via admin.html

-- ----------------------------------------------------------------
-- PRE-CHECKS — run on the READ-ONLY connection BEFORE applying.
-- Must include affected-row counts for any UPDATE/DELETE.
-- ----------------------------------------------------------------
-- SELECT code, display_name, is_coastal, country_code FROM domains WHERE code='USA';
--   expect: 1 row — USA / United States / is_coastal=true / country_code=US
-- SELECT iso_code, name, is_domestic FROM countries WHERE iso_code='US';
--   expect: 1 row — US / United States / is_domestic=false
-- SELECT code FROM spots WHERE code='LA_JOLLA_SHORES';
--   expect: 0 rows (no existing spot with this code)
-- SELECT id, spot_name, status FROM spot_suggestions WHERE id='ffc051f8-adce-4afa-9bb8-eb0737595073';
--   expect: 1 row — La Jolla Shores / approved

-- ----------------------------------------------------------------
-- BACKUP — required before any DELETE / UPDATE / DROP / TRUNCATE.
-- ----------------------------------------------------------------
-- N/A — pure INSERT, nothing destructive.

-- ----------------------------------------------------------------
-- MIGRATION — applied only after Dave types "apply".
-- ----------------------------------------------------------------
BEGIN;

INSERT INTO spots (name, code, domain, water_type, latitude, longitude, area, country_code, active)
VALUES (
  'La Jolla Shores',
  'LA_JOLLA_SHORES',
  'USA',
  'OCEAN',
  32.8569,
  -117.2571,
  'SAN_DIEGO',
  'US',
  true
);

COMMIT;

-- ----------------------------------------------------------------
-- ROLLBACK — exact SQL to undo, or state:
-- "irreversible — restore from _bak_YYYYMMDD_tablename"
-- ----------------------------------------------------------------
-- DELETE FROM spots WHERE code = 'LA_JOLLA_SHORES';

-- ----------------------------------------------------------------
-- VERIFY — run on the READ-ONLY connection AFTER applying.
-- State the expected result next to each query.
-- ----------------------------------------------------------------
-- SELECT name, code, domain, water_type, latitude, longitude, area, country_code, active
-- FROM spots WHERE code = 'LA_JOLLA_SHORES';
--   expect: 1 row — La Jolla Shores / LA_JOLLA_SHORES / USA / OCEAN / 32.8569 / -117.2571 / SAN_DIEGO / US / true
