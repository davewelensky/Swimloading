BEGIN;
GRANT EXECUTE ON FUNCTION jaked_log_change(), jaked_tasks_before_write(),
  jaked_activity_log_immutable(), grant_role(uuid, text, text, uuid, jsonb),
  revoke_role(uuid), has_role(text, text, uuid), can_manage_partner(uuid),
  jaked_partner_id() TO PUBLIC, anon, authenticated;
GRANT ALL ON user_roles, jaked_activity_log TO anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON jaked_activity_log FROM anon;   -- as the workspace migration left it
COMMIT;
