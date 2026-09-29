// OADMIN (UI) — Shell 2 chrome: the Org Admin sidebar, the configuration pages
// it leads to, and the fact that nobody else can open them.
//
// The API suite (org_admin.test.js) proves the rules; this proves the shell —
// that an admin can reach Departments, Roles and Organization from the rail, and
// that a Manager or Employee typing those URLs lands back on their dashboard.

const h = require('./lib/harness')
const u = require('./lib/uiHarness')

const TCS = ['OADMIN-030', 'OADMIN-031', 'OADMIN-032']

const ADMIN_HREFS = ['/dashboard', '/forms', '/workflows', '/analytics', '/audit-log', '/admin', '/departments', '/roles', '/settings']
const PLATFORM_HREFS = ['/platform', '/usage', '/activity', '/health', '/plans', '/admins']

h.runSuite('ui_org_admin', async () => {
  if (!(await u.frontendUp())) return u.skipAll(TCS, u.unavailableReason())

  const org = await h.createOrg('uioadm')
  const admin = await h.createUser(org, {
    name: 'UI Org Admin', email: h.emailIn(org, 'uioadm-admin'), roleName: 'Admin'
  })
  const employee = await h.createUser(org, {
    name: 'UI Org Employee', email: h.emailIn(org, 'uioadm-emp'), roleName: 'Employee', department: 'Sales'
  })
  const adminTok = await h.getToken({ email: admin.email })
  const empTok = await h.getToken({ email: employee.email })

  const browser = await u.launch()
  try {
    // ── OADMIN-030 — the Org Admin rail ──────────────────────────────────────
    const adm = await u.session(browser, { token: adminTok, workspace: org.subdomain })
    await adm.context.addInitScript((userId) => {
      localStorage.setItem(`fs.userGuide.completed.${userId}`, '1')
    }, String(adm.user?._id || adm.user?.id || ''))
    await u.goto(adm.page, '/billing')
    const billingUsage = adm.page.getByText('Usage against plan', { exact: true })
    await billingUsage.waitFor({ timeout: 15000 }).catch(() => {})
    const billingText = await adm.page.locator('body').innerText().catch(() => '')
    h.check('OADMIN-031', 'A direct Billing refresh loads the real Admin usage snapshot',
      (await billingUsage.count()) === 1 && !/do not have permission to view plan and usage data/i.test(billingText),
      `body: ${billingText.slice(0, 180).replace(/\s+/g, ' ')}`)

    const dashboardActivityRequest = adm.page.waitForRequest((request) =>
      request.url().includes('/api/analytics/activity?') &&
      new URL(request.url()).searchParams.has('from') &&
      new URL(request.url()).searchParams.has('to')
    ).catch(() => null)
    await u.goto(adm.page, '/dashboard')
    const exactRangeRequest = await dashboardActivityRequest
    const dateRangeButton = adm.page.getByRole('button', { name: /dashboard date range:/i })
    await dateRangeButton.waitFor({ timeout: 10000 }).catch(() => {})
    const dashboardText = await adm.page.locator('main').innerText().catch(() => '')
    const links = await u.sidebarLinks(adm.page)
    const missing = ADMIN_HREFS.filter((href) => !u.hasLink(links, href))
    const leaked = PLATFORM_HREFS.filter((href) => u.hasLink(links, href))

    h.check('OADMIN-030', 'The Org Admin sidebar carries every workspace destination',
      missing.length === 0, `missing ${missing.join(', ')} — saw ${u.linkHrefs(links)}`)
    h.check('OADMIN-030', 'The Org Admin sidebar hides the platform console',
      leaked.length === 0, `leaked ${leaked.join(', ')}`)
    h.check('OADMIN-030', 'The Org Admin receives the workspace administration dashboard',
      /Monitor performance, spot workflow risk, and manage workspace capacity/i.test(dashboardText) &&
        !/Your approvals and your team, at a glance/i.test(dashboardText),
      `body: ${dashboardText.slice(0, 180).replace(/\s+/g, ' ')}`)
    h.check('OADMIN-030', 'The dashboard uses one visible default date range for activity panels',
      (await dateRangeButton.count()) === 1 && /Date range:\s*Last 30 days/i.test(await dateRangeButton.innerText().catch(() => '')) &&
        !!exactRangeRequest && /Current workspace/i.test(dashboardText) &&
        !/Workflow volume period/i.test(dashboardText),
      `button=${await dateRangeButton.innerText().catch(() => '(missing)')}, request=${exactRangeRequest?.url() || '(missing)'}`)
    h.check('OADMIN-030', 'The dashboard greeting follows the current time of day',
      /Good (morning|afternoon|evening), UI/i.test(dashboardText),
      `heading: ${(await adm.page.locator('h1').first().innerText().catch(() => '(missing)'))}`)

    await dateRangeButton.click()
    const rangeDialog = adm.page.getByRole('dialog', { name: /dashboard date range/i })
    h.check('OADMIN-030', 'The date control exposes presets and an exact custom range',
      (await rangeDialog.count()) === 1 &&
        (await rangeDialog.getByRole('button', { name: '7 days', exact: true }).count()) === 1 &&
        (await rangeDialog.locator('input[type="date"]').count()) === 2,
      `dialog count ${await rangeDialog.count()}`)
    await adm.page.keyboard.press('Escape')

    // ── OADMIN-031 — the three new pages actually render ─────────────────────
    await u.goto(adm.page, '/settings')
    await adm.page.locator('.nf-settings-page').waitFor({ timeout: 10000 }).catch(() => {})
    const nameField = adm.page.getByLabel('Workspace name')
    const settingsText = await adm.page.locator('body').innerText().catch(() => '')
    h.check('OADMIN-031', 'Organization settings shows the editable profile and the read-only plan',
      (await nameField.count()) > 0 &&
        /Plan/.test(settingsText) &&
        settingsText.includes(org.subdomain) &&
        (await adm.page.getByRole('tab').count()) >= 4 &&
        (await adm.page.locator('.nf-settings-section').count()) === 1,
      `body: ${settingsText.slice(0, 160).replace(/\s+/g, ' ')}`)

    await adm.page.locator('#settings-tab-settings-activity').evaluate((button) => button.click())
    const activityPanel = adm.page.getByRole('tabpanel', { name: /activity/i })
    const selectedPath = await adm.page.evaluate(() => `${window.location.pathname}${window.location.hash}`)
    h.check('OADMIN-031', 'Settings navigation shows only the selected panel and preserves its hash',
      (await activityPanel.count()) === 1 &&
        (await adm.page.locator('.nf-settings-section').count()) === 1 &&
        (await nameField.count()) === 0 &&
        (await adm.page.evaluate(() => window.location.hash)) === '#settings-activity',
      `panels=${await adm.page.locator('.nf-settings-section').count()}, location=${selectedPath}`)
    await adm.page.locator('#settings-tab-settings-profile').evaluate((button) => button.click())
    await nameField.waitFor({ timeout: 5000 })

    const originalName = await nameField.inputValue()
    await nameField.fill(`${originalName} Updated`)
    const saveBar = adm.page.locator('.nf-settings-savebar')
    await saveBar.waitFor({ timeout: 5000 })
    const saveBarVisible = await saveBar.isVisible().catch(() => false)
    await Promise.all([
      adm.page.waitForResponse((response) =>
        response.url().includes('/api/organization') &&
        response.request().method() === 'PUT' &&
        response.ok()
      ),
      saveBar.getByRole('button', { name: /save changes/i }).evaluate((button) => button.click())
    ])
    await saveBar.waitFor({ state: 'hidden', timeout: 10000 }).catch(() => {})
    h.check('OADMIN-031', 'Organization settings saves real profile changes and clears the pending state',
      saveBarVisible && (await nameField.inputValue()) === `${originalName} Updated` && !(await saveBar.isVisible().catch(() => false)),
      'the unsaved changes bar or persisted workspace value was incorrect')

    await adm.page.setViewportSize({ width: 390, height: 844 })
    const responsiveState = await adm.page.evaluate(() => {
      const nav = document.querySelector('.nf-settings-nav')
      return {
        overflow: nav ? getComputedStyle(nav).overflowX : '',
        pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth
      }
    })
    h.check('OADMIN-031', 'Organization settings keeps its section navigation usable on mobile',
      responsiveState.overflow === 'auto' && responsiveState.pageOverflow <= 1,
      `overflow=${responsiveState.overflow}, pageOverflow=${responsiveState.pageOverflow}`)
    await adm.page.setViewportSize({ width: 1360, height: 900 })

    await u.goto(adm.page, '/departments')
    await adm.page.getByRole('button', { name: 'List view', exact: true }).click()
    const deptRow = adm.page.getByRole('row').filter({ hasText: 'Sales' }).first()
    await deptRow.waitFor({ timeout: 10000 }).catch(() => { /* asserted below */ })
    h.check('OADMIN-031', 'Departments lists the tenant\'s teams with their member counts',
      (await deptRow.count()) > 0 && (await deptRow.locator('td').nth(1).innerText().catch(() => '')) === '1',
      `row text: ${(await deptRow.innerText().catch(() => '(none)')).replace(/\s+/g, ' ')}`)

    // Adding a team from the dialog is the one write this suite performs; the
    // list it lands in is what every picker in the app reads.
    await adm.page.getByRole('button', { name: /new department/i }).first().click()
    await adm.page.waitForSelector('[role="dialog"]', { timeout: 10000 })
    await adm.page.locator('[role="dialog"] input').first().fill('Studio')
    await adm.page.getByRole('button', { name: /create department/i }).click()
    const added = await adm.page.getByRole('row').filter({ hasText: 'Studio' }).first()
      .waitFor({ timeout: 10000 }).then(() => true).catch(() => false)
    h.check('OADMIN-031', 'A department added in the dialog appears in the list',
      added, 'the new row never rendered')

    await u.goto(adm.page, '/roles')
    const matrix = adm.page.locator('table').first()
    await matrix.waitFor({ timeout: 10000 }).catch(() => { /* asserted below */ })
    const matrixText = await matrix.innerText().catch(() => '')
    h.check('OADMIN-031', 'Roles & permissions renders the capability matrix',
      /Admin/.test(matrixText) && /Employee/.test(matrixText) && !/SuperAdmin/.test(matrixText) &&
        /decide tasks/i.test(matrixText) && /manage users/i.test(matrixText) &&
        /view audit/i.test(matrixText) && /view analytics/i.test(matrixText) &&
        !/manage forms/i.test(matrixText) && !/build flows/i.test(matrixText),
      `matrix: ${matrixText.slice(0, 160).replace(/\s+/g, ' ')}`)
    await adm.context.close()

    // ── OADMIN-032 — configuration is Admin-only in the browser too ──────────
    const emp = await u.session(browser, { token: empTok, workspace: org.subdomain })
    await u.goto(emp.page, '/dashboard')
    const empLinks = await u.sidebarLinks(emp.page)
    const empLeaked = ['/departments', '/roles', '/settings', '/admin'].filter((href) => u.hasLink(empLinks, href))
    h.check('OADMIN-032', 'An employee never sees the configuration section',
      empLeaked.length === 0, `leaked ${empLeaked.join(', ')} — saw ${u.linkHrefs(empLinks)}`)

    for (const href of ['/departments', '/roles', '/settings']) {
      await u.goto(emp.page, href)
      h.check('OADMIN-032', `An employee typing ${href} is sent back to the dashboard`,
        await u.landsOn(emp.page, '/dashboard'), `landed on ${await u.pathOf(emp.page)}`)
    }
    await emp.context.close()
  } finally {
    await browser.close()
  }
})
