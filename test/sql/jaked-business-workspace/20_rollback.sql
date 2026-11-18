BEGIN;
DROP TRIGGER IF EXISTS user_roles_jaked_activity_log ON user_roles;
DELETE FROM user_roles WHERE user_id = 'cff2fc33-4a55-451b-8c7f-20f12c1898ce'
  AND role = 'partner_manager' AND resource_id = 'eb8644d9-28d2-4d08-87f1-4230da07e1c5';
DROP TABLE IF EXISTS jaked_tasks;
DROP FUNCTION IF EXISTS jaked_tasks_before_write();
DROP TRIGGER IF EXISTS partner_enquiries_activity_log ON partner_enquiries;
DROP INDEX IF EXISTS partner_enquiries_partner_status_idx;
-- only if no manual enquiry without an email exists (else restore from backup):
ALTER TABLE partner_enquiries DROP CONSTRAINT IF EXISTS partner_enquiries_contact_present;
ALTER TABLE partner_enquiries ALTER COLUMN email SET NOT NULL;
ALTER TABLE partner_enquiries DROP CONSTRAINT IF EXISTS partner_enquiries_manual_has_author,
  DROP CONSTRAINT IF EXISTS partner_enquiries_channel_vals,
  DROP CONSTRAINT IF EXISTS partner_enquiries_entry_method_vals;
ALTER TABLE partner_enquiries DROP COLUMN IF EXISTS assigned_to, DROP COLUMN IF EXISTS created_by,
  DROP COLUMN IF EXISTS channel, DROP COLUMN IF EXISTS entry_method;
DROP TRIGGER IF EXISTS jaked_activity_log_no_update_delete ON jaked_activity_log;
DROP TRIGGER IF EXISTS jaked_activity_log_no_truncate ON jaked_activity_log;
DROP TABLE IF EXISTS jaked_activity_log;
DROP FUNCTION IF EXISTS jaked_log_change();
DROP FUNCTION IF EXISTS jaked_activity_log_immutable();
DROP FUNCTION IF EXISTS can_manage_partner(uuid);
DROP FUNCTION IF EXISTS jaked_partner_id();
COMMIT;
