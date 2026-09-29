/** Real UI only. Runtime-only credentials; no fixtures or saved auth state. */
import { chromium } from 'playwright'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT = path.join(ROOT, 'public/screenshots/guide')
const BASE = process.env.APP_URL || 'http://localhost:5173'
const API_ORIGIN = new URL(process.env.NETFLOW_DOCS_API_URL || 'http://localhost:5000').origin
const EMAIL = process.env.NETFLOW_DOCS_EMAIL
const PASSWORD = process.env.NETFLOW_DOCS_PASSWORD
const VIEWPORT = { width: 1440, height: 900 }
if (!EMAIL || !PASSWORD) throw new Error('Set NETFLOW_DOCS_EMAIL and NETFLOW_DOCS_PASSWORD in this process environment.')
const requested = new Set((process.env.NETFLOW_DOCS_ONLY || '').split(',').filter(Boolean))
const want = name => !requested.size || requested.has(name)
const report = { capturedAt: new Date().toISOString(), viewport: VIEWPORT, role: 'Organization Admin · Builder', screenshots: [], blockedWrites: [] }
const browser = await chromium.launch({ headless: true, channel: process.env.NETFLOW_DOCS_BROWSER || 'msedge' })

async function newPage() {
  const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1, colorScheme: 'light', reducedMotion: 'reduce' })
  // No save, publish, share, approve, read-status, or account-setting writes.
  await context.route('**/*', route => {
    const request = route.request(), url = new URL(request.url())
    const login = request.method() === 'POST' && [new URL(BASE).origin, API_ORIGIN].includes(url.origin) && url.pathname === '/api/auth/login'
    // This POST is a read-only query (server/routes/forms.js): it resolves the
    // preview with audit:false and creates no response, run, task, or event.
    const preview = request.method() === 'POST' && [new URL(BASE).origin, API_ORIGIN].includes(url.origin) && /^\/api\/forms\/[a-f0-9]{24}\/approval-preview$/i.test(url.pathname)
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method()) && !login && !preview) {
      report.blockedWrites.push({ method: request.method(), route: url.pathname.replace(/[a-f0-9]{24}/gi, ':id') })
      return route.abort()
    }
    return route.continue()
  })
  const page = await context.newPage()
  page.setDefaultTimeout(12000)
  page.setDefaultNavigationTimeout(45000)
  return page
}
async function settle(page) {
  await page.waitForLoadState('networkidle')
  await page.evaluate(() => document.fonts.ready)
  await page.locator('[aria-busy="true"]:visible').first().waitFor({ state: 'hidden' })
  await page.waitForTimeout(450)
}
async function go(page, route) {
  // Mounted SPA navigation retains auth; the app's route guards still apply.
  await page.evaluate(next => { history.pushState({}, '', next); dispatchEvent(new PopStateEvent('popstate')) }, route)
  await settle(page)
  if (new URL(page.url()).pathname !== route.split('?')[0]) throw new Error('Unexpected route')
}
async function shot(page, name, expected, options = {}) {
  if (!want(name)) return
  await expected.waitFor({ state: 'visible' })
  await settle(page)
  if (await page.locator('#tour-title').isVisible()) throw new Error('Tour still open')
  await page.evaluate(() => {
    document.querySelectorAll('[data-docs-private]').forEach(el => el.removeAttribute('data-docs-private'))
    for (const el of document.querySelectorAll('input, textarea')) {
      if (el.value && (el.type === 'password' || /@|https?:\/\/|token|secret/i.test(el.value))) el.setAttribute('data-docs-private', '')
    }
  })
  const mask = [page.locator('[data-docs-private]'), page.getByText(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/i), page.locator('.nf-user-button > div:first-child, .nf-user-button p:first-child'), ...(options.mask || []).map(s => page.locator(s))]
  const buffer = await (options.target || page).screenshot({ animations: 'disabled', mask, maskColor: '#cbd5e1', ...(options.target ? {} : { fullPage: false, ...(options.clip ? { clip: options.clip } : {}) }) })
  fs.writeFileSync(path.join(OUT, `${name}.png`), buffer)
  report.screenshots.push({ name, status: 'captured', route: new URL(page.url()).pathname.replace(/[a-f0-9]{24}/gi, ':id'), state: options.state || name, sha256: createHash('sha256').update(buffer).digest('hex') })
  console.log(`Captured ${name}`)
}
async function job(names, callback) {
  if (!names.some(want)) return
  try { await callback() } catch (error) {
    for (const name of names.filter(want)) if (!report.screenshots.some(item => item.name === name)) report.screenshots.push({ name, status: 'pending', reason: 'Expected live screen unavailable; old asset was not overwritten.' })
    // Raw errors may include private values/URLs; never publish them.
    console.log(`Pending ${names.join(', ')} (${error.name})`)
  }
}

try {
  const publicPage = await newPage()
  for (const [name, route, selector, state] of [
    ['login', '/login', '#email', 'Blank sign-in form'],
    ['login-workspace', '/login?org=netlink', '#email', 'Workspace sign-in form'],
    ['forgot-password', '/forgot-password', 'input[type="email"]', 'Recovery request form; no email sent'],
    ['reset-password', '/reset-password', 'main', 'Missing reset link; not the new-password form'],
  ]) await job([name], async () => {
    await publicPage.goto(`${BASE}${route}`, { waitUntil: 'networkidle' })
    await shot(publicPage, name, publicPage.locator(selector).first(), { state })
  })
  await publicPage.context().close()
  const page = await newPage()
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
  await page.locator('#email').fill(EMAIL)
  await page.locator('#password').fill(PASSWORD)
  await page.getByRole('button', { name: 'Sign In', exact: true }).click()
  await page.waitForURL('**/dashboard')
  await page.locator('aside').first().waitFor()
  const skip = page.getByRole('button', { name: 'Skip', exact: true })
  if (await skip.waitFor({ state: 'visible', timeout: 8000 }).then(() => true, () => false)) await skip.click()
  await settle(page)
  if (!(await page.locator('.nf-user-button').innerText()).includes('Organization Admin')) throw new Error('Organization Admin account required.')
  await job(['dashboard-builder'], async () => {
    await page.evaluate(() => { window.scrollTo(0, 0); document.querySelector('main')?.scrollTo(0, 0) })
    await shot(page, 'dashboard-builder', page.getByRole('heading', { name: /Good .*Netlink/ }), { mask: ['main h1'], state: 'Organization Admin dashboard' })
  })

  await job(['forms-list', 'forms-share'], async () => {
    await go(page, '/forms')
    await page.locator('.nf-forms-cell-title').first().waitFor()
    await shot(page, 'forms-list', page.getByRole('heading', { name: 'Forms', exact: true }))
    const row = page.locator('tr').filter({ has: page.getByRole('button', { name: /^Share / }) }).first()
    await shot(page, 'forms-share', row, { target: row, state: 'Published form Share control; sharing not activated' })
  })
  await job(['forms-new'], async () => {
    await go(page, '/forms')
    await page.getByRole('button', { name: 'Create form', exact: true }).click()
    await shot(page, 'forms-new', page.getByRole('heading', { name: 'Create a new form', exact: true }))
    await page.keyboard.press('Escape')
  })
  await job(['forms-builder', 'forms-fill', 'forms-responses'], async () => {
    await go(page, '/forms')
    await page.locator('.nf-forms-cell-title').first().click()
    await page.waitForURL(/\/forms\/[^/]+\/edit$/)
    const id = new URL(page.url()).pathname.split('/')[2]
    await shot(page, 'forms-builder', page.getByRole('button', { name: /Save/ }).first(), { state: 'Existing form builder; no edits saved' })
    await go(page, `/forms/${id}/fill`)
    await shot(page, 'forms-fill', page.getByRole('heading', { name: /GRN/ }).first(), { mask: ['.nf-fill-route-stage > p'], state: 'Published form; no submission' })
    await go(page, `/forms/${id}/responses`)
    await shot(page, 'forms-responses', page.getByRole('button', { name: /Export CSV/ }), { mask: ['tbody td:not(:first-child):not(:last-child)'], state: 'Existing form responses; empty state if no submissions' })
  })
  await job(['workflows-list'], async () => {
    await go(page, '/workflows')
    await page.locator('.nf-forms-cell-title').first().waitFor()
    await shot(page, 'workflows-list', page.getByRole('heading', { name: 'Workflows', exact: true }))
  })
  await job(['workflows-wizard'], async () => {
    await go(page, '/workflows/new')
    await shot(page, 'workflows-wizard', page.getByRole('heading', { name: 'Choose a template', exact: true }))
  })
  await job(['workflows-canvas', 'workflows-settings', 'workflows-publish'], async () => {
    await go(page, '/workflows')
    await page.locator('.nf-forms-cell-title').filter({ hasText: 'GRN & Costing Approval Workflow' }).click()
    await page.waitForURL(/\/workflows\/[^/]+\/edit$/)
    await shot(page, 'workflows-canvas', page.getByRole('button', { name: 'Continue', exact: true }), { state: 'Existing workflow canvas; unchanged' })
    await page.getByRole('button', { name: 'Continue', exact: true }).click()
    await shot(page, 'workflows-settings', page.getByRole('heading', { name: /Settings/ }).first(), { state: 'Settings and triggers; unchanged' })
    await page.getByRole('button', { name: 'Continue', exact: true }).click()
    await shot(page, 'workflows-publish', page.getByRole('heading', { name: 'Review', exact: true }), { state: 'Review before publishing; Publish not clicked' })
  })
  await job(['workflows-executions'], async () => {
    await go(page, '/workflows')
    await page.getByRole('button', { name: /^View runs for / }).first().click()
    await shot(page, 'workflows-executions', page.getByRole('heading', { name: 'Analytics & reports', exact: true }), { state: 'View runs opens Analytics & reports, not an executions drawer' })
  })
  const taskMasks = ['main h1', '.nf-task-detail-grid dd', '.nf-task-summary-facts dd', '.nf-task-route-card li', '.nf-task-history-card li', '.nf-task-support-card .nf-task-card-body']
  await job(['tasks-inbox', 'tasks-detail', 'tasks-approve'], async () => {
    await go(page, '/tasks')
    await shot(page, 'tasks-inbox', page.getByRole('heading', { name: 'Approval inbox', exact: true }), { mask: ['tbody td:nth-child(2)', '.nf-approval-request-meta'] })
    await page.getByRole('button', { name: 'View details', exact: true }).first().click()
    await page.waitForURL(/\/tasks\/[^/]+$/)
    await shot(page, 'tasks-detail', page.locator('.nf-task-summary'), { mask: taskMasks, state: 'Completed request detail; no decision taken' })
    if (want('tasks-approve')) {
      await go(page, '/tasks')
      await page.getByRole('tab', { name: 'Team approvals', exact: true }).click()
      await settle(page)
      await page.getByRole('button', { name: 'Review', exact: true }).first().click()
      await page.waitForURL(/\/tasks\/[^/]+$/)
      await page.locator('.nf-task-summary').waitFor()
      await settle(page)
      const approve = page.getByRole('button', { name: 'Approve', exact: true })
      if (await approve.isVisible()) {
        await approve.scrollIntoViewIfNeeded()
        await shot(page, 'tasks-approve', approve, { mask: taskMasks, state: 'Decision controls; no action submitted' })
      } else {
        report.screenshots.push({ name: 'tasks-approve', status: 'pending', reason: 'The accessible pending task shows Approval in progress, without Approve/Reject controls for this account. Requires its authorized approver.' })
      }
    }
  })
  for (const [name, route, heading, masks] of [
    ['team', '/team', 'My team', ['.nf-team-identity strong', '.nf-team-avatar']],
    ['profile', '/profile', 'My profile', ['.nf-profile-avatar', '.nf-profile-identity-copy > h2', '.nf-profile-identity-copy > p', '.nf-profile-person-copy', '.nf-profile-person-avatar', '.nf-profile-report-avatar', '.nf-profile-report-copy']],
    ['change-password', '/change-password', 'Change your password', []],
    ['notifications-list', '/notifications', 'Notifications', ['main li p.text-sm']],
    ['analytics-overview', '/analytics', 'Analytics & reports', []],
    ['audit-log', '/audit-log', 'Audit log', ['tbody td:nth-child(2) .nf-audit-cell-text', '.nf-audit-target']],
  ]) await job([name], async () => {
    await go(page, route)
    await shot(page, name, page.getByRole('heading', { name: heading, exact: true }).first(), { mask: masks })
  })
  await job(['notifications-bell'], async () => {
    await go(page, '/dashboard')
    await page.getByRole('button', { name: /^Notifications(?:,|$)/ }).click()
    const dialog = page.getByRole('dialog', { name: 'Notifications', exact: true })
    await dialog.waitFor()
    const box = await dialog.boundingBox()
    await shot(page, 'notifications-bell', dialog, { clip: { x: box.x - 12, y: 0, width: box.width + 24, height: box.y + box.height + 12 }, mask: ['main h1', '[role="dialog"][aria-label="Notifications"] li p.text-sm'], state: 'Notification bell and open dropdown; messages masked' })
  })
  for (const [name, reason] of [
    ['dashboard-leader', 'Requires a Leader session; Admin is not a substitute.'],
    ['dashboard-employee', 'Requires an Employee session; Admin is not a substitute.'],
    ['tasks-committee', 'Requires an accessible real committee task; none created for capture.'],
    ...['activity', 'dashboard-superadmin', 'health', 'organizations', 'platform-orgs'].map(name => [name, 'Unreferenced legacy asset; requires SuperAdmin access.']),
  ]) if (want(name)) report.screenshots.push({ name, status: 'pending', reason })
} finally {
  await browser.close()
  const reportPath = path.join(ROOT, 'screenshots-report.json')
  if (requested.size && fs.existsSync(reportPath)) {
    const previous = JSON.parse(fs.readFileSync(reportPath, 'utf8'))
    const updated = new Set(report.screenshots.map(item => item.name))
    report.screenshots = [...previous.screenshots.filter(item => !updated.has(item.name)), ...report.screenshots]
    report.blockedWrites = [...previous.blockedWrites, ...report.blockedWrites]
  }
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n')
  console.log(`${report.screenshots.filter(i => i.status === 'captured').length} captured; ${report.screenshots.filter(i => i.status === 'pending').length} pending. See docs/screenshots-report.json.`)
}
