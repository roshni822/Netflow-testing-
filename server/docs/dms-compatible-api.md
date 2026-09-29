# Tenant-configurable DMS

NetFlow connects to an API contract, not a predefined product or vendor. An
organization can use its own installation implementing this contract. Arbitrary
third-party APIs still need an adapter; supplying a URL does not translate APIs.

## Setup

1. Enable the DMS service with `DMS_ENABLED=true` on the server.
2. In Platform → New/Edit organization → Integrations, enable DMS.
3. Enter an optional connection name, the API base URL (including its path prefix),
   the tenant's API key, and optionally its organization slug/root namespace.
4. Test the connection, then save. The check verifies authenticated document-list
   access and the expected response shape. It does not upload/delete a test file
   or certify write permissions. Those permissions must be granted in the DMS.

Configuration remains a Platform Super Admin operation. This change does not
grant tenant administrators permission to replace integration credentials.
Dedicated S3 routing is unchanged and retains its existing precedence.

## Required compatible contract

Paths below are appended to the supplied API base URL. For example, a base of
`https://documents.example.com/custom/api` uses
`https://documents.example.com/custom/api/documents`.

| Operation | Request | Expected response |
| --- | --- | --- |
| Authentication | `X-Api-Key: <tenant key>`; optional tenant login token as `Authorization: Bearer …` | Authenticated access scoped by the DMS to that tenant |
| Connection test / listing | `GET /documents?limit=1&offset=0` | JSON `{ "documents": [] }`; `data.documents` or `items` arrays also accepted |
| Upload | `POST /documents/upload`, multipart `file`, JSON string `sourceRef`, optional `folder` | JSON `{ "document": { "id": "…", "name": "…", "mime": "…", "size": 123 } }` |
| View/download URL | `GET /documents/:id/url?mode=view` or `mode=download` | JSON `{ "url": "https://…", "signed": true }` |
| Direct-file fallback | `GET /documents/:id/file`, optional `?download=1` | Browser-accessible file response when signed URL is not supplied |
| Document metadata | `GET /documents/:id` | Document metadata object |
| Delete | `DELETE /documents/:id` | Successful 2xx response |
| Upload recovery | `GET /documents/by-external-ref?app=netflow&id=…` (or task/form/workflow reference) | Previously stored document, or 404 |
| Workflow audit | `POST /documents/:id/events` with JSON `type`, `actor`, `detail`, `meta` | Successful 2xx response |

Upload `sourceRef` contains `app: "netflow"` plus available `department`, `orgSlug`,
`taskId`, `formResponseId`, `workflowId`, and `id`. Folder/root behavior is the
DMS's responsibility. Listing used for storage totals supports `limit`, `offset`
and `page`, and should return document `id` and byte `size`.

Optional endpoints: `GET /health`, `GET /folders` returning `{ "tree": [] }`,
`GET /usage` or `/stats` (opt-in via `DMS_USAGE_ENDPOINT=true`), and
`POST /auth/login` accepting JSON email/password and returning `{ "token": "…" }`.
The latter is needed only when using the existing DMS login UI.

## Isolation and endpoint safety

- Explicit tenant endpoints do not inherit platform API keys or JWTs.
- Department override URLs use their own keys when targeting another endpoint.
- Custom endpoints use HTTPS, checked socket DNS resolution, bounded responses,
  timeouts and no redirects. Credentials/query strings/fragments cannot be stored
  in base URLs.
- Private/on-premise or local HTTP installations require exact origins in the
  server-owned `DMS_TRUSTED_ORIGINS` comma-separated allowlist. Example:
  `https://dms.internal.example:8443`. Only approve trusted destinations; no
  wildcard matching is performed. Public TLS verification remains enabled.
- DMS credentials are masked in platform organization responses. Storage of
  existing credential fields is unchanged; this feature does not introduce an
  encryption-at-rest migration or external secret vault.
- Custom DMS document URLs must use an approved HTTP(S) scheme. Server-side
  extraction downloads also use DNS/address checks, reject redirects, have a
  30-second timeout and a 25 MB response limit. Signed URLs must directly serve
  the file; DMS credentials are not forwarded to the signed URL host.
- Connection receipts bind the endpoint and effective credentials. Changed DMS
  configuration is revalidated server-side before saving an enabled integration.

## Legacy connections and document safety

An empty organization base URL retains the existing `DMS_API_URL`, `DMS_API_KEY`
and `DMS_JWT` fallback. No records, environment settings or remote files are
automatically deleted or migrated. Existing API field names and document IDs
are preserved.

An already-configured organization cannot switch to a different effective base
URL through this form/API: it receives `DMS_ENDPOINT_MIGRATION_REQUIRED` (409).
This conservative guard also applies when legacy environment credentials are
available; it does not assume the tenant has no old documents. An explicit
document migration is a separate operation, not part of this feature.

Open-in-DMS file links resolve through the authenticated tenant-aware download
endpoint, not a single frontend-wide DMS website URL. They open the document
view supplied by the DMS, not a guessed vendor-specific management page.

## Verification

`node tests/dms_dynamic_endpoint.test.js` uses two local HTTP fixture servers,
isolated credentials and in-memory route checks, without a live database or DMS.
`node tests/platform_integration_validation.test.js` covers existing DMS/S3
connection checks and upload recovery.
