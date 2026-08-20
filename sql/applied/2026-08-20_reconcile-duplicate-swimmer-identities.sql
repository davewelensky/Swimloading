-- ================================================================
-- SwimLoading — Migration
-- ================================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM _project_identity WHERE key='project_name' AND value='swimloading') THEN
    RAISE EXCEPTION 'WRONG PROJECT — MIGRATION ABORTED (expected swimloading / szgkzuswelntnevobnoh)';
  END IF;
END $$;

-- ================================================================
-- Migration: 2026-08-20_reconcile-duplicate-swimmer-identities.sql
-- ================================================================

-- Purpose:
--   historical_swimmers has 1,245 people who exist as two or three separate
--   rows apiece — same name, same gender, split swim history. Merge each
--   group into one identity before importing Big Bay Events' latest 2,096
--   swims, so the new import can attach to a person unambiguously instead
--   of guessing between duplicates.

-- Requested by:
--   Dave — 20 Aug 2026, after asking whether this was "just swims on
--   different days" — checked directly against Lindi Mitchell's record:
--   two rows, same name, same gender, INTERLEAVED dates (one row's range
--   starts before the other's), 5 swims each. Same person, not two people.

-- Root cause:
--   historical_swimmers was populated by two separate imports —
--   create_historical_tables.sql (source='big_bay_events', the original
--   2,685-swim seed) and import_swim_summary_ri.sql
--   (source='big_bay_swimsummary', added later). Each import's own
--   swim-level dedup worked correctly (UNIQUE(source_row_num, source)),
--   but neither ever checked whether the SWIMMER it was about to insert
--   already existed under the other import's source label. 1,245 people
--   ended up as two (two groups: three) rows apiece.

-- Scope (verified, not estimated — dry run below):
--   1,245 duplicate (name_normalized, gender) groups — 1,243 pairs, 2 triples
--   1,247 swimmer rows removed
--   1,953 historical_swims rows repointed to the surviving identity
--   2,484 total swims BEFORE == 2,484 total swims AFTER — none lost, none
--   duplicated, only source_row_num moved to a different swimmer_id.
--   2,579 swimmers -> 1,332, the true distinct-people count.
--
--   Survivor = earliest-created row in each group (deterministic, no
--   judgement call per group). Its city/country/email_hash are backfilled
--   from the duplicate wherever the survivor was missing them, so no
--   metadata is lost either. Only one foreign key in the schema points at
--   historical_swimmers.id — historical_swims.swimmer_id — confirmed via
--   pg_constraint, so this cannot silently break something else.

-- Not in scope:
--   Rows sharing a name with gender NULL on one or both sides are NOT
--   touched here — a NULL gender is weaker evidence than an agreeing M/M
--   or F/F pair, and merging on name alone risks combining two different
--   real people. Left as a separate, lower-confidence question.

-- ----------------------------------------------------------------
-- PRE-CHECKS (read-only, before applying) — reproduced in VERIFY below
-- ----------------------------------------------------------------

-- ----------------------------------------------------------------
-- BACKUP
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS _bak_20260820_swimmer_merge AS
  SELECT *, now() AS backed_up_at FROM public.historical_swimmers;
CREATE TABLE IF NOT EXISTS _bak_20260820_swims_swimmer_id AS
  SELECT id AS swim_id, swimmer_id, now() AS backed_up_at FROM public.historical_swims;

-- ----------------------------------------------------------------
-- MIGRATION
-- ----------------------------------------------------------------
BEGIN;

-- Capture everything needed from the duplicate rows UP FRONT, including
-- their metadata, so later steps never need to join back against a row
-- that has already been deleted.
CREATE TEMP TABLE _merge_map AS
WITH groups AS (
  SELECT name_normalized, gender,
         (array_agg(id ORDER BY created_at ASC))[1] AS survivor_id,
         array_agg(id ORDER BY created_at ASC) AS all_ids
  FROM public.historical_swimmers WHERE gender IS NOT NULL
  GROUP BY name_normalized, gender HAVING count(*) > 1
),
expanded AS (
  SELECT survivor_id, unnest(all_ids[2:array_length(all_ids,1)]) AS dup_id FROM groups
)
SELECT e.survivor_id, e.dup_id, d.city, d.country, d.email_hash, d.is_group
FROM expanded e JOIN public.historical_swimmers d ON d.id = e.dup_id;

-- 1. Repoint every swim the duplicates hold onto the survivor.
UPDATE public.historical_swims hs
   SET swimmer_id = mm.survivor_id
  FROM _merge_map mm
 WHERE hs.swimmer_id = mm.dup_id;

-- 2. Delete the duplicate rows BEFORE backfilling. Backfilling first was
--    tried and failed: idx_historical_swimmers_email_hash_unique (a
--    partial unique index this migration didn't know about until it hit
--    it) briefly saw the survivor AND its not-yet-deleted duplicate
--    holding the same email_hash in the same statement. Deleting first
--    means only one row can ever hold that hash.
DELETE FROM public.historical_swimmers sw
  USING _merge_map mm
 WHERE sw.id = mm.dup_id;

-- 3. Backfill survivor metadata from the captured duplicate data. A
--    3-way group has two dup rows per survivor, so this aggregates
--    explicitly (first non-null value) rather than relying on undefined
--    multi-row UPDATE...FROM behaviour.
UPDATE public.historical_swimmers sw
   SET city       = COALESCE(sw.city, m.city),
       country    = COALESCE(sw.country, m.country),
       email_hash = COALESCE(sw.email_hash, m.email_hash),
       is_group   = sw.is_group OR m.any_group
  FROM (
    SELECT survivor_id,
           (array_agg(city)       FILTER (WHERE city IS NOT NULL))[1]       AS city,
           (array_agg(country)    FILTER (WHERE country IS NOT NULL))[1]    AS country,
           (array_agg(email_hash) FILTER (WHERE email_hash IS NOT NULL))[1] AS email_hash,
           bool_or(is_group) AS any_group
    FROM _merge_map GROUP BY survivor_id
  ) m
 WHERE sw.id = m.survivor_id;

COMMIT;

-- ----------------------------------------------------------------
-- ROLLBACK
-- ----------------------------------------------------------------
--   INSERT INTO historical_swimmers SELECT id,display_name,name_normalized,
--     gender,city,country,email_hash,linked_profile_id,is_group,created_at
--     FROM _bak_20260820_swimmer_merge b
--    WHERE NOT EXISTS (SELECT 1 FROM historical_swimmers h WHERE h.id=b.id);
--   UPDATE historical_swims hs SET swimmer_id = b.swimmer_id
--     FROM _bak_20260820_swims_swimmer_id b WHERE b.swim_id = hs.id;
--   UPDATE historical_swimmers sw SET
--     city=b.city, country=b.country, email_hash=b.email_hash, is_group=b.is_group
--     FROM _bak_20260820_swimmer_merge b WHERE b.id=sw.id;

-- ----------------------------------------------------------------
-- VERIFY (read-only, after applying)
-- ----------------------------------------------------------------
-- 1. No swim lost or duplicated.        expect: 2484 both times
-- SELECT count(*) FROM historical_swims;
--
-- 2. No swimmer left with a duplicate (name_normalized, gender). expect: 0
-- SELECT count(*) FROM (
--   SELECT name_normalized, gender FROM historical_swimmers
--   WHERE gender IS NOT NULL GROUP BY 1,2 HAVING count(*) > 1
-- ) x;
--
-- 3. Lindi Mitchell is now one person with ten swims.  expect: 1 row, count=10
-- SELECT sw.id, count(*) FROM historical_swims hs
--   JOIN historical_swimmers sw ON sw.id=hs.swimmer_id
--  WHERE sw.name_normalized='lindi mitchell' GROUP BY sw.id;
--
-- 4. Distinct swimmer total.             expect: 1332
-- SELECT count(*) FROM historical_swimmers;
