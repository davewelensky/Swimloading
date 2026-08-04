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
      '╚══════════════════════════════════════════════════════════╝'
    USING HINT = 'Check the project ref in your Supabase dashboard URL';
  END IF;
  RAISE NOTICE '✅ Project identity confirmed: swimloading (szgkzuswelntnevobnoh)';
END $$;

-- ================================================================
-- Migration: 2026-08-04_seed-global-discovery-sources.sql
-- Process:   see MIGRATIONS.md — no section below may be left empty
-- ================================================================

-- Purpose:
--   Seed the discovery crawler with real global sources, so the
--   catalogue can grow past the 38 hand-researched events it has been
--   stuck at. Until now only 3 sources existed — Oceanman plus two
--   "research umbrella" rows — and NONE were South African, which is
--   why the home market showed a single event.
--
--   Every URL below was fetched and verified before being added:
--   confirmed to load, checked for server- vs JavaScript-rendering,
--   and checked for schema.org JSON-LD. Sources that block bots (403)
--   or proved to be news pages rather than calendars were excluded and
--   are listed at the bottom of this file so the next person does not
--   re-research them.
--
--   All rows are parser_type='jsonld_html' on purpose, INCLUDING the
--   JavaScript-rendered ones. The crawler's headless-render fallback
--   fires automatically per page when plain extraction finds nothing,
--   so a JS source simply yields nothing (harmlessly, hash-tracked)
--   while DISCOVERY_PLAYWRIGHT_ENABLED is off, and starts producing
--   candidates when it is switched on. No scheduler change needed, and
--   parser_type='playwright' is avoided because the scheduler
--   deliberately skips that value.
--
--   NOTHING here publishes anything. Crawled pages become candidates in
--   discovery_candidate_events with candidate_status='pending' and
--   still require admin approval at /discovery-review before appearing
--   on /explore.

-- Requested by:
--   Dave — "the idea behind this build is to start building a global db
--   and view of swimming events" / "write the migration" (2026-08-04)

-- ----------------------------------------------------------------
-- PRE-CHECKS — run on the READ-ONLY connection BEFORE applying.
-- Must include affected-row counts for any UPDATE/DELETE.
-- ----------------------------------------------------------------
-- This migration is INSERT-only (no UPDATE, no DELETE), so no rows are
-- modified or destroyed. Expected counts:
--
--   SELECT count(*) FROM discovery_sources;                  -- expect: 4 before, 40 after
--   SELECT count(*) FROM discovery_sources WHERE enabled;    -- expect: 3 before, 37 after
--     (36 rows inserted; two are seeded DISABLED — CLDSA …0020 which 403s our crawler,
--      and DSV …003b whose robots.txt disallows the path)
--
-- Confirm none of the new fixed ids already exist (expect 0):
--   SELECT count(*) FROM discovery_sources
--   WHERE id BETWEEN '00000000-0000-4000-8000-000000000020'
--                AND '00000000-0000-4000-8000-000000000050';
--
-- Confirm the synthetic fixture source stays disabled (expect false):
--   SELECT enabled FROM discovery_sources
--   WHERE id = '00000000-0000-4000-8000-000000000001';

-- ----------------------------------------------------------------
-- BACKUP — required before any DELETE / UPDATE / DROP / TRUNCATE.
-- ----------------------------------------------------------------
-- Not required: this migration only INSERTs new rows with fixed ids and
-- touches no existing row. Rollback is a DELETE of exactly those ids
-- (see ROLLBACK below), which is why the ids are fixed rather than
-- gen_random_uuid().

-- ----------------------------------------------------------------
-- MIGRATION — applied only after Dave types "apply".
-- ----------------------------------------------------------------
BEGIN;

INSERT INTO public.discovery_sources
  (id, name, base_url, source_type, authority_level, country_code, region_hint,
   language_codes, parser_type, enabled, crawl_frequency, next_run_at, notes)
VALUES

-- ── SOUTH AFRICA — the home market, previously ZERO sources ──────────

('00000000-0000-4000-8000-000000000020',
 'Cape Long Distance Swimming Association — events',
 'https://cldsa.co.za/events/', 'governing_body', 2, 'ZA', 'Western Cape',
 ARRAY['en'], 'jsonld_html', false, 'weekly', NULL,
 'SEEDED DISABLED — returns HTTP 403 to SwimLoadingDiscoveryBot. It loads fine for an ordinary '
 'browser and for a generic fetcher, so this is UA-based blocking (a WordPress/Cloudflare security '
 'rule), not an absence of content. Content-wise it is the strongest SA source found: server-rendered, '
 'schema.org Event JSON-LD, WordPress "The Events Calendar", carrying Kromme River 14km, Keurbooms, '
 'the Orange River 20km and the Franschhoek Mile. '
 'We deliberately do NOT spoof a browser UA to get around this — an honest, identifiable crawler is '
 'the whole design. The right fix is human: ask CLDSA to allowlist the bot (Dave knows this community). '
 'Once they confirm, flip enabled=true and set next_run_at=now().'),

('00000000-0000-4000-8000-000000000021',
 'Durban Undersea Club — events',
 'https://duc.co.za/events/', 'club', 4, 'ZA', 'KwaZulu-Natal',
 ARRAY['en'], 'jsonld_html', true, 'weekly', now(),
 'Verified 2026-08-04 with the real crawler: HTTP 200, 81k chars of text, 37 same-site links, '
 'Event JSON-LD, 400 sitemap URLs of which 12 score as event-like. This is Steve''s DUC, already a '
 'SwimLoading club. WARNING: DUC and Point Water Sports Club (…0022) publish an IDENTICAL event '
 'feed down to the same image asset — expect duplicate candidates between the two and resolve '
 'them by title+date in /discovery-review, not by assuming one source is wrong.'),

('00000000-0000-4000-8000-000000000022',
 'Point Water Sports Club — events',
 'https://pwsc.co.za/pwc-events/', 'club', 4, 'ZA', 'KwaZulu-Natal',
 ARRAY['en'], 'jsonld_html', true, 'weekly', now(),
 'Verified 2026-08-04 with the real crawler: HTTP 200, Event JSON-LD, and 319 event-like URLs in '
 'its sitemap — the deepest single-site inventory in this batch. Recurring Durban open water swims. '
 'Shares its feed with DUC (…0021) — see that row''s duplicate warning.'),

('00000000-0000-4000-8000-000000000023',
 'Easy Entry Africa — event entries',
 'https://easyentry.africa/', 'organiser', 3, 'ZA', NULL,
 ARRAY['en'], 'jsonld_html', true, 'weekly', now(),
 'Verified 2026-08-04: server-rendered, no JSON-LD, no sitemap. Carries the aQuellé Ocean Racing '
 'Series (400m/1km/2km/3km, Hobie Beach, monthly Oct–Mar), Kool-a-Sun Marina Mile, Sabrina Love '
 'Challenge and SANATOWS champs. zsports.co.za/ors redirects here — same operator, do not add twice.'),

('00000000-0000-4000-8000-000000000024',
 'Swimming South Africa — upcoming events',
 'https://swimsa.org/events-results/upcoming-events', 'governing_body', 1, 'ZA', NULL,
 ARRAY['en'], 'jsonld_html', true, 'weekly', now(),
 'Verified 2026-08-04: JAVASCRIPT-RENDERED — serves "Fetching batch 1... (0 events loaded)" and '
 'fills itself by XHR. Yields NOTHING until DISCOVERY_PLAYWRIGHT_ENABLED=true; with rendering on, '
 'visible text goes 2280→5383 chars and 37 dated entries appear. The national federation, so worth '
 'the render cost. NOTE /disciplines/calendar-of-events is a genuine 404 despite being the top '
 'search result — do not "fix" this URL to that one.'),

('00000000-0000-4000-8000-000000000025',
 'aQuellé Midmar Mile',
 'https://midmarmile.com/', 'organiser', 2, 'ZA', 'KwaZulu-Natal',
 ARRAY['en'], 'jsonld_html', true, 'monthly', now(),
 'Verified 2026-08-04: server-rendered (Shopify), no JSON-LD, has a sitemap. Currently advertising '
 'the 2027 edition. Single-event organiser, hence monthly rather than weekly. '
 'midmarmile.com/pages/events 404s and midmarmile.howler.co.za shows 0 events — ignore both.'),

-- ── AMERICAS ─────────────────────────────────────────────────────────

('00000000-0000-4000-8000-000000000026',
 'Ray''s Notebook — open water swim schedules',
 'https://raysnotebook.info/ows/schedules/The%20Whole%20Shebang.html', 'aggregator', 3, NULL,
 'North America + Caribbean',
 ARRAY['en'], 'jsonld_html', true, 'weekly', now(),
 'Verified 2026-08-04 with the real crawler: HTTP 200, 64k chars of text, but only 16 links and NO '
 'sitemap. Content-wise it is the highest-value source found — 338 scheduled swims across '
 'US/CA/MX/Caribbean, with lat/long, distances, start times and a per-row last-updated stamp. '
 'BUT all of that lives in static HTML TABLES on one page, which the current extractor (JSON-LD '
 'first, then fixed CSS selectors) cannot read — expect near-zero candidates until either a '
 'table parser or the AI extraction phase exists. Seeded now so the page is hash-tracked and the '
 'source is ready the moment either lands. Hub at /ows/home.html splits into ~70 per-state pages.'),

('00000000-0000-4000-8000-000000000027',
 'Tri Tour México — calendario aguas abiertas',
 'https://www.tritour.org/calendario-aguas-abiertas-mexico', 'aggregator', 3, 'MX', NULL,
 ARRAY['es'], 'jsonld_html', true, 'weekly', now(),
 'Verified 2026-08-04: server-rendered Spanish, has a sitemap. ~34 events, and it aggregates ~30 '
 'named organisers — crawling its organiser index reaches the whole Mexican supply chain rather '
 'than one calendar. Best Mexico source found.'),

('00000000-0000-4000-8000-000000000028',
 'GranRetto — próximos eventos',
 'https://granretto.com/proximos-eventos', 'organiser', 3, 'MX', NULL,
 ARRAY['es'], 'jsonld_html', true, 'weekly', now(),
 'Verified 2026-08-04: server-rendered Spanish, no sitemap. Largest Mexican open water organiser; '
 '16 events running into 2027, including Cuba/Varadero.'),

('00000000-0000-4000-8000-000000000029',
 'Swimchannel Brasil — calendário águas abertas',
 'https://swimchannel.net/br/aguas-abertas-2026/', 'aggregator', 3, 'BR', NULL,
 ARRAY['pt'], 'jsonld_html', true, 'weekly', now(),
 'Verified 2026-08-04: server-rendered Portuguese. ~180 rows for the full year, month by month, '
 'each with date, event, place AND the organiser''s own URL — an excellent seed for Brazilian '
 'organisers. Also lists Argentine OWA rounds.'),

('00000000-0000-4000-8000-00000000002a',
 'CADDA — calendario (Confederación Argentina de Deportes Acuáticos)',
 'https://cadda.org.ar/calendario/', 'governing_body', 1, 'AR', NULL,
 ARRAY['es'], 'jsonld_html', true, 'weekly', now(),
 'Verified 2026-08-04: server-rendered with @type Event JSON-LD, has a sitemap. Runs WordPress '
 '"The Events Calendar" (same plugin as CLDSA/DUC/PWSC — one parser pattern covers all four). '
 '42 events across all aquatic disciplines, so expect the classifier to reject the pool ones.'),

('00000000-0000-4000-8000-00000000002b',
 'Cronometraje Instantáneo — eventos de natación',
 'https://cronometrajeinstantaneo.com/eventos/nataci%C3%B3n.html', 'calendar_feed', 3, 'AR', NULL,
 ARRAY['es'], 'jsonld_html', true, 'weekly', now(),
 'Verified 2026-08-04: richest structured data of any source found — SportsEvent JSON-LD including '
 'Place and Offer. ~44 events. Timing company, so its calendar tracks what is actually being run.'),

-- ── ASIA-PACIFIC ─────────────────────────────────────────────────────

('00000000-0000-4000-8000-00000000002c',
 'OceanSwims.com — event calendar',
 'https://oceanswims.com/event/', 'aggregator', 3, NULL, 'Australia + New Zealand',
 ARRAY['en'], 'jsonld_html', true, 'weekly', now(),
 'Verified 2026-08-04: server-rendered, has a sitemap. 100+ events with clean /event/<slug>/ detail '
 'URLs — Bondi to Bronte, Lorne Pier to Pub, Coogee Island Challenge, Australian Open Water Cup. '
 'Best single APAC source.'),

('00000000-0000-4000-8000-00000000002d',
 'Swimming New Zealand — open water events calendar',
 'https://www.swimmingnz.org/open-water-events-calendar', 'governing_body', 1, 'NZ', NULL,
 ARRAY['en'], 'jsonld_html', true, 'weekly', now(),
 'Verified 2026-08-04: server-rendered (heavy Wix, ~888KB, but event names ARE in the raw HTML). '
 'NZ Open Water Championships, Lake Karapiro, Rangitoto, The Epic Swim.'),

('00000000-0000-4000-8000-00000000002e',
 'OceanSwims.nz',
 'https://oceanswims.nz/', 'aggregator', 3, 'NZ', NULL,
 ARRAY['en'], 'jsonld_html', true, 'weekly', now(),
 'Verified 2026-08-04: server-rendered AMP, has a sitemap. ~40 events for the full season with '
 'per-event /YYYY/<slug> paths. Its JSON-LD is WebSite/Organization only, not Event.'),

('00000000-0000-4000-8000-00000000002f',
 'OWS三河魂 — 全国OWS大会一覧 (Japan nationwide OWS schedule)',
 'https://www.ows-mikawa.com/ows-schedule-map/', 'aggregator', 4, 'JP', NULL,
 ARRAY['ja'], 'jsonld_html', true, 'weekly', now(),
 'Verified 2026-08-04: server-rendered Japanese, has a sitemap. ~40 events nationwide with date, '
 'distance, organiser AND entry deadline per row — unusually rich for an enthusiast site, and the '
 'best-structured non-English source found. A genuine test of the multilingual pipeline.'),

('00000000-0000-4000-8000-000000000030',
 'Sported.ae — race calendar',
 'https://www.sported.ae/events/', 'aggregator', 3, 'AE', 'Middle East',
 ARRAY['en'], 'jsonld_html', true, 'weekly', now(),
 'Verified 2026-08-04: server-rendered with 25 Event JSON-LD blocks — the most structured data of '
 'any source in this batch. Multi-sport with a Swimming filter, so expect classifier rejections.'),

('00000000-0000-4000-8000-000000000031',
 'Events Horizons — Hong Kong open water races',
 'https://www.eventshorizons.com/', 'organiser', 3, 'HK', NULL,
 ARRAY['en','zh'], 'jsonld_html', true, 'monthly', now(),
 'Verified 2026-08-04: server-rendered (Wix), has a sitemap. Discovery Bay Open Water Race '
 'Challenge, Middle Island Challenge 熨波洲渡海泳賽, Hong Kong 4 Beaches 香港四灘.'),

('00000000-0000-4000-8000-000000000032',
 'Open Water Swimming Association India',
 'https://www.openwaterswimsindia.com/event', 'organiser', 3, 'IN', NULL,
 ARRAY['en'], 'jsonld_html', true, 'monthly', now(),
 'Verified 2026-08-04: server-rendered, has a sitemap. Small (~3 events, e.g. Goa Sea Pride) but '
 'it is the only working India source found.'),

('00000000-0000-4000-8000-000000000033',
 'U.S. Masters Swimming — events calendar',
 'https://www.usms.org/events', 'governing_body', 1, 'US', NULL,
 ARRAY['en'], 'jsonld_html', true, 'weekly', now(),
 'Verified 2026-08-04: JAVASCRIPT-RENDERED — a plain GET returns "No results were found" whatever '
 'the query string, because results are fetched client-side. Yields nothing until '
 'DISCOVERY_PLAYWRIGHT_ENABLED=true. Highest-authority US source, so worth the render cost. '
 '/open-water-central is a hub page with no listings — do not point this row at it.'),

-- ── EUROPE ───────────────────────────────────────────────────────────
-- Every row below fetched with the real crawler on 2026-08-04 and
-- returned HTTP 200 with event names in the raw HTML, unless noted.

('00000000-0000-4000-8000-000000000034',
 'Dansk Svømmeunion — åbent vand',
 'https://www.svoem.org/Discipliner/Aabent-vand/', 'governing_body', 1, 'DK', NULL,
 ARRAY['da'], 'jsonld_html', true, 'weekly', now(),
 'Verified 2026-08-04 with the real crawler: HTTP 200, server-rendered Danish, 26 same-site links. '
 'Danish federation — Copenhagen Beach Swim, HIMMELBJERGSVØM, TrygFonden Christiansborg Rundt. '
 'Directly answers "what is on in Denmark in September", which the catalogue previously could not.'),

('00000000-0000-4000-8000-000000000035',
 'Medley.no — terminliste open water (Norwegian federation portal)',
 'https://medley.no/terminliste.aspx?gren=5', 'governing_body', 1, 'NO', NULL,
 ARRAY['no','en'], 'jsonld_html', true, 'weekly', now(),
 'Verified 2026-08-04: HTTP 200, server-rendered, 54 links. NOTE the federation''s own site '
 'svomming.no is stale (2015–2018) and points readers here — crawl medley.no, not svomming.no.'),

('00000000-0000-4000-8000-000000000036',
 'Lopplistan — alla Sveriges simlopp',
 'https://lopplistan.se/sverige/simning/alla-/', 'aggregator', 3, 'SE', NULL,
 ARRAY['sv'], 'jsonld_html', true, 'weekly', now(),
 'Verified 2026-08-04: HTTP 200, server-rendered Swedish, 26k chars, 53 links, no sitemap. '
 '~30 events — Vansbro, Göteborgsimmet, Malmö Open Water Swim, Torekov, Runn.'),

('00000000-0000-4000-8000-000000000037',
 'Vansbrosimningen — våra lopp',
 'https://www.vansbrosimningen.se/vara-lopp/', 'organiser', 3, 'SE', NULL,
 ARRAY['sv','en'], 'jsonld_html', true, 'monthly', now(),
 'Verified 2026-08-04: HTTP 200, server-rendered. Sweden''s biggest open water week (one venue, '
 '~10 races), hence monthly rather than weekly.'),

('00000000-0000-4000-8000-000000000038',
 'Uimaliitto — tapahtumat (Finnish Swimming Federation)',
 'https://www.uimaliitto.fi/tapahtumat/', 'governing_body', 1, 'FI', NULL,
 ARRAY['fi'], 'jsonld_html', true, 'weekly', now(),
 'Verified 2026-08-04: HTTP 200, server-rendered Finnish, 66 links, sitemap present. All swimming '
 'disciplines with open water mixed in (Avovesiuinnin SM-kilpailut), so expect classifier rejections.'),

('00000000-0000-4000-8000-000000000039',
 'NOWW — Nederlandse Open Water Wedstrijden agenda',
 'https://www.noww.nl/agenda', 'aggregator', 3, 'NL', 'Low Countries',
 ARRAY['nl','en'], 'jsonld_html', true, 'weekly', now(),
 'Verified 2026-08-04: HTTP 200, server-rendered, 93 links — the most of any European source. '
 '~39 events and it also carries BE, GB, AT and LU races under country-prefixed titles.'),

('00000000-0000-4000-8000-00000000003a',
 'KNZB — wedstrijdkalender openwaterzwemmen',
 'https://www.knzb.nl/openwaterzwemmen/wedstrijdkalender', 'governing_body', 1, 'NL', NULL,
 ARRAY['nl'], 'jsonld_html', true, 'weekly', now(),
 'Verified 2026-08-04: HTTP 200 for our crawler, and 45 event-like URLs in its sitemap — but the '
 'listing page itself returned only 928 chars of text, far thinner than its content warrants. '
 'Likely a soft bot-block or client-side rendering of the calendar body. The sitemap route is the '
 'reliable one here; if candidates stay at zero, this is a rendering candidate rather than a dead source.'),

('00000000-0000-4000-8000-00000000003b',
 'Deutscher Schwimm-Verband — Terminkalender',
 'https://dsvdaten.dsv.de/Modules/Schedule/Schedule.aspx', 'governing_body', 1, 'DE', NULL,
 ARRAY['de'], 'jsonld_html', false, 'weekly', NULL,
 'SEEDED DISABLED — dsvdaten.dsv.de/robots.txt DISALLOWS this path for our crawler, and the '
 'crawler correctly refused to fetch it. We do not override robots. Content-wise it is the German '
 'federation''s real data endpoint (~23 events with a "Freiwasser" venue type), and note the public '
 'page dsv.de/.../kalender/ is only a shell that iframes this URL, so there is no compliant '
 'alternative path. The fix is human: ask the DSV for permission. Until then, German coverage comes '
 'from the Alpen Open Water Cup row (…003c).'),

('00000000-0000-4000-8000-00000000003c',
 'arena Alpen Open Water Cup — Veranstaltungen',
 'https://alpen-open-watercup.de/veranstaltungen-2/', 'organiser', 3, 'DE', 'Alps (DE + AT)',
 ARRAY['de'], 'jsonld_html', true, 'weekly', now(),
 'Verified 2026-08-04: HTTP 200, server-rendered German, 88k chars, 25 event-like sitemap URLs. '
 '9 races across Germany and Austria with dates and distances.'),

('00000000-0000-4000-8000-00000000003d',
 'Alpen Adria Swim Cup — events',
 'https://www.alpenadriaswimcup.at/events-2026', 'organiser', 3, 'AT', 'Alps-Adriatic (AT/SI/HR)',
 ARRAY['de'], 'jsonld_html', true, 'monthly', now(),
 'Verified 2026-08-04: HTTP 200 but only 2 same-site links on a 650k-char page — an unusual shape, '
 'so its 6 event-like sitemap URLs are the useful channel. 8 races across Austria, Slovenia and Croatia.'),

('00000000-0000-4000-8000-00000000003e',
 'FFN Eau Libre — calendrier',
 'https://www.ffneaulibre.fr/calendrier', 'governing_body', 1, 'FR', NULL,
 ARRAY['fr'], 'jsonld_html', true, 'weekly', now(),
 'Verified 2026-08-04: HTTP 200, server-rendered French, 42 links. 34 events — EDF Aqua Challenge, '
 'Coupe de France Eau Libre stages, Traversée du lac d''Annecy. Its /sitemap.xml 500s, so link '
 'discovery is the channel here.'),

('00000000-0000-4000-8000-00000000003f',
 'Combinaison-Néoprène — calendrier eau libre',
 'https://www.combinaison-neoprene.com/courses/calendrier-eau-libre/', 'aggregator', 3, 'FR', NULL,
 ARRAY['fr'], 'jsonld_html', true, 'weekly', now(),
 'Verified 2026-08-04: HTTP 200, 159k chars, 13 event-like sitemap URLs. ~80 events — MORE than the '
 'French federation''s own calendar, and the highest French count found. Also carries a Swiss and a '
 'Martinique race.'),

('00000000-0000-4000-8000-000000000040',
 'Open-Water.pl — kalendarz zawodów',
 'https://open-water.pl/index.php/kalendarz-zawodow', 'aggregator', 3, 'PL', NULL,
 ARRAY['pl'], 'jsonld_html', true, 'weekly', now(),
 'Verified 2026-08-04: HTTP 200, server-rendered Polish, no sitemap. ~35 events including '
 'Mistrzostwa Polski Żnin, Grand Prix Wielkopolski, Sopocki Maraton Pływacki. Beats the Polish '
 'federation, whose calendar is a PDF-only download and therefore not crawlable.'),

('00000000-0000-4000-8000-000000000041',
 'RaceFinder.pt — águas abertas',
 'https://racefinder.pt/events/natacao/aguas-abertas/', 'aggregator', 3, 'PT', NULL,
 ARRAY['pt','en'], 'jsonld_html', true, 'weekly', now(),
 'Verified 2026-08-04: HTTP 200, and 209 event-like sitemap URLs — the richest sitemap in the '
 'European batch. NOTE the Portuguese federation (fpnatacao.pt) 403s and its 15-stage national '
 'circuit is the biggest blocked target in Europe; this aggregator is the compliant substitute.'),

('00000000-0000-4000-8000-000000000042',
 'Hrvatski savez daljinskog plivanja (Croatian open water federation)',
 'https://hsdp.hr/', 'governing_body', 1, 'HR', NULL,
 ARRAY['hr','en'], 'jsonld_html', true, 'weekly', now(),
 'Verified 2026-08-04: HTTP 200, 83 links, 38 event-like sitemap URLs. ACI CRO CUP races — Raslina, '
 'Podstrana, Olib-Silba, Vinišće. CAVEAT: their /kalendar-cro-cupa-2026/ page publishes the calendar '
 'as a SCREENSHOT IMAGE with no extractable text, so races have to come from the news/post stream.'),

('00000000-0000-4000-8000-000000000043',
 'SwimBikeRun.gr — multisports calendar',
 'https://swimbikerun.gr/multisports-calendar-2026/', 'aggregator', 3, 'GR', NULL,
 ARRAY['el','en'], 'jsonld_html', true, 'weekly', now(),
 'Verified 2026-08-04: HTTP 200, 24 event-like sitemap URLs. ~40 events of which ~8 are open water '
 '(DIAPLOUS PLUS+, XTERRA OWS, MILTIADEIA). Best Greek source — the Greek federation (koe.org.gr) '
 'publishes no open water calendar at all.')

ON CONFLICT (id) DO NOTHING;

COMMIT;

-- ----------------------------------------------------------------
-- ROLLBACK — exact SQL to undo, or state:
-- "irreversible — restore from _bak_YYYYMMDD_tablename"
-- ----------------------------------------------------------------
-- Fully reversible — the ids are fixed precisely so this is exact.
-- Deleting a source CASCADEs to its discovery_source_pages,
-- discovery_runs and discovery_candidate_events, so run the softer
-- version first unless you genuinely want the crawl history gone:
--
--   -- Soft: stop crawling, keep everything already found
--   UPDATE discovery_sources SET enabled = false, next_run_at = NULL
--   WHERE id BETWEEN '00000000-0000-4000-8000-000000000020'
--                AND '00000000-0000-4000-8000-000000000050';
--
--   -- Hard: remove the sources and everything discovered through them.
--   -- Already-APPROVED events are NOT affected: event_editions
--   -- .source_candidate_id is ON DELETE SET NULL, never CASCADE.
--   DELETE FROM discovery_sources
--   WHERE id BETWEEN '00000000-0000-4000-8000-000000000020'
--                AND '00000000-0000-4000-8000-000000000050';

-- ----------------------------------------------------------------
-- VERIFY — run on the READ-ONLY connection AFTER applying.
-- State the expected result next to each query.
-- ----------------------------------------------------------------
-- SELECT count(*) FROM discovery_sources;                    -- expect: 40
-- SELECT count(*) FROM discovery_sources WHERE enabled;      -- expect: 37
-- SELECT id, enabled FROM discovery_sources WHERE id IN (
--   '00000000-0000-4000-8000-000000000001',   -- fixture      expect: false
--   '00000000-0000-4000-8000-000000000020',   -- CLDSA (403)  expect: false
--   '00000000-0000-4000-8000-00000000003b');  -- DSV (robots) expect: false
--
-- SELECT country_code, count(*) FROM discovery_sources
--   WHERE enabled GROUP BY country_code ORDER BY count(*) DESC NULLS LAST;
--   -- expect ZA 5; NULL 5 (Ray's Notebook, OceanSwims AU/NZ + 3 pre-existing);
--   --        SE 2, NL 2, FR 2, MX 2, AR 2, NZ 2;
--   --        DK/NO/FI/DE/AT/PL/PT/HR/GR/BR/JP/AE/HK/IN/US 1 each
--
-- Country spread, i.e. the point of this migration:
--   SELECT count(DISTINCT country_code) FROM discovery_sources WHERE enabled;  -- expect: 22
--
-- After the first crawl pass (the worker polls every 15 min, and every
-- row above is due immediately):
--   SELECT s.name, r.status, r.pages_fetched, r.candidates_found
--   FROM discovery_runs r JOIN discovery_sources s ON s.id = r.source_id
--   WHERE r.started_at > now() - interval '2 hours'
--   ORDER BY r.started_at DESC;
--   -- expect: rows for the server-rendered sources with candidates_found > 0;
--   --         swimsa.org (…0024) and usms.org (…0033) at 0 until rendering is on.

-- ----------------------------------------------------------------
-- DELIBERATELY EXCLUDED — verified as not worth a source row.
-- Recorded so nobody re-researches these.
-- ----------------------------------------------------------------
--   403 / blocks bots:      CBDA Brazil federation, ahotu.com,
--                           findarace.com (but its robots declares
--                           sitemap-events-current.xml — the sitemap
--                           route may still work, worth one try),
--                           swimming.org.au (Swimming Australia)
--   Unreachable from here:  globalswimseries.com (carries the Sanlam
--                           Cape Mile — retry, worth having),
--                           freedom-swim.co.za (Robben Island organiser
--                           — retry, worth having),
--                           swimmersguide.co.za,
--                           openwaterswims.ca (NXDOMAIN, likely dead),
--                           mastersswimmingcanada.ca (persistent 503)
--   Loads but has no events: racepass.com/za/swimming-events ("No races
--                           available"), FECHIDA Chile (Instagram embeds
--                           only), FECODA Costa Rica (news, not a
--                           calendar), swimchile.cl, WOWSA /events/
--                           (a course module, not a calendar),
--                           entryninja.com (JS-only, no events in HTML)
--   Stale:                  losquesi.com (still headed 2025),
--                           natacionmexico.com (newest item 2021)
