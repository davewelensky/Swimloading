-- Admin log moderation: allow admins to delete any temp_log
-- Run in Supabase SQL editor

-- 1. RLS policy — admins can delete any log
DROP POLICY IF EXISTS "Admins can delete any temp log" ON temp_logs;
CREATE POLICY "Admins can delete any temp log"
    ON temp_logs FOR DELETE
    USING (
        EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true)
    );

-- 2. Find Moondancer's bad log (Bakoven, 17°C, ~7pm March 3 2026)
--    Run this SELECT first to confirm the row before deleting
SELECT tl.id, tl.temp_c, tl.logged_at, tl.created_at, p.display_name, s.name
FROM temp_logs tl
JOIN profiles p ON p.id = tl.user_id
JOIN spots s ON s.id = tl.spot_id
WHERE p.display_name = 'Moondancer'
  AND s.name ILIKE '%bakoven%'
  AND tl.temp_c = 17
  AND (tl.logged_at BETWEEN '2026-03-03 18:00:00+02' AND '2026-03-03 20:00:00+02'
    OR tl.created_at BETWEEN '2026-03-03 18:00:00+02' AND '2026-03-03 20:00:00+02');

-- 3. Once ID confirmed, delete by its exact UUID:
-- DELETE FROM temp_logs WHERE id = '<id from SELECT above>';
