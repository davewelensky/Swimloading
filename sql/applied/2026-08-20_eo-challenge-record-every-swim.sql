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
      '╚══════════════════════════════════════════════════════════╝'
    USING HINT = 'Check the project ref in your Supabase dashboard URL';
  END IF;
  RAISE NOTICE '✅ Project identity confirmed: swimloading (szgkzuswelntnevobnoh)';
END $$;

-- ================================================================
-- Migration: 2026-08-20_eo-challenge-record-every-swim.sql
-- Process:   see MIGRATIONS.md
-- ================================================================

-- Purpose:
--   The eo SwimBETTER challenge recorded an active day only when a swim was
--   logged through the app's own form. Every Strava-imported swim was
--   invisible to it. Move recording into the database so it cannot depend on
--   which screen the swim arrived through, and backfill what was missed.

-- Requested by:
--   Dave — 20 Aug 2026, after spotting his own account showing 1 active day.

-- Evidence (measured 20 Aug 2026, challenge window 1 Aug – 31 Oct):
--   Days a swimmer was active, by how the swim arrived:
--     manual app log ......... 80 days, 58 recorded
--     Strava import only .... 101 days,  0 recorded   ← 100% loss
--   record_eo_active_day() is called from exactly one place, app.js:8400,
--   inside submitTempLog. api/strava/import-activity.js writes the temp_log
--   server-side and never calls it. Nothing was lost from temp_logs — the
--   swims are all there; only the challenge could not see them.
--
--   The failure could not surface from the app either: the RPC returns
--   {recorded:false, reason:…} on a soft refusal and the caller inspects
--   only `error`, with .catch(()=>{}) behind it. Both are discarded.

-- ----------------------------------------------------------------
-- WHO EARNS A DAY — the rules this migration encodes
-- ----------------------------------------------------------------
--   1. A swimmer earns at most one active day per SAST calendar date
--      (unchanged — the primary key already enforced this).
--
--   2. Manual app logs count only when the log's SAST date equals the SAST
--      date it was created. This is the existing anti-gaming rule: a manual
--      log carries no evidence, so backdating stays blocked.
--
--   3. Strava imports count on the SAST date of the ACTIVITY, whenever they
--      were imported. A Strava activity is a GPS-timestamped record of a
--      real swim, not a claim about one, so the anti-backdating rule has
--      nothing to protect against. Applying the same-day rule to imports
--      would have discarded 18 genuine swim days across 9 swimmers who
--      imported the morning after — precisely the loss this migration
--      exists to stop.
--
--   4. Machine feeds never earn a day. Two write to temp_logs:
--        • the London lido sensor cron (api/cron/sensor-import.js) — already
--          harmless, it writes user_id NULL and the PK forbids that;
--        • the Big Bay SwimOps watch feed — 12 readings a day at one spot.
--          Dave confirmed 20 Aug 2026 that this is Derrick Frazer recording
--          water temperatures FOR channel swimmers, not swimming himself.
--      Without this exclusion a trigger would have handed a machine a
--      perfect daily streak and let it win the prize.
--
--      The SwimOps marker is matched on note text because that is the only
--      signal the row carries today. A dedicated ingest_source column on
--      temp_logs would be the durable fix — worth doing, out of scope here.

-- ----------------------------------------------------------------
-- PRE-CHECKS — read-only, run BEFORE applying.
-- ----------------------------------------------------------------
-- A. Rows to be inserted by the backfill.        expect: 101
-- B. Rows currently in the table.                expect: 58
-- C. Rows the backfill would REMOVE.             expect: 0  (it only inserts)
--    (both queries are reproduced in the VERIFY section)

-- ----------------------------------------------------------------
-- BACKUP — required: this migration writes to a prize-bearing table.
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS _bak_20260820_eo_active_days AS
  SELECT *, now() AS backed_up_at FROM public.eo_challenge_active_days;

-- ----------------------------------------------------------------
-- MIGRATION — applied only after Dave types "apply".
-- ----------------------------------------------------------------
BEGIN;

-- 1 ── One definition of "this log earns its swimmer an active day".
--      Used by BOTH the trigger and the backfill, so the live rule and the
--      repair can never drift apart.
CREATE OR REPLACE FUNCTION public.eo_log_active_date(p_log public.temp_logs)
RETURNS date
LANGUAGE plpgsql
STABLE
SET search_path TO 'public'
AS $function$
DECLARE
  v_config     eo_challenge_config%ROWTYPE;
  v_swim_date  date;
  v_made_date  date;
  v_is_strava  boolean;
BEGIN
  SELECT * INTO v_config FROM eo_challenge_config WHERE id = 1;
  IF NOT FOUND OR NOT v_config.enabled THEN RETURN NULL; END IF;

  -- A machine feed never earns a day (rule 4).
  IF p_log.user_id IS NULL THEN RETURN NULL; END IF;
  IF p_log.notes ILIKE '%via Big Bay SwimOps%' THEN RETURN NULL; END IF;

  v_swim_date := (COALESCE(p_log.logged_at, p_log.created_at) AT TIME ZONE 'Africa/Johannesburg')::date;
  v_made_date := (p_log.created_at AT TIME ZONE 'Africa/Johannesburg')::date;

  IF v_swim_date < v_config.launch_date OR v_swim_date > v_config.end_date THEN
    RETURN NULL;
  END IF;

  SELECT EXISTS (SELECT 1 FROM strava_imports si WHERE si.imported_to_log_id = p_log.id)
    INTO v_is_strava;

  -- Rule 3: an imported activity counts on the day it happened.
  -- Rule 2: a manual log must be same-day.
  IF NOT v_is_strava AND v_swim_date <> v_made_date THEN
    RETURN NULL;
  END IF;

  RETURN v_swim_date;
END;
$function$;

-- 2 ── Record on write, whatever wrote it.
--      A trigger rather than a client call: the app form, the Strava
--      importer, crossing-prep and anything added later all pass through
--      here. This is the fix — every other change in this file is repair.
CREATE OR REPLACE FUNCTION public.eo_record_active_day_trg()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_date date;
BEGIN
  v_date := eo_log_active_date(NEW);
  IF v_date IS NOT NULL THEN
    INSERT INTO eo_challenge_active_days (user_id, active_date, source_log_id)
    VALUES (NEW.user_id, v_date, NEW.id)
    ON CONFLICT (user_id, active_date) DO NOTHING;
  END IF;
  RETURN NULL;   -- AFTER trigger
END;
$function$;

DROP TRIGGER IF EXISTS trg_eo_record_active_day ON public.temp_logs;
CREATE TRIGGER trg_eo_record_active_day
  AFTER INSERT ON public.temp_logs
  FOR EACH ROW EXECUTE FUNCTION public.eo_record_active_day_trg();

-- Strava rows are linked in strava_imports AFTER the temp_log is inserted,
-- so at INSERT time the trigger cannot yet see that a log is an import. This
-- catches it at the moment the link is made.
CREATE OR REPLACE FUNCTION public.eo_record_active_day_from_import_trg()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_log  temp_logs%ROWTYPE;
  v_date date;
BEGIN
  IF NEW.imported_to_log_id IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO v_log FROM temp_logs WHERE id = NEW.imported_to_log_id;
  IF NOT FOUND THEN RETURN NULL; END IF;

  v_date := eo_log_active_date(v_log);
  IF v_date IS NOT NULL THEN
    INSERT INTO eo_challenge_active_days (user_id, active_date, source_log_id)
    VALUES (v_log.user_id, v_date, v_log.id)
    ON CONFLICT (user_id, active_date) DO NOTHING;
  END IF;
  RETURN NULL;
END;
$function$;

DROP TRIGGER IF EXISTS trg_eo_record_active_day_import ON public.strava_imports;
CREATE TRIGGER trg_eo_record_active_day_import
  AFTER INSERT OR UPDATE OF imported_to_log_id ON public.strava_imports
  FOR EACH ROW EXECUTE FUNCTION public.eo_record_active_day_from_import_trg();

-- 3 ── Backfill every day already earned but never recorded.
--      Same rule function as the trigger, so this cannot award a day the
--      live path would not have awarded. INSERT only — nothing is removed.
INSERT INTO public.eo_challenge_active_days (user_id, active_date, source_log_id)
SELECT DISTINCT ON (t.user_id, eo_log_active_date(t.*))
       t.user_id, eo_log_active_date(t.*), t.id
  FROM public.temp_logs t
 WHERE eo_log_active_date(t.*) IS NOT NULL
 ORDER BY t.user_id, eo_log_active_date(t.*), t.created_at
ON CONFLICT (user_id, active_date) DO NOTHING;

-- 4 ── A deleted log must not erase a day that was earned.
--      source_log_id is only provenance; ON DELETE CASCADE meant removing a
--      log silently removed the day, even when the swimmer had logged again
--      that same day. release_temp_log_refs() already handles voids properly.
ALTER TABLE public.eo_challenge_active_days
  DROP CONSTRAINT IF EXISTS eo_challenge_active_days_source_log_id_fkey;
ALTER TABLE public.eo_challenge_active_days
  ADD CONSTRAINT eo_challenge_active_days_source_log_id_fkey
  FOREIGN KEY (source_log_id) REFERENCES public.temp_logs(id) ON DELETE SET NULL;

-- 5 ── A swimmer with no profiles row must not fall off the leaderboard.
--      The JOIN was inner, so a missing profile removed them entirely rather
--      than showing them unnamed.
CREATE OR REPLACE FUNCTION public.get_eo_challenge_leaders()
 RETURNS TABLE(user_id uuid, display_name text, avatar_url text, total_active_days integer, longest_streak integer, first_active_date date, last_active_date date)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH grouped AS (
    SELECT user_id, active_date,
           active_date - (ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY active_date))::integer AS grp
    FROM eo_challenge_active_days
  ),
  streaks AS (
    SELECT user_id, grp, count(*) AS streak_len
    FROM grouped GROUP BY user_id, grp
  ),
  per_user AS (
    SELECT user_id,
           count(*) AS total_active_days,
           max(active_date) AS last_active_date,
           min(active_date) AS first_active_date
    FROM eo_challenge_active_days GROUP BY user_id
  ),
  longest AS (
    SELECT user_id, max(streak_len) AS longest_streak FROM streaks GROUP BY user_id
  )
  SELECT p.user_id, pr.display_name, pr.avatar_url,
         p.total_active_days::integer, COALESCE(l.longest_streak, 0)::integer,
         p.first_active_date, p.last_active_date
  FROM per_user p
  JOIN longest l ON l.user_id = p.user_id
  LEFT JOIN profiles pr ON pr.id = p.user_id
  ORDER BY p.total_active_days DESC, l.longest_streak DESC;
$function$;

-- 6 ── Make drift visible. This is the check that would have caught the bug
--      on 2 August instead of 20 August: every day a swimmer earned under
--      the rule, against every day actually recorded.
CREATE OR REPLACE VIEW public.eo_challenge_reconciliation AS
  WITH earned AS (
    SELECT DISTINCT t.user_id, eo_log_active_date(t.*) AS active_date
      FROM temp_logs t
     WHERE eo_log_active_date(t.*) IS NOT NULL
  )
  SELECT COALESCE(e.user_id, a.user_id)       AS user_id,
         COALESCE(e.active_date, a.active_date) AS active_date,
         (e.user_id IS NOT NULL)              AS earned,
         (a.user_id IS NOT NULL)              AS recorded
    FROM earned e
    FULL JOIN eo_challenge_active_days a
      ON a.user_id = e.user_id AND a.active_date = e.active_date
   WHERE (e.user_id IS NULL) <> (a.user_id IS NULL);   -- disagreements only

COMMENT ON VIEW public.eo_challenge_reconciliation IS
  'Rows here mean the eo challenge disagrees with temp_logs. Should always be empty.';

COMMIT;

-- ----------------------------------------------------------------
-- ROLLBACK
-- ----------------------------------------------------------------
--   DROP TRIGGER IF EXISTS trg_eo_record_active_day ON public.temp_logs;
--   DROP TRIGGER IF EXISTS trg_eo_record_active_day_import ON public.strava_imports;
--   DROP VIEW IF EXISTS public.eo_challenge_reconciliation;
--   DELETE FROM public.eo_challenge_active_days a
--    WHERE NOT EXISTS (SELECT 1 FROM _bak_20260820_eo_active_days b
--                       WHERE b.user_id=a.user_id AND b.active_date=a.active_date);
--   -- then restore get_eo_challenge_leaders from git (inner JOIN profiles)
--   -- and, if truly wanted, re-add the FK with ON DELETE CASCADE.

-- ----------------------------------------------------------------
-- VERIFY — read-only, after applying.
-- ----------------------------------------------------------------
-- 1. Reconciliation is empty.                       expect: 0
-- SELECT count(*) FROM eo_challenge_reconciliation;
--
-- 2. Nothing was removed — the backup is a subset.  expect: 0
-- SELECT count(*) FROM _bak_20260820_eo_active_days b
--  WHERE NOT EXISTS (SELECT 1 FROM eo_challenge_active_days a
--                     WHERE a.user_id=b.user_id AND a.active_date=b.active_date);
--
-- 3. Derrick's watch feed earned nothing.           expect: 0 rows
-- SELECT a.* FROM eo_challenge_active_days a
--   JOIN profiles pr ON pr.id=a.user_id
--  WHERE pr.display_name LIKE 'Derrick Frazer%' AND a.active_date IN ('2026-08-07','2026-08-08');
--
-- 4. The leaderboard now matches the independent count.
-- SELECT display_name, total_active_days, longest_streak
--   FROM get_eo_challenge_leaders() LIMIT 12;
