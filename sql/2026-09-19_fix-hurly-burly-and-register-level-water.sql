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
-- Migration: 2026-09-19_fix-hurly-burly-and-register-level-water.sql
-- Process:   see MIGRATIONS.md — no section below may be left empty
-- STATUS:    ⛔ PROPOSED — NOT YET APPLIED. Awaiting Dave's review and
--            the literal word "apply" per MIGRATIONS.md step 4.
-- ================================================================

-- Purpose:
--   Dave asked whether Level Water's swim events (levelwater.org/swim-events)
--   show up on our /explore. They mostly don't, and what little we had was
--   broken:
--
--   1. "Hurly Burly" exists as THREE separate discovery_candidate_events
--      (found ad hoc via a manual "UK & Ireland open water — organiser
--      sites" research bucket on 3/5/26 Aug 2026, never via a real
--      discovery_sources row) which promoted into TWO real duplicates:
--        - hurly-burly-2026 + hurly-burly-2027 (series "Hurly Burly",
--          f240db57-...) — organiser NULL, venue = generic "North Wales"
--        - hurly-burly-bwrlwm-bermo-2026 (separate series "Hurly Burly
--          (Bwrlwm Bermo)", 18f39ac9-...) — SAME real 2026 event, but with
--          correct data: organiser Level Water, precise venue "Mawddach
--          Estuary, Barmouth"
--      This migration merges them: the precise venue moves onto the
--      surviving "Hurly Burly" series (fixing BOTH its 2026 and 2027
--      editions in one update), the duplicate edition+series is deleted
--      (verified 19 Sep 2026: 0 swimmer_event_entries, 0
--      event_interest_counts, 0 event_distances on the row being deleted —
--      nothing user-facing is lost).
--   2. hurly-burly-2027 (the one edition actually visible on /explore)
--      had a fabricated-precision date: start_date 2027-01-01, end_date
--      2027-12-31, date_precision='year', date_confirmed=true — claiming
--      the whole year is "confirmed" when the organiser's own site (live-
--      checked 19 Sep 2026) says "Autumn 2027 — Coming Soon: 2027 Swimmer
--      Info", i.e. genuinely not yet dated. The schema's own
--      event_editions_unconfirmed_has_no_dates constraint means the
--      honest fix is date_confirmed=false with both dates NULL (status
--      stays 'announced' — "coming, no date yet" — rather than either
--      deleting the whole edition or keeping a fabricated date range).
--   3. Level Water's organiser record (b4a20281-...) had official_url and
--      country_code both NULL despite being resolvable — filled in from
--      the live site.
--   4. No discovery_sources row exists for Level Water at all — that's
--      *why* every other one of their events (Dart 10K, Bantham Swoosh &
--      Boomerang, plus the past-season Watersedge/Shepperton/Ellerton/
--      Canary Wharf/Jesus Green series that will presumably recur) was
--      never found: nobody ever pointed the crawler at their real events
--      index. https://www.levelwater.org/swim-events (what Dave linked)
--      404s; the real listing page, confirmed live 19 Sep 2026, is
--      https://www.levelwater.org/swim-events-1. Registers it as a
--      standard 'organiser'/'jsonld_html' source (same shape as Oceanman,
--      Midmar Mile, etc.) so it gets picked up on the worker's normal
--      schedule — this migration does NOT itself trigger a crawl.

-- Requested by:
--   Dave, 19 Sept 2026

-- ----------------------------------------------------------------
-- PRE-CHECKS — run on the READ-ONLY connection BEFORE applying.
-- ----------------------------------------------------------------
-- SELECT id, slug, series_id, venue_id FROM event_editions
--   WHERE id IN ('faf4f970-9848-4c37-b1e5-c969d718a375','9339eb90-4573-4cf4-afd9-95d6e0a6a0da','43c79c23-2eaa-4579-abca-922203e23635');
--   -- ran 19 Sep 2026: confirms the 3-way duplicate described above
-- SELECT count(*) FROM swimmer_event_entries WHERE edition_id = '43c79c23-2eaa-4579-abca-922203e23635';
-- SELECT count(*) FROM event_interest_counts WHERE edition_id = '43c79c23-2eaa-4579-abca-922203e23635';
-- SELECT count(*) FROM event_distances WHERE edition_id = '43c79c23-2eaa-4579-abca-922203e23635';
--   -- ran 19 Sep 2026: all three = 0 — safe to delete, nothing user-facing lost
-- SELECT count(*) FROM discovery_sources WHERE base_url ILIKE '%levelwater%';
--   -- ran 19 Sep 2026: 0 — confirms no source row exists yet

-- ----------------------------------------------------------------
-- BACKUP — required before any DELETE / UPDATE / DROP / TRUNCATE.
-- ----------------------------------------------------------------
CREATE TABLE _bak_20260919_event_editions AS SELECT * FROM event_editions WHERE id IN (
  'faf4f970-9848-4c37-b1e5-c969d718a375', '9339eb90-4573-4cf4-afd9-95d6e0a6a0da', '43c79c23-2eaa-4579-abca-922203e23635'
);
CREATE TABLE _bak_20260919_event_series AS SELECT * FROM event_series WHERE id IN (
  'f240db57-5388-4fd9-b86b-73fbc714dbca', '18f39ac9-e83c-49a7-ba8c-2c3af89e322f'
);
CREATE TABLE _bak_20260919_event_organisers AS SELECT * FROM event_organisers WHERE id = 'b4a20281-a7af-4d7b-9b22-cb292c67adf8';

-- ----------------------------------------------------------------
-- MIGRATION — applied only after Dave types "apply".
-- ----------------------------------------------------------------
BEGIN;

-- 1. Attach the real organiser to the surviving "Hurly Burly" series
--    (fixes organiser on BOTH its 2026 and 2027 editions at once).
UPDATE event_series
SET organiser_id = 'b4a20281-a7af-4d7b-9b22-cb292c67adf8', updated_at = now()
WHERE id = 'f240db57-5388-4fd9-b86b-73fbc714dbca';

-- 2. Repoint both editions from the generic "North Wales" venue to the
--    precise one already on file (Mawddach Estuary, Barmouth).
UPDATE event_editions
SET venue_id = '8f684f1c-af54-4c85-b080-085f8ae7e621', updated_at = now()
WHERE id IN ('faf4f970-9848-4c37-b1e5-c969d718a375', '9339eb90-4573-4cf4-afd9-95d6e0a6a0da');

-- 3. Fix the 2027 edition's fabricated-precision date — honest
--    "announced, not yet dated" beats a wrong whole-year range.
UPDATE event_editions
SET date_confirmed = false,
    start_date = NULL,
    end_date = NULL,
    date_precision = 'unknown',
    status = 'announced',
    registration_status = 'not_open',
    verification_tier = 'listed',
    updated_at = now()
WHERE id = '9339eb90-4573-4cf4-afd9-95d6e0a6a0da';

-- 4. Delete the now-redundant duplicate edition + its series (the
--    discovery_candidate_events.promoted_edition_id pointing at it is
--    ON DELETE SET NULL, so the source candidate record itself is
--    preserved, just no longer marked "promoted").
DELETE FROM event_editions WHERE id = '43c79c23-2eaa-4579-abca-922203e23635';
DELETE FROM event_series WHERE id = '18f39ac9-e83c-49a7-ba8c-2c3af89e322f';

-- 5. Fill in the two real, verifiable facts about Level Water that were
--    sitting NULL on their organiser record.
UPDATE event_organisers
SET official_url = 'https://www.levelwater.org',
    country_code = 'GB',
    updated_at = now()
WHERE id = 'b4a20281-a7af-4d7b-9b22-cb292c67adf8';

-- 6. Register Level Water as a real, scheduled discovery source — same
--    shape as the other working organiser sources (Oceanman, Midmar
--    Mile). /swim-events (what Dave linked) 404s; /swim-events-1 is the
--    real listing page, confirmed live.
INSERT INTO discovery_sources (
  name, base_url, source_type, authority_level, country_code, parser_type, enabled, crawl_frequency
) VALUES (
  'Level Water — swim events', 'https://www.levelwater.org/swim-events-1',
  'organiser', 5, 'GB', 'jsonld_html', true, 'weekly'
);

COMMIT;

-- ----------------------------------------------------------------
-- ROLLBACK — exact SQL to undo, or state:
-- "irreversible — restore from _bak_YYYYMMDD_tablename"
-- ----------------------------------------------------------------
-- BEGIN;
-- DELETE FROM discovery_sources WHERE base_url = 'https://www.levelwater.org/swim-events-1';
-- INSERT INTO event_series SELECT * FROM _bak_20260919_event_series WHERE id = '18f39ac9-e83c-49a7-ba8c-2c3af89e322f';
-- INSERT INTO event_editions SELECT * FROM _bak_20260919_event_editions WHERE id = '43c79c23-2eaa-4579-abca-922203e23635';
-- UPDATE event_editions e SET venue_id = b.venue_id, updated_at = b.updated_at
--   FROM _bak_20260919_event_editions b WHERE e.id = b.id AND e.id IN ('faf4f970-9848-4c37-b1e5-c969d718a375','9339eb90-4573-4cf4-afd9-95d6e0a6a0da');
-- UPDATE event_editions e SET date_confirmed = b.date_confirmed, start_date = b.start_date, end_date = b.end_date,
--   date_precision = b.date_precision, status = b.status, registration_status = b.registration_status, verification_tier = b.verification_tier
--   FROM _bak_20260919_event_editions b WHERE e.id = b.id AND e.id = '9339eb90-4573-4cf4-afd9-95d6e0a6a0da';
-- UPDATE event_series SET organiser_id = NULL WHERE id = 'f240db57-5388-4fd9-b86b-73fbc714dbca';
-- UPDATE event_organisers e SET official_url = b.official_url, country_code = b.country_code
--   FROM _bak_20260919_event_organisers b WHERE e.id = b.id;
-- COMMIT;

-- ----------------------------------------------------------------
-- VERIFY — run on the READ-ONLY connection AFTER applying.
-- ----------------------------------------------------------------
-- SELECT count(*) FROM event_editions WHERE id = '43c79c23-2eaa-4579-abca-922203e23635'; -- expect 0
-- SELECT count(*) FROM event_series WHERE id = '18f39ac9-e83c-49a7-ba8c-2c3af89e322f'; -- expect 0
-- SELECT ee.slug, eo.display_name AS organiser, ev.display_name AS venue, ee.date_confirmed, ee.start_date, ee.status, ee.verification_tier
--   FROM event_editions ee LEFT JOIN event_series es ON es.id = ee.series_id LEFT JOIN event_organisers eo ON eo.id = es.organiser_id
--   LEFT JOIN event_venues ev ON ev.id = ee.venue_id WHERE ee.id IN ('faf4f970-9848-4c37-b1e5-c969d718a375','9339eb90-4573-4cf4-afd9-95d6e0a6a0da');
--   -- expect both rows: organiser 'Level Water', venue 'Mawddach Estuary, Barmouth';
--   -- 2027 row: date_confirmed=false, start_date NULL, status 'announced', verification_tier 'listed'
-- SELECT name, base_url, enabled, crawl_frequency FROM discovery_sources WHERE base_url ILIKE '%levelwater%';
--   -- expect exactly 1 row, enabled=true
