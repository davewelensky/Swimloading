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
-- Migration: 2026-11-11_crossing-programmes.sql
-- Process:   see MIGRATIONS.md
-- ================================================================

-- Purpose:
--   New table for a swimmer's personal crossing programme, shown on the
--   /crossing-prep Programme tab. A programme holds personal health and
--   training details, so it lives here and never in the (public) repo.
--   The swimmer can read their own programme only once it is published;
--   Dave can read, create, edit and publish. No existing data is touched.
--   The programme content itself is loaded separately from a private file
--   kept outside the repository.

-- Requested by:
--   Dave (11 Nov 2026), for Peter Emslie's English Channel programme.

-- ----------------------------------------------------------------
-- PRE-CHECKS — read-only, before applying
-- ----------------------------------------------------------------
-- SELECT count(*) FROM information_schema.tables
--  WHERE table_schema = 'public' AND table_name = 'crossing_programmes';   -- expect 0

-- ----------------------------------------------------------------
-- BACKUP — not needed: additive only, no DELETE / UPDATE / DROP.
-- ----------------------------------------------------------------

-- ----------------------------------------------------------------
-- MIGRATION
-- ----------------------------------------------------------------
BEGIN;

CREATE TABLE public.crossing_programmes (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    crossing_attempt_id uuid REFERENCES public.crossing_attempts(id) ON DELETE SET NULL,
    title               text NOT NULL,
    plan                jsonb NOT NULL,
    published_at        timestamptz,
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX crossing_programmes_user_idx ON public.crossing_programmes (user_id);

ALTER TABLE public.crossing_programmes ENABLE ROW LEVEL SECURITY;

-- The swimmer sees their own programme only once Dave has published it.
CREATE POLICY crossing_programmes_owner_read ON public.crossing_programmes
    FOR SELECT TO authenticated
    USING (auth.uid() = user_id AND published_at IS NOT NULL);

-- Dave can read drafts, create, edit and publish. Same pattern as the other
-- crossing_* tables' admin policies.
CREATE POLICY crossing_programmes_admin_all ON public.crossing_programmes
    FOR ALL TO authenticated
    USING (auth.uid() = 'df137255-3add-4153-b368-32e06e2be188'::uuid)
    WITH CHECK (auth.uid() = 'df137255-3add-4153-b368-32e06e2be188'::uuid);

REVOKE ALL ON public.crossing_programmes FROM anon;
REVOKE ALL ON public.crossing_programmes FROM authenticated;
GRANT SELECT, INSERT, UPDATE ON public.crossing_programmes TO authenticated;

COMMIT;

-- ----------------------------------------------------------------
-- ROLLBACK
-- ----------------------------------------------------------------
-- DROP TABLE public.crossing_programmes;   -- removes every programme; export any rows first

-- ----------------------------------------------------------------
-- VERIFY — read-only, after applying
-- ----------------------------------------------------------------
-- SELECT relrowsecurity FROM pg_class WHERE oid = 'public.crossing_programmes'::regclass;   -- expect true
-- SELECT policyname, cmd FROM pg_policies WHERE tablename = 'crossing_programmes' ORDER BY 1;
--   expect: crossing_programmes_admin_all ALL, crossing_programmes_owner_read SELECT
-- SELECT has_table_privilege('anon', 'public.crossing_programmes', 'SELECT');               -- expect false
-- SELECT has_table_privilege('authenticated', 'public.crossing_programmes', 'DELETE');      -- expect false
