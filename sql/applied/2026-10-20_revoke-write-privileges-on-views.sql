-- ================================================================
-- SwimLoading — Migration
-- ================================================================

-- ⚠️  SAFETY CHECK — runs first, aborts everything if wrong project
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM _project_identity
    WHERE key = 'project_name' AND value = 'swimloading'
  ) THEN
    RAISE EXCEPTION
      E'\n\n'
      '╔══════════════════════════════════════════════════════════╗\n'
      '║  WRONG PROJECT — MIGRATION ABORTED                       ║\n'
      '║                                                          ║\n'
      '║  This migration is for: SwimLoading                     ║\n'
      '║  Expected project ref:  szgkzuswelntnevobnoh            ║\n'
      '║                                                          ║\n'
      '║  You are connected to a DIFFERENT Supabase project.     ║\n'
      '║  No changes have been made. Check your browser URL.     ║\n'
      '╚══════════════════════════════════════════════════════════╝'
    USING HINT = 'Check the project ref in your Supabase dashboard URL';
  END IF;
  RAISE NOTICE '✅ Project identity confirmed: swimloading (szgkzuswelntnevobnoh)';
END $$;

-- ================================================================
-- Migration: 2026-10-20_revoke-write-privileges-on-views.sql
-- Process:   see MIGRATIONS.md
-- ================================================================

-- Purpose:
--   CRITICAL. Every view in public was created with the default grants
--   Supabase gives new objects: anon and authenticated hold
--   INSERT/UPDATE/DELETE/TRUNCATE on them, and the views run as their
--   owner (postgres, security_invoker = false), which bypasses RLS.
--   public_profiles is a plain `SELECT id, display_name FROM profiles`,
--   so Postgres treats it as auto-updatable: an anonymous request with the
--   public anon key can PATCH or DELETE every row of public.profiles
--   (764 users) through it. Confirmed live on 2026-10-20 with a DELETE whose
--   filter matched no rows: the API answered 200 instead of 42501.
--   event_change_history has the same shape over event_change_log.
--
--   This migration removes every write privilege on every view from anon
--   and authenticated and leaves SELECT exactly as it is, so nothing the
--   app reads changes. No application code writes through a view
--   (grepped: zero .update/.delete/.insert/.upsert calls on any view).

-- Requested by:
--   Dave — security audit, 20 Oct 2026

-- ----------------------------------------------------------------
-- PRE-CHECKS — run on the READ-ONLY connection BEFORE applying.
-- ----------------------------------------------------------------
-- Which views currently let anon/authenticated write (dry-run 2026-10-20:
-- 16 in public, 1 in eventops; v_challenge_audit is the only view already
-- closed):
-- SELECT n.nspname||'.'||c.relname AS view, c.relacl::text
--   FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
--  WHERE c.relkind = 'v' AND n.nspname IN ('public','eventops')
--    AND (c.relacl::text ~ 'anon=[^/]*[awd]' OR c.relacl::text ~ 'authenticated=[^/]*[awd]')
--  ORDER BY 1;
--
-- Views that are auto-updatable (the ones a write would actually reach a
-- table through) — expect: event_change_history, public_organisers,
-- public_profiles:
-- SELECT table_name FROM information_schema.views
--  WHERE table_schema = 'public' AND is_updatable = 'YES' ORDER BY 1;

-- ----------------------------------------------------------------
-- BACKUP — not applicable: this changes privileges only, no rows are
-- touched. Rollback is the GRANT statements below.
-- ----------------------------------------------------------------

-- ----------------------------------------------------------------
-- MIGRATION — applied only after Dave types "apply".
-- ----------------------------------------------------------------
BEGIN;

-- Every view in public, named explicitly so the file documents what changed.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON public.challenge_unusual_activity,
     public.club_member_directory,
     public.eo_challenge_reconciliation,
     public.event_change_history,
     public.event_interest_counts,
     public.june_challenge_leaderboard,
     public.latest_spot_temps,
     public.public_organisers,
     public.public_profiles,
     public.spot_conditions_live,
     public.spot_temp_estimate,
     public.spot_water_latest,
     public.v_challenge_audit,
     public.v_challenge_temp_outliers,
     public.v_challenge_travel_anomalies,
     public.v_false_bay_crossings,
     public.venue_temp_estimate,
     public.venue_water_latest
  FROM anon, authenticated;

-- eventops is not an exposed PostgREST schema today, but the same default
-- grant is there; close it while we are here.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON eventops.published_results
  FROM anon, authenticated;

COMMIT;

-- Deliberately NOT changing ALTER DEFAULT PRIVILEGES here: that would also
-- strip write grants from every future TABLE, and a later migration that
-- forgets an explicit GRANT would break the app silently. Instead, every
-- future migration that creates a VIEW must end with:
--   REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
--     ON public.<view> FROM anon, authenticated;
-- and the Supabase security advisor (security_definer_view) is the check.

-- ----------------------------------------------------------------
-- ROLLBACK — exact SQL to undo (restores the dangerous state; only for
-- emergencies, e.g. a view turns out to be written to).
-- ----------------------------------------------------------------
-- GRANT INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
--   ON <view> TO anon, authenticated;

-- ----------------------------------------------------------------
-- VERIFY — run on the READ-ONLY connection AFTER applying.
-- ----------------------------------------------------------------
-- 1. No view grants anon or authenticated anything but SELECT:
-- SELECT n.nspname||'.'||c.relname AS view, c.relacl::text
--   FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
--  WHERE c.relkind = 'v' AND n.nspname IN ('public','eventops')
--    AND (c.relacl::text ~ 'anon=[^/]*[awdDxt]' OR c.relacl::text ~ 'authenticated=[^/]*[awdDxt]');
--   -- expect: 0 rows
--
-- 2. SELECT still works for anon on the views the app reads
--    (run from a terminal with the public anon key):
--    curl -s -H "apikey: $ANON" -H "Authorization: Bearer $ANON" \
--      "https://szgkzuswelntnevobnoh.supabase.co/rest/v1/public_profiles?select=id,display_name&limit=1"
--   -- expect: one row
--
-- 3. The write path is closed (no-match filter, nothing can be deleted):
--    curl -s -X DELETE -H "apikey: $ANON" -H "Authorization: Bearer $ANON" \
--      "https://szgkzuswelntnevobnoh.supabase.co/rest/v1/public_profiles?id=eq.00000000-0000-0000-0000-000000000000"
--   -- expect: {"code":"42501", ... "permission denied for view public_profiles"}
--
-- 4. Row count unchanged:
-- SELECT count(*) FROM public.profiles;   -- expect: 764 (as at 2026-10-20)
