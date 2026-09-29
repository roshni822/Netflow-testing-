// One-off report generator: builds a PDF that lists the proposed NEW feature
// enhancements for NetFlow, split into Backend and Frontend, each grouped by
// effort/impact tier. Grounded in the current codebase (what already exists,
// what is stubbed, and what is missing). Uses the pdfkit dependency already
// installed for signed-approval PDFs.
//
//   Run:  node generate-feature-suggestions-pdf.js   (from the /server folder)
//   Out:  ../NetFlow-Feature-Suggestions.pdf         (workspace root)

const fs = require('fs')
const path = require('path')
const PDFDocument = require('pdfkit')

const OUT = path.join(__dirname, '..', 'NetFlow-Feature-Suggestions.pdf')

// ---- palette ---------------------------------------------------------------
const INDIGO = '#4f46e5'
const INK = '#111827'
const GRAY = '#374151'
const MUTE = '#9ca3af'
const BORDER = '#e5e7eb'
const PANEL_BG = '#eef2ff'
const PANEL_BR = '#c7d2fe'
const ZEBRA = '#f9fafb'
const GREEN = '#059669'
const AMBER = '#b45309'
const VIOLET = '#7c3aed'

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

const h2 = (title, color = INK) => {
  ensureSpace(34)
  doc.moveDown(0.4)
  doc.fillColor(color).font('Helvetica-Bold').fontSize(12).text(title, M, doc.y)
  doc.moveDown(0.25)
  doc.x = M
  doc.fillColor(INK)
}

// Coloured tier heading (e.g. "Tier 1 - Quick wins").
const tierHeading = (text, color) => {
  ensureSpace(30)
  doc.moveDown(0.3)
  doc.font('Helvetica-Bold').fontSize(13).fillColor(color).text(text, M)
  doc.moveDown(0.2)
  doc.x = M
  doc.fillColor(INK)
}

const para = (text, { italic = false, size = 10, color = GRAY } = {}) => {
  doc.font(italic ? 'Helvetica-Oblique' : 'Helvetica').fontSize(size).fillColor(color)
  ensureSpace(doc.heightOfString(text, { width: CONTENT_W }))
  doc.text(text, M, doc.y, { width: CONTENT_W })
  doc.moveDown(0.4)
  doc.x = M
  doc.fillColor(INK)
}

const labeled = (label, text, labelColor = INK) => {
  doc.font('Helvetica-Bold').fontSize(10).fillColor(labelColor)
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

// Shaded callout box.
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
const table = (headers, rows, colW, headerBg = INDIGO) => {
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

  drawRow(headers, { bg: headerBg, bold: true, color: '#ffffff' })
  rows.forEach((r, i) => drawRow(r, { bg: i % 2 ? ZEBRA : '#ffffff', bold: false }))
  doc.moveDown(0.5)
}

// Feature block: title + What / Current / Why / Effort+Impact.
const feature = (f) => {
  h2(f.title)
  if (f.what) labeled('What it is', f.what)
  if (f.current) labeled('Current state', f.current)
  if (f.why) labeled('Why it matters', f.why)
  if (f.effort || f.impact) {
    labeled('Effort / Impact', `${f.effort || '-'}  |  Impact: ${f.impact || '-'}`, GREEN)
  }
  doc.moveDown(0.15)
}

// ============================================================================
// COVER
// ============================================================================
doc.rect(0, 0, PAGE_W, 250).fill(INDIGO)
doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(34).text('NetFlow', M, 80)
doc.font('Helvetica').fontSize(13).fillColor('#e0e7ff')
  .text('Workflow & Approval Automation Platform', M, 124)
doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(19)
  .text('Feature Enhancement Suggestions - Frontend & Backend', M, 168, { width: CONTENT_W })

doc.fillColor(INK).font('Helvetica').fontSize(11)
doc.text(`Prepared: ${dateStr}`, M, 300)
doc.moveDown(0.4)
doc.text('Audience: Product / Engineering', M)
doc.moveDown(0.4)
doc.text('Purpose: A grounded list of proposed new features and improvements for NetFlow, split by layer (backend / frontend) and grouped by effort and impact, so the team can pick what to build next.', M, doc.y, { width: CONTENT_W })

panel('How to read this', [
  'Every item lists what it is, the current state in the codebase, why it matters, and a rough effort/impact estimate.',
  'Backend and Frontend are each split into tiers: quick wins (plumbing already exists), high-value, and strategic bets.',
  'Effort labels are rough planning estimates, not commitments.',
])

// ============================================================================
// 1. OVERVIEW
// ============================================================================
section(1, 'Overview')
para('NetFlow is already a mature workflow and approval platform. This document does not repeat what exists; it focuses on the next set of enhancements worth building, and grounds each one in the current code so scope is realistic.')

h2('Already in place (not repeated below)')
bullet('Forms: builder, conditional field logic, advanced validation, drafts, public forms, e-signatures, AI form builder.')
bullet('Workflow engine: start, approval, multi-approval (committee / N-of-M), submit, review, condition, notify, assignment, webhook/API, and end nodes.')
bullet('SLA escalation cron (hourly) and Out-of-Office redirect.')
bullet('Auth & security: JWT, forgot/reset password, email verification, login rate-limiting, MFA (TOTP), token revocation, Microsoft SSO.')
bullet('Users: admin panel, bulk CSV import, roles, departments, manager/HR org chart.')
bullet('Global search (Ctrl+K), in-app + email notifications, audit log, analytics dashboard.')

panel('The three lenses used to prioritise', [
  'Quick win  - the plumbing already exists in the code; finishing it is cheap and high value.',
  'High value - meaningful new capability; medium effort.',
  'Strategic  - larger bets that open new use-cases or customers.',
])

// ============================================================================
// 2. BACKEND ENHANCEMENTS
// ============================================================================
section(2, 'Backend Enhancements')
para('Server-side capabilities. Several items are near-complete because the supporting code (schema fields, helper utilities, the cron scheduler) is already present but not yet wired end-to-end.')

tierHeading('Tier 1 - Quick wins (plumbing already exists)', GREEN)
feature({
  title: '2.1  Timer node - real delays',
  what: 'A workflow node that genuinely waits (e.g. "wait 3 days, then continue / send a reminder").',
  current: 'handleTimerNode in utils/workflowEngine.js only logs and skips ("Timer skipped in Phase 2"); node-cron is already installed and used by the escalation job.',
  why: 'Without it the timer node is a no-op, so reminders and wait-states cannot be built.',
  effort: 'Low-Medium', impact: 'High',
})
feature({
  title: '2.2  Slack / Teams notifications',
  what: 'Post workflow events to a Slack or Teams channel.',
  current: 'A slackWebhookUrl field is declared on the Workflow model but is never used, and utils/webhook.js (interpolate + callWebhook) is already built for the API node.',
  why: 'Teams live in chat; channel notifications drive far faster action than email alone.',
  effort: 'Low', impact: 'High',
})
feature({
  title: '2.3  Document generation node',
  what: 'Generate a PDF mid-flow (not only at the end node).',
  current: 'The document node case in the engine is stubbed - logged and skipped; PDF generation (pdfkit / maybeGeneratePdf) already exists for the end node.',
  why: 'Some steps need a document produced before the flow finishes (e.g. an approval letter to attach downstream).',
  effort: 'Low-Medium', impact: 'Medium',
})
feature({
  title: '2.4  Approve / reject directly from email',
  what: 'A signed magic-link in the notification email so approvers act in one click, without logging in.',
  current: 'Email infrastructure (nodemailer / Brevo) is in place, but every action requires opening the app and signing in.',
  why: 'Removing the login step dramatically cuts approval turnaround, especially for busy executives.',
  effort: 'Medium', impact: 'High',
})
feature({
  title: '2.5  SLA reminders before breach',
  what: 'A nudge to the approver before the deadline (e.g. at 75% of the SLA), not only after it is missed.',
  current: 'jobs/escalationCron.js only reacts after dueDate has already passed (escalates overdue tasks).',
  why: 'Proactive reminders prevent breaches instead of just reacting to them.',
  effort: 'Low', impact: 'High',
})
feature({
  title: '2.6  Server-side export (Excel / CSV / PDF)',
  what: 'Downloadable exports of requests, tasks, and analytics.',
  current: 'Export libraries exist on the frontend (xlsx, jspdf); there is no first-class export endpoint or button set.',
  why: 'Reporting and audits routinely need data outside the app.',
  effort: 'Low', impact: 'Medium',
})

tierHeading('Tier 2 - High value (medium effort)', AMBER)
feature({
  title: '2.7  Inbound & scheduled triggers',
  what: 'Start a workflow from an external system (inbound webhook) or on a schedule (recurring runs).',
  current: 'Workflows can only be triggered by a form submission; the API node is outbound-only. node-cron is available for scheduling.',
  why: 'Integrations and recurring processes (e.g. monthly compliance review) need triggers beyond a human form.',
  effort: 'Medium', impact: 'High',
})
feature({
  title: '2.8  Ad-hoc reassign / delegate a task',
  what: 'Let an approver manually hand a specific task to someone else, with an audit trail.',
  current: 'Out-of-Office redirect and Delegation of Authority exist, but there is no on-the-spot "reassign this task" action.',
  why: 'Real life needs quick, one-off handoffs that are not covered by standing rules.',
  effort: 'Medium', impact: 'Medium',
})
feature({
  title: '2.9  Collaboration - comments & @mentions',
  what: 'A discussion thread on a request with @mention notifications.',
  current: 'Approval comments exist, but there is no general thread or mention system.',
  why: 'Clarifications currently move to email/chat, splitting the record away from the request.',
  effort: 'Medium', impact: 'Medium',
})
feature({
  title: '2.10  Bulk inbox actions & saved filters',
  what: 'Approve/reject multiple tasks at once; save reusable filtered views.',
  current: 'The task inbox acts on one task at a time; there are no saved views.',
  why: 'High-volume approvers waste time on repetitive single actions.',
  effort: 'Medium', impact: 'Medium',
})
feature({
  title: '2.11  Webhook hardening (HMAC signing + retries)',
  what: 'Sign outbound webhook payloads (HMAC) and retry failures with a dead-letter record.',
  current: 'The API node makes a single attempt with no signature.',
  why: 'Receivers cannot verify authenticity, and transient failures silently drop the call.',
  effort: 'Medium', impact: 'Medium',
})
feature({
  title: '2.12  Cycle-time & bottleneck analytics',
  what: 'Per-stage timing to show which node slows requests down the most.',
  current: 'WorkflowExecution stores node logs with timestamps, but this data is not surfaced as stage analytics.',
  why: 'The single most valuable data for process improvement is already being collected - it just is not shown.',
  effort: 'Medium', impact: 'High',
})

tierHeading('Tier 3 - Strategic bets', VIOLET)
feature({
  title: '2.13  Google SSO',
  what: 'Sign in with Google, alongside the existing Microsoft SSO.',
  current: 'Microsoft SSO is implemented; Google is not.',
  why: 'Broadens onboarding for organisations on Google Workspace.',
  effort: 'Low-Medium', impact: 'Medium',
})
feature({
  title: '2.14  Data retention & archival',
  what: 'Auto-archive or purge old executions per a retention policy.',
  current: 'Executions accumulate indefinitely.',
  why: 'Controls database growth and supports compliance / data-minimisation.',
  effort: 'Medium', impact: 'Medium',
})
feature({
  title: '2.15  Form versioning',
  what: 'Editing a published form creates a new version; existing responses keep their original schema.',
  current: 'Workflows are versioned, but forms are not - editing a live form can drift older responses.',
  why: 'Prevents schema drift and preserves the integrity of historical submissions.',
  effort: 'Medium', impact: 'Medium',
})
feature({
  title: '2.16  Public form spam protection',
  what: 'CAPTCHA and rate-limiting on public (unauthenticated) forms.',
  current: 'Public forms are open submission endpoints.',
  why: 'Open endpoints are an abuse/spam vector without protection.',
  effort: 'Low-Medium', impact: 'Medium',
})

// ============================================================================
// 3. FRONTEND ENHANCEMENTS
// ============================================================================
section(3, 'Frontend Enhancements')
para('The UI is already polished - custom SVG charts, clean Tailwind cards, role-based dashboards, and a Ctrl+K global search. These items close specific gaps and raise perceived quality.')

tierHeading('Bucket A - Polish (small, high perceived-quality)', GREEN)
feature({
  title: '3.1  Toast notifications (replace window.alert)',
  what: 'Styled, non-blocking toast messages for success/error feedback.',
  current: 'Native window.alert() is used for feedback (e.g. Forms.jsx, NewForm.jsx).',
  why: 'Native browser alerts look out of place in a polished SaaS app and cannot be branded.',
  effort: 'Low', impact: 'High',
})
feature({
  title: '3.2  Custom confirm modal (replace window.confirm)',
  what: 'A branded confirmation dialog for destructive actions.',
  current: 'Native window.confirm() guards deletes/discards in 8+ places (Forms, Workflows, NewForm, TaskInbox, TaskDetail, NewWorkflow).',
  why: 'Consistent, on-brand, and safer UX; the modal pattern already exists (NewFormModal, ImportUsersDialog).',
  effort: 'Low', impact: 'Medium',
})
feature({
  title: '3.3  Loading skeletons',
  what: 'Shimmer placeholders while data loads.',
  current: 'The dashboard shows a plain "Loading..." string and lists render empty until data arrives.',
  why: 'Skeletons make the app feel faster and more finished.',
  effort: 'Low', impact: 'Medium',
})
feature({
  title: '3.4  Restore the "Welcome back" header',
  what: 'A personalised greeting on the dashboard.',
  current: 'The greeting is present but commented out in Dashboard.jsx.',
  why: 'A small, warm personal touch on the primary landing page.',
  effort: 'Trivial', impact: 'Low',
})

tierHeading('Bucket B - New frontend features', AMBER)
feature({
  title: '3.5  Export buttons (PDF / Excel)',
  what: 'One-click export on Analytics, Form Responses, and Task Inbox.',
  current: 'jspdf, jspdf-autotable, and xlsx are already installed in the frontend - but no export buttons exist.',
  why: 'Near-"free" win because the libraries are already present; reporting is a common need.',
  effort: 'Low', impact: 'Medium',
})
feature({
  title: '3.6  Dark mode',
  what: 'A light/dark theme toggle.',
  current: 'There are zero dark: variants in the codebase today.',
  why: 'A widely expected, high-visibility feature; Tailwind v4 makes it a theme toggle + variants.',
  effort: 'Medium', impact: 'High',
})
feature({
  title: '3.7  Bulk actions in the task inbox',
  what: 'Select multiple tasks and approve/reject together (the UI pair of item 2.10).',
  current: 'The inbox acts on one task at a time.',
  why: 'Saves high-volume approvers significant time.',
  effort: 'Medium', impact: 'Medium',
})
feature({
  title: '3.8  Command palette upgrade',
  what: 'Add actions ("Create form", "New workflow", "Go to...") to the existing Ctrl+K search.',
  current: 'Ctrl+K currently returns search results only, not actions.',
  why: 'Turns search into a fast, keyboard-first command center for power users.',
  effort: 'Low-Medium', impact: 'Medium',
})
feature({
  title: '3.9  Notification preferences UI',
  what: 'Let users choose email vs in-app per event type (in Profile).',
  current: 'Notifications are sent with no per-user channel preference.',
  why: 'Reduces noise and lets users tune what reaches them.',
  effort: 'Medium', impact: 'Medium',
})

tierHeading('Bucket C - Design refresh', VIOLET)
feature({
  title: '3.10  Mobile experience (bottom nav)',
  what: 'A responsive bottom tab bar for small screens.',
  current: 'AppShell.jsx references an employee "bottom tab bar" in comments, but only the sidebar is implemented; it is not ideal on phones.',
  why: 'Approvers often act from a phone; a mobile-first nav improves reach.',
  effort: 'Medium', impact: 'Medium',
})
feature({
  title: '3.11  Richer empty states',
  what: 'Friendly illustrations and a primary call-to-action for empty lists.',
  current: 'Empty states are plain gray text (e.g. "No requests yet").',
  why: 'Guides new users toward the next action and feels more inviting.',
  effort: 'Low', impact: 'Low',
})
feature({
  title: '3.12  White-label / accent theming',
  what: 'A configurable accent color so the app can be branded per organisation.',
  current: 'Indigo is hard-coded throughout the UI.',
  why: 'Enables per-company branding; fits a future multi-tenant direction.',
  effort: 'Medium', impact: 'Medium',
})

// ============================================================================
// 4. RECOMMENDED PRIORITIES
// ============================================================================
section(4, 'Recommended Priorities')
para('If picking a first batch, these give the most value for the least effort - largely because the supporting code already exists.')
h2('Top picks - Backend')
bullet('Timer node real delays (2.1) - turns a dummy node into a real capability.', { bold: true })
bullet('Slack / Teams notifications (2.2) - dead field + existing webhook helper make this the quickest win.', { bold: true })
bullet('Approve / reject from email (2.4) - direct impact on approval speed.', { bold: true })
bullet('SLA reminders before breach (2.5) - prevents breaches instead of reacting.', { bold: true })
bullet('Cycle-time analytics (2.12) - the data is already collected; just surface it.', { bold: true })
h2('Top picks - Frontend')
bullet('Toasts + custom confirm modal (3.1, 3.2) - biggest perceived-quality jump for low effort.', { bold: true })
bullet('Export to PDF / Excel (3.5) - libraries already installed, so nearly free.', { bold: true })
bullet('Dark mode (3.6) - highly visible, widely expected.', { bold: true })

// ============================================================================
// 5. APPENDIX - AT A GLANCE
// ============================================================================
section(5, 'Appendix: At a Glance')
para('Every proposed item with its layer, tier, effort, and impact. Legend for tier: QW = quick win, HV = high value, ST = strategic; A/B/C = frontend buckets.')
table(
  ['#', 'Feature', 'Layer', 'Tier', 'Effort', 'Impact'],
  [
    ['2.1', 'Timer node - real delays', 'Backend', 'QW', 'Low-Med', 'High'],
    ['2.2', 'Slack / Teams notifications', 'Backend', 'QW', 'Low', 'High'],
    ['2.3', 'Document generation node', 'Backend', 'QW', 'Low-Med', 'Medium'],
    ['2.4', 'Approve / reject from email', 'Backend', 'QW', 'Medium', 'High'],
    ['2.5', 'SLA reminders before breach', 'Backend', 'QW', 'Low', 'High'],
    ['2.6', 'Server-side export', 'Backend', 'QW', 'Low', 'Medium'],
    ['2.7', 'Inbound & scheduled triggers', 'Backend', 'HV', 'Medium', 'High'],
    ['2.8', 'Ad-hoc reassign / delegate', 'Backend', 'HV', 'Medium', 'Medium'],
    ['2.9', 'Comments & @mentions', 'Backend', 'HV', 'Medium', 'Medium'],
    ['2.10', 'Bulk inbox actions & filters', 'Backend', 'HV', 'Medium', 'Medium'],
    ['2.11', 'Webhook hardening (HMAC/retry)', 'Backend', 'HV', 'Medium', 'Medium'],
    ['2.12', 'Cycle-time / bottleneck analytics', 'Backend', 'HV', 'Medium', 'High'],
    ['2.13', 'Google SSO', 'Backend', 'ST', 'Low-Med', 'Medium'],
    ['2.14', 'Data retention & archival', 'Backend', 'ST', 'Medium', 'Medium'],
    ['2.15', 'Form versioning', 'Backend', 'ST', 'Medium', 'Medium'],
    ['2.16', 'Public form spam protection', 'Backend', 'ST', 'Low-Med', 'Medium'],
    ['3.1', 'Toast notifications', 'Frontend', 'A', 'Low', 'High'],
    ['3.2', 'Custom confirm modal', 'Frontend', 'A', 'Low', 'Medium'],
    ['3.3', 'Loading skeletons', 'Frontend', 'A', 'Low', 'Medium'],
    ['3.4', 'Restore welcome header', 'Frontend', 'A', 'Trivial', 'Low'],
    ['3.5', 'Export buttons (PDF/Excel)', 'Frontend', 'B', 'Low', 'Medium'],
    ['3.6', 'Dark mode', 'Frontend', 'B', 'Medium', 'High'],
    ['3.7', 'Bulk actions in inbox', 'Frontend', 'B', 'Medium', 'Medium'],
    ['3.8', 'Command palette upgrade', 'Frontend', 'B', 'Low-Med', 'Medium'],
    ['3.9', 'Notification preferences UI', 'Frontend', 'B', 'Medium', 'Medium'],
    ['3.10', 'Mobile bottom nav', 'Frontend', 'C', 'Medium', 'Medium'],
    ['3.11', 'Richer empty states', 'Frontend', 'C', 'Low', 'Low'],
    ['3.12', 'White-label theming', 'Frontend', 'C', 'Medium', 'Medium'],
  ],
  [34, 205, 62, 40, 62, CONTENT_W - 34 - 205 - 62 - 40 - 62],
)

// ============================================================================
// FOOTERS (page numbers)
// ============================================================================
const range = doc.bufferedPageRange()
for (let i = range.start; i < range.start + range.count; i++) {
  if (i === 0) continue // no footer on the cover
  doc.switchToPage(i)
  const savedBottom = doc.page.margins.bottom
  doc.page.margins.bottom = 0
  const yBottom = doc.page.height - 34
  doc.font('Helvetica').fontSize(8).fillColor(MUTE)
  doc.text('NetFlow - Feature Enhancement Suggestions', M, yBottom, { lineBreak: false })
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
