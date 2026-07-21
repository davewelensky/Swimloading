-- ================================================================
-- SwimLoading — Migration Template
-- ================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM _project_identity
    WHERE key = 'project_name' AND value = 'swimloading'
  ) THEN
    RAISE EXCEPTION 'WRONG PROJECT — MIGRATION ABORTED. Expected ref: szgkzuswelntnevobnoh';
  END IF;
END $$;

-- ================================================================
-- Migration: 2026-07-21_notify-new-swim-rpc.sql
-- Process:   see MIGRATIONS.md
-- ================================================================

-- Purpose:
--   Restore the (silently dead) "new swim posted" in-app notification.
--   When a swim is created, the client tried to (1) read all profiles
--   with notify_new_swims=true and (2) insert a notification for each.
--   Both are blocked by RLS: profiles is own-row-only (read returns
--   empty), and notifications INSERT is own-or-service only (can't
--   insert for other recipients). So no swimmer has ever been notified.
--
--   This SECURITY DEFINER function does the fan-out server-side in one
--   call. Abuse-guarded: only the OPEN swim's own creator may fan out
--   for it — prevents any authenticated user spamming all opted-in
--   swimmers, and keeps private swims out of the community feed.
--
--   Volume note: ~644 users have notify_new_swims=true, but swim posts
--   are rare (3 in the last 30 days), so this is a handful of fan-outs a
--   month, not a firehose. The PUSH side of a new swim is separate and
--   already handled by the location broadcast (broadcastPush 'swim' →
--   notify_on_swim); this function only creates the in-app rows.

-- Requested by:
--   Dave (2026-07-21) — RLS sweep; "yes to the notification fix".

-- ----------------------------------------------------------------
-- PRE-CHECKS
-- ----------------------------------------------------------------
-- SELECT count(*) FROM pg_proc WHERE proname='notify_new_swim_v1';  -- expect: 0
-- SELECT count(*) FROM profiles WHERE notify_new_swims = true;      -- opted-in audience

-- ----------------------------------------------------------------
-- BACKUP — not required. Adds one function; writes only occur when the
-- event creator calls it, and are ordinary notification rows.
-- ----------------------------------------------------------------

-- ----------------------------------------------------------------
-- MIGRATION — applied only after Dave types "apply".
-- ----------------------------------------------------------------
BEGIN;

CREATE OR REPLACE FUNCTION public.notify_new_swim_v1(
  p_event_id uuid,
  p_title    text,
  p_message  text,
  p_payload  jsonb DEFAULT '{}'::jsonb
)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid   uuid := auth.uid();
  v_count int;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '28000';
  END IF;

  -- Abuse guard: caller must be the creator of an OPEN swim.
  IF NOT EXISTS (
    SELECT 1 FROM swim_events se
    WHERE se.id = p_event_id
      AND se.created_by = v_uid
      AND COALESCE(se.visibility, 'open') = 'open'
  ) THEN
    RAISE EXCEPTION 'not_event_creator_or_not_open' USING ERRCODE = '42501';
  END IF;

  INSERT INTO notifications
    (recipient_user_id, swim_event_id, type, title, message, payload, created_at)
  SELECT p.id, p_event_id, 'new_swim', p_title, p_message,
         COALESCE(p_payload, '{}'::jsonb), now()
  FROM profiles p
  WHERE p.notify_new_swims = true
    AND p.id <> v_uid;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

COMMENT ON FUNCTION public.notify_new_swim_v1(uuid, text, text, jsonb) IS
  'Fan out a "new swim posted" in-app notification to every profile with '
  'notify_new_swims=true (except the poster). SECURITY DEFINER to cross '
  'the profiles/notifications RLS boundaries; abuse-guarded to the OPEN '
  'swim''s own creator. Added 2026-07-21.';

REVOKE ALL ON FUNCTION public.notify_new_swim_v1(uuid, text, text, jsonb) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.notify_new_swim_v1(uuid, text, text, jsonb) TO authenticated;

COMMIT;

-- ----------------------------------------------------------------
-- ROLLBACK
-- ----------------------------------------------------------------
-- DROP FUNCTION IF EXISTS public.notify_new_swim_v1(uuid, text, text, jsonb);
-- Reverting returns new-swim in-app notifications to silently broken.

-- ----------------------------------------------------------------
-- VERIFY
-- ----------------------------------------------------------------
-- SELECT proname, prosecdef FROM pg_proc WHERE proname='notify_new_swim_v1';
--   -- expect: 1 row, prosecdef = true
-- (Behavioural verification done in a rolled-back transaction with
--  fixtures before apply — see session log.)
