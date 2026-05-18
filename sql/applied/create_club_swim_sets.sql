-- Set library: coach-created and AI-generated sets for squad sessions
CREATE TABLE IF NOT EXISTS club_swim_sets (
  id            uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  club_id       uuid REFERENCES clubs(id) ON DELETE CASCADE NOT NULL,
  name          text NOT NULL,
  total_distance integer,
  pool_type     text DEFAULT 'SCM' CHECK (pool_type IN ('SCM','LCM','either')),
  focus         text DEFAULT 'mixed' CHECK (focus IN ('aerobic','speed','drills','kick','endurance','mixed')),
  set_content   text NOT NULL DEFAULT '',
  duration_mins integer,
  ai_generated  boolean DEFAULT false,
  created_by    uuid REFERENCES auth.users(id),
  created_at    timestamptz DEFAULT now()
);

-- Calendar assignments: a set assigned to a squad on a specific date/slot
CREATE TABLE IF NOT EXISTS club_set_assignments (
  id               uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  club_id          uuid REFERENCES clubs(id) ON DELETE CASCADE NOT NULL,
  set_id           uuid REFERENCES club_swim_sets(id) ON DELETE SET NULL,
  squad_id         uuid REFERENCES club_squads(id) ON DELETE CASCADE NOT NULL,
  session_date     date NOT NULL,
  session_slot     text DEFAULT 'AM' CHECK (session_slot IN ('AM','PM','PM2','PM3')),
  delivering_coach text,
  notes            text,
  created_by       uuid REFERENCES auth.users(id),
  created_at       timestamptz DEFAULT now(),
  UNIQUE(squad_id, session_date, session_slot)
);

ALTER TABLE club_swim_sets      ENABLE ROW LEVEL SECURITY;
ALTER TABLE club_set_assignments ENABLE ROW LEVEL SECURITY;

-- Only club admins can create/read/update/delete sets and assignments
CREATE POLICY "Club admins manage swim sets"
  ON club_swim_sets FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM club_admins
      WHERE club_id = club_swim_sets.club_id
        AND user_id = auth.uid()
    )
  );

CREATE POLICY "Club admins manage set assignments"
  ON club_set_assignments FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM club_admins
      WHERE club_id = club_set_assignments.club_id
        AND user_id = auth.uid()
    )
  );
