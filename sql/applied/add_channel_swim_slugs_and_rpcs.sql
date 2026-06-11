-- Phase A — SEO-friendly slug column + lookup RPCs for individual swim pages
-- Applied via Supabase MCP migrations: add_channel_swim_slug_v2 + channel_fastest_returns_slug_v2

-- ALTER TABLE channel_solo_swims ADD COLUMN slug TEXT (unique)
-- Slug format: "firstname-lastname-year[-N]" where N handles same-year repeats
-- Example: "matthew-webb-1875", "alison-streeter-1983", "alison-streeter-1983-2"

-- RPCs added/updated:
--   get_channel_swim(p_key)         — fetch swim by slug OR unique_id
--   get_pilot_swims(...)            — pilot's other ratified crossings
--   get_swimmer_crossings(...)      — same swimmer's other crossings
-- Existing channel_fastest() + channel_search_swims() updated to return slug
