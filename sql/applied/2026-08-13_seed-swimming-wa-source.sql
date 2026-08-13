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
-- Migration: 2026-08-13_seed-swimming-wa-source.sql
-- Process:   see MIGRATIONS.md
-- ================================================================

-- Purpose:
--   Seed Swimming WA's Open Water Swimming Series as a discovery source.
--   The catalogue currently has NO Australian source of its own — every
--   Australian event we hold arrived via oceanswims.com, an aggregator.
--
--   PROBED BEFORE SEEDING, not assumed. GET returned HTTP 200 and the
--   condensed page carries the whole 2026/27 season with distances:
--       7 Nov 2026    ROUND 1: LEIGHTON        500m|1.25km|2.5km|5km
--       21-22 Nov     ROUND 2: COOGEE BEACH    ...|7.5km|10km|3km Knockout
--       6 Dec         ROUND 3: ROCKINGHAM      500m|1.25km|2.5km|5km|7.5km
--       27 Dec        ROUND 4: MULLALOO        ...|10km
--       10 Jan 2027   ROUND 5: SORRENTO        ...|10km
--       6 Feb         ROUND 6: CITY TO SCARBS  500m|1.25km|2.5km|5km
--       13 Mar        WA'S BIG OCEAN RELAY     4x500m|4x1km
--   robots.txt disallows only /wp-admin/, and a sitemap is published.
--
--   NEEDS THE AI EXTRACTOR, and that is the risk to watch. 194 KB of raw
--   HTML condenses to 1,175 characters with no JSON-LD, and the entire
--   season arrives as ONE line of text. The AI prompt's "one row per
--   distinct event" rule should split it into 7 — but a page shaped like
--   this could plausibly come back as a single row, or as one row per
--   distance. CHECK THE FIRST RUN before trusting the output; do not
--   assume 7 candidates because the page states 7 rounds.
--
--   parser_type is 'jsonld_html' to match every other seeded source; the
--   AI fallback engages automatically when the deterministic extractors
--   return nothing, which on this page they will.

-- Requested by:
--   Dave, 2026-08-13, from Yolanda Carstens: "Our Open Water Series is
--   big. Look at the distances."
--
--   NOT seeded, deliberately: the WOW Swims series
--   (wowswims.com.au/events-1) that Yolanda also sent. 449 KB of raw HTML
--   condenses to 818 characters containing ZERO dates — a Wix site whose
--   calendar is entirely JavaScript-rendered. It says "SAVE THESE DATES"
--   and then does not include them. Seeding it today would spend AI calls
--   to be told there is nothing there. It needs the headless renderer
--   first, then a re-probe.

-- ----------------------------------------------------------------
-- PRE-CHECKS — run on the READ-ONLY connection BEFORE applying.
-- ----------------------------------------------------------------
-- SELECT count(*) FROM discovery_sources
--  WHERE base_url ILIKE '%openwaterswimming.com.au%';
-- expect: 0
--
-- SELECT count(*) FROM discovery_sources WHERE enabled;   -- record this number

-- ----------------------------------------------------------------
-- BACKUP — not required: inserts one row, changes nothing existing.
-- ----------------------------------------------------------------

-- ----------------------------------------------------------------
-- MIGRATION — applied only after Dave types "apply".
-- ----------------------------------------------------------------
BEGIN;

INSERT INTO discovery_sources (
  name, base_url, source_type, authority_level, country_code, region_hint,
  language_codes, parser_type, enabled, crawl_frequency, notes
)
SELECT
  'Swimming WA — Open Water Swimming Series',
  'https://www.openwaterswimming.com.au/events-ows/',
  'governing_body',
  1,
  'AU',
  'Western Australia',
  ARRAY['en'],
  'jsonld_html',
  true,
  'weekly',
  'Probed 2026-08-13: HTTP 200, robots allows all but /wp-admin/, sitemap published. '
  'The whole 2026/27 season (7 rounds, Nov 2026 - Mar 2027) with full distance ladders '
  'is present, but 194KB of HTML condenses to 1175 chars with no JSON-LD and the season '
  'arrives as ONE line — this source depends on the AI extractor splitting it into 7 rows. '
  'VERIFY THE FIRST RUN produced 7 candidates and not 1. Suggested by Yolanda Carstens. '
  'First Australian source of our own; all other AU events come via oceanswims.com.'
WHERE NOT EXISTS (
  SELECT 1 FROM discovery_sources WHERE base_url = 'https://www.openwaterswimming.com.au/events-ows/'
);

COMMIT;

-- ----------------------------------------------------------------
-- ROLLBACK
-- ----------------------------------------------------------------
-- DELETE FROM discovery_sources
--  WHERE base_url = 'https://www.openwaterswimming.com.au/events-ows/';

-- ----------------------------------------------------------------
-- VERIFY — run on the READ-ONLY connection AFTER applying.
-- ----------------------------------------------------------------
-- SELECT name, enabled, country_code, crawl_frequency FROM discovery_sources
--  WHERE base_url = 'https://www.openwaterswimming.com.au/events-ows/';
-- expect: 1 row, enabled = true, AU, weekly
--
-- AFTER THE FIRST CRAWL — this is the check that matters:
-- SELECT canonical_name, start_date, original_date_text
--   FROM discovery_candidate_events c
--   JOIN discovery_sources s ON s.id = c.source_id
--  WHERE s.base_url = 'https://www.openwaterswimming.com.au/events-ows/'
--  ORDER BY start_date;
-- expect: 7 rows — Leighton, Coogee Beach, Rockingham, Mullaloo, Sorrento,
--         City to Scarbs, WA's Big Ocean Relay. If it returns 1 row, or a
--         row per distance, the AI split the page wrongly and the source
--         should be disabled until the prompt handles this shape.
