-- ============================================================
-- Fix email sync: profile INSERT trigger + fresh backfill
-- The previous trigger fired on auth.users INSERT, but the
-- profiles row doesn't exist yet at that point so the UPDATE
-- found nothing. This trigger fires when the profile is created.
-- Run once in Supabase → SQL Editor
-- ============================================================

-- 1. Trigger function: on profile INSERT, copy email from auth.users
CREATE OR REPLACE FUNCTION set_profile_email_on_insert()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF NEW.email IS NULL THEN
    SELECT email INTO NEW.email FROM auth.users WHERE id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

-- 2. Attach to profiles BEFORE INSERT
DROP TRIGGER IF EXISTS on_profile_insert_set_email ON public.profiles;
CREATE TRIGGER on_profile_insert_set_email
  BEFORE INSERT ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION set_profile_email_on_insert();

-- 3. Re-run backfill for any users whose email is still null
--    (catches everyone who signed up since the last backfill)
UPDATE public.profiles p
SET email = u.email
FROM auth.users u
WHERE p.id = u.id
  AND p.email IS NULL;
