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
-- Migration: 2026-09-14_sync-partner-pages-status.sql
-- Process:   see MIGRATIONS.md — no section below may be left empty
-- STATUS:    ⛔ PROPOSED — NOT YET APPLIED. Awaiting Dave's review and
--            the literal word "apply" per MIGRATIONS.md step 4.
-- ================================================================

-- Purpose:
--   dave.html's Partner Pages section loads live from partner_pages (see
--   loadPartners() in dave.html) and had drifted from the real, live
--   welcome.html partner cards. Dave noticed Blu Smooth, THEMAGIC5, TRIHARD
--   and FORM all showing "Coming soon" on /dave and asked whether it
--   reflects actual site status — it did not, for two of the four:
--     - Blu Smooth: welcome.html shows a "LIVE" badge + "Explore Blu Smooth"
--       button (active), but partner_pages.section = 'coming_soon'.
--     - THEMAGIC5: same mismatch — welcome.html shows "LIVE", DB says
--       'coming_soon'.
--     - FORM and TRIHARD are correctly 'coming_soon' — welcome.html itself
--       still shows them as pre-launch/preview, so no DB change needed for
--       either (TRIHARD's own live badge looks stale for a different reason
--       — its August-only campaign window — tracked separately in
--       PARTNERS.md, not fixed by this migration).
--   Also: JAKED is a signed, live "Coming Soon" partner (hero page +
--   welcome card live since Aug 2026) with NO row in partner_pages at all,
--   so it silently doesn't appear on /dave.

-- Requested by:
--   Dave, 14 Sept 2026

-- ----------------------------------------------------------------
-- PRE-CHECKS — run on the READ-ONLY connection BEFORE applying.
-- ----------------------------------------------------------------
-- SELECT id, name, section, status_note FROM partner_pages
--   WHERE name IN ('Blu Smooth', 'THEMAGIC5');
--   -- ran 14 Sept 2026: both section='coming_soon' — confirms the bug
-- SELECT count(*) FROM partner_pages WHERE name = 'JAKED';
--   -- ran 14 Sept 2026: 0 rows — confirms JAKED is missing entirely

-- ----------------------------------------------------------------
-- BACKUP — required before any DELETE / UPDATE / DROP / TRUNCATE.
-- ----------------------------------------------------------------
CREATE TABLE _bak_20260914_partner_pages AS SELECT * FROM partner_pages;

-- ----------------------------------------------------------------
-- MIGRATION — applied only after Dave types "apply".
-- ----------------------------------------------------------------
BEGIN;

UPDATE partner_pages
SET section = 'active',
    status_note = 'Active partner — hero page live',
    updated_at = now()
WHERE name = 'Blu Smooth';

UPDATE partner_pages
SET section = 'active',
    status_note = 'Active partner — hero page live',
    updated_at = now()
WHERE name = 'THEMAGIC5';

INSERT INTO partner_pages (name, hero_page, section, status_note, sort_order)
VALUES (
  'JAKED',
  '/partners/jaked',
  'coming_soon',
  'Partnership confirmed (Aug 2026) — soon sponsoring Carina Bruwer',
  9
);

COMMIT;

-- ----------------------------------------------------------------
-- ROLLBACK — exact SQL to undo, or state:
-- "irreversible — restore from _bak_YYYYMMDD_tablename"
-- ----------------------------------------------------------------
-- BEGIN;
-- UPDATE partner_pages p SET section = b.section, status_note = b.status_note, updated_at = b.updated_at
--   FROM _bak_20260914_partner_pages b WHERE p.id = b.id AND p.name IN ('Blu Smooth', 'THEMAGIC5');
-- DELETE FROM partner_pages WHERE name = 'JAKED';
-- COMMIT;

-- ----------------------------------------------------------------
-- VERIFY — run on the READ-ONLY connection AFTER applying.
-- ----------------------------------------------------------------
-- SELECT name, section, status_note FROM partner_pages ORDER BY sort_order;
--   -- expect: Blu Smooth and THEMAGIC5 both section='active';
--   -- JAKED present, section='coming_soon'; 9 rows total
