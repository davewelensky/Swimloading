-- ⚠️  SAFETY CHECK: runs first, aborts everything if wrong project
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM _project_identity
    WHERE key = 'project_name' AND value = 'swimloading'
  ) THEN
    RAISE EXCEPTION
      E'\n\n'
      '╔══════════════════════════════════════════════════════════╗\n'
      '║  WRONG PROJECT: MIGRATION ABORTED                        ║\n'
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
-- Migration: 2026-09-23_swim-lab-enquiries.sql
-- Process:   see MIGRATIONS.md
-- ================================================================

-- Purpose:
--   Create swim_lab_enquiries, the lead table behind the booking form on
--   /aquasharks-lab (Aquasharks Lab stroke-analysis marketing page). Anonymous
--   visitors INSERT only; reads are restricted to club admins and SwimLoading
--   admins. Nothing here touches any existing table.

-- Requested by:
--   Dave (Aquasharks, Britt's club), 23 Sep 2026

-- ----------------------------------------------------------------
-- PRE-CHECKS: run READ-ONLY before applying.
-- ----------------------------------------------------------------
-- Expect: 0 rows (table must not already exist)
-- SELECT count(*) FROM information_schema.tables
--  WHERE table_schema = 'public' AND table_name = 'swim_lab_enquiries';

-- ----------------------------------------------------------------
-- BACKUP: not required. This migration is CREATE-only:
-- no DELETE / UPDATE / DROP / TRUNCATE against existing data.
-- ----------------------------------------------------------------

-- ----------------------------------------------------------------
-- MIGRATION: applied only after Dave types "apply".
-- ----------------------------------------------------------------
BEGIN;

CREATE TABLE public.swim_lab_enquiries (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at    timestamptz NOT NULL DEFAULT now(),

  club_slug     text,                      -- 'aqua-sharks-atlantic'
  source        text,                      -- 'aquasharks-lab'

  contact_name  text        NOT NULL,
  swimmer_name  text,                      -- null when the swimmer is the contact
  email         text        NOT NULL,
  phone         text,
  squad         text,
  package       text,                      -- 'full' | 'monthly' | null
  notes         text,

  status        text        NOT NULL DEFAULT 'new',   -- new | contacted | booked | closed
  handled_by    uuid,                      -- club_admins.user_id who picked it up
  handled_at    timestamptz,

  CONSTRAINT swim_lab_enquiries_contact_name_len CHECK (char_length(contact_name) BETWEEN 1 AND 120),
  CONSTRAINT swim_lab_enquiries_email_len        CHECK (char_length(email)        BETWEEN 3 AND 254),
  CONSTRAINT swim_lab_enquiries_email_shape      CHECK (email LIKE '%_@_%._%'),
  CONSTRAINT swim_lab_enquiries_swimmer_len      CHECK (swimmer_name IS NULL OR char_length(swimmer_name) <= 120),
  CONSTRAINT swim_lab_enquiries_phone_len        CHECK (phone        IS NULL OR char_length(phone)        <= 40),
  CONSTRAINT swim_lab_enquiries_squad_len        CHECK (squad        IS NULL OR char_length(squad)        <= 120),
  CONSTRAINT swim_lab_enquiries_notes_len        CHECK (notes        IS NULL OR char_length(notes)        <= 2000),
  CONSTRAINT swim_lab_enquiries_package_vals     CHECK (package IS NULL OR package IN ('full','monthly')),
  CONSTRAINT swim_lab_enquiries_status_vals      CHECK (status  IN ('new','contacted','booked','closed'))
);

CREATE INDEX swim_lab_enquiries_created_idx ON public.swim_lab_enquiries (created_at DESC);
CREATE INDEX swim_lab_enquiries_club_idx    ON public.swim_lab_enquiries (club_slug, status);

ALTER TABLE public.swim_lab_enquiries ENABLE ROW LEVEL SECURITY;

-- Anonymous visitors may submit the form, and nothing else.
CREATE POLICY swim_lab_enquiries_public_insert
  ON public.swim_lab_enquiries
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

-- Admins of the named club may read and update their own club's enquiries.
CREATE POLICY swim_lab_enquiries_club_admin_select
  ON public.swim_lab_enquiries
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
        FROM public.club_admins ca
        JOIN public.clubs c ON c.id = ca.club_id
       WHERE ca.user_id = auth.uid()
         AND c.slug     = swim_lab_enquiries.club_slug
    )
  );

CREATE POLICY swim_lab_enquiries_club_admin_update
  ON public.swim_lab_enquiries
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
        FROM public.club_admins ca
        JOIN public.clubs c ON c.id = ca.club_id
       WHERE ca.user_id = auth.uid()
         AND c.slug     = swim_lab_enquiries.club_slug
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
        FROM public.club_admins ca
        JOIN public.clubs c ON c.id = ca.club_id
       WHERE ca.user_id = auth.uid()
         AND c.slug     = swim_lab_enquiries.club_slug
    )
  );

COMMENT ON TABLE public.swim_lab_enquiries IS
  'Booking enquiries from the Aquasharks Lab stroke-analysis page (/aquasharks-lab). Public INSERT, club-admin SELECT/UPDATE.';

COMMIT;

-- ----------------------------------------------------------------
-- ROLLBACK
-- ----------------------------------------------------------------
-- DROP TABLE IF EXISTS public.swim_lab_enquiries;
-- (Safe: the table is new and holds no pre-existing data. If leads have
--  already been captured, export them first. They exist nowhere else.)

-- ----------------------------------------------------------------
-- VERIFY: run READ-ONLY after applying.
-- ----------------------------------------------------------------
-- SELECT count(*) FROM public.swim_lab_enquiries;
--   -- expect: 0

-- SELECT relrowsecurity FROM pg_class WHERE relname = 'swim_lab_enquiries';
--   -- expect: true

-- SELECT policyname, cmd FROM pg_policies
--  WHERE schemaname = 'public' AND tablename = 'swim_lab_enquiries'
--  ORDER BY policyname;
--   -- expect exactly 3 rows:
--   --   swim_lab_enquiries_club_admin_select  | SELECT
--   --   swim_lab_enquiries_club_admin_update  | UPDATE
--   --   swim_lab_enquiries_public_insert      | INSERT
