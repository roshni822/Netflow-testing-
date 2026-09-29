# Phases 1-4 verification - updated 28 September 2026

The foundation, organization provisioning and tenant authentication/business routing are verified on disposable local PostgreSQL 18 clusters, using the real Express API and existing password/MFA helpers. Browser and configured-database evidence is recorded separately below. This report is not production deployment approval or evidence of a live Supabase test.

## Completed checks

| Area | Verified result |
| --- | --- |
| Fresh target | Existing application tables, schemas and custom types are rejected without deletion. |
| Baseline | Exactly 9 platform tables and 6 system tables; SQL/permission checksums and table manifest verified. |
| Repeat setup | Schema retry is a no-op; changed checksums fail. Identical bootstrap identity never changes its password; a conflicting identity fails. |
| Initial state | One new platform administrator, role and five application plan presets; zero customer organizations and tenant schemas before deliberate test fixtures. |
| Account placement | Platform administrator has no organization; directory entry is platform-scoped with a null organization. No default/platform organization is created. |
| Tenant template | Two intentional fixture schemas each contain all 33 expected tables. Fixed ownership, references, required fields, indexes and forced RLS are applied. |
| Naming | Normalized readable names, invalid/overlong names, name collisions and immutable stored placement checked. |
| Relationships | Another tenant's admin cannot be assigned to an organization; directory/profile drift fails; authorized platform actors are allowed while other-tenant actors are rejected. |
| Runtime privileges | Runtime cannot create schemas, alter/drop/truncate tenant tables or grant public access. No-context and wrong-tenant reads are empty. A service context does not bypass tenant policies. |
| Transactions/pooling | Nested scope changes fail; interleaved tenant transactions and connection reuse preserve isolation. Profile/directory updates roll back together. |
| Login | Real password verification, explicit platform/tenant JWT scopes, tenant organization claims and platform/tenant `me` APIs pass. Platform accounts retain no organization. |
| Scope separation | Missing and ambiguous email lookups return the same generic 401 response, without account choices. Explicit login links supply context. Workspace login cannot select a platform account. Old unscoped/mismatched tokens are rejected. |
| MFA and sessions | Enrollment, backup-code login, backup-code replay rejection, disable, single-device logout and token revocation pass. Challenges cannot act as sessions. |
| Passwords | Password change revokes earlier sessions; reset routes are updated atomically; reset-token replay fails; five wrong passwords lock the account. |
| Phase boundary | Organization provisioning, tenant login and authenticated core business routes are enabled. Public/file/SSO and worker routing remain gated; readiness stays 503 with phase 3. |
| Existing deployment | The shared-layout PostgreSQL suite passes repository, API, tenant creation, reports, forms, workflows, tasks, permissions, files, audits and tenant backup/deletion checks. |

Commands run from `server/`:

```powershell
npm run test:postgres:schemas
npm run test:postgres
npm run test:security
```

The security suite includes 10 passing tests covering existing sessions, new platform scope checks, file authorization, Microsoft callback session compatibility, production configuration, outbound-request protection and SSO nonce validation. Source syntax and whitespace checks for the affected tracked backend files passed. Historical SQL baseline files remain unchanged and the existing regression suite verifies its generated baseline against the historical file.

The Windows sandbox initially prevented the temporary PostgreSQL service from starting. The successful runs used the same isolated test harness outside that sandbox, with generated temporary credentials. No configured application connection or `.env` was used. Deliberate fixture users/organizations were confined to temporary clusters. No real email, webhook or storage integration was called.

## Phase 2 acceptance evidence

- Restricted runtime creates `tenant_<normalized_name>` with all 33 tables, six existing default roles, required departments/usage defaults and one initial organization admin. The password is bcrypt-hashed; must-change-password and selected builder/seat settings are preserved. No forms, tasks or other business records are fabricated.
- Same-key replay preserves the organization/admin/password hash. The replay returns no plaintext password. A changed payload with the same key, normalized-name collisions and subdomain collisions are rejected.
- Concurrent same-key requests create one organization and issue credentials to only the successful first response. Concurrent name collisions have one winner.
- Invalid seed ownership, mandatory audit failure and a deferred constraint-trigger failure roll back schema, roles, admin and directory writes. Only a pending/failed reservation remains. The failed reservation can be retried with the original identity; a pre-existing unrelated schema is neither adopted nor deleted.
- A simulated process interruption after reservation resumes using the same request. Operation status is restricted to its originating platform admin and exposes no payload or credentials.
- Explicit admin password recovery changes the hash, forces a password change, clears session/reset state and appends an audit. Ordinary replays never perform that reset.
- A separate disposable database initialized with only Phase 1 upgrades to Phase 3 by applying two additive migrations. Existing plan data and all three baseline checksums remain unchanged; repeating setup is a no-op.
- The focused Phase 2 suite also verifies the frozen SQL against its reviewed source, all four privileged functions' fixed `pg_catalog, pg_temp` search paths, no PUBLIC execution, a NOLOGIN/non-superuser owner and runtime rejection of owner-role switching or direct DDL.
- The real HTTP API verifies authorization, required idempotency UUID, 201 creation, 200 replay, 409 payload conflicts, operation status, organization search/pagination and credential recovery.
- The real browser form commits a creation, deliberately loses the response, then retries with identical UUID/address/payload. It shows the existing organization without revealing a password. Desktop and mobile list visibility and absence of JavaScript runtime errors are checked.
- Frontend lint and the production frontend build pass. The existing large-bundle warning remains; no unrelated bundle redesign was included.

The optional browser run requires a current frontend build and installed Chrome:

```powershell
# frontend/
npx vite build
# server/
$env:NETFLOW_SCHEMA_BROWSER_TEST='1'
npm run test:postgres:schemas
npm run test:postgres:provisioning
```

Fixtures exist only in disposable clusters or the separate temporary browser-debug fixture server. Browser API requests are pinned to the isolated API; no configured development/production connection, real email or hosted integration is used. Initial browser-test failures were corrected test-server/selector/required-fixture-field issues; the complete browser acceptance run passed.

Observed first-creation time in one complete Windows development run was 5.3 seconds; an earlier run under heavier local load took 28.4 seconds. These are development measurements, not production capacity or latency guarantees. Staging must measure the final tenant volume, storage provider and request/proxy budget before choosing synchronous provisioning for release.

## Phase 3 acceptance evidence

- Tenant temporary-password login, forced password change, product-tour profile update, scoped JWT/session validation, MFA enrollment/backup-code consumption, reset routing, suspension and logout pass through the HTTP API. A signed claim pointing an account at another organization is rejected. Duplicate email across workspaces requires explicit context.
- Users, roles, departments, organization settings, forms, workflows, tasks, notifications, audit, analytics, team and usage reads succeed with restricted runtime credentials. Form create/publish/draft/submit and synchronous workflow approval create their related records in the same schema. Cross-tenant form/workflow reads and approval attempts return 404.
- A new department survives organization profile updates and submission usage writes, and tenant user creation can use it. User creation/deactivation keeps the protected directory synchronized. Lazy query execution is explicitly awaited inside the verified placement so middleware sees tenant-owned organization children.
- Organization display-name changes preserve the stored schema name. A generic tenant update cannot change protected plan fields. Root/child mappings are built per scope; pooled connections and nested-context rejection retain isolation.
- Login failure counters commit on rejected passwords, preserving lockout. Serialized reset/MFA writes reject consumed tokens and backup codes. Repository reset-token changes and routing digests share a transaction.
- Workflow hop state remains transient and is not written into customer records. Approval execution, task status, tenant audit rows and pending business outbox intents are checked. Delivery workers remain disabled.
- Public-form publishing and file-reference entry points remain explicit phase gates. Authentication is still owned by the existing backend; no Supabase Auth or direct frontend database access is introduced.
- Built-frontend Chrome checks pass for email/password-only login, generic ambiguous-email feedback, organization-link routing, email-only recovery and the actual tenant forms list. No account/workspace selector appears before or after an error. An old browser-stored workspace cannot silently route the login, and recovery/back links retain the current explicit context. The mobile login fits a 390px viewport; the desktop forms screen shows the isolated fixture's stored form/submission totals. Screenshots were visually reviewed after suppressing only the fixture's already-completed browser onboarding guide. No JavaScript runtime errors were observed. [Desktop login](../../../output/verification/phase-3-login-desktop.png), [mobile login](../../../output/verification/phase-3-login-mobile.png), [tenant forms](../../../output/verification/phase-3-tenant-forms.png).
- The shared-layout PostgreSQL regression suite was rerun after the Phase 3 changes and passed, including document access, reports, task APIs and tenant backup/export/deletion checks. All 10 security tests, focused frontend lint, the frontend build and 25 affected backend/test syntax checks pass. The pre-existing frontend bundle-size warning remains.

## Configured local development database

The 28 September login simplification changed application code only; no configured database, account, credential or schema was changed. Its HTTP and browser checks used a disposable database. The local upgrade evidence below is from 25 September.

After the isolated Phase 3 API/browser, provisioning/permission and shared-layout regression checks passed, migration `003-routing` was applied to the independently checked development target: local PostgreSQL on port 5433, database `Netflow`. Exactly one missing migration was applied; the prior Phase 1/2 history was preserved. Counts before/after remain one platform administrator, zero organizations and zero provisioning operations. The complete existing administrator-authentication rows were fingerprinted internally and remained unchanged; no credential values or fingerprints were printed or copied into this report.

The restricted runtime connection passed version/checksum and privilege validation for release `organization-schemas-phase-3`. No fixture customer, tenant schema, replacement administrator or sample business data was created in this database. Phase 3 did not change `.env`, connection credentials or signing keys. The `PROVISIONING_FINGERPRINT_KEY` configured in Phase 2 remains in use. Restart existing API processes to load the updated code; do not bootstrap again.

A temporary API process against this development database passed `/api/health` (200), the intentional phase-3 readiness gate (503 with `phase: 3`), and anonymous organization-access rejection (401). The probe was stopped afterward and created no customer records. Disposable test clusters created during this Phase 3 verification were also stopped and removed; unrelated pre-existing temporary directories were left alone.

## Phase 4: external entry points and workers (28 September 2026)

The following checks passed with a disposable PostgreSQL 18 cluster and real HTTP API. Test tenants, account credentials and synthetic upload bytes were confined to the temporary cluster/upload root. External email/callback delivery used a test sink; no real provider credentials or messages were used.

| Area | Verified result |
| --- | --- |
| Public resources | Published form lookup and anonymous submission route to the owning schema; another tenant remains empty. Disable/delete revokes routing. Token/document changes roll back together. |
| Webhooks | Missing signature rejected; valid signature creates one tenant execution. Replayed idempotency key returns that same execution. Status lookup resolves its tenant; rotated webhook tokens fail. |
| Files | Upload creates tenant-local grant; signed download succeeds; anonymous/bearer cross-tenant requests fail; revoked capability fails. Injected cross-tenant storage references are rejected. |
| Document jobs | Both extraction and document-to-form staging return their existing job response contract. Other tenants/public contexts cannot read authenticated jobs. Concurrent claims are exclusive, stale attempts cannot overwrite a newer attempt, and expired local sources/metadata are cleaned. Retained extraction records block permanent form deletion without discarding the source. |
| Workers | Enumeration visits ready active tenants only; scoped repositories return that tenant's users. Usage/retention/timer sweeps run under verified placement. Licence expiry is derived through the constrained worker function. |
| Outbox | Delivery receives its verified tenant context; simulated failure persists for retry; concurrent dispatchers acknowledge the retry once. Suspension leaves pending delivery unclaimed, and reactivation permits dispatch. SMTP/external delivery remains at least once, not exactly once. |
| Microsoft identity | Explicit Microsoft tenant/object pairs route to the correct existing tenant or platform account. Unknown identity or wrong Microsoft tenant never executes the account callback. Existing session/nonce security checks pass. |
| Upgrades | Phase 1 baseline upgrades additively without changing its existing plan/checksums. A Phase 3 database with existing tenant tables and public/webhook/status capabilities receives the correct digest routes; repeat setup is a no-op. |
| Regression | Existing shared-layout PostgreSQL API/document/security/export suite passed. All 10 security tests passed. Syntax checks passed for 33 affected JavaScript files. |

The latest completed commands were `npm run test:postgres:schemas`, `npm run test:postgres`, and `npm run test:security`. No frontend source/design changes were made for Phase 4; earlier Phase 3 browser evidence above remains historical, not a claim of Phase 4 provider/UI acceptance. Disposable clusters and the temporary API processes used by these suites were stopped and cleaned by their harnesses.

### Phase 4 local installation

The configured target was independently checked as **development**, local PostgreSQL `127.0.0.1:5433`, database `Netflow`; runtime/setup endpoints matched. Unlike the 25 September snapshot above, it now had one existing organization and one provisioning operation. The outbox was empty.

Exactly one migration, `004-integrations`, was applied. Internal before/after fingerprints across all **42 existing platform/tenant tables** matched, including administrator and tenant authentication rows. Counts remained one platform administrator and one organization. No account, customer fixture, credential or application data was replaced. The protected `.env` was unchanged. Restricted runtime version/checksum/privilege validation passed for release `organization-schemas-phase-4`.

A temporary API probe with `PAUSE_BACKGROUND_JOBS=1` returned health 200, connected database, the intentional readiness 503 with `phase: 4`, and 401 for anonymous organization access. No jobs were registered in this probe; it was then stopped. Restart the normal backend to load the release. Do not bootstrap/recreate the database.

The new licence function fixes its search path and revokes public execution, following the [PostgreSQL SECURITY DEFINER guidance](https://www.postgresql.org/docs/18/sql-createfunction.html#SQL-CREATEFUNCTION-SECURITY). It derives expiry from stored dates and can mark notification flags; it cannot renew dates or change plans/limits.

## Remaining release work after Phase 4 (historical)

At the end of Phase 4, platform organization lifecycle/aggregate reporting, tenant export/restore, and staging/load/recovery acceptance remained pending. Phase 5 evidence follows below. Real SMTP, S3/DMS, OCR/LLM output quality and Microsoft Entra login/conditional-access acceptance remain unverified; the isolated tests validate routing, storage and delivery state. Exercise full frontend journeys with those configured staging integrations before release.

No production deployment or customer traffic cutover is part of Phases 1-4. Full production rollout remains pending.

## Phase 5: organization management and isolated recovery (28 September 2026)

The following evidence uses disposable PostgreSQL clusters, test upload directories and synthetic fixtures only. No fixture organization/user was inserted into the configured development database. Providers and outgoing messages were not exercised against real accounts.

| Area | Verified result |
| --- | --- |
| Management | Existing HTTP contracts edit name/billing/domains/settings, assign an existing plan, change licence dates/billing anchor, and grant/revoke storage. Plan changes preserve submission counts. Organization rename keeps its original schema. |
| Permissions/concurrency | Tenant callers cannot use platform operations; authentication service context cannot invoke the management function. Direct placement patches fail. Stale edits fail. An injected audit-write failure rolls back the organization change. |
| Suspension | Existing sessions cannot access a suspended tenant; SuperAdmin can still view/edit its settings and usage. Reactivation restores ordinary tenant access. Destructive tenant deletion stays gated. |
| Credentials | Disabled S3 configuration can be saved without contacting a provider. Management responses mask credentials; saving the masked response preserves the stored values. |
| Reporting | Overview, history, health and tenant usage return through the organization-schema paths. Active usage queries roll billing periods within verified tenant context. |
| Browser | Existing desktop organization edit, suspend and reactivate controls passed in headless Chrome. Creation/retry/replay, mobile organization list, email/password-only login, generic ambiguous-account behavior and explicit-link tenant forms also passed. |
| Recovery | Captured all 33 tenant tables plus 12 shared dependency table groups. Exact row values/counts/checksums, foreign keys and local file bytes verified after import into another empty database. The source snapshot and another tenant's users remained unchanged. |
| Recovery guards | Wrong passphrase, altered row/file data and cross-tenant ownership rejected. Source database and nonempty restore targets rejected. Restored sessions are removed; tenant stays suspended; unsent outbox rows are held; platform passwords/MFA/sessions excluded. |
| Customer package | 27 business tables and optional document bytes, with manifest and declared omissions/redactions. Tenant password hashes, sessions, MFA/integration tables, and webhook secrets are absent. |
| Upgrades/regression | Additive upgrades from Phase 1 and Phase 3 preserve installed checksums/data and are repeatable no-ops. Shared-layout PostgreSQL API/document/auth/export regression passed; all 10 security tests passed. |

Completed commands: `npm run test:postgres:schemas` (including a run with `NETFLOW_SCHEMA_BROWSER_TEST=1`), `npm run test:postgres`, and `npm run test:security`. Final focused backend/test syntax checks cover 16 JavaScript files. The last schema-suite run added coverage for billing-anchor changes and saved/masked integration credentials after the browser run. No product frontend source or visual design was changed in this phase. Temporary clusters, API processes and browser processes were stopped by their harnesses.

### Local development installation

The target was independently verified as development, `127.0.0.1:5433`, database `Netflow`, target label `netflow`, with separate setup/runtime users pointing to the same database. It contained one existing platform administrator, one organization and an empty outbox.

Exactly one migration, `005-management`, was applied. Internal before/after fingerprints of all **42 existing platform/tenant tables** matched. The existing `.env` was unchanged. No account, password, customer data or schema was replaced or removed. Restricted runtime role and migration checksum validation passed at version `005`.

A temporary API probe with background jobs and DMS disabled returned health 200, readiness 503 with `phase: 5`, and anonymous platform access 401; the probe was stopped. Restart the normal backend to load these changes. Do not bootstrap, recreate or clear the database.

### Limits at the end of Phase 5 (historical)

Use [the Phase 5 operations runbook](RECOVERY.md) for the exact supported commands and maintenance requirements. The recovery tool is an encrypted, bounded-size development/staging rehearsal, not a production tenant-swap command. Local files are restored to a separate upload root; provider bytes are archived and verified without live S3/DMS write-back. Department-specific DMS recovery is explicitly blocked pending its connection-aware adapter. No real provider acceptance, large-tenant/load/RTO measurement, production restore/swap, deployment or cutover was performed.

Existing plan assignment is covered; shared plan-catalogue mutation, platform-admin lifecycle, broadcasts, tenant deletion and platform-wide provider browsing remain gated. Finish those release requirements and staging journeys with SMTP, S3/DMS, OCR/LLM and Microsoft Entra before opening production readiness. Keep the old data and require the separately approved cutover/rollback process.

## Phase 6: platform operations and guarded offboarding (28 September 2026)

The complete Phase 1–6 suite passed with `NETFLOW_SCHEMA_BROWSER_TEST=1` against disposable PostgreSQL databases and a temporary HTTP API. Fixtures, account passwords, upload bytes and mock provider destinations were confined to that environment. No real email, provider write or customer deletion was performed.

| Area | Verified result |
| --- | --- |
| Plans | Create/edit/assign/delete an unused database plan; invalid limits and deletion of assigned/custom plans rejected. An injected audit failure rolls back creation. Organization forms load the catalogue. |
| Platform accounts | Additional administrator is platform-only; password hashed once, login works, deactivation removes sessions, inactive login fails, activation/reset work, old password fails and protected self-deactivation is rejected. |
| Announcements | Global and selected-organization banners coexist. Each tenant receives its matching audience through database policies; tenant callers cannot publish. |
| Storage and DMS routing | Configuration responses exclude credentials. Tenant callers cannot access platform storage views. Protected upload-time bindings are repeatable; ambiguous IDs, changed endpoints and unbound department documents fail closed. Editable attachment metadata does not choose runtime credentials. |
| Archive | Active organizations must first suspend. Archive retains schema/data and blocks tenant access. Restore returns to suspended; activation is explicit. Browser deletion never invokes schema removal. |
| Recovery | 33 tenant tables plus 13 shared dependency groups captured. Encrypted import verifies exact records, relationships and files; source/other tenant stay unchanged. Provider readback mismatch blocks relinking, retry reuses uploaded objects and replay is repeatable. JSONB numeric precision is preserved. |
| Offboarding | Verified isolated restore, explicit organization confirmation, expired retention and unchanged records/files required. Drift or an external schema dependency prevents removal atomically. Registry/audit/identity tombstones and physical files remain. Post-purge directory consistency is checked. Only disposable archived fixtures were removed. |
| Browser | Organization storage selector, archive/restore, announcement publish and plan creation/confirmed removal pass. Existing creation/retry, organization edit/suspend/reactivate, mobile list, email/password-only login/recovery and tenant forms pass without JavaScript runtime errors. |
| Upgrades | Phase 1 and Phase 3 installations upgrade additively to Phase 6, preserving existing data/checksums; repeated setup is a no-op. Runtime retains restricted DDL privileges. |

All 10 security tests, focused lint for four affected frontend files and the Vite production build passed. The existing large-bundle warning remains. Screenshots were visually reviewed: [archive](../../../output/verification/phase-6-archive.png), [announcement](../../../output/verification/phase-6-announcement.png), [unused plan removal](../../../output/verification/phase-6-plan-removal.png).

The shared-layout `npm run test:postgres` regression also passed: repositories, permissions, authentication/MFA, APIs, documents, audit retention and isolated tenant backup/export/deletion. It never connected to MongoDB. Temporary test clusters and APIs were stopped by their harnesses.

### Phase 6 local development installation

The protected configuration was independently verified as development, local PostgreSQL on port 5433, database `Netflow`, target `netflow`. Separate runtime/setup users pointed to the same database. The target contained one existing organization, one platform administrator and no processing outbox deliveries.

Exactly one migration, `006-operations`, was applied. Internal comparisons of all original columns/records across **47 existing tables** (42 platform/tenant plus five operational tables, excluding the migration ledger) matched before and after. The new broadcast column and `system.tenant_lifecycle` are additive. Existing accounts, authentication data and customer records were preserved; `.env` was unchanged. Restricted runtime privilege/checksum validation passed for version `006`.

A temporary API with background jobs and DMS disabled returned health 200, connected database, the intentional readiness 503 with `phase: 6`, zero registered workers and anonymous platform access 401. The probe was stopped. Restart the normal backend to load Phase 6; do not bootstrap or recreate the database.

These checks do not establish live-provider or production acceptance. See [OPERATIONS.md](OPERATIONS.md) for department routing, isolated provider restore and operator offboarding requirements. Phase 7 must exercise intended SMTP, S3/DMS, OCR/LLM and Entra providers, multi-process behavior, load, backup-vault recovery and RPO/RTO. Production deployment/cutover and physical file erasure remain separate decisions. `/api/ready` remains intentionally closed at phase 6.
