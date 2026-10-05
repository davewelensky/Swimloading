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
-- Migration: 2026-10-05_sponsors-commercial-schema.sql
-- Process:   see MIGRATIONS.md
-- ================================================================

-- Purpose:
--   Give /Sponsors a commercial layer without a parallel CRM: growth_sponsors stays
--   the one sponsor record (operational, founders can read/write); new child tables
--   hang off growth_sponsors.id. Confidential money tables (ledger, rate card, deal
--   lines) are Dave-only by RLS. Also adds database guards for the integrity bugs
--   fixed in code (canonical status list; "ALL" can never be stored as a country).

-- Requested by: Dave (approved plan 5 Oct 2026, stages 4 of 10)

-- ----------------------------------------------------------------
-- PRE-CHECKS (read-only; run before applying)
-- ----------------------------------------------------------------
-- SELECT count(*) FROM growth_sponsors;                                         -- expect 93
-- SELECT count(*) FROM growth_sponsors
--   WHERE status NOT IN ('Idea','Researching','Contacted','In Discussion','Confirmed','Passed');   -- expect 0 (else the status CHECK would fail)
-- SELECT count(*) FROM growth_sponsors WHERE country IS NULL OR country !~ '^[A-Z]{2,3}$' OR country = 'ALL';  -- expect 0
-- SELECT to_regclass('public.sponsor_ledger'), to_regclass('public.sponsor_rate_card');  -- expect NULL, NULL

-- ----------------------------------------------------------------
-- BACKUP — _bak_20261005_growth_sponsors is created at the top of the transaction
-- (before ANY change) because this migration normalises legacy statuses that the old
-- Growth Hub editor can still write ('Not Now' / 'Interested', e.g. REVVI was set to
-- 'Not Now' on 5 Oct 2026 12:12 UTC, AFTER the dry-run). 'Not Now'/'Interested' ->
-- 'In Discussion' keeps the row live with its follow-up date; an audit note is added
-- to the sponsor's history. Everything else is additive.
-- ----------------------------------------------------------------

BEGIN;

-- ---- Who may see commercial data -------------------------------------------
-- Dave only (same rule as the existing pp_dave_all policy on partner_pages).
CREATE OR REPLACE FUNCTION public.sponsors_is_dave() RETURNS boolean
LANGUAGE sql STABLE AS $$ SELECT lower(coalesce(auth.email(), '')) = 'dave.welensky@gmail.com' $$;

-- Founders (operational sponsor data), same rule as the existing founders_all policies.
CREATE OR REPLACE FUNCTION public.sponsors_is_founder() RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT lower(coalesce(auth.jwt() ->> 'email', '')) IN (SELECT lower(email) FROM public.growth_founders)
$$;

-- ---- growth_sponsors: new operational columns + guards ----------------------
ALTER TABLE public.growth_sponsors
  ADD COLUMN IF NOT EXISTS member_benefit      text,   -- what members get (operational, not confidential pricing)
  ADD COLUMN IF NOT EXISTS exclusivity         text,   -- existence/scope of exclusivity only; terms live in the ledger
  ADD COLUMN IF NOT EXISTS athlete_involvement text,   -- who is involved and how; fees live in the ledger
  ADD COLUMN IF NOT EXISTS partner_page_id     uuid REFERENCES public.partner_pages(id) ON DELETE SET NULL;

-- Country may be unknown for a brand (international / unconfirmed): NULL is honest,
-- a made-up default is not. "ALL" is a view filter and can never be stored.
ALTER TABLE public.growth_sponsors ALTER COLUMN country DROP NOT NULL;
ALTER TABLE public.growth_sponsors
  ADD CONSTRAINT growth_sponsors_country_chk CHECK (country IS NULL OR (country <> 'ALL' AND country ~ '^[A-Z]{2,3}$')),
  ADD CONSTRAINT growth_sponsors_status_chk  CHECK (status IN ('Idea','Researching','Contacted','In Discussion','Confirmed','Passed'));

COMMENT ON COLUMN public.growth_sponsors.conversation_log IS 'DEPRECATED 2026-10-05: history now lives in sponsor_interactions. Kept read-only for rollback.';
COMMENT ON COLUMN public.growth_sponsors.conversations    IS 'DEPRECATED 2026-10-05: history now lives in sponsor_interactions. Kept read-only for rollback.';

-- ---- Operational child tables (founders: read/write) ------------------------
CREATE TABLE public.sponsor_contacts (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  growth_sponsor_id  uuid NOT NULL REFERENCES public.growth_sponsors(id) ON DELETE CASCADE,
  name               text NOT NULL,
  role               text,
  email              text,
  phone              text,
  notes              text,
  is_primary         boolean NOT NULL DEFAULT false,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  created_by         uuid REFERENCES auth.users(id) ON DELETE SET NULL DEFAULT auth.uid()
);

CREATE TABLE public.sponsor_interactions (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  growth_sponsor_id  uuid NOT NULL REFERENCES public.growth_sponsors(id) ON DELETE CASCADE,
  occurred_at        timestamptz NOT NULL,
  interaction_type   text CHECK (interaction_type IS NULL OR interaction_type IN ('email','call','whatsapp','meeting','note','other')),
  direction          text CHECK (direction IS NULL OR direction IN ('inbound','outbound')),
  is_draft           boolean NOT NULL DEFAULT false,
  subject            text,
  body               text,
  counterpart        text,            -- who it was to/from, where known
  author             text,            -- who on our side, where known
  source             text NOT NULL DEFAULT 'app' CHECK (source IN ('app','conversation_log','conversations')),
  source_index       integer,         -- position in the legacy array, for idempotent migration
  legacy             jsonb,           -- the untouched original entry: nothing is lost in migration
  created_at         timestamptz NOT NULL DEFAULT now(),
  created_by         uuid REFERENCES auth.users(id) ON DELETE SET NULL DEFAULT auth.uid(),
  UNIQUE (growth_sponsor_id, source, source_index)
);

-- Audit trail for the status normalisation above (visible in the sponsor's history).
INSERT INTO public.sponsor_interactions (growth_sponsor_id, occurred_at, interaction_type, body, author, source)
SELECT b.id, now(), 'note',
       'Status was "' || b.status || '" (set in the old Growth Hub editor). Canonicalised to "In Discussion" by the 5 Oct 2026 sponsors migration; follow-up date and all other fields unchanged.',
       'migration', 'app'
FROM public._bak_20261005_growth_sponsors b WHERE b.status IN ('Not Now', 'Interested');

-- ---- Commercial tables (Dave only) ------------------------------------------
CREATE TABLE public.sponsor_rate_card (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text NOT NULL,
  category      text NOT NULL DEFAULT 'other' CHECK (category IN ('newsletter','campaign','event','athlete_content','exclusivity','other')),
  unit_label    text,
  unit_price    numeric(14,2) CHECK (unit_price IS NULL OR unit_price >= 0),   -- NULL = not priced yet
  currency      text CHECK (currency IS NULL OR currency ~ '^[A-Z]{3}$'),      -- any ISO-style code, not a fixed list
  ledger_kind   text NOT NULL DEFAULT 'inventory' CHECK (ledger_kind IN ('inventory','athlete_cost')),
  notes         text,
  is_active     boolean NOT NULL DEFAULT true,
  sort_order    integer NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  created_by    uuid REFERENCES auth.users(id) ON DELETE SET NULL DEFAULT auth.uid(),
  CHECK ((unit_price IS NULL) = (currency IS NULL))
);

CREATE TABLE public.sponsor_ledger (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  growth_sponsor_id  uuid NOT NULL REFERENCES public.growth_sponsors(id) ON DELETE RESTRICT,  -- financial records must not vanish with a sponsor
  occurred_on        date,
  -- Sponsor side: cash | product | other_contribution.  SwimLoading side: inventory | athlete_cost.
  -- Product is ALWAYS its own kind and is never counted as cash.
  kind               text NOT NULL CHECK (kind IN ('cash','product','other_contribution','inventory','athlete_cost')),
  description        text NOT NULL,
  amount             numeric(14,2) NOT NULL CHECK (amount >= 0),
  currency           text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),     -- per line; no FX in this phase
  status             text NOT NULL DEFAULT 'agreed' CHECK (status IN ('proposed','agreed','delivered','cancelled')),  -- cash 'delivered' = received
  rate_card_id       uuid REFERENCES public.sponsor_rate_card(id) ON DELETE SET NULL,
  campaign_ref       text,
  event_ref          text,
  athlete_name       text,
  notes              text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  created_by         uuid REFERENCES auth.users(id) ON DELETE SET NULL DEFAULT auth.uid()
);

CREATE TABLE public.sponsor_deal_lines (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  growth_sponsor_id  uuid NOT NULL REFERENCES public.growth_sponsors(id) ON DELETE RESTRICT,
  deal_label         text NOT NULL DEFAULT 'Draft deal',
  rate_card_id       uuid REFERENCES public.sponsor_rate_card(id) ON DELETE SET NULL,
  description        text NOT NULL,
  quantity           numeric(10,2) NOT NULL DEFAULT 1 CHECK (quantity > 0),
  unit_price         numeric(14,2) CHECK (unit_price IS NULL OR unit_price >= 0),   -- snapshot of the rate at build time
  currency           text CHECK (currency IS NULL OR currency ~ '^[A-Z]{3}$'),
  ledger_kind        text NOT NULL DEFAULT 'inventory' CHECK (ledger_kind IN ('inventory','athlete_cost')),
  status             text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','proposed','agreed','declined')),
  notes              text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  created_by         uuid REFERENCES auth.users(id) ON DELETE SET NULL DEFAULT auth.uid(),
  CHECK ((unit_price IS NULL) = (currency IS NULL))
);

CREATE INDEX sponsor_contacts_sponsor_idx     ON public.sponsor_contacts(growth_sponsor_id);
CREATE INDEX sponsor_interactions_sponsor_idx ON public.sponsor_interactions(growth_sponsor_id, occurred_at DESC);
CREATE INDEX sponsor_ledger_sponsor_idx       ON public.sponsor_ledger(growth_sponsor_id);
CREATE INDEX sponsor_deal_lines_sponsor_idx   ON public.sponsor_deal_lines(growth_sponsor_id);
CREATE INDEX growth_sponsors_partner_page_idx ON public.growth_sponsors(partner_page_id);

-- updated_at on every table that has it (existing helper)
CREATE TRIGGER trg_sponsor_contacts_updated   BEFORE UPDATE ON public.sponsor_contacts   FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
CREATE TRIGGER trg_sponsor_rate_card_updated  BEFORE UPDATE ON public.sponsor_rate_card  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
CREATE TRIGGER trg_sponsor_ledger_updated     BEFORE UPDATE ON public.sponsor_ledger     FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
CREATE TRIGGER trg_sponsor_deal_lines_updated BEFORE UPDATE ON public.sponsor_deal_lines FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- ---- RLS ---------------------------------------------------------------------
ALTER TABLE public.sponsor_contacts     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sponsor_interactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sponsor_rate_card    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sponsor_ledger       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sponsor_deal_lines   ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.sponsor_contacts, public.sponsor_interactions, public.sponsor_rate_card,
              public.sponsor_ledger, public.sponsor_deal_lines FROM anon;

CREATE POLICY founders_all ON public.sponsor_contacts     FOR ALL TO authenticated USING (public.sponsors_is_founder()) WITH CHECK (public.sponsors_is_founder());
CREATE POLICY founders_all ON public.sponsor_interactions FOR ALL TO authenticated USING (public.sponsors_is_founder()) WITH CHECK (public.sponsors_is_founder());
CREATE POLICY dave_only    ON public.sponsor_rate_card    FOR ALL TO authenticated USING (public.sponsors_is_dave())    WITH CHECK (public.sponsors_is_dave());
CREATE POLICY dave_only    ON public.sponsor_ledger       FOR ALL TO authenticated USING (public.sponsors_is_dave())    WITH CHECK (public.sponsors_is_dave());
CREATE POLICY dave_only    ON public.sponsor_deal_lines   FOR ALL TO authenticated USING (public.sponsors_is_dave())    WITH CHECK (public.sponsors_is_dave());

-- ---- Rate card seed: the five commercial inventory types Dave named. -------
-- NAMES AND UNITS ONLY. No prices: unit_price/currency stay NULL until Dave sets them.
INSERT INTO public.sponsor_rate_card (name, category, unit_label, ledger_kind, sort_order) VALUES
  ('Newsletter placement',   'newsletter',      'placement',        'inventory',    10),
  ('Campaign activation',    'campaign',        'campaign',         'inventory',    20),
  ('Event activation',       'event',           'event',            'inventory',    30),
  ('Athlete content',        'athlete_content', 'piece of content', 'athlete_cost', 40),
  ('Category exclusivity',   'exclusivity',     'period',           'inventory',    50);

COMMIT;

-- ----------------------------------------------------------------
-- ROLLBACK (only valid before any commercial rows are entered; afterwards
-- export the rows first). Nothing here touches existing sponsor data.
-- ----------------------------------------------------------------
-- BEGIN;
-- DROP TABLE public.sponsor_deal_lines, public.sponsor_ledger, public.sponsor_rate_card,
--            public.sponsor_interactions, public.sponsor_contacts;
-- ALTER TABLE public.growth_sponsors
--   DROP CONSTRAINT growth_sponsors_country_chk, DROP CONSTRAINT growth_sponsors_status_chk,
--   DROP COLUMN member_benefit, DROP COLUMN exclusivity, DROP COLUMN athlete_involvement, DROP COLUMN partner_page_id;
-- -- (country NOT NULL is intentionally not restored: NULL-country backfill rows may exist.)
-- DROP FUNCTION public.sponsors_is_dave(), public.sponsors_is_founder();
-- COMMIT;

-- ----------------------------------------------------------------
-- VERIFY (read-only, after apply)
-- ----------------------------------------------------------------
-- SELECT count(*) FROM growth_sponsors;                                                    -- expect 93 (unchanged)
-- SELECT tablename, rowsecurity FROM pg_tables WHERE tablename LIKE 'sponsor\_%' ORDER BY 1; -- expect 5 rows, all true
-- SELECT tablename, policyname, cmd FROM pg_policies WHERE tablename LIKE 'sponsor\_%' ORDER BY 1; -- expect 5 policies
-- SELECT count(*) FROM sponsor_rate_card WHERE unit_price IS NOT NULL;                      -- expect 0 (no invented prices)
-- SELECT conname FROM pg_constraint WHERE conrelid='growth_sponsors'::regclass AND conname LIKE '%\_chk'; -- expect 2
