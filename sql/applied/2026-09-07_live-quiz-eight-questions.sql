-- ================================================================
-- Migration: 2026-09-07_live-quiz-eight-questions.sql
-- APPLIED 2026-09-07 via supabase-admin MCP (Dave: "add the clifton
-- question and update the copy and make it 8 questions ... lets do this")
-- Recorded here after the fact per MIGRATIONS.md; data-only change on
-- rows created for the CLDSA event.
-- ================================================================

-- Purpose:
--   CLDSA quiz grows to 8 questions with a uniform 30s timer:
--   Q7 = "open the app, read Clifton 4th's live temp" (the SwimLoading
--   showcase moment; Dave verifies the correct letter against the app
--   ~30 min before the quiz on 10 Sep), Q8 = Dave's costume gag
--   (moved from sort 7, timer 15 -> 30). Event intro now says Eight.

-- Requested by:
--   Dave, 7 Sep 2026

-- ----------------------------------------------------------------
-- MIGRATION (as applied)
-- ----------------------------------------------------------------
BEGIN;
UPDATE live_quiz_questions SET sort_order = 8, time_limit_seconds = 30
 WHERE question LIKE 'Do you really need a costume%';
INSERT INTO live_quiz_questions (event_id, question, answer_a, answer_b, answer_c, answer_d, correct_answer, time_limit_seconds, sort_order, explanation)
SELECT id,
  'You''ve just joined SwimLoading. Open the app — what''s the water temperature at Clifton 4th right now?',
  'Under 10 °C', '10–12.9 °C', '13–15.9 °C', '16 °C or warmer',
  'C', 30, 7,
  'Live water temperatures for every Cape spot — that''s SwimLoading. Keep logging your swims and you''re in the running for the eo SwimBETTER90 giveaway.'
FROM live_quiz_events WHERE slug = 'cldsa2026';
UPDATE live_quiz_events SET intro = 'How well do you know your open water? Eight questions. One winner.' WHERE slug = 'cldsa2026';
COMMIT;

-- ----------------------------------------------------------------
-- ROLLBACK
-- ----------------------------------------------------------------
-- DELETE FROM live_quiz_questions WHERE question LIKE 'You''ve just joined SwimLoading%';
-- UPDATE live_quiz_questions SET sort_order = 7, time_limit_seconds = 15 WHERE question LIKE 'Do you really need a costume%';
-- UPDATE live_quiz_events SET intro = 'How well do you know your open water? Six questions. One winner.' WHERE slug = 'cldsa2026';

-- ----------------------------------------------------------------
-- VERIFY (ran 2026-09-07, read-only)
-- ----------------------------------------------------------------
-- SELECT sort_order, correct_answer, time_limit_seconds FROM live_quiz_questions ORDER BY sort_order;
--   -> 8 rows, all 30s: 1B 2C 3A 4D 5B 6C 7C 8A   (confirmed)
