CREATE TABLE system.schema_migrations (
  schema_name text NOT NULL,
  version text NOT NULL,
  scope text NOT NULL CHECK(scope IN ('platform','system','tenant')),
  org_id text REFERENCES platform.organizations(id),
  checksum text NOT NULL CHECK(checksum ~ '^[0-9a-f]{64}$'),
  release_id text NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(schema_name,version),
  CHECK((scope='tenant' AND org_id IS NOT NULL AND schema_name LIKE 'tenant\_%') OR
        (scope IN ('platform','system') AND org_id IS NULL AND schema_name=scope))
);
CREATE UNIQUE INDEX tenant_migration_version ON system.schema_migrations(org_id,version) WHERE scope='tenant';

CREATE TABLE system.user_directory (
  user_id text PRIMARY KEY CHECK(user_id ~ '^[0-9a-f]{24}$'),
  org_id text REFERENCES platform.organizations(id),
  email_key text,
  account_scope text NOT NULL CHECK(account_scope IN ('platform','tenant')),
  state text NOT NULL CHECK(state IN ('active','inactive','deleted')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  UNIQUE(org_id,user_id), UNIQUE(account_scope,user_id),
  CHECK((account_scope='platform' AND org_id IS NULL) OR (account_scope='tenant' AND org_id IS NOT NULL)),
  CHECK((state='deleted' AND email_key IS NULL AND deleted_at IS NOT NULL) OR
        (state<>'deleted' AND email_key IS NOT NULL AND deleted_at IS NULL)),
  CHECK(email_key IS NULL OR email_key=lower(btrim(email_key)))
);
CREATE UNIQUE INDEX directory_platform_email ON system.user_directory(email_key) WHERE account_scope='platform' AND state<>'deleted';
CREATE UNIQUE INDEX directory_tenant_email ON system.user_directory(org_id,email_key) WHERE account_scope='tenant' AND state<>'deleted';
CREATE INDEX directory_email_lookup ON system.user_directory(email_key) WHERE state<>'deleted';
ALTER TABLE platform.admin_users ADD CONSTRAINT admin_directory_fk FOREIGN KEY(account_scope,id)
  REFERENCES system.user_directory(account_scope,user_id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE platform.organizations ADD CONSTRAINT organization_admin_tenant_fk FOREIGN KEY(id,admin_user_id)
  REFERENCES system.user_directory(org_id,user_id) DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE system.provisioning_operations (
  id text PRIMARY KEY CHECK(id ~ '^[0-9a-f]{24}$'),
  actor_admin_id text NOT NULL REFERENCES platform.admin_users(id),
  idempotency_key text NOT NULL CHECK(length(idempotency_key) BETWEEN 16 AND 200),
  request_fingerprint text NOT NULL CHECK(request_fingerprint ~ '^[0-9a-f]{64}$'),
  org_id text REFERENCES platform.organizations(id),
  status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','running','succeeded','failed')),
  attempts integer NOT NULL DEFAULT 0 CHECK(attempts>=0),
  error_code text, created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz,
  UNIQUE(actor_admin_id,idempotency_key)
);
CREATE INDEX provisioning_pending ON system.provisioning_operations(created_at,id) WHERE status IN ('pending','running');

CREATE TABLE system.resource_routes (
  purpose text NOT NULL CHECK(purpose IN ('public_form','inbound_webhook','execution_status','password_reset')),
  token_digest text NOT NULL CHECK(token_digest ~ '^[0-9a-f]{64}$'),
  account_scope text NOT NULL CHECK(account_scope IN ('platform','tenant')),
  org_id text REFERENCES platform.organizations(id),
  resource_id text NOT NULL,
  expires_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(purpose,token_digest),
  CHECK((account_scope='tenant' AND org_id IS NOT NULL) OR
        (account_scope='platform' AND org_id IS NULL AND purpose='password_reset')),
  CHECK(purpose<>'password_reset' OR expires_at IS NOT NULL)
);
CREATE INDEX resource_routes_owner ON system.resource_routes(org_id,purpose,resource_id);
CREATE INDEX resource_routes_expiry ON system.resource_routes(expires_at) WHERE expires_at IS NOT NULL;

CREATE TABLE system.outbox (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  account_scope text NOT NULL CHECK(account_scope IN ('platform','tenant')),
  org_id text REFERENCES platform.organizations(id),
  event_key text NOT NULL UNIQUE, event_type text NOT NULL,
  delivery_purpose text NOT NULL CHECK(delivery_purpose IN ('business','recovery','platform')),
  payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','processing','sent','failed')),
  attempts integer NOT NULL DEFAULT 0 CHECK(attempts>=0),
  retry_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz,
  CHECK((account_scope='tenant' AND org_id IS NOT NULL) OR
        (account_scope='platform' AND org_id IS NULL AND delivery_purpose IN ('platform','recovery')))
);
CREATE INDEX outbox_pending ON system.outbox(retry_at,id) WHERE status IN ('pending','failed');
CREATE TABLE system.microsoft_identities (
  user_id text PRIMARY KEY REFERENCES system.user_directory(user_id),
  tenant_id text NOT NULL, object_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(tenant_id,object_id)
);

-- Invoker rights: application grants and policies still apply. The backend is a
-- trusted service; setting a GUC is not a security boundary against a compromised
-- runtime credential. These policies prevent accidental unscoped access.
CREATE FUNCTION system.sync_user_directory() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,system AS $$
DECLARE
  identity_id text := CASE WHEN TG_OP='DELETE' THEN OLD.id ELSE NEW.id END;
  organization_id text := nullif(TG_ARGV[1],'');
  current_state text;
BEGIN
  IF TG_OP='UPDATE' AND NEW.id<>OLD.id THEN
    RAISE EXCEPTION 'Account identity is immutable' USING ERRCODE='23514';
  END IF;
  IF TG_OP='DELETE' THEN
    UPDATE system.user_directory SET state='deleted',email_key=NULL,deleted_at=now(),updated_at=now() WHERE user_id=identity_id;
    RETURN OLD;
  END IF;
  current_state := CASE WHEN NEW.deleted_at IS NOT NULL THEN 'deleted' WHEN NEW.is_active IS FALSE THEN 'inactive' ELSE 'active' END;
  INSERT INTO system.user_directory(user_id,org_id,email_key,account_scope,state,deleted_at)
    VALUES(identity_id,organization_id,CASE WHEN current_state='deleted' THEN NULL ELSE lower(btrim(NEW.email)) END,TG_ARGV[0],current_state,NEW.deleted_at)
  ON CONFLICT(user_id) DO UPDATE SET email_key=EXCLUDED.email_key,state=EXCLUDED.state,
    deleted_at=EXCLUDED.deleted_at,updated_at=now()
    WHERE system.user_directory.account_scope=EXCLUDED.account_scope AND system.user_directory.org_id IS NOT DISTINCT FROM EXCLUDED.org_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Account scope collision' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END; $$;

CREATE FUNCTION system.check_user_directory() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,system AS $$
DECLARE d record; profile record; target_schema text; target_table text; identity_id text;
BEGIN
  IF TG_TABLE_NAME='user_directory' THEN identity_id:=NEW.user_id; ELSE identity_id:=NEW.id; END IF;
  SELECT * INTO d FROM system.user_directory WHERE user_id=identity_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Missing account directory' USING ERRCODE='23514'; END IF;
  IF d.account_scope='platform' THEN target_schema:='platform'; target_table:='admin_users';
  ELSE SELECT schema_name INTO target_schema FROM platform.organizations WHERE id=d.org_id; target_table:='users'; END IF;
  IF target_schema IS NULL OR (d.account_scope='tenant' AND target_schema !~ '^tenant_[a-z0-9]+(_[a-z0-9]+)*$') THEN
    RAISE EXCEPTION 'Invalid account placement' USING ERRCODE='23514';
  END IF;
  EXECUTE format('SELECT email,is_active,deleted_at FROM %I.%I WHERE id=$1',target_schema,target_table) INTO profile USING d.user_id;
  IF profile.email IS NULL THEN
    IF d.state<>'deleted' THEN RAISE EXCEPTION 'Directory has no profile' USING ERRCODE='23514'; END IF;
  ELSIF d.email_key IS DISTINCT FROM (CASE WHEN profile.deleted_at IS NOT NULL THEN NULL ELSE lower(btrim(profile.email)) END)
    OR d.state IS DISTINCT FROM (CASE WHEN profile.deleted_at IS NOT NULL THEN 'deleted' WHEN profile.is_active IS FALSE THEN 'inactive' ELSE 'active' END)
    OR d.deleted_at IS DISTINCT FROM profile.deleted_at THEN
    RAISE EXCEPTION 'Directory/profile mismatch' USING ERRCODE='23514';
  END IF;
  RETURN NULL;
END; $$;
CREATE TRIGGER admin_directory_sync AFTER INSERT OR UPDATE OR DELETE ON platform.admin_users FOR EACH ROW EXECUTE FUNCTION system.sync_user_directory('platform','');
CREATE CONSTRAINT TRIGGER admin_directory_consistency AFTER INSERT OR UPDATE ON platform.admin_users DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION system.check_user_directory();
CREATE CONSTRAINT TRIGGER directory_profile_consistency AFTER INSERT OR UPDATE ON system.user_directory DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION system.check_user_directory();

CREATE FUNCTION system.check_directory_actor() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,system AS $$
DECLARE actor_id text := to_jsonb(NEW)->>TG_ARGV[0]; d record;
BEGIN
  IF actor_id IS NULL THEN RETURN NEW; END IF;
  SELECT account_scope,org_id INTO d FROM system.user_directory WHERE user_id=actor_id;
  IF NOT FOUND OR (d.account_scope<>'platform' AND d.org_id IS DISTINCT FROM NEW.org_id) THEN
    RAISE EXCEPTION 'Actor belongs to another organization' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END; $$;

CREATE FUNCTION system.protect_audit_history() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN RAISE EXCEPTION 'Audit history is append-only' USING ERRCODE='42501'; END; $$;
CREATE TRIGGER platform_audit_history BEFORE UPDATE OR DELETE ON platform.audit_logs FOR EACH ROW EXECUTE FUNCTION system.protect_audit_history();

CREATE FUNCTION system.protect_organization_placement() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
  IF NEW.id<>OLD.id OR NEW.schema_name<>OLD.schema_name THEN
    RAISE EXCEPTION 'Organization placement is immutable' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER organization_placement BEFORE UPDATE ON platform.organizations FOR EACH ROW EXECUTE FUNCTION system.protect_organization_placement();

-- Reset routing and credential updates commit together, including token removal.
CREATE FUNCTION system.sync_admin_reset_route() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,system AS $$
BEGIN
  DELETE FROM system.resource_routes WHERE purpose='password_reset' AND account_scope='platform'
    AND resource_id=CASE WHEN TG_OP='DELETE' THEN OLD.owner_id ELSE NEW.owner_id END;
  IF TG_OP<>'DELETE' AND NEW.reset_password_token IS NOT NULL AND NEW.reset_password_expires IS NOT NULL THEN
    INSERT INTO system.resource_routes(purpose,token_digest,account_scope,resource_id,expires_at)
      VALUES('password_reset',NEW.reset_password_token,'platform',NEW.owner_id,NEW.reset_password_expires);
  END IF;
  RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END; $$;
CREATE TRIGGER admin_reset_route AFTER INSERT OR UPDATE OR DELETE ON platform.admin_auth FOR EACH ROW EXECUTE FUNCTION system.sync_admin_reset_route();

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['admin_users','admin_roles','admin_auth','admin_sessions','admin_mfa_backup_codes','organizations','plans','platform_broadcasts','audit_logs'] LOOP
    EXECUTE format('ALTER TABLE platform.%I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('ALTER TABLE platform.%I FORCE ROW LEVEL SECURITY',t);
    EXECUTE format('CREATE POLICY platform_service ON platform.%I USING(current_setting(''netflow.system'',true) IN (''authentication'',''platform'',''startup'',''test'')) WITH CHECK(current_setting(''netflow.system'',true) IN (''authentication'',''platform'',''startup'',''test''))',t);
  END LOOP;
  FOREACH t IN ARRAY ARRAY['provisioning_operations','resource_routes','outbox','microsoft_identities'] LOOP
    EXECUTE format('ALTER TABLE system.%I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('ALTER TABLE system.%I FORCE ROW LEVEL SECURITY',t);
    EXECUTE format('CREATE POLICY system_service ON system.%I USING(current_setting(''netflow.system'',true) IN (''authentication'',''platform'',''startup'',''test'')) WITH CHECK(current_setting(''netflow.system'',true) IN (''authentication'',''platform'',''startup'',''test''))',t);
  END LOOP;
END; $$;
CREATE POLICY tenant_organization_metadata ON platform.organizations FOR SELECT USING(id=nullif(current_setting('netflow.org_id',true),''));
ALTER TABLE system.user_directory ENABLE ROW LEVEL SECURITY;
ALTER TABLE system.user_directory FORCE ROW LEVEL SECURITY;
CREATE POLICY directory_read ON system.user_directory FOR SELECT USING(
  current_setting('netflow.system',true) IN ('authentication','platform','startup','test') OR org_id=nullif(current_setting('netflow.org_id',true),'')
  OR (account_scope='platform' AND pg_trigger_depth()>0)
);
CREATE POLICY directory_insert ON system.user_directory FOR INSERT WITH CHECK(pg_trigger_depth()>0 AND
  ((account_scope='platform' AND current_setting('netflow.system',true) IN ('authentication','platform','startup','test')) OR org_id=nullif(current_setting('netflow.org_id',true),'')));
CREATE POLICY directory_update ON system.user_directory FOR UPDATE USING(pg_trigger_depth()>0 AND
  ((account_scope='platform' AND current_setting('netflow.system',true) IN ('authentication','platform','startup','test')) OR org_id=nullif(current_setting('netflow.org_id',true),''))) WITH CHECK(pg_trigger_depth()>0);
REVOKE ALL ON ALL TABLES IN SCHEMA platform,system FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA system FROM PUBLIC;
