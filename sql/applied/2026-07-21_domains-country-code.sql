-- ================================================================
-- Migration: 2026-07-21_domains-country-code.sql
-- Applied:   2026-07-21 via supabase-admin. Backup: _bak_20260720_domains (2 rows).
-- ================================================================

-- Purpose:
--   Backfill the last two domains rows with no country_code. Latent, not
--   broken: their spots already carried US/AU correctly, so nothing rendered
--   wrong — but any code falling back from spot -> domain got a NULL country.
--
--   SCOPE NOTE: this file records ONLY the domains fix. The spot-level work
--   found in the same review was already applied and recorded separately:
--     - sql/applied/2026-07-21_country-code-backfill... (commit 37868d0)
--       27 spots' country_code + Zinkwazi Lagoon's corrupt longitude
--     - sql/applied/2026-07-21_domain-moves-and-passport-region.sql (3375d76)
--       FR/ES/CH/KZN domain moves + passport region RPC
--   Do not re-apply those here; this file deliberately does not duplicate them.

-- Requested by:
--   Dave (Phase 2.5 Swim Passport data-quality review, 2026-07-20/21)

-- ----------------------------------------------------------------
-- PRE-CHECK (read-only, before applying)
-- ----------------------------------------------------------------
-- SELECT code, display_name FROM domains WHERE country_code IS NULL;
--   -> 2 rows: USA, WESTERN_AUSTRALIA

-- ----------------------------------------------------------------
-- BACKUP
-- ----------------------------------------------------------------
-- CREATE TABLE _bak_20260720_domains AS
--   SELECT * FROM domains WHERE country_code IS NULL;   -- 2 rows (valid pre-fix capture)

-- ----------------------------------------------------------------
-- MIGRATION (applied)
-- ----------------------------------------------------------------
BEGIN;

UPDATE domains SET country_code = 'US' WHERE code = 'USA'               AND country_code IS NULL;
UPDATE domains SET country_code = 'AU' WHERE code = 'WESTERN_AUSTRALIA' AND country_code IS NULL;

COMMIT;

-- ----------------------------------------------------------------
-- ROLLBACK
-- ----------------------------------------------------------------
-- UPDATE domains d SET country_code = b.country_code
--   FROM _bak_20260720_domains b WHERE b.code = d.code;

-- ----------------------------------------------------------------
-- VERIFY (run read-only after applying) — all passed 2026-07-21
-- ----------------------------------------------------------------
-- SELECT count(*) FROM domains WHERE country_code IS NULL;            -- expect 0   ✓
-- SELECT country_code FROM domains WHERE code='USA';                  -- expect US  ✓
-- SELECT country_code FROM domains WHERE code='WESTERN_AUSTRALIA';    -- expect AU  ✓
-- -- no domain's country contradicts its spots (EUROPE excluded — multi-country):
-- SELECT count(*) FROM domains d JOIN spots s ON s.domain=d.code
--   WHERE d.country_code IS NOT NULL AND s.country_code <> d.country_code
--     AND d.code <> 'EUROPE';                                         -- expect 0   ✓
-- SELECT count(*) FROM temp_logs;                                     -- 2420, unchanged ✓

-- ----------------------------------------------------------------
-- CLEANUP (a LATER migration, not this one — see MIGRATIONS.md)
-- ----------------------------------------------------------------
-- DROP TABLE _bak_20260720_domains;
