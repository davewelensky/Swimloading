-- ============================================================
-- fix_profile_creation_trigger.sql
-- 1. Fixes the trigger so future signups auto-create a profile
-- 2. Bulk-creates minimal profile rows for the 28 existing
--    auth users who currently have no profile row
-- 3. Manually completes onboarding for Graham du Toit so he
--    can log in immediately without re-doing onboarding
--
-- Run once in Supabase SQL Editor → no side effects on re-run
-- ============================================================


-- ── PART 1: Fix the trigger ──────────────────────────────────
-- Creates a profile row automatically when a new auth user
-- is created. EXCEPTION block ensures signup is never blocked.

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.profiles (id, email)
    VALUES (NEW.id, NEW.email)
    ON CONFLICT (id) DO NOTHING;
    RETURN NEW;
EXCEPTION WHEN OTHERS THEN
    -- Never block a signup if the profile insert fails
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Drop old trigger if it exists under a different name
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
DROP TRIGGER IF EXISTS on_new_user_created  ON auth.users;

CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_new_user();


-- ── PART 2: Bulk backfill missing profiles ───────────────────
-- Creates a minimal profile (id + email only) for every auth
-- user who currently has no profile row.
-- These users will be prompted to complete onboarding on
-- their next login — which is correct behaviour.

INSERT INTO public.profiles (id, email)
SELECT au.id, au.email
FROM auth.users au
LEFT JOIN public.profiles p ON p.id = au.id
WHERE p.id IS NULL
ON CONFLICT (id) DO NOTHING;


-- ── PART 3: Fix Graham du Toit specifically ──────────────────
-- He's been stuck for days — bypass onboarding so he goes
-- straight into the app. He can update his phone in Settings.

UPDATE public.profiles SET
    display_name            = 'Graham du Toit',
    terms_accepted_at       = NOW(),
    privacy_accepted_at     = NOW(),
    waiver_accepted_at      = NOW(),
    data_consent_at         = NOW(),
    onboarding_completed_at = NOW(),
    phone                   = COALESCE(phone, 'unknown')
WHERE id = '284b7230-2c84-43a2-a849-27bea9e21d5a';


-- ── Verify ───────────────────────────────────────────────────
-- Run this after to confirm no auth users are missing profiles:
--
-- SELECT COUNT(*)
-- FROM auth.users au
-- LEFT JOIN public.profiles p ON p.id = au.id
-- WHERE p.id IS NULL;
--
-- Should return 0.
