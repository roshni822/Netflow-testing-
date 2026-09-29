// WS (UI) — Shell 4 chrome: what an employee actually lands on.
//
// workspace.test.js proves the API refuses what this shell hides. This proves
// the hiding: a four-item rail, a Forms page that reads as a catalogue of things
// you can ask for rather than a builder's table, requests you can track, and
// four URLs that bounce even when typed by hand.

const h = require('./lib/harness')
const u = require('./lib/uiHarness')

const TCS = ['WS-040', 'WS-041', 'WS-042', 'WS-043']

const WORKSPACE_HREFS = ['/dashboard', '/tasks', '/forms', '/profile']
const NOT_FOR_EMPLOYEES = ['/workflows', '/admin', '/analytics', '/audit-log', '/team', '/departments', '/roles', '/settings']

h.runSuite('ui_workspace', async () => {
  if (!(await u.frontendUp())) return u.skipAll(TCS, u.unavailableReason())

  const org = await h.createOrg('uiws')
  const admin = await h.createUser(org, {
    name: 'UI WS Admin', email: h.emailIn(org, 'uiws-admin'), roleName: 'Admin', department: 'IT'
  })
  const manager = await h.createUser(org, {
    name: 'UI WS Manager', email: h.emailIn(org, 'uiws-mgr'), roleName: 'Manager', department: 'Finance'
  })
  const employee = await h.createUser(org, {
    name: 'UI WS Employee', email: h.emailIn(org, 'uiws-emp'), roleName: 'Employee',
    department: 'Finance', managerId: manager._id
  })

  const empTok = await h.getToken({ email: employee.email })
  const adminTok = await h.getToken({ email: admin.email })
  const managerTok = await h.getToken({ email: manager.email })

  // One form they can start, one draft they must not see.
  const availableForm = await h.runWithOrgId(org._id, () => h.Form.create({
    title: 'Expense reimbursement',
    description: 'Claim back something you paid for',
    status: 'published',
    department: 'Finance',
    fields: [{ id: 'amount', label: 'Amount', type: 'number', required: true }],
    createdBy: admin._id
  }))
  await h.runWithOrgId(org._id, () => h.Workflow.create({
    title: 'Expense approval',
    status: 'published',
    linkedFormId: availableForm._id,
    linkedFormIds: [availableForm._id],
    triggerOn: 'Every form submission',
    createdBy: admin._id,
    nodes: [
      { id: 'start', type: 'start', nextNode: 'manager' },
      { id: 'manager', type: 'approval', label: 'Manager approval', config: { approverRole: 'direct_manager', slaHours: 24 }, nextNode: 'amount-check' },
      { id: 'amount-check', type: 'condition', config: { conditionField: 'amount', conditionOperator: 'gt', conditionValue: '100', truePath: 'finance', falsePath: 'end' } },
      { id: 'finance', type: 'approval', label: 'Finance approval', config: { approverRole: 'finance_manager', slaHours: 48 }, nextNode: 'end' },
      { id: 'end', type: 'end' }
    ]
  }))
  await h.runWithOrgId(org._id, () => h.Form.create({
    title: 'Half written policy form',
    status: 'draft',
    fields: [{ id: 'x', label: 'X', type: 'text' }],
    createdBy: admin._id
  }))

  // One request of their own, in flight with their manager.
  await h.runWithOrgId(org._id, () => h.Task.create({
    title: 'New laptop', type: 'Finance', status: 'pending',
    assignedTo: manager._id, submittedBy: employee._id
  }))
  // And one that belongs to somebody else entirely.
  await h.runWithOrgId(org._id, () => h.Task.create({
    title: 'Manager travel advance', type: 'Finance', status: 'pending',
    assignedTo: admin._id, submittedBy: manager._id
  }))

  const browser = await u.launch()
  try {
    const emp = await u.session(browser, { token: empTok, workspace: org.subdomain })
    // Workspace navigation is the subject of this suite. Mark the separate
    // first-login tour complete so its delayed first step cannot navigate the
    // browser back to /dashboard while a route assertion is in progress.
    await emp.context.addInitScript((userId) => {
      localStorage.setItem(`fs.userGuide.completed.${userId}`, '1')
    }, String(emp.user?._id || emp.user?.id || ''))

    // ── WS-040 — the workspace rail ──────────────────────────────────────────
    await u.goto(emp.page, '/dashboard')
    const links = await u.sidebarLinks(emp.page)
    const missing = WORKSPACE_HREFS.filter((href) => !u.hasLink(links, href))
    const leaked = NOT_FOR_EMPLOYEES.filter((href) => u.hasLink(links, href))

    h.check('WS-040', 'An employee\'s sidebar carries their dashboard, requests, forms and profile',
      missing.length === 0, `missing ${missing.join(', ')} — saw ${u.linkHrefs(links)}`)
    h.check('WS-040', 'An employee\'s sidebar hides everything they cannot use',
      leaked.length === 0, `leaked ${leaked.join(', ')}`)

    // ── WS-041 — the dashboard is about their own requests ───────────────────
    const dashText = await emp.page.locator('main').innerText().catch(() => '')
    h.check('WS-041', 'The dashboard opens on their own requests',
      /My Requests/i.test(dashText) && /New laptop/.test(dashText),
      `body: ${dashText.slice(0, 200).replace(/\s+/g, ' ')}`)

    h.check('WS-041', 'The employee dashboard prioritizes actions and request tracking',
      /Needs your attention/i.test(dashText) &&
        /Track status/i.test(dashText) &&
        /Request summary/i.test(dashText),
      `body: ${dashText.slice(0, 260).replace(/\s+/g, ' ')}`)

    h.check('WS-041', 'Starting a request is one click from home',
      await u.isVisible(emp.page, 'a[href="/forms"]:has-text("Start a request")'),
      'the header CTA never rendered')

    await emp.page.setViewportSize({ width: 390, height: 844 })
    await emp.page.waitForTimeout(150)
    const mobileDashboardFits = await emp.page.locator('main').evaluate((main) => (
      main.scrollWidth <= main.clientWidth + 1
    ))
    h.check('WS-041', 'The employee dashboard fits a 390px mobile viewport',
      mobileDashboardFits &&
        await u.isVisible(emp.page, 'main a[href="/forms"]:has-text("Start a request")'),
      'the Employee dashboard overflowed or hid its primary action')
    await emp.page.setViewportSize({ width: 1360, height: 900 })

    h.check('WS-041', 'None of the builder or leader panels leak in',
      !/Total Workflows/i.test(dashText) && !/Waiting on you/i.test(dashText),
      'a dashboard from another shell rendered')

    // ── WS-042 — Forms reads as a catalogue, not a builder's table ───────────
    const formsPath = await u.goto(emp.page, '/forms')
    await emp.page.waitForTimeout(800)
    const formsText = await emp.page.locator('main').innerText().catch(() => '')

    h.check('WS-042', 'An employee can open the forms catalogue directly',
      formsPath === '/forms', `landed on ${formsPath}`)

    h.check('WS-042', 'The forms page offers requests they can start',
      /Expense reimbursement/i.test(formsText) && /Start a request/i.test(formsText) && /Fill form/i.test(formsText),
      `body: ${formsText.slice(0, 240).replace(/\s+/g, ' ')}`)

    h.check('WS-042', 'The employee catalogue uses the approved list controls and columns',
      await u.isVisible(emp.page, 'input[aria-label="Search available forms"]') &&
        await u.isVisible(emp.page, 'select[aria-label="Filter by category"]') &&
        await u.isVisible(emp.page, 'select[aria-label="Sort available forms"]') &&
        /Form\s+Category\s+Fields\s+Access\s+Action/i.test(formsText),
      'the catalogue toolbar or list columns did not render')

    await emp.page.getByRole('button', { name: 'Grid view' }).click()
    const catalogueGridVisible = await emp.page.locator('.nf-forms-card-grid .nf-forms-catalogue-card').first().isVisible().catch(() => false)
    const storedCatalogueView = await emp.page.evaluate(() => localStorage.getItem('netflow.catalogue.view'))
    h.check('WS-042', 'Employees can switch to the approved card catalogue and keep that preference',
      catalogueGridVisible && storedCatalogueView === 'grid',
      `grid visible: ${catalogueGridVisible}; stored view: ${storedCatalogueView}`)

    await emp.page.getByRole('button', { name: 'List view' }).click()

    await emp.page.setViewportSize({ width: 390, height: 844 })
    await emp.page.waitForTimeout(150)
    const mobileFormsFit = await emp.page.locator('main').evaluate((main) => main.scrollWidth <= main.clientWidth + 1)
    h.check('WS-042', 'The employee catalogue contains its table at a 390px viewport',
      mobileFormsFit && await u.isVisible(emp.page, '.nf-forms-list-view'),
      'the Forms page overflowed outside its horizontal table scroller')
    await emp.page.setViewportSize({ width: 1360, height: 900 })

    h.check('WS-042', 'A draft form is not offered to an employee',
      !/Half written policy form/.test(formsText), 'an unpublished form was listed')

    h.check('WS-042', 'The builder\'s controls are absent',
      !/New form/i.test(formsText) && !/Responses/i.test(formsText) && !/Submissions/i.test(formsText),
      `body: ${formsText.slice(0, 240).replace(/\s+/g, ' ')}`)

    // The real published form opens in the guided filler, validates accessibly,
    // persists a server draft, reaches review, and submits through the API.
    await u.goto(emp.page, `/forms/${availableForm._id}/fill`)
    await emp.page.locator('.nf-fill-card').waitFor({ state: 'visible', timeout: 20000 })
    const fillText = await emp.page.locator('main').innerText()
    h.check('WS-042', 'The fill page uses the approved guided request layout',
      /Expense reimbursement/i.test(fillText) &&
        await emp.page.locator('[aria-label="Form progress"]').isVisible() &&
        /Approval route/i.test(fillText),
      `body: ${fillText.slice(0, 260).replace(/\s+/g, ' ')}`)

    await emp.page.getByText('UI WS Manager', { exact: true }).first().waitFor({ timeout: 20000 })
    const pendingApprovalRoute = await emp.page.locator('.nf-fill-next-card').innerText()
    h.check('WS-042', 'The approval panel uses the real manager and waits for its controlling field',
      /1 approval required/i.test(pendingApprovalRoute) &&
        /UI WS Manager/.test(pendingApprovalRoute) &&
        /Finance/.test(pendingApprovalRoute) &&
        /Complete Amount to confirm/i.test(pendingApprovalRoute),
      `route: ${pendingApprovalRoute.replace(/\s+/g, ' ')}`)

    await emp.page.getByRole('button', { name: 'Continue to review' }).click()
    const amountInput = emp.page.getByLabel('Amount')
    h.check('WS-042', 'Required validation stays linked to the real field',
      await amountInput.getAttribute('aria-invalid') === 'true' &&
        /Amount is required/.test(await emp.page.locator('main').innerText()),
      'the empty required amount was not identified')

    await amountInput.fill('125')
    await emp.page.getByText('2 approvals required', { exact: true }).waitFor({ timeout: 20000 })
    const resolvedApprovalRoute = await emp.page.locator('.nf-fill-next-card').innerText()
    h.check('WS-042', 'The approval panel updates from the matching real workflow branch',
      /Manager approval/.test(resolvedApprovalRoute) &&
        /Finance approval/.test(resolvedApprovalRoute) &&
        /2 approvals required/.test(resolvedApprovalRoute),
      `route: ${resolvedApprovalRoute.replace(/\s+/g, ' ')}`)
    await emp.page.getByRole('button', { name: 'Save as draft', exact: true }).click()
    await emp.page.getByText('Draft saved', { exact: true }).waitFor({ state: 'visible', timeout: 20000 })
    await emp.page.reload({ waitUntil: 'domcontentloaded' })
    await emp.page.locator('.nf-fill-card').waitFor({ state: 'visible', timeout: 20000 })
    await emp.page.getByText(/restored your saved draft/i).waitFor({ state: 'visible', timeout: 20000 })
    await emp.page.waitForFunction(() => document.getElementById('ff-amount')?.value === '125')
    h.check('WS-042', 'The guided filler restores the real server draft after refresh',
      await emp.page.getByLabel('Amount').inputValue() === '125' &&
        await emp.page.getByText(/restored your saved draft/i).isVisible(),
      'the saved amount was not restored')

    await emp.page.getByRole('button', { name: 'Continue to review' }).click()
    await emp.page.getByRole('heading', { name: 'Review your request' }).waitFor()
    const reviewText = (await emp.page.locator('.nf-fill-review').innerText()).replace(/\s+/g, ' ')
    h.check('WS-042', 'A validated request reaches a truthful review step before submission',
      /Amount\s+125/i.test(reviewText), `review: ${reviewText}`)

    await emp.page.setViewportSize({ width: 390, height: 844 })
    await emp.page.waitForTimeout(150)
    const mobileFillFits = await emp.page.locator('main').evaluate((main) => main.scrollWidth <= main.clientWidth + 1)
    const nextStepsToggle = emp.page.getByRole('button', { name: 'Show', exact: true })
    h.check('WS-042', 'The guided filler fits mobile and collapses secondary guidance',
      mobileFillFits && await nextStepsToggle.isVisible(),
      'the fill page overflowed or left the guidance expanded at 390px')
    await nextStepsToggle.click()
    h.check('WS-042', 'Mobile users can reveal the next-step guidance',
      await emp.page.locator('#fill-next-content').isVisible(),
      'the mobile next-step disclosure did not open')
    await emp.page.setViewportSize({ width: 1360, height: 900 })

    await emp.page.getByRole('button', { name: 'Submit request' }).click()
    await emp.page.getByRole('heading', { name: 'Request submitted' }).waitFor({ timeout: 20000 })
    h.check('WS-042', 'The reviewed form submits through the real form endpoint',
      /recorded successfully/i.test(await emp.page.locator('main').innerText()),
      'the real submission success state did not render')

    const routeAlertForm = await h.runWithOrgId(org._id, () => h.Form.create({
      title: 'Route configuration check',
      description: 'Verifies approval readiness before submission',
      status: 'published',
      fields: [{ id: 'note', label: 'Note', type: 'text', required: true }],
      createdBy: admin._id
    }))
    await h.runWithOrgId(org._id, () => h.Workflow.create({
      title: 'Route configuration approval',
      status: 'published',
      linkedFormId: routeAlertForm._id,
      linkedFormIds: [routeAlertForm._id],
      triggerOn: 'Every form submission',
      createdBy: admin._id,
      nodes: [
        { id: 'start', type: 'start', nextNode: 'manager' },
        { id: 'manager', type: 'approval', label: 'Manager approval', config: { approverRole: 'direct_manager', slaHours: 24 }, nextNode: 'legal' },
        { id: 'legal', type: 'approval', label: 'Legal approval', config: { approverRole: 'legal_manager', slaHours: 24 }, nextNode: 'end' },
        { id: 'end', type: 'end' }
      ]
    }))

    const mgr = await u.session(browser, { token: managerTok, workspace: org.subdomain })
    await mgr.context.addInitScript((userId) => {
      localStorage.setItem(`fs.userGuide.completed.${userId}`, '1')
    }, String(mgr.user?._id || mgr.user?.id || ''))
    await u.goto(mgr.page, `/forms/${routeAlertForm._id}/fill`)
    await mgr.page.locator('.nf-fill-route-alert.is-error')
      .getByText(/has no active direct manager assigned/i)
      .waitFor({ timeout: 20000 })
    const routeAlertText = await mgr.page.locator('.nf-fill-next-card').innerText()
    h.check('WS-042', 'A missing manager is announced as a blocking alert without escalation',
      /UI WS Manager has no active direct manager assigned/i.test(routeAlertText) &&
        /Manager approval/i.test(routeAlertText) &&
        (await mgr.page.locator('.nf-fill-route-alert.is-warning').count()) === 0,
      `route: ${routeAlertText.replace(/\s+/g, ' ')}`)
    h.check('WS-042', 'An unresolved approval is announced as a blocking alert',
      /Legal approval has no active approver configured/i.test(routeAlertText) &&
        await mgr.page.locator('.nf-fill-route-alert.is-error[role="alert"]')
          .filter({ hasText: 'Legal approval' })
          .isVisible(),
      `route: ${routeAlertText.replace(/\s+/g, ' ')}`)
    await mgr.page.getByLabel('Note').fill('Ready')
    await mgr.page.getByRole('button', { name: 'Continue to review' }).click()
    const blockedSubmitButton = mgr.page.getByRole('button', { name: 'Submit request' })
    h.check('WS-042', 'Final submission is disabled while an approval has no assignee',
      await blockedSubmitButton.isDisabled() &&
        /Configure an approver for: Manager approval, Legal approval/i.test(await mgr.page.locator('main').innerText()),
      'the unresolved approval did not block final submission')

    const unlinkedUiForm = await h.runWithOrgId(org._id, () => h.Form.create({
      title: 'No workflow request',
      status: 'published',
      fields: [{ id: 'note', label: 'Note', type: 'text' }],
      createdBy: admin._id
    }))
    await u.goto(emp.page, `/forms/${unlinkedUiForm._id}/fill`)
    await emp.page.getByText('No approval workflow linked', { exact: true }).waitFor({ timeout: 20000 })
    h.check('WS-042', 'A form without approvals shows an honest non-blocking alert',
      /recorded without an automatic approval route/i.test(await emp.page.locator('.nf-fill-next-card').innerText()),
      'the unlinked workflow warning was not shown')

    // Their inbox opens on what they raised, and carries no team tab.
    const inboxErrors = []
    emp.page.on('pageerror', (error) => inboxErrors.push(error.message))
    const inboxPath = await u.goto(emp.page, '/tasks')
    await emp.page.waitForTimeout(1000)
    const inboxText = await emp.page.locator('main').innerText().catch(() => '')
    h.check('WS-042', 'An employee can open My requests directly',
      inboxPath === '/tasks', `landed on ${inboxPath}; errors: ${inboxErrors.join(' | ') || 'none'}`)
    h.check('WS-042', 'The inbox opens on the requests they raised',
      /New laptop/.test(inboxText) && !/Manager travel advance/.test(inboxText),
      `body: ${inboxText.slice(0, 240).replace(/\s+/g, ' ')}`)
    h.check('WS-042', 'Employees only see the My requests scope',
      !/Assigned to me/i.test(inboxText) && !/My team/i.test(inboxText),
      `body: ${inboxText.slice(0, 240).replace(/\s+/g, ' ')}`)
    const requestMetrics = emp.page.locator('[aria-label="Request status overview"]')
    const requestMetricsText = await requestMetrics.innerText().catch(() => '')
    h.check('WS-042', 'My Requests summary cards use the real submitted-request state',
      /Total requests\s*2/i.test(requestMetricsText) &&
        /In progress\s*2/i.test(requestMetricsText) &&
        /Needs attention\s*0/i.test(requestMetricsText) &&
        /Completed\s*0/i.test(requestMetricsText),
      `metrics: ${requestMetricsText.replace(/\s+/g, ' ')}`)
    h.check('WS-042', 'My Requests uses the approved catalogue table and real request fields',
      /Submitted/i.test(inboxText) &&
        /Current step/i.test(inboxText) &&
        /Last updated/i.test(inboxText) &&
        await u.isVisible(emp.page, 'button:has-text("Fill form")'),
      `body: ${inboxText.slice(0, 300).replace(/\s+/g, ' ')}`)

    await emp.page.setViewportSize({ width: 390, height: 844 })
    await emp.page.waitForTimeout(150)
    const mobileRequestsFit = await emp.page.locator('main').evaluate((main) => (
      main.scrollWidth <= main.clientWidth + 1
    ))
    h.check('WS-042', 'My Requests cards and catalogue fit a 390px mobile viewport',
      mobileRequestsFit && (await requestMetrics.locator('.nf-forms-metric').count()) === 4,
      'the request summary or catalogue overflowed the mobile viewport')
    await emp.page.setViewportSize({ width: 1360, height: 900 })

    await emp.page.getByRole('button', { name: 'Grid view' }).click()
    await emp.page.waitForTimeout(150)
    h.check('WS-042', 'My Requests switches to the approved grid cards',
      (await emp.page.locator('article.nf-requests-card').count()) === 2,
      'the request grid card did not render')
    await emp.page.reload()
    await emp.page.waitForSelector('#task-search', { timeout: 20000 })
    await emp.page.locator('article.nf-requests-card').first()
      .waitFor({ state: 'visible', timeout: 20000 })
      .catch(() => {})
    h.check('WS-042', 'The selected My Requests layout survives a refresh',
      (await emp.page.locator('article.nf-requests-card').count()) === 2,
      'the grid preference was not restored')
    await emp.page.getByRole('button', { name: 'List view' }).click()

    h.check('WS-042', 'There is no team tab for someone who leads nobody',
      !/My team/i.test(inboxText), 'the team scope was offered to an employee')

    // Their Profile keeps real account controls, but presents them in the same
    // catalogue-style visual system as Forms and My Requests.
    const profilePath = await u.goto(emp.page, '/profile')
    await emp.page.waitForSelector('[aria-label="Profile summary"]', { timeout: 20000 })
    await emp.page.waitForTimeout(800)
    const profileText = await emp.page.locator('main').innerText().catch(() => '')
    const profileMetrics = await emp.page.locator('[aria-label="Profile status overview"]').innerText().catch(() => '')

    h.check('WS-042', 'The employee Profile opens with real account and reporting data',
      profilePath === '/profile' &&
        /UI WS Employee/i.test(profileText) &&
        /Finance/i.test(profileText) &&
        /UI WS Manager/i.test(profileText),
      `body: ${profileText.slice(0, 320).replace(/\s+/g, ' ')}`)

    h.check('WS-042', 'Profile status cards summarize real account settings',
      /Account\s+Active\s+Workspace access/i.test(profileMetrics) &&
        /Security\s+Not enabled\s+Two-factor authentication/i.test(profileMetrics) &&
        /Notifications\s+8 of 8\s+Channels enabled/i.test(profileMetrics) &&
        /Availability\s+Available\s+Request routing/i.test(profileMetrics),
      `metrics: ${profileMetrics.replace(/\s+/g, ' ')}`)

    h.check('WS-042', 'Profile security and notification controls remain available',
      await u.isVisible(emp.page, 'a[href="/change-password"]') &&
        await u.isVisible(emp.page, 'button:has-text("Sign out of all devices")') &&
        (await emp.page.locator('.nf-profile-notifications-card [role="switch"]').count()) === 8,
      'one or more account controls did not render')

    await emp.page.setViewportSize({ width: 390, height: 844 })
    await emp.page.waitForTimeout(150)
    const mobileProfileFits = await emp.page.locator('main').evaluate((main) => main.scrollWidth <= main.clientWidth + 1)
    h.check('WS-042', 'The redesigned Profile fits a 390px viewport',
      mobileProfileFits && await u.isVisible(emp.page, '.nf-profile-notifications-card'),
      'the Profile content overflowed the mobile viewport')
    await emp.page.setViewportSize({ width: 1360, height: 900 })

    // ── WS-043 — typing the URL gets you nowhere ─────────────────────────────
    for (const href of ['/analytics', '/audit-log', '/admin', '/workflows', '/forms/new']) {
      await u.goto(emp.page, href)
      h.check('WS-043', `An employee typing ${href} is sent back to the dashboard`,
        await u.landsOn(emp.page, '/dashboard'), `landed on ${await u.pathOf(emp.page)}`)
    }
    await emp.context.close()

    // The same pages must still open for the shell that owns them, or the guard
    // has simply been set too wide.
    const adm = await u.session(browser, { token: adminTok, workspace: org.subdomain })
    await adm.context.addInitScript((userId) => {
      localStorage.setItem(`fs.userGuide.completed.${userId}`, '1')
    }, String(adm.user?._id || adm.user?.id || ''))
    for (const href of ['/analytics', '/audit-log', '/admin']) {
      await u.goto(adm.page, href)
      h.check('WS-043', `An admin still reaches ${href}`,
        await u.landsOn(adm.page, href), `landed on ${await u.pathOf(adm.page)}`)
    }
    await adm.context.close()
  } finally {
    await browser.close()
  }
})
