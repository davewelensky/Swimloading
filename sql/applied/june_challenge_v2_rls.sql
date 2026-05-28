-- June Challenge v2 — RLS Policies (Step 8)
-- Run AFTER june_challenge_v2_tables.sql

-- ── challenge_points_audit ───────────────────────────────────────────────────

ALTER TABLE challenge_points_audit ENABLE ROW LEVEL SECURITY;

-- Users can read only their own audit records
CREATE POLICY "audit_users_own_read" ON challenge_points_audit
  FOR SELECT USING (auth.uid() = user_id);

-- No direct inserts from clients — all writes go via award_challenge_points (SECURITY DEFINER)
-- (No INSERT policy needed; the function bypasses RLS)

-- ── challenge_admin_flags ────────────────────────────────────────────────────

ALTER TABLE challenge_admin_flags ENABLE ROW LEVEL SECURITY;

-- Users can read their own flags (to check disqualification status)
CREATE POLICY "flags_users_own_read" ON challenge_admin_flags
  FOR SELECT USING (auth.uid() = user_id);

-- No direct writes from clients — admin functions are SECURITY DEFINER
