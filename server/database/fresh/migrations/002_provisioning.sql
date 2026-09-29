-- Phase 2: additive upgrade. Historical baseline and tenant template stay immutable.
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
  ADD COLUMN template_checksum text NOT NULL DEFAULT 'd8f438aeac5fea531c42a8197e836b838ca53143a74294c7e9d60cc8e94646ec' CHECK(template_checksum ~ '^[a-f0-9]{64}$');
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
  schema_slug:=lower(regexp_replace(normalize(organization->>'name',NFKD),U&'[\0300-\036f]','','g'));
  schema_slug:='tenant_'||trim(both '_' from regexp_replace(schema_slug,'[^a-z0-9]+','_','g'));
  IF schema_slug IS NULL OR schema_slug !~ '^tenant_[a-z0-9]+(_[a-z0-9]+)*$' OR octet_length(schema_slug)>63 THEN
    RAISE EXCEPTION 'INVALID_SCHEMA_NAME';
  END IF;
  IF EXISTS(SELECT 1 FROM pg_namespace WHERE nspname=schema_slug) THEN RAISE EXCEPTION 'SCHEMA_NAME_TAKEN'; END IF;
  BEGIN
    INSERT INTO platform.organizations("name","subdomain","allowed_domains","features","pdf_auto_fill","plan","licence_valid_from","licence_valid_until","licence_trial_ends_at","licence_status","licence_notified","billing_email","billing_anchor_day","limits","storage_extension_extra_mb","storage_extension_expires_at","storage_extension_granted_by","storage_extension_reason","status","admin_user_id","id","created_at","updated_at","api_version","source_missing",schema_name,provisioning_status)
      SELECT "name","subdomain","allowed_domains","features","pdf_auto_fill","plan","licence_valid_from","licence_valid_until","licence_trial_ends_at","licence_status","licence_notified","billing_email","billing_anchor_day","limits","storage_extension_extra_mb","storage_extension_expires_at","storage_extension_granted_by","storage_extension_reason","status","admin_user_id","id","created_at","updated_at","api_version","source_missing",schema_slug,'provisioning' FROM jsonb_populate_record(NULL::platform.organizations,organization);
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
  IF op.template_version<>'001' OR op.template_checksum<>'d8f438aeac5fea531c42a8197e836b838ca53143a74294c7e9d60cc8e94646ec' THEN RAISE EXCEPTION 'TEMPLATE_VERSION_MISMATCH'; END IF;
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
  EXECUTE replace(replace($tenant_template$CREATE SCHEMA "__TENANT_SCHEMA__";

REVOKE ALL ON SCHEMA "__TENANT_SCHEMA__" FROM PUBLIC;

CREATE TABLE "__TENANT_SCHEMA__"."roles" ("org_id" text,
  "name" text NOT NULL,
  "name_key" text,
  "description" text,
  "permissions" text[] DEFAULT ARRAY[]::text[],
  "id" text PRIMARY KEY CHECK ("id" ~ '^[0-9a-f]{24}$'),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  api_version bigint,
  legacy_extra jsonb NOT NULL DEFAULT '{}',
  legacy_refs jsonb NOT NULL DEFAULT '{}',
  source_missing text[] NOT NULL DEFAULT '{}',
  row_version bigint NOT NULL DEFAULT 0);

CREATE TABLE "__TENANT_SCHEMA__"."users" ("org_id" text,
  "name" text NOT NULL,
  "email" text NOT NULL,
  "must_change_password" boolean DEFAULT false,
  "needs_product_tour" boolean DEFAULT false,
  "role" text,
  "department" text NOT NULL,
  "is_active" boolean DEFAULT true,
  "can_build" boolean DEFAULT false,
  "counts_toward_seats" boolean DEFAULT true,
  "is_protected" boolean DEFAULT false,
  "avatar" text,
  "manager_id" text,
  "hr_id" text,
  "last_login" timestamptz,
  "out_of_office_enabled" boolean DEFAULT false,
  "out_of_office_from" timestamptz,
  "out_of_office_until" timestamptz,
  "out_of_office_note" text,
  "out_of_office_delegate_id" text,
  "notification_prefs" jsonb,
  "id" text PRIMARY KEY CHECK ("id" ~ '^[0-9a-f]{24}$'),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  api_version bigint,
  legacy_extra jsonb NOT NULL DEFAULT '{}',
  legacy_refs jsonb NOT NULL DEFAULT '{}',
  source_missing text[] NOT NULL DEFAULT '{}',
  row_version bigint NOT NULL DEFAULT 0);

CREATE TABLE "__TENANT_SCHEMA__"."user_auth" (owner_id text NOT NULL REFERENCES "__TENANT_SCHEMA__"."users"(id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED,
  tenant_id text,
  "password" text NOT NULL,
  "token_version" numeric DEFAULT 0,
  "reset_password_token" text,
  "reset_password_expires" timestamptz,
  "failed_login_attempts" numeric DEFAULT 0,
  "lock_until" timestamptz,
  "mfa_enabled" boolean DEFAULT false,
  "mfa_secret" text,
  legacy_extra jsonb NOT NULL DEFAULT '{}',
  legacy_refs jsonb NOT NULL DEFAULT '{}',
  source_missing text[] NOT NULL DEFAULT '{}',
  row_version bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (owner_id));

CREATE TABLE "__TENANT_SCHEMA__"."user_sessions" (owner_id text NOT NULL REFERENCES "__TENANT_SCHEMA__"."users"(id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED,
  tenant_id text,
  position integer NOT NULL CHECK (position >= 0),
  "session_id" text NOT NULL,
  legacy_extra jsonb NOT NULL DEFAULT '{}',
  legacy_refs jsonb NOT NULL DEFAULT '{}',
  source_missing text[] NOT NULL DEFAULT '{}',
  row_version bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (owner_id,position));

CREATE TABLE "__TENANT_SCHEMA__"."user_mfa_backup_codes" (owner_id text NOT NULL REFERENCES "__TENANT_SCHEMA__"."users"(id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED,
  tenant_id text,
  position integer NOT NULL CHECK (position >= 0),
  "code_hash" text NOT NULL,
  legacy_extra jsonb NOT NULL DEFAULT '{}',
  legacy_refs jsonb NOT NULL DEFAULT '{}',
  source_missing text[] NOT NULL DEFAULT '{}',
  row_version bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (owner_id,position));

CREATE TABLE "__TENANT_SCHEMA__"."forms" ("org_id" text,
  "title" text NOT NULL,
  "description" text,
  "fields" jsonb DEFAULT '[]'::jsonb,
  "status" text DEFAULT 'draft' CHECK ("status" IN ('draft','published','archived')),
  "created_by" text NOT NULL,
  "department" text,
  "version" numeric DEFAULT 1,
  "public_enabled" boolean DEFAULT false,
  "public_token" text,
  "auto_fill_enabled" boolean DEFAULT false,
  "id" text PRIMARY KEY CHECK ("id" ~ '^[0-9a-f]{24}$'),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  api_version bigint,
  legacy_extra jsonb NOT NULL DEFAULT '{}',
  legacy_refs jsonb NOT NULL DEFAULT '{}',
  source_missing text[] NOT NULL DEFAULT '{}',
  row_version bigint NOT NULL DEFAULT 0);

CREATE TABLE "__TENANT_SCHEMA__"."form_drafts" ("org_id" text,
  "form_id" text NOT NULL,
  "user_id" text NOT NULL,
  "form_data" jsonb DEFAULT '{}'::jsonb,
  "id" text PRIMARY KEY CHECK ("id" ~ '^[0-9a-f]{24}$'),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  api_version bigint,
  legacy_extra jsonb NOT NULL DEFAULT '{}',
  legacy_refs jsonb NOT NULL DEFAULT '{}',
  source_missing text[] NOT NULL DEFAULT '{}',
  row_version bigint NOT NULL DEFAULT 0);

CREATE TABLE "__TENANT_SCHEMA__"."form_responses" ("org_id" text,
  "form_id" text NOT NULL,
  "submitted_by" text,
  "submitted_by_external" jsonb,
  "source" text DEFAULT 'internal' CHECK ("source" IN ('internal','public')),
  "form_data" jsonb NOT NULL,
  "status" text DEFAULT 'submitted' CHECK ("status" IN ('submitted','under_review','approved','rejected')),
  "attachments" jsonb DEFAULT '[]'::jsonb,
  "id" text PRIMARY KEY CHECK ("id" ~ '^[0-9a-f]{24}$'),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  api_version bigint,
  legacy_extra jsonb NOT NULL DEFAULT '{}',
  legacy_refs jsonb NOT NULL DEFAULT '{}',
  source_missing text[] NOT NULL DEFAULT '{}',
  row_version bigint NOT NULL DEFAULT 0);

CREATE TABLE "__TENANT_SCHEMA__"."workflows" ("org_id" text,
  "title" text NOT NULL,
  "description" text,
  "tags" text[] DEFAULT ARRAY[]::text[],
  "nodes" jsonb DEFAULT '[]'::jsonb,
  "edges" jsonb DEFAULT '[]'::jsonb,
  "status" text DEFAULT 'draft' CHECK ("status" IN ('draft','published','paused','archived')),
  "linked_form_id" text,
  "access_who_can_submit" text DEFAULT 'All employees',
  "access_visibility" text DEFAULT 'company',
  "trigger_on" text DEFAULT 'Every form submission',
  "prevent_duplicates" boolean DEFAULT false,
  "notify_on_sla_breach" text DEFAULT 'Always',
  "inbound_webhook_enabled" boolean DEFAULT false,
  "inbound_webhook_token" text,
  "inbound_webhook_secret" text,
  "inbound_webhook_require_signature" boolean DEFAULT true,
  "inbound_webhook_callback_url" text DEFAULT '',
  "inbound_webhook_expected_fields" jsonb DEFAULT '[]'::jsonb,
  "advanced_allow_cancel" boolean DEFAULT false,
  "advanced_auto_pdf" boolean DEFAULT false,
  "department" text,
  "created_by" text,
  "version" numeric DEFAULT 1,
  "previous_version_id" text,
  "id" text PRIMARY KEY CHECK ("id" ~ '^[0-9a-f]{24}$'),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  api_version bigint,
  legacy_extra jsonb NOT NULL DEFAULT '{}',
  legacy_refs jsonb NOT NULL DEFAULT '{}',
  source_missing text[] NOT NULL DEFAULT '{}',
  row_version bigint NOT NULL DEFAULT 0);

CREATE TABLE "__TENANT_SCHEMA__"."workflow_forms" (owner_id text NOT NULL REFERENCES "__TENANT_SCHEMA__"."workflows"(id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED,
  tenant_id text,
  position integer NOT NULL CHECK (position >= 0),
  "form_id" text,
  legacy_extra jsonb NOT NULL DEFAULT '{}',
  legacy_refs jsonb NOT NULL DEFAULT '{}',
  source_missing text[] NOT NULL DEFAULT '{}',
  row_version bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (owner_id,position));

CREATE TABLE "__TENANT_SCHEMA__"."workflow_initiators" (owner_id text NOT NULL REFERENCES "__TENANT_SCHEMA__"."workflows"(id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED,
  tenant_id text,
  position integer NOT NULL CHECK (position >= 0),
  "user_id" text,
  legacy_extra jsonb NOT NULL DEFAULT '{}',
  legacy_refs jsonb NOT NULL DEFAULT '{}',
  source_missing text[] NOT NULL DEFAULT '{}',
  row_version bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (owner_id,position));

CREATE TABLE "__TENANT_SCHEMA__"."workflow_viewers" (owner_id text NOT NULL REFERENCES "__TENANT_SCHEMA__"."workflows"(id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED,
  tenant_id text,
  position integer NOT NULL CHECK (position >= 0),
  "user_id" text,
  legacy_extra jsonb NOT NULL DEFAULT '{}',
  legacy_refs jsonb NOT NULL DEFAULT '{}',
  source_missing text[] NOT NULL DEFAULT '{}',
  row_version bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (owner_id,position));

CREATE TABLE "__TENANT_SCHEMA__"."workflow_access_departments" (owner_id text NOT NULL REFERENCES "__TENANT_SCHEMA__"."workflows"(id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED,
  tenant_id text,
  position integer NOT NULL CHECK (position >= 0),
  "department_name" text NOT NULL,
  legacy_extra jsonb NOT NULL DEFAULT '{}',
  legacy_refs jsonb NOT NULL DEFAULT '{}',
  source_missing text[] NOT NULL DEFAULT '{}',
  row_version bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (owner_id,position));

CREATE TABLE "__TENANT_SCHEMA__"."workflow_executions" ("org_id" text,
  "workflow_id" text NOT NULL,
  "form_response_id" text,
  "triggered_by" text NOT NULL,
  "triggered_by_external" jsonb,
  "status_token" text,
  "status" text DEFAULT 'running' CHECK ("status" IN ('running','completed','failed','paused','cancelled')),
  "current_node_id" text,
  "started_at" timestamptz,
  "completed_at" timestamptz,
  "failed_at" timestamptz,
  "failure_reason" text,
  "timer_resume_at" timestamptz,
  "timer_next_node_id" text,
  "variables" jsonb DEFAULT '{}'::jsonb,
  "id" text PRIMARY KEY CHECK ("id" ~ '^[0-9a-f]{24}$'),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  api_version bigint,
  legacy_extra jsonb NOT NULL DEFAULT '{}',
  legacy_refs jsonb NOT NULL DEFAULT '{}',
  source_missing text[] NOT NULL DEFAULT '{}',
  row_version bigint NOT NULL DEFAULT 0);

CREATE TABLE "__TENANT_SCHEMA__"."execution_events" (owner_id text NOT NULL REFERENCES "__TENANT_SCHEMA__"."workflow_executions"(id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED,
  tenant_id text,
  position integer NOT NULL CHECK (position >= 0),
  "node_id" text,
  "node_type" text,
  "entered_at" timestamptz,
  "exited_at" timestamptz,
  "status" text CHECK ("status" IN ('in_progress','completed','failed','skipped')),
  "output" jsonb,
  "id" text,
  legacy_extra jsonb NOT NULL DEFAULT '{}',
  legacy_refs jsonb NOT NULL DEFAULT '{}',
  source_missing text[] NOT NULL DEFAULT '{}',
  row_version bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (owner_id,position));

CREATE TABLE "__TENANT_SCHEMA__"."tasks" ("org_id" text,
  "workflow_execution_id" text,
  "workflow_id" text,
  "assigned_to" text,
  "submitted_by" text,
  "form_response_id" text,
  "title" text NOT NULL,
  "type" text NOT NULL,
  "action_type" text DEFAULT 'approval' CHECK ("action_type" IN ('approval','submit','review')),
  "status" text DEFAULT 'pending' CHECK ("status" IN ('pending','approved','rejected','escalated','completed','cancelled')),
  "due_date" timestamptz,
  "current_node" text,
  "instructions" text,
  "require_attachment" boolean DEFAULT false,
  "form_fields" jsonb DEFAULT '[]'::jsonb,
  "form_data" jsonb DEFAULT '{}'::jsonb,
  "require_signature" boolean DEFAULT false,
  "attachments" jsonb DEFAULT '[]'::jsonb,
  "approval_type" text DEFAULT 'sequential' CHECK ("approval_type" IN ('sequential','parallel')),
  "required_approvals" numeric DEFAULT 1,
  "escalation_level" numeric DEFAULT 0,
  "is_escalated" boolean DEFAULT false,
  "id" text PRIMARY KEY CHECK ("id" ~ '^[0-9a-f]{24}$'),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  api_version bigint,
  legacy_extra jsonb NOT NULL DEFAULT '{}',
  legacy_refs jsonb NOT NULL DEFAULT '{}',
  source_missing text[] NOT NULL DEFAULT '{}',
  row_version bigint NOT NULL DEFAULT 0);

CREATE TABLE "__TENANT_SCHEMA__"."task_approvers" (owner_id text NOT NULL REFERENCES "__TENANT_SCHEMA__"."tasks"(id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED,
  tenant_id text,
  position integer NOT NULL CHECK (position >= 0),
  "user_id" text,
  legacy_extra jsonb NOT NULL DEFAULT '{}',
  legacy_refs jsonb NOT NULL DEFAULT '{}',
  source_missing text[] NOT NULL DEFAULT '{}',
  row_version bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (owner_id,position));

CREATE TABLE "__TENANT_SCHEMA__"."task_votes" (owner_id text NOT NULL REFERENCES "__TENANT_SCHEMA__"."tasks"(id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED,
  tenant_id text,
  position integer NOT NULL CHECK (position >= 0),
  "user_id" text,
  "status" text CHECK ("status" IN ('pending','approved','rejected')),
  "decided_at" timestamptz,
  "id" text,
  legacy_extra jsonb NOT NULL DEFAULT '{}',
  legacy_refs jsonb NOT NULL DEFAULT '{}',
  source_missing text[] NOT NULL DEFAULT '{}',
  row_version bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (owner_id,position));

CREATE TABLE "__TENANT_SCHEMA__"."task_history" (owner_id text NOT NULL REFERENCES "__TENANT_SCHEMA__"."tasks"(id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED,
  tenant_id text,
  position integer NOT NULL CHECK (position >= 0),
  "action" text CHECK ("action" IN ('submitted','approved','rejected','request_changes','escalated','reassigned')),
  "performed_by" text,
  "performed_at" timestamptz,
  "comment" text,
  "signature" jsonb,
  "id" text,
  legacy_extra jsonb NOT NULL DEFAULT '{}',
  legacy_refs jsonb NOT NULL DEFAULT '{}',
  source_missing text[] NOT NULL DEFAULT '{}',
  row_version bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (owner_id,position));

CREATE TABLE "__TENANT_SCHEMA__"."notifications" ("org_id" text,
  "user_id" text NOT NULL,
  "title" text NOT NULL,
  "message" text NOT NULL,
  "type" text NOT NULL CHECK ("type" IN ('approval','rejection','escalation','assignment','reminder','system')),
  "is_read" boolean DEFAULT false,
  "task_id" text,
  "triggered_by" text,
  "id" text PRIMARY KEY CHECK ("id" ~ '^[0-9a-f]{24}$'),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  api_version bigint,
  legacy_extra jsonb NOT NULL DEFAULT '{}',
  legacy_refs jsonb NOT NULL DEFAULT '{}',
  source_missing text[] NOT NULL DEFAULT '{}',
  row_version bigint NOT NULL DEFAULT 0);

CREATE TABLE "__TENANT_SCHEMA__"."audit_logs" ("org_id" text,
  "action" text NOT NULL CHECK ("action" IN ('form_submitted','form_deleted','task_approved','task_rejected','task_submitted','task_escalated','workflow_started','workflow_completed','workflow_failed','workflow_deleted','user_invited','user_updated','user_deleted','builder_access_granted','builder_access_revoked','role_changed','request_changes','approver_inferred','workflow_cancelled','webhook_called','webhook_received','users_imported','user_logged_in','department_created','department_renamed','department_deleted','org_settings_updated','org_created','org_updated','org_suspended','org_activated','org_deleted','org_admin_password_reset','org_storage_extended','org_storage_extension_revoked','org_licence_expired','org_limit_reached','platform_broadcast_sent')),
  "performed_by" text,
  "target_entity" text NOT NULL,
  "department" text,
  "ip_address" text,
  "detail" text,
  "metadata" jsonb DEFAULT '{}'::jsonb,
  "id" text PRIMARY KEY CHECK ("id" ~ '^[0-9a-f]{24}$'),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  api_version bigint,
  legacy_extra jsonb NOT NULL DEFAULT '{}',
  legacy_refs jsonb NOT NULL DEFAULT '{}',
  source_missing text[] NOT NULL DEFAULT '{}',
  row_version bigint NOT NULL DEFAULT 0);

CREATE TABLE "__TENANT_SCHEMA__"."document_extraction_jobs" ("org_id" text NOT NULL,
  "form_id" text NOT NULL,
  "requester_id" text,
  "audience" text NOT NULL CHECK ("audience" IN ('authenticated','public')),
  "language_mode" text DEFAULT 'english_hindi' CHECK ("language_mode" IN ('english','english_hindi','hindi')),
  "access_token_hash" text,
  "source_file" jsonb NOT NULL,
  "status" text DEFAULT 'queued' CHECK ("status" IN ('queued','security_scan','inspecting','extracting_text','ocr_processing','mapping_fields','validating','ready','failed','cancelled')),
  "stage" text DEFAULT 'Queued for processing',
  "progress" numeric DEFAULT 0 CHECK ("progress" >= 0) CHECK ("progress" <= 100),
  "attempts" numeric DEFAULT 0,
  "claimed_at" timestamptz,
  "page_count" numeric DEFAULT 0,
  "page_meta" jsonb DEFAULT '[]'::jsonb,
  "lines" jsonb DEFAULT '[]'::jsonb,
  "template_fingerprint" text,
  "document_type" text DEFAULT 'document' CHECK (char_length("document_type") <= 80),
  "critic_status" text DEFAULT 'fallback' CHECK ("critic_status" IN ('validated','unavailable','fallback')),
  "suggestions" jsonb DEFAULT '[]'::jsonb,
  "summary" jsonb,
  "error_code" text,
  "error_detail" text,
  "consumed_response_id" text,
  "consumed_at" timestamptz,
  "feedback_processed_at" timestamptz,
  "feedback_response_id" text,
  "expires_at" timestamptz NOT NULL,
  "id" text PRIMARY KEY CHECK ("id" ~ '^[0-9a-f]{24}$'),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  api_version bigint,
  legacy_extra jsonb NOT NULL DEFAULT '{}',
  legacy_refs jsonb NOT NULL DEFAULT '{}',
  source_missing text[] NOT NULL DEFAULT '{}',
  row_version bigint NOT NULL DEFAULT 0);

CREATE TABLE "__TENANT_SCHEMA__"."form_generation_jobs" ("org_id" text NOT NULL,
  "requester_id" text NOT NULL,
  "language_mode" text DEFAULT 'english_hindi' CHECK ("language_mode" IN ('english','english_hindi','hindi')),
  "source_file" jsonb NOT NULL,
  "status" text DEFAULT 'queued' CHECK ("status" IN ('queued','security_scan','inspecting','extracting_text','ocr_processing','generating_schema','validating','ready','failed','cancelled')),
  "stage" text DEFAULT 'Queued for processing',
  "progress" numeric DEFAULT 0 CHECK ("progress" >= 0) CHECK ("progress" <= 100),
  "attempts" numeric DEFAULT 0,
  "claimed_at" timestamptz,
  "retry_at" timestamptz,
  "page_count" numeric DEFAULT 0,
  "page_meta" jsonb DEFAULT '[]'::jsonb,
  "lines" jsonb DEFAULT '[]'::jsonb,
  "generated_title" text DEFAULT '',
  "generated_description" text DEFAULT '',
  "document_type" text DEFAULT '',
  "critic_status" text DEFAULT 'validated' CHECK ("critic_status" IN ('validated','unavailable')),
  "candidates" jsonb DEFAULT '[]'::jsonb,
  "confidence_summary" jsonb,
  "quality_summary" jsonb,
  "processing_version" numeric DEFAULT 1,
  "max_fields" numeric DEFAULT 25,
  "limit_reached" boolean DEFAULT false,
  "coverage" jsonb,
  "truncated" boolean DEFAULT false,
  "detected_field_count" numeric DEFAULT 0,
  "error_code" text,
  "error_detail" text,
  "expires_at" timestamptz NOT NULL,
  "id" text PRIMARY KEY CHECK ("id" ~ '^[0-9a-f]{24}$'),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  api_version bigint,
  legacy_extra jsonb NOT NULL DEFAULT '{}',
  legacy_refs jsonb NOT NULL DEFAULT '{}',
  source_missing text[] NOT NULL DEFAULT '{}',
  row_version bigint NOT NULL DEFAULT 0);

CREATE TABLE "__TENANT_SCHEMA__"."pdf_auto_fill_learning_profiles" ("org_id" text NOT NULL,
  "form_id" text NOT NULL,
  "template_fingerprint" text NOT NULL,
  "field_id" text NOT NULL,
  "evidence_key" text NOT NULL,
  "value_pattern" text NOT NULL CHECK ("value_pattern" IN ('empty','boolean','number','date','numeric_identifier','alphanumeric_identifier','identifier_list','text')),
  "positive_streak" numeric DEFAULT 0 CHECK ("positive_streak" >= 0),
  "total_confirmations" numeric DEFAULT 0 CHECK ("total_confirmations" >= 0),
  "correction_count" numeric DEFAULT 0 CHECK ("correction_count" >= 0),
  "dismissal_count" numeric DEFAULT 0 CHECK ("dismissal_count" >= 0),
  "learned_tier" text DEFAULT 'none' CHECK ("learned_tier" IN ('none','medium','high')),
  "last_feedback_at" timestamptz,
  "id" text PRIMARY KEY CHECK ("id" ~ '^[0-9a-f]{24}$'),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  api_version bigint,
  legacy_extra jsonb NOT NULL DEFAULT '{}',
  legacy_refs jsonb NOT NULL DEFAULT '{}',
  source_missing text[] NOT NULL DEFAULT '{}',
  row_version bigint NOT NULL DEFAULT 0);

CREATE TABLE "__TENANT_SCHEMA__"."pdf_auto_fill_semantic_profiles" ("org_id" text NOT NULL,
  "form_id" text NOT NULL,
  "document_type" text NOT NULL CHECK (char_length("document_type") <= 80),
  "source_alias" text NOT NULL CHECK (char_length("source_alias") <= 160),
  "field_id" text NOT NULL,
  "value_pattern" text NOT NULL CHECK ("value_pattern" IN ('empty','boolean','number','date','numeric_identifier','alphanumeric_identifier','identifier_list','text')),
  "positive_streak" numeric DEFAULT 0 CHECK ("positive_streak" >= 0),
  "total_confirmations" numeric DEFAULT 0 CHECK ("total_confirmations" >= 0),
  "correction_count" numeric DEFAULT 0 CHECK ("correction_count" >= 0),
  "dismissal_count" numeric DEFAULT 0 CHECK ("dismissal_count" >= 0),
  "learned_tier" text DEFAULT 'none' CHECK ("learned_tier" IN ('none','medium','high')),
  "last_feedback_at" timestamptz,
  "id" text PRIMARY KEY CHECK ("id" ~ '^[0-9a-f]{24}$'),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  api_version bigint,
  legacy_extra jsonb NOT NULL DEFAULT '{}',
  legacy_refs jsonb NOT NULL DEFAULT '{}',
  source_missing text[] NOT NULL DEFAULT '{}',
  row_version bigint NOT NULL DEFAULT 0);

CREATE TABLE "__TENANT_SCHEMA__"."integration_dead_letters" ("org_id" text,
  "workflow_id" text,
  "execution_id" text,
  "node_id" text,
  "url" text,
  "method" text,
  "error" text,
  "http_status" numeric,
  "attempts" numeric,
  "request_body_preview" text,
  "resolved" boolean DEFAULT false,
  "resolved_at" timestamptz,
  "resolved_by" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "id" text PRIMARY KEY CHECK ("id" ~ '^[0-9a-f]{24}$'),
  api_version bigint,
  legacy_extra jsonb NOT NULL DEFAULT '{}',
  legacy_refs jsonb NOT NULL DEFAULT '{}',
  source_missing text[] NOT NULL DEFAULT '{}',
  row_version bigint NOT NULL DEFAULT 0);

CREATE TABLE "__TENANT_SCHEMA__"."webhook_delivery_logs" ("org_id" text,
  "workflow_id" text,
  "execution_id" text,
  "ok" boolean DEFAULT false,
  "status_code" numeric,
  "error" text,
  "code" text,
  "ip" text,
  "payload_keys" text[] DEFAULT ARRAY[]::text[],
  "has_signature" boolean DEFAULT false,
  "idempotency_key" text,
  "replay" boolean DEFAULT false,
  "duration_ms" numeric,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "id" text PRIMARY KEY CHECK ("id" ~ '^[0-9a-f]{24}$'),
  api_version bigint,
  legacy_extra jsonb NOT NULL DEFAULT '{}',
  legacy_refs jsonb NOT NULL DEFAULT '{}',
  source_missing text[] NOT NULL DEFAULT '{}',
  row_version bigint NOT NULL DEFAULT 0);

CREATE TABLE "__TENANT_SCHEMA__"."webhook_idempotencies" ("org_id" text,
  "workflow_id" text NOT NULL,
  "key" text NOT NULL,
  "execution_id" text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "id" text PRIMARY KEY CHECK ("id" ~ '^[0-9a-f]{24}$'),
  api_version bigint,
  legacy_extra jsonb NOT NULL DEFAULT '{}',
  legacy_refs jsonb NOT NULL DEFAULT '{}',
  source_missing text[] NOT NULL DEFAULT '{}',
  row_version bigint NOT NULL DEFAULT 0);

CREATE TABLE "__TENANT_SCHEMA__"."organization_departments" (owner_id text NOT NULL REFERENCES "platform"."organizations"(id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED,
  tenant_id text,
  position integer NOT NULL CHECK (position >= 0),
  "name" text NOT NULL,
  legacy_extra jsonb NOT NULL DEFAULT '{}',
  legacy_refs jsonb NOT NULL DEFAULT '{}',
  source_missing text[] NOT NULL DEFAULT '{}',
  row_version bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (owner_id,position));

CREATE TABLE "__TENANT_SCHEMA__"."organization_usage" (owner_id text NOT NULL REFERENCES "platform"."organizations"(id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED,
  tenant_id text,
  "storage_bytes" numeric DEFAULT 0,
  "file_count" numeric DEFAULT 0,
  "buffer_bytes_used" numeric DEFAULT 0,
  "submissions_period_start" timestamptz,
  "submissions_period_end" timestamptz,
  "submissions_count" numeric DEFAULT 0,
  "notified" jsonb,
  legacy_extra jsonb NOT NULL DEFAULT '{}',
  legacy_refs jsonb NOT NULL DEFAULT '{}',
  source_missing text[] NOT NULL DEFAULT '{}',
  row_version bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (owner_id));

CREATE TABLE "__TENANT_SCHEMA__"."organization_integrations" (owner_id text NOT NULL REFERENCES "platform"."organizations"(id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED,
  tenant_id text,
  "s3_enabled" boolean DEFAULT false,
  "s3_bucket" text DEFAULT '',
  "s3_endpoint" text DEFAULT '',
  "s3_region" text DEFAULT 'auto',
  "s3_access_key_id" text DEFAULT '',
  "s3_secret_access_key" text DEFAULT '',
  "dms_api_key" text DEFAULT '',
  "dms_name" text DEFAULT '' CHECK (char_length("dms_name") <= 80),
  "dms_base_url" text DEFAULT '',
  "dms_jwt" text DEFAULT '',
  "dms_enabled" boolean DEFAULT false,
  "dms_org_slug" text DEFAULT '',
  legacy_extra jsonb NOT NULL DEFAULT '{}',
  legacy_refs jsonb NOT NULL DEFAULT '{}',
  source_missing text[] NOT NULL DEFAULT '{}',
  row_version bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (owner_id));

CREATE TABLE "__TENANT_SCHEMA__"."organization_department_integrations" (owner_id text NOT NULL REFERENCES "platform"."organizations"(id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED,
  tenant_id text,
  position integer NOT NULL CHECK (position >= 0),
  "department" text NOT NULL,
  "api_key" text DEFAULT '',
  "base_url" text DEFAULT '',
  "folder" text DEFAULT '',
  "enabled" boolean DEFAULT true,
  legacy_extra jsonb NOT NULL DEFAULT '{}',
  legacy_refs jsonb NOT NULL DEFAULT '{}',
  source_missing text[] NOT NULL DEFAULT '{}',
  row_version bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (owner_id,position));

ALTER TABLE "__TENANT_SCHEMA__"."roles" ADD CONSTRAINT "roles_org_id_fk" FOREIGN KEY ("org_id") REFERENCES "platform"."organizations"(id) DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX "roles_org_id_idx" ON "__TENANT_SCHEMA__"."roles"("org_id");

CREATE INDEX "roles_source_0" ON "__TENANT_SCHEMA__"."roles"("org_id" ASC);

ALTER TABLE "__TENANT_SCHEMA__"."users" ADD CONSTRAINT "users_org_id_fk" FOREIGN KEY ("org_id") REFERENCES "platform"."organizations"(id) DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX "users_org_id_idx" ON "__TENANT_SCHEMA__"."users"("org_id");

ALTER TABLE "__TENANT_SCHEMA__"."users" ADD CONSTRAINT "users_role_fk" FOREIGN KEY ("role") REFERENCES "__TENANT_SCHEMA__"."roles"(id) DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX "users_role_idx" ON "__TENANT_SCHEMA__"."users"("role");

ALTER TABLE "__TENANT_SCHEMA__"."users" ADD CONSTRAINT "users_manager_id_fk" FOREIGN KEY ("manager_id") REFERENCES "__TENANT_SCHEMA__"."users"(id) DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX "users_manager_id_idx" ON "__TENANT_SCHEMA__"."users"("manager_id");

ALTER TABLE "__TENANT_SCHEMA__"."users" ADD CONSTRAINT "users_hr_id_fk" FOREIGN KEY ("hr_id") REFERENCES "__TENANT_SCHEMA__"."users"(id) DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX "users_hr_id_idx" ON "__TENANT_SCHEMA__"."users"("hr_id");

ALTER TABLE "__TENANT_SCHEMA__"."users" ADD CONSTRAINT "users_out_of_office_delegate_id_fk" FOREIGN KEY ("out_of_office_delegate_id") REFERENCES "__TENANT_SCHEMA__"."users"(id) DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX "users_out_of_office_delegate_id_idx" ON "__TENANT_SCHEMA__"."users"("out_of_office_delegate_id");

CREATE INDEX "users_source_0" ON "__TENANT_SCHEMA__"."users"("org_id" ASC);

ALTER TABLE "__TENANT_SCHEMA__"."forms" ADD CONSTRAINT "forms_org_id_fk" FOREIGN KEY ("org_id") REFERENCES "platform"."organizations"(id) DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX "forms_org_id_idx" ON "__TENANT_SCHEMA__"."forms"("org_id");

ALTER TABLE "__TENANT_SCHEMA__"."forms" ADD CONSTRAINT "forms_created_by_fk" FOREIGN KEY ("created_by") REFERENCES "__TENANT_SCHEMA__"."users"(id) DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX "forms_created_by_idx" ON "__TENANT_SCHEMA__"."forms"("created_by");

CREATE INDEX "forms_source_0" ON "__TENANT_SCHEMA__"."forms"("org_id" ASC);

CREATE INDEX "forms_source_1" ON "__TENANT_SCHEMA__"."forms"("public_token" ASC);

ALTER TABLE "__TENANT_SCHEMA__"."form_drafts" ADD CONSTRAINT "form_drafts_org_id_fk" FOREIGN KEY ("org_id") REFERENCES "platform"."organizations"(id) DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX "form_drafts_org_id_idx" ON "__TENANT_SCHEMA__"."form_drafts"("org_id");

ALTER TABLE "__TENANT_SCHEMA__"."form_drafts" ADD CONSTRAINT "form_drafts_form_id_fk" FOREIGN KEY ("form_id") REFERENCES "__TENANT_SCHEMA__"."forms"(id) DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX "form_drafts_form_id_idx" ON "__TENANT_SCHEMA__"."form_drafts"("form_id");

ALTER TABLE "__TENANT_SCHEMA__"."form_drafts" ADD CONSTRAINT "form_drafts_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "__TENANT_SCHEMA__"."users"(id) DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX "form_drafts_user_id_idx" ON "__TENANT_SCHEMA__"."form_drafts"("user_id");

CREATE INDEX "form_drafts_source_0" ON "__TENANT_SCHEMA__"."form_drafts"("org_id" ASC);

CREATE UNIQUE INDEX "form_drafts_source_1" ON "__TENANT_SCHEMA__"."form_drafts"("form_id" ASC,"user_id" ASC);

ALTER TABLE "__TENANT_SCHEMA__"."form_responses" ADD CONSTRAINT "form_responses_org_id_fk" FOREIGN KEY ("org_id") REFERENCES "platform"."organizations"(id) DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX "form_responses_org_id_idx" ON "__TENANT_SCHEMA__"."form_responses"("org_id");

ALTER TABLE "__TENANT_SCHEMA__"."form_responses" ADD CONSTRAINT "form_responses_form_id_fk" FOREIGN KEY ("form_id") REFERENCES "__TENANT_SCHEMA__"."forms"(id) DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX "form_responses_form_id_idx" ON "__TENANT_SCHEMA__"."form_responses"("form_id");

ALTER TABLE "__TENANT_SCHEMA__"."form_responses" ADD CONSTRAINT "form_responses_submitted_by_fk" FOREIGN KEY ("submitted_by") REFERENCES "__TENANT_SCHEMA__"."users"(id) DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX "form_responses_submitted_by_idx" ON "__TENANT_SCHEMA__"."form_responses"("submitted_by");

CREATE INDEX "form_responses_source_0" ON "__TENANT_SCHEMA__"."form_responses"("org_id" ASC);

ALTER TABLE "__TENANT_SCHEMA__"."workflows" ADD CONSTRAINT "workflows_org_id_fk" FOREIGN KEY ("org_id") REFERENCES "platform"."organizations"(id) DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX "workflows_org_id_idx" ON "__TENANT_SCHEMA__"."workflows"("org_id");

ALTER TABLE "__TENANT_SCHEMA__"."workflows" ADD CONSTRAINT "workflows_linked_form_id_fk" FOREIGN KEY ("linked_form_id") REFERENCES "__TENANT_SCHEMA__"."forms"(id) DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX "workflows_linked_form_id_idx" ON "__TENANT_SCHEMA__"."workflows"("linked_form_id");

ALTER TABLE "__TENANT_SCHEMA__"."workflows" ADD CONSTRAINT "workflows_created_by_fk" FOREIGN KEY ("created_by") REFERENCES "__TENANT_SCHEMA__"."users"(id) DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX "workflows_created_by_idx" ON "__TENANT_SCHEMA__"."workflows"("created_by");

ALTER TABLE "__TENANT_SCHEMA__"."workflows" ADD CONSTRAINT "workflows_previous_version_id_fk" FOREIGN KEY ("previous_version_id") REFERENCES "__TENANT_SCHEMA__"."workflows"(id) DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX "workflows_previous_version_id_idx" ON "__TENANT_SCHEMA__"."workflows"("previous_version_id");

ALTER TABLE "__TENANT_SCHEMA__"."workflow_forms" ADD CONSTRAINT "workflow_forms_form_id_fk" FOREIGN KEY ("form_id") REFERENCES "__TENANT_SCHEMA__"."forms"(id) DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX "workflow_forms_form_id_idx" ON "__TENANT_SCHEMA__"."workflow_forms"("form_id");

ALTER TABLE "__TENANT_SCHEMA__"."workflow_initiators" ADD CONSTRAINT "workflow_initiators_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "__TENANT_SCHEMA__"."users"(id) DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX "workflow_initiators_user_id_idx" ON "__TENANT_SCHEMA__"."workflow_initiators"("user_id");

ALTER TABLE "__TENANT_SCHEMA__"."workflow_viewers" ADD CONSTRAINT "workflow_viewers_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "__TENANT_SCHEMA__"."users"(id) DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX "workflow_viewers_user_id_idx" ON "__TENANT_SCHEMA__"."workflow_viewers"("user_id");

CREATE INDEX "workflows_source_0" ON "__TENANT_SCHEMA__"."workflows"("org_id" ASC);

CREATE INDEX "workflows_source_1" ON "__TENANT_SCHEMA__"."workflows"("inbound_webhook_token" ASC) WHERE "inbound_webhook_token" IS NOT NULL;

ALTER TABLE "__TENANT_SCHEMA__"."workflow_executions" ADD CONSTRAINT "workflow_executions_org_id_fk" FOREIGN KEY ("org_id") REFERENCES "platform"."organizations"(id) DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX "workflow_executions_org_id_idx" ON "__TENANT_SCHEMA__"."workflow_executions"("org_id");

ALTER TABLE "__TENANT_SCHEMA__"."workflow_executions" ADD CONSTRAINT "workflow_executions_workflow_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "__TENANT_SCHEMA__"."workflows"(id) DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX "workflow_executions_workflow_id_idx" ON "__TENANT_SCHEMA__"."workflow_executions"("workflow_id");

ALTER TABLE "__TENANT_SCHEMA__"."workflow_executions" ADD CONSTRAINT "workflow_executions_form_response_id_fk" FOREIGN KEY ("form_response_id") REFERENCES "__TENANT_SCHEMA__"."form_responses"(id) DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX "workflow_executions_form_response_id_idx" ON "__TENANT_SCHEMA__"."workflow_executions"("form_response_id");

ALTER TABLE "__TENANT_SCHEMA__"."workflow_executions" ADD CONSTRAINT "workflow_executions_triggered_by_fk" FOREIGN KEY ("triggered_by") REFERENCES "__TENANT_SCHEMA__"."users"(id) DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX "workflow_executions_triggered_by_idx" ON "__TENANT_SCHEMA__"."workflow_executions"("triggered_by");

CREATE INDEX "workflow_executions_source_0" ON "__TENANT_SCHEMA__"."workflow_executions"("org_id" ASC);

CREATE UNIQUE INDEX "workflow_executions_source_1" ON "__TENANT_SCHEMA__"."workflow_executions"("status_token" ASC) WHERE "status_token" IS NOT NULL;

CREATE INDEX "workflow_executions_source_2" ON "__TENANT_SCHEMA__"."workflow_executions"("timer_resume_at" ASC);

CREATE INDEX "workflow_executions_source_3" ON "__TENANT_SCHEMA__"."workflow_executions"("org_id" ASC,"workflow_id" ASC,"status" ASC,"created_at" DESC);

ALTER TABLE "__TENANT_SCHEMA__"."tasks" ADD CONSTRAINT "tasks_org_id_fk" FOREIGN KEY ("org_id") REFERENCES "platform"."organizations"(id) DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX "tasks_org_id_idx" ON "__TENANT_SCHEMA__"."tasks"("org_id");

ALTER TABLE "__TENANT_SCHEMA__"."tasks" ADD CONSTRAINT "tasks_workflow_execution_id_fk" FOREIGN KEY ("workflow_execution_id") REFERENCES "__TENANT_SCHEMA__"."workflow_executions"(id) DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX "tasks_workflow_execution_id_idx" ON "__TENANT_SCHEMA__"."tasks"("workflow_execution_id");

ALTER TABLE "__TENANT_SCHEMA__"."tasks" ADD CONSTRAINT "tasks_workflow_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "__TENANT_SCHEMA__"."workflows"(id) DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX "tasks_workflow_id_idx" ON "__TENANT_SCHEMA__"."tasks"("workflow_id");

ALTER TABLE "__TENANT_SCHEMA__"."tasks" ADD CONSTRAINT "tasks_assigned_to_fk" FOREIGN KEY ("assigned_to") REFERENCES "__TENANT_SCHEMA__"."users"(id) DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX "tasks_assigned_to_idx" ON "__TENANT_SCHEMA__"."tasks"("assigned_to");

ALTER TABLE "__TENANT_SCHEMA__"."tasks" ADD CONSTRAINT "tasks_submitted_by_fk" FOREIGN KEY ("submitted_by") REFERENCES "__TENANT_SCHEMA__"."users"(id) DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX "tasks_submitted_by_idx" ON "__TENANT_SCHEMA__"."tasks"("submitted_by");

ALTER TABLE "__TENANT_SCHEMA__"."tasks" ADD CONSTRAINT "tasks_form_response_id_fk" FOREIGN KEY ("form_response_id") REFERENCES "__TENANT_SCHEMA__"."form_responses"(id) DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX "tasks_form_response_id_idx" ON "__TENANT_SCHEMA__"."tasks"("form_response_id");

ALTER TABLE "__TENANT_SCHEMA__"."task_approvers" ADD CONSTRAINT "task_approvers_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "__TENANT_SCHEMA__"."users"(id) DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX "task_approvers_user_id_idx" ON "__TENANT_SCHEMA__"."task_approvers"("user_id");

ALTER TABLE "__TENANT_SCHEMA__"."task_votes" ADD CONSTRAINT "task_votes_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "__TENANT_SCHEMA__"."users"(id) DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX "task_votes_user_id_idx" ON "__TENANT_SCHEMA__"."task_votes"("user_id");

ALTER TABLE "__TENANT_SCHEMA__"."task_history" ADD CONSTRAINT "task_history_performed_by_fk" FOREIGN KEY ("performed_by") REFERENCES "__TENANT_SCHEMA__"."users"(id) DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX "task_history_performed_by_idx" ON "__TENANT_SCHEMA__"."task_history"("performed_by");

CREATE INDEX "tasks_source_0" ON "__TENANT_SCHEMA__"."tasks"("org_id" ASC);

CREATE INDEX "tasks_source_1" ON "__TENANT_SCHEMA__"."tasks"("assigned_to" ASC,"status" ASC);

CREATE INDEX "tasks_source_2" ON "__TENANT_SCHEMA__"."tasks"("due_date" ASC,"status" ASC,"is_escalated" ASC);

CREATE INDEX "tasks_source_3" ON "__TENANT_SCHEMA__"."tasks"("org_id" ASC,"workflow_id" ASC,"status" ASC,"due_date" ASC);

ALTER TABLE "__TENANT_SCHEMA__"."notifications" ADD CONSTRAINT "notifications_org_id_fk" FOREIGN KEY ("org_id") REFERENCES "platform"."organizations"(id) DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX "notifications_org_id_idx" ON "__TENANT_SCHEMA__"."notifications"("org_id");

ALTER TABLE "__TENANT_SCHEMA__"."notifications" ADD CONSTRAINT "notifications_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "__TENANT_SCHEMA__"."users"(id) DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX "notifications_user_id_idx" ON "__TENANT_SCHEMA__"."notifications"("user_id");

ALTER TABLE "__TENANT_SCHEMA__"."notifications" ADD CONSTRAINT "notifications_task_id_fk" FOREIGN KEY ("task_id") REFERENCES "__TENANT_SCHEMA__"."tasks"(id) DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX "notifications_task_id_idx" ON "__TENANT_SCHEMA__"."notifications"("task_id");

ALTER TABLE "__TENANT_SCHEMA__"."notifications" ADD CONSTRAINT "notifications_triggered_by_fk" FOREIGN KEY ("triggered_by") REFERENCES system.user_directory(user_id) DEFERRABLE INITIALLY DEFERRED;

CREATE TRIGGER "notifications_triggered_by_scope" BEFORE INSERT OR UPDATE ON "__TENANT_SCHEMA__"."notifications" FOR EACH ROW EXECUTE FUNCTION system.check_directory_actor('triggered_by');

CREATE INDEX "notifications_source_0" ON "__TENANT_SCHEMA__"."notifications"("org_id" ASC);

CREATE INDEX "notifications_source_1" ON "__TENANT_SCHEMA__"."notifications"("user_id" ASC,"is_read" ASC,"created_at" DESC);

CREATE INDEX "audit_logs_source_0" ON "__TENANT_SCHEMA__"."audit_logs"("org_id" ASC);

CREATE INDEX "audit_logs_source_1" ON "__TENANT_SCHEMA__"."audit_logs"("created_at" DESC);

CREATE INDEX "audit_logs_source_2" ON "__TENANT_SCHEMA__"."audit_logs"("action" ASC,"created_at" DESC);

CREATE INDEX "audit_logs_source_3" ON "__TENANT_SCHEMA__"."audit_logs"("performed_by" ASC,"created_at" DESC);

ALTER TABLE "__TENANT_SCHEMA__"."document_extraction_jobs" ADD CONSTRAINT "document_extraction_jobs_org_id_fk" FOREIGN KEY ("org_id") REFERENCES "platform"."organizations"(id) DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX "document_extraction_jobs_org_id_idx" ON "__TENANT_SCHEMA__"."document_extraction_jobs"("org_id");

ALTER TABLE "__TENANT_SCHEMA__"."document_extraction_jobs" ADD CONSTRAINT "document_extraction_jobs_form_id_fk" FOREIGN KEY ("form_id") REFERENCES "__TENANT_SCHEMA__"."forms"(id) DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX "document_extraction_jobs_form_id_idx" ON "__TENANT_SCHEMA__"."document_extraction_jobs"("form_id");

ALTER TABLE "__TENANT_SCHEMA__"."document_extraction_jobs" ADD CONSTRAINT "document_extraction_jobs_requester_id_fk" FOREIGN KEY ("requester_id") REFERENCES "__TENANT_SCHEMA__"."users"(id) DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX "document_extraction_jobs_requester_id_idx" ON "__TENANT_SCHEMA__"."document_extraction_jobs"("requester_id");

ALTER TABLE "__TENANT_SCHEMA__"."document_extraction_jobs" ADD CONSTRAINT "document_extraction_jobs_consumed_response_id_fk" FOREIGN KEY ("consumed_response_id") REFERENCES "__TENANT_SCHEMA__"."form_responses"(id) DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX "document_extraction_jobs_consumed_response_id_idx" ON "__TENANT_SCHEMA__"."document_extraction_jobs"("consumed_response_id");

ALTER TABLE "__TENANT_SCHEMA__"."document_extraction_jobs" ADD CONSTRAINT "document_extraction_jobs_feedback_response_id_fk" FOREIGN KEY ("feedback_response_id") REFERENCES "__TENANT_SCHEMA__"."form_responses"(id) DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX "document_extraction_jobs_feedback_response_id_idx" ON "__TENANT_SCHEMA__"."document_extraction_jobs"("feedback_response_id");

CREATE INDEX "document_extraction_jobs_source_0" ON "__TENANT_SCHEMA__"."document_extraction_jobs"("org_id" ASC);

CREATE INDEX "document_extraction_jobs_source_1" ON "__TENANT_SCHEMA__"."document_extraction_jobs"("form_id" ASC);

CREATE INDEX "document_extraction_jobs_source_2" ON "__TENANT_SCHEMA__"."document_extraction_jobs"("requester_id" ASC);

CREATE INDEX "document_extraction_jobs_source_3" ON "__TENANT_SCHEMA__"."document_extraction_jobs"("status" ASC);

CREATE INDEX "document_extraction_jobs_source_4" ON "__TENANT_SCHEMA__"."document_extraction_jobs"("expires_at" ASC);

CREATE INDEX "document_extraction_jobs_source_5" ON "__TENANT_SCHEMA__"."document_extraction_jobs"("status" ASC,"created_at" ASC);

ALTER TABLE "__TENANT_SCHEMA__"."form_generation_jobs" ADD CONSTRAINT "form_generation_jobs_org_id_fk" FOREIGN KEY ("org_id") REFERENCES "platform"."organizations"(id) DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX "form_generation_jobs_org_id_idx" ON "__TENANT_SCHEMA__"."form_generation_jobs"("org_id");

ALTER TABLE "__TENANT_SCHEMA__"."form_generation_jobs" ADD CONSTRAINT "form_generation_jobs_requester_id_fk" FOREIGN KEY ("requester_id") REFERENCES "__TENANT_SCHEMA__"."users"(id) DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX "form_generation_jobs_requester_id_idx" ON "__TENANT_SCHEMA__"."form_generation_jobs"("requester_id");

CREATE INDEX "form_generation_jobs_source_0" ON "__TENANT_SCHEMA__"."form_generation_jobs"("org_id" ASC);

CREATE INDEX "form_generation_jobs_source_1" ON "__TENANT_SCHEMA__"."form_generation_jobs"("requester_id" ASC);

CREATE INDEX "form_generation_jobs_source_2" ON "__TENANT_SCHEMA__"."form_generation_jobs"("status" ASC);

CREATE INDEX "form_generation_jobs_source_3" ON "__TENANT_SCHEMA__"."form_generation_jobs"("expires_at" ASC);

CREATE INDEX "form_generation_jobs_source_4" ON "__TENANT_SCHEMA__"."form_generation_jobs"("status" ASC,"retry_at" ASC,"created_at" ASC);

ALTER TABLE "__TENANT_SCHEMA__"."pdf_auto_fill_learning_profiles" ADD CONSTRAINT "pdf_auto_fill_learning_profiles_org_id_fk" FOREIGN KEY ("org_id") REFERENCES "platform"."organizations"(id) DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX "pdf_auto_fill_learning_profiles_org_id_idx" ON "__TENANT_SCHEMA__"."pdf_auto_fill_learning_profiles"("org_id");

ALTER TABLE "__TENANT_SCHEMA__"."pdf_auto_fill_learning_profiles" ADD CONSTRAINT "pdf_auto_fill_learning_profiles_form_id_fk" FOREIGN KEY ("form_id") REFERENCES "__TENANT_SCHEMA__"."forms"(id) DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX "pdf_auto_fill_learning_profiles_form_id_idx" ON "__TENANT_SCHEMA__"."pdf_auto_fill_learning_profiles"("form_id");

CREATE INDEX "pdf_auto_fill_learning_profiles_source_0" ON "__TENANT_SCHEMA__"."pdf_auto_fill_learning_profiles"("org_id" ASC);

CREATE INDEX "pdf_auto_fill_learning_profiles_source_1" ON "__TENANT_SCHEMA__"."pdf_auto_fill_learning_profiles"("form_id" ASC);

CREATE INDEX "pdf_auto_fill_learning_profiles_source_2" ON "__TENANT_SCHEMA__"."pdf_auto_fill_learning_profiles"("template_fingerprint" ASC);

CREATE UNIQUE INDEX "pdf_auto_fill_learning_profiles_source_3" ON "__TENANT_SCHEMA__"."pdf_auto_fill_learning_profiles"("org_id" ASC,"form_id" ASC,"template_fingerprint" ASC,"field_id" ASC,"evidence_key" ASC,"value_pattern" ASC);

ALTER TABLE "__TENANT_SCHEMA__"."pdf_auto_fill_semantic_profiles" ADD CONSTRAINT "pdf_auto_fill_semantic_profiles_org_id_fk" FOREIGN KEY ("org_id") REFERENCES "platform"."organizations"(id) DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX "pdf_auto_fill_semantic_profiles_org_id_idx" ON "__TENANT_SCHEMA__"."pdf_auto_fill_semantic_profiles"("org_id");

ALTER TABLE "__TENANT_SCHEMA__"."pdf_auto_fill_semantic_profiles" ADD CONSTRAINT "pdf_auto_fill_semantic_profiles_form_id_fk" FOREIGN KEY ("form_id") REFERENCES "__TENANT_SCHEMA__"."forms"(id) DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX "pdf_auto_fill_semantic_profiles_form_id_idx" ON "__TENANT_SCHEMA__"."pdf_auto_fill_semantic_profiles"("form_id");

CREATE INDEX "pdf_auto_fill_semantic_profiles_source_0" ON "__TENANT_SCHEMA__"."pdf_auto_fill_semantic_profiles"("org_id" ASC);

CREATE INDEX "pdf_auto_fill_semantic_profiles_source_1" ON "__TENANT_SCHEMA__"."pdf_auto_fill_semantic_profiles"("form_id" ASC);

CREATE INDEX "pdf_auto_fill_semantic_profiles_source_2" ON "__TENANT_SCHEMA__"."pdf_auto_fill_semantic_profiles"("document_type" ASC);

CREATE UNIQUE INDEX "pdf_auto_fill_semantic_profiles_source_3" ON "__TENANT_SCHEMA__"."pdf_auto_fill_semantic_profiles"("org_id" ASC,"form_id" ASC,"document_type" ASC,"source_alias" ASC,"field_id" ASC,"value_pattern" ASC);

ALTER TABLE "__TENANT_SCHEMA__"."integration_dead_letters" ADD CONSTRAINT "integration_dead_letters_org_id_fk" FOREIGN KEY ("org_id") REFERENCES "platform"."organizations"(id) DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX "integration_dead_letters_org_id_idx" ON "__TENANT_SCHEMA__"."integration_dead_letters"("org_id");

ALTER TABLE "__TENANT_SCHEMA__"."integration_dead_letters" ADD CONSTRAINT "integration_dead_letters_workflow_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "__TENANT_SCHEMA__"."workflows"(id) DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX "integration_dead_letters_workflow_id_idx" ON "__TENANT_SCHEMA__"."integration_dead_letters"("workflow_id");

ALTER TABLE "__TENANT_SCHEMA__"."integration_dead_letters" ADD CONSTRAINT "integration_dead_letters_execution_id_fk" FOREIGN KEY ("execution_id") REFERENCES "__TENANT_SCHEMA__"."workflow_executions"(id) DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX "integration_dead_letters_execution_id_idx" ON "__TENANT_SCHEMA__"."integration_dead_letters"("execution_id");

ALTER TABLE "__TENANT_SCHEMA__"."integration_dead_letters" ADD CONSTRAINT "integration_dead_letters_resolved_by_fk" FOREIGN KEY ("resolved_by") REFERENCES system.user_directory(user_id) DEFERRABLE INITIALLY DEFERRED;

CREATE TRIGGER "integration_dead_letters_resolved_by_scope" BEFORE INSERT OR UPDATE ON "__TENANT_SCHEMA__"."integration_dead_letters" FOR EACH ROW EXECUTE FUNCTION system.check_directory_actor('resolved_by');

CREATE INDEX "integration_dead_letters_source_0" ON "__TENANT_SCHEMA__"."integration_dead_letters"("org_id" ASC);

CREATE INDEX "integration_dead_letters_source_1" ON "__TENANT_SCHEMA__"."integration_dead_letters"("workflow_id" ASC);

CREATE INDEX "integration_dead_letters_source_2" ON "__TENANT_SCHEMA__"."integration_dead_letters"("execution_id" ASC);

CREATE INDEX "integration_dead_letters_source_3" ON "__TENANT_SCHEMA__"."integration_dead_letters"("created_at" ASC);

CREATE INDEX "integration_dead_letters_source_4" ON "__TENANT_SCHEMA__"."integration_dead_letters"("org_id" ASC,"resolved" ASC,"created_at" DESC);

ALTER TABLE "__TENANT_SCHEMA__"."webhook_delivery_logs" ADD CONSTRAINT "webhook_delivery_logs_org_id_fk" FOREIGN KEY ("org_id") REFERENCES "platform"."organizations"(id) DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX "webhook_delivery_logs_org_id_idx" ON "__TENANT_SCHEMA__"."webhook_delivery_logs"("org_id");

ALTER TABLE "__TENANT_SCHEMA__"."webhook_delivery_logs" ADD CONSTRAINT "webhook_delivery_logs_workflow_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "__TENANT_SCHEMA__"."workflows"(id) DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX "webhook_delivery_logs_workflow_id_idx" ON "__TENANT_SCHEMA__"."webhook_delivery_logs"("workflow_id");

ALTER TABLE "__TENANT_SCHEMA__"."webhook_delivery_logs" ADD CONSTRAINT "webhook_delivery_logs_execution_id_fk" FOREIGN KEY ("execution_id") REFERENCES "__TENANT_SCHEMA__"."workflow_executions"(id) DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX "webhook_delivery_logs_execution_id_idx" ON "__TENANT_SCHEMA__"."webhook_delivery_logs"("execution_id");

CREATE INDEX "webhook_delivery_logs_source_0" ON "__TENANT_SCHEMA__"."webhook_delivery_logs"("org_id" ASC);

CREATE INDEX "webhook_delivery_logs_source_1" ON "__TENANT_SCHEMA__"."webhook_delivery_logs"("workflow_id" ASC);

CREATE INDEX "webhook_delivery_logs_source_2" ON "__TENANT_SCHEMA__"."webhook_delivery_logs"("created_at" ASC);

CREATE INDEX "webhook_delivery_logs_source_3" ON "__TENANT_SCHEMA__"."webhook_delivery_logs"("org_id" ASC,"created_at" DESC);

ALTER TABLE "__TENANT_SCHEMA__"."webhook_idempotencies" ADD CONSTRAINT "webhook_idempotencies_org_id_fk" FOREIGN KEY ("org_id") REFERENCES "platform"."organizations"(id) DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX "webhook_idempotencies_org_id_idx" ON "__TENANT_SCHEMA__"."webhook_idempotencies"("org_id");

ALTER TABLE "__TENANT_SCHEMA__"."webhook_idempotencies" ADD CONSTRAINT "webhook_idempotencies_workflow_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "__TENANT_SCHEMA__"."workflows"(id) DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX "webhook_idempotencies_workflow_id_idx" ON "__TENANT_SCHEMA__"."webhook_idempotencies"("workflow_id");

ALTER TABLE "__TENANT_SCHEMA__"."webhook_idempotencies" ADD CONSTRAINT "webhook_idempotencies_execution_id_fk" FOREIGN KEY ("execution_id") REFERENCES "__TENANT_SCHEMA__"."workflow_executions"(id) DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX "webhook_idempotencies_execution_id_idx" ON "__TENANT_SCHEMA__"."webhook_idempotencies"("execution_id");

CREATE INDEX "webhook_idempotencies_source_0" ON "__TENANT_SCHEMA__"."webhook_idempotencies"("org_id" ASC);

CREATE UNIQUE INDEX "webhook_idempotencies_source_1" ON "__TENANT_SCHEMA__"."webhook_idempotencies"("org_id" ASC,"workflow_id" ASC,"key" ASC);

CREATE INDEX "webhook_idempotencies_source_2" ON "__TENANT_SCHEMA__"."webhook_idempotencies"("created_at" ASC);

ALTER TABLE "__TENANT_SCHEMA__".organization_departments ADD COLUMN department_id bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
 ADD COLUMN name_key text GENERATED ALWAYS AS(lower(btrim(name))) STORED, ADD COLUMN from_legacy_default boolean NOT NULL DEFAULT false;
CREATE UNIQUE INDEX organization_department_name ON "__TENANT_SCHEMA__".organization_departments(owner_id,name_key);
ALTER TABLE "__TENANT_SCHEMA__".users ADD COLUMN deleted_at timestamptz;
CREATE UNIQUE INDEX users_email_live ON "__TENANT_SCHEMA__".users(org_id,lower(btrim(email))) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX roles_name ON "__TENANT_SCHEMA__".roles(org_id,name_key);
ALTER TABLE "__TENANT_SCHEMA__".users ALTER COLUMN role SET NOT NULL;
ALTER TABLE "__TENANT_SCHEMA__".users ADD CONSTRAINT user_email_normalized CHECK(email=lower(btrim(email)) AND email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$');
ALTER TABLE "__TENANT_SCHEMA__".users ADD CONSTRAINT user_directory_fk FOREIGN KEY(org_id,id) REFERENCES system.user_directory(org_id,user_id) DEFERRABLE INITIALLY DEFERRED;
CREATE UNIQUE INDEX user_sessions_identity ON "__TENANT_SCHEMA__".user_sessions(owner_id,session_id);
CREATE UNIQUE INDEX user_mfa_codes_identity ON "__TENANT_SCHEMA__".user_mfa_backup_codes(owner_id,code_hash);
CREATE UNIQUE INDEX task_approvers_identity ON "__TENANT_SCHEMA__".task_approvers(owner_id,user_id) WHERE user_id IS NOT NULL;
CREATE UNIQUE INDEX task_votes_identity ON "__TENANT_SCHEMA__".task_votes(owner_id,user_id) WHERE user_id IS NOT NULL;
ALTER TABLE "__TENANT_SCHEMA__".workflow_forms ADD CONSTRAINT workflow_form_owner UNIQUE(tenant_id,form_id) DEFERRABLE INITIALLY DEFERRED;
CREATE TABLE "__TENANT_SCHEMA__".file_grants(path text PRIMARY KEY,org_id text NOT NULL REFERENCES platform.organizations(id),
 owner_id text REFERENCES "__TENANT_SCHEMA__".users(id), granted_by_admin_id text REFERENCES platform.admin_users(id),
 version bigint NOT NULL DEFAULT 1 CHECK(version>0),created_at timestamptz NOT NULL DEFAULT now());

ALTER TABLE "__TENANT_SCHEMA__"."users" ADD COLUMN department_id bigint REFERENCES "__TENANT_SCHEMA__".organization_departments(department_id) DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE "__TENANT_SCHEMA__"."workflow_access_departments" ADD COLUMN department_id bigint REFERENCES "__TENANT_SCHEMA__".organization_departments(department_id) DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE "__TENANT_SCHEMA__"."organization_department_integrations" ADD COLUMN department_id bigint REFERENCES "__TENANT_SCHEMA__".organization_departments(department_id) DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE "__TENANT_SCHEMA__"."roles" ALTER COLUMN org_id SET NOT NULL;
ALTER TABLE "__TENANT_SCHEMA__"."roles" ADD CONSTRAINT fixed_organization CHECK(org_id='__ORG_ID__');
ALTER TABLE "__TENANT_SCHEMA__"."roles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "__TENANT_SCHEMA__"."roles" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_access ON "__TENANT_SCHEMA__"."roles" USING (org_id=nullif(current_setting('netflow.org_id',true),'')) WITH CHECK (org_id=nullif(current_setting('netflow.org_id',true),''));

ALTER TABLE "__TENANT_SCHEMA__"."users" ALTER COLUMN org_id SET NOT NULL;
ALTER TABLE "__TENANT_SCHEMA__"."users" ADD CONSTRAINT fixed_organization CHECK(org_id='__ORG_ID__');
ALTER TABLE "__TENANT_SCHEMA__"."users" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "__TENANT_SCHEMA__"."users" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_access ON "__TENANT_SCHEMA__"."users" USING (org_id=nullif(current_setting('netflow.org_id',true),'')) WITH CHECK (org_id=nullif(current_setting('netflow.org_id',true),''));

ALTER TABLE "__TENANT_SCHEMA__"."user_auth" ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE "__TENANT_SCHEMA__"."user_auth" ADD CONSTRAINT fixed_organization CHECK(tenant_id='__ORG_ID__');
ALTER TABLE "__TENANT_SCHEMA__"."user_auth" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "__TENANT_SCHEMA__"."user_auth" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_access ON "__TENANT_SCHEMA__"."user_auth" USING (tenant_id=nullif(current_setting('netflow.org_id',true),'')) WITH CHECK (tenant_id=nullif(current_setting('netflow.org_id',true),''));

ALTER TABLE "__TENANT_SCHEMA__"."user_sessions" ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE "__TENANT_SCHEMA__"."user_sessions" ADD CONSTRAINT fixed_organization CHECK(tenant_id='__ORG_ID__');
ALTER TABLE "__TENANT_SCHEMA__"."user_sessions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "__TENANT_SCHEMA__"."user_sessions" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_access ON "__TENANT_SCHEMA__"."user_sessions" USING (tenant_id=nullif(current_setting('netflow.org_id',true),'')) WITH CHECK (tenant_id=nullif(current_setting('netflow.org_id',true),''));

ALTER TABLE "__TENANT_SCHEMA__"."user_mfa_backup_codes" ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE "__TENANT_SCHEMA__"."user_mfa_backup_codes" ADD CONSTRAINT fixed_organization CHECK(tenant_id='__ORG_ID__');
ALTER TABLE "__TENANT_SCHEMA__"."user_mfa_backup_codes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "__TENANT_SCHEMA__"."user_mfa_backup_codes" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_access ON "__TENANT_SCHEMA__"."user_mfa_backup_codes" USING (tenant_id=nullif(current_setting('netflow.org_id',true),'')) WITH CHECK (tenant_id=nullif(current_setting('netflow.org_id',true),''));

ALTER TABLE "__TENANT_SCHEMA__"."forms" ALTER COLUMN org_id SET NOT NULL;
ALTER TABLE "__TENANT_SCHEMA__"."forms" ADD CONSTRAINT fixed_organization CHECK(org_id='__ORG_ID__');
ALTER TABLE "__TENANT_SCHEMA__"."forms" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "__TENANT_SCHEMA__"."forms" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_access ON "__TENANT_SCHEMA__"."forms" USING (org_id=nullif(current_setting('netflow.org_id',true),'')) WITH CHECK (org_id=nullif(current_setting('netflow.org_id',true),''));

ALTER TABLE "__TENANT_SCHEMA__"."form_drafts" ALTER COLUMN org_id SET NOT NULL;
ALTER TABLE "__TENANT_SCHEMA__"."form_drafts" ADD CONSTRAINT fixed_organization CHECK(org_id='__ORG_ID__');
ALTER TABLE "__TENANT_SCHEMA__"."form_drafts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "__TENANT_SCHEMA__"."form_drafts" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_access ON "__TENANT_SCHEMA__"."form_drafts" USING (org_id=nullif(current_setting('netflow.org_id',true),'')) WITH CHECK (org_id=nullif(current_setting('netflow.org_id',true),''));

ALTER TABLE "__TENANT_SCHEMA__"."form_responses" ALTER COLUMN org_id SET NOT NULL;
ALTER TABLE "__TENANT_SCHEMA__"."form_responses" ADD CONSTRAINT fixed_organization CHECK(org_id='__ORG_ID__');
ALTER TABLE "__TENANT_SCHEMA__"."form_responses" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "__TENANT_SCHEMA__"."form_responses" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_access ON "__TENANT_SCHEMA__"."form_responses" USING (org_id=nullif(current_setting('netflow.org_id',true),'')) WITH CHECK (org_id=nullif(current_setting('netflow.org_id',true),''));

ALTER TABLE "__TENANT_SCHEMA__"."workflows" ALTER COLUMN org_id SET NOT NULL;
ALTER TABLE "__TENANT_SCHEMA__"."workflows" ADD CONSTRAINT fixed_organization CHECK(org_id='__ORG_ID__');
ALTER TABLE "__TENANT_SCHEMA__"."workflows" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "__TENANT_SCHEMA__"."workflows" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_access ON "__TENANT_SCHEMA__"."workflows" USING (org_id=nullif(current_setting('netflow.org_id',true),'')) WITH CHECK (org_id=nullif(current_setting('netflow.org_id',true),''));

ALTER TABLE "__TENANT_SCHEMA__"."workflow_forms" ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE "__TENANT_SCHEMA__"."workflow_forms" ADD CONSTRAINT fixed_organization CHECK(tenant_id='__ORG_ID__');
ALTER TABLE "__TENANT_SCHEMA__"."workflow_forms" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "__TENANT_SCHEMA__"."workflow_forms" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_access ON "__TENANT_SCHEMA__"."workflow_forms" USING (tenant_id=nullif(current_setting('netflow.org_id',true),'')) WITH CHECK (tenant_id=nullif(current_setting('netflow.org_id',true),''));

ALTER TABLE "__TENANT_SCHEMA__"."workflow_initiators" ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE "__TENANT_SCHEMA__"."workflow_initiators" ADD CONSTRAINT fixed_organization CHECK(tenant_id='__ORG_ID__');
ALTER TABLE "__TENANT_SCHEMA__"."workflow_initiators" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "__TENANT_SCHEMA__"."workflow_initiators" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_access ON "__TENANT_SCHEMA__"."workflow_initiators" USING (tenant_id=nullif(current_setting('netflow.org_id',true),'')) WITH CHECK (tenant_id=nullif(current_setting('netflow.org_id',true),''));

ALTER TABLE "__TENANT_SCHEMA__"."workflow_viewers" ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE "__TENANT_SCHEMA__"."workflow_viewers" ADD CONSTRAINT fixed_organization CHECK(tenant_id='__ORG_ID__');
ALTER TABLE "__TENANT_SCHEMA__"."workflow_viewers" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "__TENANT_SCHEMA__"."workflow_viewers" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_access ON "__TENANT_SCHEMA__"."workflow_viewers" USING (tenant_id=nullif(current_setting('netflow.org_id',true),'')) WITH CHECK (tenant_id=nullif(current_setting('netflow.org_id',true),''));

ALTER TABLE "__TENANT_SCHEMA__"."workflow_access_departments" ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE "__TENANT_SCHEMA__"."workflow_access_departments" ADD CONSTRAINT fixed_organization CHECK(tenant_id='__ORG_ID__');
ALTER TABLE "__TENANT_SCHEMA__"."workflow_access_departments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "__TENANT_SCHEMA__"."workflow_access_departments" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_access ON "__TENANT_SCHEMA__"."workflow_access_departments" USING (tenant_id=nullif(current_setting('netflow.org_id',true),'')) WITH CHECK (tenant_id=nullif(current_setting('netflow.org_id',true),''));

ALTER TABLE "__TENANT_SCHEMA__"."workflow_executions" ALTER COLUMN org_id SET NOT NULL;
ALTER TABLE "__TENANT_SCHEMA__"."workflow_executions" ADD CONSTRAINT fixed_organization CHECK(org_id='__ORG_ID__');
ALTER TABLE "__TENANT_SCHEMA__"."workflow_executions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "__TENANT_SCHEMA__"."workflow_executions" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_access ON "__TENANT_SCHEMA__"."workflow_executions" USING (org_id=nullif(current_setting('netflow.org_id',true),'')) WITH CHECK (org_id=nullif(current_setting('netflow.org_id',true),''));

ALTER TABLE "__TENANT_SCHEMA__"."execution_events" ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE "__TENANT_SCHEMA__"."execution_events" ADD CONSTRAINT fixed_organization CHECK(tenant_id='__ORG_ID__');
ALTER TABLE "__TENANT_SCHEMA__"."execution_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "__TENANT_SCHEMA__"."execution_events" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_access ON "__TENANT_SCHEMA__"."execution_events" USING (tenant_id=nullif(current_setting('netflow.org_id',true),'')) WITH CHECK (tenant_id=nullif(current_setting('netflow.org_id',true),''));

ALTER TABLE "__TENANT_SCHEMA__"."tasks" ALTER COLUMN org_id SET NOT NULL;
ALTER TABLE "__TENANT_SCHEMA__"."tasks" ADD CONSTRAINT fixed_organization CHECK(org_id='__ORG_ID__');
ALTER TABLE "__TENANT_SCHEMA__"."tasks" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "__TENANT_SCHEMA__"."tasks" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_access ON "__TENANT_SCHEMA__"."tasks" USING (org_id=nullif(current_setting('netflow.org_id',true),'')) WITH CHECK (org_id=nullif(current_setting('netflow.org_id',true),''));

ALTER TABLE "__TENANT_SCHEMA__"."task_approvers" ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE "__TENANT_SCHEMA__"."task_approvers" ADD CONSTRAINT fixed_organization CHECK(tenant_id='__ORG_ID__');
ALTER TABLE "__TENANT_SCHEMA__"."task_approvers" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "__TENANT_SCHEMA__"."task_approvers" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_access ON "__TENANT_SCHEMA__"."task_approvers" USING (tenant_id=nullif(current_setting('netflow.org_id',true),'')) WITH CHECK (tenant_id=nullif(current_setting('netflow.org_id',true),''));

ALTER TABLE "__TENANT_SCHEMA__"."task_votes" ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE "__TENANT_SCHEMA__"."task_votes" ADD CONSTRAINT fixed_organization CHECK(tenant_id='__ORG_ID__');
ALTER TABLE "__TENANT_SCHEMA__"."task_votes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "__TENANT_SCHEMA__"."task_votes" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_access ON "__TENANT_SCHEMA__"."task_votes" USING (tenant_id=nullif(current_setting('netflow.org_id',true),'')) WITH CHECK (tenant_id=nullif(current_setting('netflow.org_id',true),''));

ALTER TABLE "__TENANT_SCHEMA__"."task_history" ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE "__TENANT_SCHEMA__"."task_history" ADD CONSTRAINT fixed_organization CHECK(tenant_id='__ORG_ID__');
ALTER TABLE "__TENANT_SCHEMA__"."task_history" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "__TENANT_SCHEMA__"."task_history" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_access ON "__TENANT_SCHEMA__"."task_history" USING (tenant_id=nullif(current_setting('netflow.org_id',true),'')) WITH CHECK (tenant_id=nullif(current_setting('netflow.org_id',true),''));

ALTER TABLE "__TENANT_SCHEMA__"."notifications" ALTER COLUMN org_id SET NOT NULL;
ALTER TABLE "__TENANT_SCHEMA__"."notifications" ADD CONSTRAINT fixed_organization CHECK(org_id='__ORG_ID__');
ALTER TABLE "__TENANT_SCHEMA__"."notifications" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "__TENANT_SCHEMA__"."notifications" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_access ON "__TENANT_SCHEMA__"."notifications" USING (org_id=nullif(current_setting('netflow.org_id',true),'')) WITH CHECK (org_id=nullif(current_setting('netflow.org_id',true),''));

ALTER TABLE "__TENANT_SCHEMA__"."audit_logs" ALTER COLUMN org_id SET NOT NULL;
ALTER TABLE "__TENANT_SCHEMA__"."audit_logs" ADD CONSTRAINT fixed_organization CHECK(org_id='__ORG_ID__');
ALTER TABLE "__TENANT_SCHEMA__"."audit_logs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "__TENANT_SCHEMA__"."audit_logs" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_access ON "__TENANT_SCHEMA__"."audit_logs" USING (org_id=nullif(current_setting('netflow.org_id',true),'')) WITH CHECK (org_id=nullif(current_setting('netflow.org_id',true),''));

ALTER TABLE "__TENANT_SCHEMA__"."document_extraction_jobs" ALTER COLUMN org_id SET NOT NULL;
ALTER TABLE "__TENANT_SCHEMA__"."document_extraction_jobs" ADD CONSTRAINT fixed_organization CHECK(org_id='__ORG_ID__');
ALTER TABLE "__TENANT_SCHEMA__"."document_extraction_jobs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "__TENANT_SCHEMA__"."document_extraction_jobs" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_access ON "__TENANT_SCHEMA__"."document_extraction_jobs" USING (org_id=nullif(current_setting('netflow.org_id',true),'')) WITH CHECK (org_id=nullif(current_setting('netflow.org_id',true),''));

ALTER TABLE "__TENANT_SCHEMA__"."form_generation_jobs" ALTER COLUMN org_id SET NOT NULL;
ALTER TABLE "__TENANT_SCHEMA__"."form_generation_jobs" ADD CONSTRAINT fixed_organization CHECK(org_id='__ORG_ID__');
ALTER TABLE "__TENANT_SCHEMA__"."form_generation_jobs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "__TENANT_SCHEMA__"."form_generation_jobs" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_access ON "__TENANT_SCHEMA__"."form_generation_jobs" USING (org_id=nullif(current_setting('netflow.org_id',true),'')) WITH CHECK (org_id=nullif(current_setting('netflow.org_id',true),''));

ALTER TABLE "__TENANT_SCHEMA__"."pdf_auto_fill_learning_profiles" ALTER COLUMN org_id SET NOT NULL;
ALTER TABLE "__TENANT_SCHEMA__"."pdf_auto_fill_learning_profiles" ADD CONSTRAINT fixed_organization CHECK(org_id='__ORG_ID__');
ALTER TABLE "__TENANT_SCHEMA__"."pdf_auto_fill_learning_profiles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "__TENANT_SCHEMA__"."pdf_auto_fill_learning_profiles" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_access ON "__TENANT_SCHEMA__"."pdf_auto_fill_learning_profiles" USING (org_id=nullif(current_setting('netflow.org_id',true),'')) WITH CHECK (org_id=nullif(current_setting('netflow.org_id',true),''));

ALTER TABLE "__TENANT_SCHEMA__"."pdf_auto_fill_semantic_profiles" ALTER COLUMN org_id SET NOT NULL;
ALTER TABLE "__TENANT_SCHEMA__"."pdf_auto_fill_semantic_profiles" ADD CONSTRAINT fixed_organization CHECK(org_id='__ORG_ID__');
ALTER TABLE "__TENANT_SCHEMA__"."pdf_auto_fill_semantic_profiles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "__TENANT_SCHEMA__"."pdf_auto_fill_semantic_profiles" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_access ON "__TENANT_SCHEMA__"."pdf_auto_fill_semantic_profiles" USING (org_id=nullif(current_setting('netflow.org_id',true),'')) WITH CHECK (org_id=nullif(current_setting('netflow.org_id',true),''));

ALTER TABLE "__TENANT_SCHEMA__"."integration_dead_letters" ALTER COLUMN org_id SET NOT NULL;
ALTER TABLE "__TENANT_SCHEMA__"."integration_dead_letters" ADD CONSTRAINT fixed_organization CHECK(org_id='__ORG_ID__');
ALTER TABLE "__TENANT_SCHEMA__"."integration_dead_letters" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "__TENANT_SCHEMA__"."integration_dead_letters" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_access ON "__TENANT_SCHEMA__"."integration_dead_letters" USING (org_id=nullif(current_setting('netflow.org_id',true),'')) WITH CHECK (org_id=nullif(current_setting('netflow.org_id',true),''));

ALTER TABLE "__TENANT_SCHEMA__"."webhook_delivery_logs" ALTER COLUMN org_id SET NOT NULL;
ALTER TABLE "__TENANT_SCHEMA__"."webhook_delivery_logs" ADD CONSTRAINT fixed_organization CHECK(org_id='__ORG_ID__');
ALTER TABLE "__TENANT_SCHEMA__"."webhook_delivery_logs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "__TENANT_SCHEMA__"."webhook_delivery_logs" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_access ON "__TENANT_SCHEMA__"."webhook_delivery_logs" USING (org_id=nullif(current_setting('netflow.org_id',true),'')) WITH CHECK (org_id=nullif(current_setting('netflow.org_id',true),''));

ALTER TABLE "__TENANT_SCHEMA__"."webhook_idempotencies" ALTER COLUMN org_id SET NOT NULL;
ALTER TABLE "__TENANT_SCHEMA__"."webhook_idempotencies" ADD CONSTRAINT fixed_organization CHECK(org_id='__ORG_ID__');
ALTER TABLE "__TENANT_SCHEMA__"."webhook_idempotencies" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "__TENANT_SCHEMA__"."webhook_idempotencies" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_access ON "__TENANT_SCHEMA__"."webhook_idempotencies" USING (org_id=nullif(current_setting('netflow.org_id',true),'')) WITH CHECK (org_id=nullif(current_setting('netflow.org_id',true),''));

ALTER TABLE "__TENANT_SCHEMA__"."organization_departments" ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE "__TENANT_SCHEMA__"."organization_departments" ADD CONSTRAINT fixed_organization CHECK(tenant_id='__ORG_ID__');
ALTER TABLE "__TENANT_SCHEMA__"."organization_departments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "__TENANT_SCHEMA__"."organization_departments" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_access ON "__TENANT_SCHEMA__"."organization_departments" USING (tenant_id=nullif(current_setting('netflow.org_id',true),'')) WITH CHECK (tenant_id=nullif(current_setting('netflow.org_id',true),''));

ALTER TABLE "__TENANT_SCHEMA__"."organization_departments" ADD CONSTRAINT organization_child_owner CHECK(owner_id=tenant_id);

ALTER TABLE "__TENANT_SCHEMA__"."organization_usage" ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE "__TENANT_SCHEMA__"."organization_usage" ADD CONSTRAINT fixed_organization CHECK(tenant_id='__ORG_ID__');
ALTER TABLE "__TENANT_SCHEMA__"."organization_usage" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "__TENANT_SCHEMA__"."organization_usage" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_access ON "__TENANT_SCHEMA__"."organization_usage" USING (tenant_id=nullif(current_setting('netflow.org_id',true),'')) WITH CHECK (tenant_id=nullif(current_setting('netflow.org_id',true),''));

ALTER TABLE "__TENANT_SCHEMA__"."organization_usage" ADD CONSTRAINT organization_child_owner CHECK(owner_id=tenant_id);

ALTER TABLE "__TENANT_SCHEMA__"."organization_integrations" ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE "__TENANT_SCHEMA__"."organization_integrations" ADD CONSTRAINT fixed_organization CHECK(tenant_id='__ORG_ID__');
ALTER TABLE "__TENANT_SCHEMA__"."organization_integrations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "__TENANT_SCHEMA__"."organization_integrations" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_access ON "__TENANT_SCHEMA__"."organization_integrations" USING (tenant_id=nullif(current_setting('netflow.org_id',true),'')) WITH CHECK (tenant_id=nullif(current_setting('netflow.org_id',true),''));

ALTER TABLE "__TENANT_SCHEMA__"."organization_integrations" ADD CONSTRAINT organization_child_owner CHECK(owner_id=tenant_id);

ALTER TABLE "__TENANT_SCHEMA__"."organization_department_integrations" ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE "__TENANT_SCHEMA__"."organization_department_integrations" ADD CONSTRAINT fixed_organization CHECK(tenant_id='__ORG_ID__');
ALTER TABLE "__TENANT_SCHEMA__"."organization_department_integrations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "__TENANT_SCHEMA__"."organization_department_integrations" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_access ON "__TENANT_SCHEMA__"."organization_department_integrations" USING (tenant_id=nullif(current_setting('netflow.org_id',true),'')) WITH CHECK (tenant_id=nullif(current_setting('netflow.org_id',true),''));

ALTER TABLE "__TENANT_SCHEMA__"."organization_department_integrations" ADD CONSTRAINT organization_child_owner CHECK(owner_id=tenant_id);

ALTER TABLE "__TENANT_SCHEMA__"."file_grants" ALTER COLUMN org_id SET NOT NULL;
ALTER TABLE "__TENANT_SCHEMA__"."file_grants" ADD CONSTRAINT fixed_organization CHECK(org_id='__ORG_ID__');
ALTER TABLE "__TENANT_SCHEMA__"."file_grants" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "__TENANT_SCHEMA__"."file_grants" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_access ON "__TENANT_SCHEMA__"."file_grants" USING (org_id=nullif(current_setting('netflow.org_id',true),'')) WITH CHECK (org_id=nullif(current_setting('netflow.org_id',true),''));

CREATE TRIGGER user_directory_sync AFTER INSERT OR UPDATE OR DELETE ON "__TENANT_SCHEMA__".users FOR EACH ROW EXECUTE FUNCTION system.sync_user_directory('tenant','__ORG_ID__');
CREATE CONSTRAINT TRIGGER user_directory_consistency AFTER INSERT OR UPDATE ON "__TENANT_SCHEMA__".users DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION system.check_user_directory('tenant','__ORG_ID__');
CREATE TRIGGER audit_history_protection BEFORE UPDATE OR DELETE ON "__TENANT_SCHEMA__".audit_logs FOR EACH ROW EXECUTE FUNCTION system.protect_audit_history();
CREATE INDEX tasks_inbox ON "__TENANT_SCHEMA__".tasks(assigned_to,status,due_date,created_at DESC);
CREATE INDEX audit_recent ON "__TENANT_SCHEMA__".audit_logs(created_at DESC,id);
CREATE INDEX responses_form ON "__TENANT_SCHEMA__".form_responses(form_id,created_at DESC);

CREATE INDEX document_extraction_jobs_claim ON "__TENANT_SCHEMA__".document_extraction_jobs(created_at,id) WHERE status='queued';

CREATE INDEX form_generation_jobs_claim ON "__TENANT_SCHEMA__".form_generation_jobs(created_at,id) WHERE status='queued';

REVOKE ALL ON ALL TABLES IN SCHEMA "__TENANT_SCHEMA__" FROM PUBLIC;
GRANT USAGE ON SCHEMA "__TENANT_SCHEMA__" TO netflow_app;
GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA "__TENANT_SCHEMA__" TO netflow_app;
GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA "__TENANT_SCHEMA__" TO netflow_app;
REVOKE UPDATE,DELETE,TRUNCATE ON "__TENANT_SCHEMA__".audit_logs FROM netflow_app;
$tenant_template$,'__TENANT_SCHEMA__',target_schema),'__ORG_ID__',org.id);
  EXECUTE format('INSERT INTO %I."organization_departments" ("owner_id","tenant_id","position","name","source_missing") SELECT "owner_id","tenant_id","position","name","source_missing" FROM jsonb_populate_recordset(NULL::%I."organization_departments",$1)', target_schema,target_schema) USING coalesce(seed->'organization_departments','[]'::jsonb);
  EXECUTE format('INSERT INTO %I."organization_usage" ("owner_id","tenant_id","storage_bytes","file_count","buffer_bytes_used","submissions_period_start","submissions_period_end","submissions_count","notified","source_missing") SELECT "owner_id","tenant_id","storage_bytes","file_count","buffer_bytes_used","submissions_period_start","submissions_period_end","submissions_count","notified","source_missing" FROM jsonb_populate_recordset(NULL::%I."organization_usage",$1)', target_schema,target_schema) USING coalesce(seed->'organization_usage','[]'::jsonb);
  EXECUTE format('INSERT INTO %I."organization_integrations" ("owner_id","tenant_id","s3_enabled","s3_bucket","s3_endpoint","s3_region","s3_access_key_id","s3_secret_access_key","dms_api_key","dms_name","dms_base_url","dms_jwt","dms_enabled","dms_org_slug","source_missing") SELECT "owner_id","tenant_id","s3_enabled","s3_bucket","s3_endpoint","s3_region","s3_access_key_id","s3_secret_access_key","dms_api_key","dms_name","dms_base_url","dms_jwt","dms_enabled","dms_org_slug","source_missing" FROM jsonb_populate_recordset(NULL::%I."organization_integrations",$1)', target_schema,target_schema) USING coalesce(seed->'organization_integrations','[]'::jsonb);
  EXECUTE format('INSERT INTO %I."organization_department_integrations" ("owner_id","tenant_id","position","department","api_key","base_url","folder","enabled","source_missing") SELECT "owner_id","tenant_id","position","department","api_key","base_url","folder","enabled","source_missing" FROM jsonb_populate_recordset(NULL::%I."organization_department_integrations",$1)', target_schema,target_schema) USING coalesce(seed->'organization_department_integrations','[]'::jsonb);
  EXECUTE format('INSERT INTO %I."roles" ("org_id","name","name_key","description","permissions","id","created_at","updated_at","source_missing") SELECT "org_id","name","name_key","description","permissions","id","created_at","updated_at","source_missing" FROM jsonb_populate_recordset(NULL::%I."roles",$1)', target_schema,target_schema) USING coalesce(seed->'roles','[]'::jsonb);
  EXECUTE format('INSERT INTO %I."users" ("org_id","name","email","must_change_password","needs_product_tour","role","department","is_active","can_build","counts_toward_seats","is_protected","avatar","manager_id","hr_id","last_login","out_of_office_enabled","out_of_office_from","out_of_office_until","out_of_office_note","out_of_office_delegate_id","notification_prefs","id","created_at","updated_at","source_missing") SELECT "org_id","name","email","must_change_password","needs_product_tour","role","department","is_active","can_build","counts_toward_seats","is_protected","avatar","manager_id","hr_id","last_login","out_of_office_enabled","out_of_office_from","out_of_office_until","out_of_office_note","out_of_office_delegate_id","notification_prefs","id","created_at","updated_at","source_missing" FROM jsonb_populate_recordset(NULL::%I."users",$1)', target_schema,target_schema) USING coalesce(seed->'users','[]'::jsonb);
  EXECUTE format('INSERT INTO %I."user_auth" ("owner_id","tenant_id","password","token_version","reset_password_token","reset_password_expires","failed_login_attempts","lock_until","mfa_enabled","mfa_secret","source_missing") SELECT "owner_id","tenant_id","password","token_version","reset_password_token","reset_password_expires","failed_login_attempts","lock_until","mfa_enabled","mfa_secret","source_missing" FROM jsonb_populate_recordset(NULL::%I."user_auth",$1)', target_schema,target_schema) USING coalesce(seed->'user_auth','[]'::jsonb);
  EXECUTE format('INSERT INTO %I."user_sessions" ("owner_id","tenant_id","position","session_id","source_missing") SELECT "owner_id","tenant_id","position","session_id","source_missing" FROM jsonb_populate_recordset(NULL::%I."user_sessions",$1)', target_schema,target_schema) USING coalesce(seed->'user_sessions','[]'::jsonb);
  EXECUTE format('INSERT INTO %I."user_mfa_backup_codes" ("owner_id","tenant_id","position","code_hash","source_missing") SELECT "owner_id","tenant_id","position","code_hash","source_missing" FROM jsonb_populate_recordset(NULL::%I."user_mfa_backup_codes",$1)', target_schema,target_schema) USING coalesce(seed->'user_mfa_backup_codes','[]'::jsonb);
  EXECUTE format('UPDATE %I.users u SET department_id=d.department_id FROM %I.organization_departments d WHERE d.owner_id=u.org_id AND d.name_key=lower(btrim(u.department))',target_schema,target_schema);
  EXECUTE format('UPDATE %I.organization_department_integrations i SET department_id=d.department_id FROM %I.organization_departments d WHERE d.owner_id=i.tenant_id AND d.name_key=lower(btrim(i.department))',target_schema,target_schema);
  EXECUTE format('SELECT u.id FROM %I.users u JOIN %I.roles r ON r.id=u.role JOIN %I.user_auth a ON a.owner_id=u.id WHERE u.org_id=$1 AND r.org_id=$1 AND r.name_key=''admin'' AND r.permissions=ARRAY[''*'']::text[] AND u.is_active IS TRUE AND u.must_change_password IS TRUE AND a.password ~ ''^\$2[aby]\$12\$''',target_schema,target_schema,target_schema) INTO admin_id USING org.id;
  IF admin_id IS NULL THEN RAISE EXCEPTION 'INVALID_ADMIN_SEED'; END IF;
  SELECT count(*) INTO total FROM pg_tables WHERE schemaname=target_schema;
  IF total<>33 OR EXISTS(SELECT 1 FROM unnest(ARRAY['organization_departments','organization_usage','roles','users','forms','form_drafts','form_responses','workflows','workflow_forms','workflow_initiators','workflow_viewers','workflow_access_departments','workflow_executions','execution_events','tasks','task_approvers','task_votes','task_history','notifications','audit_logs','document_extraction_jobs','form_generation_jobs','pdf_auto_fill_learning_profiles','pdf_auto_fill_semantic_profiles','integration_dead_letters','webhook_delivery_logs','webhook_idempotencies','organization_integrations','organization_department_integrations','user_auth','user_sessions','user_mfa_backup_codes','file_grants']) t WHERE to_regclass(format('%I.%I',target_schema,t)) IS NULL) THEN RAISE EXCEPTION 'TENANT_MANIFEST_MISMATCH'; END IF;
  IF EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=target_schema AND c.relkind='r'
    AND (NOT c.relrowsecurity OR NOT c.relforcerowsecurity OR NOT has_table_privilege('netflow_app',c.oid,'SELECT') OR has_table_privilege('netflow_app',c.oid,'TRUNCATE'))) THEN RAISE EXCEPTION 'TENANT_GRANTS_MISMATCH'; END IF;
  INSERT INTO system.schema_migrations(schema_name,version,scope,org_id,checksum,release_id)
    VALUES(target_schema,'001','tenant',org.id,'d8f438aeac5fea531c42a8197e836b838ca53143a74294c7e9d60cc8e94646ec','organization-schemas-phase-2');
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
  IF password_hash IS NULL OR password_hash !~ '^\$2[aby]\$12\$[./A-Za-z0-9]{53}$' THEN RAISE EXCEPTION 'INVALID_PASSWORD_HASH'; END IF;
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
