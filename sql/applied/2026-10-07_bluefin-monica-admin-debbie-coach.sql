-- Bluefin access (Tracey's WhatsApp, Oct 2026)
--   Club: Bluefin (slug bluefin, id 65e64481-8eae-451f-868d-4505a0059b70). Flags: none changed. Shared code: none touched.
--   Monica Theron  -> club_admins role 'admin' (full club admin panel)
--   Debbie Smith   -> club_admins role 'coach' (coach register, /coach/bluefin). Club-wide: there is no squad-scoped role.
--   Ursula Morris  -> NOT included: no SwimLoading account yet (only ursh@bluefinclub.co.za on her club_coaches row).
--   Also links the two existing club_coaches rows to their accounts (user_id was null).
-- Pre-checks (read-only, 7 Oct 2026): neither user has a club_admins row for Bluefin; accounts exist
--   monica23@live.co.za = 4eca760a-55c0-47b7-919b-67aaa566a78c, debbiejoysmith@gmail.com = 11ec21d8-fde9-499f-a3c9-825b5445158b.
-- MIGRATION — applied only after Dave types "apply".
BEGIN;

INSERT INTO club_admins (club_id, user_id, role) VALUES
  ('65e64481-8eae-451f-868d-4505a0059b70', '4eca760a-55c0-47b7-919b-67aaa566a78c', 'admin'),
  ('65e64481-8eae-451f-868d-4505a0059b70', '11ec21d8-fde9-499f-a3c9-825b5445158b', 'coach')
ON CONFLICT (club_id, user_id) DO NOTHING;

UPDATE club_coaches SET user_id = '4eca760a-55c0-47b7-919b-67aaa566a78c'
 WHERE club_id = '65e64481-8eae-451f-868d-4505a0059b70' AND name = 'Monica Theron' AND user_id IS NULL;
UPDATE club_coaches SET user_id = '11ec21d8-fde9-499f-a3c9-825b5445158b'
 WHERE club_id = '65e64481-8eae-451f-868d-4505a0059b70' AND name = 'Debbie Smith' AND user_id IS NULL;

COMMIT;

-- VERIFY (read-only):
--   SELECT user_id, role FROM club_admins WHERE club_id='65e64481-8eae-451f-868d-4505a0059b70';   -- expect 4 rows
--   SELECT name, user_id FROM club_coaches WHERE club_id='65e64481-8eae-451f-868d-4505a0059b70';
-- ROLLBACK (manual):
--   DELETE FROM club_admins WHERE club_id='65e64481-8eae-451f-868d-4505a0059b70' AND user_id IN ('4eca760a-55c0-47b7-919b-67aaa566a78c','11ec21d8-fde9-499f-a3c9-825b5445158b');
--   UPDATE club_coaches SET user_id=NULL WHERE club_id='65e64481-8eae-451f-868d-4505a0059b70' AND name IN ('Monica Theron','Debbie Smith');
