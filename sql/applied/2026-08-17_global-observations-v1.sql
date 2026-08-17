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
-- Migration: 2026-08-17_global-observations-v1.sql
-- Process:   see MIGRATIONS.md — no section below may be left empty
-- ================================================================

-- Purpose:
--   Increment 1 of the Global Live Water Observation Platform: provider /
--   station / observation / spot-match tables + public read view + admin
--   review RPCs. Purely additive — no existing table or column is modified.
--   temp_logs and spot_water_readings are untouched; the Tooting Bec /
--   Brockwell my-water.live feed keeps working exactly as it does today.

-- Requested by:
--   Dave

-- ----------------------------------------------------------------
-- PRE-CHECKS — run on the READ-ONLY connection BEFORE applying.
-- Must include affected-row counts for any UPDATE/DELETE.
-- ----------------------------------------------------------------
-- 1. None of the new names exist yet (all four must return 0 rows):
-- SELECT relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
--  WHERE n.nspname = 'public'
--    AND c.relname IN ('observation_providers','observation_stations',
--                      'observations','spot_observation_stations',
--                      'spot_conditions_live');
-- 2. spots PK really is uuid (expect: id / uuid):
-- SELECT column_name, data_type FROM information_schema.columns
--  WHERE table_schema='public' AND table_name='spots' AND column_name='id';
-- 3. profiles.is_admin exists for the RPC gate (expect: 1 row):
-- SELECT column_name FROM information_schema.columns
--  WHERE table_schema='public' AND table_name='profiles' AND column_name='is_admin';
-- No UPDATE/DELETE in this migration — no affected-row counts apply.

-- ----------------------------------------------------------------
-- BACKUP — required before any DELETE / UPDATE / DROP / TRUNCATE.
-- ----------------------------------------------------------------
-- Not required: this migration is purely additive (CREATE TABLE / CREATE
-- VIEW / CREATE FUNCTION / INSERT into brand-new tables only). It contains
-- no DELETE / UPDATE / DROP / TRUNCATE against existing data.

-- ----------------------------------------------------------------
-- MIGRATION — applied only after Dave types "apply".
-- ----------------------------------------------------------------
BEGIN;

-- ── 1. Providers ─────────────────────────────────────────────────
-- One row per upstream data source (NOAA NDBC, my-water.live, and later
-- ERDDAP/EMODnet/IMOS providers). `code` is the stable key used by code.
CREATE TABLE IF NOT EXISTS observation_providers (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code                  text NOT NULL UNIQUE,
  name                  text NOT NULL,
  provider_type         text NOT NULL,          -- 'buoy_network' | 'sensor_network' | 'erddap' | ...
  base_url              text,
  attribution           text NOT NULL,
  licence               text,
  enabled               boolean NOT NULL DEFAULT true,
  poll_interval_minutes integer NOT NULL DEFAULT 60,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

-- ── 2. Stations ──────────────────────────────────────────────────
-- The provider's station catalogue, refreshed by the ingestion cron.
-- Capability flags are learned from real data, not trusted from metadata.
CREATE TABLE IF NOT EXISTS observation_stations (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id            uuid NOT NULL REFERENCES observation_providers(id) ON DELETE CASCADE,
  external_id            text NOT NULL,
  name                   text,
  latitude               double precision NOT NULL,
  longitude              double precision NOT NULL,
  station_type           text,                  -- 'buoy' | 'fixed' | 'lido_sensor' | ...
  water_body             text,                  -- free text where the provider states it; null otherwise
  temperature_available  boolean NOT NULL DEFAULT false,
  wave_height_available  boolean NOT NULL DEFAULT false,
  wave_period_available  boolean NOT NULL DEFAULT false,
  wind_available         boolean NOT NULL DEFAULT false,
  tide_available         boolean NOT NULL DEFAULT false,
  sensor_depth_m         numeric,
  active                 boolean NOT NULL DEFAULT true,
  metadata               jsonb NOT NULL DEFAULT '{}',
  last_observation_at    timestamptz,           -- newest observed_at we hold
  last_success_at        timestamptz,           -- last time a fetch for this station succeeded
  last_error             text,
  last_error_at          timestamptz,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider_id, external_id)
);

-- The ingestion job and the match engine both scan "active stations that
-- measure temperature" — give that scan its own index.
CREATE INDEX IF NOT EXISTS idx_observation_stations_active_temp
  ON observation_stations (active, temperature_available);

-- ── 3. Observations ──────────────────────────────────────────────
-- Raw measured readings. Duplicate protection is the unique constraint:
-- ingestion inserts with ON CONFLICT DO NOTHING, so re-fetching the same
-- upstream rows is always safe.
CREATE TABLE IF NOT EXISTS observations (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  station_id          uuid NOT NULL REFERENCES observation_stations(id) ON DELETE CASCADE,
  observed_at         timestamptz NOT NULL,
  water_temperature_c numeric,
  wave_height_m       numeric,
  wave_period_s       numeric,
  wind_speed_ms       numeric,
  wind_direction_deg  numeric,
  tide_height_m       numeric,
  quality_code        text,
  raw                 jsonb,
  ingested_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (station_id, observed_at)
);

-- Latest-by-station and 24h/7d/30d history are both range scans on
-- (station_id, observed_at DESC) — one index serves both.
CREATE INDEX IF NOT EXISTS idx_observations_station_observed_desc
  ON observations (station_id, observed_at DESC);

-- ── 4. Station-to-spot matching ──────────────────────────────────
-- Candidates are machine-generated; approval is human. Nothing becomes
-- primary without an admin decision (see RPCs below).
CREATE TABLE IF NOT EXISTS spot_observation_stations (
  spot_id           uuid NOT NULL REFERENCES spots(id) ON DELETE CASCADE,
  station_id        uuid NOT NULL REFERENCES observation_stations(id) ON DELETE CASCADE,
  distance_km       numeric NOT NULL,
  suitability_score numeric,
  match_type        text NOT NULL DEFAULT 'auto_distance',
  status            text NOT NULL DEFAULT 'candidate'
                    CHECK (status IN ('candidate','approved','rejected')),
  is_primary        boolean NOT NULL DEFAULT false,
  reviewed_at       timestamptz,
  reviewed_by       uuid,          -- auth user id; deliberately NO FK to auth.users
  created_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (spot_id, station_id),
  -- a primary station is by definition an approved one
  CHECK (NOT is_primary OR status = 'approved')
);

-- Hard guarantee: at most ONE primary station per spot.
CREATE UNIQUE INDEX IF NOT EXISTS one_primary_station_per_spot
  ON spot_observation_stations (spot_id) WHERE is_primary;

CREATE INDEX IF NOT EXISTS idx_spot_observation_stations_station
  ON spot_observation_stations (station_id);

-- ── 5. Public read view ──────────────────────────────────────────
-- The ONE thing the public conditions service reads: approved links with
-- each station's newest temperature-bearing observation. security_invoker
-- so RLS on the underlying tables is what actually gates access.
CREATE OR REPLACE VIEW spot_conditions_live
WITH (security_invoker = true) AS
SELECT
  sos.spot_id,
  sos.station_id,
  sos.is_primary,
  sos.distance_km,
  st.name              AS station_name,
  st.station_type,
  st.sensor_depth_m,
  st.water_body,
  p.code               AS provider_code,
  p.name               AS provider_name,
  p.attribution,
  o.observed_at,
  o.water_temperature_c,
  o.wave_height_m,
  o.wave_period_s,
  o.wind_speed_ms,
  o.wind_direction_deg,
  o.tide_height_m,
  o.quality_code
FROM spot_observation_stations sos
JOIN observation_stations st ON st.id = sos.station_id AND st.active
JOIN observation_providers p ON p.id = st.provider_id AND p.enabled
LEFT JOIN LATERAL (
  SELECT * FROM observations o
   WHERE o.station_id = st.id AND o.water_temperature_c IS NOT NULL
   ORDER BY o.observed_at DESC
   LIMIT 1
) o ON true
WHERE sos.status = 'approved';

-- ── 6. RLS ───────────────────────────────────────────────────────
-- All four tables are public-read (the spot pages read them with the anon
-- key). There are NO write policies: every write path (ingestion cron,
-- matching script) uses the service role, and admin review goes through
-- the SECURITY DEFINER RPCs below.
ALTER TABLE observation_providers      ENABLE ROW LEVEL SECURITY;
ALTER TABLE observation_stations       ENABLE ROW LEVEL SECURITY;
ALTER TABLE observations               ENABLE ROW LEVEL SECURITY;
ALTER TABLE spot_observation_stations  ENABLE ROW LEVEL SECURITY;

CREATE POLICY observation_providers_public_read ON observation_providers
  FOR SELECT USING (true);
CREATE POLICY observation_stations_public_read ON observation_stations
  FOR SELECT USING (true);
CREATE POLICY observations_public_read ON observations
  FOR SELECT USING (true);
CREATE POLICY spot_observation_stations_public_read ON spot_observation_stations
  FOR SELECT USING (true);

-- ── 7. Admin review RPCs ─────────────────────────────────────────
-- Same pattern as the discovery/challenge admin RPCs: SECURITY DEFINER,
-- re-check profiles.is_admin inside, callable from admin.html with the
-- signed-in admin's JWT.

CREATE OR REPLACE FUNCTION approve_observation_station(
  p_spot_id    uuid,
  p_station_id uuid,
  p_primary    boolean DEFAULT false,
  p_replace    boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_existing_primary uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin) THEN
    RAISE EXCEPTION 'admin only';
  END IF;

  IF p_primary THEN
    SELECT station_id INTO v_existing_primary
      FROM spot_observation_stations
     WHERE spot_id = p_spot_id AND is_primary AND station_id <> p_station_id;
    IF v_existing_primary IS NOT NULL AND NOT p_replace THEN
      -- Never silently overwrite a manually approved primary station.
      RETURN jsonb_build_object(
        'ok', false,
        'error', 'primary_exists',
        'existing_station_id', v_existing_primary
      );
    END IF;
    IF v_existing_primary IS NOT NULL AND p_replace THEN
      UPDATE spot_observation_stations
         SET is_primary = false, reviewed_at = now(), reviewed_by = auth.uid()
       WHERE spot_id = p_spot_id AND station_id = v_existing_primary;
    END IF;
  END IF;

  UPDATE spot_observation_stations
     SET status      = 'approved',
         is_primary  = p_primary,
         reviewed_at = now(),
         reviewed_by = auth.uid()
   WHERE spot_id = p_spot_id AND station_id = p_station_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found');
  END IF;
  RETURN jsonb_build_object('ok', true);
END;
$$;

CREATE OR REPLACE FUNCTION reject_observation_station(
  p_spot_id    uuid,
  p_station_id uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin) THEN
    RAISE EXCEPTION 'admin only';
  END IF;

  UPDATE spot_observation_stations
     SET status      = 'rejected',
         is_primary  = false,
         reviewed_at = now(),
         reviewed_by = auth.uid()
   WHERE spot_id = p_spot_id AND station_id = p_station_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found');
  END IF;
  RETURN jsonb_build_object('ok', true);
END;
$$;

GRANT EXECUTE ON FUNCTION approve_observation_station(uuid, uuid, boolean, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION reject_observation_station(uuid, uuid) TO authenticated;

-- ── 8. Seed providers ────────────────────────────────────────────
-- NOAA NDBC is Increment 1's live provider. my-water.live is registered
-- (disabled) purely so the existing lido feed has a home in the model —
-- its cron keeps writing temp_logs untouched; adapting it behind this
-- pipeline is a later increment.
INSERT INTO observation_providers
  (code, name, provider_type, base_url, attribution, licence, enabled, poll_interval_minutes)
VALUES
  ('ndbc', 'NOAA National Data Buoy Center', 'buoy_network',
   'https://www.ndbc.noaa.gov',
   'Data: NOAA National Data Buoy Center',
   'US Government work — public domain (NOAA data are not subject to copyright; attribution requested)',
   true, 60),
  ('mywaterlive', 'my-water.live', 'sensor_network',
   'https://api.my-water.live',
   'Powered by my-water.live',
   'Commercial API — used with permission (existing partnership)',
   false, 60)
ON CONFLICT (code) DO NOTHING;

COMMIT;

-- ----------------------------------------------------------------
-- ROLLBACK — exact SQL to undo, or state:
-- "irreversible — restore from _bak_YYYYMMDD_tablename"
-- ----------------------------------------------------------------
-- Fully reversible (nothing existing was touched):
-- BEGIN;
-- DROP FUNCTION IF EXISTS approve_observation_station(uuid, uuid, boolean, boolean);
-- DROP FUNCTION IF EXISTS reject_observation_station(uuid, uuid);
-- DROP VIEW IF EXISTS spot_conditions_live;
-- DROP TABLE IF EXISTS spot_observation_stations;
-- DROP TABLE IF EXISTS observations;
-- DROP TABLE IF EXISTS observation_stations;
-- DROP TABLE IF EXISTS observation_providers;
-- COMMIT;

-- ----------------------------------------------------------------
-- VERIFY — run on the READ-ONLY connection AFTER applying.
-- State the expected result next to each query.
-- ----------------------------------------------------------------
-- SELECT count(*) FROM observation_providers;
--   -- expect: 2 (ndbc enabled, mywaterlive disabled)
-- SELECT code, enabled FROM observation_providers ORDER BY code;
--   -- expect: mywaterlive|f, ndbc|t
-- SELECT count(*) FROM spot_conditions_live;
--   -- expect: 0 (no approved links yet)
-- SELECT relrowsecurity FROM pg_class
--   WHERE relname IN ('observation_providers','observation_stations',
--                     'observations','spot_observation_stations');
--   -- expect: 4 rows, all true
-- SELECT indexname FROM pg_indexes
--   WHERE tablename = 'spot_observation_stations'
--     AND indexname = 'one_primary_station_per_spot';
--   -- expect: 1 row
