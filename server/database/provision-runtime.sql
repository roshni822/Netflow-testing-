-- Run as the development/staging migration administrator after 001_initial.sql.
-- Supply a separate LOGIN role and password through the provider's secret tools.
-- Grant that login membership in netflow_app. Never use the schema owner in the API.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'netflow_app') THEN
    CREATE ROLE netflow_app NOLOGIN NOSUPERUSER NOBYPASSRLS;
  END IF;
END
$$;
GRANT USAGE ON SCHEMA netflow, netflow_private TO netflow_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA netflow, netflow_private TO netflow_app;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA netflow, netflow_private TO netflow_app;
GRANT USAGE ON SCHEMA netflow_migration TO netflow_app;
GRANT SELECT ON netflow_migration.schema_versions TO netflow_app;
-- Schema version metadata is read-only to the runtime role.
-- No grants to Supabase anon/authenticated/service_role are necessary.

-- No runtime audit edits or truncation. Deletes pass the tenant-specific trigger.
REVOKE UPDATE, TRUNCATE ON netflow.audit_logs FROM netflow_app;
-- SELECT FOR UPDATE used by the deletion repository needs one column grant.
-- The trigger still rejects every UPDATE, including updates to id.
GRANT UPDATE (id) ON netflow.audit_logs TO netflow_app;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON netflow_private.microsoft_identities FROM netflow_app;
