-- ================================================================
-- SwimLoading — Migration
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
      '║  This migration is for: SwimLoading                      ║\n'
      '║  Expected project ref:  szgkzuswelntnevobnoh             ║\n'
      '╚══════════════════════════════════════════════════════════╝'
    USING HINT = 'Check the project ref in your Supabase dashboard URL';
  END IF;
  RAISE NOTICE '✅ Project identity confirmed: swimloading (szgkzuswelntnevobnoh)';
END $$;

-- ================================================================
-- Migration: 2026-08-06_lough-cutra-entry-options.sql
-- Process:   see MIGRATIONS.md
-- ================================================================

-- Purpose:
--   Reject the 19 candidates that are entry options for the Lough Cutra
--   Castle festival rather than swims: "Sprint", "Olympic", "10K",
--   "9-10 years", "Saturday Swim 5K" and so on. One page, one weekend,
--   every way to enter it transcribed as its own event by the AI
--   extractor.
--
--   None ever reached the public catalogue — all 19 are pending with no
--   date, and the approve RPC refuses a dateless candidate — so this is
--   not a correctness fix for anything a swimmer can see. It clears a
--   decision from the review queue that has no answer, which is the same
--   reasoning as retire_past_candidates: asking a human to rule on
--   "Standard" buries the handful of candidates that genuinely need them.
--
--   The two REAL events from that same page are deliberately untouched:
--     "Lough Cutra Castle Swim Series"                     (approved, published)
--     "Lough Cutra Castle Triathlon and Multisport Festival" (pending, dated)
--
--   Prevention ships with this: rejectAsEventName() now covers bare
--   distances, standard race formats and hyphenated age ranges. A sweep of
--   all 752 undecided candidates matched exactly these 15 and nothing
--   else, so the rules are not catching real swims
--   (discovery-worker/scripts/sweep-not-a-name.ts).
--
--   Four of the 19 are rejected here but have NO rule: "Gauntlet" and the
--   three "Saturday Swim <distance>" rows. Those names are this
--   organiser's own wording, and a pattern invented from one example is
--   how a real swim gets silently deleted later. They stay a manual
--   decision. Re-crawling will not resurrect them: candidate_status is not
--   part of the upsert payload, so a rejection survives.

-- Requested by:
--   Dave

-- ----------------------------------------------------------------
-- PRE-CHECKS — run on the READ-ONLY connection BEFORE applying.
-- ----------------------------------------------------------------

-- 1. Expect 19 rows, every one: pending, start_date NULL, never published.
--    A non-null promoted_edition_id here means something IS public and
--    this migration is the wrong tool — stop.
-- SELECT canonical_name, candidate_status, start_date, promoted_edition_id
--   FROM discovery_candidate_events WHERE id IN (<the list below>);
--    Result 2026-08-06: 19 rows, all pending, all dateless, none published.

-- 2. The two real events must NOT be in the list. Expect 0.
-- SELECT count(*) FROM discovery_candidate_events
--  WHERE id IN (<the list below>)
--    AND canonical_name ILIKE 'Lough Cutra Castle%';

-- 3. Queue size before, for the after comparison.
-- SELECT count(*) FROM discovery_candidate_events
--  WHERE candidate_status IN ('pending','needs_review');
--    Result 2026-08-06: 752.

-- ----------------------------------------------------------------
-- BACKUP — required: this is an UPDATE.
-- ----------------------------------------------------------------
-- CREATE TABLE _bak_20260806_lough_cutra AS
--   SELECT * FROM discovery_candidate_events WHERE id IN (<the list below>);

-- ----------------------------------------------------------------
-- MIGRATION — applied only after Dave types "apply".
-- ----------------------------------------------------------------
BEGIN;

CREATE TEMP TABLE _entry_options (id uuid PRIMARY KEY) ON COMMIT DROP;
INSERT INTO _entry_options (id) VALUES
  ('9afc1573-ca62-4219-8c6a-a530d3f48450'),  -- Olympic
  ('2e46f98b-717f-49c5-8c77-cd1bc6c25942'),  -- Sprint
  ('61f15f79-e097-4170-bead-1621a3c32454'),  -- Sprint Plus
  ('4697c893-cbd0-41f2-9eb7-6e3d24e18417'),  -- Super Sprint
  ('ad590da6-90d0-4b81-b1ac-54fe7799fa4b'),  -- Starter
  ('ac5c4d8d-a1a0-45da-949d-aeb797c703d9'),  -- Middle
  ('154da740-90c5-4521-a104-aa5347484bab'),  -- Standard
  ('9ddb83bd-2f3b-4be4-a110-607db17461d8'),  -- Half Marathon
  ('9102a762-aa96-4be9-9fbe-1192c17b4390'),  -- Marathon
  ('bacb8274-a735-405f-a719-3d78825da7b0'),  -- 10K
  ('b5462de4-855b-460f-a880-2b2697f59516'),  -- 16-17 years
  ('d2043caf-ce92-41b9-9ea7-b62fca49b797'),  -- 12-13 years
  ('c187b3e3-c674-4e7b-87b0-30d7a9699bfe'),  -- 14-15 years
  ('f4b17bda-fa53-4d32-a366-650ea0711802'),  -- 11-12 years
  ('d2d1a496-f70a-480d-a5cf-e5475df613f8'),  -- 9-10 years
  -- No rule covers these four; rejected by hand, on purpose. See header.
  ('2ccc975a-f56b-4a0a-8259-c2e215243fcf'),  -- Gauntlet
  ('54735a3f-e0c2-41e9-80ab-cf7803bbe2ee'),  -- Saturday Swim 1 Mile
  ('efb4b055-2ad6-4d2e-b56d-15102fef543d'),  -- Saturday Swim 2.5K
  ('738a4be6-d578-4761-b3e8-a13878cc63e8');  -- Saturday Swim 5K

-- Audit row first, so the history says who did it and why. decided_by NULL
-- is the established convention for "the system", same as
-- retire_past_candidates.
INSERT INTO discovery_review_decisions
  (candidate_id, decision, decided_by, notes, previous_status, new_status, metadata)
SELECT c.id, 'rejected', NULL,
       'Not a swim: an entry option for the Lough Cutra Castle festival — a distance, '
       'a race format or an age group. The festival itself is listed separately and is '
       'unaffected. rejectAsEventName() now blocks this shape at extraction.',
       c.candidate_status, 'rejected',
       jsonb_build_object('automatic', true, 'reason', 'entry_option_not_event',
                          'source_page', 'https://www.castleraceseries.com/events/lough-cutra-castle/')
  FROM discovery_candidate_events c
  JOIN _entry_options e ON e.id = c.id
 WHERE c.candidate_status IN ('pending', 'needs_review');

-- Guarded on the current status so this cannot un-approve anything, and
-- is safe to re-run.
UPDATE discovery_candidate_events c
   SET candidate_status = 'rejected', last_reviewed_at = now()
  FROM _entry_options e
 WHERE c.id = e.id
   AND c.candidate_status IN ('pending', 'needs_review');

COMMIT;

-- ----------------------------------------------------------------
-- ROLLBACK
-- ----------------------------------------------------------------
-- UPDATE discovery_candidate_events c SET candidate_status = b.candidate_status,
--        last_reviewed_at = b.last_reviewed_at
--   FROM _bak_20260806_lough_cutra b WHERE b.id = c.id;
-- DELETE FROM discovery_review_decisions
--  WHERE metadata->>'reason' = 'entry_option_not_event';

-- ----------------------------------------------------------------
-- VERIFY — read-only, after applying.
-- ----------------------------------------------------------------

-- 1. All 19 rejected. Expect 19 / 0.
-- SELECT count(*) FILTER (WHERE candidate_status = 'rejected') AS rejected,
--        count(*) FILTER (WHERE candidate_status <> 'rejected') AS not_rejected
--   FROM discovery_candidate_events WHERE id IN (<the list below>);

-- 2. Queue drops by exactly 19: 752 -> 733.
-- SELECT count(*) FROM discovery_candidate_events
--  WHERE candidate_status IN ('pending','needs_review');

-- 3. The two real Lough Cutra events are untouched — one approved and
--    still published, one still pending with its date.
-- SELECT canonical_name, candidate_status, start_date, promoted_edition_id
--   FROM discovery_candidate_events
--  WHERE canonical_name ILIKE 'Lough Cutra Castle%';

-- 4. The audit trail exists. Expect 19.
-- SELECT count(*) FROM discovery_review_decisions
--  WHERE metadata->>'reason' = 'entry_option_not_event';
