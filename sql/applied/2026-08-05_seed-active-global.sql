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
-- Migration: 2026-08-05_seed-active-global.sql
-- STATUS:    ✅ APPLIED 2026-08-05. Verified: present, enabled, country_code
--            NULL (global), daily cadence, due immediately. First crawl run
--            under supervision with AI DISABLED and a 40-page budget — a
--            large site earns its budget rather than being given one.
-- ================================================================

-- Purpose:
--   Seed Active.com as a GLOBAL source, rather than continuing to add one
--   national calendar at a time.
--
--   Dave: "these are the swims that happen globally, so we need to be
--   fetching these swims ... we need to be adding swims constantly to make
--   this useful — i can imagine there are swims planned in all countries."
--
--   The catalogue's 41 sources are almost all single-country calendars,
--   hand-found. That does not scale to "all countries", and it has a second
--   problem: a national calendar for one season goes stale, which is why
--   Japan, New Zealand and half of Poland turned out to be spent seasons in
--   August. A large aggregator does not have that shape — it carries next
--   year's events as organisers post them, continuously.
--
--   PROBED BEFORE SEEDING:
--     /swimming/races        no dates, 105 same-site links  (a link hub)
--     /swimming              no dates, 105 same-site links  (a link hub)
--     one event page         1 FUTURE DATED event, 95 links
--       -> "Swimjunkie Challenge: CARAMOAN 2026 Year10", 2026-10-04
--
--   Exactly the OceanSwims shape: listing pages are hubs, event pages carry
--   the dates, and the crawler follows same-site links to reach them. That
--   shape was worth 8 published Australian events today.
--
--   robots.txt permits event pages — it disallows /page/, /register/, /cm/
--   and similar, none of which we want — and it publishes a sitemap at
--   https://www.active.com/assets/sitemaps/active/sitemap.xml.gz, which the
--   crawler's existing sitemap discovery can follow.

-- Requested by:
--   Dave — 2026-08-05, after supplying Philippine events and asking how the
--   catalogue keeps growing year on year.

-- ----------------------------------------------------------------
-- PRE-CHECKS (read-only)
-- ----------------------------------------------------------------
-- 1. Not already present (expect 0):
--      SELECT count(*) FROM discovery_sources WHERE base_url ILIKE '%active.com%';
-- 2. Countries with no coverage at all, which this is meant to reach:
--      SELECT count(DISTINCT v.country_code) FROM event_editions e
--        JOIN event_venues v ON v.id=e.venue_id WHERE e.start_date >= current_date;
--      -- ACTUAL 2026-08-05: 28. The Philippines is not among them.
-- 3. Source count before (expect 41):
--      SELECT count(*) FROM discovery_sources;

-- ----------------------------------------------------------------
-- BACKUP — not required. One INSERT into discovery_sources.
-- ----------------------------------------------------------------

BEGIN;

INSERT INTO discovery_sources (
  name, base_url, source_type, authority_level, country_code, region_hint,
  language_codes, parser_type, enabled, health_status, crawl_frequency,
  next_run_at, robots_checked_at, notes
)
SELECT
  'Active.com — swimming races (global)',
  'https://www.active.com/swimming/races',
  'aggregator',
  -- 3, not higher: it is a listings platform carrying organiser-submitted
  -- entries, so it is a reliable pointer and not an authority. Anything it
  -- yields still goes through the same verification tiers.
  3,
  -- NULL country: this is the first genuinely global source and pinning it
  -- to one country would be wrong. Country comes from each event's venue.
  NULL,
  NULL,
  ARRAY['en'],
  'html',
  true,
  'unknown',
  -- Daily, unlike the weekly national calendars. This is the source most
  -- likely to carry NEW events continuously — next year's, as organisers
  -- post them — which is the whole reason for adding it.
  'daily',
  now(),
  now(),
  'Probed 2026-08-05 before seeding. Listing pages (/swimming/races, /swimming) are '
  || 'LINK HUBS: 105 same-site links, no dates. Individual event pages carry confirmed '
  || 'future dates — verified on the Caramoan page, which yielded '
  || '"Swimjunkie Challenge: CARAMOAN 2026 Year10" dated 2026-10-04 with JSON-LD present. '
  || 'Same one-event-per-page shape as OceanSwims. robots.txt permits event pages and '
  || 'publishes a sitemap (assets/sitemaps/active/sitemap.xml.gz) the crawler can follow. '
  || 'GLOBAL by design — country_code is deliberately NULL; country comes from each '
  || 'event venue. Watch discovery_runs.metrics on the first few runs: this site is very '
  || 'large, so the page budget and AI spend matter more here than on a national calendar.'
WHERE NOT EXISTS (
  SELECT 1 FROM discovery_sources WHERE base_url ILIKE '%active.com%');

COMMIT;

-- ----------------------------------------------------------------
-- ROLLBACK
-- ----------------------------------------------------------------
-- BEGIN;
-- DELETE FROM discovery_sources WHERE base_url ILIKE '%active.com%';
-- COMMIT;
-- Check for candidates first if it has already crawled:
--   SELECT count(*) FROM discovery_candidate_events c JOIN discovery_sources s
--     ON s.id=c.source_id WHERE s.base_url ILIKE '%active.com%';

-- ----------------------------------------------------------------
-- VERIFY (read-only)
-- ----------------------------------------------------------------
-- 1. Present, enabled, global, due now:
--      SELECT name, enabled, country_code, crawl_frequency, next_run_at <= now() AS due
--        FROM discovery_sources WHERE base_url ILIKE '%active.com%';
--      -- expect: enabled true, country_code NULL, daily, due true
--
-- 2. AFTER the first run — what it produced and what it cost. This is a very
--    large site, so check the spend before letting it run daily unattended:
--      SELECT r.status, r.started_at, r.metrics->>'aiCallsMade' AS ai_calls,
--             r.metrics->>'urlsDeferredByBudget' AS deferred,
--             (SELECT count(*) FROM discovery_candidate_events c WHERE c.source_id=r.source_id) AS candidates
--        FROM discovery_runs r JOIN discovery_sources s ON s.id=r.source_id
--       WHERE s.base_url ILIKE '%active.com%' ORDER BY r.started_at DESC LIMIT 3;
--
-- 3. Does it reach countries nothing else does? The Philippines is the test
--    case, since Dave supplied a Philippine event and we have zero coverage:
--      SELECT v.country_code, count(*) FROM event_editions e
--        JOIN event_venues v ON v.id=e.venue_id
--       WHERE e.start_date >= current_date GROUP BY 1 ORDER BY 2 DESC;
--
-- 4. Specifically, the event this source was verified on:
--      SELECT title, start_date, slug FROM event_editions WHERE title ILIKE '%Caramoan%';
--      -- expect Swimjunkie Challenge: Caramoan, 2026-10-04, once the crawl reaches it

-- ----------------------------------------------------------------
-- NOTE — the OTHER Philippine event Dave supplied is NOT addable
-- ----------------------------------------------------------------
-- "Swimjunkie Challenge: Camiguin", Mambajao, 10 May 2026, 2/5/8 km, has
-- ALREADY HAPPENED — today is 5 August 2026. It is recorded here so nobody
-- re-adds it as upcoming. It will reappear legitimately when the 2027
-- edition is announced, which is precisely the continuous-growth behaviour
-- a daily aggregator crawl is meant to capture.
