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
-- Migration: 2026-10-01_swim-lab-assessments.sql   (rewritten before first apply: SwimAnalysis v3 + publishing)
-- ================================================================

-- Purpose:
--   Store Aquasharks Lab SwimBETTER assessments: the parsed EO evidence + coach review (SwimAnalysis v3), the original upload,
--   and a PUBLISHED swimmer-facing report snapshot reachable by an unguessable share token.
--   Club: Aquasharks only. Written/read ONLY by /api/lab-report*.js (service key). Staff access goes through club_admins checks
--   in the API; swimmers/parents reach a report only via its token. RLS on with NO policies = no direct client access.

-- Requested by:
--   Dave (Aqua Sharks SwimBETTER Report Generator; Britt's workflow)

-- ----------------------------------------------------------------
-- PRE-CHECKS (read-only)
-- ----------------------------------------------------------------
-- SELECT to_regclass('public.swim_lab_assessments');        -- expect: NULL (table does not exist yet)
-- SELECT id FROM storage.buckets WHERE id = 'lab-evidence';  -- expect: 0 rows
-- No UPDATE/DELETE/DROP in this migration, so no backup table is needed.

-- ----------------------------------------------------------------
-- MIGRATION
-- ----------------------------------------------------------------
BEGIN;

CREATE TABLE public.swim_lab_assessments (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club_slug              text NOT NULL DEFAULT 'aqua-sharks-atlantic',
  swimmer_name           text NOT NULL,
  swimmer_key            text NOT NULL,                 -- lower(trim(name)): matches a retest to the earlier test
  roster_id              uuid REFERENCES public.club_roster(id) ON DELETE SET NULL,
  session_date           date,
  communication_profile  text CHECK (communication_profile IN ('JUNIOR','PERFORMANCE','MASTERS_OPEN_WATER')),
  previous_id            uuid REFERENCES public.swim_lab_assessments(id) ON DELETE SET NULL,
  schema_version         integer NOT NULL DEFAULT 3,
  analysis               jsonb NOT NULL,                -- SwimAnalysis v3: EO source evidence + coachReview (derived layers are recomputed)
  status                 text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','archived')),
  source_file_path       text,                          -- original upload in the private lab-evidence bucket
  source_file_name       text,
  share_token            text UNIQUE,                   -- null until published; 32+ url-safe characters
  published_report       jsonb,                         -- swimmer-facing report model, frozen at publish time
  published_at           timestamptz,
  published_by           uuid,
  created_by             uuid,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT published_has_token CHECK (status <> 'published' OR (share_token IS NOT NULL AND published_report IS NOT NULL))
);

CREATE INDEX swim_lab_assessments_swimmer_idx ON public.swim_lab_assessments (club_slug, swimmer_key, session_date DESC);

ALTER TABLE public.swim_lab_assessments ENABLE ROW LEVEL SECURITY;
-- Deliberately no policies: only the service role (the API) can read or write.

-- Private bucket for the original EO uploads. No storage policies = service role only.
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
-- SELECT conname FROM pg_constraint WHERE conrelid='public.swim_lab_assessments'::regclass AND contype='c'; -- expect: published_has_token + 2 check constraints
