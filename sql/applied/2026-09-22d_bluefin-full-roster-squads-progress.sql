-- ================================================================
-- SwimLoading — Migration Template
-- ================================================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM _project_identity WHERE key = 'project_name' AND value = 'swimloading') THEN
    RAISE EXCEPTION 'WRONG PROJECT — MIGRATION ABORTED';
  END IF;
END $$;

-- ================================================================
-- Migration: 2026-09-22d_bluefin-full-roster-squads-progress.sql
-- Process:   see MIGRATIONS.md
-- ================================================================

-- Purpose:
--   Continue Blue Fin onboarding with the real data Tracey sent
--   (spreadsheet + Reddam Foundation LTS report):
--   1. Fix Masters Squad's Tuesday open-water time (was guessed 07:00,
--      confirmed 07:30 — end time still not given, estimated 08:30 to
--      match the 1hr pattern, flagged in the session's notes)
--   2. Add two squads that weren't known before: College Students
--      (Reddam LTS, Tue 16:30-17:30) and Adult Learn to Swim
--      (Wed 09:00-10:00, enrollment for this semester unconfirmed)
--   3. Turn on progress_reports (Aquasharks' existing per-swimmer
--      term-report feature) so Bluefin's coaches can write/update
--      progress notes themselves, per Dave's request
--   4. Import the real roster: 27 more Masters swimmers + 10 Reddam
--      College students (first names only, per Tracey's own privacy
--      practice for minors)
--   5. Add 4 coaches to club_coaches: Monica Theron, Scott Tait,
--      Ursula Morris, Debbie Smith — per Tracey's CURRENT coach list
--   6. Seed one progress_reports row per Reddam College student from
--      the real LTS feedback report Tracey already sent to Nicky
--      Sheridan (Reddam Foundation) — transcribed, not invented —
--      left UNPUBLISHED (is_published=false) so a coach reviews before
--      it becomes visible to any swimmer/parent view

-- Requested by:
--   Dave — "yes, go ahead with all of that" + "the coaches need to
--   create or complete a report on progress per minor/swimmer, this
--   can then be fed into a decent report for nicky"

-- ----------------------------------------------------------------
-- KNOWN OPEN QUESTIONS — not resolved by this migration:
--   - College Students coach: Tracey's message (22 Sep 2026) says
--     Scott Tait + Ursula Morris. The Reddam Foundation feedback PDF
--     says Barbara Johnston-Read coached the reported LTS term. Both
--     can be true (Barbara coached that past term, Scott/Ursula are
--     current) — the seeded progress report below is attributed to
--     Barbara since she is who the PDF says ran those specific
--     sessions; the club_coaches / squad session records use Tracey's
--     current answer (Scott Tait + Ursula Morris).
--   - Spreadsheet lists 10 Reddam College students; the PDF says 11
--     and includes a "Mercy" not in the spreadsheet. Only the 10 from
--     the spreadsheet are imported here — Mercy is not, since it's
--     unclear whether she's a past-term-only student. Ask Tracey.
--   - Real fee_paid status is unknown for the 24 non-coach Masters
--     swimmers being imported — set to false (not "confirmed unpaid",
--     just "unconfirmed") rather than guessing true. Needs a real
--     pass via the Roster tab.
--   - Nicky Sheridan's own access mechanism (parent_language flag vs.
--     something else) is still undecided — not touched by this
--     migration. The Nicky-facing report being built separately uses
--     this seeded data directly, not live parent-portal access.

-- ----------------------------------------------------------------
-- PRE-CHECKS — run on the READ-ONLY connection BEFORE applying.
-- ----------------------------------------------------------------
-- club_roster for bluefin currently has exactly 1 row (Tracey, #1) —
-- confirmed via: SELECT count(*) FROM club_roster WHERE club_id = (SELECT id FROM clubs WHERE slug='bluefin');
-- club_squads for bluefin currently has exactly 1 row (Masters Squad,
-- id 501da6d8-e264-4f7e-b74d-a9ec0c5177d9).
-- This migration only INSERTs new rows plus one UPDATE to a single
-- existing club_squad_sessions row (Masters' Tuesday session) and one
-- UPDATE to clubs.features (additive jsonb merge, not overwrite).

-- ----------------------------------------------------------------
-- BACKUP — required before any DELETE / UPDATE / DROP / TRUNCATE.
-- ----------------------------------------------------------------
CREATE TABLE _bak_20260922d_club_squad_sessions_bluefin AS
  SELECT sess.* FROM club_squad_sessions sess
  JOIN club_squads sq ON sq.id = sess.squad_id
  WHERE sq.club_id = (SELECT id FROM clubs WHERE slug = 'bluefin');
CREATE TABLE _bak_20260922d_clubs_bluefin AS
  SELECT * FROM clubs WHERE slug = 'bluefin';

-- ----------------------------------------------------------------
-- MIGRATION — applied only after Dave types "apply".
-- ----------------------------------------------------------------
BEGIN;

-- 1. Fix Masters' Tuesday open-water time
UPDATE club_squad_sessions
SET start_time = '07:30'::time,
    end_time = '08:30'::time,
    notes = 'Open water — Fish Hoek / Glencairn / Simon''s Town, weather dependent, WhatsApp coordinated. End time estimated (1hr) — confirm with Tracey. Some weekend sessions also happen, not yet scheduled here.'
WHERE squad_id = '501da6d8-e264-4f7e-b74d-a9ec0c5177d9' AND day_of_week = 2;

-- 2. Turn on progress_reports
UPDATE clubs SET features = features || '{"progress_reports": true}'::jsonb WHERE slug = 'bluefin';

-- 3. Two new squads + their sessions
WITH college_squad AS (
  INSERT INTO club_squads (club_id, name, type, sort_order, is_active)
  VALUES ((SELECT id FROM clubs WHERE slug = 'bluefin'), 'College Students', 'lts', 2, true)
  RETURNING id
)
INSERT INTO club_squad_sessions (squad_id, day_of_week, start_time, end_time, coach_name, notes, is_active)
SELECT id, 2, '16:30'::time, '17:30'::time, 'Ursula Morris', 'Reddam College Learn to Swim — also coached by Scott Tait', true FROM college_squad;

WITH lts_squad AS (
  INSERT INTO club_squads (club_id, name, type, sort_order, is_active)
  VALUES ((SELECT id FROM clubs WHERE slug = 'bluefin'), 'Adult Learn to Swim', 'lts', 3, true)
  RETURNING id
)
INSERT INTO club_squad_sessions (squad_id, day_of_week, start_time, end_time, coach_name, notes, is_active)
SELECT id, 3, '09:00'::time, '10:00'::time, 'Debbie Smith', 'Usual slot — enrolment for this semester not yet confirmed', true FROM lts_squad;

-- 4a. Masters roster — 27 more members (#2-28), squad = Masters Squad
INSERT INTO club_roster (club_id, member_number, display_name, phone, member_type, squad_id, is_trial, fee_paid, is_active)
SELECT (SELECT id FROM clubs WHERE slug = 'bluefin'), v.member_number, v.display_name, NULL, v.member_type,
       '501da6d8-e264-4f7e-b74d-a9ec0c5177d9', false, (v.member_type = 'coach'), true
FROM (VALUES
  (2,  'Amy Brown',              'senior'),
  (3,  'Andrew Horsfall',        'senior'),
  (4,  'Barbara Johnston-Read',  'senior'),
  (5,  'Debbie Smith',           'coach'),
  (6,  'Fred Cresswell',         'senior'),
  (7,  'Gary Blakey',            'senior'),
  (8,  'Gideon Van Zyl',         'senior'),
  (9,  'Gregg Price',            'senior'),
  (10, 'Hannah Borthwick',       'senior'),
  (11, 'Hannah Horsfall',        'senior'),
  (12, 'Heather Cresswell',      'senior'),
  (13, 'Heinrich Langer',        'senior'),
  (14, 'Ingrid Altmann',         'senior'),
  (15, 'Jack Woodburn',          'senior'),
  (16, 'Janice Blakey',          'senior'),
  (17, 'Jeanne',                 'senior'),
  (18, 'Justin Nurse',           'senior'),
  (19, 'Justine Solomon',        'senior'),
  (20, 'Leigh Barge',            'senior'),
  (21, 'Lisa Elferink',          'senior'),
  (22, 'Monica Theron',          'coach'),
  (23, 'Monique Bohnenn',        'senior'),
  (24, 'Pam Renaud',             'senior'),
  (25, 'Sally Matusik',          'senior'),
  (26, 'Sasha Boerma',           'senior'),
  (27, 'Steve Ruffel',           'senior'),
  (28, 'Ursula Morris',          'coach')
) AS v(member_number, display_name, member_type);

-- 4b. Reddam College Students roster — 10 members (#29-38), first names
--     only, squad = College Students, member_type = 'youth'
INSERT INTO club_roster (club_id, member_number, display_name, member_type, squad_id, is_trial, fee_paid, is_active)
SELECT (SELECT id FROM clubs WHERE slug = 'bluefin'), v.member_number, v.display_name, 'youth',
       (SELECT id FROM club_squads WHERE club_id = (SELECT id FROM clubs WHERE slug='bluefin') AND name = 'College Students'),
       false, true, true
FROM (VALUES
  (29, 'Kelvin'), (30, 'Onke'), (31, 'Sichu'), (32, 'Shanna'), (33, 'Zeta'),
  (34, 'Anashe'), (35, 'Yvette'), (36, 'Bubu'), (37, 'India Blue'), (38, 'Christina')
) AS v(member_number, display_name);

-- 5. Coaches
INSERT INTO club_coaches (club_id, name, title, email, is_active)
VALUES
  ((SELECT id FROM clubs WHERE slug = 'bluefin'), 'Monica Theron', 'Masters Coach', 'monica23@live.co.za', true),
  ((SELECT id FROM clubs WHERE slug = 'bluefin'), 'Scott Tait', 'College Students Coach', NULL, true),
  ((SELECT id FROM clubs WHERE slug = 'bluefin'), 'Ursula Morris', 'College Students Coach', 'ursh@bluefinclub.co.za', true),
  ((SELECT id FROM clubs WHERE slug = 'bluefin'), 'Debbie Smith', 'Adult Learn to Swim Coach', 'debbiejoysmith@gmail.com', true);

-- 6. Seed progress reports for the 10 Reddam College students, from the
--    real LTS feedback report — draft/unpublished pending coach review
INSERT INTO club_progress_reports (club_id, roster_id, term_label, body, coach_name, is_published)
SELECT (SELECT id FROM clubs WHERE slug = 'bluefin'), r.id, '2026 Learn to Swim Programme', v.body, 'Barbara Johnston-Read', false
FROM club_roster r
JOIN (VALUES
  ('Kelvin',     'Beginner swimmer, still building coordination and breathing. Joined the programme partway through the term after missing the introductory session. Attended 1.5 of 7 sessions to date. Not yet water safe.'),
  ('Onke',       'Beginner swimmer with limited confidence, but able to float independently. Attended 2 of 7 sessions to date. Not yet water safe.'),
  ('Sichu',      'Beginner swimmer, progressing well with kickboard coordination and floating. Attended 3 of 7 sessions to date. Not yet water safe.'),
  ('Shanna',     'Able to swim short distances independently. Attended 4 of 7 sessions to date. Water safe.'),
  ('Zeta',       'Beginner swimmer, progressing to short unassisted swims. Attended 5 of 7 sessions to date. Water safe in the shallow end.'),
  ('Anashe',     'Beginner swimmer with good kicking technique and improving coordination. Attended 5 of 7 sessions to date. Water safe in the shallow end.'),
  ('Yvette',     'Able to swim short distances independently and float confidently. Attended 7 of 7 sessions to date. Water safe.'),
  ('Bubu',       'Competent swimmer, improving technique and breathing control. Attended 6 of 7 sessions to date. Water safe.'),
  ('India Blue', 'Able to swim short distances independently. Attended 6 of 7 sessions to date. Water safe in the shallow end.'),
  ('Christina',  'Beginner swimmer, still requiring assistance with floating and coordination. Attended 6 of 7 sessions to date. Not yet water safe.')
) AS v(display_name, body) ON v.display_name = r.display_name
WHERE r.club_id = (SELECT id FROM clubs WHERE slug = 'bluefin');

COMMIT;

-- ----------------------------------------------------------------
-- ROLLBACK
-- ----------------------------------------------------------------
-- DELETE FROM club_progress_reports WHERE club_id = (SELECT id FROM clubs WHERE slug='bluefin');
-- DELETE FROM club_coaches WHERE club_id = (SELECT id FROM clubs WHERE slug='bluefin')
--   AND name IN ('Monica Theron','Scott Tait','Ursula Morris','Debbie Smith');
-- DELETE FROM club_roster WHERE club_id = (SELECT id FROM clubs WHERE slug='bluefin') AND member_number BETWEEN 2 AND 38;
-- DELETE FROM club_squad_sessions WHERE squad_id IN
--   (SELECT id FROM club_squads WHERE club_id = (SELECT id FROM clubs WHERE slug='bluefin') AND name IN ('College Students','Adult Learn to Swim'));
-- DELETE FROM club_squads WHERE club_id = (SELECT id FROM clubs WHERE slug='bluefin') AND name IN ('College Students','Adult Learn to Swim');
-- UPDATE clubs SET features = features - 'progress_reports' WHERE slug = 'bluefin';
-- (or restore full rows from _bak_20260922d_clubs_bluefin / _bak_20260922d_club_squad_sessions_bluefin)

-- ----------------------------------------------------------------
-- VERIFY
-- ----------------------------------------------------------------
-- SELECT count(*) FROM club_roster WHERE club_id = (SELECT id FROM clubs WHERE slug='bluefin');
--   -- expect: 38
-- SELECT name FROM club_squads WHERE club_id = (SELECT id FROM clubs WHERE slug='bluefin') ORDER BY sort_order;
--   -- expect: Masters Squad, College Students, Adult Learn to Swim
-- SELECT count(*) FROM club_progress_reports WHERE club_id = (SELECT id FROM clubs WHERE slug='bluefin');
--   -- expect: 10
-- SELECT features->'progress_reports' FROM clubs WHERE slug='bluefin';
--   -- expect: true
