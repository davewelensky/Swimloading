-- ================================================================
-- SwimLoading — Migration Template
-- ================================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM _project_identity
    WHERE key = 'project_name' AND value = 'swimloading'
  ) THEN
    RAISE EXCEPTION E'\n\nWRONG PROJECT — MIGRATION ABORTED\nThis migration is for: SwimLoading\nExpected project ref: szgkzuswelntnevobnoh'
    USING HINT = 'Check the project ref in your Supabase dashboard URL';
  END IF;
  RAISE NOTICE '✅ Project identity confirmed: swimloading';
END $$;

-- ================================================================
-- Migration: fix_club_rls_and_schema.sql
--
-- Fixes UNRESTRICTED RLS on 4 tables. Both clubs must keep working:
--   DUC (open water league):   club_squads, club_squad_sessions
--   Aqua Sharks (pool club):   club_coaches, club_member_profile
--   Both:                      all policies keyed by club_id, work for any club
--
-- Security model:
--   club_coaches        → admin/organiser only (private: certs, emergency contacts)
--   club_member_profile → admin/organiser full + member reads own DOB/gender only
--   club_squads         → admin/organiser full + active member read
--   club_squad_sessions → admin/organiser full + active member read
--   club_admins         → admin/organiser full + self-read (needed for auth check)
--
-- Drops club_league_results — dead table, zero JS references.
-- ================================================================


-- ── HELPER FUNCTIONS (SECURITY DEFINER) ──────────────────────────
-- All functions are SECURITY DEFINER so they bypass RLS on the
-- tables they read from. This prevents:
--   a) Infinite recursion (policies calling policies on the same table)
--   b) Permission errors when reading club_roster inside profile policies

-- Is the current user an admin or organiser of the given club?
-- Checks both club_members (swimming members with elevated role)
-- and club_admins (non-swimming staff like committee members).
CREATE OR REPLACE FUNCTION is_club_admin_or_organiser(p_club_id uuid)
RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM club_members
    WHERE club_id   = p_club_id
      AND user_id   = auth.uid()
      AND role      IN ('admin', 'organiser')
      AND is_active = true
  ) OR EXISTS (
    SELECT 1 FROM club_admins
    WHERE club_id = p_club_id
      AND user_id = auth.uid()
  )
$$;

-- Is the current user an active member (any role) of the given club?
CREATE OR REPLACE FUNCTION is_club_active_member(p_club_id uuid)
RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM club_members
    WHERE club_id   = p_club_id
      AND user_id   = auth.uid()
      AND is_active = true
  ) OR EXISTS (
    SELECT 1 FROM club_admins
    WHERE club_id = p_club_id
      AND user_id = auth.uid()
  )
$$;

-- Can the current user administer the club_member_profile for this roster_id?
-- Goes through club_roster → club_id lookup — must be SECURITY DEFINER
-- so that club_roster RLS is bypassed during the check.
CREATE OR REPLACE FUNCTION can_admin_roster_profile(p_roster_id uuid)
RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM club_roster r
    WHERE r.id = p_roster_id
      AND is_club_admin_or_organiser(r.club_id)
  )
$$;

-- Can the current user read their own club_member_profile?
-- Checks that the roster entry belongs to auth.uid().
CREATE OR REPLACE FUNCTION is_own_roster_profile(p_roster_id uuid)
RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM club_roster
    WHERE id      = p_roster_id
      AND user_id = auth.uid()
  )
$$;


-- ── DROP ALL EXISTING POLICIES (before recreating) ───────────────
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT policyname, tablename
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN (
        'club_coaches',
        'club_member_profile',
        'club_squads',
        'club_squad_sessions',
        'club_admins'
      )
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', r.policyname, r.tablename);
    RAISE NOTICE 'Dropped policy: % on %', r.policyname, r.tablename;
  END LOOP;
END $$;


-- ── 1. CLUB_COACHES ───────────────────────────────────────────────
-- Who reads it:  club-admin.html (Team tab) — admins only
-- Who writes it: club-admin.html (Team tab) — admins only
-- Contains: name, title, emergency contact, certifications, first aid
-- Access: admin/organiser only — no member or public read

ALTER TABLE club_coaches ENABLE ROW LEVEL SECURITY;

CREATE POLICY "coaches_admin_all" ON club_coaches
  FOR ALL
  USING     (is_club_admin_or_organiser(club_id))
  WITH CHECK(is_club_admin_or_organiser(club_id));


-- ── 2. CLUB_MEMBER_PROFILE ────────────────────────────────────────
-- Who reads it:
--   club-admin.html → admins read full profile (guardian, medical, consents)
--   app-club.js line 125 → member reads OWN date_of_birth + gender
--     (for QT age-group calculation — Aqua Sharks feature)
-- Contains: DOB, gender, guardian names/phones/emails,
--           medical conditions, allergies, medical aid, consents
-- Access: admin full + member reads own DOB/gender only

ALTER TABLE club_member_profile ENABLE ROW LEVEL SECURITY;

CREATE POLICY "profile_admin_all" ON club_member_profile
  FOR ALL
  USING     (can_admin_roster_profile(roster_id))
  WITH CHECK(can_admin_roster_profile(roster_id));

CREATE POLICY "profile_member_read_own" ON club_member_profile
  FOR SELECT
  USING (is_own_roster_profile(roster_id));


-- ── 3. CLUB_SQUADS ────────────────────────────────────────────────
-- Who reads it:  club-admin.html (squad picker, roster assignment)
-- Who writes it: club-admin.html (Settings/squad management)
-- Contains: squad name, type, sort_order, is_active
-- Access: admin full + active member read (squad-aware features coming)

ALTER TABLE club_squads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "squads_admin_all" ON club_squads
  FOR ALL
  USING     (is_club_admin_or_organiser(club_id))
  WITH CHECK(is_club_admin_or_organiser(club_id));

CREATE POLICY "squads_member_read" ON club_squads
  FOR SELECT
  USING (is_club_active_member(club_id));


-- ── 4. CLUB_SQUAD_SESSIONS ────────────────────────────────────────
-- Who reads it:  club-admin.html (Today's Schedule banner)
-- Who writes it: club-admin.html (timetable setup)
-- Contains: day_of_week, start_time, end_time, session_type, coach_name
-- Access: admin full + active member read (so member tab can show schedule)

ALTER TABLE club_squad_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "squad_sessions_admin_all" ON club_squad_sessions
  FOR ALL
  USING     (is_club_admin_or_organiser(club_id))
  WITH CHECK(is_club_admin_or_organiser(club_id));

CREATE POLICY "squad_sessions_member_read" ON club_squad_sessions
  FOR SELECT
  USING (is_club_active_member(club_id));


-- ── 5. CLUB_ADMINS (patch + secure) ──────────────────────────────
-- Who reads it:
--   club-admin.html line 1344: auth check — finds which clubs the
--     current user is an admin of (queries by user_id = current user)
--   club-admin.html loadTeam(): lists all admins for a club
-- Who writes it: club-admin.html (add/remove team members)

ALTER TABLE club_admins ENABLE ROW LEVEL SECURITY;

-- Admin of the club can see and manage all admin records for that club
CREATE POLICY "admins_club_admin_all" ON club_admins
  FOR ALL
  USING     (is_club_admin_or_organiser(club_id))
  WITH CHECK(is_club_admin_or_organiser(club_id));

-- Every authenticated user can read their OWN admin rows — needed by
-- the auth flow in loadClub() which does:
--   sb.from('club_admins').select('role, clubs(*)').eq('user_id', currentUser.id)
-- Without this, a new admin can't discover which clubs they manage.
CREATE POLICY "admins_read_own_rows" ON club_admins
  FOR SELECT
  USING (user_id = auth.uid());


-- ── 6. DROP DEAD TABLE ────────────────────────────────────────────
-- club_league_results: original league design linked to club_event_id.
-- Superseded by:
--   club_race_results      (open water / DUC: position, points, year, month)
--   club_season_standings  (denormalised standings built from race_results)
-- Zero JS/HTML references. Aqua Sharks uses gala_results/swimmer_times.
-- DUC uses race_results/season_standings. Safe to drop.

DROP TABLE IF EXISTS club_league_results;


-- ── VERIFY ───────────────────────────────────────────────────────
DO $$
DECLARE
  tbl text;
  cnt int;
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '=== RLS Summary ===';

  FOREACH tbl IN ARRAY ARRAY[
    'club_coaches','club_member_profile','club_squads',
    'club_squad_sessions','club_admins'
  ] LOOP
    EXECUTE format(
      'SELECT COUNT(*) FROM pg_policies WHERE schemaname = ''public'' AND tablename = %L',
      tbl
    ) INTO cnt;
    RAISE NOTICE '%: % policies active', tbl, cnt;
  END LOOP;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'club_league_results'
  ) THEN
    RAISE NOTICE 'club_league_results: dropped successfully';
  ELSE
    RAISE WARNING 'club_league_results: still exists — check for dependencies';
  END IF;

  RAISE NOTICE '';
  RAISE NOTICE 'DUC:         club_race_results + club_season_standings — unchanged';
  RAISE NOTICE 'Aqua Sharks: club_gala_results + club_swimmer_times   — unchanged';
  RAISE NOTICE 'Both clubs:  is_club_admin_or_organiser() + is_club_active_member() available';
END $$;
