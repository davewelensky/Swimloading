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
-- Migration: 2026-08-06_seed-canada-italy-sources.sql
--            (extended in draft to six sources before applying — Canada,
--             Italy, Singapore/Thailand and two global series)
-- ================================================================

-- Purpose:
--   Seed three organiser sources, each running a multi-event series, each
--   probed and each stating upcoming dates:
--
--     Canaqua Sports (CA)        4 future dates — 9 Aug, 16 Aug, 30 Aug,
--                                27 Sep 2026. Runs the Mudskipper swimrun
--                                and open-water series across Ontario,
--                                Manitoba, Quebec, BC and Nova Scotia.
--     Across the Lake Swim (CA)  7 future dates — 9 Aug, 15 Aug, 22 Aug,
--                                12 Sep 2026. The Okanagan lake series:
--                                Kelowna, Skaha, Kalamalka, Gellatly,
--                                Cultus, Rattlesnake Island.
--     SwimTheIsland (IT)         1 future date — 4 Oct 2026 (Bergeggi).
--                                A three-stage circuit: San Teodoro in
--                                May, San Vincenzo in June, Bergeggi in
--                                October, so one upcoming is the season's
--                                tail rather than a thin source.
--
--     X-WATERS (global)          2 future dates. A world-championship
--                                series running Thailand, Turkey and
--                                Kazakhstan — we already publish X-WATERS
--                                Kazakhstan, found incidentally.
--     TriFactor Asia (SG/TH)     4 future dates — 9 Aug, 16 Aug, 13 Sep
--                                2026. Singapore and Thailand. THE FIRST
--                                SOUTHEAST ASIAN SOURCE we have found that
--                                states upcoming dates.
--     UltraSwim 33.3 (global)    2 future dates — 18 Oct, 5 Dec 2026.
--                                Multi-day 33.3 km adventure swims, the
--                                English Channel distance, in Greece,
--                                Croatia and Spain.
--
--   CANADA AND ITALY HAVE NO SOURCE AT ALL TODAY. Canada's 13 live events
--   and Italy's 3 were picked up incidentally by Ray's Notebook and the
--   Oceanman calendar. These are the first sources pointed at either
--   country deliberately.
--
--   HOW THEY WERE FOUND, because the method matters more than the three
--   rows. Ahotu blocks automated access behind a Cloudflare challenge, so
--   its calendar is not ours to crawl. Dave read it in his browser and
--   pasted what he saw; the useful content was not the events but the
--   ORGANISER names recurring across them — one company behind seven
--   Canadian events, one circuit behind three Italian ones. Those names
--   are plain facts, and every organiser publishes its own calendar and
--   wants to be found. Going to source also yields MORE than copying
--   would: an organiser's own site carries all of its events, not the
--   subset a directory happens to list.
--
--   ALL THREE ARE seed-with-ai, NOT seed. The deterministic extractors
--   cannot read any of these pages — the dates are there, in divs no
--   selector reaches — so crawling them WILL spend AI budget. That is a
--   cost accepted knowingly here rather than discovered on an invoice.

-- Requested by:
--   Dave, 2026-08-06.

-- ----------------------------------------------------------------
-- PRE-CHECKS — run on the READ-ONLY connection BEFORE applying.
-- ----------------------------------------------------------------

-- 1. None of the three already exists. Expect 0.
-- SELECT count(*) FROM discovery_sources
--  WHERE base_url IN ('https://www.canaquasports.com/',
--                     'https://acrossthelakeswim.com/',
--                     'https://www.swimtheisland.com/',
--                     'https://x-waters.com/events/?lang=en',
--                     'https://trifactor.asia/',
--                     'https://ultraswim333.com/');

-- 2. Canada and Italy genuinely have no source yet. Expect 0.
-- SELECT count(*) FROM discovery_sources WHERE country_code IN ('CA','IT');
--    Result 2026-08-06: 0.

-- 3. Source count before, for the after comparison.
-- SELECT count(*) FILTER (WHERE enabled) AS enabled, count(*) AS total
--   FROM discovery_sources;

-- ----------------------------------------------------------------
-- BACKUP — not required: this INSERTs new rows and modifies none.
-- The rollback is a DELETE of exactly these three base_urls.
-- ----------------------------------------------------------------

-- ----------------------------------------------------------------
-- MIGRATION — applied only after Dave types "apply".
-- ----------------------------------------------------------------
BEGIN;

-- WHERE NOT EXISTS on base_url rather than ON CONFLICT: base_url carries
-- no unique constraint, and this makes the migration safe to re-run
-- without adding one as a side effect.
INSERT INTO discovery_sources
  (name, base_url, source_type, authority_level, country_code, language_codes,
   parser_type, crawl_frequency, enabled, next_run_at, notes)
SELECT v.name, v.base_url, 'organiser', 3, v.country_code, v.language_codes,
       'jsonld_html', v.crawl_frequency, true, now(), v.notes
  FROM (VALUES
    ('Canaqua Sports — Mudskipper swimrun & open water series',
     'https://www.canaquasports.com/', 'CA', ARRAY['en','fr'], 'weekly',
     'Probed 2026-08-06: seed-with-ai. States 4 future dates (9 Aug, 16 Aug, 30 Aug, 27 Sep 2026) '
     'that the deterministic extractors cannot reach, so expect AI fallback to do the work. '
     'Multi-province series (ON, MB, QC, BC, NS); Quebec events are French, hence en+fr.'),

    ('Across the Lake Swim — Okanagan series',
     'https://acrossthelakeswim.com/', 'CA', ARRAY['en'], 'weekly',
     'Probed 2026-08-06: seed-with-ai. States 7 future dates (9, 15, 22 Aug, 12 Sep 2026). '
     'Kelowna, Skaha, Kalamalka, Gellatly Bay, Cultus, Rattlesnake Island. 44 same-site links, '
     'so expect roughly one event per event page.'),

    ('SwimTheIsland — circuito',
     'https://www.swimtheisland.com/', 'IT', ARRAY['it','en'], 'monthly',
     'Probed 2026-08-06: seed-with-ai. States 4 Oct 2026 (Bergeggi). Three-stage circuit — '
     'San Teodoro (May), San Vincenzo (June), Bergeggi (October) — so one upcoming date is the '
     'season tail, not a thin source. Per-stage sites exist (swimtheislandbergeggi.it, '
     'swimtheislandsardegna.it) if the hub proves too shallow.'),

    ('X-WATERS — world series',
     'https://x-waters.com/events/?lang=en', NULL, ARRAY['en','ru'], 'weekly',
     'Probed 2026-08-06: seed-with-ai. States 2 future dates (16 Aug 2026, 27 Mar 2027). '
     'Multi-country championship series — Thailand, Turkey, Kazakhstan. We already publish '
     'X-WATERS Kazakhstan, found incidentally by a global source; this is the series itself. '
     'country_code deliberately NULL: it spans countries, so the page must state the location.'),

    ('TriFactor Asia — swim & multisport',
     'https://trifactor.asia/', 'SG', ARRAY['en'], 'weekly',
     'Probed 2026-08-06: seed-with-ai. States 4 future dates (9 Aug, 16 Aug, 13 Sep 2026). '
     'Singapore and Thailand — the first Southeast Asian source found that states upcoming '
     'dates. Runs Swimathon (Thailand) and Run/Run-Swim (Singapore); expect multisport, so the '
     'classifier will be doing real work here.'),

    ('UltraSwim 33.3',
     'https://ultraswim333.com/', NULL, ARRAY['en'], 'monthly',
     'Probed 2026-08-06: seed-with-ai. States 2 future dates (18 Oct, 5 Dec 2026). Multi-day '
     '33.3 km adventure swims — the English Channel distance — in Greece, Croatia and Spain. '
     'Premium (EUR 1950+), so these are destination swims rather than local races. Distances '
     'above 25 km here are REAL and must not be mistaken for the unit bug fixed 2026-08-06.')
  ) AS v(name, base_url, country_code, language_codes, crawl_frequency, notes)
 WHERE NOT EXISTS (
   SELECT 1 FROM discovery_sources s WHERE s.base_url = v.base_url
 );

COMMIT;

-- ----------------------------------------------------------------
-- ROLLBACK
-- ----------------------------------------------------------------
-- DELETE FROM discovery_sources
--  WHERE base_url IN ('https://www.canaquasports.com/',
--                     'https://acrossthelakeswim.com/',
--                     'https://www.swimtheisland.com/',
--                     'https://x-waters.com/events/?lang=en',
--                     'https://trifactor.asia/',
--                     'https://ultraswim333.com/');

-- ----------------------------------------------------------------
-- VERIFY — read-only, after applying.
-- ----------------------------------------------------------------

-- 1. Six new sources, enabled and due now. Expect 6.
-- SELECT name, country_code, crawl_frequency, enabled, next_run_at <= now() AS due
--   FROM discovery_sources
--  WHERE base_url IN ('https://www.canaquasports.com/',
--                     'https://acrossthelakeswim.com/',
--                     'https://acrossthelakeswim.com/',
--                     'https://www.swimtheisland.com/');

-- 2. Canada and Italy now have sources. Expect CA 2, IT 1.
-- SELECT country_code, count(*) FROM discovery_sources
--  WHERE country_code IN ('CA','IT') GROUP BY country_code;

-- 3. Nothing else changed — enabled count is exactly +6.
-- SELECT count(*) FILTER (WHERE enabled) AS enabled, count(*) AS total
--   FROM discovery_sources;

-- 4. AFTER the worker runs — the check that matters, on behaviour:
-- SELECT s.name, count(c.id) AS candidates,
--        count(c.id) FILTER (WHERE c.start_date IS NOT NULL) AS dated
--   FROM discovery_sources s
--   LEFT JOIN discovery_candidate_events c ON c.source_id = s.id
--  WHERE s.base_url IN ('https://www.canaquasports.com/',
--                       'https://acrossthelakeswim.com/',
--                       'https://www.swimtheisland.com/')
--  GROUP BY s.name;
--    If candidates arrive but dated is 0, the AI fallback is not running —
--    check DISCOVERY_AI_ENABLED on the worker before blaming the parser.
