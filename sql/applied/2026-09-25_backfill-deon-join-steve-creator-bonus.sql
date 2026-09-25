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
-- Migration: 2026-09-25_backfill-deon-join-steve-creator-bonus.sql
-- Process:   see MIGRATIONS.md — no section below may be left empty
-- ================================================================

-- Purpose:
--   Record the September join points that the first-joiner-only bug (fixed in
--   2026-09-25_fix-join-swim-points-every-joiner.sql) silently dropped:
--     Deon Odendaal  joined "DUC League Swim" (recurring monthly, swim
--                    e71f9ce1-5b22-4c4e-a808-b3ebec19f24b) on 19 Sep 2026
--                    09:01 UTC, auto-approved -> join_swim, 20 pts
--     Steve Evans    creator of that swim -> creator_bonus for Deon's join,
--                    10 pts (Steve's 2nd on this swim; cap is 3)
--   Exactly what the fixed live code would have written at the time: same
--   tables, same point values (read from june_challenge_config), same ref_id
--   format ('<swim id>:<joiner id>'), timestamped at Deon's join, with
--   source = 'backfill' and a backfill tag in metadata so the rows are
--   identifiable and removable.
--
--   Leaderboard effect (get_challenge_leaders):
--     Deon  140 -> 160 pts; swims joined 0 -> 1. Draw entries stay 0 for now:
--           he has 8 of the 10 temp logs needed to qualify. If he reaches 10
--           by 30 Sep his entries are 2 (1 + this join) instead of 1.
--     Steve 10 -> 20 pts. Not in the draw (0 temp logs).

-- Requested by:
--   Dave, 25 Sep 2026 ("yes, backfill Deon and Steve")

-- ----------------------------------------------------------------
-- PRE-CHECKS — run on the READ-ONLY connection BEFORE applying.
-- Must include affected-row counts for any UPDATE/DELETE.
-- ----------------------------------------------------------------
-- INSERT only: 4 rows (2 challenge_points_audit + 2 june_challenge_events).
-- No UPDATE / DELETE. Dry-run results (25 Sep 2026):
--
-- P1. The join is real and approved:
-- SELECT status, requested_at FROM swim_participants
--  WHERE swim_event_id = 'e71f9ce1-5b22-4c4e-a808-b3ebec19f24b'
--    AND user_id = '6f712f66-90ba-4585-a688-93ccb1a9d994';
-- result: approved, 2026-09-19 09:01:51.0771+00 (auto-approve path; the
--         swim does not require approval, creator is Steve Evans)
--
-- P2. Nothing recorded yet for this join (so this can't double-award):
--   audit rows on this swim: Yalsha join_swim 20 + Steve creator_bonus 10
--   (both for Yalsha's 3 Sep join). Nothing for Deon. Events likewise.
--
-- P3. Eligibility: challenge enabled, not test_mode, window 1-30 Sep;
--     pts_join_swim = 20, pts_creator_bonus = 10, cap = 3; Steve has 1
--     creator_bonus on this swim; challenge_admin_flags rows for either: 0.
--
-- P4. Current board: Deon 140 pts / 0 entries / 0 joined / 8 temp logs;
--     Steve 10 pts / 0 entries.

-- ----------------------------------------------------------------
-- BACKUP — required before any DELETE / UPDATE / DROP / TRUNCATE.
-- ----------------------------------------------------------------
-- Not required: INSERT only, nothing existing is changed. Every inserted row
-- carries metadata.backfill = '2026-09-25_backfill-deon-join-steve-creator-bonus',
-- which the rollback deletes by.

-- ----------------------------------------------------------------
-- MIGRATION — applied only after Dave types "apply".
-- ----------------------------------------------------------------
BEGIN;

-- Guard: still exactly the situation the dry-run saw.
DO $$
DECLARE
  v_swim    constant uuid := 'e71f9ce1-5b22-4c4e-a808-b3ebec19f24b';
  v_deon    constant uuid := '6f712f66-90ba-4585-a688-93ccb1a9d994';
  v_steve   constant uuid := '31c588d3-4a32-4b40-8301-988bfcb05bbc';
  v_cfg     june_challenge_config%ROWTYPE;
BEGIN
  SELECT * INTO v_cfg FROM june_challenge_config WHERE id = 1;
  IF NOT v_cfg.enabled OR v_cfg.test_mode
     OR v_cfg.launch_date <> '2026-09-01' OR v_cfg.end_date <> '2026-09-30'
     OR v_cfg.pts_join_swim <> 20 OR v_cfg.pts_creator_bonus <> 10 THEN
    RAISE EXCEPTION 'Challenge config changed since dry-run. Aborting.';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM swim_participants
                  WHERE swim_event_id = v_swim AND user_id = v_deon AND status = 'approved'
                    AND requested_at >= '2026-09-01' AND requested_at < '2026-10-01') THEN
    RAISE EXCEPTION 'Deon''s approved September join not found. Aborting.';
  END IF;

  IF (SELECT created_by FROM swim_events WHERE id = v_swim) IS DISTINCT FROM v_steve THEN
    RAISE EXCEPTION 'Swim creator is not Steve Evans. Aborting.';
  END IF;

  IF EXISTS (SELECT 1 FROM challenge_points_audit
              WHERE challenge_id = 1 AND source_record_id = v_swim::text
                AND points_status = 'awarded'
                AND (   (user_id = v_deon  AND action_type = 'join_swim')
                     OR (user_id = v_steve AND action_type = 'creator_bonus'
                         AND metadata->>'joining_user_id' = v_deon::text)))
     OR EXISTS (SELECT 1 FROM june_challenge_events
                 WHERE ref_id = v_swim::text || ':' || v_deon::text) THEN
    RAISE EXCEPTION 'Deon''s join or Steve''s bonus for it is already recorded. Aborting.';
  END IF;

  IF (SELECT count(*) FROM challenge_points_audit
       WHERE challenge_id = 1 AND user_id = v_steve AND action_type = 'creator_bonus'
         AND source_record_id = v_swim::text AND points_status = 'awarded') >= v_cfg.pts_creator_bonus_cap THEN
    RAISE EXCEPTION 'Steve is at the creator bonus cap for this swim. Aborting.';
  END IF;

  IF EXISTS (SELECT 1 FROM challenge_admin_flags
              WHERE challenge_id = 1 AND user_id IN (v_deon, v_steve) AND disqualified) THEN
    RAISE EXCEPTION 'One of them is disqualified. Aborting.';
  END IF;
END $$;

WITH j AS (
  SELECT sp.swim_event_id, sp.user_id AS joiner, sp.requested_at AS joined_at,
         se.created_by AS creator, cfg.pts_join_swim, cfg.pts_creator_bonus
    FROM swim_participants sp
    JOIN swim_events se ON se.id = sp.swim_event_id
    JOIN june_challenge_config cfg ON cfg.id = 1
   WHERE sp.swim_event_id = 'e71f9ce1-5b22-4c4e-a808-b3ebec19f24b'
     AND sp.user_id       = '6f712f66-90ba-4585-a688-93ccb1a9d994'
),
tag AS (
  SELECT jsonb_build_object(
           'backfill', '2026-09-25_backfill-deon-join-steve-creator-bonus',
           'reason',   'join dropped by first-joiner-only bug; approved by Dave 2026-09-25') AS t
),
audit_join AS (
  INSERT INTO challenge_points_audit
    (challenge_id, user_id, action_type, source_table, source_record_id,
     points_awarded, points_status, metadata, awarded_at)
  SELECT 1, j.joiner, 'join_swim', 'swim_participants', j.swim_event_id::text,
         j.pts_join_swim, 'awarded', tag.t, j.joined_at
    FROM j, tag
  RETURNING 1
),
audit_bonus AS (
  INSERT INTO challenge_points_audit
    (challenge_id, user_id, action_type, source_table, source_record_id,
     points_awarded, points_status, metadata, awarded_at)
  SELECT 1, j.creator, 'creator_bonus', 'swim_events', j.swim_event_id::text,
         j.pts_creator_bonus, 'awarded',
         jsonb_build_object('joining_user_id', j.joiner) || tag.t, j.joined_at
    FROM j, tag
  RETURNING 1
),
event_join AS (
  INSERT INTO june_challenge_events
    (user_id, display_name, action_type, points, ref_id, metadata, source, created_at)
  SELECT j.joiner, p.display_name, 'join_swim', j.pts_join_swim,
         j.swim_event_id::text || ':' || j.joiner::text, tag.t, 'backfill', j.joined_at
    FROM j, tag, profiles p WHERE p.id = j.joiner
  RETURNING 1
),
event_bonus AS (
  INSERT INTO june_challenge_events
    (user_id, display_name, action_type, points, ref_id, metadata, source, created_at)
  SELECT j.creator, p.display_name, 'creator_bonus', j.pts_creator_bonus,
         j.swim_event_id::text || ':' || j.joiner::text,
         jsonb_build_object('joining_user_id', j.joiner) || tag.t, 'backfill', j.joined_at
    FROM j, tag, profiles p WHERE p.id = j.creator
  RETURNING 1
)
SELECT (SELECT count(*) FROM audit_join) + (SELECT count(*) FROM audit_bonus)
     + (SELECT count(*) FROM event_join) + (SELECT count(*) FROM event_bonus) AS rows_inserted;

-- Exactly 4 rows or nothing.
DO $$
BEGIN
  IF (SELECT count(*) FROM challenge_points_audit
       WHERE metadata->>'backfill' = '2026-09-25_backfill-deon-join-steve-creator-bonus') <> 2
  OR (SELECT count(*) FROM june_challenge_events
       WHERE metadata->>'backfill' = '2026-09-25_backfill-deon-join-steve-creator-bonus') <> 2 THEN
    RAISE EXCEPTION 'Backfill did not insert exactly 2 + 2 rows. Rolling back.';
  END IF;
END $$;

COMMIT;

-- ----------------------------------------------------------------
-- ROLLBACK — exact SQL to undo, or state:
-- "irreversible — restore from _bak_YYYYMMDD_tablename"
-- ----------------------------------------------------------------
-- BEGIN;
-- DELETE FROM june_challenge_events
--  WHERE metadata->>'backfill' = '2026-09-25_backfill-deon-join-steve-creator-bonus';   -- 2 rows
-- DELETE FROM challenge_points_audit
--  WHERE metadata->>'backfill' = '2026-09-25_backfill-deon-join-steve-creator-bonus';   -- 2 rows
-- COMMIT;

-- ----------------------------------------------------------------
-- VERIFY — run on the READ-ONLY connection AFTER applying.
-- State the expected result next to each query.
-- ----------------------------------------------------------------
-- V1. The 4 rows:
-- SELECT 'audit' t, user_id, action_type, points_awarded, awarded_at FROM challenge_points_audit
--  WHERE metadata->>'backfill' = '2026-09-25_backfill-deon-join-steve-creator-bonus'
-- UNION ALL
-- SELECT 'event', user_id, action_type, points, created_at FROM june_challenge_events
--  WHERE metadata->>'backfill' = '2026-09-25_backfill-deon-join-steve-creator-bonus';
-- expect: 4 rows — Deon join_swim 20 (x2: audit + event), Steve creator_bonus
--         10 (x2), all at 2026-09-19 09:01:51 UTC.
--
-- V2. Board:
-- SELECT display_name, total_points, draw_entries, swims_joined_rewarded, temp_logs_rewarded
--   FROM get_challenge_leaders(null, null)
--  WHERE user_id IN ('6f712f66-90ba-4585-a688-93ccb1a9d994','31c588d3-4a32-4b40-8301-988bfcb05bbc');
-- expect: Deon 160 pts, 0 entries (8 temp logs < 10), 1 joined;
--         Steve 20 pts, 0 entries. (Deon's temp-log count may be higher if
--         he logs before verification; the join delta is what matters.)
--
-- V3. Join reconciliation still 0:
-- SELECT count(*) FROM june_challenge_events e
--  WHERE e.created_at >= '2026-09-01 00:00+02' AND e.source <> 'trigger'
--    AND e.action_type = 'join_swim'
--    AND NOT EXISTS (SELECT 1 FROM swim_participants sp
--                     WHERE sp.swim_event_id::text = split_part(e.ref_id, ':', 1)
--                       AND sp.user_id = e.user_id);
-- expect: 0
--
-- APPLIED 2026-09-25 via supabase-admin apply_migration
-- (2026_09_25_backfill_deon_join_steve_creator_bonus), after Dave typed "apply".
-- V1 pass: 4 rows (Deon join_swim 20 audit + event, Steve creator_bonus 10
-- audit + event), all at 2026-09-19 09:01:51.0771 UTC. V2 pass: Deon 160 pts,
-- 0 entries, 1 joined, 8 temp logs; Steve 20 pts, 0 entries. V3 pass: 0.
