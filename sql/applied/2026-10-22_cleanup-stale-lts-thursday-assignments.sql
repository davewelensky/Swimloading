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
-- Migration: 2026-10-22_cleanup-stale-lts-thursday-assignments.sql
-- Process:   see MIGRATIONS.md
-- ================================================================

-- Purpose:
--   Remove 8 stale club_session_assignments rows from Linda's Thursday
--   Learn to Swim session (580ce982-...) so its count drops from 13 to 5:
--   4 swimmers who left the club (is_active = false) and 4 swimmers now in
--   a Weizmann squad (their Thursday session is Hazel's Weizmann session).

-- Requested by:
--   Britt (Aquasharks) via Dave, 22 Oct 2026

-- Club / feature flag:
--   Aquasharks (385e2c9d-b32e-47d1-bb1d-1e042523de23) / hasDaySlotScheduling

-- Dry-run (read-only): rows_to_remove = 8, before = 13, after = 5.

-- Backup before delete
CREATE TABLE IF NOT EXISTS _bak_20261022_club_session_assignments AS
SELECT a.*
FROM club_session_assignments a
JOIN club_roster r ON r.id = a.roster_id
LEFT JOIN club_squads q ON q.id = r.squad_id
WHERE a.session_id = '580ce982-f88d-4edb-aebe-c6a781b48e41'
  AND (r.is_active = false OR q.name ILIKE 'Weizmann%');
ALTER TABLE _bak_20261022_club_session_assignments ENABLE ROW LEVEL SECURITY;

DELETE FROM club_session_assignments a
USING club_roster r
LEFT JOIN club_squads q ON q.id = r.squad_id
WHERE r.id = a.roster_id
  AND a.session_id = '580ce982-f88d-4edb-aebe-c6a781b48e41'
  AND (r.is_active = false OR q.name ILIKE 'Weizmann%');

-- Verify (read-only, after apply):
--   SELECT count(*) FROM club_session_assignments
--    WHERE session_id = '580ce982-f88d-4edb-aebe-c6a781b48e41';   -- expect 5
--   SELECT count(*) FROM _bak_20261022_club_session_assignments;   -- expect 8

-- Rollback:
--   INSERT INTO club_session_assignments SELECT * FROM _bak_20261022_club_session_assignments ON CONFLICT DO NOTHING;
