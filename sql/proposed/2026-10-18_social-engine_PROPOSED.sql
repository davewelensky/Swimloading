-- PROPOSED, NOT APPLIED. Social Content Engine library (Stage B-4).
-- Follow MIGRATIONS.md: read-only dry-run, Dave types "apply", apply via supabase-admin, verify, move to sql/applied/.
-- All tables are new, so no backup table is needed. RLS: Dave only, same pattern as partner_pages (pp_dave_all).
-- The publish job (Stage C) will use the service key, which bypasses RLS; nothing here is readable by anon.

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
