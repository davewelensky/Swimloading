-- June Challenge v2 — Table migrations
-- Steps 1-3: extend config + create audit/flag tables
-- Run in Supabase SQL editor BEFORE deploying app-june.js v2
-- Challenge period: 1 June – 30 June 2026

-- ── Step 1: Extend june_challenge_config with point values ───────────────────

ALTER TABLE june_challenge_config ADD COLUMN IF NOT EXISTS pts_temp_log              integer DEFAULT 15;
ALTER TABLE june_challenge_config ADD COLUMN IF NOT EXISTS pts_create_swim           integer DEFAULT 15;
ALTER TABLE june_challenge_config ADD COLUMN IF NOT EXISTS pts_join_swim             integer DEFAULT 20;
ALTER TABLE june_challenge_config ADD COLUMN IF NOT EXISTS pts_creator_bonus         integer DEFAULT 10;
ALTER TABLE june_challenge_config ADD COLUMN IF NOT EXISTS pts_creator_bonus_cap     integer DEFAULT 3;
ALTER TABLE june_challenge_config ADD COLUMN IF NOT EXISTS pts_whatsapp_share        integer DEFAULT 5;
ALTER TABLE june_challenge_config ADD COLUMN IF NOT EXISTS pts_streak_3day           integer DEFAULT 20;
ALTER TABLE june_challenge_config ADD COLUMN IF NOT EXISTS pts_streak_7day           integer DEFAULT 50;
ALTER TABLE june_challenge_config ADD COLUMN IF NOT EXISTS draw_entry_cap            integer DEFAULT 500;
ALTER TABLE june_challenge_config ADD COLUMN IF NOT EXISTS qualify_min_active_days   integer DEFAULT 5;
ALTER TABLE june_challenge_config ADD COLUMN IF NOT EXISTS qualify_min_temp_logs     integer DEFAULT 4;
ALTER TABLE june_challenge_config ADD COLUMN IF NOT EXISTS qualify_min_joined_swims  integer DEFAULT 1;

-- Update the single config row with correct values
UPDATE june_challenge_config SET
  pts_temp_log             = 15,
  pts_create_swim          = 15,
  pts_join_swim            = 20,
  pts_creator_bonus        = 10,
  pts_creator_bonus_cap    = 3,
  pts_whatsapp_share       = 5,
  pts_streak_3day          = 20,
  pts_streak_7day          = 50,
  draw_entry_cap           = 500,
  qualify_min_active_days  = 5,
  qualify_min_temp_logs    = 4,
  qualify_min_joined_swims = 1
WHERE id = 1;

-- ── Step 2: Challenge points audit table ────────────────────────────────────

CREATE TABLE IF NOT EXISTS challenge_points_audit (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  challenge_id     integer     NOT NULL DEFAULT 1,
  user_id          uuid        NOT NULL REFERENCES profiles(id),
  action_type      text        NOT NULL,
  -- action_type values:
  -- temp_log, create_swim, join_swim, creator_bonus, whatsapp_share,
  -- streak_3day, streak_7day, admin_action, admin_reversal
  source_table     text,
  source_record_id text,
  points_awarded   integer     NOT NULL DEFAULT 0,
  points_status    text        NOT NULL DEFAULT 'awarded',
  -- points_status values: awarded, rejected, reversed, flagged
  rejection_reason text,
  awarded_at       timestamptz DEFAULT now(),
  created_at       timestamptz DEFAULT now(),
  metadata         jsonb       DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_audit_user_action
  ON challenge_points_audit(challenge_id, user_id, action_type, awarded_at);
CREATE INDEX IF NOT EXISTS idx_audit_status
  ON challenge_points_audit(points_status);
CREATE INDEX IF NOT EXISTS idx_audit_source
  ON challenge_points_audit(source_record_id) WHERE source_record_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_audit_awarded_date
  ON challenge_points_audit(CAST(awarded_at AT TIME ZONE 'UTC' AS date));

-- ── Step 3: Challenge admin flags table ─────────────────────────────────────

CREATE TABLE IF NOT EXISTS challenge_admin_flags (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  challenge_id         integer     NOT NULL DEFAULT 1,
  user_id              uuid        NOT NULL REFERENCES profiles(id),
  flag_type            text        NOT NULL,
  -- flag_type values:
  -- high_burst, repeated_pair, excessive_rejections,
  -- too_many_shares, swim_farming, last_minute_surge
  severity             text        NOT NULL DEFAULT 'low',
  -- severity: low, medium, high
  description          text,
  related_action_count integer     DEFAULT 0,
  first_seen_at        timestamptz DEFAULT now(),
  last_seen_at         timestamptz DEFAULT now(),
  status               text        NOT NULL DEFAULT 'open',
  -- status: open, reviewed, dismissed, confirmed
  admin_notes          text,
  disqualified         boolean     NOT NULL DEFAULT false,
  created_at           timestamptz DEFAULT now(),
  updated_at           timestamptz DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_flags_unique
  ON challenge_admin_flags(challenge_id, user_id, flag_type);

CREATE INDEX IF NOT EXISTS idx_flags_open
  ON challenge_admin_flags(status) WHERE status = 'open';

-- ── Pre-launch cleanup (run manually on June 1 before going live) ────────────
-- DELETE FROM june_challenge_events;
-- DELETE FROM challenge_points_audit;
-- DELETE FROM challenge_admin_flags;
