-- ============================================================
-- fix_notify_new_swims_default.sql
--
-- Problem: notify_new_swims defaults to FALSE, so every new
-- user who joins gets silently opted out of new swim alerts.
--
-- Fix:
--   1. Change column default to TRUE (new signups auto opt-in)
--   2. Update handle_new_user() trigger to explicitly set TRUE
--      (belt-and-braces: works even if default is ever changed)
--
-- Safe to re-run — idempotent.
-- ============================================================


-- ── 1. Change column default ──────────────────────────────────
ALTER TABLE profiles ALTER COLUMN notify_new_swims SET DEFAULT TRUE;


-- ── 2. Update profile creation trigger to explicitly opt users in ──
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
    IF (TG_OP = 'UPDATE' AND OLD.email_confirmed_at IS NULL AND NEW.email_confirmed_at IS NOT NULL)
    OR (TG_OP = 'INSERT' AND NEW.email_confirmed_at IS NOT NULL) THEN
        INSERT INTO public.profiles (id, email, display_name, notify_new_swims)
        VALUES (NEW.id, NEW.email, '', TRUE)
        ON CONFLICT (id) DO NOTHING;
    END IF;
    RETURN NEW;
EXCEPTION WHEN OTHERS THEN
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger definition stays the same — just recreate to be safe
DROP TRIGGER IF EXISTS on_auth_user_confirmed ON auth.users;
CREATE TRIGGER on_auth_user_confirmed
    AFTER INSERT OR UPDATE OF email_confirmed_at ON auth.users
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_new_user();


-- ── 3. Verify ─────────────────────────────────────────────────
-- Run this after to confirm all confirmed users are opted in:
--
-- SELECT COUNT(*) FROM profiles WHERE notify_new_swims = FALSE;
-- Should be 0 (or very close — only users who explicitly opted out).
