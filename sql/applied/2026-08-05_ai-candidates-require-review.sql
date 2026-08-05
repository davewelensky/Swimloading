-- ================================================================
-- SwimLoading — Migration
-- The safety block hard-fails if you are in the wrong project.
-- ================================================================

DO $safety$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM _project_identity WHERE key='project_name' AND value='swimloading') THEN
    RAISE EXCEPTION E'\n WRONG PROJECT — MIGRATION ABORTED. Expected swimloading / szgkzuswelntnevobnoh';
  END IF;
  RAISE NOTICE '✅ Project identity confirmed: swimloading';
END $safety$;

-- ================================================================
-- Migration: 2026-08-05_ai-candidates-require-review.sql
-- Process:   see MIGRATIONS.md — no section below may be left empty
-- STATUS:    ✅ APPLIED 2026-08-05. Verified: ai_fallback filter present,
--            widened <> 'rejected' rule and both correctness guards intact,
--            signature still (p_limit integer) so the worker binding is
--            unaffected, zero anon/authenticated grants, and the AI-read
--            edition count is unchanged at the 56 baseline.
-- ================================================================

-- Purpose:
--   Stop the automatic sweep from publishing anything a language model
--   read. An ai_fallback candidate stays queued for a human.
--
--   Why this and not a wider retreat: the 2026-08-04 product decision
--   ("publish and show our ranking, at your own risk") is correct and is
--   NOT being reversed. It rests on a specific claim — that everything
--   after the reading step is deterministic, so a low-quality listing is
--   published *and honestly labelled* by verification_tier. That claim
--   holds for the reading itself only when a rule read the page. When a
--   model reads the page, the failure mode is different in kind: it is not
--   a thin listing that the tier can describe, it is a confidently-shaped
--   row for something that was never an event.
--
--   Seven aQuellé Midmar Mile start waves reached the live site that way,
--   including "Disabled, Pope-Ellis and 71yr/over" — a disability start
--   category offered to the public as a swim you could enter. They scored
--   well, because a wave row looks exactly like an event row to
--   deterministic arithmetic. rejectAsEventName() now blocks that shape at
--   build time, but that gate is a list of known-bad shapes; it cannot
--   anticipate the next one. A human in front of AI-read rows can.
--
--   The cost of this is latency on ~100 queued candidates, not lost
--   coverage — nothing is discarded, and a reviewer can still approve any
--   of them through the existing admin path.

-- Requested by:
--   Dave — 2026-08-05, from the Global Swim Discovery handoff §6 item 2,
--   "one line in the eligibility rule so ai_fallback requires manual_review".

-- ----------------------------------------------------------------
-- PRE-CHECKS — run on the READ-ONLY connection BEFORE applying.
-- ----------------------------------------------------------------
-- 1. The live function is the widened 2026-08-04 body and has no
--    extraction_method filter yet:
--      SELECT (prosrc ILIKE '%publication_recommendation <> ''rejected''%') AS widened,
--             (prosrc ILIKE '%extraction_method%')                          AS already_filtered
--        FROM pg_proc WHERE proname = 'auto_publish_eligible_candidates';
--      -- ACTUAL 2026-08-05: widened = true, already_filtered = false.
--
-- 2. What the change withholds — candidates that pass every other guard
--    today and would be published automatically:
--      SELECT c.extraction_method, count(*)
--        FROM discovery_candidate_events c
--       WHERE c.candidate_status IN ('pending','needs_review')
--         AND c.publication_recommendation <> 'rejected'
--         AND c.date_confirmed AND c.start_date >= current_date
--         AND coalesce(c.raw_source_values->>'eventStatus','') NOT IN ('cancelled','postponed')
--         AND NOT EXISTS (SELECT 1 FROM discovery_dedupe_links l
--                          WHERE l.candidate_id=c.id AND l.resolution='unresolved')
--       GROUP BY 1;
--      -- ACTUAL 2026-08-05: 0 rows, for ANY extraction method. Everything
--      -- currently eligible has already been published; the 582 in the
--      -- queue are held back by the date guard, not by this one. So this
--      -- migration withholds NOTHING today — it takes effect on the next
--      -- crawl. Applying it before the next crawl is the whole point.
--
-- 3. AI-read candidates by recommendation tier, i.e. the population this
--    rule will hold back in future:
--      SELECT publication_recommendation, count(*)
--        FROM discovery_candidate_events
--       WHERE extraction_method = 'ai_fallback' GROUP BY 1;
--      -- ACTUAL 2026-08-05: manual_review 100, insufficient_evidence 321,
--      -- rejected 335. NONE are high_confidence — which is why excluding
--      -- ai_fallback outright and excluding it "unless high_confidence"
--      -- are the same rule today. The outright form is chosen because it
--      -- is the one that stays true if the scorer changes.

-- ----------------------------------------------------------------
-- BACKUP — not required. This replaces one function body. It writes no
-- rows, and changes no existing row, column, policy or grant. Editions
-- already published are deliberately left alone (see OPERATIONAL NOTE).
-- ----------------------------------------------------------------

BEGIN;

CREATE OR REPLACE FUNCTION public.auto_publish_eligible_candidates(
  p_limit integer DEFAULT 100
)
RETURNS TABLE (candidate_id uuid, edition_id uuid, event_name text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  r          record;
  v_edition  uuid;
BEGIN
  -- Service role only. A browser must never be able to trigger a bulk
  -- publish, even an admin's browser — bulk publishing is a worker
  -- operation, and individual publishing already has its own RPC.
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'auto_publish_eligible_candidates may only be called by the worker (service role)';
  END IF;

  FOR r IN
    SELECT c.id, c.canonical_name
    FROM discovery_candidate_events c
    WHERE c.candidate_status IN ('pending','needs_review')
      -- Everything except outright rejection (widened 2026-08-04). Quality
      -- is communicated to the public page via verification_tier rather
      -- than gated here.
      AND c.publication_recommendation <> 'rejected'
      -- ADDED 2026-08-05: never auto-publish a page a model read. The
      -- deterministic tier can describe a thin listing honestly; it cannot
      -- describe a row that was never an event in the first place. These
      -- wait for a human, who can still approve them one by one through
      -- approve_discovery_candidate().
      AND c.extraction_method <> 'ai_fallback'
      -- Correctness guards, unchanged.
      AND c.date_confirmed
      AND c.start_date >= current_date
      AND coalesce(c.raw_source_values->>'eventStatus','') NOT IN ('cancelled','postponed')
      AND NOT EXISTS (
        SELECT 1 FROM discovery_dedupe_links l
         WHERE l.candidate_id = c.id AND l.resolution = 'unresolved')
    ORDER BY c.confidence_score DESC, c.start_date
    LIMIT p_limit
  LOOP
    BEGIN
      v_edition := approve_discovery_candidate(r.id, NULL, NULL, NULL, NULL,
                     'Auto-published: rule-extracted, confirmed future date, not cancelled, '
                     'no duplicate warnings. Trust shown to users via verification_tier.');
      candidate_id := r.id; edition_id := v_edition; event_name := r.canonical_name;
      RETURN NEXT;
    EXCEPTION WHEN OTHERS THEN
      -- One bad candidate must not abort the whole sweep. It simply stays
      -- queued for a human, which is the correct fallback.
      RAISE NOTICE 'Skipped % (%): %', r.canonical_name, r.id, SQLERRM;
    END;
  END LOOP;
END;
$fn$;

COMMENT ON FUNCTION public.auto_publish_eligible_candidates IS
  'Worker-only bulk publish. Publishes anything RULE-EXTRACTED (never '
  'extraction_method=''ai_fallback'') that is not outright rejected, has a '
  'confirmed future date, is not cancelled, and has no unresolved '
  'duplicate. AI-read candidates are withheld for human review because the '
  'deterministic verification_tier can describe a thin listing but cannot '
  'describe a row that was never an event. Delegates to '
  'approve_discovery_candidate() so each publish stays atomic, '
  'provenance-linked and audited.';

REVOKE ALL ON FUNCTION public.auto_publish_eligible_candidates(integer) FROM public, anon, authenticated;

COMMIT;

-- ----------------------------------------------------------------
-- ROLLBACK — exact SQL to undo.
-- ----------------------------------------------------------------
-- Re-apply the function body verbatim from
--   sql/applied/2026-08-04_publish-with-verification-tier.sql, section 4
-- (identical except for the single `AND c.extraction_method <> 'ai_fallback'`
-- line and the two comment blocks). Nothing else in this migration to undo.
--
-- Rolling back does NOT unpublish anything, because this migration
-- published nothing.

-- ----------------------------------------------------------------
-- OPERATIONAL NOTE — the 56 AI-read editions already live.
-- ----------------------------------------------------------------
-- This migration is prospective only. As at 2026-08-05, 56 published
-- editions trace to an ai_fallback candidate (40 manual_review, 16
-- insufficient_evidence):
--   SELECT c.publication_recommendation, count(*)
--     FROM event_editions e
--     JOIN discovery_candidate_events c ON c.id = e.source_candidate_id
--    WHERE c.extraction_method = 'ai_fallback'
--    GROUP BY 1;
-- They are NOT withdrawn here. Withdrawing them is a separate, destructive
-- decision that needs its own migration, its own backup and its own "apply"
-- — and a review pass is the more likely right answer than a bulk delete,
-- since most of the 56 are probably real swims. Listing them for that pass:
--   SELECT e.id, e.title, e.start_date, e.verification_tier, e.confidence_score
--     FROM event_editions e
--     JOIN discovery_candidate_events c ON c.id = e.source_candidate_id
--    WHERE c.extraction_method = 'ai_fallback'
--    ORDER BY e.confidence_score NULLS FIRST, e.start_date;

-- ----------------------------------------------------------------
-- VERIFY — run on the READ-ONLY connection AFTER applying.
-- ----------------------------------------------------------------
-- 1. The filter is in the live body, and the other guards survived intact:
--      SELECT (prosrc ILIKE '%extraction_method <> ''ai_fallback''%') AS ai_filtered,
--             (prosrc ILIKE '%publication_recommendation <> ''rejected''%') AS still_widened,
--             (prosrc ILIKE '%date_confirmed%')                        AS date_guard,
--             (prosrc ILIKE '%unresolved%')                            AS dedupe_guard
--        FROM pg_proc WHERE proname = 'auto_publish_eligible_candidates';
--      -- expect: all four true
--
-- 2. Still worker-only — no browser role may call it:
--      SELECT count(*) FROM information_schema.routine_privileges
--       WHERE routine_name = 'auto_publish_eligible_candidates'
--         AND grantee IN ('anon','authenticated');       -- expect: 0
--
-- 3. Signature unchanged, so discovery-worker/src/db/publish.ts still binds:
--      SELECT pg_get_function_identity_arguments(oid)
--        FROM pg_proc WHERE proname = 'auto_publish_eligible_candidates';
--      -- expect: p_limit integer
--
-- 4. After the next crawl, no NEW edition traces to an AI-read candidate.
--    Compare against the 56 baseline in the operational note above:
--      SELECT count(*) FROM event_editions e
--        JOIN discovery_candidate_events c ON c.id = e.source_candidate_id
--       WHERE c.extraction_method = 'ai_fallback';     -- expect: still 56
