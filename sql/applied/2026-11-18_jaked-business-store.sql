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
-- Migration: 2026-11-18_jaked-business-store.sql
-- Process:   see MIGRATIONS.md — no section below may be left empty
-- STATUS:    APPLIED 18 Nov 2026 13:11:08 UTC on production (szgkzuswelntnevobnoh) after Dave typed "apply"; Supabase migration 20261118131108_jaked_business_store (MIGRATION section verbatim). Verified: V1-V5 as expected; save function, workspace columns and policy fingerprints identical to the tested file.
-- DEPENDS ON: sql/applied/2026-11-18_create-user-roles.sql,
--             sql/applied/2026-11-18_jaked-business-workspace.sql,
--             sql/applied/2026-11-18_jaked-function-privileges.sql
-- SUPERSEDES: Dave's local draft sql/2026-11-18_jaked-business.sql (never
--             applied). Same catalogue / workspace / save design; access
--             now comes from the live JAKED role instead of a second
--             members list, and saves go into jaked_activity_log.
-- ================================================================

-- Purpose:
--   Stage 1 of the JAKED business platform: the storage Dave's
--   /jaked-business page reads and writes.
--     1. jaked_business_catalogue — private supplier catalogue snapshots
--        (JAKED wholesale prices, stock by channel, catalogue links). Read
--        by the JAKED team only; written only by migrations. The data is
--        loaded by a separate migration and NEVER committed to git (the
--        repo is public).
--     2. jaked_business_workspace — one shared workspace (orders, pricing
--        scenarios, own-stock ledger, image overrides) as versioned JSON.
--        Saved only through jaked_business_save(), which refuses a save
--        made against an out-of-date version, so Dave and Carina can never
--        silently overwrite each other.
--     3. Every save writes one jaked_activity_log row (entity 'workspace'):
--        who, when, version from/to, which sections changed, order counts,
--        each order's stage change, and an md5 fingerprint of the saved
--        state. The log stays append-only.
--   Access everywhere: (select can_manage_partner(jaked_partner_id())) —
--   Dave (platform_admin) and Carina (partner_manager on JAKED).

-- Requested by:
--   Dave, 18 Nov 2026 — "I want to access the page"; Stage 1 approved
--   ("Yes, build Stage 1 now").

-- ----------------------------------------------------------------
-- PRE-CHECKS — run on the READ-ONLY connection BEFORE applying.
-- ----------------------------------------------------------------
-- 1. select count(*) from information_schema.tables where table_schema='public'
--      and table_name like 'jaked_business%';                       -- expect 0
-- 2. select count(*) from pg_proc where proname = 'jaked_business_save'; -- expect 0
-- 3. select pg_get_constraintdef(oid) from pg_constraint
--      where conname = 'jaked_activity_log_entity_check';
--      -- expect CHECK ((entity = ANY (ARRAY['enquiry'::text, 'task'::text, 'role'::text])))
-- 4. select count(*) from jaked_activity_log;                         -- record N (unchanged by this file)

-- ----------------------------------------------------------------
-- BACKUP — not applicable: new tables only. The one ALTER widens a CHECK
-- constraint on jaked_activity_log (adds 'workspace'); no row changes.
-- ----------------------------------------------------------------

-- ----------------------------------------------------------------
-- MIGRATION — applied only after Dave types "apply".
-- ----------------------------------------------------------------
BEGIN;

-- 0. Dependency guard
DO $$
BEGIN
  IF to_regprocedure('public.can_manage_partner(uuid)') IS NULL
     OR to_regprocedure('public.jaked_partner_id()') IS NULL
     OR to_regclass('public.jaked_activity_log') IS NULL THEN
    RAISE EXCEPTION 'Apply the 2026-11-18 roles / workspace / privileges migrations first';
  END IF;
END $$;

-- 1. Activity log: allow workspace saves ---------------------------------
ALTER TABLE jaked_activity_log DROP CONSTRAINT jaked_activity_log_entity_check;
ALTER TABLE jaked_activity_log ADD CONSTRAINT jaked_activity_log_entity_check
  CHECK (entity IN ('enquiry', 'task', 'role', 'workspace'));

-- 2. Private catalogue ----------------------------------------------------
CREATE TABLE jaked_business_catalogue (
  snapshot_date  date        PRIMARY KEY,
  payload        jsonb       NOT NULL CHECK (jsonb_typeof(payload) = 'object'
                                             AND jsonb_typeof(payload->'products') = 'array'
                                             AND jsonb_typeof(payload->'variants') = 'array'),
  payload_md5    text        GENERATED ALWAYS AS (md5(payload::text)) STORED,
  created_at     timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE jaked_business_catalogue IS
  'Private JAKED supplier catalogue snapshots (wholesale prices, stock by '
  'channel, catalogue links). JAKED team read-only; written by migrations '
  'only. Supplier data: never commit it to git (the repo is public).';

ALTER TABLE jaked_business_catalogue ENABLE ROW LEVEL SECURITY;
CREATE POLICY jaked_business_catalogue_team_read ON jaked_business_catalogue
  FOR SELECT TO authenticated
  USING ((SELECT can_manage_partner(jaked_partner_id())));
REVOKE ALL ON jaked_business_catalogue FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON jaked_business_catalogue FROM authenticated;

-- 3. Shared workspace -----------------------------------------------------
CREATE TABLE jaked_business_workspace (
  id          integer     PRIMARY KEY CHECK (id = 1),
  uid         uuid        NOT NULL UNIQUE DEFAULT gen_random_uuid(),   -- stable id for the activity log
  version     integer     NOT NULL DEFAULT 0 CHECK (version >= 0),
  state       jsonb       NOT NULL DEFAULT '{}'::jsonb,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  uuid        NULL REFERENCES auth.users(id) ON DELETE SET NULL
);

COMMENT ON TABLE jaked_business_workspace IS
  'The one shared JAKED business workspace (orders, pricing scenarios, own '
  'stock ledger, media overrides). Written ONLY by jaked_business_save(), '
  'which rejects stale versions and logs every save.';

INSERT INTO jaked_business_workspace (id) VALUES (1);

ALTER TABLE jaked_business_workspace ENABLE ROW LEVEL SECURITY;
CREATE POLICY jaked_business_workspace_team_read ON jaked_business_workspace
  FOR SELECT TO authenticated
  USING ((SELECT can_manage_partner(jaked_partner_id())));
REVOKE ALL ON jaked_business_workspace FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON jaked_business_workspace FROM authenticated;

-- 4. The only way to write the workspace ---------------------------------
CREATE FUNCTION jaked_business_save(expected_version integer, new_state jsonb, change_summary text)
RETURNS SETOF jaked_business_workspace
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_old      public.jaked_business_workspace%ROWTYPE;
  v_changes  jsonb;
  v_stages   jsonb;
  v_sections text[];
BEGIN
  IF auth.uid() IS NULL OR NOT public.can_manage_partner(public.jaked_partner_id()) THEN
    RAISE EXCEPTION 'Access denied' USING ERRCODE = '42501';
  END IF;
  IF new_state IS NULL OR jsonb_typeof(new_state) <> 'object'
     OR pg_column_size(new_state) > 2097152
     OR jsonb_typeof(new_state->'orders')    IS DISTINCT FROM 'array'
     OR jsonb_typeof(new_state->'cases')     IS DISTINCT FROM 'object'
     OR jsonb_typeof(new_state->'inventory') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Invalid workspace' USING ERRCODE = '22023';
  END IF;
  IF char_length(coalesce(change_summary, '')) NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION 'Change summary required' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_old FROM public.jaked_business_workspace WHERE id = 1 FOR UPDATE;
  IF v_old.version IS DISTINCT FROM expected_version THEN
    RAISE EXCEPTION 'workspace_conflict' USING ERRCODE = '40001';
  END IF;

  -- Which top-level sections changed (orders, cases, inventory, media, …)
  SELECT coalesce(array_agg(k ORDER BY k), '{}') INTO v_sections
    FROM (SELECT key AS k FROM jsonb_each(new_state)
          UNION SELECT key FROM jsonb_each(v_old.state)) keys
   WHERE (new_state -> k) IS DISTINCT FROM (v_old.state -> k);

  -- Per-order stage changes, matched by order id
  SELECT jsonb_agg(jsonb_build_object('order', n->>'name', 'from', o->>'stage', 'to', n->>'stage'))
    INTO v_stages
    FROM jsonb_array_elements(new_state->'orders') n
    LEFT JOIN LATERAL (
      SELECT x FROM jsonb_array_elements(coalesce(v_old.state->'orders', '[]'::jsonb)) x
       WHERE x->>'id' = n->>'id') prev(o) ON true
   WHERE (o->>'stage') IS DISTINCT FROM (n->>'stage');

  UPDATE public.jaked_business_workspace
     SET version = version + 1, state = new_state, updated_at = now(), updated_by = auth.uid()
   WHERE id = 1;

  v_changes := jsonb_build_object(
    'version',  jsonb_build_object('from', v_old.version, 'to', v_old.version + 1),
    'sections', to_jsonb(v_sections),
    'orders',   jsonb_build_object('from', jsonb_array_length(coalesce(v_old.state->'orders', '[]'::jsonb)),
                                   'to',   jsonb_array_length(new_state->'orders')),
    'inventory_entries', jsonb_build_object('from', jsonb_array_length(coalesce(v_old.state->'inventory', '[]'::jsonb)),
                                            'to',   jsonb_array_length(new_state->'inventory')),
    'stage_changes', coalesce(v_stages, '[]'::jsonb),
    'state_md5', md5(new_state::text));

  INSERT INTO public.jaked_activity_log (actor_id, entity, entity_id, action, changes, summary)
  VALUES (auth.uid(), 'workspace', v_old.uid, 'updated', v_changes,
          left('Workspace v' || (v_old.version + 1) || ': ' || change_summary, 300));

  RETURN QUERY SELECT * FROM public.jaked_business_workspace WHERE id = 1;
END;
$$;

COMMENT ON FUNCTION jaked_business_save IS
  'Saves the shared JAKED workspace. Refuses non-team callers (42501), '
  'malformed state (22023) and stale versions (40001 workspace_conflict). '
  'Writes one jaked_activity_log row per save.';

REVOKE EXECUTE ON FUNCTION jaked_business_save(integer, jsonb, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION jaked_business_save(integer, jsonb, text) TO authenticated, service_role;

COMMIT;

-- ----------------------------------------------------------------
-- ROLLBACK — export the workspace first (it holds business records):
--   select state from jaked_business_workspace;  -- save the JSON
-- ----------------------------------------------------------------
-- BEGIN;
-- DROP FUNCTION IF EXISTS jaked_business_save(integer, jsonb, text);
-- DROP TABLE IF EXISTS jaked_business_workspace;
-- DROP TABLE IF EXISTS jaked_business_catalogue;
-- -- Only if no 'workspace' rows exist in the log (it is append-only, so
-- -- normally leave the widened constraint in place):
-- -- ALTER TABLE jaked_activity_log DROP CONSTRAINT jaked_activity_log_entity_check;
-- -- ALTER TABLE jaked_activity_log ADD CONSTRAINT jaked_activity_log_entity_check
-- --   CHECK (entity IN ('enquiry', 'task', 'role'));
-- COMMIT;

-- ----------------------------------------------------------------
-- VERIFY — run on the READ-ONLY connection AFTER applying.
-- ----------------------------------------------------------------
-- 1. select relname, relrowsecurity from pg_class
--      where relname in ('jaked_business_catalogue','jaked_business_workspace'); -- expect both true
-- 2. select id, version, state from jaked_business_workspace;      -- expect 1 row: 1, 0, {}
-- 3. select count(*) from jaked_business_catalogue;                -- expect 0 (data arrives in the next migration)
-- 4. select has_table_privilege('anon','public.jaked_business_workspace','SELECT'),
--           has_table_privilege('authenticated','public.jaked_business_workspace','UPDATE'),
--           has_function_privilege('anon','public.jaked_business_save(integer,jsonb,text)','EXECUTE');
--      -- expect false, false, false
-- 5. select count(*) from jaked_activity_log;                       -- expect N from pre-check 4
-- 6. Security advisors: only the by-design authenticated row for
--    jaked_business_save is new.
