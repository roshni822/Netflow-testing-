-- Additive operations upgrade. Historical migrations and tenant template stay immutable.
ALTER TABLE system.resource_routes DROP CONSTRAINT resource_routes_purpose_check;
ALTER TABLE system.resource_routes ADD CONSTRAINT resource_routes_purpose_check
 CHECK(purpose IN ('password_reset','public_form','inbound_webhook','execution_status','document_connection'));
CREATE POLICY tenant_document_connections ON system.resource_routes
 USING(account_scope='tenant' AND org_id=nullif(current_setting('netflow.org_id',true),'') AND purpose='document_connection')
 WITH CHECK(account_scope='tenant' AND org_id=nullif(current_setting('netflow.org_id',true),'') AND purpose='document_connection');
DO $audit$ DECLARE expression text; BEGIN
  SELECT pg_get_expr(conbin,conrelid) INTO expression FROM pg_constraint
    WHERE conrelid='platform.audit_logs'::regclass AND conname='audit_logs_action_check';
  IF expression IS NULL THEN RAISE EXCEPTION 'AUDIT_CONSTRAINT_MISSING'; END IF;
  ALTER TABLE platform.audit_logs DROP CONSTRAINT audit_logs_action_check;
  EXECUTE 'ALTER TABLE platform.audit_logs ADD CONSTRAINT audit_logs_action_check CHECK (('||expression||') OR action IN
    (''plan_created'',''plan_updated'',''plan_deleted'',''platform_admin_created'',''platform_admin_password_reset'',
     ''platform_admin_activated'',''platform_admin_deactivated'',''org_archived'',''org_restored'',''org_purge_verified''))';
END; $audit$;
GRANT INSERT,UPDATE,DELETE ON platform.plans TO netflow_app;
CREATE POLICY plan_insert_guard ON platform.plans AS RESTRICTIVE FOR INSERT TO netflow_app
 WITH CHECK(current_setting('netflow.system',true)='platform' AND nullif(current_setting('netflow.org_id',true),'') IS NULL);
CREATE POLICY plan_update_guard ON platform.plans AS RESTRICTIVE FOR UPDATE TO netflow_app
 USING(current_setting('netflow.system',true)='platform' AND nullif(current_setting('netflow.org_id',true),'') IS NULL);
CREATE POLICY plan_delete_guard ON platform.plans AS RESTRICTIVE FOR DELETE TO netflow_app
 USING(current_setting('netflow.system',true)='platform' AND nullif(current_setting('netflow.org_id',true),'') IS NULL);
ALTER TABLE platform.platform_broadcasts ADD COLUMN target_org_ids text[];
ALTER TABLE platform.platform_broadcasts ADD CONSTRAINT broadcast_nonempty_audience CHECK(target_org_ids IS NULL OR cardinality(target_org_ids)>0);
CREATE INDEX broadcast_audience_idx ON platform.platform_broadcasts USING gin(target_org_ids);
GRANT INSERT ON platform.platform_broadcasts TO netflow_app;
CREATE POLICY broadcast_insert_guard ON platform.platform_broadcasts AS RESTRICTIVE FOR INSERT TO netflow_app
 WITH CHECK(current_setting('netflow.system',true)='platform' AND nullif(current_setting('netflow.org_id',true),'') IS NULL);
DROP POLICY tenant_broadcast_read ON platform.platform_broadcasts;
CREATE POLICY tenant_broadcast_read ON platform.platform_broadcasts FOR SELECT
 USING((target_org_ids IS NULL OR nullif(current_setting('netflow.org_id',true),'')=ANY(target_org_ids))
 AND EXISTS(SELECT 1 FROM platform.organizations o WHERE o.id=nullif(current_setting('netflow.org_id',true),'')
 AND o.status='active' AND o.provisioning_status='ready' AND o.deleted_at IS NULL));

CREATE TABLE system.tenant_lifecycle (
 org_id text PRIMARY KEY REFERENCES platform.organizations(id),
 archived_at timestamptz NOT NULL, purge_after timestamptz NOT NULL,
 actor_admin_id text NOT NULL REFERENCES platform.admin_users(id), reason text NOT NULL,
 backup_digest text, snapshot_digest text, restore_database text, verified_at timestamptz,
 purged_at timestamptz,
 CHECK(purge_after>archived_at),
 CHECK(backup_digest IS NULL OR backup_digest ~ '^[a-f0-9]{64}$'),
 CHECK(snapshot_digest IS NULL OR snapshot_digest ~ '^[a-f0-9]{64}$')
);
ALTER TABLE system.tenant_lifecycle ENABLE ROW LEVEL SECURITY;
ALTER TABLE system.tenant_lifecycle FORCE ROW LEVEL SECURITY;
CREATE POLICY lifecycle_platform ON system.tenant_lifecycle
 USING(current_setting('netflow.system',true)='platform') WITH CHECK(current_setting('netflow.system',true)='platform');
GRANT SELECT ON system.tenant_lifecycle TO netflow_app;
GRANT SELECT,INSERT,UPDATE,DELETE ON system.tenant_lifecycle TO netflow_provisioner;
GRANT SELECT ON system.outbox TO netflow_provisioner;
CREATE FUNCTION system.archive_organization(actor text,organization_id text,retention_days integer,reason_text text,restore boolean DEFAULT false)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $body$
DECLARE org platform.organizations;
BEGIN
 IF current_setting('netflow.system',true) IS DISTINCT FROM 'platform' OR nullif(current_setting('netflow.org_id',true),'') IS NOT NULL THEN
  RAISE EXCEPTION 'PLATFORM_ACCESS_REQUIRED' USING ERRCODE='42501'; END IF;
 PERFORM system.require_platform_admin(actor);
 PERFORM pg_advisory_xact_lock(hashtextextended('tenant-operation:'||organization_id,0));
 SELECT * INTO org FROM platform.organizations WHERE id=organization_id AND deleted_at IS NULL FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'ORG_NOT_FOUND'; END IF;
 IF restore THEN
  IF org.provisioning_status<>'maintenance' OR NOT EXISTS(SELECT 1 FROM system.tenant_lifecycle WHERE org_id=organization_id AND purged_at IS NULL) THEN RAISE EXCEPTION 'ORG_NOT_ARCHIVED'; END IF;
  UPDATE platform.organizations SET provisioning_status='ready',status='suspended',row_version=row_version+1,updated_at=now() WHERE id=organization_id;
  DELETE FROM system.tenant_lifecycle WHERE org_id=organization_id;
 ELSE
  IF org.provisioning_status<>'ready' OR org.status<>'suspended' THEN RAISE EXCEPTION 'SUSPEND_BEFORE_ARCHIVE'; END IF;
  IF retention_days IS NULL OR retention_days<1 OR retention_days>3650 OR reason_text IS NULL OR length(btrim(reason_text)) NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION 'INVALID_ARCHIVE_REQUEST'; END IF;
  IF EXISTS(SELECT 1 FROM system.outbox WHERE org_id=organization_id AND status='processing') THEN RAISE EXCEPTION 'IN_FLIGHT_DELIVERY'; END IF;
  UPDATE platform.organizations SET provisioning_status='maintenance',row_version=row_version+1,updated_at=now() WHERE id=organization_id;
  INSERT INTO system.tenant_lifecycle(org_id,archived_at,purge_after,actor_admin_id,reason)
   VALUES(organization_id,now(),now()+make_interval(days=>retention_days),actor,btrim(reason_text));
 END IF;
 INSERT INTO platform.audit_logs(id,performed_by,action,target_entity,target_org_id,detail,metadata)
 VALUES(left(replace(gen_random_uuid()::text,'-',''),24),actor,CASE WHEN restore THEN 'org_restored' ELSE 'org_archived' END,
  org.name,organization_id,CASE WHEN restore THEN 'Archive reversed; organization remains suspended' ELSE 'Organization archived; data retained' END,
  jsonb_build_object('targetOrgId',organization_id,'retentionDays',retention_days));
END; $body$;
ALTER FUNCTION system.archive_organization(text,text,integer,text,boolean) OWNER TO netflow_provisioner;
REVOKE ALL ON FUNCTION system.archive_organization(text,text,integer,text,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION system.archive_organization(text,text,integer,text,boolean) TO netflow_app;
-- Purged identities remain as tombstones for durable audit actor references.
-- Only a deleted organization with no tenant schema may omit its profile.
DO $directory$ DECLARE definition text; BEGIN
 SELECT pg_get_functiondef('system.check_user_directory()'::regprocedure) INTO definition;
 definition:=replace(definition,'  EXECUTE format(''SELECT email,is_active,deleted_at',
  '  IF d.account_scope=''tenant'' AND d.state=''deleted'' AND d.email_key IS NULL AND d.deleted_at IS NOT NULL
     AND EXISTS(SELECT 1 FROM platform.organizations WHERE id=d.org_id AND provisioning_status=''deleted'' AND deleted_at IS NOT NULL)
     AND NOT EXISTS(SELECT 1 FROM pg_namespace WHERE nspname=target_schema) THEN RETURN NULL; END IF;
  EXECUTE format(''SELECT email,is_active,deleted_at');
 EXECUTE definition;
END; $directory$;
