-- ============================================================
-- Backfill email into profiles + trigger for new signups
-- Run once in Supabase → SQL Editor
-- ============================================================

-- 1. Add email column to profiles if it doesn't exist
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS email TEXT;

-- 2. Backfill email from auth.users for all existing users
UPDATE public.profiles p
SET email = u.email
FROM auth.users u
WHERE p.id = u.id AND p.email IS NULL;

-- 3. Function to auto-copy email on new signup
CREATE OR REPLACE FUNCTION copy_email_to_profile()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  UPDATE public.profiles SET email = NEW.email WHERE id = NEW.id;
  RETURN NEW;
END;
$$;

-- 4. Trigger on auth.users INSERT (fires after every new signup)
DROP TRIGGER IF EXISTS on_auth_user_created_copy_email ON auth.users;
CREATE TRIGGER on_auth_user_created_copy_email
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION copy_email_to_profile();
