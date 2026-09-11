-- ================================================================
-- Migration: 2026-09-11_merge-quiz-duplicate-accounts.sql
-- Process:   see MIGRATIONS.md
-- ================================================================

-- Purpose:
--   Three existing members created duplicate accounts via the quiz fast-lane
--   signup on 10 Sep (different email, so the duplicate check passed):
--     Heather Bougard  keep ee1fcb82… (hcbougard@gmail.com, Mar 2026)   drop dcb288a9… (hbougard@iafrica.com)
--     Kim Hawke        keep 579b6c18… (hello@kimhawke.com, Mar 2026)    drop a1f6f944… (kimhawke@mweb.co.za)
--     Tracey Steyn     keep f39ec11b… (traceysteyn@gmail.com, Feb 2026) drop 05c37f42… (tracey@nomadmarketing.co.za)
--   Their quiz results (incl. Tracey's winning 70) move to the kept account,
--   then the duplicate profile + auth user is deleted.
--   Nicholas Horwood EXCLUDED — his "duplicate" is aimsthorne@gmail.com,
--   which may be a different person; Dave to confirm before touching it.
--   Full FK sweep (90 referencing columns, run 11 Sep): the duplicate ids
--   appear ONLY in live_quiz_participants (3), analytics_events (8),
--   activity_audit (2). No temp_logs, club, Strava or challenge data.

-- Requested by:
--   Dave ("clean up the duplicates ... we drop the new accounts", 11 Sep 2026)

-- ----------------------------------------------------------------
-- PRE-CHECKS — run on the READ-ONLY connection BEFORE applying.
-- ----------------------------------------------------------------
-- SELECT count(*) FROM live_quiz_participants WHERE user_id IN
--   ('f39ec11b-f328-44fe-bd4c-767b0f3a99e0','579b6c18-aded-482b-8e7d-7c2695302b98','ee1fcb82-0ced-495e-ad01-678ded301183');
--   -- expect 0 (kept accounts did not also play — unique constraint safe)

-- ----------------------------------------------------------------
-- BACKUP
-- ----------------------------------------------------------------
-- CREATE TABLE _bak_20260911_dup_profiles AS SELECT * FROM profiles
--   WHERE id IN ('dcb288a9-e8b6-4fcf-8f57-2432aa1cf0d6','a1f6f944-b2b6-4ef9-b554-fd9c20608ab6','05c37f42-aa36-483c-9c76-e85e5fb6add7');
-- CREATE TABLE _bak_20260911_dup_lqp AS SELECT * FROM live_quiz_participants
--   WHERE user_id IN ('dcb288a9-e8b6-4fcf-8f57-2432aa1cf0d6','a1f6f944-b2b6-4ef9-b554-fd9c20608ab6','05c37f42-aa36-483c-9c76-e85e5fb6add7');

-- ----------------------------------------------------------------
-- MIGRATION — applied only after Dave types "apply".
-- ----------------------------------------------------------------
BEGIN;

CREATE TABLE _bak_20260911_dup_profiles AS SELECT * FROM profiles
  WHERE id IN ('dcb288a9-e8b6-4fcf-8f57-2432aa1cf0d6','a1f6f944-b2b6-4ef9-b554-fd9c20608ab6','05c37f42-aa36-483c-9c76-e85e5fb6add7');
CREATE TABLE _bak_20260911_dup_lqp AS SELECT * FROM live_quiz_participants
  WHERE user_id IN ('dcb288a9-e8b6-4fcf-8f57-2432aa1cf0d6','a1f6f944-b2b6-4ef9-b554-fd9c20608ab6','05c37f42-aa36-483c-9c76-e85e5fb6add7');

-- move quiz results, analytics and audit rows to the kept accounts (dup -> kept)
UPDATE live_quiz_participants SET user_id = 'ee1fcb82-0ced-495e-ad01-678ded301183' WHERE user_id = 'dcb288a9-e8b6-4fcf-8f57-2432aa1cf0d6'; -- Heather, 1 row
UPDATE live_quiz_participants SET user_id = '579b6c18-aded-482b-8e7d-7c2695302b98' WHERE user_id = 'a1f6f944-b2b6-4ef9-b554-fd9c20608ab6'; -- Kim, 1 row
UPDATE live_quiz_participants SET user_id = 'f39ec11b-f328-44fe-bd4c-767b0f3a99e0' WHERE user_id = '05c37f42-aa36-483c-9c76-e85e5fb6add7'; -- Tracey (the winner), 1 row
UPDATE analytics_events SET user_id = 'ee1fcb82-0ced-495e-ad01-678ded301183' WHERE user_id = 'dcb288a9-e8b6-4fcf-8f57-2432aa1cf0d6';
UPDATE analytics_events SET user_id = '579b6c18-aded-482b-8e7d-7c2695302b98' WHERE user_id = 'a1f6f944-b2b6-4ef9-b554-fd9c20608ab6';
UPDATE analytics_events SET user_id = 'f39ec11b-f328-44fe-bd4c-767b0f3a99e0' WHERE user_id = '05c37f42-aa36-483c-9c76-e85e5fb6add7';
UPDATE activity_audit SET user_id = 'ee1fcb82-0ced-495e-ad01-678ded301183' WHERE user_id = 'dcb288a9-e8b6-4fcf-8f57-2432aa1cf0d6';
UPDATE activity_audit SET user_id = '579b6c18-aded-482b-8e7d-7c2695302b98' WHERE user_id = 'a1f6f944-b2b6-4ef9-b554-fd9c20608ab6';
UPDATE activity_audit SET user_id = 'f39ec11b-f328-44fe-bd4c-767b0f3a99e0' WHERE user_id = '05c37f42-aa36-483c-9c76-e85e5fb6add7';

-- drop the duplicate accounts (10 Sep fast-lane signups, now empty of data)
DELETE FROM profiles   WHERE id IN ('dcb288a9-e8b6-4fcf-8f57-2432aa1cf0d6','a1f6f944-b2b6-4ef9-b554-fd9c20608ab6','05c37f42-aa36-483c-9c76-e85e5fb6add7');
DELETE FROM auth.users WHERE id IN ('dcb288a9-e8b6-4fcf-8f57-2432aa1cf0d6','a1f6f944-b2b6-4ef9-b554-fd9c20608ab6','05c37f42-aa36-483c-9c76-e85e5fb6add7');

COMMIT;

-- ----------------------------------------------------------------
-- ROLLBACK
-- ----------------------------------------------------------------
-- Profiles + participants restorable from _bak_20260911_dup_profiles /
-- _bak_20260911_dup_lqp (re-point user_id back). The auth.users rows are
-- NOT restorable — the members would need to sign up again (acceptable:
-- 1-day-old duplicates; their kept accounts are untouched).

-- ----------------------------------------------------------------
-- VERIFY — read-only after applying
-- ----------------------------------------------------------------
-- SELECT p.email, lp.total_score, lp.answered_count FROM live_quiz_participants lp
--   JOIN profiles p ON p.id = lp.user_id WHERE lp.total_score = 70;
--   -- expect: traceysteyn@gmail.com 70/8 and cacmackenzie@yahoo.com 70/7
-- SELECT count(*) FROM profiles WHERE id IN ('dcb288a9-e8b6-4fcf-8f57-2432aa1cf0d6','a1f6f944-b2b6-4ef9-b554-fd9c20608ab6','05c37f42-aa36-483c-9c76-e85e5fb6add7'); -- expect 0
-- SELECT count(*) FROM live_quiz_participants; -- expect 77 (unchanged)
