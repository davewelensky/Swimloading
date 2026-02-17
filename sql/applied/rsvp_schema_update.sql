-- RSVP support for swim_participants
ALTER TABLE public.swim_participants
ADD COLUMN IF NOT EXISTS rsvp text NOT NULL DEFAULT 'going';

-- Add check constraint for rsvp column
ALTER TABLE public.swim_participants
DROP CONSTRAINT IF EXISTS swim_participants_rsvp_check;

ALTER TABLE public.swim_participants
ADD CONSTRAINT swim_participants_rsvp_check
CHECK (rsvp IN ('going', 'maybe'));

-- Update existing 'yes' data to 'going' if any
UPDATE public.swim_participants SET rsvp = 'going' WHERE rsvp = 'yes';
