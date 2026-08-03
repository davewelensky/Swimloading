-- Global Swim Discovery — the review queue.
-- Read-only. Paste into the Supabase SQL editor:
--   https://supabase.com/dashboard/project/szgkzuswelntnevobnoh/sql/new
--
-- Sorted the way a reviewer would work it: strongest candidates first,
-- rejects last. dupe_warnings > 0 means the approval RPC will refuse
-- until those links are resolved.

SELECT
  c.publication_recommendation                        AS recommendation,
  c.confidence_score                                  AS score,
  c.canonical_name                                    AS event,
  to_char(c.start_date, 'DD Mon YYYY')                AS date,
  c.date_precision                                    AS precision,
  c.city,
  coalesce(c.raw_source_values->>'eventStatus', '—')  AS event_status,
  (SELECT count(*) FROM public.discovery_candidate_distances d
     WHERE d.candidate_id = c.id)                     AS distances,
  (SELECT count(*) FROM public.discovery_event_evidence e
     WHERE e.candidate_id = c.id)                     AS evidence,
  (SELECT count(*) FROM public.discovery_dedupe_links l
     WHERE l.candidate_id = c.id AND l.resolution = 'unresolved') AS dupe_warnings,
  c.candidate_status                                  AS review_state,
  c.promoted_edition_id                               AS published_as,
  c.id                                                AS candidate_id
FROM public.discovery_candidate_events c
ORDER BY
  array_position(
    ARRAY['high_confidence','manual_review','insufficient_evidence','rejected'],
    c.publication_recommendation),
  c.confidence_score DESC;


-- ── Why a specific candidate scored what it did ──────────────────────────
-- SELECT canonical_name, confidence_score,
--        jsonb_array_elements_text(confidence_reasons) AS reason
-- FROM public.discovery_candidate_events
-- WHERE canonical_name = 'Great Bay Swim Festival';

-- ── The evidence behind each proposed field ──────────────────────────────
-- SELECT e.field_name, e.evidence_type, e.selector_or_path, left(e.raw_snippet, 80) AS snippet
-- FROM public.discovery_event_evidence e
-- JOIN public.discovery_candidate_events c ON c.id = e.candidate_id
-- WHERE c.canonical_name = 'Great Bay Swim Festival'
-- ORDER BY e.field_name;

-- ── Unresolved duplicate pairs ───────────────────────────────────────────
-- SELECT a.canonical_name AS candidate, b.canonical_name AS matches,
--        l.similarity_score, l.matching_signals, l.conflicting_signals
-- FROM public.discovery_dedupe_links l
-- JOIN public.discovery_candidate_events a ON a.id = l.candidate_id
-- JOIN public.discovery_candidate_events b ON b.id = l.matching_candidate_id
-- WHERE l.resolution = 'unresolved';

-- ── What is actually PUBLISHED (empty until you approve something) ───────
-- SELECT s.display_name AS series, e.edition_year, e.start_date, e.status,
--        v.display_name AS venue, v.city,
--        (SELECT count(*) FROM public.event_distances d WHERE d.edition_id = e.id) AS distances
-- FROM public.event_editions e
-- JOIN public.event_series s ON s.id = e.series_id
-- LEFT JOIN public.event_venues v ON v.id = e.venue_id
-- ORDER BY e.start_date;
