-- ============================================================
-- fix_new_signup_notifications.sql
--
-- Problem: New swimmer notifications not reaching Dave.
-- Two root causes:
--   1. `is_admin` column may not be set TRUE for Dave
--      → JS path in saveOnboardingPersonal() queries
--        WHERE is_admin = true, finds nothing, sends 0 notifs
--   2. Old trigger fired on profiles INSERT (email confirmation)
--      → display_name is '' at that point, so COALESCE returns ''
--      → notification message says " just signed up" (blank name)
--
-- Fix:
--   1. Ensure is_admin = TRUE for Dave
--   2. Replace INSERT trigger with UPDATE trigger that fires when
--      onboarding_completed_at changes from NULL → a value.
--      At that point, full_name and display_name are already set.
--
-- Safe to re-run — idempotent.
-- ============================================================


-- ── DIAGNOSTIC (run this first to confirm the issues) ────────
/*
SELECT id, display_name, is_admin
FROM profiles
WHERE id = 'df137255-3add-4153-b368-32e06e2be188';

SELECT trigger_name, event_manipulation, event_object_table
FROM information_schema.triggers
WHERE trigger_name IN ('on_new_profile_created', 'on_onboarding_completed');

SELECT id, title, message, created_at
FROM notifications
WHERE type = 'new_signup'
ORDER BY created_at DESC LIMIT 10;

SELECT id, display_name, full_name, created_at, onboarding_completed_at
FROM profiles
ORDER BY created_at DESC LIMIT 10;
*/


-- ── 1. Ensure is_admin column exists and Dave is set ─────────
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS is_admin BOOLEAN DEFAULT FALSE;

UPDATE profiles
SET is_admin = TRUE
WHERE id = 'df137255-3add-4153-b368-32e06e2be188';


-- ── 2. Improved notify_new_signup() function ─────────────────
--      Fires on onboarding completion, not profile INSERT.
--      Uses real name (full_name > display_name > fallback).

CREATE OR REPLACE FUNCTION notify_new_signup()
RETURNS TRIGGER AS $$
DECLARE
    swimmer_name TEXT;
BEGIN
    -- Only fire when onboarding_completed_at goes NULL → a value
    IF TG_OP = 'UPDATE'
       AND OLD.onboarding_completed_at IS NULL
       AND NEW.onboarding_completed_at IS NOT NULL THEN

        swimmer_name := COALESCE(
            NULLIF(TRIM(NEW.full_name), ''),
            NULLIF(TRIM(NEW.display_name), ''),
            'A new swimmer'
        );

        INSERT INTO notifications (recipient_user_id, type, title, message)
        VALUES (
            'df137255-3add-4153-b368-32e06e2be188',
            'new_signup',
            '🏊 New swimmer joined!',
            swimmer_name || ' just joined SwimLoading'
        );
    END IF;
    RETURN NEW;
EXCEPTION WHEN OTHERS THEN
    -- Never block a profile update if notification fails
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- ── 3. Drop old INSERT trigger, create UPDATE trigger ────────
DROP TRIGGER IF EXISTS on_new_profile_created ON profiles;
DROP TRIGGER IF EXISTS on_onboarding_completed ON profiles;

CREATE TRIGGER on_onboarding_completed
    AFTER UPDATE OF onboarding_completed_at ON profiles
    FOR EACH ROW
    EXECUTE FUNCTION notify_new_signup();


-- ── 4. Verify ────────────────────────────────────────────────
SELECT trigger_name, event_manipulation, event_object_table
FROM information_schema.triggers
WHERE trigger_name = 'on_onboarding_completed';

-- Should return 1 row:
-- on_onboarding_completed | UPDATE | profiles

-- Also confirm Dave is admin:
SELECT id, display_name, is_admin
FROM profiles
WHERE id = 'df137255-3add-4153-b368-32e06e2be188';
