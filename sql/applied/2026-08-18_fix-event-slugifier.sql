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
-- Migration: 2026-08-18_fix-event-slugifier.sql
-- ================================================================

-- Purpose:
--   Stop the event slugifier destroying accented names. event_slug_base()
--   does regexp_replace(lower(title), '[^a-z0-9]+', '-'), which turns EVERY
--   non-ASCII character into a hyphen:
--
--     BOUCLE DES FAÏENCIERS  → boucle-des-fa-enciers
--     Traversée de Montereau → travers-e-de-montereau
--     ...w Pływaniu...       → ...w-p-ywaniu...
--     9ème Coupe Volcanique  → 9-me-coupe-volcanique
--
--   27 of 316 live editions carry a mangled slug and 12 of those are already
--   in the sitemap — ugly URLs on exactly the pages we want to rank. This
--   transliterates first, so FAÏENCIERS becomes faienciers.

-- Requested by:
--   Dave, 18 Aug 2026.

-- Scope — DELIBERATELY NO DATA CHANGE:
--   This migration fixes the FUNCTION only. Existing slugs are untouched, so
--   no published URL moves and nothing needs a redirect yet. Renaming the 27
--   is a separate migration, written only AFTER this one is applied and the
--   corrected slugs can be read off the real function rather than guessed.
--   Note api/seo-utils.js generateSlug() already handles diacritics correctly
--   for spots; this brings events into line with it.

-- Why unaccent rather than more regex:
--   NFD-and-strip-combining-marks (what the JS does) handles é and ï but NOT
--   ł, which is a distinct letter with no decomposition — Polish events would
--   still break. unaccent's rule table covers both.

-- ----------------------------------------------------------------
-- PRE-CHECKS — read-only, before applying.
-- ----------------------------------------------------------------
--   -- unaccent is available but not yet installed (expect 0, 1):
--   SELECT (SELECT count(*) FROM pg_extension WHERE extname='unaccent') AS installed,
--          (SELECT count(*) FROM pg_available_extensions WHERE name='unaccent') AS available;
--
--   -- How many live editions currently have a mangled slug (expect 27, 12):
--   SELECT count(*) AS mangled,
--          count(*) FILTER (WHERE is_indexable) AS mangled_and_indexed
--     FROM event_editions
--    WHERE is_searchable AND status NOT IN ('cancelled','completed')
--      AND COALESCE(end_date,start_date) >= current_date
--      AND slug ~ '(^|-)[a-z]?-';

-- ----------------------------------------------------------------
-- BACKUP — not required: no rows are modified. The previous function
-- body is reproduced in the ROLLBACK section below.
-- ----------------------------------------------------------------

-- ----------------------------------------------------------------
-- MIGRATION — applied only after Dave types "apply".
-- ----------------------------------------------------------------
BEGIN;

CREATE EXTENSION IF NOT EXISTS unaccent;

-- unaccent(text) is only STABLE, because it depends on a dictionary that
-- could in principle be reloaded. The two-argument form with an explicit
-- regdictionary IS immutable, which is what lets event_slug_base stay
-- IMMUTABLE — required, since it is used by the slug trigger.
CREATE OR REPLACE FUNCTION public.event_slug_base(p_title text, p_year smallint)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  SELECT nullif(
    trim(both '-' from
      regexp_replace(
        regexp_replace(
          lower(unaccent('unaccent'::regdictionary, coalesce(p_title,''))),
          '[^a-z0-9]+', '-', 'g'),
        '-{2,}', '-', 'g')
    ), '')
    || CASE WHEN p_year IS NULL THEN '' ELSE '-' || p_year::text END;
$function$;

COMMIT;

-- ----------------------------------------------------------------
-- ROLLBACK — restores the previous (accent-destroying) definition.
-- ----------------------------------------------------------------
--   CREATE OR REPLACE FUNCTION public.event_slug_base(p_title text, p_year smallint)
--    RETURNS text LANGUAGE sql IMMUTABLE SET search_path TO 'public'
--   AS $function$
--     SELECT nullif(
--       trim(both '-' from
--         regexp_replace(
--           regexp_replace(lower(coalesce(p_title,'')), '[^a-z0-9]+', '-', 'g'),
--           '-{2,}', '-', 'g')
--       ), '')
--       || CASE WHEN p_year IS NULL THEN '' ELSE '-' || p_year::text END;
--   $function$;
--   -- The extension may be left installed; it is inert without this function.

-- ----------------------------------------------------------------
-- VERIFY — read-only, after applying. THIS IS ALSO THE PREVIEW for the
-- rename migration: it shows exactly what each corrected slug becomes.
-- ----------------------------------------------------------------
--   -- The four cases that motivated this:
--   SELECT event_slug_base('BOUCLE DES FAÏENCIERS', 2026::smallint)   AS faienciers,
--          event_slug_base('Traversée de Montereau', 2026::smallint)  AS traversee,
--          event_slug_base('20. Grand Prix Wielkopolski w Pływaniu', 2026::smallint) AS polish,
--          event_slug_base('9ème Coupe Volcanique', 2026::smallint)   AS neuvieme;
--   -- expect boucle-des-faienciers-2026, traversee-de-montereau-2026,
--   --        20-grand-prix-wielkopolski-w-plywaniu-2026, 9eme-coupe-volcanique-2026
--
--   -- Every live edition whose slug WOULD change, old vs new. This list is
--   -- the input to the rename + 301 migration; read it before writing that.
--   SELECT e.slug AS old_slug,
--          event_slug_base(e.title, EXTRACT(YEAR FROM e.start_date)::smallint) AS new_slug,
--          e.is_indexable, e.title
--     FROM event_editions e
--    WHERE e.is_searchable AND e.status NOT IN ('cancelled','completed')
--      AND COALESCE(e.end_date,e.start_date) >= current_date
--      AND e.slug IS DISTINCT FROM event_slug_base(e.title, EXTRACT(YEAR FROM e.start_date)::smallint)
--    ORDER BY e.is_indexable DESC, e.slug;
--
--   -- No existing slug was modified by this migration (expect 0):
--   SELECT count(*) FROM event_editions WHERE updated_at > now() - interval '5 minutes';
