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
-- Migration: 2026-08-03_discovery-schema-v1.sql
-- Process:   see MIGRATIONS.md — no section below may be left empty
-- STATUS:    ✅ APPLIED 2026-08-03 via supabase-admin apply_migration
--            (migration name: discovery_schema_v1), after Dave approved
--            with "run the pre-checks on the read-only connection and
--            apply". All pre-checks passed clean; all post-apply
--            verification passed (13 tables, 13 RLS, 1 view, 16 policies,
--            0 write policies, swim_events unchanged at 32 columns).
--            Constraint suite: 19/19 passed in a rolled-back transaction.
--            RLS probe: 31 passed / 0 failed.
--
--            APPLIED WITH is_admin PROTECTION *NOT* IN PLACE — the
--            protect_profile_admin_fields trigger was absent at apply
--            time (pre-check #2 returned 0), a deliberate choice per the
--            RELATED note below. Recorded here so the follow-up is not
--            forgotten.
-- RELATED:   sql/2026-08-03_protect-profiles-is-admin.sql (separate,
--            also not yet applied). Every admin policy below is gated on
--            profiles.is_admin, which is currently self-updatable. That
--            hole already exists and already unlocks more sensitive
--            things than this migration adds (domains management,
--            spotlights, temp_logs DELETE, the UK-challenge admin
--            functions). Applying this migration first is therefore a
--            deliberate, low-marginal-risk choice — the discovery tables
--            it exposes to a self-granted admin hold scraped public event
--            data, not personal data. Ordering is NOT enforced here;
--            apply them in whichever order suits the schedule.
-- ================================================================

-- Purpose:
--   Global Swim Discovery, Phase 2 — the additive database foundation.
--   Creates two separate groups of tables:
--
--     (a) The PUBLISHED third-party event catalogue —
--         event_organisers, event_venues, event_series, event_editions,
--         event_distances. Publicly readable. Rows only ever arrive here
--         via admin approval (the future atomic RPC), never from the
--         worker.
--
--     (b) The DISCOVERY pipeline —
--         discovery_sources, discovery_source_pages, discovery_runs,
--         discovery_candidate_events, discovery_candidate_distances,
--         discovery_event_evidence, discovery_dedupe_links,
--         discovery_review_decisions. Never publicly readable. Written
--         only by the worker via the service-role key (which bypasses
--         RLS), read by admins only.
--
--   public.swim_events is NOT touched, referenced, or altered. It keeps
--   its existing meaning: SwimLoading-native, user-created group swims
--   with swim_participants RSVP and recurrence behaviour. Discovered
--   third-party events are a different concept with no RSVP and no
--   created_by user, hence the separate catalogue — see
--   docs/global-swim-discovery/database-schema.md.

-- Requested by:
--   Dave — Global Swim Discovery Phase 2 (database foundation), 2026-08-03.

-- ----------------------------------------------------------------
-- PRE-CHECKS — run on the READ-ONLY connection BEFORE applying.
-- ----------------------------------------------------------------
-- 1. None of the 13 new tables may already exist (expect NULL for each):
--      SELECT to_regclass('public.event_organisers'),
--             to_regclass('public.event_venues'),
--             to_regclass('public.event_series'),
--             to_regclass('public.event_editions'),
--             to_regclass('public.event_distances'),
--             to_regclass('public.discovery_sources'),
--             to_regclass('public.discovery_source_pages'),
--             to_regclass('public.discovery_runs'),
--             to_regclass('public.discovery_candidate_events'),
--             to_regclass('public.discovery_candidate_distances'),
--             to_regclass('public.discovery_event_evidence'),
--             to_regclass('public.discovery_dedupe_links'),
--             to_regclass('public.discovery_review_decisions');
--      -- expect: 13 NULLs
--
-- 2. Informational only — is the is_admin protection trigger applied yet?
--      SELECT trigger_name FROM information_schema.triggers
--      WHERE event_object_table = 'profiles'
--        AND trigger_name = 'protect_profile_admin_fields';
--      -- 1 row = protected. 0 rows = not yet, which is FINE to proceed
--      -- with (see the RELATED note in the header) — just record which
--      -- state you applied in, so the follow-up isn't forgotten.
--
-- 3. The generic touch helper must not already exist under this name
--    (it is created below; the only existing touch function in the
--    schema is the table-specific touch_swimmer_story_events_updated_at):
--      SELECT proname FROM pg_proc WHERE proname = 'touch_updated_at';
--      -- expect: 0 rows
--
-- 4. Confirm swim_events is untouched by this migration (baseline for
--    the post-apply comparison):
--      SELECT count(*) FROM information_schema.columns
--      WHERE table_name = 'swim_events';
--      -- record this number; it must be identical after applying.
--
-- 5. Confirm pgcrypto/gen_random_uuid() is available (used by every
--    table below; already used across the existing schema):
--      SELECT gen_random_uuid();  -- expect: a uuid, no error

-- ----------------------------------------------------------------
-- BACKUP — not required. This migration is purely additive: it creates
-- new tables, indexes, policies, grants and one function. It does not
-- ALTER, UPDATE, DELETE, or DROP any existing object or row.
-- ----------------------------------------------------------------

-- ----------------------------------------------------------------
-- MIGRATION — applied only after Dave types "apply".
-- ----------------------------------------------------------------
BEGIN;

-- ════════════════════════════════════════════════════════════════
-- 0. Shared updated_at helper
-- ════════════════════════════════════════════════════════════════
-- The only existing touch function in the applied schema is
-- touch_swimmer_story_events_updated_at(), which is hard-bound to one
-- table and cannot be reused. Rather than add 11 more near-identical
-- per-table copies, this migration introduces ONE generic helper and
-- uses it for every table it creates. Nothing existing is repointed at
-- it — the story-engine function keeps its own trigger untouched.
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.touch_updated_at IS
  'Generic BEFORE UPDATE trigger helper: bumps NEW.updated_at to now(). '
  'Introduced by the Global Swim Discovery Phase 2 migration and used by '
  'every table it creates. SECURITY INVOKER (the default) — it needs no '
  'elevated privilege, it only rewrites a column on the row being written.';

-- ════════════════════════════════════════════════════════════════
-- PART A — PUBLISHED EVENT CATALOGUE
-- Publicly readable. Populated only by admin approval, never by the
-- worker.
-- ════════════════════════════════════════════════════════════════

-- ── A1. event_organisers ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.event_organisers (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  canonical_name        text NOT NULL,
  display_name          text NOT NULL,
  description           text,
  organiser_type        text NOT NULL DEFAULT 'unknown'
                          CHECK (organiser_type IN (
                            'club','commercial','charity','governing_body',
                            'community_group','individual','unknown')),
  official_url          text,
  registration_base_url text,
  email                 text,
  phone                 text,
  country_code          text CHECK (country_code IS NULL OR country_code ~ '^[A-Z]{2}$'),
  external_identifiers  jsonb NOT NULL DEFAULT '{}'::jsonb,
  status                text NOT NULL DEFAULT 'active'
                          CHECK (status IN ('active','inactive','merged','archived')),
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.event_organisers IS
  'Third-party event organisers (clubs, commercial promoters, charities). '
  'Public catalogue reference data. email/phone are deliberately optional '
  'and are NOT public-facing personal data — they are organisation contact '
  'details only; do not store an individual''s personal contact here.';

-- ── A2. event_venues ──────────────────────────────────────────────
-- Deliberately SEPARATE from public.spots. spots is the swimmer
-- temperature-logging domain (it drives temp charts, spot_temp_estimate,
-- the admin spot-curation workflow and the Passport). A discovered race
-- start line is not automatically a place anyone logs temperatures at.
-- spot_id is an OPTIONAL, admin-confirmed link — this migration never
-- creates or auto-links a spot.
CREATE TABLE IF NOT EXISTS public.event_venues (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  canonical_name       text NOT NULL,
  display_name         text NOT NULL,
  location_text        text,
  city                 text,
  region               text,
  country_code         text CHECK (country_code IS NULL OR country_code ~ '^[A-Z]{2}$'),
  latitude             numeric(9,6),
  longitude            numeric(9,6),
  timezone             text,
  water_body_type      text CHECK (water_body_type IS NULL OR water_body_type IN
                         ('sea','lake','river','reservoir','pool','unknown')),
  spot_id              uuid REFERENCES public.spots(id) ON DELETE SET NULL,
  external_identifiers jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),

  -- Coordinates are all-or-nothing: a lone latitude is meaningless and
  -- would silently break any radius search.
  CONSTRAINT event_venues_coords_paired
    CHECK ((latitude IS NULL) = (longitude IS NULL)),
  CONSTRAINT event_venues_latitude_range
    CHECK (latitude IS NULL OR (latitude >= -90 AND latitude <= 90)),
  CONSTRAINT event_venues_longitude_range
    CHECK (longitude IS NULL OR (longitude >= -180 AND longitude <= 180))
);

COMMENT ON COLUMN public.event_venues.spot_id IS
  'OPTIONAL admin-confirmed link to a SwimLoading spot. Never set '
  'automatically — a venue and a temperature-logging spot are different '
  'concepts that only sometimes coincide.';

-- ── A3. event_series ──────────────────────────────────────────────
-- The enduring identity ("Great North Swim"), not a particular year.
CREATE TABLE IF NOT EXISTS public.event_series (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  canonical_name       text NOT NULL,
  display_name         text NOT NULL,
  organiser_id         uuid REFERENCES public.event_organisers(id) ON DELETE SET NULL,
  event_type           text NOT NULL DEFAULT 'official_race'
                         CHECK (event_type IN (
                           'official_race','mass_participation_swim','marathon_swim',
                           'charity_swim','swim_festival','guided_swim','swim_camp',
                           'expedition','recurring_group_swim')),
  description          text,
  official_url         text,
  status               text NOT NULL DEFAULT 'active'
                         CHECK (status IN ('active','dormant','discontinued','archived')),
  typical_month        smallint CHECK (typical_month IS NULL OR (typical_month BETWEEN 1 AND 12)),
  external_identifiers jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.event_series IS
  'The enduring event identity across years. A 2027 running of an annual '
  'race is an event_editions row pointing at this series — historical '
  'editions are therefore preserved rather than overwritten.';

-- ── A4. event_editions ────────────────────────────────────────────
-- One specific running of a series. source_candidate_id is declared here
-- but its FOREIGN KEY is added by ALTER TABLE at the end of this
-- migration, because discovery_candidate_events does not exist yet.
CREATE TABLE IF NOT EXISTS public.event_editions (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  series_id           uuid NOT NULL REFERENCES public.event_series(id) ON DELETE CASCADE,
  venue_id            uuid REFERENCES public.event_venues(id) ON DELETE SET NULL,
  edition_year        smallint NOT NULL CHECK (edition_year BETWEEN 1900 AND 2100),
  title               text,
  start_date          date,
  end_date            date,
  date_precision      text NOT NULL DEFAULT 'unknown'
                        CHECK (date_precision IN ('exact','range','month','year','unknown')),
  date_confirmed      boolean NOT NULL DEFAULT false,
  status              text NOT NULL DEFAULT 'unconfirmed'
                        CHECK (status IN (
                          'announced','registration_open','sold_out','completed',
                          'cancelled','postponed','unconfirmed')),
  registration_status text NOT NULL DEFAULT 'unknown'
                        CHECK (registration_status IN (
                          'not_open','open','closing_soon','closed','sold_out',
                          'waitlist','unknown')),
  registration_url    text,
  official_url        text,
  timezone            text,
  last_verified_at    timestamptz,
  source_candidate_id uuid,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),

  -- The anti-inference rule, carried over verbatim from the Phase 1
  -- worker contract (discovery-worker/src/domain/validation.ts): a date
  -- that is not confirmed must not carry a concrete date. This is what
  -- structurally prevents a missing year ever being guessed into a real
  -- published date.
  CONSTRAINT event_editions_unconfirmed_has_no_dates
    CHECK (date_confirmed OR (start_date IS NULL AND end_date IS NULL)),
  CONSTRAINT event_editions_confirmed_has_start_date
    CHECK (NOT date_confirmed OR start_date IS NOT NULL),
  CONSTRAINT event_editions_date_order
    CHECK (end_date IS NULL OR start_date IS NULL OR end_date >= start_date)
);

COMMENT ON COLUMN public.event_editions.source_candidate_id IS
  'The discovery candidate this edition was promoted from, if any. '
  'Nullable — an edition may be created manually by an admin with no '
  'discovery provenance. FK added by ALTER TABLE at the end of this '
  'migration (circular dependency with discovery_candidate_events).';

-- Duplicate-edition guard. Keyed on (series, year, venue) rather than
-- (series, year) so a series that legitimately runs two editions in the
-- same year at DIFFERENT locations is not incorrectly blocked. COALESCE
-- gives NULL venues a stable sentinel so two venue-less editions of the
-- same series+year still collide (which is the genuine duplicate case).
-- Same COALESCE-in-unique-index idiom already used by user_roles.
CREATE UNIQUE INDEX IF NOT EXISTS event_editions_series_year_venue_uniq
  ON public.event_editions (
    series_id,
    edition_year,
    COALESCE(venue_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );

-- ── A5. event_distances ───────────────────────────────────────────
-- One row per enterable distance/wave. Deliberately NOT an array column
-- and not a JSON blob: each option carries its own start time, price,
-- registration URL and wetsuit policy, and must be independently
-- queryable ("show me 5km+ swims near Manchester in September").
CREATE TABLE IF NOT EXISTS public.event_distances (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  edition_id            uuid NOT NULL REFERENCES public.event_editions(id) ON DELETE CASCADE,
  original_label        text NOT NULL,
  distance_metres       integer,
  category              text,
  start_time            time,
  registration_url      text,
  wetsuit_policy        text CHECK (wetsuit_policy IS NULL OR wetsuit_policy IN
                          ('permitted','mandatory','banned','wave_dependent','unknown')),
  qualification_required boolean,
  price_amount          numeric(10,2),
  price_currency        text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),

  -- NULL distance_metres is allowed (a valid but unquantifiable option,
  -- e.g. "Junior Splash Wave"), but a stored distance must be positive.
  CONSTRAINT event_distances_positive_distance
    CHECK (distance_metres IS NULL OR distance_metres > 0),
  -- A price is only meaningful as an amount+currency pair.
  CONSTRAINT event_distances_price_paired
    CHECK ((price_amount IS NULL) = (price_currency IS NULL)),
  CONSTRAINT event_distances_price_non_negative
    CHECK (price_amount IS NULL OR price_amount >= 0),
  CONSTRAINT event_distances_currency_format
    CHECK (price_currency IS NULL OR price_currency ~ '^[A-Z]{3}$')
);

COMMENT ON COLUMN public.event_distances.original_label IS
  'The organiser''s own wording, preserved verbatim ("10km Elite Wave"). '
  'Never overwritten by the normalised distance_metres value.';

-- ════════════════════════════════════════════════════════════════
-- PART B — DISCOVERY PIPELINE
-- Never publicly readable. Written by the worker via the service-role
-- key (which bypasses RLS); read by admins only.
-- ════════════════════════════════════════════════════════════════

-- ── B1. discovery_sources ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.discovery_sources (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                      text NOT NULL,
  base_url                  text NOT NULL,
  source_type               text NOT NULL
                              CHECK (source_type IN (
                                'organiser','aggregator','governing_body','club',
                                'tourism_board','calendar_feed','other')),
  authority_level           smallint NOT NULL DEFAULT 3
                              CHECK (authority_level BETWEEN 1 AND 5),
  country_code              text CHECK (country_code IS NULL OR country_code ~ '^[A-Z]{2}$'),
  region_hint               text,
  language_codes            text[] NOT NULL DEFAULT ARRAY['en']::text[],
  parser_type               text NOT NULL DEFAULT 'jsonld'
                              CHECK (parser_type IN ('jsonld','html','jsonld_html','playwright','manual')),
  enabled                   boolean NOT NULL DEFAULT false,
  health_status             text NOT NULL DEFAULT 'unknown'
                              CHECK (health_status IN ('healthy','degraded','failing','blocked','unknown')),
  crawl_frequency           text NOT NULL DEFAULT 'weekly'
                              CHECK (crawl_frequency IN ('hourly','daily','weekly','monthly','manual')),
  next_run_at               timestamptz,
  last_run_at               timestamptz,
  last_success_at           timestamptz,
  consecutive_failure_count integer NOT NULL DEFAULT 0
                              CHECK (consecutive_failure_count >= 0),
  robots_checked_at         timestamptz,
  terms_checked_at          timestamptz,
  notes                     text,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now()
);

COMMENT ON COLUMN public.discovery_sources.enabled IS
  'Defaults to FALSE. A source is inert until an admin explicitly enables '
  'it — this migration seeds no sources at all.';
COMMENT ON COLUMN public.discovery_sources.authority_level IS
  '1 (lowest, e.g. unverified aggregator) to 5 (highest, the organiser''s '
  'own official page). Feeds the confidence score.';

-- ── B2. discovery_source_pages ────────────────────────────────────
-- Per-URL retrieval history. Enables change monitoring across runs.
-- Full downloaded HTML is deliberately NOT stored in Postgres in this
-- version — only a content hash, so a change can be detected without
-- turning the database into a page archive.
CREATE TABLE IF NOT EXISTS public.discovery_source_pages (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id            uuid NOT NULL REFERENCES public.discovery_sources(id) ON DELETE CASCADE,
  url                  text NOT NULL,
  canonical_url        text NOT NULL,
  page_type            text NOT NULL DEFAULT 'unknown'
                         CHECK (page_type IN ('listing','event_detail','calendar','results','unknown')),
  content_hash         text,
  http_status          integer,
  etag                 text,
  last_modified_header text,
  first_seen_at        timestamptz NOT NULL DEFAULT now(),
  last_fetched_at      timestamptz,
  last_changed_at      timestamptz,
  fetch_count          integer NOT NULL DEFAULT 0 CHECK (fetch_count >= 0),
  failure_count        integer NOT NULL DEFAULT 0 CHECK (failure_count >= 0),
  last_error           text,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),

  -- One tracked row per canonical URL per source: re-crawling the same
  -- page updates this row rather than appending a new one.
  CONSTRAINT discovery_source_pages_source_canonical_uniq
    UNIQUE (source_id, canonical_url)
);

-- ── B3. discovery_runs ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.discovery_runs (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id        uuid NOT NULL REFERENCES public.discovery_sources(id) ON DELETE CASCADE,
  run_type         text NOT NULL DEFAULT 'scheduled'
                     CHECK (run_type IN ('scheduled','manual','backfill','verification')),
  status           text NOT NULL DEFAULT 'running'
                     CHECK (status IN ('running','succeeded','failed','partial','cancelled')),
  started_at       timestamptz NOT NULL DEFAULT now(),
  finished_at      timestamptz,
  pages_requested  integer NOT NULL DEFAULT 0 CHECK (pages_requested  >= 0),
  pages_fetched    integer NOT NULL DEFAULT 0 CHECK (pages_fetched    >= 0),
  pages_changed    integer NOT NULL DEFAULT 0 CHECK (pages_changed    >= 0),
  candidates_found integer NOT NULL DEFAULT 0 CHECK (candidates_found >= 0),
  retry_count      integer NOT NULL DEFAULT 0 CHECK (retry_count      >= 0),
  max_retries      integer NOT NULL DEFAULT 3 CHECK (max_retries      >= 0),
  error_code       text,
  error_message    text,
  metrics          jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at       timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT discovery_runs_finish_after_start
    CHECK (finished_at IS NULL OR finished_at >= started_at)
);

-- ── B4. discovery_candidate_events ────────────────────────────────
-- The database representation of the Phase 1 CandidateEvent contract
-- (discovery-worker/src/domain/candidate-event.ts). Field names are
-- snake_case here and camelCase there; the mapping is documented in
-- discovery-worker/README.md.
CREATE TABLE IF NOT EXISTS public.discovery_candidate_events (
  id                         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_key              text NOT NULL,
  source_id                  uuid NOT NULL REFERENCES public.discovery_sources(id) ON DELETE CASCADE,
  source_page_id             uuid REFERENCES public.discovery_source_pages(id) ON DELETE SET NULL,
  source_url                 text NOT NULL,
  official_url               text,
  registration_url           text,
  canonical_name             text,
  original_name              text,
  event_type                 text CHECK (event_type IS NULL OR event_type IN (
                               'official_race','mass_participation_swim','marathon_swim',
                               'charity_swim','swim_festival','guided_swim','swim_camp',
                               'expedition','recurring_group_swim')),
  candidate_status           text NOT NULL DEFAULT 'pending'
                               CHECK (candidate_status IN (
                                 'pending','needs_review','approved','rejected','duplicate')),
  organiser_name             text,
  proposed_organiser_id      uuid REFERENCES public.event_organisers(id) ON DELETE SET NULL,
  venue_name                 text,
  proposed_venue_id          uuid REFERENCES public.event_venues(id) ON DELETE SET NULL,
  location_text              text,
  city                       text,
  region                     text,
  country_code               text CHECK (country_code IS NULL OR country_code ~ '^[A-Z]{2}$'),
  latitude                   numeric(9,6),
  longitude                  numeric(9,6),
  start_date                 date,
  end_date                   date,
  original_date_text         text,
  date_precision             text NOT NULL DEFAULT 'unknown'
                               CHECK (date_precision IN ('exact','range','month','year','unknown')),
  date_confirmed             boolean NOT NULL DEFAULT false,
  timezone                   text,
  water_body_type            text CHECK (water_body_type IS NULL OR water_body_type IN
                               ('sea','lake','river','reservoir','pool','unknown')),
  wetsuit_policy             text CHECK (wetsuit_policy IS NULL OR wetsuit_policy IN
                               ('permitted','mandatory','banned','wave_dependent','unknown')),
  description_summary        text,
  extraction_method          text NOT NULL DEFAULT 'none'
                               CHECK (extraction_method IN ('jsonld','html','jsonld+html','none')),
  confidence_score           smallint NOT NULL DEFAULT 0
                               CHECK (confidence_score BETWEEN 0 AND 100),
  publication_recommendation text NOT NULL DEFAULT 'insufficient_evidence'
                               CHECK (publication_recommendation IN (
                                 'high_confidence','manual_review','insufficient_evidence','rejected')),
  confidence_reasons         jsonb NOT NULL DEFAULT '[]'::jsonb,
  warnings                   jsonb NOT NULL DEFAULT '[]'::jsonb,
  raw_source_values          jsonb NOT NULL DEFAULT '{}'::jsonb,
  raw_payload                jsonb NOT NULL DEFAULT '{}'::jsonb,
  extracted_at               timestamptz NOT NULL DEFAULT now(),
  last_reviewed_at           timestamptz,
  promoted_edition_id        uuid REFERENCES public.event_editions(id) ON DELETE SET NULL,
  created_at                 timestamptz NOT NULL DEFAULT now(),
  updated_at                 timestamptz NOT NULL DEFAULT now(),

  -- Same anti-inference rule as event_editions and the Phase 1 worker.
  CONSTRAINT dce_unconfirmed_has_no_dates
    CHECK (date_confirmed OR (start_date IS NULL AND end_date IS NULL)),
  CONSTRAINT dce_date_order
    CHECK (end_date IS NULL OR start_date IS NULL OR end_date >= start_date),
  CONSTRAINT dce_coords_paired
    CHECK ((latitude IS NULL) = (longitude IS NULL)),
  CONSTRAINT dce_latitude_range
    CHECK (latitude IS NULL OR (latitude >= -90 AND latitude <= 90)),
  CONSTRAINT dce_longitude_range
    CHECK (longitude IS NULL OR (longitude >= -180 AND longitude <= 180)),
  -- A candidate may only point at a published edition once it has
  -- actually been approved. This is half of the future approval RPC's
  -- idempotency guarantee (the other half is the FOR UPDATE row lock).
  CONSTRAINT dce_promoted_only_when_approved
    CHECK (promoted_edition_id IS NULL OR candidate_status = 'approved'),
  -- Idempotent worker upserts: re-extracting the same event from the
  -- same source updates this row instead of creating a duplicate. Scoped
  -- per source (not globally) because two different sources describing
  -- the same real-world event are two legitimate candidates — that
  -- relationship is expressed in discovery_dedupe_links, not by
  -- collapsing them here.
  CONSTRAINT discovery_candidate_events_source_key_uniq
    UNIQUE (source_id, candidate_key)
);

COMMENT ON COLUMN public.discovery_candidate_events.candidate_key IS
  'Stable, worker-computed identity for one event as seen from one '
  'source (e.g. a hash of source_page + canonical name + date text). '
  'UNIQUE per source_id so repeated extraction upserts rather than '
  'duplicates.';
COMMENT ON COLUMN public.discovery_candidate_events.raw_payload IS
  'The untouched extraction payload, for audit and re-processing. '
  'Structured facts must ALSO be written to their real columns and to '
  'discovery_candidate_distances — never stored only in here.';

-- ── B5. discovery_candidate_distances ─────────────────────────────
-- The Phase 1 worker already models distances as structured options
-- (DistanceOption[]). They must stay queryable and promotable without
-- parsing JSON, so they get a real table rather than living in
-- raw_payload.
CREATE TABLE IF NOT EXISTS public.discovery_candidate_distances (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id           uuid NOT NULL REFERENCES public.discovery_candidate_events(id) ON DELETE CASCADE,
  original_label         text NOT NULL,
  distance_metres        integer,
  category               text,
  -- text, not `time`: this is raw extracted data that may legitimately
  -- be unparseable ("TBC", "dawn"). The published event_distances.start_time
  -- is a real `time` — the cast happens at admin-reviewed promotion.
  start_time             text,
  registration_url       text,
  wetsuit_policy         text CHECK (wetsuit_policy IS NULL OR wetsuit_policy IN
                           ('permitted','mandatory','banned','wave_dependent','unknown')),
  qualification_required boolean,
  created_at             timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT dcd_positive_distance
    CHECK (distance_metres IS NULL OR distance_metres > 0)
);

-- ── B6. discovery_event_evidence ──────────────────────────────────
-- Field-addressable provenance: the review UI can show exactly which
-- snippet supports each proposed value. Full page content is NOT copied
-- here — only the specific snippet that produced a specific field.
CREATE TABLE IF NOT EXISTS public.discovery_event_evidence (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id        uuid NOT NULL REFERENCES public.discovery_candidate_events(id) ON DELETE CASCADE,
  source_page_id      uuid REFERENCES public.discovery_source_pages(id) ON DELETE SET NULL,
  evidence_type       text NOT NULL
                        CHECK (evidence_type IN ('jsonld','html_selector','meta_tag','playwright','ai_fallback')),
  field_name          text NOT NULL,
  raw_snippet         text,
  structured_value    jsonb,
  selector_or_path    text,
  extracted_at        timestamptz NOT NULL DEFAULT now(),
  extraction_warnings jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at          timestamptz NOT NULL DEFAULT now()
);

COMMENT ON COLUMN public.discovery_event_evidence.raw_snippet IS
  'The specific extracted fragment supporting one field — never a full '
  'page copy. Two evidence rows for the same field_name that disagree ARE '
  'the representation of conflicting evidence; no separate table is needed.';

-- ── B7. discovery_dedupe_links ────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.discovery_dedupe_links (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id          uuid NOT NULL REFERENCES public.discovery_candidate_events(id) ON DELETE CASCADE,
  matching_candidate_id uuid REFERENCES public.discovery_candidate_events(id) ON DELETE CASCADE,
  matching_edition_id   uuid REFERENCES public.event_editions(id) ON DELETE CASCADE,
  similarity_score      smallint NOT NULL CHECK (similarity_score BETWEEN 0 AND 100),
  possible_duplicate    boolean NOT NULL DEFAULT false,
  matching_signals      jsonb NOT NULL DEFAULT '[]'::jsonb,
  conflicting_signals   jsonb NOT NULL DEFAULT '[]'::jsonb,
  resolution            text NOT NULL DEFAULT 'unresolved'
                          CHECK (resolution IN ('unresolved','confirmed_duplicate','confirmed_distinct')),
  resolved_by           uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  resolved_at           timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),

  -- A link points at exactly one thing: another candidate, or a
  -- published edition. Never both, never neither.
  CONSTRAINT ddl_exactly_one_target
    CHECK ((matching_candidate_id IS NOT NULL)::int + (matching_edition_id IS NOT NULL)::int = 1),
  CONSTRAINT ddl_no_self_match
    CHECK (matching_candidate_id IS NULL OR matching_candidate_id <> candidate_id),
  -- A resolved link records who resolved it and when; an unresolved one
  -- records neither.
  CONSTRAINT ddl_resolution_timestamp_agrees
    CHECK ((resolution = 'unresolved') = (resolved_at IS NULL)),
  CONSTRAINT ddl_resolver_paired
    CHECK ((resolved_by IS NULL) = (resolved_at IS NULL))
);

-- ── B8. discovery_review_decisions ────────────────────────────────
-- Append-only audit of every admin review action. Enforced at the policy
-- level: this table has no UPDATE and no DELETE policy for any client
-- role, and no INSERT policy either — rows will be written only by the
-- future SECURITY DEFINER approval RPC.
CREATE TABLE IF NOT EXISTS public.discovery_review_decisions (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id        uuid NOT NULL REFERENCES public.discovery_candidate_events(id) ON DELETE CASCADE,
  decision            text NOT NULL
                        CHECK (decision IN (
                          'approved','rejected','marked_duplicate',
                          'returned_for_review','edited','duplicate_resolved')),
  decided_by          uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  decided_at          timestamptz NOT NULL DEFAULT now(),
  notes               text,
  resulting_edition_id uuid REFERENCES public.event_editions(id) ON DELETE SET NULL,
  previous_status     text,
  new_status          text,
  metadata            jsonb NOT NULL DEFAULT '{}'::jsonb
);

COMMENT ON TABLE public.discovery_review_decisions IS
  'Append-only review history. No UPDATE/DELETE policy exists for any '
  'client role, matching the sponsor_partner_audit and '
  'challenge_points_audit precedent — history is never rewritten.';

-- ════════════════════════════════════════════════════════════════
-- PART C — resolve the circular FK
-- ════════════════════════════════════════════════════════════════
-- event_editions.source_candidate_id -> discovery_candidate_events.id
-- could not be declared inline because discovery_candidate_events is
-- created after event_editions (it needs event_editions for
-- promoted_edition_id). Both directions are nullable and both use
-- ON DELETE SET NULL — deliberately NOT CASCADE, so deleting a candidate
-- can never cascade into deleting a published event, or vice versa.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'event_editions_source_candidate_fk'
  ) THEN
    ALTER TABLE public.event_editions
      ADD CONSTRAINT event_editions_source_candidate_fk
      FOREIGN KEY (source_candidate_id)
      REFERENCES public.discovery_candidate_events(id)
      ON DELETE SET NULL;
  END IF;
END $$;

-- ════════════════════════════════════════════════════════════════
-- PART D — updated_at triggers
-- ════════════════════════════════════════════════════════════════
DROP TRIGGER IF EXISTS trg_touch_event_organisers            ON public.event_organisers;
DROP TRIGGER IF EXISTS trg_touch_event_venues                ON public.event_venues;
DROP TRIGGER IF EXISTS trg_touch_event_series                ON public.event_series;
DROP TRIGGER IF EXISTS trg_touch_event_editions              ON public.event_editions;
DROP TRIGGER IF EXISTS trg_touch_event_distances             ON public.event_distances;
DROP TRIGGER IF EXISTS trg_touch_discovery_sources           ON public.discovery_sources;
DROP TRIGGER IF EXISTS trg_touch_discovery_source_pages      ON public.discovery_source_pages;
DROP TRIGGER IF EXISTS trg_touch_discovery_candidate_events  ON public.discovery_candidate_events;

CREATE TRIGGER trg_touch_event_organisers           BEFORE UPDATE ON public.event_organisers           FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER trg_touch_event_venues               BEFORE UPDATE ON public.event_venues               FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER trg_touch_event_series               BEFORE UPDATE ON public.event_series               FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER trg_touch_event_editions             BEFORE UPDATE ON public.event_editions             FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER trg_touch_event_distances            BEFORE UPDATE ON public.event_distances            FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER trg_touch_discovery_sources          BEFORE UPDATE ON public.discovery_sources          FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER trg_touch_discovery_source_pages     BEFORE UPDATE ON public.discovery_source_pages     FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER trg_touch_discovery_candidate_events BEFORE UPDATE ON public.discovery_candidate_events FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ════════════════════════════════════════════════════════════════
-- PART E — INDEXES
-- ════════════════════════════════════════════════════════════════
-- NOTE: PostGIS is NOT enabled in this project (verified — no
-- geography/geometry column or GiST index exists anywhere in the applied
-- schema). Geographic filtering therefore uses scalar latitude/longitude
-- B-tree indexes as a bounding-box prefilter, with the existing Haversine
-- distance calculation applied afterwards — the same approach already
-- used by the Strava spot-matching code.

-- Published catalogue — the acceptance query is
-- "open-water swims within 200km of Manchester, 1 Sep - 31 Oct 2027".
CREATE INDEX IF NOT EXISTS event_editions_start_date_idx   ON public.event_editions (start_date);
CREATE INDEX IF NOT EXISTS event_editions_date_range_idx   ON public.event_editions (start_date, end_date);
CREATE INDEX IF NOT EXISTS event_editions_status_date_idx  ON public.event_editions (status, start_date);
CREATE INDEX IF NOT EXISTS event_editions_series_idx       ON public.event_editions (series_id);
CREATE INDEX IF NOT EXISTS event_editions_venue_idx        ON public.event_editions (venue_id);
CREATE INDEX IF NOT EXISTS event_editions_year_idx         ON public.event_editions (edition_year);
CREATE INDEX IF NOT EXISTS event_editions_source_cand_idx  ON public.event_editions (source_candidate_id);

CREATE INDEX IF NOT EXISTS event_venues_country_city_idx   ON public.event_venues (country_code, city);
CREATE INDEX IF NOT EXISTS event_venues_lat_lng_idx        ON public.event_venues (latitude, longitude);
CREATE INDEX IF NOT EXISTS event_venues_spot_idx           ON public.event_venues (spot_id);

CREATE INDEX IF NOT EXISTS event_series_organiser_idx      ON public.event_series (organiser_id);
CREATE INDEX IF NOT EXISTS event_series_event_type_idx     ON public.event_series (event_type);
CREATE INDEX IF NOT EXISTS event_organisers_country_idx    ON public.event_organisers (country_code);

CREATE INDEX IF NOT EXISTS event_distances_edition_idx     ON public.event_distances (edition_id);
CREATE INDEX IF NOT EXISTS event_distances_metres_idx      ON public.event_distances (distance_metres);

-- Discovery — source scheduling.
CREATE INDEX IF NOT EXISTS discovery_sources_due_idx
  ON public.discovery_sources (next_run_at) WHERE enabled = true;
CREATE INDEX IF NOT EXISTS discovery_sources_health_idx    ON public.discovery_sources (health_status);

-- Discovery — source page lookup by URL.
CREATE INDEX IF NOT EXISTS discovery_source_pages_source_idx    ON public.discovery_source_pages (source_id);
CREATE INDEX IF NOT EXISTS discovery_source_pages_canonical_idx ON public.discovery_source_pages (canonical_url);
CREATE INDEX IF NOT EXISTS discovery_source_pages_hash_idx      ON public.discovery_source_pages (content_hash);

-- Discovery — run history.
CREATE INDEX IF NOT EXISTS discovery_runs_source_started_idx ON public.discovery_runs (source_id, started_at DESC);
CREATE INDEX IF NOT EXISTS discovery_runs_status_idx         ON public.discovery_runs (status);

-- Discovery — the review queue: status, confidence, and the idempotency key.
CREATE INDEX IF NOT EXISTS dce_status_confidence_idx  ON public.discovery_candidate_events (candidate_status, confidence_score DESC);
CREATE INDEX IF NOT EXISTS dce_recommendation_idx     ON public.discovery_candidate_events (publication_recommendation);
CREATE INDEX IF NOT EXISTS dce_candidate_key_idx      ON public.discovery_candidate_events (candidate_key);
CREATE INDEX IF NOT EXISTS dce_source_idx             ON public.discovery_candidate_events (source_id);
CREATE INDEX IF NOT EXISTS dce_source_page_idx        ON public.discovery_candidate_events (source_page_id);
CREATE INDEX IF NOT EXISTS dce_country_city_idx       ON public.discovery_candidate_events (country_code, city);
CREATE INDEX IF NOT EXISTS dce_start_date_idx         ON public.discovery_candidate_events (start_date);
CREATE INDEX IF NOT EXISTS dce_lat_lng_idx            ON public.discovery_candidate_events (latitude, longitude);
CREATE INDEX IF NOT EXISTS dce_promoted_edition_idx   ON public.discovery_candidate_events (promoted_edition_id);
CREATE INDEX IF NOT EXISTS dce_pending_queue_idx
  ON public.discovery_candidate_events (confidence_score DESC)
  WHERE candidate_status IN ('pending','needs_review');

CREATE INDEX IF NOT EXISTS dcd_candidate_idx ON public.discovery_candidate_distances (candidate_id);

-- Discovery — evidence, addressable by candidate and field.
CREATE INDEX IF NOT EXISTS dee_candidate_field_idx ON public.discovery_event_evidence (candidate_id, field_name);
CREATE INDEX IF NOT EXISTS dee_source_page_idx     ON public.discovery_event_evidence (source_page_id);

-- Discovery — unresolved duplicates (the admin's actual working queue).
CREATE INDEX IF NOT EXISTS ddl_candidate_idx ON public.discovery_dedupe_links (candidate_id);
CREATE INDEX IF NOT EXISTS ddl_unresolved_idx
  ON public.discovery_dedupe_links (candidate_id, similarity_score DESC)
  WHERE resolution = 'unresolved';
CREATE INDEX IF NOT EXISTS ddl_matching_edition_idx ON public.discovery_dedupe_links (matching_edition_id);

-- Discovery — review history.
CREATE INDEX IF NOT EXISTS drd_candidate_decided_idx ON public.discovery_review_decisions (candidate_id, decided_at DESC);
CREATE INDEX IF NOT EXISTS drd_decided_by_idx        ON public.discovery_review_decisions (decided_by);

-- ════════════════════════════════════════════════════════════════
-- PART F — ROW LEVEL SECURITY
-- ════════════════════════════════════════════════════════════════
ALTER TABLE public.event_organisers               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_venues                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_series                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_editions                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_distances                ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.discovery_sources              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.discovery_source_pages         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.discovery_runs                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.discovery_candidate_events     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.discovery_candidate_distances  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.discovery_event_evidence       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.discovery_dedupe_links         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.discovery_review_decisions     ENABLE ROW LEVEL SECURITY;

-- ── F1. Published catalogue: public read ──────────────────────────
-- These tables hold PUBLIC event listings — being publicly readable is
-- the entire product purpose (the Explore pages). This is deliberately
-- NOT the same situation as the profiles / club_roster / club_join_links
-- USING(true) incidents, which exposed personal data.
--
-- event_organisers is the ONE table here with columns that should not be
-- public (email/phone — organisation contact details). It therefore gets
-- NO public read policy at all: public access goes through the
-- public_organisers VIEW created in Part G, exactly matching the existing
-- public_profiles precedent. The table itself is admin-read-only.
--
-- An edition is publicly visible only once it is no longer 'unconfirmed'.
-- That gives admins a place to park a partially-verified edition without
-- it appearing on the public site.

DROP POLICY IF EXISTS event_venues_public_read ON public.event_venues;
CREATE POLICY event_venues_public_read ON public.event_venues
  FOR SELECT USING (true);

DROP POLICY IF EXISTS event_series_public_read ON public.event_series;
CREATE POLICY event_series_public_read ON public.event_series
  FOR SELECT USING (status IN ('active','dormant'));

DROP POLICY IF EXISTS event_editions_public_read ON public.event_editions;
CREATE POLICY event_editions_public_read ON public.event_editions
  FOR SELECT USING (status <> 'unconfirmed');

-- Distances inherit their parent edition's visibility — otherwise an
-- unconfirmed edition would leak through its distance rows.
DROP POLICY IF EXISTS event_distances_public_read ON public.event_distances;
CREATE POLICY event_distances_public_read ON public.event_distances
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.event_editions e
      WHERE e.id = event_distances.edition_id
        AND e.status <> 'unconfirmed'
    )
  );

-- ── F2. Published catalogue: admin read of everything ─────────────
-- Admins additionally see unconfirmed/archived rows the public cannot.
-- No INSERT/UPDATE/DELETE policy is created for ANY client role: writes
-- to the published catalogue happen only through the future atomic
-- approval RPC (SECURITY DEFINER) or the service role. This is
-- deliberate — a permissive admin UPDATE policy would let the browser
-- bypass that RPC, which is exactly what the approval design forbids.

DROP POLICY IF EXISTS event_organisers_admin_read ON public.event_organisers;
CREATE POLICY event_organisers_admin_read ON public.event_organisers
  FOR SELECT USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin = true));

DROP POLICY IF EXISTS event_series_admin_read ON public.event_series;
CREATE POLICY event_series_admin_read ON public.event_series
  FOR SELECT USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin = true));

DROP POLICY IF EXISTS event_editions_admin_read ON public.event_editions;
CREATE POLICY event_editions_admin_read ON public.event_editions
  FOR SELECT USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin = true));

DROP POLICY IF EXISTS event_distances_admin_read ON public.event_distances;
CREATE POLICY event_distances_admin_read ON public.event_distances
  FOR SELECT USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin = true));

-- ── F3. Discovery pipeline: admin READ ONLY, never public ─────────
-- Every discovery table gets exactly one policy: admin SELECT. No
-- INSERT, UPDATE or DELETE policy exists for any client role. The worker
-- writes with the service-role key, which bypasses RLS entirely and
-- therefore needs no policy of its own.

DROP POLICY IF EXISTS discovery_sources_admin_read ON public.discovery_sources;
CREATE POLICY discovery_sources_admin_read ON public.discovery_sources
  FOR SELECT USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin = true));

DROP POLICY IF EXISTS discovery_source_pages_admin_read ON public.discovery_source_pages;
CREATE POLICY discovery_source_pages_admin_read ON public.discovery_source_pages
  FOR SELECT USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin = true));

DROP POLICY IF EXISTS discovery_runs_admin_read ON public.discovery_runs;
CREATE POLICY discovery_runs_admin_read ON public.discovery_runs
  FOR SELECT USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin = true));

DROP POLICY IF EXISTS discovery_candidate_events_admin_read ON public.discovery_candidate_events;
CREATE POLICY discovery_candidate_events_admin_read ON public.discovery_candidate_events
  FOR SELECT USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin = true));

DROP POLICY IF EXISTS discovery_candidate_distances_admin_read ON public.discovery_candidate_distances;
CREATE POLICY discovery_candidate_distances_admin_read ON public.discovery_candidate_distances
  FOR SELECT USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin = true));

DROP POLICY IF EXISTS discovery_event_evidence_admin_read ON public.discovery_event_evidence;
CREATE POLICY discovery_event_evidence_admin_read ON public.discovery_event_evidence
  FOR SELECT USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin = true));

DROP POLICY IF EXISTS discovery_dedupe_links_admin_read ON public.discovery_dedupe_links;
CREATE POLICY discovery_dedupe_links_admin_read ON public.discovery_dedupe_links
  FOR SELECT USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin = true));

DROP POLICY IF EXISTS discovery_review_decisions_admin_read ON public.discovery_review_decisions;
CREATE POLICY discovery_review_decisions_admin_read ON public.discovery_review_decisions
  FOR SELECT USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin = true));

-- ════════════════════════════════════════════════════════════════
-- PART G — GRANTS
-- ════════════════════════════════════════════════════════════════
-- RLS alone is not sufficient: Supabase's default privileges may grant
-- anon/authenticated broad table access on newly created public-schema
-- tables, and table privileges are evaluated BEFORE row policies. Every
-- new table therefore starts from REVOKE ALL and is granted back only
-- what it genuinely needs.
--
-- Note the asymmetry that makes this work:
--   * anon gets SELECT on the published catalogue only, and NOTHING on
--     any discovery table.
--   * authenticated gets SELECT on discovery tables — because admins are
--     `authenticated` users in the browser, and without the table grant
--     the admin RLS policy above could never be reached. The RLS policy
--     is what narrows those rows to admins; the grant merely makes the
--     table reachable.
--   * NOBODY gets INSERT/UPDATE/DELETE on anything here. All writes go
--     through the service role (worker) or the future SECURITY DEFINER
--     approval RPC.

-- Published catalogue — public read.
REVOKE ALL ON public.event_organisers FROM anon, authenticated;
REVOKE ALL ON public.event_venues     FROM anon, authenticated;
REVOKE ALL ON public.event_series     FROM anon, authenticated;
REVOKE ALL ON public.event_editions   FROM anon, authenticated;
REVOKE ALL ON public.event_distances  FROM anon, authenticated;

GRANT SELECT ON public.event_venues    TO anon, authenticated;
GRANT SELECT ON public.event_series    TO anon, authenticated;
GRANT SELECT ON public.event_editions  TO anon, authenticated;
GRANT SELECT ON public.event_distances TO anon, authenticated;

-- event_organisers is NOT granted to anon at all, and is granted to
-- authenticated only so the admin-only RLS policy can be reached.
-- Ordinary authenticated users get zero rows from the table itself.
GRANT SELECT ON public.event_organisers TO authenticated;

-- ── public_organisers view ────────────────────────────────────────
-- The public read surface for organisers, replacing what would
-- otherwise be a column-level grant. Same precedent as the existing
-- public_profiles view: a plain (non-security_invoker) view, so it
-- executes with the view owner's privileges and is readable by anon
-- without granting anon anything on the underlying table.
--
-- Because it bypasses the table's RLS by design, the "only active
-- organisers are public" rule is enforced INSIDE the view (WHERE
-- status = 'active') rather than by a table policy — the view is
-- self-contained and cannot be widened by a future policy change.
--
-- email and phone are simply not selected. There is no grant that could
-- expose them through this view.
CREATE OR REPLACE VIEW public.public_organisers AS
  SELECT id,
         canonical_name,
         display_name,
         description,
         organiser_type,
         official_url,
         registration_base_url,
         country_code,
         external_identifiers,
         created_at,
         updated_at
  FROM public.event_organisers
  WHERE status = 'active';

COMMENT ON VIEW public.public_organisers IS
  'Public read surface for event_organisers. Excludes email and phone '
  '(organisation contact details) and exposes only status=''active'' '
  'rows. Follows the existing public_profiles pattern: a plain view, '
  'executed with owner privileges, so anon needs no grant on the '
  'underlying table. Explore pages must read THIS, not event_organisers.';

REVOKE ALL ON public.public_organisers FROM anon, authenticated;
GRANT SELECT ON public.public_organisers TO anon, authenticated;

-- Discovery pipeline — no anon access at all; authenticated may reach
-- the table only so the admin-only RLS policy can be evaluated.
REVOKE ALL ON public.discovery_sources             FROM anon, authenticated;
REVOKE ALL ON public.discovery_source_pages        FROM anon, authenticated;
REVOKE ALL ON public.discovery_runs                FROM anon, authenticated;
REVOKE ALL ON public.discovery_candidate_events    FROM anon, authenticated;
REVOKE ALL ON public.discovery_candidate_distances FROM anon, authenticated;
REVOKE ALL ON public.discovery_event_evidence      FROM anon, authenticated;
REVOKE ALL ON public.discovery_dedupe_links        FROM anon, authenticated;
REVOKE ALL ON public.discovery_review_decisions    FROM anon, authenticated;

GRANT SELECT ON public.discovery_sources             TO authenticated;
GRANT SELECT ON public.discovery_source_pages        TO authenticated;
GRANT SELECT ON public.discovery_runs                TO authenticated;
GRANT SELECT ON public.discovery_candidate_events    TO authenticated;
GRANT SELECT ON public.discovery_candidate_distances TO authenticated;
GRANT SELECT ON public.discovery_event_evidence      TO authenticated;
GRANT SELECT ON public.discovery_dedupe_links        TO authenticated;
GRANT SELECT ON public.discovery_review_decisions    TO authenticated;

COMMIT;

-- ----------------------------------------------------------------
-- ROLLBACK — exact SQL to undo. Fully reversible: this migration only
-- created objects, so dropping them restores the prior state exactly.
-- Drop order respects the FK graph (children first).
-- ----------------------------------------------------------------
-- BEGIN;
-- DROP VIEW IF EXISTS public.public_organisers;
-- ALTER TABLE IF EXISTS public.event_editions
--   DROP CONSTRAINT IF EXISTS event_editions_source_candidate_fk;
-- DROP TABLE IF EXISTS public.discovery_review_decisions;
-- DROP TABLE IF EXISTS public.discovery_dedupe_links;
-- DROP TABLE IF EXISTS public.discovery_event_evidence;
-- DROP TABLE IF EXISTS public.discovery_candidate_distances;
-- DROP TABLE IF EXISTS public.discovery_candidate_events;
-- DROP TABLE IF EXISTS public.discovery_runs;
-- DROP TABLE IF EXISTS public.discovery_source_pages;
-- DROP TABLE IF EXISTS public.discovery_sources;
-- DROP TABLE IF EXISTS public.event_distances;
-- DROP TABLE IF EXISTS public.event_editions;
-- DROP TABLE IF EXISTS public.event_series;
-- DROP TABLE IF EXISTS public.event_venues;
-- DROP TABLE IF EXISTS public.event_organisers;
-- DROP FUNCTION IF EXISTS public.touch_updated_at();
-- COMMIT;
-- -- Nothing outside these objects is touched, so there is no data loss
-- -- anywhere else. swim_events, profiles, spots and all existing RLS are
-- -- unaffected by both the migration and this rollback.

-- ----------------------------------------------------------------
-- VERIFY — run on the READ-ONLY connection AFTER applying.
-- ----------------------------------------------------------------
-- 1. All 13 tables exist:
--      SELECT count(*) FROM information_schema.tables
--      WHERE table_schema='public' AND table_name IN (
--        'event_organisers','event_venues','event_series','event_editions',
--        'event_distances','discovery_sources','discovery_source_pages',
--        'discovery_runs','discovery_candidate_events',
--        'discovery_candidate_distances','discovery_event_evidence',
--        'discovery_dedupe_links','discovery_review_decisions');
--      -- expect: 13
--
-- 2. RLS is enabled on all 13:
--      SELECT count(*) FROM pg_tables
--      WHERE schemaname='public' AND rowsecurity = true AND tablename IN (
--        'event_organisers','event_venues','event_series','event_editions',
--        'event_distances','discovery_sources','discovery_source_pages',
--        'discovery_runs','discovery_candidate_events',
--        'discovery_candidate_distances','discovery_event_evidence',
--        'discovery_dedupe_links','discovery_review_decisions');
--      -- expect: 13
--
-- 3. NO write policy exists on any new table (all writes go via service
--    role / the future RPC):
--      SELECT tablename, policyname, cmd FROM pg_policies
--      WHERE schemaname='public'
--        AND tablename LIKE ANY (ARRAY['event\_%','discovery\_%'])
--        AND cmd <> 'SELECT';
--      -- expect: 0 rows
--
-- 4. anon holds NO privilege on any discovery table:
--      SELECT table_name, privilege_type FROM information_schema.role_table_grants
--      WHERE grantee='anon' AND table_schema='public'
--        AND table_name LIKE 'discovery\_%';
--      -- expect: 0 rows
--
-- 5. anon holds ONLY SELECT on the published catalogue, and NOTHING on
--    event_organisers (which is reached via the public_organisers view):
--      SELECT table_name, privilege_type FROM information_schema.role_table_grants
--      WHERE grantee='anon' AND table_schema='public'
--        AND table_name IN ('event_organisers','event_venues','event_series',
--                           'event_editions','event_distances','public_organisers');
--      -- expect: SELECT on event_venues, event_series, event_editions,
--      -- event_distances and public_organisers. NO row for
--      -- event_organisers at all. No INSERT/UPDATE/DELETE anywhere.
--
-- 6. The public_organisers view exists and exposes no contact columns:
--      SELECT column_name FROM information_schema.columns
--      WHERE table_schema='public' AND table_name='public_organisers';
--      -- expect: 11 columns, and NEITHER 'email' NOR 'phone' among them
--
-- 6b. anon can actually read the view, and cannot read the base table:
--      -- as anon (PostgREST):
--      --   GET /rest/v1/public_organisers?select=*&limit=1   -> 200
--      --   GET /rest/v1/event_organisers?select=*&limit=1    -> 401/403/empty
--
-- 7. swim_events is untouched — compare to pre-check #4:
--      SELECT count(*) FROM information_schema.columns WHERE table_name='swim_events';
--      -- expect: identical to the pre-check baseline
--
-- 8. The circular FK resolved correctly in both directions:
--      SELECT conname FROM pg_constraint
--      WHERE conname IN ('event_editions_source_candidate_fk')
--         OR (conrelid='public.discovery_candidate_events'::regclass
--             AND confrelid='public.event_editions'::regclass);
--      -- expect: 2 rows (one per direction)
--
-- 9. Run the constraint test suite (safe, transactional, rolls back):
--      \i sql/2026-08-03_discovery-schema-v1-tests.sql
--      -- expect: every test reports PASS, then ROLLBACK
--
-- 10. Run the RLS probe from the repo root:
--       node scripts/test-discovery-schema-rls.mjs --mode=readonly-safe
--       -- expect: all checks pass
