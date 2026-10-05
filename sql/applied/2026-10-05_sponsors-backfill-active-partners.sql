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
-- Migration: 2026-10-05_sponsors-backfill-active-partners.sql
-- Process:   see MIGRATIONS.md
-- ================================================================

-- Purpose:
--   The live partners (Maurten, SiS, eo SwimBETTER, Blu Smooth, THEMAGIC5, FORM, JAKED)
--   have no row in growth_sponsors, so the CRM does not reflect who the partners actually
--   are. Create them, using ONLY facts stated in PARTNERS.md (as of 5 Oct 2026). Anything
--   PARTNERS.md marks [UNCONFIRMED]/[TBD] is left NULL. No financial values, exclusivity
--   or dates are inferred. Also link the two partners that already have rows (Blue70 UK,
--   Trihard) to their partner_pages row, and give SiS/JAKED their second contacts.
-- Requested by: Dave (approved plan 5 Oct 2026, stage 6 of 10). Requires
--   2026-10-05_sponsors-commercial-schema.sql to be applied first.

-- ----------------------------------------------------------------
-- PRE-CHECKS (read-only)
-- ----------------------------------------------------------------
-- SELECT count(*) FROM growth_sponsors;   -- expect 93
-- SELECT sponsor_name FROM growth_sponsors WHERE lower(sponsor_name) ~ '(maurten|science in sport|^sis$|eo swimbetter|blu smooth|magic5|^form$|jaked)';  -- expect 0 rows (else those would be skipped, not duplicated)
-- SELECT sponsor_name, partner_page_id FROM growth_sponsors WHERE sponsor_name IN ('Blue70 UK','Trihard');  -- expect 2 rows, partner_page_id NULL (the only UPDATEs below)

-- ----------------------------------------------------------------
-- BACKUP — the migration UPDATEs two existing rows, so copy the table first.
-- ----------------------------------------------------------------
-- The backup table _bak_20261005_growth_sponsors was already created by
-- 2026-10-05_sponsors-commercial-schema.sql (before any change), so it holds the true pre-migration state.
BEGIN;

-- ----------------------------------------------------------------
-- MIGRATION — applied only after Dave types "apply".
-- ----------------------------------------------------------------

-- Link existing rows to their public partner page (partner_page_id only).
UPDATE public.growth_sponsors SET partner_page_id = (SELECT id FROM public.partner_pages WHERE hero_page = '/partners/blueseventy')
 WHERE sponsor_name = 'Blue70 UK' AND partner_page_id IS NULL;
UPDATE public.growth_sponsors SET partner_page_id = (SELECT id FROM public.partner_pages WHERE hero_page = '/partners/trihard')
 WHERE sponsor_name = 'Trihard' AND partner_page_id IS NULL;

-- New rows. Idempotent: skipped if a sponsor of that name already exists.
INSERT INTO public.growth_sponsors
  (sponsor_name, country, category, status, website, contact_name, contact_email, instagram,
   proposed_offer, member_benefit, athlete_involvement, next_action, notes, partner_page_id)
SELECT v.sponsor_name, v.country, v.category, v.status, v.website, v.contact_name, v.contact_email, v.instagram,
       v.proposed_offer, v.member_benefit, v.athlete_involvement, v.next_action, v.notes,
       (SELECT id FROM public.partner_pages WHERE hero_page = v.hero_page)
FROM (VALUES
  ('Maurten', 'SA', 'Nutrition', 'Confirmed', 'https://artofendurance.co.za', 'Charl (Art of Endurance)', NULL,
   'https://www.instagram.com/artofendurance/',
   'Monthly challenge prize: Maurten gels + merchandise, supplied by Art of Endurance (SA Maurten distributor). 9-month commitment confirmed.',
   'Monthly prize pack; 1 winner per month by weighted random draw.',
   NULL::text, 'Tag @artofendurance on social posts; fix hero-page links to artofendurance.co.za (no www).',
   'Backfilled from PARTNERS.md 5 Oct 2026. SA only: do not imply UK/AUS users can claim prizes. Do not say "exclusively" supplied by Art of Endurance (Charl asked us to remove this). Do not publish Maurten retail prices. SwimLoading gives: partner card, hero page /partners/maurten, monthly challenge prize feature, @artofendurance tags on social.',
   '/partners/maurten'),
  ('Science in Sport', 'SA', 'Nutrition', 'Confirmed', 'https://www.scienceinsport.co.za', 'Hailey', NULL, NULL,
   'Tiered competition prizes (3 prize products for 1st/2nd/3rd + a box of gels for giveaways, shipped May 2026) and a member discount code.',
   '15% off at scienceinsport.co.za with code SWM15 (confirmed by SiS, May 2026).',
   NULL, 'Verify which URL to link members to for shopping (scienceinsport.co.za vs FUELME.co.za); confirm with Chris before promoting to UK users.',
   'Backfilled from PARTNERS.md 5 Oct 2026. SA arrangement; SiS locally operates as FUELME.co.za. Contacts: Hailey (WhatsApp) and Chris, her manager. Do not publish the discount code on the hero page until received and tested. SwimLoading gives: partner card, hero page /partners/sis, discount code promotion to members.',
   '/partners/sis'),
  ('eo SwimBETTER', NULL, NULL, 'Confirmed', NULL, NULL, NULL, NULL,
   'Performance Challenge, 1 Aug to 31 Oct 2026: prize of a handset + 1-year Gold Membership + expert session (US$1,349 value, as confirmed by Dave 29 Jul 2026).',
   'Prize giveaway through SwimLoading (Performance Challenge, 1 Aug to 31 Oct 2026).',
   NULL, 'Confirm full commercial terms, contact name and geography.',
   'Backfilled from PARTNERS.md 5 Oct 2026 from the live hero page only. Geography, contact and commercial terms are UNCONFIRMED in PARTNERS.md and are left blank here.',
   '/partners/eolab'),
  ('Blu Smooth', 'SA', 'Wetsuits & open water kit', 'Confirmed', NULL, 'Kevin Richards (founder)', NULL, NULL,
   'SA winter competition prize: MK2 wetsuit, run as the July 2026 "Winter Warrior" monthly challenge (completed; winner drawn and verified).',
   'Winter competition prize (July 2026, completed).',
   NULL, 'Follow-up WhatsApp drafted 14 Sep 2026, awaiting Dave to send: confirm website (blusmooth.com vs blusmooth.co.za), MK2 specs/price, UK partnership scope, SA team introduction.',
   'Backfilled from PARTNERS.md 5 Oct 2026. Primary geography SA; Kevin is UK-based and interested in a UK/Europe partnership. Website is unresolved in PARTNERS.md (blusmooth.com vs blusmooth.co.za) so left blank. Prices on the hero page are unconfirmed. Do not add MK2 to the hero page until specs and price are confirmed.',
   '/partners/blu-smooth'),
  ('THEMAGIC5', NULL, 'Goggles & swim training tools', 'Confirmed', 'https://themagic5.com', 'Jake Morden', NULL, NULL,
   'SwimLoading member portal with a year-round discount; product giveaways for competitions depending on partner activity. SwimLoading gives logo on newsletter/social, 3-4 newsletter or group-chat mentions a year, and a monthly prize feature.',
   '30% off year-round via a dedicated SwimLoading member portal (45-50% during promotions). Portal URL / code still TBD.',
   NULL, 'Reply to Jake on what the monthly leaderboard prize means; receive the portal URL/discount code; agree the first newsletter mention.',
   'Backfilled from PARTNERS.md 5 Oct 2026. Ships globally from Denmark. Prices not published; direct users to themagic5.com. Brand colours are cyan/blue, not gold. Country left blank (international).',
   '/partners/magic5'),
  ('FORM', NULL, 'Goggles & swim training tools', 'Confirmed', 'https://www.formswim.com', 'Timmy', NULL, NULL,
   'Member discounts on FORM goggles and a prize pair of FORM Smart Swim 2 goggles. Percentage, code/portal, geography, challenge/month and mechanics are all TBD with Timmy.',
   NULL,
   NULL, 'Get from Timmy: discount %/code or portal, geography, prize timing and mechanics, logo assets, preferred copy.',
   'Backfilled from PARTNERS.md 5 Oct 2026. Partnership confirmed Jul 2026, details still being finalised. Timmy surname/contact details TBD. Do not publish FORM prices. FORM ships worldwide but SwimLoading discount/prize geography is unconfirmed.',
   '/partners/form'),
  ('JAKED', NULL, 'Swimwear & kit', 'In Discussion', 'https://www.jaked.com/en', 'Edoardo "Eddie" Galbiati (Miriade SpA)', 'egalbiati@miriadespa.it', NULL,
   'Hero page documenting Carina Bruwer''s journey with JAKED; community engagement and engagement reporting for JAKED. Formal commercial terms beyond this are TBD (Dave''s 3 Aug 2026 pitch is the working basis, not yet agreed).',
   NULL,
   'Sponsors Carina Bruwer (SwimLoading athlete) with product, not cash. Kit shipped, due Sept 2026; ships direct from Italy to Carina.',
   'Chase Eddie for high-res logos, photography, product images and brand guidelines; confirm formal commercial terms and geography.',
   'Backfilled from PARTNERS.md 5 Oct 2026. Status set to In Discussion rather than Confirmed because PARTNERS.md says formal commercial terms are not yet agreed (the Carina sponsorship itself is confirmed). Member benefits are TBD. Eddie also cc''s Lilia Vassilieva. Engagement tracking live 4 Oct 2026 at /partner-stats?partner=jaked.',
   '/partners/jaked')
) AS v(sponsor_name, country, category, status, website, contact_name, contact_email, instagram,
       proposed_offer, member_benefit, athlete_involvement, next_action, notes, hero_page)
WHERE NOT EXISTS (SELECT 1 FROM public.growth_sponsors g WHERE lower(g.sponsor_name) = lower(v.sponsor_name));

-- Second contacts stated in PARTNERS.md.
INSERT INTO public.sponsor_contacts (growth_sponsor_id, name, role, email)
SELECT g.id, c.name, c.role, c.email
FROM (VALUES
  ('Science in Sport', 'Chris', 'Hailey''s manager', NULL::text),
  ('JAKED', 'Lilia Vassilieva', 'cc''d on the Miriade SpA thread', 'lvassilieva@miriadespa.it')
) AS c(sponsor_name, name, role, email)
JOIN public.growth_sponsors g ON g.sponsor_name = c.sponsor_name
WHERE NOT EXISTS (SELECT 1 FROM public.sponsor_contacts x WHERE x.growth_sponsor_id = g.id AND x.name = c.name);

COMMIT;

-- ----------------------------------------------------------------
-- ROLLBACK
-- ----------------------------------------------------------------
-- BEGIN;
-- DELETE FROM public.sponsor_contacts WHERE growth_sponsor_id IN (SELECT id FROM public.growth_sponsors WHERE sponsor_name IN ('Science in Sport','JAKED'));
-- DELETE FROM public.growth_sponsors WHERE sponsor_name IN ('Maurten','Science in Sport','eo SwimBETTER','Blu Smooth','THEMAGIC5','FORM','JAKED')
--   AND id NOT IN (SELECT id FROM public._bak_20261005_growth_sponsors);   -- only rows created by this migration
-- UPDATE public.growth_sponsors SET partner_page_id = NULL WHERE sponsor_name IN ('Blue70 UK','Trihard');
-- COMMIT;

-- ----------------------------------------------------------------
-- VERIFY (read-only, after apply)
-- ----------------------------------------------------------------
-- SELECT count(*) FROM growth_sponsors;                                  -- expect 100 (93 + 7)
-- SELECT count(*) FROM _bak_20261005_growth_sponsors;                    -- expect 93 (created by migration 1)
-- SELECT count(*) FROM growth_sponsors g JOIN _bak_20261005_growth_sponsors b USING (id)
--   WHERE (g.sponsor_name, g.status, g.notes, g.category, g.country) IS DISTINCT FROM (b.sponsor_name, b.status, b.notes, b.category, b.country);  -- expect 0 (existing rows untouched)
-- SELECT sponsor_name, status, partner_page_id IS NOT NULL linked FROM growth_sponsors WHERE sponsor_name IN ('Maurten','Science in Sport','eo SwimBETTER','Blu Smooth','THEMAGIC5','FORM','JAKED','Blue70 UK','Trihard') ORDER BY 1;  -- expect 9 rows, all linked
-- SELECT tablename, rowsecurity FROM pg_tables WHERE tablename = '_bak_20261005_growth_sponsors';  -- expect true
