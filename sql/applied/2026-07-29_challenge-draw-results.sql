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
-- Migration: 2026-07-29_challenge-draw-results.sql
-- Process:   see MIGRATIONS.md — no section below may be left empty
-- ================================================================

-- Purpose:
--   New table to store the OUTPUT of scripts/draw-monthly-winner.mjs
--   (the existing, separately-built challenge draw script — its
--   random-selection algorithm is NOT touched by this migration).
--   This is the integration contract table: the newsletter/admin UI
--   must only ever read an approved row here, never the script's raw
--   console output, per the "no winner before admin approval" rule.

-- Requested by:
--   Dave — July 2026 challenge winner + newsletter integration

-- ----------------------------------------------------------------
-- PRE-CHECKS — run on the READ-ONLY connection BEFORE applying.
-- Must include affected-row counts for any UPDATE/DELETE.
-- ----------------------------------------------------------------
-- SELECT to_regclass('public.challenge_draw_results');
-- -- expect: NULL (table does not exist yet)

-- ----------------------------------------------------------------
-- BACKUP — required before any DELETE / UPDATE / DROP / TRUNCATE.
-- ----------------------------------------------------------------
-- Not required — new table, no existing data touched.

-- ----------------------------------------------------------------
-- MIGRATION — applied only after Dave types "apply".
-- ----------------------------------------------------------------
BEGIN;

CREATE TABLE IF NOT EXISTS challenge_draw_results (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  challenge_id              text NOT NULL,           -- e.g. '2026-07' (SAST month key, matches june_challenge_config window)
  challenge_name            text NOT NULL,            -- e.g. 'July 2026 — Blu Smooth MK2 Comp wetsuit'
  winner_user_id            uuid REFERENCES profiles(id),
  winner_display_name       text,
  winning_ticket_id         text,                     -- winning ticket index within the pool, as text (script prints 0-indexed ticket number)
  winning_entry_type        text DEFAULT 'draw_entry',
  winning_entry_description text,                     -- human-readable, e.g. "Ticket #14 of 33 (10 temp logs = 1 ticket)"
  participant_count         integer NOT NULL,
  ticket_count              integer NOT NULL,
  raw_ticket_breakdown      jsonb,                    -- full entrant/ticket-range audit list from the script, for transparency
  drawn_at                  timestamptz NOT NULL DEFAULT now(),
  approved_at               timestamptz,              -- NULL = not yet approved; newsletter must treat as pending
  approved_by               uuid REFERENCES profiles(id),
  ineligible                boolean NOT NULL DEFAULT false,
  ineligible_reason         text,
  replacement_for           uuid REFERENCES challenge_draw_results(id), -- set when this row is a runner-up promoted after the original winner declined/was disqualified
  created_at                timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_challenge_draw_results_challenge_id ON challenge_draw_results(challenge_id);

ALTER TABLE challenge_draw_results ENABLE ROW LEVEL SECURITY;

-- Admin-only read (contains a real prize winner's identity ahead of public announcement)
CREATE POLICY "admin_read_challenge_draw_results" ON challenge_draw_results
  FOR SELECT USING (auth.email() = 'dave.welensky@gmail.com');

-- Admin-only update (the only client-side write path is the Approve action in admin.html;
-- the draw script itself inserts via the service-role key, which bypasses RLS entirely)
CREATE POLICY "admin_update_challenge_draw_results" ON challenge_draw_results
  FOR UPDATE USING (auth.email() = 'dave.welensky@gmail.com')
  WITH CHECK (auth.email() = 'dave.welensky@gmail.com');

COMMIT;

-- ----------------------------------------------------------------
-- ROLLBACK — exact SQL to undo, or state:
-- "irreversible — restore from _bak_YYYYMMDD_tablename"
-- ----------------------------------------------------------------
-- DROP TABLE IF EXISTS challenge_draw_results;

-- ----------------------------------------------------------------
-- VERIFY — run on the READ-ONLY connection AFTER applying.
-- State the expected result next to each query.
-- ----------------------------------------------------------------
-- SELECT to_regclass('public.challenge_draw_results');
-- -- expect: 'challenge_draw_results'
-- SELECT policyname FROM pg_policies WHERE tablename = 'challenge_draw_results';
-- -- expect: admin_read_challenge_draw_results, admin_update_challenge_draw_results
