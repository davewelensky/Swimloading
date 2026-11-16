-- ⚠️  SAFETY CHECK: runs first, aborts everything if wrong project
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM _project_identity
    WHERE key = 'project_name' AND value = 'swimloading'
  ) THEN
    RAISE EXCEPTION
      E'\n\n'
      '╔══════════════════════════════════════════════════════════╗\n'
      '║  WRONG PROJECT: MIGRATION ABORTED                        ║\n'
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
-- Migration: 2026-11-16_partner-enquiries.sql
-- Process:   see MIGRATIONS.md
-- ================================================================

-- Purpose:
--   Create partner_enquiries, the lead table behind the "Register your
--   interest" form on /partners/jaked. SwimLoading coordinates South African
--   JAKED enquiries and confirmed orders by hand: this is NOT a shop (no cart,
--   payment, stock, pricing or shipping logic anywhere).
--
--   Generic on purpose (partner column) so a later partner can reuse it, but
--   the CHECK only allows 'jaked' until another partner is explicitly added.
--
--   Security model: SERVER ONLY. RLS is on with NO policies, and anon /
--   authenticated have every privilege revoked. The browser never touches this
--   table. Writes go through /api/partner-enquiry (validation, honeypot, rate
--   limit, service key); reads and status updates go through
--   /api/partner-enquiries, which checks profiles.is_admin on the caller's
--   own session token first. Customer contact details therefore cannot leak
--   through the public REST API.
--
--   Nothing here touches any existing table.

-- Requested by:
--   Dave (SwimLoading partner: JAKED), 16 Nov 2026. Not a club change.

-- ----------------------------------------------------------------
-- PRE-CHECKS: run READ-ONLY before applying.
-- ----------------------------------------------------------------
-- Expect: 0 (table must not already exist)
-- SELECT count(*) FROM information_schema.tables
--  WHERE table_schema = 'public' AND table_name = 'partner_enquiries';
--
-- Expect: 1 (gen_random_uuid available, as for swim_lab_enquiries)
-- SELECT count(*) FROM pg_proc WHERE proname = 'gen_random_uuid';

-- ----------------------------------------------------------------
-- BACKUP: not required. This migration is CREATE-only:
-- no DELETE / UPDATE / DROP / TRUNCATE against existing data.
-- ----------------------------------------------------------------

-- ----------------------------------------------------------------
-- MIGRATION: applied only after Dave types "apply".
-- ----------------------------------------------------------------
BEGIN;

CREATE TABLE public.partner_enquiries (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  status_changed_at timestamptz NOT NULL DEFAULT now(),

  partner           text        NOT NULL,             -- 'jaked'
  reference         text        NOT NULL UNIQUE,      -- 'JKD-7KQ2MD', shown to the customer
  source            text,                             -- page the form sat on, e.g. 'partners/jaked'

  customer_name     text        NOT NULL,
  email             text        NOT NULL,
  phone             text,

  product_category  text        NOT NULL,             -- open_water_wetsuit | racing_swimsuit | training_swimwear
  preferred_model   text,                             -- free text, e.g. 'BLADE'
  fit               text,                             -- womens | mens | unisex | not_sure | null
  size              text,                             -- free text: JAKED size charts are not on file
  size_help         boolean     NOT NULL DEFAULT false, -- "Not sure, I need sizing help"
  colour            text,
  quantity          integer     NOT NULL DEFAULT 1,
  comments          text,

  consent_contact   boolean     NOT NULL,
  consent_text      text        NOT NULL,             -- the exact wording they ticked
  user_id           uuid,                             -- SwimLoading member, when signed in (no FK: see club FK gotcha)
  ip_hash           text,                             -- sha256, only for the submit rate limit; never the raw IP

  status            text        NOT NULL DEFAULT 'new',
  internal_notes    text,
  updated_by        uuid,                             -- admin who last changed status or notes

  CONSTRAINT partner_enquiries_partner_vals    CHECK (partner IN ('jaked')),
  CONSTRAINT partner_enquiries_reference_shape CHECK (reference ~ '^[A-Z]{3}-[A-Z0-9]{6}$'),
  CONSTRAINT partner_enquiries_source_len      CHECK (source IS NULL OR char_length(source) <= 120),
  CONSTRAINT partner_enquiries_name_len        CHECK (char_length(customer_name) BETWEEN 1 AND 120),
  CONSTRAINT partner_enquiries_email_len       CHECK (char_length(email) BETWEEN 3 AND 254),
  CONSTRAINT partner_enquiries_email_shape     CHECK (email LIKE '%_@_%._%'),
  CONSTRAINT partner_enquiries_phone_len       CHECK (phone IS NULL OR char_length(phone) <= 40),
  CONSTRAINT partner_enquiries_category_vals   CHECK (product_category IN ('open_water_wetsuit','racing_swimsuit','training_swimwear')),
  CONSTRAINT partner_enquiries_model_len       CHECK (preferred_model IS NULL OR char_length(preferred_model) <= 120),
  CONSTRAINT partner_enquiries_fit_vals        CHECK (fit IS NULL OR fit IN ('womens','mens','unisex','not_sure')),
  CONSTRAINT partner_enquiries_size_len        CHECK (size IS NULL OR char_length(size) <= 40),
  CONSTRAINT partner_enquiries_colour_len      CHECK (colour IS NULL OR char_length(colour) <= 60),
  CONSTRAINT partner_enquiries_quantity_range  CHECK (quantity BETWEEN 1 AND 20),
  CONSTRAINT partner_enquiries_comments_len    CHECK (comments IS NULL OR char_length(comments) <= 2000),
  CONSTRAINT partner_enquiries_consent_given   CHECK (consent_contact = true),
  CONSTRAINT partner_enquiries_consent_len     CHECK (char_length(consent_text) BETWEEN 1 AND 500),
  CONSTRAINT partner_enquiries_ip_hash_len     CHECK (ip_hash IS NULL OR char_length(ip_hash) <= 64),
  CONSTRAINT partner_enquiries_notes_len       CHECK (internal_notes IS NULL OR char_length(internal_notes) <= 4000),
  CONSTRAINT partner_enquiries_status_vals     CHECK (status IN (
    'new','contacted','awaiting_pricing','quoted','confirmed',
    'ordered_from_jaked','shipped','completed','cancelled'))
);

CREATE INDEX partner_enquiries_partner_created_idx ON public.partner_enquiries (partner, created_at DESC);
CREATE INDEX partner_enquiries_email_created_idx   ON public.partner_enquiries (lower(email), created_at DESC);
CREATE INDEX partner_enquiries_ip_created_idx      ON public.partner_enquiries (ip_hash, created_at DESC);

-- Server only. RLS on with no policies denies anon and authenticated
-- everything; the REVOKE is belt and braces against default grants.
ALTER TABLE public.partner_enquiries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.partner_enquiries FROM anon, authenticated;

COMMENT ON TABLE public.partner_enquiries IS
  'Product enquiries from partner pages (JAKED first). Server-only: no RLS policies; written by /api/partner-enquiry, read and updated by admins via /api/partner-enquiries.';

COMMIT;

-- ----------------------------------------------------------------
-- ROLLBACK
-- ----------------------------------------------------------------
-- DROP TABLE IF EXISTS public.partner_enquiries;
-- (Safe while empty. If enquiries have been captured, export the CSV from
--  /partner-enquiries first. They exist nowhere else.)

-- ----------------------------------------------------------------
-- VERIFY: run READ-ONLY after applying.
-- ----------------------------------------------------------------
-- SELECT count(*) FROM public.partner_enquiries;
--   -- expect: 0
--
-- SELECT relrowsecurity FROM pg_class WHERE relname = 'partner_enquiries';
--   -- expect: true
--
-- SELECT count(*) FROM pg_policies
--  WHERE schemaname = 'public' AND tablename = 'partner_enquiries';
--   -- expect: 0
--
-- SELECT grantee, privilege_type FROM information_schema.role_table_grants
--  WHERE table_schema = 'public' AND table_name = 'partner_enquiries'
--    AND grantee IN ('anon','authenticated');
--   -- expect: 0 rows
