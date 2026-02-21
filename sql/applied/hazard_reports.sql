-- Hazard / Incident Reporting System
-- Applied: 2026-02-21
--
-- Manual Supabase steps BEFORE running this:
--   1. Create 'hazards' storage bucket in Supabase Dashboard → Storage
--      Settings: Public = true, Max file size = 5242880 (5MB)
--
-- Then run this entire file in Supabase SQL Editor.

-- ── 1. hazard_reports table ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS hazard_reports (
    id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id         UUID REFERENCES profiles(id) ON DELETE SET NULL,
    spot_id         UUID REFERENCES spots(id) ON DELETE CASCADE,
    hazard_type     TEXT NOT NULL CHECK (hazard_type IN (
                        'seal_aggression', 'shark_sighting', 'jellyfish', 'sewage',
                        'pollution', 'rip_current', 'beach_closure', 'other'
                    )),
    severity        TEXT NOT NULL DEFAULT 'caution' CHECK (severity IN ('info', 'caution', 'danger')),
    title           TEXT NOT NULL,
    description     TEXT,
    photo_url       TEXT,
    active_until    TIMESTAMPTZ,    -- NULL = indefinite
    resolved_at     TIMESTAMPTZ,    -- NULL = still active
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ── 2. RLS on hazard_reports ────────────────────────────────────────────────

ALTER TABLE hazard_reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone authenticated can read hazards"
ON hazard_reports FOR SELECT TO authenticated
USING (true);

CREATE POLICY "Authenticated users can insert hazards"
ON hazard_reports FOR INSERT TO authenticated
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own hazards"
ON hazard_reports FOR UPDATE TO authenticated
USING (auth.uid() = user_id);

-- ── 3. Storage RLS for 'hazards' bucket ────────────────────────────────────
-- Run after creating the 'hazards' bucket in Supabase Dashboard → Storage

CREATE POLICY "Authenticated users can upload hazard photos"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'hazards');

CREATE POLICY "Hazard photos are publicly readable"
ON storage.objects FOR SELECT TO public
USING (bucket_id = 'hazards');

-- ── 4. Add spot_id to swim_events (for future swims) ───────────────────────

ALTER TABLE swim_events ADD COLUMN IF NOT EXISTS spot_id UUID REFERENCES spots(id);
