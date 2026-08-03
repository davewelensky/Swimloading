-- ================================================================
-- SwimLoading — Migration
-- ================================================================

DO $safety$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM _project_identity WHERE key='project_name' AND value='swimloading') THEN
    RAISE EXCEPTION 'WRONG PROJECT — MIGRATION ABORTED. Expected ref szgkzuswelntnevobnoh';
  END IF;
END $safety$;

-- ================================================================
-- Migration: 2026-08-03_auto-publish-high-confidence.sql
-- Process:   see MIGRATIONS.md
-- STATUS:    ⛔ PROPOSED — NOT YET APPLIED.
-- ================================================================

-- Purpose:
--   Per-swim manual review does not scale to a global catalogue. This
--   lets the worker publish the cases the machine is already confident
--   about, and leaves a human only the genuinely ambiguous ones.
--
--   Conservative by explicit decision (Dave, 2026-08-03): ONLY the
--   high_confidence tier auto-publishes. manual_review and below stay
--   queued. Widen later on evidence, by changing the single
--   publication_recommendation test below.
--
--   Why the eligibility rules live HERE and not in the worker: they are
--   a safety policy, not a client preference. Encoding them in SQL means
--   a bug, a rewrite, or a future second caller cannot quietly widen what
--   gets published to the public site.
--
--   Nothing bypasses the atomic path: this calls the same
--   approve_discovery_candidate() the admin UI does, so every automatic
--   publish still creates an event_editions row, links provenance both
--   ways, and appends a discovery_review_decisions audit row.

-- Requested by:
--   Dave — 2026-08-03, "start conservative with high_confidence only".

-- ----------------------------------------------------------------
-- PRE-CHECKS (read-only)
-- ----------------------------------------------------------------
-- 1. SELECT proname FROM pg_proc WHERE proname='auto_publish_eligible_candidates';
--    -- expect: 0 rows
-- 2. How many would publish on the first run:
--      SELECT count(*) FROM discovery_candidate_events c
--       WHERE c.candidate_status IN ('pending','needs_review')
--         AND c.publication_recommendation = 'high_confidence'
--         AND c.date_confirmed AND c.start_date >= current_date
--         AND coalesce(c.raw_source_values->>'eventStatus','') <> 'cancelled'
--         AND NOT EXISTS (SELECT 1 FROM discovery_dedupe_links l
--                          WHERE l.candidate_id=c.id AND l.resolution='unresolved');
--      -- review this number BEFORE enabling the worker flag.

-- ----------------------------------------------------------------
-- BACKUP — not required. Replaces one function, creates one.
-- ----------------------------------------------------------------

BEGIN;

-- ── 1. Let the service role call the approval path ────────────────────
-- The worker authenticates with the service-role key, where auth.uid() is
-- NULL, so the admin check alone would reject it. service_role is a
-- trusted server-side identity that already bypasses RLS entirely — the
-- gate is not weakened by naming it explicitly, and doing so keeps a
-- single promotion implementation rather than a forked copy.
-- decided_by stays NULL for these, which is how the audit trail
-- distinguishes an automatic publish from a person's decision.
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
AS $fn$
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
  IF NOT (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true)
    OR auth.role() = 'service_role'
  ) THEN
    RAISE EXCEPTION 'Not authorised: approving a discovery candidate requires an admin account';
  END IF;

  SELECT * INTO v_cand FROM discovery_candidate_events WHERE id = p_candidate_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Candidate % not found', p_candidate_id;
  END IF;

  IF v_cand.candidate_status = 'approved' THEN
    RETURN v_cand.promoted_edition_id;
  END IF;

  IF v_cand.candidate_status NOT IN ('pending', 'needs_review') THEN
    RAISE EXCEPTION 'Candidate % is "%" - only pending or needs_review candidates can be approved',
      p_candidate_id, v_cand.candidate_status;
  END IF;

  IF coalesce(trim(v_cand.canonical_name), '') = '' THEN
    RAISE EXCEPTION 'Candidate % has no name - cannot publish an unnamed event', p_candidate_id;
  END IF;

  v_year := COALESCE(
    p_edition_year,
    CASE WHEN v_cand.date_confirmed AND v_cand.start_date IS NOT NULL
         THEN EXTRACT(YEAR FROM v_cand.start_date)::smallint END
  );
  IF v_year IS NULL THEN
    RAISE EXCEPTION
      'Candidate % has an unconfirmed date, so its edition year is unknown. Pass p_edition_year explicitly if you know it, or leave the candidate unapproved.',
      p_candidate_id;
  END IF;

  SELECT count(*) INTO v_unresolved FROM discovery_dedupe_links
   WHERE candidate_id = p_candidate_id AND resolution = 'unresolved';
  IF v_unresolved > 0 THEN
    RAISE EXCEPTION 'Candidate % has % unresolved duplicate warning(s) - resolve them before approving',
      p_candidate_id, v_unresolved;
  END IF;

  v_organiser_id := COALESCE(p_organiser_id, v_cand.proposed_organiser_id);
  IF v_organiser_id IS NULL AND coalesce(trim(v_cand.organiser_name), '') <> '' THEN
    SELECT id INTO v_organiser_id FROM event_organisers
     WHERE lower(trim(canonical_name)) = lower(trim(v_cand.organiser_name)) LIMIT 1;
    IF v_organiser_id IS NULL THEN
      INSERT INTO event_organisers (canonical_name, display_name)
      VALUES (lower(trim(v_cand.organiser_name)), trim(v_cand.organiser_name))
      RETURNING id INTO v_organiser_id;
    END IF;
  END IF;

  v_venue_id := COALESCE(p_venue_id, v_cand.proposed_venue_id);
  IF v_venue_id IS NULL AND coalesce(trim(v_cand.venue_name), '') <> '' THEN
    SELECT id INTO v_venue_id FROM event_venues
     WHERE lower(trim(canonical_name)) = lower(trim(v_cand.venue_name)) LIMIT 1;
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
     WHERE lower(trim(canonical_name)) = lower(trim(v_cand.canonical_name)) LIMIT 1;
    IF v_series_id IS NULL THEN
      INSERT INTO event_series (canonical_name, display_name, organiser_id, event_type, official_url)
      VALUES (lower(trim(v_cand.canonical_name)), trim(v_cand.canonical_name), v_organiser_id,
              COALESCE(v_cand.event_type, 'official_race'), v_cand.official_url)
      RETURNING id INTO v_series_id;
    END IF;
  END IF;

  v_status := CASE lower(coalesce(v_cand.raw_source_values->>'eventStatus',''))
                WHEN 'cancelled' THEN 'cancelled' WHEN 'postponed' THEN 'postponed'
                WHEN 'completed' THEN 'completed' ELSE 'announced' END;

  SELECT id INTO v_existing FROM event_editions
   WHERE series_id = v_series_id AND edition_year = v_year
     AND COALESCE(venue_id,'00000000-0000-0000-0000-000000000000'::uuid)
       = COALESCE(v_venue_id,'00000000-0000-0000-0000-000000000000'::uuid);
  IF v_existing IS NOT NULL THEN
    RAISE EXCEPTION 'An edition already exists for this series/year/venue (edition %). Mark candidate % as a duplicate instead of approving it.',
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

  INSERT INTO event_distances (
    edition_id, original_label, distance_metres, category, start_time,
    registration_url, wetsuit_policy, qualification_required)
  SELECT v_edition_id, d.original_label, d.distance_metres, d.category,
    CASE WHEN d.start_time ~ '^\d{1,2}:\d{2}(:\d{2})?$' THEN d.start_time::time END,
    d.registration_url, d.wetsuit_policy, d.qualification_required
  FROM discovery_candidate_distances d WHERE d.candidate_id = p_candidate_id;

  UPDATE discovery_candidate_events
     SET candidate_status='approved', promoted_edition_id=v_edition_id, last_reviewed_at=now()
   WHERE id = p_candidate_id;

  INSERT INTO discovery_review_decisions (
    candidate_id, decision, decided_by, notes, resulting_edition_id,
    previous_status, new_status, metadata)
  VALUES (
    p_candidate_id, 'approved', auth.uid(), p_admin_notes, v_edition_id,
    v_cand.candidate_status, 'approved',
    jsonb_build_object('series_id', v_series_id, 'venue_id', v_venue_id,
                       'organiser_id', v_organiser_id, 'edition_year', v_year,
                       'automatic', auth.uid() IS NULL));

  RETURN v_edition_id;
END;
$fn$;

-- ── 2. The auto-publish sweep ─────────────────────────────────────────
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
      -- CONSERVATIVE TIER: high_confidence only. This single line is the
      -- policy dial. Widening it to include 'manual_review' is a
      -- deliberate migration, not a config change.
      AND c.publication_recommendation = 'high_confidence'
      -- A date we actually know, that has not already passed.
      AND c.date_confirmed
      AND c.start_date >= current_date
      -- Never auto-publish something the source says is off.
      AND coalesce(c.raw_source_values->>'eventStatus','') NOT IN ('cancelled','postponed')
      -- Never auto-publish one half of an unresolved duplicate pair.
      AND NOT EXISTS (
        SELECT 1 FROM discovery_dedupe_links l
         WHERE l.candidate_id = c.id AND l.resolution = 'unresolved')
    ORDER BY c.confidence_score DESC, c.start_date
    LIMIT p_limit
  LOOP
    BEGIN
      v_edition := approve_discovery_candidate(r.id, NULL, NULL, NULL, NULL,
                     'Auto-published: high_confidence tier, confirmed future date, no duplicate warnings.');
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
  'Worker-only bulk publish of the high_confidence tier. Eligibility is '
  'enforced here in SQL, not in the worker, because it is a safety policy. '
  'Delegates to approve_discovery_candidate() so every automatic publish '
  'is atomic, provenance-linked and audited exactly like a manual one.';

REVOKE ALL ON FUNCTION public.auto_publish_eligible_candidates(integer) FROM public, anon, authenticated;

COMMIT;

-- ----------------------------------------------------------------
-- ROLLBACK
-- ----------------------------------------------------------------
-- BEGIN;
-- DROP FUNCTION IF EXISTS public.auto_publish_eligible_candidates(integer);
-- -- and restore the admin-only gate in approve_discovery_candidate by
-- -- re-applying sql/applied/2026-08-03_approve-discovery-candidate-rpc.sql
-- COMMIT;
-- -- Already auto-published editions are NOT withdrawn by this rollback.
-- -- To withdraw one, follow the per-approval undo in that migration.

-- ----------------------------------------------------------------
-- VERIFY (read-only)
-- ----------------------------------------------------------------
-- 1. SELECT proname FROM pg_proc WHERE proname='auto_publish_eligible_candidates'; -- expect 1
-- 2. SELECT count(*) FROM information_schema.routine_privileges
--     WHERE routine_name='auto_publish_eligible_candidates'
--       AND grantee IN ('anon','authenticated');   -- expect 0
-- 3. Audit trail distinguishes automatic from human:
--    SELECT decision, decided_by IS NULL AS automatic, count(*)
--      FROM discovery_review_decisions GROUP BY 1,2;
