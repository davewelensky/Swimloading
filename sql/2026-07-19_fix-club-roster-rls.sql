-- ================================================================
-- SwimLoading — Migration Template
-- ================================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM _project_identity
    WHERE key = 'project_name' AND value = 'swimloading'
  ) THEN
    RAISE EXCEPTION
      E'\n\n WRONG PROJECT — MIGRATION ABORTED. Expected szgkzuswelntnevobnoh.';
  END IF;
  RAISE NOTICE '✅ Project identity confirmed: swimloading (szgkzuswelntnevobnoh)';
END $$;

-- ================================================================
-- Migration: 2026-07-19_fix-club-roster-rls.sql
-- STATUS: ⛔ PROPOSED — NOT YET APPLIED. Requires the literal approval
--         phrase "APPLY CLUB_ROSTER RLS FIX".
-- ================================================================

-- Purpose:
--   Close a confirmed public-read exposure of club_roster (962 rows,
--   including youth-squad members — 224 rows for Aquasharks alone
--   confirmed filterable by anon). Same USING(true) shape as the
--   already-fixed profiles issue. See
--   docs/refactor/INCIDENT_CLUB_ROSTER_PUBLIC_READ.md and
--   docs/refactor/CLUB_ROSTER_RLS_REMEDIATION.md.

-- Requested by:
--   Dave — SwimLoading security remediation, continuation of the
--   profiles RLS fix, 2026-07-19

-- Pre-checks:
--   1. select count(*) from pg_policies where schemaname='public'
--      and tablename='club_roster' and qual='true';  -- expect 1
--   2. select count(*) from club_roster;  -- expect ~962
--   3. select proname from pg_proc where proname in
--      ('search_roster_entries_for_linking','get_platform_roster_directory');
--      -- expect 0 rows
--   4. select viewname from pg_views where schemaname='public'
--      and viewname='club_member_directory';  -- expect 0 rows
--   5. Confirm the 4 existing write-side policies are untouched by this
--      migration (club_roster_insert_by_admin, club_roster_insert_by_coach,
--      club_roster_update_by_admin, club_roster_delete_by_coach) — this
--      migration only DROPs/CREATEs SELECT policies, never touches these.

-- Backup:
--   Only policies, a view, and functions change — no row data touched.
--   No backup required.

BEGIN;

-- ── Section 0: capture current policy for the record (informational) ──────
-- SELECT policyname, cmd, qual, with_check FROM pg_policies
-- WHERE schemaname='public' AND tablename='club_roster';

-- ── Section 1: remove the unsafe SELECT policy ─────────────────────────────
DROP POLICY IF EXISTS "Public can read club_roster" ON club_roster;

-- Write-side policies (club_roster_insert_by_admin, club_roster_insert_by_coach,
-- club_roster_update_by_admin, club_roster_delete_by_coach) are NOT touched —
-- already correctly scoped, confirmed during Step 1 inspection. Adding them
-- here would risk weakening tested, working restrictions.

-- ── Section 2: own-row SELECT (reuses existing is_own_roster_profile) ──────
CREATE POLICY "club_roster_select_own" ON club_roster
  FOR SELECT
  USING (is_own_roster_profile(id));

-- ── Section 3: club admin/organiser SELECT (reuses existing function) ─────
CREATE POLICY "club_roster_select_admin_organiser" ON club_roster
  FOR SELECT
  USING (is_club_admin_or_organiser(club_id));

-- ── Section 4: coach SELECT — matches the EXISTING coach check shape used
-- by club_roster_delete_by_coach/club_roster_insert_by_coach exactly, for
-- consistency (same club_coaches.club_id + user_id match, no additional
-- restriction beyond what coaches already have for insert/delete).
CREATE POLICY "club_roster_select_coach" ON club_roster
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM club_coaches cc
      WHERE cc.club_id = club_roster.club_id AND cc.user_id = auth.uid()
    )
  );

-- ── Section 5: member-facing directory ─────────────────────────────────────
-- Plain view (owned by the migration-applying role, bypasses club_roster's
-- own RLS via table ownership — same mechanism public_profiles already
-- uses). The membership check is an explicit WHERE EXISTS clause in the
-- view's own query, not RLS — this is what actually restricts exposure,
-- together with the narrow column list. Only approved fields per the
-- product decision: club_id, profile_id, display_name, squad label.
CREATE VIEW club_member_directory AS
  SELECT
    r.club_id,
    r.user_id AS profile_id,
    r.display_name,
    sq.name AS squad_label
  FROM club_roster r
  LEFT JOIN club_squads sq ON sq.id = r.squad_id
  WHERE r.is_active = true
    AND EXISTS (
      SELECT 1 FROM club_roster me
      WHERE me.club_id = r.club_id AND me.user_id = auth.uid()
    );

COMMENT ON VIEW club_member_directory IS
  'Member-facing team directory. Only club_id/profile_id/display_name/'
  'squad_label — no phone, DOB, gender, fee, or other sensitive/youth '
  'fields. Visible only to authenticated users with their own active '
  'roster row in the same club (via the WHERE EXISTS clause, not RLS).';

GRANT SELECT ON club_member_directory TO authenticated;
REVOKE ALL ON club_member_directory FROM anon;
REVOKE ALL ON club_member_directory FROM PUBLIC;

-- ── Section 6: platform-admin gated RPC ────────────────────────────────────
CREATE OR REPLACE FUNCTION get_platform_roster_directory()
RETURNS TABLE (
  id uuid, club_id uuid, member_number integer, display_name text,
  category text, gender character, user_id uuid, phone text,
  date_of_birth date, is_trial boolean, fee_paid boolean, is_active boolean
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT r.id, r.club_id, r.member_number, r.display_name, r.category,
         r.gender, r.user_id, r.phone, r.date_of_birth, r.is_trial,
         r.fee_paid, r.is_active
  FROM club_roster r
  WHERE EXISTS (SELECT 1 FROM profiles me WHERE me.id = auth.uid() AND me.is_admin = true);
$$;

COMMENT ON FUNCTION get_platform_roster_directory IS
  'Platform-admin gated full roster read, across all clubs. Empty set '
  'unless caller profiles.is_admin = true. Same gate as '
  'get_admin_user_directory() from the profiles RLS fix.';

-- ── Section 7: roster search RPC for linking flows (join.html) ────────────
-- Required to preserve join.html's two linking flows:
--   1. A new member self-identifies their own (usually unlinked) entry by
--      name/number/id.
--   2. A parent searches for their CHILD's entry to request a parent link
--      — the child may already have their own linked account (older kids),
--      so this cannot be restricted to unlinked rows only without breaking
--      that flow. Still authenticated-only, club-scoped, 5 narrow
--      identification fields (never phone/DOB/fee/emergency), and gated
--      by a minimum 2-character query or an exact number/id match rather
--      than an unbounded listing.
CREATE OR REPLACE FUNCTION search_roster_entries_for_linking(
  p_club_id uuid,
  p_query text DEFAULT NULL,
  p_member_number integer DEFAULT NULL,
  p_roster_id uuid DEFAULT NULL
)
RETURNS TABLE (id uuid, member_number integer, display_name text, category text, gender character, squad_id uuid)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT r.id, r.member_number, r.display_name, r.category, r.gender, r.squad_id
  FROM club_roster r
  WHERE r.club_id = p_club_id
    AND auth.role() = 'authenticated'
    AND (p_roster_id IS NULL OR r.id = p_roster_id)
    AND (p_member_number IS NULL OR r.member_number = p_member_number)
    AND (p_query IS NULL OR (length(p_query) >= 2 AND r.display_name ILIKE '%' || p_query || '%'))
    AND (p_roster_id IS NOT NULL OR p_member_number IS NOT NULL OR p_query IS NOT NULL)
  ORDER BY r.display_name
  LIMIT 10;
$$;

COMMENT ON FUNCTION search_roster_entries_for_linking IS
  'Roster search for join.html''s self-linking and parent-linking flows. '
  'Requires at least one of p_roster_id/p_member_number/p_query (a 2+ char '
  'name match) — cannot be called with no filter to enumerate a club''s '
  'full roster. Only 5 identification fields, never phone/DOB/fee/'
  'emergency data. Not restricted to unlinked rows — parent-linking needs '
  'to find already-linked children too.';

-- ── Section 8: grants ───────────────────────────────────────────────────────
GRANT EXECUTE ON FUNCTION get_platform_roster_directory() TO authenticated;
GRANT EXECUTE ON FUNCTION search_roster_entries_for_linking(uuid, text, integer, uuid) TO authenticated;
REVOKE EXECUTE ON FUNCTION get_platform_roster_directory() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION search_roster_entries_for_linking(uuid, text, integer, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION get_platform_roster_directory() FROM anon;
REVOKE EXECUTE ON FUNCTION search_roster_entries_for_linking(uuid, text, integer, uuid) FROM anon;

COMMIT;

-- Post-checks:
--   1. select count(*) from pg_policies where schemaname='public'
--      and tablename='club_roster' and qual='true';  -- expect 0
--   2. select policyname from pg_policies where schemaname='public'
--      and tablename='club_roster' and cmd='SELECT';  -- expect exactly:
--        club_roster_select_own, club_roster_select_admin_organiser,
--        club_roster_select_coach
--   3. select count(*) from pg_policies where schemaname='public'
--      and tablename='club_roster' and cmd in ('INSERT','UPDATE','DELETE');
--      -- expect 4 (unchanged from before this migration)
--   4. select count(*) from club_member_directory;  -- as an authenticated
--      member with an active roster row, expect > 0 and <= club's roster size
--   5. Anon verification (status/count/field-presence only):
--      curl .../rest/v1/club_roster?select=id&limit=1 with the anon key
--      -- expect HTTP 200 with an EMPTY array

-- Rollback:
--   BEGIN;
--   REVOKE EXECUTE ON FUNCTION get_platform_roster_directory() FROM authenticated;
--   REVOKE EXECUTE ON FUNCTION search_roster_entries_for_linking(uuid, text, integer, uuid) FROM authenticated;
--   DROP FUNCTION IF EXISTS get_platform_roster_directory();
--   DROP FUNCTION IF EXISTS search_roster_entries_for_linking(uuid, text, integer, uuid);
--   DROP VIEW IF EXISTS club_member_directory;
--   DROP POLICY IF EXISTS "club_roster_select_own" ON club_roster;
--   DROP POLICY IF EXISTS "club_roster_select_admin_organiser" ON club_roster;
--   DROP POLICY IF EXISTS "club_roster_select_coach" ON club_roster;
--   -- ⚠️ Restoring the original policy re-opens the exposure — essentially
--   -- never the right call, documented because "no rollback path" isn't
--   -- acceptable either:
--   CREATE POLICY "Public can read club_roster" ON club_roster FOR SELECT USING (true);
--   COMMIT;
