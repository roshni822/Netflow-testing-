// Master documentation PDF generator.
// Produces a single 20+ page English document covering: completed features,
// pending features, a multi-tenancy how-to, and a hierarchically numbered
// implementation roadmap, plus architecture and an end-to-end workflow.
// Deliberately EXCLUDES Docker, CI/CD, and deployment topics.
//
//   Run:  node generate-master-doc-pdf.js   (from the /server folder)
//   Out:  ../NetFlow-Complete-Feature-and-Roadmap.pdf  (workspace root)

const fs = require('fs')
const path = require('path')
const PDFDocument = require('pdfkit')

const OUT = path.join(__dirname, '..', 'NetFlow-Complete-Feature-and-Roadmap.pdf')

// ---- palette ---------------------------------------------------------------
const INDIGO = '#4f46e5'
const INK = '#111827'
const GRAY = '#374151'
const MUTE = '#9ca3af'
const BORDER = '#e5e7eb'
const ZEBRA = '#f9fafb'
const GREEN = '#065f46'
const AMBER = '#92400e'
const RED = '#991b1b'

const M = 54
const doc = new PDFDocument({ size: 'A4', margin: M, bufferPages: true })
const stream = fs.createWriteStream(OUT)
doc.pipe(stream)

const PAGE_W = doc.page.width
const CONTENT_W = PAGE_W - M * 2
const dateStr = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' })

// ---- hierarchical numbering ------------------------------------------------
// section() bumps the top-level counter (1, 2, 3...). sub() bumps the second
// level (1.1, 1.2). subsub() bumps the third level (1.1.1).
let L1 = 0, L2 = 0, L3 = 0
const nextL1 = () => { L1 += 1; L2 = 0; L3 = 0; return `${L1}` }
const nextL2 = () => { L2 += 1; L3 = 0; return `${L1}.${L2}` }
const nextL3 = () => { L3 += 1; return `${L1}.${L2}.${L3}` }

// ---- layout helpers --------------------------------------------------------
const ensureSpace = (h) => { if (doc.y + h > doc.page.height - M) doc.addPage() }

const section = (title) => {
  doc.addPage()
  const num = nextL1()
  doc.fillColor(INDIGO).font('Helvetica-Bold').fontSize(17).text(`${num}. ${title}`, M, doc.y)
  const y = doc.y + 3
  doc.moveTo(M, y).lineTo(M + CONTENT_W, y).lineWidth(1.3).strokeColor(INDIGO).stroke()
  doc.moveDown(0.7); doc.x = M; doc.fillColor(INK)
}

const sub = (title) => {
  ensureSpace(40)
  const num = nextL2()
  doc.moveDown(0.3)
  doc.fillColor(INK).font('Helvetica-Bold').fontSize(12.5).text(`${num} ${title}`, M, doc.y)
  doc.moveDown(0.2); doc.x = M
  return num
}

const subsub = (title) => {
  ensureSpace(32)
  const num = nextL3()
  doc.moveDown(0.15)
  doc.fillColor(GRAY).font('Helvetica-Bold').fontSize(10.5).text(`${num} ${title}`, M, doc.y)
  doc.moveDown(0.15); doc.x = M; doc.fillColor(INK)
  return num
}

const para = (text, { italic = false, size = 10, color = GRAY } = {}) => {
  doc.font(italic ? 'Helvetica-Oblique' : 'Helvetica').fontSize(size).fillColor(color)
  ensureSpace(doc.heightOfString(text, { width: CONTENT_W }))
  doc.text(text, M, doc.y, { width: CONTENT_W })
  doc.moveDown(0.4); doc.x = M; doc.fillColor(INK)
}

const labeled = (label, text) => {
  doc.font('Helvetica-Bold').fontSize(10).fillColor(INK)
  ensureSpace(doc.heightOfString(`${label}: ${text}`, { width: CONTENT_W }) + 2)
  doc.text(`${label}: `, M, doc.y, { continued: true })
  doc.font('Helvetica').fillColor(GRAY).text(text)
  doc.moveDown(0.3); doc.x = M; doc.fillColor(INK)
}

// Numbered body item, e.g. "1." Uses an independent counter the caller resets.
const bullet = (text, { indent = 0, bold = false } = {}) => {
  const x = M + 14 + indent, w = CONTENT_W - 14 - indent
  doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(10).fillColor(INK)
  const h = doc.heightOfString(text, { width: w })
  ensureSpace(h + 3)
  const y = doc.y
  doc.circle(M + 4 + indent, y + 5, 1.7).fill(INDIGO)
  doc.fillColor(INK).font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(10).text(text, x, y, { width: w })
  doc.moveDown(0.25); doc.x = M
}

const numItem = (n, text) => {
  const x = M + 18, w = CONTENT_W - 18
  doc.font('Helvetica-Bold').fontSize(10).fillColor(INDIGO)
  const h = doc.heightOfString(text, { width: w })
  ensureSpace(h + 3)
  const y = doc.y
  doc.text(`${n}.`, M, y, { width: 16 })
  doc.font('Helvetica').fontSize(10).fillColor(INK).text(text, x, y, { width: w })
  doc.moveDown(0.25); doc.x = M
}

const panel = (title, lines, { bg = '#eef2ff', border = '#c7d2fe', titleColor = '#3730a3', mono = false } = {}) => {
  const padX = 10, padY = 8, innerW = CONTENT_W - padX * 2
  const bodyFont = mono ? 'Courier' : 'Helvetica', bodySize = mono ? 8.5 : 9.5
  doc.font('Helvetica-Bold').fontSize(9.5)
  let h = padY * 2 + doc.heightOfString(title, { width: innerW }) + 5
  doc.font(bodyFont).fontSize(bodySize)
  for (const ln of lines) h += doc.heightOfString(ln, { width: innerW }) + 3
  ensureSpace(h)
  const y = doc.y
  doc.rect(M, y, CONTENT_W, h).fillAndStroke(bg, border)
  doc.fillColor(titleColor).font('Helvetica-Bold').fontSize(9.5).text(title, M + padX, y + padY, { width: innerW })
  doc.fillColor(GRAY).font(bodyFont).fontSize(bodySize)
  for (const ln of lines) doc.text(ln, M + padX, doc.y + 3, { width: innerW })
  doc.y = y + h + 7; doc.x = M; doc.fillColor(INK)
}

const diagram = (title, lines) => panel(title, lines, { bg: '#f8fafc', border: BORDER, titleColor: INK, mono: true })
const flowPanel = (steps) => panel('Flow', steps.map((s, i) => `${i + 1}. ${s}`), { bg: '#eff6ff', border: '#bfdbfe', titleColor: '#1e40af' })
const examplePanel = (line) => panel('Example', Array.isArray(line) ? line : [line], { bg: '#ecfdf5', border: '#a7f3d0', titleColor: GREEN })

const table = (headers, rows, colW) => {
  const padX = 6, padY = 5, totalW = colW.reduce((a, b) => a + b, 0)
  const drawRow = (cells, { bg, bold, color }) => {
    doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(8.8)
    const heights = cells.map((c, i) => doc.heightOfString(String(c == null ? '' : c), { width: colW[i] - padX * 2 }))
    const rowH = Math.max(...heights, 10) + padY * 2
    ensureSpace(rowH)
    const y = doc.y
    if (bg) doc.rect(M, y, totalW, rowH).fill(bg)
    let x = M
    for (let i = 0; i < cells.length; i++) {
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(8.8).fillColor(color || INK)
        .text(String(cells[i] == null ? '' : cells[i]), x + padX, y + padY, { width: colW[i] - padX * 2 })
      doc.rect(x, y, colW[i], rowH).strokeColor(BORDER).lineWidth(0.5).stroke()
      x += colW[i]
    }
    doc.y = y + rowH; doc.x = M; doc.fillColor(INK)
  }
  drawRow(headers, { bg: INDIGO, bold: true, color: '#ffffff' })
  rows.forEach((r, i) => drawRow(r, { bg: i % 2 ? ZEBRA : '#ffffff', bold: false }))
  doc.moveDown(0.5)
}

// Feature block used in the pending-features and roadmap sections.
const featureBlock = (g) => {
  subsub(g.title)
  if (g.what) labeled('What it is', g.what)
  if (g.current) labeled('Current state', g.current)
  if (g.why) labeled('Why it matters', g.why)
  if (g.how) labeled('How to build it', g.how)
  if (g.flow && g.flow.length) flowPanel(g.flow)
  if (g.example) examplePanel(g.example)
  doc.moveDown(0.1)
}

// ============================================================================
// COVER
// ============================================================================
doc.rect(0, 0, PAGE_W, 265).fill(INDIGO)
doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(34).text('NetFlow', M, 74)
doc.font('Helvetica').fontSize(13).fillColor('#e0e7ff').text('Workflow & Approval Automation Platform', M, 118)
doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(20)
  .text('Complete Feature Inventory, Multi-Tenancy Guide', M, 162, { width: CONTENT_W })
doc.text('& Implementation Roadmap', M, 188, { width: CONTENT_W })
doc.font('Helvetica').fontSize(11).fillColor('#e0e7ff')
  .text('What is built, what is pending, and how to serve many organizations', M, 220, { width: CONTENT_W })

doc.fillColor(INK).font('Helvetica').fontSize(11)
doc.text(`Prepared: ${dateStr}`, M, 306)
doc.moveDown(0.4); doc.text('Audience: Management and Engineering', M)
doc.moveDown(0.4); doc.text('Language: English. Scope note: this document intentionally excludes Docker, CI/CD, and deployment topics, by request.', M, doc.y, { width: CONTENT_W })
panel('How to read this document', [
  'Sections use hierarchical numbering: 1, 1.1, 1.1.1 and so on. Section 2 lists everything already built. Section 3 lists what is pending. Section 4 is a step-by-step guide to making the app multi-tenant (usable by many organizations). Section 5 is the phased roadmap. Sections 6-7 cover architecture and an end-to-end workflow. Section 8 is a quick status table.',
])

// ============================================================================
// 1. INTRODUCTION
// ============================================================================
section('Introduction and How To Read This Document')

sub('Purpose and audience')
para('This document is a single reference for NetFlow. It explains, in plain language, what the product already does, what is still missing, how to turn it into a platform that many organizations can use at the same time, and the order in which to build the remaining work. It is written for both managers (to plan and prioritize) and engineers (to understand scope).')

sub('What NetFlow is')
para('NetFlow is a no-code workflow and approval automation platform. A non-technical administrator builds a form and an approval workflow on a visual canvas; employees submit requests; approvers act on them with an electronic signature; and the outcome is recorded and archived as a signed PDF with a full audit trail. It replaces email-and-spreadsheet approval chasing with a structured, trackable process.')
para('Every organization has repetitive approval processes. NetFlow is designed to digitize them:')
table(
  ['Department', 'Example process NetFlow replaces'],
  [
    ['HR', 'Leave requests, onboarding checklists, expense pre-approval'],
    ['Finance', 'Purchase requests, invoice approval, budget sign-off'],
    ['IT', 'Access requests, asset provisioning, change approval'],
    ['Operations', 'Goods Receipt Notes, vendor onboarding, SOP sign-off'],
    ['Legal', 'Contract review, NDA approval'],
    ['Sales', 'Discount approval, deal-desk sign-off'],
  ],
  [120, CONTENT_W - 120],
)

sub('Legend used throughout')
panel('Status labels', [
  'Built = working today.',
  'Partial = the foundation exists in the data model or code, but it is not fully wired end to end.',
  'Pending = not yet built.',
])

// ============================================================================
// 2. COMPLETED FEATURES
// ============================================================================
section('Completed Features (Built Today)')
para('NetFlow is already a working, demo-ready product. This section inventories what exists. At a high level, the platform today includes roughly the following capability areas, all functional:')
panel('At a glance - what is built', [
  'Accounts and role-based access; a rich form builder with 11 field types; form templates; an AI form builder; auto-fill.',
  'Public (no-login) forms; a visual workflow canvas and a working engine with 9 active node types.',
  'Approvals with approve / reject / request-changes, comments, approval chain and history; electronic signatures; signed-PDF generation.',
  'Task inbox and notifications (with sort and delete); analytics with CSV / Excel / PDF export; a full audit log.',
  'SLA escalation, Out-of-Office auto-reassignment, delegation of authority, an AI assistant chatbot, access controls, workflow triggers, and request cancellation.',
])

sub('Accounts and access')
para('JSON Web Token (JWT) based login, with roles and role-based access control. An Admin Panel lets administrators create and manage users; a protected CEO account is seed-only. Registration bootstraps the first user as Admin, and additional users are created by admins.')

sub('Form builder and field types')
para('A drag-and-add form builder supports 11 field types: text, textarea, number, dropdown, date, file upload, checkbox, radio, signature, repeater, and a dynamic grid/table (with per-column cell types and dynamic rows). Fields can be marked required.')
bullet('Form templates library for one-click starting points (for example Leave Approval, Purchase Request).')
bullet('AI form builder: describe a form in words and it generates the fields.')
bullet('Auto-fill: for logged-in users, fields such as name and email are pre-filled.')

sub('Public (unauthenticated) forms')
para('Forms can be shared as a public link (an unguessable token) so people who are not users, such as vendors or customers, can submit data - similar to a Google Form. Submissions are collected with a responses viewer and CSV export, and public submit and upload routes are rate-limited.')

sub('Visual workflow canvas and engine')
para('A visual canvas lets a builder lay out the process as connected nodes. A backend engine executes the graph: it walks from node to node, creates tasks, pauses to wait for human action, and resumes when the action is taken.')

sub('Node types implemented')
para('Nine node types are active in the engine, covering the full lifecycle of a request:')
table(
  ['Node', 'What it does'],
  [
    ['Start', 'Entry point of the workflow'],
    ['Submit', 'An assignee fills an inline form and/or uploads documents, then submits'],
    ['Approval', 'An approver approves, rejects, or requests changes'],
    ['Review', 'A reviewer views everything and forwards or sends back for changes'],
    ['Condition', 'Branches true/false on a field (equals, greater/less than, contains, and so on)'],
    ['Notification', 'Sends a notification'],
    ['Timer', 'Waits/delays'],
    ['Assignment', 'Assigns/sets routing'],
    ['End', 'Completes the request; can optionally generate a signed PDF'],
  ],
  [110, CONTENT_W - 110],
)
para('Two further node types (integration/API and standalone document) are present as placeholders but not yet implemented - see the pending section.', { italic: true, color: MUTE, size: 9 })

sub('Approvals, chain, and history')
para('Approvers can approve, reject, or request changes, each with a comment. The request shows an approval chain (all the approval steps in the path) and an approval history (who did what, when, with their comment). Documents attached at earlier steps are visible to later approvers.')

sub('Electronic signatures and signed PDF')
para('Approval steps can require an electronic signature, captured either as a typed name in a signature font or an uploaded image. On completion, the End node can optionally generate a signed PDF of the whole request - form data, the approval trail, and the captured signatures - archived like any other attachment.')

sub('Submit-node inline forms and specific-person approvers')
para('A Submit node can define its own inline form (custom fields such as name, account number, e-signature, and attachments) that the assignee fills before submitting. Approval steps can be assigned to a specific named person, not only to a role.')

sub('Task inbox and notifications')
para('Users have a task inbox with two views: tasks assigned to me and requests I submitted. Both support sorting (date, name, status) and deletion of finished requests. In-app notifications also support sorting and per-item deletion.')

sub('Analytics, exports, and audit log')
para('An analytics dashboard summarizes activity and supports export to CSV, Excel, and PDF. A full audit log records key actions for traceability.')

sub('Routing, availability, and governance')
bullet('SLA escalation: a scheduled job escalates overdue tasks.')
bullet('Out-of-Office: while enabled, a user new tasks auto-route to their manager.')
bullet('Delegation of Authority: approval routing can be delegated.')
bullet('Access controls: who can submit a workflow, and visibility of forms, are enforced on the backend.')
bullet('Workflow triggers: every submission, or manual trigger only.')
bullet('Request cancellation: a submitter can cancel an in-progress request.')

sub('AI assistant chatbot')
para('A floating in-app assistant answers grounded, role-scoped questions such as where a request is or who approved a given item, by searching the user own requests and tasks and summarizing with a language model.')

sub('How the built features fit together')
para('The completed features are not isolated - they form one continuous chain from designing a form to an archived, signed decision. The diagram below shows how a request flows through the pieces that already exist today.')
diagram('Built capabilities, end to end', [
  'Form builder + templates + AI builder',
  '        |  (publish)',
  'Linked workflow on the canvas  --trigger-->  Engine',
  '        |                                       |',
  '   Task inbox  <----  tasks + notifications  <--+',
  '        |',
  '   Approve / Reject / Request-changes  (+ e-signature)',
  '        |',
  '   End node  ->  optional signed PDF  ->  Audit log + Analytics',
])
examplePanel([
  'A manager builds a "Purchase Request" form with the builder, links it to a two-step approval workflow, and publishes.',
  'An employee submits it; the approver gets a task and notification, approves with a typed e-signature; the End node produces a signed PDF; the whole trail appears in analytics and the audit log.',
])

// ============================================================================
// 3. PENDING FEATURES
// ============================================================================
section('Pending Features (Not Yet Built)')
para('This section lists what is missing, grouped by theme. For each item you get what it is, the current state, and why it matters. Deployment topics (Docker, CI/CD, hosting) are intentionally out of scope for this document.')

sub('Multi-tenancy - the headline gap')
featureBlock({
  title: 'Organization isolation (orgId)',
  what: 'One running app that securely serves many organizations, each seeing only its own data.',
  current: 'No tenant concept exists. All users share one global space, email is globally unique, and departments are a fixed hard-coded list, so the app can serve exactly one company.',
  why: 'Without it, a second organization cannot be onboarded, and one org data would be visible to another. This is the single most important gap and is covered in detail in Section 4.',
})

sub('Application-level security')
featureBlock({
  title: 'Forgot / reset password and email verification',
  what: 'Self-service password reset via an emailed, expiring link, and verifying email at signup.',
  current: 'Only register, login, me, and logout exist; there is no reset or verification.',
  why: 'A user who forgets their password is locked out until an admin intervenes.',
})
featureBlock({
  title: 'Login rate-limiting and MFA',
  what: 'Throttle repeated login attempts and offer a second factor (authenticator code).',
  current: 'Rate-limiting exists only on public form routes; the login endpoint has none, and there is no MFA.',
  why: 'The login endpoint can be brute-forced, and the system authorizes money and access.',
})
featureBlock({
  title: 'Token revocation (real logout)',
  what: 'The ability to invalidate a session immediately on the server.',
  current: 'Tokens are stateless and valid for days; logout only asks the client to forget the token.',
  why: 'A leaked token or a terminated employee cannot be cut off until the token naturally expires.',
})

sub('Workflow depth')
featureBlock({
  title: 'Parallel / quorum approvals',
  what: 'A single stage that needs multiple approvers - all of them, or any N of M.',
  current: 'An approval node resolves one approver and one task; a stored approval type is not acted on.',
  why: 'Real approvals are often committee-based; today they can only be chained slowly and cannot express any 2 of 3.',
})
featureBlock({
  title: 'Workflow versioning',
  what: 'Publishing an edit creates a new version; in-flight requests keep running on their original version.',
  current: 'A workflow is a single mutable document with no per-execution version pin.',
  why: 'Editing a live workflow can disrupt requests that are half-finished.',
})
featureBlock({
  title: 'Integration / webhook node and document node',
  what: 'A node that calls an external system (ERP, payments, chat), and a standalone document-generation node.',
  current: 'Both node types are present as placeholders but are skipped by the engine.',
  why: 'An approval outcome usually needs to trigger something in another system automatically.',
})

sub('Forms depth')
featureBlock({
  title: 'Conditional field logic (Partial)',
  what: 'Show or hide a field based on another answer.',
  current: 'The form data model already declares conditional logic, but the fill-time renderer does not apply it. This makes it a fast win.',
  why: 'Forms become long and confusing; adaptive forms are impossible.',
})
featureBlock({
  title: 'Advanced validation (Partial)',
  what: 'Rules beyond required: length limits, numeric ranges, and format patterns.',
  current: 'The model declares validation rules, but fill-time validation checks only whether required fields are filled.',
  why: 'Malformed data flows straight into approvals and cannot be fixed downstream.',
})
featureBlock({
  title: 'Save as draft',
  what: 'Save a partially filled form and finish later.',
  current: 'Submission is all-or-nothing; there is no draft response.',
  why: 'Long forms plus interruptions cause lost work and abandonment.',
})

sub('Collaboration')
featureBlock({
  title: 'Comments / discussion thread with mentions',
  what: 'A running conversation on a request, with the ability to mention colleagues.',
  current: 'Only a single comment per approval action exists; there is no thread.',
  why: 'Clarifications stall requests when there is nowhere to discuss them.',
})
featureBlock({
  title: 'Notifications in existing tools (Teams / Slack / Outlook)',
  what: 'Deliver alerts into the tools an organization already uses.',
  current: 'Notifications are in-app and email only.',
  why: 'People miss tasks if alerts do not reach where they already work.',
})

sub('Self-service and teams')
featureBlock({
  title: 'Service catalog / request portal',
  what: 'A single place listing every request type an employee can start, with one-click launch.',
  current: 'Forms exist but there is no catalog-style front door.',
  why: 'Adoption rises sharply when employees can see what they can request.',
})
featureBlock({
  title: 'Teams / groups approvals',
  what: 'Route an approval to a group where any member can act.',
  current: 'Approvals target a role or a specific person, not a managed group.',
  why: 'Real teams share an approval queue rather than depending on one person.',
})

sub('Administration and people')
featureBlock({
  title: 'Department and org-structure management',
  what: 'Manage departments and reporting hierarchy from the UI.',
  current: 'Departments are a hard-coded list in the code.',
  why: 'Each organization has its own structure and needs to manage it itself.',
})
featureBlock({
  title: 'Bulk user import and SSO',
  what: 'Import many users at once (CSV), and let staff sign in with Microsoft or Google.',
  current: 'Users are created one at a time; there is no single sign-on.',
  why: 'Onboarding large organizations by hand is slow, and SSO removes extra passwords.',
})

sub('Reporting and platform capabilities')
featureBlock({
  title: 'Manager dashboards and scheduled reports',
  what: 'Cycle-time and bottleneck views per team, plus emailed summaries.',
  current: 'Analytics exists but not per-node bottleneck insight or scheduling.',
  why: 'Managers need to see where approvals get stuck.',
})
featureBlock({
  title: 'Real-time updates, durable uploads, production email, background workers',
  what: 'Live UI updates (no refresh), durable file storage (S3), a real email provider, and a background job queue (Redis + workers).',
  current: 'The UI polls/refreshes; uploads sit on local disk; email uses a sandbox; the engine runs inline.',
  why: 'These enablers make notifications reliable, files durable, and the app responsive under load. (Framed here as product enablers, not deployment.)',
})
featureBlock({
  title: 'Per-org branding, multi-language, dark mode, mobile',
  what: 'Per-organization logo and colors, multiple languages, dark theme, and strong mobile support.',
  current: 'Single default theme, English only.',
  why: 'Broadens reach and makes each organization feel at home.',
})

// ============================================================================
// 4. MULTI-TENANCY
// ============================================================================
section('How To Make It Multi-Tenant')
para('This is the core of turning NetFlow from a single-company tool into a platform many organizations can use. The good news: it does not require rewriting features or buying a domain. It is mostly about tagging data with an organization id and always filtering by it.')

sub('The problem today')
para('Right now there is one shared space. Nothing on a record says which organization it belongs to, and user email is globally unique. So if a second organization started using the same instance, their data would sit in the same collections and list queries would return everyone data - one organization would see another one forms, employees, and requests.')
panel('Where this shows up in the code', [
  'User email is globally unique (server/models/User.js), so the same person cannot exist in two organizations.',
  'Departments are a fixed hard-coded list (server/models/User.js and server/routes/auth.js).',
  'No collection carries an organization id, and no query filters by one.',
])

sub('The concept: tenant and the shared-database model')
para('A tenant is one customer organization and its users, kept fully separate from other customers even though they share the same application. Think of an apartment building: everyone shares the building (one app and one database), but each family has its own locked unit (its own data). The recommended model is shared database plus an organization id (orgId) on every record - cheapest to run and used by most SaaS products.')

sub('Data model changes')
para('The concrete changes are:')
numItem(1, 'Add a new Organization model: name, slug, plan, settings (including its own departments), and branding.')
numItem(2, 'Add an indexed orgId field to every collection: User, Role, Form, FormResponse, Workflow, WorkflowExecution, Task, Notification, and AuditLog.')
numItem(3, 'Change user email from globally unique to compound-unique on { orgId, email }, so the same person can exist in two organizations.')
numItem(4, 'Move departments out of the hard-coded list and into each Organization settings.')

sub('Tenant resolution without a domain')
para('Because every user belongs to exactly one organization, the app learns the tenant from the logged-in user - no subdomain or custom domain required. The orgId is read from the user record at login and carried inside the JWT; every later request is then scoped to that orgId.')
diagram('Tenant resolution (no domain needed)', [
  'Login (email + password)',
  '   -> server finds the user',
  '   -> reads user.orgId from the record',
  '   -> puts orgId inside the JWT',
  '   -> every later request is auto-filtered by orgId',
])

sub('Central tenant-scoping layer')
para('The most important safety measure: do not rely on each developer remembering to filter by orgId. Add one central layer - a middleware plus a Mongoose plugin/base query helper - that automatically injects the current orgId into every read and write. Forgetting to filter is the number-one cause of cross-tenant data leaks, so making it automatic is what makes isolation trustworthy.')
flowPanel([
  'A request arrives with a JWT containing orgId.',
  'Middleware puts the orgId into a per-request context.',
  'The data layer automatically adds { orgId } to every query and every new document.',
  'Queries can only ever see the current organization data.',
])

sub('Organization onboarding flow')
para('Creating a new organization is a data operation, not new code. It happens once you build the onboarding path, then repeats for every customer:')
flowPanel([
  'A new company signs up (self-service) or is provisioned by a super-admin.',
  'The backend creates an Organization record (a new orgId) and its first Admin user.',
  'The admin logs in to an empty workspace for that organization.',
  'The admin invites employees; each new user automatically gets that orgId.',
  'Everyone uses the same single login page; the server scopes them by orgId.',
])
examplePanel('Acme signs up and gets ORG_ACME; Globex signs up and gets ORG_GLOBEX. Neither can see the other data, and the same person can exist in both. No new code is written per organization.')

sub('Data migration and isolation testing')
para('Two finishing steps make the switch safe:')
numItem(1, 'Migrate existing records: run a one-time script that assigns a default orgId to all current documents so nothing is orphaned.')
numItem(2, 'Add isolation tests: automated tests that prove organization A can never read organization B data, so future changes cannot silently break the wall.')

sub('Multi-tenant request and isolation diagram')
diagram('Two organizations, one app, fully isolated', [
  'Acme user  --login-->  JWT { orgId: ORG_ACME }',
  'Globex user --login-->  JWT { orgId: ORG_GLOBEX }',
  '',
  'Request (Acme)  ->  scope layer adds { orgId: ORG_ACME }',
  '                 ->  Form.find({ orgId: ORG_ACME })   (only Acme forms)',
  'Request (Globex) ->  scope layer adds { orgId: ORG_GLOBEX }',
  '                 ->  Form.find({ orgId: ORG_GLOBEX })  (only Globex forms)',
  '',
  'Shared MongoDB (one database) - separated logically by orgId',
])

// ============================================================================
// 5. ROADMAP
// ============================================================================
section('Implementation Roadmap')
para('The remaining work is grouped into three phases. Phase 1 is the foundation that makes NetFlow multi-tenant and safe. Phase 2 adds scale and collaboration. Phase 3 adds depth and compliance. Deployment topics are intentionally excluded.')

sub('Phase 1 - Foundation (multi-org and safe)')
labeled('Goal', 'Make the app usable by many organizations and safe for real use.')
featureBlock({
  title: 'Organization tenancy (orgId)',
  how: 'Add the Organization model, orgId on every collection, compound-unique email, the central scoping layer, onboarding, and the migration script (see Section 4).',
  flow: ['Add Organization model and orgId fields.', 'Put orgId in the JWT at login.', 'Add the central auto-scoping layer.', 'Build onboarding (create org + first admin).', 'Migrate existing data and add isolation tests.'],
})
featureBlock({
  title: 'Password reset and login protection',
  how: 'Add forgot/reset endpoints with an emailed expiring token; add login rate-limiting; add optional authenticator-app MFA; move to short-lived tokens with server-side revocation.',
})
featureBlock({
  title: 'Durable uploads and production email',
  how: 'Store attachments in object storage (S3) via pre-signed URLs; send transactional email through a real provider with a verified sender domain. (Product enablers, not deployment.)',
})
featureBlock({
  title: 'Quick wins: conditional form logic and validation',
  how: 'Wire the already-declared conditional logic and validation rules into the form renderer and validator. Low effort because the data model already supports them.',
  example: 'A Travel Request reveals passport fields only when International is Yes, and enforces an 11-16 digit account number before submission.',
})

sub('Phase 2 - Scale and Collaboration')
labeled('Goal', 'Handle load and add the collaboration and access features organizations expect.')
featureBlock({
  title: 'Redis plus background workers / queue',
  how: 'Introduce Redis and a job queue; move running the engine, sending email, and generating PDFs into workers so the API responds instantly and failed jobs retry.',
})
featureBlock({
  title: 'Real-time notifications',
  how: 'Add a live channel (WebSocket or server-sent events) so inboxes and badges update instantly, using Redis to work across instances.',
})
featureBlock({
  title: 'Comments / mentions, teams/groups approvals, and service catalog',
  how: 'Add a discussion thread with mentions on each request; allow routing approvals to a group queue; add a catalog front door listing all request types.',
})
featureBlock({
  title: 'SSO, notification integrations, dashboards, and branding',
  how: 'Add Microsoft/Google single sign-on; push alerts to Teams/Slack/Outlook; add cycle-time and bottleneck dashboards; add per-org logo and colors.',
})

sub('Phase 3 - Depth and Compliance')
labeled('Goal', 'Match how complex and regulated organizations actually work.')
featureBlock({
  title: 'Parallel / quorum approvals and workflow versioning',
  how: 'Add an approval mode (all, or any N of M) that fans out tasks and completes on the rule; store immutable workflow versions and pin each execution to its version.',
})
featureBlock({
  title: 'Integration / webhook node and document generation',
  how: 'Implement the currently stubbed node to call external systems with retries and map the response back into workflow variables; add template-based document generation.',
})
featureBlock({
  title: 'Audit retention, data residency, and multi-language',
  how: 'Add per-org retention policies and tamper-evident history; offer region-pinned storage for residency; add multi-language support.',
})

sub('Suggested sequence and fastest first wins')
bullet('Start Phase 1 with tenancy and the isolation tests, because they protect everything built afterwards.')
bullet('Set up durable uploads and production email early - they remove silent failures immediately.')
bullet('Do the conditional-logic and validation quick wins first; the schema already supports them.')
bullet('Introduce Redis at the start of Phase 2 - it underpins rate-limiting, token revocation, queues, and real-time.')
bullet('Schedule SSO, billing-like plans, and data residency when a specific customer requires them.')
panel('Fastest first wins (low effort, high value)', [
  'Conditional form logic and advanced validation (schema already exists).',
  'Durable uploads plus production email (removes silent failures).',
  'Password reset plus login rate-limiting (closes the biggest security gaps).',
])

// ============================================================================
// PREREQUISITES AND DECISIONS
// ============================================================================
section('Prerequisites and Decisions')
para('A short list of the service accounts and decisions needed to build the roadmap. These are product enablers (storage, email, cache) and choices - not deployment steps. Secrets should never be pasted into chat or committed to the code; the app reads them from environment variables.')
sub('Service accounts (product enablers)')
table(
  ['What to provide', 'Enables', 'First needed'],
  [
    ['Object storage: S3 bucket (name, region, key, secret) or equivalent', 'Durable file uploads', 'Phase 1'],
    ['Email provider: API key + a verified sender', 'Reliable transactional email (reset, task alerts)', 'Phase 1'],
    ['Managed Redis (connection URL + password)', 'Rate-limit, token revocation, queue, real-time', 'Phase 1/2'],
    ['Per customer: SSO details (Microsoft/Google)', 'Single sign-on', 'Phase 2'],
    ['Per integration: external system URL + API key', 'Integration / webhook node', 'Phase 3'],
  ],
  [250, 175, 62],
)
sub('Decisions needed from you')
bullet('Confirm the tenancy model (recommended: shared database with orgId).')
bullet('Onboarding style: self-service signup, or super-admin provisioning of each organization.')
bullet('MFA method: authenticator app (free, recommended) or SMS codes.')
bullet('Which single sign-on providers to support first (Microsoft, Google).')
bullet('Whether per-organization branding (logo and colors) is needed early.')
panel('A note on credentials', [
  'Please share any keys through a private environment file you control, not in chat or in the repository. Because the app loads all secrets from environment variables, nothing sensitive is ever stored in the codebase.',
], { bg: '#fffbeb', border: '#fde68a', titleColor: AMBER })

// ============================================================================
// 6. ARCHITECTURE
// ============================================================================
section('Architecture')
sub('Current architecture')
para('Today NetFlow is a single-instance application. The engine, scheduled jobs, email, and file storage all run within one server process, and uploads are written to a local folder.')
diagram('Current (single instance)', [
  'Browser (SPA)  ->  React + Vite (frontend)',
  '      |   REST /api + JWT',
  'Express API  (single instance)',
  '      |-- MongoDB (Mongoose)',
  '      |-- Workflow Engine   (runs in-process)',
  '      |-- Language model (AI form builder / assistant)',
  '      |-- Email (sandbox in dev)',
  '      |-- Uploads: local folder',
  'Scheduled job: SLA escalation (in-process)',
])

sub('Target architecture at the application level')
para('The target keeps the same product but makes it multi-tenant and able to handle load. Heavy work moves to background workers, uploads move to durable storage, and Redis provides shared caching and coordination. (No Docker, CI/CD, or hosting details are included here by request.)')
diagram('Target (application level)', [
  'Browser  ->  React SPA (single login page)',
  '      ->  Stateless API (tenant-scoped by orgId)',
  '             |-- Redis: cache, sessions, rate-limit, queue',
  '             |-- MongoDB: all records carry orgId',
  '             |-- Object storage (S3): durable uploads',
  '             |-- Background workers: engine, email, PDF, jobs',
  '             |-- Email provider (real delivery)',
])
para('The key shifts: every request is scoped by orgId; the engine, email, and PDF generation run in background workers; uploads are durable; and Redis coordinates work across the app.')

// ============================================================================
// 7. WORKFLOW WALKTHROUGH
// ============================================================================
section('End-to-End Workflow Walkthrough')
para('This example ties the pieces together: how a request travels from a blank form to a signed, archived outcome. It uses a purchase request as the example.')
diagram('Request lifecycle', [
  '1. Builder designs a form + workflow on the canvas, then publishes.',
  '2. Employee submits the linked form (a purchase request).',
  '3. Trigger fires -> engine creates a WorkflowExecution.',
  '4. Engine walks nodes: Submit -> Approval -> (Condition) -> ...',
  '5. Each human step creates a Task + a notification to the assignee.',
  '6. Approver approves / rejects / requests changes (+ e-signature).',
  '7. A Condition node can branch (for example amount > 100000).',
  '8. End node completes the request and can generate a signed PDF.',
  '9. Every action is written to the audit log.',
])
sub('Step-by-step explanation')
numItem(1, 'Build and publish: an admin creates the purchase-request form and a workflow that links to it, then publishes both.')
numItem(2, 'Submit: an employee fills the form and submits; the linked workflow triggers automatically.')
numItem(3, 'Execution: the engine creates an execution record and begins walking the node graph from Start.')
numItem(4, 'Tasks and notifications: at each human node the engine creates a task for the right assignee (by role, specific person, or - after Phase 2 - a group) and notifies them.')
numItem(5, 'Action with signature: the approver acts with a comment and, if required, an electronic signature, which is stored in the approval history.')
numItem(6, 'Branching: a condition node can send high-value requests to an extra approver and low-value ones straight through.')
numItem(7, 'Completion: the End node marks the request complete and can produce a signed PDF containing the form data, approval trail, and signatures.')
numItem(8, 'Audit: every step is recorded, so the whole decision is traceable afterwards.')

// ============================================================================
// RISKS OF SHIPPING AS-IS
// ============================================================================
section('Risks of Serving Multiple Organizations As-Is')
para('If a second organization were added before the multi-tenancy and security work is done, the following problems would appear. This section explains why Phase 1 comes first.')
sub('Data would mix between organizations')
para('Because no record carries an organization id and list queries return everything, one organization would see another one forms, employees, requests, and analytics. This is both a trust problem and, for real customers, a legal and reputational one.')
examplePanel('Globex logs in and sees Acme purchase requests and employee names in dropdowns, simply because both share the same collections with no orgId filter.')
sub('Accounts could not be safely managed')
para('An unthrottled login endpoint can be brute-forced, and stateless tokens cannot be revoked. For a system that authorizes money and access, that means a compromised or ex-employee account cannot be cut off immediately.')
examplePanel('A terminated employee keeps approving requests from a still-valid token until it naturally expires, because logout only clears the client.')
sub('Files and notifications could be lost')
para('Uploads on local disk and sandbox email mean attachments can disappear and task emails may never reach approvers - so requests silently stall.')
examplePanel('An approver never receives the "task assigned" email, and a delivery-note attachment is missing after the server restarts.')
sub('Why this ordering matters')
para('These are exactly the items in Phase 1. Building tenancy, security, durable uploads, and real email first means every later feature is added on a safe foundation, rather than having to be retrofitted for isolation and security afterwards.')

// ============================================================================
// GLOSSARY
// ============================================================================
section('Glossary of Key Terms')
para('Plain-language definitions of the terms used in this document.')
const glossary = [
  ['Tenant', 'One customer organization and its users, kept fully separate from other organizations on the same app.'],
  ['Multi-tenancy', 'One running application that serves many organizations at once, each isolated from the others.'],
  ['orgId', 'The organization id stamped on every record and used to filter every query, so data never crosses organizations.'],
  ['JWT (token)', 'A signed login token the browser sends with each request; it will carry the user orgId.'],
  ['Workflow', 'The approval process, laid out as connected nodes on the canvas.'],
  ['Node', 'One step in a workflow (for example an approval, a condition, or the end).'],
  ['Execution', 'One running instance of a workflow, created when a form is submitted.'],
  ['Task', 'A single action assigned to a person (for example "approve this request").'],
  ['SLA', 'A time limit for a task; overdue tasks can be escalated automatically.'],
  ['Quorum approval', 'A stage that completes when a required number of approvers act (for example any 2 of 3).'],
  ['SSO', 'Single sign-on - logging in with an existing company identity such as Microsoft or Google.'],
  ['Object storage (S3)', 'Durable cloud file storage that survives restarts and is shared across servers.'],
  ['Redis', 'A fast in-memory store used for caching, rate-limiting, sessions, and job queues.'],
  ['Background worker', 'A separate process that runs heavy work (engine, email, PDF) outside the web request.'],
]
table(['Term', 'Meaning'], glossary, [120, CONTENT_W - 120])

// ============================================================================
// FAQ
// ============================================================================
section('Frequently Asked Questions')
const faq = (q, a) => { subsub(q); para(a) }
faq('Do we need to write new code for each organization?',
  'No. An organization is a data record, not new code. You build the onboarding path once; after that, every new organization is created as data (an Organization record plus its first admin), exactly like adding a new user.')
faq('Do we need a domain or subdomains to support many organizations?',
  'No. Because each user belongs to exactly one organization, the app reads the orgId from the logged-in user and carries it in the token. Subdomains and custom domains are optional and mainly for branding; you can start entirely on your existing URL, even locally.')
faq('Will existing data break when we add orgId?',
  'No, provided you run the one-time migration that assigns a default orgId to all current records. After that, everything is scoped normally.')
faq('How do we guarantee one organization cannot see another data?',
  'By adding a single central scoping layer that automatically filters every query by orgId, plus automated isolation tests. Making the filter automatic - rather than relying on each developer to remember it - is what makes isolation reliable.')
faq('Can the same person belong to two organizations?',
  'Yes, once email is made unique per organization (compound-unique on orgId plus email). A person can then exist independently in, say, both Acme and Globex.')
faq('What should we build first?',
  'Phase 1: multi-tenancy, password reset, login rate-limiting and MFA, token revocation, durable uploads, and production email - plus the quick wins of conditional form logic and validation, since the data model already supports them.')

// ============================================================================
// 8. APPENDIX
// ============================================================================
section('Appendix: Feature Status')
para('A quick reference of everything, grouped, with status and rough priority. Legend: Built, Partial, Pending.')
table(
  ['Area', 'Feature', 'Status', 'Priority'],
  [
    ['Core', 'Login + roles/RBAC + Admin Panel', 'Built', '-'],
    ['Core', 'Form builder (11 field types)', 'Built', '-'],
    ['Core', 'Form templates + AI form builder + auto-fill', 'Built', '-'],
    ['Core', 'Public (no-login) forms + responses + CSV', 'Built', '-'],
    ['Core', 'Workflow canvas + engine (9 node types)', 'Built', '-'],
    ['Core', 'Approvals (approve/reject/changes) + chain + history', 'Built', '-'],
    ['Core', 'E-signatures + signed-PDF generation', 'Built', '-'],
    ['Core', 'Submit-node inline forms; specific-person approver', 'Built', '-'],
    ['Core', 'Task inbox + notifications (sort/delete)', 'Built', '-'],
    ['Core', 'Analytics + CSV/Excel/PDF export + audit log', 'Built', '-'],
    ['Core', 'SLA escalation, Out-of-Office, delegation', 'Built', '-'],
    ['Core', 'AI assistant; access control; triggers; cancellation', 'Built', '-'],
    ['Tenancy', 'Organization model + orgId scoping', 'Pending', 'High'],
    ['Tenancy', 'Per-org departments, roles, branding', 'Pending', 'Medium'],
    ['Security', 'Password reset + email verification', 'Pending', 'High'],
    ['Security', 'Login rate-limit + MFA', 'Pending', 'High'],
    ['Security', 'Token revocation / short-lived tokens', 'Pending', 'High'],
    ['Security', 'SSO (Microsoft / Google)', 'Pending', 'Medium'],
    ['Workflow', 'Parallel / quorum approvals', 'Pending', 'High'],
    ['Workflow', 'Workflow versioning', 'Pending', 'Medium'],
    ['Workflow', 'Integration/webhook node + document node', 'Pending', 'Medium'],
    ['Forms', 'Conditional field logic', 'Partial', 'Medium'],
    ['Forms', 'Advanced validation (length/range/pattern)', 'Partial', 'Medium'],
    ['Forms', 'Save as draft', 'Pending', 'Low'],
    ['Collab', 'Comments/discussion thread + mentions', 'Pending', 'High'],
    ['Collab', 'Teams/Slack/Outlook notifications', 'Pending', 'Medium'],
    ['Self-service', 'Service catalog / request portal', 'Pending', 'High'],
    ['Self-service', 'Teams / groups approvals', 'Pending', 'High'],
    ['Admin', 'Department/org management UI + bulk import', 'Pending', 'Medium'],
    ['Reporting', 'Bottleneck dashboards + scheduled reports', 'Pending', 'Medium'],
    ['Platform', 'Real-time updates', 'Pending', 'Medium'],
    ['Platform', 'Durable uploads (S3)', 'Pending', 'High'],
    ['Platform', 'Production email', 'Pending', 'High'],
    ['Platform', 'Redis + background workers/queue', 'Pending', 'Medium'],
    ['Platform', 'Per-org branding, i18n, dark mode, mobile', 'Pending', 'Low'],
  ],
  [70, 250, 60, 60],
)
para('End of document.', { italic: true, color: MUTE, size: 9 })

// ============================================================================
// FOOTERS
// ============================================================================
const range = doc.bufferedPageRange()
for (let i = range.start; i < range.start + range.count; i++) {
  if (i === 0) continue
  doc.switchToPage(i)
  const savedBottom = doc.page.margins.bottom
  doc.page.margins.bottom = 0
  const yBottom = doc.page.height - 34
  doc.font('Helvetica').fontSize(8).fillColor(MUTE)
  doc.text('NetFlow - Complete Feature & Multi-Tenancy Roadmap', M, yBottom, { lineBreak: false })
  doc.text(`Page ${i + 1} of ${range.count}`, M, yBottom, { width: CONTENT_W, align: 'right', lineBreak: false })
  doc.page.margins.bottom = savedBottom
}

doc.end()
stream.on('finish', () => {
  const kb = (fs.statSync(OUT).size / 1024).toFixed(0)
  console.log(`PDF_DONE path=${OUT} size=${kb}KB pages=${range.count}`)
})
stream.on('error', (err) => { console.error('PDF_ERROR', err.message); process.exit(1) })
