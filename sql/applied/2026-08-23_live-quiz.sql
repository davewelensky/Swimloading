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
-- Migration: 2026-08-23_live-quiz.sql
-- Process:   see MIGRATIONS.md — no section below may be left empty
-- ================================================================

-- Purpose:
--   CLDSA Awards evening (Sept 2026) live quiz: 4 tables, RLS, and the seed
--   event `cldsa2026` with 6 editable questions. All game writes go through
--   /api/live-quiz (service role) — clients get READ-ONLY access to the
--   event, its questions WITHOUT the answer key (via a view), and their own
--   participant/answer rows. Admin edits go through the same API, which
--   re-checks profiles.is_admin (same hardening as the UK challenge RPCs).

-- Requested by:
--   Dave (CLDSA Awards activation brief, 23 Aug 2026)

-- ----------------------------------------------------------------
-- PRE-CHECKS — run on the READ-ONLY connection BEFORE applying.
-- ----------------------------------------------------------------
-- SELECT count(*) FROM information_schema.tables
--   WHERE table_name LIKE 'live_quiz_%';                    -- expect: 0
-- SELECT count(*) FROM profiles WHERE is_admin;              -- expect: 1 (Dave)

-- ----------------------------------------------------------------
-- BACKUP — required before any DELETE / UPDATE / DROP / TRUNCATE.
-- ----------------------------------------------------------------
-- Not applicable — CREATE only, no existing data touched.

-- ----------------------------------------------------------------
-- MIGRATION — applied only after Dave types "apply".
-- ----------------------------------------------------------------
BEGIN;

CREATE TABLE live_quiz_events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug        text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9-]{3,40}$'),
  name        text NOT NULL,
  intro       text,
  prize       text,
  status      text NOT NULL DEFAULT 'draft'
              CHECK (status IN ('draft','open','live','finished')),
  is_active   boolean NOT NULL DEFAULT false,
  starts_at   timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE live_quiz_questions (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id            uuid NOT NULL REFERENCES live_quiz_events(id) ON DELETE CASCADE,
  question            text NOT NULL,
  answer_a            text NOT NULL,
  answer_b            text NOT NULL,
  answer_c            text NOT NULL,
  answer_d            text NOT NULL,
  correct_answer      char(1) NOT NULL CHECK (correct_answer IN ('A','B','C','D')),
  time_limit_seconds  integer NOT NULL DEFAULT 30 CHECK (time_limit_seconds BETWEEN 5 AND 60),
  sort_order          integer NOT NULL DEFAULT 0,
  explanation         text
);
CREATE INDEX live_quiz_questions_event_idx ON live_quiz_questions (event_id, sort_order);

-- profiles(id) not auth.users — same FK choice as the campaign_* tables, so
-- PostgREST can embed profiles(full_name,display_name) for the leaderboard.
CREATE TABLE live_quiz_participants (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id           uuid NOT NULL REFERENCES live_quiz_events(id) ON DELETE CASCADE,
  user_id            uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  joined_at          timestamptz NOT NULL DEFAULT now(),
  total_score        integer NOT NULL DEFAULT 0,
  answered_count     integer NOT NULL DEFAULT 0,
  total_response_ms  integer NOT NULL DEFAULT 0,
  UNIQUE (event_id, user_id)
);
CREATE INDEX live_quiz_participants_board_idx ON live_quiz_participants (event_id, total_score DESC);

-- A row is created when a question is SERVED (served_at) and completed when
-- answered; response_ms is server-measured from served_at. UNIQUE enforces
-- one answer per question per participant regardless of refreshes.
CREATE TABLE live_quiz_answers (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  participant_id   uuid NOT NULL REFERENCES live_quiz_participants(id) ON DELETE CASCADE,
  question_id      uuid NOT NULL REFERENCES live_quiz_questions(id) ON DELETE CASCADE,
  served_at        timestamptz NOT NULL DEFAULT now(),
  selected_answer  char(1) CHECK (selected_answer IN ('A','B','C','D')),
  is_correct       boolean,
  is_late          boolean NOT NULL DEFAULT false,
  response_ms      integer,
  points           integer NOT NULL DEFAULT 0,
  answered_at      timestamptz,
  UNIQUE (participant_id, question_id)
);

-- ── RLS: clients read; the service role (API) writes ─────────────────
ALTER TABLE live_quiz_events       ENABLE ROW LEVEL SECURITY;
ALTER TABLE live_quiz_questions    ENABLE ROW LEVEL SECURITY;
ALTER TABLE live_quiz_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE live_quiz_answers      ENABLE ROW LEVEL SECURITY;

CREATE POLICY "live_quiz_events_public_read" ON live_quiz_events
  FOR SELECT USING (true);

-- Questions: NO direct client SELECT (the row holds correct_answer). Players
-- receive questions from /api/live-quiz/next; admins via /api/live-quiz/admin-event.
CREATE POLICY "live_quiz_questions_admin_read" ON live_quiz_questions
  FOR SELECT USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin));

CREATE POLICY "live_quiz_participants_own_read" ON live_quiz_participants
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "live_quiz_participants_admin_read" ON live_quiz_participants
  FOR SELECT USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin));

CREATE POLICY "live_quiz_answers_own_read" ON live_quiz_answers
  FOR SELECT USING (EXISTS (
    SELECT 1 FROM live_quiz_participants p WHERE p.id = participant_id AND p.user_id = auth.uid()));
-- No INSERT/UPDATE/DELETE policies on any table: all writes are service-role.

-- ── Seed: the CLDSA event + 6 questions (edit in /admin/live-quiz) ──────
-- Kept in step with api/_lib/live-quiz/fixture.js.
-- Fun set agreed with Dave 23 Aug 2026 (relatable cold-water questions, joke distractors).
INSERT INTO live_quiz_events (slug, name, intro, prize, status, is_active, starts_at) VALUES
  ('cldsa2026', 'CLDSA Awards Challenge',
   'How well do you know your open water? Six questions. One winner.',
   'Win a personalised SwimLoading Open Water Performance Assessment',
   'draft', false, '2026-09-12 19:00+02');

INSERT INTO live_quiz_questions (event_id, question, answer_a, answer_b, answer_c, answer_d, correct_answer, time_limit_seconds, sort_order, explanation)
SELECT e.id, q.* FROM live_quiz_events e, (VALUES
  ('"The claw" — when your hands stop working mid-swim — is caused by…',
   'Too much coffee', 'Cold shutting down the nerves and muscles in your forearms', 'Gripping the tow float', 'Judging other people''s stroke', 'B', 30, 1,
   'Cold slows the nerves and muscles in your forearms. Once the claw arrives, it is time to head in.'),
  ('"Afterdrop" is…',
   'The dip in your Strava kudos', 'The moment the coffee van closes', 'Your core temperature carrying on falling after you get out', 'The walk back to the car in a wet costume', 'C', 30, 2,
   'Your core keeps cooling for a while after you leave the water — which is why you feel worse ten minutes later.'),
  ('Which current keeps the Atlantic side of Cape Town so cold?',
   'The Benguela', 'The Agulhas', 'The Sea Point Promenade current', 'Load shedding', 'A', 30, 3,
   'The cold Benguela current, plus upwelling along the west coast.'),
  ('After a cold swim, the right move is…',
   'Straight into a hot shower', 'One more lap to warm up', 'Stand around discussing the temperature', 'Get dry and dressed fast, top half first, then a warm drink', 'D', 30, 4,
   'Dry off, dress quickly from the top down, get out of the wind, warm drink. Hot showers can make afterdrop worse.'),
  ('Robben Island to Blouberg is roughly…',
   '3.4 km', '7.4 km', '12.4 km', 'Far enough, thanks', 'B', 30, 5,
   'About 7.4 km of open Atlantic — short on paper, not in the water.'),
  ('A brightly coloured tow float is mainly for…',
   'Keeping your car keys dry', 'Scaring off seals', 'Being seen by boats and safety crew', 'Floating home when you''ve had enough', 'C', 30, 6,
   'Visibility. Keys stay dry as a bonus, and it is something to hold if you need a breather.')
) AS q(question, a, b, c, d, correct, lim, ord, expl)
WHERE e.slug = 'cldsa2026';

COMMIT;

-- ----------------------------------------------------------------
-- ROLLBACK — exact SQL to undo
-- ----------------------------------------------------------------
-- DROP TABLE live_quiz_answers, live_quiz_participants, live_quiz_questions, live_quiz_events;

-- ----------------------------------------------------------------
-- VERIFY — run on the READ-ONLY connection AFTER applying.
-- ----------------------------------------------------------------
-- SELECT slug, status, is_active FROM live_quiz_events;           -- expect: cldsa2026 | draft | false
-- SELECT count(*) FROM live_quiz_questions;                       -- expect: 6
-- SELECT sort_order, correct_answer FROM live_quiz_questions ORDER BY sort_order; -- expect: 1 B,2 C,3 A,4 D,5 B,6 C
-- SELECT tablename, rowsecurity FROM pg_tables WHERE tablename LIKE 'live_quiz_%'; -- expect: all true
