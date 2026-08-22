-- ⚠️  SAFETY CHECK
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM _project_identity WHERE key='project_name' AND value='swimloading') THEN
    RAISE EXCEPTION 'WRONG PROJECT — MIGRATION ABORTED. Expected swimloading (szgkzuswelntnevobnoh).'
    USING HINT = 'Check the project ref in your Supabase dashboard URL';
  END IF;
  RAISE NOTICE '✅ Project identity confirmed: swimloading';
END $$;

-- ================================================================
-- Migration: 2026-08-22_group-swim-reports.sql
-- ================================================================

-- Purpose:
--   Somewhere to put the answer when we ask a swimmer "do you swim here with
--   a regular group?". scripts/detect-group-swims.mjs finds 11 candidates and
--   names the 84 swimmers who were there; this is where their answers land.
--   A report is a lead for review, never a published listing.

-- Requested by:
--   Dave, 22 Aug 2026.

-- Why a separate table rather than writing recurring_swims directly:
--   recurring_swims is public — /explore reads it and /group-swims/{slug}
--   publishes it. A swimmer's answer is one person's account of somebody
--   else's group, and publishing it unreviewed would put a stranger's swim
--   on the internet with a time and a meeting point nobody confirmed. Every
--   row in recurring_swims today was checked by hand and says where it came
--   from; that stays true.

-- The 'no' answer matters as much as the 'yes':
--   It is how we stop asking. Without recording it, the same swimmer gets the
--   same question every time they log at their local beach, which is how a
--   helpful prompt becomes the reason someone stops logging.

-- ----------------------------------------------------------------
-- PRE-CHECKS — read-only, before applying.
-- ----------------------------------------------------------------
--   SELECT count(*) FROM information_schema.tables
--    WHERE table_schema='public' AND table_name='group_swim_reports';   -- expect 0

-- ----------------------------------------------------------------
-- BACKUP — not required: creates a new table, modifies nothing.
-- ----------------------------------------------------------------

-- ----------------------------------------------------------------
-- MIGRATION — applied only after Dave types "apply".
-- ----------------------------------------------------------------
BEGIN;

CREATE TABLE IF NOT EXISTS public.group_swim_reports (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  spot_id       uuid NOT NULL REFERENCES public.spots(id) ON DELETE CASCADE,

  -- 'yes' there is a group, 'no' there is not, 'skip' they dismissed it.
  -- All three stop us asking again; only 'yes' is a lead.
  answer        text NOT NULL CHECK (answer IN ('yes','no','skip')),

  -- Everything below is optional and in the swimmer's own words. Nothing is
  -- required beyond the answer: a prompt that demands six fields is a prompt
  -- people dismiss.
  group_name    text,
  schedule_text text,
  meeting_point text,
  contact       text,
  open_to_newcomers boolean,
  notes         text,

  -- What we asked about, so a lead can be read without re-deriving it.
  observed_dow  smallint CHECK (observed_dow BETWEEN 0 AND 6),

  status        text NOT NULL DEFAULT 'new' CHECK (status IN ('new','reviewed','published','rejected')),
  reviewed_at   timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- One answer per swimmer per spot. Asking again after they said no is the
-- fastest way to make the prompt unwelcome; the app checks this, and the
-- index is what makes that check both cheap and enforced.
CREATE UNIQUE INDEX IF NOT EXISTS group_swim_reports_user_spot_idx
  ON public.group_swim_reports (user_id, spot_id);

CREATE INDEX IF NOT EXISTS group_swim_reports_triage_idx
  ON public.group_swim_reports (status, created_at DESC)
  WHERE answer = 'yes';

ALTER TABLE public.group_swim_reports ENABLE ROW LEVEL SECURITY;

-- A swimmer may file their own answer and read it back — the app needs the
-- read to know whether it has already asked.
CREATE POLICY group_swim_reports_insert_own ON public.group_swim_reports
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

CREATE POLICY group_swim_reports_select_own ON public.group_swim_reports
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

-- Deliberately NOT readable by other swimmers, unlike hazard_reports. A
-- hazard is a warning everyone needs now; this is an unverified account of
-- someone else's group, and it belongs to review until a human publishes it.
CREATE POLICY group_swim_reports_admin_all ON public.group_swim_reports
  FOR ALL USING (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.is_admin))
           WITH CHECK (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.is_admin));

COMMENT ON TABLE public.group_swim_reports IS
  'Swimmer answers to "do you swim here with a regular group?", asked after a temp log. Leads for review, never published directly — recurring_swims is public and every row in it was checked by hand.';

COMMIT;

-- ----------------------------------------------------------------
-- ROLLBACK
-- ----------------------------------------------------------------
--   DROP TABLE IF EXISTS public.group_swim_reports;

-- ----------------------------------------------------------------
-- VERIFY — read-only, after applying.
-- ----------------------------------------------------------------
--   -- Table, RLS on, four policies (expect 1, true, 4):
--   SELECT (SELECT count(*) FROM information_schema.tables
--            WHERE table_schema='public' AND table_name='group_swim_reports') AS tbl,
--          (SELECT relrowsecurity FROM pg_class WHERE relname='group_swim_reports') AS rls_on,
--          (SELECT count(*) FROM pg_policies WHERE tablename='group_swim_reports') AS policies;
--
--   -- Anon cannot read it at all (expect false):
--   SELECT has_table_privilege('anon', 'public.group_swim_reports', 'SELECT') AS anon_can_read;
--
--   -- The triage query the review will use:
--   SELECT r.created_at, s.name AS spot, r.group_name, r.schedule_text, r.contact
--     FROM group_swim_reports r JOIN spots s ON s.id = r.spot_id
--    WHERE r.answer='yes' AND r.status='new' ORDER BY r.created_at DESC;
