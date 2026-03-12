-- Add WhatsApp group/channel URL to spotlights
-- Run once in Supabase → SQL Editor

ALTER TABLE spotlights ADD COLUMN IF NOT EXISTS whatsapp_url text;
