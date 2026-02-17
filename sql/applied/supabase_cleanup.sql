-- Automatically remove temperature logs older than 4 days
-- 
-- USAGE INSTRUCTIONS:
--
-- OPTION 1: Manual Run
-- 1. Go to your Supabase Dashboard -> SQL Editor
-- 2. Paste the query below
-- 3. Click "Run"
--
-- OPTION 2: Scheduled Job (requires pg_cron extension)
-- 1. Enable pg_cron: Go to Database -> Extensions -> Search "pg_cron" -> Enable
-- 2. Run the following command in SQL Editor once:
--    SELECT cron.schedule(
--      'cleanup-temp-logs', -- name of the cron job
--      '0 0 * * *',         -- every day at midnight
--      $$DELETE FROM public.temp_logs WHERE created_at < (now() - interval '4 days')$$
--    );

DELETE FROM public.temp_logs
WHERE created_at < (now() - interval '4 days');
