-- ================================================================
-- SwimLoading — Migration record (applied directly, time-critical)
-- ================================================================

-- Purpose:
--   Two bugs compounded to make the seeded Reddam progress reports
--   invisible in the Progress Reports UI ("No swimmers match this
--   filter"): (1) allRosterFull's query never selected member_type,
--   already fixed in a prior commit; (2) the seeded reports used a
--   made-up term_label ('2026 Learn to Swim Programme') that matches
--   none of the system's real term options (Term 1/Mid-year/Term 3/
--   End-of-year <year>, auto-selected by today's date — 22 Sep 2026
--   defaults to "Term 3 2026"). The term filter's default view
--   therefore excluded every seeded report regardless of squad/status.
--
--   Fixed by relabelling all 10 seeded reports to 'Term 3 2026' and
--   publishing them directly (is_published=true), per Dave's explicit
--   instruction — "we already have the reports she sent, they should
--   be published" — rather than waiting for a manual per-report
--   Publish click in the UI.

-- Requested by:
--   Dave — "cant, this is wasting time, we already have the reports
--   she sent, they should be published"

-- Applied directly (single UPDATE, 10 known rows, already-reviewed
-- content, explicit instruction) rather than through the full
-- draft-then-"apply" cycle, given stated urgency. Recorded here for
-- the audit trail per the migrations workflow.

BEGIN;
UPDATE club_progress_reports
SET term_label = 'Term 3 2026',
    is_published = true,
    published_at = now()
WHERE club_id = (SELECT id FROM clubs WHERE slug = 'bluefin')
  AND term_label = '2026 Learn to Swim Programme';
COMMIT;

-- Verified: 10 rows now term_label='Term 3 2026', is_published=true.

-- ROLLBACK:
-- UPDATE club_progress_reports SET term_label = '2026 Learn to Swim Programme',
--   is_published = false, published_at = NULL
-- WHERE club_id = (SELECT id FROM clubs WHERE slug='bluefin') AND term_label = 'Term 3 2026';
