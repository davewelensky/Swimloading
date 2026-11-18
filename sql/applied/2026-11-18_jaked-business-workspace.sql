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
-- Migration: 2026-11-18_jaked-business-workspace.sql
-- Process:   see MIGRATIONS.md — no section below may be left empty
-- STATUS:    APPLIED 18 Nov 2026 10:17:13 UTC on production (szgkzuswelntnevobnoh) after Dave typed "apply"; Supabase migration 20261118101713_jaked_business_workspace (MIGRATION section verbatim). Verified: V1-V7 as expected, tamper test refused, 8 fingerprints identical to the tested file.
-- REDACTED 18 Nov 2026 (Dave's request): Carina's email address is removed
--             from this public copy and replaced by her account id. As run,
--             the step-0 guard also matched her email; the verbatim executed
--             SQL is kept privately in supabase_migrations.schema_migrations
--             (version 20261118101713). Nothing else differs.
-- DEPENDS ON: 2026-11-18_create-user-roles.sql (applied first; this file
--             aborts if user_roles does not exist).
-- ================================================================

-- Purpose:
--   Phase 1 of the JAKED business platform (Dave + Carina run the JAKED
--   business together from /jaked-business):
--     1. Carina gets JAKED-only access: user_roles 'partner_manager' on the
--        JAKED partner (partner_pages.id eb8644d9-…). She does NOT get
--        is_admin, growth_founders, or any club / sponsor / media access.
--     2. partner_enquiries can hold enquiries logged by hand (WhatsApp,
--        Instagram, phone, in person …), with who logged it and who owns it.
--        A manual enquiry may have a phone number instead of an email.
--     3. jaked_tasks — the shared Dave + Carina task list (owner, due date,
--        area, status, optional link to an enquiry). Not growth_tasks: that
--        table is gated by growth_founders, which would expose the whole
--        Growth Hub to Carina.
--     4. jaked_activity_log — append-only audit trail. A trigger writes one
--        row for every enquiry / task / JAKED role create, change or delete: who, when, and
--        each changed field's old and new value. Nobody (not even the API's
--        service key) can edit or delete a log row.
--   Existing table checked first (18 Nov 2026, read-only): partner_enquiries
--   is extended, not replaced. jaked_tasks / jaked_activity_log do not exist.

-- Requested by:
--   Dave, 18 Nov 2026 — "a platform for Carina and I to build the JAKED
--   brand … we both need to work on this app … see all statuses".
--   Decisions confirmed by Dave the same day: inside SwimLoading; Carina on
--   a JAKED-only role via the July user_roles system; business model not
--   decided yet (this file is model-neutral: no prices, orders or money);
--   payments later = EFT + invoice.

-- ----------------------------------------------------------------
-- PRE-CHECKS — run on the READ-ONLY connection BEFORE applying.
-- ----------------------------------------------------------------
-- 1. select to_regclass('public.user_roles');                        -- expect user_roles (migration 1 applied)
-- 2. select id, name from partner_pages
--      where id = 'eb8644d9-28d2-4d08-87f1-4230da07e1c5';            -- expect 1 row, name JAKED
-- 3. select id from auth.users
--      where id = 'cff2fc33-4a55-451b-8c7f-20f12c1898ce';            -- expect 1 row (Carina's account)
-- 4. select count(*) from information_schema.tables where table_schema='public'
--      and table_name in ('jaked_tasks','jaked_activity_log');        -- expect 0
-- 5. select count(*) from information_schema.columns where table_schema='public'
--      and table_name='partner_enquiries'
--      and column_name in ('entry_method','channel','created_by','assigned_to'); -- expect 0
-- 6. select count(*) from partner_enquiries;                         -- expect 1 (16 Nov BLADE enquiry); recorded for the backup check
-- 7. select count(*) from partner_enquiries where email is null;     -- expect 0

-- ----------------------------------------------------------------
-- BACKUP — this file ALTERs partner_enquiries (adds columns, drops the
-- NOT NULL on email). No row is updated or deleted, but a backup is taken
-- anyway so the table can be restored exactly.
-- ----------------------------------------------------------------
-- (inside the transaction below, first statement after the dependency check)

-- ----------------------------------------------------------------
-- MIGRATION — applied only after Dave types "apply".
-- ----------------------------------------------------------------
BEGIN;

-- 0. Dependency + identity guards ---------------------------------------
DO $$
BEGIN
  IF to_regclass('public.user_roles') IS NULL THEN
    RAISE EXCEPTION 'Apply 2026-11-18_create-user-roles.sql first (user_roles missing)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM partner_pages WHERE id = 'eb8644d9-28d2-4d08-87f1-4230da07e1c5' AND name = 'JAKED') THEN
    RAISE EXCEPTION 'JAKED partner_pages row not found — aborting';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = 'cff2fc33-4a55-451b-8c7f-20f12c1898ce') THEN
    RAISE EXCEPTION 'Carina''s account (cff2fc33-…) not found — aborting';
  END IF;
END $$;

-- Backup (see BACKUP above)
CREATE TABLE _bak_20261118_partner_enquiries AS SELECT * FROM partner_enquiries;
ALTER TABLE _bak_20261118_partner_enquiries ENABLE ROW LEVEL SECURITY;

-- 1. Access helpers -----------------------------------------------------
-- The JAKED partner id, in one place (partner_pages.id). IMMUTABLE so RLS
-- policies can inline it.
CREATE FUNCTION jaked_partner_id()
RETURNS uuid LANGUAGE sql IMMUTABLE SET search_path = public
AS $$ SELECT 'eb8644d9-28d2-4d08-87f1-4230da07e1c5'::uuid $$;

-- True for a platform_admin, or a partner_manager of that partner. Checks
-- the CALLING user only (auth.uid() inside has_role) — you cannot ask about
-- someone else. Server code using the service key checks user_roles itself.
CREATE FUNCTION can_manage_partner(p_partner_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT has_role('platform_admin', 'platform', NULL)
      OR has_role('partner_manager', 'partner', p_partner_id)
$$;

COMMENT ON FUNCTION can_manage_partner IS
  'RLS helper: platform_admin, or partner_manager on p_partner_id. Use '
  '(select can_manage_partner(jaked_partner_id())) in JAKED policies.';

-- 2. Activity log (append-only) ----------------------------------------
CREATE TABLE jaked_activity_log (
  id           bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  occurred_at  timestamptz NOT NULL DEFAULT now(),
  actor_id     uuid        NULL REFERENCES auth.users(id) ON DELETE SET NULL,  -- NULL = public web form / system
  entity       text        NOT NULL CHECK (entity IN ('enquiry', 'task', 'role')),
  entity_id    uuid        NOT NULL,
  action       text        NOT NULL CHECK (action IN ('created', 'updated', 'deleted')),
  changes      jsonb       NULL,      -- updates: {"field": {"from": …, "to": …}}; creates: key fields only
  summary      text        NULL CHECK (summary IS NULL OR char_length(summary) <= 300)
);

COMMENT ON TABLE jaked_activity_log IS
  'Append-only audit trail for the JAKED business platform. Written only by '
  'the jaked_log_change() trigger. UPDATE / DELETE / TRUNCATE are blocked by '
  'trigger for every role, including the service key.';

CREATE INDEX jaked_activity_log_entity_idx ON jaked_activity_log (entity, entity_id, occurred_at DESC);
CREATE INDEX jaked_activity_log_time_idx   ON jaked_activity_log (occurred_at DESC);

CREATE FUNCTION jaked_activity_log_immutable()
RETURNS trigger LANGUAGE plpgsql SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'jaked_activity_log is append-only (% blocked)', TG_OP;
END;
$$;

CREATE TRIGGER jaked_activity_log_no_update_delete
  BEFORE UPDATE OR DELETE ON jaked_activity_log
  FOR EACH ROW EXECUTE FUNCTION jaked_activity_log_immutable();
CREATE TRIGGER jaked_activity_log_no_truncate
  BEFORE TRUNCATE ON jaked_activity_log
  FOR EACH STATEMENT EXECUTE FUNCTION jaked_activity_log_immutable();

ALTER TABLE jaked_activity_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY jaked_activity_log_team_read ON jaked_activity_log
  FOR SELECT TO authenticated
  USING ((SELECT can_manage_partner(jaked_partner_id())));
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON jaked_activity_log FROM anon, authenticated;

-- The one writer. SECURITY DEFINER so it can insert past RLS / the REVOKE.
-- Actor: the signed-in user (browser) or, for API calls made with the
-- service key, the updated_by / created_by the API sets on the row.
CREATE FUNCTION jaked_log_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
-- One function for three tables with different columns, so every field is
-- read through jsonb (v_new / v_old), never NEW.<col> — a missing column on
-- one table must not break the others.
DECLARE
  -- On DELETE there is no NEW: the deleted row is read as v_new.
  v_new     jsonb := CASE WHEN TG_OP = 'DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
  v_old     jsonb := CASE WHEN TG_OP = 'UPDATE' THEN to_jsonb(OLD) END;
  v_entity  text;
  v_actor   uuid;
  v_changes jsonb;
  v_summary text;
BEGIN
  v_entity := CASE TG_TABLE_NAME
                WHEN 'partner_enquiries' THEN 'enquiry'
                WHEN 'jaked_tasks'       THEN 'task'
                WHEN 'user_roles'        THEN 'role'
              END;
  IF v_entity IS NULL THEN
    RAISE EXCEPTION 'jaked_log_change() attached to unexpected table %', TG_TABLE_NAME;
  END IF;

  -- Only JAKED role grants are logged.
  IF v_entity = 'role'
     AND NOT (v_new->>'scope' = 'partner' AND v_new->>'resource_id' = jaked_partner_id()::text) THEN
    RETURN NULL;   -- AFTER trigger: return value ignored
  END IF;

  -- Actor: signed-in user (browser), else what the API / migration recorded.
  v_actor := coalesce(
    auth.uid(),
    CASE WHEN v_entity = 'role' THEN (v_new->>'granted_by')::uuid
         ELSE coalesce((v_new->>'updated_by')::uuid, (v_new->>'created_by')::uuid) END);
  -- A public web-form submission has no actor.
  IF TG_OP = 'INSERT' AND v_entity = 'enquiry' AND v_new->>'entry_method' = 'web_form' THEN
    v_actor := NULL;
  END IF;

  IF TG_OP = 'DELETE' THEN
    -- Should not happen in normal use (enquiries are cancelled, tasks are
    -- cancelled, roles are revoked) — but if anyone deletes, it is on record.
    v_actor := auth.uid();
    v_changes := jsonb_build_object('reference', v_new->'reference', 'title', v_new->'title',
                   'status', v_new->'status', 'role', v_new->'role');
    v_changes := jsonb_strip_nulls(v_changes);
    v_summary := initcap(v_entity) || ' DELETED' || coalesce(': ' || coalesce(v_new->>'reference', left(v_new->>'title', 200), v_new->>'role'), '');
  ELSIF TG_OP = 'INSERT' THEN
    IF v_entity = 'enquiry' THEN
      -- Customer details are NOT copied into the log: the enquiry row holds them.
      v_changes := jsonb_build_object(
        'reference', v_new->'reference', 'status', v_new->'status',
        'product_category', v_new->'product_category',
        'entry_method', v_new->'entry_method', 'channel', v_new->'channel');
      v_summary := CASE WHEN v_new->>'entry_method' = 'manual'
        THEN 'Enquiry ' || (v_new->>'reference') || ' logged by hand' || coalesce(' (' || (v_new->>'channel') || ')', '')
        ELSE 'Enquiry ' || (v_new->>'reference') || ' received via the web form' END;
    ELSIF v_entity = 'task' THEN
      v_changes := jsonb_build_object(
        'title', v_new->'title', 'status', v_new->'status', 'owner_id', v_new->'owner_id',
        'due_date', v_new->'due_date', 'area', v_new->'area', 'priority', v_new->'priority');
      v_summary := 'Task created: ' || left(v_new->>'title', 200);
    ELSE
      v_changes := jsonb_build_object(
        'user_id', v_new->'user_id', 'role', v_new->'role',
        'scope', v_new->'scope', 'resource_id', v_new->'resource_id');
      v_summary := 'JAKED access granted (' || (v_new->>'role') || ')';
    END IF;
  ELSE
    SELECT jsonb_object_agg(n.key, jsonb_build_object('from', o.value, 'to', n.value))
      INTO v_changes
      FROM jsonb_each(v_new) n
      JOIN jsonb_each(v_old) o USING (key)
     WHERE n.value IS DISTINCT FROM o.value
       AND n.key NOT IN ('updated_at', 'status_changed_at', 'updated_by', 'ip_hash');
    IF v_changes IS NULL THEN
      RETURN NULL;  -- nothing meaningful changed; AFTER trigger, value ignored
    END IF;
    v_summary := CASE
      WHEN v_entity = 'role' AND v_new->>'revoked_at' IS NOT NULL AND v_old->>'revoked_at' IS NULL
        THEN 'JAKED access revoked (' || (v_new->>'role') || ')'
      WHEN v_changes ? 'status'
        THEN initcap(v_entity) || ' status: ' || coalesce(v_old->>'status', '?') || ' -> ' || coalesce(v_new->>'status', '?')
      ELSE initcap(v_entity) || ' updated: ' || (SELECT string_agg(k, ', ' ORDER BY k) FROM jsonb_object_keys(v_changes) k)
    END;
  END IF;

  INSERT INTO jaked_activity_log (actor_id, entity, entity_id, action, changes, summary)
  VALUES (v_actor, v_entity, (v_new->>'id')::uuid,
          CASE TG_OP WHEN 'INSERT' THEN 'created' WHEN 'UPDATE' THEN 'updated' ELSE 'deleted' END,
          v_changes, left(v_summary, 300));
  RETURN NULL;   -- AFTER trigger: return value ignored
END;
$$;

-- 3. partner_enquiries: manual entries, owner, who logged it ------------
ALTER TABLE partner_enquiries
  ADD COLUMN entry_method text NOT NULL DEFAULT 'web_form',
  ADD COLUMN channel      text NULL,
  ADD COLUMN created_by   uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN assigned_to  uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE partner_enquiries
  ADD CONSTRAINT partner_enquiries_entry_method_vals
    CHECK (entry_method IN ('web_form', 'manual')),
  ADD CONSTRAINT partner_enquiries_channel_vals
    CHECK (channel IS NULL OR channel IN ('website', 'whatsapp', 'instagram', 'facebook', 'email', 'phone', 'in_person', 'event', 'referral', 'other')),
  ADD CONSTRAINT partner_enquiries_manual_has_author
    CHECK (entry_method <> 'manual' OR (created_by IS NOT NULL AND channel IS NOT NULL));

-- A WhatsApp / phone lead may have no email. Web-form enquiries still must.
ALTER TABLE partner_enquiries ALTER COLUMN email DROP NOT NULL;
ALTER TABLE partner_enquiries
  ADD CONSTRAINT partner_enquiries_contact_present
    CHECK (email IS NOT NULL OR (entry_method = 'manual' AND phone IS NOT NULL));

CREATE INDEX partner_enquiries_partner_status_idx ON partner_enquiries (partner, status);

COMMENT ON COLUMN partner_enquiries.entry_method IS 'web_form = /partners/jaked form; manual = logged by the JAKED team';
COMMENT ON COLUMN partner_enquiries.channel      IS 'Where a manual enquiry came from (whatsapp, instagram, phone, in_person, …)';
COMMENT ON COLUMN partner_enquiries.assigned_to  IS 'Team member who owns this enquiry (Dave or Carina)';

-- partner_enquiries stays server-only (RLS on, no policies, no anon /
-- authenticated grants) — unchanged. The /api/partner-enquiries handler
-- checks the JAKED role with the service key.

CREATE TRIGGER partner_enquiries_activity_log
  AFTER INSERT OR UPDATE OR DELETE ON partner_enquiries
  FOR EACH ROW EXECUTE FUNCTION jaked_log_change();

-- 4. jaked_tasks --------------------------------------------------------
CREATE TABLE jaked_tasks (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  title         text        NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
  details       text        NULL CHECK (details IS NULL OR char_length(details) <= 4000),
  area          text        NOT NULL DEFAULT 'operations' CHECK (area IN
                  ('launch', 'sales', 'marketing', 'fulfilment', 'finance', 'legal', 'supplier', 'operations')),
  status        text        NOT NULL DEFAULT 'todo' CHECK (status IN
                  ('todo', 'in_progress', 'waiting', 'done', 'cancelled')),
  priority      text        NOT NULL DEFAULT 'normal' CHECK (priority IN ('high', 'normal', 'low')),
  owner_id      uuid        NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  due_date      date        NULL,
  enquiry_id    uuid        NULL REFERENCES partner_enquiries(id) ON DELETE SET NULL,
  created_by    uuid        NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id),
  updated_by    uuid        NULL DEFAULT auth.uid() REFERENCES auth.users(id),
  completed_at  timestamptz NULL
);

COMMENT ON TABLE jaked_tasks IS
  'Shared Dave + Carina task list for the JAKED business. Never deleted — '
  'set status = cancelled so the audit trail stays whole.';

CREATE INDEX jaked_tasks_open_idx  ON jaked_tasks (status, due_date) WHERE status NOT IN ('done', 'cancelled');
CREATE INDEX jaked_tasks_owner_idx ON jaked_tasks (owner_id) WHERE status NOT IN ('done', 'cancelled');

CREATE FUNCTION jaked_tasks_before_write()
RETURNS trigger LANGUAGE plpgsql SET search_path = public
AS $$
BEGIN
  NEW.updated_at := now();
  NEW.updated_by := coalesce(auth.uid(), NEW.updated_by);
  IF NEW.status <> 'done' THEN
    NEW.completed_at := NULL;
  ELSIF TG_OP = 'INSERT' THEN
    NEW.completed_at := now();
  ELSIF OLD.status <> 'done' THEN
    NEW.completed_at := now();
  END IF;   -- done -> done keeps the original completed_at
  RETURN NEW;
END;
$$;

CREATE TRIGGER jaked_tasks_before_write
  BEFORE INSERT OR UPDATE ON jaked_tasks
  FOR EACH ROW EXECUTE FUNCTION jaked_tasks_before_write();
CREATE TRIGGER jaked_tasks_activity_log
  AFTER INSERT OR UPDATE OR DELETE ON jaked_tasks
  FOR EACH ROW EXECUTE FUNCTION jaked_log_change();

ALTER TABLE jaked_tasks ENABLE ROW LEVEL SECURITY;
CREATE POLICY jaked_tasks_team_read ON jaked_tasks
  FOR SELECT TO authenticated
  USING ((SELECT can_manage_partner(jaked_partner_id())));
CREATE POLICY jaked_tasks_team_insert ON jaked_tasks
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT can_manage_partner(jaked_partner_id())) AND created_by = (SELECT auth.uid()));
CREATE POLICY jaked_tasks_team_update ON jaked_tasks
  FOR UPDATE TO authenticated
  USING ((SELECT can_manage_partner(jaked_partner_id())))
  WITH CHECK ((SELECT can_manage_partner(jaked_partner_id())));
-- No DELETE policy, and DELETE revoked: cancel instead.
REVOKE DELETE, TRUNCATE ON jaked_tasks FROM anon, authenticated;
REVOKE ALL ON jaked_tasks FROM anon;

-- 5. Log JAKED role grants / revokes -----------------------------------
CREATE TRIGGER user_roles_jaked_activity_log
  AFTER INSERT OR UPDATE OR DELETE ON user_roles
  FOR EACH ROW EXECUTE FUNCTION jaked_log_change();

-- 6. Grant Carina JAKED-only access ------------------------------------
-- Direct insert (as the user_roles bootstrap does): a migration has no
-- auth.uid(), so grant_role() cannot be used. granted_by = Dave.
INSERT INTO user_roles (user_id, role, scope, resource_id, granted_by, metadata)
VALUES (
  'cff2fc33-4a55-451b-8c7f-20f12c1898ce'::uuid,          -- Carina
  'partner_manager',
  'partner',
  jaked_partner_id(),
  'df137255-3add-4153-b368-32e06e2be188'::uuid,          -- Dave
  '{"note": "JAKED business platform co-founder access — Dave, 18 Nov 2026, migration 2026-11-18_jaked-business-workspace"}'::jsonb
);

COMMIT;

-- ----------------------------------------------------------------
-- ROLLBACK — exact SQL to undo (no other table is affected).
-- The activity log is append-only by design, so its triggers are dropped
-- before the table.
-- ----------------------------------------------------------------
-- BEGIN;
-- DROP TRIGGER IF EXISTS user_roles_jaked_activity_log ON user_roles;
-- DELETE FROM user_roles WHERE user_id = 'cff2fc33-4a55-451b-8c7f-20f12c1898ce'
--   AND role = 'partner_manager' AND resource_id = 'eb8644d9-28d2-4d08-87f1-4230da07e1c5';
-- DROP TABLE IF EXISTS jaked_tasks;
-- DROP FUNCTION IF EXISTS jaked_tasks_before_write();
-- DROP TRIGGER IF EXISTS partner_enquiries_activity_log ON partner_enquiries;
-- DROP INDEX IF EXISTS partner_enquiries_partner_status_idx;
-- -- only if no manual enquiry without an email exists (else restore from backup):
-- ALTER TABLE partner_enquiries DROP CONSTRAINT IF EXISTS partner_enquiries_contact_present;
-- ALTER TABLE partner_enquiries ALTER COLUMN email SET NOT NULL;
-- ALTER TABLE partner_enquiries DROP CONSTRAINT IF EXISTS partner_enquiries_manual_has_author,
--   DROP CONSTRAINT IF EXISTS partner_enquiries_channel_vals,
--   DROP CONSTRAINT IF EXISTS partner_enquiries_entry_method_vals;
-- ALTER TABLE partner_enquiries DROP COLUMN IF EXISTS assigned_to, DROP COLUMN IF EXISTS created_by,
--   DROP COLUMN IF EXISTS channel, DROP COLUMN IF EXISTS entry_method;
-- DROP TRIGGER IF EXISTS jaked_activity_log_no_update_delete ON jaked_activity_log;
-- DROP TRIGGER IF EXISTS jaked_activity_log_no_truncate ON jaked_activity_log;
-- DROP TABLE IF EXISTS jaked_activity_log;
-- DROP FUNCTION IF EXISTS jaked_log_change();
-- DROP FUNCTION IF EXISTS jaked_activity_log_immutable();
-- DROP FUNCTION IF EXISTS can_manage_partner(uuid);
-- DROP FUNCTION IF EXISTS jaked_partner_id();
-- COMMIT;
-- Data restore if needed: _bak_20261118_partner_enquiries (exact pre-migration copy).

-- ----------------------------------------------------------------
-- VERIFY — run on the READ-ONLY connection AFTER applying.
-- ----------------------------------------------------------------
-- 1. select user_id, role, scope, resource_id, revoked_at from user_roles order by granted_at;
--      -- expect 2 rows: Dave platform_admin/platform/null; Carina partner_manager/partner/eb8644d9-…; both revoked_at null
-- 2. select entity, action, summary from jaked_activity_log;
--      -- expect 1 row: role / created / 'JAKED access granted (partner_manager)'
-- 3. select count(*) from partner_enquiries;                          -- expect same as pre-check 6 (1)
-- 4. select count(*) from _bak_20261118_partner_enquiries;            -- expect same as pre-check 6 (1)
-- 5. select entry_method, count(*) from partner_enquiries group by 1; -- expect web_form = 1
-- 6. select relname, relrowsecurity from pg_class where relname in
--      ('jaked_tasks','jaked_activity_log','_bak_20261118_partner_enquiries'); -- expect all true
-- 7. select grantee, privilege_type from information_schema.role_table_grants
--      where table_name='jaked_activity_log' and grantee in ('anon','authenticated')
--      and privilege_type in ('INSERT','UPDATE','DELETE','TRUNCATE');  -- expect 0 rows
-- 8. Run Supabase security advisors — expect no new findings for these objects.
