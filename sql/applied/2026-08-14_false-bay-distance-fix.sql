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
-- Migration: 2026-08-14_false-bay-distance-fix.sql
-- ================================================================

-- Purpose:
--   Two Dave-validated corrections to False Bay (2026-08-14):
--   1. Distance: the crossing is ~33 km — distance_km has said 33 all
--      along, but the legacy page content carried "~28 km" into intro and
--      key_facts. (crossings.html index card + readiness option fixed in
--      the same ship.)
--   2. Wildlife: not only great whites — many shark species, Cape fur
--      seals, jellyfish and bluebottles, even orcas (Dave's words).

-- Requested by:
--   Dave, 2026-08-14

-- ----------------------------------------------------------------
-- PRE-CHECKS — run on the READ-ONLY connection BEFORE applying.
-- ----------------------------------------------------------------
-- Expect intro containing "approximately 28 km" and key_facts->0->>'val' = '~28 km':
-- SELECT intro, key_facts->0->>'val' FROM public.crossings WHERE slug = 'false-bay';

-- ----------------------------------------------------------------
-- BACKUP — required: this UPDATEs existing values.
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS _bak_20260814c_crossings_fb AS
  SELECT * FROM public.crossings WHERE slug = 'false-bay';

-- ----------------------------------------------------------------
-- MIGRATION — applied only after Dave types "apply".
-- ----------------------------------------------------------------
BEGIN;

UPDATE public.crossings SET
  intro = replace(intro, 'approximately 28 km', 'approximately 33 km'),
  key_facts = jsonb_set(
    jsonb_set(key_facts, '{0,val}', to_jsonb('~33 km'::text)),
    '{4}',
    '{"label":"Wildlife","val":"Great whites & more","note":"Beyond great white sharks, False Bay hosts many other shark species, Cape fur seals, jellyfish and bluebottles — even orcas. Shark watch boats are required for any crossing attempt."}'::jsonb
  ),
  updated_at = now()
WHERE slug = 'false-bay'
  AND intro LIKE '%approximately 28 km%'
  AND key_facts->0->>'label' = 'Distance'
  AND key_facts->4->>'label' = 'Wildlife';

COMMIT;

-- ----------------------------------------------------------------
-- ROLLBACK
-- ----------------------------------------------------------------
-- BEGIN;
-- UPDATE public.crossings c SET intro = b.intro, key_facts = b.key_facts
--   FROM _bak_20260814c_crossings_fb b WHERE c.slug = b.slug;
-- COMMIT;

-- ----------------------------------------------------------------
-- VERIFY — read-only, after applying.
-- ----------------------------------------------------------------
-- Expect "approximately 33 km" and "~33 km":
-- SELECT intro, key_facts->0->>'val' FROM public.crossings WHERE slug = 'false-bay';
-- Expect 0:
-- SELECT count(*) FROM public.crossings WHERE slug='false-bay' AND (intro LIKE '%28 km%' OR key_facts::text LIKE '%28 km%');
-- Expect the broadened wildlife note (fur seals, bluebottles, orcas):
-- SELECT key_facts->4 FROM public.crossings WHERE slug = 'false-bay';
