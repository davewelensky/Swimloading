-- Applied 2026-07-19 via supabase-admin apply_migration (two calls,
-- combined here into one file for the record).
--
-- Bug: admin.html's "Void" buttons (June Challenge outliers panel, and
-- the UK Swim Spot Challenge's ukVoidLog() tool) only removed the
-- challenge/campaign credit for a flagged log — they never touched the
-- underlying temp_logs row. A voided reading kept showing as the spot's
-- current displayed temperature. Confirmed live: Dave voided Trevor
-- Lauf's 22C Bakoven reading (2026-07-18 13:11:45 SAST) in the June
-- Challenge panel; the spot still showed 22C until the row was manually
-- deleted (temp_logs id 6d55238d-916d-46d5-b3a1-c2390fb16903, deleted
-- directly, one-off, ahead of this migration).
--
-- Fix: both void functions now also DELETE FROM temp_logs WHERE id =
-- p_log_id. Voiding a log means the temperature reading itself is wrong
-- (both buttons live under "outliers"/suspicious-log review), not just
-- that it shouldn't earn points/credit.

CREATE OR REPLACE FUNCTION public.void_challenge_log(p_log_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_deleted integer;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM june_challenge_config
                 WHERE id = 1 AND tester_ids @> ARRAY[auth.uid()]::uuid[]) THEN
    RAISE EXCEPTION 'Not authorised to void logs';
  END IF;

  DELETE FROM june_challenge_events
  WHERE ref_id = p_log_id::text AND action_type = 'temp_log';
  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  DELETE FROM temp_logs WHERE id = p_log_id;

  RETURN v_deleted;
END;
$function$;

CREATE OR REPLACE FUNCTION public.void_campaign_log(p_campaign_id uuid, p_log_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_deleted_count integer;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_authorized');
  END IF;

  DELETE FROM campaign_location_credits
  WHERE campaign_id = p_campaign_id AND first_qualifying_log_id = p_log_id;
  GET DIAGNOSTICS v_deleted_count = ROW_COUNT;

  DELETE FROM temp_logs WHERE id = p_log_id;

  RETURN jsonb_build_object('ok', true, 'credits_removed', v_deleted_count);
END;
$function$;

-- Rollback: re-create each function without the "DELETE FROM temp_logs"
-- line (i.e. restore the versions shown in the "Bug" comment above).
