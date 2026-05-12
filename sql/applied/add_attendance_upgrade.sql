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
-- Migration: add_attendance_upgrade.sql
-- Replaces Britt's manual spreadsheet with a proper digital system.
--
-- What this adds:
--   1. coach_name on club_sessions + club_squad_sessions
--   2. is_trial, trial_start_date, trial_end_date on club_roster
--   3. fee_paid, fee_due_date on club_roster
--   4. is_catch_up, catch_up_for_date on club_attendance
--   5. Drop old status CHECK constraint so new codes work
--
-- New status codes (matching Britt's spreadsheet):
--   present      = X  (attended)
--   no_contact   = nc (absent, no message from parent)
--   notice       = gave advance notice (parent warned ahead)
--   no_show      = NS (said they were coming, didn't show)
--   away         = away / holiday
--   dnp          = DNP (did not pay — fee issue)
--   catch_up     = C/U (attending a make-up session)
--   late         = Late (kept for back-compat)
--   absent       = Absent (kept for back-compat)
--   excused      = Excused (kept for back-compat)
-- ================================================================

-- ── 1. CLUB_SESSIONS — add coach_name ────────────────────────────
ALTER TABLE club_sessions ADD COLUMN IF NOT EXISTS coach_name TEXT;

-- ── 2. CLUB_SQUAD_SESSIONS — add coach_name, capacity ────────────
ALTER TABLE club_squad_sessions ADD COLUMN IF NOT EXISTS coach_name TEXT;
ALTER TABLE club_squad_sessions ADD COLUMN IF NOT EXISTS max_capacity INTEGER;

-- ── 3. CLUB_ROSTER — trial + fee tracking ────────────────────────
ALTER TABLE club_roster ADD COLUMN IF NOT EXISTS is_trial       BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE club_roster ADD COLUMN IF NOT EXISTS trial_start_date DATE;
ALTER TABLE club_roster ADD COLUMN IF NOT EXISTS trial_end_date   DATE;
ALTER TABLE club_roster ADD COLUMN IF NOT EXISTS fee_paid        BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE club_roster ADD COLUMN IF NOT EXISTS fee_due_date    DATE;

-- ── 4. CLUB_ATTENDANCE — catch-up flag + drop old status check ───
--
-- Drop old CHECK constraint on status column if it exists
-- (old constraint only allowed: present, late, absent, excused)
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'club_attendance'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%status%'
  LOOP
    EXECUTE 'ALTER TABLE club_attendance DROP CONSTRAINT IF EXISTS ' || quote_ident(r.conname);
    RAISE NOTICE 'Dropped constraint: %', r.conname;
  END LOOP;
END $$;

ALTER TABLE club_attendance ADD COLUMN IF NOT EXISTS is_catch_up        BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE club_attendance ADD COLUMN IF NOT EXISTS catch_up_for_date  DATE;

-- ── 5. INDEXES ───────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_club_roster_trial    ON club_roster(club_id, is_trial) WHERE is_trial = TRUE;
CREATE INDEX IF NOT EXISTS idx_club_roster_fee      ON club_roster(club_id, fee_paid) WHERE fee_paid = FALSE;
CREATE INDEX IF NOT EXISTS idx_club_attendance_cu   ON club_attendance(session_id, is_catch_up) WHERE is_catch_up = TRUE;
