// One-off report generator: builds a manager-ready PDF describing NetFlow's
// current state and everything needed to make it multi-tenant and production
// ready. Uses the pdfkit dependency already installed for signed-approval PDFs.
//
//   Run:  node generate-readiness-pdf.js   (from the /server folder)
//   Out:  ../NetFlow-Production-Readiness.pdf  (workspace root)

const fs = require('fs')
const path = require('path')
const PDFDocument = require('pdfkit')

const OUT = path.join(__dirname, '..', 'NetFlow-Production-Readiness.pdf')

// ---- palette ---------------------------------------------------------------
const INDIGO = '#4f46e5'
const INK = '#111827'
const GRAY = '#374151'
const MUTE = '#9ca3af'
const BORDER = '#e5e7eb'
const PANEL_BG = '#eef2ff'
const PANEL_BR = '#c7d2fe'
const ZEBRA = '#f9fafb'

const M = 54 // page margin

const doc = new PDFDocument({ size: 'A4', margin: M, bufferPages: true })
const stream = fs.createWriteStream(OUT)
doc.pipe(stream)

const PAGE_W = doc.page.width
const CONTENT_W = PAGE_W - M * 2

const dateStr = new Date().toLocaleDateString('en-GB', {
  day: '2-digit', month: 'long', year: 'numeric',
})

// ---- layout helpers --------------------------------------------------------
const ensureSpace = (h) => {
  if (doc.y + h > doc.page.height - M) doc.addPage()
}

const section = (num, title) => {
  doc.addPage()
  doc.fillColor(INDIGO).font('Helvetica-Bold').fontSize(16).text(`${num}. ${title}`, M, doc.y)
  const y = doc.y + 3
  doc.moveTo(M, y).lineTo(M + CONTENT_W, y).lineWidth(1.2).strokeColor(INDIGO).stroke()
  doc.moveDown(0.7)
  doc.x = M
  doc.fillColor(INK)
}

const h2 = (title) => {
  ensureSpace(34)
  doc.moveDown(0.4)
  doc.fillColor(INK).font('Helvetica-Bold').fontSize(12).text(title, M, doc.y)
  doc.moveDown(0.25)
  doc.x = M
}

const para = (text, { italic = false, size = 10, color = GRAY } = {}) => {
  doc.font(italic ? 'Helvetica-Oblique' : 'Helvetica').fontSize(size).fillColor(color)
  ensureSpace(doc.heightOfString(text, { width: CONTENT_W }))
  doc.text(text, M, doc.y, { width: CONTENT_W })
  doc.moveDown(0.4)
  doc.x = M
  doc.fillColor(INK)
}

const labeled = (label, text) => {
  doc.font('Helvetica-Bold').fontSize(10).fillColor(INK)
  ensureSpace(doc.heightOfString(`${label}: ${text}`, { width: CONTENT_W }) + 2)
  doc.text(`${label}: `, M, doc.y, { continued: true })
  doc.font('Helvetica').fillColor(GRAY).text(text)
  doc.moveDown(0.3)
  doc.x = M
  doc.fillColor(INK)
}

const bullet = (text, { indent = 0, bold = false } = {}) => {
  const x = M + 12 + indent
  const w = CONTENT_W - 12 - indent
  doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(10).fillColor(INK)
  const h = doc.heightOfString(text, { width: w })
  ensureSpace(h + 3)
  const y = doc.y
  doc.circle(M + 4 + indent, y + 5, 1.7).fill(INDIGO)
  doc.fillColor(INK).font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(10)
    .text(text, x, y, { width: w })
  doc.moveDown(0.25)
  doc.x = M
}

// Shaded callout box — used for workflow examples and the architecture diagrams.
const panel = (title, lines, {
  bg = PANEL_BG, border = PANEL_BR, titleColor = '#3730a3', mono = false,
} = {}) => {
  const padX = 10, padY = 8
  const innerW = CONTENT_W - padX * 2
  const bodyFont = mono ? 'Courier' : 'Helvetica'
  const bodySize = mono ? 9 : 9.5

  doc.font('Helvetica-Bold').fontSize(9.5)
  let h = padY * 2 + doc.heightOfString(title, { width: innerW }) + 5
  doc.font(bodyFont).fontSize(bodySize)
  for (const ln of lines) h += doc.heightOfString(ln, { width: innerW }) + 3

  ensureSpace(h)
  const y = doc.y
  doc.rect(M, y, CONTENT_W, h).fillAndStroke(bg, border)

  doc.fillColor(titleColor).font('Helvetica-Bold').fontSize(9.5)
    .text(title, M + padX, y + padY, { width: innerW })
  doc.fillColor(GRAY).font(bodyFont).fontSize(bodySize)
  for (const ln of lines) doc.text(ln, M + padX, doc.y + 3, { width: innerW })

  doc.y = y + h + 7
  doc.x = M
  doc.fillColor(INK)
}

// Simple bordered table with a coloured header and zebra rows.
const table = (headers, rows, colW) => {
  const padX = 6, padY = 5
  const totalW = colW.reduce((a, b) => a + b, 0)

  const drawRow = (cells, { bg, bold, color }) => {
    doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(9)
    const heights = cells.map((c, i) =>
      doc.heightOfString(String(c == null ? '' : c), { width: colW[i] - padX * 2 }))
    const rowH = Math.max(...heights, 10) + padY * 2
    ensureSpace(rowH)
    const y = doc.y
    if (bg) doc.rect(M, y, totalW, rowH).fill(bg)
    let x = M
    for (let i = 0; i < cells.length; i++) {
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(9).fillColor(color || INK)
        .text(String(cells[i] == null ? '' : cells[i]), x + padX, y + padY, { width: colW[i] - padX * 2 })
      doc.rect(x, y, colW[i], rowH).strokeColor(BORDER).lineWidth(0.5).stroke()
      x += colW[i]
    }
    doc.y = y + rowH
    doc.x = M
    doc.fillColor(INK)
  }

  drawRow(headers, { bg: INDIGO, bold: true, color: '#ffffff' })
  rows.forEach((r, i) => drawRow(r, { bg: i % 2 ? ZEBRA : '#ffffff', bold: false }))
  doc.moveDown(0.5)
}

// ============================================================================
// COVER
// ============================================================================
doc.rect(0, 0, PAGE_W, 250).fill(INDIGO)
doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(34).text('NetFlow', M, 80)
doc.font('Helvetica').fontSize(13).fillColor('#e0e7ff')
  .text('Workflow & Approval Automation Platform', M, 124)
doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(19)
  .text('Production-Readiness & Multi-Organization Strategy', M, 168, { width: CONTENT_W })

doc.fillColor(INK).font('Helvetica').fontSize(11)
doc.text(`Prepared: ${dateStr}`, M, 300)
doc.moveDown(0.4)
doc.text('Audience: Management / Engineering Leadership', M)
doc.moveDown(0.4)
doc.text('Purpose: A plain-English roadmap to turn NetFlow into a secure, multi-tenant, production-ready product that any organization can use.', M, doc.y, { width: CONTENT_W })

panel('In one sentence', [
  'NetFlow already works as an internal approvals platform. To sell it to many organizations and run it reliably in production, we need three things: Isolation (each org walled off), Trust (secure and reliable), and Fidelity (workflows that match real approvals).',
])

// ============================================================================
// 1. EXECUTIVE SUMMARY
// ============================================================================
section(1, 'Executive Summary')
para('NetFlow is a no-code workflow and approval automation platform. Employees submit requests (leave, purchases, vendor onboarding, and more); the system routes them for approval, captures e-signatures, and archives a signed PDF with a full audit trail. A working product exists today with a rich feature set.')
para('The gap is not core features. It is the foundation required to (a) serve multiple organizations from one deployment without their data ever mixing, (b) meet the security and reliability bar for a system that authorizes money and access, and (c) add a few workflow capabilities that mirror how real committee approvals work.')
para('This document explains what is built, what is missing, why each gap matters (with a concrete workflow example), the target architecture, and a phased roadmap with the business value each phase unlocks.')

panel('The three themes (use these with your manager)', [
  'Isolation - many organizations safely share one app (multi-tenancy).',
  'Trust - safe and reliable enough to approve money and access (security, tests, monitoring).',
  'Fidelity - digital approvals match reality (parallel approvals, conditional forms, integrations, real-time).',
])

// ============================================================================
// 2. WHAT NETFLOW IS
// ============================================================================
section(2, 'What NetFlow Is (and who it is for)')
para('NetFlow replaces email-and-spreadsheet approval chasing with a structured, auditable process. A non-technical admin builds a form and an approval workflow on a visual canvas; employees submit; approvers act with an e-signature; the outcome is recorded and archived automatically.')
h2('Every organization has these workflows')
table(
  ['Department', 'Example workflow it replaces'],
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

// ============================================================================
// 3. CURRENT STATE
// ============================================================================
section(3, 'Current State - What Is Already Built')
para('NetFlow is demo-ready. The following capabilities exist and work today:')
bullet('Form builder with many field types: text, dropdown, date, file, signature, number, checkbox, radio, and a dynamic grid/table.')
bullet('Visual workflow canvas and a working engine: start, approval, submit, review, condition (branching), notification, timer, assignment, and end nodes.')
bullet('E-signatures on approvals, plus an optional auto-generated signed PDF of the completed request.')
bullet('Task inbox, in-app notifications, and a full audit log.')
bullet('Analytics dashboard with CSV, Excel, and PDF export.')
bullet('SLA escalation (scheduled job), Out-of-Office auto-reassignment, and delegation / approval routing.')
bullet('Public (unauthenticated) forms to collect data from non-users, like a Google Form.')
bullet('AI form builder (describe a form in words) and an AI assistant chatbot for status questions.')
para('Stack: React 19 + Vite + Tailwind (frontend, deployed on Vercel); Node.js + Express 5 + MongoDB/Mongoose (backend); pdfkit, nodemailer, and node-cron for PDFs, email, and scheduled jobs.', { italic: true, color: MUTE, size: 9 })

// ============================================================================
// 4. THE VISION - MULTI-TENANCY
// ============================================================================
section(4, 'The Vision: One Platform for Every Organization')
para('Today the app is single-tenant: all users live in one shared space, email is globally unique, and departments are a fixed hard-coded list. That means it can serve exactly one company. To serve many, we introduce multi-tenancy - a single deployment that securely hosts many independent organizations, each seeing only its own data (like acme.netflow.app vs globex.netflow.app).')
h2('Choosing a tenancy model')
table(
  ['Model', 'Isolation', 'Cost / Ops', 'Best for'],
  [
    ['Shared DB + tenantId (recommended start)', 'Logical (row-level)', 'Lowest', 'SMB and most SaaS'],
    ['Database / collection per tenant', 'Strong', 'Medium', 'Mid-market; easy per-tenant backup'],
    ['Dedicated deployment (silo)', 'Physical', 'Highest', 'Enterprise / regulated / data residency'],
  ],
  [150, 95, 80, CONTENT_W - 325],
)
h2('What the recommended model requires')
bullet('A new Organization model (name, subdomain/slug, plan, branding, settings, SSO config).')
bullet('An indexed orgId on every collection (users, roles, forms, responses, workflows, executions, tasks, notifications, audit logs).')
bullet('Change email from globally unique to a compound-unique { orgId, email } - so the same person can exist in two orgs.')
bullet('Per-org departments and roles instead of the hard-coded list.')
bullet('Tenant-resolver middleware that auto-filters every database query by orgId, making cross-tenant access impossible by construction.')
bullet('Automated isolation tests proving Org A can never read Org B data.')

// ============================================================================
// 5. GAP ANALYSIS
// ============================================================================
section(5, 'Gap Analysis - What Is Missing, and Why It Matters')
para('Each gap below is grouped by theme. For every point: what it is, the current state in NetFlow, why it matters, and a concrete workflow example that shows the gap biting.')

const gap = (g) => {
  h2(g.title)
  if (g.what) labeled('What it is', g.what)
  if (g.current) labeled('Current state', g.current)
  if (g.why) labeled('Why it matters', g.why)
  if (g.example) panel('Workflow example', [g.example])
}

doc.moveDown(0.2)
doc.font('Helvetica-Bold').fontSize(13).fillColor(INDIGO).text('Theme A - Isolation', M)
doc.moveDown(0.2); doc.fillColor(INK)
gap({
  title: 'A1. Multi-tenancy (organization isolation)',
  what: 'One deployment securely serving many organizations, each seeing only its own data.',
  current: 'No tenant concept exists; email is globally unique and departments are hard-coded, so the app serves exactly one company.',
  why: 'Without it we cannot onboard a second customer, and any org would see another org data.',
  example: 'Acme and Globex both sign up. Globex HR logs in and sees Acme workflows, Acme employees in the approver dropdown, and Acme leave requests in analytics. There is no wall between them.',
})

doc.moveDown(0.2)
doc.font('Helvetica-Bold').fontSize(13).fillColor(INDIGO).text('Theme B - Trust', M)
doc.moveDown(0.2); doc.fillColor(INK)
gap({
  title: 'B1. Forgot / reset password',
  what: 'Self-service password reset via an emailed, expiring one-time link.',
  current: 'Only register, login, me, and logout exist. There is no reset route.',
  why: 'A user who forgets their password is locked out until an admin intervenes - a daily support burden at scale.',
  example: 'A finance manager returns from leave, forgets her password, and has 12 invoice approvals overdue. Today she must email IT and wait; the invoices breach SLA. With reset, she is back in two minutes.',
})
gap({
  title: 'B2. Login rate-limiting and MFA',
  what: 'Throttle login attempts and add a second factor (one-time code).',
  current: 'Rate-limiting exists only on public form routes; the login endpoint has none, and there is no MFA.',
  why: 'The login endpoint can be brute-forced, and this system authorizes money and access.',
  example: 'An attacker scripts thousands of password guesses against the CFO account, unthrottled. If they succeed they can approve a fake vendor payment. Rate-limit plus MFA makes this impractical.',
})
gap({
  title: 'B3. Token revocation (real logout)',
  what: 'The ability to invalidate a session on the server.',
  current: 'Tokens are stateless and valid for 7 days; logout only asks the client to forget the token.',
  why: 'A leaked or stolen token cannot be killed - it stays valid for up to a week, even after logout or account deactivation.',
  example: 'An employee is terminated and deactivated, but their browser still holds a valid token and can keep approving requests until it expires. Server-side revocation makes deactivation instant.',
})
gap({
  title: 'B4. Automated tests and CI/CD',
  what: 'A test suite plus an automated build/deploy pipeline.',
  current: 'There are no tests and no CI pipeline; deploys are manual.',
  why: 'Any change can silently break the approval engine - the one part that must be correct.',
  example: 'Adding quorum approvals accidentally breaks the single-approver path, so leave requests auto-approve with no one acting. Tests would fail the build before it ships.',
})
gap({
  title: 'B5. Durable file storage and production email',
  what: 'Store uploads in object storage (S3) and send mail via a real provider.',
  current: 'Uploads are written to a local folder; email points at Mailtrap (a dev sandbox that never delivers).',
  why: 'On cloud hosting the local disk is wiped on redeploy, and sandbox email never reaches users.',
  example: 'A GRN workflow attaches a scanned delivery note; after a nightly redeploy the attachment link is 404. Meanwhile the assignee never gets the email that a task is waiting, so it breaches SLA.',
})
gap({
  title: 'B6. Monitoring and error tracking',
  what: 'Structured logging, metrics, and alerting (e.g., Sentry).',
  current: 'Only development-style console logging exists.',
  why: 'Outages are discovered by users, not alerts.',
  example: 'The engine throws on a malformed node at 2 AM and executions silently stop advancing. You learn at 10 AM from angry approvers instead of being paged immediately.',
})
gap({
  title: 'B7. Workflow versioning',
  what: 'Editing a published workflow creates a new version; in-flight requests keep running on the version they started with.',
  current: 'A workflow is a single mutable document with no per-execution version pin.',
  why: 'Editing a live workflow can corrupt requests that are half-finished.',
  example: '30 leave requests are mid-approval when HR inserts a new director sign-off step. Those 30 now have an inconsistent path. With versioning they finish on v1; only new requests use v2.',
})

doc.moveDown(0.2)
doc.font('Helvetica-Bold').fontSize(13).fillColor(INDIGO).text('Theme C - Fidelity', M)
doc.moveDown(0.2); doc.fillColor(INK)
gap({
  title: 'C1. Parallel / quorum approvals',
  what: 'A single stage needing multiple approvers - all in parallel, or a quorum such as any 2 of 3.',
  current: 'An approval node resolves one approver and one task; the stored approvalType is not acted on by the engine.',
  why: 'Real approvals are often committee-based; today you can only chain them slowly and cannot express any N of M.',
  example: 'A large capital expense must be approved by any 2 of {CFO, COO, CEO} at the same time. Today this is impossible; you would chain all three in sequence. A quorum node fans out three tasks and advances as soon as two approve.',
})
gap({
  title: 'C2. Conditional form logic (declared but not enforced)',
  what: 'Show or hide a field based on another answer.',
  current: 'The form model declares conditionalLogic, but the fill-time renderer ignores it and shows every field.',
  why: 'Forms become long and confusing; adaptive forms are impossible.',
  example: 'A Travel Request has "International trip? Yes/No". If Yes it should reveal passport and visa fields. Today those fields always show, even for a domestic train trip.',
})
gap({
  title: 'C3. Advanced validation (declared but not enforced)',
  what: 'Rules beyond required: length limits, numeric ranges, and format patterns (email, phone, account number).',
  current: 'The model declares validation rules, but fill-time validation checks only whether required fields are filled.',
  why: 'Malformed data flows straight into approvals and cannot be fixed downstream.',
  example: 'A reimbursement form needs an 11-16 digit account number. A user types "my HDFC acct" and it sails through to Finance, who must reject and restart the whole workflow.',
})
gap({
  title: 'C4. Save as draft',
  what: 'Save a partially filled form and finish later.',
  current: 'Submission is all-or-nothing; there is no draft response.',
  why: 'Long forms plus interruptions cause lost work and abandonment.',
  example: 'An ops lead is 80% through a 40-field vendor-onboarding form, gets pulled into a meeting, the tab closes, and all input is lost.',
})
gap({
  title: 'C5. Integration / webhook node',
  what: 'A workflow node that calls an external system (ERP, payments, Slack).',
  current: 'The api and document node types are stubbed - logged and skipped.',
  why: 'An approval outcome usually needs to do something in another system.',
  example: 'A vendor payment gets final approval and should post to the accounting API and notify a Slack channel. Today the api node does nothing, so someone re-keys the payment by hand.',
})
gap({
  title: 'C6. Real-time updates',
  what: 'The UI updates instantly when something changes server-side (WebSocket/SSE).',
  current: 'The frontend polls or refreshes manually; there is no socket layer.',
  why: 'Approvers do not see new tasks until they refresh; dashboards look stale.',
  example: 'The CEO waits on the approvals page; the submitter clicks Submit; the CEO inbox shows nothing until a manual refresh, prompting a phone call to confirm. Real-time makes the task appear instantly.',
})

// ============================================================================
// 6. PRODUCTION-READINESS CHECKLIST
// ============================================================================
section(6, 'Production-Readiness Checklist')
h2('Security')
bullet('Password reset, email verification, login rate-limiting, MFA, and server-side token revocation.')
bullet('Secrets in a managed vault (not committed env files); rotate API keys.')
bullet('Per-tenant data isolation enforced and tested.')
h2('Reliability and scale')
bullet('Stateless API behind a load balancer; Redis for cache, sessions, and distributed rate-limiting.')
bullet('Background worker queue for the engine, emails, and PDF generation (off the request path).')
bullet('MongoDB replica set (shard by orgId at scale); object storage for uploads.')
h2('Operations')
bullet('Automated tests, CI/CD, containerized deploys.')
bullet('Monitoring, error tracking, structured logs, health checks, and alerting.')
bullet('Backups, data-retention policy, and an incident runbook.')

// ============================================================================
// 7. ARCHITECTURE
// ============================================================================
section(7, 'Architecture: Today vs Target')
h2('Today (single instance)')
panel('Current architecture', [
  'Browser (SPA)  ->  React 19 + Vite, hosted on Vercel',
  '      |   REST /api + JWT',
  'Express 5 API  (single instance)',
  '      |-- MongoDB (Mongoose)',
  '      |-- Workflow Engine   (runs in-process)',
  '      |-- LLM: NVIDIA / Gemini',
  '      |-- Email: nodemailer -> Mailtrap (dev sandbox)',
  '      |-- Uploads: local /uploads folder (ephemeral)',
  'node-cron: SLA escalation (in-process)',
], { mono: true, bg: '#f8fafc', border: BORDER, titleColor: INK })
h2('Target (production, multi-tenant)')
panel('Target architecture', [
  'Browser (acme.netflow.app)  ->  CDN + SPA',
  '      ->  API Gateway / Load Balancer',
  '      ->  Stateless API nodes  (xN)',
  '             |-- Redis: cache, rate-limit, sessions',
  '             |-- MongoDB: replica set, sharded by orgId',
  '             |-- Object storage (S3): durable uploads',
  '             |-- Queue (BullMQ)  ->  Workers: engine, email, PDF, cron',
  '             |-- Secrets manager',
  '             |-- Observability: logs, metrics, tracing, Sentry',
], { mono: true, bg: '#f8fafc', border: BORDER, titleColor: INK })
para('Key shifts: from a single in-process server to stateless API nodes behind a load balancer; heavy work (engine, email, PDF) moves to background workers; uploads move to durable object storage; and Redis provides shared caching and rate-limiting that works across instances.')

// ============================================================================
// 8. PHASED ROADMAP
// ============================================================================
section(8, 'Phased Roadmap')
para('Effort labels are rough planning estimates, not commitments. Phase 1 is the critical foundation that makes NetFlow sellable to multiple organizations and safe for production.')
table(
  ['Phase', 'Focus', 'Key items', 'Business value'],
  [
    ['1 - Foundation', 'Multi-org + safe', 'orgId tenancy, password reset, login rate-limit + MFA, token revocation, S3 uploads, production email, test + CI baseline', 'Can onboard multiple customers; safe for real use'],
    ['2 - Scale + Enterprise', 'Grow + sell up', 'Redis + workers/queue, SSO/SAML + provisioning, billing/plans, real-time notifications, monitoring', 'Handles load; wins larger customers'],
    ['3 - Depth + Compliance', 'Match reality', 'Parallel/quorum approvals, workflow versioning, integration node, conditional form logic, audit retention, data residency', 'Fits complex orgs; enterprise/compliance ready'],
  ],
  [90, 90, CONTENT_W - 90 - 90 - 150, 150],
)

// ============================================================================
// 9. RISKS OF INACTION
// ============================================================================
section(9, 'Risks of Inaction')
bullet('Commercial: cannot onboard more than one organization, capping revenue.', { bold: false })
bullet('Security: an unthrottled login and non-revocable tokens invite account takeover of approvers who authorize money and access.')
bullet('Data: without tenant isolation, one customer could see another customer data - a legal and reputational event.')
bullet('Reliability: silent engine failures and lost uploads/emails erode trust in the approval record.')
bullet('Adoption: missing real-time updates, conditional forms, and validation push teams back to email and spreadsheets.')

// ============================================================================
// 10. THE ASK & NEXT STEPS
// ============================================================================
section(10, 'The Ask and Next Steps')
para('Recommendation: prioritize Phase 1 as the first milestone. It is the foundation that makes the product multi-tenant and production-safe; Phases 2 and 3 follow based on customer demand.')
bullet('Approve Phase 1 scope and sequencing.')
bullet('Confirm the tenancy model (recommended: shared database with orgId).')
bullet('Provision production infrastructure (managed MongoDB, Redis, object storage, email provider, error tracking).')
bullet('Establish the test + CI baseline before feature work, to protect the approval engine.')

// ============================================================================
// 11. APPENDIX - FEATURE STATUS
// ============================================================================
section(11, 'Appendix: Feature Status')
para('Legend: Built = working today; Partial = present but incomplete; Missing = not yet built.')
table(
  ['Area', 'Feature', 'Status', 'Priority'],
  [
    ['Core', 'Form builder (11 field types)', 'Built', '-'],
    ['Core', 'Workflow engine + canvas', 'Built', '-'],
    ['Core', 'E-signatures + signed PDF', 'Built', '-'],
    ['Core', 'Tasks, notifications, audit log', 'Built', '-'],
    ['Core', 'Analytics + CSV/Excel/PDF export', 'Built', '-'],
    ['Core', 'Public forms, AI builder, AI assistant', 'Built', '-'],
    ['Tenancy', 'Organization model + orgId scoping', 'Missing', 'High'],
    ['Tenancy', 'Subdomain / tenant routing', 'Missing', 'High'],
    ['Tenancy', 'Per-org branding, departments, roles', 'Missing', 'Medium'],
    ['Tenancy', 'Billing / plans (Stripe)', 'Missing', 'Medium'],
    ['Security', 'Forgot/reset password, email verify', 'Missing', 'High'],
    ['Security', 'Login rate-limit + MFA', 'Missing', 'High'],
    ['Security', 'Token revocation / refresh tokens', 'Missing', 'High'],
    ['Security', 'SSO / SAML / SCIM', 'Missing', 'Medium'],
    ['Security', 'Global (distributed) rate limiting', 'Partial', 'High'],
    ['Workflow', 'Parallel / quorum approvals', 'Missing', 'High'],
    ['Workflow', 'Workflow versioning', 'Missing', 'Medium'],
    ['Workflow', 'Integration / webhook node', 'Missing', 'Medium'],
    ['Forms', 'Conditional field logic', 'Partial', 'Medium'],
    ['Forms', 'Advanced validation (length/range/regex)', 'Partial', 'Medium'],
    ['Forms', 'Save as draft', 'Missing', 'Low'],
    ['Platform', 'Real-time updates (WebSocket/SSE)', 'Missing', 'Medium'],
    ['Platform', 'Durable uploads (S3)', 'Missing', 'High'],
    ['Platform', 'Production email provider', 'Missing', 'High'],
    ['DevOps', 'Automated tests', 'Missing', 'High'],
    ['DevOps', 'CI/CD + Docker', 'Missing', 'High'],
    ['DevOps', 'Monitoring + error tracking', 'Missing', 'High'],
  ],
  [80, 247, 70, 90],
)

// ============================================================================
// FOOTERS (page numbers)
// ============================================================================
const range = doc.bufferedPageRange()
for (let i = range.start; i < range.start + range.count; i++) {
  if (i === 0) continue // no footer on the cover
  doc.switchToPage(i)
  // Temporarily drop the bottom margin so writing in the footer band does not
  // make pdfkit auto-append a blank page (a known bufferPages gotcha).
  const savedBottom = doc.page.margins.bottom
  doc.page.margins.bottom = 0
  const yBottom = doc.page.height - 34
  doc.font('Helvetica').fontSize(8).fillColor(MUTE)
  doc.text('NetFlow - Production-Readiness & Multi-Org Strategy', M, yBottom, { lineBreak: false })
  doc.text(`Page ${i + 1} of ${range.count}`, M, yBottom, { width: CONTENT_W, align: 'right', lineBreak: false })
  doc.page.margins.bottom = savedBottom
}

doc.end()
stream.on('finish', () => {
  const kb = (fs.statSync(OUT).size / 1024).toFixed(0)
  console.log(`PDF_DONE path=${OUT} size=${kb}KB pages=${range.count}`)
})
stream.on('error', (err) => {
  console.error('PDF_ERROR', err.message)
  process.exit(1)
})
