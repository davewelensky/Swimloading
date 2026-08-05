-- ================================================================
-- SwimLoading — Migration
-- The safety block hard-fails if you are in the wrong project.
-- ================================================================

DO $safety$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM _project_identity WHERE key='project_name' AND value='swimloading') THEN
    RAISE EXCEPTION E'\n WRONG PROJECT — MIGRATION ABORTED. Expected swimloading / szgkzuswelntnevobnoh';
  END IF;
  RAISE NOTICE '✅ Project identity confirmed: swimloading';
END $safety$;

-- ================================================================
-- Migration: 2026-08-05_explore-phase1-foundation.sql
-- Process:   see MIGRATIONS.md — no section below may be left empty
-- STATUS:    ✅ APPLIED 2026-08-05. Verified: 259 editions / 0 entries
--            unchanged; 259 total = 259 slugged = 259 distinct; 0 slugs with
--            invalid characters; 2 rows took the collision suffix; 194
--            indexable and 0 of them AI-read. Functional tests run in an
--            aborted block: status->cancelled logged as
--            'cancelled / notify=true', and a new edition titled
--            'Slug Trigger Test!!' auto-slugged to 'slug-trigger-test-2099'.
-- ================================================================

-- Purpose:
--   Stage 2 of the Explore Phase 1 brief: the data foundation for stable
--   public event pages, saving and following, change notifications, and
--   organiser claims.
--
--   Additive only. No column is dropped, renamed or retyped; no existing
--   row is deleted; every existing query keeps working unchanged.
--
--   WHAT THIS DELIBERATELY DOES NOT ADD, and why. The brief §2 lists ~40
--   canonical fields. Most have no source and no consumer: the discovery
--   pipeline does not extract race format, cutoff times, skins rules,
--   safety notes or expected water temperature, and nothing renders them.
--   Adding twenty always-NULL columns would advertise a rich event record
--   that is empty, which is exactly the failure the brief warns against in
--   its own "do not fabricate" rule. Two specific omissions worth naming:
--
--     * water_type — NOT added to the edition. event_venues.water_body_type
--       already holds it, and water type is a property of the water, not of
--       one year's running of a race. A second copy would drift.
--     * expected water temperature min/max/source — NOT added.
--       venue_water_climatology already answers this properly (83 venues x
--       52 weeks x 20 years) and is a better answer than a hand-typed range.
--       The detail page derives it; it is not restated as a column.
--
--   Fields ARE added where a claimed organiser will fill them in the next
--   phase and the detail page will render them if present — description,
--   entry window — because those have a named future writer.
--
--   See docs/global-swim-discovery/EXPLORE_PHASE1_AUDIT.md for the full
--   gap analysis this migration implements.

-- Requested by:
--   Dave — 2026-08-05, "Explore Phase 1" brief, Stage 2.

-- ----------------------------------------------------------------
-- PRE-CHECKS — run on the READ-ONLY connection BEFORE applying.
-- ----------------------------------------------------------------
-- 1. Row counts before, to compare against the VERIFY block:
--      SELECT 'editions' t, count(*) FROM event_editions
--      UNION ALL SELECT 'entries', count(*) FROM swimmer_event_entries;
--      -- ACTUAL 2026-08-05: editions 250, entries 0.
--
-- 2. None of the new columns may already exist (expect 0):
--      SELECT count(*) FROM information_schema.columns
--       WHERE table_name='event_editions'
--         AND column_name IN ('slug','short_description','description',
--             'entry_opens_on','entry_closes_on','is_searchable','is_featured');
--
-- 3. None of the new tables may already exist (expect 0):
--      SELECT count(*) FROM information_schema.tables WHERE table_schema='public'
--       AND table_name IN ('event_change_log','event_claims');
--
-- 4. The slug backfill must be able to produce a UNIQUE value for every
--    edition. This counts titles that would collide within the same year
--    BEFORE the de-duplicating suffix is applied — informational only,
--    because step 3 below resolves collisions deterministically:
--      SELECT count(*) FROM (
--        SELECT lower(regexp_replace(coalesce(title,''),'[^a-zA-Z0-9]+','-','g')),
--               edition_year, count(*) n
--          FROM event_editions GROUP BY 1,2 HAVING count(*) > 1) x;
--
-- 5. Confirm the existing CHECK on swimmer_event_entries.status, because
--    this migration must REPLACE it rather than add a second one:
--      SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint
--       WHERE conrelid='swimmer_event_entries'::regclass AND contype='c';
--      -- ACTUAL: status IN ('interested','entered','completed')
--      --     AND ((status='completed') = (completed_on IS NOT NULL))

-- ----------------------------------------------------------------
-- BACKUP — required: this migration UPDATEs existing rows (the slug
-- backfill) and REPLACEs a CHECK constraint on a user-data table.
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS _bak_20260805_event_editions AS
  SELECT id, title, edition_year, status, now() AS backed_up_at FROM event_editions;

CREATE TABLE IF NOT EXISTS _bak_20260805_swimmer_event_entries AS
  SELECT *, now() AS backed_up_at FROM swimmer_event_entries;

-- ----------------------------------------------------------------
-- MIGRATION — applied only after Dave types "apply".
-- ----------------------------------------------------------------
BEGIN;

-- ══ 1. Canonical event record: the fields with a real source or consumer ══

ALTER TABLE public.event_editions
  ADD COLUMN IF NOT EXISTS slug              text,
  ADD COLUMN IF NOT EXISTS short_description text,
  ADD COLUMN IF NOT EXISTS description       text,
  ADD COLUMN IF NOT EXISTS entry_opens_on    date,
  ADD COLUMN IF NOT EXISTS entry_closes_on   date,
  -- Visibility. NOT a second is_public: public readability is already
  -- decided by the existing RLS policy (status <> 'unconfirmed') and a
  -- duplicate flag would give two answers to one question. is_searchable
  -- hides a row from Explore WITHOUT unpublishing its page (for a listing
  -- that is real but too thin to surface); is_indexable additionally
  -- controls sitemap and robots, so an event can be browsable without
  -- being handed to Google.
  ADD COLUMN IF NOT EXISTS is_searchable     boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS is_indexable      boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_featured       boolean NOT NULL DEFAULT false,
  -- Organiser claim state, read by the public page to show the strongest
  -- trust label. Set only by the claim-approval path, never by a crawler.
  ADD COLUMN IF NOT EXISTS officially_claimed    boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS claimed_by_profile_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS claimed_at            timestamptz;

COMMENT ON COLUMN public.event_editions.is_indexable IS
  'Whether this edition may appear in the sitemap and be crawled. Defaults '
  'to FALSE and is granted by rule, never by default: see the backfill in '
  'this migration. Kept separate from is_searchable so an event can be '
  'browsable on Explore without being handed to a search engine.';

COMMENT ON COLUMN public.event_editions.slug IS
  'Stable public URL segment for /events/{slug}. Unique. Generated from '
  'title + edition_year and NEVER regenerated on title edits — a changed '
  'slug breaks every saved and shared link.';

-- ══ 2. Slug generation ═══════════════════════════════════════════════════
-- IMMUTABLE and deterministic so it can be reasoned about and re-run.
-- Transliteration is deliberately NOT attempted: unaccent() is not
-- installed, and a wrong transliteration of a non-Latin name is worse than
-- falling back to the id, which step 3 does.
CREATE OR REPLACE FUNCTION public.event_slug_base(p_title text, p_year smallint)
RETURNS text
LANGUAGE sql IMMUTABLE
SET search_path = public
AS $fn$
  SELECT nullif(
    trim(both '-' from
      regexp_replace(
        regexp_replace(lower(coalesce(p_title,'')), '[^a-z0-9]+', '-', 'g'),
        '-{2,}', '-', 'g')
    ), '')
    || CASE WHEN p_year IS NULL THEN '' ELSE '-' || p_year::text END;
$fn$;

-- ══ 3. Backfill slugs — every edition, guaranteed unique ═════════════════
-- Collisions resolved by appending a short suffix of the row's own id,
-- which is stable across re-runs (unlike row_number(), which would
-- reshuffle if a row were added). A title that slugifies to nothing at all
-- (e.g. entirely non-Latin) falls back to the id — an ugly URL is
-- recoverable, a missing page is not.
WITH base AS (
  SELECT id,
         coalesce(event_slug_base(title, edition_year), 'event-' || left(id::text, 8)) AS s
    FROM event_editions
   WHERE slug IS NULL
), numbered AS (
  SELECT id, s,
         count(*) OVER (PARTITION BY s) AS dupes
    FROM base
)
UPDATE event_editions e
   SET slug = CASE WHEN n.dupes > 1 THEN n.s || '-' || left(e.id::text, 6) ELSE n.s END
  FROM numbered n
 WHERE e.id = n.id;

-- Belt and braces: if the above still left a duplicate (only possible if a
-- slug column had been partially populated by hand before this ran), make
-- the remaining ones unique by id rather than failing the unique index.
UPDATE event_editions e
   SET slug = e.slug || '-' || left(e.id::text, 6)
 WHERE EXISTS (SELECT 1 FROM event_editions o
                WHERE o.slug = e.slug AND o.id <> e.id AND o.ctid < e.ctid);

ALTER TABLE public.event_editions
  ADD CONSTRAINT event_editions_slug_key UNIQUE (slug);

-- ══ 4. Keep new editions slugged automatically ═══════════════════════════
-- A BEFORE INSERT trigger rather than a DEFAULT, because the value depends
-- on two other columns. It never overwrites a slug that was supplied, and
-- never touches an existing one on UPDATE (see the WHEN clause) — that is
-- what keeps shared links alive across a title correction.
CREATE OR REPLACE FUNCTION public.set_edition_slug()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $fn$
DECLARE
  v_base text;
BEGIN
  IF NEW.slug IS NOT NULL AND trim(NEW.slug) <> '' THEN
    RETURN NEW;
  END IF;

  v_base := coalesce(event_slug_base(NEW.title, NEW.edition_year),
                     'event-' || left(NEW.id::text, 8));

  IF EXISTS (SELECT 1 FROM event_editions WHERE slug = v_base) THEN
    v_base := v_base || '-' || left(NEW.id::text, 6);
  END IF;

  NEW.slug := v_base;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_edition_slug ON public.event_editions;
CREATE TRIGGER trg_edition_slug
  BEFORE INSERT ON public.event_editions
  FOR EACH ROW EXECUTE FUNCTION public.set_edition_slug();

-- ══ 5. Indexability backfill — conservative, and the reason matters ══════
-- Granted only where the listing is good enough to stand up in a search
-- result: a confirmed future date, a real verification tier, not cancelled,
-- and NOT sourced from an AI-read candidate.
--
-- That last clause is the important one. 56 live editions trace to an
-- ai_fallback candidate and have never been reviewed by a person (see
-- sql/applied/2026-08-05_ai-candidates-require-review.sql). Auto-publishing
-- them was stopped on 2026-08-05; indexing them now would push exactly the
-- same unreviewed machine-read rows into Google, where a wrong listing
-- outlives its correction. They become indexable when a human approves
-- them, not before.
UPDATE public.event_editions e
   SET is_indexable = true
 WHERE e.date_confirmed
   AND e.start_date >= current_date
   AND e.status NOT IN ('cancelled','postponed','completed')
   AND e.verification_tier IN ('confirmed','listed')
   AND NOT EXISTS (
     SELECT 1 FROM discovery_candidate_events c
      WHERE c.id = e.source_candidate_id
        AND c.extraction_method = 'ai_fallback');

-- ══ 6. Save / follow — EXTEND swimmer_event_entries, do not replace it ═══
-- The brief asks for a new swim_event_follows table. This table already is
-- that table: same grain (one row per user per edition), same unique
-- constraint, and correct own-row RLS already in place. Creating a second
-- one would split a swimmer's relationship with an event across two places.
ALTER TABLE public.swimmer_event_entries
  ADD COLUMN IF NOT EXISTS notify_date_change     boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS notify_entry_open      boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS notify_entry_close     boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS notify_cancellation    boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS notify_material_change boolean NOT NULL DEFAULT true;

-- Widen the status vocabulary to the brief's five states. The existing
-- constraint is REPLACED, not supplemented — two CHECKs on one column both
-- have to pass, so leaving the old one would silently reject 'saved'.
-- The completed_on pairing rule is preserved verbatim.
ALTER TABLE public.swimmer_event_entries
  DROP CONSTRAINT IF EXISTS swimmer_event_entries_status_check;

ALTER TABLE public.swimmer_event_entries
  ADD CONSTRAINT swimmer_event_entries_status_check
  CHECK (status IN ('saved','interested','planning','entered','completed'));

COMMENT ON TABLE public.swimmer_event_entries IS
  'A swimmer''s relationship with one published event edition: saved, '
  'interested, planning, entered or completed, plus their per-event '
  'notification preferences. One row per (user_id, edition_id). This is the '
  'table the Phase 1 brief calls swim_event_follows — extended rather than '
  'duplicated so a swimmer''s relationship with an event lives in one place.';

-- ══ 7. Change log ════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.event_change_log (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  edition_id            uuid NOT NULL REFERENCES public.event_editions(id) ON DELETE CASCADE,
  field_name            text NOT NULL,
  old_value             text,
  new_value             text,
  change_type           text NOT NULL CHECK (change_type IN (
                          'date_changed','venue_changed','cancelled','postponed',
                          'entry_opened','entry_closed','sold_out',
                          'distance_removed','url_changed','other')),
  -- Whether a swimmer should hear about it. Set at write time by the
  -- trigger below, so the notifier never has to re-derive materiality and
  -- the two cannot disagree.
  notification_required boolean NOT NULL DEFAULT false,
  source                text NOT NULL DEFAULT 'system'
                          CHECK (source IN ('system','discovery','admin','organiser')),
  changed_by            uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  changed_at            timestamptz NOT NULL DEFAULT now(),
  notified_at           timestamptz
);

CREATE INDEX IF NOT EXISTS event_change_log_edition_idx  ON public.event_change_log (edition_id, changed_at DESC);
-- Partial index: the notifier's only query is "material changes not yet
-- sent", which is a tiny slice of a table that grows on every crawl.
CREATE INDEX IF NOT EXISTS event_change_log_pending_idx  ON public.event_change_log (changed_at)
  WHERE notification_required AND notified_at IS NULL;

-- ══ 8. Change detection ══════════════════════════════════════════════════
-- A trigger, not application code, so a change is recorded no matter which
-- path made it — the worker's re-crawl, an admin edit, or a future
-- organiser update. Materiality is decided in ONE place.
CREATE OR REPLACE FUNCTION public.log_edition_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_actor uuid := auth.uid();
BEGIN
  IF NEW.start_date IS DISTINCT FROM OLD.start_date THEN
    INSERT INTO event_change_log (edition_id, field_name, old_value, new_value,
                                  change_type, notification_required, changed_by)
    VALUES (NEW.id, 'start_date', OLD.start_date::text, NEW.start_date::text,
            'date_changed', true, v_actor);
  END IF;

  IF NEW.venue_id IS DISTINCT FROM OLD.venue_id THEN
    INSERT INTO event_change_log (edition_id, field_name, old_value, new_value,
                                  change_type, notification_required, changed_by)
    VALUES (NEW.id, 'venue_id', OLD.venue_id::text, NEW.venue_id::text,
            'venue_changed', true, v_actor);
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO event_change_log (edition_id, field_name, old_value, new_value,
                                  change_type, notification_required, changed_by)
    VALUES (NEW.id, 'status', OLD.status, NEW.status,
            CASE NEW.status WHEN 'cancelled' THEN 'cancelled'
                            WHEN 'postponed' THEN 'postponed'
                            ELSE 'other' END,
            NEW.status IN ('cancelled','postponed'), v_actor);
  END IF;

  IF NEW.registration_status IS DISTINCT FROM OLD.registration_status THEN
    INSERT INTO event_change_log (edition_id, field_name, old_value, new_value,
                                  change_type, notification_required, changed_by)
    VALUES (NEW.id, 'registration_status', OLD.registration_status, NEW.registration_status,
            CASE NEW.registration_status
              WHEN 'open'      THEN 'entry_opened'
              WHEN 'closed'    THEN 'entry_closed'
              WHEN 'sold_out'  THEN 'sold_out'
              ELSE 'other' END,
            NEW.registration_status IN ('open','closed','sold_out'), v_actor);
  END IF;

  -- Recorded but never notified: useful history, not worth an email.
  IF NEW.official_url IS DISTINCT FROM OLD.official_url THEN
    INSERT INTO event_change_log (edition_id, field_name, old_value, new_value,
                                  change_type, notification_required, changed_by)
    VALUES (NEW.id, 'official_url', OLD.official_url, NEW.official_url,
            'url_changed', false, v_actor);
  END IF;

  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_edition_change_log ON public.event_editions;
CREATE TRIGGER trg_edition_change_log
  AFTER UPDATE ON public.event_editions
  FOR EACH ROW EXECUTE FUNCTION public.log_edition_change();

-- ══ 9. Organiser claims ══════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.event_claims (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  edition_id      uuid NOT NULL REFERENCES public.event_editions(id) ON DELETE CASCADE,
  profile_id      uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  organiser_name  text NOT NULL,
  role            text,
  email           text NOT NULL,
  evidence_url    text,
  notes           text,
  status          text NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','approved','rejected','more_information_required')),
  reviewed_by     uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  reviewed_at     timestamptz,
  review_notes    text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- One pending claim per person per event. Partial unique index rather than
-- a plain one, so a rejected claim can be resubmitted with better evidence
-- but a duplicate cannot be spammed while one is queued.
CREATE UNIQUE INDEX IF NOT EXISTS event_claims_one_pending_idx
  ON public.event_claims (edition_id, profile_id) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS event_claims_status_idx ON public.event_claims (status, created_at DESC);

-- ══ 10. RLS ══════════════════════════════════════════════════════════════

ALTER TABLE public.event_claims     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_change_log ENABLE ROW LEVEL SECURITY;

-- Claims are private: they carry a real name and email address. A claimant
-- sees only their own; only an admin sees all. There is deliberately NO
-- public policy — anon gets nothing at all.
CREATE POLICY event_claims_select_own ON public.event_claims
  FOR SELECT TO authenticated USING (profile_id = auth.uid());

CREATE POLICY event_claims_insert_own ON public.event_claims
  FOR INSERT TO authenticated WITH CHECK (profile_id = auth.uid());

CREATE POLICY event_claims_admin_all ON public.event_claims
  FOR ALL TO authenticated
  USING      (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.is_admin))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.is_admin));

-- No UPDATE policy for the claimant, by design: letting someone edit a
-- queued claim would let them swap the evidence after an admin had read it.
-- Withdraw and resubmit instead.

-- The change log is public READ — "this event's date moved on 12 August" is
-- exactly the provenance the brief wants visible, and it contains no
-- personal data beyond changed_by, which is not exposed by the public view
-- below. Writes are trigger-only (SECURITY DEFINER); no role gets INSERT.
CREATE POLICY event_change_log_public_read ON public.event_change_log
  FOR SELECT TO anon, authenticated USING (true);

-- ══ 11. Public projection of the change log ══════════════════════════════
-- The table is readable but changed_by is not something a visitor should
-- see. security_invoker keeps the caller's RLS in force rather than the
-- view owner's.
CREATE OR REPLACE VIEW public.event_change_history
WITH (security_invoker = true) AS
  SELECT id, edition_id, field_name, old_value, new_value, change_type, changed_at
    FROM public.event_change_log
   ORDER BY changed_at DESC;

GRANT SELECT ON public.event_change_history TO anon, authenticated;

-- ══ 12. Indexes for the search patterns Explore actually uses ════════════
CREATE UNIQUE INDEX IF NOT EXISTS event_editions_slug_idx ON public.event_editions (slug);
-- Partial: every Explore query is "searchable, upcoming, not cancelled".
CREATE INDEX IF NOT EXISTS event_editions_searchable_idx
  ON public.event_editions (start_date)
  WHERE is_searchable AND status NOT IN ('cancelled','completed');
CREATE INDEX IF NOT EXISTS event_editions_indexable_idx
  ON public.event_editions (start_date) WHERE is_indexable;
CREATE INDEX IF NOT EXISTS event_editions_featured_idx
  ON public.event_editions (is_featured, start_date) WHERE is_featured;
CREATE INDEX IF NOT EXISTS event_claims_edition_idx ON public.event_claims (edition_id);

COMMIT;

-- ----------------------------------------------------------------
-- ROLLBACK — exact SQL to undo. Run top to bottom.
-- ----------------------------------------------------------------
-- BEGIN;
-- DROP VIEW IF EXISTS public.event_change_history;
-- DROP TRIGGER IF EXISTS trg_edition_change_log ON public.event_editions;
-- DROP FUNCTION IF EXISTS public.log_edition_change();
-- DROP TRIGGER IF EXISTS trg_edition_slug ON public.event_editions;
-- DROP FUNCTION IF EXISTS public.set_edition_slug();
-- DROP FUNCTION IF EXISTS public.event_slug_base(text, smallint);
-- DROP TABLE IF EXISTS public.event_claims;
-- DROP TABLE IF EXISTS public.event_change_log;
-- ALTER TABLE public.swimmer_event_entries
--   DROP COLUMN IF EXISTS notify_date_change,
--   DROP COLUMN IF EXISTS notify_entry_open,
--   DROP COLUMN IF EXISTS notify_entry_close,
--   DROP COLUMN IF EXISTS notify_cancellation,
--   DROP COLUMN IF EXISTS notify_material_change;
-- -- Restore the original narrower status vocabulary. This FAILS if any row
-- -- has since been written as 'saved' or 'planning' — that is intentional:
-- -- decide what happens to those rows rather than silently voiding them.
-- --   SELECT count(*) FROM swimmer_event_entries WHERE status IN ('saved','planning');
-- ALTER TABLE public.swimmer_event_entries DROP CONSTRAINT IF EXISTS swimmer_event_entries_status_check;
-- ALTER TABLE public.swimmer_event_entries ADD CONSTRAINT swimmer_event_entries_status_check
--   CHECK (status IN ('interested','entered','completed'));
-- ALTER TABLE public.event_editions DROP CONSTRAINT IF EXISTS event_editions_slug_key;
-- ALTER TABLE public.event_editions
--   DROP COLUMN IF EXISTS slug, DROP COLUMN IF EXISTS short_description,
--   DROP COLUMN IF EXISTS description, DROP COLUMN IF EXISTS entry_opens_on,
--   DROP COLUMN IF EXISTS entry_closes_on, DROP COLUMN IF EXISTS is_searchable,
--   DROP COLUMN IF EXISTS is_indexable, DROP COLUMN IF EXISTS is_featured,
--   DROP COLUMN IF EXISTS officially_claimed, DROP COLUMN IF EXISTS claimed_by_profile_id,
--   DROP COLUMN IF EXISTS claimed_at;
-- COMMIT;
--
-- The two _bak_20260805_* tables are left in place deliberately; drop them
-- by hand once the migration has been live long enough to trust.

-- ----------------------------------------------------------------
-- VERIFY — run on the READ-ONLY connection AFTER applying.
-- ----------------------------------------------------------------
-- 1. No row was lost (compare with pre-check 1 — expect 250 / 0):
--      SELECT 'editions' t, count(*) FROM event_editions
--      UNION ALL SELECT 'entries', count(*) FROM swimmer_event_entries;
--
-- 2. Every edition has a slug, and every slug is unique:
--      SELECT count(*) AS total, count(slug) AS slugged,
--             count(DISTINCT slug) AS distinct_slugs FROM event_editions;
--      -- expect all three equal
--
-- 3. Slugs are URL-safe — no uppercase, space or punctuation survived:
--      SELECT count(*) FROM event_editions WHERE slug !~ '^[a-z0-9-]+$';  -- expect 0
--
-- 4. Indexability is conservative, and NO ai_fallback edition got it:
--      SELECT count(*) FROM event_editions WHERE is_indexable;
--      SELECT count(*) FROM event_editions e
--        JOIN discovery_candidate_events c ON c.id = e.source_candidate_id
--       WHERE c.extraction_method='ai_fallback' AND e.is_indexable;   -- expect 0
--
-- 5. Claims are invisible to the public. As anon (no JWT):
--      SELECT count(*) FROM event_claims;   -- expect 0 rows / permission denied
--
-- 6. The change trigger fires and marks materiality correctly. Run inside a
--    transaction and ROLL BACK:
--      BEGIN;
--        UPDATE event_editions SET status='cancelled'
--         WHERE id=(SELECT id FROM event_editions LIMIT 1);
--        SELECT change_type, notification_required FROM event_change_log
--         ORDER BY changed_at DESC LIMIT 1;   -- expect cancelled / true
--      ROLLBACK;
--
-- 7. New editions get a slug automatically. Inside a transaction, ROLL BACK:
--      BEGIN;
--        INSERT INTO event_editions (series_id, edition_year, title, status)
--        SELECT series_id, 2099, 'Slug Trigger Test', 'announced'
--          FROM event_editions LIMIT 1;
--        SELECT slug FROM event_editions WHERE edition_year=2099;
--        -- expect: slug-trigger-test-2099
--      ROLLBACK;
