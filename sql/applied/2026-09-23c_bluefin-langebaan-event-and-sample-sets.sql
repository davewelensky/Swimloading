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
-- Migration: 2026-09-23c_bluefin-langebaan-event-and-sample-sets.sql
-- ================================================================

-- Purpose:
--   1. Add the Langebaan Express (Sat 7 Nov 2026) to the Events tab —
--      logistics transcribed from the official race itinerary already
--      gathered during onboarding. `course` defaults to 'LC', a
--      leftover pool-gala field that has no real meaning for an open
--      water race — harmless, nothing reads it for this row.
--   2. Seed the Sets Planner Library with 3 of Tracey's 4 real sample
--      sets (Notes app screenshots she sent), transcribed as-is,
--      tagged to Masters Squad. The 4th set's photo has a chunk
--      obscured by a video-scrubber overlay (some rep counts and
--      distances aren't legible) — not guessed, not included. Ask
--      Tracey for a clean version if it's wanted too.

-- Requested by:
--   Dave — "in the events tab, dont we add the upcoming langebaan
--   express and also in the library, tracey provided some sample
--   sets, should we add thos as astart"

-- ----------------------------------------------------------------
-- PRE-CHECKS
-- ----------------------------------------------------------------
-- SELECT count(*) FROM club_events WHERE club_id=(SELECT id FROM clubs WHERE slug='bluefin'); -> 0
-- SELECT count(*) FROM club_swim_sets WHERE club_id=(SELECT id FROM clubs WHERE slug='bluefin'); -> 0
-- Masters Squad id (confirmed earlier this session): 501da6d8-e264-4f7e-b74d-a9ec0c5177d9
-- Pure INSERTs — no existing rows touched.

-- ----------------------------------------------------------------
-- BACKUP
-- ----------------------------------------------------------------
-- Not applicable — INSERT only, both tables currently empty for Bluefin.

-- ----------------------------------------------------------------
-- MIGRATION
-- ----------------------------------------------------------------
BEGIN;

INSERT INTO club_events (
  club_id, title, event_date, start_time, description, venue,
  event_start, logistics, entry_deadline, entry_open,
  allows_day_entries, is_league, is_public
)
VALUES (
  (SELECT id FROM clubs WHERE slug = 'bluefin'),
  'Langebaan Express',
  '2026-11-07',
  '06:00',
  'One-way open water swim from Preekstoel — 6km (finish at Pearly''s) or 12km (finish at Cape Town Fish Market Mykonos). Pre-entries only; entries close 1 Oct 2026 (or when limit reached). Substitutions close 12 Oct, no changes after that.',
  'Preekstoel',
  '06:00',
  'Registration & race pack collection: Fri 6 Nov, 4-7pm, Cape Town Fish Market Mykonos. Race briefing 6:30pm. Race day: 12km swimmers meet Mykonos Casino parking 3:45am, 6km swimmers meet Pearly''s 3:45am — buses depart 4:15am to Preekstoel (arrive 5:15am). Final check & briefing 5:30-5:45am. Swim starts 6:00am. 3-hour cutoff at the 6km mark (9:00am) applies to both distances. Compulsory inflated swim buoy + event cap.',
  '2026-10-01',
  true,
  false,
  false,
  false
);

INSERT INTO club_swim_sets (club_id, squad_id, name, total_distance, focus, duration_mins, set_content, ai_generated)
VALUES
(
  (SELECT id FROM clubs WHERE slug = 'bluefin'),
  '501da6d8-e264-4f7e-b74d-a9ec0c5177d9',
  'Descending Ladder + Pull',
  3100, 'mixed', 60,
  E'6 x 150m (Swim / drill swim / scull swim / swim)\n\n8 x 25 sprints on 30 sec\n\n3 x 200m pull, 20 sec rest\n\n6 x 50m fast / 100m smooth\n4 x 50m fast / 100m smooth\n2 x 50m fast / 100m smooth\n1 x 50m / 200m smooth\n\n250 cool down',
  false
),
(
  (SELECT id FROM clubs WHERE slug = 'bluefin'),
  '501da6d8-e264-4f7e-b74d-a9ec0c5177d9',
  'Pace Work 5x200',
  2600, 'mixed', 60,
  E'400 free/back warm-up\n\n4 x 100 drill swim / kick swim\n\n8 x 25 sprints\n\n75m pull, 10 sec rest / 50m sprint — x4\n\n5 x 200 (100m medium pace, 100m fast)\n\n100 easy',
  false
),
(
  (SELECT id FROM clubs WHERE slug = 'bluefin'),
  '501da6d8-e264-4f7e-b74d-a9ec0c5177d9',
  'Paddles & Descending 50s',
  2500, 'mixed', 60,
  E'200 easy swim free/back\n\n4 x 50 drills\n\n200 pull\n\n8 x 25 sprints\n\n400 swim with paddles\n\n4 x 100 (25 fast max effort, 75 easy)\n\n8 x 50 descending 1-4\n\n16 x 25 fast/build/easy\n\n100 easy',
  false
);

COMMIT;

-- ----------------------------------------------------------------
-- ROLLBACK
-- ----------------------------------------------------------------
-- DELETE FROM club_swim_sets WHERE club_id=(SELECT id FROM clubs WHERE slug='bluefin')
--   AND name IN ('Descending Ladder + Pull','Pace Work 5x200','Paddles & Descending 50s');
-- DELETE FROM club_events WHERE club_id=(SELECT id FROM clubs WHERE slug='bluefin') AND title='Langebaan Express';

-- ----------------------------------------------------------------
-- VERIFY
-- ----------------------------------------------------------------
-- SELECT title, event_date FROM club_events WHERE club_id=(SELECT id FROM clubs WHERE slug='bluefin');
--   -- expect: 1 row, Langebaan Express, 2026-11-07
-- SELECT name, total_distance FROM club_swim_sets WHERE club_id=(SELECT id FROM clubs WHERE slug='bluefin');
--   -- expect: 3 rows
