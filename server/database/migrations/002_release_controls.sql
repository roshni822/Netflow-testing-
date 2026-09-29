-- Additive release controls; 001 remains immutable for existing installations.
CREATE TABLE netflow_private.file_grants (
  path text PRIMARY KEY,
  org_id text NOT NULL REFERENCES netflow.organizations(id) ON DELETE CASCADE,
  owner_id text REFERENCES netflow.users(id) ON DELETE SET NULL,
  version bigint NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE netflow_private.file_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE netflow_private.file_grants FORCE ROW LEVEL SECURITY;
CREATE POLICY file_grants_access ON netflow_private.file_grants
  USING (nullif(current_setting('netflow.system', true), '') IS NOT NULL OR org_id = nullif(current_setting('netflow.org_id', true), ''))
  WITH CHECK (nullif(current_setting('netflow.system', true), '') IS NOT NULL OR org_id = nullif(current_setting('netflow.org_id', true), ''));

-- Audits are append-only except a deliberate, tenant-specific lifecycle operation.
CREATE FUNCTION netflow_private.protect_audit_history() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND current_setting('netflow.system', true) = 'platform'
     AND current_setting('netflow.audit_delete_org', true) = OLD.org_id THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'Audit history is append-only' USING ERRCODE = '42501';
END;
$$;
CREATE TRIGGER audit_history_protection BEFORE UPDATE OR DELETE ON netflow.audit_logs
  FOR EACH ROW EXECUTE FUNCTION netflow_private.protect_audit_history();
REVOKE ALL ON netflow_private.file_grants FROM PUBLIC;

-- Preserve the historical actor ID when an account is deleted.
ALTER TABLE netflow.audit_logs DROP CONSTRAINT audit_logs_performed_by_fk;

CREATE TABLE netflow_private.microsoft_identities (
  user_id text PRIMARY KEY REFERENCES netflow.users(id) ON DELETE CASCADE,
  tenant_id text NOT NULL,
  object_id text NOT NULL,
  UNIQUE(tenant_id, object_id)
);
REVOKE ALL ON netflow_private.microsoft_identities FROM PUBLIC;
