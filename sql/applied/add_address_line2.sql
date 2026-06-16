-- ============================================================
-- Add address_line2 column to profiles
-- Run once in Supabase → SQL Editor
-- ============================================================

-- 1. Add address_line2 column (optional — unit/complex/apartment)
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS address_line2 TEXT;

-- 2. Manual data fix for Zastra Conway-nunn (id: 0482cb39-a1db-477f-bd8e-c60ce99254b8)
--    Her city was entered as the street address — fix it here or she can edit in-app
-- UPDATE public.profiles
-- SET address_line1 = '257 Main Road', address_line2 = 'Heath Court', city = 'Cape Town'
-- WHERE id = '0482cb39-a1db-477f-bd8e-c60ce99254b8';
-- (Uncomment and run after confirming with user, or let her fix via Profile Settings)
