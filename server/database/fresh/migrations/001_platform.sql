CREATE SCHEMA platform;

CREATE SCHEMA system;

REVOKE ALL ON SCHEMA platform, system FROM PUBLIC;

CREATE TABLE "platform"."admin_users" ("name" text NOT NULL,
  "email" text NOT NULL,
  "must_change_password" boolean DEFAULT false,
  "needs_product_tour" boolean DEFAULT false,
  "role_id" text,
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

CREATE TABLE "platform"."admin_auth" (owner_id text NOT NULL REFERENCES "platform"."admin_users"(id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED,
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

CREATE TABLE "platform"."admin_sessions" (owner_id text NOT NULL REFERENCES "platform"."admin_users"(id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED,
  tenant_id text,
  position integer NOT NULL CHECK (position >= 0),
  "session_id" text NOT NULL,
  legacy_extra jsonb NOT NULL DEFAULT '{}',
  legacy_refs jsonb NOT NULL DEFAULT '{}',
  source_missing text[] NOT NULL DEFAULT '{}',
  row_version bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (owner_id,position));

CREATE TABLE "platform"."admin_mfa_backup_codes" (owner_id text NOT NULL REFERENCES "platform"."admin_users"(id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED,
  tenant_id text,
  position integer NOT NULL CHECK (position >= 0),
  "code_hash" text NOT NULL,
  legacy_extra jsonb NOT NULL DEFAULT '{}',
  legacy_refs jsonb NOT NULL DEFAULT '{}',
  source_missing text[] NOT NULL DEFAULT '{}',
  row_version bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (owner_id,position));

CREATE TABLE "platform"."admin_roles" ("name" text NOT NULL,
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

CREATE TABLE "platform"."organizations" ("name" text NOT NULL,
  "subdomain" text NOT NULL,
  "allowed_domains" text[] DEFAULT ARRAY[]::text[],
  "features" jsonb,
  "pdf_auto_fill" jsonb,
  "plan" text DEFAULT 'custom',
  "licence_valid_from" timestamptz,
  "licence_valid_until" timestamptz,
  "licence_trial_ends_at" timestamptz,
  "licence_status" text DEFAULT 'active' CHECK ("licence_status" IN ('active','expired','suspended')),
  "licence_notified" jsonb,
  "billing_email" text DEFAULT '',
  "billing_anchor_day" numeric DEFAULT 1 CHECK ("billing_anchor_day" >= 1) CHECK ("billing_anchor_day" <= 31),
  "limits" jsonb,
  "storage_extension_extra_mb" numeric DEFAULT 0,
  "storage_extension_expires_at" timestamptz,
  "storage_extension_granted_by" text,
  "storage_extension_reason" text DEFAULT '',
  "status" text DEFAULT 'active' CHECK ("status" IN ('active','suspended')),
  "admin_user_id" text,
  "id" text PRIMARY KEY CHECK ("id" ~ '^[0-9a-f]{24}$'),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  api_version bigint,
  legacy_extra jsonb NOT NULL DEFAULT '{}',
  legacy_refs jsonb NOT NULL DEFAULT '{}',
  source_missing text[] NOT NULL DEFAULT '{}',
  row_version bigint NOT NULL DEFAULT 0);

CREATE TABLE "platform"."plans" ("key" text NOT NULL,
  "label" text NOT NULL,
  "trial_days" numeric,
  "limits" jsonb,
  "features" jsonb,
  "is_custom" boolean DEFAULT false,
  "id" text PRIMARY KEY CHECK ("id" ~ '^[0-9a-f]{24}$'),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  api_version bigint,
  legacy_extra jsonb NOT NULL DEFAULT '{}',
  legacy_refs jsonb NOT NULL DEFAULT '{}',
  source_missing text[] NOT NULL DEFAULT '{}',
  row_version bigint NOT NULL DEFAULT 0);

CREATE TABLE "platform"."audit_logs" ("target_org_id" text,
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

CREATE TABLE "platform"."platform_broadcasts" ("message" text NOT NULL CHECK (char_length("message") <= 500),
  "severity" text DEFAULT 'info' CHECK ("severity" IN ('info','warning','critical')),
  "expires_at" timestamptz NOT NULL,
  "created_by" text NOT NULL,
  "superseded_at" timestamptz,
  "id" text PRIMARY KEY CHECK ("id" ~ '^[0-9a-f]{24}$'),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  api_version bigint,
  legacy_extra jsonb NOT NULL DEFAULT '{}',
  legacy_refs jsonb NOT NULL DEFAULT '{}',
  source_missing text[] NOT NULL DEFAULT '{}',
  row_version bigint NOT NULL DEFAULT 0);

ALTER TABLE "platform"."admin_users" ADD CONSTRAINT "admin_users_role_id_fk" FOREIGN KEY ("role_id") REFERENCES "platform"."admin_roles"(id) DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX "admin_users_role_id_idx" ON "platform"."admin_users"("role_id");

ALTER TABLE "platform"."admin_users" ADD CONSTRAINT "admin_users_manager_id_fk" FOREIGN KEY ("manager_id") REFERENCES "platform"."admin_users"(id) DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX "admin_users_manager_id_idx" ON "platform"."admin_users"("manager_id");

ALTER TABLE "platform"."admin_users" ADD CONSTRAINT "admin_users_hr_id_fk" FOREIGN KEY ("hr_id") REFERENCES "platform"."admin_users"(id) DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX "admin_users_hr_id_idx" ON "platform"."admin_users"("hr_id");

ALTER TABLE "platform"."admin_users" ADD CONSTRAINT "admin_users_out_of_office_delegate_id_fk" FOREIGN KEY ("out_of_office_delegate_id") REFERENCES "platform"."admin_users"(id) DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX "admin_users_out_of_office_delegate_id_idx" ON "platform"."admin_users"("out_of_office_delegate_id");

ALTER TABLE "platform"."organizations" ADD CONSTRAINT "organizations_storage_extension_granted_by_fk" FOREIGN KEY ("storage_extension_granted_by") REFERENCES "platform"."admin_users"(id) DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX "organizations_storage_extension_granted_by_idx" ON "platform"."organizations"("storage_extension_granted_by");

CREATE UNIQUE INDEX "organizations_source_0" ON "platform"."organizations"("subdomain" ASC);

CREATE INDEX "organizations_source_1" ON "platform"."organizations"("licence_valid_until" ASC);

CREATE INDEX "organizations_source_2" ON "platform"."organizations"("licence_trial_ends_at" ASC);

CREATE UNIQUE INDEX "plans_source_0" ON "platform"."plans"("key" ASC);

CREATE INDEX "audit_logs_source_0" ON "platform"."audit_logs"("target_org_id" ASC);

CREATE INDEX "audit_logs_source_1" ON "platform"."audit_logs"("created_at" DESC);

CREATE INDEX "audit_logs_source_2" ON "platform"."audit_logs"("action" ASC,"created_at" DESC);

CREATE INDEX "audit_logs_source_3" ON "platform"."audit_logs"("performed_by" ASC,"created_at" DESC);

ALTER TABLE "platform"."platform_broadcasts" ADD CONSTRAINT "platform_broadcasts_created_by_fk" FOREIGN KEY ("created_by") REFERENCES "platform"."admin_users"(id) DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX "platform_broadcasts_created_by_idx" ON "platform"."platform_broadcasts"("created_by");

CREATE INDEX "platform_broadcasts_source_0" ON "platform"."platform_broadcasts"("expires_at" ASC);

CREATE INDEX "platform_broadcasts_source_1" ON "platform"."platform_broadcasts"("superseded_at" ASC,"expires_at" ASC,"created_at" DESC);

ALTER TABLE platform.admin_users ADD COLUMN account_scope text NOT NULL DEFAULT 'platform' CHECK (account_scope='platform'), ADD COLUMN deleted_at timestamptz,
 ADD COLUMN is_bootstrap boolean NOT NULL DEFAULT false;
CREATE UNIQUE INDEX single_bootstrap_admin ON platform.admin_users(is_bootstrap) WHERE is_bootstrap;
ALTER TABLE platform.admin_users ALTER COLUMN role_id SET NOT NULL;
CREATE UNIQUE INDEX admin_users_email_live ON platform.admin_users(lower(btrim(email))) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX admin_roles_name ON platform.admin_roles(name_key);
ALTER TABLE platform.admin_roles ALTER COLUMN name_key SET NOT NULL;
ALTER TABLE platform.admin_users ADD CONSTRAINT admin_email_normalized CHECK (email=lower(btrim(email)) AND email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$');
ALTER TABLE platform.organizations ADD COLUMN schema_name text NOT NULL UNIQUE CHECK (schema_name ~ '^tenant_[a-z0-9]+(_[a-z0-9]+)*$' AND octet_length(schema_name)<=63),
 ADD COLUMN provisioning_status text NOT NULL DEFAULT 'provisioning' CHECK (provisioning_status IN ('provisioning','ready','failed','maintenance','deleting','deleted')),
 ADD COLUMN schema_version text, ADD COLUMN deleted_at timestamptz;
ALTER TABLE platform.organizations ADD CONSTRAINT organizations_plan_fk FOREIGN KEY(plan) REFERENCES platform.plans(key) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE platform.organizations ADD CONSTRAINT organizations_subdomain_format CHECK (subdomain ~ '^([a-z0-9]|[a-z0-9][a-z0-9-]{0,61}[a-z0-9])$');
ALTER TABLE platform.plans ADD CONSTRAINT plans_key_format CHECK (key ~ '^[a-z0-9-]+$');
CREATE UNIQUE INDEX admin_sessions_identity ON platform.admin_sessions(owner_id,session_id);
CREATE UNIQUE INDEX admin_mfa_codes_identity ON platform.admin_mfa_backup_codes(owner_id,code_hash);
ALTER TABLE platform.admin_auth ADD CONSTRAINT admin_token_version_valid CHECK(token_version>=0 AND token_version=trunc(token_version));
ALTER TABLE platform.admin_auth ADD CONSTRAINT admin_password_hash CHECK(password ~ '^\$2[aby]\$[0-9]{2}\$');
ALTER TABLE platform.admin_auth ADD CONSTRAINT admin_auth_no_tenant CHECK(tenant_id IS NULL);
ALTER TABLE platform.admin_sessions ADD CONSTRAINT admin_sessions_no_tenant CHECK(tenant_id IS NULL);
ALTER TABLE platform.admin_mfa_backup_codes ADD CONSTRAINT admin_codes_no_tenant CHECK(tenant_id IS NULL);
