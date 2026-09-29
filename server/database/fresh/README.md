# Organization schemas - Phases 1-5

This is the fresh-database implementation of the approved [blueprint](../../../output/architecture/netflow-schema-per-organization-blueprint.md).
The existing deployment continues to use its current database layout unless explicitly configured otherwise.

## Delivered foundation

- A separate versioned baseline: nine `platform` tables and six `system` tables.
- One platform SuperAdmin, with no organization, tenant schema or customer records.
- Five existing application plan presets, including `custom`, seeded before any organization can reference them.
- Reusable [33-table tenant template](tenant/001_template.sql) with local relationships, fixed organization checks and forced row-level security. Phase 2 exposes it through the authenticated organization-creation API and a narrow database function.
- Existing account model/password/MFA helpers and authentication routes reused through a platform storage adapter. Platform JWTs explicitly carry `scope=platform` and no organization claim.
- Platform login, MFA, password change/reset, logout and session revocation. Shared minimal directory entries and password-reset routes are maintained transactionally.
- Explicit ambiguity handling: bare email lookup succeeds only for one account. `accountScope: "platform"` selects platform login; a workspace never falls through to a platform account.
- Restricted runtime access; no runtime schema creation, table ownership, superuser or `BYPASSRLS` privileges.

The new layout is **not a complete production release yet**. Phases 1–6 implement tenant provisioning/routing, platform management, reporting, encrypted recovery, provider restore tooling and guarded offboarding. `/api/ready` intentionally returns 503 with `phase: 6`. Workers run unless `PAUSE_BACKGROUND_JOBS=1`; provider feature/configuration gates still apply. Phase 7 staging/provider/load/recovery acceptance and separately approved production cutover remain pending. The old shared layout remains supported. See [recovery](RECOVERY.md) and [Phase 6 operations](OPERATIONS.md) for commands and limits.

## Inspect the SQL

From `server/`:

```powershell
npm run db:fresh -- schema-preview
```

The baseline is [001_platform.sql](migrations/001_platform.sql) and [001_system.sql](migrations/001_system.sql). Historical `database/migrations/001_initial.sql` and `002_release_controls.sql` are not edited or applied by this setup. After release, upgrade with a new versioned migration; never regenerate applied historical files.

Application-facing field names and 24-character IDs remain compatible with the existing repositories. `legacy_extra`, `legacy_refs`, `source_missing`, `api_version` and `row_version` are compatibility/change-tracking columns, not imported old data. Platform profile fields are retained for API compatibility, but `admin_users` and `admin_roles` have no `org_id` column. Tenant tables keep organization IDs as an additional integrity check.

## Prepare a new development database

Use the existing single protected `server/.env` or your approved server-side secret mechanism. Never paste credentials into documentation, SQL preview output, frontend configuration or chat.

Required existing setup settings: `SETUP_ENV`, `SETUP_TARGET`, `SETUP_DATABASE_URL`, `SETUP_DATABASE_HOST`, `SETUP_DATABASE_NAME`, `SETUP_DATABASE_USER`. The URL must match the independently confirmed host/database/user. `SETUP_TARGET` must match the explicit command argument. Production setup additionally requires `--confirm-production`.

1. Create a separate, empty application database. Existing application schemas, tables or non-extension functions cause setup to refuse the target; nothing is dropped or reset. Recognized provider infrastructure may remain.
2. Point only the setup settings at that new database. Review the SQL preview.
3. Run the following with your actual configured target label:

   ```powershell
   npm run db:fresh -- schema-apply --target YOUR_TARGET_LABEL
   npm run db:fresh -- check --target YOUR_TARGET_LABEL
   ```

4. Use the database administrator's secure workflow to create a separate restricted LOGIN, then grant it membership in `netflow_app`. The runtime login must not own the database/schemas/tables, inherit an administrative role, or have `CREATE`, `SUPERUSER`, `BYPASSRLS`, `CREATEDB` or `CREATEROLE`. The CLI creates only the permission group; it does not invent or print database passwords.
5. Provide the new real bootstrap identity through protected `ADMIN_NAME`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`, then run:

   ```powershell
   npm run db:fresh -- bootstrap --target YOUR_TARGET_LABEL
   ```

   This uses the setup connection and the existing password policy/hash helper. A retry for the same identity never replaces the password. Conflicting bootstrap identities fail. Bootstrap creates zero customer organizations and tenant schemas. Remove bootstrap credential inputs from the runtime environment when finished.
6. In a separate development deployment, set `DATABASE_URL` to the restricted connection for this same new database and set `DATABASE_LAYOUT=organization-schemas`. Set new deployment secrets using the existing secret workflow. Keep the other application settings in the same configuration file. Start the API normally and verify `/api/auth/login`, `/api/auth/me`, MFA and logout. No frontend database credentials are used.

Do not switch the current production application to this foundation release. A database backup, staging acceptance and the remaining blueprint gates are still required for the final release. No existing MongoDB or PostgreSQL records/files are imported or deleted.

## Security and ownership

`platform` contains administrators, organization registry, plans and platform audit history. `system` contains version history, provisioning operations, minimal account/resource routing, outbox and stable Microsoft identity bindings. Tenant schemas are created only when an organization is deliberately provisioned in Phase 2.

Schema names are validated lowercase ASCII, `tenant_<normalized_name>`, at most 63 bytes. The registry enforces uniqueness; collisions are rejected, not silently suffixed. Organization display-name changes do not rename the schema. No client-supplied SQL or arbitrary schema identifier is executed.

The tenant template enforces its fixed organization on every root/child row, with forced RLS and no blanket `netflow.system` bypass. The runtime has only required DML grants and audit history is append-only. Pooled transaction settings are local to the transaction; nested scope changes fail. Shared profile/directory writes and reset-token routing are committed together.

The backend remains a trusted shared service. Session context/RLS protect against missing or incorrect application scope; they do not isolate customers from a fully compromised runtime credential able to execute arbitrary SQL. Use dedicated credentials/services/databases if that stronger boundary is required.

## Verification

```powershell
npm run test:postgres:schemas
```

The suite creates a disposable local PostgreSQL cluster on port 55439 and isolated HTTP server on port 15550. It never loads `.env` or connects to the configured application database. Deliberate fixture administrators, tenants and business records exist only in that temporary cluster, which is stopped and removed afterward. The local PostgreSQL binary location can be supplied through `NETFLOW_PG_BIN`.

Tests cover target guards, checksums, repeat bootstrap/password preservation, exact table manifests, tenant name collisions, foreign keys/directory consistency, RLS, runtime privilege restrictions, scoped sessions, ambiguous login, MFA backup-code consumption, password reset/change, logout and lockout. Existing shared-layout regression checks remain `npm run test:postgres` and `npm run test:security`.

## Phase 2 setup and creation

Existing installations run the same guarded `schema-apply` command to apply only missing migrations, including [002](migrations/002_provisioning.sql) and [003](migrations/003_tenant_routing.sql). The setup verifies all existing checksums before upgrading; it never rewrites applied files. `check` validates the complete installed release. No customer schemas or accounts are created by this upgrade.

Configure `PROVISIONING_FINGERPRINT_KEY` in the same protected `server/.env`/secret manager: a separate cryptographically random value of at least 32 characters. Keep it stable across API replicas/restarts and include it in protected recovery configuration. Rotation requires resolving existing pending requests first; changing it makes previous request fingerprints incompatible. Do not reuse an admin password or signing key. A missing key blocks creation with `PROVISIONING_KEY_REQUIRED`, without reserving any organization.

The restricted runtime executes fixed functions owned by `netflow_provisioner` (NOLOGIN, no SUPERUSER/BYPASSRLS or administrative role membership). That owner has database CREATE for tenant schemas, necessary shared-table access and ownership of newly created tenant objects. The API has no membership in it and no direct DDL privilege. Deployment requires a migration operator able to create/assign this restricted owner; verify this separately on any managed provider before launch.

The privileged functions use qualified application objects and a fixed `pg_catalog, pg_temp` search path, with temporary objects searched last; PUBLIC execution is revoked in the installation transaction. This follows PostgreSQL's [SECURITY DEFINER guidance](https://www.postgresql.org/docs/current/sql-createfunction.html#SQL-CREATEFUNCTION-SECURITY).

`POST /api/platform/orgs` retains the existing payload and initial 201 response. Supply a fresh UUID in `Idempotency-Key` for each creation intent. The existing frontend does this automatically and retains its UUID/address while the modal stays open. Keep the form unchanged when retrying. Editing its contents starts a new intent; refreshing/closing loses that in-memory intent, so use the operation registry/operator review for an abandoned failed reservation rather than deleting schemas.

1. Validate the organization, licence, email-domain policy and enabled integrations outside the DDL transaction.
2. Commit a reservation with a unique readable schema name, organization ID and UUID operation/key. The operation stores only the keyed fingerprint, actor, status, version/checksum and safe error metadata—no request body or credentials.
3. One transaction creates all 33 tables, local constraints/indexes/RLS/grants, required departments/usage/integrations, six existing default roles, and the initial organization admin. The admin keeps the selected builder/seat settings, receives a bcrypt hash and must change the temporary password. Forms/tasks/customer records are not invented.
4. Verify the table manifest, required runtime grants, local admin and deferred directory constraints; commit schema history, ready status and the mandatory platform audit together.
5. Return the temporary password once after commit. Nothing sends email or other external notifications in this creation flow.

A failed DDL/seed/audit/constraint transaction leaves only the inactive reservation and sanitized failed operation. A process crash leaves a pending reservation; retrying its original request takes the operation lock and checks actual committed state. No automatic deletion or adoption of an existing schema occurs. A retry after commit returns 200 with `credentialsAlreadyIssued: true` and no password. The explicit existing `reset-admin-password` action issues new credentials, revokes sessions/reset tokens and writes an audit atomically.

Concurrent matching requests return the existing result or 202 `PROVISIONING_IN_PROGRESS`. `GET /api/platform/provisioning/:operationId` exposes sanitized status only to the initiating authorized platform admin. Same-key/different-payload and schema/subdomain conflicts return 409. Pending/failed reservations are labelled as setup states in the organization list, never Active.

Provisioning currently runs synchronously with bounded lock waits and the configured PostgreSQL statement timeout. Measure it on staging before selecting the production request/proxy budget; if creation exceeds that budget, move this same durable operation to an authenticated dispatcher before rollout. The development result is not a production latency guarantee.

The optional real-browser suite runs against a disposable API/database. Build the frontend first (`npx vite build` from `frontend/`); installed Chrome is required:

```powershell
$env:NETFLOW_SCHEMA_BROWSER_TEST='1'
npm run test:postgres:schemas
```

## Phase 3: tenant sign-in and business routing

Run from `server/`, using the existing protected connection settings:

```powershell
npm run db:fresh -- schema-apply --target netflow
npm run db:fresh -- check --target netflow
```

Restart the backend after the upgrade. Do not bootstrap again or recreate the database. Migration `003-routing` adds only restricted shared-table policies/column grants and outbox enqueue permissions; the 001 tenant template and applied provisioning function stay unchanged.

- Login shows only email and password; recovery shows only email. A unique email is routed automatically. Multiple matches return the same `401 INVALID_CREDENTIALS` response as no match, with no account/workspace selector or account-count disclosure. Use an administrator-provided organization login link (`/login?org=<subdomain>` or the organization hostname), or the platform link `/login?accountScope=platform`, when explicit context is needed. Recovery/back links preserve that context. Old browser-stored workspace values are ignored. These link parameters identify a target, never grant permissions; the backend still verifies the password, account scope and organization.
- Signed tenant sessions and MFA challenges include tenant scope and organization ID. The protected directory must agree; the registry must be active, ready and have the supported tenant-template checksum before account data is loaded. Unknown, deleted, suspended, incomplete and incompatible placements fail closed.
- Tenant repositories receive an immutable verified placement through async context. Fully qualified root and child tables are selected per request; no schema is cached on shared model definitions. Every transaction rechecks placement and rejects nested scope changes. `skipOrgScope` cannot cross schemas.
- Organization reads compose the shared profile with local departments, usage and integrations. Tenant saves can change approved profile fields and local children, not plan/licence/placement fields. Display-name changes preserve the schema name.
- Existing users, roles, departments, organization settings, forms/drafts/submissions, synchronous workflows/tasks, notifications, tenant analytics/audit and usage APIs retain their contracts. Platform broadcasts are read-only. All customer SQL runs through the backend.
- Tenant password-reset digest routes are maintained by the account repository in the same transaction as credentials; validation checks the actual local token/email/expiry. Direct SQL edits to reset tokens are not an account-recovery API. Login failure counters commit even when a password is rejected; MFA backup-code consumption and reset-token use are serialized.
- Phase 3 persisted business delivery intents and gated external entry points. Phase 4 below enables those paths after its additive migration.

## Phase 4: files, public resources, SSO and workers

Apply the reviewed additive migration with the same `schema-apply` and `check` commands above, then restart the API. Migration `004-integrations` does not recreate any tenant table or change historical checksums. It adds narrowly scoped routing/worker policies, outbox acknowledgement permissions and a constrained licence-reconciliation function. Existing public/webhook/status capabilities are indexed by SHA-256 digest; collisions stop the entire upgrade for review. New tenant creation still uses the unchanged 33-table template.

- Files retain tenant directory/S3 prefixes and organization-specific DMS credentials. Access grants and revocation versions live in the owning tenant schema. Signed local links expire and remain revocable; bearer sessions must match the file's organization. Storage references from another tenant are rejected.
- PDF extraction and document-to-form jobs are staged, polled, retried and cleaned up in the resolved tenant schema. Public extraction access additionally checks its originating form and job token. Retained extraction records prevent permanent form deletion with `409 FORM_DOCUMENTS_RETAINED`; archiving remains available. Cleanup follows existing expiry settings and preserves consumed attachments.
- Public form, webhook and execution-status entry points resolve a protected capability digest before querying business tables. Published/enabled flags, webhook signatures, idempotency, quotas and local token checks remain enforced. Token changes/deletions and registry entries commit together. Direct SQL changes to capability fields are not a supported publishing API.
- Workers enumerate only active, ready registry entries in pages, rotate their starting tenant and verify the current template/placement. SQL remains tenant-scoped; service context never bypasses tenant-table RLS. A suspended/incomplete tenant is skipped. Timer transitions serialize across API instances. Document claims use row locks/skip-locked, renewal and attempt checks to prevent stale workers overwriting retries.
- Email intents in this layout always enter `system.outbox`. Dispatch claims with skip-locked, revalidates tenant placement, renews its lease, and fences acknowledgements by attempt. Failures back off, with a maximum of 12 attempts. Exhausted rows remain for operator review. Delivery is **at least once**: an SMTP/provider timeout after acceptance can produce a duplicate. Callback receivers need idempotency. Suspension pauses tenant delivery without discarding rows.
- Microsoft SSO retains the existing provider/state/nonce validation and NetFlow session system. A setup administrator explicitly binds Microsoft tenant ID + object ID to an existing directory user with `scripts/bindMicrosoftIdentity.js --target <label> --user <id> --tenant <Microsoft-tenant-UUID> --object <Microsoft-object-UUID>`. Protected setup credentials stay in the existing environment. One Microsoft identity maps to one account; there is no email-based auto-link, new account creation or account chooser. Microsoft configuration and a real Entra round-trip require staging acceptance.

Before starting dispatch on an existing development/staging database, inspect pending/failed outbox counts and intended recipients through an authorized operator session. Use `PAUSE_BACKGROUND_JOBS=1` for upgrade/smoke checks when delivery should remain paused. Do not manually clear queues to pass tests.

The isolated suite also sets a temporary upload root and replaces external delivery with an in-process test sink. It verifies SQL/API behavior, not live SMTP, S3, DMS, OCR/LLM quality or Microsoft consent/conditional-access configuration. Run those provider checks with the real staging integrations before release.

## Next phase

Phase 5 organization lifecycle, aggregate reporting and operator export/recovery tooling are implemented with additive `005-management`. This paragraph records the Phase 5 boundary; Phase 6 extends it as documented below. Read [RECOVERY.md](RECOVERY.md) before using backups or isolated restore. Complete the remaining features and full staging/load/recovery/provider acceptance before production cutover.


## Phase 6 operations

Additive `006-operations` adds plan/admin lifecycle, targeted announcements, organization storage browsing, archive/restore controls and verified operator offboarding. System tables now total 7, including `tenant_lifecycle`; each tenant still has the immutable 33-table template. See [OPERATIONS.md](OPERATIONS.md) for scope, provider recovery, retention and Phase 7 acceptance. Run `npm run db:fresh -- schema-apply --target netflow` against the independently verified configured target; never recreate an existing database. Readiness stays 503 with phase 6.
