# Quick start

This guide takes you from signing in to submitting your first request and acting on a task, in about 10 minutes.

::: tip Need every click spelled out?
The [User guide](/guide/account-sign-in) has step-by-step pages (with screenshots) for sign-in, forms, workflows, tasks, and more.
:::

## 1. Sign in

Open your organization's URL and sign in with your email and password.

- If your organization uses a **workspace subdomain** (for example `acme.netflow.app`), open that address directly. The login screen shows the workspace name so you know you're in the right place.
- The same email can belong to more than one organization; the workspace determines which account you sign into.

::: tip First login with a temporary password
If an admin created your account, you'll sign in with a temporary password and be asked to set a new one immediately. See [Account & sign-in](/guide/account-sign-in#forced-password-change).
:::

If your organization has **Microsoft SSO** enabled, you can click **Sign in with Microsoft** instead. See [Single sign-on](/guide/account-sign-in#microsoft-sso).

## 2. Set up multi-factor authentication (admins)

Admin accounts are required to enrol in **MFA** on first login:

1. After entering your password, you'll see a QR code.
2. Scan it with an authenticator app (Google Authenticator, Authy, Microsoft Authenticator).
3. Enter the 6-digit code to finish.
4. **Save your backup codes** somewhere safe — they're shown only once.

Full details: [Multi-factor authentication](/guide/account-sign-in#multi-factor-authentication-mfa).

## 3. Get your bearings

After signing in you land on the **Dashboard**. The main areas are:

- **Forms** — browse and fill forms; builders can create them.
- **Tasks / Approvals / My Requests** — your inbox of requests to act on and requests you submitted (label depends on your role).
- **Notifications** — in-app alerts about assignments and decisions.
- **Analytics** and **Audit log** — reporting and a record of key actions.

### In-app product tour
New users are greeted with a role-based guided tour that highlights key features of the platform based on their persona. You can dismiss the tour and restart it later from the help menu.

### Global search
The AppShell includes a global search bar (press `Ctrl + K` or `Cmd + K`). Use it to quickly jump to specific requests, forms, users, or workflows across the entire platform.

## 4. Submit your first request

1. Go to **Forms** and open a published form.
2. Fill it in. Some fields may appear or hide based on your earlier answers (conditional logic), and file fields let you attach documents.
3. Optionally click **Save draft** to finish later — drafts are private to you and don't count as a submission.
4. Click **Submit**.

If the form is linked to a published workflow, you'll see **"Approval workflow started"** and can track it under **Tasks → My requests**.

## 5. Act on a task

If work is routed to you:

1. Open **Tasks → Assigned to me**.
2. Open a task to see the request, its history, and the approval chain.
3. Choose an action:
   - **Approve** (optional comment / e-signature)
   - **Reject** (comment required)
   - **Request changes** (comment required; sends it back)

See [Tasks & approvals](/guide/tasks-approvals) for committee voting, submit, and review tasks.

## 6. Build something (builders only)

If you are the **Administrator** (`Admin`) with a builder seat:

1. **Create a form** — go to **Forms → New**, choose a template, start blank, or build it with AI. See [Forms](/guide/forms).
2. **Create a workflow** — go to **Workflows → New**, pick a template, wire up your approval nodes on the canvas, link your form, and publish. See [Workflows](/guide/workflows).
3. **Publish both** — only published forms and workflows are live for end users.

## Next steps

- Understand every field type and option in [Forms](/guide/forms).
- Learn the full node palette in [Workflows](/guide/workflows).
- Setting up a new organization from scratch? See the [Onboarding guide](/getting-started/onboarding).
