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
-- Migration: 2026-07-19_fix-profiles-rls.sql
-- Process:   see MIGRATIONS.md — no section below may be left empty
-- STATUS:    ⛔ EMERGENCY CONTAINMENT — PROPOSED, NOT YET APPLIED.
--            Requires the literal approval phrase "APPLY PROFILES RLS FIX"
--            per this task's explicit instruction. Prior approval of
--            other refactor phases does NOT authorise this migration.
-- ================================================================

-- Purpose:
--   Close a confirmed, live, unauthenticated public-read exposure of the
--   profiles table (645 rows: name, phone, DOB, address, emergency
--   contact, email, and more — readable by anyone with the public anon
--   key, no login required). See docs/refactor/INCIDENT_PROFILES_PUBLIC_READ.md
--   for the full incident report and docs/refactor/PROFILES_RLS_REMEDIATION.md
--   for the dependency matrix and design this migration implements.

-- Requested by:
--   Dave — SwimLoading v2 Platform Refactor, emergency task, 2026-07-19

-- Pre-checks (run on the read-only `supabase` server before applying):
--   1. select count(*) from pg_policies where schemaname='public'
--      and tablename='profiles' and qual='true';
--      -- expect 1 (the policy this migration removes) — if 0, someone
--      -- already fixed this; STOP and re-investigate before proceeding.
--   2. select count(*) from profiles;  -- expect 645 (or close to it —
--      confirms row count hasn't unexpectedly changed since the incident
--      report was written)
--   3. select proname from pg_proc where proname in
--      ('get_admin_user_directory','get_club_roster_profiles',
--       'search_profile_by_email','get_signup_notification_targets');
--      -- expect 0 rows (functions must not already exist)
--   4. select viewname from pg_views where schemaname='public'
--      and viewname='public_profiles';  -- expect 0 rows

-- Backup:
--   This migration only changes POLICIES and adds new views/functions —
--   it does not DELETE, UPDATE, or DROP any row or column. No table
--   backup is required. The CURRENT POLICY DEFINITIONS are captured below
--   (Section 0) specifically so they can be recreated exactly as-is if a
--   rollback is ever needed, since "what the policy used to say" is itself
--   the thing worth preserving here.

BEGIN;

-- ── Section 0: capture current policy definitions for the record ──────────
-- (Informational only — this SELECT's output should be saved by whoever
-- applies this migration, alongside the applied migration file, as the
-- historical record of exactly what was replaced.)
-- SELECT policyname, cmd, qual, with_check FROM pg_policies
-- WHERE schemaname='public' AND tablename='profiles';

-- ── Section 1: remove the unsafe policies ──────────────────────────────────
DROP POLICY IF EXISTS "Public profiles are viewable by everyone" ON profiles;
DROP POLICY IF EXISTS "Authenticated users can view profiles" ON profiles;

-- Also clean up the three redundant duplicate UPDATE policies found during
-- Step 1 inspection (all three do the same `auth.uid() = id` check — likely
-- accumulated from repeated migrations over time). Replaced with exactly
-- one, named clearly.
DROP POLICY IF EXISTS "Users can update own profile" ON profiles;
DROP POLICY IF EXISTS "profiles update own" ON profiles;
DROP POLICY IF EXISTS "update own profile" ON profiles;

-- ── Section 2: own-row SELECT ──────────────────────────────────────────────
CREATE POLICY "profiles_select_own" ON profiles
  FOR SELECT
  USING (auth.uid() = id);

-- ── Section 3: own-row UPDATE (single, replaces the 3 duplicates above) ───
CREATE POLICY "profiles_update_own" ON profiles
  FOR UPDATE
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- ── Section 4: INSERT — already correctly scoped, left as-is ──────────────
-- "Users can insert own profile" (WITH CHECK auth.uid() = id) already
-- exists and is correct — not touched by this migration.

-- ── Section 5: restricted public view ──────────────────────────────────────
CREATE VIEW public_profiles AS
  SELECT id, display_name FROM profiles;

COMMENT ON VIEW public_profiles IS
  'Minimal, safe-to-read-broadly subset of profiles — id + display_name '
  'only. For leaderboard/attribution/roster-name use cases that do not '
  'need any other field. Granted to authenticated only, not anon — '
  'nothing in the current app needs anonymous access to member names.';

GRANT SELECT ON public_profiles TO authenticated;
REVOKE ALL ON public_profiles FROM anon;

-- ── Section 6: admin RPC — replaces admin.html's direct broad SELECT ──────
CREATE OR REPLACE FUNCTION get_admin_user_directory()
RETURNS TABLE (
  id uuid, email text, display_name text, phone text,
  emergency_contact_name text, onboarding_completed_at timestamp,
  created_at timestamptz, address_line1 text, city text, postal_code text
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.id, p.email, p.display_name, p.phone, p.emergency_contact_name,
         p.onboarding_completed_at, p.created_at, p.address_line1, p.city, p.postal_code
  FROM profiles p
  WHERE EXISTS (SELECT 1 FROM profiles me WHERE me.id = auth.uid() AND me.is_admin = true);
$$;

COMMENT ON FUNCTION get_admin_user_directory IS
  'Replaces admin.html''s direct `select(...).from(profiles)` broad read. '
  'Returns nothing (empty set, not an error) unless the caller''s own '
  'profiles.is_admin = true. Enforces at the data layer what admin.html '
  'previously only checked in client-side JS.';

-- ── Section 7: club-manager RPC ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION get_club_roster_profiles(p_club_id uuid)
RETURNS TABLE (id uuid, display_name text, email text, phone text)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.id, p.display_name, p.email, p.phone
  FROM profiles p
  JOIN club_roster cr ON cr.user_id = p.id
  WHERE cr.club_id = p_club_id
    AND is_club_manager(p_club_id);
$$;

COMMENT ON FUNCTION get_club_roster_profiles IS
  'Replaces club-admin.html''s pattern of reading profiles by a client-'
  'supplied id list. Joins against the actual club_roster membership '
  'server-side and requires is_club_manager(p_club_id) — a tampered '
  'client-side id list can no longer pull another club''s member data.';

-- ── Section 8: email-search RPC (narrow — name only, not a general lookup) ─
CREATE OR REPLACE FUNCTION search_profile_by_email(p_email text)
RETURNS TABLE (id uuid, display_name text)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.id, p.display_name
  FROM profiles p
  WHERE p.email ILIKE p_email
    AND auth.role() = 'authenticated'
  LIMIT 1;
$$;

COMMENT ON FUNCTION search_profile_by_email IS
  'Replaces club-admin.html''s .ilike(''email'', email) direct table '
  'search. Returns only id + display_name — confirms whether an email '
  'belongs to a user for linking purposes, without exposing that user''s '
  'phone/address/other fields to whoever is searching.';

-- ── Section 9: notification fan-out RPC ────────────────────────────────────
CREATE OR REPLACE FUNCTION get_signup_notification_targets()
RETURNS TABLE (id uuid)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.id FROM profiles p WHERE p.notify_new_swims = true
  UNION
  SELECT p.id FROM profiles p WHERE p.is_admin = true;
$$;

COMMENT ON FUNCTION get_signup_notification_targets IS
  'Replaces the two ad-hoc app.js queries (notify_new_swims=true fan-out, '
  'is_admin=true fan-out) used to decide who gets a new-signup '
  'notification. Returns only id — never any other field.';

-- ── Section 10: grants ──────────────────────────────────────────────────────
GRANT EXECUTE ON FUNCTION get_admin_user_directory() TO authenticated;
GRANT EXECUTE ON FUNCTION get_club_roster_profiles(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION search_profile_by_email(text) TO authenticated;
GRANT EXECUTE ON FUNCTION get_signup_notification_targets() TO authenticated;
-- Deliberately NOT granted to anon — every one of these is for an
-- authenticated, already-onboarded user's own app usage or an admin/club-
-- manager action; none has a legitimate anonymous caller.
REVOKE EXECUTE ON FUNCTION get_admin_user_directory() FROM anon;
REVOKE EXECUTE ON FUNCTION get_club_roster_profiles(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION search_profile_by_email(text) FROM anon;
REVOKE EXECUTE ON FUNCTION get_signup_notification_targets() FROM anon;

COMMIT;

-- Post-checks (run after applying, on the read-only `supabase` server):
--   1. select count(*) from pg_policies where schemaname='public'
--      and tablename='profiles' and qual='true';  -- expect 0
--   2. select policyname from pg_policies where schemaname='public'
--      and tablename='profiles';  -- expect exactly:
--        profiles_select_own, profiles_update_own,
--        "Users can insert own profile"
--   3. select count(*) from public_profiles;  -- expect 645, same as profiles
--   4. As Dave (is_admin=true): select count(*) from get_admin_user_directory();
--      -- expect 645
--   5. Anon-role verification (same method as the incident report — Range
--      header / field-presence only, never print values):
--        curl .../rest/v1/profiles?select=id&limit=1 with the anon key
--        -- expect HTTP 200 with an EMPTY array `[]` (RLS returns zero
--        -- rows for anon now, not an error — this is correct Postgres
--        -- RLS behavior)
--
-- CODE CHANGES STILL NEEDED AFTER THIS MIGRATION APPLIES (see
-- docs/refactor/PROFILES_RLS_REMEDIATION.md's dependency matrix — this
-- migration alone does not update any .html/.js file):
--   - app.js, app-trends.js, clubs.html: switch id/display_name-only
--     reads from `profiles` to `public_profiles`
--   - admin.html: switch the full user-list read to
--     `supabaseClient.rpc('get_admin_user_directory')`
--   - club-admin.html: switch roster/linking reads to
--     `get_club_roster_profiles()` / `search_profile_by_email()`
--   - app.js: switch the two notification fan-out queries to
--     `get_signup_notification_targets()`
--   - app.js:1147 (new-signup count): needs a decision — see
--     PROFILES_RLS_REMEDIATION.md Step 4 point 7, not resolved yet
--   Until these code changes ship, the affected pages will see EMPTY
--   results (not errors) for the reads this migration removes broad
--   access to — see "Expected application impact" in the final report.

-- Rollback:
--   BEGIN;
--   REVOKE EXECUTE ON FUNCTION get_admin_user_directory() FROM authenticated;
--   REVOKE EXECUTE ON FUNCTION get_club_roster_profiles(uuid) FROM authenticated;
--   REVOKE EXECUTE ON FUNCTION search_profile_by_email(text) FROM authenticated;
--   REVOKE EXECUTE ON FUNCTION get_signup_notification_targets() FROM authenticated;
--   DROP FUNCTION IF EXISTS get_admin_user_directory();
--   DROP FUNCTION IF EXISTS get_club_roster_profiles(uuid);
--   DROP FUNCTION IF EXISTS search_profile_by_email(text);
--   DROP FUNCTION IF EXISTS get_signup_notification_targets();
--   DROP VIEW IF EXISTS public_profiles;
--   DROP POLICY IF EXISTS "profiles_select_own" ON profiles;
--   DROP POLICY IF EXISTS "profiles_update_own" ON profiles;
--   -- Recreate the ORIGINAL (unsafe) policies exactly as captured in
--   -- Section 0's pre-migration SELECT, if a full rollback to prior
--   -- behavior is genuinely needed:
--   CREATE POLICY "Public profiles are viewable by everyone" ON profiles
--     FOR SELECT USING (true);
--   CREATE POLICY "Authenticated users can view profiles" ON profiles
--     FOR SELECT USING (auth.role() = 'authenticated');
--   CREATE POLICY "Users can update own profile" ON profiles
--     FOR UPDATE USING (auth.uid() = id) WITH CHECK (auth.uid() = id);
--   COMMIT;
--   -- ⚠️ This rollback deliberately RESTORES the public-read exposure —
--   -- only use it if the application-code changes above cannot ship in
--   -- time and the resulting empty-results regression is worse than the
--   -- exposure for some reason. This should essentially never be the
--   -- right call; documented because "no rollback path" isn't acceptable
--   -- either.
