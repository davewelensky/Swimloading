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
-- Migration: 2026-11-09_fix-milnerton-high-school-water-type.sql
-- Process:   see MIGRATIONS.md
-- ================================================================

-- Purpose:
--   "Milnerton High school" (spots.id 18b8187a-73a3-4f65-bf98-835e7aa59bd8) is a
--   swimming pool but was saved as water_type OCEAN (the swimmer who suggested it
--   picked OCEAN on 19 Oct and the admin approval on 20 Oct copied it as is).
--   Because it is OCEAN, the 3-hourly marine cron has been storing modelled SEA
--   temperature for it, and spot_temp_estimate now reports 14.7 C (model) for a pool
--   whose swimmer logs are 25-28 C.
--   1. Set water_type = 'POOL'.
--   2. Delete the 157 modelled sea-temperature rows for this spot. They must go:
--      spot_temp_estimate's model branch has no age limit, so they would keep
--      serving the stale 14.7 C after the type change. The cron only fetches
--      OCEAN and LAGOON spots, so it will not write new ones.
--   Domain stays WEST_COAST (valid for pools: Virgin Active Table View is POOL/WEST_COAST).
--   Code, name, coordinates, temp_logs (6), june_challenge_events (6) and
--   swimmer_story_events (1) are not touched.

-- Requested by:
--   Dave, 9 Nov 2026

-- Club / feature flag:
--   Not a club change. Global spots data. No shared code touched.

-- ----------------------------------------------------------------
-- PRE-CHECKS (read-only dry-run, 9 Nov 2026)
-- ----------------------------------------------------------------
-- SELECT id, name, water_type, domain FROM spots WHERE id = '18b8187a-73a3-4f65-bf98-835e7aa59bd8';
--   -> 1 row: Milnerton High school, OCEAN, WEST_COAST
-- SELECT count(*) FROM spot_water_readings WHERE spot_id = '18b8187a-73a3-4f65-bf98-835e7aa59bd8';
--   -> 157 (20 Oct to 9 Nov, +1 about every 3 h while it is still OCEAN, so apply may see a few more)
-- SELECT best_c, best_source, confidence FROM spot_temp_estimate WHERE spot_id = '18b8187a-73a3-4f65-bf98-835e7aa59bd8';
--   -> 14.7, model, medium (wrong: swimmer reports are 25-28 C)
-- October pool leaderboard (get_monthly_temp_leaders): rodhols 14 logs 270 pts today;
--   with this spot counted as a pool: 20 logs 390 pts (still first; display card only, no prize reads it).

-- ----------------------------------------------------------------
-- BACKUP — before any UPDATE / DELETE
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS _bak_20261109_spots_milnerton_high AS
SELECT * FROM spots WHERE id = '18b8187a-73a3-4f65-bf98-835e7aa59bd8';
ALTER TABLE _bak_20261109_spots_milnerton_high ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS _bak_20261109_spot_water_readings_milnerton AS
SELECT * FROM spot_water_readings WHERE spot_id = '18b8187a-73a3-4f65-bf98-835e7aa59bd8';
ALTER TABLE _bak_20261109_spot_water_readings_milnerton ENABLE ROW LEVEL SECURITY;

-- ----------------------------------------------------------------
-- MIGRATION — applied only after Dave types "apply".
-- ----------------------------------------------------------------
BEGIN;

-- 1 row expected. Guarded so it only changes the row if it is still OCEAN.
UPDATE spots
SET water_type = 'POOL'
WHERE id = '18b8187a-73a3-4f65-bf98-835e7aa59bd8'
  AND water_type = 'OCEAN';

-- 157 rows expected (a few more if the cron ran since the dry-run).
DELETE FROM spot_water_readings
WHERE spot_id = '18b8187a-73a3-4f65-bf98-835e7aa59bd8';

COMMIT;

-- ----------------------------------------------------------------
-- ROLLBACK
-- ----------------------------------------------------------------
-- UPDATE spots SET water_type = 'OCEAN' WHERE id = '18b8187a-73a3-4f65-bf98-835e7aa59bd8';
-- INSERT INTO spot_water_readings SELECT * FROM _bak_20261109_spot_water_readings_milnerton ON CONFLICT DO NOTHING;
--   (the marine cron would also refill the readings on its own once the spot is OCEAN again)

-- ----------------------------------------------------------------
-- VERIFY — read-only, after apply
-- ----------------------------------------------------------------
-- SELECT water_type FROM spots WHERE id = '18b8187a-73a3-4f65-bf98-835e7aa59bd8';
--   -- expect POOL
-- SELECT count(*) FROM spot_water_readings WHERE spot_id = '18b8187a-73a3-4f65-bf98-835e7aa59bd8';
--   -- expect 0 (if not 0, the cron wrote a row mid-apply: delete again)
-- SELECT best_c, best_source, confidence FROM spot_temp_estimate WHERE spot_id = '18b8187a-73a3-4f65-bf98-835e7aa59bd8';
--   -- expect best_c NULL, best_source NULL, confidence none (last swimmer log was 30 Oct, older than 7 days)
-- SELECT (SELECT count(*) FROM temp_logs WHERE spot_id = '18b8187a-73a3-4f65-bf98-835e7aa59bd8') AS logs,
--        (SELECT count(*) FROM june_challenge_events WHERE spot_id = '18b8187a-73a3-4f65-bf98-835e7aa59bd8') AS challenge_events;
--   -- expect 6 and 6 (unchanged)
-- SELECT (SELECT count(*) FROM _bak_20261109_spots_milnerton_high) AS spot_bak,
--        (SELECT count(*) FROM _bak_20261109_spot_water_readings_milnerton) AS readings_bak;
--   -- expect 1 and the same number that was deleted (157 or a few more)
