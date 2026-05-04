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
-- Migration: create_clubs_schema.sql
-- Full club system — clubs, categories, members, events, entries,
-- league results, and join links.
-- No payment fields anywhere — payments are handled externally.
-- ================================================================


-- ── 1. CLUBS ──────────────────────────────────────────────────────
-- One row per club. International-ready: country code, timezone.
CREATE TABLE IF NOT EXISTS clubs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code            text UNIQUE NOT NULL,          -- short identifier: 'DUC', 'BFSC', 'FINA'
  slug            text UNIQUE NOT NULL,          -- url-safe: 'duc', 'bfsc' → swimloading.com/clubs/duc
  name            text NOT NULL,                 -- 'Durban Underwater Club'
  country         text NOT NULL DEFAULT 'ZA',   -- ISO 3166-1 alpha-2: ZA, AU, GB, etc.
  city            text,
  founded_year    int,
  tagline         text,                          -- "@ DUC the ocean is the limit"
  description     text,
  logo_url        text,
  website         text,
  contact_email   text,
  home_spot_id    uuid REFERENCES spots(id),    -- primary swim location
  domain          text REFERENCES domains(code), -- links to existing region system
  member_count    int DEFAULT 0,                 -- denormalised, updated by trigger
  is_active       boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- ── 2. CLUB CATEGORIES ────────────────────────────────────────────
-- Configurable per club — not hardcoded. Each club defines its own
-- age brackets. DUC: Guppies / Sailfish / Makos / Walrus / Coelacanths
CREATE TABLE IF NOT EXISTS club_categories (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id     uuid NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  name        text NOT NULL,       -- 'Guppies'
  sort_order  int NOT NULL DEFAULT 0,
  min_age     int,                 -- NULL = no lower bound
  max_age     int,                 -- NULL = no upper bound (open-ended senior)
  description text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (club_id, name)
);

-- ── 3. CLUB MEMBERS ───────────────────────────────────────────────
-- Links an existing SwimLoading user to a club.
-- Temp logs are NOT stored here — they stay in temp_logs (universal).
-- The club view just filters temp_logs by user_id membership.
CREATE TABLE IF NOT EXISTS club_members (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id         uuid NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  member_number   text NOT NULL,   -- '#14' — unique within the club
  category_id     uuid REFERENCES club_categories(id),
  role            text NOT NULL DEFAULT 'member'
                  CHECK (role IN ('member','organiser','admin')),
  joined_at       timestamptz NOT NULL DEFAULT now(),
  is_active       boolean NOT NULL DEFAULT true,
  notes           text,            -- admin-only notes (invisible to member)
  UNIQUE (club_id, user_id),
  UNIQUE (club_id, member_number)
);

-- ── 4. CLUB JOIN LINKS ────────────────────────────────────────────
-- Admin generates a link → shares on WhatsApp → existing members tap
-- and are instantly joined with category auto-assigned from their DOB.
CREATE TABLE IF NOT EXISTS club_join_links (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id     uuid NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  code        text UNIQUE NOT NULL,  -- random slug, e.g. 'duc-2026-xk9'
  created_by  uuid REFERENCES auth.users(id),
  expires_at  timestamptz,           -- NULL = never expires
  max_uses    int,                   -- NULL = unlimited
  use_count   int NOT NULL DEFAULT 0,
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- ── 5. CLUB EVENTS ────────────────────────────────────────────────
-- Club-specific races and sessions. Separate from swim_events so
-- clubs can have private events. can optionally link to swim_events
-- for public visibility.
CREATE TABLE IF NOT EXISTS club_events (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id             uuid NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  swim_event_id       uuid REFERENCES swim_events(id),  -- optional public link
  title               text NOT NULL,
  event_date          date NOT NULL,
  start_time          time,
  spot_id             uuid REFERENCES spots(id),
  description         text,
  entry_cap           int,           -- NULL = unlimited
  pre_entry_cutoff    timestamptz,   -- NULL = no cutoff
  allows_day_entries  boolean NOT NULL DEFAULT true,
  is_league           boolean NOT NULL DEFAULT false,  -- counts for standings
  is_active           boolean NOT NULL DEFAULT true,
  created_by          uuid REFERENCES auth.users(id),
  created_at          timestamptz NOT NULL DEFAULT now()
);

-- ── 6. CLUB RACE ENTRIES ─────────────────────────────────────────
-- Who has entered a club event. Covers:
--   a) Pre-entered club member (user_id + club_member_id set)
--   b) Day-of club member (same, arrived = true, entry_type = 'day_of')
--   c) Day-of non-member guest (user_id null, guest_* fields set)
-- No payment fields — payment is external.
CREATE TABLE IF NOT EXISTS club_race_entries (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club_event_id   uuid NOT NULL REFERENCES club_events(id) ON DELETE CASCADE,
  -- Club member path
  user_id         uuid REFERENCES auth.users(id),
  club_member_id  uuid REFERENCES club_members(id),
  category_id     uuid REFERENCES club_categories(id),
  race_number     text NOT NULL,   -- '#14' for members, 'D01' for day-of guests
  entry_type      text NOT NULL DEFAULT 'pre_entry'
                  CHECK (entry_type IN ('pre_entry','day_of')),
  -- Guest (non-member) day-of path
  guest_name      text,
  guest_dob       date,
  guest_email     text,
  indemnity_signed_at timestamptz,  -- timestamp of digital indemnity acceptance
  -- Race day
  arrived         boolean NOT NULL DEFAULT false,  -- admin marks who showed up
  arrived_at      timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  -- A user can only enter once per event
  UNIQUE (club_event_id, user_id),
  -- A race number can only be used once per event
  UNIQUE (club_event_id, race_number)
);

-- ── 7. CLUB LEAGUE RESULTS ────────────────────────────────────────
-- Admin enters results after each league race. Points calculated here.
-- We are NOT the timing system — results come from timing sheets / CSV.
-- This is the record-keeping and display layer only.
CREATE TABLE IF NOT EXISTS club_league_results (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club_event_id   uuid NOT NULL REFERENCES club_events(id) ON DELETE CASCADE,
  club_member_id  uuid NOT NULL REFERENCES club_members(id),
  category_id     uuid NOT NULL REFERENCES club_categories(id),
  finish_position int,             -- position within their category
  finish_time     interval,        -- optional, from timing system
  points          int NOT NULL DEFAULT 0,
  dnf             boolean NOT NULL DEFAULT false,  -- did not finish
  dns             boolean NOT NULL DEFAULT false,  -- did not start
  entered_by      uuid REFERENCES auth.users(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (club_event_id, club_member_id)
);

-- ── INDEXES ───────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_club_members_club_id  ON club_members(club_id);
CREATE INDEX IF NOT EXISTS idx_club_members_user_id  ON club_members(user_id);
CREATE INDEX IF NOT EXISTS idx_club_events_club_id   ON club_events(club_id);
CREATE INDEX IF NOT EXISTS idx_club_events_date      ON club_events(event_date);
CREATE INDEX IF NOT EXISTS idx_race_entries_event    ON club_race_entries(club_event_id);
CREATE INDEX IF NOT EXISTS idx_race_entries_user     ON club_race_entries(user_id);
CREATE INDEX IF NOT EXISTS idx_league_results_event  ON club_league_results(club_event_id);
CREATE INDEX IF NOT EXISTS idx_league_results_member ON club_league_results(club_member_id);

-- ── RLS ──────────────────────────────────────────────────────────
ALTER TABLE clubs               ENABLE ROW LEVEL SECURITY;
ALTER TABLE club_categories     ENABLE ROW LEVEL SECURITY;
ALTER TABLE club_members        ENABLE ROW LEVEL SECURITY;
ALTER TABLE club_join_links     ENABLE ROW LEVEL SECURITY;
ALTER TABLE club_events         ENABLE ROW LEVEL SECURITY;
ALTER TABLE club_race_entries   ENABLE ROW LEVEL SECURITY;
ALTER TABLE club_league_results ENABLE ROW LEVEL SECURITY;

-- Clubs: public read, service role write
CREATE POLICY "clubs_public_read"    ON clubs FOR SELECT USING (true);
CREATE POLICY "clubs_service_write"  ON clubs FOR ALL USING (auth.role() = 'service_role');

-- Club categories: public read
CREATE POLICY "categories_public_read"   ON club_categories FOR SELECT USING (true);
CREATE POLICY "categories_admin_write"   ON club_categories FOR ALL
  USING (EXISTS (SELECT 1 FROM club_members m WHERE m.club_id = club_id AND m.user_id = auth.uid() AND m.role IN ('admin','organiser')));

-- Club members: members see their own club, admins see all in club
CREATE POLICY "members_read_own_club" ON club_members FOR SELECT
  USING (club_id IN (SELECT club_id FROM club_members WHERE user_id = auth.uid()));
CREATE POLICY "members_insert_self"   ON club_members FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "members_admin_all"     ON club_members FOR ALL
  USING (EXISTS (SELECT 1 FROM club_members m WHERE m.club_id = club_id AND m.user_id = auth.uid() AND m.role IN ('admin','organiser')));

-- Club events: members of that club can read; admins write
CREATE POLICY "events_member_read"   ON club_events FOR SELECT
  USING (club_id IN (SELECT club_id FROM club_members WHERE user_id = auth.uid() AND is_active = true));
CREATE POLICY "events_admin_write"   ON club_events FOR ALL
  USING (EXISTS (SELECT 1 FROM club_members m WHERE m.club_id = club_id AND m.user_id = auth.uid() AND m.role IN ('admin','organiser')));

-- Race entries: entrant sees own entry; admins see all
CREATE POLICY "entries_own_read"     ON club_race_entries FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "entries_own_insert"   ON club_race_entries FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "entries_admin_all"    ON club_race_entries FOR ALL
  USING (EXISTS (
    SELECT 1 FROM club_events ce
    JOIN club_members m ON m.club_id = ce.club_id
    WHERE ce.id = club_event_id AND m.user_id = auth.uid() AND m.role IN ('admin','organiser')
  ));

-- League results: members of club read; admins write
CREATE POLICY "results_member_read"  ON club_league_results FOR SELECT
  USING (EXISTS (SELECT 1 FROM club_members m WHERE m.user_id = auth.uid() AND m.club_id = (
    SELECT ce.club_id FROM club_events ce WHERE ce.id = club_event_id)));
CREATE POLICY "results_admin_write"  ON club_league_results FOR ALL
  USING (EXISTS (
    SELECT 1 FROM club_events ce
    JOIN club_members m ON m.club_id = ce.club_id
    WHERE ce.id = club_event_id AND m.user_id = auth.uid() AND m.role IN ('admin','organiser')
  ));

-- Join links: public read (to validate a link), admin write
CREATE POLICY "join_links_public_read"  ON club_join_links FOR SELECT USING (true);
CREATE POLICY "join_links_admin_write"  ON club_join_links FOR ALL
  USING (EXISTS (SELECT 1 FROM club_members m WHERE m.club_id = club_id AND m.user_id = auth.uid() AND m.role IN ('admin','organiser')));


-- ── SEED DUC ─────────────────────────────────────────────────────
-- Insert DUC as the first club. Home spot = Vetch's Beach (update
-- the spot ID once confirmed in your spots table).
INSERT INTO clubs (code, slug, name, country, city, founded_year, tagline, contact_email, domain, is_active)
VALUES ('DUC', 'duc', 'Durban Underwater Club', 'ZA', 'Durban', 1954,
        'The ocean is the limit', 'support@swimloading.com', 'kzn', true)
ON CONFLICT (code) DO NOTHING;

-- DUC categories — age ranges to confirm with Steve, these are estimates
INSERT INTO club_categories (club_id, name, sort_order, min_age, max_age, description)
SELECT id, 'Guppies',      1, NULL, 17,   'Juniors under 18'         FROM clubs WHERE code = 'DUC'
ON CONFLICT (club_id, name) DO NOTHING;
INSERT INTO club_categories (club_id, name, sort_order, min_age, max_age, description)
SELECT id, 'Sailfish',     2, 18,   29,   '18–29'                    FROM clubs WHERE code = 'DUC'
ON CONFLICT (club_id, name) DO NOTHING;
INSERT INTO club_categories (club_id, name, sort_order, min_age, max_age, description)
SELECT id, 'Makos',        3, 30,   39,   '30–39'                    FROM clubs WHERE code = 'DUC'
ON CONFLICT (club_id, name) DO NOTHING;
INSERT INTO club_categories (club_id, name, sort_order, min_age, max_age, description)
SELECT id, 'Walrus',       4, 40,   49,   '40–49'                    FROM clubs WHERE code = 'DUC'
ON CONFLICT (club_id, name) DO NOTHING;
INSERT INTO club_categories (club_id, name, sort_order, min_age, max_age, description)
SELECT id, 'Coelacanths',  5, 50,   NULL, '50 and over'              FROM clubs WHERE code = 'DUC'
ON CONFLICT (club_id, name) DO NOTHING;

