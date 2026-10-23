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
-- Migration: 2026-10-21_mark-english-channel-post-published.sql   (see MIGRATIONS.md)
-- ================================================================
-- Purpose:
--   Record the English Channel post published by hand on the Facebook Page on 20 Oct 2026 as PUBLISHED, so the 90-day
--   source de-duplication (social_posts.source_key) sees it without the local social-poc/publish-ledger.json.
--   scheduled_for is moved to the real publish time so the row does not occupy the 27 Oct slot or hide an empty slot from the alert.
-- Requested by:
--   Dave

-- PRE-CHECKS (read-only; run 21 Oct 2026): exactly 1 row matches.
--   SELECT id, status, scheduled_for, fb_result FROM social_posts
--    WHERE id = '37fef859-038c-49b0-b910-fa0e204338cd' AND source_key = 'crossing:8c086e60-ea21-4445-ba2a-b5b1f2bcce41';
--   -- got: status REJECTED, scheduled_for 2026-10-27 08:00:00+00, fb_result NULL, idempotency_key NULL
--   Facebook post id and time come from social-poc/publish-ledger.json (908877712320197_122125346168110894, 2026-10-20T17:18:10.428Z).

-- BACKUP (UPDATE): one row.
CREATE TABLE _bak_20261021_social_posts AS SELECT * FROM social_posts WHERE id = '37fef859-038c-49b0-b910-fa0e204338cd';
ALTER TABLE _bak_20261021_social_posts ENABLE ROW LEVEL SECURITY;

-- MIGRATION (applied only after Dave types "apply")
BEGIN;
UPDATE social_posts
   SET status = 'PUBLISHED',
       scheduled_for = '2026-10-20T17:18:10.428Z',
       fb_result = '{"externalId":"908877712320197_122125346168110894","publishedAt":"2026-10-20T17:18:10.428Z","attempts":1,"manual":true}'::jsonb,
       updated_at = now()
 WHERE id = '37fef859-038c-49b0-b910-fa0e204338cd'
   AND source_key = 'crossing:8c086e60-ea21-4445-ba2a-b5b1f2bcce41'
   AND status = 'REJECTED';
COMMIT;

-- ROLLBACK
--   UPDATE social_posts s SET status = b.status, scheduled_for = b.scheduled_for, fb_result = b.fb_result, updated_at = now()
--     FROM _bak_20261021_social_posts b WHERE s.id = b.id;
--   (drop the backup table afterwards)

-- VERIFY (read-only, after applying)
--   SELECT status, scheduled_for, fb_result->>'externalId' FROM social_posts WHERE id = '37fef859-038c-49b0-b910-fa0e204338cd';
--   -- expect: PUBLISHED | 2026-10-20 17:18:10.428+00 | 908877712320197_122125346168110894
--   SELECT count(*) FROM social_posts WHERE status IN ('APPROVED','SCHEDULED') AND scheduled_for <= now();   -- expect: no change from before (publisher ignores PUBLISHED)
