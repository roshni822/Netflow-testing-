// Focused dashboard regression tests. All business data lives in harness-owned
// qa-* tenants; requests are served by the real API, not mocked responses.
const h = require('./lib/harness')
const u = require('./lib/uiHarness')
const fs = require('fs')
const path = require('path')
const os = require('os')

h.runSuite('ui_admin_dashboard', async () => {
  if (!(await u.frontendUp())) throw new Error(u.unavailableReason())
  const org = await h.createOrg('dashboard')
  const admin = await h.createUser(org, { name: 'Dashboard Admin', email: h.emailIn(org, 'admin'), roleName: 'Admin', canBuild: true, department: 'IT' })
  const employee = await h.createUser(org, { name: 'Dashboard Employee', email: h.emailIn(org, 'employee'), roleName: 'Employee', department: 'IT', managerId: admin._id })
  const token = await h.getToken({ email: admin.email })
  const wf = await h.runWithOrgId(org._id, () => h.Workflow.create({ title: 'Dashboard verification', status: 'published', createdBy: admin._id, nodes: [] }))
  const day = (offset) => {
    const date = new Date()
    date.setDate(date.getDate() + offset)
    return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 10)
  }
  const seedRun = (status, offset) => {
    const createdAt = new Date(`${day(offset)}T10:00:00Z`)
    return h.runWithOrgId(org._id, () => h.WorkflowExecution.create({
      workflowId: wf._id,
      triggeredBy: employee._id,
      status,
      createdAt,
      startedAt: new Date(createdAt.getTime() - 3600000),
      ...(status === 'completed' ? { completedAt: createdAt } : {}),
    }))
  }
  await seedRun('completed', 0)
  await h.runWithOrgId(org._id, () => h.Task.create({
    title: 'Check this approval', type: 'IT', status: 'pending',
    assignedTo: admin._id, submittedBy: employee._id, workflowId: wf._id,
    dueDate: new Date(Date.now() - 3600000),
  }))
  for (let index = 0; index < 3; index += 1) {
    await h.runWithOrgId(org._id, () => h.AuditLog.create({ action: 'user_logged_in', targetEntity: admin.name, performedBy: admin._id, createdAt: new Date(Date.now() - index * 1000) }))
  }
  await h.runWithOrgId(org._id, () => h.AuditLog.create({
    action: 'user_updated', targetEntity: `User: ${employee.name}`,
    performedBy: admin._id, createdAt: new Date(),
  }))

  const browser = await u.launch()
  const captures = process.env.UI_CAPTURE_DIR || path.join(os.tmpdir(), 'netflow-admin-dashboard-qa')
  fs.mkdirSync(captures, { recursive: true })
  try {
    const { page, context, user } = await u.session(browser, { token, workspace: org.subdomain })
    await context.addInitScript((id) => localStorage.setItem(`fs.userGuide.completed.${id}`, '1'), String(user._id || user.id))
    page.setDefaultTimeout(12000)
    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    const panel = (title) => page.locator('main section.nf-panel').filter({ has: page.getByRole('heading', { name: title, exact: true }) })
    const dateButton = page.getByRole('button', { name: /dashboard date range:/i })
    const dialog = page.getByRole('dialog', { name: 'Dashboard date range', exact: true })
    const waitReady = () => page.waitForFunction(() => ![...document.querySelectorAll('[role="status"]')].some((element) => /^Loading /.test(element.getAttribute('aria-label') || '')))
    await u.goto(page, '/dashboard')
    await dateButton.waitFor()
    await waitReady()
    const expectedGreeting = await page.evaluate(() => {
      const hour = new Date().getHours()
      return hour >= 5 && hour < 12 ? 'Good morning' : hour >= 12 && hour < 17 ? 'Good afternoon' : 'Good evening'
    })
    h.check('DASH-001', 'Greeting follows browser-local time and the Admin dashboard remains selected',
      (await page.locator('h1').innerText()) === `${expectedGreeting}, Dashboard` &&
      (await page.getByText('Monitor performance, spot workflow risk, and manage workspace capacity.', { exact: true }).count()) === 1)
    const controlTowerText = await panel('Workflow Control Tower').innerText()
    h.check('DASH-002', 'Control Tower shows real live risk and selected-period workflow performance',
      /Open requests\s+0/.test(controlTowerText) &&
      /Overdue\s+1/.test(controlTowerText) &&
      /Median completion\s+1h/.test(controlTowerText) &&
      /Dashboard verification/.test(controlTowerText) &&
      /100%/.test(controlTowerText) &&
      await panel('Workflow activity').count() === 0 &&
      await panel('Outcome distribution').count() === 0 &&
      await panel('Workflow Control Tower').getByRole('link', { name: /View all workflows/i }).count() === 1)
    h.check('DASH-002', 'Operational KPIs and SLA health use the connected analytics data',
      await page.getByText('Activity overview', { exact: true }).count() === 1 &&
      await page.getByText('Workflow runs', { exact: true }).count() >= 1 &&
      await panel('SLA trend').count() === 1)
    const slaPanel = panel('SLA trend')
    const slaPanelText = await slaPanel.innerText()
    const slaNumericLabels = (await slaPanel.locator('svg text').evaluateAll((labels) => labels.map((label) => label.textContent?.trim())))
      .filter((label) => /^\d+$/.test(label))
    const slaScaleValues = [...new Set(slaNumericLabels)].sort()
    h.check('DASH-002', 'Sparse SLA trend uses clear dates, a direct value and an adaptive integer scale',
      /1 breach/.test(slaPanelText) &&
      /Peak:/.test(slaPanelText) &&
      /other 4 intervals recorded none/.test(slaPanelText) &&
      !/\bW\d+\b/.test(slaPanelText) &&
      JSON.stringify(slaScaleValues) === JSON.stringify(['0', '1']) &&
      slaNumericLabels.filter((label) => label === '1').length >= 2,
      `text ${JSON.stringify(slaPanelText)}, chart labels ${JSON.stringify(slaNumericLabels)}`)
    h.check('DASH-003', 'Pending approvals show the real requester, owner and workflow',
      /Dashboard Employee/.test(await panel('Needs attention').innerText()) &&
      /Dashboard Admin/.test(await panel('Needs attention').innerText()) &&
      /Dashboard verification/.test(await panel('Needs attention').innerText()))
    const administrationText = await panel('Recent administration activity').innerText()
    h.check('DASH-004', 'Dashboard prioritizes real administration changes and leaves sign-ins in the audit log',
      /Dashboard Admin updated Dashboard Employee/.test(administrationText) &&
      !/logged in/.test(administrationText) &&
      await h.runWithOrgId(org._id, () => h.AuditLog.countDocuments({ action: 'user_logged_in' })) >= 3)
    await page.setViewportSize({ width: 1360, height: 900 })
    await page.screenshot({ path: path.join(captures, 'sparse-1360.png') })

    const originalMetrics = await page.locator('main > .grid').first().innerText()
    const paths = ['/analytics/summary', '/analytics/department-kpis', '/analytics/activity', '/analytics/workflow-control-tower', '/analytics/sla-breaches', '/audit-logs']
    const requests = []
    page.on('request', (request) => {
      if (paths.some((part) => request.url().includes(part))) requests.push(new URL(request.url()))
    })
    await dateButton.click()
    await dialog.getByRole('button', { name: '7 days', exact: true }).click()
    await waitReady()
    h.check('DASH-005', 'One preset filters all dashboard APIs with identical boundaries',
      paths.every((part) => requests.some((url) => url.pathname.endsWith(part) && url.searchParams.get('from') === day(-6) && url.searchParams.get('to') === day(0))))
    h.check('DASH-005', 'Catalogue and usage metrics do not change with activity dates',
      originalMetrics === await page.locator('main > .grid').first().innerText())
    await dateButton.click()
    await dialog.getByRole('button', { name: '90 days', exact: true }).click()
    await waitReady()
    h.check('DASH-005', 'The 90-day preset uses an inclusive 90-day range',
      requests.some((url) => url.pathname.endsWith('/analytics/activity') && url.searchParams.get('from') === day(-89) && url.searchParams.get('to') === day(0)))
    await dateButton.click()
    h.check('DASH-006', 'Opening the picker moves keyboard focus inside it',
      await dialog.evaluate((element) => element.contains(document.activeElement)))
    await dialog.getByLabel('From', { exact: true }).fill(day(-100))
    await dialog.getByRole('button', { name: 'Apply range', exact: true }).click()
    h.check('DASH-006', 'Custom ranges over 90 inclusive days show a validation error',
      /90 days or fewer/.test(await dialog.getByRole('alert').innerText()))
    await page.keyboard.press('Escape')
    h.check('DASH-006', 'Escape closes the picker and restores trigger focus',
      await dialog.count() === 0 && await dateButton.evaluate((element) => element === document.activeElement))
    await dateButton.click()
    await page.locator('h1').click()
    h.check('DASH-006', 'Outside click closes the picker', await dialog.count() === 0)
    await dateButton.click()
    await dialog.getByLabel('From', { exact: true }).fill(day(-60))
    await dialog.getByLabel('Till', { exact: true }).fill(day(-50))
    await dialog.getByRole('button', { name: 'Apply range', exact: true }).click()
    await waitReady()
    const historicalControlTower = await panel('Workflow Control Tower').innerText()
    h.check('DASH-007', 'Empty performance ranges retain the live Control Tower workload',
      /Overdue\s+1/.test(historicalControlTower) &&
      /Failed runs\s+0/.test(historicalControlTower) &&
      /Dashboard verification/.test(historicalControlTower) &&
      /No approval tasks need attention/.test(await panel('Needs attention').innerText()) &&
      /No administration changes/.test(await panel('Recent administration activity').innerText()))

    await seedRun('running', -7)
    await seedRun('paused', -14)
    await seedRun('failed', -21)
    await seedRun('cancelled', 0)
    await dateButton.click()
    await dialog.getByRole('button', { name: '30 days', exact: true }).click()
    await waitReady()
    const workflowKpi = await page.locator('div.nf-panel.relative').filter({ has: page.getByText('Workflow runs', { exact: true }) }).innerText()
    const inProgressKpi = await page.locator('div.nf-panel.relative').filter({ has: page.getByText('In progress', { exact: true }) }).innerText()
    const populatedControlTower = await panel('Workflow Control Tower').innerText()
    h.check('DASH-008', 'Control Tower keeps live workload and period outcomes understandable together',
      /Open requests\s+2/.test(populatedControlTower) &&
      /Failed runs\s+1/.test(populatedControlTower) &&
      /Overdue\s+1/.test(populatedControlTower) &&
      /33.3%/.test(populatedControlTower) &&
      /Workflow runs\s+5\s+In selected period/.test(workflowKpi) &&
      /In progress\s+1\s+1 waiting/.test(inProgressKpi),
      populatedControlTower)

    for (const theme of ['light', 'dark']) {
      // Use the same root class applied by the existing theme store.
      await page.evaluate((value) => {
        document.documentElement.classList.toggle('dark', value === 'dark')
        document.documentElement.style.colorScheme = value
      }, theme)
      for (const width of [1360, 1180, 820, 390]) {
        await page.setViewportSize({ width, height: 900 })
        await page.evaluate(() => document.querySelector('main').scrollTo(0, 0))
        await page.waitForTimeout(250)
        const dimensions = await page.evaluate(() => {
          const main = document.querySelector('main')
          return { page: document.documentElement.scrollWidth - innerWidth, main: main.scrollWidth - main.clientWidth }
        })
        h.check('DASH-009', `${theme} dashboard fits ${width}px without page-level horizontal overflow`,
          dimensions.page <= 1 && dimensions.main <= 1, JSON.stringify(dimensions))
        await dateButton.click()
        const bounds = await dialog.boundingBox()
        h.check('DASH-009', `${theme} date popup stays inside ${width}px viewport`, bounds.x >= 0 && bounds.x + bounds.width <= width + 1, JSON.stringify(bounds))
        await page.screenshot({ path: path.join(captures, `${theme}-${width}-picker.png`) })
        await page.keyboard.press('Escape')
        await page.screenshot({ path: path.join(captures, `${theme}-${width}.png`) })
        if (width === 390) {
          h.check('DASH-009', `${theme} Control Tower uses stacked workflow cards on mobile`,
            await panel('Workflow Control Tower').locator('article').first().isVisible() &&
            !(await panel('Workflow Control Tower').locator('table').isVisible()))
        }
        if (width === 1360) {
          h.check('DASH-009', `${theme} Control Tower uses the comparison table on desktop`,
            await panel('Workflow Control Tower').locator('table').isVisible())
        }
        if (width === 390 || width === 1360) {
          await panel('Workflow Control Tower').screenshot({ path: path.join(captures, `${theme}-${width}-control-tower.png`) })
          await panel('Recent administration activity').screenshot({ path: path.join(captures, `${theme}-${width}-audit.png`) })
        }
      }
    }
    h.check('DASH-010', 'Dashboard has no browser runtime errors', errors.length === 0, errors.join(' | '))
    console.log(`Dashboard screenshots: ${captures}`)
    await context.close()
  } finally {
    await browser.close()
  }
})
