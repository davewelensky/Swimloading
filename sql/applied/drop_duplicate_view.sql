-- Remove duplicate latest_spot_temps_active view
-- The app only uses latest_spot_temps — the _active version is a duplicate
-- Run in Supabase SQL Editor
-- Date: 2026-02-17

-- Check both views exist before dropping
-- SELECT viewname FROM pg_views WHERE viewname LIKE 'latest_spot%';

DROP VIEW IF EXISTS latest_spot_temps_active;
