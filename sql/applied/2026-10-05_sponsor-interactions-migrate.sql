-- ================================================================
-- SwimLoading — Migration Template
-- Copy this header into EVERY new migration file.
-- The safety block hard-fails if you are in the wrong project.
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
      '║                                                          ║\n'
      '║  This migration is for: SwimLoading                     ║\n'
      '║  Expected project ref:  szgkzuswelntnevobnoh            ║\n'
      '║                                                          ║\n'
      '║  You are connected to a DIFFERENT Supabase project.     ║\n'
      '║  No changes have been made. Check your browser URL.     ║\n'
      '╚══════════════════════════════════════════════════════════╝'
    USING HINT = 'Check the project ref in your Supabase dashboard URL';
  END IF;
  RAISE NOTICE '✅ Project identity confirmed: swimloading (szgkzuswelntnevobnoh)';
END $$;

-- ================================================================
-- Migration: 2026-10-05_sponsor-interactions-migrate.sql
-- Process:   see MIGRATIONS.md
-- ================================================================

-- Purpose:
--   Normalise the two legacy conversation stores on growth_sponsors into one
--   structured sponsor_interactions history, losing nothing:
--     conversation_log (used by /Sponsors): {date, direction, subject, body|summary, to|from}
--     conversations    (used by Growth Hub): {date, author, text}
--   Every entry is copied with its untouched original in `legacy`. The old columns are
--   NOT cleared or dropped (rollback + audit); code stops writing to them.
-- Requested by: Dave (approved plan 5 Oct 2026, stage 5 of 10). Requires migration
--   2026-10-05_sponsors-commercial-schema.sql to be applied first.

-- ----------------------------------------------------------------
-- PRE-CHECKS (read-only)
-- ----------------------------------------------------------------
-- SELECT sum(jsonb_array_length(coalesce(conversation_log,'[]'))) log_entries,
--        sum(jsonb_array_length(coalesce(conversations,'[]')))    conv_entries FROM growth_sponsors;   -- expect 29, 2
-- SELECT count(*) FROM sponsor_interactions;                                                              -- expect 0

-- ----------------------------------------------------------------
-- BACKUP — this migration only INSERTS into a new table and reads growth_sponsors;
-- it does not UPDATE/DELETE anything, and the source columns are left in place, so
-- the originals ARE the backup. No backup table required.
-- ----------------------------------------------------------------

BEGIN;

INSERT INTO public.sponsor_interactions
  (growth_sponsor_id, occurred_at, interaction_type, direction, is_draft, subject, body, counterpart, author, source, source_index, legacy)
SELECT s.id,
       (e.value ->> 'date')::timestamptz,
       CASE WHEN e.value ?| ARRAY['subject','to','from'] THEN 'email' ELSE NULL END,        -- only where the entry is evidently an email
       CASE WHEN e.value ->> 'direction' LIKE 'inbound%'  THEN 'inbound'
            WHEN e.value ->> 'direction' LIKE 'outbound%' THEN 'outbound' END,
       coalesce(e.value ->> 'direction', '') LIKE '%draft%',                                  -- outbound_draft / outbound_draft_revised
       e.value ->> 'subject',
       coalesce(e.value ->> 'body', e.value ->> 'summary'),
       coalesce(e.value ->> 'to', e.value ->> 'from'),
       NULL,                                                                                  -- author was never recorded in conversation_log
       'conversation_log',
       e.ordinality - 1,
       e.value
FROM public.growth_sponsors s
CROSS JOIN LATERAL jsonb_array_elements(coalesce(s.conversation_log, '[]'::jsonb)) WITH ORDINALITY AS e(value, ordinality)
ON CONFLICT (growth_sponsor_id, source, source_index) DO NOTHING;

INSERT INTO public.sponsor_interactions
  (growth_sponsor_id, occurred_at, interaction_type, direction, is_draft, subject, body, counterpart, author, source, source_index, legacy)
SELECT s.id,
       (e.value ->> 'date')::timestamptz,
       'note',
       NULL, false, NULL,
       e.value ->> 'text',
       NULL,
       e.value ->> 'author',
       'conversations',
       e.ordinality - 1,
       e.value
FROM public.growth_sponsors s
CROSS JOIN LATERAL jsonb_array_elements(coalesce(s.conversations, '[]'::jsonb)) WITH ORDINALITY AS e(value, ordinality)
ON CONFLICT (growth_sponsor_id, source, source_index) DO NOTHING;

COMMIT;

-- ----------------------------------------------------------------
-- ROLLBACK: the source columns were not modified, so this is lossless.
-- ----------------------------------------------------------------
-- DELETE FROM public.sponsor_interactions WHERE source IN ('conversation_log','conversations');

-- ----------------------------------------------------------------
-- VERIFY (read-only, after apply)
-- ----------------------------------------------------------------
-- SELECT source, count(*) FROM sponsor_interactions GROUP BY 1;                 -- expect conversation_log 29, conversations 2
-- SELECT count(*) FROM sponsor_interactions WHERE legacy IS NULL;               -- expect 0
-- SELECT count(*) FROM growth_sponsors s WHERE
--   jsonb_array_length(coalesce(conversation_log,'[]')) <> (SELECT count(*) FROM sponsor_interactions i WHERE i.growth_sponsor_id=s.id AND i.source='conversation_log')
--   OR jsonb_array_length(coalesce(conversations,'[]')) <> (SELECT count(*) FROM sponsor_interactions i WHERE i.growth_sponsor_id=s.id AND i.source='conversations');  -- expect 0
