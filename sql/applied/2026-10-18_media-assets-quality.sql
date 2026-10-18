-- ================================================================
-- SwimLoading — Migration (see MIGRATIONS.md)
-- ================================================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM _project_identity WHERE key = 'project_name' AND value = 'swimloading') THEN
    RAISE EXCEPTION 'WRONG PROJECT — MIGRATION ABORTED (expected swimloading, szgkzuswelntnevobnoh)';
  END IF;
END $$;

-- Purpose:      add the optional 1-5 `quality` tie-breaker the image selector uses (catalogue.json already has it).
-- Requested by: Dave
-- PRE-CHECKS:   media_assets exists (applied 18 Oct 2026, 0 rows); column `quality` absent.
-- BACKUP:       not required — additive column on an empty table, no DELETE/UPDATE/DROP/TRUNCATE.
BEGIN;
ALTER TABLE media_assets ADD COLUMN quality smallint CHECK (quality BETWEEN 1 AND 5);
COMMIT;
-- ROLLBACK:     ALTER TABLE media_assets DROP COLUMN quality;
-- VERIFY:       SELECT column_name FROM information_schema.columns WHERE table_name='media_assets' AND column_name='quality';  -- expect 1 row
