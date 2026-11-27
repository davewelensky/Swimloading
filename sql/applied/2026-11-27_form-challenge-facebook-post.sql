-- ================================================================
-- SwimLoading — Migration
-- ================================================================

-- ⚠️  SAFETY CHECK — runs first, aborts everything if wrong project
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM _project_identity
    WHERE key = 'project_name' AND value = 'swimloading'
  ) THEN
    RAISE EXCEPTION 'WRONG PROJECT - MIGRATION ABORTED (expected swimloading)';
  END IF;
END $$;

-- ================================================================
-- Migration: 2026-11-27_form-challenge-facebook-post.sql
-- Process:   see MIGRATIONS.md
-- ================================================================

-- Purpose:
--   Hand-made Facebook announcement of the 12 Swims of Christmas for Tuesday
--   1 December 10:00 SAST. The post already in that slot (Gibraltar crossing)
--   moves to the first free Tue/Thu/Sat slot from 10 December.

-- Requested by:
--   Dave — 27 Nov 2026.

-- Needs first: the image and the own-site image rule (api/_lib/social/store.js)
-- deployed, because the publisher downloads the image from swimloading.com.

-- ----------------------------------------------------------------
-- PRE-CHECKS
-- ----------------------------------------------------------------
-- SELECT count(*) FROM social_posts WHERE source_key = 'challenge:form-12-swims:launch';  -- expect: 0
-- SELECT status, idempotency_key FROM social_posts WHERE id = '378b209e-c349-4640-85b4-3eca97144186';  -- expect: SCHEDULED, null

-- ----------------------------------------------------------------
-- BACKUP — the one moved row.
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS _bak_20261127_social_posts_gibraltar AS
  SELECT * FROM social_posts WHERE id = '378b209e-c349-4640-85b4-3eca97144186';
ALTER TABLE _bak_20261127_social_posts_gibraltar ENABLE ROW LEVEL SECURITY;

-- ----------------------------------------------------------------
-- MIGRATION — applied only after Dave types "apply".
-- ----------------------------------------------------------------
BEGIN;

UPDATE social_posts
   SET scheduled_for = (
         SELECT s.slot
           FROM generate_series(timestamptz '2026-12-10 08:00+00', timestamptz '2027-03-01 08:00+00', interval '1 day') AS s(slot)
          WHERE extract(isodow FROM s.slot) IN (2, 4, 6)
            AND NOT EXISTS (SELECT 1 FROM social_posts p WHERE p.scheduled_for = s.slot AND p.status IN ('SCHEDULED', 'APPROVED', 'PUBLISHED'))
          ORDER BY s.slot LIMIT 1),
       updated_at = now()
 WHERE id = '378b209e-c349-4640-85b4-3eca97144186' AND status = 'SCHEDULED' AND idempotency_key IS NULL;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM social_posts WHERE scheduled_for = timestamptz '2026-12-01 08:00+00' AND status IN ('SCHEDULED', 'APPROVED')) THEN
    RAISE EXCEPTION 'The 1 December slot is still taken - nothing changed';
  END IF;
  IF EXISTS (SELECT 1 FROM social_posts WHERE source_key = 'challenge:form-12-swims:launch') THEN
    RAISE EXCEPTION 'The announcement already exists - nothing changed';
  END IF;
END $$;

INSERT INTO social_posts
  (source_key, category, angle, origin, facts, image_paths, fb_caption, ig_caption, risk, review_reasons, status, is_reserve, scheduled_for, expires_at)
VALUES (
  'challenge:form-12-swims:launch',
  'BEHIND THE BRAND',
  'challenge-launch',
  'manual',
  '[{"key":"partner","kind":"evergreen","text":"FORM","source":{"table":"partner_pages","row":"b4e89ab1-d468-423f-b369-37158a6df883","column":"name"},"observedAt":null}]'::jsonb,
  ARRAY['https://www.swimloading.com/partners/form-12-swims-post.jpg'],
  E'The 12 Swims of Christmas starts today.\n\nSwim and log on 12 different days between 1 December and 6 January, and you are in the draw for a pair of FORM Smart Swim 2 goggles.\n\nA swim on Christmas Day adds a bonus entry. A swim on New Year''s Day adds another.\n\nOne winner, drawn on 7 January. South African delivery addresses only.\n\nRules and how to enter: https://www.swimloading.com/partners/form?utm_source=social&utm_medium=post&utm_campaign=12-swims',
  E'The 12 Swims of Christmas starts today.\n\nSwim and log on 12 different days between 1 December and 6 January for a place in the draw for FORM Smart Swim 2 goggles. Full rules on swimloading.com. Link in bio.\n\n#openwaterswimming #swimloading #12swimsofchristmas',
  'AUTO_ELIGIBLE',
  '[]'::jsonb,
  'SCHEDULED',
  false,
  timestamptz '2026-12-01 08:00+00',
  timestamptz '2026-12-01 20:00+00'
);

COMMIT;

-- ----------------------------------------------------------------
-- ROLLBACK (only before 1 December 10:00 SAST)
-- ----------------------------------------------------------------
-- DELETE FROM social_posts WHERE source_key = 'challenge:form-12-swims:launch' AND status = 'SCHEDULED';
-- UPDATE social_posts p SET scheduled_for = b.scheduled_for, updated_at = b.updated_at
--   FROM _bak_20261127_social_posts_gibraltar b WHERE p.id = b.id;

-- ----------------------------------------------------------------
-- VERIFY
-- ----------------------------------------------------------------
-- SELECT source_key, status, scheduled_for FROM social_posts
--  WHERE source_key = 'challenge:form-12-swims:launch' OR id = '378b209e-c349-4640-85b4-3eca97144186';
--  expect: announcement SCHEDULED 2026-12-01 08:00+00; Gibraltar SCHEDULED on a Tue/Thu/Sat from 10 Dec
