-- Add missing Wednesday timetable entries for Aquasharks Bronze + Silver
-- Britt confirmed these squads run every weekday but Wed was missing from
-- club_squad_sessions, so they didn't appear in attendance.
-- Times match the Tue/Thu pattern; coach Teagan (matches her Wed afternoon work).
-- Applied 2026-06-11 via Supabase MCP.

INSERT INTO club_squad_sessions
  (squad_id,                                      day_of_week, start_time, end_time, coach_name, is_active)
VALUES
  ('a1000001-0000-0000-0000-000000000003',         3,           '15:30',    '16:00',  'Teagan',   true),  -- Bronze Wed
  ('a1000001-0000-0000-0000-000000000004',         3,           '16:00',    '16:45',  'Teagan',   true);  -- Silver Wed
