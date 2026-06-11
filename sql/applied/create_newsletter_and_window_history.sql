-- Phase 3a — newsletter_subscribers table + channel_window_history RPC
-- Applied via Supabase MCP migrations:
--   create_newsletter_subscribers
--   add_channel_window_history_rpc

-- Table: public.newsletter_subscribers
--   email (lower-unique), source, country_code, tags, tide_window_start, 
--   tide_window_end, pilot, created_at, confirmed_at, unsubscribed_at
--   RLS: anon/authenticated can INSERT; no public SELECT

-- RPC: channel_window_history(start_month, start_day, end_month, end_day, from_year)
--   Returns: swims_count, fastest_seconds, fastest_name, fastest_year,
--            median_seconds, male_count, female_count, years_with_swims
--   Used by "Historically · This Week" card for personalised tide window
