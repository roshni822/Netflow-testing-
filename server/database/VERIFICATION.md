# Fresh PostgreSQL verification

Status: **fresh-database preparation and local verification passed**. Supabase
connection details are intentionally blank for the user to configure afterward.
No Supabase project was initialized, no production deployment was switched, and
no existing MongoDB database was read, imported, reset or deleted during this work.
This supersedes the earlier source-data migration rehearsal.

Backend configuration is consolidated in `server/.env`. Existing effective values
were preserved, deployment environment variables retain priority, and the isolated
test bypass remains available. The redundant PostgreSQL-specific env files were removed.
The database section now uses `SETUP_DATABASE_*`, `SETUP_ENV`, `SETUP_TARGET`,
`ADMIN_*` and `PAUSE_BACKGROUND_JOBS`; runtime confirmation fields are
`DATABASE_HOST`, `DATABASE_NAME` and `DATABASE_USER`. Redundant defaults and the
unused MongoDB connection setting were removed from `.env`. Independent target
checks, verified TLS and restricted runtime permissions remain in place.

## Completed verification

Run from `server/`:

~~~powershell
npm run test:postgres
~~~

The suite creates a password-protected disposable local PostgreSQL cluster and a
separate API process. It does not load the application's environment files. All
fixture users, tenants and business records exist only in this temporary test
cluster; the production bootstrap does not create those fixtures. Cron is disabled,
email uses a local capture function, and no real file purge is invoked. The test
cluster is stopped and removed afterward.

| Check | Result |
| --- | --- |
| Fresh schema creation and matching generated SQL | Passed |
| Repeated schema application with checksum verification | Passed |
| Migration archive tables removed; only SQL version metadata retained | Passed |
| Required administrator identity/password validation | Passed |
| Initial system records only; every business table starts empty | Passed |
| Bootstrap retry preserves the existing administrator password | Passed |
| Different bootstrap identity refused on an occupied database | Passed |
| PostgreSQL default with no DATABASE_PROVIDER flag | Passed |
| Mongoose, MongoDB and BSON packages absent from the backend | Passed |
| Context-free tenant/private reads denied by RLS | Passed |
| Repository projections, population, filtering, sorting and pagination | Passed |
| Nested/array relations, unsaved reference changes and child timestamp defaults | Passed |
| Nested required fields, enums and numeric bounds validated by Ajv | Passed |
| Analytics grouping, facets and report joins | Passed |
| Concurrent increments, stale-save rejection and transaction rollback | Passed |
| Outbox commit/rollback and deduplication with local capture | Passed |
| New invalid references rejected | Passed |
| Bcrypt hashing and secret-field serialization | Passed |
| Actual password login and session-authenticated /auth/me | Passed |
| MFA setup, TOTP login and rejection of reused backup codes over HTTP | Passed |
| Password-reset hashing, account locks and secret-field redaction | Passed |
| Tenant/platform API permissions and dashboard/report feeds | Passed |
| Forms, workflows, tasks, users, roles, departments, audits and notifications APIs | Passed |
| Form draft upsert/read and product-tour completion | Passed |
| Tenant export, atomic deletion/rollback and other-tenant preservation | Passed |

The password-login check exposed and fixed a projection bug: selecting normally
hidden login fields with `+field` had accidentally excluded ordinary user fields
during hydration. The regression check now verifies both field selection and an
actual password-based HTTP sign-in.

Additional checks include JavaScript syntax verification, document generation,
evidence-batch and PDF autofill regressions. Git whitespace checks pass,
npm command targets exist, the lockfile matches declared dependencies,
and the private configuration file is ignored by Git. The schema setup command
rejects the currently blank connection configuration before connecting.

## Cleanup and retained dependencies

Removed the MongoDB source snapshot/import implementation and CLI, its real-data
migration test, old MongoDB migration/backup/maintenance scripts, demo/account seed
scripts and the empty seeds folder. MongoDB-specific standalone checks were replaced
by the fresh PostgreSQL suite. The shared API test harness now requires an explicitly
configured isolated PostgreSQL test deployment and cannot run cleanup if its
connection guard fails.

The backend no longer connects to MongoDB or falls back to it. Mongoose, MongoDB
and BSON dependencies and the old tenant-scope plugin have been removed.
Ajv validates database-independent model definitions; the PostgreSQL repository
provides record persistence, change tracking and related-record loading. Bcrypt,
password-reset and MFA helpers, string IDs and secret-field serialization remain.
Models, current file-storage integrations and the frontend are retained. Existing database storage, uploads and
backups on the machine were not erased. PostgreSQL/provider backups and separate
file-storage backups must be configured for the new deployment.

## Remaining work after Supabase configuration

- Apply the schema, provision the restricted runtime login and bootstrap the actual
  administrator using [the setup guide](README.md).
- Verify Supabase network connectivity, verified TLS, role permissions and private
  schema exposure in the configured project.
- Complete browser workflow, approval, report/export, upload/download, MFA/reset,
  Microsoft SSO, SMTP, S3/DMS, OCR/AI, worker, scheduler and webhook checks using
  approved staging services. Local API checks are not full browser/integration QA.
- Enable scheduled jobs only after staging acceptance and integration configuration.
  Test database and file-storage restore before production release.

The larger API/browser test catalog was not executed in this preparation. Use an
isolated test deployment with the explicit safeguards described in the setup guide.
