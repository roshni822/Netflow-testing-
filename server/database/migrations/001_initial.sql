-- Generated from database/catalog.js and the reviewed application schemas.

-- Apply only with the guarded migration CLI. Never run through the HTTP API.

CREATE SCHEMA netflow;

CREATE SCHEMA netflow_private;

CREATE SCHEMA netflow_migration;

REVOKE ALL ON SCHEMA netflow, netflow_private, netflow_migration FROM PUBLIC;

CREATE TABLE netflow_migration.schema_versions (version text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now());

CREATE TABLE netflow."plans" (
  "key" text NOT NULL,
  "label" text NOT NULL,
  "trial_days" numeric,
  "limits" jsonb,
  "features" jsonb,
  "is_custom" boolean DEFAULT false,
  "id" text PRIMARY KEY CHECK (id ~ '^[0-9a-f]{24}$'),
  "created_at" timestamptz NOT NULL,
  "updated_at" timestamptz NOT NULL,
  api_version bigint,
  legacy_extra jsonb NOT NULL DEFAULT '{}',
  legacy_refs jsonb NOT NULL DEFAULT '{}',
  source_missing text[] NOT NULL DEFAULT '{}',
  row_version bigint NOT NULL DEFAULT 0
);

CREATE TABLE netflow."organizations" (
  "name" text NOT NULL,
  "subdomain" text NOT NULL,
  "allowed_domains" text[],
  "features" jsonb,
  "pdf_auto_fill" jsonb,
  "plan" text DEFAULT 'custom',
  "licence_valid_from" timestamptz,
  "licence_valid_until" timestamptz,
  "licence_trial_ends_at" timestamptz,
  "licence_status" text DEFAULT 'active' CHECK ("licence_status" IN ('active', 'expired', 'suspended')),
  "licence_notified" jsonb,
  "billing_email" text DEFAULT '',
  "billing_anchor_day" numeric DEFAULT 1 CHECK ("billing_anchor_day" >= 1) CHECK ("billing_anchor_day" <= 31),
  "limits" jsonb,
  "storage_extension_extra_mb" numeric DEFAULT 0,
  "storage_extension_expires_at" timestamptz,
  "storage_extension_granted_by" text,
  "storage_extension_reason" text DEFAULT '',
  "status" text DEFAULT 'active' CHECK ("status" IN ('active', 'suspended')),
  "is_default" boolean DEFAULT false,
  "admin_user_id" text,
  "id" text PRIMARY KEY CHECK (id ~ '^[0-9a-f]{24}$'),
  "created_at" timestamptz NOT NULL,
  "updated_at" timestamptz NOT NULL,
  api_version bigint,
  legacy_extra jsonb NOT NULL DEFAULT '{}',
  legacy_refs jsonb NOT NULL DEFAULT '{}',
  source_missing text[] NOT NULL DEFAULT '{}',
  row_version bigint NOT NULL DEFAULT 0
);

CREATE TABLE netflow."organization_departments" (
  owner_id text NOT NULL REFERENCES netflow."organizations"(id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED,
  tenant_id text,
  position integer NOT NULL CHECK (position >= 0),
  "name" text NOT NULL,
  legacy_extra jsonb NOT NULL DEFAULT '{}',
  legacy_refs jsonb NOT NULL DEFAULT '{}',
  source_missing text[] NOT NULL DEFAULT '{}',
  row_version bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (owner_id, position)
);

CREATE TABLE netflow."organization_usage" (
  owner_id text NOT NULL REFERENCES netflow."organizations"(id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED,
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
  PRIMARY KEY (owner_id)
);

CREATE TABLE netflow_private."organization_integrations" (
  owner_id text NOT NULL REFERENCES netflow."organizations"(id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED,
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
  PRIMARY KEY (owner_id)
);

CREATE TABLE netflow_private."organization_department_integrations" (
  owner_id text NOT NULL REFERENCES netflow."organizations"(id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED,
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
  PRIMARY KEY (owner_id, position)
);

CREATE TABLE netflow."roles" (
  "org_id" text,
  "name" text NOT NULL,
  "name_key" text,
  "description" text,
  "permissions" text[],
  "id" text PRIMARY KEY CHECK (id ~ '^[0-9a-f]{24}$'),
  "created_at" timestamptz NOT NULL,
  "updated_at" timestamptz NOT NULL,
  api_version bigint,
  legacy_extra jsonb NOT NULL DEFAULT '{}',
  legacy_refs jsonb NOT NULL DEFAULT '{}',
  source_missing text[] NOT NULL DEFAULT '{}',
  row_version bigint NOT NULL DEFAULT 0
);

CREATE TABLE netflow."users" (
  "org_id" text,
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
  "id" text PRIMARY KEY CHECK (id ~ '^[0-9a-f]{24}$'),
  "created_at" timestamptz NOT NULL,
  "updated_at" timestamptz NOT NULL,
  api_version bigint,
  legacy_extra jsonb NOT NULL DEFAULT '{}',
  legacy_refs jsonb NOT NULL DEFAULT '{}',
  source_missing text[] NOT NULL DEFAULT '{}',
  row_version bigint NOT NULL DEFAULT 0
);

CREATE TABLE netflow_private."user_auth" (
  owner_id text NOT NULL REFERENCES netflow."users"(id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED,
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
  PRIMARY KEY (owner_id)
);

CREATE TABLE netflow_private."user_sessions" (
  owner_id text NOT NULL REFERENCES netflow."users"(id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED,
  tenant_id text,
  position integer NOT NULL CHECK (position >= 0),
  "session_id" text NOT NULL,
  legacy_extra jsonb NOT NULL DEFAULT '{}',
  legacy_refs jsonb NOT NULL DEFAULT '{}',
  source_missing text[] NOT NULL DEFAULT '{}',
  row_version bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (owner_id, position)
);

CREATE TABLE netflow_private."user_mfa_backup_codes" (
  owner_id text NOT NULL REFERENCES netflow."users"(id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED,
  tenant_id text,
  position integer NOT NULL CHECK (position >= 0),
  "code_hash" text NOT NULL,
  legacy_extra jsonb NOT NULL DEFAULT '{}',
  legacy_refs jsonb NOT NULL DEFAULT '{}',
  source_missing text[] NOT NULL DEFAULT '{}',
  row_version bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (owner_id, position)
);

CREATE TABLE netflow."forms" (
  "org_id" text,
  "title" text NOT NULL,
  "description" text,
  "fields" jsonb,
  "status" text DEFAULT 'draft' CHECK ("status" IN ('draft', 'published', 'archived')),
  "created_by" text,
  "department" text,
  "version" numeric DEFAULT 1,
  "public_enabled" boolean DEFAULT false,
  "public_token" text,
  "auto_fill_enabled" boolean DEFAULT false,
  "id" text PRIMARY KEY CHECK (id ~ '^[0-9a-f]{24}$'),
  "created_at" timestamptz NOT NULL,
  "updated_at" timestamptz NOT NULL,
  api_version bigint,
  legacy_extra jsonb NOT NULL DEFAULT '{}',
  legacy_refs jsonb NOT NULL DEFAULT '{}',
  source_missing text[] NOT NULL DEFAULT '{}',
  row_version bigint NOT NULL DEFAULT 0
);

CREATE TABLE netflow."form_drafts" (
  "org_id" text,
  "form_id" text,
  "user_id" text,
  "form_data" jsonb,
  "id" text PRIMARY KEY CHECK (id ~ '^[0-9a-f]{24}$'),
  "created_at" timestamptz NOT NULL,
  "updated_at" timestamptz NOT NULL,
  api_version bigint,
  legacy_extra jsonb NOT NULL DEFAULT '{}',
  legacy_refs jsonb NOT NULL DEFAULT '{}',
  source_missing text[] NOT NULL DEFAULT '{}',
  row_version bigint NOT NULL DEFAULT 0
);

CREATE TABLE netflow."form_responses" (
  "org_id" text,
  "form_id" text,
  "submitted_by" text,
  "submitted_by_external" jsonb,
  "source" text DEFAULT 'internal' CHECK ("source" IN ('internal', 'public')),
  "form_data" jsonb,
  "status" text DEFAULT 'submitted' CHECK ("status" IN ('submitted', 'under_review', 'approved', 'rejected')),
  "attachments" jsonb,
  "id" text PRIMARY KEY CHECK (id ~ '^[0-9a-f]{24}$'),
  "created_at" timestamptz NOT NULL,
  "updated_at" timestamptz NOT NULL,
  api_version bigint,
  legacy_extra jsonb NOT NULL DEFAULT '{}',
  legacy_refs jsonb NOT NULL DEFAULT '{}',
  source_missing text[] NOT NULL DEFAULT '{}',
  row_version bigint NOT NULL DEFAULT 0
);

CREATE TABLE netflow."workflows" (
  "org_id" text,
  "title" text NOT NULL,
  "description" text,
  "tags" text[],
  "nodes" jsonb,
  "edges" jsonb,
  "status" text DEFAULT 'draft' CHECK ("status" IN ('draft', 'published', 'paused', 'archived')),
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
  "inbound_webhook_expected_fields" jsonb,
  "advanced_allow_cancel" boolean DEFAULT false,
  "advanced_auto_pdf" boolean DEFAULT false,
  "department" text,
  "created_by" text,
  "version" numeric DEFAULT 1,
  "previous_version_id" text,
  "id" text PRIMARY KEY CHECK (id ~ '^[0-9a-f]{24}$'),
  "created_at" timestamptz NOT NULL,
  "updated_at" timestamptz NOT NULL,
  api_version bigint,
  legacy_extra jsonb NOT NULL DEFAULT '{}',
  legacy_refs jsonb NOT NULL DEFAULT '{}',
  source_missing text[] NOT NULL DEFAULT '{}',
  row_version bigint NOT NULL DEFAULT 0
);

CREATE TABLE netflow."workflow_forms" (
  owner_id text NOT NULL REFERENCES netflow."workflows"(id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED,
  tenant_id text,
  position integer NOT NULL CHECK (position >= 0),
  "form_id" text,
  legacy_extra jsonb NOT NULL DEFAULT '{}',
  legacy_refs jsonb NOT NULL DEFAULT '{}',
  source_missing text[] NOT NULL DEFAULT '{}',
  row_version bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (owner_id, position)
);

CREATE TABLE netflow."workflow_initiators" (
  owner_id text NOT NULL REFERENCES netflow."workflows"(id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED,
  tenant_id text,
  position integer NOT NULL CHECK (position >= 0),
  "user_id" text,
  legacy_extra jsonb NOT NULL DEFAULT '{}',
  legacy_refs jsonb NOT NULL DEFAULT '{}',
  source_missing text[] NOT NULL DEFAULT '{}',
  row_version bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (owner_id, position)
);

CREATE TABLE netflow."workflow_viewers" (
  owner_id text NOT NULL REFERENCES netflow."workflows"(id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED,
  tenant_id text,
  position integer NOT NULL CHECK (position >= 0),
  "user_id" text,
  legacy_extra jsonb NOT NULL DEFAULT '{}',
  legacy_refs jsonb NOT NULL DEFAULT '{}',
  source_missing text[] NOT NULL DEFAULT '{}',
  row_version bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (owner_id, position)
);

CREATE TABLE netflow."workflow_access_departments" (
  owner_id text NOT NULL REFERENCES netflow."workflows"(id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED,
  tenant_id text,
  position integer NOT NULL CHECK (position >= 0),
  "department_name" text NOT NULL,
  legacy_extra jsonb NOT NULL DEFAULT '{}',
  legacy_refs jsonb NOT NULL DEFAULT '{}',
  source_missing text[] NOT NULL DEFAULT '{}',
  row_version bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (owner_id, position)
);

CREATE TABLE netflow."workflow_executions" (
  "org_id" text,
  "workflow_id" text,
  "form_response_id" text,
  "triggered_by" text,
  "triggered_by_external" jsonb,
  "status_token" text,
  "status" text DEFAULT 'running' CHECK ("status" IN ('running', 'completed', 'failed', 'paused', 'cancelled')),
  "current_node_id" text,
  "started_at" timestamptz,
  "completed_at" timestamptz,
  "failed_at" timestamptz,
  "failure_reason" text,
  "timer_resume_at" timestamptz,
  "timer_next_node_id" text,
  "variables" jsonb,
  "id" text PRIMARY KEY CHECK (id ~ '^[0-9a-f]{24}$'),
  "created_at" timestamptz NOT NULL,
  "updated_at" timestamptz NOT NULL,
  api_version bigint,
  legacy_extra jsonb NOT NULL DEFAULT '{}',
  legacy_refs jsonb NOT NULL DEFAULT '{}',
  source_missing text[] NOT NULL DEFAULT '{}',
  row_version bigint NOT NULL DEFAULT 0
);

CREATE TABLE netflow."execution_events" (
  owner_id text NOT NULL REFERENCES netflow."workflow_executions"(id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED,
  tenant_id text,
  position integer NOT NULL CHECK (position >= 0),
  "node_id" text,
  "node_type" text,
  "entered_at" timestamptz,
  "exited_at" timestamptz,
  "status" text CHECK ("status" IN ('in_progress', 'completed', 'failed', 'skipped')),
  "output" jsonb,
  "id" text,
  legacy_extra jsonb NOT NULL DEFAULT '{}',
  legacy_refs jsonb NOT NULL DEFAULT '{}',
  source_missing text[] NOT NULL DEFAULT '{}',
  row_version bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (owner_id, position)
);

CREATE TABLE netflow."tasks" (
  "org_id" text,
  "workflow_execution_id" text,
  "workflow_id" text,
  "assigned_to" text,
  "submitted_by" text,
  "form_response_id" text,
  "title" text NOT NULL,
  "type" text NOT NULL,
  "action_type" text DEFAULT 'approval' CHECK ("action_type" IN ('approval', 'submit', 'review')),
  "status" text DEFAULT 'pending' CHECK ("status" IN ('pending', 'approved', 'rejected', 'escalated', 'completed', 'cancelled')),
  "due_date" timestamptz,
  "current_node" text,
  "instructions" text,
  "require_attachment" boolean DEFAULT false,
  "form_fields" jsonb,
  "form_data" jsonb,
  "require_signature" boolean DEFAULT false,
  "attachments" jsonb,
  "approval_type" text DEFAULT 'sequential' CHECK ("approval_type" IN ('sequential', 'parallel')),
  "required_approvals" numeric DEFAULT 1,
  "escalation_level" numeric DEFAULT 0,
  "is_escalated" boolean DEFAULT false,
  "id" text PRIMARY KEY CHECK (id ~ '^[0-9a-f]{24}$'),
  "created_at" timestamptz NOT NULL,
  "updated_at" timestamptz NOT NULL,
  api_version bigint,
  legacy_extra jsonb NOT NULL DEFAULT '{}',
  legacy_refs jsonb NOT NULL DEFAULT '{}',
  source_missing text[] NOT NULL DEFAULT '{}',
  row_version bigint NOT NULL DEFAULT 0
);

CREATE TABLE netflow."task_approvers" (
  owner_id text NOT NULL REFERENCES netflow."tasks"(id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED,
  tenant_id text,
  position integer NOT NULL CHECK (position >= 0),
  "user_id" text,
  legacy_extra jsonb NOT NULL DEFAULT '{}',
  legacy_refs jsonb NOT NULL DEFAULT '{}',
  source_missing text[] NOT NULL DEFAULT '{}',
  row_version bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (owner_id, position)
);

CREATE TABLE netflow."task_votes" (
  owner_id text NOT NULL REFERENCES netflow."tasks"(id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED,
  tenant_id text,
  position integer NOT NULL CHECK (position >= 0),
  "user_id" text,
  "status" text CHECK ("status" IN ('pending', 'approved', 'rejected')),
  "decided_at" timestamptz,
  "id" text,
  legacy_extra jsonb NOT NULL DEFAULT '{}',
  legacy_refs jsonb NOT NULL DEFAULT '{}',
  source_missing text[] NOT NULL DEFAULT '{}',
  row_version bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (owner_id, position)
);

CREATE TABLE netflow."task_history" (
  owner_id text NOT NULL REFERENCES netflow."tasks"(id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED,
  tenant_id text,
  position integer NOT NULL CHECK (position >= 0),
  "action" text CHECK ("action" IN ('submitted', 'approved', 'rejected', 'request_changes', 'escalated', 'reassigned')),
  "performed_by" text,
  "performed_at" timestamptz,
  "comment" text,
  "signature" jsonb,
  "id" text,
  legacy_extra jsonb NOT NULL DEFAULT '{}',
  legacy_refs jsonb NOT NULL DEFAULT '{}',
  source_missing text[] NOT NULL DEFAULT '{}',
  row_version bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (owner_id, position)
);

CREATE TABLE netflow."notifications" (
  "org_id" text,
  "user_id" text,
  "title" text NOT NULL,
  "message" text NOT NULL,
  "type" text NOT NULL CHECK ("type" IN ('approval', 'rejection', 'escalation', 'assignment', 'reminder', 'system')),
  "is_read" boolean DEFAULT false,
  "task_id" text,
  "triggered_by" text,
  "id" text PRIMARY KEY CHECK (id ~ '^[0-9a-f]{24}$'),
  "created_at" timestamptz NOT NULL,
  "updated_at" timestamptz NOT NULL,
  api_version bigint,
  legacy_extra jsonb NOT NULL DEFAULT '{}',
  legacy_refs jsonb NOT NULL DEFAULT '{}',
  source_missing text[] NOT NULL DEFAULT '{}',
  row_version bigint NOT NULL DEFAULT 0
);

CREATE TABLE netflow."audit_logs" (
  "org_id" text,
  "action" text NOT NULL CHECK ("action" IN ('form_submitted', 'form_deleted', 'task_approved', 'task_rejected', 'task_submitted', 'task_escalated', 'workflow_started', 'workflow_completed', 'workflow_failed', 'workflow_deleted', 'user_invited', 'user_updated', 'user_deleted', 'builder_access_granted', 'builder_access_revoked', 'role_changed', 'request_changes', 'approver_inferred', 'workflow_cancelled', 'webhook_called', 'webhook_received', 'users_imported', 'user_logged_in', 'department_created', 'department_renamed', 'department_deleted', 'org_settings_updated', 'org_created', 'org_updated', 'org_suspended', 'org_activated', 'org_deleted', 'org_admin_password_reset', 'org_storage_extended', 'org_storage_extension_revoked', 'org_licence_expired', 'org_limit_reached', 'platform_broadcast_sent')),
  "performed_by" text,
  "target_entity" text NOT NULL,
  "department" text,
  "ip_address" text,
  "detail" text,
  "metadata" jsonb,
  "id" text PRIMARY KEY CHECK (id ~ '^[0-9a-f]{24}$'),
  "created_at" timestamptz NOT NULL,
  "updated_at" timestamptz NOT NULL,
  api_version bigint,
  legacy_extra jsonb NOT NULL DEFAULT '{}',
  legacy_refs jsonb NOT NULL DEFAULT '{}',
  source_missing text[] NOT NULL DEFAULT '{}',
  row_version bigint NOT NULL DEFAULT 0
);

CREATE TABLE netflow."platform_broadcasts" (
  "message" text NOT NULL CHECK (char_length("message") <= 500),
  "severity" text DEFAULT 'info' CHECK ("severity" IN ('info', 'warning', 'critical')),
  "expires_at" timestamptz NOT NULL,
  "created_by" text,
  "superseded_at" timestamptz,
  "id" text PRIMARY KEY CHECK (id ~ '^[0-9a-f]{24}$'),
  "created_at" timestamptz NOT NULL,
  "updated_at" timestamptz NOT NULL,
  api_version bigint,
  legacy_extra jsonb NOT NULL DEFAULT '{}',
  legacy_refs jsonb NOT NULL DEFAULT '{}',
  source_missing text[] NOT NULL DEFAULT '{}',
  row_version bigint NOT NULL DEFAULT 0
);

CREATE TABLE netflow."document_extraction_jobs" (
  "org_id" text,
  "form_id" text,
  "requester_id" text,
  "audience" text NOT NULL CHECK ("audience" IN ('authenticated', 'public')),
  "language_mode" text DEFAULT 'english_hindi' CHECK ("language_mode" IN ('english', 'english_hindi', 'hindi')),
  "access_token_hash" text,
  "source_file" jsonb,
  "status" text DEFAULT 'queued' CHECK ("status" IN ('queued', 'security_scan', 'inspecting', 'extracting_text', 'ocr_processing', 'mapping_fields', 'validating', 'ready', 'failed', 'cancelled')),
  "stage" text DEFAULT 'Queued for processing',
  "progress" numeric DEFAULT 0 CHECK ("progress" >= 0) CHECK ("progress" <= 100),
  "attempts" numeric DEFAULT 0,
  "claimed_at" timestamptz,
  "page_count" numeric DEFAULT 0,
  "page_meta" jsonb,
  "lines" jsonb,
  "template_fingerprint" text,
  "document_type" text DEFAULT 'document' CHECK (char_length("document_type") <= 80),
  "critic_status" text DEFAULT 'fallback' CHECK ("critic_status" IN ('validated', 'unavailable', 'fallback')),
  "suggestions" jsonb,
  "summary" jsonb,
  "error_code" text,
  "error_detail" text,
  "consumed_response_id" text,
  "consumed_at" timestamptz,
  "feedback_processed_at" timestamptz,
  "feedback_response_id" text,
  "expires_at" timestamptz NOT NULL,
  "id" text PRIMARY KEY CHECK (id ~ '^[0-9a-f]{24}$'),
  "created_at" timestamptz NOT NULL,
  "updated_at" timestamptz NOT NULL,
  api_version bigint,
  legacy_extra jsonb NOT NULL DEFAULT '{}',
  legacy_refs jsonb NOT NULL DEFAULT '{}',
  source_missing text[] NOT NULL DEFAULT '{}',
  row_version bigint NOT NULL DEFAULT 0
);

CREATE TABLE netflow."form_generation_jobs" (
  "org_id" text,
  "requester_id" text,
  "language_mode" text DEFAULT 'english_hindi' CHECK ("language_mode" IN ('english', 'english_hindi', 'hindi')),
  "source_file" jsonb,
  "status" text DEFAULT 'queued' CHECK ("status" IN ('queued', 'security_scan', 'inspecting', 'extracting_text', 'ocr_processing', 'generating_schema', 'validating', 'ready', 'failed', 'cancelled')),
  "stage" text DEFAULT 'Queued for processing',
  "progress" numeric DEFAULT 0 CHECK ("progress" >= 0) CHECK ("progress" <= 100),
  "attempts" numeric DEFAULT 0,
  "claimed_at" timestamptz,
  "retry_at" timestamptz,
  "page_count" numeric DEFAULT 0,
  "page_meta" jsonb,
  "lines" jsonb,
  "generated_title" text DEFAULT '',
  "generated_description" text DEFAULT '',
  "document_type" text DEFAULT '',
  "critic_status" text DEFAULT 'validated' CHECK ("critic_status" IN ('validated', 'unavailable')),
  "candidates" jsonb,
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
  "id" text PRIMARY KEY CHECK (id ~ '^[0-9a-f]{24}$'),
  "created_at" timestamptz NOT NULL,
  "updated_at" timestamptz NOT NULL,
  api_version bigint,
  legacy_extra jsonb NOT NULL DEFAULT '{}',
  legacy_refs jsonb NOT NULL DEFAULT '{}',
  source_missing text[] NOT NULL DEFAULT '{}',
  row_version bigint NOT NULL DEFAULT 0
);

CREATE TABLE netflow."pdf_auto_fill_learning_profiles" (
  "org_id" text,
  "form_id" text,
  "template_fingerprint" text NOT NULL,
  "field_id" text NOT NULL,
  "evidence_key" text NOT NULL,
  "value_pattern" text NOT NULL CHECK ("value_pattern" IN ('empty', 'boolean', 'number', 'date', 'numeric_identifier', 'alphanumeric_identifier', 'identifier_list', 'text')),
  "positive_streak" numeric DEFAULT 0 CHECK ("positive_streak" >= 0),
  "total_confirmations" numeric DEFAULT 0 CHECK ("total_confirmations" >= 0),
  "correction_count" numeric DEFAULT 0 CHECK ("correction_count" >= 0),
  "dismissal_count" numeric DEFAULT 0 CHECK ("dismissal_count" >= 0),
  "learned_tier" text DEFAULT 'none' CHECK ("learned_tier" IN ('none', 'medium', 'high')),
  "last_feedback_at" timestamptz,
  "id" text PRIMARY KEY CHECK (id ~ '^[0-9a-f]{24}$'),
  "created_at" timestamptz NOT NULL,
  "updated_at" timestamptz NOT NULL,
  api_version bigint,
  legacy_extra jsonb NOT NULL DEFAULT '{}',
  legacy_refs jsonb NOT NULL DEFAULT '{}',
  source_missing text[] NOT NULL DEFAULT '{}',
  row_version bigint NOT NULL DEFAULT 0
);

CREATE TABLE netflow."pdf_auto_fill_semantic_profiles" (
  "org_id" text,
  "form_id" text,
  "document_type" text NOT NULL CHECK (char_length("document_type") <= 80),
  "source_alias" text NOT NULL CHECK (char_length("source_alias") <= 160),
  "field_id" text NOT NULL,
  "value_pattern" text NOT NULL CHECK ("value_pattern" IN ('empty', 'boolean', 'number', 'date', 'numeric_identifier', 'alphanumeric_identifier', 'identifier_list', 'text')),
  "positive_streak" numeric DEFAULT 0 CHECK ("positive_streak" >= 0),
  "total_confirmations" numeric DEFAULT 0 CHECK ("total_confirmations" >= 0),
  "correction_count" numeric DEFAULT 0 CHECK ("correction_count" >= 0),
  "dismissal_count" numeric DEFAULT 0 CHECK ("dismissal_count" >= 0),
  "learned_tier" text DEFAULT 'none' CHECK ("learned_tier" IN ('none', 'medium', 'high')),
  "last_feedback_at" timestamptz,
  "id" text PRIMARY KEY CHECK (id ~ '^[0-9a-f]{24}$'),
  "created_at" timestamptz NOT NULL,
  "updated_at" timestamptz NOT NULL,
  api_version bigint,
  legacy_extra jsonb NOT NULL DEFAULT '{}',
  legacy_refs jsonb NOT NULL DEFAULT '{}',
  source_missing text[] NOT NULL DEFAULT '{}',
  row_version bigint NOT NULL DEFAULT 0
);

CREATE TABLE netflow."integration_dead_letters" (
  "org_id" text,
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
  "created_at" timestamptz NOT NULL,
  "id" text PRIMARY KEY CHECK (id ~ '^[0-9a-f]{24}$'),
  api_version bigint,
  legacy_extra jsonb NOT NULL DEFAULT '{}',
  legacy_refs jsonb NOT NULL DEFAULT '{}',
  source_missing text[] NOT NULL DEFAULT '{}',
  row_version bigint NOT NULL DEFAULT 0
);

CREATE TABLE netflow."webhook_delivery_logs" (
  "org_id" text,
  "workflow_id" text,
  "execution_id" text,
  "ok" boolean DEFAULT false,
  "status_code" numeric,
  "error" text,
  "code" text,
  "ip" text,
  "payload_keys" text[],
  "has_signature" boolean DEFAULT false,
  "idempotency_key" text,
  "replay" boolean DEFAULT false,
  "duration_ms" numeric,
  "created_at" timestamptz NOT NULL,
  "id" text PRIMARY KEY CHECK (id ~ '^[0-9a-f]{24}$'),
  api_version bigint,
  legacy_extra jsonb NOT NULL DEFAULT '{}',
  legacy_refs jsonb NOT NULL DEFAULT '{}',
  source_missing text[] NOT NULL DEFAULT '{}',
  row_version bigint NOT NULL DEFAULT 0
);

CREATE TABLE netflow."webhook_idempotencies" (
  "org_id" text,
  "workflow_id" text,
  "key" text NOT NULL,
  "execution_id" text,
  "created_at" timestamptz NOT NULL,
  "id" text PRIMARY KEY CHECK (id ~ '^[0-9a-f]{24}$'),
  api_version bigint,
  legacy_extra jsonb NOT NULL DEFAULT '{}',
  legacy_refs jsonb NOT NULL DEFAULT '{}',
  source_missing text[] NOT NULL DEFAULT '{}',
  row_version bigint NOT NULL DEFAULT 0
);

ALTER TABLE netflow.organizations ADD COLUMN departments_mode text NOT NULL DEFAULT 'configured' CHECK (departments_mode IN ('configured','legacy_default')); 

ALTER TABLE netflow.organization_departments ADD COLUMN department_id bigint GENERATED ALWAYS AS IDENTITY UNIQUE, ADD COLUMN name_key text GENERATED ALWAYS AS (lower(btrim(name))) STORED, ADD COLUMN from_legacy_default boolean NOT NULL DEFAULT false;

CREATE UNIQUE INDEX organization_department_name ON netflow.organization_departments(owner_id,name_key);

ALTER TABLE netflow.users ADD COLUMN department_id bigint REFERENCES netflow.organization_departments(department_id) ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE netflow.workflow_access_departments ADD COLUMN department_id bigint REFERENCES netflow.organization_departments(department_id) ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE netflow_private.organization_department_integrations ADD COLUMN department_id bigint REFERENCES netflow.organization_departments(department_id) ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED;

CREATE UNIQUE INDEX "plans_source_0" ON netflow."plans" ("key" ASC) NULLS NOT DISTINCT;

ALTER TABLE netflow."organizations" ADD CONSTRAINT "organizations_storage_extension_granted_by_fk" FOREIGN KEY ("storage_extension_granted_by") REFERENCES netflow."users"(id) DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX "organizations_storage_extension_granted_by_idx" ON netflow."organizations" ("storage_extension_granted_by");

ALTER TABLE netflow."organizations" ADD CONSTRAINT "organizations_admin_user_id_fk" FOREIGN KEY ("admin_user_id") REFERENCES netflow."users"(id) DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX "organizations_admin_user_id_idx" ON netflow."organizations" ("admin_user_id");

CREATE UNIQUE INDEX "organizations_source_0" ON netflow."organizations" ("subdomain" ASC) NULLS NOT DISTINCT;

CREATE INDEX "organizations_source_1" ON netflow."organizations" ("licence_valid_until" ASC);

CREATE INDEX "organizations_source_2" ON netflow."organizations" ("licence_trial_ends_at" ASC);

ALTER TABLE netflow."roles" ADD CONSTRAINT "roles_org_id_fk" FOREIGN KEY ("org_id") REFERENCES netflow."organizations"(id) DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX "roles_org_id_idx" ON netflow."roles" ("org_id");

CREATE UNIQUE INDEX "roles_source_0" ON netflow."roles" ((COALESCE("org_id", legacy_refs->>'orgId')) ASC, "name_key" ASC) NULLS NOT DISTINCT WHERE org_id IS NOT NULL;

ALTER TABLE netflow."users" ADD CONSTRAINT "users_org_id_fk" FOREIGN KEY ("org_id") REFERENCES netflow."organizations"(id) DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX "users_org_id_idx" ON netflow."users" ("org_id");

ALTER TABLE netflow."users" ADD CONSTRAINT "users_role_fk" FOREIGN KEY ("role") REFERENCES netflow."roles"(id) DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX "users_role_idx" ON netflow."users" ("role");

ALTER TABLE netflow."users" ADD CONSTRAINT "users_manager_id_fk" FOREIGN KEY ("manager_id") REFERENCES netflow."users"(id) DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX "users_manager_id_idx" ON netflow."users" ("manager_id");

ALTER TABLE netflow."users" ADD CONSTRAINT "users_hr_id_fk" FOREIGN KEY ("hr_id") REFERENCES netflow."users"(id) DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX "users_hr_id_idx" ON netflow."users" ("hr_id");

ALTER TABLE netflow."users" ADD CONSTRAINT "users_out_of_office_delegate_id_fk" FOREIGN KEY ("out_of_office_delegate_id") REFERENCES netflow."users"(id) DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX "users_out_of_office_delegate_id_idx" ON netflow."users" ("out_of_office_delegate_id");

CREATE UNIQUE INDEX "users_source_0" ON netflow."users" ((COALESCE("org_id", legacy_refs->>'orgId')) ASC, "email" ASC) NULLS NOT DISTINCT;

ALTER TABLE netflow."forms" ADD CONSTRAINT "forms_org_id_fk" FOREIGN KEY ("org_id") REFERENCES netflow."organizations"(id) DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX "forms_org_id_idx" ON netflow."forms" ("org_id");

ALTER TABLE netflow."forms" ADD CONSTRAINT "forms_created_by_fk" FOREIGN KEY ("created_by") REFERENCES netflow."users"(id) DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX "forms_created_by_idx" ON netflow."forms" ("created_by");

CREATE INDEX "forms_source_0" ON netflow."forms" ("public_token" ASC);

ALTER TABLE netflow."form_drafts" ADD CONSTRAINT "form_drafts_org_id_fk" FOREIGN KEY ("org_id") REFERENCES netflow."organizations"(id) DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX "form_drafts_org_id_idx" ON netflow."form_drafts" ("org_id");

ALTER TABLE netflow."form_drafts" ADD CONSTRAINT "form_drafts_form_id_fk" FOREIGN KEY ("form_id") REFERENCES netflow."forms"(id) DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX "form_drafts_form_id_idx" ON netflow."form_drafts" ("form_id");

ALTER TABLE netflow."form_drafts" ADD CONSTRAINT "form_drafts_user_id_fk" FOREIGN KEY ("user_id") REFERENCES netflow."users"(id) DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX "form_drafts_user_id_idx" ON netflow."form_drafts" ("user_id");

CREATE UNIQUE INDEX "form_drafts_source_0" ON netflow."form_drafts" ((COALESCE("form_id", legacy_refs->>'formId')) ASC, (COALESCE("user_id", legacy_refs->>'userId')) ASC) NULLS NOT DISTINCT;

ALTER TABLE netflow."form_responses" ADD CONSTRAINT "form_responses_org_id_fk" FOREIGN KEY ("org_id") REFERENCES netflow."organizations"(id) DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX "form_responses_org_id_idx" ON netflow."form_responses" ("org_id");

ALTER TABLE netflow."form_responses" ADD CONSTRAINT "form_responses_form_id_fk" FOREIGN KEY ("form_id") REFERENCES netflow."forms"(id) DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX "form_responses_form_id_idx" ON netflow."form_responses" ("form_id");

ALTER TABLE netflow."form_responses" ADD CONSTRAINT "form_responses_submitted_by_fk" FOREIGN KEY ("submitted_by") REFERENCES netflow."users"(id) DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX "form_responses_submitted_by_idx" ON netflow."form_responses" ("submitted_by");

ALTER TABLE netflow."workflows" ADD CONSTRAINT "workflows_org_id_fk" FOREIGN KEY ("org_id") REFERENCES netflow."organizations"(id) DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX "workflows_org_id_idx" ON netflow."workflows" ("org_id");

ALTER TABLE netflow."workflows" ADD CONSTRAINT "workflows_linked_form_id_fk" FOREIGN KEY ("linked_form_id") REFERENCES netflow."forms"(id) DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX "workflows_linked_form_id_idx" ON netflow."workflows" ("linked_form_id");

ALTER TABLE netflow."workflows" ADD CONSTRAINT "workflows_created_by_fk" FOREIGN KEY ("created_by") REFERENCES netflow."users"(id) DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX "workflows_created_by_idx" ON netflow."workflows" ("created_by");

ALTER TABLE netflow."workflows" ADD CONSTRAINT "workflows_previous_version_id_fk" FOREIGN KEY ("previous_version_id") REFERENCES netflow."workflows"(id) DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX "workflows_previous_version_id_idx" ON netflow."workflows" ("previous_version_id");

ALTER TABLE netflow."workflow_forms" ADD CONSTRAINT "workflow_forms_form_id_fk" FOREIGN KEY ("form_id") REFERENCES netflow."forms"(id) DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX "workflow_forms_form_id_idx" ON netflow."workflow_forms" ("form_id");

ALTER TABLE netflow."workflow_initiators" ADD CONSTRAINT "workflow_initiators_user_id_fk" FOREIGN KEY ("user_id") REFERENCES netflow."users"(id) DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX "workflow_initiators_user_id_idx" ON netflow."workflow_initiators" ("user_id");

ALTER TABLE netflow."workflow_viewers" ADD CONSTRAINT "workflow_viewers_user_id_fk" FOREIGN KEY ("user_id") REFERENCES netflow."users"(id) DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX "workflow_viewers_user_id_idx" ON netflow."workflow_viewers" ("user_id");

CREATE INDEX "workflows_source_0" ON netflow."workflows" ("inbound_webhook_token" ASC) WHERE "inbound_webhook_token" IS NOT NULL;

ALTER TABLE netflow."workflow_executions" ADD CONSTRAINT "workflow_executions_org_id_fk" FOREIGN KEY ("org_id") REFERENCES netflow."organizations"(id) DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX "workflow_executions_org_id_idx" ON netflow."workflow_executions" ("org_id");

ALTER TABLE netflow."workflow_executions" ADD CONSTRAINT "workflow_executions_workflow_id_fk" FOREIGN KEY ("workflow_id") REFERENCES netflow."workflows"(id) DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX "workflow_executions_workflow_id_idx" ON netflow."workflow_executions" ("workflow_id");

ALTER TABLE netflow."workflow_executions" ADD CONSTRAINT "workflow_executions_form_response_id_fk" FOREIGN KEY ("form_response_id") REFERENCES netflow."form_responses"(id) DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX "workflow_executions_form_response_id_idx" ON netflow."workflow_executions" ("form_response_id");

ALTER TABLE netflow."workflow_executions" ADD CONSTRAINT "workflow_executions_triggered_by_fk" FOREIGN KEY ("triggered_by") REFERENCES netflow."users"(id) DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX "workflow_executions_triggered_by_idx" ON netflow."workflow_executions" ("triggered_by");

CREATE UNIQUE INDEX "workflow_executions_source_0" ON netflow."workflow_executions" ("status_token" ASC) WHERE "status_token" IS NOT NULL;

CREATE INDEX "workflow_executions_source_1" ON netflow."workflow_executions" ("timer_resume_at" ASC);

CREATE INDEX "workflow_executions_source_2" ON netflow."workflow_executions" ("org_id" ASC, "workflow_id" ASC, "status" ASC, "created_at" DESC);

ALTER TABLE netflow."tasks" ADD CONSTRAINT "tasks_org_id_fk" FOREIGN KEY ("org_id") REFERENCES netflow."organizations"(id) DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX "tasks_org_id_idx" ON netflow."tasks" ("org_id");

ALTER TABLE netflow."tasks" ADD CONSTRAINT "tasks_workflow_execution_id_fk" FOREIGN KEY ("workflow_execution_id") REFERENCES netflow."workflow_executions"(id) DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX "tasks_workflow_execution_id_idx" ON netflow."tasks" ("workflow_execution_id");

ALTER TABLE netflow."tasks" ADD CONSTRAINT "tasks_workflow_id_fk" FOREIGN KEY ("workflow_id") REFERENCES netflow."workflows"(id) DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX "tasks_workflow_id_idx" ON netflow."tasks" ("workflow_id");

ALTER TABLE netflow."tasks" ADD CONSTRAINT "tasks_assigned_to_fk" FOREIGN KEY ("assigned_to") REFERENCES netflow."users"(id) DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX "tasks_assigned_to_idx" ON netflow."tasks" ("assigned_to");

ALTER TABLE netflow."tasks" ADD CONSTRAINT "tasks_submitted_by_fk" FOREIGN KEY ("submitted_by") REFERENCES netflow."users"(id) DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX "tasks_submitted_by_idx" ON netflow."tasks" ("submitted_by");

ALTER TABLE netflow."tasks" ADD CONSTRAINT "tasks_form_response_id_fk" FOREIGN KEY ("form_response_id") REFERENCES netflow."form_responses"(id) DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX "tasks_form_response_id_idx" ON netflow."tasks" ("form_response_id");

ALTER TABLE netflow."task_approvers" ADD CONSTRAINT "task_approvers_user_id_fk" FOREIGN KEY ("user_id") REFERENCES netflow."users"(id) DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX "task_approvers_user_id_idx" ON netflow."task_approvers" ("user_id");

ALTER TABLE netflow."task_votes" ADD CONSTRAINT "task_votes_user_id_fk" FOREIGN KEY ("user_id") REFERENCES netflow."users"(id) DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX "task_votes_user_id_idx" ON netflow."task_votes" ("user_id");

ALTER TABLE netflow."task_history" ADD CONSTRAINT "task_history_performed_by_fk" FOREIGN KEY ("performed_by") REFERENCES netflow."users"(id) DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX "task_history_performed_by_idx" ON netflow."task_history" ("performed_by");

CREATE INDEX "tasks_source_0" ON netflow."tasks" ("assigned_to" ASC, "status" ASC);

CREATE INDEX "tasks_source_1" ON netflow."tasks" ("due_date" ASC, "status" ASC, "is_escalated" ASC);

CREATE INDEX "tasks_source_2" ON netflow."tasks" ("org_id" ASC, "workflow_id" ASC, "status" ASC, "due_date" ASC);

ALTER TABLE netflow."notifications" ADD CONSTRAINT "notifications_org_id_fk" FOREIGN KEY ("org_id") REFERENCES netflow."organizations"(id) DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX "notifications_org_id_idx" ON netflow."notifications" ("org_id");

ALTER TABLE netflow."notifications" ADD CONSTRAINT "notifications_user_id_fk" FOREIGN KEY ("user_id") REFERENCES netflow."users"(id) DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX "notifications_user_id_idx" ON netflow."notifications" ("user_id");

ALTER TABLE netflow."notifications" ADD CONSTRAINT "notifications_task_id_fk" FOREIGN KEY ("task_id") REFERENCES netflow."tasks"(id) DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX "notifications_task_id_idx" ON netflow."notifications" ("task_id");

ALTER TABLE netflow."notifications" ADD CONSTRAINT "notifications_triggered_by_fk" FOREIGN KEY ("triggered_by") REFERENCES netflow."users"(id) DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX "notifications_triggered_by_idx" ON netflow."notifications" ("triggered_by");

CREATE INDEX "notifications_source_0" ON netflow."notifications" ("user_id" ASC, "is_read" ASC, "created_at" DESC);

ALTER TABLE netflow."audit_logs" ADD CONSTRAINT "audit_logs_org_id_fk" FOREIGN KEY ("org_id") REFERENCES netflow."organizations"(id) DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX "audit_logs_org_id_idx" ON netflow."audit_logs" ("org_id");

ALTER TABLE netflow."audit_logs" ADD CONSTRAINT "audit_logs_performed_by_fk" FOREIGN KEY ("performed_by") REFERENCES netflow."users"(id) DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX "audit_logs_performed_by_idx" ON netflow."audit_logs" ("performed_by");

CREATE INDEX "audit_logs_source_0" ON netflow."audit_logs" ("created_at" DESC);

CREATE INDEX "audit_logs_source_1" ON netflow."audit_logs" ("action" ASC, "created_at" DESC);

CREATE INDEX "audit_logs_source_2" ON netflow."audit_logs" ("performed_by" ASC, "created_at" DESC);

ALTER TABLE netflow."platform_broadcasts" ADD CONSTRAINT "platform_broadcasts_created_by_fk" FOREIGN KEY ("created_by") REFERENCES netflow."users"(id) DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX "platform_broadcasts_created_by_idx" ON netflow."platform_broadcasts" ("created_by");

CREATE INDEX "platform_broadcasts_source_0" ON netflow."platform_broadcasts" ("expires_at" ASC);

CREATE INDEX "platform_broadcasts_source_1" ON netflow."platform_broadcasts" ("superseded_at" ASC, "expires_at" ASC, "created_at" DESC);

ALTER TABLE netflow."document_extraction_jobs" ADD CONSTRAINT "document_extraction_jobs_org_id_fk" FOREIGN KEY ("org_id") REFERENCES netflow."organizations"(id) DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX "document_extraction_jobs_org_id_idx" ON netflow."document_extraction_jobs" ("org_id");

ALTER TABLE netflow."document_extraction_jobs" ADD CONSTRAINT "document_extraction_jobs_form_id_fk" FOREIGN KEY ("form_id") REFERENCES netflow."forms"(id) DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX "document_extraction_jobs_form_id_idx" ON netflow."document_extraction_jobs" ("form_id");

ALTER TABLE netflow."document_extraction_jobs" ADD CONSTRAINT "document_extraction_jobs_requester_id_fk" FOREIGN KEY ("requester_id") REFERENCES netflow."users"(id) DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX "document_extraction_jobs_requester_id_idx" ON netflow."document_extraction_jobs" ("requester_id");

ALTER TABLE netflow."document_extraction_jobs" ADD CONSTRAINT "document_extraction_jobs_consumed_response_id_fk" FOREIGN KEY ("consumed_response_id") REFERENCES netflow."form_responses"(id) DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX "document_extraction_jobs_consumed_response_id_idx" ON netflow."document_extraction_jobs" ("consumed_response_id");

ALTER TABLE netflow."document_extraction_jobs" ADD CONSTRAINT "document_extraction_jobs_feedback_response_id_fk" FOREIGN KEY ("feedback_response_id") REFERENCES netflow."form_responses"(id) DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX "document_extraction_jobs_feedback_response_id_idx" ON netflow."document_extraction_jobs" ("feedback_response_id");

CREATE INDEX "document_extraction_jobs_source_0" ON netflow."document_extraction_jobs" ("status" ASC);

CREATE INDEX "document_extraction_jobs_source_1" ON netflow."document_extraction_jobs" ("expires_at" ASC);

CREATE INDEX "document_extraction_jobs_source_2" ON netflow."document_extraction_jobs" ("status" ASC, "created_at" ASC);

ALTER TABLE netflow."form_generation_jobs" ADD CONSTRAINT "form_generation_jobs_org_id_fk" FOREIGN KEY ("org_id") REFERENCES netflow."organizations"(id) DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX "form_generation_jobs_org_id_idx" ON netflow."form_generation_jobs" ("org_id");

ALTER TABLE netflow."form_generation_jobs" ADD CONSTRAINT "form_generation_jobs_requester_id_fk" FOREIGN KEY ("requester_id") REFERENCES netflow."users"(id) DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX "form_generation_jobs_requester_id_idx" ON netflow."form_generation_jobs" ("requester_id");

CREATE INDEX "form_generation_jobs_source_0" ON netflow."form_generation_jobs" ("status" ASC);

CREATE INDEX "form_generation_jobs_source_1" ON netflow."form_generation_jobs" ("expires_at" ASC);

CREATE INDEX "form_generation_jobs_source_2" ON netflow."form_generation_jobs" ("status" ASC, "retry_at" ASC, "created_at" ASC);

ALTER TABLE netflow."pdf_auto_fill_learning_profiles" ADD CONSTRAINT "pdf_auto_fill_learning_profiles_org_id_fk" FOREIGN KEY ("org_id") REFERENCES netflow."organizations"(id) DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX "pdf_auto_fill_learning_profiles_org_id_idx" ON netflow."pdf_auto_fill_learning_profiles" ("org_id");

ALTER TABLE netflow."pdf_auto_fill_learning_profiles" ADD CONSTRAINT "pdf_auto_fill_learning_profiles_form_id_fk" FOREIGN KEY ("form_id") REFERENCES netflow."forms"(id) DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX "pdf_auto_fill_learning_profiles_form_id_idx" ON netflow."pdf_auto_fill_learning_profiles" ("form_id");

CREATE INDEX "pdf_auto_fill_learning_profiles_source_0" ON netflow."pdf_auto_fill_learning_profiles" ("template_fingerprint" ASC);

CREATE UNIQUE INDEX "pdf_auto_fill_learning_profiles_source_1" ON netflow."pdf_auto_fill_learning_profiles" ((COALESCE("org_id", legacy_refs->>'orgId')) ASC, (COALESCE("form_id", legacy_refs->>'formId')) ASC, "template_fingerprint" ASC, "field_id" ASC, "evidence_key" ASC, "value_pattern" ASC) NULLS NOT DISTINCT;

ALTER TABLE netflow."pdf_auto_fill_semantic_profiles" ADD CONSTRAINT "pdf_auto_fill_semantic_profiles_org_id_fk" FOREIGN KEY ("org_id") REFERENCES netflow."organizations"(id) DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX "pdf_auto_fill_semantic_profiles_org_id_idx" ON netflow."pdf_auto_fill_semantic_profiles" ("org_id");

ALTER TABLE netflow."pdf_auto_fill_semantic_profiles" ADD CONSTRAINT "pdf_auto_fill_semantic_profiles_form_id_fk" FOREIGN KEY ("form_id") REFERENCES netflow."forms"(id) DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX "pdf_auto_fill_semantic_profiles_form_id_idx" ON netflow."pdf_auto_fill_semantic_profiles" ("form_id");

CREATE INDEX "pdf_auto_fill_semantic_profiles_source_0" ON netflow."pdf_auto_fill_semantic_profiles" ("document_type" ASC);

CREATE UNIQUE INDEX "pdf_auto_fill_semantic_profiles_source_1" ON netflow."pdf_auto_fill_semantic_profiles" ((COALESCE("org_id", legacy_refs->>'orgId')) ASC, (COALESCE("form_id", legacy_refs->>'formId')) ASC, "document_type" ASC, "source_alias" ASC, "field_id" ASC, "value_pattern" ASC) NULLS NOT DISTINCT;

ALTER TABLE netflow."integration_dead_letters" ADD CONSTRAINT "integration_dead_letters_org_id_fk" FOREIGN KEY ("org_id") REFERENCES netflow."organizations"(id) DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX "integration_dead_letters_org_id_idx" ON netflow."integration_dead_letters" ("org_id");

ALTER TABLE netflow."integration_dead_letters" ADD CONSTRAINT "integration_dead_letters_workflow_id_fk" FOREIGN KEY ("workflow_id") REFERENCES netflow."workflows"(id) DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX "integration_dead_letters_workflow_id_idx" ON netflow."integration_dead_letters" ("workflow_id");

ALTER TABLE netflow."integration_dead_letters" ADD CONSTRAINT "integration_dead_letters_execution_id_fk" FOREIGN KEY ("execution_id") REFERENCES netflow."workflow_executions"(id) DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX "integration_dead_letters_execution_id_idx" ON netflow."integration_dead_letters" ("execution_id");

ALTER TABLE netflow."integration_dead_letters" ADD CONSTRAINT "integration_dead_letters_resolved_by_fk" FOREIGN KEY ("resolved_by") REFERENCES netflow."users"(id) DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX "integration_dead_letters_resolved_by_idx" ON netflow."integration_dead_letters" ("resolved_by");

CREATE INDEX "integration_dead_letters_source_0" ON netflow."integration_dead_letters" ("created_at" ASC);

CREATE INDEX "integration_dead_letters_source_1" ON netflow."integration_dead_letters" ("org_id" ASC, "resolved" ASC, "created_at" DESC);

ALTER TABLE netflow."webhook_delivery_logs" ADD CONSTRAINT "webhook_delivery_logs_org_id_fk" FOREIGN KEY ("org_id") REFERENCES netflow."organizations"(id) DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX "webhook_delivery_logs_org_id_idx" ON netflow."webhook_delivery_logs" ("org_id");

ALTER TABLE netflow."webhook_delivery_logs" ADD CONSTRAINT "webhook_delivery_logs_workflow_id_fk" FOREIGN KEY ("workflow_id") REFERENCES netflow."workflows"(id) DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX "webhook_delivery_logs_workflow_id_idx" ON netflow."webhook_delivery_logs" ("workflow_id");

ALTER TABLE netflow."webhook_delivery_logs" ADD CONSTRAINT "webhook_delivery_logs_execution_id_fk" FOREIGN KEY ("execution_id") REFERENCES netflow."workflow_executions"(id) DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX "webhook_delivery_logs_execution_id_idx" ON netflow."webhook_delivery_logs" ("execution_id");

CREATE INDEX "webhook_delivery_logs_source_0" ON netflow."webhook_delivery_logs" ("created_at" ASC);

CREATE INDEX "webhook_delivery_logs_source_1" ON netflow."webhook_delivery_logs" ("org_id" ASC, "created_at" DESC);

ALTER TABLE netflow."webhook_idempotencies" ADD CONSTRAINT "webhook_idempotencies_org_id_fk" FOREIGN KEY ("org_id") REFERENCES netflow."organizations"(id) DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX "webhook_idempotencies_org_id_idx" ON netflow."webhook_idempotencies" ("org_id");

ALTER TABLE netflow."webhook_idempotencies" ADD CONSTRAINT "webhook_idempotencies_workflow_id_fk" FOREIGN KEY ("workflow_id") REFERENCES netflow."workflows"(id) DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX "webhook_idempotencies_workflow_id_idx" ON netflow."webhook_idempotencies" ("workflow_id");

ALTER TABLE netflow."webhook_idempotencies" ADD CONSTRAINT "webhook_idempotencies_execution_id_fk" FOREIGN KEY ("execution_id") REFERENCES netflow."workflow_executions"(id) DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX "webhook_idempotencies_execution_id_idx" ON netflow."webhook_idempotencies" ("execution_id");

CREATE UNIQUE INDEX "webhook_idempotencies_source_0" ON netflow."webhook_idempotencies" ((COALESCE("org_id", legacy_refs->>'orgId')) ASC, (COALESCE("workflow_id", legacy_refs->>'workflowId')) ASC, "key" ASC) NULLS NOT DISTINCT;

CREATE INDEX "webhook_idempotencies_source_1" ON netflow."webhook_idempotencies" ("created_at" ASC);

ALTER TABLE netflow.organizations ADD CONSTRAINT organizations_plan_fk FOREIGN KEY (plan) REFERENCES netflow.plans(key) DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE netflow.organizations ADD CONSTRAINT organizations_subdomain_format CHECK (subdomain ~ '^([a-z0-9]|[a-z0-9][a-z0-9-]{0,61}[a-z0-9])$');

ALTER TABLE netflow.plans ADD CONSTRAINT plans_key_format CHECK (key ~ '^[a-z0-9-]+$');

CREATE UNIQUE INDEX user_sessions_identity ON netflow_private.user_sessions(owner_id, session_id);

CREATE UNIQUE INDEX user_mfa_backup_codes_identity ON netflow_private.user_mfa_backup_codes(owner_id, code_hash);

CREATE UNIQUE INDEX task_approvers_identity ON netflow.task_approvers(owner_id, user_id) WHERE user_id IS NOT NULL;

CREATE UNIQUE INDEX task_votes_identity ON netflow.task_votes(owner_id, user_id) WHERE user_id IS NOT NULL;

ALTER TABLE netflow.workflow_forms ADD CONSTRAINT workflow_form_owner UNIQUE(tenant_id, form_id) DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX document_extraction_jobs_claim ON netflow.document_extraction_jobs(created_at, id) WHERE status = 'queued';

CREATE INDEX form_generation_jobs_claim ON netflow.form_generation_jobs(created_at, id) WHERE status = 'queued';

CREATE INDEX tasks_tenant_inbox ON netflow.tasks(org_id, assigned_to, status, due_date, created_at DESC);

CREATE INDEX audit_logs_tenant_recent ON netflow.audit_logs(org_id, created_at DESC, id);

CREATE INDEX form_responses_tenant_form ON netflow.form_responses(org_id, form_id, created_at DESC);

CREATE TABLE netflow_private.outbox (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, tenant_id text, event_key text NOT NULL UNIQUE, event_type text NOT NULL, payload jsonb NOT NULL, status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','sent','failed')), attempts integer NOT NULL DEFAULT 0, retry_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz);

CREATE INDEX outbox_pending ON netflow_private.outbox(retry_at, id) WHERE status IN ('pending','failed');

ALTER TABLE netflow."plans" ENABLE ROW LEVEL SECURITY;

ALTER TABLE netflow."plans" FORCE ROW LEVEL SECURITY;

CREATE POLICY read_access ON netflow."plans" FOR SELECT USING (nullif(current_setting('netflow.system', true), '') IS NOT NULL OR true);

CREATE POLICY insert_access ON netflow."plans" FOR INSERT  WITH CHECK (nullif(current_setting('netflow.system', true), '') IS NOT NULL OR false);

CREATE POLICY update_access ON netflow."plans" FOR UPDATE USING (nullif(current_setting('netflow.system', true), '') IS NOT NULL OR false) WITH CHECK (nullif(current_setting('netflow.system', true), '') IS NOT NULL OR false);

CREATE POLICY delete_access ON netflow."plans" FOR DELETE USING (nullif(current_setting('netflow.system', true), '') IS NOT NULL OR false) ;

ALTER TABLE netflow."organizations" ENABLE ROW LEVEL SECURITY;

ALTER TABLE netflow."organizations" FORCE ROW LEVEL SECURITY;

CREATE POLICY read_access ON netflow."organizations" FOR SELECT USING (nullif(current_setting('netflow.system', true), '') IS NOT NULL OR "id" = nullif(current_setting('netflow.org_id', true), ''));

CREATE POLICY insert_access ON netflow."organizations" FOR INSERT  WITH CHECK (nullif(current_setting('netflow.system', true), '') IS NOT NULL OR "id" = nullif(current_setting('netflow.org_id', true), ''));

CREATE POLICY update_access ON netflow."organizations" FOR UPDATE USING (nullif(current_setting('netflow.system', true), '') IS NOT NULL OR "id" = nullif(current_setting('netflow.org_id', true), '')) WITH CHECK (nullif(current_setting('netflow.system', true), '') IS NOT NULL OR "id" = nullif(current_setting('netflow.org_id', true), ''));

CREATE POLICY delete_access ON netflow."organizations" FOR DELETE USING (nullif(current_setting('netflow.system', true), '') IS NOT NULL OR "id" = nullif(current_setting('netflow.org_id', true), '')) ;

ALTER TABLE netflow."organization_departments" ENABLE ROW LEVEL SECURITY;

ALTER TABLE netflow."organization_departments" FORCE ROW LEVEL SECURITY;

CREATE POLICY read_access ON netflow."organization_departments" FOR SELECT USING (nullif(current_setting('netflow.system', true), '') IS NOT NULL OR "tenant_id" = nullif(current_setting('netflow.org_id', true), ''));

CREATE POLICY insert_access ON netflow."organization_departments" FOR INSERT  WITH CHECK (nullif(current_setting('netflow.system', true), '') IS NOT NULL OR "tenant_id" = nullif(current_setting('netflow.org_id', true), ''));

CREATE POLICY update_access ON netflow."organization_departments" FOR UPDATE USING (nullif(current_setting('netflow.system', true), '') IS NOT NULL OR "tenant_id" = nullif(current_setting('netflow.org_id', true), '')) WITH CHECK (nullif(current_setting('netflow.system', true), '') IS NOT NULL OR "tenant_id" = nullif(current_setting('netflow.org_id', true), ''));

CREATE POLICY delete_access ON netflow."organization_departments" FOR DELETE USING (nullif(current_setting('netflow.system', true), '') IS NOT NULL OR "tenant_id" = nullif(current_setting('netflow.org_id', true), '')) ;

ALTER TABLE netflow."organization_usage" ENABLE ROW LEVEL SECURITY;

ALTER TABLE netflow."organization_usage" FORCE ROW LEVEL SECURITY;

CREATE POLICY read_access ON netflow."organization_usage" FOR SELECT USING (nullif(current_setting('netflow.system', true), '') IS NOT NULL OR "tenant_id" = nullif(current_setting('netflow.org_id', true), ''));

CREATE POLICY insert_access ON netflow."organization_usage" FOR INSERT  WITH CHECK (nullif(current_setting('netflow.system', true), '') IS NOT NULL OR "tenant_id" = nullif(current_setting('netflow.org_id', true), ''));

CREATE POLICY update_access ON netflow."organization_usage" FOR UPDATE USING (nullif(current_setting('netflow.system', true), '') IS NOT NULL OR "tenant_id" = nullif(current_setting('netflow.org_id', true), '')) WITH CHECK (nullif(current_setting('netflow.system', true), '') IS NOT NULL OR "tenant_id" = nullif(current_setting('netflow.org_id', true), ''));

CREATE POLICY delete_access ON netflow."organization_usage" FOR DELETE USING (nullif(current_setting('netflow.system', true), '') IS NOT NULL OR "tenant_id" = nullif(current_setting('netflow.org_id', true), '')) ;

ALTER TABLE netflow_private."organization_integrations" ENABLE ROW LEVEL SECURITY;

ALTER TABLE netflow_private."organization_integrations" FORCE ROW LEVEL SECURITY;

CREATE POLICY read_access ON netflow_private."organization_integrations" FOR SELECT USING (nullif(current_setting('netflow.system', true), '') IS NOT NULL OR "tenant_id" = nullif(current_setting('netflow.org_id', true), ''));

CREATE POLICY insert_access ON netflow_private."organization_integrations" FOR INSERT  WITH CHECK (nullif(current_setting('netflow.system', true), '') IS NOT NULL OR "tenant_id" = nullif(current_setting('netflow.org_id', true), ''));

CREATE POLICY update_access ON netflow_private."organization_integrations" FOR UPDATE USING (nullif(current_setting('netflow.system', true), '') IS NOT NULL OR "tenant_id" = nullif(current_setting('netflow.org_id', true), '')) WITH CHECK (nullif(current_setting('netflow.system', true), '') IS NOT NULL OR "tenant_id" = nullif(current_setting('netflow.org_id', true), ''));

CREATE POLICY delete_access ON netflow_private."organization_integrations" FOR DELETE USING (nullif(current_setting('netflow.system', true), '') IS NOT NULL OR "tenant_id" = nullif(current_setting('netflow.org_id', true), '')) ;

ALTER TABLE netflow_private."organization_department_integrations" ENABLE ROW LEVEL SECURITY;

ALTER TABLE netflow_private."organization_department_integrations" FORCE ROW LEVEL SECURITY;

CREATE POLICY read_access ON netflow_private."organization_department_integrations" FOR SELECT USING (nullif(current_setting('netflow.system', true), '') IS NOT NULL OR "tenant_id" = nullif(current_setting('netflow.org_id', true), ''));

CREATE POLICY insert_access ON netflow_private."organization_department_integrations" FOR INSERT  WITH CHECK (nullif(current_setting('netflow.system', true), '') IS NOT NULL OR "tenant_id" = nullif(current_setting('netflow.org_id', true), ''));

CREATE POLICY update_access ON netflow_private."organization_department_integrations" FOR UPDATE USING (nullif(current_setting('netflow.system', true), '') IS NOT NULL OR "tenant_id" = nullif(current_setting('netflow.org_id', true), '')) WITH CHECK (nullif(current_setting('netflow.system', true), '') IS NOT NULL OR "tenant_id" = nullif(current_setting('netflow.org_id', true), ''));

CREATE POLICY delete_access ON netflow_private."organization_department_integrations" FOR DELETE USING (nullif(current_setting('netflow.system', true), '') IS NOT NULL OR "tenant_id" = nullif(current_setting('netflow.org_id', true), '')) ;

ALTER TABLE netflow."roles" ENABLE ROW LEVEL SECURITY;

ALTER TABLE netflow."roles" FORCE ROW LEVEL SECURITY;

CREATE POLICY read_access ON netflow."roles" FOR SELECT USING (nullif(current_setting('netflow.system', true), '') IS NOT NULL OR "org_id" = nullif(current_setting('netflow.org_id', true), '') OR org_id IS NULL);

CREATE POLICY insert_access ON netflow."roles" FOR INSERT  WITH CHECK (nullif(current_setting('netflow.system', true), '') IS NOT NULL OR "org_id" = nullif(current_setting('netflow.org_id', true), ''));

CREATE POLICY update_access ON netflow."roles" FOR UPDATE USING (nullif(current_setting('netflow.system', true), '') IS NOT NULL OR "org_id" = nullif(current_setting('netflow.org_id', true), '')) WITH CHECK (nullif(current_setting('netflow.system', true), '') IS NOT NULL OR "org_id" = nullif(current_setting('netflow.org_id', true), ''));

CREATE POLICY delete_access ON netflow."roles" FOR DELETE USING (nullif(current_setting('netflow.system', true), '') IS NOT NULL OR "org_id" = nullif(current_setting('netflow.org_id', true), '')) ;

ALTER TABLE netflow."users" ENABLE ROW LEVEL SECURITY;

ALTER TABLE netflow."users" FORCE ROW LEVEL SECURITY;

CREATE POLICY read_access ON netflow."users" FOR SELECT USING (nullif(current_setting('netflow.system', true), '') IS NOT NULL OR "org_id" = nullif(current_setting('netflow.org_id', true), ''));

CREATE POLICY insert_access ON netflow."users" FOR INSERT  WITH CHECK (nullif(current_setting('netflow.system', true), '') IS NOT NULL OR "org_id" = nullif(current_setting('netflow.org_id', true), ''));

CREATE POLICY update_access ON netflow."users" FOR UPDATE USING (nullif(current_setting('netflow.system', true), '') IS NOT NULL OR "org_id" = nullif(current_setting('netflow.org_id', true), '')) WITH CHECK (nullif(current_setting('netflow.system', true), '') IS NOT NULL OR "org_id" = nullif(current_setting('netflow.org_id', true), ''));

CREATE POLICY delete_access ON netflow."users" FOR DELETE USING (nullif(current_setting('netflow.system', true), '') IS NOT NULL OR "org_id" = nullif(current_setting('netflow.org_id', true), '')) ;

ALTER TABLE netflow_private."user_auth" ENABLE ROW LEVEL SECURITY;

ALTER TABLE netflow_private."user_auth" FORCE ROW LEVEL SECURITY;

CREATE POLICY read_access ON netflow_private."user_auth" FOR SELECT USING (nullif(current_setting('netflow.system', true), '') IS NOT NULL OR "tenant_id" = nullif(current_setting('netflow.org_id', true), ''));

CREATE POLICY insert_access ON netflow_private."user_auth" FOR INSERT  WITH CHECK (nullif(current_setting('netflow.system', true), '') IS NOT NULL OR "tenant_id" = nullif(current_setting('netflow.org_id', true), ''));

CREATE POLICY update_access ON netflow_private."user_auth" FOR UPDATE USING (nullif(current_setting('netflow.system', true), '') IS NOT NULL OR "tenant_id" = nullif(current_setting('netflow.org_id', true), '')) WITH CHECK (nullif(current_setting('netflow.system', true), '') IS NOT NULL OR "tenant_id" = nullif(current_setting('netflow.org_id', true), ''));

CREATE POLICY delete_access ON netflow_private."user_auth" FOR DELETE USING (nullif(current_setting('netflow.system', true), '') IS NOT NULL OR "tenant_id" = nullif(current_setting('netflow.org_id', true), '')) ;

ALTER TABLE netflow_private."user_sessions" ENABLE ROW LEVEL SECURITY;

ALTER TABLE netflow_private."user_sessions" FORCE ROW LEVEL SECURITY;

CREATE POLICY read_access ON netflow_private."user_sessions" FOR SELECT USING (nullif(current_setting('netflow.system', true), '') IS NOT NULL OR "tenant_id" = nullif(current_setting('netflow.org_id', true), ''));

CREATE POLICY insert_access ON netflow_private."user_sessions" FOR INSERT  WITH CHECK (nullif(current_setting('netflow.system', true), '') IS NOT NULL OR "tenant_id" = nullif(current_setting('netflow.org_id', true), ''));

CREATE POLICY update_access ON netflow_private."user_sessions" FOR UPDATE USING (nullif(current_setting('netflow.system', true), '') IS NOT NULL OR "tenant_id" = nullif(current_setting('netflow.org_id', true), '')) WITH CHECK (nullif(current_setting('netflow.system', true), '') IS NOT NULL OR "tenant_id" = nullif(current_setting('netflow.org_id', true), ''));

CREATE POLICY delete_access ON netflow_private."user_sessions" FOR DELETE USING (nullif(current_setting('netflow.system', true), '') IS NOT NULL OR "tenant_id" = nullif(current_setting('netflow.org_id', true), '')) ;

ALTER TABLE netflow_private."user_mfa_backup_codes" ENABLE ROW LEVEL SECURITY;

ALTER TABLE netflow_private."user_mfa_backup_codes" FORCE ROW LEVEL SECURITY;

CREATE POLICY read_access ON netflow_private."user_mfa_backup_codes" FOR SELECT USING (nullif(current_setting('netflow.system', true), '') IS NOT NULL OR "tenant_id" = nullif(current_setting('netflow.org_id', true), ''));

CREATE POLICY insert_access ON netflow_private."user_mfa_backup_codes" FOR INSERT  WITH CHECK (nullif(current_setting('netflow.system', true), '') IS NOT NULL OR "tenant_id" = nullif(current_setting('netflow.org_id', true), ''));

CREATE POLICY update_access ON netflow_private."user_mfa_backup_codes" FOR UPDATE USING (nullif(current_setting('netflow.system', true), '') IS NOT NULL OR "tenant_id" = nullif(current_setting('netflow.org_id', true), '')) WITH CHECK (nullif(current_setting('netflow.system', true), '') IS NOT NULL OR "tenant_id" = nullif(current_setting('netflow.org_id', true), ''));

CREATE POLICY delete_access ON netflow_private."user_mfa_backup_codes" FOR DELETE USING (nullif(current_setting('netflow.system', true), '') IS NOT NULL OR "tenant_id" = nullif(current_setting('netflow.org_id', true), '')) ;

ALTER TABLE netflow."forms" ENABLE ROW LEVEL SECURITY;

ALTER TABLE netflow."forms" FORCE ROW LEVEL SECURITY;

CREATE POLICY read_access ON netflow."forms" FOR SELECT USING (nullif(current_setting('netflow.system', true), '') IS NOT NULL OR "org_id" = nullif(current_setting('netflow.org_id', true), ''));

CREATE POLICY insert_access ON netflow."forms" FOR INSERT  WITH CHECK (nullif(current_setting('netflow.system', true), '') IS NOT NULL OR "org_id" = nullif(current_setting('netflow.org_id', true), ''));

CREATE POLICY update_access ON netflow."forms" FOR UPDATE USING (nullif(current_setting('netflow.system', true), '') IS NOT NULL OR "org_id" = nullif(current_setting('netflow.org_id', true), '')) WITH CHECK (nullif(current_setting('netflow.system', true), '') IS NOT NULL OR "org_id" = nullif(current_setting('netflow.org_id', true), ''));

CREATE POLICY delete_access ON netflow."forms" FOR DELETE USING (nullif(current_setting('netflow.system', true), '') IS NOT NULL OR "org_id" = nullif(current_setting('netflow.org_id', true), '')) ;

ALTER TABLE netflow."form_drafts" ENABLE ROW LEVEL SECURITY;

ALTER TABLE netflow."form_drafts" FORCE ROW LEVEL SECURITY;

CREATE POLICY read_access ON netflow."form_drafts" FOR SELECT USING (nullif(current_setting('netflow.system', true), '') IS NOT NULL OR "org_id" = nullif(current_setting('netflow.org_id', true), ''));

CREATE POLICY insert_access ON netflow."form_drafts" FOR INSERT  WITH CHECK (nullif(current_setting('netflow.system', true), '') IS NOT NULL OR "org_id" = nullif(current_setting('netflow.org_id', true), ''));

CREATE POLICY update_access ON netflow."form_drafts" FOR UPDATE USING (nullif(current_setting('netflow.system', true), '') IS NOT NULL OR "org_id" = nullif(current_setting('netflow.org_id', true), '')) WITH CHECK (nullif(current_setting('netflow.system', true), '') IS NOT NULL OR "org_id" = nullif(current_setting('netflow.org_id', true), ''));

CREATE POLICY delete_access ON netflow."form_drafts" FOR DELETE USING (nullif(current_setting('netflow.system', true), '') IS NOT NULL OR "org_id" = nullif(current_setting('netflow.org_id', true), '')) ;

ALTER TABLE netflow."form_responses" ENABLE ROW LEVEL SECURITY;

ALTER TABLE netflow."form_responses" FORCE ROW LEVEL SECURITY;

CREATE POLICY read_access ON netflow."form_responses" FOR SELECT USING (nullif(current_setting('netflow.system', true), '') IS NOT NULL OR "org_id" = nullif(current_setting('netflow.org_id', true), ''));

CREATE POLICY insert_access ON netflow."form_responses" FOR INSERT  WITH CHECK (nullif(current_setting('netflow.system', true), '') IS NOT NULL OR "org_id" = nullif(current_setting('netflow.org_id', true), ''));

CREATE POLICY update_access ON netflow."form_responses" FOR UPDATE USING (nullif(current_setting('netflow.system', true), '') IS NOT NULL OR "org_id" = nullif(current_setting('netflow.org_id', true), '')) WITH CHECK (nullif(current_setting('netflow.system', true), '') IS NOT NULL OR "org_id" = nullif(current_setting('netflow.org_id', true), ''));

CREATE POLICY delete_access ON netflow."form_responses" FOR DELETE USING (nullif(current_setting('netflow.system', true), '') IS NOT NULL OR "org_id" = nullif(current_setting('netflow.org_id', true), '')) ;

ALTER TABLE netflow."workflows" ENABLE ROW LEVEL SECURITY;

ALTER TABLE netflow."workflows" FORCE ROW LEVEL SECURITY;

CREATE POLICY read_access ON netflow."workflows" FOR SELECT USING (nullif(current_setting('netflow.system', true), '') IS NOT NULL OR "org_id" = nullif(current_setting('netflow.org_id', true), ''));

CREATE POLICY insert_access ON netflow."workflows" FOR INSERT  WITH CHECK (nullif(current_setting('netflow.system', true), '') IS NOT NULL OR "org_id" = nullif(current_setting('netflow.org_id', true), ''));

CREATE POLICY update_access ON netflow."workflows" FOR UPDATE USING (nullif(current_setting('netflow.system', true), '') IS NOT NULL OR "org_id" = nullif(current_setting('netflow.org_id', true), '')) WITH CHECK (nullif(current_setting('netflow.system', true), '') IS NOT NULL OR "org_id" = nullif(current_setting('netflow.org_id', true), ''));

CREATE POLICY delete_access ON netflow."workflows" FOR DELETE USING (nullif(current_setting('netflow.system', true), '') IS NOT NULL OR "org_id" = nullif(current_setting('netflow.org_id', true), '')) ;

ALTER TABLE netflow."workflow_forms" ENABLE ROW LEVEL SECURITY;

ALTER TABLE netflow."workflow_forms" FORCE ROW LEVEL SECURITY;

CREATE POLICY read_access ON netflow."workflow_forms" FOR SELECT USING (nullif(current_setting('netflow.system', true), '') IS NOT NULL OR "tenant_id" = nullif(current_setting('netflow.org_id', true), ''));

CREATE POLICY insert_access ON netflow."workflow_forms" FOR INSERT  WITH CHECK (nullif(current_setting('netflow.system', true), '') IS NOT NULL OR "tenant_id" = nullif(current_setting('netflow.org_id', true), ''));

CREATE POLICY update_access ON netflow."workflow_forms" FOR UPDATE USING (nullif(current_setting('netflow.system', true), '') IS NOT NULL OR "tenant_id" = nullif(current_setting('netflow.org_id', true), '')) WITH CHECK (nullif(current_setting('netflow.system', true), '') IS NOT NULL OR "tenant_id" = nullif(current_setting('netflow.org_id', true), ''));

CREATE POLICY delete_access ON netflow."workflow_forms" FOR DELETE USING (nullif(current_setting('netflow.system', true), '') IS NOT NULL OR "tenant_id" = nullif(current_setting('netflow.org_id', true), '')) ;

ALTER TABLE netflow."workflow_initiators" ENABLE ROW LEVEL SECURITY;

ALTER TABLE netflow."workflow_initiators" FORCE ROW LEVEL SECURITY;

CREATE POLICY read_access ON netflow."workflow_initiators" FOR SELECT USING (nullif(current_setting('netflow.system', true), '') IS NOT NULL OR "tenant_id" = nullif(current_setting('netflow.org_id', true), ''));

CREATE POLICY insert_access ON netflow."workflow_initiators" FOR INSERT  WITH CHECK (nullif(current_setting('netflow.system', true), '') IS NOT NULL OR "tenant_id" = nullif(current_setting('netflow.org_id', true), ''));

CREATE POLICY update_access ON netflow."workflow_initiators" FOR UPDATE USING (nullif(current_setting('netflow.system', true), '') IS NOT NULL OR "tenant_id" = nullif(current_setting('netflow.org_id', true), '')) WITH CHECK (nullif(current_setting('netflow.system', true), '') IS NOT NULL OR "tenant_id" = nullif(current_setting('netflow.org_id', true), ''));

CREATE POLICY delete_access ON netflow."workflow_initiators" FOR DELETE USING (nullif(current_setting('netflow.system', true), '') IS NOT NULL OR "tenant_id" = nullif(current_setting('netflow.org_id', true), '')) ;

ALTER TABLE netflow."workflow_viewers" ENABLE ROW LEVEL SECURITY;

ALTER TABLE netflow."workflow_viewers" FORCE ROW LEVEL SECURITY;

CREATE POLICY read_access ON netflow."workflow_viewers" FOR SELECT USING (nullif(current_setting('netflow.system', true), '') IS NOT NULL OR "tenant_id" = nullif(current_setting('netflow.org_id', true), ''));

CREATE POLICY insert_access ON netflow."workflow_viewers" FOR INSERT  WITH CHECK (nullif(current_setting('netflow.system', true), '') IS NOT NULL OR "tenant_id" = nullif(current_setting('netflow.org_id', true), ''));

CREATE POLICY update_access ON netflow."workflow_viewers" FOR UPDATE USING (nullif(current_setting('netflow.system', true), '') IS NOT NULL OR "tenant_id" = nullif(current_setting('netflow.org_id', true), '')) WITH CHECK (nullif(current_setting('netflow.system', true), '') IS NOT NULL OR "tenant_id" = nullif(current_setting('netflow.org_id', true), ''));

CREATE POLICY delete_access ON netflow."workflow_viewers" FOR DELETE USING (nullif(current_setting('netflow.system', true), '') IS NOT NULL OR "tenant_id" = nullif(current_setting('netflow.org_id', true), '')) ;

ALTER TABLE netflow."workflow_access_departments" ENABLE ROW LEVEL SECURITY;

ALTER TABLE netflow."workflow_access_departments" FORCE ROW LEVEL SECURITY;

CREATE POLICY read_access ON netflow."workflow_access_departments" FOR SELECT USING (nullif(current_setting('netflow.system', true), '') IS NOT NULL OR "tenant_id" = nullif(current_setting('netflow.org_id', true), ''));

CREATE POLICY insert_access ON netflow."workflow_access_departments" FOR INSERT  WITH CHECK (nullif(current_setting('netflow.system', true), '') IS NOT NULL OR "tenant_id" = nullif(current_setting('netflow.org_id', true), ''));

CREATE POLICY update_access ON netflow."workflow_access_departments" FOR UPDATE USING (nullif(current_setting('netflow.system', true), '') IS NOT NULL OR "tenant_id" = nullif(current_setting('netflow.org_id', true), '')) WITH CHECK (nullif(current_setting('netflow.system', true), '') IS NOT NULL OR "tenant_id" = nullif(current_setting('netflow.org_id', true), ''));

CREATE POLICY delete_access ON netflow."workflow_access_departments" FOR DELETE USING (nullif(current_setting('netflow.system', true), '') IS NOT NULL OR "tenant_id" = nullif(current_setting('netflow.org_id', true), '')) ;

ALTER TABLE netflow."workflow_executions" ENABLE ROW LEVEL SECURITY;

ALTER TABLE netflow."workflow_executions" FORCE ROW LEVEL SECURITY;

CREATE POLICY read_access ON netflow."workflow_executions" FOR SELECT USING (nullif(current_setting('netflow.system', true), '') IS NOT NULL OR "org_id" = nullif(current_setting('netflow.org_id', true), ''));

CREATE POLICY insert_access ON netflow."workflow_executions" FOR INSERT  WITH CHECK (nullif(current_setting('netflow.system', true), '') IS NOT NULL OR "org_id" = nullif(current_setting('netflow.org_id', true), ''));

CREATE POLICY update_access ON netflow."workflow_executions" FOR UPDATE USING (nullif(current_setting('netflow.system', true), '') IS NOT NULL OR "org_id" = nullif(current_setting('netflow.org_id', true), '')) WITH CHECK (nullif(current_setting('netflow.system', true), '') IS NOT NULL OR "org_id" = nullif(current_setting('netflow.org_id', true), ''));

CREATE POLICY delete_access ON netflow."workflow_executions" FOR DELETE USING (nullif(current_setting('netflow.system', true), '') IS NOT NULL OR "org_id" = nullif(current_setting('netflow.org_id', true), '')) ;

ALTER TABLE netflow."execution_events" ENABLE ROW LEVEL SECURITY;

ALTER TABLE netflow."execution_events" FORCE ROW LEVEL SECURITY;

CREATE POLICY read_access ON netflow."execution_events" FOR SELECT USING (nullif(current_setting('netflow.system', true), '') IS NOT NULL OR "tenant_id" = nullif(current_setting('netflow.org_id', true), ''));

CREATE POLICY insert_access ON netflow."execution_events" FOR INSERT  WITH CHECK (nullif(current_setting('netflow.system', true), '') IS NOT NULL OR "tenant_id" = nullif(current_setting('netflow.org_id', true), ''));

CREATE POLICY update_access ON netflow."execution_events" FOR UPDATE USING (nullif(current_setting('netflow.system', true), '') IS NOT NULL OR "tenant_id" = nullif(current_setting('netflow.org_id', true), '')) WITH CHECK (nullif(current_setting('netflow.system', true), '') IS NOT NULL OR "tenant_id" = nullif(current_setting('netflow.org_id', true), ''));

CREATE POLICY delete_access ON netflow."execution_events" FOR DELETE USING (nullif(current_setting('netflow.system', true), '') IS NOT NULL OR "tenant_id" = nullif(current_setting('netflow.org_id', true), '')) ;

ALTER TABLE netflow."tasks" ENABLE ROW LEVEL SECURITY;

ALTER TABLE netflow."tasks" FORCE ROW LEVEL SECURITY;

CREATE POLICY read_access ON netflow."tasks" FOR SELECT USING (nullif(current_setting('netflow.system', true), '') IS NOT NULL OR "org_id" = nullif(current_setting('netflow.org_id', true), ''));

CREATE POLICY insert_access ON netflow."tasks" FOR INSERT  WITH CHECK (nullif(current_setting('netflow.system', true), '') IS NOT NULL OR "org_id" = nullif(current_setting('netflow.org_id', true), ''));

CREATE POLICY update_access ON netflow."tasks" FOR UPDATE USING (nullif(current_setting('netflow.system', true), '') IS NOT NULL OR "org_id" = nullif(current_setting('netflow.org_id', true), '')) WITH CHECK (nullif(current_setting('netflow.system', true), '') IS NOT NULL OR "org_id" = nullif(current_setting('netflow.org_id', true), ''));

CREATE POLICY delete_access ON netflow."tasks" FOR DELETE USING (nullif(current_setting('netflow.system', true), '') IS NOT NULL OR "org_id" = nullif(current_setting('netflow.org_id', true), '')) ;

ALTER TABLE netflow."task_approvers" ENABLE ROW LEVEL SECURITY;

ALTER TABLE netflow."task_approvers" FORCE ROW LEVEL SECURITY;

CREATE POLICY read_access ON netflow."task_approvers" FOR SELECT USING (nullif(current_setting('netflow.system', true), '') IS NOT NULL OR "tenant_id" = nullif(current_setting('netflow.org_id', true), ''));

CREATE POLICY insert_access ON netflow."task_approvers" FOR INSERT  WITH CHECK (nullif(current_setting('netflow.system', true), '') IS NOT NULL OR "tenant_id" = nullif(current_setting('netflow.org_id', true), ''));

CREATE POLICY update_access ON netflow."task_approvers" FOR UPDATE USING (nullif(current_setting('netflow.system', true), '') IS NOT NULL OR "tenant_id" = nullif(current_setting('netflow.org_id', true), '')) WITH CHECK (nullif(current_setting('netflow.system', true), '') IS NOT NULL OR "tenant_id" = nullif(current_setting('netflow.org_id', true), ''));

CREATE POLICY delete_access ON netflow."task_approvers" FOR DELETE USING (nullif(current_setting('netflow.system', true), '') IS NOT NULL OR "tenant_id" = nullif(current_setting('netflow.org_id', true), '')) ;

ALTER TABLE netflow."task_votes" ENABLE ROW LEVEL SECURITY;

ALTER TABLE netflow."task_votes" FORCE ROW LEVEL SECURITY;

CREATE POLICY read_access ON netflow."task_votes" FOR SELECT USING (nullif(current_setting('netflow.system', true), '') IS NOT NULL OR "tenant_id" = nullif(current_setting('netflow.org_id', true), ''));

CREATE POLICY insert_access ON netflow."task_votes" FOR INSERT  WITH CHECK (nullif(current_setting('netflow.system', true), '') IS NOT NULL OR "tenant_id" = nullif(current_setting('netflow.org_id', true), ''));

CREATE POLICY update_access ON netflow."task_votes" FOR UPDATE USING (nullif(current_setting('netflow.system', true), '') IS NOT NULL OR "tenant_id" = nullif(current_setting('netflow.org_id', true), '')) WITH CHECK (nullif(current_setting('netflow.system', true), '') IS NOT NULL OR "tenant_id" = nullif(current_setting('netflow.org_id', true), ''));

CREATE POLICY delete_access ON netflow."task_votes" FOR DELETE USING (nullif(current_setting('netflow.system', true), '') IS NOT NULL OR "tenant_id" = nullif(current_setting('netflow.org_id', true), '')) ;

ALTER TABLE netflow."task_history" ENABLE ROW LEVEL SECURITY;

ALTER TABLE netflow."task_history" FORCE ROW LEVEL SECURITY;

CREATE POLICY read_access ON netflow."task_history" FOR SELECT USING (nullif(current_setting('netflow.system', true), '') IS NOT NULL OR "tenant_id" = nullif(current_setting('netflow.org_id', true), ''));

CREATE POLICY insert_access ON netflow."task_history" FOR INSERT  WITH CHECK (nullif(current_setting('netflow.system', true), '') IS NOT NULL OR "tenant_id" = nullif(current_setting('netflow.org_id', true), ''));

CREATE POLICY update_access ON netflow."task_history" FOR UPDATE USING (nullif(current_setting('netflow.system', true), '') IS NOT NULL OR "tenant_id" = nullif(current_setting('netflow.org_id', true), '')) WITH CHECK (nullif(current_setting('netflow.system', true), '') IS NOT NULL OR "tenant_id" = nullif(current_setting('netflow.org_id', true), ''));

CREATE POLICY delete_access ON netflow."task_history" FOR DELETE USING (nullif(current_setting('netflow.system', true), '') IS NOT NULL OR "tenant_id" = nullif(current_setting('netflow.org_id', true), '')) ;

ALTER TABLE netflow."notifications" ENABLE ROW LEVEL SECURITY;

ALTER TABLE netflow."notifications" FORCE ROW LEVEL SECURITY;

CREATE POLICY read_access ON netflow."notifications" FOR SELECT USING (nullif(current_setting('netflow.system', true), '') IS NOT NULL OR "org_id" = nullif(current_setting('netflow.org_id', true), ''));

CREATE POLICY insert_access ON netflow."notifications" FOR INSERT  WITH CHECK (nullif(current_setting('netflow.system', true), '') IS NOT NULL OR "org_id" = nullif(current_setting('netflow.org_id', true), ''));

CREATE POLICY update_access ON netflow."notifications" FOR UPDATE USING (nullif(current_setting('netflow.system', true), '') IS NOT NULL OR "org_id" = nullif(current_setting('netflow.org_id', true), '')) WITH CHECK (nullif(current_setting('netflow.system', true), '') IS NOT NULL OR "org_id" = nullif(current_setting('netflow.org_id', true), ''));

CREATE POLICY delete_access ON netflow."notifications" FOR DELETE USING (nullif(current_setting('netflow.system', true), '') IS NOT NULL OR "org_id" = nullif(current_setting('netflow.org_id', true), '')) ;

ALTER TABLE netflow."audit_logs" ENABLE ROW LEVEL SECURITY;

ALTER TABLE netflow."audit_logs" FORCE ROW LEVEL SECURITY;

CREATE POLICY read_access ON netflow."audit_logs" FOR SELECT USING (nullif(current_setting('netflow.system', true), '') IS NOT NULL OR "org_id" = nullif(current_setting('netflow.org_id', true), ''));

CREATE POLICY insert_access ON netflow."audit_logs" FOR INSERT  WITH CHECK (nullif(current_setting('netflow.system', true), '') IS NOT NULL OR "org_id" = nullif(current_setting('netflow.org_id', true), ''));

CREATE POLICY update_access ON netflow."audit_logs" FOR UPDATE USING (nullif(current_setting('netflow.system', true), '') IS NOT NULL OR "org_id" = nullif(current_setting('netflow.org_id', true), '')) WITH CHECK (nullif(current_setting('netflow.system', true), '') IS NOT NULL OR "org_id" = nullif(current_setting('netflow.org_id', true), ''));

CREATE POLICY delete_access ON netflow."audit_logs" FOR DELETE USING (nullif(current_setting('netflow.system', true), '') IS NOT NULL OR "org_id" = nullif(current_setting('netflow.org_id', true), '')) ;

ALTER TABLE netflow."platform_broadcasts" ENABLE ROW LEVEL SECURITY;

ALTER TABLE netflow."platform_broadcasts" FORCE ROW LEVEL SECURITY;

CREATE POLICY read_access ON netflow."platform_broadcasts" FOR SELECT USING (nullif(current_setting('netflow.system', true), '') IS NOT NULL OR true);

CREATE POLICY insert_access ON netflow."platform_broadcasts" FOR INSERT  WITH CHECK (nullif(current_setting('netflow.system', true), '') IS NOT NULL OR false);

CREATE POLICY update_access ON netflow."platform_broadcasts" FOR UPDATE USING (nullif(current_setting('netflow.system', true), '') IS NOT NULL OR false) WITH CHECK (nullif(current_setting('netflow.system', true), '') IS NOT NULL OR false);

CREATE POLICY delete_access ON netflow."platform_broadcasts" FOR DELETE USING (nullif(current_setting('netflow.system', true), '') IS NOT NULL OR false) ;

ALTER TABLE netflow."document_extraction_jobs" ENABLE ROW LEVEL SECURITY;

ALTER TABLE netflow."document_extraction_jobs" FORCE ROW LEVEL SECURITY;

CREATE POLICY read_access ON netflow."document_extraction_jobs" FOR SELECT USING (nullif(current_setting('netflow.system', true), '') IS NOT NULL OR "org_id" = nullif(current_setting('netflow.org_id', true), ''));

CREATE POLICY insert_access ON netflow."document_extraction_jobs" FOR INSERT  WITH CHECK (nullif(current_setting('netflow.system', true), '') IS NOT NULL OR "org_id" = nullif(current_setting('netflow.org_id', true), ''));

CREATE POLICY update_access ON netflow."document_extraction_jobs" FOR UPDATE USING (nullif(current_setting('netflow.system', true), '') IS NOT NULL OR "org_id" = nullif(current_setting('netflow.org_id', true), '')) WITH CHECK (nullif(current_setting('netflow.system', true), '') IS NOT NULL OR "org_id" = nullif(current_setting('netflow.org_id', true), ''));

CREATE POLICY delete_access ON netflow."document_extraction_jobs" FOR DELETE USING (nullif(current_setting('netflow.system', true), '') IS NOT NULL OR "org_id" = nullif(current_setting('netflow.org_id', true), '')) ;

ALTER TABLE netflow."form_generation_jobs" ENABLE ROW LEVEL SECURITY;

ALTER TABLE netflow."form_generation_jobs" FORCE ROW LEVEL SECURITY;

CREATE POLICY read_access ON netflow."form_generation_jobs" FOR SELECT USING (nullif(current_setting('netflow.system', true), '') IS NOT NULL OR "org_id" = nullif(current_setting('netflow.org_id', true), ''));

CREATE POLICY insert_access ON netflow."form_generation_jobs" FOR INSERT  WITH CHECK (nullif(current_setting('netflow.system', true), '') IS NOT NULL OR "org_id" = nullif(current_setting('netflow.org_id', true), ''));

CREATE POLICY update_access ON netflow."form_generation_jobs" FOR UPDATE USING (nullif(current_setting('netflow.system', true), '') IS NOT NULL OR "org_id" = nullif(current_setting('netflow.org_id', true), '')) WITH CHECK (nullif(current_setting('netflow.system', true), '') IS NOT NULL OR "org_id" = nullif(current_setting('netflow.org_id', true), ''));

CREATE POLICY delete_access ON netflow."form_generation_jobs" FOR DELETE USING (nullif(current_setting('netflow.system', true), '') IS NOT NULL OR "org_id" = nullif(current_setting('netflow.org_id', true), '')) ;

ALTER TABLE netflow."pdf_auto_fill_learning_profiles" ENABLE ROW LEVEL SECURITY;

ALTER TABLE netflow."pdf_auto_fill_learning_profiles" FORCE ROW LEVEL SECURITY;

CREATE POLICY read_access ON netflow."pdf_auto_fill_learning_profiles" FOR SELECT USING (nullif(current_setting('netflow.system', true), '') IS NOT NULL OR "org_id" = nullif(current_setting('netflow.org_id', true), ''));

CREATE POLICY insert_access ON netflow."pdf_auto_fill_learning_profiles" FOR INSERT  WITH CHECK (nullif(current_setting('netflow.system', true), '') IS NOT NULL OR "org_id" = nullif(current_setting('netflow.org_id', true), ''));

CREATE POLICY update_access ON netflow."pdf_auto_fill_learning_profiles" FOR UPDATE USING (nullif(current_setting('netflow.system', true), '') IS NOT NULL OR "org_id" = nullif(current_setting('netflow.org_id', true), '')) WITH CHECK (nullif(current_setting('netflow.system', true), '') IS NOT NULL OR "org_id" = nullif(current_setting('netflow.org_id', true), ''));

CREATE POLICY delete_access ON netflow."pdf_auto_fill_learning_profiles" FOR DELETE USING (nullif(current_setting('netflow.system', true), '') IS NOT NULL OR "org_id" = nullif(current_setting('netflow.org_id', true), '')) ;

ALTER TABLE netflow."pdf_auto_fill_semantic_profiles" ENABLE ROW LEVEL SECURITY;

ALTER TABLE netflow."pdf_auto_fill_semantic_profiles" FORCE ROW LEVEL SECURITY;

CREATE POLICY read_access ON netflow."pdf_auto_fill_semantic_profiles" FOR SELECT USING (nullif(current_setting('netflow.system', true), '') IS NOT NULL OR "org_id" = nullif(current_setting('netflow.org_id', true), ''));

CREATE POLICY insert_access ON netflow."pdf_auto_fill_semantic_profiles" FOR INSERT  WITH CHECK (nullif(current_setting('netflow.system', true), '') IS NOT NULL OR "org_id" = nullif(current_setting('netflow.org_id', true), ''));

CREATE POLICY update_access ON netflow."pdf_auto_fill_semantic_profiles" FOR UPDATE USING (nullif(current_setting('netflow.system', true), '') IS NOT NULL OR "org_id" = nullif(current_setting('netflow.org_id', true), '')) WITH CHECK (nullif(current_setting('netflow.system', true), '') IS NOT NULL OR "org_id" = nullif(current_setting('netflow.org_id', true), ''));

CREATE POLICY delete_access ON netflow."pdf_auto_fill_semantic_profiles" FOR DELETE USING (nullif(current_setting('netflow.system', true), '') IS NOT NULL OR "org_id" = nullif(current_setting('netflow.org_id', true), '')) ;

ALTER TABLE netflow."integration_dead_letters" ENABLE ROW LEVEL SECURITY;

ALTER TABLE netflow."integration_dead_letters" FORCE ROW LEVEL SECURITY;

CREATE POLICY read_access ON netflow."integration_dead_letters" FOR SELECT USING (nullif(current_setting('netflow.system', true), '') IS NOT NULL OR "org_id" = nullif(current_setting('netflow.org_id', true), ''));

CREATE POLICY insert_access ON netflow."integration_dead_letters" FOR INSERT  WITH CHECK (nullif(current_setting('netflow.system', true), '') IS NOT NULL OR "org_id" = nullif(current_setting('netflow.org_id', true), ''));

CREATE POLICY update_access ON netflow."integration_dead_letters" FOR UPDATE USING (nullif(current_setting('netflow.system', true), '') IS NOT NULL OR "org_id" = nullif(current_setting('netflow.org_id', true), '')) WITH CHECK (nullif(current_setting('netflow.system', true), '') IS NOT NULL OR "org_id" = nullif(current_setting('netflow.org_id', true), ''));

CREATE POLICY delete_access ON netflow."integration_dead_letters" FOR DELETE USING (nullif(current_setting('netflow.system', true), '') IS NOT NULL OR "org_id" = nullif(current_setting('netflow.org_id', true), '')) ;

ALTER TABLE netflow."webhook_delivery_logs" ENABLE ROW LEVEL SECURITY;

ALTER TABLE netflow."webhook_delivery_logs" FORCE ROW LEVEL SECURITY;

CREATE POLICY read_access ON netflow."webhook_delivery_logs" FOR SELECT USING (nullif(current_setting('netflow.system', true), '') IS NOT NULL OR "org_id" = nullif(current_setting('netflow.org_id', true), ''));

CREATE POLICY insert_access ON netflow."webhook_delivery_logs" FOR INSERT  WITH CHECK (nullif(current_setting('netflow.system', true), '') IS NOT NULL OR "org_id" = nullif(current_setting('netflow.org_id', true), ''));

CREATE POLICY update_access ON netflow."webhook_delivery_logs" FOR UPDATE USING (nullif(current_setting('netflow.system', true), '') IS NOT NULL OR "org_id" = nullif(current_setting('netflow.org_id', true), '')) WITH CHECK (nullif(current_setting('netflow.system', true), '') IS NOT NULL OR "org_id" = nullif(current_setting('netflow.org_id', true), ''));

CREATE POLICY delete_access ON netflow."webhook_delivery_logs" FOR DELETE USING (nullif(current_setting('netflow.system', true), '') IS NOT NULL OR "org_id" = nullif(current_setting('netflow.org_id', true), '')) ;

ALTER TABLE netflow."webhook_idempotencies" ENABLE ROW LEVEL SECURITY;

ALTER TABLE netflow."webhook_idempotencies" FORCE ROW LEVEL SECURITY;

CREATE POLICY read_access ON netflow."webhook_idempotencies" FOR SELECT USING (nullif(current_setting('netflow.system', true), '') IS NOT NULL OR "org_id" = nullif(current_setting('netflow.org_id', true), ''));

CREATE POLICY insert_access ON netflow."webhook_idempotencies" FOR INSERT  WITH CHECK (nullif(current_setting('netflow.system', true), '') IS NOT NULL OR "org_id" = nullif(current_setting('netflow.org_id', true), ''));

CREATE POLICY update_access ON netflow."webhook_idempotencies" FOR UPDATE USING (nullif(current_setting('netflow.system', true), '') IS NOT NULL OR "org_id" = nullif(current_setting('netflow.org_id', true), '')) WITH CHECK (nullif(current_setting('netflow.system', true), '') IS NOT NULL OR "org_id" = nullif(current_setting('netflow.org_id', true), ''));

CREATE POLICY delete_access ON netflow."webhook_idempotencies" FOR DELETE USING (nullif(current_setting('netflow.system', true), '') IS NOT NULL OR "org_id" = nullif(current_setting('netflow.org_id', true), '')) ;

ALTER TABLE netflow_private.outbox ENABLE ROW LEVEL SECURITY;

ALTER TABLE netflow_private.outbox FORCE ROW LEVEL SECURITY;

CREATE POLICY outbox_access ON netflow_private.outbox USING (nullif(current_setting('netflow.system', true), '') IS NOT NULL OR tenant_id = nullif(current_setting('netflow.org_id', true), '')) WITH CHECK (nullif(current_setting('netflow.system', true), '') IS NOT NULL OR tenant_id = nullif(current_setting('netflow.org_id', true), ''));

REVOKE ALL ON ALL TABLES IN SCHEMA netflow, netflow_private, netflow_migration FROM PUBLIC;
