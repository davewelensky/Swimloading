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
    RAISE EXCEPTION 'WRONG PROJECT — MIGRATION ABORTED (expected swimloading / szgkzuswelntnevobnoh)'
    USING HINT = 'Check the project ref in your Supabase dashboard URL';
  END IF;
  RAISE NOTICE '✅ Project identity confirmed: swimloading (szgkzuswelntnevobnoh)';
END $$;

-- ================================================================
-- Migration: 2026-08-14_north-channel-qualifying-fix.sql
-- ================================================================

-- Purpose:
--   Correct the North Channel qualifying-swim claim. The legacy page said
--   "at least 8 hours in cold water"; the ILDSA's published standard is a
--   ratified 6-hour swim in water of 13°C or below OR an 8-hour swim in
--   15°C or below. Sources: Openwaterpedia "Qualifying swim" + WOWSA
--   association database, corroborating each other; Infinity Channel
--   Swimming's application page confirms the requirement is set by the
--   ILDSA. ildsa.info itself blocks automated fetchers, so the primary
--   rulebook was NOT read directly — figures rest on two secondary
--   sources. No submission timeframe is stated because the sources
--   disagree on it (6 vs 9 months).

-- Requested by:
--   Dave (factual-accuracy rule, 2026-08-14)

-- ----------------------------------------------------------------
-- PRE-CHECKS — run on the READ-ONLY connection BEFORE applying.
-- ----------------------------------------------------------------
-- Show the sentence being replaced (expect the "at least 8 hours" text):
-- SELECT preparation->>1 FROM public.crossings WHERE slug = 'north-channel';

-- ----------------------------------------------------------------
-- BACKUP — required: this UPDATEs an existing preparation value.
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS _bak_20260814b_crossings_nc AS
  SELECT * FROM public.crossings WHERE slug = 'north-channel';

-- ----------------------------------------------------------------
-- MIGRATION — applied only after Dave types "apply".
-- ----------------------------------------------------------------
BEGIN;

UPDATE public.crossings SET
  preparation = jsonb_set(
    preparation,
    '{1}',
    to_jsonb('The ILDSA requires a ratified qualifying swim — typically 6 hours in water of 13°C or below, or 8 hours in 15°C or below. Many pilots require evidence of cold water tolerance before they will accept a booking. Budget 2–3 years of preparation for most swimmers attempting this crossing.'::text)
  ),
  updated_at = now()
WHERE slug = 'north-channel'
  AND preparation->>1 LIKE 'An ILDSA-ratified attempt typically requires%';

COMMIT;

-- ----------------------------------------------------------------
-- ROLLBACK
-- ----------------------------------------------------------------
-- BEGIN;
-- UPDATE public.crossings c SET preparation = b.preparation
--   FROM _bak_20260814b_crossings_nc b WHERE c.slug = b.slug;
-- COMMIT;

-- ----------------------------------------------------------------
-- VERIFY — read-only, after applying.
-- ----------------------------------------------------------------
-- Expect the new sentence:
-- SELECT preparation->>1 FROM public.crossings WHERE slug = 'north-channel';
-- Expect 0:
-- SELECT count(*) FROM public.crossings WHERE preparation::text LIKE '%at least 8 hours in cold water%';
