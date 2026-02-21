-- Add 'hazard_alert' to notifications type CHECK constraint
-- Run in Supabase SQL Editor after hazard_reports.sql
-- Applied: 2026-02-21

ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check
    CHECK (type = ANY (ARRAY[
        'swim_cancelled', 'approval_request', 'approval_granted',
        'approval_rejected', 'participant_late', 'new_signup',
        'spot_suggestion', 'swim_updated', 'rsvp_cancelled', 'new_swim', 'hazard_alert'
    ]));
