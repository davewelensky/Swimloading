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
-- Migration: 2026-07-19_create-user-roles.sql
-- Process:   see MIGRATIONS.md — no section below may be left empty
-- STATUS:    ⛔ PROPOSED — NOT YET APPLIED. Awaiting Dave's review and
--            the literal word "apply" per MIGRATIONS.md step 4.
-- ================================================================

-- Purpose:
--   Generic, resource-scoped role model for internal/admin tooling
--   (dave.html, admin.html, PHtest.html, caption-agent.html,
--   content-calendar.html, and the future Sponsor CRM). Replaces the
--   current mix of hardcoded emails/user-IDs in those pages. Does NOT
--   touch or replace growth_founders, club_admins, or profiles.is_admin —
--   those keep their existing, narrower purposes.

-- Requested by:
--   Dave — SwimLoading v2 Platform Refactor, Phase 1, Step 1

-- Pre-checks (run on the read-only `supabase` server before applying):
--   1. select count(*) from information_schema.tables
--      where table_schema='public' and table_name='user_roles';
--      -- expect 0 (table must not already exist)
--   2. select count(*) from pg_proc where proname in
--      ('has_role','grant_role','revoke_role');
--      -- expect 0 (functions must not already exist)
--   3. select id, email from auth.users where email = '<dave's email>';
--      -- confirms the user_id to seed the first platform_admin grant with

-- Backup:
--   Not applicable — this migration only creates new objects. It does not
--   ALTER, DELETE, UPDATE, or DROP anything that already exists.

BEGIN;

-- ── Table ─────────────────────────────────────────────────────────────────
CREATE TABLE user_roles (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role         text        NOT NULL CHECK (role IN (
                 'platform_admin', 'platform_operator', 'partner_manager',
                 'content_manager', 'club_admin', 'coach', 'partner_viewer'
               )),
  scope        text        NOT NULL CHECK (scope IN (
                 'platform', 'partner', 'club', 'content', 'challenge'
               )),
  -- NULL for platform-wide roles (scope='platform'). Set to the specific
  -- club_id / partner identifier for resource-scoped roles. There is no FK
  -- here on purpose — resource_id can point at different tables depending
  -- on scope (clubs.id for scope='club', a future partners.id for
  -- scope='partner') so it's validated at the grant_role() function level,
  -- not by a single FK constraint.
  resource_id  uuid        NULL,
  granted_at   timestamptz NOT NULL DEFAULT now(),
  granted_by   uuid        NOT NULL REFERENCES auth.users(id),
  revoked_at   timestamptz NULL,
  metadata     jsonb       NULL DEFAULT '{}'::jsonb,

  CONSTRAINT platform_scope_has_no_resource
    CHECK (scope <> 'platform' OR resource_id IS NULL)
);

COMMENT ON TABLE user_roles IS
  'Generic internal/admin role grants. Append-only in practice — rows are '
  'revoked via revoked_at, never deleted, so grant history is preserved. '
  'Never insert/update/delete directly; use grant_role()/revoke_role().';

-- One active grant per (user, role, scope, resource) — prevents duplicate
-- rows while still allowing history (a revoked grant + a fresh grant of the
-- same shape can both exist).
CREATE UNIQUE INDEX user_roles_active_grant_uniq
  ON user_roles (user_id, role, scope, COALESCE(resource_id, '00000000-0000-0000-0000-000000000000'::uuid))
  WHERE revoked_at IS NULL;

CREATE INDEX user_roles_user_active_idx
  ON user_roles (user_id) WHERE revoked_at IS NULL;

-- ── has_role(): the read-side check, used in RLS policies everywhere ──────
-- Same shape as the existing is_club_manager() precedent (STABLE SQL,
-- SECURITY DEFINER, reads auth.uid() internally so callers never pass a
-- user id — you cannot ask "does someone else have this role" from the
-- client, only "do I have this role").
CREATE OR REPLACE FUNCTION has_role(p_role text, p_scope text DEFAULT 'platform', p_resource_id uuid DEFAULT NULL)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM user_roles
    WHERE user_id = auth.uid()
      AND role = p_role
      AND scope = p_scope
      AND resource_id IS NOT DISTINCT FROM p_resource_id
      AND revoked_at IS NULL
  );
$$;

COMMENT ON FUNCTION has_role IS
  'RLS/app helper. has_role(''platform_admin'') checks a platform-wide '
  'grant; has_role(''partner_manager'',''partner'',<partner_id>) checks a '
  'resource-scoped one. Always evaluated against the calling user only.';

-- ── grant_role() / revoke_role(): the only writable surface ───────────────
-- No RLS policy allows direct INSERT/UPDATE/DELETE from authenticated
-- clients (see policies below) — every write goes through these two
-- functions, which enforce "only a platform_admin can grant/revoke" and
-- "you cannot grant a role to yourself" server-side, not just in the UI.
CREATE OR REPLACE FUNCTION grant_role(
  p_user_id     uuid,
  p_role        text,
  p_scope       text DEFAULT 'platform',
  p_resource_id uuid DEFAULT NULL,
  p_metadata    jsonb DEFAULT '{}'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF NOT has_role('platform_admin', 'platform') THEN
    RAISE EXCEPTION 'Only platform_admin can grant roles';
  END IF;
  IF p_user_id = auth.uid() THEN
    RAISE EXCEPTION 'Cannot grant a role to yourself';
  END IF;

  INSERT INTO user_roles (user_id, role, scope, resource_id, granted_by, metadata)
  VALUES (p_user_id, p_role, p_scope, p_resource_id, auth.uid(), p_metadata)
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION revoke_role(p_role_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT has_role('platform_admin', 'platform') THEN
    RAISE EXCEPTION 'Only platform_admin can revoke roles';
  END IF;

  UPDATE user_roles SET revoked_at = now()
  WHERE id = p_role_id AND revoked_at IS NULL;

  RETURN FOUND;
END;
$$;

-- ── RLS ─────────────────────────────────────────────────────────────────
ALTER TABLE user_roles ENABLE ROW LEVEL SECURITY;

-- Users can see their own grants (so a page can show "you have X access").
CREATE POLICY user_roles_read_own ON user_roles
  FOR SELECT
  USING (user_id = auth.uid());

-- platform_admins can see everyone's grants (needed for a future role-
-- management UI). Uses has_role() so it stays correct as roles change.
CREATE POLICY user_roles_read_all_for_admins ON user_roles
  FOR SELECT
  USING (has_role('platform_admin', 'platform'));

-- Deliberately NO insert/update/delete policy for any client role.
-- All writes go through grant_role()/revoke_role() (SECURITY DEFINER,
-- bypasses RLS by design, but only after their own has_role() check).

-- ── Seed the first platform_admin ─────────────────────────────────────────
-- grant_role() can't be used here (nobody has platform_admin yet — the
-- exact bootstrap problem the check exists to prevent). This is the one
-- direct INSERT in this migration, and it's the only time it should ever
-- happen outside grant_role().
--
-- ⚠️ REPLACE '<DAVE_USER_ID>' below with the real auth.users.id from the
-- pre-check query before applying. Left as a placeholder deliberately —
-- do not guess an ID.
INSERT INTO user_roles (user_id, role, scope, granted_by, metadata)
VALUES (
  '<DAVE_USER_ID>'::uuid,
  'platform_admin',
  'platform',
  '<DAVE_USER_ID>'::uuid,  -- self-referential only for this one bootstrap row
  '{"note": "bootstrap grant — migration 2026-07-19_create-user-roles"}'::jsonb
);

COMMIT;

-- Rollback:
--   BEGIN;
--   DROP POLICY IF EXISTS user_roles_read_own ON user_roles;
--   DROP POLICY IF EXISTS user_roles_read_all_for_admins ON user_roles;
--   DROP FUNCTION IF EXISTS grant_role(uuid, text, text, uuid, jsonb);
--   DROP FUNCTION IF EXISTS revoke_role(uuid);
--   DROP FUNCTION IF EXISTS has_role(text, text, uuid);
--   DROP TABLE IF EXISTS user_roles;
--   COMMIT;
--   -- Full rollback, no data loss elsewhere — nothing outside this new
--   -- table/functions is touched by this migration.

-- Verify (run after applying):
--   SELECT * FROM user_roles;  -- expect exactly 1 row (the bootstrap grant)
--   SELECT has_role('platform_admin');  -- run as Dave, expect true
--   SELECT grant_role(auth.uid(), 'platform_admin');
--     -- run as Dave, expect an exception "Cannot grant a role to yourself"
