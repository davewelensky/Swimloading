-- ================================================================
-- SwimLoading — Global Swim Discovery Phase 2 — CONSTRAINT TESTS
--
-- Companion to sql/2026-08-03_discovery-schema-v1.sql. Run this ONLY
-- AFTER that migration has been applied.
--
-- ⚠️  SAFETY: this script runs entirely inside a transaction that ends
--     in ROLLBACK. It creates temporary test rows and throws them away.
--     It NEVER commits. It touches no existing table — only the 13 new
--     tables the Phase 2 migration created.
--
--     Every test asserts that an INVALID row is REJECTED. If a test
--     "fails", it means the database ACCEPTED data it should have
--     refused — i.e. a missing constraint, not a broken test.
--
-- Usage:
--     psql "$DATABASE_URL" -f sql/2026-08-03_discovery-schema-v1-tests.sql
--   or paste into the Supabase SQL editor.
--
-- STATUS: ⛔ NOT YET RUN — the migration it tests is not yet applied.
-- ================================================================

-- ⚠️  SAFETY CHECK — wrong project aborts everything
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM _project_identity
    WHERE key = 'project_name' AND value = 'swimloading'
  ) THEN
    RAISE EXCEPTION 'WRONG PROJECT — TESTS ABORTED. Expected ref szgkzuswelntnevobnoh';
  END IF;
END $$;

BEGIN;

-- ── Fixtures: minimal valid rows the invalid-row tests hang off ──────
INSERT INTO public.event_organisers (id, canonical_name, display_name)
VALUES ('11111111-1111-1111-1111-111111111111', 'test organiser', 'Test Organiser');

INSERT INTO public.event_venues (id, canonical_name, display_name, latitude, longitude)
VALUES ('22222222-2222-2222-2222-222222222222', 'test venue', 'Test Venue', 54.366700, -2.916700);

INSERT INTO public.event_series (id, canonical_name, display_name, organiser_id)
VALUES ('33333333-3333-3333-3333-333333333333', 'test series', 'Test Series',
        '11111111-1111-1111-1111-111111111111');

INSERT INTO public.event_editions (id, series_id, venue_id, edition_year, start_date, date_precision, date_confirmed, status)
VALUES ('44444444-4444-4444-4444-444444444444', '33333333-3333-3333-3333-333333333333',
        '22222222-2222-2222-2222-222222222222', 2027, DATE '2027-06-12', 'exact', true, 'announced');

INSERT INTO public.discovery_sources (id, name, base_url, source_type)
VALUES ('55555555-5555-5555-5555-555555555555', 'test source',
        'https://test-source.invalid', 'organiser');

INSERT INTO public.discovery_candidate_events (id, candidate_key, source_id, source_url)
VALUES ('66666666-6666-6666-6666-666666666666', 'test-key-1',
        '55555555-5555-5555-5555-555555555555', 'https://test-source.invalid/event');

INSERT INTO public.discovery_candidate_events (id, candidate_key, source_id, source_url)
VALUES ('77777777-7777-7777-7777-777777777777', 'test-key-2',
        '55555555-5555-5555-5555-555555555555', 'https://test-source.invalid/event-2');

-- ── Test harness ─────────────────────────────────────────────────────
-- Each test runs one INSERT that MUST be rejected. If the insert
-- succeeds, we raise a distinct P0001 error that is NOT caught by the
-- inner handler, aborting the whole script loudly.

-- TEST 1 — invalid latitude (out of range) on a venue
DO $$
BEGIN
  BEGIN
    INSERT INTO public.event_venues (canonical_name, display_name, latitude, longitude)
    VALUES ('bad lat', 'Bad Lat', 95.000000, 0.000000);
    RAISE EXCEPTION 'TEST 1 FAILED: latitude 95 was accepted';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'PASS  1 — invalid latitude rejected';
  END;
END $$;

-- TEST 1b — a lone latitude with no longitude (coords must be paired)
DO $$
BEGIN
  BEGIN
    INSERT INTO public.event_venues (canonical_name, display_name, latitude)
    VALUES ('half coords', 'Half Coords', 54.000000);
    RAISE EXCEPTION 'TEST 1b FAILED: latitude without longitude was accepted';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'PASS  1b — unpaired coordinates rejected';
  END;
END $$;

-- TEST 2 — invalid date range (end_date before start_date) on an edition
DO $$
BEGIN
  BEGIN
    INSERT INTO public.event_editions (series_id, edition_year, start_date, end_date, date_confirmed, date_precision)
    VALUES ('33333333-3333-3333-3333-333333333333', 2028,
            DATE '2028-06-12', DATE '2028-06-10', true, 'range');
    RAISE EXCEPTION 'TEST 2 FAILED: end_date before start_date was accepted';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'PASS  2 — reversed date range rejected';
  END;
END $$;

-- TEST 2b — the anti-inference rule: unconfirmed date may not carry dates
DO $$
BEGIN
  BEGIN
    INSERT INTO public.event_editions (series_id, edition_year, start_date, date_confirmed, date_precision)
    VALUES ('33333333-3333-3333-3333-333333333333', 2029,
            DATE '2029-06-12', false, 'unknown');
    RAISE EXCEPTION 'TEST 2b FAILED: unconfirmed edition with a concrete start_date was accepted';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'PASS  2b — unconfirmed date with a concrete value rejected (no year inference)';
  END;
END $$;

-- TEST 3 — invalid confidence score (>100) on a candidate
DO $$
BEGIN
  BEGIN
    INSERT INTO public.discovery_candidate_events (candidate_key, source_id, source_url, confidence_score)
    VALUES ('bad-confidence', '55555555-5555-5555-5555-555555555555',
            'https://test-source.invalid/x', 150);
    RAISE EXCEPTION 'TEST 3 FAILED: confidence_score 150 was accepted';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'PASS  3 — out-of-range confidence_score rejected';
  END;
END $$;

-- TEST 4 — promoted_edition_id set while candidate_status is NOT approved.
--
-- NOTE on the deliberately one-directional constraint: the schema enforces
-- "promoted implies approved", NOT the reverse. An 'approved' candidate
-- with a NULL promoted_edition_id is intentionally still legal, because
-- event_editions.id is referenced ON DELETE SET NULL — a biconditional
-- CHECK would make deleting any published edition fail with a confusing
-- check violation on a completely different table. The approved-therefore-
-- promoted direction is guaranteed instead by the future atomic approval
-- RPC, which performs both writes in one transaction.
DO $$
BEGIN
  BEGIN
    INSERT INTO public.discovery_candidate_events
      (candidate_key, source_id, source_url, candidate_status, promoted_edition_id)
    VALUES ('bad-promotion', '55555555-5555-5555-5555-555555555555',
            'https://test-source.invalid/y', 'pending',
            '44444444-4444-4444-4444-444444444444');
    RAISE EXCEPTION 'TEST 4 FAILED: pending candidate with a promoted_edition_id was accepted';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'PASS  4 — promotion without approval rejected';
  END;
END $$;

-- TEST 5a — dedupe link pointing at BOTH a candidate and an edition
DO $$
BEGIN
  BEGIN
    INSERT INTO public.discovery_dedupe_links
      (candidate_id, matching_candidate_id, matching_edition_id, similarity_score)
    VALUES ('66666666-6666-6666-6666-666666666666',
            '77777777-7777-7777-7777-777777777777',
            '44444444-4444-4444-4444-444444444444', 80);
    RAISE EXCEPTION 'TEST 5a FAILED: dedupe link with two targets was accepted';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'PASS  5a — dedupe link with both targets rejected';
  END;
END $$;

-- TEST 5b — dedupe link pointing at NEITHER
DO $$
BEGIN
  BEGIN
    INSERT INTO public.discovery_dedupe_links (candidate_id, similarity_score)
    VALUES ('66666666-6666-6666-6666-666666666666', 80);
    RAISE EXCEPTION 'TEST 5b FAILED: dedupe link with no target was accepted';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'PASS  5b — dedupe link with no target rejected';
  END;
END $$;

-- TEST 5c — a candidate matching itself
DO $$
BEGIN
  BEGIN
    INSERT INTO public.discovery_dedupe_links
      (candidate_id, matching_candidate_id, similarity_score)
    VALUES ('66666666-6666-6666-6666-666666666666',
            '66666666-6666-6666-6666-666666666666', 100);
    RAISE EXCEPTION 'TEST 5c FAILED: self-referential dedupe link was accepted';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'PASS  5c — self-match rejected';
  END;
END $$;

-- TEST 5d — resolved link missing its resolver/timestamp pair
DO $$
BEGIN
  BEGIN
    INSERT INTO public.discovery_dedupe_links
      (candidate_id, matching_candidate_id, similarity_score, resolution)
    VALUES ('66666666-6666-6666-6666-666666666666',
            '77777777-7777-7777-7777-777777777777', 90, 'confirmed_duplicate');
    RAISE EXCEPTION 'TEST 5d FAILED: resolved link with no resolved_at was accepted';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'PASS  5d — resolved link without resolved_at rejected';
  END;
END $$;

-- TEST 6 — negative distance on a published distance option
DO $$
BEGIN
  BEGIN
    INSERT INTO public.event_distances (edition_id, original_label, distance_metres)
    VALUES ('44444444-4444-4444-4444-444444444444', 'Negative Swim', -500);
    RAISE EXCEPTION 'TEST 6 FAILED: negative distance_metres was accepted';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'PASS  6 — negative distance rejected';
  END;
END $$;

-- TEST 6b — negative distance on a CANDIDATE distance option
DO $$
BEGIN
  BEGIN
    INSERT INTO public.discovery_candidate_distances (candidate_id, original_label, distance_metres)
    VALUES ('66666666-6666-6666-6666-666666666666', 'Negative Candidate Swim', -1);
    RAISE EXCEPTION 'TEST 6b FAILED: negative candidate distance_metres was accepted';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'PASS  6b — negative candidate distance rejected';
  END;
END $$;

-- TEST 7 — inconsistent price fields (amount with no currency)
DO $$
BEGIN
  BEGIN
    INSERT INTO public.event_distances (edition_id, original_label, price_amount)
    VALUES ('44444444-4444-4444-4444-444444444444', 'Priced Swim', 45.00);
    RAISE EXCEPTION 'TEST 7 FAILED: price_amount without price_currency was accepted';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'PASS  7 — unpaired price amount rejected';
  END;
END $$;

-- TEST 7b — malformed currency code
DO $$
BEGIN
  BEGIN
    INSERT INTO public.event_distances (edition_id, original_label, price_amount, price_currency)
    VALUES ('44444444-4444-4444-4444-444444444444', 'Bad Currency Swim', 45.00, 'pounds');
    RAISE EXCEPTION 'TEST 7b FAILED: currency "pounds" was accepted';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'PASS  7b — malformed currency code rejected';
  END;
END $$;

-- TEST 8 — duplicate candidate_key within the same source
DO $$
BEGIN
  BEGIN
    INSERT INTO public.discovery_candidate_events (candidate_key, source_id, source_url)
    VALUES ('test-key-1', '55555555-5555-5555-5555-555555555555',
            'https://test-source.invalid/duplicate');
    RAISE EXCEPTION 'TEST 8 FAILED: duplicate (source_id, candidate_key) was accepted';
  EXCEPTION WHEN unique_violation THEN
    RAISE NOTICE 'PASS  8 — duplicate candidate_key within a source rejected';
  END;
END $$;

-- TEST 8b — the SAME candidate_key under a DIFFERENT source must be
-- ALLOWED (two sources describing one real event are two legitimate
-- candidates; that relationship belongs in discovery_dedupe_links).
DO $$
DECLARE
  v_other_source uuid;
BEGIN
  INSERT INTO public.discovery_sources (name, base_url, source_type)
  VALUES ('second test source', 'https://other-source.invalid', 'aggregator')
  RETURNING id INTO v_other_source;

  INSERT INTO public.discovery_candidate_events (candidate_key, source_id, source_url)
  VALUES ('test-key-1', v_other_source, 'https://other-source.invalid/event');

  RAISE NOTICE 'PASS  8b — same candidate_key under a different source accepted';
EXCEPTION WHEN unique_violation THEN
  RAISE EXCEPTION 'TEST 8b FAILED: candidate_key uniqueness is global, not per-source';
END $$;

-- TEST 9 — duplicate edition guard: same series + year + venue
DO $$
BEGIN
  BEGIN
    INSERT INTO public.event_editions (series_id, venue_id, edition_year, date_confirmed, date_precision)
    VALUES ('33333333-3333-3333-3333-333333333333',
            '22222222-2222-2222-2222-222222222222', 2027, false, 'unknown');
    RAISE EXCEPTION 'TEST 9 FAILED: duplicate series+year+venue edition was accepted';
  EXCEPTION WHEN unique_violation THEN
    RAISE NOTICE 'PASS  9 — duplicate edition (same series/year/venue) rejected';
  END;
END $$;

-- TEST 9b — same series + year at a DIFFERENT venue must be ALLOWED
DO $$
DECLARE
  v_other_venue uuid;
BEGIN
  INSERT INTO public.event_venues (canonical_name, display_name)
  VALUES ('second venue', 'Second Venue')
  RETURNING id INTO v_other_venue;

  INSERT INTO public.event_editions (series_id, venue_id, edition_year, date_confirmed, date_precision)
  VALUES ('33333333-3333-3333-3333-333333333333', v_other_venue, 2027, false, 'unknown');

  RAISE NOTICE 'PASS  9b — same series/year at a different venue accepted';
EXCEPTION WHEN unique_violation THEN
  RAISE EXCEPTION 'TEST 9b FAILED: two same-year editions at different venues were incorrectly blocked';
END $$;

-- TEST 10 — public_organisers view excludes contact columns entirely
DO $$
DECLARE
  v_bad_cols int;
BEGIN
  SELECT count(*) INTO v_bad_cols
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'public_organisers'
    AND column_name IN ('email', 'phone');

  IF v_bad_cols > 0 THEN
    RAISE EXCEPTION 'TEST 10 FAILED: public_organisers exposes % contact column(s)', v_bad_cols;
  END IF;
  RAISE NOTICE 'PASS 10 — public_organisers exposes no email/phone column';
END $$;

-- TEST 10b — the view hides non-active organisers
DO $$
DECLARE
  v_archived_id uuid;
  v_visible     int;
BEGIN
  INSERT INTO public.event_organisers (canonical_name, display_name, status, email)
  VALUES ('archived org', 'Archived Org', 'archived', 'hidden@example.invalid')
  RETURNING id INTO v_archived_id;

  SELECT count(*) INTO v_visible
  FROM public.public_organisers WHERE id = v_archived_id;

  IF v_visible <> 0 THEN
    RAISE EXCEPTION 'TEST 10b FAILED: an archived organiser is visible through public_organisers';
  END IF;
  RAISE NOTICE 'PASS 10b — archived organiser hidden from public_organisers';
END $$;

-- TEST 10c — the view DOES show active organisers
DO $$
DECLARE
  v_visible int;
BEGIN
  SELECT count(*) INTO v_visible
  FROM public.public_organisers
  WHERE id = '11111111-1111-1111-1111-111111111111';

  IF v_visible <> 1 THEN
    RAISE EXCEPTION 'TEST 10c FAILED: an active organiser is NOT visible through public_organisers';
  END IF;
  RAISE NOTICE 'PASS 10c — active organiser visible through public_organisers';
END $$;

DO $$ BEGIN RAISE NOTICE '--- ALL CONSTRAINT TESTS PASSED ---'; END $$;

-- ⚠️  ALWAYS ROLLBACK. This script must never commit test data.
ROLLBACK;
