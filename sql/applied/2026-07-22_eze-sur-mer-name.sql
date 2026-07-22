-- ================================================================
-- Migration: 2026-07-22_eze-sur-mer-name.sql
-- ================================================================

-- Purpose:
--   Correct the display name of the spot stored as 'eze sur meet' to its real
--   name, 'Èze-sur-Mer' — the coastal part of Èze on the Côte d'Azur, between
--   Nice and Cap Ferrat. Coordinates (43.7223, 7.3596) confirm the location.
--
--   `code` is deliberately NOT changed. It is an internal identifier (the
--   Trends grid keys off it) and nothing user-facing renders it, so renaming
--   it would be churn with a real breakage risk and no benefit.

-- Requested by:
--   Dave, 2026-07-22

-- ----------------------------------------------------------------
-- PRE-CHECK (read-only)
-- ----------------------------------------------------------------
-- SELECT id, name, code FROM spots WHERE code = 'EZE_SUR_MEET';   -- expect 1 row

-- ----------------------------------------------------------------
-- BACKUP
-- ----------------------------------------------------------------
-- CREATE TABLE _bak_20260722_spot_eze AS
--   SELECT * FROM spots WHERE code = 'EZE_SUR_MEET';   -- 1 row

-- ----------------------------------------------------------------
-- MIGRATION
-- ----------------------------------------------------------------
BEGIN;

UPDATE spots SET name = 'Èze-sur-Mer' WHERE code = 'EZE_SUR_MEET';

COMMIT;

-- ----------------------------------------------------------------
-- ROLLBACK
-- ----------------------------------------------------------------
-- UPDATE spots SET name = 'eze sur meet' WHERE code = 'EZE_SUR_MEET';

-- ----------------------------------------------------------------
-- VERIFY (read-only, after applying)
-- ----------------------------------------------------------------
-- SELECT name FROM spots WHERE code='EZE_SUR_MEET';        -- expect: Èze-sur-Mer
-- SELECT count(*) FROM spots WHERE name = 'eze sur meet';  -- expect: 0
-- SELECT count(*) FROM temp_logs;                          -- unchanged (logs key off spot_id)

-- ----------------------------------------------------------------
-- SEO NOTE — ships WITH the generateSlug fix in api/seo-utils.js
-- ----------------------------------------------------------------
-- generateSlug() did not strip diacritics, so an accented name produced an
-- accented slug — and spots-handler.js never percent-decodes the path, so
-- such a URL could never match. 'Santa Ponça' was live proof: both
-- /spots/santa-pon%C3%A7a and /spots/santa-ponca returned 404.
--
-- With NFD normalisation added:
--   'Èze-sur-Mer' -> /spots/eze-sur-mer      (ASCII, resolves)
--   'Santa Ponça' -> /spots/santa-ponca      (fixes an existing live 404)
-- Every other spot slug is byte-identical — verified against all 8 non-ASCII
-- names; the em-dash ones were already handled by the existing rule.
--
-- URL CHANGE: /spots/eze-sur-meet (the typo, currently 200) becomes
-- /spots/eze-sur-mer. The old typo URL will 404. Judged acceptable — it is a
-- misspelling with negligible inbound value. Add a redirect if that changes.
