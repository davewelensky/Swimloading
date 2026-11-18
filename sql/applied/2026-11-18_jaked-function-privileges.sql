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
-- Migration: 2026-11-18_jaked-function-privileges.sql
-- Process:   see MIGRATIONS.md — no section below may be left empty
-- STATUS:    APPLIED 18 Nov 2026 10:28:54 UTC on production (szgkzuswelntnevobnoh) after Dave typed "apply"; Supabase migration 20261118102854_jaked_function_privileges (MIGRATION section verbatim). Verified: V1-V3 as expected; trigger still logs (rolled-back probe); advisors: 6 rows cleared, 5 remain by design, 0 other change.
-- DEPENDS ON: sql/applied/2026-11-18_create-user-roles.sql and
--             sql/applied/2026-11-18_jaked-business-workspace.sql
-- ================================================================

-- Purpose:
--   Tighten who may EXECUTE the functions added by the two migrations
--   above. Postgres grants EXECUTE to PUBLIC by default and Supabase also
--   grants anon/authenticated, so the security advisor (18 Nov 2026,
--   after the apply) flagged 10 new WARN rows: has_role, grant_role,
--   revoke_role, can_manage_partner and jaked_log_change callable by
--   `anon` and `authenticated` via /rest/v1/rpc. None is exploitable
--   (each answers only for the caller; grant/revoke refuse non-admins;
--   a trigger function cannot run outside a trigger), but anon has no
--   reason to call any of them. After this migration:
--     * trigger functions — no client role can call them (triggers still
--       fire: Postgres does not check EXECUTE when a trigger runs);
--     * grant_role / revoke_role — authenticated + service_role only;
--     * has_role / can_manage_partner / jaked_partner_id — authenticated +
--       service_role only (RLS policies need them for signed-in users);
--     * anon loses table access to user_roles and jaked_activity_log so it
--       gets a clean "permission denied" instead of RLS calling a
--       function it may not execute.
--   Expected advisor result: the 5 anon rows and the jaked_log_change
--   authenticated row clear. The authenticated rows for has_role,
--   can_manage_partner, grant_role and revoke_role remain BY DESIGN
--   (RLS and the admin UI need them; each checks auth.uid() itself).
--   The _bak_20261118_partner_enquiries INFO row also remains by design
--   (server-only backup, same as every other _bak_* table).

-- Requested by:
--   Claude, from the post-apply security advisor check of 18 Nov 2026;
--   requires Dave's "apply".

-- ----------------------------------------------------------------
-- PRE-CHECKS — run on the READ-ONLY connection BEFORE applying.
-- ----------------------------------------------------------------
-- select proname, has_function_privilege('anon', p.oid, 'EXECUTE') anon_x,
--        has_function_privilege('authenticated', p.oid, 'EXECUTE') auth_x
--   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--  where n.nspname = 'public' and proname in ('has_role','grant_role','revoke_role',
--        'can_manage_partner','jaked_partner_id','jaked_log_change',
--        'jaked_tasks_before_write','jaked_activity_log_immutable');
--   -- expect 8 rows, all anon_x = true, auth_x = true (read 18 Nov 2026)
-- select has_table_privilege('anon','public.user_roles','SELECT'),
--        has_table_privilege('anon','public.jaked_activity_log','SELECT');
--   -- expect true, true

-- ----------------------------------------------------------------
-- BACKUP — not applicable: privileges only, no data is changed.
-- ----------------------------------------------------------------

-- ----------------------------------------------------------------
-- MIGRATION — applied only after Dave types "apply".
-- ----------------------------------------------------------------
BEGIN;

-- Trigger functions: never called directly by anyone.
REVOKE EXECUTE ON FUNCTION jaked_log_change()             FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION jaked_tasks_before_write()     FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION jaked_activity_log_immutable() FROM PUBLIC, anon, authenticated;

-- Role management: signed-in callers only (the functions still refuse
-- anyone who is not platform_admin).
REVOKE EXECUTE ON FUNCTION grant_role(uuid, text, text, uuid, jsonb) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION revoke_role(uuid)                         FROM PUBLIC, anon;

-- RLS helpers: signed-in callers only.
REVOKE EXECUTE ON FUNCTION has_role(text, text, uuid)    FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION can_manage_partner(uuid)      FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION jaked_partner_id()            FROM PUBLIC, anon;

-- Explicit grants for the roles that keep access (PUBLIC was the source
-- for some of them; make the intent visible in the ACL).
GRANT EXECUTE ON FUNCTION grant_role(uuid, text, text, uuid, jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION revoke_role(uuid)                         TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION has_role(text, text, uuid)                TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION can_manage_partner(uuid)                  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION jaked_partner_id()                        TO authenticated, service_role;

-- anon has no business reading these tables at all.
REVOKE ALL ON user_roles         FROM anon;
REVOKE ALL ON jaked_activity_log FROM anon;

COMMIT;

-- ----------------------------------------------------------------
-- ROLLBACK — restores the default privileges exactly as before.
-- ----------------------------------------------------------------
-- BEGIN;
-- GRANT EXECUTE ON FUNCTION jaked_log_change(), jaked_tasks_before_write(),
--   jaked_activity_log_immutable(), grant_role(uuid, text, text, uuid, jsonb),
--   revoke_role(uuid), has_role(text, text, uuid), can_manage_partner(uuid),
--   jaked_partner_id() TO PUBLIC, anon, authenticated;
-- GRANT ALL ON user_roles, jaked_activity_log TO anon;
-- REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON jaked_activity_log FROM anon;   -- as the workspace migration left it
-- COMMIT;

-- ----------------------------------------------------------------
-- VERIFY — run on the READ-ONLY connection AFTER applying.
-- ----------------------------------------------------------------
-- 1. Re-run the pre-check function query.
--    expect: anon_x = false for all 8; auth_x = false for the 3 trigger
--    functions, true for the other 5.
-- 2. select has_table_privilege('anon','public.user_roles','SELECT'),
--           has_table_privilege('anon','public.jaked_activity_log','SELECT');
--    expect false, false
-- 3. select count(*) from jaked_activity_log;  -- expect unchanged (1 + any real activity)
-- 4. Security advisors: the 5 anon rows and jaked_log_change/authenticated
--    row are gone; nothing new.
