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
      '║  No changes have been made. Check your browser URL.      ║\n'
      '╚══════════════════════════════════════════════════════════╝'
    USING HINT = 'Check the project ref in your Supabase dashboard URL';
  END IF;
  RAISE NOTICE '✅ Project identity confirmed: swimloading (szgkzuswelntnevobnoh)';
END $$;

-- ================================================================
-- Migration: 2026-09-25_swim-lab-slots.sql
-- Process:   see MIGRATIONS.md
-- ================================================================

-- Purpose:
--   Saturday slot booking for Aquasharks Lab. Britt opens a day; the system
--   generates 30 minute slots; a parent picks a free one from /aquasharks-lab
--   and books it themselves. The point is that Britt never negotiates a time
--   over WhatsApp, because that admin is exactly what has stalled this before.
--
--   Two tables rather than one, so a day can be closed or its notes changed
--   without touching bookings, and so a slot carries its own booking.

-- Requested by:
--   Dave, 25 Sep 2026. Session length (30 min) and venue confirmed 23 Sep 2026.

-- ----------------------------------------------------------------
-- PRE-CHECKS: run READ-ONLY before applying.
-- ----------------------------------------------------------------
-- Expect 0 for both, neither table may already exist:
-- SELECT count(*) FROM information_schema.tables
--  WHERE table_schema='public' AND table_name IN ('swim_lab_days','swim_lab_slots');
--
-- Expect 1, the club the days will belong to:
-- SELECT count(*) FROM public.clubs WHERE slug = 'aqua-sharks-atlantic';

-- ----------------------------------------------------------------
-- BACKUP: not required. CREATE-only, no existing data is touched.
-- ----------------------------------------------------------------

-- ----------------------------------------------------------------
-- MIGRATION: applied only after Dave types "apply".
-- ----------------------------------------------------------------
BEGIN;

CREATE TABLE public.swim_lab_days (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at    timestamptz NOT NULL DEFAULT now(),
  club_slug     text        NOT NULL,
  session_date  date        NOT NULL,
  start_time    time        NOT NULL,
  slot_minutes  int         NOT NULL DEFAULT 30,
  is_open       boolean     NOT NULL DEFAULT true,
  note          text,

  CONSTRAINT swim_lab_days_slot_minutes_sane CHECK (slot_minutes BETWEEN 10 AND 120),
  CONSTRAINT swim_lab_days_note_len          CHECK (note IS NULL OR char_length(note) <= 400),
  -- one entry per club per day, so a double tap cannot create two mornings
  CONSTRAINT swim_lab_days_unique_per_club   UNIQUE (club_slug, session_date)
);

CREATE TABLE public.swim_lab_slots (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  day_id        uuid        NOT NULL REFERENCES public.swim_lab_days(id) ON DELETE CASCADE,
  starts_at     timestamptz NOT NULL,
  status        text        NOT NULL DEFAULT 'open',

  -- booking details, all null until someone takes the slot
  contact_name  text,
  swimmer_name  text,
  email         text,
  phone         text,
  squad         text,
  notes         text,
  booked_at     timestamptz,

  CONSTRAINT swim_lab_slots_status_vals CHECK (status IN ('open','booked','blocked')),
  -- a booked slot must carry who booked it; an open one must not
  CONSTRAINT swim_lab_slots_booking_shape CHECK (
    (status = 'booked' AND contact_name IS NOT NULL AND email IS NOT NULL AND booked_at IS NOT NULL)
    OR (status <> 'booked' AND contact_name IS NULL AND email IS NULL)
  ),
  CONSTRAINT swim_lab_slots_name_len  CHECK (contact_name IS NULL OR char_length(contact_name) BETWEEN 1 AND 120),
  CONSTRAINT swim_lab_slots_email_len CHECK (email IS NULL OR char_length(email) BETWEEN 3 AND 254),
  CONSTRAINT swim_lab_slots_notes_len CHECK (notes IS NULL OR char_length(notes) <= 2000),
  -- two slots cannot start at the same moment on the same day
  CONSTRAINT swim_lab_slots_unique_start UNIQUE (day_id, starts_at)
);

CREATE INDEX swim_lab_days_lookup  ON public.swim_lab_days (club_slug, session_date DESC);
CREATE INDEX swim_lab_slots_day    ON public.swim_lab_slots (day_id, starts_at);
CREATE INDEX swim_lab_slots_status ON public.swim_lab_slots (status, starts_at);

ALTER TABLE public.swim_lab_days  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.swim_lab_slots ENABLE ROW LEVEL SECURITY;

-- Anyone may see which days are open, so the public page can list them.
CREATE POLICY swim_lab_days_public_read
  ON public.swim_lab_days FOR SELECT TO anon, authenticated
  USING (is_open = true);

-- Club admins manage their own club's days.
CREATE POLICY swim_lab_days_admin_all
  ON public.swim_lab_days FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.club_admins ca JOIN public.clubs c ON c.id = ca.club_id
     WHERE ca.user_id = auth.uid() AND c.slug = swim_lab_days.club_slug))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.club_admins ca JOIN public.clubs c ON c.id = ca.club_id
     WHERE ca.user_id = auth.uid() AND c.slug = swim_lab_days.club_slug));

-- The public page needs to know which slots exist and which are taken, but it
-- must never see who booked them. The API serves the public view with the
-- service key and returns only id, starts_at and status, so no policy here
-- grants anonymous SELECT on the row itself.
CREATE POLICY swim_lab_slots_admin_all
  ON public.swim_lab_slots FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.swim_lab_days d
      JOIN public.clubs c ON c.slug = d.club_slug
      JOIN public.club_admins ca ON ca.club_id = c.id
     WHERE d.id = swim_lab_slots.day_id AND ca.user_id = auth.uid()))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.swim_lab_days d
      JOIN public.clubs c ON c.slug = d.club_slug
      JOIN public.club_admins ca ON ca.club_id = c.id
     WHERE d.id = swim_lab_slots.day_id AND ca.user_id = auth.uid()));

COMMENT ON TABLE public.swim_lab_days IS
  'A morning of Aquasharks Lab slots. Britt opens one; slots are generated from start_time and slot_minutes.';
COMMENT ON TABLE public.swim_lab_slots IS
  'One bookable slot. Booking is an UPDATE ... WHERE status = ''open'', which is atomic, so two parents cannot take the same slot.';

COMMIT;

-- ----------------------------------------------------------------
-- ROLLBACK
-- ----------------------------------------------------------------
-- DROP TABLE IF EXISTS public.swim_lab_slots;   -- drop first, it references days
-- DROP TABLE IF EXISTS public.swim_lab_days;
-- Safe while no bookings exist. If any slot is booked, export it first:
--   SELECT * FROM public.swim_lab_slots WHERE status = 'booked';

-- ----------------------------------------------------------------
-- VERIFY: run READ-ONLY after applying.
-- ----------------------------------------------------------------
-- SELECT count(*) FROM public.swim_lab_days;     -- expect: 0
-- SELECT count(*) FROM public.swim_lab_slots;    -- expect: 0
--
-- SELECT relname, relrowsecurity FROM pg_class
--  WHERE relname IN ('swim_lab_days','swim_lab_slots');
--   -- expect: both true
--
-- SELECT tablename, policyname, cmd FROM pg_policies
--  WHERE schemaname='public' AND tablename IN ('swim_lab_days','swim_lab_slots')
--  ORDER BY tablename, policyname;
--   -- expect exactly 3 rows:
--   --   swim_lab_days  | swim_lab_days_admin_all    | ALL
--   --   swim_lab_days  | swim_lab_days_public_read  | SELECT
--   --   swim_lab_slots | swim_lab_slots_admin_all   | ALL
