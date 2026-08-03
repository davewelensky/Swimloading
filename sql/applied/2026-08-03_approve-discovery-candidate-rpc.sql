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
    RAISE EXCEPTION 'WRONG PROJECT — MIGRATION ABORTED. Expected ref szgkzuswelntnevobnoh';
  END IF;
  RAISE NOTICE 'Project identity confirmed: swimloading';
END $$;

-- ================================================================
-- Migration: 2026-08-03_approve-discovery-candidate-rpc.sql
-- Process:   see MIGRATIONS.md
-- STATUS:    ⛔ PROPOSED — NOT YET APPLIED. Awaiting Dave's "apply".
-- ================================================================

-- Purpose:
--   The atomic candidate approval operation for Global Swim Discovery.
--   This is the ONLY write path into the published event catalogue: the
--   Phase 2 schema deliberately ships with no INSERT/UPDATE/DELETE policy
--   on any of its 13 tables for any client role, so a browser cannot
--   perform a half-completed promotion even as an admin.
--
--   One call does all of it in one transaction: authorise, lock, validate,
--   resolve organiser/venue/series, create the edition and its distances,
--   link provenance both ways, flip the candidate to approved, and append
--   an immutable review-decision row.
--
--   Also adds reject_discovery_candidate() — the review loop is
--   unusable without it, and it is the same ~15 lines of gate + audit.

-- Requested by:
--   Dave — Global Swim Discovery, approval step, 2026-08-03.

-- ----------------------------------------------------------------
-- PRE-CHECKS — run on the READ-ONLY connection BEFORE applying.
-- ----------------------------------------------------------------
-- 1. Neither function may already exist:
--      SELECT proname FROM pg_proc
--      WHERE proname IN ('approve_discovery_candidate','reject_discovery_candidate');
--      -- expect: 0 rows
--
-- 2. The tables it writes to must all exist (Phase 2 applied):
--      SELECT count(*) FROM information_schema.tables WHERE table_schema='public'
--        AND table_name IN ('event_organisers','event_venues','event_series',
--                           'event_editions','event_distances',
--                           'discovery_candidate_events','discovery_candidate_distances',
--                           'discovery_dedupe_links','discovery_review_decisions');
--      -- expect: 9
--
-- 3. Baseline row counts — the published catalogue should still be empty,
--    and nothing should be approved yet:
--      SELECT (SELECT count(*) FROM event_editions)            AS editions,
--             (SELECT count(*) FROM event_series)              AS series,
--             (SELECT count(*) FROM discovery_candidate_events
--                WHERE candidate_status='approved')            AS approved;
--      -- expect: 0, 0, 0

-- ----------------------------------------------------------------
-- BACKUP — not required. Creates two functions; changes no existing
-- object, row, policy or grant.
-- ----------------------------------------------------------------

-- ----------------------------------------------------------------
-- MIGRATION — applied only after Dave types "apply".
-- ----------------------------------------------------------------
BEGIN;

CREATE OR REPLACE FUNCTION public.approve_discovery_candidate(
  p_candidate_id  uuid,
  p_series_id     uuid     DEFAULT NULL,
  p_venue_id      uuid     DEFAULT NULL,
  p_organiser_id  uuid     DEFAULT NULL,
  p_edition_year  smallint DEFAULT NULL,
  p_admin_notes   text     DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cand         discovery_candidate_events%ROWTYPE;
  v_organiser_id uuid;
  v_venue_id     uuid;
  v_series_id    uuid;
  v_edition_id   uuid;
  v_year         smallint;
  v_status       text;
  v_existing     uuid;
  v_unresolved   integer;
BEGIN
  -- ── 1. Authorise ────────────────────────────────────────────────────
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true) THEN
    RAISE EXCEPTION 'Not authorised: approving a discovery candidate requires an admin account';
  END IF;

  -- ── 2. Lock the candidate ───────────────────────────────────────────
  -- FOR UPDATE serialises concurrent retries: a second caller blocks here
  -- until the first commits, then sees candidate_status='approved' at
  -- step 3 and returns the same edition instead of creating a second one.
  SELECT * INTO v_cand FROM discovery_candidate_events
   WHERE id = p_candidate_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Candidate % not found', p_candidate_id;
  END IF;

  -- ── 3. Idempotency ──────────────────────────────────────────────────
  -- Already approved => return what it produced. A retry (double-clicked
  -- button, network retry, replayed job) is a no-op, never a duplicate.
  IF v_cand.candidate_status = 'approved' THEN
    RETURN v_cand.promoted_edition_id;
  END IF;

  -- ── 4. Still reviewable? ────────────────────────────────────────────
  IF v_cand.candidate_status NOT IN ('pending', 'needs_review') THEN
    RAISE EXCEPTION 'Candidate % is "%" — only pending or needs_review candidates can be approved',
      p_candidate_id, v_cand.candidate_status;
  END IF;

  -- ── 5. Required fields ──────────────────────────────────────────────
  IF coalesce(trim(v_cand.canonical_name), '') = '' THEN
    RAISE EXCEPTION 'Candidate % has no name — cannot publish an unnamed event', p_candidate_id;
  END IF;

  -- The edition year. event_editions.edition_year is NOT NULL, and a
  -- candidate whose date was never confirmed genuinely has no year — the
  -- worker refuses to guess one and so does this. An admin who knows the
  -- year may pass it explicitly via p_edition_year.
  v_year := COALESCE(
    p_edition_year,
    CASE WHEN v_cand.date_confirmed AND v_cand.start_date IS NOT NULL
         THEN EXTRACT(YEAR FROM v_cand.start_date)::smallint END
  );
  IF v_year IS NULL THEN
    RAISE EXCEPTION
      'Candidate % has an unconfirmed date, so its edition year is unknown. '
      'Pass p_edition_year explicitly if you know it, or leave the candidate unapproved.',
      p_candidate_id;
  END IF;

  -- ── 6. Unresolved duplicate warnings block approval ─────────────────
  SELECT count(*) INTO v_unresolved
    FROM discovery_dedupe_links
   WHERE candidate_id = p_candidate_id AND resolution = 'unresolved';
  IF v_unresolved > 0 THEN
    RAISE EXCEPTION
      'Candidate % has % unresolved duplicate warning(s) — resolve them before approving',
      p_candidate_id, v_unresolved;
  END IF;

  -- ── 7. Resolve organiser / venue / series ───────────────────────────
  -- Explicit ids win (the review UI will pass them). Otherwise fall back
  -- to the candidate's proposed link, then to find-or-create by name.
  v_organiser_id := COALESCE(p_organiser_id, v_cand.proposed_organiser_id);
  IF v_organiser_id IS NULL AND coalesce(trim(v_cand.organiser_name), '') <> '' THEN
    SELECT id INTO v_organiser_id FROM event_organisers
     WHERE lower(trim(canonical_name)) = lower(trim(v_cand.organiser_name))
     LIMIT 1;
    IF v_organiser_id IS NULL THEN
      INSERT INTO event_organisers (canonical_name, display_name)
      VALUES (lower(trim(v_cand.organiser_name)), trim(v_cand.organiser_name))
      RETURNING id INTO v_organiser_id;
    END IF;
  END IF;

  v_venue_id := COALESCE(p_venue_id, v_cand.proposed_venue_id);
  IF v_venue_id IS NULL AND coalesce(trim(v_cand.venue_name), '') <> '' THEN
    SELECT id INTO v_venue_id FROM event_venues
     WHERE lower(trim(canonical_name)) = lower(trim(v_cand.venue_name))
     LIMIT 1;
    IF v_venue_id IS NULL THEN
      INSERT INTO event_venues (
        canonical_name, display_name, location_text, city, region,
        country_code, latitude, longitude, timezone, water_body_type)
      VALUES (
        lower(trim(v_cand.venue_name)), trim(v_cand.venue_name), v_cand.location_text,
        v_cand.city, v_cand.region, v_cand.country_code,
        v_cand.latitude, v_cand.longitude, v_cand.timezone, v_cand.water_body_type)
      RETURNING id INTO v_venue_id;
    END IF;
  END IF;

  v_series_id := p_series_id;
  IF v_series_id IS NULL THEN
    SELECT id INTO v_series_id FROM event_series
     WHERE lower(trim(canonical_name)) = lower(trim(v_cand.canonical_name))
     LIMIT 1;
    IF v_series_id IS NULL THEN
      INSERT INTO event_series (canonical_name, display_name, organiser_id, event_type, official_url)
      VALUES (
        lower(trim(v_cand.canonical_name)), trim(v_cand.canonical_name), v_organiser_id,
        COALESCE(v_cand.event_type, 'official_race'), v_cand.official_url)
      RETURNING id INTO v_series_id;
    END IF;
  END IF;

  -- ── 8. Create the edition ───────────────────────────────────────────
  -- Carry the discovered event status through. It currently lives in
  -- raw_source_values because discovery_candidate_events has no dedicated
  -- column for it (see discovery-worker/README.md, "Contract gaps").
  v_status := CASE lower(coalesce(v_cand.raw_source_values->>'eventStatus', ''))
                WHEN 'cancelled' THEN 'cancelled'
                WHEN 'postponed' THEN 'postponed'
                WHEN 'completed' THEN 'completed'
                ELSE 'announced'
              END;

  -- If this series already has an edition for that year+venue, stop and
  -- say so rather than silently merging — deciding whether this candidate
  -- IS that edition is a human judgement, expressed by marking it a
  -- duplicate, not by an implicit merge here.
  SELECT id INTO v_existing FROM event_editions
   WHERE series_id = v_series_id
     AND edition_year = v_year
     AND COALESCE(venue_id, '00000000-0000-0000-0000-000000000000'::uuid)
         = COALESCE(v_venue_id, '00000000-0000-0000-0000-000000000000'::uuid);
  IF v_existing IS NOT NULL THEN
    RAISE EXCEPTION
      'An edition already exists for this series/year/venue (edition %). '
      'Mark candidate % as a duplicate instead of approving it.',
      v_existing, p_candidate_id;
  END IF;

  INSERT INTO event_editions (
    series_id, venue_id, edition_year, title, start_date, end_date,
    date_precision, date_confirmed, status, registration_url, official_url,
    timezone, last_verified_at, source_candidate_id)
  VALUES (
    v_series_id, v_venue_id, v_year, v_cand.canonical_name,
    v_cand.start_date, v_cand.end_date, v_cand.date_precision, v_cand.date_confirmed,
    v_status, v_cand.registration_url, v_cand.official_url,
    v_cand.timezone, now(), p_candidate_id)
  RETURNING id INTO v_edition_id;

  -- ── 9. Copy the distances ───────────────────────────────────────────
  -- start_time is text on the candidate (raw extraction may be "TBC") and
  -- a real `time` on the published row. Cast only what actually looks like
  -- a time; anything else becomes NULL rather than failing the approval.
  INSERT INTO event_distances (
    edition_id, original_label, distance_metres, category, start_time,
    registration_url, wetsuit_policy, qualification_required)
  SELECT
    v_edition_id, d.original_label, d.distance_metres, d.category,
    CASE WHEN d.start_time ~ '^\d{1,2}:\d{2}(:\d{2})?$' THEN d.start_time::time END,
    d.registration_url, d.wetsuit_policy, d.qualification_required
  FROM discovery_candidate_distances d
  WHERE d.candidate_id = p_candidate_id;

  -- ── 10/11. Flip the candidate and record the decision ───────────────
  UPDATE discovery_candidate_events
     SET candidate_status    = 'approved',
         promoted_edition_id = v_edition_id,
         last_reviewed_at    = now()
   WHERE id = p_candidate_id;

  INSERT INTO discovery_review_decisions (
    candidate_id, decision, decided_by, notes, resulting_edition_id,
    previous_status, new_status, metadata)
  VALUES (
    p_candidate_id, 'approved', auth.uid(), p_admin_notes, v_edition_id,
    v_cand.candidate_status, 'approved',
    jsonb_build_object('series_id', v_series_id, 'venue_id', v_venue_id,
                       'organiser_id', v_organiser_id, 'edition_year', v_year));

  -- ── 12. Commit is implicit — one function body, one transaction ─────
  RETURN v_edition_id;
END;
$$;

COMMENT ON FUNCTION public.approve_discovery_candidate IS
  'Atomic promotion of a discovery candidate into the published catalogue. '
  'The ONLY write path into event_* tables. Admin-gated, row-locked, and '
  'idempotent: re-approving an already-approved candidate returns its '
  'existing edition rather than creating a second one.';

-- ── reject_discovery_candidate ────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.reject_discovery_candidate(
  p_candidate_id uuid,
  p_reason       text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cand discovery_candidate_events%ROWTYPE;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true) THEN
    RAISE EXCEPTION 'Not authorised: rejecting a discovery candidate requires an admin account';
  END IF;

  SELECT * INTO v_cand FROM discovery_candidate_events WHERE id = p_candidate_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Candidate % not found', p_candidate_id;
  END IF;

  IF v_cand.candidate_status = 'rejected' THEN
    RETURN true;  -- idempotent, same as approve
  END IF;

  IF v_cand.candidate_status = 'approved' THEN
    RAISE EXCEPTION
      'Candidate % is already approved and published as edition % — '
      'unpublishing is a separate, deliberate action, not a rejection',
      p_candidate_id, v_cand.promoted_edition_id;
  END IF;

  UPDATE discovery_candidate_events
     SET candidate_status = 'rejected', last_reviewed_at = now()
   WHERE id = p_candidate_id;

  INSERT INTO discovery_review_decisions (
    candidate_id, decision, decided_by, notes, previous_status, new_status)
  VALUES (p_candidate_id, 'rejected', auth.uid(), p_reason,
          v_cand.candidate_status, 'rejected');

  RETURN true;
END;
$$;

COMMENT ON FUNCTION public.reject_discovery_candidate IS
  'Marks a candidate rejected and appends an immutable review-decision row. '
  'Refuses to reject an already-approved candidate — withdrawing something '
  'already published is a different, deliberate action.';

-- ── Grants ────────────────────────────────────────────────────────────
-- Both functions check is_admin internally; the grant only makes them
-- callable by a logged-in user. anon has no business calling either.
REVOKE ALL ON FUNCTION public.approve_discovery_candidate(uuid, uuid, uuid, uuid, smallint, text) FROM public, anon;
REVOKE ALL ON FUNCTION public.reject_discovery_candidate(uuid, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.approve_discovery_candidate(uuid, uuid, uuid, uuid, smallint, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reject_discovery_candidate(uuid, text) TO authenticated;

COMMIT;

-- ----------------------------------------------------------------
-- ROLLBACK
-- ----------------------------------------------------------------
-- BEGIN;
-- DROP FUNCTION IF EXISTS public.approve_discovery_candidate(uuid, uuid, uuid, uuid, smallint, text);
-- DROP FUNCTION IF EXISTS public.reject_discovery_candidate(uuid, text);
-- COMMIT;
-- -- Note: dropping the functions does NOT unpublish anything already
-- -- approved. To undo an individual approval, delete the event_edition
-- -- (its distances cascade) and reset the candidate:
-- --   UPDATE discovery_candidate_events
-- --      SET candidate_status='pending', promoted_edition_id=NULL
-- --    WHERE id='<candidate>';
-- --   DELETE FROM event_editions WHERE id='<edition>';
-- -- Order matters: the candidate must be un-linked first, because
-- -- dce_promoted_only_when_approved forbids a non-approved candidate
-- -- holding a promoted_edition_id.

-- ----------------------------------------------------------------
-- VERIFY — run on the READ-ONLY connection AFTER applying.
-- ----------------------------------------------------------------
-- 1. Both functions exist and are SECURITY DEFINER:
--      SELECT proname, prosecdef FROM pg_proc
--      WHERE proname IN ('approve_discovery_candidate','reject_discovery_candidate');
--      -- expect: 2 rows, prosecdef = true for both
--
-- 2. anon cannot execute either:
--      SELECT routine_name, grantee FROM information_schema.routine_privileges
--      WHERE routine_name IN ('approve_discovery_candidate','reject_discovery_candidate')
--        AND grantee = 'anon';
--      -- expect: 0 rows
--
-- 3. Still no write POLICY was introduced anywhere (the functions are the
--    only write path, by design):
--      SELECT count(*) FROM pg_policies WHERE schemaname='public'
--        AND (tablename LIKE 'event\_%' OR tablename LIKE 'discovery\_%')
--        AND cmd <> 'SELECT';
--      -- expect: 0
