-- ================================================================
-- Migration: create_monthly_leaderboard.sql
--
-- Stores monthly challenge results as a queryable snapshot.
-- Populated manually or via snapshot_monthly_leaderboard() function.
-- ================================================================

CREATE TABLE IF NOT EXISTS monthly_leaderboard (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  month         date        NOT NULL,   -- first day of the month, e.g. 2026-05-01
  user_id       uuid        REFERENCES auth.users(id),
  display_name  text        NOT NULL,
  rank          int         NOT NULL,
  log_count     int         NOT NULL DEFAULT 0,
  total_points  int         NOT NULL DEFAULT 0,
  is_winner     boolean     NOT NULL DEFAULT false, -- true for #1 eligible (excl. organiser)
  prize         text,                               -- e.g. 'Maurten bundle'
  prize_sent    boolean     NOT NULL DEFAULT false,
  notes         text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (month, user_id)
);

-- Index for fast month lookups
CREATE INDEX IF NOT EXISTS idx_monthly_lb_month ON monthly_leaderboard(month);
CREATE INDEX IF NOT EXISTS idx_monthly_lb_winner ON monthly_leaderboard(month, is_winner);

-- RLS: only admins can read/write
ALTER TABLE monthly_leaderboard ENABLE ROW LEVEL SECURITY;

CREATE POLICY "monthly_lb_admin_all" ON monthly_leaderboard
  FOR ALL USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true)
  );

-- ── Snapshot function ────────────────────────────────────────────
-- Call at month end: SELECT snapshot_monthly_leaderboard('2026-05-01');
-- Organiser ID excluded from is_winner flag.

CREATE OR REPLACE FUNCTION snapshot_monthly_leaderboard(p_month date)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_start timestamptz := date_trunc('month', p_month)::timestamptz;
  v_end   timestamptz := (date_trunc('month', p_month) + interval '1 month' - interval '1 second')::timestamptz;
  v_organiser_id uuid := 'df137255-3add-4153-b368-32e06e2be188'; -- DaveW
  v_rank  int := 0;
  v_row   record;
BEGIN
  -- Remove any existing snapshot for this month first
  DELETE FROM monthly_leaderboard WHERE month = date_trunc('month', p_month)::date;

  -- Re-rank eligible swimmers (excluding organiser) to determine is_winner
  FOR v_row IN
    SELECT user_id, display_name, log_count, total_points
    FROM get_monthly_temp_leaders(v_start::text, v_end::text)
    WHERE user_id != v_organiser_id
    ORDER BY total_points DESC, log_count DESC
  LOOP
    v_rank := v_rank + 1;
    INSERT INTO monthly_leaderboard
      (month, user_id, display_name, rank, log_count, total_points, is_winner)
    VALUES (
      date_trunc('month', p_month)::date,
      v_row.user_id,
      v_row.display_name,
      v_rank,
      v_row.log_count,
      v_row.total_points,
      v_rank = 1
    );
  END LOOP;
END;
$$;

-- ── Pre-populate known correct results ──────────────────────────

-- April 2026 (Ysie won, declined — Brigitte Melly runner-up notified)
INSERT INTO monthly_leaderboard (month, user_id, display_name, rank, log_count, total_points, is_winner, prize, prize_sent, notes)
VALUES
  ('2026-04-01', 'cff2fc33-4a55-451b-8c7f-20f12c1898ce', 'Ysie',           1, 8, 160, true,  'Maurten bundle', false, 'Declined prize — runner-up Brigitte Melly notified'),
  ('2026-04-01', 'df137255-3add-4153-b368-32e06e2be188', 'DaveW',          2, 6, 120, false, null, false, 'Organiser — excluded from prize'),
  ('2026-04-01', '2d2e6472-548d-4587-a887-eabe5ecbaba9', 'Brigitte Melly', 3, 6, 120, false, 'Maurten bundle', false, 'Notified as runner-up after winner declined'),
  ('2026-04-01', '437fe022-4c77-4c93-8cc1-20a73e19ef67', 'Eish',           4, 3,  60, false, null, false, null)
ON CONFLICT (month, user_id) DO NOTHING;

-- May 2026 (Eish won — both prizes sent due to newsletter error)
INSERT INTO monthly_leaderboard (month, user_id, display_name, rank, log_count, total_points, is_winner, prize, prize_sent, notes)
VALUES
  ('2026-05-01', 'df137255-3add-4153-b368-32e06e2be188', 'DaveW',          1, 18, 360, false, null, false, 'Organiser — excluded from prize'),
  ('2026-05-01', '437fe022-4c77-4c93-8cc1-20a73e19ef67', 'Eish',           2, 12, 240, true,  'Maurten bundle', false, 'Correct winner. Newsletter error sent Brigitte Melly — both prizes being sent'),
  ('2026-05-01', 'cff2fc33-4a55-451b-8c7f-20f12c1898ce', 'Ysie',           3, 10, 190, false, null, false, null),
  ('2026-05-01', '7a90a8a8-944e-4fd4-aa58-639050de0272', 'ocean.chiq',     4,  7, 140, false, null, false, null),
  ('2026-05-01', '9b1445e8-cce5-4501-a038-489146d15ab2', 'Peter Emslie',   5,  6, 120, false, null, false, null)
ON CONFLICT (month, user_id) DO NOTHING;
