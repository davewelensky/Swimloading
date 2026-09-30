-- SAFETY CHECK
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM _project_identity WHERE key='project_name' AND value='swimloading') THEN
    RAISE EXCEPTION 'WRONG PROJECT — MIGRATION ABORTED'; END IF;
END $$;

-- Migration: 2026-09-30_temp-logs-hide-gps-photo-from-anon.sql
-- Purpose:   Logged-OUT visitors (anon key) could read every swimmer's exact GPS position
--            (temp_logs.lat / lng, 679 rows) and photo_url via the public "landing page" read
--            policy. Restrict the anon role to the non-location columns. Row policy unchanged.
--            Logged-in users (authenticated), service-role APIs, crons and definer views are
--            NOT affected — this touches the anon role only.
-- Requested by: Dave (security review, 30 Sep 2026). Constraint: must not break Aquasharks /
--            Bluefin / DUC club apps (all run logged-in; none use anon reads of these columns).
-- Pre-checks: repo-wide search — no logged-out page/API selects lat, lng or photo_url from
--            temp_logs; the only select('*') callers run after login; spot_temp_estimate (the one
--            security_invoker view) does not use them. user_id + notes stay readable for now
--            (clubs.html, site-sync.js, concepts page still use them) — Stage 2, separate change.
-- Backup:    not needed — permission change only.
REVOKE SELECT ON public.temp_logs FROM anon;
GRANT SELECT (id, user_id, spot_id, temp_c, conditions, hazards, notes, created_at,
              visibility, swell, location_source, gps_spot_id, logged_at,
              distance_km, duration_minutes, location_type)
  ON public.temp_logs TO anon;
-- Rollback:  GRANT SELECT ON public.temp_logs TO anon;
-- Verify:    anon: select=lat -> 401/42501 ; select=temp_c,spot_id,created_at -> 200 ;
--            has_column_privilege('authenticated','public.temp_logs','lat','SELECT') = true ;
--            all public pages / RPC probes identical to baseline.
