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
-- Migration: 2026-10-18_social-publishing.sql   (see MIGRATIONS.md)
-- ================================================================
-- Purpose:      Social Content Engine publishing queue: social_settings (paused = TRUE by default), social_posts,
--               social_source_state, and the PUBLIC 'social-posts' bucket for GENERATED post images only
--               (no originals, no EXIF; Instagram/Facebook need a public image URL to fetch).
-- Requested by: Dave
-- PRE-CHECKS:   none of the three tables exist; bucket 'social-posts' does not exist (verify read-only before applying).
-- BACKUP:       not required - new objects only.
BEGIN;

INSERT INTO storage.buckets (id, name, public) VALUES ('social-posts', 'social-posts', true);  -- public READ of objects only; writes need the service key

CREATE TABLE social_settings (
  id            boolean PRIMARY KEY DEFAULT true CHECK (id),          -- single row
  paused        boolean NOT NULL DEFAULT true,                        -- global publishing pause; ships ON
  timezone      text    NOT NULL DEFAULT 'Africa/Johannesburg',
  cadence       jsonb   NOT NULL DEFAULT '[{"day":2,"hour":10,"minute":0},{"day":4,"hour":10,"minute":0},{"day":6,"hour":10,"minute":0}]',
  mix           jsonb   NOT NULL DEFAULT '{"explore":0.30,"locations":0.25,"crossings":0.15,"ocean":0.10,"partners":0.10,"clubsAndPlatform":0.10}',
  dedupe_days   int     NOT NULL DEFAULT 90,
  reserve_min   int     NOT NULL DEFAULT 6,
  updated_at    timestamptz NOT NULL DEFAULT now()
);
INSERT INTO social_settings DEFAULT VALUES;

CREATE TABLE social_posts (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_key        text NOT NULL,                  -- stable id, e.g. 'spot:<uuid>', 'explore:week:2026-10-20'
  category          text NOT NULL,
  angle             text,
  origin            text NOT NULL DEFAULT 'auto' CHECK (origin IN ('auto','manual')),  -- manual posts never displace the schedule
  facts             jsonb NOT NULL DEFAULT '[]',    -- [{key,text,kind,observedAt,source}]
  image_paths       text[] NOT NULL DEFAULT '{}',
  fb_caption        text,
  ig_caption        text,
  risk              text NOT NULL CHECK (risk IN ('AUTO_ELIGIBLE','REVIEW_REQUIRED','BLOCKED')),
  review_reasons    jsonb NOT NULL DEFAULT '[]',
  status            text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','PENDING_REVIEW','APPROVED','SCHEDULED','PUBLISHED','FAILED','REJECTED')),
  is_reserve        boolean NOT NULL DEFAULT false, -- validated evergreen held back as fallback
  scheduled_for     timestamptz,
  expires_at        timestamptz,
  source_snapshot   text,                           -- hash of material fields at build time
  fb_result         jsonb,                          -- {externalId, publishedAt, error, attempts}
  ig_result         jsonb,
  idempotency_key   text UNIQUE,                    -- one publish attempt per (post, platform, slot)
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX social_posts_status_idx ON social_posts (status, scheduled_for);
CREATE INDEX social_posts_source_idx ON social_posts (source_key, created_at DESC);

CREATE TABLE social_source_state (
  source_key           text PRIMARY KEY,
  first_seen_at        timestamptz NOT NULL DEFAULT now(),
  last_snapshot_hash   text,
  last_material_change_at timestamptz,
  last_promoted_at     timestamptz
);

ALTER TABLE social_settings     ENABLE ROW LEVEL SECURITY;
ALTER TABLE social_posts        ENABLE ROW LEVEL SECURITY;
ALTER TABLE social_source_state ENABLE ROW LEVEL SECURITY;
CREATE POLICY social_settings_dave     ON social_settings     FOR ALL USING (auth.email() = 'dave.welensky@gmail.com') WITH CHECK (auth.email() = 'dave.welensky@gmail.com');
CREATE POLICY social_posts_dave        ON social_posts        FOR ALL USING (auth.email() = 'dave.welensky@gmail.com') WITH CHECK (auth.email() = 'dave.welensky@gmail.com');
CREATE POLICY social_source_state_dave ON social_source_state FOR ALL USING (auth.email() = 'dave.welensky@gmail.com') WITH CHECK (auth.email() = 'dave.welensky@gmail.com');

COMMIT;
-- ROLLBACK:     DROP TABLE social_source_state; DROP TABLE social_posts; DROP TABLE social_settings;
--               DELETE FROM storage.buckets WHERE id='social-posts';   -- empty the bucket first
-- VERIFY:       SELECT paused FROM social_settings;                                  -- expect true (1 row)
--               SELECT relname, relrowsecurity FROM pg_class WHERE relname LIKE 'social_%' AND relkind='r';  -- expect 3 rows, all true
--               SELECT public FROM storage.buckets WHERE id='social-posts';          -- expect true
