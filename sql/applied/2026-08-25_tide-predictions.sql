-- ⚠️  SAFETY CHECK
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM _project_identity WHERE key='project_name' AND value='swimloading') THEN
    RAISE EXCEPTION 'WRONG PROJECT — MIGRATION ABORTED. Expected swimloading (szgkzuswelntnevobnoh).'
    USING HINT = 'Check the project ref in your Supabase dashboard URL';
  END IF;
  RAISE NOTICE '✅ Project identity confirmed: swimloading';
END $$;

-- ================================================================
-- Migration: 2026-08-25_tide-predictions.sql
-- ================================================================

-- Purpose:
--   Store tide extremes so the public pages read them from Postgres instead
--   of every visitor costing a WorldTides credit.
--
--   August burned 661 credits against July's 115 — not because the key was
--   public (though it was, and is now rotated and server-side), but because
--   nothing was cached. Every page load on /robben, /intel and /preekstool
--   was one upstream call, and two of those pages appended
--   &_=${Date.now()} which defeated caching on purpose.
--
--   Edge caching alone does not fix this: Vercel's cache is per region, so
--   Cape Town, London and US visitors each warm their own copy. A daily cron
--   into this table makes the cost exactly 4 calls a day — about 120 credits
--   a month, flat, no matter how popular the pages get.

-- Requested by:
--   Dave, 25 Aug 2026, after reading the usage chart.

-- Why storing predictions is safe:
--   Tide extremes are HARMONICS. They are computed from the moon and the
--   coastline, not observed, so a row is exactly as correct a week after it
--   was fetched as the minute it arrived. This is unlike spot_water_readings
--   or observations, which record something measured and go stale by nature.
--   The only thing that expires here is the WINDOW: a 2-day fetch stops
--   covering "the next tide" once it is 2 days old.

-- Public read, service-role write — same shape as spot_water_readings. The
-- data is a published tide table, not a user's anything, and /api/tides
-- serves it to anonymous visitors.

-- ----------------------------------------------------------------
-- PRE-CHECKS — read-only, before applying.
-- ----------------------------------------------------------------
--   SELECT count(*) FROM information_schema.tables
--    WHERE table_schema='public' AND table_name='tide_predictions';   -- expect 0

-- ----------------------------------------------------------------
-- BACKUP — not required: creates a new table, modifies nothing.
-- ----------------------------------------------------------------

-- ----------------------------------------------------------------
-- MIGRATION — applied only after Dave types "apply".
-- ----------------------------------------------------------------
BEGIN;

CREATE TABLE IF NOT EXISTS public.tide_predictions (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

  -- Matches a key in api/_lib/tide-places.js. Deliberately a plain text key
  -- rather than a spot_id: these are named tide stations the crossing pages
  -- ask about, not swim spots, and Dover is not a spot at all.
  place        text        NOT NULL,

  extreme_at   timestamptz NOT NULL,
  height_m     numeric(6,3),
  extreme_type text        NOT NULL CHECK (extreme_type IN ('High','Low')),

  fetched_at   timestamptz NOT NULL DEFAULT now()
);

-- One row per extreme per place. Re-fetching the same window is then an
-- idempotent upsert rather than a duplicate — the cron runs daily over
-- overlapping windows by design, so this does the real de-duplication.
CREATE UNIQUE INDEX IF NOT EXISTS tide_predictions_place_time_idx
  ON public.tide_predictions (place, extreme_at);

-- The only query the route makes: this place, from now, in order.
CREATE INDEX IF NOT EXISTS tide_predictions_lookup_idx
  ON public.tide_predictions (place, extreme_at DESC);

ALTER TABLE public.tide_predictions ENABLE ROW LEVEL SECURITY;

CREATE POLICY tide_predictions_public_read ON public.tide_predictions
  FOR SELECT USING (true);

COMMENT ON TABLE public.tide_predictions IS
  'Tide extremes from WorldTides, refreshed daily by /api/cron/tides and served by /api/tides. Harmonic predictions, not measurements — a stored row does not go stale, only its window runs out. Places are defined in api/_lib/tide-places.js.';

COMMIT;

-- ----------------------------------------------------------------
-- ROLLBACK
-- ----------------------------------------------------------------
--   DROP TABLE IF EXISTS public.tide_predictions;
--   -- /api/tides falls back to calling WorldTides directly, so the pages
--   -- keep working; only the credit saving is lost.

-- ----------------------------------------------------------------
-- VERIFY — read-only, after applying.
-- ----------------------------------------------------------------
--   -- Table, RLS on, public read (expect 1, true, 1):
--   SELECT (SELECT count(*) FROM information_schema.tables
--            WHERE table_schema='public' AND table_name='tide_predictions')  AS tbl,
--          (SELECT relrowsecurity FROM pg_class WHERE relname='tide_predictions') AS rls_on,
--          (SELECT count(*) FROM pg_policies WHERE tablename='tide_predictions')  AS policies;
--
--   -- Anon CAN read this one, unlike group_swim_reports — it is a published
--   -- tide table and /api/tides serves it anonymously (expect true):
--   SELECT has_table_privilege('anon','public.tide_predictions','SELECT');
--
--   -- After the first cron run, four places with future extremes:
--   SELECT place, count(*) AS extremes, min(extreme_at) AS first, max(extreme_at) AS last
--     FROM tide_predictions WHERE extreme_at > now() GROUP BY place ORDER BY place;
