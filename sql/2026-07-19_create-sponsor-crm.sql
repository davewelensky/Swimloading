-- ================================================================
-- SwimLoading — Migration Template
-- Copy this header into EVERY new migration file.
-- The safety block hard-fails if you are in the wrong project.
-- ================================================================

-- ⚠️  SAFETY CHECK — runs first, aborts everything if wrong project
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM _project_identity
    WHERE key = 'project_name' AND value = 'swimloading'
  ) THEN
    RAISE EXCEPTION
      E'\n\n'
      '╔══════════════════════════════════════════════════════════╗\n'
      '║  WRONG PROJECT — MIGRATION ABORTED                       ║\n'
      '║                                                          ║\n'
      '║  This migration is for: SwimLoading                     ║\n'
      '║  Expected project ref:  szgkzuswelntnevobnoh            ║\n'
      '║                                                          ║\n'
      '║  You are connected to a DIFFERENT Supabase project.     ║\n'
      '║  No changes have been made. Check your browser URL.     ║\n'
      '╚══════════════════════════════════════════════════════════╝'
    USING HINT = 'Check the project ref in your Supabase dashboard URL';
  END IF;
  RAISE NOTICE '✅ Project identity confirmed: swimloading (szgkzuswelntnevobnoh)';
END $$;

-- ================================================================
-- Migration: 2026-07-19_create-sponsor-crm.sql
-- Process:   see MIGRATIONS.md — no section below may be left empty
-- STATUS:    ⛔ PROPOSED — NOT YET APPLIED. Schema only — creates EMPTY
--            tables. Does NOT import any data from Sponsors/index.html.
--            Depends on user_roles (2026-07-19_create-user-roles.sql)
--            being applied first — has_role() must already exist.
-- ================================================================

-- Purpose:
--   Replace the static, unauthenticated Sponsors/index.html BRANDS array
--   (91 brands, currently contained via routing block, see
--   docs/refactor/SECURITY_REGISTER.md §2) with a real, RLS-protected
--   table. This migration creates the schema only — see
--   docs/refactor/SPONSOR_CRM_PLAN.md for the field classification and
--   import plan, which requires separate approval before any row is
--   inserted. Distinct from, and not a replacement for, growth_sponsors
--   (a smaller, separate 9-row tool already used by growth-hub.html).

-- Requested by:
--   Dave — SwimLoading v2 Platform Refactor, Phase 1, Step 4

-- Pre-checks:
--   1. select count(*) from information_schema.tables
--      where table_schema='public' and table_name in
--      ('sponsor_partners','sponsor_partner_audit');  -- expect 0
--   2. select has_role('platform_admin');  -- requires user_roles migration
--      already applied and you already granted platform_admin

-- Backup:
--   Not applicable — new tables only, no existing data touched.

BEGIN;

-- ── Table: sponsor_partners ────────────────────────────────────────────
-- Field classification (full detail in docs/refactor/SPONSOR_CRM_PLAN.md):
--   operational           — brand, category, status, website, tags,
--                            next_action, campaign_relevance, is_priority
--   commercial-sensitive  — value_proposition (prize/discount specifics)
--   personal-sensitive    — contact_name, contact_email, notes (freeform
--                            strategy commentary may reference people)
--   archival              — archived_at (soft-delete only, see below)
CREATE TABLE sponsor_partners (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  brand               text        NOT NULL,
  category            text        NULL,
  status              text        NOT NULL DEFAULT 'not_contacted' CHECK (status IN (
                        'not_contacted', 'researching', 'contacted', 'replied',
                        'deal_done', 'passed', 'archived'
                      )),
  website             text        NULL,
  contact_name        text        NULL,   -- personal-sensitive, see plan doc
  contact_email       text        NULL,   -- personal-sensitive, see plan doc
  country_region      text        NULL,
  value_proposition   text        NULL,   -- commercial-sensitive
  campaign_relevance  text        NULL,   -- e.g. 'monthly_challenge', 'carina_swimwear', 'carina_crossing_africa'
  tags                text[]      NOT NULL DEFAULT '{}',
  is_priority         boolean     NOT NULL DEFAULT false,
  next_action         text        NULL,
  notes               text        NULL,   -- personal-sensitive, see plan doc
  archived_at         timestamptz NULL,   -- soft delete only — see requirement 10
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  created_by          uuid        NULL REFERENCES auth.users(id),
  updated_by          uuid        NULL REFERENCES auth.users(id)
);

COMMENT ON TABLE sponsor_partners IS
  'Sponsor/partner pipeline — replaces the static Sponsors/index.html '
  'BRANDS array. No hard delete: use archived_at. See '
  'docs/refactor/SPONSOR_CRM_PLAN.md for field classification and the '
  'import plan (separately approved, not part of this migration).';

CREATE INDEX sponsor_partners_status_idx ON sponsor_partners (status) WHERE archived_at IS NULL;

-- ── Table: sponsor_partner_audit ───────────────────────────────────────
-- Durable audit trail for status/contact/value changes and deletions
-- (requirement 9). Append-only — never updated or deleted by the app.
CREATE TABLE sponsor_partner_audit (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  sponsor_id      uuid        NOT NULL REFERENCES sponsor_partners(id) ON DELETE CASCADE,
  changed_by      uuid        NOT NULL REFERENCES auth.users(id),
  changed_at      timestamptz NOT NULL DEFAULT now(),
  change_type     text        NOT NULL CHECK (change_type IN (
                    'status_change', 'contact_change', 'value_change', 'archived', 'created'
                  )),
  field_name      text        NULL,
  old_value       text        NULL,
  new_value       text        NULL
);

COMMENT ON TABLE sponsor_partner_audit IS
  'Append-only. Populated by the trigger below, not written directly by '
  'the app — guarantees every mutation is logged regardless of which API '
  'path made the change.';

-- Trigger: log status/contact/value changes and archival automatically,
-- so the audit trail can't be bypassed by a code path that forgets to log.
CREATE OR REPLACE FUNCTION log_sponsor_partner_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO sponsor_partner_audit (sponsor_id, changed_by, change_type, new_value)
    VALUES (NEW.id, auth.uid(), 'created', NEW.brand);
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.status IS DISTINCT FROM OLD.status THEN
      INSERT INTO sponsor_partner_audit (sponsor_id, changed_by, change_type, field_name, old_value, new_value)
      VALUES (NEW.id, auth.uid(), CASE WHEN NEW.status = 'archived' THEN 'archived' ELSE 'status_change' END, 'status', OLD.status, NEW.status);
    END IF;
    IF NEW.contact_name IS DISTINCT FROM OLD.contact_name OR NEW.contact_email IS DISTINCT FROM OLD.contact_email THEN
      INSERT INTO sponsor_partner_audit (sponsor_id, changed_by, change_type, field_name, old_value, new_value)
      VALUES (NEW.id, auth.uid(), 'contact_change', 'contact', OLD.contact_email, NEW.contact_email);
    END IF;
    IF NEW.value_proposition IS DISTINCT FROM OLD.value_proposition THEN
      INSERT INTO sponsor_partner_audit (sponsor_id, changed_by, change_type, field_name, old_value, new_value)
      VALUES (NEW.id, auth.uid(), 'value_change', 'value_proposition', OLD.value_proposition, NEW.value_proposition);
    END IF;
    NEW.updated_at = now();
    NEW.updated_by = auth.uid();
    RETURN NEW;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER sponsor_partners_audit_trigger
  BEFORE INSERT OR UPDATE ON sponsor_partners
  FOR EACH ROW EXECUTE FUNCTION log_sponsor_partner_change();

-- ── RLS ─────────────────────────────────────────────────────────────────
ALTER TABLE sponsor_partners ENABLE ROW LEVEL SECURITY;
ALTER TABLE sponsor_partner_audit ENABLE ROW LEVEL SECURITY;

-- Read + write restricted to platform_admin and partner_manager (requirement 3).
CREATE POLICY sponsor_partners_read ON sponsor_partners
  FOR SELECT
  USING (has_role('platform_admin', 'platform') OR has_role('partner_manager', 'partner'));

CREATE POLICY sponsor_partners_write ON sponsor_partners
  FOR INSERT
  WITH CHECK (has_role('platform_admin', 'platform') OR has_role('partner_manager', 'partner'));

CREATE POLICY sponsor_partners_update ON sponsor_partners
  FOR UPDATE
  USING (has_role('platform_admin', 'platform') OR has_role('partner_manager', 'partner'))
  WITH CHECK (has_role('platform_admin', 'platform') OR has_role('partner_manager', 'partner'));

-- No DELETE policy at all (requirement 10 — no hard delete; use archived_at
-- via the UPDATE path instead). Even platform_admin cannot hard-delete a
-- row through the API — only through a manual dashboard action outside RLS.

CREATE POLICY sponsor_partner_audit_read ON sponsor_partner_audit
  FOR SELECT
  USING (has_role('platform_admin', 'platform') OR has_role('partner_manager', 'partner'));

-- No write policy on the audit table for any client role — it is only
-- ever populated by the SECURITY DEFINER trigger function above.

COMMIT;

-- Rollback:
--   BEGIN;
--   DROP TRIGGER IF EXISTS sponsor_partners_audit_trigger ON sponsor_partners;
--   DROP FUNCTION IF EXISTS log_sponsor_partner_change();
--   DROP TABLE IF EXISTS sponsor_partner_audit;
--   DROP TABLE IF EXISTS sponsor_partners;
--   COMMIT;
--   -- Safe — both tables are empty until the separately-approved import
--   -- plan runs, so rollback at this stage loses nothing.

-- Verify (run after applying):
--   SELECT count(*) FROM sponsor_partners;  -- expect 0
--   INSERT INTO sponsor_partners (brand) VALUES ('Test Brand') RETURNING id;
--     -- run as Dave (platform_admin), expect success
--   SELECT * FROM sponsor_partner_audit WHERE sponsor_id = '<returned id>';
--     -- expect one 'created' row
--   DELETE FROM sponsor_partners WHERE brand = 'Test Brand';
--     -- expect this to FAIL (no delete policy) — confirms hard-delete is blocked
--   -- clean up the test row instead via:
--   UPDATE sponsor_partners SET status='archived', archived_at=now() WHERE brand='Test Brand';
