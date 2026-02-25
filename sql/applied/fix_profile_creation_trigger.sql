-- ============================================================
-- fix_profile_creation_trigger.sql
-- 0. Deletes ghost profiles for unconfirmed email users
-- 1. Fixes trigger to fire on email confirmation, not signup
-- 2. Bulk-creates minimal profiles for confirmed users with no row
-- 3. Manually completes onboarding for Graham du Toit
--
-- Safe to re-run — all statements are idempotent
-- ============================================================


-- ── PART 0: Ghost profile cleanup (optional — commented out) ─
-- Uncomment if you want to remove empty profiles for users who
-- never confirmed their email. Leave commented to keep them so
-- display names can be filled in manually.
--
-- DELETE FROM public.profiles p
-- USING auth.users au
-- WHERE p.id = au.id
--   AND au.email_confirmed_at IS NULL
--   AND p.display_name = ''
--   AND p.terms_accepted_at IS NULL
--   AND p.onboarding_completed_at IS NULL;


-- ── PART 1: Fix the trigger ──────────────────────────────────
-- Creates a profile row when a user CONFIRMS their email,
-- not at signup. This prevents nameless ghost profiles for
-- users who sign up but never click the confirmation link.

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
    IF (TG_OP = 'UPDATE' AND OLD.email_confirmed_at IS NULL AND NEW.email_confirmed_at IS NOT NULL)
    OR (TG_OP = 'INSERT' AND NEW.email_confirmed_at IS NOT NULL) THEN
        INSERT INTO public.profiles (id, email, display_name)
        VALUES (NEW.id, NEW.email, '')
        ON CONFLICT (id) DO NOTHING;
    END IF;
    RETURN NEW;
EXCEPTION WHEN OTHERS THEN
    -- Never block auth operations if the profile insert fails
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Drop any old versions of this trigger
DROP TRIGGER IF EXISTS on_auth_user_created   ON auth.users;
DROP TRIGGER IF EXISTS on_new_user_created    ON auth.users;
DROP TRIGGER IF EXISTS on_auth_user_confirmed ON auth.users;

-- Fire on signup (for auto-confirmed providers) AND on email confirmation
CREATE TRIGGER on_auth_user_confirmed
    AFTER INSERT OR UPDATE OF email_confirmed_at ON auth.users
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_new_user();


-- ── PART 2: Backfill confirmed users with no profile ─────────
-- Creates a minimal profile for any auth user who confirmed
-- their email but still has no profile row.
-- They will complete onboarding on next login.

INSERT INTO public.profiles (id, email, display_name)
SELECT au.id, au.email, ''
FROM auth.users au
LEFT JOIN public.profiles p ON p.id = au.id
WHERE p.id IS NULL
  AND au.email_confirmed_at IS NOT NULL
ON CONFLICT (id) DO NOTHING;


-- ── PART 3: Fix Graham du Toit specifically ──────────────────
-- Bypass onboarding so he goes straight into the app.
-- He can update his phone number from Settings.

UPDATE public.profiles SET
    display_name            = 'Graham du Toit',
    terms_accepted_at       = NOW(),
    privacy_accepted_at     = NOW(),
    waiver_accepted_at      = NOW(),
    data_consent_at         = NOW(),
    onboarding_completed_at = NOW(),
    phone                   = COALESCE(NULLIF(phone, ''), 'unknown')
WHERE id = '284b7230-2c84-43a2-a849-27bea9e21d5a';


-- ── Verify ───────────────────────────────────────────────────
-- After running, confirm no confirmed users are missing profiles:
--
-- SELECT COUNT(*)
-- FROM auth.users au
-- LEFT JOIN public.profiles p ON p.id = au.id
-- WHERE p.id IS NULL AND au.email_confirmed_at IS NOT NULL;
--
-- Should return 0.
