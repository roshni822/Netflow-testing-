# Fresh PostgreSQL / Supabase setup

For the new **`platform` / `system` / `tenant_<name>` architecture**, use the
[Phases 1-4 setup guide](fresh/README.md). That separate, explicit setup does not
run the historical baseline described below. Provisioning, tenant authentication
and authenticated business routing are implemented. Public/file/SSO routing, workers,
lifecycle/recovery and full production rollout remain pending.

The application now starts with a **fresh PostgreSQL database**. Existing MongoDB
records are not imported. Supabase supplies PostgreSQL behind the existing Express
backend; authentication, API contracts, frontend data access and file integrations
remain in the backend. Supabase Auth and direct browser database access are not used.

PostgreSQL is the only runtime provider. MongoDB connection code, source snapshot
and import tooling, migration archive tables, old MongoDB maintenance scripts and
demo/account seeds have been removed. Mongoose and its MongoDB/BSON dependencies
have also been removed. The `pg` client runs PostgreSQL queries; Ajv validates
the database-independent [model definitions](../models/definitions).
The model modules remain necessary: they provide validation, password hashing,
MFA helpers, serialization and the existing API's 24-character string IDs.
Related-record loading and change tracking are implemented in the PostgreSQL
repository, without a MongoDB client or connection.

## Configure Supabase when ready

All backend settings live in the protected, ignored `server/.env`: application
secrets, integrations, PostgreSQL connections and administrator setup. Database and
administrator fields are prepared for you to configure. No actual Supabase project
has been connected or initialized by this preparation.

For a new checkout, add the following settings to `server/.env` alongside your
existing application settings. Fill in the blank connection and administrator
values using your own project and account:

~~~dotenv
# App database: restricted login
DATABASE_URL=
DATABASE_HOST=
DATABASE_NAME=postgres
DATABASE_USER=

# Database setup: administrator login
SETUP_DATABASE_URL=
SETUP_DATABASE_HOST=
SETUP_DATABASE_NAME=postgres
SETUP_DATABASE_USER=

# Setup checks
SETUP_ENV=development
SETUP_TARGET=netflow-development

# Your first NetFlow administrator
ADMIN_NAME=
ADMIN_EMAIL=
ADMIN_PASSWORD=

# Keep scheduled jobs paused until setup is complete
PAUSE_BACKGROUND_JOBS=1
~~~

The host, name and user fields are independent setup checks, not extra passwords.
Verify them against your chosen project; the setup command refuses a connection
that does not match. The application and setup logins have different permissions,
so their connection strings remain separate.

1. Create a dedicated Supabase development/staging project. Keep `netflow`,
   `netflow_private` and `netflow_migration` outside the exposed Data API schemas.
2. Set `SETUP_DATABASE_URL` to the schema administrator's direct connection.
   Set `SETUP_DATABASE_HOST`, `SETUP_DATABASE_NAME` and
   `SETUP_DATABASE_USER` from independently checked project details. Set
   `SETUP_ENV` and a descriptive `SETUP_TARGET`.
3. From `server/`, inspect and apply the versioned schema:

   ~~~powershell
   npm run db:postgres -- schema-preview
   npm run db:postgres -- schema-apply --target netflow-development
   npm run db:postgres -- provision-runtime --target netflow-development
   ~~~

4. Provision a separate runtime LOGIN through the provider's protected credential
   workflow. It must have neither SUPERUSER nor BYPASSRLS. Grant it membership in
   `netflow_app`. Set `DATABASE_URL` to that login's direct or session-pooler
   connection, and set its independent `DATABASE_HOST`,
   `DATABASE_NAME` and `DATABASE_USER` values. Admin and
   runtime endpoints may differ when a session pooler is used.
5. Set `ADMIN_NAME`, `ADMIN_EMAIL` and `ADMIN_PASSWORD` to the
   actual administrator. The password must be at least 12 characters and at most
   72 UTF-8 bytes. Configure strong `JWT_SECRET` and `FILE_URL_SECRET` for a new
   deployment. Keep these in the same `server/.env` as the database settings.
6. Initialize the administrator and launch the API:

   ~~~powershell
   npm run db:bootstrap -- --target netflow-development
   npm run dev
   ~~~

Use your configured target label in every command. Explicit deployment environment
variables take precedence over `server/.env`. The backend loads only this file.
A missing `DATABASE_URL` fails startup; the
application never silently falls back to MongoDB. These setup commands permit
only development/staging; production provisioning remains a separate release step.

PostgreSQL is already the default. The application also defaults to 10 pooled
connections, a 30-second statement timeout and disabled legacy upload serving;
these settings do not need lines in `.env`.

Remote connections require verified TLS. Only add `PGSSL_CA_FILE` if a trusted
CA bundle is required. Paths are relative to `server/`; absolute paths also work.
The Supabase CA downloaded from the dashboard's official certificate source is
included at `config/certs/supabase-root-2021.crt`. For a connection requiring it, set
`PGSSL_CA_FILE=config/certs/supabase-root-2021.crt`. Certificate and hostname
verification remain enabled. Optional tuning remains available through `PGPOOL_MAX`
and `PG_STATEMENT_TIMEOUT_MS`. Never put credentials in frontend `VITE_*`
settings or commit a populated environment file.

## What initialization creates

Bootstrap runs in one transaction and creates the five built-in subscription-plan
presets, one internal platform organization, one SuperAdmin role and your chosen
administrator. The internal organization is required by authentication and hidden
from customer-organization listings. No customer tenants, forms, workflows,
submissions, tasks, notifications or sample statistics are seeded.

Repeating bootstrap for the same administrator preserves the existing account and
password. A different administrator request against a populated application database
is refused. Schema setup also refuses conflicting schemas/checksums rather than
resetting anything. There is no DROP, TRUNCATE, database reset or old-data import command.

Sign in with your configured credentials, then create your first customer organization
and its administrator through the existing platform interface. Enable jobs only after
staging integration configuration is ready: the prepared file sets `PAUSE_BACKGROUND_JOBS=1`.
Historical flat upload serving is disabled by default; new files use the existing
signed/authenticated file routes. Existing upload files and backups were not deleted.

## Application schema

[001_initial.sql](migrations/001_initial.sql) is generated from the model definitions,
[catalog.js](catalog.js) and [schema.js](schema.js). It contains normalized root/child tables, foreign keys,
checks, unique constraints, query indexes, timestamps and forced tenant RLS.

| Application model | PostgreSQL table |
| --- | --- |
| Plan | plans |
| Organization | organizations |
| Role | roles |
| User | users |
| Form | forms |
| FormDraft | form_drafts |
| FormResponse | form_responses |
| Workflow | workflows |
| WorkflowExecution | workflow_executions |
| Task | tasks |
| Notification | notifications |
| AuditLog | audit_logs |
| PlatformBroadcast | platform_broadcasts |
| DocumentExtractionJob | document_extraction_jobs |
| FormGenerationJob | form_generation_jobs |
| PdfAutoFillLearningProfile | pdf_auto_fill_learning_profiles |
| PdfAutoFillSemanticProfile | pdf_auto_fill_semantic_profiles |
| IntegrationDeadLetter | integration_dead_letters |
| WebhookDeliveryLog | webhook_delivery_logs |
| WebhookIdempotency | webhook_idempotencies |

Owned tables store departments, organization usage and integration configuration,
private user authentication, sessions, MFA backup codes, workflow access/form links,
execution events and task approvals/history. Form definitions, submitted values,
workflow graphs, attachments and execution variables retain their flexible JSONB
shape. File bytes remain in the configured local/S3/DMS storage.

Compatibility fields preserve missing/null semantics and references needed by
historical audit records after ordinary application deletions. These support the
existing API and are not an imported MongoDB dataset. The `netflow_migration`
schema contains only version/checksum metadata for SQL schema evolution.

RLS uses transaction-local tenant context. Auth/public routes, platform operations
and workers use explicit backend service contexts. This assumes a trusted backend
login; never expose SQL credentials to clients. Forms/workflows/tasks/role/department
mutations commit before HTTP success. Email and callbacks inside SQL transactions
use a durable outbox with retries and at-least-once delivery. External services and
file operations cannot be rolled back by PostgreSQL.

## Verification and operations

Run `npm run test:postgres` from `server/`. The dedicated suite creates a new
password-protected local PostgreSQL cluster on port 55439, uses generated fixtures
only inside that disposable database, and runs an isolated API on port 15549. It
never loads the application's environment files, accesses MongoDB or connects to
Supabase. Local email capture prevents production delivery. The cluster is stopped
and removed afterward. PostgreSQL binaries default to
`C:/Program Files/PostgreSQL/18/bin`; override `NETFLOW_PG_BIN` if necessary.

[VERIFICATION.md](VERIFICATION.md) records the completed checks and remaining
staging work. The older API/browser suites require explicit
`NETFLOW_ALLOW_INTEGRATION_TEST_DB=1`, `TEST_DATABASE_URL` and `TEST_API_URL`
for an isolated PostgreSQL deployment; do not point them at production.

Before deployment, test browser workflows, actual SMTP/SSO, S3/DMS uploads/downloads,
OCR/AI processing, job scheduling and webhook delivery with approved staging services.
Configure PostgreSQL/provider backups and verify restore; back up file storage
separately. The removed MongoDB backup script is not a PostgreSQL backup solution.
Use the root `server/` as the backend; the separate historical `frontend/server/`
copy is not the deployed API and was not ported.
