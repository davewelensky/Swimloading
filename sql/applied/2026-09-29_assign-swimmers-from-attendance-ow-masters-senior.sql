-- ================================================================
-- SwimLoading — Migration
-- The safety block hard-fails if you are in the wrong project.
-- ================================================================

-- ⚠️  SAFETY CHECK — runs first, aborts everything if wrong project
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM _project_identity
    WHERE key = 'project_name' AND value = 'swimloading'
  ) THEN
    RAISE EXCEPTION 'WRONG PROJECT - migration aborted. Expected swimloading (szgkzuswelntnevobnoh).';
  END IF;
  RAISE NOTICE 'Project identity confirmed: swimloading';
END $$;

-- ================================================================
-- Migration: 2026-09-29_assign-swimmers-from-attendance-ow-masters-senior.sql
-- Process:   see MIGRATIONS.md
-- ================================================================

-- Purpose:
--   Aquasharks timetable sessions for OW Masters 6-7 / 7-8 / 8-9 and Senior Squad have (almost) no swimmers in
--   club_session_assignments, so the coach register shows "Expected 1 / 25" while ~10-14 actually turn up.
--   Add an assignment for every ACTIVE member of that squad who was marked 'present' on at least 2 different dates
--   in the last 8 weeks at that same session (squad + weekday + start time). INSERT ONLY: nothing is removed or changed.

-- Requested by:
--   Dave (attendance workflow, 29 Sep 2026). Club: Aquasharks (385e2c9d-b32e-47d1-bb1d-1e042523de23).

-- What this changes for users (verified in coach.html before writing):
--   Ordinary squad sessions list the WHOLE squad in the register regardless of assignments, so no coach sees a different
--   swimmer list. The assignments feed the "Expected N / cap" figure and any admin view of who is assigned to a session.
--   Sessions with secondary_squad_id (Dry Land) and multisquad sessions are excluded.

-- Pre-checks (read-only, run 29 Sep 2026 before writing this file):
--   New rows to insert (per session, Aquasharks): OW Masters 6-7 Mon 24 / Wed 23 / Fri 11; OW Masters 7-8 Mon 17 / Wed 17 / Fri 11;
--   OW Masters 8-9 Mon 23 / Wed 19 / Fri 8; Senior Mon 4 / Tue 17 / Wed 15 / Thu 17 / Fri 12 / Sat 4  =>  222 rows in total.
--   club_session_assignments has UNIQUE (roster_id, session_id), no triggers; 170 existing rows for this club.
--   The exact count depends on the run date (rolling 8-week window); it is recorded in the tracking table below.

-- Backup:
--   Not needed for an INSERT-only change. Instead a tracking table lists exactly the rows this migration created,
--   which makes the rollback precise: _added_20260929_session_assignments.

-- ----------------------------------------------------------------
-- MIGRATION — applied only after Dave types "apply".
-- ----------------------------------------------------------------
BEGIN;

CREATE TABLE _added_20260929_session_assignments (id uuid PRIMARY KEY);

WITH tgt AS (
  SELECT s.id AS session_id, q.id AS squad_id, s.day_of_week AS dow, left(s.start_time::text, 5) AS st
  FROM club_squad_sessions s
  JOIN club_squads q ON q.id = s.squad_id
  WHERE q.club_id = '385e2c9d-b32e-47d1-bb1d-1e042523de23'
    AND s.is_active AND q.is_active
    AND q.name IN ('OW Masters 6-7', 'OW Masters 7-8', 'OW Masters 8-9', 'Senior Squad')
    AND s.secondary_squad_id IS NULL
    AND COALESCE(s.is_multisquad, false) = false
),
att AS (
  SELECT t.session_id, t.squad_id, a.roster_id, count(DISTINCT cs.session_date) AS days_present
  FROM tgt t
  JOIN club_sessions cs
    ON cs.club_id = '385e2c9d-b32e-47d1-bb1d-1e042523de23'
   AND cs.squad_id = t.squad_id
   AND extract(dow FROM cs.session_date)::int = t.dow
   AND left(cs.start_time::text, 5) = t.st
   AND cs.session_date >= current_date - 56 AND cs.session_date <= current_date
  JOIN club_attendance a ON a.session_id = cs.id AND a.status = 'present'
  GROUP BY t.session_id, t.squad_id, a.roster_id
),
cand AS (
  SELECT att.session_id, att.roster_id
  FROM att
  JOIN club_roster r
    ON r.id = att.roster_id AND r.is_active AND r.club_id = '385e2c9d-b32e-47d1-bb1d-1e042523de23'
   AND (r.squad_id = att.squad_id OR r.secondary_squad_id = att.squad_id)
  WHERE att.days_present >= 2
),
ins AS (
  INSERT INTO club_session_assignments (club_id, session_id, roster_id)
  SELECT '385e2c9d-b32e-47d1-bb1d-1e042523de23', c.session_id, c.roster_id FROM cand c
  ON CONFLICT (roster_id, session_id) DO NOTHING
  RETURNING id
)
INSERT INTO _added_20260929_session_assignments (id) SELECT id FROM ins;

COMMIT;

-- ----------------------------------------------------------------
-- ROLLBACK — exact
-- ----------------------------------------------------------------
--   DELETE FROM club_session_assignments WHERE id IN (SELECT id FROM _added_20260929_session_assignments);
--   (The tracking table is kept until a later migration removes it.)

-- ----------------------------------------------------------------
-- VERIFY — run on the READ-ONLY connection AFTER applying.
-- ----------------------------------------------------------------
--   SELECT count(*) FROM _added_20260929_session_assignments;   -- expect 222 (same-day run)
--   SELECT count(*) FROM club_session_assignments WHERE club_id='385e2c9d-b32e-47d1-bb1d-1e042523de23';
--      -- expect 170 + 222 = 392
--   -- per-session assigned counts should now be roughly: OW Masters 6-7 ~25/24/12, 7-8 ~17/17/11, 8-9 ~26/22/11, Senior 18/17/15/17/12/4
