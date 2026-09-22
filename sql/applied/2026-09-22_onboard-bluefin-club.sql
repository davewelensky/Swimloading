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
-- Migration: 2026-09-22_onboard-bluefin-club.sql
-- Process:   see MIGRATIONS.md — no section below may be left empty
-- ================================================================

-- Purpose:
--   Onboard Blue Fin Swim Club (Cape Town Masters lane/bay club) as a new
--   SwimLoading club — CLUB_ONBOARDING.md Steps 1-3 (club record, feature
--   flags, admin account for Tracey Steyn). Steps 4+ (roster import, squad
--   setup, guide page) stay blocked on still-outstanding member/kid data —
--   see project-bluefin-onboarding.md memory for full context.

-- Requested by:
--   Dave — club type/flags confirmed 22 Sep 2026 ("go with that")

-- NOTE ON SCHEMA: CLUB_ONBOARDING.md's Step 0-2 SQL templates are stale —
-- the actual clubs table uses `club_type` (not `type`), and carries extra
-- columns (`website`, `description`, `training_schedule` jsonb) the doc
-- doesn't mention. This migration is written against the real, verified
-- schema (checked via information_schema before writing this file), not
-- copied from the doc. Worth fixing CLUB_ONBOARDING.md separately.

-- ----------------------------------------------------------------
-- PRE-CHECKS — run on the READ-ONLY connection BEFORE applying.
-- Must include affected-row counts for any UPDATE/DELETE.
-- ----------------------------------------------------------------
-- Already run read-only, results below (no live re-run needed unless stale):
--   SELECT id, code, slug, name FROM public.clubs;
--     -> only duc / aqua-sharks-atlantic / k8-coaching exist. No 'bluefin'
--        slug or 'BLUEFIN' code collision.
--   SELECT id, email, full_name FROM public.profiles WHERE email ILIKE '%tracey%';
--     -> Tracey Steyn, traceysteyn@gmail.com, id f39ec11b-f328-44fe-bd4c-767b0f3a99e0,
--        account created 2026-02-16. This is her personal SwimLoading login,
--        NOT her tracey@bluefinclub.co.za club email (that address has no
--        SwimLoading account).
--   SELECT code FROM public.domains WHERE code = 'FALSE_BAY';
--     -> exists (Bluefin's open-water base: Fish Hoek / Glencairn / Simon's Town).
-- This is a pure-INSERT migration (0 existing rows touched) — no UPDATE/DELETE
-- affected-row count applies.

-- ----------------------------------------------------------------
-- BACKUP — required before any DELETE / UPDATE / DROP / TRUNCATE.
-- ----------------------------------------------------------------
-- Not applicable — INSERT only, nothing existing is modified or removed.

-- ----------------------------------------------------------------
-- MIGRATION — applied only after Dave types "apply".
-- ----------------------------------------------------------------
BEGIN;

INSERT INTO clubs (
  code, slug, name, country, city, founded_year,
  tagline, contact_email, website, domain, is_active, club_type,
  features, training_schedule
)
VALUES (
  'BLUEFIN',
  'bluefin',
  'Blue Fin Swim Club',
  'ZA',
  'Cape Town',
  NULL,                                          -- founded_year unknown, not guessed
  'Masters Lane and Bay Swim Club',               -- from bluefinclub.co.za's own site copy
  'tracey@bluefinclub.co.za',                     -- ASSUMPTION: Tracey as primary club contact — confirm/adjust
  'https://bluefinclub.co.za',
  'FALSE_BAY',
  true,
  'swim_club',
  '{
    "health":           true,
    "league":           false,
    "squads":           true,
    "timetable":        true,
    "attendance":       true,
    "challenges":       false,
    "gala_entries":     false,
    "coaching_staff":   true,
    "temp_challenge":   false,
    "parent_language":  false
  }'::jsonb,
  '[
    {"day": 1, "start": "07:45", "end": "08:45", "type": "squad",  "label": "Pool Squad",       "arrive_by": "07:35", "squads": []},
    {"day": 3, "start": "07:45", "end": "08:45", "type": "squad",  "label": "Pool Squad",       "arrive_by": "07:35", "squads": []},
    {"day": 5, "start": "07:45", "end": "08:45", "type": "squad",  "label": "Pool Squad",       "arrive_by": "07:35", "squads": []},
    {"day": 2, "start": "07:00", "end": "08:00", "type": "masters","label": "Open Water",       "note": "Fish Hoek / Glencairn / Simon's Town — weather dependent, WhatsApp coordinated"},
    {"day": 2, "start": "07:45", "end": "08:45", "type": "other",  "label": "Stroke Correction", "note": "Booking essential, max 5 swimmers"}
  ]'::jsonb
)
ON CONFLICT (code) DO NOTHING;

INSERT INTO club_admins (club_id, user_id, role)
VALUES (
  (SELECT id FROM clubs WHERE slug = 'bluefin'),
  'f39ec11b-f328-44fe-bd4c-767b0f3a99e0',  -- Tracey Steyn, traceysteyn@gmail.com
  'admin'
)
ON CONFLICT DO NOTHING;

COMMIT;

-- ----------------------------------------------------------------
-- ROLLBACK — exact SQL to undo, or state:
-- "irreversible — restore from _bak_YYYYMMDD_tablename"
-- ----------------------------------------------------------------
-- DELETE FROM club_admins WHERE club_id = (SELECT id FROM clubs WHERE slug = 'bluefin')
--   AND user_id = 'f39ec11b-f328-44fe-bd4c-767b0f3a99e0';
-- DELETE FROM clubs WHERE slug = 'bluefin';
-- (Safe to fully reverse — no existing data was touched, only new rows added.)

-- ----------------------------------------------------------------
-- VERIFY — run on the READ-ONLY connection AFTER applying.
-- State the expected result next to each query.
-- ----------------------------------------------------------------
-- SELECT id, slug, name, club_type, features FROM clubs WHERE slug = 'bluefin';
--   -- expect: 1 row, club_type = 'swim_club', features matching the block above
-- SELECT ca.role, p.full_name, p.email FROM club_admins ca
--   JOIN profiles p ON p.id = ca.user_id
--   WHERE ca.club_id = (SELECT id FROM clubs WHERE slug = 'bluefin');
--   -- expect: 1 row, Tracey Steyn, role = 'admin'
