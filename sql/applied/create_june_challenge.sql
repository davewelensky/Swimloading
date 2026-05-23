-- June Community Challenge tables
-- Run in Supabase SQL editor BEFORE deploying app-june.js
-- Challenge period: 1 June – 30 June 2026
-- Test mode: enabled now, visible only to testers

-- ── Config (single row, id always = 1) ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS june_challenge_config (
  id int PRIMARY KEY DEFAULT 1,
  enabled bool NOT NULL DEFAULT false,
  test_mode bool NOT NULL DEFAULT true,
  launch_date date NOT NULL DEFAULT '2026-06-01',
  end_date date NOT NULL DEFAULT '2026-06-30',
  CONSTRAINT jcc_single_row CHECK (id = 1)
);

-- Start in test mode (enabled=true, test_mode=true) so we can test internally
INSERT INTO june_challenge_config (id, enabled, test_mode, launch_date, end_date)
VALUES (1, true, true, '2026-06-01', '2026-06-30')
ON CONFLICT (id) DO NOTHING;

-- ── Activity / scoring log ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS june_challenge_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name text,
  action_type text NOT NULL,
  -- Action types: temp_log, create_swim, attend_swim, new_spot, hazard_report,
  --               whatsapp_share, streak_3day, dormant_spot, group_bonus
  points int NOT NULL DEFAULT 0,
  spot_id uuid REFERENCES spots(id) ON DELETE SET NULL,
  spot_name text,
  ref_id text,        -- log_id, event_id, etc. — for dedup checks
  metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS jce_user_idx      ON june_challenge_events(user_id);
CREATE INDEX IF NOT EXISTS jce_created_idx   ON june_challenge_events(created_at DESC);
CREATE INDEX IF NOT EXISTS jce_action_idx    ON june_challenge_events(action_type);
CREATE INDEX IF NOT EXISTS jce_ref_idx       ON june_challenge_events(ref_id) WHERE ref_id IS NOT NULL;

-- ── RLS ───────────────────────────────────────────────────────────────────────
ALTER TABLE june_challenge_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE june_challenge_events ENABLE ROW LEVEL SECURITY;

-- Everyone can read config and events (leaderboard/feed must be public)
CREATE POLICY "jcc_read_all"      ON june_challenge_config FOR SELECT TO authenticated USING (true);
CREATE POLICY "jce_read_all"      ON june_challenge_events FOR SELECT TO authenticated USING (true);

-- Users can only insert their own events
CREATE POLICY "jce_insert_own"    ON june_challenge_events FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- ── Helper: get June leaderboard ─────────────────────────────────────────────
-- Called from JS via direct query (aggregated in client); no RPC needed.
-- But useful for admin reporting:

CREATE OR REPLACE VIEW june_challenge_leaderboard AS
SELECT
  jce.user_id,
  p.display_name,
  SUM(jce.points)   AS total_points,
  COUNT(*)          AS event_count,
  MAX(jce.created_at) AS last_action_at
FROM june_challenge_events jce
JOIN profiles p ON p.id = jce.user_id
GROUP BY jce.user_id, p.display_name
ORDER BY total_points DESC;

-- ── Toggle guide ─────────────────────────────────────────────────────────────
-- To disable challenge:
--   UPDATE june_challenge_config SET enabled = false WHERE id = 1;
-- To launch publicly (disable test mode on June 1):
--   UPDATE june_challenge_config SET test_mode = false WHERE id = 1;
-- To re-enable test mode:
--   UPDATE june_challenge_config SET test_mode = true WHERE id = 1;
