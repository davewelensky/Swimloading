-- Strava integration tables
-- Phase 1: OAuth connections + activity imports

-- Stores OAuth tokens per user (server-side only via Edge Functions)
CREATE TABLE IF NOT EXISTS public.strava_connections (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL UNIQUE,
  strava_athlete_id   bigint NOT NULL,
  access_token        text NOT NULL,
  refresh_token       text NOT NULL,
  expires_at          bigint NOT NULL,  -- unix timestamp
  scope               text,
  connected_at        timestamptz DEFAULT now(),
  updated_at          timestamptz DEFAULT now()
);

-- Caches imported Strava activities, links to temp_logs once imported
CREATE TABLE IF NOT EXISTS public.strava_imports (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                 uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  strava_activity_id      bigint NOT NULL,
  name                    text,
  sport_type              text,
  start_date              timestamptz,
  start_date_local        timestamptz,
  distance_m              numeric,
  elapsed_time_seconds    int,
  moving_time_seconds     int,
  average_speed           numeric,
  start_latlng            jsonb,
  end_latlng              jsonb,
  map_summary_polyline    text,
  raw_payload             jsonb,
  matched_spot_id         uuid REFERENCES public.spots(id),
  imported_to_log_id      uuid,  -- FK to temp_logs added after confirm that column exists
  created_at              timestamptz DEFAULT now(),
  UNIQUE(user_id, strava_activity_id)
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS strava_imports_user_id_idx ON public.strava_imports(user_id);
CREATE INDEX IF NOT EXISTS strava_imports_start_date_idx ON public.strava_imports(start_date DESC);
CREATE INDEX IF NOT EXISTS strava_imports_imported_idx ON public.strava_imports(imported_to_log_id) WHERE imported_to_log_id IS NULL;

-- RLS: enable on both tables
ALTER TABLE public.strava_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.strava_imports ENABLE ROW LEVEL SECURITY;

-- strava_connections: users can only see/manage their own row
CREATE POLICY "Users manage own strava connection"
  ON public.strava_connections
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- strava_imports: users can only see/manage their own rows
CREATE POLICY "Users manage own strava imports"
  ON public.strava_imports
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Service role bypass (Edge Functions use service role to upsert on behalf of user)
CREATE POLICY "Service role can manage strava connections"
  ON public.strava_connections
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Service role can manage strava imports"
  ON public.strava_imports
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
