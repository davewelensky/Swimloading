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
-- Migration: 2026-09-21_remove-dave-duc-k8-admin-rows.sql
-- Process:   see MIGRATIONS.md — no section below may be left empty
-- ================================================================

-- Purpose:
--   Remove Dave's own club-admin memberships for Durban Underwater Club and
--   K8 Coaching so the two "Club Admin Dashboard" cards stop appearing on his
--   Home screen. His Aquasharks membership is untouched. Steve (DUC) and
--   Britt / the coaches (K8, Aquasharks) keep every one of their rows.
--   Exactly TWO rows are deleted, identified by primary key AND user_id.

-- Requested by:
--   Dave (21 Sep 2026: "remove the K8 and DUC from my selection as not needed")

-- ----------------------------------------------------------------
-- PRE-CHECKS — run on the READ-ONLY connection BEFORE applying.
-- ----------------------------------------------------------------
-- Dave's rows (expect 3: Aquasharks, DUC, K8):
-- SELECT ca.id, ca.role, c.slug
-- FROM public.club_admins ca
-- JOIN public.clubs c ON c.id = ca.club_id
-- JOIN auth.users u   ON u.id = ca.user_id
-- WHERE u.email = 'dave.welensky@gmail.com';
--
-- Rows the DELETE will hit (expect exactly 2):
-- SELECT count(*) FROM public.club_admins ca
-- JOIN auth.users u ON u.id = ca.user_id
-- WHERE u.email = 'dave.welensky@gmail.com'
--   AND ca.id IN ('67cc3b41-84e2-429d-942c-db8bb821c01e',   -- DUC
--                 '47510ccc-0d58-4a5d-89d8-263271ea14af');  -- K8 Coaching
--
-- Other admins on those clubs must be untouched (DUC 2 rows, K8 8 rows before):
-- SELECT c.slug, count(*) FROM public.club_admins ca
-- JOIN public.clubs c ON c.id = ca.club_id
-- WHERE c.slug IN ('duc','k8-coaching') GROUP BY c.slug;

-- ----------------------------------------------------------------
-- BACKUP — required before any DELETE / UPDATE / DROP / TRUNCATE.
-- ----------------------------------------------------------------
-- CREATE TABLE _bak_20260921_club_admins AS
--   SELECT * FROM public.club_admins
--   WHERE id IN ('67cc3b41-84e2-429d-942c-db8bb821c01e',
--                '47510ccc-0d58-4a5d-89d8-263271ea14af');

-- ----------------------------------------------------------------
-- MIGRATION — applied only after Dave types "apply".
-- ----------------------------------------------------------------
BEGIN;

CREATE TABLE _bak_20260921_club_admins AS
  SELECT * FROM public.club_admins
  WHERE id IN ('67cc3b41-84e2-429d-942c-db8bb821c01e',
               '47510ccc-0d58-4a5d-89d8-263271ea14af');

DO $$
BEGIN
  IF (SELECT count(*) FROM _bak_20260921_club_admins) <> 2 THEN
    RAISE EXCEPTION 'Backup holds % rows, expected 2 — aborting', (SELECT count(*) FROM _bak_20260921_club_admins);
  END IF;
END $$;

DELETE FROM public.club_admins ca
USING auth.users u
WHERE u.id = ca.user_id
  AND u.email = 'dave.welensky@gmail.com'
  AND ca.id IN ('67cc3b41-84e2-429d-942c-db8bb821c01e',
                '47510ccc-0d58-4a5d-89d8-263271ea14af');

COMMIT;

-- ----------------------------------------------------------------
-- ROLLBACK — exact SQL to undo:
--   INSERT INTO public.club_admins SELECT * FROM _bak_20260921_club_admins;
-- (the backup table is kept until Dave confirms he does not want them back)
-- ----------------------------------------------------------------

-- ----------------------------------------------------------------
-- VERIFY — run on the READ-ONLY connection AFTER applying.
-- ----------------------------------------------------------------
-- Dave now has only Aquasharks:
-- SELECT c.slug FROM public.club_admins ca
-- JOIN public.clubs c ON c.id = ca.club_id
-- JOIN auth.users u ON u.id = ca.user_id
-- WHERE u.email = 'dave.welensky@gmail.com';        -- expect: aqua-sharks-atlantic only
--
-- Nobody else lost access (DUC 1 row = Steve, K8 7 rows):
-- SELECT c.slug, count(*) FROM public.club_admins ca
-- JOIN public.clubs c ON c.id = ca.club_id
-- WHERE c.slug IN ('duc','k8-coaching','aqua-sharks-atlantic') GROUP BY c.slug;
--                                                    -- expect: duc 1, k8-coaching 7, aqua-sharks-atlantic 8
--
-- Backup intact:
-- SELECT count(*) FROM _bak_20260921_club_admins;    -- expect: 2
