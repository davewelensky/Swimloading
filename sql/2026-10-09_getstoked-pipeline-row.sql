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
-- Migration: 2026-10-09_getstoked-pipeline-row.sql   (PENDING: not yet requested for apply)
-- Process:   see MIGRATIONS.md — no section below may be left empty
-- ================================================================

-- Purpose:
--   Record the terms Sam confirmed in her email on the Therabody pipeline row and link it to the new partner_pages card.
--   Run AFTER 2026-10-09_getstoked-partner-page.sql (it looks the card up by hero_page).

-- Requested by:
--   Dave (not yet asked to apply)

-- ----------------------------------------------------------------
-- PRE-CHECKS — read-only, run BEFORE applying.
-- ----------------------------------------------------------------
-- The card exists (expect 1):   SELECT count(*) FROM partner_pages WHERE hero_page = '/partners/getstoked';
-- The pipeline row exists (expect 1):  SELECT count(*) FROM growth_sponsors WHERE id = '556cd44c-3f53-43ea-b15d-b6395ed516ce';
-- Backup table must not already exist (expect 0):  SELECT count(*) FROM pg_class WHERE relname = '_bak_20261009_growth_sponsors_therabody';
-- Rows this migration will UPDATE: growth_sponsors 1.

-- ----------------------------------------------------------------
-- BACKUP — required before any UPDATE.
-- ----------------------------------------------------------------
CREATE TABLE _bak_20261009_growth_sponsors_therabody AS
  SELECT * FROM growth_sponsors WHERE id = '556cd44c-3f53-43ea-b15d-b6395ed516ce';
ALTER TABLE _bak_20261009_growth_sponsors_therabody ENABLE ROW LEVEL SECURITY;   -- holds contact details and negotiation notes: must not be API-readable

-- ----------------------------------------------------------------
-- MIGRATION
-- ----------------------------------------------------------------
BEGIN;

-- 3. Pipeline row: link it to the card and record the position after Dave's reply to Sam (sent 8 Oct 2026). Status stays
--    'In Discussion' on purpose: moving it to 'Confirmed' is Dave's call (nothing is signed and the code is not live).
UPDATE growth_sponsors
SET partner_page_id    = (SELECT id FROM partner_pages WHERE hero_page = '/partners/getstoked'),
    member_benefit     = 'Exclusive 10% discount for SwimLoading members on all Therabody products on Get Stoked''s website. Code SWIMLOADING10 chosen by Dave (reply to Sam, 8 Oct 2026). NOT live: Get Stoked still have to set it up and confirm which website it works on. Not published on the partner page until confirmed.',
    exclusivity        = 'Category agreed in principle by both sides: massage/percussion devices, compression technology and similar recovery equipment. The exclusivity arrangement itself is to be shaped after Langebaan Express. Nothing in writing.',
    athlete_involvement = 'Carina Bruwer: Sam asked for handles and audience data; Dave sent some information with his 8 Oct reply and both sides agreed to treat Carina as a separate conversation from the SwimLoading partnership. Carina swims 15 km in Durban later in Oct 2026 (event + charity), Dave observing from the boat. Dave also asked Sam about a Theragun for his own use and testing.',
    next_action        = 'Waiting on Sam: (1) confirm SWIMLOADING10 is set up and which website it works on, then test it at checkout before the page shows it; (2) whether a Therabody team can come to Langebaan Express (Nov 2026; Dave and Derrick are keen, 6 km and 12 km swimmers); (3) Therabody approved claims and brand guidelines; (4) the Theragun question; (5) the Carina athlete conversation.',
    updated_at         = now()
WHERE id = '556cd44c-3f53-43ea-b15d-b6395ed516ce';

COMMIT;

-- ----------------------------------------------------------------
-- POST-VERIFY — read-only, run after applying.
-- ----------------------------------------------------------------
-- Linked and status unchanged (expect partner_page_id not null, status 'In Discussion'):
--   SELECT status, partner_page_id, left(member_benefit, 60) FROM growth_sponsors WHERE id = '556cd44c-3f53-43ea-b15d-b6395ed516ce';
-- Backup holds the original (expect 1) and has RLS on:
--   SELECT count(*) FROM _bak_20261009_growth_sponsors_therabody;
--   SELECT relname, relrowsecurity FROM pg_class WHERE relname = '_bak_20261009_growth_sponsors_therabody';
