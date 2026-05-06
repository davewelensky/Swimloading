-- ============================================================
-- Strava Multi-User Setup
-- Applied: 2026-05-06
-- Ensures strava_connections and strava_imports exist with
-- correct columns, constraints, indexes, and RLS policies
-- for production multi-user access (up to 999 athletes).
-- ============================================================

-- ─── strava_connections ──────────────────────────────────────
-- One row per user. Stores OAuth tokens for the connected athlete.
-- Upserted by /api/strava/callback (service role).
-- Read by client-side to check connection status.

CREATE TABLE IF NOT EXISTS strava_connections (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    strava_athlete_id   bigint NOT NULL,
    access_token        text NOT NULL,
    refresh_token       text NOT NULL,
    expires_at          bigint NOT NULL,   -- Unix timestamp from Strava
    scope               text,
    updated_at          timestamptz NOT NULL DEFAULT now(),
    created_at          timestamptz NOT NULL DEFAULT now(),
    UNIQUE (user_id)                       -- one Strava account per SwimLoading user
);

-- Index for token-helper lookups (user_id → tokens)
CREATE INDEX IF NOT EXISTS strava_connections_user_id_idx ON strava_connections(user_id);

-- RLS: users can see and manage their own connection
ALTER TABLE strava_connections ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can read own strava connection" ON strava_connections;
CREATE POLICY "Users can read own strava connection"
    ON strava_connections FOR SELECT
    USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete own strava connection" ON strava_connections;
CREATE POLICY "Users can delete own strava connection"
    ON strava_connections FOR DELETE
    USING (auth.uid() = user_id);

-- Service role (API) handles INSERT and UPDATE via service key (bypasses RLS)

-- ─── strava_imports ──────────────────────────────────────────
-- One row per user+activity pair. Cached from Strava API.
-- Upserted by /api/strava/activities (service role).
-- imported_to_log_id is set when the user creates a temp_log from it.

CREATE TABLE IF NOT EXISTS strava_imports (
    id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id                 uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    strava_activity_id      bigint NOT NULL,
    name                    text,
    sport_type              text,
    start_date              timestamptz,
    start_date_local        timestamptz,
    distance_m              float,
    elapsed_time_seconds    integer,
    moving_time_seconds     integer,
    average_speed           float,
    start_latlng            text,             -- JSON: [lat, lng]
    end_latlng              text,             -- JSON: [lat, lng]
    map_summary_polyline    text,
    matched_spot_id         uuid REFERENCES spots(id) ON DELETE SET NULL,
    raw_payload             text,             -- full Strava activity JSON
    imported_to_log_id      uuid REFERENCES temp_logs(id) ON DELETE SET NULL,
    created_at              timestamptz NOT NULL DEFAULT now(),
    UNIQUE (user_id, strava_activity_id)      -- one row per user per activity
);

-- Indexes for common query patterns
CREATE INDEX IF NOT EXISTS strava_imports_user_id_idx          ON strava_imports(user_id);
CREATE INDEX IF NOT EXISTS strava_imports_user_activity_idx    ON strava_imports(user_id, strava_activity_id);
CREATE INDEX IF NOT EXISTS strava_imports_imported_log_idx     ON strava_imports(imported_to_log_id) WHERE imported_to_log_id IS NOT NULL;

-- RLS: users can see and update their own imports
ALTER TABLE strava_imports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can read own strava imports" ON strava_imports;
CREATE POLICY "Users can read own strava imports"
    ON strava_imports FOR SELECT
    USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own strava imports" ON strava_imports;
CREATE POLICY "Users can update own strava imports"
    ON strava_imports FOR UPDATE
    USING (auth.uid() = user_id);

-- Service role handles INSERT and UPSERT via service key (bypasses RLS)
