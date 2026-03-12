-- Add category and poster_url to swim_events for official races
-- Run once in Supabase → SQL Editor

ALTER TABLE swim_events
    ADD COLUMN IF NOT EXISTS category   text NOT NULL DEFAULT 'group_swim',
    ADD COLUMN IF NOT EXISTS poster_url text;

-- category values: 'group_swim' | 'official_race'
-- poster_url: public URL from Supabase Storage bucket 'event-posters'

-- Storage bucket for event posters (run in Supabase dashboard if needed)
-- insert into storage.buckets (id, name, public) values ('event-posters', 'event-posters', true);
