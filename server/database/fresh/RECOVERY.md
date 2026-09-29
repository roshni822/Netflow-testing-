# Tenant export and isolated recovery

Phases 5?6 supply operator tooling for the organization-schema layout. It does not replace full database/PITR backups, and it does not perform a production tenant swap, deletion or activation. Production cutover remains a separate approved operation.

## Organization management

The existing SuperAdmin screen now supports display-name/domain/feature edits, assignment of existing plans, licence dates and limits, temporary storage grants, suspension/reactivation and usage/history/health reporting. Renaming an organization keeps its schema and subdomain stable. Suspended organizations remain visible to platform management; tenant sessions, public links and worker routing remain blocked.

Updates use `system.manage_organization`: active platform-admin verification, an allowlist of mutable fields, an organization lock, optimistic row-version checking and a mandatory audit insert in the same transaction. Runtime still has no schema DDL capability. A failed audit or stale edit rolls back the change. Usage counters are not reset during plan changes. No customer data is created by setup.

Plan **assignment** is covered here. Phase 6 adds the platform operations described in [OPERATIONS.md](OPERATIONS.md); old shared-schema deletion/provider handlers remain disabled for the fresh layout.

## Two different packages

| Package | Contents | Intended recipient |
| --- | --- | --- |
| Encrypted recovery backup | All 33 tenant tables, exact PostgreSQL values, organization/plan, required platform actor profiles/roles, organization audit, directory/SSO/routing, provisioning, outbox and document bytes | Authorized recovery operator only |
| Customer export | 27 business tables, organization metadata and optionally document bytes; credentials, sessions, MFA, integration configuration, internal routing and queues excluded; redactions declared in manifest | Authorized customer recipient |

Recovery does **not** include platform passwords, MFA or sessions. Platform actor profiles are included only to preserve foreign-key dependencies; they cannot sign in to the isolated target. Secrets in the tenant backup are protected with AES-256-GCM and a scrypt-derived key. Keep the passphrase separately from backups and apply restrictive filesystem/backup-vault permissions. `mode: 0600` is not a substitute for Windows ACLs. Customer packages contain personal/business data: use an approved encrypted transfer with recipient authorization and expiry. The CLI does not publish a download URL.

## Prepare a backup

Use the existing `server/.env` (no second environment file):

- Existing `SETUP_DATABASE_URL`, independently verified `SETUP_DATABASE_HOST`, `SETUP_DATABASE_NAME`, `SETUP_DATABASE_USER`, `SETUP_TARGET` and `SETUP_ENV` identify the source.
- Set `TENANT_BACKUP_PASSPHRASE` to a strong secret of at least 32 characters, or inject it through the operator's secret manager. Do not put it in command arguments or chat.
- `UPLOAD_ROOT` must identify the actual source upload directory.
- Optional `TENANT_BACKUP_MAX_BYTES` defaults to 256 MiB. The tool fails above its supported package size; it never truncates records. This version assembles the bundle in memory. Rehearse peak memory and recovery time at the intended volume; use a reviewed streaming implementation for larger tenants. The existing remote document reader has a 25 MiB per-document bound.

The current CLI permits development/staging rehearsals only. For a copy of production, retain its access restrictions and prevent all external deliveries.

1. Suspend the selected tenant through platform management.
2. Stop/drain **all** API instances, workers, scheduled tasks and direct writers for the snapshot interval. Merely setting `PAUSE_BACKGROUND_JOBS=1` does not drain existing API/provider operations. Stop external writes to tenant DMS/S3 objects as well.
3. Confirm no in-flight document processing or outbox delivery remains. The tool rejects those states; investigate ambiguous deliveries before retrying. It does not clear the queue to make a backup pass.
4. Run from `server/`, using the actual organization ID and target label:

```powershell
npm run db:tenant -- backup --target netflow --org <organization-id> --out <protected-directory>/tenant-backup.nfb --writers-stopped
npm run db:tenant -- verify --in <protected-directory>/tenant-backup.nfb
```

`--writers-stopped` is the operator's assertion that step 2 is complete; the tool cannot verify external maintenance. It also takes an exclusive organization operation lock and tenant table locks, validates schema checksums and uses a repeatable-read snapshot. Source data and status remain unchanged. Use a new output filename for each retry: files are never overwritten.

The snapshot captures local files, S3/DMS references and unlinked remote uploads recorded in file grants. Missing **referenced** bytes or provider failures stop the backup. An unreferenced local grant whose bytes were already removed by retention is explicitly reported as `unreferencedMissingFiles`; its grant metadata is preserved. Remote reads use the organization's existing configured provider, not global credentials. Department-specific DMS recovery is explicitly blocked with `DEPARTMENT_DMS_RECOVERY_NOT_SUPPORTED` when DMS references exist; it needs a reviewed per-document connection adapter before those tenants can use this tool. Real S3/DMS access and object-version guarantees still require staging acceptance; unsupported/missing objects are never ignored.

## Create a customer package

```powershell
npm run db:tenant -- customer-export --in <protected-directory>/tenant-backup.nfb --out <protected-directory>/customer-data.json --include-files
```

Omit `--include-files` for records only. The manifest reports record counts, checksums, excluded tables and redacted paths. Review the declared export scope with the recipient. This is a data portability package, not an executable database backup. User-entered business content and documents may themselves contain sensitive information and need the customer's normal handling rules.

## Restore and verify in isolation

Create a new, empty PostgreSQL database on the verified development/staging server, named for example `netflow_restore_trial`. Do **not** bootstrap an admin or seed data there. Use a **new** filesystem destination outside the live upload root; its parent must exist.

```powershell
npm run db:tenant -- restore-verify --target netflow --in <protected-directory>/tenant-backup.nfb --database netflow_restore_trial --files <new-restore-directory>
```

The tool connects to that database with setup credentials. It refuses the source database, unsupported names/releases, existing tenant/account/plan data, tampered bundles or an existing file destination. It uses reviewed local schema SQL, never SQL supplied by a backup.

Verification includes every captured row's exact values/count/checksum, ownership, deferred foreign keys, table manifest and file bytes. PostgreSQL numeric precision and timestamp microseconds are preserved by storing raw JSON row text. File names/ownership are checked before writing. A database failure rolls back the import; diagnostic files are retained. Retry against another empty target and new directory after resolving the reported error. A `restore-report.json` with `databaseCommitted: true` records successful database commit and verified file paths; a prepared report with `false` is not success.

The restored tenant remains suspended. Sessions and password-reset links are revoked, file-link versions increment, and unsent outbox entries are held at their retry limit. Sent delivery records are preserved. These deliberate changes are listed separately from the exact pre-quarantine comparison. Platform authentication is absent.

Local documents are materialized under `<new-restore-directory>/uploads/<org-id>/`. Provider documents are materialized under `provider-objects/` with an original-key/checksum mapping in the report. **The tool does not write back to S3/DMS or change provider references.** Validate/rebind restored objects against isolated provider accounts before testing those journeys. Do not connect the recovered tenant to the original live provider or start workers simply to verify it.

## Before a real recovery or release

- Rehearse complete user journeys against the recovered staging tenant with the intended app version, runtime role, isolated storage and integrations.
- Approve RPO/RTO, retention, backup-vault ACLs/encryption/key recovery and large-tenant limits.
- Reconcile pending/ambiguous external deliveries and choose which to resume; never bulk-replay held outbox rows.
- Plan the audited, tenant-scoped maintenance swap/reload, directory/SSO/resource reconciliation and file activation. Take a final backup first. Production swap is not implemented or authorized by this rehearsal command.
- Validate unrelated tenants and monitoring, then approve activation and the rollback window. Retain the previous data until that window and explicit deletion approval.

`/api/ready` remains 503 with `phase: 6`. Provider acceptance, load/recovery acceptance and the remaining gated platform features must be resolved before the application is described as production-ready.


Phase 6 adds connection-aware department backups, isolated provider rehydration/relinking and retention/proof-checked archive removal. Follow [OPERATIONS.md](OPERATIONS.md). The base `restore-verify` command still performs no external provider writes; `restore-providers` is explicit and restricted to isolated targets.
