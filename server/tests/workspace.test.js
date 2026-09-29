// WS — Shell 4 (Workspace): what an employee can reach, and what they cannot.
//
// The shell's promise is that someone who only files requests never sees the
// machinery around them. Two things used to break that promise from the API
// side: the dashboard analytics routes were open to any signed-in caller, and
// GET /api/users handed the whole personnel record to anyone who asked. Both
// are covered here, alongside the submit path an employee actually depends on
// and the role catalogue after Viewer and the pilot roles were retired.

const h = require('./lib/harness')
const { runWithOrgId, Form, Workflow, Task } = h

h.runSuite('workspace', async () => {
  const org = await h.createOrg('ws')

  const admin = await h.createUser(org, { name: 'WS Admin', email: h.emailIn(org, 'ws-admin'), roleName: 'Admin', department: 'IT' })
  const manager = await h.createUser(org, { name: 'WS Manager', email: h.emailIn(org, 'ws-mgr'), roleName: 'Manager', department: 'Finance' })
  const employee = await h.createUser(org, { name: 'WS Employee', email: h.emailIn(org, 'ws-emp'), roleName: 'Employee', department: 'Finance', managerId: manager._id })
  const colleague = await h.createUser(org, { name: 'WS Colleague', email: h.emailIn(org, 'ws-colleague'), roleName: 'Employee', department: 'Finance', managerId: manager._id })

  // Sequential: the auth limiter counts attempts in flight, so a burst of
  // parallel logins trips it even when every one of them is valid.
  const adminTok = await h.getToken({ email: admin.email })
  const mgrTok = await h.getToken({ email: manager.email })
  const empTok = await h.getToken({ email: employee.email })
  const colleagueTok = await h.getToken({ email: colleague.email })
  if (!adminTok || !mgrTok || !empTok || !colleagueTok) {
    h.check('WS-000', 'tokens obtained', false, 'one or more logins failed')
    return
  }

  // A published form routed to the manager for approval — the shape an employee
  // actually meets, and the only shape they can track afterwards.
  const published = await runWithOrgId(org._id, () => Form.create({
    title: 'WS Expense claim',
    description: 'Claim something back',
    status: 'published',
    department: 'Finance',
    fields: [{ id: 'amount', label: 'Amount', type: 'number', required: true }],
    createdBy: admin._id
  }))
  await runWithOrgId(org._id, () => Workflow.create({
    title: 'WS Expense approval',
    status: 'published',
    createdBy: admin._id,
    linkedFormId: published._id,
    nodes: [
      { id: 'start', type: 'start', nextNode: 'approve' },
      { id: 'approve', type: 'approval', config: { approverId: manager._id }, nextNode: 'end' },
      { id: 'end', type: 'end' }
    ]
  }))
  const draft = await runWithOrgId(org._id, () => Form.create({
    title: 'WS Unfinished form',
    status: 'draft',
    fields: [{ id: 'x', label: 'X', type: 'text' }],
    createdBy: admin._id
  }))

  // ── reporting belongs to the leaders ───────────────────────────────────────
  // WS-001..003 every analytics route, not just the two that carried a guard.
  const empSummary = await h.api('GET', '/analytics/summary', empTok)
  h.check('WS-001', 'An employee cannot read the workspace summary',
    empSummary.status === 403, `status ${empSummary.status}`)

  const openRoutes = ['/analytics/completion-time', '/analytics/approval-rate', '/analytics/activity', '/analytics/workflow-control-tower']
  const openStatuses = []
  for (const route of openRoutes) {
    const r = await h.api('GET', route, empTok)
    openStatuses.push(`${route} ${r.status}`)
  }
  h.check('WS-002', 'The dashboard analytics routes are closed to an employee too',
    openStatuses.every((s) => s.endsWith('403')), openStatuses.join(', '))

  const empAudit = await h.api('GET', '/audit-logs', empTok)
  h.check('WS-003', 'An employee cannot read the audit log',
    empAudit.status === 403, `status ${empAudit.status}`)

  // WS-004..005 the guard must not have taken the shells above it down with it.
  const mgrSummary = await h.api('GET', '/analytics/summary', mgrTok)
  h.check('WS-004', 'A leader still reads reports', mgrSummary.status === 200, `status ${mgrSummary.status}`)

  const adminActivity = await h.api('GET', '/analytics/activity', adminTok)
  h.check('WS-005', 'An admin still reads the activity chart', adminActivity.status === 200, `status ${adminActivity.status}`)

  // ── the directory, not the personnel record ────────────────────────────────
  // WS-006 an employee needs colleagues' names for the delegate picker; they do
  // not need who reports to whom, who holds a builder seat, or who has MFA on.
  const empDirectory = await h.api('GET', '/users?isActive=true', empTok)
  const sample = (empDirectory.body?.users || []).find((u) => u.name === 'WS Manager')
  const leakedFields = sample
    ? ['canBuild', 'mfaEnabled', 'managerId', 'hrId', 'lastLogin', 'password', 'notificationPrefs']
      .filter((f) => sample[f] !== undefined)
    : ['<manager missing from directory>']
  h.check('WS-006', 'An employee reads names, not personnel records',
    empDirectory.status === 200 && sample && leakedFields.length === 0,
    `status ${empDirectory.status}, leaked: ${leakedFields.join(', ') || 'none'}`)

  h.check('WS-007', 'The directory still carries what a picker needs',
    !!(sample && sample.name && sample.email && sample.department && sample.role?.name),
    `got ${JSON.stringify(sample || null)}`)

  // WS-008 the Users page is the Admin's, and it still gets everything.
  const adminList = await h.api('GET', '/users?isActive=true', adminTok)
  const adminSample = (adminList.body?.users || []).find((u) => u.name === 'WS Manager')
  h.check('WS-008', 'An admin still sees the full record',
    adminList.status === 200 && adminSample && adminSample.canBuild !== undefined,
    `status ${adminList.status}, canBuild ${adminSample?.canBuild}`)

  // WS-009 the same rule on the single-user route, which the list's projection
  // would otherwise be trivial to walk around.
  const empOne = await h.api('GET', `/users/${manager._id}`, empTok)
  h.check('WS-009', 'Reading one colleague is scoped the same way',
    empOne.status === 200 && empOne.body?.user?.canBuild === undefined && !!empOne.body?.user?.name,
    `status ${empOne.status}, canBuild ${empOne.body?.user?.canBuild}`)

  // ── what the shell is for ──────────────────────────────────────────────────
  // WS-010 the catalogue: published forms only, so a half-written draft never
  // appears as something to start.
  const empForms = await h.api('GET', '/forms', empTok)
  const titles = (empForms.body?.forms || []).map((f) => f.title)
  h.check('WS-010', 'An employee sees published forms only',
    empForms.status === 200 && titles.includes('WS Expense claim') && !titles.includes('WS Unfinished form'),
    `got ${titles.join(', ')}`)

  // WS-011 the one write an employee has.
  const submit = await h.api('POST', `/forms/${published._id}/submit`, empTok, { formData: { amount: 120 } })
  h.check('WS-011', 'An employee can submit a request',
    submit.status === 200 || submit.status === 201, `status ${submit.status} ${JSON.stringify(submit.body?.error || '')}`)

  // WS-012 and it lands in their own list. The engine advances the execution
  // after the response is saved, so the row appears a beat later.
  const mine = await h.waitUntil(async () => {
    const r = await h.api('GET', '/tasks/my-tasks?scope=submitted', empTok)
    return (r.body?.tasks || []).length ? r : null
  })
  h.check('WS-012', 'The request shows up under their own',
    !!mine, `no submitted rows for the employee within the timeout`)

  // WS-013 a colleague's request is not theirs to read.
  await h.api('POST', `/forms/${published._id}/submit`, colleagueTok, { formData: { amount: 500 } })
  const colleagueTask = await h.waitUntil(() => runWithOrgId(org._id, () =>
    Task.findOne({ submittedBy: colleague._id }).select('_id').lean()))
  const mineAgain = await h.api('GET', '/tasks/my-tasks', empTok)
  const seesColleague = (mineAgain.body?.tasks || []).some((t) => String(t.submittedBy?._id || t.submittedBy) === String(colleague._id))
  h.check('WS-013', 'One employee cannot see another employee\'s request',
    !seesColleague, `colleague rows visible: ${seesColleague}`)

  // WS-014 the team scope is a leader's tab. An employee asking for it gets an
  // empty list rather than somebody else's queue.
  const empTeamScope = await h.api('GET', '/tasks/my-tasks?scope=team', empTok)
  h.check('WS-014', 'The team scope is empty for someone who leads nobody',
    empTeamScope.status === 200 && (empTeamScope.body?.tasks || []).length === 0,
    `status ${empTeamScope.status}, count ${empTeamScope.body?.tasks?.length}`)

  // WS-015 acting on a request that isn't theirs. Nothing about being an
  // employee grants an override, so this is a flat refusal.
  if (colleagueTask) {
    const steal = await h.api('POST', `/tasks/${colleagueTask._id}/approve`, empTok, { comment: 'not mine' })
    h.check('WS-015', 'An employee cannot approve a colleague\'s request',
      steal.status === 403 || steal.status === 404, `status ${steal.status}`)
  } else {
    h.note('WS-015', 'Skip', 'the colleague\'s submission produced no task')
  }

  // ── never show ─────────────────────────────────────────────────────────────
  // WS-016..019 the four doors the workspace nav does not offer.
  const empCreateForm = await h.api('POST', '/forms', empTok, { title: 'WS should not design', fields: [] })
  h.check('WS-016', 'An employee cannot create a form', empCreateForm.status === 403, `status ${empCreateForm.status}`)

  const empCreateWorkflow = await h.api('POST', '/workflows', empTok, { title: 'WS should not build', nodes: [] })
  h.check('WS-017', 'An employee cannot create a workflow', empCreateWorkflow.status === 403, `status ${empCreateWorkflow.status}`)

  const empCreateUser = await h.api('POST', '/users', empTok, {
    name: 'Nope', email: h.emailIn(org, 'ws-nope'), department: 'Finance', roleId: String(await h.roleId('Employee'))
  })
  h.check('WS-018', 'An employee cannot create users', empCreateUser.status === 403, `status ${empCreateUser.status}`)

  const empResponses = await h.api('GET', `/forms/${published._id}/responses`, empTok)
  h.check('WS-019', 'An employee cannot read everyone\'s submissions',
    empResponses.status === 403, `status ${empResponses.status}`)

  // WS-020 publishing is a builder's switch, and the Forms page hides it — the
  // API has to refuse it as well.
  const empPublish = await h.api('POST', `/forms/${draft._id}/publish`, empTok, {})
  h.check('WS-020', 'An employee cannot publish a form', empPublish.status === 403, `status ${empPublish.status}`)

  // ── their own account ──────────────────────────────────────────────────────
  // WS-021 profile and out-of-office are the settings an employee does own.
  const profile = await h.api('GET', '/users/me/profile', empTok)
  h.check('WS-021', 'An employee reads their own profile',
    profile.status === 200 && profile.body?.user?.email === employee.email, `status ${profile.status}`)

  const ooo = await h.api('PUT', '/users/me/out-of-office', empTok, {
    enabled: true, from: new Date().toISOString(), until: new Date(Date.now() + 864e5).toISOString(), delegateId: String(colleague._id)
  })
  h.check('WS-022', 'An employee sets their own out-of-office', ooo.status === 200, `status ${ooo.status}`)

  // ── the catalogue after the retirement ─────────────────────────────────────
  // WS-023 Viewer and the five pilot roles promised permissions no guard read.
  const catalogue = await h.api('GET', '/roles', adminTok)
  const roleNames = (catalogue.body?.roles || []).map((r) => r.name)
  const retired = ['Viewer', 'Receiving Staff', 'Warehouse Manager', 'Accounts Officer', 'Brand Rep', 'Finance Approver']
  const stillThere = retired.filter((r) => roleNames.includes(r))
  h.check('WS-023', 'Retired roles are gone from the catalogue',
    stillThere.length === 0, `still offered: ${stillThere.join(', ')}`)

  h.check('WS-024', 'The catalogue is the six workspace roles',
    ['Admin', 'CEO', 'VP', 'Manager', 'HR', 'Employee'].every((r) => roleNames.includes(r)) && !roleNames.includes('SuperAdmin'),
    `got ${roleNames.join(', ')}`)

  // WS-025 the matrix an admin reads is built from the same lists as the guards,
  // so an employee's row must say submit and nothing else.
  const summary = await h.api('GET', '/roles/summary', adminTok)
  const empRow = (summary.body?.roles || []).find((r) => r.name === 'Employee')
  h.check('WS-025', 'The matrix gives Employee no independent role capabilities',
    summary.status === 200 && empRow?.shell === 'workspace'
      && JSON.stringify(empRow?.capabilities) === JSON.stringify([]),
    `shell ${empRow?.shell}, capabilities ${JSON.stringify(empRow?.capabilities)}`)

  // ── across workspaces ──────────────────────────────────────────────────────
  // WS-026 an employee in another tenant sees none of this one, directory
  // included — the projection narrows fields, tenancy narrows rows.
  const otherOrg = await h.createOrg('ws-other')
  const otherEmp = await h.createUser(otherOrg, { name: 'WS Other Employee', email: h.emailIn(otherOrg, 'ws-other-emp'), roleName: 'Employee' })
  const otherTok = await h.getToken({ email: otherEmp.email, subdomain: otherOrg.subdomain })
  const otherDirectory = await h.api('GET', '/users', otherTok)
  const leakedNames = (otherDirectory.body?.users || []).filter((u) => String(u.name).startsWith('WS ') && u.name !== 'WS Other Employee')
  h.check('WS-026', 'An employee in another workspace sees none of this one',
    otherDirectory.status === 200 && leakedNames.length === 0,
    `leaked ${leakedNames.map((u) => u.name).join(', ')}`)

  const otherForms = await h.api('GET', '/forms', otherTok)
  h.check('WS-027', 'And none of its forms',
    otherForms.status === 200 && !(otherForms.body?.forms || []).some((f) => f.title.startsWith('WS ')),
    `got ${(otherForms.body?.forms || []).map((f) => f.title).join(', ')}`)
})
