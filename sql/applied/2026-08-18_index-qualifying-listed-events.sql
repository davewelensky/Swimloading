-- ⚠️  SAFETY CHECK
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM _project_identity WHERE key='project_name' AND value='swimloading') THEN
    RAISE EXCEPTION 'WRONG PROJECT — MIGRATION ABORTED. Expected swimloading (szgkzuswelntnevobnoh).'
    USING HINT = 'Check the project ref in your Supabase dashboard URL';
  END IF;
  RAISE NOTICE '✅ Project identity confirmed: swimloading';
END $$;

-- ================================================================
-- Migration: 2026-08-18_index-qualifying-listed-events.sql
-- ================================================================

-- Purpose:
--   Let Google see the listed events that are actually worth ranking.
--   145 of 316 searchable editions are is_indexable = false, so they show on
--   /explore but are absent from the sitemap. 89 of those are 'unverified'
--   and stay out. The other 56 are 'listed' — the same tier as 129 editions
--   that ARE indexed — with no rule separating them; the flag was set
--   inconsistently at ingest. This applies a rule instead.

-- Requested by:
--   Dave, 18 Aug 2026, having chosen "apply the rule" over confirmed-only.

-- The rule — a 'listed' edition is indexable when ALL hold:
--   1. it has a venue            — location is what people search for
--   2. date_precision = 'exact'  — "sometime in September" is a thin page
--   3. at least one distance     — otherwise there is nearly no content
--   4. it has an official_url    — attributable, and evidence it is real
--   5. no -[0-9a-f]{6} slug      — that suffix means the slugifier hit a name
--                                  collision, i.e. the same event twice
--
--   'confirmed' stays fully indexed. 'unverified' stays fully excluded —
--   asking Google to index a swim nobody has checked is how a catalogue
--   earns a reputation for being wrong.

-- Expected effect (measured 2026-08-18): 25 of the 56 qualify.
--   Sitemap 171 → 196. The 31 that fail: 17 no distances, 13 no official
--   url, 7 no venue, 2 fuzzy date (categories overlap).

-- Useful side effect, not a coincidence:
--   Where two records describe the same race (Coupe Volcanique, Traversée de
--   Montereau, ELSA'S Cup, Six Fours, Les Boucles de la Jemaye), the richer
--   record has the official_url and the distances and the thin twin does not.
--   The rule therefore indexes the canonical one and leaves the duplicate
--   out, without needing to know they are duplicates.

-- ----------------------------------------------------------------
-- PRE-CHECKS — read-only, before applying.
-- ----------------------------------------------------------------
--   SELECT count(*) AS will_flip FROM event_editions e
--    WHERE e.is_searchable AND NOT e.is_indexable
--      AND e.verification_tier = 'listed'
--      AND e.status NOT IN ('cancelled','completed')
--      AND COALESCE(e.end_date,e.start_date) >= current_date
--      AND e.venue_id IS NOT NULL
--      AND e.date_precision = 'exact'
--      AND e.official_url IS NOT NULL
--      AND e.slug !~ '-[0-9a-f]{6}$'
--      AND EXISTS (SELECT 1 FROM event_distances d WHERE d.edition_id = e.id);
--   -- expect 25

-- ----------------------------------------------------------------
-- BACKUP — required: this migration contains an UPDATE.
-- ----------------------------------------------------------------
BEGIN;

CREATE TABLE IF NOT EXISTS _bak_20260818_indexability AS
SELECT id, slug, is_indexable, verification_tier, now() AS backed_up_at
  FROM event_editions
 WHERE is_searchable AND verification_tier = 'listed';

UPDATE event_editions e
   SET is_indexable = true,
       updated_at   = now()
 WHERE e.is_searchable AND NOT e.is_indexable
   AND e.verification_tier = 'listed'
   AND e.status NOT IN ('cancelled','completed')
   AND COALESCE(e.end_date, e.start_date) >= current_date
   AND e.venue_id IS NOT NULL
   AND e.date_precision = 'exact'
   AND e.official_url IS NOT NULL
   AND e.slug !~ '-[0-9a-f]{6}$'
   AND EXISTS (SELECT 1 FROM event_distances d WHERE d.edition_id = e.id);

COMMIT;

-- ----------------------------------------------------------------
-- ROLLBACK — restores every 'listed' row's flag to its pre-change value.
-- ----------------------------------------------------------------
--   UPDATE event_editions e SET is_indexable = b.is_indexable
--     FROM _bak_20260818_indexability b WHERE e.id = b.id;
--   -- then: DROP TABLE _bak_20260818_indexability;

-- ----------------------------------------------------------------
-- VERIFY — read-only, after applying.
-- ----------------------------------------------------------------
--   -- Indexable total should rise by exactly 25 (171 → 196):
--   SELECT verification_tier, count(*) FILTER (WHERE is_indexable) AS indexable, count(*) AS total
--     FROM event_editions
--    WHERE is_searchable AND status NOT IN ('cancelled','completed')
--      AND COALESCE(end_date,start_date) >= current_date
--    GROUP BY 1 ORDER BY 1;
--   -- expect confirmed 42/42, listed 154/185, unverified 0/89
--
--   -- No unverified edition became indexable (expect 0):
--   SELECT count(*) FROM event_editions
--    WHERE verification_tier = 'unverified' AND is_indexable;
--
--   -- No collision-slug edition became indexable (expect 0):
--   SELECT count(*) FROM event_editions
--    WHERE is_indexable AND slug ~ '-[0-9a-f]{6}$' AND verification_tier = 'listed'
--      AND id NOT IN (SELECT id FROM _bak_20260818_indexability WHERE is_indexable);
