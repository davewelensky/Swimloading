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
      '║  This migration is for: SwimLoading                     ║\n'
      '║  Expected project ref:  szgkzuswelntnevobnoh            ║\n'
      '╚══════════════════════════════════════════════════════════╝'
    USING HINT = 'Check the project ref in your Supabase dashboard URL';
  END IF;
  RAISE NOTICE '✅ Project identity confirmed: swimloading (szgkzuswelntnevobnoh)';
END $$;

-- ================================================================
-- Migration: 2026-08-04_publish-with-verification-tier.sql
-- Process:   see MIGRATIONS.md — no section below may be left empty
-- ================================================================

-- Purpose:
--   Shift Global Swim Discovery from "an admin approves every event" to
--   "publish it and show how well we verified it".
--
--   Product decision (Dave, 2026-08-04): a listing is not a warranty. The
--   catalogue carries an explicit confirm-before-you-travel disclaimer,
--   SwimLoading is not accountable for a third-party event changing or
--   being cancelled, and a swim we never listed helps nobody. Manual
--   approval of hundreds of events was going to be the bottleneck that
--   kept the catalogue at 38.
--
--   Two parts:
--     1. event_editions gains confidence_score + verification_tier, filled
--        automatically from the candidate that produced the edition, so
--        the PUBLIC page can show how trustworthy each listing is. The
--        discovery tables stay non-public, which is why this has to be
--        copied onto the published row rather than joined at read time.
--     2. auto_publish_eligible_candidates widens from high_confidence-only
--        to everything that is not outright rejected.
--
--   What is deliberately NOT relaxed, because these are CORRECTNESS
--   guards rather than liability ones — "at your own risk" covers an
--   event changing, it does not excuse us listing the same swim twice or
--   putting a pool gala on an open-water site:
--     * a confirmed date that has not already passed
--     * not marked cancelled or postponed at source
--     * no unresolved duplicate warning
--     * publication_recommendation <> 'rejected', which after the
--       2026-08-04 classifier fix means either a hard classification veto
--       (pool_only, triathlon_only, historical_result, tourism,
--       no_opportunity) or a near-empty extraction

-- Requested by:
--   Dave — 2026-08-04: "i would rather have a ranking system where we show
--   our ranking of this being legit… i would rather then publish and say
--   at your own risk", "we arent accountable for publishing a prospective
--   swim event", "build both".

-- ----------------------------------------------------------------
-- PRE-CHECKS — run on the READ-ONLY connection BEFORE applying.
-- ----------------------------------------------------------------
-- Columns must not already exist (expect 0):
--   SELECT count(*) FROM information_schema.columns
--    WHERE table_name='event_editions'
--      AND column_name IN ('confidence_score','verification_tier');
--
-- Editions that will be backfilled (expect 38 rows, all with a candidate):
--   SELECT count(*) FROM event_editions WHERE source_candidate_id IS NOT NULL;
--   SELECT count(*) FROM event_editions;
--
-- How many candidates the widened sweep would publish on its first run:
--   SELECT count(*) FROM discovery_candidate_events c
--    WHERE c.candidate_status IN ('pending','needs_review')
--      AND c.publication_recommendation <> 'rejected'
--      AND c.date_confirmed AND c.start_date >= current_date
--      AND coalesce(c.raw_source_values->>'eventStatus','') NOT IN ('cancelled','postponed')
--      AND NOT EXISTS (SELECT 1 FROM discovery_dedupe_links l
--                       WHERE l.candidate_id=c.id AND l.resolution='unresolved');
--   -- ACTUAL on 2026-08-04: 0. Not a mistake — see below.
--
-- WHY THE FIRST SWEEP PUBLISHES NOTHING, and what has to happen first:
--   The 38 candidates that are already 'approved' ARE the current public
--   catalogue, so they are correctly skipped. Every candidate the crawler
--   has found SINCE was scored by the classifier bug fixed in commit
--   1db8844 — it read a fixture-only attribute no real site has, so every
--   live page classified as 'unclassified' and was force-rejected.
--
--   Those stored scores do not heal themselves. Ordering matters:
--     1. Redeploy the Railway worker (there is NO auto-deploy — the
--        GitHub App is not installed on the davewelensky account), so it
--        actually runs the fixed classifier.
--     2. Re-crawl. Re-extraction upserts on (source_id, candidate_key),
--        so candidates are rescored in place rather than duplicated.
--     3. THEN this sweep has something to publish.
--   Applying this migration before step 1 is harmless — it simply
--   publishes nothing until there is something worth publishing.

-- ----------------------------------------------------------------
-- BACKUP — required before any DELETE / UPDATE / DROP / TRUNCATE.
-- ----------------------------------------------------------------
-- The only UPDATE is the backfill of two brand-new columns, which have no
-- prior value to lose. Snapshot the identifying columns anyway so the
-- backfill can be audited after the fact.
CREATE TABLE IF NOT EXISTS _bak_20260804_event_editions AS
  SELECT id, title, start_date, source_candidate_id, now() AS backed_up_at
  FROM event_editions;

-- ----------------------------------------------------------------
-- MIGRATION — applied only after Dave types "apply".
-- ----------------------------------------------------------------
BEGIN;

-- ── 1. Public-facing trust signal ─────────────────────────────────────
ALTER TABLE public.event_editions
  ADD COLUMN IF NOT EXISTS confidence_score smallint
    CHECK (confidence_score IS NULL OR confidence_score BETWEEN 0 AND 100),
  ADD COLUMN IF NOT EXISTS verification_tier text
    CHECK (verification_tier IS NULL OR verification_tier IN ('confirmed','listed','unverified'));

COMMENT ON COLUMN public.event_editions.confidence_score IS
  'Deterministic extraction confidence (0-100) copied from the discovery '
  'candidate that produced this edition. Never an LLM judgement — every '
  'point traces to a named rule in discovery-worker/src/confidence/rules.ts.';
COMMENT ON COLUMN public.event_editions.verification_tier IS
  'User-facing banding of confidence_score: confirmed (>=80), listed '
  '(>=40), unverified (<40). Shown on /explore so a swimmer can see how '
  'well a listing was verified. NULL for hand-entered editions.';

-- ── 2. Fill it automatically, wherever an edition is created ──────────
-- A trigger rather than editing approve_discovery_candidate(): it cannot
-- drift from that function, and it covers manual approvals, the automatic
-- sweep, and any future caller identically.
CREATE OR REPLACE FUNCTION public.set_edition_verification_from_candidate()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_score smallint;
BEGIN
  -- Respect an explicitly supplied value; only fill what is missing.
  IF NEW.confidence_score IS NOT NULL OR NEW.source_candidate_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT confidence_score INTO v_score
    FROM discovery_candidate_events WHERE id = NEW.source_candidate_id;
  IF v_score IS NULL THEN
    RETURN NEW;
  END IF;

  NEW.confidence_score   := v_score;
  NEW.verification_tier  := CASE
                              WHEN v_score >= 80 THEN 'confirmed'
                              WHEN v_score >= 40 THEN 'listed'
                              ELSE 'unverified'
                            END;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_edition_verification ON public.event_editions;
CREATE TRIGGER trg_edition_verification
  BEFORE INSERT ON public.event_editions
  FOR EACH ROW EXECUTE FUNCTION public.set_edition_verification_from_candidate();

-- ── 3. Backfill the editions already published ────────────────────────
UPDATE public.event_editions e
   SET confidence_score  = c.confidence_score,
       verification_tier = CASE
                             WHEN c.confidence_score >= 80 THEN 'confirmed'
                             WHEN c.confidence_score >= 40 THEN 'listed'
                             ELSE 'unverified'
                           END
  FROM public.discovery_candidate_events c
 WHERE e.source_candidate_id = c.id
   AND e.confidence_score IS NULL;

-- ── 4. Widen the automatic publish bar ────────────────────────────────
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
      -- WIDENED 2026-08-04: everything except outright rejection. The
      -- publication_recommendation itself carries the quality signal to
      -- the public page via verification_tier, so a merely thin listing
      -- is published AND labelled rather than withheld.
      AND c.publication_recommendation <> 'rejected'
      -- Correctness guards below are NOT relaxed — see the file header.
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
                     'Auto-published: confirmed future date, not cancelled, no duplicate warnings. '
                     'Trust shown to users via verification_tier.');
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
  'Worker-only bulk publish. Publishes anything not outright rejected that '
  'has a confirmed future date, is not cancelled, and has no unresolved '
  'duplicate. Quality is communicated rather than gated: every edition '
  'carries verification_tier for display. Delegates to '
  'approve_discovery_candidate() so each publish stays atomic, '
  'provenance-linked and audited.';

REVOKE ALL ON FUNCTION public.auto_publish_eligible_candidates(integer) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.set_edition_verification_from_candidate() FROM public, anon, authenticated;

-- ── 4b. Requeue candidates rejected because of the classifier bug ─────
-- Nine real events — Cole Classic, The BIG Welsh Swim, The Big Bala Swim,
-- Epic Lakes Coniston and Ullswater, the Dublin City Liffey Swim,
-- Yorkshire Dales Swim — were reviewed and rejected while every live page
-- was being force-rejected by the fixture-only classifier. Those
-- rejections were decisions about a broken score, not about the events.
--
-- Scoped as tightly as possible: only candidates whose sole review
-- decision predates the fix, and only back to 'pending' so they are
-- re-reviewed rather than published. A genuine human "no" made on
-- correct information is not touched, because after the fix any new
-- rejection has a later timestamp.
--
-- The prior status is preserved in the audit trail by the decision rows
-- already recorded, so this is reversible (see ROLLBACK).
UPDATE public.discovery_candidate_events c
   SET candidate_status = 'pending',
       last_reviewed_at = NULL
 WHERE c.candidate_status = 'rejected'
   AND c.source_id <> '00000000-0000-4000-8000-000000000001'
   -- Only ones scored under the bug: no candidate scored after the fix
   -- can still be sitting on an 'unclassified' force-rejection.
   AND c.extracted_at < timestamptz '2026-08-04 12:00:00+02'
   AND EXISTS (SELECT 1 FROM discovery_review_decisions d
                WHERE d.candidate_id = c.id AND d.decision = 'rejected');

INSERT INTO public.discovery_review_decisions
  (candidate_id, decision, decided_by, notes, previous_status, new_status, metadata)
-- 'returned_for_review' is the permitted decision value for this; the
-- CHECK constraint allows approved / rejected / marked_duplicate /
-- returned_for_review / edited / duplicate_resolved.
SELECT c.id, 'returned_for_review', NULL,
       'Requeued: the original rejection was based on a confidence score produced by the '
       'classifier bug fixed 2026-08-04 (every live page force-rejected as unclassified). '
       'Re-crawl will rescore; the candidate returns to normal review.',
       'rejected', 'pending',
       jsonb_build_object('automatic', true, 'reason', 'classifier_bug_2026_08_04')
  FROM public.discovery_candidate_events c
 WHERE c.candidate_status = 'pending'
   AND c.last_reviewed_at IS NULL
   AND c.source_id <> '00000000-0000-4000-8000-000000000001'
   AND EXISTS (SELECT 1 FROM discovery_review_decisions d
                WHERE d.candidate_id = c.id AND d.decision = 'rejected');

-- ── 5. Surface the tier through the public search RPC ─────────────────
-- The discovery tables are not public-readable, so /explore can only see
-- what this function returns. Two columns appended at the END of the
-- return shape — appending rather than reordering keeps every existing
-- caller working, since explore.html reads results by name.
-- Body is otherwise unchanged from
-- sql/applied/2026-08-03_discovery-rpc-fixes-and-search.sql.
DROP FUNCTION IF EXISTS public.search_event_editions(
  numeric,numeric,integer,date,date,boolean,integer,text,text,integer);

CREATE OR REPLACE FUNCTION public.search_event_editions(
  p_lat numeric DEFAULT NULL, p_lng numeric DEFAULT NULL, p_radius_km integer DEFAULT NULL,
  p_date_from date DEFAULT NULL, p_date_to date DEFAULT NULL, p_weekend_only boolean DEFAULT false,
  p_min_distance_m integer DEFAULT NULL, p_country text DEFAULT NULL,
  p_sort text DEFAULT 'date', p_limit integer DEFAULT 60
)
RETURNS TABLE (
  edition_id uuid, title text, series_name text, prominence text,
  start_date date, end_date date, date_precision text, date_confirmed boolean,
  status text, registration_status text, registration_url text, official_url text,
  venue_name text, city text, region text, country_code text,
  latitude numeric, longitude numeric, distance_km numeric,
  participant_estimate integer, organiser_name text, distances jsonb, max_distance_m integer,
  verification_tier text, confidence_score smallint
)
LANGUAGE sql STABLE SET search_path = public
AS $fn$
  WITH base AS (
    SELECT e.id, e.title, s.display_name AS series_name, s.prominence,
      e.start_date, e.end_date, e.date_precision, e.date_confirmed,
      e.status, e.registration_status, e.registration_url, e.official_url,
      v.display_name AS venue_name, v.city, v.region, v.country_code,
      v.latitude, v.longitude, e.participant_estimate, o.display_name AS organiser_name,
      e.verification_tier, e.confidence_score,
      CASE WHEN p_lat IS NULL OR p_lng IS NULL OR v.latitude IS NULL THEN NULL
        ELSE round((6371 * acos(LEAST(1, GREATEST(-1,
            cos(radians(p_lat))*cos(radians(v.latitude))*cos(radians(v.longitude)-radians(p_lng))
            + sin(radians(p_lat))*sin(radians(v.latitude))))))::numeric, 1) END AS distance_km
    FROM event_editions e
    JOIN event_series s ON s.id = e.series_id
    LEFT JOIN event_venues v ON v.id = e.venue_id
    LEFT JOIN public_organisers o ON o.id = s.organiser_id
    WHERE e.status NOT IN ('cancelled','completed')
      AND (e.start_date IS NULL OR e.start_date >= COALESCE(p_date_from, current_date))
      AND (p_date_to IS NULL OR e.start_date IS NULL OR e.start_date <= p_date_to)
      AND (NOT p_weekend_only OR e.start_date IS NULL OR EXTRACT(DOW FROM e.start_date) IN (0,6))
      AND (p_country IS NULL OR v.country_code = upper(p_country))
      AND (p_min_distance_m IS NULL OR EXISTS (
            SELECT 1 FROM event_distances d WHERE d.edition_id=e.id AND d.distance_metres >= p_min_distance_m))
  )
  SELECT b.id, b.title, b.series_name, b.prominence, b.start_date, b.end_date,
    b.date_precision, b.date_confirmed, b.status, b.registration_status,
    b.registration_url, b.official_url, b.venue_name, b.city, b.region, b.country_code,
    b.latitude, b.longitude, b.distance_km, b.participant_estimate, b.organiser_name,
    COALESCE((SELECT jsonb_agg(jsonb_build_object('label',d.original_label,'metres',d.distance_metres,
              'start_time',d.start_time,'wetsuit',d.wetsuit_policy) ORDER BY d.distance_metres NULLS LAST)
       FROM event_distances d WHERE d.edition_id=b.id), '[]'::jsonb),
    (SELECT max(d.distance_metres) FROM event_distances d WHERE d.edition_id=b.id),
    b.verification_tier, b.confidence_score
  FROM base b
  WHERE p_radius_km IS NULL OR (b.distance_km IS NOT NULL AND b.distance_km <= p_radius_km)
  ORDER BY
    CASE WHEN p_sort='prominence' THEN array_position(ARRAY['iconic','major','regional','local','unknown'], b.prominence) END,
    CASE WHEN p_sort='prominence' THEN b.participant_estimate END DESC NULLS LAST,
    CASE WHEN p_sort='distance' THEN b.distance_km END NULLS LAST,
    b.start_date NULLS LAST
  LIMIT GREATEST(1, LEAST(p_limit, 200));
$fn$;

GRANT EXECUTE ON FUNCTION public.search_event_editions(
  numeric,numeric,integer,date,date,boolean,integer,text,text,integer) TO anon, authenticated;

COMMIT;

-- ----------------------------------------------------------------
-- ROLLBACK — exact SQL to undo.
-- ----------------------------------------------------------------
-- BEGIN;
-- DROP TRIGGER IF EXISTS trg_edition_verification ON public.event_editions;
-- DROP FUNCTION IF EXISTS public.set_edition_verification_from_candidate();
-- ALTER TABLE public.event_editions
--   DROP COLUMN IF EXISTS confidence_score,
--   DROP COLUMN IF EXISTS verification_tier;
-- -- Narrow the sweep back to the conservative tier:
-- --   re-apply the auto_publish_eligible_candidates body from
-- --   sql/2026-08-03_auto-publish-high-confidence.sql
-- COMMIT;
--
-- To undo ONLY the requeue in step 4b (put those 9 back to rejected):
-- UPDATE discovery_candidate_events c SET candidate_status='rejected'
--  WHERE c.candidate_status='pending'
--    AND EXISTS (SELECT 1 FROM discovery_review_decisions d
--                 WHERE d.candidate_id=c.id AND d.decision='returned_for_review'
--                   AND d.metadata->>'reason'='classifier_bug_2026_08_04');
--
-- NOTE: rolling back does NOT withdraw editions already auto-published.
-- To withdraw one, delete the event_editions row (its candidate reverts
-- via ON DELETE SET NULL) and set that candidate back to 'pending'.

-- ----------------------------------------------------------------
-- VERIFY — run on the READ-ONLY connection AFTER applying.
-- ----------------------------------------------------------------
-- SELECT count(*) FROM information_schema.columns
--  WHERE table_name='event_editions'
--    AND column_name IN ('confidence_score','verification_tier');   -- expect: 2
--
-- SELECT verification_tier, count(*), min(confidence_score), max(confidence_score)
--   FROM event_editions GROUP BY 1 ORDER BY 2 DESC;
--   -- expect every backfilled edition banded; NULL only for hand-entered ones
--
-- SELECT count(*) FROM information_schema.routine_privileges
--  WHERE routine_name IN ('auto_publish_eligible_candidates',
--                         'set_edition_verification_from_candidate')
--    AND grantee IN ('anon','authenticated');                        -- expect: 0
--
-- Automatic vs human publishes stay distinguishable in the audit trail:
-- SELECT decision, decided_by IS NULL AS automatic, count(*)
--   FROM discovery_review_decisions GROUP BY 1,2;
