-- ⚠️  SAFETY CHECK: runs first, aborts everything if wrong project
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM _project_identity
    WHERE key = 'project_name' AND value = 'swimloading'
  ) THEN
    RAISE EXCEPTION
      E'\n\n'
      '╔══════════════════════════════════════════════════════════╗\n'
      '║  WRONG PROJECT: MIGRATION ABORTED                        ║\n'
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
-- Migration: 2026-11-16_water-latest-fast-lookup.sql  (APPLIED 16 Nov 2026; verified: 119/210 rows, venue_temp_estimate 18 ms warm, search_events_v2 homepage call 75 ms)
-- Process:   see MIGRATIONS.md
-- ================================================================

-- Purpose:
--   Stop the public temperature views timing out.
--
--   spot_water_latest and venue_water_latest picked each place's newest
--   modelled reading with DISTINCT ON over the WHOLE history
--   (spot_water_readings ~117k rows, venue_water_readings ~44k, both growing
--   every 3 hours from the marine cron). Every call to spot_temp_estimate,
--   venue_temp_estimate and search_events_v2 paid for that full scan
--   (~118k buffer reads), so as the history grew they averaged ~750 ms and
--   their tail hit the 3 s anon statement_timeout. Supabase logs, 24 h to
--   16 Nov 2026 10:58 UTC: 401 "canceling statement due to statement
--   timeout" (venue_temp_estimate 177, search_events_v2 162,
--   spot_temp_estimate 60). The homepage "Find a swim" strip, /explore and
--   the app's spot-picker temperature dots all fail silently when that
--   happens.
--
--   Fix: same two views, same columns, same rows, but each now walks the
--   existing (spot_id|venue_id, source, observed_at) unique index: a
--   recursive skip-scan finds the distinct (place, source) pairs, then one
--   index probe per pair takes the newest reading. ~240 index probes instead
--   of a 117k-row scan, and it no longer grows with history.
--
--   Results are identical, not approximately equal: (place, source,
--   observed_at) is UNIQUE on both tables, so "newest per pair" has exactly
--   one answer either way. Dry-run on live data 16 Nov 2026: 119/119 spot
--   rows and 210/210 venue rows, EXCEPT both directions = 0. Timing,
--   5-run average: spot_water_latest 38.4 ms old vs 2.6 ms new.
--
--   Unchanged: view names, column names/types/order (CREATE OR REPLACE
--   requires it), owners, grants (anon/authenticated SELECT), and
--   security_invoker=true on spot_water_latest (venue_water_latest has none,
--   as before). Dependent views spot_temp_estimate / venue_temp_estimate and
--   search_events_v2 are not touched and pick this up automatically.

-- Requested by:
--   Dave, 16 Nov 2026 ("Find a swim" section on the homepage does not always
--   render). Not a club change.

-- ----------------------------------------------------------------
-- PRE-CHECKS: run READ-ONLY before applying.
-- ----------------------------------------------------------------
-- Expect: both unique indexes present (the new views depend on them for speed)
-- SELECT indexname FROM pg_indexes WHERE indexname IN
--   ('spot_water_readings_spot_id_source_observed_at_key','venue_water_readings_uniq',
--    'idx_spot_water_readings_spot_source_time','idx_venue_water_readings_venue_source_time');
--   -- expect 4 rows
--
-- Expect: 0 rows differ (run the two SELECTs below as CTEs against the old
-- views with EXCEPT in both directions; done 16 Nov 2026, all 0).

-- ----------------------------------------------------------------
-- BACKUP: not required. Only view definitions change; no table data is
-- touched. The old definitions are in ROLLBACK below, verbatim.
-- ----------------------------------------------------------------

-- ----------------------------------------------------------------
-- MIGRATION: applied only after Dave types "apply".
-- ----------------------------------------------------------------
BEGIN;

CREATE OR REPLACE VIEW public.spot_water_latest WITH (security_invoker = true) AS
WITH RECURSIVE pairs AS (
  (SELECT w.spot_id, w.source
     FROM public.spot_water_readings w
    ORDER BY w.spot_id, w.source
    LIMIT 1)
  UNION ALL
  SELECT nx.spot_id, nx.source
    FROM pairs p
    CROSS JOIN LATERAL (
      SELECT w.spot_id, w.source
        FROM public.spot_water_readings w
       WHERE (w.spot_id, w.source) > (p.spot_id, p.source)
       ORDER BY w.spot_id, w.source
       LIMIT 1) nx
)
SELECT p.spot_id,
       p.source,
       r.sst_c,
       r.wave_height_m,
       r.observed_at,
       r.fetched_at
  FROM pairs p
  CROSS JOIN LATERAL (
    SELECT w.sst_c, w.wave_height_m, w.observed_at, w.fetched_at
      FROM public.spot_water_readings w
     WHERE w.spot_id = p.spot_id AND w.source = p.source
     ORDER BY w.observed_at DESC
     LIMIT 1) r;

CREATE OR REPLACE VIEW public.venue_water_latest AS
WITH RECURSIVE pairs AS (
  (SELECT w.venue_id, w.source
     FROM public.venue_water_readings w
    ORDER BY w.venue_id, w.source
    LIMIT 1)
  UNION ALL
  SELECT nx.venue_id, nx.source
    FROM pairs p
    CROSS JOIN LATERAL (
      SELECT w.venue_id, w.source
        FROM public.venue_water_readings w
       WHERE (w.venue_id, w.source) > (p.venue_id, p.source)
       ORDER BY w.venue_id, w.source
       LIMIT 1) nx
)
SELECT p.venue_id,
       p.source,
       r.sst_c,
       r.wave_height_m,
       r.observed_at,
       r.fetched_at
  FROM pairs p
  CROSS JOIN LATERAL (
    SELECT w.sst_c, w.wave_height_m, w.observed_at, w.fetched_at
      FROM public.venue_water_readings w
     WHERE w.venue_id = p.venue_id AND w.source = p.source
     ORDER BY w.observed_at DESC
     LIMIT 1) r;

COMMENT ON VIEW public.spot_water_latest IS
  'Newest modelled reading per (spot, source). Index skip-scan, not DISTINCT ON over history: see sql/applied/2026-11-16_water-latest-fast-lookup.sql.';
COMMENT ON VIEW public.venue_water_latest IS
  'Newest modelled reading per (venue, source). Index skip-scan, not DISTINCT ON over history: see sql/applied/2026-11-16_water-latest-fast-lookup.sql.';

COMMIT;

-- ----------------------------------------------------------------
-- ROLLBACK: the exact previous definitions.
-- ----------------------------------------------------------------
-- BEGIN;
-- CREATE OR REPLACE VIEW public.spot_water_latest WITH (security_invoker = true) AS
--  SELECT DISTINCT ON (spot_id, source) spot_id, source, sst_c, wave_height_m, observed_at, fetched_at
--    FROM spot_water_readings
--   ORDER BY spot_id, source, observed_at DESC;
-- CREATE OR REPLACE VIEW public.venue_water_latest AS
--  SELECT DISTINCT ON (venue_id, source) venue_id, source, sst_c, wave_height_m, observed_at, fetched_at
--    FROM venue_water_readings
--   ORDER BY venue_id, source, observed_at DESC;
-- COMMENT ON VIEW public.spot_water_latest IS NULL;
-- COMMENT ON VIEW public.venue_water_latest IS NULL;
-- COMMIT;

-- ----------------------------------------------------------------
-- VERIFY: run READ-ONLY after applying.
-- ----------------------------------------------------------------
-- SELECT count(*) FROM spot_water_latest;   -- expect 119 (as of 16 Nov 2026)
-- SELECT count(*) FROM venue_water_latest;  -- expect 210
-- SELECT reloptions FROM pg_class WHERE relname = 'spot_water_latest';   -- expect {security_invoker=true}
-- SELECT has_table_privilege('anon','public.spot_water_latest','SELECT'),
--        has_table_privilege('anon','public.venue_water_latest','SELECT'); -- expect true, true
-- EXPLAIN ANALYZE SELECT * FROM venue_temp_estimate;  -- expect well under the old ~185 ms
-- Then, over the next hours: statement timeouts in postgres_logs should drop
-- from ~17/hour towards 0.
