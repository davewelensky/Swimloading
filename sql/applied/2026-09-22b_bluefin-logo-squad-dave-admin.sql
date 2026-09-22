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
    RAISE EXCEPTION 'WRONG PROJECT — MIGRATION ABORTED';
  END IF;
  RAISE NOTICE 'Project identity confirmed: swimloading';
END $$;

-- ================================================================
-- Migration: 2026-09-22b_bluefin-logo-squad-dave-admin.sql
-- Process:   see MIGRATIONS.md — no section below may be left empty
-- ================================================================

-- Purpose:
--   Continue Blue Fin Swim Club onboarding (follows
--   2026-09-22_onboard-bluefin-club.sql): set logo_url/description on the
--   club record, create its one real squad (Masters Squad) with the
--   confirmed weekly sessions, and add Dave as a club_admins admin —
--   Dave's standing rule is that he always needs admin access to any
--   club that gets built, same as DUC/Aquasharks/K8.

-- Requested by:
--   Dave — "lets proceed with their logo etc and do as much as possible,
--   lets build what we know now" + "I always need access to whatever I build"

-- ----------------------------------------------------------------
-- PRE-CHECKS — run on the READ-ONLY connection BEFORE applying.
-- Must include affected-row counts for any UPDATE/DELETE.
-- ----------------------------------------------------------------
-- Already run read-only:
--   SELECT id FROM public.clubs WHERE slug = 'bluefin';
--     -> 65e64481-8eae-451f-868d-4505a0059b70 (1 row — from the prior migration)
--   SELECT id, email FROM public.profiles WHERE email = 'dave.welensky@gmail.com';
--     -> df137255-3add-4153-b368-32e06e2be188
--   SELECT c.slug, ca.role FROM club_admins ca JOIN clubs c ON c.id=ca.club_id
--     WHERE ca.user_id = 'df137255-3add-4153-b368-32e06e2be188';
--     -> only aqua-sharks-atlantic today, despite CLAUDE.md/memory claiming
--        all three — that memory is stale, not something this migration
--        fixes (flagging separately, not touching duc/k8-coaching here).
-- The UPDATE below touches exactly 1 row (the bluefin clubs row, matched
-- by slug, already confirmed unique). Both INSERTs are net-new rows.

-- ----------------------------------------------------------------
-- BACKUP — required before any DELETE / UPDATE / DROP / TRUNCATE.
-- ----------------------------------------------------------------
CREATE TABLE _bak_20260922_clubs_bluefin AS
  SELECT * FROM clubs WHERE slug = 'bluefin';

-- ----------------------------------------------------------------
-- MIGRATION — applied only after Dave types "apply".
-- ----------------------------------------------------------------
BEGIN;

UPDATE clubs
SET
  logo_url = '/icons/bluefin-logo.png',
  description = 'Blue Fin Swim Club is a Masters lane and bay swim club based at Reddam House Constantia, Cape Town. Squad sessions run Monday, Wednesday and Friday mornings in the pool, with open water swimming at Fish Hoek, Glencairn or Simon''s Town on Tuesdays. The club also runs a 16-week Robben Island training programme and trains members toward events including the Langebaan Express.'
WHERE slug = 'bluefin';

INSERT INTO club_admins (club_id, user_id, role)
VALUES (
  (SELECT id FROM clubs WHERE slug = 'bluefin'),
  'df137255-3add-4153-b368-32e06e2be188',  -- Dave Welensky
  'admin'
)
ON CONFLICT DO NOTHING;

WITH new_squad AS (
  INSERT INTO club_squads (club_id, name, type, sort_order, is_active)
  VALUES (
    (SELECT id FROM clubs WHERE slug = 'bluefin'),
    'Masters Squad',
    'masters',
    1,
    true
  )
  RETURNING id
)
INSERT INTO club_squad_sessions (squad_id, day_of_week, start_time, end_time, coach_name, notes, is_active)
SELECT id, 1, '07:45'::time, '08:45'::time, 'Tracey Steyn', 'Pool — Reddam House Constantia', true FROM new_squad
UNION ALL
SELECT id, 3, '07:45'::time, '08:45'::time, 'Tracey Steyn', 'Pool — Reddam House Constantia', true FROM new_squad
UNION ALL
SELECT id, 5, '07:45'::time, '08:45'::time, 'Tracey Steyn', 'Pool — Reddam House Constantia', true FROM new_squad
UNION ALL
SELECT id, 2, '07:00'::time, '08:00'::time, 'Tracey Steyn', 'Open water — Fish Hoek / Glencairn / Simon''s Town, weather dependent, WhatsApp coordinated', true FROM new_squad;

COMMIT;

-- ----------------------------------------------------------------
-- ROLLBACK — exact SQL to undo, or state:
-- "irreversible — restore from _bak_YYYYMMDD_tablename"
-- ----------------------------------------------------------------
-- DELETE FROM club_squad_sessions WHERE squad_id IN
--   (SELECT id FROM club_squads WHERE club_id = (SELECT id FROM clubs WHERE slug='bluefin') AND name='Masters Squad');
-- DELETE FROM club_squads WHERE club_id = (SELECT id FROM clubs WHERE slug='bluefin') AND name='Masters Squad';
-- DELETE FROM club_admins WHERE club_id = (SELECT id FROM clubs WHERE slug='bluefin')
--   AND user_id = 'df137255-3add-4153-b368-32e06e2be188';
-- UPDATE clubs SET logo_url = NULL, description = NULL WHERE slug = 'bluefin';
--   (or restore full row from _bak_20260922_clubs_bluefin)

-- ----------------------------------------------------------------
-- VERIFY — run on the READ-ONLY connection AFTER applying.
-- State the expected result next to each query.
-- ----------------------------------------------------------------
-- SELECT logo_url, description FROM clubs WHERE slug = 'bluefin';
--   -- expect: logo_url = '/icons/bluefin-logo.png', description populated
-- SELECT c.slug, ca.role, p.full_name FROM club_admins ca
--   JOIN clubs c ON c.id = ca.club_id JOIN profiles p ON p.id = ca.user_id
--   WHERE c.slug = 'bluefin' ORDER BY p.full_name;
--   -- expect: 2 rows — Dave Welensky (admin), Tracey Steyn (admin)
-- SELECT s.name, s.type, sess.day_of_week, sess.start_time, sess.end_time, sess.coach_name
--   FROM club_squads s JOIN club_squad_sessions sess ON sess.squad_id = s.id
--   WHERE s.club_id = (SELECT id FROM clubs WHERE slug = 'bluefin')
--   ORDER BY sess.day_of_week;
--   -- expect: 4 rows, Masters Squad, days 1/2/3/5, matching the schedule above
