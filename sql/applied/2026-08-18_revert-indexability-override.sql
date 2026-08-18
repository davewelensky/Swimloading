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
-- Migration: 2026-08-18_revert-indexability-override.sql
-- ================================================================

-- Purpose:
--   Undo 2026-08-18_index-qualifying-listed-events.sql. That migration was
--   applied on a wrong premise and must not stand.

-- Requested by:
--   Dave, 18 Aug 2026, on being shown the evidence below.

-- What was wrong:
--   The earlier migration claimed the 56 non-indexed 'listed' editions had
--   "no rule separating them" from the 129 indexed ones. There is a rule, it
--   is perfectly consistent, and it is enforced by the trigger
--   zz_edition_indexable → set_edition_indexable():
--
--     extraction_method   editions   indexed before the override
--     html                    107        107
--     jsonld                   21         21
--     jsonld+html               1          1
--     ai_fallback              56          0
--
--   Every excluded edition is ai_fallback — its date, distances and venue
--   were inferred by an AI from unstructured HTML rather than parsed from
--   structured data. Excluding those from the sitemap is a deliberate
--   quality gate, and the right one: an inferred date is exactly what you do
--   not want Google sending a swimmer to. The override published 25 such
--   pages (16 still standing at the time of this revert).

-- Why it could not have held anyway:
--   is_indexable is DERIVED, not owned. set_edition_indexable() recomputes it
--   on every INSERT or UPDATE, and only respects a value that the statement
--   itself is changing:
--
--     IF TG_OP = 'UPDATE' AND NEW.is_indexable IS DISTINCT FROM OLD.is_indexable
--       THEN RETURN NEW;   -- explicit change respected
--     END IF;
--     NEW.is_indexable := (…the real rule…);
--
--   So 2026-08-18_rename-mangled-event-slugs.sql, which updated slug on 27
--   rows and never mentioned is_indexable, silently reverted 9 of the 25 as a
--   side effect — 154 became 145. The remainder would have decayed the same
--   way on any future edit. A value maintained by a trigger cannot be
--   overridden by an UPDATE and expected to stay.

-- If the policy is ever to change:
--   Change set_edition_indexable(), not the column. Anything else drifts.

-- NOT reverted, deliberately — these were real bugs and are verified live:
--   * 2026-08-18_fix-event-slugifier.sql        (unaccent; accented names)
--   * 2026-08-18_rename-mangled-event-slugs.sql (27 renames + previous_slugs)

-- ----------------------------------------------------------------
-- PRE-CHECKS — read-only, before applying.
-- ----------------------------------------------------------------
--   SELECT count(*) AS will_revert,
--          count(*) FILTER (WHERE e.is_indexable AND NOT b.is_indexable) AS turning_off,
--          count(*) FILTER (WHERE NOT e.is_indexable AND b.is_indexable) AS turning_on
--     FROM event_editions e
--     JOIN _bak_20260818_indexability b ON b.id = e.id
--    WHERE e.is_indexable IS DISTINCT FROM b.is_indexable;
--   -- expect 16 / 16 / 0  (verified 2026-08-18)

-- ----------------------------------------------------------------
-- BACKUP — the source of truth for this revert IS a backup table,
-- _bak_20260818_indexability, taken before the override. It holds every
-- 'listed' row's flag as it stood, not only the ones that changed.
-- ----------------------------------------------------------------
BEGIN;

UPDATE event_editions e
   SET is_indexable = b.is_indexable
  FROM _bak_20260818_indexability b
 WHERE e.id = b.id
   AND e.is_indexable IS DISTINCT FROM b.is_indexable;

COMMIT;

-- ----------------------------------------------------------------
-- ROLLBACK (i.e. re-applying the override — not recommended)
-- ----------------------------------------------------------------
--   See 2026-08-18_index-qualifying-listed-events.sql. Do not: change the
--   trigger instead.

-- ----------------------------------------------------------------
-- VERIFY — read-only, after applying.
-- ----------------------------------------------------------------
--   -- Nothing differs from the pre-override backup (expect 0):
--   SELECT count(*) FROM event_editions e
--     JOIN _bak_20260818_indexability b ON b.id = e.id
--    WHERE e.is_indexable IS DISTINCT FROM b.is_indexable;
--
--   -- No ai_fallback edition is indexable (expect 0):
--   SELECT count(*) FROM event_editions e
--     JOIN discovery_candidate_events c ON c.id = e.source_candidate_id
--    WHERE e.is_indexable AND c.extraction_method = 'ai_fallback';
--
--   -- Tiers back to where they started (expect confirmed 42/42,
--   -- listed 129/185, unverified 0/89):
--   SELECT verification_tier, count(*) FILTER (WHERE is_indexable) AS indexable, count(*) AS total
--     FROM event_editions
--    WHERE is_searchable AND status NOT IN ('cancelled','completed')
--      AND COALESCE(end_date,start_date) >= current_date
--    GROUP BY 1 ORDER BY 1;
