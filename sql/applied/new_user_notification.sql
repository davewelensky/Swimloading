-- Notify admin (you) when a new user signs up
-- Run this in Supabase → SQL Editor

CREATE OR REPLACE FUNCTION notify_new_signup()
RETURNS TRIGGER AS $$
BEGIN
    -- Send notification to your user ID (Dave)
    INSERT INTO notifications (recipient_user_id, title, body)
    VALUES (
        'df137255-3add-4153-b368-32e06e2be188',
        '🏊 New swimmer joined!',
        COALESCE(NEW.display_name, 'Someone') || ' just signed up for SwimLoading'
    );
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Drop if exists (safe re-run)
DROP TRIGGER IF EXISTS on_new_profile_created ON profiles;

-- Fire when a new profile row is inserted
CREATE TRIGGER on_new_profile_created
    AFTER INSERT ON profiles
    FOR EACH ROW
    EXECUTE FUNCTION notify_new_signup();
