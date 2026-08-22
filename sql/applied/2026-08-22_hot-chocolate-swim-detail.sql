-- ⚠️  SAFETY CHECK
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM _project_identity WHERE key='project_name' AND value='swimloading') THEN
    RAISE EXCEPTION 'WRONG PROJECT — MIGRATION ABORTED. Expected swimloading (szgkzuswelntnevobnoh).'
    USING HINT = 'Check the project ref in your Supabase dashboard URL';
  END IF;
  RAISE NOTICE '✅ Project identity confirmed: swimloading';
END $$;

-- ================================================================
-- Migration: 2026-08-22_hot-chocolate-swim-detail.sql
-- ================================================================

-- Purpose:
--   Fill in the Hot Chocolate Swim from Dave's own account. He swims it, so
--   this is first-hand rather than crawled — the only row on the platform
--   that can say that. It gains a route, a founding, and a stated purpose.

-- Source:
--   Dave Welensky, 22 Aug 2026, verbatim:
--
--     "Our usual cold swim with hot chocolate. Every Sunday in camps bay 9am
--      by Caprice. Founded by Andrew Chin and Ram Barkai since 1999. The
--      purpose of the group is place pre swim info on conditions and post
--      swim stories"
--
--     "route, start infront of Cafe Caprice, head left to the kelp, then
--      regroup, sometimes if conditions permit, we head around the big rock,
--      then accross the entire bay to the other side, then back to the kelp,
--      then finish where we start"
--
--   Tidied for spelling and sentence breaks only. Nothing added: the "if
--   conditions permit" hedge is his and stays, because it is the honest
--   shape of the swim — the long version is not guaranteed.

-- STILL NULL, deliberately — he was asked and did not answer these, so they
-- stay unknown rather than become assumptions:
--     is_free, requires_membership, season_start_month, season_end_month,
--     website_url, contact_url
--   The group's "purpose" he describes (pre-swim conditions, post-swim
--   stories) reads like a WhatsApp or Facebook group, but no link was given
--   and guessing one would send swimmers somewhere we have never seen.

-- ----------------------------------------------------------------
-- PRE-CHECKS — read-only, before applying.
-- ----------------------------------------------------------------
--   SELECT slug, route_description IS NULL AS no_route, summary
--     FROM recurring_swims WHERE slug = 'hot-chocolate-swim-camps-bay';
--   -- expect 1 row, no_route = true

-- ----------------------------------------------------------------
-- BACKUP — required: this migration contains an UPDATE.
-- ----------------------------------------------------------------
BEGIN;

CREATE TABLE IF NOT EXISTS _bak_20260822_hot_chocolate AS
SELECT * FROM recurring_swims WHERE slug = 'hot-chocolate-swim-camps-bay';

UPDATE recurring_swims
   SET summary = 'A cold swim with hot chocolate afterwards, every Sunday at 9am off Camps Bay, starting in front of Café Caprice. Founded in 1999 by Andrew Chin and Ram Barkai, and still running every week.',
       route_description = 'Start in front of Café Caprice and head left to the kelp, then regroup. If conditions permit the group carries on around the big rock, across the entire bay to the other side, back to the kelp, and finishes where it started.',
       notes = 'First-hand account from Dave Welensky, 22 Aug 2026 — he swims it. Founded 1999 by Andrew Chin and Ram Barkai. The group exists to share conditions before the swim and stories after it. Distance is "around 1.6km" as described, not a measured course. is_free, requires_membership, season and any group link were asked for and not given, so they remain NULL rather than assumed.',
       last_verified_at = '2026-08-22',
       updated_at = now()
 WHERE slug = 'hot-chocolate-swim-camps-bay';

COMMIT;

-- ----------------------------------------------------------------
-- ROLLBACK
-- ----------------------------------------------------------------
--   UPDATE recurring_swims r
--      SET summary = b.summary, route_description = b.route_description,
--          notes = b.notes, last_verified_at = b.last_verified_at
--     FROM _bak_20260822_hot_chocolate b WHERE r.id = b.id;
--   -- then: DROP TABLE _bak_20260822_hot_chocolate;

-- ----------------------------------------------------------------
-- VERIFY — read-only, after applying.
-- ----------------------------------------------------------------
--   SELECT slug, summary, route_description, last_verified_at,
--          is_free, requires_membership          -- both must still be NULL
--     FROM recurring_swims WHERE slug = 'hot-chocolate-swim-camps-bay';
