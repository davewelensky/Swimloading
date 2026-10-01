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
    RAISE EXCEPTION
      E'\n\nWRONG PROJECT — MIGRATION ABORTED\nExpected project ref: szgkzuswelntnevobnoh\nNo changes have been made.'
    USING HINT = 'Check the project ref in your Supabase dashboard URL';
  END IF;
  RAISE NOTICE 'Project identity confirmed: swimloading (szgkzuswelntnevobnoh)';
END $$;

-- ================================================================
-- Migration: 2026-10-01_swim-lab-assessments.sql
-- ================================================================

-- Purpose:
--   Store Aquasharks Lab SwimBETTER assessments (EO source data, approved
--   coaching interpretation, evidence page images) so a retest can show progress.
--   Club: Aquasharks only. Written/read ONLY by /api/lab-report.js (service key,
--   club_admins check). RLS on with NO policies = no direct client access.

-- Requested by:
--   Dave (Aqua Sharks SwimBETTER Report Generator)

-- ----------------------------------------------------------------
-- PRE-CHECKS (read-only)
-- ----------------------------------------------------------------
-- SELECT to_regclass('public.swim_lab_assessments');      -- expect: NULL (table does not exist yet)
-- SELECT id FROM storage.buckets WHERE id = 'lab-evidence'; -- expect: 0 rows
-- No UPDATE/DELETE/DROP in this migration, so no backup table is needed.

-- ----------------------------------------------------------------
-- MIGRATION
-- ----------------------------------------------------------------
BEGIN;

CREATE TABLE public.swim_lab_assessments (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club_slug        text NOT NULL DEFAULT 'aqua-sharks-atlantic',
  swimmer_name     text NOT NULL,
  swimmer_key      text NOT NULL,            -- lower(trim(name)); matches a retest to the earlier test
  roster_id        uuid REFERENCES public.club_roster(id) ON DELETE SET NULL,
  session_date     date,
  swimmer_type     text CHECK (swimmer_type IN ('junior','senior','masters')),
  primary_focus    text,
  stroke           text,
  pool_length      text,
  coach            text,
  previous_id      uuid REFERENCES public.swim_lab_assessments(id) ON DELETE SET NULL,
  source_filename  text,
  normalized       jsonb NOT NULL,           -- EO measured data + observations (coach-approved)
  interpretation   jsonb,                    -- Aqua Sharks interpretation (coach-edited)
  evidence         jsonb,                    -- [{id,title,path}] pages in the lab-evidence bucket
  status           text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','approved')),
  approved_by      uuid,
  approved_at      timestamptz,
  created_by       uuid,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX swim_lab_assessments_swimmer_idx ON public.swim_lab_assessments (club_slug, swimmer_key, session_date DESC);

ALTER TABLE public.swim_lab_assessments ENABLE ROW LEVEL SECURITY;
-- Deliberately no policies: only the service role (the API) can read or write.

-- Private bucket for the EO source pages. No storage policies = service role only;
-- the API hands out short-lived signed URLs.
INSERT INTO storage.buckets (id, name, public) VALUES ('lab-evidence', 'lab-evidence', false);

COMMIT;

-- ----------------------------------------------------------------
-- ROLLBACK
-- ----------------------------------------------------------------
-- DROP TABLE public.swim_lab_assessments;
-- DELETE FROM storage.buckets WHERE id = 'lab-evidence';  -- after emptying it
-- (new table, no pre-existing data: nothing to restore)

-- ----------------------------------------------------------------
-- VERIFY (read-only, after applying)
-- ----------------------------------------------------------------
-- SELECT count(*) FROM public.swim_lab_assessments;                                  -- expect: 0
-- SELECT relrowsecurity FROM pg_class WHERE relname='swim_lab_assessments';          -- expect: true
-- SELECT count(*) FROM pg_policies WHERE tablename='swim_lab_assessments';           -- expect: 0
-- SELECT id, public FROM storage.buckets WHERE id='lab-evidence';                    -- expect: 1 row, public=false
