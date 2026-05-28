-- Club Challenges — generic challenge system for any club
-- Run in Supabase SQL editor before deploying club-admin.html with hasChallenges flag
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. club_challenges ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS club_challenges (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id         uuid        NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  title           text        NOT NULL,
  description     text,
  start_date      date        NOT NULL,
  end_date        date        NOT NULL,

  -- Who can participate
  scope           text        NOT NULL DEFAULT 'club_only'
                              CHECK (scope IN ('club_only','open')),
  category_filter text[],     -- NULL = all categories; ['Guppies','Makos'] = specific
  gender_filter   text        CHECK (gender_filter IN ('male','female')),  -- NULL = all

  -- Scoring config stored as JSONB array of action objects:
  -- { type, label, points, auto, enabled }
  -- auto=true  → computed from temp_logs / swim_participants / swim_events
  -- auto=false → admin-awarded manually via club_challenge_points
  scoring_actions jsonb       NOT NULL DEFAULT '[]',

  -- How the winner is determined
  winner_type     text        NOT NULL DEFAULT 'highest_points'
                              CHECK (winner_type IN ('highest_points','draw_entries')),

  prizes          text,       -- free text: "1st: Maurten bundle · 2nd: SiS pack"
  status          text        NOT NULL DEFAULT 'active'
                              CHECK (status IN ('draft','active','completed')),

  created_by      uuid        REFERENCES auth.users(id),
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_club_challenges_club
  ON club_challenges(club_id, status);

-- ── 2. club_challenge_points — manual / custom action awards ─────────────────
CREATE TABLE IF NOT EXISTS club_challenge_points (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  challenge_id     uuid        NOT NULL REFERENCES club_challenges(id) ON DELETE CASCADE,
  user_id          uuid        NOT NULL REFERENCES profiles(id),
  action_type      text        NOT NULL,
  points           integer     NOT NULL CHECK (points > 0),
  source_table     text,        -- 'temp_logs' | 'swim_participants' | NULL (manual)
  source_record_id text,        -- prevents double-award for same record
  awarded_by       uuid        REFERENCES auth.users(id),  -- NULL = auto
  notes            text,        -- e.g. "Instagram post — tagged @swimloading"
  created_at       timestamptz DEFAULT now()
);

-- Prevent the same source record being awarded twice for the same challenge+action
CREATE UNIQUE INDEX IF NOT EXISTS club_challenge_points_dedup
  ON club_challenge_points(challenge_id, action_type, source_record_id)
  WHERE source_record_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ccp_challenge_user
  ON club_challenge_points(challenge_id, user_id);

-- ── 3. RLS ───────────────────────────────────────────────────────────────────
ALTER TABLE club_challenges       ENABLE ROW LEVEL SECURITY;
ALTER TABLE club_challenge_points ENABLE ROW LEVEL SECURITY;

-- Club admins: full access to their club's challenges
CREATE POLICY "challenge_admin_all" ON club_challenges
  FOR ALL
  USING   (club_id IN (SELECT club_id FROM club_admins WHERE user_id = auth.uid()))
  WITH CHECK (club_id IN (SELECT club_id FROM club_admins WHERE user_id = auth.uid()));

-- Club members: read their club's challenges
CREATE POLICY "challenge_member_read" ON club_challenges
  FOR SELECT
  USING (
    (scope = 'club_only'
      AND club_id IN (SELECT club_id FROM club_members WHERE user_id = auth.uid()))
    OR scope = 'open'
  );

-- Admins: full access to points for their clubs
CREATE POLICY "challenge_points_admin_all" ON club_challenge_points
  FOR ALL
  USING (
    challenge_id IN (
      SELECT cc.id FROM club_challenges cc
      WHERE cc.club_id IN (SELECT club_id FROM club_admins WHERE user_id = auth.uid())
    )
  )
  WITH CHECK (
    challenge_id IN (
      SELECT cc.id FROM club_challenges cc
      WHERE cc.club_id IN (SELECT club_id FROM club_admins WHERE user_id = auth.uid())
    )
  );

-- Members: read points for their club's challenges
CREATE POLICY "challenge_points_member_read" ON club_challenge_points
  FOR SELECT
  USING (
    challenge_id IN (
      SELECT cc.id FROM club_challenges cc
      WHERE cc.club_id IN (SELECT club_id FROM club_members WHERE user_id = auth.uid())
    )
  );
