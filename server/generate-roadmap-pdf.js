// Detailed implementation-roadmap PDF: explains Phases 1-3 with how-it-works,
// step-by-step flows, concrete examples, and everything needed from the client
// (credentials / accounts / decisions). Uses the already-installed pdfkit.
//
//   Run:  node generate-roadmap-pdf.js   (from the /server folder)
//   Out:  ../NetFlow-Implementation-Roadmap.pdf  (workspace root)

const fs = require('fs')
const path = require('path')
const PDFDocument = require('pdfkit')

const OUT = path.join(__dirname, '..', 'NetFlow-Implementation-Roadmap.pdf')

// ---- palette ---------------------------------------------------------------
const INDIGO = '#4f46e5'
const INK = '#111827'
const GRAY = '#374151'
const MUTE = '#9ca3af'
const BORDER = '#e5e7eb'
const ZEBRA = '#f9fafb'

const M = 54
const doc = new PDFDocument({ size: 'A4', margin: M, bufferPages: true })
const stream = fs.createWriteStream(OUT)
doc.pipe(stream)

const PAGE_W = doc.page.width
const CONTENT_W = PAGE_W - M * 2
const dateStr = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' })

// ---- layout helpers --------------------------------------------------------
const ensureSpace = (h) => { if (doc.y + h > doc.page.height - M) doc.addPage() }

const section = (num, title) => {
  doc.addPage()
  doc.fillColor(INDIGO).font('Helvetica-Bold').fontSize(16).text(`${num}. ${title}`, M, doc.y)
  const y = doc.y + 3
  doc.moveTo(M, y).lineTo(M + CONTENT_W, y).lineWidth(1.2).strokeColor(INDIGO).stroke()
  doc.moveDown(0.7); doc.x = M; doc.fillColor(INK)
}

const h2 = (title) => {
  ensureSpace(34); doc.moveDown(0.4)
  doc.fillColor(INK).font('Helvetica-Bold').fontSize(12).text(title, M, doc.y)
  doc.moveDown(0.25); doc.x = M
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

const bullet = (text, { indent = 0, bold = false } = {}) => {
  const x = M + 12 + indent, w = CONTENT_W - 12 - indent
  doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(10).fillColor(INK)
  const h = doc.heightOfString(text, { width: w })
  ensureSpace(h + 3)
  const y = doc.y
  doc.circle(M + 4 + indent, y + 5, 1.7).fill(INDIGO)
  doc.fillColor(INK).font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(10).text(text, x, y, { width: w })
  doc.moveDown(0.25); doc.x = M
}

const panel = (title, lines, { bg = '#eef2ff', border = '#c7d2fe', titleColor = '#3730a3', mono = false } = {}) => {
  const padX = 10, padY = 8, innerW = CONTENT_W - padX * 2
  const bodyFont = mono ? 'Courier' : 'Helvetica', bodySize = mono ? 9 : 9.5
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

const flowPanel = (steps) => panel('Flow', steps.map((s, i) => `${i + 1}. ${s}`), { bg: '#eff6ff', border: '#bfdbfe', titleColor: '#1e40af' })
const examplePanel = (line) => panel('Example', [line], { bg: '#ecfdf5', border: '#a7f3d0', titleColor: '#065f46' })
const needPanel = (line) => panel('What we need from you', Array.isArray(line) ? line : [line], { bg: '#fffbeb', border: '#fde68a', titleColor: '#92400e' })

const table = (headers, rows, colW) => {
  const padX = 6, padY = 5, totalW = colW.reduce((a, b) => a + b, 0)
  const drawRow = (cells, { bg, bold, color }) => {
    doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(9)
    const heights = cells.map((c, i) => doc.heightOfString(String(c == null ? '' : c), { width: colW[i] - padX * 2 }))
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
    doc.y = y + rowH; doc.x = M; doc.fillColor(INK)
  }
  drawRow(headers, { bg: INDIGO, bold: true, color: '#ffffff' })
  rows.forEach((r, i) => drawRow(r, { bg: i % 2 ? ZEBRA : '#ffffff', bold: false }))
  doc.moveDown(0.5)
}

const feature = (g) => {
  h2(g.title)
  if (g.what) labeled('What it is', g.what)
  if (g.how) labeled('How it works', g.how)
  if (g.flow && g.flow.length) flowPanel(g.flow)
  if (g.example) examplePanel(g.example)
  if (g.need) needPanel(g.need)
  else labeled('Needs from you', 'Nothing external - internal engineering only.')
  doc.moveDown(0.15)
}

// ============================================================================
// COVER
// ============================================================================
doc.rect(0, 0, PAGE_W, 250).fill(INDIGO)
doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(32).text('NetFlow', M, 78)
doc.font('Helvetica').fontSize(13).fillColor('#e0e7ff').text('Workflow & Approval Automation Platform', M, 120)
doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(19).text('Implementation Roadmap: Phases 1-3', M, 164, { width: CONTENT_W })
doc.font('Helvetica').fontSize(12).fillColor('#e0e7ff').text('Detailed plan, flows, examples, and what is needed from you', M, 196, { width: CONTENT_W })

doc.fillColor(INK).font('Helvetica').fontSize(11)
doc.text(`Prepared: ${dateStr}`, M, 300)
doc.moveDown(0.4); doc.text('Audience: Management / Engineering Leadership', M)
doc.moveDown(0.4); doc.text('Companion to: NetFlow Production-Readiness & Multi-Organization Strategy.', M, doc.y, { width: CONTENT_W })
panel('How this document is organized', [
  'Each phase lists its items. For every item you get: What it is, How it works, a step-by-step Flow, a concrete Example, and exactly What we need from you (accounts, credentials, or decisions). A consolidated checklist of everything required from your side is in the final section.',
])

// ============================================================================
// 1. HOW TO READ
// ============================================================================
section(1, 'How To Read This Document')
para('The roadmap is delivered in three phases. Phase 1 is the foundation that makes NetFlow multi-tenant and production-safe. Phase 2 adds scale and enterprise selling points. Phase 3 adds workflow depth and compliance. Each phase builds on the previous one.')
table(
  ['Phase', 'Focus', 'Outcome it unlocks'],
  [
    ['1 - Foundation', 'Multi-org + safe', 'Can onboard multiple customers; safe for real production use'],
    ['2 - Scale + Enterprise', 'Grow + sell up', 'Handles load; wins larger customers'],
    ['3 - Depth + Compliance', 'Match reality', 'Fits complex orgs; enterprise / compliance ready'],
  ],
  [130, 110, CONTENT_W - 240],
)
panel('Legend', [
  'Flow = the step-by-step sequence of what happens at runtime.',
  'Example = a real workflow scenario showing the feature in action.',
  'What we need from you = an account, credential, DNS/domain, or a decision required before we can build or ship that item.',
])

// ============================================================================
// 2. PHASE 1
// ============================================================================
section(2, 'Phase 1 - Foundation (Multi-org + Safe)')
labeled('Goal', 'Turn the single-company app into a secure platform that many organizations can use.')
labeled('Unlocks', 'The ability to onboard multiple customers and run NetFlow safely in production.')

feature({
  title: '2.1 Organization tenancy (orgId)',
  what: 'One deployment that securely hosts many organizations, each seeing only its own data.',
  how: 'Add an Organization collection and stamp every record with an indexed orgId. A tenant-resolver middleware derives the orgId from the subdomain (acme.netflow.app) or the user token, then auto-filters every database query by orgId. Email becomes unique per organization instead of globally.',
  flow: [
    'A user visits acme.netflow.app.',
    'Middleware resolves the organization "Acme" from the subdomain.',
    'Login issues a token containing userId and orgId.',
    'Every API request is auto-scoped: all queries get filtered by orgId.',
    'The user sees only Acme forms, workflows, tasks, and analytics.',
  ],
  example: 'Globex HR logs in and cannot see Acme workflows or employees, because every query is walled off by orgId. The same person can exist as a user in both Acme and Globex.',
  need: [
    'Decision: confirm the tenancy model (recommended: shared database with orgId).',
    'A base domain and DNS access to point wildcard subdomains (*.yourdomain.com) plus a wildcard TLS certificate.',
  ],
})

feature({
  title: '2.2 Forgot / reset password',
  what: 'Self-service password reset through an emailed, time-limited link.',
  how: 'A /forgot endpoint stores a hashed one-time token with an expiry on the user and emails a link. A /reset endpoint validates the token and sets the new password, then invalidates the token.',
  flow: [
    'User clicks "Forgot password" and enters their email.',
    'Server emails a one-time link valid for about 30 minutes.',
    'User opens the link and sets a new password.',
    'The token is consumed and can no longer be reused.',
  ],
  example: 'A finance manager back from leave resets her own password in two minutes instead of waiting on IT while approvals breach SLA.',
  need: 'A working production email provider (see item 2.6) and the app public URL used to build the reset link.',
})

feature({
  title: '2.3 Login rate-limiting + MFA',
  what: 'Throttle repeated login attempts and add an optional second factor.',
  how: 'Rate-limit login by IP and email using a Redis counter (for example five attempts per fifteen minutes, then a cool-down). MFA uses TOTP (authenticator app): the user stores a secret once, then enters a six-digit code at login. SMS codes are an optional alternative.',
  flow: [
    'User submits email and password.',
    'Server verifies the password.',
    'If MFA is enabled, the server asks for the six-digit code.',
    'User enters the code from their authenticator app.',
    'Server verifies the code and issues the session token.',
  ],
  example: 'An attacker scripting thousands of guesses at the CFO account is blocked after five tries; even a stolen password fails without the phone code.',
  need: [
    'TOTP (recommended) needs nothing - authenticator apps are free.',
    'Optional SMS codes need a Twilio account (account SID, auth token, sender number).',
    'A Redis instance for shared rate-limit counters (also used in Phase 2).',
  ],
})

feature({
  title: '2.4 Token revocation (real logout)',
  what: 'The ability to invalidate a session on the server, instantly.',
  how: 'Switch to short-lived access tokens (about fifteen minutes) plus refresh tokens stored in Redis. Logout or deactivation deletes the refresh token and denylists the current access token until it expires.',
  flow: [
    'Login issues a short access token and a longer refresh token.',
    'When the access token expires, the client silently refreshes it.',
    'On logout or termination, the server deletes the refresh token and denylists the access token.',
    'Any further request from that session is rejected.',
  ],
  example: 'A terminated employee is locked out immediately, instead of keeping access for up to seven days as happens today.',
  need: 'A Redis instance to hold refresh tokens and the denylist (shared in Phase 2).',
})

feature({
  title: '2.5 Durable file storage (S3)',
  what: 'Store uploaded attachments in durable object storage instead of the local disk.',
  how: 'Replace the local /uploads folder with S3 (or Cloudflare R2). The browser uploads directly using a short-lived pre-signed URL; downloads use short-lived signed URLs. Only the object key is stored in the database.',
  flow: [
    'User attaches a file to a form or task.',
    'Server returns a pre-signed upload URL.',
    'The browser uploads the file directly to object storage.',
    'The object key is saved on the form response.',
    'Downloads are served through a short-lived signed URL.',
  ],
  example: 'A Goods Receipt Note attachment survives a nightly redeploy and is shared across all server instances - no more broken 404 links.',
  need: [
    'An AWS account: S3 bucket name, region, access key ID, and secret access key.',
    'Or Cloudflare R2: account ID, bucket, and API token.',
    'Decision: keep files private with signed URLs (recommended).',
  ],
})

feature({
  title: '2.6 Production email',
  what: 'Real, deliverable transactional email for notifications.',
  how: 'Swap the Mailtrap sandbox for SendGrid or Amazon SES, keeping the existing send interface. Verify a sender domain with SPF and DKIM records so mail lands in the inbox, not spam.',
  flow: [
    'The app triggers an event such as "task assigned".',
    'The mailer sends through the provider API or SMTP.',
    'The provider delivers to the real recipient inbox.',
    'Bounces and opens are visible in the provider dashboard.',
  ],
  example: 'Approvers actually receive "New task assigned" emails, so tasks stop silently breaching SLA because nobody knew about them.',
  need: [
    'A provider account: a SendGrid API key, or AWS SES access key, secret, and region.',
    'A sender email or domain you control, plus DNS access to add SPF and DKIM records.',
  ],
})

feature({
  title: '2.7 Test + CI baseline',
  what: 'Automated tests plus a pipeline that runs them on every change.',
  how: 'Add a test framework (Jest or Vitest) with API and workflow-engine tests, and a GitHub Actions pipeline that lints and tests on every push and pull request, blocking merges that fail.',
  flow: [
    'A developer pushes code or opens a pull request.',
    'The pipeline installs, lints, and runs the test suite.',
    'Green means the change can merge; red blocks it.',
    'Optionally, merges to the main branch auto-deploy.',
  ],
  example: 'A change that accidentally breaks the single-approver path fails the pipeline before it can ever reach production.',
  need: [
    'A GitHub repository and permission to enable Actions and add repository secrets.',
    'A test database connection (an ephemeral or in-memory MongoDB is fine).',
  ],
})

// ============================================================================
// 3. PHASE 2
// ============================================================================
section(3, 'Phase 2 - Scale & Enterprise (Grow + Sell Up)')
labeled('Goal', 'Handle real load and add the features larger customers expect.')
labeled('Unlocks', 'Reliable performance under load and the ability to win bigger, enterprise customers.')

feature({
  title: '3.1 Redis + background workers / queue',
  what: 'A shared cache plus a background job queue with worker processes.',
  how: 'Introduce Redis for caching, sessions, and rate-limiting, and a BullMQ queue. Move heavy work - running the workflow engine, sending email, generating PDFs - into workers so the API responds instantly and failed jobs retry automatically.',
  flow: [
    'A form is submitted; the API enqueues a "run workflow" job and returns immediately.',
    'A worker picks up the job and advances the engine.',
    'The worker sends emails and generates any PDFs.',
    'Failures retry automatically with backoff.',
  ],
  example: 'A spike of 500 submissions at month-end does not slow the interface; the jobs drain steadily in the background.',
  need: 'A managed Redis instance (connection URL and password) - for example Upstash, AWS ElastiCache, or Redis Cloud.',
})

feature({
  title: '3.2 SSO / SAML + user provisioning',
  what: 'Let staff sign in with the company identity provider, and auto-manage accounts.',
  how: 'Add SAML 2.0 or OIDC login (Okta, Microsoft Entra/Azure AD, Google Workspace) and optional SCIM provisioning so users are created, updated, and deactivated automatically.',
  flow: [
    'User clicks "Sign in with SSO".',
    'They are redirected to the company identity provider.',
    'The provider authenticates them and returns a signed assertion.',
    'NetFlow creates or updates the user in that org and signs them in.',
  ],
  example: 'A new hire added in Okta appears in NetFlow automatically with the right role; a departing employee is disabled the moment HR removes them.',
  need: [
    'Per customer org: identity-provider metadata or an OIDC client ID, client secret, and issuer URL.',
    'Agreement on attribute mapping (email, name, groups to roles).',
    'For SCIM provisioning: a provisioning token from the customer.',
  ],
})

feature({
  title: '3.3 Billing / plans',
  what: 'Subscription plans, usage limits, and payments.',
  how: 'Integrate Stripe. Plan tiers gate features and limits; Stripe Checkout collects payment; webhooks keep each org subscription status in sync; the app enforces the tier limits.',
  flow: [
    'An org admin selects a plan.',
    'Stripe Checkout collects payment details.',
    'A Stripe webhook marks the org active on that tier.',
    'The app enforces the tier features and limits.',
  ],
  example: 'A Free tier caps the org at three workflows; upgrading unlocks unlimited workflows plus SSO.',
  need: [
    'A Stripe account: publishable key, secret key, and webhook signing secret.',
    'Decisions on plan tiers, prices, and what each tier includes.',
  ],
})

feature({
  title: '3.4 Real-time notifications',
  what: 'The interface updates instantly, with no manual refresh.',
  how: 'Add a WebSocket (Socket.IO) or Server-Sent-Events channel per user and org. The engine emits events (task assigned, approved) that push straight to connected clients, updating inboxes and badges live. Uses the Phase 2 Redis to work across multiple instances.',
  flow: [
    'The client opens a socket connection using its token.',
    'The server joins it to the correct user and org channels.',
    'When a task is created, the server pushes an event to that user.',
    'The inbox and badges update instantly.',
  ],
  example: 'The CEO sees a new approval appear the instant it is submitted, so no one has to phone to ask "did it go through?"',
  need: 'Nothing beyond the Phase 2 Redis; no external account required.',
})

feature({
  title: '3.5 Monitoring & error tracking',
  what: 'Error tracking, metrics, and alerting so problems surface immediately.',
  how: 'Add Sentry for frontend and backend errors, health checks and an uptime monitor, structured logging, and alerts to Slack or email.',
  flow: [
    'An exception occurs in the app.',
    'Sentry captures the stack trace, context, and release version.',
    'An alert fires to Slack or email.',
    'The team triages from the dashboard.',
  ],
  example: 'A 2 AM engine crash pages the on-call engineer immediately, instead of being discovered at 10 AM by frustrated approvers.',
  need: [
    'A Sentry account (a DSN key).',
    'Optionally an uptime monitor and a Slack incoming-webhook URL for alerts.',
  ],
})

// ============================================================================
// 4. PHASE 3
// ============================================================================
section(4, 'Phase 3 - Depth & Compliance (Match Reality)')
labeled('Goal', 'Add the workflow depth and compliance controls that complex and regulated organizations require.')
labeled('Unlocks', 'A fit for complex org structures and enterprise or compliance requirements.')

feature({
  title: '4.1 Parallel / quorum approvals',
  what: 'A single stage that needs multiple approvers - all of them, or any N of M.',
  how: 'Add an approval mode to the node (all, or any N). The engine fans out several tasks at once and a collector advances the workflow when the rule is met; remaining tasks are closed automatically.',
  flow: [
    'The workflow reaches the quorum node.',
    'The engine creates tasks for CFO, COO, and CEO simultaneously.',
    'As approvals arrive, a counter increases.',
    'When two approvals are reached, the node completes and the remaining task closes.',
  ],
  example: 'A large capital expense clears the moment any two of three executives approve, working in parallel rather than a slow sequential chain.',
})

feature({
  title: '4.2 Workflow versioning',
  what: 'Publishing an edit creates a new version; in-flight requests keep their original version.',
  how: 'Store each published workflow definition immutably as a version. Every execution pins the version it started on; edits create the next version, used only by new requests.',
  flow: [
    'Version 1 is published; requests start running on v1.',
    'An admin edits the workflow, publishing version 2.',
    'Existing in-flight requests finish on v1.',
    'Only new requests use v2.',
  ],
  example: 'Thirty leave requests already mid-approval are not disrupted when HR inserts a new director sign-off step.',
})

feature({
  title: '4.3 Integration / webhook node',
  what: 'A workflow step that calls an external system (ERP, payments, Slack).',
  how: 'Implement the currently stubbed API node: configurable method, URL, headers, and body mapping; credentials kept in a secrets store; automatic retries; and the response mapped back into workflow variables so a later condition can branch on it.',
  flow: [
    'The workflow reaches the integration node.',
    'A worker calls the external endpoint with the mapped data.',
    'The response is saved into workflow variables.',
    'A condition node can then branch on the result.',
  ],
  example: 'On final approval, the workflow posts the payment to the accounting system and notifies a Slack channel automatically - no manual re-keying.',
  need: 'Per integration: the target system endpoint URLs and API keys or tokens (for example the accounting/ERP API and a Slack incoming-webhook URL). These usually come from each customer.',
})

feature({
  title: '4.4 Conditional form logic',
  what: 'Show or hide form fields based on previous answers. (The data model already supports this.)',
  how: 'Wire the existing conditionalLogic definition (dependsOn / showWhen) into the form renderer and the validator, so hidden fields are neither displayed nor required. This is one of the fastest wins because the schema exists already.',
  flow: [
    'The user answers "International trip? Yes".',
    'The passport and visa fields appear.',
    'Validation requires those fields only while they are visible.',
  ],
  example: 'Domestic travelers never see passport fields, and the form stays short and relevant.',
})

feature({
  title: '4.5 Audit retention & integrity',
  what: 'Configurable retention periods and tamper-evident approval history.',
  how: 'Add per-org retention policies with archival and pruning; optionally hash-chain audit entries so tampering is detectable; support legal hold.',
  flow: [
    'Every action is logged with who, when, and the before/after change.',
    'A retention job archives or prunes entries per the org policy.',
    'Compliance exports are produced on demand.',
  ],
  example: 'A regulated customer retains seven years of approval history and can export it for an external audit.',
  need: 'Decisions on retention durations per data type; optionally archival storage (an S3 bucket with lifecycle rules).',
})

feature({
  title: '4.6 Data residency',
  what: 'Store a customer data in a specific geographic region.',
  how: 'Offer region-pinned databases and deployments (the dedicated silo model for enterprise), and route each org to its region.',
  flow: [
    'An EU customer is provisioned in the EU region.',
    'Their subdomain routes to EU infrastructure.',
    'Their data never leaves the region.',
  ],
  example: 'An EU customer keeps all of its data inside the EU to satisfy GDPR.',
  need: 'Decisions on which regions to support, and provisioning of infrastructure in each chosen cloud region.',
})

// ============================================================================
// 5. WHAT WE NEED FROM YOU
// ============================================================================
section(5, 'What We Need From You')
para('This consolidates every account, credential, and decision required across all phases. Items are grouped by the phase in which they are first needed.')
panel('Important - handling credentials safely', [
  'Please do NOT paste secrets (API keys, passwords) into chat or commit them to git. Share them through a private .env file you control or a secrets manager. The application reads all secrets from environment variables, so nothing sensitive is ever hard-coded or stored in the codebase.',
], { bg: '#fef2f2', border: '#fecaca', titleColor: '#991b1b' })

h2('Accounts & credentials')
table(
  ['What to provide', 'Used for', 'Phase'],
  [
    ['Base domain + DNS access (wildcard subdomain + TLS)', 'Multi-tenant routing and email SPF/DKIM', '1'],
    ['Managed MongoDB connection string (e.g., Atlas)', 'Primary database', '1'],
    ['Object storage: AWS S3 (bucket, region, key, secret) or Cloudflare R2', 'Durable file uploads', '1'],
    ['Email provider: SendGrid API key OR AWS SES key/secret/region + verified sender domain', 'Transactional email', '1'],
    ['Optional Twilio (SID, auth token, sender number)', 'SMS one-time codes (only if not using authenticator apps)', '1'],
    ['GitHub repo access + permission to add Actions and secrets', 'Automated tests and CI/CD', '1'],
    ['Managed Redis instance (URL + password)', 'Cache, sessions, rate-limit, queue, real-time', '2'],
    ['Per customer: SSO metadata / OIDC client ID + secret + issuer; SCIM token', 'Enterprise login and user provisioning', '2'],
    ['Stripe account (publishable key, secret key, webhook secret)', 'Billing and subscription plans', '2'],
    ['Sentry DSN (+ optional Slack webhook)', 'Error tracking and alerts', '2'],
    ['Per integration: external system URLs + API keys/tokens; Slack webhook', 'Integration / webhook node', '3'],
    ['Archival storage + regional infrastructure choices', 'Audit retention and data residency', '3'],
  ],
  [250, 177, 60],
)

h2('Decisions we need from you')
bullet('Tenancy model: confirm shared database with orgId (recommended) versus database-per-tenant or dedicated silos.')
bullet('Base domain and subdomain scheme (for example acme.yourproduct.com).')
bullet('Cloud provider preference (AWS, Cloudflare, or other) for storage and hosting.')
bullet('Email provider preference (SendGrid or AWS SES).')
bullet('MFA method: authenticator app (free, recommended) or SMS codes.')
bullet('Which SSO providers to support first (Okta, Microsoft, Google).')
bullet('Plan tiers and pricing for billing.')
bullet('Regions required for data residency, if any.')
bullet('Audit retention durations required by your industry.')

// ============================================================================
// 6. SUGGESTED SEQUENCE
// ============================================================================
section(6, 'Suggested Sequence & Notes')
para('Effort labels are rough planning guidance, not commitments; actual timing depends on scope and review cycles.')
bullet('Start Phase 1 with the test + CI baseline and tenancy, because they protect everything built afterwards.')
bullet('Set up managed MongoDB, object storage, and the email provider early - several Phase 1 items depend on them.')
bullet('Redis is introduced in Phase 2 but underpins rate-limiting, token revocation, queues, and real-time, so provision it as soon as Phase 2 begins.')
bullet('Conditional form logic (4.4) is a quick, high-value win because the data model already supports it - it can be pulled forward if desired.')
bullet('SSO, billing, and data residency are customer-driven; schedule them when a customer requires them.')
panel('Fastest first wins (low effort, high value)', [
  'Conditional form logic and advanced validation (schema already exists).',
  'Production email + durable uploads (removes silent failures immediately).',
  'Password reset + login rate-limiting (closes the biggest security gaps quickly).',
])

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
  doc.text('NetFlow - Implementation Roadmap (Phases 1-3)', M, yBottom, { lineBreak: false })
  doc.text(`Page ${i + 1} of ${range.count}`, M, yBottom, { width: CONTENT_W, align: 'right', lineBreak: false })
  doc.page.margins.bottom = savedBottom
}

doc.end()
stream.on('finish', () => {
  const kb = (fs.statSync(OUT).size / 1024).toFixed(0)
  console.log(`PDF_DONE path=${OUT} size=${kb}KB pages=${range.count}`)
})
stream.on('error', (err) => { console.error('PDF_ERROR', err.message); process.exit(1) })
