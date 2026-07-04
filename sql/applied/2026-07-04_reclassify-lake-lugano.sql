-- Applied 2026-07-04 via supabase-admin (Dave requested).
-- Lake Lugano (Switzerland) was miscoded water_type='OCEAN' (an inland lake).
-- 1 row changed OCEAN -> LAKE. Rollback: set water_type='OCEAN' for the same id.
UPDATE public.spots SET water_type='LAKE'
WHERE id='ba68b7a2-574c-4d1b-b651-edbd498dfdf0' AND name='Lake Lugano' AND water_type='OCEAN';
