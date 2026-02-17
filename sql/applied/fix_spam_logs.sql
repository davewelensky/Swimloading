-- 1. Clean up gregstreak's duplicate spam logs
-- Keep only the FIRST log per spot per user per hour, delete the rest
DELETE FROM temp_logs
WHERE id IN (
    SELECT id FROM (
        SELECT id,
            ROW_NUMBER() OVER (
                PARTITION BY user_id, spot_id, DATE_TRUNC('hour', created_at)
                ORDER BY created_at ASC
            ) AS rn
        FROM temp_logs
    ) dupes
    WHERE rn > 1
);

-- 2. Add a database-level function to prevent rapid-fire logging
-- This runs BEFORE insert and rejects duplicates within 1 hour
CREATE OR REPLACE FUNCTION check_temp_log_cooldown()
RETURNS TRIGGER AS $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM temp_logs
        WHERE user_id = NEW.user_id
          AND spot_id = NEW.spot_id
          AND created_at > (NOW() - INTERVAL '1 hour')
    ) THEN
        RAISE EXCEPTION 'You can only log once per spot per hour';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS enforce_temp_log_cooldown ON temp_logs;

CREATE TRIGGER enforce_temp_log_cooldown
    BEFORE INSERT ON temp_logs
    FOR EACH ROW
    EXECUTE FUNCTION check_temp_log_cooldown();
