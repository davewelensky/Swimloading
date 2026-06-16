-- Fix swim_events_category_check constraint to include 'official_race'
-- NOT VALID skips checking existing rows — only new inserts/updates are validated
-- Run in Supabase → SQL Editor

ALTER TABLE swim_events
    DROP CONSTRAINT IF EXISTS swim_events_category_check;

ALTER TABLE swim_events
    ADD CONSTRAINT swim_events_category_check
    CHECK (category IN ('group_swim', 'official_race')) NOT VALID;
