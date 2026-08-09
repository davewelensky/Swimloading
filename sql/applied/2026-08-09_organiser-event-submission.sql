-- ================================================================
-- SwimLoading — Migration (schema + data; MIGRATIONS.md applies)
-- ================================================================

DO $safety$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM _project_identity WHERE key='project_name' AND value='swimloading') THEN
    RAISE EXCEPTION E'\n WRONG PROJECT — MIGRATION ABORTED. Expected swimloading / szgkzuswelntnevobnoh';
  END IF;
END $safety$;

-- ================================================================
-- Migration: 2026-08-09_organiser-event-submission.sql
-- STATUS:    APPLIED 2026-08-09. Verified: anon can EXECUTE the function and
--            cannot INSERT, SELECT or approve; source row created disabled;
--            past dates, junk URLs and resubmissions all behave. The
--            COALESCE block below was a correction made DURING that
--            verification — see its comment.
-- ================================================================

-- Purpose:
--   Let an organiser add their own swim, without an account, from a public
--   form at /list-your-swim.
--
--   WHY. Every event in the catalogue today was crawled. Crawling is how
--   you bootstrap a catalogue and not how you grow one: 2026-08-06 was
--   spent finding six sources by hand for roughly forty events, while
--   Ahotu reached 60,000 by letting organisers add their own, free,
--   because listing is worth more to an organiser than it costs them.
--   Their organiser page is one sentence long — "All you have to do is
--   create an organiser account and you can start adding your events."
--
--   THE DESIGN, in one line: a submitted swim is just another candidate.
--   It lands in discovery_candidate_events exactly as a crawled one does,
--   so it inherits the whole existing pipeline — the review queue, dedupe
--   against events we already hold, the classifier, and
--   approve_discovery_candidate with all of its guards. Nothing here can
--   publish anything. A stranger fills in a form and Dave still decides.
--
--   That reuse is the point. A separate "submissions" table would have
--   needed its own review UI, its own dedupe, its own path to
--   event_editions, and would eventually have disagreed with the crawler's
--   version of the same rules. There is one queue.
--
--   WHAT IS DELIBERATELY NOT HERE. No account, no login, no email
--   verification. Every one of those is friction in front of someone doing
--   us a favour, and none of them is load-bearing, because the review
--   queue is the actual gate. If spam becomes real, the answer is a
--   tightened rate limit or a captcha — not making honest organisers
--   register first.

-- Requested by:
--   Dave, 2026-08-09.

-- ----------------------------------------------------------------
-- PRE-CHECKS — run on the READ-ONLY connection BEFORE applying.
-- ----------------------------------------------------------------

-- 1. 'organiser' is not yet an allowed extraction_method. Expect the four
--    crawler values plus 'none', and no 'organiser'.
-- SELECT pg_get_constraintdef(oid) FROM pg_constraint
--  WHERE conrelid='discovery_candidate_events'::regclass
--    AND conname='discovery_candidate_events_extraction_method_check';

-- 2. The submissions source does not exist yet. Expect 0.
-- SELECT count(*) FROM discovery_sources WHERE base_url = 'https://www.swimloading.com/list-your-swim';

-- 3. No function of this name exists yet. Expect 0.
-- SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
--  WHERE n.nspname='public' AND p.proname='submit_organiser_event';

-- ----------------------------------------------------------------
-- BACKUP — not required: adds an enum value, one source row and one
-- function. Rollback drops exactly those.
-- ----------------------------------------------------------------

-- ----------------------------------------------------------------
-- MIGRATION — applied only after Dave types "apply".
-- ----------------------------------------------------------------
BEGIN;

-- 1. A submitted row was not extracted from anything, and saying it was
--    'none' would lose the distinction that matters most about it: a human
--    who runs the event typed it. That is better provenance than any
--    crawl, and the review queue should be able to see it at a glance.
ALTER TABLE discovery_candidate_events
  DROP CONSTRAINT discovery_candidate_events_extraction_method_check;
ALTER TABLE discovery_candidate_events
  ADD CONSTRAINT discovery_candidate_events_extraction_method_check
  CHECK (extraction_method = ANY (ARRAY[
    'jsonld', 'html', 'jsonld+html', 'ai_fallback', 'none', 'organiser'
  ]));

-- 2. Submissions need a source row like anything else, so the review queue
--    groups them and every existing query keeps working unchanged.
INSERT INTO discovery_sources
  (name, base_url, source_type, authority_level, country_code, language_codes,
   parser_type, crawl_frequency, enabled, next_run_at, notes)
SELECT 'Organiser submissions — /list-your-swim',
       'https://www.swimloading.com/list-your-swim',
       'organiser', 5, NULL, ARRAY['en'], 'manual', 'monthly',
       -- enabled=false: there is nothing to crawl. This row exists to give
       -- submissions a source_id and a name in the review queue. Leaving it
       -- enabled would put a form page into the crawl rotation forever.
       false, NULL,
       'Not a crawled source. Submissions from the public form at '
       '/list-your-swim land here via submit_organiser_event(). authority_level 5: '
       'the person who runs the event is the best authority there is on it, which is '
       'why these arrive as manual_review rather than insufficient_evidence. They '
       'still go through the same review queue and the same approve RPC as anything '
       'crawled — a submission publishes nothing by itself.'
 WHERE NOT EXISTS (
   SELECT 1 FROM discovery_sources WHERE base_url = 'https://www.swimloading.com/list-your-swim'
 );

-- 3. The submission entry point.
CREATE OR REPLACE FUNCTION public.submit_organiser_event(
  p_event_name       text,
  p_start_date       date,
  p_location_text    text,
  p_official_url     text,
  p_organiser_name   text,
  p_contact_email    text,
  p_end_date         date DEFAULT NULL,
  p_country_code     text DEFAULT NULL,
  p_registration_url text DEFAULT NULL,
  p_distances_text   text DEFAULT NULL,
  p_notes            text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_source_id uuid;
  v_key       text;
  v_id        uuid;
  v_recent    integer;
  v_name      text := nullif(btrim(p_event_name), '');
  v_org       text := nullif(btrim(p_organiser_name), '');
  v_email     text := lower(nullif(btrim(p_contact_email), ''));
  v_loc       text := nullif(btrim(p_location_text), '');
  v_url       text := nullif(btrim(p_official_url), '');
BEGIN
  -- Validation. Everything here is a fact about the submission itself, not
  -- a judgement about the event — judging is the review queue's job, and
  -- doing it twice in two places is how the two come to disagree.
  IF v_name IS NULL OR length(v_name) < 3 THEN
    RAISE EXCEPTION 'Please give the swim a name.' USING ERRCODE = 'check_violation';
  END IF;
  IF length(v_name) > 200 THEN
    RAISE EXCEPTION 'That name is too long — 200 characters maximum.' USING ERRCODE = 'check_violation';
  END IF;
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'Please tell us who organises the swim.' USING ERRCODE = 'check_violation';
  END IF;
  IF v_email IS NULL OR v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[a-z]{2,}$' THEN
    RAISE EXCEPTION 'Please give a contact email we can reach you on.' USING ERRCODE = 'check_violation';
  END IF;
  IF v_loc IS NULL THEN
    RAISE EXCEPTION 'Please say where the swim takes place.' USING ERRCODE = 'check_violation';
  END IF;
  IF v_url IS NULL OR v_url !~* '^https?://[^[:space:]]+\.[^[:space:]]+' THEN
    RAISE EXCEPTION 'Please give the web address of the swim, starting with https://'
      USING ERRCODE = 'check_violation';
  END IF;

  -- A date is not optional here, unlike a crawl. A person filling in a
  -- form knows when their own swim is; an unconfirmed date is never
  -- stored, so a submission without one could never publish and would just
  -- sit in the queue.
  IF p_start_date IS NULL THEN
    RAISE EXCEPTION 'Please give the date of the swim.' USING ERRCODE = 'check_violation';
  END IF;
  IF p_start_date < current_date THEN
    RAISE EXCEPTION 'That date has already passed. Submit the next edition instead.'
      USING ERRCODE = 'check_violation';
  END IF;
  IF p_start_date > current_date + interval '4 years' THEN
    RAISE EXCEPTION 'That date is more than four years away — please check it.'
      USING ERRCODE = 'check_violation';
  END IF;
  IF p_end_date IS NOT NULL AND p_end_date < p_start_date THEN
    RAISE EXCEPTION 'The end date is before the start date.' USING ERRCODE = 'check_violation';
  END IF;
  IF p_country_code IS NOT NULL AND p_country_code !~ '^[A-Za-z]{2}$' THEN
    RAISE EXCEPTION 'Country must be a two-letter code.' USING ERRCODE = 'check_violation';
  END IF;

  SELECT id INTO v_source_id FROM discovery_sources
   WHERE base_url = 'https://www.swimloading.com/list-your-swim';
  IF v_source_id IS NULL THEN
    RAISE EXCEPTION 'Submissions are not configured. Please email support@swimloading.com.';
  END IF;

  -- Rate limit. Generous on purpose: a series organiser legitimately adds
  -- eight events in one sitting, and the review queue is the real defence.
  -- This exists to stop a script, not to ration honest use.
  SELECT count(*) INTO v_recent FROM discovery_candidate_events
   WHERE source_id = v_source_id
     AND raw_source_values->>'contactEmail' = v_email
     AND created_at > now() - interval '1 hour';
  IF v_recent >= 20 THEN
    RAISE EXCEPTION 'That is a lot of swims in one hour. Email support@swimloading.com and we will add them for you.'
      USING ERRCODE = 'check_violation';
  END IF;

  -- Same identity rule the crawler uses: name + date + source URL. A
  -- resubmission of the same swim updates rather than duplicates, so an
  -- organiser correcting a typo does not create a second listing.
  v_key := md5(lower(regexp_replace(v_name, '[^a-zA-Z0-9]+', ' ', 'g')) || '|' ||
               p_start_date::text || '|' || lower(v_url));

  INSERT INTO discovery_candidate_events (
    candidate_key, source_id, source_url, official_url, registration_url,
    canonical_name, original_name, organiser_name, location_text, country_code,
    start_date, end_date, date_precision, date_confirmed,
    candidate_status, extraction_method, confidence_score,
    publication_recommendation, confidence_reasons, warnings, raw_source_values
  ) VALUES (
    v_key, v_source_id, v_url, v_url, nullif(btrim(p_registration_url), ''),
    v_name, v_name, v_org, v_loc, upper(nullif(btrim(p_country_code), '')),
    p_start_date, p_end_date,
    CASE WHEN p_end_date IS NOT NULL THEN 'range' ELSE 'exact' END, true,
    'pending', 'organiser', 60,
    -- manual_review, never high_confidence. The organiser is the best
    -- authority on their own swim AND an unverified stranger to us; both
    -- are true, and a human still looks at it.
    'manual_review',
    jsonb_build_array('+30 submitted by the organiser', '+15 exact date given', '+15 official URL given'),
    jsonb_build_array('Submitted through /list-your-swim by ' || v_org ||
                      ' — not verified against the organiser''s own site. Check the URL before publishing.'),
    jsonb_build_object('contactEmail', v_email, 'distancesText', nullif(btrim(p_distances_text), ''),
                       'submitterNotes', nullif(btrim(p_notes), ''), 'submittedAt', now())
  )
  -- COALESCE, not bare EXCLUDED. A resubmission that omits an optional
  -- field must not DELETE what was there. The first version of this used
  -- EXCLUDED directly and the end-to-end test caught it: resubmitting with
  -- a corrected location wiped country_code ('ZA' -> null) and the
  -- distances, turning "fix my typo" into silent data loss. NULL now means
  -- "no change"; clearing a field is a support request, and losing one
  -- silently is not a trade worth making.
  ON CONFLICT (source_id, candidate_key) DO UPDATE SET
    location_text    = COALESCE(EXCLUDED.location_text,    discovery_candidate_events.location_text),
    country_code     = COALESCE(EXCLUDED.country_code,     discovery_candidate_events.country_code),
    end_date         = COALESCE(EXCLUDED.end_date,         discovery_candidate_events.end_date),
    registration_url = COALESCE(EXCLUDED.registration_url, discovery_candidate_events.registration_url),
    organiser_name   = COALESCE(EXCLUDED.organiser_name,   discovery_candidate_events.organiser_name),
    raw_source_values = discovery_candidate_events.raw_source_values || jsonb_strip_nulls(EXCLUDED.raw_source_values),
    updated_at = now()
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$fn$;

COMMENT ON FUNCTION public.submit_organiser_event IS
  'Public entry point for /list-your-swim. Writes ONE pending candidate into the '
  'existing review queue — it cannot publish, approve, or reach event_editions. '
  'SECURITY DEFINER because anon has no rights on discovery_candidate_events and '
  'must not be given any; every field it can set is an explicit parameter.';

REVOKE ALL ON FUNCTION public.submit_organiser_event FROM public;
GRANT EXECUTE ON FUNCTION public.submit_organiser_event TO anon, authenticated;

COMMIT;

-- ----------------------------------------------------------------
-- ROLLBACK
-- ----------------------------------------------------------------
-- DROP FUNCTION IF EXISTS public.submit_organiser_event(text,date,text,text,text,text,date,text,text,text,text);
-- DELETE FROM discovery_candidate_events WHERE extraction_method = 'organiser';
-- DELETE FROM discovery_sources WHERE base_url = 'https://www.swimloading.com/list-your-swim';
-- ALTER TABLE discovery_candidate_events DROP CONSTRAINT discovery_candidate_events_extraction_method_check;
-- ALTER TABLE discovery_candidate_events ADD CONSTRAINT discovery_candidate_events_extraction_method_check
--   CHECK (extraction_method = ANY (ARRAY['jsonld','html','jsonld+html','ai_fallback','none']));

-- ----------------------------------------------------------------
-- VERIFY — read-only, after applying.
-- ----------------------------------------------------------------

-- 1. The source exists and is DISABLED (nothing to crawl). Expect 1 row, enabled=false.
-- SELECT name, enabled, source_type, authority_level FROM discovery_sources
--  WHERE base_url = 'https://www.swimloading.com/list-your-swim';

-- 2. anon can execute the function and nothing else. Expect true, then false.
-- SELECT has_function_privilege('anon', 'public.submit_organiser_event(text,date,text,text,text,text,date,text,text,text,text)', 'EXECUTE');
-- SELECT has_table_privilege('anon', 'discovery_candidate_events', 'INSERT');
--   (has_function_privilege, not information_schema.routine_privileges — that
--    under-reports grants and made a working permission look missing on 4 Aug.)

-- 3. A submission lands as pending and CANNOT be published without review.
-- SELECT candidate_status, extraction_method, publication_recommendation, date_confirmed
--   FROM discovery_candidate_events WHERE extraction_method='organiser';
--   expected: pending / organiser / manual_review / true
