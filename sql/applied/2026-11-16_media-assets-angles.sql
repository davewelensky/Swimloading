-- Migration:    media_assets.angles (which product claims a photograph may illustrate)
-- Date:         2026-11-16
-- Requested by: Dave (JAKED priority partner posts)
-- Purpose:      JAKED product photos are tied to angles (wetsuit, costumes, about, enquire) so a costume photo can never
--               stand in for a wetsuit claim. The catalogue file already carries `angles`; the table has no column for it,
--               so on Vercel (which reads the table) the guard would be lost. The selector now fails closed (an asset with
--               no angles is never used for an angled post), so JAKED posts cannot be built until this is applied and
--               scripts/sync-media-to-supabase.mjs has been re-run.
-- APPLIED:      16 Nov 2026 via supabase-admin (apply_migration "media_assets_angles"); verified: column present (text[]), 58 existing rows unchanged.
-- PRE-CHECKS:   media_assets exists; column `angles` absent. Read-only:
--               SELECT column_name FROM information_schema.columns WHERE table_name='media_assets' AND column_name='angles';  -- expect 0 rows
-- BACKUP:       not required: additive nullable column, no existing row changes.
BEGIN;
ALTER TABLE media_assets ADD COLUMN angles text[];
COMMIT;
-- ROLLBACK:     ALTER TABLE media_assets DROP COLUMN angles;
-- VERIFY:       SELECT column_name FROM information_schema.columns WHERE table_name='media_assets' AND column_name='angles';  -- expect 1 row
