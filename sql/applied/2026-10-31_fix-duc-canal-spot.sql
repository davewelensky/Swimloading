-- ================================================================
-- SwimLoading — Migration
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
-- Migration: 2026-10-31_fix-duc-canal-spot.sql
-- Process:   see MIGRATIONS.md
-- ================================================================

-- Purpose:
--   The "DUC canal" spot (created 29 Oct 2026) was saved with domain
--   FALSE_BAY, no country and no timezone, and typed LAGOON. It is the
--   canal between the buildings at the Durban Underwater Club (DUC), KZN,
--   where the League swim is held on Sat 31 Oct 2026. Fix it to
--   KwaZulu-Natal / South Africa / Africa/Johannesburg / LAKE / Durban.
--
--   Typing it LAKE (not LAGOON) also takes it out of the marine-temperature
--   cron (api/cron/marine-temps.js fetches only OCEAN + LAGOON), so it stops
--   receiving a modelled SEA-surface temperature that does not apply to a
--   canal. The 17-18 sea-model readings already stored for this spot are
--   removed for the same reason: spot_temp_estimate falls back to the latest
--   model reading with no age limit once the last swimmer log is >24h old,
--   so a stale sea figure would show as the canal's "best" temperature.
--
-- Requested by:
--   Dave (for DUC / Steve) — spots table only, no club feature code, no
--   feature flag involved, no shared app code touched.

-- ----------------------------------------------------------------
-- PRE-CHECKS — run on the READ-ONLY connection BEFORE applying.
-- ----------------------------------------------------------------
-- SELECT id, name, code, domain, area, water_type, country_code, timezone, active
--   FROM public.spots WHERE id = 'f2f114ab-ddc0-460d-bcca-643954dded06';
--   -- expect 1 row: DUC canal / DUC_CANAL / FALSE_BAY / null / LAGOON / null / null / true
-- SELECT count(*) FROM public.spot_water_readings
--   WHERE spot_id = 'f2f114ab-ddc0-460d-bcca-643954dded06';
--   -- expect 17-18 (all source = open_meteo; the cron adds one every 3h, 18 at apply time)
-- SELECT count(*) FROM public.temp_logs
--   WHERE spot_id = 'f2f114ab-ddc0-460d-bcca-643954dded06';
--   -- expect 1 (a swimmer log from 31 Oct; NOT touched by this migration)

-- ----------------------------------------------------------------
-- BACKUP — required before any UPDATE / DELETE.
-- ----------------------------------------------------------------
CREATE TABLE _bak_20261031_spots AS
  SELECT * FROM public.spots
  WHERE id = 'f2f114ab-ddc0-460d-bcca-643954dded06';
ALTER TABLE _bak_20261031_spots ENABLE ROW LEVEL SECURITY;

CREATE TABLE _bak_20261031_spot_water_readings AS
  SELECT * FROM public.spot_water_readings
  WHERE spot_id = 'f2f114ab-ddc0-460d-bcca-643954dded06';
ALTER TABLE _bak_20261031_spot_water_readings ENABLE ROW LEVEL SECURITY;

-- ----------------------------------------------------------------
-- MIGRATION — applied only after Dave types "apply".
-- ----------------------------------------------------------------
BEGIN;

-- 1. The spot itself (exactly 1 row)
UPDATE public.spots
   SET domain       = 'KZN',
       water_type   = 'LAKE',
       country_code = 'ZA',
       timezone     = 'Africa/Johannesburg',
       area         = 'DURBAN'
 WHERE id   = 'f2f114ab-ddc0-460d-bcca-643954dded06'
   AND code = 'DUC_CANAL';

-- 2. Sea-surface model readings that do not apply to a canal (expect 17-18)
DELETE FROM public.spot_water_readings
 WHERE spot_id = 'f2f114ab-ddc0-460d-bcca-643954dded06';

COMMIT;

-- ----------------------------------------------------------------
-- ROLLBACK — exact SQL to undo:
-- ----------------------------------------------------------------
-- UPDATE public.spots
--    SET domain = 'FALSE_BAY', water_type = 'LAGOON', country_code = NULL,
--        timezone = NULL, area = NULL
--  WHERE id = 'f2f114ab-ddc0-460d-bcca-643954dded06';
-- INSERT INTO public.spot_water_readings
--   SELECT * FROM _bak_20261031_spot_water_readings;

-- ----------------------------------------------------------------
-- VERIFY — run on the READ-ONLY connection AFTER applying.
-- ----------------------------------------------------------------
-- SELECT name, code, domain, area, water_type, country_code, timezone, active
--   FROM public.spots WHERE id = 'f2f114ab-ddc0-460d-bcca-643954dded06';
--   -- expect: DUC canal / DUC_CANAL / KZN / DURBAN / LAKE / ZA / Africa/Johannesburg / true
-- SELECT count(*) FROM public.spot_water_readings
--   WHERE spot_id = 'f2f114ab-ddc0-460d-bcca-643954dded06';   -- expect 0
-- SELECT count(*) FROM public.temp_logs
--   WHERE spot_id = 'f2f114ab-ddc0-460d-bcca-643954dded06';   -- expect 1 (unchanged)
-- SELECT best_c, best_source, confidence FROM public.spot_temp_estimate
--   WHERE spot_id = 'f2f114ab-ddc0-460d-bcca-643954dded06';   -- expect swimmer reading (22), source 'swimmer'

-- ================================================================
-- APPLIED 2026-10-31 via the Supabase dashboard SQL editor, by Dave
-- (apply_migration was declined twice at the permission prompt, so the
-- documented dashboard fallback was used). Verified read-only afterwards:
--   spots row:  DUC canal / DUC_CANAL / KZN / DURBAN / LAKE / ZA /
--               Africa/Johannesburg / active
--   spot_water_readings for the spot: 0 (18 deleted, backed up)
--   temp_logs for the spot: 1 (the 22C swimmer log, unchanged)
--   spot_temp_estimate: best_c 22, best_source swimmer, model_c null
--   backups: _bak_20261031_spots (1 row), _bak_20261031_spot_water_readings
--            (18 rows), both with RLS on
-- ================================================================
