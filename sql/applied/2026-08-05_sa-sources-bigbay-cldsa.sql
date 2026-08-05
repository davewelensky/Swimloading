-- ================================================================
-- SwimLoading — Migration (data change; MIGRATIONS.md applies)
-- ================================================================

DO $safety$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM _project_identity WHERE key='project_name' AND value='swimloading') THEN
    RAISE EXCEPTION E'\n WRONG PROJECT — MIGRATION ABORTED. Expected swimloading / szgkzuswelntnevobnoh';
  END IF;
END $safety$;

-- ================================================================
-- Migration: 2026-08-05_sa-sources-bigbay-cldsa.sql
-- Process:   see MIGRATIONS.md — no section below may be left empty
-- STATUS:    ✅ APPLIED 2026-08-05. Verified: Big Bay present, enabled=false,
--            health_status='degraded', base_url=/big-bay-swim-events/ (NOT
--            /events/); CLDSA enabled=false, health_status='blocked', 403
--            reason recorded; ZA enabled count unchanged at 5; ZA sources
--            6 -> 7.
--            NOTE: the first apply attempt FAILED on the health_status CHECK
--            — 'unusable' is not a permitted value. Allowed values are
--            healthy/degraded/failing/blocked/unknown. Nothing was written.
-- ================================================================

-- Purpose:
--   Record two South African sources as PROBED AND NOT CRAWLABLE, with the
--   evidence, so the next person does not spend an afternoon rediscovering
--   it. Neither is enabled. This migration adds no crawling capability —
--   it adds knowledge.
--
--   Context: South Africa has 6 sources and 250 published events worldwide,
--   but only 4 upcoming ZA events, and the nearest swim to Cape Town is
--   1,220 km away. Dave asked why, given Big Bay Events clearly runs a
--   number of Cape Town swims.
--
-- ── BIG BAY EVENTS — probed 2026-08-05 ──────────────────────────────────
--   The site is reachable (200, no robots.txt — /robots.txt 301s away) and
--   describes its swims well. It publishes NO DATES a crawler can read.
--
--   What is actually there:
--     * /events/  — WordPress THEME DEMO CONTENT. Verbatim: "JUMPERS —
--       LAKERS, Sports Hall New York, United States", "BULLS — New
--       Yorkers", "Big Slam — Oklahoma, Houston House, United States".
--       Placeholder basketball fixtures shipped with the theme. Pointing
--       an extractor at this page would publish American basketball as
--       South African open-water swimming. This page must NEVER be used
--       as the source URL, which is the single most important line here.
--     * /events/big-bay-swim-events/ — real, good descriptions of Around
--       the Rocks (~2500 m, 12-15 C), Langebaan Express (6 km / 12 km),
--       Langebaan Around the Island. No dates at all.
--     * /swimming-events/ — a year x event grid, 2022-2026, where every
--       cell is a "Click Here" link. All 33 resolve to URL shorteners.
--     * Every resolved link, INCLUDING both 2026 ones
--       (Around-the-Rocks-2026, Chapmans-Peak-2026), lands on
--       live.mobii.com RESULT pages. Results of races already swum, not
--       entries for races to come.
--
--   So the extraction ladder has nothing to bite on, and the schema rule
--   "an unconfirmed date is never stored" means any candidate from this
--   site would be unpublishable by construction. Enabling it would burn
--   AI-extraction budget to produce rows that can never go live.
--
--   The route that works is not technical: Derrick Frazer is a known
--   contact (derrick@bigbayevents.co.za, +27 82 770 5798, listed publicly
--   on the site). An organiser-supplied calendar arrives as
--   organiser_confirmed — the strongest trust tier we have — and skips
--   extraction, review and this entire problem.
--
-- ── CLDSA — probed 2026-08-05 ───────────────────────────────────────────
--   ⚠️ RETRACTED 2026-08-05 by Dave: everything below about CLDSA being a
--   race calendar is WRONG. CLDSA sanctions and records Robben Island
--   crossings and publishes SWIMMER STATISTICS — solo sanctioned swims, not
--   events anyone enters from a calendar. It is not an event source at all,
--   so its 403 is irrelevant and it must not be re-probed or enabled. The
--   claim that it was "the single biggest reason Cape Town looks empty" was
--   my inference, not a checked fact, and it was wrong. The live row's notes
--   have been corrected. Kept below for the record only.
--   Already present and disabled; this only records WHY, which was not
--   written down. https://cldsa.co.za/events/ returns 403 to an automated
--   fetch. It is behind Cloudflare (robots.txt references /cdn-cgi/).
--   Critically, robots.txt does NOT disallow /events/ — so this is a
--   bot-blocker, not the site asking us to stay away. Same shape as the
--   Rottnest organiser. Flipping `enabled` alone will not help: it will
--   403 on every run and burn the failure counter.
--
--   CLDSA matters more than any other ZA source: it is the Cape Town open
--   water body, and it is the single biggest reason Cape Town looks empty.

-- Requested by:
--   Dave — 2026-08-05, "add big bay events as a source first", after
--   "we need to understand why south africa only has the midmar mile".

-- ----------------------------------------------------------------
-- PRE-CHECKS — run on the READ-ONLY connection BEFORE applying.
-- ----------------------------------------------------------------
-- 1. Big Bay must not already exist (expect 0):
--      SELECT count(*) FROM discovery_sources WHERE base_url ILIKE '%bigbayevents%';
--
-- 2. CLDSA must exist, and must be disabled (expect 1 row, enabled = false):
--      SELECT name, enabled, notes FROM discovery_sources
--       WHERE base_url ILIKE '%cldsa%';
--
-- 3. Current ZA source count, to compare after (expect 6):
--      SELECT count(*) FROM discovery_sources WHERE country_code='ZA';

-- ----------------------------------------------------------------
-- BACKUP — required: this UPDATEs an existing discovery_sources row.
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS _bak_20260805_discovery_sources AS
  SELECT *, now() AS backed_up_at FROM discovery_sources;

-- ----------------------------------------------------------------
-- MIGRATION — applied only after Dave types "apply".
-- ----------------------------------------------------------------
BEGIN;

-- Big Bay Events. enabled = FALSE deliberately and the base_url points at
-- the descriptive page, NOT /events/ — so that if someone later flips the
-- flag without reading the notes, the worst case is dateless candidates
-- rather than imported American basketball fixtures.
INSERT INTO discovery_sources (
  name, base_url, source_type, authority_level, country_code, region_hint,
  language_codes, parser_type, enabled, health_status, crawl_frequency,
  robots_checked_at, notes
)
SELECT
  'Big Bay Events — swim events',
  'https://bigbayevents.co.za/events/big-bay-swim-events/',
  'organiser',
  2,
  'ZA',
  'Western Cape',
  ARRAY['en'],
  'html',
  false,
  -- 'degraded', not 'blocked'. health_status permits only
  -- healthy/degraded/failing/blocked/unknown, and none of them means
  -- "reachable, well written, but publishes no dates" — which is exactly
  -- this site's condition. 'blocked' would be a lie (it returns 200
  -- happily) and would put it in the same bucket as CLDSA's 403, hiding
  -- the fact that these two need completely different fixes. 'degraded'
  -- is the least wrong, and the notes carry the real meaning.
  'degraded',
  'manual',
  now(),
  'DISABLED — probed 2026-08-05, no machine-readable dates anywhere on the site. '
  || 'Descriptions of Around the Rocks (~2500m, 12-15C), Langebaan Express (6km/12km) '
  || 'and Langebaan Around the Island are present and good, but undated. /swimming-events/ '
  || 'is a 2022-2026 grid whose 33 "Click Here" links ALL resolve to live.mobii.com RESULT '
  || 'pages, including both 2026 links — results, not entries. '
  || 'DO NOT point this source at /events/ : that page contains WordPress theme demo '
  || 'content ("JUMPERS - LAKERS, Sports Hall New York"), i.e. American basketball '
  || 'fixtures that would be published as South African swims. '
  || 'THE FIX IS NOT TECHNICAL: ask Derrick Frazer (derrick@bigbayevents.co.za, '
  || '+27 82 770 5798) for the calendar. An organiser-supplied list is organiser_confirmed '
  || 'and skips extraction entirely.'
WHERE NOT EXISTS (
  SELECT 1 FROM discovery_sources WHERE base_url ILIKE '%bigbayevents%');

-- CLDSA: record the reason it is off. Does not enable it.
UPDATE discovery_sources
   SET health_status   = 'blocked',
       robots_checked_at = now(),
       notes = coalesce(notes || ' | ', '')
         || 'DISABLED — probed 2026-08-05: https://cldsa.co.za/events/ returns 403 to '
         || 'automated fetches, behind Cloudflare (robots.txt references /cdn-cgi/). '
         || 'robots.txt does NOT disallow /events/, so this is a bot-blocker rather than '
         || 'the site declining to be crawled. Enabling the flag alone will NOT work — it '
         || 'will 403 every run and drive consecutive_failure_count up. CLDSA is the Cape '
         || 'Town open-water body and the single biggest reason Cape Town looks empty; '
         || 'the realistic route is asking them directly, as with Big Bay.'
 WHERE base_url ILIKE '%cldsa%';

COMMIT;

-- ----------------------------------------------------------------
-- ROLLBACK — exact SQL to undo.
-- ----------------------------------------------------------------
-- BEGIN;
-- DELETE FROM discovery_sources WHERE base_url ILIKE '%bigbayevents%';
-- UPDATE discovery_sources s
--    SET notes = b.notes, health_status = b.health_status,
--        robots_checked_at = b.robots_checked_at
--   FROM _bak_20260805_discovery_sources b
--  WHERE s.id = b.id AND s.base_url ILIKE '%cldsa%';
-- COMMIT;
-- Safe: the Big Bay row has never been crawled, so no candidate references
-- it. Confirm before deleting:
--   SELECT count(*) FROM discovery_candidate_events c
--    JOIN discovery_sources s ON s.id=c.source_id
--    WHERE s.base_url ILIKE '%bigbayevents%';   -- expect 0

-- ----------------------------------------------------------------
-- VERIFY — run on the READ-ONLY connection AFTER applying.
-- ----------------------------------------------------------------
-- 1. Big Bay exists and is OFF (the whole point — an enabled row here
--    would be a regression, not a success):
--      SELECT name, enabled, health_status, base_url FROM discovery_sources
--       WHERE base_url ILIKE '%bigbayevents%';
--      -- expect: 1 row, enabled = false, base_url ending /big-bay-swim-events/
--
-- 2. No ZA source was switched on by accident:
--      SELECT count(*) FROM discovery_sources WHERE country_code='ZA' AND enabled;
--      -- expect: 5, unchanged
--
-- 3. CLDSA still disabled, now with a reason recorded:
--      SELECT enabled, health_status, notes ILIKE '%403%' AS reason_recorded
--        FROM discovery_sources WHERE base_url ILIKE '%cldsa%';
--      -- expect: false, 'blocked', true
--
-- 4. ZA source count went 6 -> 7:
--      SELECT count(*) FROM discovery_sources WHERE country_code='ZA';
