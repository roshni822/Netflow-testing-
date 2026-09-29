// TSK (UI) — inbox search, attachment links, the approve button's busy state
// and the escalated badge colour.
//
// The approve/reject engine itself is covered by tasks_approvals.test.js; what
// is left here is what the API can't answer: my-tasks has no name filter (the
// search is client-side), and the rest is rendering.

const h = require('./lib/harness')
const u = require('./lib/uiHarness')
const { runWithOrgId, Task, Form, FormResponse, Workflow, WorkflowExecution } = h

const TCS = ['TSK-004', 'TSK-009', 'TSK-013', 'TSK-023']

h.runSuite('ui_tasks', async () => {
  if (!(await u.frontendUp())) return u.skipAll(TCS, u.unavailableReason())

  const org = await h.createOrg('uitsk')
  const approver = await h.createUser(org, {
    name: 'UI Tsk Approver', email: h.emailIn(org, 'uitsk-appr'), roleName: 'Manager'
  })
  const submitter = await h.createUser(org, {
    name: 'UI Tsk Submitter', email: h.emailIn(org, 'uitsk-sub'), roleName: 'Employee'
  })
  const apprTok = await h.getToken({ email: approver.email })

  const mkTask = (extra) => runWithOrgId(org._id, () => Task.create({
    title: 'UI task', type: 'IT', status: 'pending',
    assignedTo: approver._id, submittedBy: submitter._id, ...extra
  }))

  await mkTask({ title: 'Laptop refresh request' })
  await mkTask({ title: 'Travel reimbursement' })
  await mkTask({ title: 'Overdue budget sign-off', status: 'escalated' })

  // Resolved work keeps its real due date for history, but the inbox must show
  // the SLA outcome rather than presenting that date as a future deadline.
  const completedAt = new Date(Date.now() - 5 * 60000)
  const completedWorkflow = await runWithOrgId(org._id, () => Workflow.create({
    title: 'Completed SLA workflow', status: 'published', createdBy: approver._id, nodes: []
  }))
  const completedExecution = await runWithOrgId(org._id, () => WorkflowExecution.create({
    workflowId: completedWorkflow._id,
    triggeredBy: submitter._id,
    status: 'completed',
    startedAt: new Date(Date.now() - 60 * 60000),
    completedAt,
  }))
  await mkTask({
    title: 'Completed SLA display',
    status: 'approved',
    workflowId: completedWorkflow._id,
    workflowExecutionId: completedExecution._id,
    dueDate: new Date(Date.now() + 24 * 60 * 60000),
    approvalHistory: [{ action: 'approved', performedBy: approver._id, performedAt: completedAt }],
  })

  // A real upload so the attachment link resolves to a real file rather than a
  // 404 — "downloads/previews" is only proven if the bytes come back.
  const uploaded = await u.uploadFile(apprTok, { name: 'invoice.png', buf: u.PNG_1PX })
  const form = await runWithOrgId(org._id, () => Form.create({
    title: 'UI Tsk form', status: 'published', createdBy: approver._id,
    fields: [{ id: 'invoice', type: 'file', label: 'Invoice scan' }]
  }))
  const response = await runWithOrgId(org._id, () => FormResponse.create({
    formId: form._id, submittedBy: submitter._id, status: 'submitted',
    formData: { invoice: { name: uploaded.name, url: uploaded.url } }
  }))
  const fileTask = await mkTask({ title: 'Invoice approval', formResponseId: response._id })
  const approveTask = await mkTask({ title: 'Busy state check' })

  const browser = await u.launch()
  try {
    const taskSession = async () => {
      const session = await u.session(browser, { token: apprTok, workspace: org.subdomain })
      await session.context.addInitScript((userId) => {
        localStorage.setItem(`fs.userGuide.completed.${userId}`, '1')
      }, String(session.user?._id || session.user?.id || ''))
      return session
    }

    // ── TSK-004 — the inbox search filters by task name ─────────────────────
    {
      const { context, page } = await taskSession()
      await u.goto(page, '/tasks')
      await page.waitForSelector('#task-search', { timeout: 20000 })
      await page.waitForTimeout(800)

      h.check('TSK-004', 'Managers see the Approval inbox title',
        await page.getByRole('heading', { name: 'Approval inbox' }).isVisible().catch(() => false),
        'the manager inbox title did not render')
      const tabLabels = await page.getByRole('tab').allTextContents()
      h.check('TSK-004', 'Approval scopes use the approved order',
        tabLabels.join('|') === 'Assigned to me|Submitted by me|Team approvals',
        `tabs rendered as ${tabLabels.join('|')}`)
      const columnLabels = await page.locator('.nf-approval-table thead th').allTextContents()
      h.check('TSK-004', 'Assigned approvals expose requester, step, SLA, and actions columns',
        columnLabels.join('|') === 'Request|Requester|Status|Current step|SLA / due|Actions',
        `columns rendered as ${columnLabels.join('|')}`)

      const visibleTitles = async () => {
        const body = await page.locator('main').innerText().catch(async () => page.locator('body').innerText())
        return body
      }

      const before = await visibleTitles()
      h.check('TSK-004', 'Both tasks are listed before searching',
        before.includes('Laptop refresh request') && before.includes('Travel reimbursement'),
        'inbox did not list the seeded tasks')

      await page.fill('#task-search', 'Laptop')
      await page.waitForTimeout(700)
      const after = await visibleTitles()
      h.check('TSK-004', 'Searching a task name keeps the match and drops the rest',
        after.includes('Laptop refresh request') && !after.includes('Travel reimbursement'),
        'search did not narrow the list')

      // A term nothing matches should say so rather than silently showing all.
      await page.fill('#task-search', 'zzzz-no-such-task')
      await page.waitForTimeout(700)
      const empty = await visibleTitles()
      h.check('TSK-004', 'A search with no matches shows the empty state',
        /nothing matches/i.test(empty), 'no empty state for an unmatched search')

      await page.fill('#task-search', 'Completed SLA workflow')
      await page.waitForTimeout(700)
      const completedRow = page.locator('tr', { hasText: 'Completed SLA workflow' }).first()
      const completedText = await completedRow.innerText().catch(() => '')
      h.check('TSK-004', 'Completed approvals show an SLA outcome instead of a future due date',
        completedText.includes('Completed on time') && !completedText.includes('Due tomorrow'),
        `completed row rendered as ${completedText.replace(/\s+/g, ' ').trim()}`)
      h.check('TSK-004', 'Resolved approvals expose one contextual details action without a duplicate overflow',
        await completedRow.getByRole('button', { name: 'View details', exact: true }).isVisible().catch(() => false)
          && await completedRow.getByRole('button', { name: /More actions/i }).count() === 0,
        'the completed row did not render one View details action')

      await context.close()
    }

    // ── TSK-023 — an escalated task wears the orange badge ──────────────────
    {
      const { context, page } = await taskSession()
      await u.goto(page, '/tasks')
      await page.waitForSelector('#task-search', { timeout: 20000 })
      await page.fill('#task-search', 'Overdue budget')
      await page.waitForTimeout(700)

      const badge = page.locator('span', { hasText: /^Escalated$/ }).first()
      const shown = (await badge.count()) > 0
      const cls = shown ? await badge.getAttribute('class') : ''
      h.check('TSK-023', 'An escalated task shows an "Escalated" badge',
        shown, 'no Escalated badge in the inbox')
      h.check('TSK-023', 'The escalated badge is styled orange',
        /orange/.test(cls || ''), `badge classes: ${cls}`)

      await context.close()
    }

    // ── TSK-009 — submitted attachments open ────────────────────────────────
    {
      const { context, page } = await taskSession()
      await u.goto(page, `/tasks/${fileTask._id}`)
      await page.waitForSelector('text=Invoice approval', { timeout: 20000 })

      const link = page.locator(`a[href*="${uploaded.url}"]`).first()
      const hasLink = (await link.count()) > 0
      h.check('TSK-009', 'A submitted file renders as an openable link on the task detail',
        hasLink, `no link pointing at ${uploaded.url}`)

      if (hasLink) {
        const label = (await link.innerText()).trim()
        h.check('TSK-009', 'The attachment link is labelled with the uploaded file name',
          label.includes('invoice.png'), `link read "${label}"`)

        // Fetch it the way the browser would, from inside the page's origin.
        const href = await link.getAttribute('href')
        const fetched = await page.evaluate(async (url) => {
          const r = await fetch(url)
          const b = await r.arrayBuffer()
          return { status: r.status, bytes: b.byteLength, type: r.headers.get('content-type') || '' }
        }, href)
        h.check('TSK-009', 'Opening the attachment serves the real file',
          fetched.status === 200 && fetched.bytes === u.PNG_1PX.length,
          `status ${fetched.status}, ${fetched.bytes} bytes (expected ${u.PNG_1PX.length}), type ${fetched.type}`)
      }

      await context.close()
    }

    // ── TSK-013 — the approve button shows progress and blocks double-submit ─
    {
      const { context, page } = await taskSession()

      // Hold the approve response open so the busy state is observable instead
      // of a sub-100ms flicker.
      let approveCalls = 0
      await page.route('**/api/tasks/*/approve', async (route) => {
        approveCalls++
        await new Promise((r) => setTimeout(r, 2000))
        await route.continue()
      })

      await u.goto(page, '/tasks')
      await page.waitForSelector('#task-search', { timeout: 20000 })
      await page.fill('#task-search', 'Busy state check')
      await page.waitForTimeout(700)

      // Pin the DOM node before clicking: a by-name locator stops matching the
      // moment the label flips to "Approving…", and would silently re-resolve
      // to some other button.
      // Decisions are intentionally kept in the row overflow to preserve the
      // compact catalogue layout while retaining the existing real action.
      const busyRow = page.locator('tr', { hasText: 'Busy state check' }).first()
      await busyRow.getByRole('button', { name: /More actions/i }).click()
      const approveBtn = await page.getByRole('menuitem', { name: /^approve$/i }).first().elementHandle()
      await approveBtn.click()
      await page.waitForTimeout(500)

      const label = (await approveBtn.innerText()).trim()
      const disabled = await approveBtn.isDisabled()
      h.check('TSK-013', 'The approve button switches to "Approving…" while the request is in flight',
        /approving/i.test(label), `button read "${label}"`)
      h.check('TSK-013', 'The approve button is disabled while busy, so it cannot double-submit',
        disabled, 'button stayed clickable during the request')

      // Clicking again while busy must not fire a second approve.
      await approveBtn.click({ force: true, timeout: 2000 }).catch(() => { /* disabled */ })
      await page.waitForTimeout(300)
      h.check('TSK-013', 'A second click while busy sends no extra approve request',
        approveCalls === 1, `${approveCalls} approve requests were sent`)

      // And it settles: the task ends up approved.
      const settled = await h.waitUntil(async () => {
        const t = await runWithOrgId(org._id, () => Task.findById(approveTask._id).lean())
        return t?.status === 'approved' ? t : null
      })
      h.check('TSK-013', 'The approval completes once the request returns',
        Boolean(settled), 'task never reached approved')

      await context.close()
    }
  } finally {
    await browser.close()
  }
})
