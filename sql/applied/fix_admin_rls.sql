-- Fix admin RLS permissions
-- Run in Supabase SQL editor before deploying JS

-- Spotlights: admins can SELECT, INSERT, UPDATE, DELETE any spotlight
DROP POLICY IF EXISTS "Admins can manage spotlights" ON spotlights;
CREATE POLICY "Admins can manage spotlights"
    ON spotlights FOR ALL
    USING (
        EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true)
    )
    WITH CHECK (
        EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true)
    );
