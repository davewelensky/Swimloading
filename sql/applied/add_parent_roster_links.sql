-- Parent-roster linking table
-- Supports many-to-many: one parent → many swimmers, one swimmer → many parents
-- Each link has a relationship label (Mother, Father, Guardian, Stepparent, etc.)
-- Britt approves all links before the parent gains access

CREATE TABLE IF NOT EXISTS parent_roster_links (
  id              UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  parent_user_id  UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  roster_id       UUID        NOT NULL REFERENCES club_roster(id) ON DELETE CASCADE,
  club_id         UUID        NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  relationship    TEXT        NOT NULL DEFAULT 'Guardian',
  status          TEXT        NOT NULL DEFAULT 'pending'
                              CHECK (status IN ('pending','approved','revoked')),
  approved_by     UUID        REFERENCES auth.users(id),
  approved_at     TIMESTAMPTZ,
  invited_by      UUID        REFERENCES auth.users(id), -- set when admin creates the link
  notes           TEXT,       -- admin can note e.g. "emergency contact only"
  created_at      TIMESTAMPTZ DEFAULT now(),
  UNIQUE (parent_user_id, roster_id)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_prl_parent  ON parent_roster_links (parent_user_id);
CREATE INDEX IF NOT EXISTS idx_prl_roster  ON parent_roster_links (roster_id);
CREATE INDEX IF NOT EXISTS idx_prl_club    ON parent_roster_links (club_id);
CREATE INDEX IF NOT EXISTS idx_prl_status  ON parent_roster_links (status);

-- RLS
ALTER TABLE parent_roster_links ENABLE ROW LEVEL SECURITY;

-- Parents can see their own links (all statuses — so they know if still pending)
CREATE POLICY "parent can view own links"
  ON parent_roster_links FOR SELECT
  USING (parent_user_id = auth.uid());

-- Parents can create pending requests (self-register flow)
CREATE POLICY "parent can request link"
  ON parent_roster_links FOR INSERT
  WITH CHECK (
    parent_user_id = auth.uid()
    AND status = 'pending'
    AND invited_by IS NULL
  );

-- Club admins can view all links for their club
CREATE POLICY "club admin can view club links"
  ON parent_roster_links FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM club_admins ca
      WHERE ca.user_id = auth.uid() AND ca.club_id = parent_roster_links.club_id
    )
    OR
    EXISTS (
      SELECT 1 FROM club_members cm
      WHERE cm.user_id = auth.uid()
        AND cm.club_id = parent_roster_links.club_id
        AND cm.role IN ('admin','organiser')
        AND cm.is_active = true
    )
  );

-- Club admins can insert links (manual invite flow)
CREATE POLICY "club admin can insert link"
  ON parent_roster_links FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM club_admins ca
      WHERE ca.user_id = auth.uid() AND ca.club_id = parent_roster_links.club_id
    )
    OR
    EXISTS (
      SELECT 1 FROM club_members cm
      WHERE cm.user_id = auth.uid()
        AND cm.club_id = parent_roster_links.club_id
        AND cm.role IN ('admin','organiser')
        AND cm.is_active = true
    )
  );

-- Club admins can update status (approve / revoke)
CREATE POLICY "club admin can update link status"
  ON parent_roster_links FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM club_admins ca
      WHERE ca.user_id = auth.uid() AND ca.club_id = parent_roster_links.club_id
    )
    OR
    EXISTS (
      SELECT 1 FROM club_members cm
      WHERE cm.user_id = auth.uid()
        AND cm.club_id = parent_roster_links.club_id
        AND cm.role IN ('admin','organiser')
        AND cm.is_active = true
    )
  );

-- Parents can delete their own pending requests (withdraw before approved)
CREATE POLICY "parent can withdraw pending request"
  ON parent_roster_links FOR DELETE
  USING (parent_user_id = auth.uid() AND status = 'pending');
