-- PROPOSED, NOT APPLIED. Media catalogue table for the Social Content Engine.
-- Until applied, media-library/catalogue.json is the source of truth (same fields, camelCase there).
-- Follow MIGRATIONS.md (dry-run, Dave types "apply", verify, move to sql/applied/). New table: no backup needed.
-- Originals go in a PRIVATE Storage bucket 'social-media' (create in the dashboard; never public: files may carry EXIF
-- location and show identifiable swimmers). Generated post images contain no EXIF and may be served publicly.

CREATE TABLE media_assets (
  id                   text PRIMARY KEY,
  storage_path         text NOT NULL,                 -- bucket 'social-media', or repo path in file mode
  thumb_path           text,                          -- 480px JPEG thumbnail (no EXIF); may be served publicly
  original_filename    text,
  sha1                 text UNIQUE,                   -- exact-duplicate detection across the whole library
  kind                 text NOT NULL DEFAULT 'photo' CHECK (kind IN ('photo','product','logo')),
  source               text NOT NULL,                 -- 'google-photos-export' | 'wikimedia-commons' | 'swimloading-site' | 'partner'
  source_album         text,
  source_url           text,
  owner                text,
  photographer         text,
  location             text,
  country              text,
  spot_id              uuid REFERENCES spots(id),     -- set ONLY if the photo documents exactly this spot
  region               text,                          -- regional photo (e.g. 'Cape Town') when the exact spot is unknown
  crossing_slug        text,
  partner              text,                          -- partner slug for product images
  subject              text NOT NULL DEFAULT 'generic' CHECK (subject IN ('location','generic')),
  tags                 text[] NOT NULL DEFAULT '{}',
  width                int, height int,
  orientation          text GENERATED ALWAYS AS (CASE WHEN width > height THEN 'landscape' WHEN width < height THEN 'portrait' ELSE 'square' END) STORED,
  permission           text NOT NULL DEFAULT 'owned' CHECK (permission IN ('owned','cc-by','cc-by-sa','partner-supplied')),
  attribution          text,
  approved_for_social  boolean NOT NULL DEFAULT false,
  provenance_confirmed boolean NOT NULL DEFAULT false,
  identifiable_people  boolean,
  consent              text NOT NULL DEFAULT 'n/a' CHECK (consent IN ('n/a','unknown','confirmed')),
  session_id           text,                          -- one swim = one session: rotation avoids same-session repeats
  captured_at          timestamptz,
  dhash                text,                          -- 64-bit difference hash for near-duplicate detection
  focus_x              smallint NOT NULL DEFAULT 50,  -- crop focus (object-position %), keeps faces and subjects in frame
  focus_y              smallint NOT NULL DEFAULT 50,
  notes                text,
  created_at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX media_assets_spot_idx    ON media_assets (spot_id) WHERE spot_id IS NOT NULL;
CREATE INDEX media_assets_session_idx ON media_assets (session_id);

-- Which asset was used by which post (rotation + 21-day rule read this).
CREATE TABLE social_post_media (
  post_id   uuid NOT NULL,                            -- social_posts.id (see 2026-10-18_social-engine_PROPOSED.sql)
  slide     smallint NOT NULL DEFAULT 1,
  asset_id  text REFERENCES media_assets(id),         -- NULL for maps and branded graphics
  tier      text NOT NULL,
  reason    text NOT NULL,
  used_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (post_id, slide)
);

ALTER TABLE media_assets      ENABLE ROW LEVEL SECURITY;
ALTER TABLE social_post_media ENABLE ROW LEVEL SECURITY;
CREATE POLICY media_assets_dave      ON media_assets      FOR ALL USING (auth.email() = 'dave.welensky@gmail.com') WITH CHECK (auth.email() = 'dave.welensky@gmail.com');
CREATE POLICY social_post_media_dave ON social_post_media FOR ALL USING (auth.email() = 'dave.welensky@gmail.com') WITH CHECK (auth.email() = 'dave.welensky@gmail.com');
