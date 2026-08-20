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
-- Migration: 2026-08-20_clean-lopplistan-nonswim-candidates.sql
-- Process:   see MIGRATIONS.md — no section below may be left empty
-- ================================================================

-- Purpose:
--   discovery_sources row 00000000-0000-4000-8000-000000000036
--   ("Lopplistan — alla Sveriges simlopp") is scoped to a Swedish
--   swim-race listing, but the crawler walked off it onto the site's
--   all-sports listing between 2026-08-04 and 2026-08-19 (fixed by an
--   expand_url_pattern change already applied to the source row on
--   2026-08-19 12:11 UTC — see discovery-worker/src/jobs/crawl-source.ts
--   line ~305). This cleans up the leftover pollution the bad crawl
--   window already wrote to the database:
--     1. Bulk-rejects every still-pending candidate from this source
--        (Dave manually rejected 46 running/marathon events from the
--        review queue on 2026-08-20 and does not want to triage the rest
--        by hand — they are the same pollution).
--     2. Un-publishes 3 non-swim events (Kretsloppet, Ölands Marathon,
--        Sangis runt) that were wrongly auto-approved and promoted to
--        live event_editions rows before anyone caught the leak.
--   Stockholm Triathlon (candidate 8c50ab6b-8261-42bc-92c7-569c5a3d5716,
--   edition b5d990cb-e8bb-4637-bf70-0ec3bc56c22f) is a genuine multisport
--   swim-leg listing from the same source and is NOT touched.

-- Requested by:
--   Dave

-- ----------------------------------------------------------------
-- PRE-CHECKS — run on the READ-ONLY connection BEFORE applying.
-- Must include affected-row counts for any UPDATE/DELETE.
-- ----------------------------------------------------------------
-- SELECT candidate_status, count(*) FROM discovery_candidate_events
--   WHERE source_id = '00000000-0000-4000-8000-000000000036'
--   GROUP BY candidate_status;
--   -- expect: approved=4, pending=101, rejected=104, duplicate=31 (as of 2026-08-20)
--
-- SELECT count(*) FROM swimmer_event_entries WHERE edition_id IN
--   ('ce4395ea-8256-4ddc-983a-7e7ecc2d5d26','22175694-aa5d-4ace-a6c5-914f0106dd6c','18a13705-f0e6-40cf-9d70-30432b703c65');
--   -- expect: 0 (confirmed 2026-08-20 — no swimmer entered any of these)
--
-- SELECT count(*) FROM event_claims WHERE edition_id IN
--   ('ce4395ea-8256-4ddc-983a-7e7ecc2d5d26','22175694-aa5d-4ace-a6c5-914f0106dd6c','18a13705-f0e6-40cf-9d70-30432b703c65');
--   -- expect: 0 (confirmed 2026-08-20 — none claimed by an organiser)

-- ----------------------------------------------------------------
-- BACKUP — required before any DELETE / UPDATE / DROP / TRUNCATE.
-- ----------------------------------------------------------------
CREATE TABLE _bak_20260820_discovery_candidate_events AS
SELECT * FROM discovery_candidate_events
WHERE source_id = '00000000-0000-4000-8000-000000000036'
  AND (
    candidate_status = 'pending'
    OR id IN (
      'da0d336c-290e-4f89-a1fc-bcb4842eaf18', -- Kretsloppet
      '8a53e876-fd82-4c46-a600-3d181902f0d1', -- Ölands Marathon
      'aa13a4cb-f2ec-49e6-ae4c-5b1476d51d3e'  -- Sangis runt
    )
  );

CREATE TABLE _bak_20260820_event_editions AS
SELECT * FROM event_editions
WHERE id IN (
  'ce4395ea-8256-4ddc-983a-7e7ecc2d5d26', -- Kretsloppet edition
  '22175694-aa5d-4ace-a6c5-914f0106dd6c', -- Ölands Marathon edition
  '18a13705-f0e6-40cf-9d70-30432b703c65'  -- Sangis runt edition
);

-- Cascade children of the 3 editions being deleted, backed up so the
-- rollback can restore them exactly (event_distances/event_change_log
-- have no independent value here, but "no backup, no apply" is the rule).
CREATE TABLE _bak_20260820_event_distances AS
SELECT * FROM event_distances
WHERE edition_id IN (
  'ce4395ea-8256-4ddc-983a-7e7ecc2d5d26',
  '22175694-aa5d-4ace-a6c5-914f0106dd6c',
  '18a13705-f0e6-40cf-9d70-30432b703c65'
);

CREATE TABLE _bak_20260820_event_change_log AS
SELECT * FROM event_change_log
WHERE edition_id IN (
  'ce4395ea-8256-4ddc-983a-7e7ecc2d5d26',
  '22175694-aa5d-4ace-a6c5-914f0106dd6c',
  '18a13705-f0e6-40cf-9d70-30432b703c65'
);

-- ----------------------------------------------------------------
-- MIGRATION — applied only after Dave types "apply".
-- ----------------------------------------------------------------
BEGIN;

-- 1. Bulk-reject every still-pending candidate from the bad source.
UPDATE discovery_candidate_events
SET candidate_status = 'rejected',
    last_reviewed_at = now()
WHERE source_id = '00000000-0000-4000-8000-000000000036'
  AND candidate_status = 'pending';

-- 2. Delete the 3 wrongly-published editions. ON DELETE CASCADE removes
--    their event_distances/event_change_log rows (backed up above);
--    ON DELETE SET NULL clears discovery_candidate_events.promoted_edition_id
--    for the matching candidates, which is required before step 3 can
--    change their candidate_status away from 'approved'
--    (dce_promoted_only_when_approved check constraint).
DELETE FROM event_editions
WHERE id IN (
  'ce4395ea-8256-4ddc-983a-7e7ecc2d5d26',
  '22175694-aa5d-4ace-a6c5-914f0106dd6c',
  '18a13705-f0e6-40cf-9d70-30432b703c65'
);

-- 3. Mark the 3 source candidates rejected now that nothing references them.
UPDATE discovery_candidate_events
SET candidate_status = 'rejected',
    last_reviewed_at = now()
WHERE id IN (
  'da0d336c-290e-4f89-a1fc-bcb4842eaf18',
  '8a53e876-fd82-4c46-a600-3d181902f0d1',
  'aa13a4cb-f2ec-49e6-ae4c-5b1476d51d3e'
);

COMMIT;

-- ----------------------------------------------------------------
-- ROLLBACK — exact SQL to undo, or state:
-- "irreversible — restore from _bak_YYYYMMDD_tablename"
-- ----------------------------------------------------------------
-- BEGIN;
-- INSERT INTO event_editions SELECT * FROM _bak_20260820_event_editions;
-- INSERT INTO event_distances SELECT * FROM _bak_20260820_event_distances;
-- INSERT INTO event_change_log SELECT * FROM _bak_20260820_event_change_log;
-- UPDATE discovery_candidate_events c
-- SET candidate_status = b.candidate_status,
--     promoted_edition_id = b.promoted_edition_id,
--     last_reviewed_at = b.last_reviewed_at
-- FROM _bak_20260820_discovery_candidate_events b
-- WHERE c.id = b.id;
-- COMMIT;

-- ----------------------------------------------------------------
-- VERIFY — run on the READ-ONLY connection AFTER applying.
-- State the expected result next to each query.
-- ----------------------------------------------------------------
-- SELECT candidate_status, count(*) FROM discovery_candidate_events
--   WHERE source_id = '00000000-0000-4000-8000-000000000036'
--   GROUP BY candidate_status;
--   -- expect: pending=0, approved=1 (Stockholm Triathlon only), rejected=~209, duplicate=31
--
-- SELECT id, title FROM event_editions WHERE id IN
--   ('ce4395ea-8256-4ddc-983a-7e7ecc2d5d26','22175694-aa5d-4ace-a6c5-914f0106dd6c','18a13705-f0e6-40cf-9d70-30432b703c65');
--   -- expect: 0 rows
--
-- SELECT id, title, status FROM event_editions WHERE id = 'b5d990cb-e8bb-4637-bf70-0ec3bc56c22f';
--   -- expect: 1 row, "Stockholm Triathlon", untouched
