-- Club Groups, Group Members, Group Sessions, Group RSVPs
-- Applied: June 2026 — for K8 Coaching (open water goal groups)
-- Tables: club_groups, club_group_members, club_group_sessions, club_group_rsvps

CREATE TABLE IF NOT EXISTS club_groups (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id       uuid NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  name          text NOT NULL,
  description   text,
  goal_event    text,
  goal_date     date,
  max_members   integer,
  signup_open   boolean NOT NULL DEFAULT true,
  is_active     boolean NOT NULL DEFAULT true,
  created_by    uuid REFERENCES auth.users(id),
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS club_group_members (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id    uuid NOT NULL REFERENCES club_groups(id) ON DELETE CASCADE,
  roster_id   uuid NOT NULL REFERENCES club_roster(id) ON DELETE CASCADE,
  joined_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE(group_id, roster_id)
);

CREATE TABLE IF NOT EXISTS club_group_sessions (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id       uuid NOT NULL REFERENCES club_groups(id) ON DELETE CASCADE,
  club_id        uuid NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  title          text NOT NULL,
  description    text,
  session_date   date NOT NULL,
  session_time   time,
  location       text,
  distance_km    numeric(5,2),
  session_type   text NOT NULL DEFAULT 'ocean',
  whatsapp_text  text,
  created_by     uuid REFERENCES auth.users(id),
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS club_group_rsvps (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id  uuid NOT NULL REFERENCES club_group_sessions(id) ON DELETE CASCADE,
  roster_id   uuid NOT NULL REFERENCES club_roster(id) ON DELETE CASCADE,
  status      text NOT NULL DEFAULT 'going',
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE(session_id, roster_id)
);
