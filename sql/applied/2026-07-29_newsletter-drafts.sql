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
-- Migration: 2026-07-29_newsletter-drafts.sql
-- Process:   see MIGRATIONS.md — no section below may be left empty
-- ================================================================

-- Purpose:
--   Storage for the admin Newsletter Builder (Part 5-6 of the July
--   install/newsletter work): one row per newsletter draft, holding the
--   editable inputs, the live metrics snapshot used to build it (for
--   figure-reconciliation/audit), the generated HTML, and its
--   draft -> approved -> sent lifecycle. No automated bulk-send exists —
--   "sent" here just records that Dave pasted the HTML into Brevo himself
--   and confirmed it, per his explicit instruction.

-- Requested by:
--   Dave — July 2026 newsletter builder

-- ----------------------------------------------------------------
-- PRE-CHECKS — run on the READ-ONLY connection BEFORE applying.
-- Must include affected-row counts for any UPDATE/DELETE.
-- ----------------------------------------------------------------
-- SELECT to_regclass('public.newsletter_drafts');
-- -- expect: NULL (table does not exist yet)

-- ----------------------------------------------------------------
-- BACKUP — required before any DELETE / UPDATE / DROP / TRUNCATE.
-- ----------------------------------------------------------------
-- Not required — new table, no existing data touched.

-- ----------------------------------------------------------------
-- MIGRATION — applied only after Dave types "apply".
-- ----------------------------------------------------------------
BEGIN;

CREATE TABLE IF NOT EXISTS newsletter_drafts (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  month             text NOT NULL,               -- e.g. '2026-07'
  inputs            jsonb NOT NULL DEFAULT '{}', -- editable free-text fields (hero copy, closing note, etc.)
  metrics_snapshot  jsonb,                        -- computed metrics at generation time, for figure-reconciliation
  html              text,                         -- last-generated full newsletter HTML
  status            text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','approved','sent')),
  test_sent_at      timestamptz,
  approved_at       timestamptz,
  approved_by       uuid REFERENCES profiles(id),
  sent_at           timestamptz,
  recipient_count   integer,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_newsletter_drafts_month ON newsletter_drafts(month);

ALTER TABLE newsletter_drafts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin_all_newsletter_drafts" ON newsletter_drafts
  FOR ALL USING (auth.email() = 'dave.welensky@gmail.com')
  WITH CHECK (auth.email() = 'dave.welensky@gmail.com');

COMMIT;

-- ----------------------------------------------------------------
-- ROLLBACK — exact SQL to undo, or state:
-- "irreversible — restore from _bak_YYYYMMDD_tablename"
-- ----------------------------------------------------------------
-- DROP TABLE IF EXISTS newsletter_drafts;

-- ----------------------------------------------------------------
-- VERIFY — run on the READ-ONLY connection AFTER applying.
-- State the expected result next to each query.
-- ----------------------------------------------------------------
-- SELECT to_regclass('public.newsletter_drafts');
-- -- expect: 'newsletter_drafts'
