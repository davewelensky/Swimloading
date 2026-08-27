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
-- Migration: 2026-08-27_swimops-boat-track-checkins.sql
-- Process:   see MIGRATIONS.md — no section below may be left empty
-- ================================================================

-- Purpose:
--   Big Bay SwimOps (Derrick's separate operations platform for escorted
--   marathon swims) is NOT actually in SwimLoading's Supabase project
--   (verified: list_tables shows no boat_track_points/checkins/missions
--   here today) despite Dave saying "swimops is in the same supabase" —
--   this migration brings a copy of three of its tables IN, from CSV
--   exports Dave supplied (boat_track_points_rows.csv, checkins_rows.csv,
--   swim_missions_rows.csv), so SwimLoading can build real, data-driven
--   Channel/marathon-swim intelligence content (see english-channel.html
--   "Real crossings" section, shipped 27 Aug 2026) instead of hand-typing
--   swim stats into HTML every time. Prefixed `swimops_` to make the
--   external source obvious, same pattern as `historical_swims` /
--   `historical_swimmers` for Big Bay Events' other dataset. Note:
--   `swimops_missions.historical_swim_id` does NOT resolve against our
--   own `historical_swims.id` (checked — zero matches) — it is SwimOps'
--   own internal FK to its own separate historical-swims-equivalent
--   table, which we do not have. Don't treat it as a join key here.
--
--   Mission attribution (worked out from swim_missions, no guessing):
--   `e498bce1` = Lynne MacGregor (actual duration 04:16:00->15:46:00 =
--   exactly 11h30m00s, matches what was reported). `d728d652` = Tracey
--   Steyn (07:41:30.395->22:11:18.512 = 14h29m48s, matches "14h 29m").
--   `23c24ab1` is a THIRD swimmer, confirmed by Dave as **Amber Rose
--   Berry** — same route, same start beach (Shakespeare Beach) and same
--   day as Lynne (23 Aug 2026), 10h27m00s exactly, different swimmer_id.
--   `4be669f3` is an unrelated
--   15 Aug Scotland/Skye-area swim (checkins mention Kat, Joselyn,
--   Monika) — not English Channel, not touched by this work.
--
--   New precise facts this surfaces that the shipped page did NOT have
--   (worth a follow-up content correction): Lynne started at
--   **Shakespeare Beach**, Dover (51.11377, 1.31055); Tracey started at
--   **Samphire Hoe**, Dover (51.10419, 1.27602) — these are two DIFFERENT
--   beaches, both previously just written as generic "Dover". Both are
--   CSA-ratified, both swum **skins** (no wetsuit) — neither fact was on
--   the page before. Real AIS end positions: Lynne last fix 50.84544,
--   1.57495; Tracey last fix 50.87539, 1.619 — both near Cap Gris-Nez,
--   usable once boat_track_points is loaded for an actual (not idealised)
--   S-curve plot.

-- Requested by:
--   Dave

-- ----------------------------------------------------------------
-- PRE-CHECKS — run on the READ-ONLY connection BEFORE applying.
-- Must include affected-row counts for any UPDATE/DELETE.
-- ----------------------------------------------------------------
-- SELECT table_name FROM information_schema.tables
--   WHERE table_schema='public' AND table_name IN ('swimops_boat_track_points','swimops_checkins');
--   -- expect: 0 rows (tables do not exist yet)

-- ----------------------------------------------------------------
-- BACKUP — required before any DELETE / UPDATE / DROP / TRUNCATE.
-- ----------------------------------------------------------------
-- Not required — new tables, pure CREATE + INSERT, nothing existing is touched.

-- ----------------------------------------------------------------
-- MIGRATION — applied only after Dave types "apply".
-- ----------------------------------------------------------------
BEGIN;

CREATE TABLE public.swimops_boat_track_points (
  id             uuid PRIMARY KEY,
  mission_id     uuid NOT NULL,
  source         text NOT NULL,              -- 'navionics_gpx' | 'csa_ais'
  mmsi           text,
  recorded_at    timestamptz NOT NULL,
  latitude       double precision NOT NULL,
  longitude      double precision NOT NULL,
  speed_knots    numeric,
  created_at     timestamptz NOT NULL,
  imported_at    timestamptz NOT NULL DEFAULT now(),
  imported_from  text NOT NULL DEFAULT 'swimops_csv_export_20260827'
);
CREATE INDEX idx_swimops_track_mission ON public.swimops_boat_track_points (mission_id, recorded_at);
ALTER TABLE public.swimops_boat_track_points ENABLE ROW LEVEL SECURITY;
CREATE POLICY swimops_track_points_read ON public.swimops_boat_track_points FOR SELECT USING (true);

CREATE TABLE public.swimops_missions (
  id                          uuid PRIMARY KEY,
  mission_reference           text,
  swimmer_id                  uuid,
  route_id                    uuid,
  planned_start_datetime      timestamptz,
  actual_start_datetime       timestamptz,
  actual_end_datetime         timestamptz,
  estimated_duration_minutes  integer,
  mission_status              text,
  category                    text,
  primary_boat_id             uuid,
  primary_observer_id         uuid,
  primary_skipper_id          uuid,
  risk_level                  text,
  family_updates_enabled      boolean,
  notes                       text,
  created_by                  uuid,
  created_at                  timestamptz,
  updated_at                  timestamptz,
  overdue_notified_at         timestamptz,
  closed_at                   timestamptz,
  closed_by                   uuid,
  fuel_used_litres            numeric,
  closeout_notes              text,
  event_id                    uuid,
  actual_water_temp_c         numeric,
  actual_distance_km          numeric,
  historical_swim_id          uuid,          -- SwimOps' own internal FK, does NOT resolve against our historical_swims.id (checked)
  checkin_interval_minutes    integer,
  primary_support_crew_id     uuid,
  start_latitude              double precision,
  start_longitude             double precision,
  ratifying_organisation      text,
  is_test                     boolean NOT NULL DEFAULT false,
  cleared_water_at_start      boolean,
  cleared_water_at_finish     boolean,
  start_location              text,
  kit_category                text,
  imported_at                 timestamptz NOT NULL DEFAULT now(),
  imported_from               text NOT NULL DEFAULT 'swimops_csv_export_20260827'
);
ALTER TABLE public.swimops_missions ENABLE ROW LEVEL SECURITY;
CREATE POLICY swimops_missions_read ON public.swimops_missions FOR SELECT USING (true);
COMMENT ON TABLE public.swimops_missions IS 'Mission records (one per escorted swim attempt) from Big Bay SwimOps, imported from CSV export 2026-08-27. swimmer_id/route_id/boat_id/etc. are SwimOps'' own internal UUIDs with no local FK — no swimmers/routes tables were imported, so names must come from Dave/Derrick or be worked out independently (e.g. by matching actual_start/actual_end duration against a known reported crossing time).';

CREATE TABLE public.swimops_checkins (
  id                        uuid PRIMARY KEY,
  mission_id                uuid NOT NULL,
  submitted_by_user_id      uuid,
  submitted_by_crew_id      uuid,
  checkin_datetime          timestamptz NOT NULL,
  gps_latitude              double precision,
  gps_longitude             double precision,
  swimmer_status            text,
  sea_conditions            text,
  water_temperature_c       numeric,
  wind_conditions           text,
  visibility                text,
  progress_notes            text,
  family_visible            boolean NOT NULL DEFAULT true,
  created_offline           boolean NOT NULL DEFAULT false,
  sync_status               text,
  created_at                timestamptz NOT NULL,
  synced_at                 timestamptz,
  event_uuid                uuid,
  gps_accuracy_m            numeric,
  stroke_rate_spm           integer,
  entered_retrospectively   boolean NOT NULL DEFAULT false,
  air_temperature_c         numeric,
  wind_speed_knots          numeric,
  wind_direction            text,
  retro_source              text,
  imported_at               timestamptz NOT NULL DEFAULT now(),
  imported_from             text NOT NULL DEFAULT 'swimops_csv_export_20260827'
);
CREATE INDEX idx_swimops_checkins_mission ON public.swimops_checkins (mission_id, checkin_datetime);
ALTER TABLE public.swimops_checkins ENABLE ROW LEVEL SECURITY;
CREATE POLICY swimops_checkins_read ON public.swimops_checkins FOR SELECT USING (true);

COMMENT ON TABLE public.swimops_boat_track_points IS 'Escort-boat GPS/AIS positions, imported from Big Bay SwimOps (separate product, CSV export 2026-08-27). mission_id has no local FK — no missions table has been imported yet, so it cannot be resolved to a swimmer/crossing without Dave/Derrick confirming the mapping.';
COMMENT ON TABLE public.swimops_checkins IS 'Crew check-in reports (swimmer status, conditions, notes) from Big Bay SwimOps, imported from CSV export 2026-08-27. Same mission_id caveat as swimops_boat_track_points.';

COMMIT;

-- ----------------------------------------------------------------
-- ROLLBACK — exact SQL to undo, or state:
-- "irreversible — restore from _bak_YYYYMMDD_tablename"
-- ----------------------------------------------------------------
-- DROP TABLE IF EXISTS public.swimops_boat_track_points;
-- DROP TABLE IF EXISTS public.swimops_checkins;
-- DROP TABLE IF EXISTS public.swimops_missions;

-- ----------------------------------------------------------------
-- VERIFY — run on the READ-ONLY connection AFTER applying.
-- State the expected result next to each query.
-- ----------------------------------------------------------------
-- SELECT count(*) FROM public.swimops_boat_track_points;  -- expect: 0 (schema-only migration, data loaded separately)
-- SELECT count(*) FROM public.swimops_checkins;            -- expect: 0
-- SELECT count(*) FROM public.swimops_missions;            -- expect: 0
