'use strict'
// Development-only source for migration 002. Setup executes the frozen SQL file,
// never a request-supplied template. Do not regenerate an applied migration.
const fs = require('node:fs')
const path = require('node:path')
const { sourceCatalog, q } = require('../catalog')
const { platformCatalog, TENANT_TABLES } = require('./manifest')
const { digest } = require('./setup')
const literal = value => "'" + String(value).replaceAll("'", "''") + "'"

function generateProvisioningSQL () {
  const source = sourceCatalog()
  const template = fs.readFileSync(path.join(__dirname, 'tenant/001_template.sql'), 'utf8')
  const checksum = digest(template)
  const orgColumns = platformCatalog(source).Organization.fields.map(f => f.column).concat('api_version','source_missing')
  const seedParts = [...source.Organization.children, source.Role, source.User, ...source.User.children]
  const seeds = seedParts.map(spec => {
    const columns = [...(spec.owner ? ['owner_id','tenant_id', ...(spec.one ? [] : ['position'])] : []), ...spec.fields.map(f => f.column), 'source_missing']
    return `EXECUTE format('INSERT INTO %I.${q(spec.table)} (${columns.map(q).join(',')}) SELECT ${columns.map(q).join(',')} FROM jsonb_populate_recordset(NULL::%I.${q(spec.table)},$1)', target_schema,target_schema) USING coalesce(seed->${literal(spec.table)},'[]'::jsonb);`
  }).join('\n  ')
  return `-- Phase 2: additive upgrade. Historical baseline and tenant template stay immutable.
DO $guard$ BEGIN
  IF EXISTS(SELECT 1 FROM system.provisioning_operations) THEN
    RAISE EXCEPTION 'Phase 1 placeholder operations require operator review' USING ERRCODE='P0001';
  END IF;
  IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='netflow_provisioner') THEN
    CREATE ROLE netflow_provisioner NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION;
  ELSIF EXISTS(SELECT FROM pg_roles WHERE rolname='netflow_provisioner' AND
    (rolcanlogin OR rolsuper OR rolbypassrls OR rolcreatedb OR rolcreaterole OR rolreplication)) THEN
    RAISE EXCEPTION 'Unsafe provisioning owner' USING ERRCODE='42501';
  END IF;
  IF pg_has_role('netflow_app','netflow_provisioner','MEMBER') OR pg_has_role('netflow_provisioner','netflow_app','MEMBER') OR EXISTS(
    SELECT 1 FROM pg_roles r WHERE pg_has_role('netflow_provisioner',r.oid,'MEMBER') AND (r.rolsuper OR r.rolbypassrls OR r.rolcreatedb OR r.rolcreaterole OR r.rolreplication)) THEN
    RAISE EXCEPTION 'Provisioning owner must be isolated' USING ERRCODE='42501';
  END IF;
  EXECUTE format('GRANT CREATE ON DATABASE %I TO netflow_provisioner',current_database());
END; $guard$;
ALTER TABLE system.provisioning_operations DROP CONSTRAINT provisioning_operations_id_check,
  DROP CONSTRAINT provisioning_operations_idempotency_key_check,
  ALTER COLUMN id TYPE uuid USING id::uuid,
  ALTER COLUMN idempotency_key TYPE uuid USING idempotency_key::uuid,
  ADD COLUMN template_version text NOT NULL DEFAULT '001',
  ADD COLUMN template_checksum text NOT NULL DEFAULT '${checksum}' CHECK(template_checksum ~ '^[a-f0-9]{64}$');
ALTER TABLE platform.organizations ADD COLUMN provisioned_at timestamptz;
GRANT USAGE,CREATE ON SCHEMA system TO netflow_provisioner;
GRANT USAGE ON SCHEMA platform TO netflow_provisioner;
GRANT SELECT ON platform.admin_users,platform.admin_roles,platform.plans TO netflow_provisioner;
GRANT SELECT,INSERT,UPDATE,REFERENCES ON platform.organizations TO netflow_provisioner;
GRANT REFERENCES ON platform.platform_broadcasts,platform.admin_users TO netflow_provisioner;
GRANT SELECT,INSERT ON platform.audit_logs,system.schema_migrations TO netflow_provisioner;
GRANT SELECT,INSERT,UPDATE ON system.provisioning_operations,system.user_directory TO netflow_provisioner;
GRANT REFERENCES ON system.user_directory TO netflow_provisioner;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA system TO netflow_provisioner;

CREATE FUNCTION system.require_platform_admin(actor text) RETURNS void
LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $body$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM platform.admin_users u JOIN platform.admin_roles r ON r.id=u.role_id
    WHERE u.id=actor AND u.deleted_at IS NULL AND u.is_active IS TRUE
    AND r.name_key='superadmin' AND 'platform:manage_orgs'=ANY(r.permissions)) THEN
    RAISE EXCEPTION 'PROVISIONING_FORBIDDEN' USING ERRCODE='42501';
  END IF;
END; $body$;

CREATE FUNCTION system.reserve_organization(actor text,request_key uuid,fingerprint text,organization jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $body$
DECLARE op system.provisioning_operations; schema_slug text; oid text:=organization->>'id';
BEGIN
  PERFORM system.require_platform_admin(actor);
  IF fingerprint IS NULL OR fingerprint !~ '^[a-f0-9]{64}$' OR request_key IS NULL THEN
    RAISE EXCEPTION 'INVALID_PROVISIONING_REQUEST';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('provisioning-key:'||actor||':'||request_key,0));
  SELECT * INTO op FROM system.provisioning_operations WHERE actor_admin_id=actor AND idempotency_key=request_key;
  IF FOUND THEN
    IF op.request_fingerprint<>fingerprint THEN RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT'; END IF;
    RETURN jsonb_build_object('id',op.id,'orgId',op.org_id,'status',op.status);
  END IF;
  schema_slug:=lower(regexp_replace(normalize(organization->>'name',NFKD),U&'[\\0300-\\036f]','','g'));
  schema_slug:='tenant_'||trim(both '_' from regexp_replace(schema_slug,'[^a-z0-9]+','_','g'));
  IF schema_slug IS NULL OR schema_slug !~ '^tenant_[a-z0-9]+(_[a-z0-9]+)*$' OR octet_length(schema_slug)>63 THEN
    RAISE EXCEPTION 'INVALID_SCHEMA_NAME';
  END IF;
  IF EXISTS(SELECT 1 FROM pg_namespace WHERE nspname=schema_slug) THEN RAISE EXCEPTION 'SCHEMA_NAME_TAKEN'; END IF;
  BEGIN
    INSERT INTO platform.organizations(${orgColumns.map(q).join(',')},schema_name,provisioning_status)
      SELECT ${orgColumns.map(q).join(',')},schema_slug,'provisioning' FROM jsonb_populate_record(NULL::platform.organizations,organization);
  EXCEPTION WHEN unique_violation THEN
    IF EXISTS(SELECT 1 FROM platform.organizations WHERE schema_name=schema_slug) THEN RAISE EXCEPTION 'SCHEMA_NAME_TAKEN'; END IF;
    RAISE EXCEPTION 'SUBDOMAIN_TAKEN';
  END;
  IF organization->>'admin_user_id' IS NOT NULL THEN RAISE EXCEPTION 'INVALID_PROVISIONING_REQUEST'; END IF;
  INSERT INTO system.provisioning_operations(id,actor_admin_id,idempotency_key,request_fingerprint,org_id)
    VALUES(gen_random_uuid(),actor,request_key,fingerprint,oid) RETURNING * INTO op;
  RETURN jsonb_build_object('id',op.id,'orgId',op.org_id,'status',op.status);
END; $body$;

CREATE FUNCTION system.provision_organization(operation uuid,actor text,fingerprint text,seed jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $body$
DECLARE op system.provisioning_operations; org platform.organizations; target_schema text;
  admin_id text; old_org text:=current_setting('netflow.org_id',true); total integer;
BEGIN
  PERFORM system.require_platform_admin(actor);
  IF NOT pg_try_advisory_xact_lock(hashtextextended('provisioning:'||operation,0)) THEN
    RETURN jsonb_build_object('pending',true,'operationId',operation);
  END IF;
  SELECT * INTO op FROM system.provisioning_operations WHERE id=operation AND actor_admin_id=actor FOR UPDATE;
  IF NOT FOUND OR op.request_fingerprint IS DISTINCT FROM fingerprint THEN RAISE EXCEPTION 'INVALID_PROVISIONING_OPERATION'; END IF;
  IF op.status='succeeded' THEN RETURN jsonb_build_object('replayed',true,'orgId',op.org_id,'operationId',operation); END IF;
  IF op.template_version<>'001' OR op.template_checksum<>'${checksum}' THEN RAISE EXCEPTION 'TEMPLATE_VERSION_MISMATCH'; END IF;
  SELECT * INTO STRICT org FROM platform.organizations WHERE id=op.org_id FOR UPDATE;
  target_schema:=org.schema_name;
  IF org.provisioning_status NOT IN ('provisioning','failed') OR org.admin_user_id IS NOT NULL OR org.deleted_at IS NOT NULL
    OR EXISTS(SELECT 1 FROM pg_namespace WHERE nspname=target_schema) THEN RAISE EXCEPTION 'SCHEMA_CONFLICT'; END IF;
  IF target_schema !~ '^tenant_[a-z0-9]+(_[a-z0-9]+)*$' OR octet_length(target_schema)>63
    OR jsonb_array_length(seed->'users') IS DISTINCT FROM 1 OR jsonb_array_length(seed->'user_auth') IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'INVALID_PROVISIONING_SEED';
  END IF;
  UPDATE system.provisioning_operations SET status='running',attempts=attempts+1,updated_at=now(),error_code=NULL WHERE id=operation;
  PERFORM set_config('netflow.org_id',org.id,true);
  -- Installed constant template; neither schema nor SQL is supplied to this function.
  EXECUTE replace(replace($tenant_template$${template}$tenant_template$,'__TENANT_SCHEMA__',target_schema),'__ORG_ID__',org.id);
  ${seeds}
  EXECUTE format('UPDATE %I.users u SET department_id=d.department_id FROM %I.organization_departments d WHERE d.owner_id=u.org_id AND d.name_key=lower(btrim(u.department))',target_schema,target_schema);
  EXECUTE format('UPDATE %I.organization_department_integrations i SET department_id=d.department_id FROM %I.organization_departments d WHERE d.owner_id=i.tenant_id AND d.name_key=lower(btrim(i.department))',target_schema,target_schema);
  EXECUTE format('SELECT u.id FROM %I.users u JOIN %I.roles r ON r.id=u.role JOIN %I.user_auth a ON a.owner_id=u.id WHERE u.org_id=$1 AND r.org_id=$1 AND r.name_key=''admin'' AND r.permissions=ARRAY[''*'']::text[] AND u.is_active IS TRUE AND u.must_change_password IS TRUE AND a.password ~ ''^\\$2[aby]\\$12\\$''',target_schema,target_schema,target_schema) INTO admin_id USING org.id;
  IF admin_id IS NULL THEN RAISE EXCEPTION 'INVALID_ADMIN_SEED'; END IF;
  SELECT count(*) INTO total FROM pg_tables WHERE schemaname=target_schema;
  IF total<>33 OR EXISTS(SELECT 1 FROM unnest(ARRAY[${TENANT_TABLES.map(literal).join(',')}]) t WHERE to_regclass(format('%I.%I',target_schema,t)) IS NULL) THEN RAISE EXCEPTION 'TENANT_MANIFEST_MISMATCH'; END IF;
  IF EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=target_schema AND c.relkind='r'
    AND (NOT c.relrowsecurity OR NOT c.relforcerowsecurity OR NOT has_table_privilege('netflow_app',c.oid,'SELECT') OR has_table_privilege('netflow_app',c.oid,'TRUNCATE'))) THEN RAISE EXCEPTION 'TENANT_GRANTS_MISMATCH'; END IF;
  INSERT INTO system.schema_migrations(schema_name,version,scope,org_id,checksum,release_id)
    VALUES(target_schema,'001','tenant',org.id,'${checksum}','organization-schemas-phase-2');
  UPDATE platform.organizations SET admin_user_id=admin_id,schema_version='001',provisioning_status='ready',provisioned_at=now(),updated_at=now(),source_missing=array_remove(source_missing,'adminUserId') WHERE id=org.id;
  INSERT INTO platform.audit_logs(id,target_org_id,performed_by,action,target_entity,detail,metadata)
    VALUES(substr(replace(gen_random_uuid()::text,'-',''),1,24),org.id,actor,'org_created',org.name,'Organization schema and initial admin provisioned',jsonb_build_object('operationId',operation,'schemaName',target_schema,'orgId',org.id));
  UPDATE system.provisioning_operations SET status='succeeded',completed_at=now(),updated_at=now() WHERE id=operation;
  -- Deferred directory FKs/triggers run under the narrowly privileged owner and
  -- tenant context before returning to the ordinary platform transaction.
  SET CONSTRAINTS ALL IMMEDIATE;
  SET CONSTRAINTS ALL DEFERRED;
  PERFORM set_config('netflow.org_id',coalesce(old_org,''),true);
  RETURN jsonb_build_object('replayed',false,'orgId',org.id,'operationId',operation);
END; $body$;

CREATE FUNCTION system.fail_provisioning(operation uuid,actor text,fingerprint text,safe_code text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $body$
DECLARE oid text;
BEGIN
  PERFORM system.require_platform_admin(actor);
  IF safe_code NOT IN ('PROVISIONING_FAILED','SCHEMA_CONFLICT','TEMPLATE_VERSION_MISMATCH') THEN safe_code:='PROVISIONING_FAILED'; END IF;
  IF NOT pg_try_advisory_xact_lock(hashtextextended('provisioning:'||operation,0)) THEN RETURN; END IF;
  UPDATE system.provisioning_operations SET status='failed',error_code=safe_code,attempts=attempts+1,updated_at=now()
    WHERE id=operation AND actor_admin_id=actor AND request_fingerprint=fingerprint AND status<>'succeeded' RETURNING org_id INTO oid;
  IF oid IS NOT NULL THEN UPDATE platform.organizations SET provisioning_status='failed',updated_at=now() WHERE id=oid AND provisioning_status<>'ready'; END IF;
END; $body$;

CREATE FUNCTION system.reset_organization_admin(actor text,organization_id text,password_hash text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $body$
DECLARE org platform.organizations; profile record; affected integer; old_org text:=current_setting('netflow.org_id',true);
BEGIN
  PERFORM system.require_platform_admin(actor);
  IF password_hash IS NULL OR password_hash !~ '^\\$2[aby]\\$12\\$[./A-Za-z0-9]{53}$' THEN RAISE EXCEPTION 'INVALID_PASSWORD_HASH'; END IF;
  SELECT * INTO org FROM platform.organizations WHERE id=organization_id AND provisioning_status='ready' AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'ORG_NOT_READY'; END IF;
  PERFORM set_config('netflow.org_id',org.id,true);
  EXECUTE format('SELECT u.id,u.email,u.name FROM %I.users u JOIN %I.roles r ON r.id=u.role WHERE u.id=$1 AND u.is_active IS TRUE AND u.deleted_at IS NULL AND r.name_key=''admin''',org.schema_name,org.schema_name) INTO profile USING org.admin_user_id;
  IF profile.id IS NULL THEN RAISE EXCEPTION 'NO_ORG_ADMIN'; END IF;
  EXECUTE format('UPDATE %I.user_auth SET password=$1,token_version=coalesce(token_version,0)+1,reset_password_token=NULL,reset_password_expires=NULL,failed_login_attempts=0,lock_until=NULL WHERE owner_id=$2',org.schema_name) USING password_hash,profile.id;
  GET DIAGNOSTICS affected=ROW_COUNT;
  IF affected<>1 THEN RAISE EXCEPTION 'NO_ORG_ADMIN'; END IF;
  EXECUTE format('DELETE FROM %I.user_sessions WHERE owner_id=$1',org.schema_name) USING profile.id;
  EXECUTE format('UPDATE %I.users SET must_change_password=true,updated_at=now(),row_version=row_version+1 WHERE id=$1',org.schema_name) USING profile.id;
  INSERT INTO platform.audit_logs(id,target_org_id,performed_by,action,target_entity,detail)
    VALUES(substr(replace(gen_random_uuid()::text,'-',''),1,24),org.id,actor,'org_admin_password_reset',org.name,'Initial organization admin credentials reset');
  SET CONSTRAINTS ALL IMMEDIATE;
  SET CONSTRAINTS ALL DEFERRED;
  PERFORM set_config('netflow.org_id',coalesce(old_org,''),true);
  RETURN jsonb_build_object('email',profile.email,'name',profile.name);
END; $body$;

ALTER FUNCTION system.require_platform_admin(text) OWNER TO netflow_provisioner;
ALTER FUNCTION system.reserve_organization(text,uuid,text,jsonb) OWNER TO netflow_provisioner;
ALTER FUNCTION system.provision_organization(uuid,text,text,jsonb) OWNER TO netflow_provisioner;
ALTER FUNCTION system.fail_provisioning(uuid,text,text,text) OWNER TO netflow_provisioner;
ALTER FUNCTION system.reset_organization_admin(text,text,text) OWNER TO netflow_provisioner;
REVOKE ALL ON FUNCTION system.require_platform_admin(text),system.reserve_organization(text,uuid,text,jsonb),system.provision_organization(uuid,text,text,jsonb),system.fail_provisioning(uuid,text,text,text),system.reset_organization_admin(text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION system.reserve_organization(text,uuid,text,jsonb),system.provision_organization(uuid,text,text,jsonb),system.fail_provisioning(uuid,text,text,text),system.reset_organization_admin(text,text,text) TO netflow_app;
REVOKE CREATE ON SCHEMA system FROM netflow_provisioner;
`
}
module.exports = { generateProvisioningSQL }
