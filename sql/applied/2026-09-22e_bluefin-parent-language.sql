-- ================================================================
-- SwimLoading — Migration Template
-- ================================================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM _project_identity WHERE key = 'project_name' AND value = 'swimloading') THEN
    RAISE EXCEPTION 'WRONG PROJECT — MIGRATION ABORTED';
  END IF;
END $$;

-- ================================================================
-- Migration: 2026-09-22e_bluefin-parent-language.sql
-- ================================================================

-- Purpose:
--   Turn on parent_language for Bluefin. Resolves the open question
--   from earlier migrations: how does Nicky Sheridan (Reddam Foundation)
--   see the college students' progress? Answer, per Dave: Nicky creates
--   his own SwimLoading account, and Tracey links him to each of the 10
--   Reddam College roster entries via the Parents tab's "Invite a
--   parent" flow — the `relationship` field is free text (not limited
--   to Mother/Father/Guardian), so "Reddam Foundation" works as the
--   label. He then sees each student's PUBLISHED progress report in
--   his own account. The 10 seeded reports from the previous migration
--   are still is_published=false — a coach needs to review and publish
--   them before Nicky (or anyone else linked) can see them.

-- Requested by:
--   Dave — "well we get nicky to create an account - he signs up"

-- ----------------------------------------------------------------
-- PRE-CHECKS
-- ----------------------------------------------------------------
-- SELECT features->'parent_language' FROM clubs WHERE slug='bluefin'; -> false (or absent)

-- ----------------------------------------------------------------
-- BACKUP
-- ----------------------------------------------------------------
-- Already covered by _bak_20260922d_clubs_bluefin from the prior migration
-- (same table, taken same day) — not re-backed-up here.

-- ----------------------------------------------------------------
-- MIGRATION
-- ----------------------------------------------------------------
BEGIN;
UPDATE clubs SET features = features || '{"parent_language": true}'::jsonb WHERE slug = 'bluefin';
COMMIT;

-- ----------------------------------------------------------------
-- ROLLBACK
-- ----------------------------------------------------------------
-- UPDATE clubs SET features = features || '{"parent_language": false}'::jsonb WHERE slug = 'bluefin';

-- ----------------------------------------------------------------
-- VERIFY
-- ----------------------------------------------------------------
-- SELECT features->'parent_language' FROM clubs WHERE slug='bluefin'; -- expect: true
