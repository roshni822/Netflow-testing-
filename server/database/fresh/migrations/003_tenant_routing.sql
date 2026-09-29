-- Additive Phase 3 runtime permissions. Existing tenant tables/template stay
-- unchanged. No public grants and no administrator capability for runtime.
GRANT UPDATE(name,billing_email,pdf_auto_fill,updated_at,row_version) ON platform.organizations TO netflow_app;
CREATE POLICY tenant_organization_settings ON platform.organizations FOR UPDATE
 USING(id=nullif(current_setting('netflow.org_id',true),'') AND deleted_at IS NULL AND provisioning_status='ready' AND status='active')
 WITH CHECK(id=nullif(current_setting('netflow.org_id',true),'') AND deleted_at IS NULL AND provisioning_status='ready' AND status='active');
CREATE POLICY tenant_plan_read ON platform.plans FOR SELECT
 USING(EXISTS(SELECT 1 FROM platform.organizations o WHERE o.id=nullif(current_setting('netflow.org_id',true),'') AND o.plan=key));
CREATE POLICY tenant_broadcast_read ON platform.platform_broadcasts FOR SELECT
 USING(EXISTS(SELECT 1 FROM platform.organizations o WHERE o.id=nullif(current_setting('netflow.org_id',true),'') AND o.status='active' AND o.provisioning_status='ready'));
CREATE POLICY tenant_reset_routes ON system.resource_routes
 USING(account_scope='tenant' AND org_id=nullif(current_setting('netflow.org_id',true),'') AND purpose='password_reset')
 WITH CHECK(account_scope='tenant' AND org_id=nullif(current_setting('netflow.org_id',true),'') AND purpose='password_reset'
   AND EXISTS(SELECT 1 FROM system.user_directory d WHERE d.user_id=system.resource_routes.resource_id AND d.org_id=system.resource_routes.org_id AND d.account_scope='tenant' AND d.state<>'deleted'));
GRANT INSERT ON system.outbox TO netflow_app;
GRANT USAGE ON SEQUENCE system.outbox_id_seq TO netflow_app;
CREATE POLICY tenant_outbox ON system.outbox FOR INSERT
 WITH CHECK(account_scope='tenant' AND org_id=nullif(current_setting('netflow.org_id',true),'') AND delivery_purpose='business');
CREATE POLICY tenant_outbox_read ON system.outbox FOR SELECT
 USING(account_scope='tenant' AND org_id=nullif(current_setting('netflow.org_id',true),''));
