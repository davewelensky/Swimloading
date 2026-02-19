-- Temp log enhancements: backdating + edit/delete
-- Run in Supabase SQL editor

-- 1. Add logged_at column for backdating
ALTER TABLE temp_logs ADD COLUMN IF NOT EXISTS logged_at TIMESTAMPTZ;
UPDATE temp_logs SET logged_at = created_at WHERE logged_at IS NULL;
ALTER TABLE temp_logs ALTER COLUMN logged_at SET DEFAULT NOW();

-- 2. Update cooldown trigger to use logged_at (supports backdated logs)
CREATE OR REPLACE FUNCTION check_temp_log_cooldown()
RETURNS TRIGGER AS $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM temp_logs
        WHERE user_id = NEW.user_id
          AND spot_id = NEW.spot_id
          AND ABS(EXTRACT(EPOCH FROM (
              COALESCE(NEW.logged_at, NOW()) - COALESCE(logged_at, created_at)
          ))) < 3600
          AND id != COALESCE(NEW.id, '00000000-0000-0000-0000-000000000000'::uuid)
    ) THEN
        RAISE EXCEPTION 'Please wait before logging this spot again';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 3. RLS policies for edit/delete (use IF NOT EXISTS pattern)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies WHERE tablename = 'temp_logs' AND policyname = 'Users can update own temp logs'
    ) THEN
        CREATE POLICY "Users can update own temp logs"
            ON temp_logs FOR UPDATE USING (auth.uid() = user_id);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies WHERE tablename = 'temp_logs' AND policyname = 'Users can delete own temp logs'
    ) THEN
        CREATE POLICY "Users can delete own temp logs"
            ON temp_logs FOR DELETE USING (auth.uid() = user_id);
    END IF;
END $$;
