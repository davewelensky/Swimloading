-- ================================================================
-- SwimLoading — Migration Template
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
END $$;

-- ================================================================
-- Migration: 2026-08-26_migrate-k8-sets-to-aquasharks.sql
-- ================================================================

-- Purpose:
--   Britt: "Is there a way for my masters swim sets on planner to pull
--   through on app?" — same gap as club_members earlier today: the
--   original K8->Aquasharks merge (2026-08-26_migrate-k8-swimmers-to-
--   aquasharks.sql) moved club_roster/club_sessions but never touched
--   club_swim_sets (the Sets Planner library) or club_set_assignments
--   (the weekly calendar placements). Britt's ~2 months of K8 Masters
--   sets are invisible in Aquasharks' Sets Planner as a result.
--
--   23 club_swim_sets rows: 22 are general library entries (squad_id
--   null, no remap needed), 1 has squad_id = 06:00 Group.
--   24 club_set_assignments rows: 21 for 06:00 Group, and the first day
--   (8 June) covers all 3 groups on one set. All need squad_id remapped.
--
--   No collision risk: club_set_assignments has a UNIQUE(squad_id,
--   session_date, session_slot) constraint, but Aquasharks' 3 OW Masters
--   squads (created 21 Aug) never had any assignments before this.

-- Requested by:
--   Britt (Aquasharks), via Dave, 26 Aug 2026.

-- ----------------------------------------------------------------
-- BACKUP
-- ----------------------------------------------------------------
CREATE TABLE _bak_20260826_club_swim_sets_k8 AS
SELECT * FROM club_swim_sets WHERE club_id = 'de64faab-c3d2-4997-a6bb-904ab989650c';

CREATE TABLE _bak_20260826_club_set_assignments_k8 AS
SELECT * FROM club_set_assignments WHERE club_id = 'de64faab-c3d2-4997-a6bb-904ab989650c';

-- ----------------------------------------------------------------
-- MIGRATION — applied only after Dave types "apply".
-- ----------------------------------------------------------------
BEGIN;

UPDATE club_swim_sets
SET
  club_id = '385e2c9d-b32e-47d1-bb1d-1e042523de23'::uuid,
  squad_id = CASE squad_id
    WHEN '8e6e5a94-cfdb-4e8f-9b80-c4ee376a1565'::uuid THEN '993bf5d1-4980-4eaf-8b36-a68b434a6d09'::uuid
    WHEN 'f72db6ba-1f30-4c52-92cf-3c41fd1cf16d'::uuid THEN '5d78be26-cddc-46e8-9d97-69b1d90cb880'::uuid
    WHEN '552840c8-aa71-4c3b-a882-3cfb83f99a2e'::uuid THEN 'f807af8e-fb21-41a0-ad46-802da504a214'::uuid
    ELSE squad_id
  END
WHERE club_id = 'de64faab-c3d2-4997-a6bb-904ab989650c'::uuid;

UPDATE club_set_assignments
SET
  club_id = '385e2c9d-b32e-47d1-bb1d-1e042523de23'::uuid,
  squad_id = CASE squad_id
    WHEN '8e6e5a94-cfdb-4e8f-9b80-c4ee376a1565'::uuid THEN '993bf5d1-4980-4eaf-8b36-a68b434a6d09'::uuid
    WHEN 'f72db6ba-1f30-4c52-92cf-3c41fd1cf16d'::uuid THEN '5d78be26-cddc-46e8-9d97-69b1d90cb880'::uuid
    WHEN '552840c8-aa71-4c3b-a882-3cfb83f99a2e'::uuid THEN 'f807af8e-fb21-41a0-ad46-802da504a214'::uuid
    ELSE squad_id
  END
WHERE club_id = 'de64faab-c3d2-4997-a6bb-904ab989650c'::uuid;

COMMIT;

-- ----------------------------------------------------------------
-- ROLLBACK
-- ----------------------------------------------------------------
-- UPDATE club_swim_sets t SET club_id = b.club_id, squad_id = b.squad_id
--   FROM _bak_20260826_club_swim_sets_k8 b WHERE t.id = b.id;
-- UPDATE club_set_assignments t SET club_id = b.club_id, squad_id = b.squad_id
--   FROM _bak_20260826_club_set_assignments_k8 b WHERE t.id = b.id;

-- ----------------------------------------------------------------
-- VERIFY
-- ----------------------------------------------------------------
-- SELECT count(*) FROM club_swim_sets WHERE club_id = 'de64faab-c3d2-4997-a6bb-904ab989650c';
-- -- expect: 0
-- SELECT count(*) FROM club_set_assignments WHERE club_id = 'de64faab-c3d2-4997-a6bb-904ab989650c';
-- -- expect: 0
-- SELECT count(*) FROM club_swim_sets WHERE club_id = '385e2c9d-b32e-47d1-bb1d-1e042523de23' AND squad_id = '993bf5d1-4980-4eaf-8b36-a68b434a6d09';
-- -- expect: 1
-- SELECT count(*) FROM club_set_assignments WHERE club_id = '385e2c9d-b32e-47d1-bb1d-1e042523de23' AND squad_id = '993bf5d1-4980-4eaf-8b36-a68b434a6d09';
-- -- expect: 22 (21 own + the shared 8 June one)
