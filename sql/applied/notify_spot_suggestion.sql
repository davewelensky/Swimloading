-- Notify admin when a new spot suggestion is submitted
-- Run in Supabase SQL Editor
-- Date: 2026-02-18

-- Add spot_suggestion to allowed notification types
ALTER TABLE notifications DROP CONSTRAINT notifications_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check
CHECK (type = ANY (ARRAY['swim_cancelled', 'approval_request', 'approval_granted', 'approval_rejected', 'participant_late', 'new_signup', 'spot_suggestion']));

-- Create trigger function
CREATE OR REPLACE FUNCTION notify_spot_suggestion()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO notifications (recipient_user_id, title, message, type)
    VALUES (
        'df137255-3add-4153-b368-32e06e2be188',
        '📍 New spot suggestion',
        COALESCE(NEW.spot_name, 'Unknown') || ' (' || COALESCE(NEW.water_type, '') || ') — ' || COALESCE(NEW.region, 'no region'),
        'spot_suggestion'
    );
    RETURN NEW;
EXCEPTION WHEN OTHERS THEN
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Attach trigger
DROP TRIGGER IF EXISTS on_new_spot_suggestion ON spot_suggestions;
CREATE TRIGGER on_new_spot_suggestion
    AFTER INSERT ON spot_suggestions
    FOR EACH ROW
    EXECUTE FUNCTION notify_spot_suggestion();
