-- ================================================================
-- SwimLoading — Project Identity & Safety Guard
-- Migration: project_identity.sql
-- ================================================================
-- Run this ONCE in the SwimLoading Supabase project.
-- Confirms project ref: szgkzuswelntnevobnoh
-- ================================================================
-- ⚠️  VERIFY YOU ARE HERE FIRST:
-- https://supabase.com/dashboard/project/szgkzuswelntnevobnoh/sql/new
-- ================================================================

CREATE TABLE IF NOT EXISTS _project_identity (
  key   text PRIMARY KEY,
  value text NOT NULL,
  note  text
);

INSERT INTO _project_identity (key, value, note) VALUES
  ('project_name', 'swimloading',           'Human-readable name of this Supabase project'),
  ('project_ref',  'szgkzuswelntnevobnoh',  'Supabase project ref — appears in dashboard URL'),
  ('product',      'SwimLoading',            'Product name'),
  ('environment',  'production',             'production | staging | dev'),
  ('owner',        'dave.welensky@gmail.com','Primary owner email')
ON CONFLICT (key) DO NOTHING;

ALTER TABLE _project_identity ENABLE ROW LEVEL SECURITY;
CREATE POLICY "identity_read_all" ON _project_identity FOR SELECT USING (true);

-- Quick check — should return swimloading
SELECT key, value FROM _project_identity ORDER BY key;
