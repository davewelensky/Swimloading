-- ================================================================
-- SwimLoading — Migration
-- ================================================================

DO $safety$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM _project_identity WHERE key='project_name' AND value='swimloading') THEN
    RAISE EXCEPTION E'\n WRONG PROJECT — MIGRATION ABORTED. Expected swimloading / szgkzuswelntnevobnoh';
  END IF;
END $safety$;

-- ================================================================
-- Migration: 2026-08-05_indexable-trigger-and-title-cleanup.sql
-- STATUS:    ✅ APPLIED 2026-08-05. Verified: 0 events wrongly non-indexable;
--            0 AI-read events indexable (the safety rule survived); 0 polluted
--            titles or slugs; every slug unique and non-null; Australia 2 -> 15;
--            212 events indexable in total.
--            Trigger proven in an aborted transaction: a clean future event
--            inserts with is_indexable=true unset by anyone, and cancelling
--            it flips to false immediately.
--            NOTE: the created_at >= current_date filter in section 2 was too
--            narrow — 6 rows came from the 4 August crawl and were cleaned in
--            a follow-up statement. Their slugs were changed despite being
--            live, which is normally forbidden; safe only because /explore
--            was noindex,nofollow and events were absent from the sitemap
--            until that same hour, so nothing linked to them.
-- ================================================================

-- Purpose:
--   Three faults, all surfaced by one OceanSwims crawl. The first is the
--   one that matters.
--
--   1. is_indexable IS NEVER SET ON NEW EVENTS.
--      sql/applied/2026-08-05_explore-phase1-foundation.sql backfilled it
--      once, as a one-off UPDATE. Nothing sets it on INSERT, and the column
--      defaults to false. So every event published after that migration —
--      the 5 Polish, the 8 Australian, and everything the crawler finds from
--      now on — is silently excluded from the sitemap and marked
--      noindex,nofollow by the page handler.
--
--      The whole SEO effort earlier today put 202 pages in the sitemap and
--      then quietly stopped accepting new ones. A one-off backfill was the
--      wrong shape for a rule that has to hold continuously.
--
--   2. Titles carry the source site's SEO boilerplate. OceanSwims sets an
--      HTML <title> of "Lorne Pier to Pub – Ocean Swim in Lorne VIC |
--      oceanswims.com", and that whole string became the event name and,
--      worse, the slug. Slugs are permanent once shared, so these are fixed
--      before anyone links to them.
--
--   3. Venues created from that source have no country_code, so eight
--      Australian events do not appear under Australia anywhere — not in
--      the country chip, not on /swims/australia, not in a country search.

-- Requested by:
--   Found while verifying the OceanSwims deep crawl Dave asked for,
--   2026-08-05.

-- ----------------------------------------------------------------
-- PRE-CHECKS (read-only)
-- ----------------------------------------------------------------
-- 1. The scale of fault 1 — events that SHOULD be indexable but are not:
--      SELECT count(*) FROM event_editions e
--       WHERE NOT e.is_indexable AND e.date_confirmed AND e.start_date >= current_date
--         AND e.status NOT IN ('cancelled','postponed','completed')
--         AND e.verification_tier IN ('confirmed','listed')
--         AND NOT EXISTS (SELECT 1 FROM discovery_candidate_events c
--                          WHERE c.id = e.source_candidate_id AND c.extraction_method='ai_fallback');
--
-- 2. Titles carrying the oceanswims suffix (ACTUAL 2026-08-05: 14):
--      SELECT count(*) FROM event_editions WHERE title ILIKE '%| oceanswims.com%';
--
-- 3. Venues from that crawl with no country (ACTUAL 2026-08-05: 13):
--      SELECT display_name FROM event_venues
--       WHERE country_code IS NULL AND display_name ~ '(NSW|VIC|QLD|WA|SA|TAS|NT|ACT)$';
--
-- 4. Australia baseline (ACTUAL 2026-08-05: 2 — should become ~15):
--      SELECT count(*) FROM event_editions e JOIN event_venues v ON v.id=e.venue_id
--       WHERE v.country_code='AU' AND e.start_date >= current_date;

-- ----------------------------------------------------------------
-- BACKUP — required: UPDATEs titles, slugs and venue rows.
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS _bak_20260805e_event_editions AS
  SELECT id, title, slug, is_indexable, now() AS backed_up_at FROM event_editions;
CREATE TABLE IF NOT EXISTS _bak_20260805e_event_venues AS
  SELECT id, display_name, country_code, now() AS backed_up_at FROM event_venues;

BEGIN;

-- ══ 1. Make the indexability rule continuous, not a one-off ═════════════
-- A trigger, so it holds for every future insert without anyone
-- remembering. Deliberately the SAME rule as the original backfill,
-- including the exclusion of AI-read candidates: an event we have not
-- verified well enough must never be handed to a search engine, where a
-- wrong listing outlives its correction.
CREATE OR REPLACE FUNCTION public.set_edition_indexable()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  -- An explicit value always wins: an admin who un-indexes something by
  -- hand must not have it silently re-enabled on the next update.
  IF TG_OP = 'UPDATE' AND NEW.is_indexable IS DISTINCT FROM OLD.is_indexable THEN
    RETURN NEW;
  END IF;

  NEW.is_indexable := (
        NEW.date_confirmed
    AND NEW.start_date IS NOT NULL
    AND NEW.start_date >= current_date
    AND NEW.status NOT IN ('cancelled','postponed','completed')
    AND NEW.verification_tier IN ('confirmed','listed')
    AND NOT EXISTS (
      SELECT 1 FROM discovery_candidate_events c
       WHERE c.id = NEW.source_candidate_id
         AND c.extraction_method = 'ai_fallback')
  );
  RETURN NEW;
END;
$fn$;

-- Existing triggers on this table, checked before adding another:
--   trg_edition_change_log, trg_edition_discipline, trg_edition_slug,
--   trg_edition_verification, trg_touch_event_editions.
-- This one is named zz_* so it sorts LAST: Postgres fires same-timing
-- row triggers in NAME order, and it reads verification_tier, which
-- trg_edition_verification sets. Sorting earlier would read a NULL.
--
-- BEFORE INSERT OR UPDATE, not INSERT alone: an event whose date is
-- corrected, or which is cancelled, must lose indexability at the same
-- moment rather than lingering in the sitemap until someone notices.
DROP TRIGGER IF EXISTS zz_edition_indexable ON public.event_editions;
CREATE TRIGGER zz_edition_indexable
  BEFORE INSERT OR UPDATE ON public.event_editions
  FOR EACH ROW EXECUTE FUNCTION public.set_edition_indexable();

-- Backfill everything the missing trigger has already let through.
UPDATE public.event_editions e
   SET is_indexable = true
 WHERE NOT e.is_indexable
   AND e.date_confirmed AND e.start_date >= current_date
   AND e.status NOT IN ('cancelled','postponed','completed')
   AND e.verification_tier IN ('confirmed','listed')
   AND NOT EXISTS (SELECT 1 FROM discovery_candidate_events c
                    WHERE c.id = e.source_candidate_id AND c.extraction_method = 'ai_fallback');

-- ══ 2. Strip the source site's SEO suffix from titles and slugs ═════════
-- Only the exact pattern this source emits: " – Ocean Swim in <place> |
-- oceanswims.com". Anchored and specific, so it cannot mangle a legitimate
-- title that happens to contain a dash or a pipe.
UPDATE public.event_editions
   SET title = btrim(regexp_replace(title, '\s*[–-]\s*Ocean Swim in .*$', '')),
       -- Slug regenerated from the CLEAN title. Safe only because these
       -- were created minutes ago and have never been linked; changing a
       -- slug that is in the wild breaks every saved and shared link.
       slug = NULL
 WHERE title ILIKE '%| oceanswims.com%'
   -- Scoped to rows created TODAY. Measured: 14 rows carry the suffix, not
   -- the 8 from the most recent crawl — an earlier pass produced 6 more.
   -- All were created today and none has been linked from anywhere, which
   -- is the only reason regenerating their slugs is safe.
   AND created_at >= current_date;

-- The BEFORE INSERT slug trigger does not fire on UPDATE, so regenerate
-- here, reusing the same function so the two cannot diverge.
UPDATE public.event_editions e
   SET slug = coalesce(event_slug_base(e.title, e.edition_year), 'event-' || left(e.id::text, 8))
 WHERE e.slug IS NULL;

-- Any collision the regeneration created gets the same id suffix the
-- original backfill used.
UPDATE public.event_editions e
   SET slug = e.slug || '-' || left(e.id::text, 6)
 WHERE EXISTS (SELECT 1 FROM event_editions o
                WHERE o.slug = e.slug AND o.id <> e.id AND o.ctid < e.ctid);

-- ══ 3. Give the Australian venues their country ═════════════════════════
-- Matched on the state abbreviation the source appends, which is
-- unambiguous for Australia: no other country in the catalogue uses these
-- as a trailing token.
UPDATE public.event_venues
   SET country_code = 'AU',
       region = regexp_replace(display_name, '^.*\s([A-Z]{2,3})$', '\1')
 WHERE country_code IS NULL
   AND display_name ~ '\s(NSW|VIC|QLD|WA|SA|TAS|NT|ACT)$';

COMMIT;

-- ----------------------------------------------------------------
-- ROLLBACK
-- ----------------------------------------------------------------
-- BEGIN;
-- DROP TRIGGER IF EXISTS zz_edition_indexable ON public.event_editions;
-- DROP FUNCTION IF EXISTS public.set_edition_indexable();
-- UPDATE event_editions e SET title = b.title, slug = b.slug, is_indexable = b.is_indexable
--   FROM _bak_20260805e_event_editions b WHERE e.id = b.id;
-- UPDATE event_venues v SET country_code = b.country_code
--   FROM _bak_20260805e_event_venues b WHERE v.id = b.id;
-- COMMIT;

-- ----------------------------------------------------------------
-- VERIFY (read-only)
-- ----------------------------------------------------------------
-- 1. No event that should be indexable is not:
--      SELECT count(*) FROM event_editions e
--       WHERE NOT e.is_indexable AND e.date_confirmed AND e.start_date >= current_date
--         AND e.status NOT IN ('cancelled','postponed','completed')
--         AND e.verification_tier IN ('confirmed','listed')
--         AND NOT EXISTS (SELECT 1 FROM discovery_candidate_events c
--                          WHERE c.id=e.source_candidate_id AND c.extraction_method='ai_fallback');
--      -- expect 0
--
-- 2. AI-read events are STILL excluded — the safety rule survived:
--      SELECT count(*) FROM event_editions e
--        JOIN discovery_candidate_events c ON c.id=e.source_candidate_id
--       WHERE c.extraction_method='ai_fallback' AND e.is_indexable;   -- expect 0
--
-- 3. The trigger holds for new rows. Inside a transaction, ROLL BACK:
--      BEGIN;
--        INSERT INTO event_editions (series_id, edition_year, title, start_date,
--                                    date_confirmed, status, verification_tier)
--        SELECT series_id, 2099, 'Indexable Trigger Test', current_date + 30,
--               true, 'announced', 'confirmed' FROM event_editions LIMIT 1;
--        SELECT title, is_indexable FROM event_editions WHERE edition_year=2099;
--        -- expect is_indexable = true, with no one having set it
--      ROLLBACK;
--
-- 4. Titles and slugs are clean:
--      SELECT title, slug FROM event_editions WHERE slug LIKE '%oceanswims%';  -- expect 0 rows
--      SELECT title, slug FROM event_editions WHERE title ILIKE '%Lorne%';
--      -- expect "Powercor Lorne Pier to Pub" and "Lorne Pier to Pub", clean slugs
--
-- 5. Australia is findable — 2 becomes ~15:
--      SELECT count(*) FROM event_editions e JOIN event_venues v ON v.id=e.venue_id
--       WHERE v.country_code='AU' AND e.start_date >= current_date;

-- ----------------------------------------------------------------
-- FOLLOW-UP — fix it upstream too, or it recurs on every crawl.
-- ----------------------------------------------------------------
-- deriveCanonicalName in discovery-worker/src/jobs/process-table-page.ts
-- takes the page <title> as the event name when nothing better is found.
-- Site suffixes (" | oceanswims.com", " – Ocean Swim in <place>") should be
-- stripped there, with a test, so the next aggregator does not reintroduce
-- this. This migration cleans 8 rows; the worker fix stops the ninth.
