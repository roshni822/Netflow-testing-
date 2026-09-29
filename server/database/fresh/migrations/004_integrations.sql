-- Phase 4: scoped external entry points and background delivery. Historical
-- tenant tables/templates and all previous migration checksums stay unchanged.
CREATE POLICY service_placement_read ON platform.organizations FOR SELECT
 USING(current_setting('netflow.system',true) IN ('public-form','webhook','signed-file','worker'));
CREATE POLICY public_resource_lookup ON system.resource_routes FOR SELECT
 USING(account_scope='tenant' AND ((current_setting('netflow.system',true)='public-form' AND purpose='public_form')
 OR (current_setting('netflow.system',true)='webhook' AND purpose IN ('inbound_webhook','execution_status'))));
CREATE POLICY tenant_business_routes ON system.resource_routes
 USING(account_scope='tenant' AND org_id=nullif(current_setting('netflow.org_id',true),'') AND purpose IN ('public_form','inbound_webhook','execution_status'))
 WITH CHECK(account_scope='tenant' AND org_id=nullif(current_setting('netflow.org_id',true),'') AND purpose IN ('public_form','inbound_webhook','execution_status'));
GRANT UPDATE(status,attempts,retry_at,completed_at) ON system.outbox TO netflow_app;
CREATE POLICY outbox_worker ON system.outbox
 USING(current_setting('netflow.system',true)='worker')
 WITH CHECK(current_setting('netflow.system',true)='worker');

-- Backfill capabilities issued by Phase 3, including existing execution tokens.
-- Duplicate capabilities fail the whole upgrade for operator review.
DO $backfill$ DECLARE o record; BEGIN
 FOR o IN SELECT id,schema_name FROM platform.organizations WHERE provisioning_status='ready' AND deleted_at IS NULL LOOP
  IF o.schema_name !~ '^tenant_[a-z0-9]+(_[a-z0-9]+)*$' THEN RAISE EXCEPTION 'INVALID_TENANT_PLACEMENT'; END IF;
  EXECUTE format('INSERT INTO system.resource_routes(purpose,token_digest,account_scope,org_id,resource_id)
   SELECT ''public_form'',encode(sha256(convert_to(public_token,''UTF8'')),''hex''),''tenant'',org_id,id FROM %I.forms
   WHERE public_enabled AND status=''published'' AND public_token IS NOT NULL',o.schema_name);
  EXECUTE format('INSERT INTO system.resource_routes(purpose,token_digest,account_scope,org_id,resource_id)
   SELECT ''inbound_webhook'',encode(sha256(convert_to(inbound_webhook_token,''UTF8'')),''hex''),''tenant'',org_id,id FROM %I.workflows
   WHERE inbound_webhook_enabled AND status=''published'' AND inbound_webhook_token IS NOT NULL',o.schema_name);
  EXECUTE format('INSERT INTO system.resource_routes(purpose,token_digest,account_scope,org_id,resource_id)
   SELECT ''execution_status'',encode(sha256(convert_to(status_token,''UTF8'')),''hex''),''tenant'',org_id,id FROM %I.workflow_executions
   WHERE status_token IS NOT NULL',o.schema_name);
 END LOOP;
END; $backfill$;

-- A worker may derive expiry from existing dates and mark sent reminders. It
-- cannot renew a licence, change a plan/limit or clear suspension.
CREATE FUNCTION system.reconcile_licence(notified jsonb) RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $body$
BEGIN
 IF current_setting('netflow.system',true) IS DISTINCT FROM 'worker'
 OR nullif(current_setting('netflow.org_id',true),'') IS NULL
 OR jsonb_typeof(notified) IS DISTINCT FROM 'object'
 OR EXISTS(SELECT FROM jsonb_each(notified) e WHERE e.key NOT IN ('d30','d14','d7','d1','expired') OR e.value<>'true'::jsonb)
 THEN RAISE EXCEPTION 'WORKER_SCOPE_REQUIRED' USING ERRCODE='42501'; END IF;
 UPDATE platform.organizations SET
  licence_status=CASE WHEN least(licence_valid_until,licence_trial_ends_at)<=now() THEN 'expired' ELSE 'active' END,
  licence_notified=coalesce(licence_notified,'{}'::jsonb)||notified,
  updated_at=now(),row_version=row_version+1
 WHERE id=current_setting('netflow.org_id',true) AND licence_status IS DISTINCT FROM 'suspended'
 AND status='active' AND provisioning_status='ready' AND deleted_at IS NULL;
END; $body$;
ALTER FUNCTION system.reconcile_licence(jsonb) OWNER TO netflow_provisioner;
REVOKE ALL ON FUNCTION system.reconcile_licence(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION system.reconcile_licence(jsonb) TO netflow_app;
