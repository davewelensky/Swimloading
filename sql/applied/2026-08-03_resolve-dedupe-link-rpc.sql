-- ================================================================
-- SwimLoading — Migration
-- ================================================================

DO $safety$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM _project_identity
    WHERE key = 'project_name' AND value = 'swimloading'
  ) THEN
    RAISE EXCEPTION 'WRONG PROJECT — MIGRATION ABORTED. Expected ref szgkzuswelntnevobnoh';
  END IF;
END $safety$;

-- ================================================================
-- Migration: 2026-08-03_resolve-dedupe-link-rpc.sql
-- Process:   see MIGRATIONS.md
-- STATUS:    ⛔ PROPOSED — NOT YET APPLIED.
-- ================================================================

-- Purpose:
--   Completes the review loop. approve_discovery_candidate() refuses to
--   approve a candidate that has unresolved duplicate warnings — but
--   nothing could RESOLVE one, because discovery_dedupe_links has no
--   UPDATE policy for any client role (by design: all writes go through
--   SECURITY DEFINER RPCs). That made the two Windermere candidates
--   permanently unapprovable and the review UI unable to unblock them.
--
--   This adds the missing verb, in the same shape as the other two:
--   admin-gated, row-locked, idempotent, and audited.

-- Requested by:
--   Dave — admin review UI, 2026-08-03.

-- ----------------------------------------------------------------
-- PRE-CHECKS (read-only connection)
-- ----------------------------------------------------------------
-- 1. SELECT proname FROM pg_proc WHERE proname='resolve_dedupe_link';
--    -- expect: 0 rows
-- 2. SELECT count(*) FROM discovery_dedupe_links WHERE resolution='unresolved';
--    -- expect: 2 (the Windermere pair)
-- 3. SELECT count(*) FROM pg_policies WHERE schemaname='public'
--      AND tablename='discovery_dedupe_links' AND cmd<>'SELECT';
--    -- expect: 0 — confirming there is genuinely no client write path

-- ----------------------------------------------------------------
-- BACKUP — not required. Creates one function.
-- ----------------------------------------------------------------

BEGIN;

CREATE OR REPLACE FUNCTION public.resolve_dedupe_link(
  p_link_id                  uuid,
  p_resolution               text,
  p_mark_candidate_duplicate boolean DEFAULT false,
  p_notes                    text    DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_link discovery_dedupe_links%ROWTYPE;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true) THEN
    RAISE EXCEPTION 'Not authorised: resolving a duplicate link requires an admin account';
  END IF;

  IF p_resolution NOT IN ('confirmed_duplicate', 'confirmed_distinct') THEN
    RAISE EXCEPTION 'Resolution must be confirmed_duplicate or confirmed_distinct, got "%"', p_resolution;
  END IF;

  SELECT * INTO v_link FROM discovery_dedupe_links WHERE id = p_link_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Duplicate link % not found', p_link_id;
  END IF;

  -- Idempotent, like approve/reject: re-resolving the same way is a no-op
  -- rather than an error, but silently CHANGING an existing decision is
  -- refused — that should be a deliberate, visible action.
  IF v_link.resolution <> 'unresolved' THEN
    IF v_link.resolution = p_resolution THEN
      RETURN true;
    END IF;
    RAISE EXCEPTION
      'Link % is already resolved as "%" — re-resolving it differently is not supported',
      p_link_id, v_link.resolution;
  END IF;

  UPDATE discovery_dedupe_links
     SET resolution  = p_resolution,
         resolved_by = auth.uid(),
         resolved_at = now()
   WHERE id = p_link_id;

  -- Resolve the RECIPROCAL link too. The worker records duplicate findings
  -- in both directions (A->B and B->A), and a duplicate decision is about
  -- the PAIR, not one direction. Without this, retiring A leaves B blocked
  -- by a link pointing at the candidate you just retired — a dead end the
  -- reviewer cannot clear sensibly.
  --
  -- Note it does NOT mark the other candidate as a duplicate: retiring is
  -- a per-candidate choice, and the whole point of confirming a duplicate
  -- is that ONE of the pair survives to be published.
  UPDATE discovery_dedupe_links
     SET resolution  = p_resolution,
         resolved_by = auth.uid(),
         resolved_at = now()
   WHERE candidate_id = v_link.matching_candidate_id
     AND matching_candidate_id = v_link.candidate_id
     AND resolution = 'unresolved';

  -- Optionally retire the candidate as a duplicate in the same breath —
  -- the common case when the reviewer decides two pages describe one
  -- event. Never applied to an already-approved candidate: withdrawing
  -- something published is a separate, deliberate action.
  IF p_mark_candidate_duplicate AND p_resolution = 'confirmed_duplicate' THEN
    UPDATE discovery_candidate_events
       SET candidate_status = 'duplicate', last_reviewed_at = now()
     WHERE id = v_link.candidate_id
       AND candidate_status IN ('pending', 'needs_review');
  END IF;

  INSERT INTO discovery_review_decisions (
    candidate_id, decision, decided_by, notes, previous_status, new_status, metadata)
  SELECT
    v_link.candidate_id, 'duplicate_resolved', auth.uid(), p_notes,
    'unresolved', p_resolution,
    jsonb_build_object(
      'link_id', p_link_id,
      'matching_candidate_id', v_link.matching_candidate_id,
      'matching_edition_id', v_link.matching_edition_id,
      'similarity_score', v_link.similarity_score,
      'candidate_marked_duplicate', p_mark_candidate_duplicate AND p_resolution = 'confirmed_duplicate');

  RETURN true;
END;
$fn$;

COMMENT ON FUNCTION public.resolve_dedupe_link IS
  'Resolves one duplicate link so approve_discovery_candidate() is no '
  'longer blocked by it. Admin-gated, row-locked, idempotent, audited. '
  'Optionally retires the candidate as a duplicate in the same call.';

REVOKE ALL ON FUNCTION public.resolve_dedupe_link(uuid, text, boolean, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.resolve_dedupe_link(uuid, text, boolean, text) TO authenticated;

COMMIT;

-- ----------------------------------------------------------------
-- ROLLBACK
-- ----------------------------------------------------------------
-- BEGIN;
-- DROP FUNCTION IF EXISTS public.resolve_dedupe_link(uuid, text, boolean, text);
-- COMMIT;
-- -- Already-resolved links stay resolved; to re-open one:
-- --   UPDATE discovery_dedupe_links
-- --      SET resolution='unresolved', resolved_by=NULL, resolved_at=NULL
-- --    WHERE id='<link>';
-- -- (resolved_by and resolved_at must be cleared together — ddl_resolver_paired.)

-- ----------------------------------------------------------------
-- VERIFY (read-only connection)
-- ----------------------------------------------------------------
-- 1. SELECT proname, prosecdef FROM pg_proc WHERE proname='resolve_dedupe_link';
--    -- expect: 1 row, prosecdef = true
-- 2. SELECT count(*) FROM information_schema.routine_privileges
--      WHERE routine_name='resolve_dedupe_link' AND grantee='anon';
--    -- expect: 0
-- 3. SELECT count(*) FROM pg_policies WHERE schemaname='public'
--      AND (tablename LIKE 'event\_%' OR tablename LIKE 'discovery\_%') AND cmd<>'SELECT';
--    -- expect: 0 — still no client write policy anywhere
