-- ================================================================
-- SwimLoading — Migration Template
-- ================================================================

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
-- Migration: 2026-08-26_dedupe-senior-squad-june-import.sql
-- ================================================================

-- Purpose:
--   Teagan reported "some seniors are now duplicated" while everyone was
--   looking closely at the roster for the K8 merge — turned out to be
--   completely unrelated: 13 Senior Squad members were duplicated in a
--   bulk import glitch on 4 June 2026 (all 13 stray copies share the
--   exact same created_at timestamp, 2026-06-04 11:58:12.290083+00,
--   confirming one batch operation). Each original (11-12 May, real
--   attendance history, 9-47 marks) has a near-empty June 4 twin (0-1
--   marks). Confirmed via name-match sweep: Intermediate squad clean,
--   no separate "Dry Land" squad exists (it's a combined session, not
--   its own squad) — only Senior Squad affected.
--
--   Affected: Charlotte Hofinger, Daniel Terblanche, Ella Voysey,
--   Gabi Sa, Jasmine Goldman, Jesse Sandler, Louis Ludick, Michael
--   Goodall, Mikayla Wilensky, Patrick Maughan, Paul Hauser, Rebecca
--   Allderman, Yakira Goldman.

-- Requested by:
--   Dave, relaying Teagan, 26 Aug 2026.

-- ----------------------------------------------------------------
-- BACKUP (taken before applying)
-- ----------------------------------------------------------------
-- CREATE TABLE _bak_20260826_senior_squad_dupes AS SELECT * FROM club_roster WHERE id IN (...)

-- ----------------------------------------------------------------
-- MIGRATION (applied)
-- ----------------------------------------------------------------
-- UPDATE club_roster SET is_active = false WHERE id IN (
--   '7315f978-609f-4e44-bd46-4dadab85d734','af49843f-3bf7-4ec5-b017-d64accaf1b10',
--   '87001f24-1e38-4f2c-9fca-1ae7a23b5e2a','20846d1a-5ba7-49d9-9b64-850c0dd67e2c',
--   'aa12cf79-f625-41ef-b283-333c56b474d2','23b596ff-9dcd-42d1-ad28-d1aefcb929c7',
--   '1385ff3a-76e8-4189-b340-fad602025ea9','b3742c15-6319-423b-8378-3aabfee399c9',
--   'b4846ed6-b944-46a0-b0bf-86a6cd8cf205','847f8848-1f18-40ae-85b3-4539f2a36134',
--   'cfc4e422-c481-409a-8c01-6a1b4e6b4512','1795a68b-6d08-48fa-9a75-cdd5fe050735',
--   '1f51635c-137a-4a64-b65e-a959b3482ab9'
-- );

-- ----------------------------------------------------------------
-- ROLLBACK
-- ----------------------------------------------------------------
-- UPDATE club_roster r SET is_active = true FROM _bak_20260826_senior_squad_dupes b WHERE r.id = b.id;

-- ----------------------------------------------------------------
-- VERIFY (run after applying)
-- ----------------------------------------------------------------
-- Confirmed 0 remaining active duplicate names in Senior Squad.
