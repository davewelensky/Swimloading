-- ================================================================
-- SwimLoading — Migration
-- ================================================================

-- ⚠️  SAFETY CHECK — runs first, aborts everything if wrong project
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM _project_identity
    WHERE key = 'project_name' AND value = 'swimloading'
  ) THEN
    RAISE EXCEPTION 'WRONG PROJECT — MIGRATION ABORTED. Expected szgkzuswelntnevobnoh.'
    USING HINT = 'Check the project ref in your Supabase dashboard URL';
  END IF;
  RAISE NOTICE 'Project identity confirmed: swimloading (szgkzuswelntnevobnoh)';
END $$;

-- ================================================================
-- Migration: 2026-09-30_bak-tables-enable-rls.sql
-- ================================================================

-- Purpose:
--   Enable RLS on the 97 backup/scratch tables in public (_bak_*, spots_bak_*,
--   _added_*) that had it OFF. With RLS on and no policies, anon/authenticated
--   get nothing. They were readable AND writable with the public anon key,
--   and included full profile PII (phone, DOB, address, emergency contact),
--   swim-lab enquiries, club rosters and the club_admins list.

-- Requested by:
--   Dave (security review, 30 Sep 2026)

-- Pre-checks (all run read-only on 30 Sep 2026 before writing this file):
--   * No view, function, trigger or foreign key references any of these tables
--   * No app code reads them (only scripts/backfill-crossing-heads.mjs, which
--     uses the service-role key and bypasses RLS)
--   * Every LIVE public table already has RLS on — this touches backups only
--   * 97 target tables currently have RLS off

-- Backup:
--   Not required — no DELETE / UPDATE / DROP / TRUNCATE. Metadata-only change.
--   (The optional DROP section in the PROPOSED file is deliberately NOT included.)

-- Migration:
DO $$
DECLARE
  r record;
  n int := 0;
BEGIN
  FOR r IN
    SELECT c.relname
    FROM pg_class c
    JOIN pg_namespace ns ON ns.oid = c.relnamespace
    WHERE ns.nspname = 'public'
      AND c.relkind = 'r'
      AND NOT c.relrowsecurity
      AND (c.relname LIKE '\_bak\_%' OR c.relname LIKE 'spots\_bak\_%' OR c.relname LIKE '\_added\_%')
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', r.relname);
    n := n + 1;
  END LOOP;
  RAISE NOTICE 'RLS enabled on % backup tables', n;
END $$;

-- Rollback (per table, only if ever needed — restores the exposure):
--   ALTER TABLE public.<table> DISABLE ROW LEVEL SECURITY;

-- Verify (expect 0 rows, and 0):
--   SELECT relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
--    WHERE n.nspname='public' AND c.relkind='r' AND NOT c.relrowsecurity;
--   -- expect: no rows (no public table without RLS)
-- Then re-run the anon probe: the _bak_* tables must return 0 rows/401-empty,
-- and every live public table must return the SAME counts as the baseline.
