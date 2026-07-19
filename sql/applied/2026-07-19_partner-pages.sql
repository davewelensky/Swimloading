-- ================================================================
-- SwimLoading — Migration Template
-- ================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM _project_identity
    WHERE key = 'project_name' AND value = 'swimloading'
  ) THEN
    RAISE EXCEPTION 'WRONG PROJECT — MIGRATION ABORTED (expected swimloading / szgkzuswelntnevobnoh)';
  END IF;
  RAISE NOTICE '✅ Project identity confirmed: swimloading (szgkzuswelntnevobnoh)';
END $$;

-- ================================================================
-- Migration: 2026-07-19_partner-pages.sql
-- ================================================================

-- Purpose:
--   /dave's hardcoded "Partner Pages" list was missing 4 of 8 live
--   partner pages (eo, BlueSeventy, Blu Smooth, THEMAGIC5, FORM, TRIHARD
--   overlap check — actually missing eo/BlueSeventy/Blu Smooth/FORM/TRIHARD,
--   had only Maurten/SiS/Blu Smooth/THEMAGIC5 hardcoded, itself stale).
--   PARTNERS.md is the real source of truth but is deliberately excluded
--   from the deployed bundle (.vercelignore *.md, security decision D8) —
--   no server-side code can read it at runtime. This table is the queryable
--   mirror /dave needs; PARTNERS.md remains the source of truth for full
--   commercial detail, this table only carries what /dave needs to link out.

-- Requested by:
--   Dave, 2026-07-19 — "we have offered 3 swimmers access to this,
--   let's make it worth it" (extended to partners in the same rebuild)

-- ----------------------------------------------------------------
-- PRE-CHECKS
-- ----------------------------------------------------------------
-- SELECT count(*) FROM information_schema.tables WHERE table_name='partner_pages'; -- expect 0

-- ----------------------------------------------------------------
-- BACKUP — not required, new table only.
-- ----------------------------------------------------------------

BEGIN;

CREATE TABLE partner_pages (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  hero_page   text NOT NULL,        -- e.g. /partners/maurten
  section     text NOT NULL CHECK (section IN ('active', 'coming_soon')),
  status_note text,
  sort_order  int NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE partner_pages IS
  'Queryable mirror of PARTNERS.md "Active Partners" + "Coming Soon Partners" sections, for /dave to render live. PARTNERS.md stays the source of truth for full commercial detail — this table exists ONLY because *.md files are excluded from the deployed bundle (.vercelignore) and cannot be read at runtime. Update both when a partner is added/removed.';

ALTER TABLE partner_pages ENABLE ROW LEVEL SECURITY;

CREATE POLICY pp_dave_all ON partner_pages
  FOR ALL USING (auth.email() = 'dave.welensky@gmail.com')
  WITH CHECK (auth.email() = 'dave.welensky@gmail.com');

INSERT INTO partner_pages (name, hero_page, section, status_note, sort_order) VALUES
  ('Maurten × Art of Endurance', '/partners/maurten',     'active',      'Active partner — 9-month commitment confirmed', 1),
  ('Science in Sport (SiS)',     '/partners/sis',         'active',      'Active partner — prizes shipped, discount code pending', 2),
  ('eo SwimBETTER',              '/partners/eolab',       'active',      'Active partner — hero page live', 3),
  ('BlueSeventy UK',             '/partners/blueseventy', 'active',      'Active partner — hero page live', 4),
  ('Blu Smooth',                 '/partners/blu-smooth',  'coming_soon', 'Partnership confirmed — terms being agreed', 5),
  ('THEMAGIC5',                  '/partners/magic5',      'coming_soon', 'Partnership confirmed — portal and discount code being set up', 6),
  ('FORM',                       '/partners/form',        'coming_soon', 'Partnership confirmed (Jul 2026) — details being finalised', 7),
  ('TRIHARD',                    '/partners/trihard',     'coming_soon', 'Presenting sponsor, The Great UK Swim Spot Challenge', 8);

COMMIT;

-- ----------------------------------------------------------------
-- ROLLBACK
-- ----------------------------------------------------------------
-- DROP TABLE IF EXISTS partner_pages;

-- ----------------------------------------------------------------
-- VERIFY
-- ----------------------------------------------------------------
-- SELECT name, hero_page, section FROM partner_pages ORDER BY sort_order; -- expect 8 rows
