-- SAFETY CHECK
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM _project_identity WHERE key='project_name' AND value='swimloading') THEN
    RAISE EXCEPTION 'WRONG PROJECT — MIGRATION ABORTED'; END IF;
END $$;

-- Migration: 2026-09-30_revoke-anon-challenge-anomaly-fns.sql
-- Purpose:   get_challenge_anomalies() and get_challenge_temp_outliers() are SECURITY DEFINER,
--            have no caller check, and were executable by logged-OUT visitors (anon), leaking
--            swimmer user_id + display_name of flagged challenge logs.
-- Requested by: Dave (security review, 30 Sep 2026)
-- Pre-checks: only callers are admin.html (loadAntiCheat) and app-june.js admin view — both
--             run logged-in. No policy/view/function uses these two. Logged-in access is kept.
-- Backup:    not needed — permission change only, no data touched.
REVOKE EXECUTE ON FUNCTION public.get_challenge_anomalies()     FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_challenge_temp_outliers() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_challenge_anomalies()     TO authenticated;
GRANT  EXECUTE ON FUNCTION public.get_challenge_temp_outliers() TO authenticated;
-- Rollback:
--   GRANT EXECUTE ON FUNCTION public.get_challenge_anomalies(), public.get_challenge_temp_outliers() TO anon;
-- Verify: anon rpc call -> 401/403 ; has_function_privilege('authenticated', ...) = true
-- Follow-up (needs Dave's call): restrict further to admins/testers — see tester_ids pattern in void_challenge_log.
