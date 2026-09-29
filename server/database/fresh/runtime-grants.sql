DO $$ BEGIN
  IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='netflow_app') THEN
    CREATE ROLE netflow_app NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  ELSIF EXISTS(SELECT FROM pg_roles WHERE rolname='netflow_app' AND
    (rolcanlogin OR rolsuper OR rolbypassrls OR rolcreatedb OR rolcreaterole OR rolreplication)) THEN
    RAISE EXCEPTION 'Unsafe existing netflow_app role' USING ERRCODE='42501';
  END IF;
END; $$;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA platform,system TO netflow_app;
GRANT SELECT,INSERT,UPDATE,DELETE ON platform.admin_users,platform.admin_roles,platform.admin_auth,
  platform.admin_sessions,platform.admin_mfa_backup_codes TO netflow_app;
GRANT SELECT ON platform.organizations,platform.plans,platform.platform_broadcasts TO netflow_app;
GRANT SELECT,INSERT ON platform.audit_logs TO netflow_app;
GRANT SELECT ON system.schema_migrations,system.microsoft_identities,system.provisioning_operations,system.outbox TO netflow_app;
GRANT SELECT,INSERT,UPDATE ON system.user_directory TO netflow_app;
GRANT SELECT,INSERT,UPDATE,DELETE ON system.resource_routes TO netflow_app;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA system TO netflow_app;
REVOKE UPDATE,DELETE,TRUNCATE ON platform.audit_logs FROM netflow_app;
-- Phase 2 installs a narrow provisioning function. There is deliberately no
-- CREATE privilege and no organization/provisioning mutation grant in Phase 1.
