BEGIN;
DROP FUNCTION IF EXISTS jaked_business_save(integer, jsonb, text);
DROP TABLE IF EXISTS jaked_business_workspace;
DROP TABLE IF EXISTS jaked_business_catalogue;
COMMIT;
