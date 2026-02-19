-- Swim re-confirm flow: when host changes significant details,
-- accepted swimmers are moved to pending_reconfirm and must re-confirm.

-- 1. Add needs_reconfirm flag to swim_participants
ALTER TABLE swim_participants ADD COLUMN IF NOT EXISTS needs_reconfirm BOOLEAN DEFAULT FALSE;

-- 2. Add change_summary to swim_events so we can show what changed
ALTER TABLE swim_events ADD COLUMN IF NOT EXISTS last_change_summary TEXT;
