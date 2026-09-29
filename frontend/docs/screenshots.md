# Screenshot maintenance

The public guides use real screenshots from the running NetFlow application. Capture credentials must stay in the shell's process environment; never put passwords, session state, reset tokens, or public sharing tokens in documentation or this script.

## Refresh

1. Start the existing frontend and API.
2. Supply `NETFLOW_DOCS_EMAIL` and `NETFLOW_DOCS_PASSWORD` privately in the process environment for an authorized Organization Admin with builder access.
3. From `frontend`, run `node docs/scripts/capture-screenshots.mjs`.
4. Review every changed image and `docs/screenshots-report.json`, update guide captions, then run `node docs/scripts/verify-screenshots.mjs` and `npm run docs:build`.

Optional environment variables: `APP_URL` (default `http://localhost:5173`), `NETFLOW_DOCS_API_URL` (default `http://localhost:5000`), `NETFLOW_DOCS_BROWSER` (default `msedge`), and `NETFLOW_DOCS_ONLY` (comma-separated asset names without `.png` for a targeted recapture).

The script blocks all non-read HTTP requests except sign-in and the verified read-only `POST /api/forms/:id/approval-preview` query. It does not save, submit, publish, enable sharing, send password resets, change passwords, or mark notifications read. Sign-in can produce normal server login/audit records. Each run uses an isolated browser context and does not save authentication state.

## Accuracy and privacy

- Gray masks hide identities, emails, submitted values, and credentials. The app's real labels, layouts, statuses, and controls are not replaced with fixtures.
- Each capture waits for its expected state. Failed captures do not overwrite an existing asset, and appear as pending in the report. A pending image must not be embedded as a current screenshot.
- The reset-password capture shows the real missing/invalid-link state, not a simulated valid reset form.
- The Share capture shows its control only. Activating it would enable public access.
- Workflow canvas, settings, and review captures are separate steps of an existing workflow; nothing is saved or published.
- View runs currently navigates to Analytics & reports. Its caption states this rather than describing a nonexistent executions drawer.
- Leader and Employee dashboards require the corresponding accounts. Committee and actionable approval screenshots require accessible tasks in those states. An Admin screenshot must not stand in for a different role.

## Coverage

See `screenshots-report.json` for capture status, route patterns, state descriptions, and SHA-256 checksums. The five pre-existing, unreferenced platform images (`activity`, `dashboard-superadmin`, `health`, `organizations`, `platform-orgs`) are retained unchanged; they need a SuperAdmin session before reuse. Other pending legacy images are also retained but not embedded in the current guides.

The existing `NetFlow-Testing-Packet.docx` is outside this screenshot refresh and is not regenerated.
