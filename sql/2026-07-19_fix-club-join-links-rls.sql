-- ================================================================
-- SwimLoading — Migration Template
-- ================================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM _project_identity
    WHERE key = 'project_name' AND value = 'swimloading'
  ) THEN
    RAISE EXCEPTION E'\n\n WRONG PROJECT — MIGRATION ABORTED. Expected szgkzuswelntnevobnoh.';
  END IF;
  RAISE NOTICE '✅ Project identity confirmed: swimloading (szgkzuswelntnevobnoh)';
END $$;

-- ================================================================
-- Migration: 2026-07-19_fix-club-join-links-rls.sql
-- STATUS: ⛔ PROPOSED — NOT YET APPLIED.
-- ================================================================

-- Purpose:
--   Close a confirmed public-read exposure of club_join_links.code (6
--   rows, 3-20 char codes, no consistent format — a 3-char code is
--   trivially brute-forceable). Not just a data leak: a harvested code
--   is a direct path to unauthorised club self-enrolment, including for
--   youth-squad clubs. See docs/refactor/INCIDENT_CLUB_JOIN_LINKS_PUBLIC_READ.md
--   and docs/refactor/CLUB_JOIN_LINKS_RLS_REMEDIATION.md.

-- Requested by:
--   Dave — SwimLoading security remediation, continuation of the
--   profiles/club_roster fixes, 2026-07-19

-- Pre-checks:
--   1. select count(*) from pg_policies where schemaname='public'
--      and tablename='club_join_links' and qual='true';  -- expect 1
--   2. select count(*) from club_join_links;  -- expect ~6
--   3. select proname from pg_proc where proname in
--      ('validate_join_code','redeem_club_join_code','get_club_active_join_code');
--      -- expect 0 rows
--   4. select count(*) from pg_policies where schemaname='public'
--      and tablename='club_join_links' and cmd in ('INSERT','UPDATE','DELETE');
--      -- expect 3 (unchanged by this migration) + 1 ALL policy = confirm
--      -- write-side policy count before/after matches

-- Backup:
--   Only policies, functions, and one new empty audit table change — no
--   existing row data touched or deleted. No backup required.

BEGIN;

-- ── Section 1: remove the unsafe SELECT policy ─────────────────────────────
DROP POLICY IF EXISTS "join_links_public_read" ON club_join_links;

-- Write-side policies (join_links_club_admins_write, join_links_admin_insert,
-- join_links_admin_update, join_links_admin_delete) are NOT touched —
-- already correctly scoped, confirmed during investigation.

-- ── Section 2: club admin/organiser SELECT (reuses existing function) ─────
-- Reuses is_club_admin_or_organiser() for consistency with club_roster's
-- fix, rather than the schema's other, slightly weaker is_club_admin()
-- (missing the club_admins fallback and is_active check) already used by
-- this table's write-side policies — a deliberate tightening for this new
-- read policy, not a change to the untouched write policies.
CREATE POLICY "join_links_select_admin_organiser" ON club_join_links
  FOR SELECT
  USING (is_club_admin_or_organiser(club_id));

-- ── Section 3: redemption audit table ──────────────────────────────────────
CREATE TABLE club_join_redemptions (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  link_id     uuid        NOT NULL REFERENCES club_join_links(id),
  user_id     uuid        NOT NULL REFERENCES auth.users(id),
  club_id     uuid        NOT NULL REFERENCES clubs(id),
  redeemed_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE club_join_redemptions IS
  'Durable redemption audit, populated only by redeem_club_join_code() — '
  'not a trigger on club_members, since admin-added/CSV-imported members '
  'are not "redemptions."';

ALTER TABLE club_join_redemptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "join_redemptions_select_admin_organiser" ON club_join_redemptions
  FOR SELECT
  USING (is_club_admin_or_organiser(club_id));

-- No INSERT/UPDATE/DELETE policy for any client role — only ever written
-- by the SECURITY DEFINER redeem_club_join_code() function below.

-- ── Section 4: anon-callable code validation (pre-auth join.html step) ────
-- Anonymous access is deliberate here — confirmed during investigation
-- that join.html's code check runs BEFORE the login screen, an existing,
-- intentional part of the product flow (show the club before asking
-- someone to sign up). Returns only minimal club display info — never
-- the invite code itself (redundant — caller already has it from the
-- URL) or any other link metadata (id, use_count, created_by, etc).
CREATE OR REPLACE FUNCTION validate_join_code(p_code text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_link club_join_links%ROWTYPE;
  v_club clubs%ROWTYPE;
BEGIN
  SELECT * INTO v_link FROM club_join_links
  WHERE code = trim(p_code) AND is_active = true;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('valid', false, 'status', 'invalid_code');
  END IF;

  IF v_link.expires_at IS NOT NULL AND v_link.expires_at < now() THEN
    RETURN jsonb_build_object('valid', false, 'status', 'expired');
  END IF;

  IF v_link.max_uses IS NOT NULL AND v_link.use_count >= v_link.max_uses THEN
    RETURN jsonb_build_object('valid', false, 'status', 'exhausted');
  END IF;

  SELECT * INTO v_club FROM clubs WHERE id = v_link.club_id;

  -- Fields matched exactly to what join.html's clubData object uses
  -- (id, name, tagline, city) — checked via grep before writing this.
  RETURN jsonb_build_object(
    'valid', true, 'status', 'ok',
    'club_id', v_club.id, 'club_name', v_club.name,
    'club_tagline', v_club.tagline, 'club_city', v_club.city
  );
END;
$$;

COMMENT ON FUNCTION validate_join_code IS
  'Anon-callable by design (join.html checks a code before login).
  Never returns the stored code or any other link row field.';

-- ── Section 5: public "current active code" lookup (clubs.html banner) ────
-- Also anon-callable by design (public club directory page's "Join"
-- button) — matches EXACTLY the current narrow, single-column,
-- single-club behavior of the direct read it replaces. The fix here is
-- eliminating the ability to read OTHER columns or OTHER clubs' codes in
-- the same query, not restricting who can see one club's own code.
CREATE OR REPLACE FUNCTION get_club_active_join_code(p_club_id uuid)
RETURNS text
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT code FROM club_join_links
  WHERE club_id = p_club_id AND is_active = true
  ORDER BY created_at DESC
  LIMIT 1;
$$;

COMMENT ON FUNCTION get_club_active_join_code IS
  'Anon-callable by design — matches the existing public "Join this club" '
  'banner behavior on clubs.html. Returns exactly one club''s current '
  'code, nothing else, no cross-club enumeration possible in one call.';

-- ── Section 6: atomic redemption RPC ───────────────────────────────────────
CREATE OR REPLACE FUNCTION redeem_club_join_code(p_code text, p_roster_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_link club_join_links%ROWTYPE;
  v_member_number text;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'status', 'not_authenticated');
  END IF;

  SELECT * INTO v_link FROM club_join_links
  WHERE code = trim(p_code) AND is_active = true
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'status', 'invalid_code');
  END IF;

  IF v_link.expires_at IS NOT NULL AND v_link.expires_at < now() THEN
    RETURN jsonb_build_object('success', false, 'status', 'expired');
  END IF;

  IF v_link.max_uses IS NOT NULL AND v_link.use_count >= v_link.max_uses THEN
    RETURN jsonb_build_object('success', false, 'status', 'exhausted');
  END IF;

  IF EXISTS (
    SELECT 1 FROM club_members
    WHERE club_id = v_link.club_id AND user_id = auth.uid() AND is_active = true
  ) THEN
    RETURN jsonb_build_object('success', false, 'status', 'already_member', 'club_id', v_link.club_id);
  END IF;

  IF p_roster_id IS NOT NULL THEN
    SELECT member_number::text INTO v_member_number
    FROM club_roster WHERE id = p_roster_id AND club_id = v_link.club_id;

    IF NOT FOUND THEN
      RETURN jsonb_build_object('success', false, 'status', 'roster_mismatch');
    END IF;

    IF EXISTS (SELECT 1 FROM club_members WHERE roster_id = p_roster_id AND is_active = true) THEN
      RETURN jsonb_build_object('success', false, 'status', 'roster_already_claimed');
    END IF;
  END IF;

  INSERT INTO club_members (club_id, user_id, role, is_active, roster_id, member_number)
  VALUES (v_link.club_id, auth.uid(), 'member', true, p_roster_id, v_member_number);

  UPDATE club_join_links SET use_count = use_count + 1 WHERE id = v_link.id;

  INSERT INTO club_join_redemptions (link_id, user_id, club_id)
  VALUES (v_link.id, auth.uid(), v_link.club_id);

  RETURN jsonb_build_object('success', true, 'status', 'joined', 'club_id', v_link.club_id);
END;
$$;

COMMENT ON FUNCTION redeem_club_join_code IS
  'Atomic join-code redemption — validates expiry/exhaustion/duplicate-'
  'membership/roster-claim collision, creates the club_members row,
  increments use_count, and records an audit row, all in one function
  call. Never returns the code or link row. auth.uid() required.';

-- ── Section 7: grants ───────────────────────────────────────────────────────
GRANT EXECUTE ON FUNCTION validate_join_code(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION get_club_active_join_code(uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION redeem_club_join_code(text, uuid) TO authenticated;
REVOKE EXECUTE ON FUNCTION validate_join_code(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION get_club_active_join_code(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION redeem_club_join_code(text, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION redeem_club_join_code(text, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION validate_join_code(text) TO anon;
GRANT EXECUTE ON FUNCTION get_club_active_join_code(uuid) TO anon;

COMMIT;

-- Post-checks:
--   1. select count(*) from pg_policies where schemaname='public'
--      and tablename='club_join_links' and qual='true';  -- expect 0
--   2. select policyname from pg_policies where schemaname='public'
--      and tablename='club_join_links' and cmd='SELECT';
--      -- expect exactly: join_links_select_admin_organiser
--   3. select count(*) from pg_policies where schemaname='public'
--      and tablename='club_join_links' and cmd in ('INSERT','UPDATE','DELETE');
--      -- expect 3 (unchanged) + the ALL policy still present
--   4. select count(*) from club_join_redemptions;  -- expect 0 (new, empty)
--   5. Anon verification (status/count only, never print a code):
--      curl .../rest/v1/club_join_links?select=id&limit=1 with the anon key
--      -- expect HTTP 200 with an EMPTY array
--   6. As anon: POST rpc/validate_join_code with a KNOWN test code ->
--      expect a jsonb result with club_id/club_name, never the code field
--   7. As anon: POST rpc/redeem_club_join_code -> expect 401/404 (no anon grant)

-- Rollback:
--   BEGIN;
--   REVOKE EXECUTE ON FUNCTION validate_join_code(text) FROM anon, authenticated;
--   REVOKE EXECUTE ON FUNCTION get_club_active_join_code(uuid) FROM anon, authenticated;
--   REVOKE EXECUTE ON FUNCTION redeem_club_join_code(text, uuid) FROM authenticated;
--   DROP FUNCTION IF EXISTS validate_join_code(text);
--   DROP FUNCTION IF EXISTS get_club_active_join_code(uuid);
--   DROP FUNCTION IF EXISTS redeem_club_join_code(text, uuid);
--   DROP POLICY IF EXISTS "join_redemptions_select_admin_organiser" ON club_join_redemptions;
--   DROP TABLE IF EXISTS club_join_redemptions;
--   DROP POLICY IF EXISTS "join_links_select_admin_organiser" ON club_join_links;
--   -- ⚠️ Restoring the original policy re-opens the exposure:
--   CREATE POLICY "join_links_public_read" ON club_join_links FOR SELECT USING (true);
--   COMMIT;
