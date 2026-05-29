-- ================================================================
-- Migration: add_sessions_json.sql
--
-- Adds sessions_json and course to club_events so swimmer portal
-- can show per-session event lists with level-based QT gating.
-- ================================================================

ALTER TABLE club_events
  ADD COLUMN IF NOT EXISTS sessions_json JSONB,
  ADD COLUMN IF NOT EXISTS course        text NOT NULL DEFAULT 'LC'
    CHECK (course IN ('LC','SC'));
