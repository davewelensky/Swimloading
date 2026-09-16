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
-- Migration: 2026-09-16_import-sponsors-tracker-into-growth-sponsors.sql
-- Process:   see MIGRATIONS.md — no section below may be left empty
-- STATUS:    ⛔ PROPOSED — NOT YET APPLIED. Awaiting Dave's review and
--            the literal word "apply" per MIGRATIONS.md step 4.
-- ================================================================

-- Purpose:
--   Dave pointed out there are now two sponsor-prospect tools —
--   Sponsors/index.html (a static, 89-entry curated brand list, no DB,
--   local-file-only) and a separate sponsors-admin_1.html (a real,
--   RLS-authed live CRM backed by growth_sponsors) — and asked to combine
--   them into one page. growth_sponsors already has 19 real, live rows
--   with genuine outreach history (Lindi's UK contacts since Jun 2026,
--   plus a researched SA push on 15 Sep 2026), so it is the tool actually
--   in use; the static file is the wishlist it was partly drawn from.
--
--   This migration imports the 74 entries from Sponsors/index.html that
--   are NOT already tracked in growth_sponsors, as new 'Idea'-status
--   rows, so nothing from that research is lost once the static file is
--   retired. Excluded from the 89 total:
--     - 10 already live in growth_sponsors under a different exact
--       string (Red Equipment, Swimtrek, Garmin, Hyperice, Therabody,
--       FINIS, Sealand Gear, Stream2Sea, Island Tribe, DJI) — matched by
--       brand name 14–15 Sep 2026, left alone here to avoid clobbering
--       their real status/notes.
--     - 5 "Women's leadership (Carina only)" entries (Investec, Discovery,
--       Santam, Old Mutual, Nedbank) — explicitly marked in their own
--       notes as "for Carina personally, not SwimLoading" and already
--       tracked in PARTNERS.md's Carina Tier 6. Out of scope for this
--       SwimLoading-branded sponsor pipeline.
--
--   country is set to 'SA' where the source entry carried an 'sa' tag,
--   'UK' otherwise (matches the column's own default and this tracker's
--   original UK-expansion framing). notes append the original tags and
--   an import attribution line for traceability.

-- Requested by:
--   Dave, 16 Sept 2026

-- ----------------------------------------------------------------
-- PRE-CHECKS — run on the READ-ONLY connection BEFORE applying.
-- ----------------------------------------------------------------
-- SELECT count(*) FROM growth_sponsors;  -- ran 16 Sep 2026: 19 (before import)
-- SELECT sponsor_name FROM growth_sponsors ORDER BY sponsor_name;
--   -- confirms none of the 74 names below already exist

-- ----------------------------------------------------------------
-- BACKUP — required before any DELETE / UPDATE / DROP / TRUNCATE.
-- ----------------------------------------------------------------
-- Not applicable — pure INSERT of 74 new rows, nothing existing is
-- touched.

-- ----------------------------------------------------------------
-- MIGRATION — applied only after Dave types "apply".
-- ----------------------------------------------------------------
BEGIN;

INSERT INTO growth_sponsors (sponsor_name, category, country, website, proposed_offer, notes, status)
VALUES
  ('TYR', 'Wetsuits & open water kit', 'SA', 'https://tyr.co.za', 'Tracer X wetsuit · R8,000–R12,000', 'SA office confirmed (tyr.co.za, +27 21 702 0238). Ambassador Simon Ince holds world record for 33km False Bay crossing (Millers Point → Rooi Els, 10:42). Easiest warm approach — already in SA. [tags: sa, verified, hot] — imported from Sponsors/index.html tracker, 16 Sep 2026.', 'Idea'),
  ('Orca', 'Wetsuits & open water kit', 'SA', 'https://fluidlines.co.za', 'Apex Flex OW wetsuit · R6,000–R9,000', 'SA distributor: Fluidlines, Greenpoint + Somerset West. Approach Fluidlines as the wholesale intro, not Orca directly. [tags: sa, verified] — imported from Sponsors/index.html tracker, 16 Sep 2026.', 'Idea'),
  ('Zone3', 'Wetsuits & open water kit', 'UK', 'https://zone3.com/pages/club-affiliate-program', 'Advance wetsuit · ~R8,000', 'Has formal Club Affiliate Programme + Clubhouse Rewards loyalty scheme — community pitch angle already built in. Approach via zone3.com/pages/club-affiliate-program. — imported from Sponsors/index.html tracker, 16 Sep 2026.', 'Idea'),
  ('Huub', 'Wetsuits & open water kit', 'UK', 'https://www.huubdesign.com', 'Axiom wetsuit · ~R8,000', 'UK open water specialist. Sponsored Ironman Wales, Channel swimmers. Strong triathlon + OW crossover. Active ambassador programme. — imported from Sponsors/index.html tracker, 16 Sep 2026.', 'Idea'),
  ('Sailfish', 'Wetsuits & open water kit', 'UK', 'https://www.sailfish.com', 'One wetsuit · ~R7,000', 'German brand, popular across European OW + triathlon circuit. Sponsors ÖTILLÖ swimrun events — community sponsorship history. — imported from Sponsors/index.html tracker, 16 Sep 2026.', 'Idea'),
  ('Roka', 'Wetsuits & open water kit', 'UK', 'https://www.roka.com/pages/ambassador-program', 'Maverick Pro wetsuit + goggles · ~R10,000', 'Premium US brand, goggles + wetsuits. Strong OW triathlon community. Active ambassador programme. Ships internationally. — imported from Sponsors/index.html tracker, 16 Sep 2026.', 'Idea'),
  ('Yonda', 'Wetsuits & open water kit', 'UK', 'https://yondasport.com', 'Ghost wetsuit · ~R7,000', 'Small UK brand built exclusively for open water swimming. Very niche, very on-brand. Approachable as a smaller company — high chance of yes. — imported from Sponsors/index.html tracker, 16 Sep 2026.', 'Idea'),
  ('Xterra Wetsuits', 'Wetsuits & open water kit', 'UK', 'https://xterrawetsuits.com', 'Vortex / Vector wetsuit · R5,000–R12,000', 'US brand, widely distributed SA + internationally. Strong OW and triathlon heritage. Good prize range from entry to grand. Widely stocked in SA triathlon retailers. — imported from Sponsors/index.html tracker, 16 Sep 2026.', 'Idea'),
  ('Camaro', 'Wetsuits & open water kit', 'UK', 'https://www.camaro.eu', 'Open water wetsuit · R4,000–R9,000', 'German neoprene/cold water brand. Some SA presence via triathlon retailers. Strong cold water credentials — good fit for Channel + crossing prep swimmers. — imported from Sponsors/index.html tracker, 16 Sep 2026.', 'Idea'),
  ('Vorgee', 'Goggles & swim training tools', 'UK', 'https://vorgee.com', 'Missile Tinted goggles · R400–R800', 'Australian goggle brand, cult OW following. Tinted lenses for outdoor glare. Lower prize value = easier volume deal. Multiple winners per month possible. — imported from Sponsors/index.html tracker, 16 Sep 2026.', 'Idea'),
  ('Aqua Sphere', 'Goggles & swim training tools', 'UK', 'https://www.aquasphereswim.com', 'Vista Open Water goggle + fin bundle · R1,500', 'Vista Open Water goggle designed specifically for OW sighting. SA retail presence. Also makes fins, bags, accessories — multiple prize tiers. — imported from Sponsors/index.html tracker, 16 Sep 2026.', 'Idea'),
  ('Swim Smooth', 'Goggles & swim training tools', 'UK', 'https://www.swimsmooth.com', 'Guru subscription + paddle set · ~R2,000', 'UK coaching platform + training tools. Pull buoys, paddles. Strong crossover with data-driven swimmers who use SwimLoading. — imported from Sponsors/index.html tracker, 16 Sep 2026.', 'Idea'),
  ('Zoggs', 'Goggles & swim training tools', 'SA', 'https://www.zoggs.com', 'Predator Flex goggles · R600–R900', 'UK brand, SA stocked at Sportsmans Warehouse. Accessible volume prize — run multiple winners per month. Good for lower-tier monthly prizes alongside bigger brand names. [tags: sa] — imported from Sponsors/index.html tracker, 16 Sep 2026.', 'Idea'),
  ('MP Michael Phelps', 'Goggles & swim training tools', 'SA', 'https://www.michaelphelps.com', 'Xceed goggles + fin bundle · R800–R2,500', 'Arena-owned brand carrying Michael Phelps name. SA retail available. Goggles + fins bundle makes a strong aspirational prize with huge name recognition. [tags: sa] — imported from Sponsors/index.html tracker, 16 Sep 2026.', 'Idea'),
  ('Kitbrix', 'Bags, kit & safety', 'UK', 'https://kitbrix.com', 'Triathlon transition bag · R2,500–R3,500', 'UK brand built for triathlon/swim kit organisation. Modular compartments for wetsuit, goggles, nutrition. No competitor offers this in SA. — imported from Sponsors/index.html tracker, 16 Sep 2026.', 'Idea'),
  ('BTTLNS', 'Bags, kit & safety', 'UK', 'https://www.bttlns.com', 'Open water kit bundle · R1,500–R2,500', 'Dutch OW accessories brand: tow floats, neoprene socks/gloves, swim caps. Full open water starter kit prize concept. — imported from Sponsors/index.html tracker, 16 Sep 2026.', 'Idea'),
  ('Swim Secure', 'Bags, kit & safety', 'UK', 'https://www.swim-secure.co.uk', 'Dry bag + tow float bundle · R1,200–R2,000', 'UK OW safety brand. Actively sponsors OW events. Tow floats are safety gear — strong narrative for SwimLoading safety-first messaging. — imported from Sponsors/index.html tracker, 16 Sep 2026.', 'Idea'),
  ('Restube', 'Bags, kit & safety', 'UK', 'https://restube.com', 'Inflatable tow float/buoy · R900–R1,500 (unverified)', 'Added 14 Sept 2026. German brand, one of the EU market leaders in inflatable tow floats/buoys for open water swimming, kayaking and SUP. Price and SA distribution unverified — confirm before outreach. [tags: new] — imported from Sponsors/index.html tracker, 16 Sep 2026.', 'Idea'),
  ('Dryrobe', 'Changing robes & warmth', 'UK', 'https://www.dryrobe.com/pages/ambassador', 'Advance Long Sleeve · R4,000–R5,500', 'The #1 open water brand globally. Every swimmer wants one. Monthly prize that gets photographed and shared — free marketing. SA market growing fast. [tags: hot] — imported from Sponsors/index.html tracker, 16 Sep 2026.', 'Idea'),
  ('Finisterre', 'Changing robes & warmth', 'UK', 'https://www.finisterre.com', 'Ocean hoodie + beanie bundle · R2,000–R3,000', 'UK ocean sustainability brand. Aligns with SwimLoading ocean-conscious values. Hoodies + beanies are year-round winner gifts. — imported from Sponsors/index.html tracker, 16 Sep 2026.', 'Idea'),
  ('Phocea', 'Changing robes & warmth', 'UK', 'https://phocea.fr', 'Changing poncho robe · R1,800–R2,500', 'French brand, Dryrobe alternative. If Dryrobe ignores outreach — similar product, more approachable as a smaller company. — imported from Sponsors/index.html tracker, 16 Sep 2026.', 'Idea'),
  ('Fourth Element', 'Changing robes & warmth', 'UK', 'https://www.fourthelement.com/pages/ambassadors', 'Thermocline thermal range · R2,500–R5,000', 'UK cold water thermal wear brand. Thermocline top + shorts designed for cold open water swimming. Niche credibility — the brand serious cold water swimmers know. No SA retail but ships internationally. — imported from Sponsors/index.html tracker, 16 Sep 2026.', 'Idea'),
  ('GoPro', 'Action cameras', 'UK', 'https://gopro.com/en/za/update/gopro', 'Hero 13 Black + waterproof mount · R7,500–R9,000', 'Robben Island and Channel crossing footage. User-generated content that lands on SwimLoading + Instagram. SA retail widely available. — imported from Sponsors/index.html tracker, 16 Sep 2026.', 'Idea'),
  ('Insta360', 'Action cameras', 'UK', 'https://www.insta360.com', 'Go 3S action cam · ~R5,000', 'Clips onto a swim cap. Tiny, lightweight, waterproof to 10m. Perfect for capturing OW footage without bulk. Growing fast in endurance sports. — imported from Sponsors/index.html tracker, 16 Sep 2026.', 'Idea'),
  ('Shokz OpenSwim / Pro', 'Audio & wearables', 'UK', 'https://shokz.com/pages/become-an-ambassador', 'Standard ~R2,700 / Pro ~R4,500', 'Bone conduction, waterproof to 2m, IP68. Pro has 32GB + Bluetooth. Designed specifically for swimming. Novel prize — no other sponsor offers this. [tags: verified] — imported from Sponsors/index.html tracker, 16 Sep 2026.', 'Idea'),
  ('Coros', 'Audio & wearables', 'UK', 'https://coros.com', 'Pace 3 with swim tracking · ~R5,500', 'Fast-growing Garmin rival. Less saturated for sponsorship. Open water swim tracking built in. SA availability improving. — imported from Sponsors/index.html tracker, 16 Sep 2026.', 'Idea'),
  ('WHOOP', 'Audio & wearables', 'UK', 'https://www.whoop.com/partnerships', '6-month membership · ~R2,400', 'Subscription prize = ongoing community tie-in, not a one-time item. Recovery-focused, waterproof. Recurring revenue model means they love ongoing partnerships. — imported from Sponsors/index.html tracker, 16 Sep 2026.', 'Idea'),
  ('TYR Swimwear', 'Swimwear & kit', 'SA', 'https://tyr.co.za', 'Tracer A+ Race suit · R1,500–R3,000', 'Same SA office (tyr.co.za). Separate from wetsuit — swimsuits, caps, accessories for lower-value monthly prizes. [tags: sa, verified] — imported from Sponsors/index.html tracker, 16 Sep 2026.', 'Idea'),
  ('Funkita / Funky Trunks', 'Swimwear & kit', 'UK', 'https://funkita.com/pages/ambassadors', 'Kit bundle · R1,000–R2,000', 'Australian brand with massive SA following. Colourful, distinctive — photographed and shared constantly. Multiple SA stockists. — imported from Sponsors/index.html tracker, 16 Sep 2026.', 'Idea'),
  ('Arena', 'Swimwear & kit', 'UK', 'https://www.arenasport.com', 'Carbon Air³ tech suit · R2,500–R5,000', 'Global brand, SA presence. Sponsors major pool events but less active in OW — opportunity to be first mover for SA open water community outreach. — imported from Sponsors/index.html tracker, 16 Sep 2026.', 'Idea'),
  ('Speedo', 'Swimwear & kit', 'UK', 'https://www.speedo.com', 'Fastskin cap + goggle + suit bundle · R1,500–R3,000', 'SA distribution strong. Sponsors Cape Long Distance events. Prize familiarity = high appeal. Bundle works at any budget tier. — imported from Sponsors/index.html tracker, 16 Sep 2026.', 'Idea'),
  ('2XU', 'Swimwear & kit', 'UK', 'https://za.2xu.com', 'Compression kit · R2,000–R4,000', 'Australian brand, SA presence. Compression tights + top — recovery wear that crosses training and everyday. Triathlon + OW community crossover. — imported from Sponsors/index.html tracker, 16 Sep 2026.', 'Idea'),
  ('De Boer', 'Swimwear & kit', 'UK', 'https://www.deboer.eu', 'Competition + training suits · R1,500–R4,000', 'Dutch/European competitive swimwear brand. Strong in European markets. Limited SA presence — approach direct for international prize shipping. Good fit for the UK/Switzerland audience expansion. — imported from Sponsors/index.html tracker, 16 Sep 2026.', 'Idea'),
  ('Turbo', 'Swimwear & kit', 'UK', 'https://www.turbosport.com', 'Tech suit + training bundle · R1,500–R5,000', 'Spanish competitive swimwear brand. Strong in Europe and LatAm, limited SA retail. Worth approaching for the growing international member base. — imported from Sponsors/index.html tracker, 16 Sep 2026.', 'Idea'),
  ('Muzinto', 'SA-specific brands', 'SA', 'https://muzinto.co.za', 'Swimwear + caps bundle · R300–R600', 'SA brand (muzinto.co.za). Affordable swimwear, caps, goggles for school/club level. Lower prize value but SA-first and easiest logistics. Good for volume prizes — multiple winners in one month. [tags: sa] — imported from Sponsors/index.html tracker, 16 Sep 2026.', 'Idea'),
  ('Precision Fuel & Hydration', 'Recovery', 'UK', 'https://www.precisionhydration.com/partner', 'Sweat test + 3-month fuel kit · R1,500–R2,500', 'UK brand dominant in OW + marathon swimming. Sweat testing offer is a killer hook — personalised fuelling plan as part of the prize. [tags: verified] — imported from Sponsors/index.html tracker, 16 Sep 2026.', 'Idea'),
  ('Compex', 'Recovery', 'UK', 'https://www.compex.com', 'SP 6.0 muscle stimulator · R5,000–R8,000', 'EMS recovery device. Less mainstream = more novelty appeal as a prize. Popular with serious endurance athletes and triathletes. — imported from Sponsors/index.html tracker, 16 Sep 2026.', 'Idea'),
  ('High5', 'Nutrition', 'UK', 'https://www.high5sport.com/pages/sponsors', 'Energy + electrolyte bundle · R800–R1,500', 'UK brand popular specifically with OW and marathon swimmers. Ships SA. Complements Maurten/SiS in a different price bracket. — imported from Sponsors/index.html tracker, 16 Sep 2026.', 'Idea'),
  ('Tailwind Nutrition', 'Nutrition', 'UK', 'https://www.tailwindnutrition.com', 'Endurance fuel + recovery bundle · R1,000–R2,000', 'US brand, all-in-one (carbs + electrolytes + amino acids). Cult following among long-distance and OW swimmers. Ships internationally. — imported from Sponsors/index.html tracker, 16 Sep 2026.', 'Idea'),
  ('SaltStick', 'Nutrition', 'UK', 'https://saltstick.com', 'Electrolyte capsule bundle · R500–R900', 'Electrolyte caps specifically for endurance sport. Trusted by marathon swimmers. Lower cost = easier gifting deal to close quickly. — imported from Sponsors/index.html tracker, 16 Sep 2026.', 'Idea'),
  ('USN (SA)', 'Nutrition', 'SA', 'https://www.usn.co.za', 'Endurance fuel + recovery bundle · R600–R1,500', 'SA brand (United Sports Nutrition). National retail presence. SA-first pitch = easiest deal to close. Ships same day, no logistics complexity. [tags: sa] — imported from Sponsors/index.html tracker, 16 Sep 2026.', 'Idea'),
  ('Zealios', 'Sunscreen & skincare', 'UK', 'https://www.zealios.com', 'V2 Triathlon sunscreen bundle · R700–R1,200', 'Stays on in water. Designed for triathletes and OW swimmers. Lower cost = high volume prize deal. US brand ships internationally. — imported from Sponsors/index.html tracker, 16 Sep 2026.', 'Idea'),
  ('Triswim', 'Sunscreen & skincare', 'UK', 'https://triswim.com', 'Swimmer hair + skincare kit · R600–R900', 'Made to remove chlorine and salt from hair and skin. Every regular open water swimmer needs this. Easy gifting arrangement. — imported from Sponsors/index.html tracker, 16 Sep 2026.', 'Idea'),
  ('Falke', 'SA-specific brands', 'SA', 'https://www.falke.com/za', 'Performance compression + sock bundle · R800–R1,500', 'Iconic SA brand with strong endurance sport presence. SA-first = fastest deal to close. Practical, desirable prize. [tags: sa, hot] — imported from Sponsors/index.html tracker, 16 Sep 2026.', 'Idea'),
  ('Biogen', 'SA-specific brands', 'SA', 'https://www.biogen.co.za', 'Sport nutrition bundle · R800–R1,500', 'SA brand, national retail. Endurance fuel + recovery stack. Easy SA logistics for lower-tier monthly prizes. [tags: sa] — imported from Sponsors/index.html tracker, 16 Sep 2026.', 'Idea'),
  ('Cape Union Mart', 'SA-specific brands', 'SA', 'https://www.capeunionmart.co.za', 'Outdoor adventure voucher · R1,000–R3,000', 'SA outdoor giant. Voucher prize = zero fulfilment complexity. Covers sunscreen, towels, beanies, wetsuits — everything swimmer-adjacent. [tags: sa] — imported from Sponsors/index.html tracker, 16 Sep 2026.', 'Idea'),
  ('H2Open Magazine', 'Outside the box', 'UK', 'https://www.h2openmagazine.com', 'Annual subscription + cross-promo', 'The definitive OW swimming publication. Cross-promotion: H2Open readers into SwimLoading; SwimLoading members into H2Open. Mutual audience, low cost to close. — imported from Sponsors/index.html tracker, 16 Sep 2026.', 'Idea'),
  ('Outdoor Swimmer Magazine', 'Outside the box', 'UK', 'https://outdoorswimmer.com', 'Co-branded prize challenge', 'Red Equipment runs prize giveaways through them right now. Approach for co-branded prize: SwimLoading + Outdoor Swimmer joint monthly challenge. Bridges SA + UK audience. [tags: hot] — imported from Sponsors/index.html tracker, 16 Sep 2026.', 'Idea'),
  ('SA Cold Plunge Facility', 'Outside the box', 'UK', NULL, 'Cold plunge session package · R1,500–R3,000', 'Cold water acclimation is central to OW training. Experiential prize at a local SA facility. Works especially well for the crossing-prep / Channel swimmer audience. — imported from Sponsors/index.html tracker, 16 Sep 2026.', 'Idea'),
  ('JOLYN', 'Swimwear & kit', 'UK', 'https://jolynswimwear.com', 'Carina swimwear sponsorship (not a monthly-challenge prize)', 'Massive female swimming audience, aggressive ambassador programme. Carina Tier 1 target — top 5 priority for her personal swimwear sponsor search. [tags: new] — imported from Sponsors/index.html tracker, 16 Sep 2026.', 'Idea'),
  ('Oceanus Swimwear', 'Swimwear & kit', 'UK', NULL, 'Carina swimwear sponsorship (not a monthly-challenge prize)', 'Luxury female swimwear. Interesting angle around female empowerment — fits Carina''s women''s-leadership positioning. [tags: new] — imported from Sponsors/index.html tracker, 16 Sep 2026.', 'Idea'),
  ('Qatar Airways', 'Travel & adventure (Crossing Africa)', 'UK', NULL, 'Flight support for Crossing Africa legs', 'Crossing Africa (Dakar/Ceuta/Aqaba/Gulf of Guinea/Walvis Bay/Maputo) is closer to expedition sponsorship than swim sponsorship. Travel support is often easier to secure than cash. [tags: new] — imported from Sponsors/index.html tracker, 16 Sep 2026.', 'Idea'),
  ('Emirates', 'Travel & adventure (Crossing Africa)', 'UK', NULL, 'Flight support for Crossing Africa legs', 'Same Crossing Africa expedition-sponsorship logic as Qatar Airways. [tags: new] — imported from Sponsors/index.html tracker, 16 Sep 2026.', 'Idea'),
  ('Ethiopian Airlines', 'Travel & adventure (Crossing Africa)', 'UK', NULL, 'Flight support for Crossing Africa legs', 'Strong pan-African route network — natural fit for a continent-spanning crossing project. [tags: new] — imported from Sponsors/index.html tracker, 16 Sep 2026.', 'Idea'),
  ('Airlink', 'Travel & adventure (Crossing Africa)', 'SA', 'https://www.flyairlink.com', 'Flight support for Crossing Africa legs', 'SA regional carrier, strong Southern/East Africa network. Also a SwimLoading-itself target (member travel behaviour). [tags: new, sa] — imported from Sponsors/index.html tracker, 16 Sep 2026.', 'Idea'),
  ('FlySafair', 'Travel & adventure (Crossing Africa)', 'SA', 'https://www.flysafair.co.za', 'Flight support for Crossing Africa legs', 'SA domestic carrier — easiest first conversation of the airline targets given local presence. [tags: new, sa] — imported from Sponsors/index.html tracker, 16 Sep 2026.', 'Idea'),
  ('Protea Hotels', 'Travel & adventure (Crossing Africa)', 'SA', NULL, 'Accommodation support for Crossing Africa', 'SA-founded hotel brand (Marriott-owned) with strong African footprint — matches the Crossing Africa route. [tags: new, sa] — imported from Sponsors/index.html tracker, 16 Sep 2026.', 'Idea'),
  ('Southern Sun', 'Travel & adventure (Crossing Africa)', 'SA', 'https://www.southernsun.com', 'Accommodation support for Crossing Africa', 'SA hotel group. Travel/accommodation support often easier to close than cash sponsorship. [tags: new, sa] — imported from Sponsors/index.html tracker, 16 Sep 2026.', 'Idea'),
  ('Marriott Bonvoy', 'Travel & adventure (Crossing Africa)', 'UK', NULL, 'Accommodation support for Crossing Africa', 'Global footprint across Crossing Africa''s route countries — one relationship could cover multiple legs. [tags: new] — imported from Sponsors/index.html tracker, 16 Sep 2026.', 'Idea'),
  ('Radisson Blu', 'Travel & adventure (Crossing Africa)', 'UK', NULL, 'Accommodation support for Crossing Africa', 'Strong African presence, same logic as Marriott Bonvoy. [tags: new] — imported from Sponsors/index.html tracker, 16 Sep 2026.', 'Idea'),
  ('Normatec', 'Recovery', 'UK', 'https://hyperice.com/normatec', 'Compression boots · check overlap with Hyperice entry above', 'NOTE: Normatec is a Hyperice product line — coordinate with the existing Hyperice entry rather than approaching separately. [tags: new] — imported from Sponsors/index.html tracker, 16 Sep 2026.', 'Idea'),
  ('Recoverite', 'Recovery', 'UK', NULL, 'Recovery nutrition bundle · R500–R900', 'Hammer Nutrition''s recovery product. Massive overlap with endurance athletes generally. [tags: new] — imported from Sponsors/index.html tracker, 16 Sep 2026.', 'Idea'),
  ('TriggerPoint', 'Recovery', 'UK', 'https://www.triggerpoint.com', 'Foam roller / mobility kit · R800–R1,500', 'Self-myofascial release tools, strong endurance-athlete crossover. [tags: new] — imported from Sponsors/index.html tracker, 16 Sep 2026.', 'Idea'),
  ('Heliocare', 'Sunscreen & skincare', 'UK', NULL, 'SPF bundle · R500–R900', 'Near-ignored category in swim sponsorship despite every swimmer needing it. [tags: new] — imported from Sponsors/index.html tracker, 16 Sep 2026.', 'Idea'),
  ('P20', 'Sunscreen & skincare', 'UK', NULL, 'SPF bundle · R400–R700', 'Once-a-day SPF, popular with endurance/outdoor athletes for all-day water exposure. [tags: new] — imported from Sponsors/index.html tracker, 16 Sep 2026.', 'Idea'),
  ('La Roche-Posay', 'Sunscreen & skincare', 'UK', NULL, 'SPF + skin recovery bundle · R600–R1,000', 'Dermatologist-brand credibility — strong fit for the "swimming is hard on skin" story. [tags: new] — imported from Sponsors/index.html tracker, 16 Sep 2026.', 'Idea'),
  ('Paul Mitchell', 'Sunscreen & skincare', 'UK', NULL, 'Swimmer hair-care bundle · R500–R900', 'Swimming destroys hair — a very credible, under-used story angle. Complements Triswim in this category. [tags: new] — imported from Sponsors/index.html tracker, 16 Sep 2026.', 'Idea'),
  ('Moroccanoil', 'Sunscreen & skincare', 'UK', NULL, 'Swimmer hair-care bundle · R500–R900', 'Same hair-damage story angle as Paul Mitchell. [tags: new] — imported from Sponsors/index.html tracker, 16 Sep 2026.', 'Idea'),
  ('Olaplex', 'Sunscreen & skincare', 'UK', NULL, 'Hair repair bundle · R800–R1,200', 'Premium hair-repair brand — strongest name recognition of the hair-care targets. [tags: new] — imported from Sponsors/index.html tracker, 16 Sep 2026.', 'Idea'),
  ('YETI', 'Outdoor & lifestyle', 'UK', NULL, 'Cooler / drinkware bundle · R2,000–R4,000', 'Dry bags, duffels, travel gear and adventure storytelling fit naturally — often an easier close than swim brands. [tags: new] — imported from Sponsors/index.html tracker, 16 Sep 2026.', 'Idea'),
  ('Stanley 1913', 'Outdoor & lifestyle', 'UK', NULL, 'Drinkware / travel gear bundle · R1,000–R2,000', 'Same lifestyle/adventure-storytelling logic as YETI. [tags: new] — imported from Sponsors/index.html tracker, 16 Sep 2026.', 'Idea'),
  ('Patagonia', 'Outdoor & lifestyle', 'UK', NULL, 'Outdoor apparel bundle · R2,000–R4,000', 'Strong ocean-conservation brand values — good story fit for SwimLoading''s ocean-conscious community. [tags: new] — imported from Sponsors/index.html tracker, 16 Sep 2026.', 'Idea'),
  ('The North Face', 'Outdoor & lifestyle', 'SA', NULL, 'Outdoor apparel bundle · R2,000–R4,000', 'Global outdoor/adventure brand, strong SA retail presence. [tags: new, sa] — imported from Sponsors/index.html tracker, 16 Sep 2026.', 'Idea'),
  ('Thule', 'Outdoor & lifestyle', 'UK', NULL, 'Travel bag / storage bundle · R1,500–R3,000', 'Premium travel/storage gear — fits the "swimmer who also travels for crossings" story. [tags: new] — imported from Sponsors/index.html tracker, 16 Sep 2026.', 'Idea');

COMMIT;

-- ----------------------------------------------------------------
-- ROLLBACK — exact SQL to undo, or state:
-- "irreversible — restore from _bak_YYYYMMDD_tablename"
-- ----------------------------------------------------------------
-- BEGIN;
-- DELETE FROM growth_sponsors WHERE notes LIKE '%imported from Sponsors/index.html tracker, 16 Sep 2026.%';
-- COMMIT;

-- ----------------------------------------------------------------
-- VERIFY — run on the READ-ONLY connection AFTER applying.
-- ----------------------------------------------------------------
-- SELECT count(*) FROM growth_sponsors;  -- expect: 19 + 74 = 93
-- SELECT count(*) FROM growth_sponsors WHERE status = 'Idea' AND notes LIKE '%imported from Sponsors/index.html%';
--   -- expect: 74
