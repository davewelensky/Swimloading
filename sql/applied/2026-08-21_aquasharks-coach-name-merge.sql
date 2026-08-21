-- ============================================================================
-- AQUASHARKS: merge coach_name variants flagged by the Audit tab
-- Requested by Dave, 21 Aug 2026 ("on the audit tab, merge these records").
-- Club: Aqua Sharks Academy Atlantic (385e2c9d-b32e-47d1-bb1d-1e042523de23)
--
-- Variants → canonical (canonical names confirmed against club_coaches):
--   'Teagan'  → 'Teagan Thompson'
--   'Noah'    → 'Noah Arelisky'
--   'Tarryn'  → 'Tarryn Stanford'
--
-- Dry-run counts (verified 21 Aug 2026):
--   club_sessions (attendance):   Noah 10, Tarryn 108, Teagan 23   = 141 rows
--   club_squad_sessions (timetable, Aquasharks squads): Tarryn 13  =  13 rows
--   club_coaches: 'Teagan' roster row itself lacks the surname     =   1 row
--   club_progress_reports: no variant rows                          =   0 rows
-- ============================================================================

-- Backup (same _bak_ pattern as the 24 Jul / 07 Aug Tarryn merges)
CREATE TABLE _bak_20260821_club_sessions_coachmerge AS
  SELECT * FROM club_sessions
  WHERE club_id = '385e2c9d-b32e-47d1-bb1d-1e042523de23'
    AND coach_name IN ('Teagan','Noah','Tarryn');

CREATE TABLE _bak_20260821_club_squad_sessions_coachmerge AS
  SELECT css.* FROM club_squad_sessions css
  JOIN club_squads sq ON sq.id = css.squad_id
  WHERE sq.club_id = '385e2c9d-b32e-47d1-bb1d-1e042523de23'
    AND css.coach_name IN ('Teagan','Noah','Tarryn');

-- Attendance sessions
UPDATE club_sessions SET coach_name = 'Teagan Thompson'
WHERE club_id = '385e2c9d-b32e-47d1-bb1d-1e042523de23' AND coach_name = 'Teagan';

UPDATE club_sessions SET coach_name = 'Noah Arelisky'
WHERE club_id = '385e2c9d-b32e-47d1-bb1d-1e042523de23' AND coach_name = 'Noah';

UPDATE club_sessions SET coach_name = 'Tarryn Stanford'
WHERE club_id = '385e2c9d-b32e-47d1-bb1d-1e042523de23' AND coach_name = 'Tarryn';

-- Timetable sessions (scoped via the club's squads)
UPDATE club_squad_sessions css SET coach_name = 'Tarryn Stanford'
FROM club_squads sq
WHERE sq.id = css.squad_id
  AND sq.club_id = '385e2c9d-b32e-47d1-bb1d-1e042523de23'
  AND css.coach_name = 'Tarryn';

-- Coach roster row that is itself the variant source
UPDATE club_coaches SET name = 'Teagan Thompson', updated_at = now()
WHERE club_id = '385e2c9d-b32e-47d1-bb1d-1e042523de23' AND name = 'Teagan';

-- Verify (expect zero variant rows left):
-- SELECT coach_name, count(*) FROM club_sessions
--   WHERE club_id='385e2c9d-b32e-47d1-bb1d-1e042523de23'
--   AND coach_name IN ('Teagan','Noah','Tarryn') GROUP BY coach_name;
