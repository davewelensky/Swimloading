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
-- Migration: 2026-11-18_jaked-product-images.sql
-- Process:   see MIGRATIONS.md — no section below may be left empty
-- STATUS:    PROPOSED 18 Nov 2026. Awaiting the literal word "apply".
-- DEPENDS ON: sql/applied/2026-11-18_jaked-business-store.sql (and the role migrations)
-- ================================================================

-- Purpose:
--   Private product photos for the JAKED Business workspace. 46 of the 122
--   priced products had no photo in JAKED's public feed; Dave supplied the
--   JAKED FW26-27 catalogues (Racing, Swim part 1, Swim part 2). 41 products
--   were matched to a catalogue photo page by EXACT product code (no fuzzy
--   matching) and cropped to the product images. The photos are supplier
--   material, so they live only in this table (JAKED team read-only, written
--   by migrations only) and are loaded by the page per product, on demand —
--   never committed to the public repo. The data itself is loaded by a
--   separate private file (record: sql/2026-11-18_jaked-product-images-load.record.sql).

-- Requested by:
--   Dave, 18 Nov 2026 ("Fill missing photos" from the uploaded catalogues).

-- ----------------------------------------------------------------
-- PRE-CHECKS — run on the READ-ONLY connection BEFORE applying.
-- ----------------------------------------------------------------
-- select to_regclass('public.jaked_business_product_images');   -- expect NULL
-- select to_regprocedure('public.can_manage_partner(uuid)') is not null; -- expect true

-- ----------------------------------------------------------------
-- BACKUP — not applicable: one new, empty table.
-- ----------------------------------------------------------------

-- ----------------------------------------------------------------
-- MIGRATION — applied only after Dave types "apply".
-- ----------------------------------------------------------------
BEGIN;

CREATE TABLE jaked_business_product_images (
  sku          text        PRIMARY KEY CHECK (char_length(sku) BETWEEN 3 AND 40),
  data_url     text        NOT NULL CHECK (data_url ~ '^data:image/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$'
                                           AND char_length(data_url) <= 400000),
  source       text        NOT NULL CHECK (char_length(source) BETWEEN 1 AND 200),   -- catalogue + page, e.g. 'JAKED Racing FW26-27 p46'
  match_basis  text        NOT NULL DEFAULT 'exact product code' CHECK (match_basis = 'exact product code'),
  created_at   timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE jaked_business_product_images IS
  'Private JAKED product photos cropped from the supplier FW26-27 catalogues, '
  'matched to price-list SKUs by exact product code. JAKED team read-only; '
  'written by migrations only. Supplier material: never commit to git.';

ALTER TABLE jaked_business_product_images ENABLE ROW LEVEL SECURITY;
CREATE POLICY jaked_business_product_images_team_read ON jaked_business_product_images
  FOR SELECT TO authenticated
  USING ((SELECT can_manage_partner(jaked_partner_id())));
REVOKE ALL ON jaked_business_product_images FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON jaked_business_product_images FROM authenticated;

COMMIT;

-- ----------------------------------------------------------------
-- ROLLBACK
-- ----------------------------------------------------------------
-- BEGIN; DROP TABLE IF EXISTS jaked_business_product_images; COMMIT;
-- (The photos can be re-loaded from the private load file.)

-- ----------------------------------------------------------------
-- VERIFY — run on the READ-ONLY connection AFTER applying.
-- ----------------------------------------------------------------
-- 1. select relrowsecurity from pg_class where relname = 'jaked_business_product_images'; -- expect true
-- 2. select count(*) from jaked_business_product_images;                                  -- expect 0 (data loads next)
-- 3. select has_table_privilege('anon','public.jaked_business_product_images','SELECT'),
--           has_table_privilege('authenticated','public.jaked_business_product_images','INSERT'); -- expect false, false
