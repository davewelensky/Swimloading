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
-- Migration: 2026-08-26_fix-k8-merge-account-links.sql
-- Process:   see MIGRATIONS.md
-- ================================================================

-- Purpose:
--   2026-08-26_migrate-k8-swimmers-to-aquasharks.sql moved club_roster
--   and club_sessions from K8 to Aquasharks, but missed club_members —
--   the table that actually controls a swimmer's live app access.
--   Found while building the swimmer-facing CSS tab.
--
--   IMPORTANT CORRECTION from the first pass of this investigation:
--   club_roster.user_id is NOT a reliable signal of account/access state
--   — club_members.roster_id is the real source of truth, and the two
--   can disagree (some roster rows have user_id set with no matching
--   club_members row at all; that's harmless, the join flow doesn't
--   read club_roster.user_id either). Redone directly from club_members:
--
--     63  no club_members row at all for their roster_id -> send the
--          join link (no fix needed here — the existing
--          redeem_club_join_code() RPC matches by roster_id, not by
--          club_roster.user_id, so this just works)
--     37  club_members row still points at dormant K8            -> re-link
--      8  DUPLICATE PEOPLE — already an existing, separate Aquasharks
--          Senior Squad member; K8 held a second copy of the same
--          person (exact full-name match, confirmed by Dave/Britt
--          26 Aug 2026): Sophia Wener, Italia Pugliese, Liam Brownlee,
--          Jenson Smith, Leon Walther Kotze, Noah Arelisky, Emma
--          Brownlee, Teagan Thompson             -> retire the K8-origin
--          duplicate roster row (both were already "Senior Squad", so
--          nothing to merge squad-wise — their real, original
--          Aquasharks roster row already has everything). 6 of these 8
--          also have a stale K8 club_members row to deactivate; the
--          other 2 never had one.
--
--   37 + 8 + 63 = 108, matches the full migrated roster count.

-- Requested by:
--   Dave, relaying Britt — confirmed the 8 duplicate names 26 Aug 2026

-- ----------------------------------------------------------------
-- PRE-CHECKS — run on the READ-ONLY connection BEFORE applying.
-- ----------------------------------------------------------------
-- Aquasharks club_members.member_number max is 118 (numeric-only values) —
-- the 37 re-linked rows get renumbered 119-155 to avoid colliding with it.

-- ----------------------------------------------------------------
-- BACKUP — required before any DELETE / UPDATE / DROP / TRUNCATE.
-- ----------------------------------------------------------------
CREATE TABLE _bak_20260826_club_members_k8merge AS
SELECT * FROM club_members
WHERE roster_id IN (
  -- 37 stale-K8-only
  '40925da5-0d7b-4c19-ac95-92215aa96665','733ba2fc-c68c-4f0d-a72f-948999310470',
  '735fac44-c383-404d-88c3-007444ba8805','405c523b-1a92-438e-889d-5721645702fd',
  '982d7687-2478-4b9a-8fae-f888a18d1da4','e3344a1b-b301-4767-9321-3eaa9ca64a5b',
  '00aeabbf-cca3-4686-9e3f-878639a79dfe','b9b4c551-0bcb-4774-9819-0c2bc55d07db',
  'da35aa0b-2c4f-4f41-9eda-dde904c7fc0a','ab6a8257-4fa8-4432-a248-3637a0ca490b',
  'b52b821f-65be-4b68-a828-19b11252fb99','fc5a2945-bd12-4c8e-9296-5bbb58f4e485',
  '54d9e654-75da-4511-baa8-8f0a571ac033','9b81d938-f643-4778-9292-b139a8e258b8',
  '386d6600-1fce-45ec-9a10-172686e89caf','336da735-a764-413e-8b92-204da3e1fde0',
  '5bae034b-b138-489f-92ac-2c52efd20f03','c2e38e06-015f-4ead-aaa0-28b1f5023564',
  'd294ec5f-c12e-4c87-82d4-4af6b37b0306','6e6ff183-a8ea-4ee1-bf5d-8ba2143f2d69',
  '5e83d13b-3c39-4407-ab38-6e972562febe','fd11e59a-9a85-4d0d-afa2-291a08a4c744',
  'ab7b716d-9bb2-44f5-a405-ac8c89371e9a','9d0dea9f-9df2-4f01-ad1c-b95a85e15f00',
  '99b0e7c7-a5a4-4b81-ae41-99f0d97681ff','0ce341a8-10c1-43dd-990b-e78a00cfe6be',
  'a5374d65-b66a-465b-a6fe-c2d42d190d1b','5ea46d7d-3678-4add-bf5c-565c4ed39d27',
  '61079528-7c17-4fb9-901d-98b71ebedb0a','2d457dfc-49a4-42e5-b403-fe86f531e3c0',
  'b338b929-67d1-4169-a6b8-901bf3ed4c21','793b5cde-059a-4524-8295-74d10d2d2c1c',
  'e8b78757-91a8-415d-a530-683846b04336','633ece27-6882-4b74-bf85-563aa7c1bd5c',
  '829f4c2a-a95d-49ca-bdb9-d9c88fbae9f4','755e6c02-0e0a-43d9-b023-adb3c7ea9f3e',
  '5eabfa90-c69e-4abf-9e6c-982483ff77d6',
  -- 6 duplicate-with-stale-K8-link
  '4406395b-3b67-4f87-9ba4-ada80cd644da','c025915b-bac2-46aa-abdd-b95c44d6f0ef',
  'feca8bcc-e59a-42ba-b8e0-1641f1e06e47','65a49df3-445b-4961-b020-eef1401bc999',
  'e796bc4e-445d-47f1-9b42-70b8858a6e97','5404d00b-6284-4181-9034-fbb8ddc87e44'
);

CREATE TABLE _bak_20260826_club_roster_dupes AS
SELECT * FROM club_roster WHERE id IN (
  '4406395b-3b67-4f87-9ba4-ada80cd644da','c025915b-bac2-46aa-abdd-b95c44d6f0ef',
  'feca8bcc-e59a-42ba-b8e0-1641f1e06e47','65a49df3-445b-4961-b020-eef1401bc999',
  'e796bc4e-445d-47f1-9b42-70b8858a6e97','5404d00b-6284-4181-9034-fbb8ddc87e44',
  '1bd88525-606f-408f-8133-5ccabebc181c','c0248d25-ef07-4897-ab6c-853b940d2b11'
);

-- ----------------------------------------------------------------
-- MIGRATION — applied only after Dave types "apply".
-- ----------------------------------------------------------------
BEGIN;

-- A) Re-link the 37 accounts still pointing at dormant K8, renumbered to
--    avoid colliding with Aquasharks' existing club_members.member_number.
WITH ids AS (
  SELECT unnest(ARRAY[
    '40925da5-0d7b-4c19-ac95-92215aa96665','733ba2fc-c68c-4f0d-a72f-948999310470',
    '735fac44-c383-404d-88c3-007444ba8805','405c523b-1a92-438e-889d-5721645702fd',
    '982d7687-2478-4b9a-8fae-f888a18d1da4','e3344a1b-b301-4767-9321-3eaa9ca64a5b',
    '00aeabbf-cca3-4686-9e3f-878639a79dfe','b9b4c551-0bcb-4774-9819-0c2bc55d07db',
    'da35aa0b-2c4f-4f41-9eda-dde904c7fc0a','ab6a8257-4fa8-4432-a248-3637a0ca490b',
    'b52b821f-65be-4b68-a828-19b11252fb99','fc5a2945-bd12-4c8e-9296-5bbb58f4e485',
    '54d9e654-75da-4511-baa8-8f0a571ac033','9b81d938-f643-4778-9292-b139a8e258b8',
    '386d6600-1fce-45ec-9a10-172686e89caf','336da735-a764-413e-8b92-204da3e1fde0',
    '5bae034b-b138-489f-92ac-2c52efd20f03','c2e38e06-015f-4ead-aaa0-28b1f5023564',
    'd294ec5f-c12e-4c87-82d4-4af6b37b0306','6e6ff183-a8ea-4ee1-bf5d-8ba2143f2d69',
    '5e83d13b-3c39-4407-ab38-6e972562febe','fd11e59a-9a85-4d0d-afa2-291a08a4c744',
    'ab7b716d-9bb2-44f5-a405-ac8c89371e9a','9d0dea9f-9df2-4f01-ad1c-b95a85e15f00',
    '99b0e7c7-a5a4-4b81-ae41-99f0d97681ff','0ce341a8-10c1-43dd-990b-e78a00cfe6be',
    'a5374d65-b66a-465b-a6fe-c2d42d190d1b','5ea46d7d-3678-4add-bf5c-565c4ed39d27',
    '61079528-7c17-4fb9-901d-98b71ebedb0a','2d457dfc-49a4-42e5-b403-fe86f531e3c0',
    'b338b929-67d1-4169-a6b8-901bf3ed4c21','793b5cde-059a-4524-8295-74d10d2d2c1c',
    'e8b78757-91a8-415d-a530-683846b04336','633ece27-6882-4b74-bf85-563aa7c1bd5c',
    '829f4c2a-a95d-49ca-bdb9-d9c88fbae9f4','755e6c02-0e0a-43d9-b023-adb3c7ea9f3e',
    '5eabfa90-c69e-4abf-9e6c-982483ff77d6'
  ]::uuid[]) AS roster_id
),
renumbered AS (
  SELECT roster_id, 118 + row_number() OVER (ORDER BY roster_id) AS new_num FROM ids
)
UPDATE club_members cm
SET club_id = '385e2c9d-b32e-47d1-bb1d-1e042523de23'::uuid,
    member_number = renumbered.new_num::text
FROM renumbered
WHERE cm.roster_id = renumbered.roster_id
  AND cm.club_id = 'de64faab-c3d2-4997-a6bb-904ab989650c'::uuid
  AND cm.is_active = true;

-- B) Retire the 8 confirmed-duplicate K8-origin roster rows — the same
--    real person already exists under their original Aquasharks roster_id.
UPDATE club_roster SET is_active = false
WHERE id IN (
  '4406395b-3b67-4f87-9ba4-ada80cd644da','c025915b-bac2-46aa-abdd-b95c44d6f0ef',
  'feca8bcc-e59a-42ba-b8e0-1641f1e06e47','65a49df3-445b-4961-b020-eef1401bc999',
  'e796bc4e-445d-47f1-9b42-70b8858a6e97','5404d00b-6284-4181-9034-fbb8ddc87e44',
  '1bd88525-606f-408f-8133-5ccabebc181c','c0248d25-ef07-4897-ab6c-853b940d2b11'
);

-- Clean up the 6 stale K8-side club_members rows belonging to those duplicates
-- (the other 2 duplicates never had a K8 club_members row to begin with).
UPDATE club_members SET is_active = false
WHERE club_id = 'de64faab-c3d2-4997-a6bb-904ab989650c'::uuid
  AND roster_id IN (
    '4406395b-3b67-4f87-9ba4-ada80cd644da','c025915b-bac2-46aa-abdd-b95c44d6f0ef',
    'feca8bcc-e59a-42ba-b8e0-1641f1e06e47','65a49df3-445b-4961-b020-eef1401bc999',
    'e796bc4e-445d-47f1-9b42-70b8858a6e97','5404d00b-6284-4181-9034-fbb8ddc87e44'
  );

COMMIT;

-- ----------------------------------------------------------------
-- ROLLBACK
-- ----------------------------------------------------------------
-- UPDATE club_members cm SET club_id = bak.club_id, member_number = bak.member_number, is_active = bak.is_active
--   FROM _bak_20260826_club_members_k8merge bak WHERE cm.id = bak.id;
-- UPDATE club_roster r SET is_active = bak.is_active
--   FROM _bak_20260826_club_roster_dupes bak WHERE r.id = bak.id;

-- ----------------------------------------------------------------
-- VERIFY — run on the READ-ONLY connection AFTER applying.
-- ----------------------------------------------------------------
-- SELECT count(*) FROM club_members WHERE roster_id IN (<37 ids above>) AND club_id = '385e2c9d-b32e-47d1-bb1d-1e042523de23';
-- -- expect: 37
-- SELECT count(*) FROM club_roster WHERE is_active = true AND id IN (<8 duplicate ids>);
-- -- expect: 0
-- SELECT count(*) FROM club_members WHERE club_id = 'de64faab-c3d2-4997-a6bb-904ab989650c' AND is_active = true;
-- -- expect: 2 (K8's own coach/admin-type club_members rows, role='member' roster_id=null —
-- --            unrelated to the 108 migrated swimmers, not touched by this migration)
