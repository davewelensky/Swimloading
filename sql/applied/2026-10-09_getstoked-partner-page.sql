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
-- Migration: 2026-10-09_getstoked-partner-page.sql
-- Process:   see MIGRATIONS.md — no section below may be left empty
-- ================================================================

-- Purpose:
--   Put Get Stoked on the homepage partner list: one new partner_pages row (drives the homepage card, the admin Partner
--   Report and the Growth Hub) and correct the "New sponsors" placeholder card now that the recovery sponsor is named.
--   Nothing here publishes a discount code: none is confirmed or live.

-- Requested by:
--   Dave ("lets add getstoked here: swimloading.com", 9 Oct 2026)

-- ----------------------------------------------------------------
-- PRE-CHECKS — read-only, run BEFORE applying. Results on 9 Oct 2026 are in brackets.
-- ----------------------------------------------------------------
-- No Get Stoked card exists yet (expect 0):                [0]
--   SELECT count(*) FROM partner_pages WHERE hero_page = '/partners/getstoked' OR name ILIKE '%stoked%';
-- The placeholder row to correct exists (expect 1 row, home_order 10):  [1 row: 21a221ef..., home_order 10]
--   SELECT id, home_order FROM partner_pages WHERE name = 'New sponsors (unnamed placeholder)';
-- Backup table must not already exist (expect 0):          [0]
--   SELECT count(*) FROM pg_class WHERE relname = '_bak_20261009_partner_pages';
-- Rows this migration will UPDATE: partner_pages 1. Rows it will INSERT: partner_pages 1.

-- ----------------------------------------------------------------
-- BACKUP — required before any UPDATE.
-- ----------------------------------------------------------------
CREATE TABLE _bak_20261009_partner_pages AS
  SELECT * FROM partner_pages WHERE name = 'New sponsors (unnamed placeholder)';
ALTER TABLE _bak_20261009_partner_pages ENABLE ROW LEVEL SECURITY;   -- a backup copies every column; without RLS the public API can read it

-- ----------------------------------------------------------------
-- MIGRATION — applied only after Dave's go-ahead.
-- ----------------------------------------------------------------
BEGIN;

-- 1. The Get Stoked card. 'coming_soon' + chip "Discount Coming" because the member discount is agreed in principle
--    but not set up. Flip section to 'active' only when the code is live.
INSERT INTO partner_pages
  (name, hero_page, section, status_note, sort_order, show_on_home, home_order,
   logo_url, logo_alt, logo_style, logo_text, chip_state, chip_label, blurb, cta_label)
SELECT
  'Get Stoked', '/partners/getstoked', 'coming_soon',
  'Agreed in principle (Oct 2026): exclusive 10% member discount on Therabody + recovery content. Discount code not live yet.',
  10, true, 10,
  '/icons/getstoked-logo.jpg', 'Get Stoked', 'height:34px;width:auto;border-radius:4px;', NULL,
  'soon', 'Discount Coming',
  'The official Therabody importer and distributor in South Africa. An exclusive 10% member discount on Therabody products is being set up.',
  'Preview Get Stoked'
WHERE NOT EXISTS (SELECT 1 FROM partner_pages WHERE hero_page = '/partners/getstoked');

-- 2. The placeholder said two sponsors were landing (skincare + recovery). Recovery is now named, so only skincare is left,
--    and it moves down one slot to make room.
UPDATE partner_pages
SET blurb       = 'A new skincare sponsor is landing soon. We will name them as soon as the details are settled.',
    status_note = 'Placeholder card until the skincare sponsor is agreed and named. Replace with a real row then.',
    home_order  = 11,
    updated_at  = now()
WHERE name = 'New sponsors (unnamed placeholder)';

COMMIT;

-- ----------------------------------------------------------------
-- POST-VERIFY — read-only, run after applying.
-- ----------------------------------------------------------------
-- Card exists, coming_soon, home_order 10 (expect 1 row):
--   SELECT name, section, chip_label, home_order FROM partner_pages WHERE hero_page = '/partners/getstoked';
-- Placeholder moved to 11 with the skincare-only copy (expect 1 row):
--   SELECT home_order, blurb FROM partner_pages WHERE name = 'New sponsors (unnamed placeholder)';
-- Backup holds the original (expect 1) and has RLS on:
--   SELECT count(*) FROM _bak_20261009_partner_pages;
--   SELECT relname, relrowsecurity FROM pg_class WHERE relname = '_bak_20261009_partner_pages';
