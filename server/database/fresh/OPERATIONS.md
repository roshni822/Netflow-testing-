# Phase 6 operations

This release keeps the existing Express backend, authentication and schema-per-organization layout. Apply additive migration `006-operations` using the existing setup command; do not rerun bootstrap or recreate the database. Production readiness remains closed at phase 6 until staging acceptance and a separately approved cutover.

## Platform screens

- **Plans:** create/edit catalogue entries; only unused plans can be removed. `custom` remains protected. Organization forms load the database catalogue. Existing negotiated organization limits are preserved until an explicit plan/limit update. Plan feature entitlements are resolved in the tenant's request context, so another API process does not need a restart after an edit.
- **Platform administrators:** create additional platform-only accounts, reset passwords, activate/deactivate. Passwords are hashed once, temporary credentials are shown once, and resets require a password change. Reset/deactivation revokes sessions. The protected administrator, your own account and the last active administrator cannot be deactivated. MFA is retained during password resets. No tenant schema is created for a platform administrator.
- **Dashboard announcements:** an expiring in-app banner for selected organizations or all organizations. The latest matching live banner wins; publishing to one organization does not remove another organization's banner. Tenant database policies filter the audience. No email is sent by this feature.
- **Organization details → Organization documents:** explicitly choose that organization's S3 or DMS/department connection. S3 browsing is limited to the organization prefix; DMS browsing shows application-linked document IDs only. Each page reports its own listed bytes; it does not claim to be the provider's total usage. The application usage meter is displayed separately. Provider credentials and signed links are excluded.
- **Archive:** suspend first, then select Archive organization, enter a retention period/reason and confirm the name. Archiving keeps the schema/data and blocks routing. Restore archive returns the organization to suspended; activation is a separate action. No browser action permanently deletes a tenant.

Plan/admin changes and their audit entries commit together. The runtime login still has no schema creation/deletion capability. Schema names remain immutable.

## Department DMS backups

The normal encrypted backup command now resolves document connections using protected upload-time `system.resource_routes` bindings (`document_connection`). New upload/staging references also retain readable department metadata, but editable attachment fields never select runtime credentials. Conflicting document-ID bindings or a changed endpoint fail closed. Legacy unlabelled IDs in an organization with department connections require an explicit protected JSON map:

```json
{"dms:existing-document-id": "Finance", "dms:another-existing-id": ""}
```

An empty department selects the organization connection. Supply the file using `--dms-map <path>` to `backup`. The file contains routing identifiers only, not credentials. Conflicting references to the same document ID on different connections fail with `DMS_DOCUMENT_CONNECTION_AMBIGUOUS`; reconcile the ambiguous source records before retrying. The tool never probes unrelated providers to guess ownership. Missing records/files are failures, never silently skipped.

Backups contain credentials and business data: retain encryption, restrictive filesystem/vault access and the separate passphrase. Existing `.env`/secret injection is used; there is no additional environment file. Bundle releases are checksum-bound: retain the matching application release to restore older backups. Capture a new backup after upgrades.

## Restore remote files in isolation

First use `db:tenant restore-verify` as described in [RECOVERY.md](RECOVERY.md). Keep the resulting restore directory and report. The restored database must be named `netflow_restore_*`, contain only this suspended organization, and differ from the source database.

Prepare a protected operator JSON file containing `isolated: true` and `integrations` with the existing application S3/DMS configuration shape. Include only intended isolated destination providers. S3 requires a different bucket; DMS requires different server origins from every source DMS connection. Credentials go in that protected file, never command arguments, documentation or chat. The operator must confirm the destination account is isolated; hostname/bucket guards cannot establish account ownership by themselves.

```powershell
npm run db:tenant -- restore-providers --target netflow --in <encrypted-backup> --database netflow_restore_trial --files <restore-directory> --provider-config <protected-config.json>
```

Each object has a stable retry reference. S3 uses conditional creation; DMS requires its existing external-reference lookup/upload API. Every upload is downloaded and SHA-256 verified before SQL references change. `provider-recovery.json` records progress; retry with the same backup, destination and directory. Do not delete the journal to force a retry. An interrupted operation retains diagnostic objects and files; it does not delete existing provider data. An upload timeout remains dependent on the provider's external-reference idempotency behavior and must be covered in staging acceptance.

Relinking updates known document IDs/keys, nested JSONB references and file grants inside the isolated tenant. JSONB numbers remain PostgreSQL numeric. Old signed URLs on remapped document objects are cleared for regeneration. Audit history remains immutable. Destination credentials replace source integration settings. The tenant stays suspended, revoked sessions remain revoked and held deliveries are not replayed. This command performs no production swap or activation.

## Verified offboarding

These operator commands are restricted to `SETUP_ENV=development|staging`. A production deletion workflow and retention policy require the later production acceptance/cutover process.

1. Suspend and archive with an explicit retention period. Stop/drain writers and provider uploads.
2. Take an encrypted backup with `--writers-stopped`, including all referenced file bytes.
3. Restore into an empty isolated database/directory using `restore-verify` plus `--record-offboarding`. The operator records the successful exact-row/file restore proof against the source archive. A copied/unverified report alone is insufficient for the CLI workflow.
4. After retention expires, use the exact backup and explicitly confirm the organization ID:

```powershell
npm run db:tenant -- purge-archive --target netflow --in <encrypted-backup> --confirm-org <organization-id> --writers-stopped
```

The command recaptures and compares the current records/files with the verified snapshot, checks the encrypted backup digest and restore proof, and obtains the organization maintenance lock. Drift requires a new backup and rehearsal. It drops the tenant's known tables/schema with **RESTRICT**, so external dependencies abort the transaction. Registry/audit history and identity tombstones remain; routing/SSO links are removed and queued payloads cleared. It cannot delete the platform schema or an arbitrary named schema.

**Backups, local files and S3/DMS objects are retained.** Their eventual physical erasure is a separate retention/approval operation; no automatic provider/file deletion is hidden inside schema removal. This is intentional recovery protection, not a claim that all retained personal data has been erased.

## Phase 7 acceptance

Run the complete staging journeys with actual tenant data and intended SMTP, S3/DMS, OCR/LLM and Entra providers. Verify provider timeout/idempotency behavior, multi-process plan changes, isolation/concurrency, backup-vault restore, retention policy, RPO/RTO, load and monitoring. Finish the approved recovery/cutover/rollback runbook before enabling production readiness. Isolated fixture tests do not establish live provider or production acceptance.
