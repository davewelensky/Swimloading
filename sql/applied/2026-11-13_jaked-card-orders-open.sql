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
-- Migration: 2026-11-13_jaked-card-orders-open.sql
-- Process:   see MIGRATIONS.md — no section below may be left empty
-- ================================================================

-- Purpose:
--   The homepage JAKED card still says "Kit Arrived" / "Preview JAKED" and is styled as coming soon.
--   The JAKED page now takes wetsuit and costume order enquiries, so the card says "Orders open" / "Shop JAKED"
--   and drops the stale "kit arrived in September" line. Only the four card columns change. `section` and
--   `status_note` (read by the admin partner report) are deliberately left alone.

-- APPLIED 13 Nov 2026 via supabase-admin after Dave typed "apply". Verified read-only: row now live | Orders open | Shop JAKED,
-- backup _bak_20261113_partner_pages_jaked has 1 row with RLS on, no other partner row touched, live homepage shows the new card.

-- Requested by:
--   Dave (13 Nov 2026: "update the homepage card wording and apply")

-- ----------------------------------------------------------------
-- PRE-CHECKS — read-only, run before applying (13 Nov 2026).
-- ----------------------------------------------------------------
-- SELECT count(*) FROM partner_pages WHERE hero_page = '/partners/jaked';      -- result: 1
-- SELECT id, chip_state, chip_label, cta_label FROM partner_pages WHERE hero_page = '/partners/jaked';
--   -- result: eb8644d9-28d2-4d08-87f1-4230da07e1c5 | soon | Kit Arrived | Preview JAKED
-- Constraint: chip_state IN ('live','soon','done') — 'live' is valid.
-- No triggers on partner_pages. No existing table named _bak_20261113_partner_pages_jaked.

-- ----------------------------------------------------------------
-- MIGRATION — applied only after Dave types "apply" (he did, 13 Nov 2026).
-- ----------------------------------------------------------------
BEGIN;

-- BACKUP — required before any UPDATE. RLS ON: a backup copies every column (incl. status_note).
CREATE TABLE _bak_20261113_partner_pages_jaked AS
  SELECT * FROM partner_pages WHERE hero_page = '/partners/jaked';
ALTER TABLE _bak_20261113_partner_pages_jaked ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF (SELECT count(*) FROM _bak_20261113_partner_pages_jaked) <> 1 THEN
    RAISE EXCEPTION 'Expected exactly 1 JAKED row in the backup, aborting';
  END IF;
END $$;

UPDATE partner_pages
   SET chip_state = 'live',
       chip_label = 'Orders open',
       cta_label  = 'Shop JAKED',
       blurb      = 'Italian performance swimwear: open water wetsuits, competition suits and goggles built on research and innovation. Sponsoring SwimLoading''s own Carina Bruwer, now swimming in her JAKED kit. Order a wetsuit or costume through SwimLoading.',
       updated_at = now()
 WHERE id = 'eb8644d9-28d2-4d08-87f1-4230da07e1c5'
   AND hero_page = '/partners/jaked';

DO $$
BEGIN
  IF (SELECT count(*) FROM partner_pages WHERE hero_page = '/partners/jaked' AND chip_label = 'Orders open') <> 1 THEN
    RAISE EXCEPTION 'JAKED card update did not land on exactly 1 row, aborting';
  END IF;
END $$;

COMMIT;

-- ----------------------------------------------------------------
-- ROLLBACK — exact SQL to undo:
-- ----------------------------------------------------------------
-- UPDATE partner_pages p
--    SET chip_state = b.chip_state, chip_label = b.chip_label, cta_label = b.cta_label,
--        blurb = b.blurb, updated_at = b.updated_at
--   FROM _bak_20261113_partner_pages_jaked b
--  WHERE p.id = b.id;

-- ----------------------------------------------------------------
-- VERIFY — run on the READ-ONLY connection AFTER applying.
-- ----------------------------------------------------------------
-- SELECT chip_state, chip_label, cta_label, left(blurb, 60) FROM partner_pages WHERE hero_page = '/partners/jaked';
--   -- expect: live | Orders open | Shop JAKED | Italian performance swimwear: open water wetsuits, ...
-- SELECT count(*) FROM _bak_20261113_partner_pages_jaked;                                  -- expect: 1
-- SELECT relrowsecurity FROM pg_class WHERE relname = '_bak_20261113_partner_pages_jaked'; -- expect: true
