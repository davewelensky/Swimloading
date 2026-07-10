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
-- Migration: 2026-07-10_uk-challenge-tables.sql
-- Process:   see MIGRATIONS.md — no section below may be left empty
-- ================================================================

-- Purpose:
--   New, standalone tables for "The Great UK Swim Spot Challenge" x TRI HARD
--   (unique UK-location scoring campaign). Entirely parallel to june_challenge_*
--   — does NOT touch the live monthly challenge (challenge_id=1) tables/rows.
--   Uses a real campaigns table with a UUID PK + campaign_id FK on every child
--   table (not a single-row CHECK constraint like june_challenge_config) so a
--   second/future campaign is just another row, not a schema copy.

-- Requested by:
--   Dave

-- ----------------------------------------------------------------
-- PRE-CHECKS — run on the READ-ONLY connection BEFORE applying.
-- Must include affected-row counts for any UPDATE/DELETE.
-- ----------------------------------------------------------------
-- SELECT count(*) FROM information_schema.tables
--   WHERE table_schema='public' AND table_name IN
--   ('campaigns','campaign_participants','campaign_location_credits',
--    'campaign_events','campaign_admin_flags','campaign_location_proposals');
--   -- expect: 0 (none of these tables exist yet)
-- SELECT count(*) FROM spots WHERE country_code='GB'; -- expect: 14 (sanity check, no change here)

-- ----------------------------------------------------------------
-- BACKUP — required before any DELETE / UPDATE / DROP / TRUNCATE.
-- ----------------------------------------------------------------
-- Not applicable — this migration only CREATEs new tables, no existing
-- table is altered, deleted from, or dropped.

-- ----------------------------------------------------------------
-- MIGRATION — applied only after Dave types "apply".
-- ----------------------------------------------------------------
BEGIN;

-- ── campaigns ────────────────────────────────────────────────────────────
CREATE TABLE campaigns (
  id                        uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  slug                      text        NOT NULL UNIQUE,
  name                      text        NOT NULL,
  sponsor_name              text,
  enabled                   boolean     NOT NULL DEFAULT false,
  test_mode                 boolean     NOT NULL DEFAULT true,
  tester_ids                uuid[]      NOT NULL DEFAULT '{}',
  launch_date               date,
  end_date                  date,
  points_per_unique_location integer    NOT NULL DEFAULT 10,
  eligible_country_code     text        NOT NULL DEFAULT 'GB',
  eligible_water_types      text[]      NOT NULL DEFAULT ARRAY['OCEAN','LAGOON','RIVER','LAKE','DAM','TIDAL_POOL'],
  created_at                timestamptz DEFAULT now()
);

-- Seed the one campaign row, disabled + test_mode by default (safe-by-default,
-- matches june_challenge_config's launch pattern). Dates are placeholders —
-- Dave to confirm real launch/end dates before flipping enabled=true.
INSERT INTO campaigns (slug, name, sponsor_name, enabled, test_mode, launch_date, end_date)
VALUES (
  'uk_swim_spot_challenge',
  'The Great UK Swim Spot Challenge',
  'TRI HARD',
  false,
  true,
  '2026-08-01',
  '2026-09-30'
);

-- ── campaign_participants ────────────────────────────────────────────────
CREATE TABLE campaign_participants (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id    uuid        NOT NULL REFERENCES campaigns(id),
  user_id        uuid        NOT NULL REFERENCES profiles(id),
  joined_at      timestamptz DEFAULT now(),
  referral_code  text,
  UNIQUE (campaign_id, user_id)
);

-- ── campaign_location_credits (the unique-location scoring ledger) ──────
CREATE TABLE campaign_location_credits (
  id                     uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id            uuid        NOT NULL REFERENCES campaigns(id),
  user_id                uuid        NOT NULL REFERENCES profiles(id),
  spot_id                uuid        NOT NULL REFERENCES spots(id),
  first_qualifying_log_id uuid       REFERENCES temp_logs(id),
  points_awarded         integer     NOT NULL DEFAULT 0,
  awarded_at             timestamptz DEFAULT now(),
  -- This UNIQUE constraint IS the "one unique-location credit per user"
  -- rule — enforced by Postgres, not app logic.
  UNIQUE (campaign_id, user_id, spot_id)
);

CREATE INDEX idx_campaign_credits_user
  ON campaign_location_credits(campaign_id, user_id);

-- ── campaign_events (live feed) ───────────────────────────────────────────
CREATE TABLE campaign_events (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id   uuid        NOT NULL REFERENCES campaigns(id),
  user_id       uuid        NOT NULL REFERENCES profiles(id),
  display_name  text,
  action_type   text        NOT NULL,
  -- action_type values: joined, location_earned, swim_logged_repeat
  points        integer     NOT NULL DEFAULT 0,
  spot_id       uuid        REFERENCES spots(id),
  spot_name     text,
  metadata      jsonb       DEFAULT '{}',
  created_at    timestamptz DEFAULT now()
);

CREATE INDEX idx_campaign_events_campaign_created
  ON campaign_events(campaign_id, created_at DESC);

-- ── campaign_admin_flags (mirrors challenge_admin_flags shape) ───────────
CREATE TABLE campaign_admin_flags (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id          uuid        NOT NULL REFERENCES campaigns(id),
  user_id              uuid        NOT NULL REFERENCES profiles(id),
  flag_type            text        NOT NULL,
  severity             text        NOT NULL DEFAULT 'low',
  description          text,
  related_action_count integer     DEFAULT 0,
  first_seen_at        timestamptz DEFAULT now(),
  last_seen_at         timestamptz DEFAULT now(),
  status               text        NOT NULL DEFAULT 'open',
  admin_notes          text,
  disqualified         boolean     NOT NULL DEFAULT false,
  created_at           timestamptz DEFAULT now(),
  updated_at           timestamptz DEFAULT now(),
  UNIQUE (campaign_id, user_id, flag_type)
);

CREATE INDEX idx_campaign_flags_open
  ON campaign_admin_flags(status) WHERE status = 'open';

-- ── campaign_location_proposals (link to spot_suggestions, no changes to
--    that table's own schema — it stays fully reused as-is) ───────────────
CREATE TABLE campaign_location_proposals (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id        uuid        NOT NULL REFERENCES campaigns(id),
  user_id            uuid        NOT NULL REFERENCES profiles(id),
  spot_suggestion_id uuid        NOT NULL REFERENCES spot_suggestions(id),
  -- Claimed coordinates for the proposed location — stored here (not on
  -- spot_suggestions, which has no lat/lng column) so admin can view on a
  -- map and find_nearest_spot() can dedupe against `spots` before a
  -- suggestion is even created.
  claimed_lat        double precision,
  claimed_lng        double precision,
  status             text        NOT NULL DEFAULT 'pending',
  -- status values: pending, approved, rejected, merged_to_existing
  resolved_spot_id   uuid        REFERENCES spots(id),
  created_at         timestamptz DEFAULT now(),
  resolved_at        timestamptz
);

CREATE INDEX idx_campaign_proposals_status
  ON campaign_location_proposals(campaign_id, status);

COMMIT;

-- ----------------------------------------------------------------
-- ROLLBACK — exact SQL to undo, or state:
-- "irreversible — restore from _bak_YYYYMMDD_tablename"
-- ----------------------------------------------------------------
-- DROP TABLE IF EXISTS campaign_location_proposals;
-- DROP TABLE IF EXISTS campaign_admin_flags;
-- DROP TABLE IF EXISTS campaign_events;
-- DROP TABLE IF EXISTS campaign_location_credits;
-- DROP TABLE IF EXISTS campaign_participants;
-- DROP TABLE IF EXISTS campaigns;
-- (Safe / fully reversible — brand new tables, no existing data touched.)

-- ----------------------------------------------------------------
-- VERIFY — run on the READ-ONLY connection AFTER applying.
-- State the expected result next to each query.
-- ----------------------------------------------------------------
-- SELECT slug, enabled, test_mode, launch_date, end_date FROM campaigns;
--   -- expect: 1 row, slug='uk_swim_spot_challenge', enabled=false, test_mode=true
-- SELECT count(*) FROM information_schema.tables WHERE table_schema='public'
--   AND table_name IN ('campaigns','campaign_participants','campaign_location_credits',
--   'campaign_events','campaign_admin_flags','campaign_location_proposals');
--   -- expect: 6
