-- ================================================================
-- SwimLoading — Migration
-- The safety block hard-fails if you are in the wrong project.
-- ================================================================

-- ⚠️  SAFETY CHECK — runs first, aborts everything if wrong project
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM _project_identity
    WHERE key = 'project_name' AND value = 'swimloading'
  ) THEN
    RAISE EXCEPTION 'WRONG PROJECT - migration aborted. Expected swimloading (szgkzuswelntnevobnoh).';
  END IF;
  RAISE NOTICE 'Project identity confirmed: swimloading';
END $$;

-- ================================================================
-- Migration: 2026-10-04_partner-cards-from-database.sql
-- Process:   see MIGRATIONS.md
-- ================================================================

-- Purpose:
--   Make the welcome-page partner cards data-driven. Add the card fields to partner_pages (logo, chip, blurb, link label,
--   homepage order, show flag), copy the TEN cards exactly as they are on welcome.html today into those columns (nine partners
--   plus the "new sponsors" placeholder), and let the PUBLIC read ONLY the card columns of rows marked show_on_home.
--   A new partner then appears on the homepage by adding/editing one row, with no edit to welcome.html.

-- Requested by:
--   Dave (4 Oct 2026: "this should always grow as partners join").

-- Privacy design (why column grants, not a view):
--   partner_pages holds internal notes (status_note, e.g. "prizes shipped, discount code pending"). The public must never read them.
--   anon today has table-wide privileges and is kept out only by the row policy pp_dave_all. We REVOKE anon's table privileges and
--   GRANT it SELECT on the card columns only (plus show_on_home itself, which the row policy reads), plus a row policy limited to show_on_home. status_note, sort_order, id and the
--   timestamps are NOT readable by anon. authenticated/service_role are unchanged (Dave keeps full access via pp_dave_all).
--   No SECURITY DEFINER view is created.

-- Pre-checks (read-only, run 4 Oct 2026 before writing this file):
--   partner_pages: 9 rows, RLS on, one policy pp_dave_all (ALL, email = Dave). ACL: anon/authenticated/service_role = arwdDxtm.
--   hero_page is NOT NULL and section CHECK in (active, coming_soon): the placeholder row uses hero_page = '' and section coming_soon.
--   Only reader of partner_pages in the codebase is admin.html (Dave, authenticated). No anon reader exists.

-- Backup (UPDATE => required): _bak_20261004_partner_pages (copy of all 9 rows before the change).

-- ----------------------------------------------------------------
-- MIGRATION — applied only after Dave types "apply".
-- ----------------------------------------------------------------
BEGIN;

CREATE TABLE _bak_20261004_partner_pages AS SELECT * FROM partner_pages;

ALTER TABLE partner_pages
  ADD COLUMN show_on_home boolean NOT NULL DEFAULT false,
  ADD COLUMN home_order   integer,
  ADD COLUMN logo_url     text,
  ADD COLUMN logo_alt     text,
  ADD COLUMN logo_style   text,
  ADD COLUMN logo_text    text,
  ADD COLUMN chip_state   text CHECK (chip_state IN ('live', 'soon', 'done')),
  ADD COLUMN chip_label   text,
  ADD COLUMN blurb        text,
  ADD COLUMN cta_label    text;

-- the ten cards, exactly as on welcome.html today
UPDATE partner_pages SET show_on_home = true, home_order = 1,
  logo_url = $q$/icons/Maurten logo.jpg$q$, logo_alt = $q$Maurten$q$, logo_style = $q$height:32px;width:auto;border-radius:4px;$q$, logo_text = NULL,
  chip_state = $q$live$q$, chip_label = $q$Live$q$, blurb = $q$Precision sports nutrition: gels and drinks engineered to fuel long open water swims without GI distress.$q$, cta_label = $q$Explore Maurten$q$
 WHERE hero_page = $q$/partners/maurten$q$;
UPDATE partner_pages SET show_on_home = true, home_order = 2,
  logo_url = $q$/icons/sis-logo-stacked.png$q$, logo_alt = $q$Science in Sport$q$, logo_style = $q$height:36px;width:auto;filter:brightness(1.3);$q$, logo_text = NULL,
  chip_state = $q$live$q$, chip_label = $q$Live$q$, blurb = $q$Science in Sport: evidence-based nutrition trusted by elite athletes. Gels, hydration and recovery for every swim.$q$, cta_label = $q$Explore SiS$q$
 WHERE hero_page = $q$/partners/sis$q$;
UPDATE partner_pages SET show_on_home = true, home_order = 3,
  logo_url = $q$/icons/blu-smooth-logo.png$q$, logo_alt = $q$Blu Smooth$q$, logo_style = $q$height:36px;width:auto;$q$, logo_text = NULL,
  chip_state = $q$live$q$, chip_label = $q$Live$q$, blurb = $q$Blu Smooth wetsuits designed for open water swimmers. Warm, fast and built for South African conditions.$q$, cta_label = $q$Explore Blu Smooth$q$
 WHERE hero_page = $q$/partners/blu-smooth$q$;
UPDATE partner_pages SET show_on_home = true, home_order = 4,
  logo_url = NULL, logo_alt = NULL, logo_style = NULL, logo_text = $q$THEMAGIC5$q$,
  chip_state = $q$live$q$, chip_label = $q$Live$q$, blurb = $q$Custom-fit goggles built from a 3D scan of your face. No more leaks, no more pressure, no more compromises.$q$, cta_label = $q$Explore THEMAGIC5$q$
 WHERE hero_page = $q$/partners/magic5$q$;
UPDATE partner_pages SET show_on_home = true, home_order = 5,
  logo_url = $q$/partners/BLUE70_FULLCOLOR.png$q$, logo_alt = $q$BlueSeventy UK$q$, logo_style = $q$height:38px;width:auto;$q$, logo_text = NULL,
  chip_state = $q$live$q$, chip_label = $q$15% UK Discount$q$, blurb = $q$Member Benefit Partner: 15% off goggles, training wetsuits and open water gear for members in the UK & Channel Islands.$q$, cta_label = $q$Explore BlueSeventy$q$
 WHERE hero_page = $q$/partners/blueseventy$q$;
UPDATE partner_pages SET show_on_home = true, home_order = 6,
  logo_url = $q$/partners/trihard-logo-white.png$q$, logo_alt = $q$TRIHARD$q$, logo_style = $q$height:26px;width:auto;$q$, logo_text = NULL,
  chip_state = $q$soon$q$, chip_label = $q$UK/EU Challenge$q$, blurb = $q$Pre- and post-swim skincare built for open water athletes: chlorine protection, sun defence and salt recovery. Presenting sponsor of The Great UK Swim Spot Challenge.$q$, cta_label = $q$Preview TRIHARD$q$
 WHERE hero_page = $q$/partners/trihard$q$;
UPDATE partner_pages SET show_on_home = true, home_order = 7,
  logo_url = $q$/partners/eo-logo-white.png$q$, logo_alt = $q$eo SwimBETTER$q$, logo_style = $q$height:28px;width:auto;$q$, logo_text = NULL,
  chip_state = $q$soon$q$, chip_label = $q$Aug – Oct 2026$q$, blurb = $q$"The missing link between swimming harder and swimming faster is knowing what to change." Used by Kyle Chalmers, 14 national federations and 50+ NCAA colleges.$q$, cta_label = $q$Preview eo SwimBETTER$q$
 WHERE hero_page = $q$/partners/eolab$q$;
UPDATE partner_pages SET show_on_home = true, home_order = 8,
  logo_url = NULL, logo_alt = NULL, logo_style = NULL, logo_text = $q$FORM$q$,
  chip_state = $q$soon$q$, chip_label = $q$Coming Soon$q$, blurb = $q$Smart swim goggles with a heads-up display: your pace, distance and stroke metrics in your line of sight. Member discounts and a Smart Swim 2 prize on the way.$q$, cta_label = $q$Preview FORM$q$
 WHERE hero_page = $q$/partners/form$q$;
UPDATE partner_pages SET show_on_home = true, home_order = 9,
  logo_url = $q$/icons/jaked-logo.png$q$, logo_alt = $q$JAKED$q$, logo_style = NULL, logo_text = NULL,
  chip_state = $q$soon$q$, chip_label = $q$Kit Arrived$q$, blurb = $q$Italian performance swimwear: open water wetsuits, competition suits and goggles built on research and innovation. Sponsoring SwimLoading's own Carina Bruwer, whose kit arrived in September 2026 and who is now swimming in it.$q$, cta_label = $q$Preview JAKED$q$
 WHERE hero_page = $q$/partners/jaked$q$;

INSERT INTO partner_pages (name, hero_page, section, status_note, sort_order, show_on_home, home_order, logo_text, chip_state, chip_label, blurb)
VALUES ('New sponsors (unnamed placeholder)', '', 'coming_soon', 'Placeholder card until the two new sponsors are agreed and named. Replace with real rows then.', 99, true, 10,
  $q$NEW SPONSORS$q$, $q$soon$q$, $q$Coming Soon$q$, $q$Two new sponsors are landing soon, one for skincare and one for recovery. We will name them as soon as the details are settled.$q$);

-- public read: card columns of homepage rows only
REVOKE ALL ON partner_pages FROM anon;
GRANT SELECT (name, hero_page, logo_url, logo_alt, logo_style, logo_text, chip_state, chip_label, blurb, cta_label, home_order, show_on_home)
  ON partner_pages TO anon;
CREATE POLICY pp_anon_home_cards ON partner_pages FOR SELECT TO anon USING (show_on_home = true);

COMMIT;

-- ----------------------------------------------------------------
-- ROLLBACK
-- ----------------------------------------------------------------
--   DROP POLICY pp_anon_home_cards ON partner_pages;
--   REVOKE ALL ON partner_pages FROM anon;  GRANT ALL ON partner_pages TO anon;   -- the original default grants
--   DELETE FROM partner_pages WHERE hero_page = '' AND name LIKE 'New sponsors%';
--   ALTER TABLE partner_pages DROP COLUMN show_on_home, DROP COLUMN home_order, DROP COLUMN logo_url, DROP COLUMN logo_alt,
--     DROP COLUMN logo_style, DROP COLUMN logo_text, DROP COLUMN chip_state, DROP COLUMN chip_label, DROP COLUMN blurb, DROP COLUMN cta_label;
--   (original 9 rows are also in _bak_20261004_partner_pages)

-- ----------------------------------------------------------------
-- VERIFY — run on the READ-ONLY connection AFTER applying.
-- ----------------------------------------------------------------
--   SELECT count(*) FROM partner_pages;                                   -- expect 10 (9 partners + placeholder)
--   SELECT count(*) FROM partner_pages WHERE show_on_home;                -- expect 10
--   SELECT home_order, name, chip_state, chip_label FROM partner_pages WHERE show_on_home ORDER BY home_order;  -- 10 rows, order 1..10
--   SELECT count(*) FROM _bak_20261004_partner_pages;                     -- expect 9
--   -- as the public (anon key): GET /rest/v1/partner_pages?select=name,blurb,home_order&order=home_order  -> 10 rows
--   -- as the public: GET /rest/v1/partner_pages?select=status_note  -> permission denied (the internal notes are not readable)
