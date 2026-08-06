-- ================================================================
-- SwimLoading — Migration
-- ================================================================

-- ⚠️  SAFETY CHECK — runs first, aborts everything if wrong project
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM _project_identity
    WHERE key = 'project_name' AND value = 'swimloading'
  ) THEN
    RAISE EXCEPTION
      E'\n\n'
      '╔══════════════════════════════════════════════════════════╗\n'
      '║  WRONG PROJECT — MIGRATION ABORTED                       ║\n'
      '║  This migration is for: SwimLoading                       ║\n'
      '║  Expected project ref:  szgkzuswelntnevobnoh              ║\n'
      '╚══════════════════════════════════════════════════════════╝'
    USING HINT = 'Check the project ref in your Supabase dashboard URL';
  END IF;
  RAISE NOTICE '✅ Project identity confirmed: swimloading (szgkzuswelntnevobnoh)';
END $$;

-- ================================================================
-- Migration: 2026-08-06_recover-january-first-dates.sql
-- Process:   see MIGRATIONS.md
-- ================================================================

-- Purpose:
--   Restore the real date of 134 candidates that were stored as 1 January
--   because the parser could not read their date format, then auto-retired
--   as "date_passed" — rejected for a date that never existed.
--
--   Whole countries were invisible because of this. Finland's federation
--   publishes a full calendar; all 47 of its events were filed on 1
--   January 2026 and retired. Same for 25 Dutch, 9 Austrian, 4 Mexican,
--   4 Argentinian and 3 U.S. Masters events.
--
--   Cause, fixed in the same ship (discovery-worker/src/normalize/date.ts):
--     * wholly numeric dates were never parsed — "3.10.2026" (Finland),
--       "23.05.2026" (Austria), "21/02/2026" (Argentina, Netherlands);
--     * month-first English dates were never parsed — "Sep. 19, 2026",
--       "August 30th, 2026", "March 6–8, 2026";
--     * and the year-only fallback marked its own failure dateConfirmed,
--       so an unread date was stored as fact. That branch now refuses,
--       which is what "an unconfirmed date is never stored" always meant.
--
--   Every date below was produced by running the FIXED parser over each
--   row's own stored original_date_text, with that source's registered
--   country deciding day-first vs month-first and refusing when it cannot
--   be told —  discovery-worker/scripts/replay-dates.ts --sql. No date
--   here was chosen by hand.
--
--   Two rows are deliberately NOT touched: OceanSwims.nz prints "Thursday,
--   1 January" with no year anywhere, and a missing year is never
--   inferred. They stay as they are.
--
--   Nothing was public: 0 of the 136 had ever published, so no swimmer was
--   shown a wrong date. This recovers events we already crawled and threw
--   away.

-- Requested by:
--   Dave

-- ----------------------------------------------------------------
-- PRE-CHECKS — run on the READ-ONLY connection BEFORE applying.
-- ----------------------------------------------------------------

-- 1. Expect 136 candidates dated 1 January; 134 in the list below.
-- SELECT count(*) FROM discovery_candidate_events
--  WHERE start_date IS NOT NULL
--    AND extract(month FROM start_date)=1 AND extract(day FROM start_date)=1;

-- 2. Expect 134 rejected / 134 auto-retired as date_passed, 0 published.
--    If any is published, STOP: a wrong date is live and this is the wrong
--    tool for that.
-- SELECT candidate_status, count(*),
--        count(*) FILTER (WHERE promoted_edition_id IS NOT NULL) AS published
--   FROM discovery_candidate_events
--  WHERE extract(month FROM start_date)=1 AND extract(day FROM start_date)=1
--  GROUP BY candidate_status;

-- 3. Every id below is currently dated 1 January. Expect 134.
--    A mismatch means the replay output is stale — re-run it, do not edit
--    this file by hand.

-- ----------------------------------------------------------------
-- BACKUP — required: this is an UPDATE.
-- ----------------------------------------------------------------
-- CREATE TABLE _bak_20260806_jan1_dates AS
--   SELECT id, start_date, end_date, date_precision, date_confirmed,
--          candidate_status, last_reviewed_at, original_date_text
--     FROM discovery_candidate_events
--    WHERE start_date IS NOT NULL
--      AND extract(month FROM start_date)=1 AND extract(day FROM start_date)=1;

-- ----------------------------------------------------------------
-- MIGRATION — applied only after Dave types "apply".
-- ----------------------------------------------------------------
BEGIN;

CREATE TEMP TABLE _date_fix (candidate_id uuid PRIMARY KEY, start_date date, end_date date)
  ON COMMIT DROP;

INSERT INTO _date_fix (candidate_id, start_date, end_date) VALUES
  ('0007398d-ea46-42a8-afac-40f74cecc556'::uuid, '2026-08-08'::date, NULL),
  ('021bbc60-961e-494e-ad64-82efc0a815d3'::uuid, '2026-09-19'::date, '2026-09-20'::date),
  ('038e60ee-dbc4-4b73-a9af-60dd7181e2c9'::uuid, '2026-09-09'::date, NULL),
  ('04fda4df-93bb-4158-887d-e5f4c0b65b09'::uuid, '2026-09-18'::date, '2027-02-14'::date),
  ('05503dee-8a38-4337-9760-62252eb2c8bd'::uuid, '2026-06-13'::date, NULL),
  ('076029e8-a3d2-4e29-823a-8c569278e0a2'::uuid, '2026-09-13'::date, NULL),
  ('0ab35c6b-225e-41d3-8a42-a6afc108fdae'::uuid, '2026-08-12'::date, '2027-04-18'::date),
  ('15d775c2-bdce-4700-87cb-3a6a8f600bb8'::uuid, '2026-08-11'::date, NULL),
  ('15f95b1e-e2af-416f-b481-ade7555359f9'::uuid, '2026-10-10'::date, NULL),
  ('18e1c0a7-b7d9-46e2-9916-fca96161f103'::uuid, '2026-08-05'::date, NULL),
  ('1d33be7d-f2eb-4fe1-a05f-9c35aec6dcd6'::uuid, '2026-08-08'::date, NULL),
  ('1ddd476e-9d39-4e76-86c9-228568a79e30'::uuid, '2026-09-12'::date, NULL),
  ('1e8440e2-a0ca-4db7-9a8d-2c0cc41697bd'::uuid, '2026-07-10'::date, NULL),
  ('22dc369b-18c8-451c-a488-263e5525072f'::uuid, '2026-08-12'::date, NULL),
  ('22e98e59-e093-4491-bfc0-299c27625548'::uuid, '2026-03-05'::date, NULL),
  ('2580ff1f-e645-4c0e-bbce-ce008148119d'::uuid, '2026-08-09'::date, NULL),
  ('25fa4e44-283f-4096-a57b-87e4948f2764'::uuid, '2026-04-18'::date, NULL),
  ('26f68e52-5d9e-4806-abaa-2a3435eb6a67'::uuid, '2026-01-31'::date, NULL),
  ('274fec20-905d-4f97-8adf-aaf68800ddc7'::uuid, '2026-10-10'::date, NULL),
  ('282e159f-3a09-4a53-8cef-bff3410c0e29'::uuid, '2026-09-05'::date, NULL),
  ('28374376-e027-4e3a-8bdf-a6b49f2a443f'::uuid, '2026-08-05'::date, NULL),
  ('28659aaa-288c-453e-8fd3-dc75943140f0'::uuid, '2026-02-14'::date, NULL),
  ('28a5a9a9-8e47-4f73-b64d-4ef1d0d09897'::uuid, '2026-08-05'::date, NULL),
  ('2aa0c5f0-29d7-4ddb-8984-f18a2e69a520'::uuid, '2026-08-09'::date, NULL),
  ('2ebf1328-db1b-4e93-b99c-bc41c5632af0'::uuid, '2026-03-14'::date, NULL),
  ('311cbee3-fb37-4c2c-926f-c60a78aa8ef5'::uuid, '2026-03-29'::date, NULL),
  ('32a43346-6022-4cb1-a145-2f20458659dc'::uuid, '2026-08-11'::date, NULL),
  ('33989cda-acfd-462b-a7d8-3c5984854194'::uuid, '2026-09-11'::date, '2026-10-25'::date),
  ('3687e1ef-d665-4366-b9c6-e4257e68e6d1'::uuid, '2026-08-10'::date, NULL),
  ('37b492ff-bf13-4cd9-b37f-138a0e8681a8'::uuid, '2027-02-27'::date, NULL),
  ('3b1b575c-dd33-4caf-822a-ba6a44fd39b5'::uuid, '2026-08-08'::date, NULL),
  ('3ca46f71-8046-4584-bb7d-8e4e2c8ff606'::uuid, '2026-09-26'::date, '2026-09-27'::date),
  ('3d53e8c1-6d53-4722-adf7-bfd245d9589a'::uuid, '2026-08-08'::date, '2026-08-09'::date),
  ('41116c35-e5d0-498a-b9fe-3089b69f46cb'::uuid, '2026-03-21'::date, NULL),
  ('4216b414-3b60-4bc3-97a0-32e190669211'::uuid, '2026-08-22'::date, '2026-10-31'::date),
  ('42c60312-840e-4224-af20-97cb81b9f0b9'::uuid, '2026-08-08'::date, NULL),
  ('449a9c89-d891-4ebf-bc71-278496585a78'::uuid, '2026-08-08'::date, NULL),
  ('456fd268-51f1-43ff-b889-0b162590f493'::uuid, '2026-05-24'::date, NULL),
  ('48373a08-7c70-41da-87f0-d145402af261'::uuid, '2026-08-09'::date, NULL),
  ('4a0b14e6-9dba-4eee-be2f-a22390300579'::uuid, '2026-10-10'::date, NULL),
  ('4b00d9a2-8b64-4b97-9133-e876cc56ecaa'::uuid, '2026-10-09'::date, '2026-10-11'::date),
  ('4ed74930-39d8-44f6-8a83-33a5dea1f32c'::uuid, '2026-05-23'::date, NULL),
  ('4eedec79-fb56-425d-b27e-8d76aee2b017'::uuid, '2026-01-10'::date, NULL),
  ('4f99e56d-57e2-4352-a1f3-15dccfd8b167'::uuid, '2026-04-12'::date, NULL),
  ('5094ae8e-dba2-478d-8079-0ce94be1125e'::uuid, '2026-08-08'::date, NULL),
  ('5784fe6e-2668-4eca-beb4-2f0756db94d9'::uuid, '2026-08-12'::date, NULL),
  ('58b4f00b-aa26-4fe1-bb1e-e08b9a01c68c'::uuid, '2026-01-11'::date, NULL),
  ('599b40a4-5e19-4c46-b6bd-bd1d6386ae3c'::uuid, '2026-06-06'::date, NULL),
  ('5bae164a-ee19-41c7-9fb0-74963dc9523d'::uuid, '2026-10-10'::date, NULL),
  ('5c98529c-2ddf-460d-b725-cde0e78f2477'::uuid, '2026-01-17'::date, NULL),
  ('5efd0793-54a5-4d0a-8785-f4900b9baafc'::uuid, '2026-08-12'::date, NULL),
  ('60d279f9-80bb-4272-95dd-66513e6e5b94'::uuid, '2026-02-21'::date, NULL),
  ('633c7bd6-df7e-49e9-a0d5-6694ba7c82b1'::uuid, '2026-09-05'::date, '2026-09-06'::date),
  ('641657d5-60bd-4bd8-87fa-07778aa79f9a'::uuid, '2014-01-01'::date, '2014-12-31'::date),
  ('669851ff-b05f-4c77-96b6-02ce9edae41d'::uuid, '2026-08-05'::date, NULL),
  ('67bba999-ad47-453a-b90c-6332ef4c0e82'::uuid, '2026-03-22'::date, NULL),
  ('6801722f-61a2-4087-95a0-f5d614ffc111'::uuid, '2026-08-11'::date, NULL),
  ('717fb41b-da6a-4fb5-9569-f40898092ad8'::uuid, '2026-08-08'::date, NULL),
  ('73665cee-dd6b-48eb-9709-c31f460bc189'::uuid, '2026-02-22'::date, NULL),
  ('763659c5-5111-4a7b-83bd-7c903dfc3db0'::uuid, '2026-08-22'::date, '2026-10-04'::date),
  ('796d362c-c8de-4f81-959e-8ff374c552e7'::uuid, '2026-03-06'::date, NULL),
  ('798bae65-ded6-46c6-86c9-9b13ac02a943'::uuid, '2026-08-08'::date, NULL),
  ('79a4a392-1858-4f56-9cd9-16be5b8823ba'::uuid, '2026-08-30'::date, NULL),
  ('7dff4d5e-4d11-472d-9a2f-e311d2965d4f'::uuid, '2026-08-16'::date, NULL),
  ('7fbd6231-9de6-43ee-8319-0640b5a44537'::uuid, '2026-10-10'::date, NULL),
  ('8121762c-1ebc-48c7-aa38-853888aa10d7'::uuid, '2026-08-09'::date, NULL),
  ('81ace56c-9e81-4fba-990d-38b453e7d331'::uuid, '2026-06-20'::date, NULL),
  ('8503132b-8f15-4455-bd01-7543e8c4c3c1'::uuid, '2026-10-03'::date, NULL),
  ('85993c99-b81e-43d6-b687-288ca7e779e5'::uuid, '2026-09-12'::date, NULL),
  ('88877ccb-27f5-40b1-bb14-866afc20e434'::uuid, '2026-08-11'::date, NULL),
  ('88fd9c7c-4d39-4def-a305-581d47645f78'::uuid, '2026-03-21'::date, NULL),
  ('8ab8acbf-6426-4123-8b19-2df36e1b4ac6'::uuid, '2026-02-08'::date, NULL),
  ('8c7b9761-06f8-4821-b878-347cd1785c3c'::uuid, '2026-09-19'::date, NULL),
  ('8e46de3f-c65e-4293-a2a5-e93f42fd5a07'::uuid, '2026-09-17'::date, NULL),
  ('8f72ff54-5602-44a2-89e6-413225b12715'::uuid, '2026-10-03'::date, NULL),
  ('8fb64421-4d46-4e32-9c48-ea43b06615c4'::uuid, '2026-08-12'::date, NULL),
  ('9017811f-ed1c-4b22-82f6-827f1664846f'::uuid, '2026-08-15'::date, NULL),
  ('90615527-8fb5-4fc9-850d-bd5e217ea62b'::uuid, '2026-05-01'::date, NULL),
  ('9249695b-d1fe-457e-b3e3-67244a81790a'::uuid, '2026-09-26'::date, NULL),
  ('934832ea-cfda-412b-80eb-25f673e3c74d'::uuid, '2026-04-12'::date, NULL),
  ('9a2199a0-5dbb-49b8-ae2b-cb893de2c0cb'::uuid, '2026-02-21'::date, NULL),
  ('9d068548-c1f5-4dfa-b814-f3c12559aa23'::uuid, '2026-11-14'::date, NULL),
  ('9d35655f-aa87-4cf5-8139-312b93ac8ba4'::uuid, '2026-08-12'::date, NULL),
  ('9e12ff2b-9dbd-4cee-afc0-f3065a95694e'::uuid, '2026-08-12'::date, NULL),
  ('9e5879c2-0df3-48ee-822d-7f36f3560ed2'::uuid, '2026-09-19'::date, NULL),
  ('9e7becb2-5911-40b8-b6a7-592d95522a6f'::uuid, '2026-10-09'::date, '2026-10-10'::date),
  ('a221f9d3-389a-4611-8a8f-04a9c42122d1'::uuid, '2026-05-23'::date, NULL),
  ('a2e4adfc-8fac-464f-970c-c2d8f20f4e0d'::uuid, '2026-03-21'::date, NULL),
  ('a50449e5-ced5-4dfc-987f-b3511f1f0ff8'::uuid, '2026-08-08'::date, NULL),
  ('a59e0f1e-70f8-4be8-94e3-7b49d6907734'::uuid, '2026-08-08'::date, NULL),
  ('a5ef9045-7dd8-48a6-aafb-6947d1d56db0'::uuid, '2026-03-06'::date, '2026-03-08'::date),
  ('a601622d-0abf-4197-9eff-3c8d4e3af048'::uuid, '2026-01-24'::date, NULL),
  ('a7daf352-9fdf-4a2c-bbe9-0cc170eeca52'::uuid, '2026-08-12'::date, NULL),
  ('a88adee9-739c-49c0-80cb-994d1fc49df3'::uuid, '2027-05-29'::date, NULL),
  ('a9bc89d0-ac91-4487-a15e-21f89b78a31d'::uuid, '2026-08-12'::date, NULL),
  ('af7eb918-254a-45d5-879d-9c31c5ffe4af'::uuid, '2026-08-15'::date, NULL),
  ('afaf0e49-f8dd-464a-b9d4-5723bf6484a8'::uuid, '2026-02-21'::date, NULL),
  ('b505a253-bdd7-438d-b098-fab42eee3a76'::uuid, '2026-02-22'::date, NULL),
  ('bd205681-1caa-4ad7-a0ce-8caf23ed3ce3'::uuid, '2026-10-10'::date, NULL),
  ('c04aab08-4ae5-4b48-8465-0aa6311f9296'::uuid, '2026-10-10'::date, NULL),
  ('c1d60957-3424-4d78-96c9-fc935210f6b7'::uuid, '2026-09-26'::date, NULL),
  ('c3827b93-6a61-486a-8ac0-758b8240afdd'::uuid, '2026-01-24'::date, NULL),
  ('c535733c-b29c-4bb9-8076-45a6fdd2c93e'::uuid, '2026-08-15'::date, NULL),
  ('c606e798-b20b-44db-bdde-fbb52f040043'::uuid, '2026-09-19'::date, NULL),
  ('c6721bb2-88bb-43b3-b48b-de42dbdf70d7'::uuid, '2026-11-15'::date, NULL),
  ('cdb3b461-db84-470c-9a00-705a13d26605'::uuid, '2026-01-31'::date, NULL),
  ('cdccd00f-b449-4651-8951-51491cb7a15d'::uuid, '2026-08-16'::date, NULL),
  ('d1adddeb-6fb0-4422-bde2-f81e46c4a900'::uuid, '2026-01-24'::date, NULL),
  ('d45d4e69-a061-406a-9df0-1d9244a94e5a'::uuid, '2026-04-19'::date, NULL),
  ('d556b9c4-fb83-4e65-801e-9deee5ffc231'::uuid, '2026-09-19'::date, NULL),
  ('d5c8df9f-c2ce-4c2c-a109-92113bb7670d'::uuid, '2026-10-03'::date, NULL),
  ('d771e052-f454-4e83-9449-08fc5a810696'::uuid, '2026-06-27'::date, NULL),
  ('de559fe5-35cc-4131-b492-b061beb02b2d'::uuid, '2026-09-12'::date, NULL),
  ('de9d3d26-7346-4a05-9ab1-5e5397a767d5'::uuid, '2026-08-12'::date, NULL),
  ('e0aa5c99-a4ff-4dc6-a527-be1780cac258'::uuid, '2026-08-08'::date, NULL),
  ('e1b41496-90ca-49e3-8835-aa608cd4e789'::uuid, '2026-02-21'::date, NULL),
  ('e295f933-3005-4986-bc88-0bfe104e67bd'::uuid, '2026-02-08'::date, NULL),
  ('e417a7d8-3fc7-40bb-9dde-d0a50440a151'::uuid, '2026-02-17'::date, NULL),
  ('e60b43d1-3981-4fce-8154-c0658076f6b3'::uuid, '2026-08-12'::date, '2026-08-16'::date),
  ('e6938063-2776-4cde-b19e-308891482fc0'::uuid, '2026-09-19'::date, NULL),
  ('ec4e3601-7040-41c8-ac82-ed0c3a62d83f'::uuid, '2026-08-08'::date, NULL),
  ('ecf7c35f-b694-407b-b1d1-977808cca78a'::uuid, '2026-05-23'::date, NULL),
  ('eff4e81b-ee02-41df-a3d5-171d6bf94d50'::uuid, '2026-03-22'::date, NULL),
  ('f047b774-342a-4350-aff3-4b5c2cfaa6cc'::uuid, '2026-01-17'::date, NULL),
  ('f05027c3-e800-46a1-9f02-aad470defb13'::uuid, '2026-04-04'::date, NULL),
  ('f16a4799-d368-4773-b8f8-cc2ec221ff82'::uuid, '2026-03-28'::date, NULL),
  ('f91fa230-2dc5-4fc2-840d-434367804527'::uuid, '2026-10-18'::date, NULL),
  ('fac06ffc-c6b9-40e8-88f9-5f63782e0285'::uuid, '2026-08-10'::date, '2026-08-16'::date),
  ('fc1e8fbd-283d-4760-9b28-48af675b46ba'::uuid, '2026-09-26'::date, NULL),
  ('fcea987f-2ca1-44fb-adc8-aee53060a653'::uuid, '2026-08-08'::date, NULL),
  ('fcec5275-837f-43d1-97c6-d86de7729351'::uuid, '2026-10-03'::date, NULL),
  ('ff5bb108-8d54-4ba3-b1f7-ad91d710f657'::uuid, '2026-03-15'::date, NULL),
  ('ff9a006f-8f5e-4f27-8f19-fab3207249f4'::uuid, '2026-09-26'::date, NULL),
  ('ffe0aa50-ead5-4f1b-954b-c02cdaf7be52'::uuid, '2026-08-16'::date, NULL);

-- 1. The dates themselves. Guarded on the 1-January signature so this
--    cannot overwrite a date that has since been corrected by any other
--    route, and is safe to re-run.
UPDATE discovery_candidate_events c
   SET start_date  = f.start_date,
       end_date    = f.end_date,
       date_precision = CASE WHEN f.end_date IS NOT NULL THEN 'range' ELSE 'exact' END,
       updated_at  = now()
  FROM _date_fix f
 WHERE c.id = f.candidate_id
   AND extract(month FROM c.start_date) = 1
   AND extract(day FROM c.start_date) = 1;

-- 2. Un-retire the ones that are actually still to come. They were
--    rejected by retire_past_candidates for a date that was never real,
--    so returning them to the queue is undoing our own error, not
--    overruling a human — every one of these decisions has decided_by
--    NULL. A genuinely past event stays rejected, now for a true reason.
INSERT INTO discovery_review_decisions
  (candidate_id, decision, decided_by, notes, previous_status, new_status, metadata)
SELECT c.id, 'returned_for_review', NULL,
       'Returned to the queue: this was retired as "date_passed" on a date that did not exist. '
       'Its real date was unreadable by the parser and stored as 1 January; it has now been '
       'recovered from the source text and is still upcoming.',
       'rejected', 'pending',
       jsonb_build_object('automatic', true, 'reason', 'date_recovered')
  FROM discovery_candidate_events c
  JOIN _date_fix f ON f.candidate_id = c.id
 WHERE c.candidate_status = 'rejected'
   AND c.start_date >= current_date;

UPDATE discovery_candidate_events c
   SET candidate_status = 'pending', last_reviewed_at = now()
  FROM _date_fix f
 WHERE c.id = f.candidate_id
   AND c.candidate_status = 'rejected'
   AND c.start_date >= current_date;

COMMIT;

-- ----------------------------------------------------------------
-- ROLLBACK
-- ----------------------------------------------------------------
-- UPDATE discovery_candidate_events c
--    SET start_date = b.start_date, end_date = b.end_date,
--        date_precision = b.date_precision, date_confirmed = b.date_confirmed,
--        candidate_status = b.candidate_status, last_reviewed_at = b.last_reviewed_at
--   FROM _bak_20260806_jan1_dates b WHERE b.id = c.id;
-- DELETE FROM discovery_review_decisions WHERE metadata->>'reason' = 'date_recovered';

-- ----------------------------------------------------------------
-- VERIFY — read-only, after applying.
-- ----------------------------------------------------------------

-- 1. Only the 2 genuinely-yearless OceanSwims.nz rows remain on 1 January.
-- SELECT count(*) FROM discovery_candidate_events
--  WHERE extract(month FROM start_date)=1 AND extract(day FROM start_date)=1;
--   expected 2

-- 2. The recovered upcoming events are back in the queue, by country.
-- SELECT s.country_code, count(*) FROM discovery_candidate_events c
--   JOIN discovery_sources s ON s.id = c.source_id
--  WHERE c.candidate_status = 'pending' AND c.start_date >= current_date
--    AND EXISTS (SELECT 1 FROM discovery_review_decisions d
--                WHERE d.candidate_id = c.id AND d.metadata->>'reason'='date_recovered')
--  GROUP BY s.country_code ORDER BY count(*) DESC;

-- 3. No date landed in the past by accident.
-- SELECT count(*) FROM discovery_candidate_events c JOIN _bak_20260806_jan1_dates b ON b.id=c.id
--  WHERE c.candidate_status='pending' AND c.start_date < current_date;
--   expected 0
