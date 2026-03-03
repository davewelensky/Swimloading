-- ============================================
-- Add home_domain to profiles
-- Allows users to personalise their dashboard feed to their home region.
-- Nullable FK — existing users get null until they set it via the one-time prompt.
-- Run in Supabase SQL Editor BEFORE deploying JS changes.
-- ============================================

ALTER TABLE profiles
    ADD COLUMN IF NOT EXISTS home_domain TEXT REFERENCES domains(code);
