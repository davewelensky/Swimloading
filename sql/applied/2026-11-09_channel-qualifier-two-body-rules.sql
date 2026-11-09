-- ================================================================
-- SwimLoading — Migration Template
-- The safety block hard-fails if you are in the wrong project.
-- ================================================================

-- SAFETY CHECK — runs first, aborts everything if wrong project
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM _project_identity
    WHERE key = 'project_name' AND value = 'swimloading'
  ) THEN
    RAISE EXCEPTION 'WRONG PROJECT — MIGRATION ABORTED. Expected project ref szgkzuswelntnevobnoh. No changes have been made.'
    USING HINT = 'Check the project ref in your Supabase dashboard URL';
  END IF;
  RAISE NOTICE 'Project identity confirmed: swimloading (szgkzuswelntnevobnoh)';
END $$;

-- ================================================================
-- Migration: 2026-11-09_channel-qualifier-two-body-rules.sql
-- Process:   see MIGRATIONS.md — no section below may be left empty
-- STATUS:    APPLIED 9 Nov 2026 via supabase-admin after Dave typed "apply". Verify queries passed.
-- ================================================================

-- Purpose:
--   The English Channel now has two qualifier rules: CSA 8 hours from 2027, CS&PF 6 hours.
--   One crossings row cannot hold both in qualifying_duration_minutes, so add a
--   qualifying_rules jsonb column holding one entry per governing body, filled for
--   english-channel only. The existing columns are NOT changed: they keep gating the
--   qualifier section on every crossing and stay correct for the CS&PF.
--
--   Sources (governing bodies only):
--   CSA notice 21 Oct 2026  https://www.channelswimmingassociation.com/news/219/qualifying-swim-8-hours
--   CSA step-by-step guide  https://www.channelswimmingassociation.com/swim-advice/a-step-by-step-guide
--   CS&PF notice 9 Oct 2026 https://cspf.co.uk/article/246/6-hour-assessment-swim
--   CS&PF Assessment Swim Form 2026, linked from https://cspf.co.uk/documents

-- Requested by:
--   Dave, via the Channel qualifier content update (9 Nov 2026)

-- ----------------------------------------------------------------
-- PRE-CHECKS — run on the READ-ONLY connection BEFORE applying.
-- ----------------------------------------------------------------
-- SELECT count(*) FROM crossings WHERE slug = 'english-channel';                         -- expect 1 (the UPDATE touches this row only)
-- SELECT count(*) FROM information_schema.columns
--   WHERE table_schema='public' AND table_name='crossings' AND column_name='qualifying_rules'; -- expect 0
-- SELECT count(*) FROM information_schema.tables
--   WHERE table_schema='public' AND table_name='_bak_20261109_crossings';                -- expect 0

-- ----------------------------------------------------------------
-- BACKUP + MIGRATION — applied only after Dave types "apply".
-- ----------------------------------------------------------------
BEGIN;

CREATE TABLE _bak_20261109_crossings AS
  SELECT * FROM crossings WHERE slug = 'english-channel';
ALTER TABLE _bak_20261109_crossings ENABLE ROW LEVEL SECURITY;

ALTER TABLE crossings ADD COLUMN qualifying_rules jsonb;

COMMENT ON COLUMN crossings.qualifying_rules IS
  'Per-governing-body qualifier rules where bodies differ. NULL = use qualifying_duration_minutes / qualifying_temp_limit_c.';

UPDATE crossings
SET qualifying_rules = $json$[
  {
    "body": "CSA",
    "body_name": "Channel Swimming Association",
    "duration_minutes": 480,
    "applies_from_year": 2027,
    "temp_limit_f": 60,
    "temp_limit_c": 15.5,
    "validity_text": "within 12 months of the swim, with some grace given",
    "note": "Whether a 6-hour CSA qualifier swum before the change counts for a 2027 CSA swim is unconfirmed.",
    "source_url": "https://www.channelswimmingassociation.com/news/219/qualifying-swim-8-hours"
  },
  {
    "body": "CS&PF",
    "body_name": "Channel Swimming & Piloting Federation",
    "duration_minutes": 360,
    "applies_from_year": null,
    "temp_limit_f": 61,
    "temp_limit_c": 16,
    "validity_text": "up to 18 months before the booked tide",
    "note": null,
    "source_url": "https://cspf.co.uk/article/246/6-hour-assessment-swim"
  }
]$json$::jsonb
WHERE slug = 'english-channel';

COMMIT;

-- ----------------------------------------------------------------
-- ROLLBACK
-- ----------------------------------------------------------------
-- ALTER TABLE crossings DROP COLUMN qualifying_rules;
-- (No other column is changed. _bak_20261109_crossings holds the pre-change row.)

-- ----------------------------------------------------------------
-- VERIFY — run on the READ-ONLY connection AFTER applying.
-- ----------------------------------------------------------------
-- SELECT slug, jsonb_array_length(qualifying_rules) FROM crossings WHERE qualifying_rules IS NOT NULL;
--   expect: one row, english-channel, 2
-- SELECT qualifying_duration_minutes, qualifying_temp_limit_c FROM crossings WHERE slug = 'english-channel';
--   expect: 360, 16 (unchanged)
-- SELECT r->>'body', r->>'duration_minutes', r->>'temp_limit_f'
--   FROM crossings, jsonb_array_elements(qualifying_rules) r WHERE slug = 'english-channel';
--   expect: CSA 480 60; CS&PF 360 61
-- SELECT relrowsecurity FROM pg_class WHERE relname = '_bak_20261109_crossings';
--   expect: true
