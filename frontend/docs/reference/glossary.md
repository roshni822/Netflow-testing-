# Glossary

Key terms used throughout NetFlow.

- **Form** — a set of fields users fill in. Has a lifecycle: draft → published → archived.
- **Draft (form response)** — a privately saved, incomplete form. Never counts as a submission and never triggers a workflow.
- **Response** — a submitted form record. Source is *internal* (signed-in user) or *public* (share link).
- **Workflow** — a graph of nodes that routes a submission through approvals and other steps.
- **Node** — a single step in a workflow (approval, committee, submit, review, condition, notify, integration, timer, start, end).
- **Execution** — one running instance of a workflow, created per trigger.
- **Task** — a unit of work assigned to a person (approval, submit, or review).
- **Blocking node** — a node that creates a task and pauses the execution until someone acts.
- **Committee / N-of-M** — a multi-approval stage that passes when N of M voters approve.
- **SLA** — the deadline on a task; breaching it triggers escalation.
- **Escalation** — automatic re-routing of an overdue task to a higher level.
- **Inbound webhook** — external POST that starts a published workflow.
- **Result callback** — outbound POST of a webhook-started run’s final outcome to a URL you configure.
- **Integration node** — outbound HTTP step inside a workflow (partner APIs, n8n, etc.).
- **Dead letter** — retained record of a failed Integration call after retries.
- **Organization / workspace** — your company’s NetFlow space (users, forms, workflows).
- **Plan / tier** — Trial, Basic, Professional, or Enterprise. Negotiated limits keep the selected plan name.
- **Builder seat** — plan allowance for users who design forms and workflows.
- **Administrator** — workspace admin who designs forms/workflows and manages users.
- **MFA** — multi-factor authentication (TOTP), required for admins.
- **SSO** — single sign-on via Microsoft.
- **e-signature** — a typed or uploaded signature captured with an approval decision.
- **DMS (Documents Management System)** — secure internal file storage for documents and form attachments.
- **S3 storage** — an external AWS-compatible bucket that can replace internal storage for an organization.
- **Read-only mode** — the state a workspace enters when its license expires or limit is severely breached; no new data can be created.
- **Shell** — the top-level layout and navigation structure (Platform, Org Admin, Ops, or Workspace) loaded based on your role.
- **Files meter** — the usage tracker that calculates total bytes stored against your plan limit.
- **Custom plan** — a negotiated subscription plan beyond the standard tiers.
- **Product tour** — a role-based guided walkthrough shown to new users on their dashboard.
