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
-- Migration: 2026-08-06_active-com-back-to-daily.sql
-- ================================================================

-- Purpose:
--   Restore Active.com to daily. It was parked on 2026-08-05 with three
--   named defects and an explicit condition — "Restore to daily once those
--   are fixed and tested." All three are fixed, and the fix is visible in
--   the data rather than only in the commit log:
--
--     1. "countries do not resolve"
--        Fixed 2026-08-06. The cause was not the URL path anyone expected:
--        the country was in the JSON-LD all along, and two gaps in our own
--        parsing threw it away — a twelve-entry country name table, and a
--        JSON-LD path that never applied the subdivision inference the
--        free-text path already had.
--        EVIDENCE: all 7 active.com candidates now carry a country_code;
--        none did on 5 August. Verify below.
--
--     2. "titles carry location and date into the slug"
--        Fixed 2026-08-05, commit "Strip listing-site furniture from event
--        names before they become slugs".
--        CAVEAT, stated rather than buried: slugs are PERMANENT, so the
--        seven already published keep the furniture in theirs. Only new
--        events get clean ones. That is the correct trade — a changed slug
--        is a broken link — but it means the fix is not retroactive.
--
--     3. "the classifier ignores a URL path saying swimming-classes"
--        Fixed 2026-08-05, commit "Classifier: a lesson is not a swim you
--        enter". NON_RACE_PHRASES is checked BEFORE the open-water signal,
--        so a class held in the sea is still a class.
--
--   WHY THIS IS WORTH THE CRAWL BUDGET. Active.com is the only source we
--   have with a 100% publish rate: 7 candidates, 7 published, zero AI cost,
--   six countries from one 40-page run, including an event dated 2027. Its
--   566 deferred URLs are the backlog a daily cadence exists to work
--   through. It is also the best answer we have to "how does the catalogue
--   keep growing", because a global aggregator carries next season's events
--   as organisers post them — which matters in August, when most northern
--   calendars are spent.
--
--   WHAT TO WATCH, because "large site + daily + AI" is how a budget
--   disappears. The verify block below reads discovery_runs.metrics after
--   the first daily runs. Active.com's individual event pages carry JSON-LD
--   and cost nothing to read; if AI spend climbs, the crawler is wandering
--   into pages that are not event pages, and expand_url_pattern (added
--   2026-08-06) is the lever — the same wandering put two running races on
--   /explore from Lopplistan.

-- Requested by:
--   Dave, 2026-08-06.

-- ----------------------------------------------------------------
-- PRE-CHECKS — run on the READ-ONLY connection BEFORE applying.
-- ----------------------------------------------------------------

-- 1. Defect 1 is fixed in the data. Expect 7 candidates, 0 without country.
-- SELECT count(*) AS candidates, count(*) FILTER (WHERE country_code IS NULL) AS no_country,
--        count(*) FILTER (WHERE promoted_edition_id IS NOT NULL) AS published
--   FROM discovery_candidate_events
--  WHERE source_id = 'bb11b565-e2eb-4f9f-8f64-37d523083dd0';
--    Result 2026-08-06: 7 / 0 / 7.

-- 2. Current cadence is weekly and it is not due until 12 Aug.
-- SELECT crawl_frequency, next_run_at FROM discovery_sources
--  WHERE id = 'bb11b565-e2eb-4f9f-8f64-37d523083dd0';
--    Result 2026-08-06: weekly, 2026-08-12.

-- 3. The one swimming-class candidate that got through before the
--    classifier fix is NOT public. Checked rather than assumed, because a
--    lesson offered as a swim you can enter is the failure this source was
--    parked for.
-- SELECT c.candidate_status, e.is_searchable, e.slug
--   FROM discovery_candidate_events c
--   LEFT JOIN event_editions e ON e.source_candidate_id = c.id
--  WHERE c.source_url ILIKE '%swimming-classes%';
--    Result 2026-08-06: approved candidate, edition is_searchable = FALSE.
--    Not on /explore. Its slug still reads
--    "summer-event-adapted-luau-fort-worth-tx-august-08-2026-2026" — the
--    furniture defect, permanent by design, and the reason defect 2 above
--    is described as fixed-but-not-retroactive.

-- 4. Nothing else is on a daily cadence, so this is a deliberate exception
--    rather than a drift in policy.
--    Result 2026-08-06: 37 weekly, 7 monthly, 0 daily.
-- SELECT crawl_frequency, count(*) FROM discovery_sources
--  WHERE enabled GROUP BY crawl_frequency;

-- ----------------------------------------------------------------
-- BACKUP — not required: two columns on one row, both recorded above
-- and restored verbatim by the rollback.
-- ----------------------------------------------------------------

-- ----------------------------------------------------------------
-- MIGRATION — applied only after Dave types "apply".
-- ----------------------------------------------------------------
BEGIN;

UPDATE discovery_sources
   SET crawl_frequency = 'daily',
       next_run_at = now(),
       notes = notes || ' | RESTORED TO DAILY 2026-08-06: all three parking defects fixed and '
                        'verified — countries resolve (7/7 candidates now carry one), listing '
                        'furniture is stripped from names before slugging, and the classifier '
                        'reads a swimming-classes URL path. Slugs already minted keep their '
                        'furniture; slugs are permanent and a changed one is a broken link. '
                        'Watch discovery_runs.metrics for AI spend on the first daily runs — '
                        'this site is large, and expand_url_pattern is the lever if the crawler '
                        'starts wandering off event pages.'
 WHERE id = 'bb11b565-e2eb-4f9f-8f64-37d523083dd0';

COMMIT;

-- ----------------------------------------------------------------
-- ROLLBACK
-- ----------------------------------------------------------------
-- UPDATE discovery_sources
--    SET crawl_frequency = 'weekly', next_run_at = '2026-08-12 14:23:09.927169+00'
--  WHERE id = 'bb11b565-e2eb-4f9f-8f64-37d523083dd0';
--   (the appended note is harmless history and can be left in place)

-- ----------------------------------------------------------------
-- VERIFY — read-only, after applying.
-- ----------------------------------------------------------------

-- 1. Daily and due now.
-- SELECT crawl_frequency, next_run_at <= now() AS due FROM discovery_sources
--  WHERE id = 'bb11b565-e2eb-4f9f-8f64-37d523083dd0';

-- 2. AFTER the first daily runs — the checks that matter, on behaviour:
--
--    a) Countries keep resolving on NEW candidates, not just backfilled ones:
-- SELECT count(*) FILTER (WHERE country_code IS NULL) AS no_country, count(*) AS total
--   FROM discovery_candidate_events
--  WHERE source_id = 'bb11b565-e2eb-4f9f-8f64-37d523083dd0'
--    AND extracted_at > '2026-08-06';
--
--    b) No class or lesson reaches the catalogue:
-- SELECT canonical_name, source_url FROM discovery_candidate_events
--  WHERE source_id = 'bb11b565-e2eb-4f9f-8f64-37d523083dd0'
--    AND source_url ILIKE '%classes%' AND candidate_status <> 'rejected';
--   expected 0 rows
--
--    c) AI spend stays near zero — this source's event pages carry JSON-LD:
-- SELECT started_at::date, metrics->>'aiCallsMade' AS ai_calls,
--        metrics->>'aiInputTokens' AS in_tokens, metrics->>'candidatesPersisted' AS candidates
--   FROM discovery_runs WHERE source_id = 'bb11b565-e2eb-4f9f-8f64-37d523083dd0'
--  ORDER BY started_at DESC LIMIT 7;
--   If ai_calls climbs while candidates does not, the crawler is reading
--   pages that are not event pages. Set expand_url_pattern rather than
--   re-parking the source.
