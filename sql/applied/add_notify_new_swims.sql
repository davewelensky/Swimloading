-- Add opt-in column for new swim notifications
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS notify_new_swims BOOLEAN DEFAULT FALSE;

-- Add 'new_swim' to the notifications type CHECK constraint
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check
    CHECK (type = ANY (ARRAY[
        'swim_cancelled', 'approval_request', 'approval_granted',
        'approval_rejected', 'participant_late', 'new_signup',
        'spot_suggestion', 'swim_updated', 'rsvp_cancelled', 'new_swim'
    ]));
