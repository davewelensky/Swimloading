-- ================================================================
-- SwimLoading — Migration Template
-- The safety block hard-fails if you are in the wrong project.
-- ================================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM _project_identity WHERE key='project_name' AND value='swimloading') THEN
    RAISE EXCEPTION E'\n WRONG PROJECT — MIGRATION ABORTED. Expected swimloading / szgkzuswelntnevobnoh';
  END IF;
  RAISE NOTICE '✅ Project identity confirmed: swimloading';
END $$;

-- ================================================================
-- Migration: 2026-08-04_swimmer-event-entries.sql
-- Process:   see MIGRATIONS.md
-- ================================================================

-- Purpose:
--   Join the two halves of the product. /explore answers "where can I
--   swim?" and the Passport answers "what have I done?", but nothing
--   connects them: the Passport is driven entirely by temp_logs at
--   SPOTS, and knows nothing about events.
--
--   This adds the missing relation — a swimmer's standing with a
--   specific event edition — which closes the loop:
--     browse /explore -> "I'm interested" -> swim it -> mark it done
--     -> a story event writes itself -> the Passport shows a NAMED SWIM
--     -> back to /explore for the next one.
--
--   Two decisions from Dave (2026-08-04), both reflected below:
--     * "interested should be public" — so an event can show
--       "14 swimmers interested", which is the social signal that makes
--       a listing worth returning to.
--     * "no log required" — a swimmer can record having done a swim they
--       never logged a temperature for. Completion is self-declared and
--       recorded as such; a linked temp_log is optional corroboration.

-- Requested by:
--   Dave — 2026-08-04, "we created a swim passport... do we use the story
--   to mark swims you have done?", then "interested should be public, and
--   no log required".

-- ----------------------------------------------------------------
-- PRIVACY NOTE — read before changing anything here.
-- ----------------------------------------------------------------
--   "Public" means a public COUNT, never a public list of names. This
--   codebase already has an opt-in identity model (profiles.identity_public,
--   guarded by trg_identity_public_guard which forces minors and
--   unknown-DOB users private) and there are children in this database
--   via the club rosters. Exposing who is going to a swim by default
--   would leak a minor's location and plans, so:
--     * anyone may read aggregate counts per edition
--     * NOBODY may read another swimmer's individual entry rows
--     * a named "who's going" list is deliberately NOT built here; if it
--       is ever wanted it must filter on profiles.identity_public and go
--       through its own review.

-- ----------------------------------------------------------------
-- PRE-CHECKS (read-only)
-- ----------------------------------------------------------------
--   SELECT count(*) FROM information_schema.tables
--    WHERE table_name IN ('swimmer_event_entries');            -- expect 0
--   SELECT count(*) FROM event_editions;                        -- expect 185
--   SELECT count(*) FROM information_schema.columns
--    WHERE table_name='profiles' AND column_name='identity_public'; -- expect 1
--
-- Confirm the existing story_type values before they are rebuilt below,
-- so nothing is silently dropped from the CHECK (expect the 15 listed in
-- section 3b, and NOT 'event_completed'):
--   SELECT pg_get_constraintdef(oid) FROM pg_constraint
--    WHERE conname = 'swimmer_story_events_story_type_check';

-- ----------------------------------------------------------------
-- BACKUP — not required: creates new objects, alters no existing data.
-- ----------------------------------------------------------------

BEGIN;

-- ── 1. The relation ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.swimmer_event_entries (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  edition_id   uuid NOT NULL REFERENCES public.event_editions(id) ON DELETE CASCADE,
  status       text NOT NULL DEFAULT 'interested'
                 CHECK (status IN ('interested','entered','completed')),
  -- Completion is self-declared by decision: requiring a temperature log
  -- would exclude every swim done before SwimLoading existed, which is
  -- most of anyone's swimming life.
  completed_on date,
  -- Optional corroboration, never required. When present the Passport can
  -- show the water temperature the swimmer actually recorded.
  source_log_id uuid REFERENCES public.temp_logs(id) ON DELETE SET NULL,
  note         text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),

  -- One standing per swimmer per edition; changing your mind is an UPDATE.
  CONSTRAINT swimmer_event_entries_uniq UNIQUE (user_id, edition_id),
  -- A completion needs a date; anything else must not carry one.
  CONSTRAINT swimmer_event_entries_completed_date
    CHECK ((status = 'completed') = (completed_on IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS swimmer_event_entries_edition_idx
  ON public.swimmer_event_entries (edition_id, status);
CREATE INDEX IF NOT EXISTS swimmer_event_entries_user_idx
  ON public.swimmer_event_entries (user_id, status);

COMMENT ON TABLE public.swimmer_event_entries IS
  'A swimmer''s standing with one event edition: interested / entered / '
  'completed. Individual rows are private to their owner; only aggregate '
  'counts are public (see event_interest_counts).';

-- ── 2. RLS: own your rows, nobody reads anyone else''s ─────────────────
ALTER TABLE public.swimmer_event_entries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS see_select_own ON public.swimmer_event_entries;
CREATE POLICY see_select_own ON public.swimmer_event_entries
  FOR SELECT TO authenticated USING (user_id = auth.uid());

DROP POLICY IF EXISTS see_insert_own ON public.swimmer_event_entries;
CREATE POLICY see_insert_own ON public.swimmer_event_entries
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS see_update_own ON public.swimmer_event_entries;
CREATE POLICY see_update_own ON public.swimmer_event_entries
  FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS see_delete_own ON public.swimmer_event_entries;
CREATE POLICY see_delete_own ON public.swimmer_event_entries
  FOR DELETE TO authenticated USING (user_id = auth.uid());

REVOKE ALL ON public.swimmer_event_entries FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.swimmer_event_entries TO authenticated;

-- ── 3. The public signal: counts only, never identities ───────────────
-- security_invoker = OFF (the default for views) is what lets an
-- anonymous visitor read counts without being able to read the rows the
-- counts came from. That asymmetry is the entire point.
CREATE OR REPLACE VIEW public.event_interest_counts AS
  SELECT edition_id,
         count(*) FILTER (WHERE status = 'interested') AS interested,
         count(*) FILTER (WHERE status = 'entered')    AS entered,
         count(*) FILTER (WHERE status = 'completed')  AS completed,
         count(*)                                      AS total
    FROM public.swimmer_event_entries
   GROUP BY edition_id;

COMMENT ON VIEW public.event_interest_counts IS
  'Aggregate interest per edition for public display. Deliberately counts '
  'only — a named "who is going" list would expose minors'' plans and is '
  'not built here. See the privacy note in this migration.';

GRANT SELECT ON public.event_interest_counts TO anon, authenticated;

-- ── 3b. Admit the new story type ──────────────────────────────────────
-- swimmer_story_events.story_type is a closed CHECK — deliberately, so a
-- typo cannot invent a story kind. 'event_completed' has to be added to
-- it or the trigger below fails on the very first completion. Rebuilt
-- rather than dropped-and-guessed: the existing 15 values are preserved
-- verbatim and one is appended.
ALTER TABLE public.swimmer_story_events
  DROP CONSTRAINT IF EXISTS swimmer_story_events_story_type_check;
ALTER TABLE public.swimmer_story_events
  ADD CONSTRAINT swimmer_story_events_story_type_check
  CHECK (story_type = ANY (ARRAY[
    'first_swim','swim_count_milestone','first_spot_visit','spots_explored_milestone',
    'spot_visit_milestone','new_coldest_swim','new_warmest_swim','first_sub_16',
    'first_sub_13','first_sub_10','first_sub_7','first_sub_5','first_pool_swim',
    'first_open_water_swim','streak_milestone',
    'event_completed'
  ]));

-- ── 4. Completing a swim writes its own story ─────────────────────────
-- Consistent with every other story type: generated from something the
-- swimmer did, never typed in as a claim. Marked pending_verification
-- because it is self-declared — corroboration would come from a linked
-- temp_log or, later, an organiser's results.
CREATE OR REPLACE FUNCTION public.emit_event_completion_story()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_title text;
  v_place text;
  v_spot  uuid;
BEGIN
  IF NEW.status IS DISTINCT FROM 'completed' THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = 'completed' THEN RETURN NEW; END IF;

  SELECT e.title,
         nullif(concat_ws(', ', v.city, v.country_code), ''),
         v.spot_id
    INTO v_title, v_place, v_spot
    FROM event_editions e
    LEFT JOIN event_venues v ON v.id = e.venue_id
   WHERE e.id = NEW.edition_id;

  INSERT INTO swimmer_story_events
    (user_id, temp_log_id, story_type, story_date, title, summary,
     spot_id, metadata, verification_status, visibility, dedupe_key)
  VALUES
    (NEW.user_id, NEW.source_log_id, 'event_completed', NEW.completed_on,
     COALESCE(v_title, 'Open water event'),
     CASE WHEN v_place IS NULL THEN 'You swam it.'
          ELSE 'You swam it — ' || v_place || '.' END,
     v_spot,
     jsonb_build_object('edition_id', NEW.edition_id, 'self_declared', NEW.source_log_id IS NULL),
     'pending_verification', 'private',
     'event_completed:' || NEW.user_id::text || ':' || NEW.edition_id::text)
  ON CONFLICT DO NOTHING;

  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_event_completion_story ON public.swimmer_event_entries;
CREATE TRIGGER trg_event_completion_story
  AFTER INSERT OR UPDATE OF status ON public.swimmer_event_entries
  FOR EACH ROW EXECUTE FUNCTION public.emit_event_completion_story();

REVOKE ALL ON FUNCTION public.emit_event_completion_story() FROM public, anon, authenticated;

COMMIT;

-- ----------------------------------------------------------------
-- ROLLBACK
-- ----------------------------------------------------------------
-- BEGIN;
-- DROP TRIGGER IF EXISTS trg_event_completion_story ON public.swimmer_event_entries;
-- DROP FUNCTION IF EXISTS public.emit_event_completion_story();
-- DROP VIEW IF EXISTS public.event_interest_counts;
-- DROP TABLE IF EXISTS public.swimmer_event_entries;
-- DELETE FROM swimmer_story_events WHERE story_type = 'event_completed';
-- COMMIT;

-- ----------------------------------------------------------------
-- VERIFY (read-only)
-- ----------------------------------------------------------------
-- Anonymous can read counts but NOT rows — the whole privacy contract:
--   SELECT count(*) FROM information_schema.role_table_grants
--    WHERE table_name='swimmer_event_entries' AND grantee='anon';   -- expect 0
--   SELECT count(*) FROM information_schema.role_table_grants
--    WHERE table_name='event_interest_counts' AND grantee='anon';   -- expect 1
--
-- RLS is on and scoped to the owner:
--   SELECT relrowsecurity FROM pg_class
--    WHERE oid='swimmer_event_entries'::regclass;                   -- expect true
--   SELECT count(*) FROM pg_policies
--    WHERE tablename='swimmer_event_entries';                       -- expect 4
--
-- The story type is wired:
--   SELECT tgname FROM pg_trigger
--    WHERE tgrelid='swimmer_event_entries'::regclass AND NOT tgisinternal;
--   -- expect trg_event_completion_story
