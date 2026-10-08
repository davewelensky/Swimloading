-- ================================================================
-- SwimLoading — Migration Template
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
-- Migration: 2026-10-08_test-programme-engine.sql
-- Process:   see MIGRATIONS.md
-- ================================================================

-- Purpose:
--   A generic partner product-testing engine (programmes, products, sessions,
--   per-product observations, market signals) plus the first programme:
--   Jaked x Carina Bruwer. The engine is partner-neutral; only the seed rows
--   at the bottom are Jaked-specific. All data is private to programme members.

-- Requested by:
--   Dave

-- ----------------------------------------------------------------
-- PRE-CHECKS — read-only, run BEFORE applying.
-- ----------------------------------------------------------------
-- None of these names may exist yet (expect 0 rows):
--   SELECT table_name FROM information_schema.tables
--    WHERE table_schema = 'public' AND table_name LIKE 'test\_%';
-- Both participants must exist as auth users (expect 2 rows):
--   SELECT id FROM auth.users WHERE id IN
--     ('df137255-3add-4153-b368-32e06e2be188','cff2fc33-4a55-451b-8c7f-20f12c1898ce');

-- ----------------------------------------------------------------
-- BACKUP — not required: this migration only CREATES new tables and
-- INSERTS seed rows. It contains no UPDATE / DELETE / DROP / TRUNCATE
-- against existing data and touches no existing table or policy.
-- ----------------------------------------------------------------

-- ----------------------------------------------------------------
-- MIGRATION — applied only after Dave types "apply".
-- ----------------------------------------------------------------
BEGIN;

-- ── Programmes ──────────────────────────────────────────────────
CREATE TABLE public.test_programs (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug         text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9-]{2,60}$'),
  title        text NOT NULL,
  partner_name text NOT NULL,
  athlete_name text NOT NULL,
  status       text NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','complete')),
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- Membership drives every RLS policy below. 'admin' may publish findings and
-- delete; 'athlete' may log and edit. No FK to auth.users on purpose (matches
-- the project's existing pattern for participant ids).
CREATE TABLE public.test_program_members (
  program_id uuid NOT NULL REFERENCES public.test_programs(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL,
  role       text NOT NULL CHECK (role IN ('admin','athlete')),
  PRIMARY KEY (program_id, user_id)
);

-- ── Products ────────────────────────────────────────────────────
CREATE TABLE public.test_products (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  program_id  uuid NOT NULL REFERENCES public.test_programs(id) ON DELETE CASCADE,
  name        text NOT NULL,
  group_label text,                         -- e.g. five costumes share one garage card
  category    text NOT NULL CHECK (category IN
                ('wetsuit','training_swimwear','goggles','cap','racing_swimwear','other')),
  model_name  text,                         -- only filled once the partner confirms it
  received_on date,
  status      text NOT NULL DEFAULT 'not_started' CHECK (status IN
                ('not_started','available','early_testing','active_testing',
                 'long_term_testing','test_complete','awaiting_product')),
  is_reference boolean NOT NULL DEFAULT false,   -- a comparison product that is not the partner's
  sort_order  int NOT NULL DEFAULT 0,
  notes       text CHECK (notes IS NULL OR char_length(notes) <= 1000),
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (program_id, name),
  UNIQUE (id, program_id)
);

-- ── Sessions: the swim is the event ─────────────────────────────
CREATE TABLE public.test_sessions (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  program_id          uuid NOT NULL REFERENCES public.test_programs(id) ON DELETE CASCADE,
  created_by          uuid NOT NULL DEFAULT auth.uid(),
  session_date        date,                 -- nullable: a first impression can be logged before the real date is entered
  location            text CHECK (location IS NULL OR char_length(location) <= 120),
  environment         text CHECK (environment IN ('pool','sea','lake')),
  session_kind        text NOT NULL DEFAULT 'training' CHECK (session_kind IN ('training','event','controlled_test')),
  distance_km         numeric(6,2) CHECK (distance_km IS NULL OR (distance_km >= 0 AND distance_km <= 200)),
  duration_seconds    int CHECK (duration_seconds IS NULL OR (duration_seconds > 0 AND duration_seconds <= 172800)),
  water_temp_c        numeric(4,1) CHECK (water_temp_c IS NULL OR (water_temp_c >= -2 AND water_temp_c <= 40)),
  air_temp_c          numeric(4,1) CHECK (air_temp_c IS NULL OR (air_temp_c >= -20 AND air_temp_c <= 55)),
  conditions          text CHECK (conditions IN ('flat','light_chop','choppy','rough')),
  wind                text CHECK (wind IN ('none','light','moderate','strong')),
  avg_pace_sec_per_100m int CHECK (avg_pace_sec_per_100m IS NULL OR (avg_pace_sec_per_100m BETWEEN 30 AND 600)),
  avg_hr              int CHECK (avg_hr IS NULL OR (avg_hr BETWEEN 30 AND 230)),
  avg_stroke_rate     numeric(4,1) CHECK (avg_stroke_rate IS NULL OR (avg_stroke_rate BETWEEN 10 AND 150)),
  rpe                 smallint CHECK (rpe IS NULL OR (rpe BETWEEN 1 AND 10)),
  strava_import_id    uuid REFERENCES public.strava_imports(id) ON DELETE SET NULL,
  comparison_group_id uuid,                 -- sessions sharing this id form one controlled comparison
  athlete_note        text CHECK (athlete_note IS NULL OR char_length(athlete_note) <= 2000),
  partner_note        text CHECK (partner_note IS NULL OR char_length(partner_note) <= 2000),
  vs_expectation      text CHECK (vs_expectation IN ('worse','as_expected','better')),
  confidence          text CHECK (confidence IN ('low','medium','high')),
  data_status         text NOT NULL DEFAULT 'partial' CHECK (data_status IN ('partial','complete')),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, program_id)
);

-- Products used in a session. One swim, many products, no duplicated swim rows.
CREATE TABLE public.test_session_products (
  session_id    uuid NOT NULL,
  product_id    uuid NOT NULL,
  program_id    uuid NOT NULL,
  report_mode   text NOT NULL DEFAULT 'report' CHECK (report_mode IN ('no_change','report')),
  usage_km      numeric(6,2) CHECK (usage_km IS NULL OR (usage_km >= 0 AND usage_km <= 200)),
  usage_seconds int CHECK (usage_seconds IS NULL OR (usage_seconds > 0 AND usage_seconds <= 172800)),
  PRIMARY KEY (session_id, product_id),
  FOREIGN KEY (session_id, program_id) REFERENCES public.test_sessions(id, program_id) ON DELETE CASCADE,
  FOREIGN KEY (product_id, program_id) REFERENCES public.test_products(id, program_id) ON DELETE CASCADE
);

-- Per-product observations. Criteria are category-specific and defined in the
-- app, so a new category or question never needs a schema change.
CREATE TABLE public.test_observations (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  program_id uuid NOT NULL,
  session_id uuid NOT NULL,
  product_id uuid NOT NULL,
  kind       text NOT NULL CHECK (kind IN ('rating','issue','note')),
  criterion  text NOT NULL CHECK (criterion ~ '^[a-z0-9_]{2,40}$'),
  score      smallint CHECK (score IS NULL OR score BETWEEN 1 AND 5),
  note       text CHECK (note IS NULL OR char_length(note) <= 1000),
  visibility text NOT NULL DEFAULT 'private' CHECK (visibility IN ('private','publishable')),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((kind = 'rating' AND score IS NOT NULL) OR (kind <> 'rating' AND score IS NULL)),
  FOREIGN KEY (session_id, product_id) REFERENCES public.test_session_products(session_id, product_id) ON DELETE CASCADE,
  FOREIGN KEY (session_id, program_id) REFERENCES public.test_sessions(id, program_id) ON DELETE CASCADE
);
-- one rating / issue per criterion per product per session; notes may repeat
CREATE UNIQUE INDEX test_observations_one_per_criterion
  ON public.test_observations (session_id, product_id, kind, criterion) WHERE kind <> 'note';

-- ── Market evidence: kept apart from product evidence ───────────
CREATE TABLE public.test_market_signals (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  program_id  uuid NOT NULL,
  product_id  uuid,
  signal_date date NOT NULL DEFAULT (now() AT TIME ZONE 'Africa/Johannesburg')::date,
  signal_type text NOT NULL CHECK (signal_type IN
                ('page_views','product_enquiry','direct_question','where_to_buy',
                 'sizing_question','interest_registration','club_enquiry')),
  count       int NOT NULL DEFAULT 1 CHECK (count BETWEEN 1 AND 100000),
  channel     text CHECK (channel IS NULL OR char_length(channel) <= 80),
  note        text CHECK (note IS NULL OR char_length(note) <= 1000),
  recorded_by uuid NOT NULL DEFAULT auth.uid(),
  created_at  timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (program_id) REFERENCES public.test_programs(id) ON DELETE CASCADE,
  FOREIGN KEY (product_id, program_id) REFERENCES public.test_products(id, program_id) ON DELETE CASCADE
);

CREATE INDEX test_sessions_program_date ON public.test_sessions (program_id, session_date DESC);
CREATE INDEX test_observations_product ON public.test_observations (product_id);
CREATE INDEX test_market_signals_program ON public.test_market_signals (program_id, signal_date DESC);

-- updated_at on sessions (plain trigger, not SECURITY DEFINER)
CREATE FUNCTION public.test_touch_updated_at() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END $$;
CREATE TRIGGER test_sessions_touch BEFORE UPDATE ON public.test_sessions
  FOR EACH ROW EXECUTE FUNCTION public.test_touch_updated_at();

-- ── Privileges: signed-in only. anon gets nothing. ──────────────
REVOKE ALL ON public.test_programs, public.test_program_members, public.test_products,
              public.test_sessions, public.test_session_products,
              public.test_observations, public.test_market_signals FROM anon, public;
GRANT SELECT ON public.test_programs, public.test_program_members TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.test_products, public.test_sessions,
              public.test_session_products, public.test_observations,
              public.test_market_signals TO authenticated;

-- ── RLS: only members of a programme can touch its rows ─────────
ALTER TABLE public.test_programs         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.test_program_members  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.test_products         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.test_sessions         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.test_session_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.test_observations     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.test_market_signals   ENABLE ROW LEVEL SECURITY;

-- members see their own membership rows only (also what the other policies' subqueries read)
CREATE POLICY tpm_read_own ON public.test_program_members FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));

CREATE POLICY tp_read ON public.test_programs FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.test_program_members m
                 WHERE m.program_id = test_programs.id AND m.user_id = (SELECT auth.uid())));

-- products: members read; admins manage the garage
CREATE POLICY tprod_read ON public.test_products FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.test_program_members m
                 WHERE m.program_id = test_products.program_id AND m.user_id = (SELECT auth.uid())));
CREATE POLICY tprod_admin_write ON public.test_products FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.test_program_members m
                 WHERE m.program_id = test_products.program_id AND m.user_id = (SELECT auth.uid()) AND m.role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM public.test_program_members m
                 WHERE m.program_id = test_products.program_id AND m.user_id = (SELECT auth.uid()) AND m.role = 'admin'));

-- sessions: members read / insert / update; admins delete
CREATE POLICY tsess_read ON public.test_sessions FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.test_program_members m
                 WHERE m.program_id = test_sessions.program_id AND m.user_id = (SELECT auth.uid())));
CREATE POLICY tsess_insert ON public.test_sessions FOR INSERT TO authenticated
  WITH CHECK (created_by = (SELECT auth.uid()) AND EXISTS (SELECT 1 FROM public.test_program_members m
                 WHERE m.program_id = test_sessions.program_id AND m.user_id = (SELECT auth.uid())));
CREATE POLICY tsess_update ON public.test_sessions FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.test_program_members m
                 WHERE m.program_id = test_sessions.program_id AND m.user_id = (SELECT auth.uid())))
  WITH CHECK (EXISTS (SELECT 1 FROM public.test_program_members m
                 WHERE m.program_id = test_sessions.program_id AND m.user_id = (SELECT auth.uid())));
CREATE POLICY tsess_delete ON public.test_sessions FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.test_program_members m
                 WHERE m.program_id = test_sessions.program_id AND m.user_id = (SELECT auth.uid()) AND m.role = 'admin'));

-- session products: members read / write
CREATE POLICY tsp_member_all ON public.test_session_products FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.test_program_members m
                 WHERE m.program_id = test_session_products.program_id AND m.user_id = (SELECT auth.uid())))
  WITH CHECK (EXISTS (SELECT 1 FROM public.test_program_members m
                 WHERE m.program_id = test_session_products.program_id AND m.user_id = (SELECT auth.uid())));

-- observations: members read and write PRIVATE rows; only an admin may set or keep 'publishable'
CREATE POLICY tobs_read ON public.test_observations FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.test_program_members m
                 WHERE m.program_id = test_observations.program_id AND m.user_id = (SELECT auth.uid())));
CREATE POLICY tobs_insert ON public.test_observations FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.test_program_members m
            WHERE m.program_id = test_observations.program_id AND m.user_id = (SELECT auth.uid()))
    AND (visibility = 'private' OR EXISTS (SELECT 1 FROM public.test_program_members a
            WHERE a.program_id = test_observations.program_id AND a.user_id = (SELECT auth.uid()) AND a.role = 'admin')));
CREATE POLICY tobs_update ON public.test_observations FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.test_program_members m
                 WHERE m.program_id = test_observations.program_id AND m.user_id = (SELECT auth.uid())))
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.test_program_members m
            WHERE m.program_id = test_observations.program_id AND m.user_id = (SELECT auth.uid()))
    AND (visibility = 'private' OR EXISTS (SELECT 1 FROM public.test_program_members a
            WHERE a.program_id = test_observations.program_id AND a.user_id = (SELECT auth.uid()) AND a.role = 'admin')));
CREATE POLICY tobs_delete ON public.test_observations FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.test_program_members m
                 WHERE m.program_id = test_observations.program_id AND m.user_id = (SELECT auth.uid())));

-- market signals: members read / insert / update; admins delete
CREATE POLICY tms_read ON public.test_market_signals FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.test_program_members m
                 WHERE m.program_id = test_market_signals.program_id AND m.user_id = (SELECT auth.uid())));
CREATE POLICY tms_insert ON public.test_market_signals FOR INSERT TO authenticated
  WITH CHECK (recorded_by = (SELECT auth.uid()) AND EXISTS (SELECT 1 FROM public.test_program_members m
                 WHERE m.program_id = test_market_signals.program_id AND m.user_id = (SELECT auth.uid())));
CREATE POLICY tms_update ON public.test_market_signals FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.test_program_members m
                 WHERE m.program_id = test_market_signals.program_id AND m.user_id = (SELECT auth.uid())))
  WITH CHECK (EXISTS (SELECT 1 FROM public.test_program_members m
                 WHERE m.program_id = test_market_signals.program_id AND m.user_id = (SELECT auth.uid())));
CREATE POLICY tms_delete ON public.test_market_signals FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.test_program_members m
                 WHERE m.program_id = test_market_signals.program_id AND m.user_id = (SELECT auth.uid()) AND m.role = 'admin'));

-- ── Atomic save: one swim + its products + their observations ───
-- SECURITY INVOKER on purpose: it runs as the caller, so every RLS policy above still applies
-- (unlike a SECURITY DEFINER function, it cannot be used to bypass them). All-or-nothing: if any
-- row is rejected, nothing is saved, so a failed save never leaves an orphan session behind.
-- Editing (p_session_id set) replaces the session's products and observations; replaced observations
-- come back as 'private' so nothing an admin published stays published after an edit.
CREATE FUNCTION public.test_save_session(p_program uuid, p_session_id uuid, p_session jsonb, p_products jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE sid uuid; prod jsonb; obs jsonb;
BEGIN
  IF jsonb_typeof(p_products) IS DISTINCT FROM 'array' OR jsonb_array_length(p_products) = 0 THEN
    RAISE EXCEPTION 'A session needs at least one product';
  END IF;

  IF p_session_id IS NULL THEN
    INSERT INTO test_sessions (program_id, session_date, location, environment, session_kind, distance_km, duration_seconds,
      water_temp_c, air_temp_c, conditions, wind, avg_pace_sec_per_100m, avg_hr, avg_stroke_rate, rpe, strava_import_id,
      comparison_group_id, athlete_note, partner_note, vs_expectation, confidence, data_status)
    VALUES (p_program, nullif(p_session->>'session_date','')::date, nullif(p_session->>'location',''), nullif(p_session->>'environment',''),
      coalesce(nullif(p_session->>'session_kind',''),'training'), nullif(p_session->>'distance_km','')::numeric,
      nullif(p_session->>'duration_seconds','')::int, nullif(p_session->>'water_temp_c','')::numeric, nullif(p_session->>'air_temp_c','')::numeric,
      nullif(p_session->>'conditions',''), nullif(p_session->>'wind',''), nullif(p_session->>'avg_pace_sec_per_100m','')::int,
      nullif(p_session->>'avg_hr','')::int, nullif(p_session->>'avg_stroke_rate','')::numeric, nullif(p_session->>'rpe','')::smallint,
      nullif(p_session->>'strava_import_id','')::uuid, nullif(p_session->>'comparison_group_id','')::uuid,
      nullif(p_session->>'athlete_note',''), nullif(p_session->>'partner_note',''), nullif(p_session->>'vs_expectation',''),
      nullif(p_session->>'confidence',''), coalesce(nullif(p_session->>'data_status',''),'partial'))
    RETURNING id INTO sid;
  ELSE
    UPDATE test_sessions SET
      session_date = nullif(p_session->>'session_date','')::date, location = nullif(p_session->>'location',''),
      environment = nullif(p_session->>'environment',''), session_kind = coalesce(nullif(p_session->>'session_kind',''),'training'),
      distance_km = nullif(p_session->>'distance_km','')::numeric, duration_seconds = nullif(p_session->>'duration_seconds','')::int,
      water_temp_c = nullif(p_session->>'water_temp_c','')::numeric, air_temp_c = nullif(p_session->>'air_temp_c','')::numeric,
      conditions = nullif(p_session->>'conditions',''), wind = nullif(p_session->>'wind',''),
      avg_pace_sec_per_100m = nullif(p_session->>'avg_pace_sec_per_100m','')::int, avg_hr = nullif(p_session->>'avg_hr','')::int,
      avg_stroke_rate = nullif(p_session->>'avg_stroke_rate','')::numeric, rpe = nullif(p_session->>'rpe','')::smallint,
      strava_import_id = nullif(p_session->>'strava_import_id','')::uuid, comparison_group_id = nullif(p_session->>'comparison_group_id','')::uuid,
      athlete_note = nullif(p_session->>'athlete_note',''), partner_note = nullif(p_session->>'partner_note',''),
      vs_expectation = nullif(p_session->>'vs_expectation',''), confidence = nullif(p_session->>'confidence',''),
      data_status = coalesce(nullif(p_session->>'data_status',''),'partial')
    WHERE id = p_session_id AND program_id = p_program
    RETURNING id INTO sid;
    IF sid IS NULL THEN RAISE EXCEPTION 'Session not found'; END IF;
    DELETE FROM test_session_products WHERE session_id = sid;   -- cascades to its observations
  END IF;

  FOR prod IN SELECT * FROM jsonb_array_elements(p_products) LOOP
    INSERT INTO test_session_products (session_id, product_id, program_id, report_mode, usage_km, usage_seconds)
    VALUES (sid, (prod->>'product_id')::uuid, p_program, coalesce(nullif(prod->>'report_mode',''),'report'),
            nullif(prod->>'usage_km','')::numeric, nullif(prod->>'usage_seconds','')::int);
    FOR obs IN SELECT * FROM jsonb_array_elements(coalesce(prod->'observations','[]'::jsonb)) LOOP
      INSERT INTO test_observations (program_id, session_id, product_id, kind, criterion, score, note)
      VALUES (p_program, sid, (prod->>'product_id')::uuid, obs->>'kind', obs->>'criterion',
              nullif(obs->>'score','')::smallint, nullif(obs->>'note',''));
    END LOOP;
  END LOOP;
  RETURN sid;
END $$;
REVOKE ALL ON FUNCTION public.test_save_session(uuid, uuid, jsonb, jsonb) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.test_save_session(uuid, uuid, jsonb, jsonb) TO authenticated;

-- ── Seed: the Jaked x Carina programme ──────────────────────────
-- Only facts Dave has stated. No dates, distances, model names or scores are invented:
-- model_name and received_on stay NULL until confirmed.
INSERT INTO public.test_programs (slug, title, partner_name, athlete_name)
VALUES ('jaked-carina', 'Jaked x Carina Field Test Programme', 'Jaked', 'Carina Bruwer');

INSERT INTO public.test_program_members (program_id, user_id, role)
SELECT p.id, v.uid::uuid, v.role
FROM public.test_programs p,
     (VALUES ('df137255-3add-4153-b368-32e06e2be188','admin'),
             ('cff2fc33-4a55-451b-8c7f-20f12c1898ce','athlete')) AS v(uid, role)
WHERE p.slug = 'jaked-carina';

INSERT INTO public.test_products (program_id, name, group_label, category, status, sort_order)
SELECT p.id, v.name, v.grp, v.cat, v.st, v.ord
FROM public.test_programs p,
     (VALUES
       ('Jaked Blade',               NULL,                    'wetsuit',           'early_testing',    1),
       ('Training Costume 01',       'Jaked Training Swimwear','training_swimwear', 'active_testing',   2),
       ('Training Costume 02',       'Jaked Training Swimwear','training_swimwear', 'active_testing',   3),
       ('Training Costume 03',       'Jaked Training Swimwear','training_swimwear', 'active_testing',   4),
       ('Training Costume 04',       'Jaked Training Swimwear','training_swimwear', 'active_testing',   5),
       ('Training Costume 05',       'Jaked Training Swimwear','training_swimwear', 'active_testing',   6),
       ('Jaked Goggles',             NULL,                    'goggles',           'available',        7),
       ('Jaked Cap',                 NULL,                    'cap',               'available',        8),
       ('Jaked Racing Swimsuit',     NULL,                    'racing_swimwear',   'awaiting_product', 9)
     ) AS v(name, grp, cat, st, ord)
WHERE p.slug = 'jaked-carina';

COMMIT;

-- ----------------------------------------------------------------
-- POST-VERIFY — read-only, run after applying.
-- ----------------------------------------------------------------
-- All 7 tables have RLS on (expect 7 rows, all true):
--   SELECT relname, relrowsecurity FROM pg_class
--    WHERE relname LIKE 'test\_%' AND relkind = 'r';
-- anon has no privileges (expect 0 rows):
--   SELECT * FROM information_schema.role_table_grants
--    WHERE grantee = 'anon' AND table_name LIKE 'test\_%';
-- Seed: 1 programme, 2 members, 9 products.
