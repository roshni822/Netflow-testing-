// OPS (UI) — Shell 3 chrome: what a leader actually lands on.
//
// The API suite (ops.test.js) proves the rules. This proves the shell: that a
// Manager gets an approvals-first dashboard instead of the builder's execution
// charts, that My Team is one click away, that the inbox has a team tab, and
// that the builder is not reachable from their rail or by typing the URL.

const h = require('./lib/harness')
const u = require('./lib/uiHarness')

const TCS = ['OPS-040', 'OPS-041', 'OPS-042', 'OPS-043']

const OPS_HREFS = ['/dashboard', '/tasks', '/forms', '/team', '/analytics', '/audit-log']
const BUILDER_HREFS = ['/workflows', '/admin', '/departments', '/roles', '/settings']

h.runSuite('ui_ops', async () => {
  if (!(await u.frontendUp())) return u.skipAll(TCS, u.unavailableReason())

  const org = await h.createOrg('uiops')
  const manager = await h.createUser(org, {
    name: 'UI Ops Manager', email: h.emailIn(org, 'uiops-mgr'), roleName: 'Manager', department: 'Finance'
  })
  const report = await h.createUser(org, {
    name: 'UI Ops Report', email: h.emailIn(org, 'uiops-report'), roleName: 'Employee',
    department: 'Finance', managerId: manager._id
  })
  const employee = await h.createUser(org, {
    name: 'UI Ops Employee', email: h.emailIn(org, 'uiops-emp'), roleName: 'Employee', department: 'Sales'
  })

  const mgrTok = await h.getToken({ email: manager.email })
  const empTok = await h.getToken({ email: employee.email })

  // One decision waiting on the manager, one raised by their report, so both the
  // queue and the team tab have something real to render.
  await h.runWithOrgId(org._id, () => h.Task.create({
    title: 'Laptop refresh', type: 'Finance', status: 'pending',
    assignedTo: manager._id, submittedBy: report._id
  }))
  await h.runWithOrgId(org._id, () => h.Task.create({
    title: 'Travel advance', type: 'Finance', status: 'pending',
    assignedTo: employee._id, submittedBy: report._id
  }))

  const browser = await u.launch()
  try {
    const mgr = await u.session(browser, { token: mgrTok, workspace: org.subdomain })
    await mgr.context.addInitScript((userId) => {
      localStorage.setItem(`fs.userGuide.completed.${userId}`, '1')
    }, String(mgr.user?._id || mgr.user?.id || ''))

    // ── OPS-040 — the ops rail ───────────────────────────────────────────────
    await u.goto(mgr.page, '/dashboard')
    const links = await u.sidebarLinks(mgr.page)
    const missing = OPS_HREFS.filter((href) => !u.hasLink(links, href))
    const leaked = BUILDER_HREFS.filter((href) => u.hasLink(links, href))

    h.check('OPS-040', 'A leader\'s sidebar carries approvals, forms, team and reports',
      missing.length === 0, `missing ${missing.join(', ')} — saw ${u.linkHrefs(links)}`)
    h.check('OPS-040', 'A leader\'s sidebar hides the builder and the admin section',
      leaked.length === 0, `leaked ${leaked.join(', ')}`)

    // ── OPS-041 — the dashboard leads with the decision queue ────────────────
    const dashText = await mgr.page.locator('main').innerText().catch(() => '')
    h.check('OPS-041', 'The leader dashboard opens with what is waiting on them',
      /Waiting on you/i.test(dashText) && /Needs your decision/i.test(dashText),
      `body: ${dashText.slice(0, 200).replace(/\s+/g, ' ')}`)

    h.check('OPS-041', 'The queue lists the request waiting on this leader',
      /Laptop refresh/.test(dashText), 'the pending task never rendered')

    h.check('OPS-041', 'The builder dashboard is not what a leader gets',
      !/Total Workflows/i.test(dashText), 'builder stats leaked into the ops dashboard')

    // ── OPS-042 — My Team, and the team tab on the inbox ─────────────────────
    await u.goto(mgr.page, '/team')
    await mgr.page.getByText('UI Ops Report', { exact: true }).first().waitFor()
    const teamText = await mgr.page.locator('main').innerText().catch(() => '')
    h.check('OPS-042', 'My Team lists the people reporting to this leader',
      /UI Ops Report/.test(teamText), `body: ${teamText.slice(0, 200).replace(/\s+/g, ' ')}`)
    h.check('OPS-042', 'My Team does not list people outside the leader\'s branch',
      !/UI Ops Employee/.test(teamText), 'somebody else\'s report leaked into the roster')

    const metricText = await mgr.page.locator('.nf-team-metrics').innerText()
    h.check('OPS-042', 'My Team workload cards use the real team totals',
      /Team members\s+1\b/.test(metricText) && /Open requests\s+2\b/.test(metricText),
      `metrics: ${metricText.replace(/\s+/g, ' ')}`)

    const tableText = await mgr.page.locator('.nf-team-table').innerText()
    h.check('OPS-042', 'My Team list exposes every approved management column',
      ['MEMBER', 'DEPARTMENT', 'PENDING APPROVALS', 'OPEN REQUESTS', 'OVERDUE', 'AVAILABILITY', 'ACTION']
        .every((label) => tableText.includes(label)),
      `table: ${tableText.slice(0, 240).replace(/\s+/g, ' ')}`)

    await mgr.page.locator('.nf-team-table').getByRole('button', { name: 'View details' }).first().click()
    const memberDialog = mgr.page.getByRole('dialog')
    await memberDialog.waitFor()
    const memberDetail = await memberDialog.innerText()
    h.check('OPS-042', 'Team member details retain real identity and reporting data',
      memberDetail.includes(report.email) && /Direct report/.test(memberDetail),
      `dialog: ${memberDetail.replace(/\s+/g, ' ')}`)
    await memberDialog.getByRole('button', { name: 'Close', exact: true }).click()

    await mgr.page.getByRole('button', { name: 'Grid view' }).click()
    h.check('OPS-042', 'My Team switches to the approved member-card view',
      await mgr.page.locator('.nf-team-card').filter({ hasText: 'UI Ops Report' }).isVisible(),
      'the real report did not render in the grid')
    h.check('OPS-042', 'My Team remembers the selected view',
      await mgr.page.evaluate(() => localStorage.getItem('netflow.team.view')) === 'grid',
      'grid preference was not persisted')

    await mgr.page.reload({ waitUntil: 'domcontentloaded' })
    await mgr.page.locator('.nf-team-card').filter({ hasText: 'UI Ops Report' }).waitFor()
    h.check('OPS-042', 'My Team restores the saved grid view after refresh',
      await mgr.page.getByRole('button', { name: 'Grid view' }).getAttribute('aria-pressed') === 'true',
      'grid view was not restored')

    await mgr.page.setViewportSize({ width: 390, height: 844 })
    const mobileFits = await mgr.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
    h.check('OPS-042', 'My Team cards remain contained at mobile width', mobileFits,
      'the page overflowed horizontally at 390px')
    await mgr.page.setViewportSize(u.VIEWPORT)

    await u.goto(mgr.page, '/tasks?scope=team')
    await mgr.page.waitForTimeout(1200)
    const inboxText = await mgr.page.locator('main').innerText().catch(() => '')
    h.check('OPS-042', 'The inbox has a team scope showing what the team raised',
      /Travel advance/.test(inboxText),
      `body: ${inboxText.slice(0, 200).replace(/\s+/g, ' ')}`)
    await mgr.context.close()

    // ── OPS-043 — the builder stays shut, by rail and by URL ─────────────────
    const mgr2 = await u.session(browser, { token: mgrTok, workspace: org.subdomain })
    for (const href of ['/workflows', '/workflows/new', '/departments', '/roles', '/settings']) {
      await u.goto(mgr2.page, href)
      h.check('OPS-043', `A leader typing ${href} is sent back to the dashboard`,
        await u.landsOn(mgr2.page, '/dashboard'), `landed on ${await u.pathOf(mgr2.page)}`)
    }
    await mgr2.context.close()

    // An employee has no team at all — the nav item and the page are both shut.
    const emp = await u.session(browser, { token: empTok, workspace: org.subdomain })
    await u.goto(emp.page, '/dashboard')
    const empLinks = await u.sidebarLinks(emp.page)
    h.check('OPS-043', 'An employee never sees My Team in the rail',
      !u.hasLink(empLinks, '/team'), `saw ${u.linkHrefs(empLinks)}`)

    await u.goto(emp.page, '/team')
    h.check('OPS-043', 'An employee typing /team is sent back to the dashboard',
      await u.landsOn(emp.page, '/dashboard'), `landed on ${await u.pathOf(emp.page)}`)
    await emp.context.close()
  } finally {
    await browser.close()
  }
})
