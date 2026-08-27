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
    RAISE EXCEPTION 'WRONG PROJECT — MIGRATION ABORTED';
  END IF;
END $$;

-- ================================================================
-- Migration: 2026-08-27c_swimops-feed-checkin-intel.sql
-- Process:   see MIGRATIONS.md — no section below may be left empty
-- ================================================================

-- Purpose:
--   Import two more Big Bay SwimOps tables — mission_feed_intel (structured
--   per-feed items/ml/carb/sodium, a view over feed_logs+swim_missions+
--   swimmers) and mission_checkin_intel (richer than the swimops_checkins
--   already imported 27 Aug — adds stroke rate + baseline/delta, water temp
--   delta, minutes-since-feed) — as CSV exports Dave supplied, so the
--   marathon-swim intel on english-channel.html (and future crossing pages)
--   can be built from real fuelling/pacing data instead of estimates.
--
--   This covers FAR more missions than the original 3-table import (which
--   was English-Channel-only): short Cape Town day swims, a Robben Island
--   triple/quad attempt, a Scotland/Skye swim, and the 3 real English
--   Channel crossings, spanning many named swimmers — most not asked about
--   consent. `items` in mission_feed_intel includes medication mentions
--   (Pain meds, Cramp Ease, Anti-inflammatory) tied to real names — treat
--   this as MORE sensitive than the GPS-track data already handled, not
--   less: fine to hold here (admin-only), never surfaced per-swimmer on a
--   public page, and even in anonymized aggregate form, prefer qualitative
--   framing ("some swimmers needed pain relief late in long swims") over
--   precise per-medication counts — confirm with Dave before publishing
--   anything from the medication-adjacent items specifically.
--
--   Learned from the 27 Aug incident: these tables are created with RLS
--   enabled and NO select policy from the start (the original 3-table
--   import created public `USING (true)` policies, then had to be locked
--   down in a follow-up migration after Tracey's/Amber's data was briefly
--   exposed) — same posture as swimops_missions/checkins/boat_track_points
--   have today.
--
--   Data was NOT loaded via inline INSERT. A first attempt hand-typing the
--   204+125 rows into an INSERT statement produced a corrupted UUID
--   ('194c5dd8-4474-4eb8-82-7ebeb4473f2a' — not valid UUID syntax) that
--   rolled back the whole transaction — confirmed via
--   information_schema.tables (0 rows) before retrying. Hand-transcribing
--   this volume of UUID data is unreliable; don't repeat that approach for
--   future SwimOps imports of this size. Instead: CREATE TABLE only was
--   applied via this migration (see below), and Dave imported the row data
--   directly through Supabase Studio's Table Editor CSV importer. The raw
--   CSV exports had the literal text "null" in empty cells, which the
--   importer read as the string "null" rather than SQL NULL and rejected
--   for integer/numeric columns (`ERROR: 22P02: invalid input syntax for
--   type integer: "null"`) — fixed by cleaning both CSVs (literal "null"
--   text → truly empty cell) before reimporting. Verified after import:
--   204 checkin rows / 125 feed rows (exact match to source CSVs), 0 rows
--   in pg_policies for both tables, and two spot-checks against the
--   original CSV content (Bernd Petring's "Nausea and cramping" checkin,
--   Lynne Macgregor's first three feeds) matched exactly.

-- Requested by:
--   Dave

-- ----------------------------------------------------------------
-- PRE-CHECKS — run on the READ-ONLY connection BEFORE applying.
-- ----------------------------------------------------------------
-- SELECT table_name FROM information_schema.tables
--   WHERE table_schema='public' AND table_name IN ('swimops_mission_feed_intel','swimops_mission_checkin_intel');
--   -- expect: 0 rows (tables do not exist yet)

-- ----------------------------------------------------------------
-- BACKUP — required before any DELETE / UPDATE / DROP / TRUNCATE.
-- ----------------------------------------------------------------
-- Not required — new tables, pure CREATE + data import, nothing existing is touched.

-- ----------------------------------------------------------------
-- MIGRATION — applied only after Dave types "apply".
-- Table DDL only — row data loaded separately via Supabase Studio's CSV
-- importer (see Purpose). Applied via supabase-admin apply_migration,
-- name: swimops_feed_checkin_intel_create_tables.
-- ----------------------------------------------------------------
CREATE TABLE public.swimops_mission_checkin_intel (
  checkin_id                     uuid PRIMARY KEY,
  mission_reference              text,
  swimmer                        text,
  mission_id                     uuid NOT NULL,
  checkin_datetime               timestamptz NOT NULL,
  minutes_into_swim              integer,
  swimmer_status                 text,
  status_changed                 boolean,
  stroke_rate_spm                integer,
  baseline_spm                   numeric,
  stroke_delta_pct               numeric,
  water_temperature_c            numeric,
  water_temp_delta_90m           numeric,
  air_temperature_c              numeric,
  sea_conditions                 text,
  wind_speed_knots               numeric,
  wind_direction                 text,
  progress_notes                 text,
  gps_latitude                   double precision,
  gps_longitude                  double precision,
  gps_accuracy_m                 numeric,
  minutes_since_feed_at_checkin  integer,
  imported_at                    timestamptz NOT NULL DEFAULT now(),
  imported_from                  text NOT NULL DEFAULT 'swimops_csv_export_20260827c'
);
CREATE INDEX idx_swimops_checkin_intel_mission ON public.swimops_mission_checkin_intel (mission_id, checkin_datetime);
ALTER TABLE public.swimops_mission_checkin_intel ENABLE ROW LEVEL SECURITY;
-- No SELECT policy — admin/service-role only from creation (see Purpose).

CREATE TABLE public.swimops_mission_feed_intel (
  feed_id             uuid PRIMARY KEY,
  mission_reference   text,
  swimmer             text,
  mission_id          uuid NOT NULL,
  logged_at           timestamptz NOT NULL,
  minutes_into_swim   integer,
  items               text,
  quantity_ml         numeric,
  carb_grams          numeric,
  sodium_mg           numeric,
  swimmer_response    text,
  notes               text,
  is_carb             boolean,
  minutes_since_feed  integer,
  minutes_since_carb  integer,
  cum_ml              numeric,
  cum_carb_g          numeric,
  cum_sodium_mg       numeric,
  ml_per_hour         numeric,
  carb_g_per_hour     numeric,
  imported_at         timestamptz NOT NULL DEFAULT now(),
  imported_from       text NOT NULL DEFAULT 'swimops_csv_export_20260827c'
);
CREATE INDEX idx_swimops_feed_intel_mission ON public.swimops_mission_feed_intel (mission_id, logged_at);
ALTER TABLE public.swimops_mission_feed_intel ENABLE ROW LEVEL SECURITY;
-- No SELECT policy — admin/service-role only from creation (see Purpose).

COMMENT ON TABLE public.swimops_mission_checkin_intel IS 'Crew check-in reports from Big Bay SwimOps (mission_checkin_intel view), CSV export 2026-08-27, imported via Supabase Studio Table Editor. Same consent/aggregation-only rule as swimops_checkins — real-time personal status narrative (tired/cramping/etc.) that must never be republished verbatim without consent. RLS locked to service-role only, no public SELECT policy.';
COMMENT ON TABLE public.swimops_mission_feed_intel IS 'Structured per-feed nutrition/medication data from Big Bay SwimOps (mission_feed_intel view: items, quantity_ml, carb_grams, sodium_mg), CSV export 2026-08-27, imported via Supabase Studio Table Editor. Same consent/aggregation rule as other swimops_* tables, PLUS treat medication items (Pain meds, Cramp Ease, Anti-inflammatory) as extra-sensitive: fine for internal analysis, but confirm with Dave before publishing anything derived from medication-related items, even anonymized/aggregated. RLS locked to service-role only, no public SELECT policy.';

-- ----------------------------------------------------------------
-- ROLLBACK — exact SQL to undo, or state:
-- "irreversible — restore from _bak_YYYYMMDD_tablename"
-- ----------------------------------------------------------------
-- BEGIN;
-- DROP TABLE IF EXISTS public.swimops_mission_checkin_intel;
-- DROP TABLE IF EXISTS public.swimops_mission_feed_intel;
-- COMMIT;

-- ----------------------------------------------------------------
-- VERIFY — run on the READ-ONLY connection AFTER applying.
-- ----------------------------------------------------------------
-- SELECT count(*) FROM public.swimops_mission_checkin_intel;  -- confirmed: 204
-- SELECT count(*) FROM public.swimops_mission_feed_intel;     -- confirmed: 125
-- SELECT tablename, policyname FROM pg_policies
--   WHERE tablename IN ('swimops_mission_checkin_intel','swimops_mission_feed_intel');
--   -- confirmed: 0 rows (no policies — admin/service-role only)
