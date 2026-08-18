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
-- Migration: 2026-08-18_rename-mangled-event-slugs.sql
-- ================================================================

-- Purpose:
--   Rename the event slugs the old slugifier mangled, and keep the old URLs
--   working. 2026-08-18_fix-event-slugifier.sql fixed the function; this
--   applies it to rows created before that fix.
--
--     boucle-des-fa-enciers-2026  → boucle-des-faienciers-2026
--     travers-e-de-montereau-...  → traversee-de-montereau-a-la-nage-2026
--     ...w-p-ywaniu-...-fina-2026 → ...w-plywaniu-...-final-2026
--     w-rthersee-2026             → worthersee-2026
--
--   16 of the 27 are already in the sitemap.

-- Requested by:
--   Dave, 18 Aug 2026 — chose "rename published slugs + 301".

-- Redirects — why a column and not vercel.json:
--   A published slug is a permanent URL, so every rename needs a 301. 27 new
--   routes in vercel.json would work but must each sit BEFORE the
--   ^/events/(.*)$ catch-all to fire at all, they need a deploy per rename,
--   and this will recur every time a title is corrected (the entity fix
--   earlier today changed one slug by itself). previous_slugs travels with
--   the row, needs no deploy, and cannot be defeated by route ordering.
--   api/events-handler.js resolves it: unknown slug → look up previous_slugs
--   → 301 to the current one.

-- EXCLUDED — 4 rows, deliberately, because their corrected slug COLLIDES:
--     aquell-midmar-mile-2027-970d43  ┐ both → aquelle-midmar-mile-2027
--     aquell-midmar-mile-2027-8a8754  ┘
--     six-fours-swim-cup-2026-d76b40   → six-fours-swim-cup-2026 (already taken)
--     les-boucles-de-la-jemaye-2026-690b8e → les-boucles-de-la-jemaye-2026 (taken)
--   The -[0-9a-f]{6} suffix exists precisely BECAUSE the name was already in
--   use, so these are duplicate records, not mangled ones. Renaming them
--   would fail on the unique index or overwrite a live page. They need a
--   merge decision (which record is canonical) and a retire-plus-301 — a
--   separate piece of work that needs Dave's eyes on each pair, not a
--   mechanical rename. The guard below re-derives this rather than
--   hard-coding the four, so it stays correct if the data moves.

-- ----------------------------------------------------------------
-- PRE-CHECKS — read-only, before applying.
-- ----------------------------------------------------------------
--   -- 31 rows differ from the corrected function; 4 of them collide:
--   WITH proposed AS (
--     SELECT e.id, e.slug AS old_slug,
--            event_slug_base(e.title, EXTRACT(YEAR FROM e.start_date)::smallint) AS new_slug
--       FROM event_editions e
--      WHERE e.is_searchable AND e.status NOT IN ('cancelled','completed')
--        AND COALESCE(e.end_date,e.start_date) >= current_date
--        AND e.slug IS DISTINCT FROM event_slug_base(e.title, EXTRACT(YEAR FROM e.start_date)::smallint))
--   SELECT count(*) AS proposed,
--          count(*) FILTER (WHERE EXISTS (SELECT 1 FROM event_editions x WHERE x.slug=p.new_slug AND x.id<>p.id)
--                              OR (SELECT count(*) FROM proposed q WHERE q.new_slug=p.new_slug AND q.id<>p.id) > 0) AS colliding
--     FROM proposed p;
--   -- expect 31 proposed, 4 colliding → 27 renamed

-- ----------------------------------------------------------------
-- BACKUP — required: this migration contains an UPDATE.
-- ----------------------------------------------------------------
BEGIN;

-- Old URLs live here. Array rather than a join table: a slug can be renamed
-- more than once and every historical form must keep resolving.
ALTER TABLE event_editions
  ADD COLUMN IF NOT EXISTS previous_slugs text[] NOT NULL DEFAULT '{}';

CREATE INDEX IF NOT EXISTS event_editions_previous_slugs_idx
  ON event_editions USING gin (previous_slugs);

CREATE TABLE IF NOT EXISTS _bak_20260818_event_slugs AS
SELECT id, slug, previous_slugs, now() AS backed_up_at
  FROM event_editions
 WHERE is_searchable AND status NOT IN ('cancelled','completed')
   AND COALESCE(end_date, start_date) >= current_date;

WITH proposed AS (
  SELECT e.id, e.slug AS old_slug,
         event_slug_base(e.title, EXTRACT(YEAR FROM e.start_date)::smallint) AS new_slug
    FROM event_editions e
   WHERE e.is_searchable AND e.status NOT IN ('cancelled','completed')
     AND COALESCE(e.end_date, e.start_date) >= current_date
     AND e.slug IS DISTINCT FROM event_slug_base(e.title, EXTRACT(YEAR FROM e.start_date)::smallint)
),
safe AS (
  SELECT p.* FROM proposed p
   WHERE p.new_slug IS NOT NULL
     -- would not overwrite an existing row
     AND NOT EXISTS (SELECT 1 FROM event_editions x WHERE x.slug = p.new_slug AND x.id <> p.id)
     -- and is unique within this batch
     AND (SELECT count(*) FROM proposed q WHERE q.new_slug = p.new_slug AND q.id <> p.id) = 0
)
UPDATE event_editions e
   SET slug           = s.new_slug,
       previous_slugs = (
         SELECT array_agg(DISTINCT v)
           FROM unnest(e.previous_slugs || ARRAY[s.old_slug]) AS v
       ),
       updated_at     = now()
  FROM safe s
 WHERE e.id = s.id;

COMMIT;

-- ----------------------------------------------------------------
-- ROLLBACK
-- ----------------------------------------------------------------
--   UPDATE event_editions e
--      SET slug = b.slug, previous_slugs = b.previous_slugs
--     FROM _bak_20260818_event_slugs b
--    WHERE e.id = b.id;
--   -- The column and index may stay; they are inert when empty.
--   -- then: DROP TABLE _bak_20260818_event_slugs;

-- ----------------------------------------------------------------
-- VERIFY — read-only, after applying.
-- ----------------------------------------------------------------
--   -- 27 rows renamed and each remembers its old slug:
--   SELECT count(*) AS renamed FROM event_editions WHERE cardinality(previous_slugs) > 0;
--   -- expect 27
--
--   -- Only the 4 known collisions still disagree with the function (expect 4):
--   SELECT slug FROM event_editions e
--    WHERE e.is_searchable AND e.status NOT IN ('cancelled','completed')
--      AND COALESCE(e.end_date,e.start_date) >= current_date
--      AND e.slug IS DISTINCT FROM event_slug_base(e.title, EXTRACT(YEAR FROM e.start_date)::smallint);
--
--   -- No slug is duplicated (expect 0):
--   SELECT slug, count(*) FROM event_editions GROUP BY 1 HAVING count(*) > 1;
--
--   -- No old slug collides with a current one — a redirect must never
--   -- shadow a live page (expect 0):
--   SELECT p FROM event_editions e, unnest(e.previous_slugs) p
--    WHERE EXISTS (SELECT 1 FROM event_editions x WHERE x.slug = p);
--
--   -- Spot check, both must resolve after the handler change:
--   --   /events/boucle-des-fa-enciers-2026  → 301 → /events/boucle-des-faienciers-2026
