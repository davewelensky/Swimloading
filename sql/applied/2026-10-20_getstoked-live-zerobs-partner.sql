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
-- Migration: 2026-10-20_getstoked-live-zerobs-partner.sql
-- Process:   see MIGRATIONS.md
-- ================================================================

-- Purpose:
--   1. Get Stoked: Sam confirmed 20 Oct 2026 that SWIMLOADING10 (10% off all products on therabody.co.za) is set up and members
--      may use it. Flip the homepage card from "Discount Coming" to live, and move the pipeline row to Confirmed.
--   2. Zero BS: partnership confirmed 20 Oct 2026 (Shade samples for the Langebaan Express goodie bags + three sports packs as
--      prizes). Turn the "New sponsors" placeholder card into the real Zero BS card and link the pipeline row to it.
--   Nothing here publishes Dave's personal one-off code, sample counts or any unconfirmed offer.

-- Requested by:
--   Dave (20 Oct 2026: update partners/sponsors for Get Stoked and add a Zero BS partner page)

-- ----------------------------------------------------------------
-- PRE-CHECKS — read-only, run BEFORE applying.
-- ----------------------------------------------------------------
-- Get Stoked card exists (expect 1):     SELECT count(*) FROM partner_pages WHERE hero_page = '/partners/getstoked';
-- Placeholder exists (expect 1):         SELECT count(*) FROM partner_pages WHERE name = 'New sponsors (unnamed placeholder)';
-- No Zero BS card yet (expect 0):        SELECT count(*) FROM partner_pages WHERE hero_page = '/partners/zerobs';
-- Pipeline rows (expect 2):              SELECT sponsor_name, status FROM growth_sponsors WHERE id IN ('556cd44c-3f53-43ea-b15d-b6395ed516ce','c672cfa2-e7cd-49d6-a639-27622790e28b');
-- Backups must not exist (expect 0, 0):  SELECT count(*) FROM pg_class WHERE relname IN ('_bak_20261020_partner_pages','_bak_20261020_growth_sponsors');
-- Rows UPDATEd: partner_pages 2, growth_sponsors 2. Rows INSERTed/DELETEd: none.

-- ----------------------------------------------------------------
-- BACKUP — required before any UPDATE.
-- ----------------------------------------------------------------
CREATE TABLE _bak_20261020_partner_pages AS
  SELECT * FROM partner_pages WHERE hero_page = '/partners/getstoked' OR name = 'New sponsors (unnamed placeholder)';
ALTER TABLE _bak_20261020_partner_pages ENABLE ROW LEVEL SECURITY;

CREATE TABLE _bak_20261020_growth_sponsors AS
  SELECT * FROM growth_sponsors WHERE id IN ('556cd44c-3f53-43ea-b15d-b6395ed516ce','c672cfa2-e7cd-49d6-a639-27622790e28b');
ALTER TABLE _bak_20261020_growth_sponsors ENABLE ROW LEVEL SECURITY;

-- ----------------------------------------------------------------
-- MIGRATION — applied only after Dave types "apply".
-- ----------------------------------------------------------------
BEGIN;

-- 1. Get Stoked card goes live.
UPDATE partner_pages
SET section     = 'active',
    chip_state  = 'live',
    chip_label  = '10% Member Code',
    blurb       = 'The official Therabody importer and distributor in South Africa. SwimLoading members get 10% off all products on therabody.co.za.',
    cta_label   = 'Explore Get Stoked',
    status_note = 'Active partner (20 Oct 2026): member code SWIMLOADING10 confirmed live by Get Stoked, 10% off all products on therabody.co.za.',
    updated_at  = now()
WHERE hero_page = '/partners/getstoked';

-- 2. Placeholder becomes the Zero BS card (same row, same home_order 11).
UPDATE partner_pages
SET name         = 'Zero BS',
    hero_page    = '/partners/zerobs',
    section      = 'active',
    status_note  = 'Confirmed 20 Oct 2026: products only. Shade samples for the Langebaan Express goodie bags + three sports packs as prizes. No member discount agreed.',
    logo_url     = NULL,
    logo_alt     = 'Zero BS',
    logo_style   = NULL,
    logo_text    = 'ZERO BS',
    chip_state   = 'live',
    chip_label   = 'New Partner',
    blurb        = 'South African tallow-based skincare. Zero BS Shade samples go into the Langebaan Express goodie bags, with sports packs as prizes.',
    cta_label    = 'Explore Zero BS',
    updated_at   = now()
WHERE name = 'New sponsors (unnamed placeholder)';

-- 3. Pipeline: Therabody confirmed.
UPDATE growth_sponsors
SET status         = 'Confirmed',
    member_benefit = 'Exclusive 10% discount for SwimLoading members on all products on therabody.co.za, code SWIMLOADING10. Confirmed live by Get Stoked (Sam, 20 Oct 2026). Published on /partners/getstoked.',
    next_action    = 'Open with Sam: (1) whether a Therabody team can attend Langebaan Express (staffing is the blocker); (2) approved claims and brand guidelines for the recovery content; (3) Theragun stock is expected back in a few weeks, revisit then; (4) Carina stays a separate conversation (Sam suggests her audience may be too international for their South Africa focus). Get the code tested at checkout.',
    updated_at     = now()
WHERE id = '556cd44c-3f53-43ea-b15d-b6395ed516ce';

-- 4. Pipeline: Zero BS confirmed and linked to its card.
UPDATE growth_sponsors
SET status          = 'Confirmed',
    partner_page_id = (SELECT id FROM partner_pages WHERE hero_page = '/partners/zerobs'),
    member_benefit  = 'No member discount agreed. Product partnership: Shade samples for the Langebaan Express goodie bags and three sports packs as prizes.',
    athlete_involvement = 'Paid athlete content (Carina / Ryan) is a separate arrangement and NOT agreed. Nicola (Zero BS) may attend Langebaan Express to capture her own content.',
    next_action     = 'Send Nicola delivery details (full name, cell number, address) and agree the sample deadline; coordinate logistics and prizes with Derrick (Big Bay Events); ask for the logo, sports pack contents, and a few extra products or caps for the registration team; confirm whether Nicola attends.',
    follow_up_date  = '2026-10-23',
    updated_at      = now()
WHERE id = 'c672cfa2-e7cd-49d6-a639-27622790e28b';

COMMIT;

-- ----------------------------------------------------------------
-- POST-VERIFY — read-only.
-- ----------------------------------------------------------------
-- SELECT name, section, chip_label, home_order, hero_page FROM partner_pages WHERE hero_page IN ('/partners/getstoked','/partners/zerobs');   -- expect 2 active rows
-- SELECT sponsor_name, status, partner_page_id FROM growth_sponsors WHERE id IN ('556cd44c-3f53-43ea-b15d-b6395ed516ce','c672cfa2-e7cd-49d6-a639-27622790e28b');   -- expect 2 Confirmed, Zero BS linked
-- SELECT count(*) FROM _bak_20261020_partner_pages;      -- expect 2
-- SELECT count(*) FROM _bak_20261020_growth_sponsors;    -- expect 2
-- SELECT relname, relrowsecurity FROM pg_class WHERE relname LIKE '_bak_20261020_%';   -- expect both true

-- ----------------------------------------------------------------
-- ROLLBACK — restore from the backups.
-- ----------------------------------------------------------------
-- UPDATE partner_pages p SET section=b.section, chip_state=b.chip_state, chip_label=b.chip_label, blurb=b.blurb, cta_label=b.cta_label,
--   status_note=b.status_note, name=b.name, hero_page=b.hero_page, logo_url=b.logo_url, logo_alt=b.logo_alt, logo_style=b.logo_style, logo_text=b.logo_text
--   FROM _bak_20261020_partner_pages b WHERE p.id=b.id;
-- UPDATE growth_sponsors g SET status=b.status, member_benefit=b.member_benefit, next_action=b.next_action, athlete_involvement=b.athlete_involvement,
--   partner_page_id=b.partner_page_id, follow_up_date=b.follow_up_date FROM _bak_20261020_growth_sponsors b WHERE g.id=b.id;
