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
-- Migration: 2026-10-30_temp-logs-wetsuit.sql
-- Process:   see MIGRATIONS.md — no section below may be left empty
-- ================================================================

-- Purpose:
--   Add a nullable boolean temp_logs.wetsuit (true = wetsuit, false = no
--   wetsuit / skins, NULL = not said) so swimmers can tag a swim, and the new
--   "Pace by water temperature" profile card can separate wetsuit swims from
--   skins swims. Cold swims are mostly wetsuit swims, which would otherwise
--   distort a pace-vs-temperature comparison.
--   Additive only: no backfill, no default, no change to any existing row.

-- Requested by:
--   Dave (Swim Smooth GURU email -> "pace vs water temp" + wetsuit chip)

-- ----------------------------------------------------------------
-- PRE-CHECKS — run on the READ-ONLY connection BEFORE applying.
-- ----------------------------------------------------------------
-- SELECT count(*) FROM information_schema.columns
--   WHERE table_schema = 'public' AND table_name = 'temp_logs' AND column_name = 'wetsuit';
--   -- expect: 0 (column does not exist yet)
-- SELECT count(*) FROM public.temp_logs;
--   -- expect: ~8,195 and unchanged by this migration (no UPDATE/DELETE below)
-- SELECT r.rolname,
--   has_table_privilege(r.rolname, 'public.temp_logs', 'SELECT') AS table_select,
--   has_table_privilege(r.rolname, 'public.temp_logs', 'INSERT') AS table_insert,
--   has_table_privilege(r.rolname, 'public.temp_logs', 'UPDATE') AS table_update
--   FROM pg_roles r WHERE r.rolname IN ('anon','authenticated','service_role');
--   -- dry-run result 2026-10-30: authenticated = SELECT/INSERT/UPDATE all true (new column
--   -- is usable by logged-in swimmers with no GRANT needed). anon = table_select false
--   -- (column-level SELECT on 16 columns only), so the new column is NOT readable by
--   -- logged-out visitors. That is the intended outcome.

-- ----------------------------------------------------------------
-- BACKUP — not required: no DELETE / UPDATE / DROP / TRUNCATE below.
-- The only statement adds a new, empty, nullable column.
-- ----------------------------------------------------------------

-- ----------------------------------------------------------------
-- MIGRATION — applied only after Dave types "apply".
-- ----------------------------------------------------------------
BEGIN;

ALTER TABLE public.temp_logs
  ADD COLUMN IF NOT EXISTS wetsuit boolean;

COMMENT ON COLUMN public.temp_logs.wetsuit IS
  'Optional swimmer tag: true = wetsuit, false = no wetsuit (skins), NULL = not said. Used only by the personal pace-by-temperature card.';

COMMIT;

-- ----------------------------------------------------------------
-- ROLLBACK — exact SQL to undo:
--   ALTER TABLE public.temp_logs DROP COLUMN wetsuit;
-- Loses only tags swimmers entered after this migration (the column is new,
-- so there is nothing to restore and no _bak_ table). Roll the app code back
-- first, otherwise inserts that include "wetsuit" will error.
-- ----------------------------------------------------------------

-- ----------------------------------------------------------------
-- VERIFY — run on the READ-ONLY connection AFTER applying.
-- ----------------------------------------------------------------
-- SELECT column_name, data_type, is_nullable FROM information_schema.columns
--   WHERE table_schema = 'public' AND table_name = 'temp_logs' AND column_name = 'wetsuit';
--   -- expect: one row, boolean, YES
-- SELECT count(*) FILTER (WHERE wetsuit IS NOT NULL) AS tagged, count(*) AS total FROM public.temp_logs;
--   -- expect: tagged = 0 right after apply; total unchanged (~8,195)

-- ----------------------------------------------------------------
-- APPLIED 2026-10-30 via supabase-admin apply_migration, name
-- '2026_10_30_temp_logs_wetsuit'. Dave typed "apply". The tool supplies the
-- transaction, so the explicit BEGIN/COMMIT above were omitted from the call
-- (the safety block, ALTER and COMMENT ran exactly as written).
-- VERIFIED read-only: wetsuit | boolean | nullable; 0 tagged of 8,200 logs
-- (no existing row changed); authenticated insert/update/select = true;
-- anon select = false.
-- ----------------------------------------------------------------
