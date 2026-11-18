-- Minimal Supabase-like stub mirroring production objects these migrations touch.
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname=$q$anon$q$) THEN CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF; END $$;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
CREATE SCHEMA auth; GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
CREATE TABLE auth.users (id uuid PRIMARY KEY, email text);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;
INSERT INTO auth.users VALUES
 ('df137255-3add-4153-b368-32e06e2be188','dave.welensky@gmail.com'),
 ('cff2fc33-4a55-451b-8c7f-20f12c1898ce','carina@example.test'),
 ('11111111-1111-1111-1111-111111111111','someone@example.com');
CREATE TABLE _project_identity (key text, value text);
INSERT INTO _project_identity VALUES ('project_name','swimloading');
CREATE TABLE partner_pages (id uuid PRIMARY KEY, name text);
INSERT INTO partner_pages VALUES ('eb8644d9-28d2-4d08-87f1-4230da07e1c5','JAKED');
-- partner_enquiries as in production (columns, NOT NULLs, defaults, checks; read 18 Nov 2026)
CREATE TABLE partner_enquiries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  status_changed_at timestamptz NOT NULL DEFAULT now(), partner text NOT NULL, reference text NOT NULL UNIQUE, source text,
  customer_name text NOT NULL, email text NOT NULL, phone text, product_category text NOT NULL, preferred_model text, fit text, size text,
  size_help boolean NOT NULL DEFAULT false, colour text, quantity integer NOT NULL DEFAULT 1, comments text, consent_contact boolean NOT NULL,
  consent_text text NOT NULL, user_id uuid, ip_hash text, status text NOT NULL DEFAULT 'new', internal_notes text, updated_by uuid,
  CONSTRAINT partner_enquiries_category_vals CHECK (product_category = ANY (ARRAY['open_water_wetsuit','racing_swimsuit','training_swimwear'])),
  CONSTRAINT partner_enquiries_consent_given CHECK (consent_contact = true),
  CONSTRAINT partner_enquiries_email_len CHECK (char_length(email) >= 3 AND char_length(email) <= 254),
  CONSTRAINT partner_enquiries_email_shape CHECK (email ~~ '%_@_%._%'),
  CONSTRAINT partner_enquiries_partner_vals CHECK (partner = 'jaked'),
  CONSTRAINT partner_enquiries_reference_shape CHECK (reference ~ '^[A-Z]{3}-[A-Z0-9]{6}$'),
  CONSTRAINT partner_enquiries_status_vals CHECK (status = ANY (ARRAY['new','contacted','awaiting_pricing','quoted','confirmed','ordered_from_jaked','shipped','completed','cancelled']))
);
ALTER TABLE partner_enquiries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON partner_enquiries FROM anon, authenticated;
INSERT INTO partner_enquiries (partner, reference, customer_name, email, product_category, preferred_model, consent_contact, consent_text)
VALUES ('jaked','JKD-ABC123','Test Customer','t@example.com','open_water_wetsuit','BLADE',true,'I agree');
