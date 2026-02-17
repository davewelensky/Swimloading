-- Add phone and emergency contact fields to profiles
-- Run this in Supabase → SQL Editor

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS phone TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS emergency_contact_name TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS emergency_contact_phone TEXT;
