// OPS — Shell 3 (Business Ops): what a leader can reach.
//
// The interesting cases here are all about the edge of a leader's authority.
// Until this shell existed, "elevated" was a flat role list — any Manager could
// open, approve or delete any request in the tenant, while HR and VP at the same
// seniority could not touch anything outside their own queue. Authority now
// follows the reporting line, so the suite proves both halves: a leader reaches
// their own people, and stops at the next team over.

const h = require('./lib/harness')
const { runWithOrgId, Task } = h

h.runSuite('ops', async () => {
  const org = await h.createOrg('ops')

  // Two branches of one org chart:
  //   ceo ── vp ── manager ── reportA, reportB
  //       └─ otherManager ── outsider
  // hrLead is nobody's manager but is named as HR partner by reportA.
  const ceo = await h.createUser(org, { name: 'OPS CEO', email: h.emailIn(org, 'ops-ceo'), roleName: 'CEO', department: 'Operations' })
  const vp = await h.createUser(org, { name: 'OPS VP', email: h.emailIn(org, 'ops-vp'), roleName: 'VP', department: 'Operations', managerId: ceo._id })
  const manager = await h.createUser(org, { name: 'OPS Manager', email: h.emailIn(org, 'ops-mgr'), roleName: 'Manager', department: 'Finance', managerId: vp._id })
  const hrLead = await h.createUser(org, { name: 'OPS HR', email: h.emailIn(org, 'ops-hr'), roleName: 'HR', department: 'HR' })
  const reportA = await h.createUser(org, { name: 'OPS Report A', email: h.emailIn(org, 'ops-a'), roleName: 'Employee', department: 'Finance', managerId: manager._id, hrId: hrLead._id })
  const reportB = await h.createUser(org, { name: 'OPS Report B', email: h.emailIn(org, 'ops-b'), roleName: 'Employee', department: 'Finance', managerId: manager._id })
  const otherManager = await h.createUser(org, { name: 'OPS Other Manager', email: h.emailIn(org, 'ops-other-mgr'), roleName: 'Manager', department: 'Legal', managerId: ceo._id })
  const outsider = await h.createUser(org, { name: 'OPS Outsider', email: h.emailIn(org, 'ops-outsider'), roleName: 'Employee', department: 'Legal', managerId: otherManager._id })

  // Logins run one at a time: the auth limiter counts in-flight attempts, so a
  // burst of parallel logins trips it even though every one of them succeeds.
  const ceoTok = await h.getToken({ email: ceo.email })
  const vpTok = await h.getToken({ email: vp.email })
  const mgrTok = await h.getToken({ email: manager.email })
  const hrTok = await h.getToken({ email: hrLead.email })
  const aTok = await h.getToken({ email: reportA.email })
  const outsiderTok = await h.getToken({ email: outsider.email })
  const otherMgrTok = await h.getToken({ email: otherManager.email })
  if (!ceoTok || !vpTok || !mgrTok || !hrTok || !aTok || !outsiderTok) {
    h.check('OPS-000', 'tokens obtained', false, 'one or more logins failed')
    return
  }

  const mkTask = (extra) => runWithOrgId(org._id, () => Task.create({
    title: 'OPS task', type: 'Finance', status: 'pending', ...extra
  }))

  // ── the team endpoint ──────────────────────────────────────────────────────
  // OPS-001 a manager sees the people who report to them, and nobody else.
  const mgrTeam = await h.api('GET', '/team', mgrTok)
  const mgrNames = (mgrTeam.body?.members || []).map((m) => m.name).sort()
  h.check('OPS-001', 'A manager sees their direct reports',
    mgrTeam.status === 200 && mgrNames.join(',') === 'OPS Report A,OPS Report B',
    `status ${mgrTeam.status}, got ${mgrNames.join(', ')}`)

  h.check('OPS-002', 'A manager does not see another team',
    !mgrNames.includes('OPS Outsider'), `got ${mgrNames.join(', ')}`)

  // OPS-003 reach is transitive: a VP gets their managers' reports too.
  const vpTeam = await h.api('GET', '/team', vpTok)
  const vpNames = (vpTeam.body?.members || []).map((m) => m.name)
  h.check('OPS-003', 'A VP reaches down the whole reporting chain',
    vpTeam.status === 200 && vpNames.includes('OPS Manager') && vpNames.includes('OPS Report A'),
    `got ${vpNames.join(', ')}`)

  // OPS-004 HR partners count as team even without a reporting line.
  const hrTeam = await h.api('GET', '/team', hrTok)
  const hrNames = (hrTeam.body?.members || []).map((m) => m.name)
  h.check('OPS-004', 'An HR partner sees the people who name them',
    hrTeam.status === 200 && hrNames.length === 1 && hrNames[0] === 'OPS Report A',
    `got ${hrNames.join(', ')}`)

  // OPS-005 the CEO answers for the workspace, so their team is everyone.
  const ceoTeam = await h.api('GET', '/team', ceoTok)
  h.check('OPS-005', 'The CEO sees the whole workspace',
    ceoTeam.status === 200 && ceoTeam.body?.reach === 'org' && (ceoTeam.body?.members || []).length >= 7,
    `reach ${ceoTeam.body?.reach}, count ${ceoTeam.body?.members?.length}`)

  // OPS-006 an employee has no team page at all.
  const empTeam = await h.api('GET', '/team', aTok)
  h.check('OPS-006', 'An employee cannot open the team endpoint', empTeam.status === 403, `status ${empTeam.status}`)

  // OPS-007 rows carry live counts, which is the whole point of the page.
  await mkTask({ title: 'Sitting with A', assignedTo: reportA._id, submittedBy: reportB._id })
  await mkTask({ title: 'Raised by A', assignedTo: manager._id, submittedBy: reportA._id })
  await mkTask({ title: 'Overdue with A', assignedTo: reportA._id, submittedBy: reportB._id, dueDate: new Date(Date.now() - 86400000) })
  const counted = await h.api('GET', '/team', mgrTok)
  const rowA = (counted.body?.members || []).find((m) => m.name === 'OPS Report A')
  h.check('OPS-007', 'Team rows carry the live queue, overdue and raised counts',
    rowA?.pendingApprovals === 2 && rowA?.overdue === 1 && rowA?.openRequests === 1,
    `queue ${rowA?.pendingApprovals}, overdue ${rowA?.overdue}, raised ${rowA?.openRequests}`)

  h.check('OPS-008', 'Team totals add up across the team',
    counted.body?.totals?.pendingApprovals === 2 && counted.body?.totals?.overdue === 1,
    `totals ${JSON.stringify(counted.body?.totals)}`)

  // OPS-031 whoever is away is flagged on the roster, using the same window test
  // the engine applies when it redirects their work to a delegate.
  await h.api('PUT', '/users/me/out-of-office', aTok, { enabled: true, until: new Date(Date.now() + 3 * 86400000) })
  const away = await h.api('GET', '/team', mgrTok)
  const rowAway = (away.body?.members || []).find((m) => m.name === 'OPS Report A')
  const rowHere = (away.body?.members || []).find((m) => m.name === 'OPS Report B')
  h.check('OPS-031', 'The roster flags who is out of office',
    !!rowAway?.outOfOffice && rowHere?.outOfOffice === null,
    `A ${JSON.stringify(rowAway?.outOfOffice)}, B ${JSON.stringify(rowHere?.outOfOffice)}`)
  await h.api('PUT', '/users/me/out-of-office', aTok, { enabled: false })

  // ── the team scope on the inbox ────────────────────────────────────────────
  // OPS-009 a leader can list what their people have in flight.
  const teamScope = await h.api('GET', '/tasks/my-tasks?scope=team', mgrTok)
  const teamTitles = (teamScope.body?.tasks || []).map((t) => t.title)
  h.check('OPS-009', 'scope=team lists the team\'s requests',
    teamScope.status === 200 && teamTitles.includes('Raised by A') && teamTitles.includes('Sitting with A'),
    `got ${teamTitles.join(', ')}`)

  // OPS-010 and it stops at the team boundary.
  await mkTask({ title: 'Legal only', assignedTo: outsider._id, submittedBy: outsider._id })
  const teamScope2 = await h.api('GET', '/tasks/my-tasks?scope=team', mgrTok)
  h.check('OPS-010', 'scope=team excludes other teams',
    !(teamScope2.body?.tasks || []).some((t) => t.title === 'Legal only'),
    `got ${(teamScope2.body?.tasks || []).map((t) => t.title).join(', ')}`)

  // OPS-011 someone with no reports gets an empty list, not an error.
  const noTeam = await h.api('GET', '/tasks/my-tasks?scope=team', otherMgrTok)
  const noTeamTitles = (noTeam.body?.tasks || []).map((t) => t.title)
  h.check('OPS-011', 'A leader with one report only sees that report\'s work',
    noTeam.status === 200 && noTeamTitles.length === 1 && noTeamTitles[0] === 'Legal only',
    `status ${noTeam.status}, got ${noTeamTitles.join(', ')}`)

  // ── the override, which is the part that used to be too wide ───────────────
  const outsiderTask = await mkTask({ title: 'Outsider request', assignedTo: otherManager._id, submittedBy: outsider._id })
  const ownTeamTask = await mkTask({ title: 'Team request', assignedTo: hrLead._id, submittedBy: reportB._id })

  // OPS-012 a leader opens a request from their own team even when it is
  // assigned to somebody else.
  const readOwn = await h.api('GET', `/tasks/${ownTeamTask._id}`, mgrTok)
  h.check('OPS-012', 'A manager can open a request raised by their own report',
    readOwn.status === 200, `status ${readOwn.status}`)

  // OPS-013 …and is refused on the next team over. This is the regression that
  // matters: before Shell 3 this returned 200.
  const readOther = await h.api('GET', `/tasks/${outsiderTask._id}`, mgrTok)
  h.check('OPS-013', 'A manager cannot open another team\'s request',
    readOther.status === 403, `status ${readOther.status}`)

  // OPS-014 the same rule governs acting, not just reading.
  const actOther = await h.api('POST', `/tasks/${outsiderTask._id}/approve`, mgrTok, {})
  h.check('OPS-014', 'A manager cannot approve another team\'s request',
    actOther.status === 403, `status ${actOther.status}`)

  const actOwn = await h.api('POST', `/tasks/${ownTeamTask._id}/approve`, mgrTok, {})
  h.check('OPS-015', 'A manager can approve on behalf of their own team',
    actOwn.status === 200, `status ${actOwn.status}`)

  // OPS-016 HR and VP now behave like the Manager they sit beside — previously
  // they were missing from the elevated list entirely.
  const hrReadOwn = await h.api('GET', `/tasks/${(await mkTask({ title: 'A raised', assignedTo: manager._id, submittedBy: reportA._id }))._id}`, hrTok)
  h.check('OPS-016', 'An HR partner can open their person\'s request',
    hrReadOwn.status === 200, `status ${hrReadOwn.status}`)

  const vpReadDown = await h.api('GET', `/tasks/${ownTeamTask._id}`, vpTok)
  h.check('OPS-017', 'A VP reaches requests two levels down',
    vpReadDown.status === 200, `status ${vpReadDown.status}`)

  // OPS-018 the CEO keeps the workspace-wide override.
  const ceoRead = await h.api('GET', `/tasks/${outsiderTask._id}`, ceoTok)
  h.check('OPS-018', 'The CEO can open any request in the workspace',
    ceoRead.status === 200, `status ${ceoRead.status}`)

  // OPS-019 an employee is still limited to their own records.
  const empRead = await h.api('GET', `/tasks/${outsiderTask._id}`, aTok)
  h.check('OPS-019', 'An employee cannot open somebody else\'s request',
    empRead.status === 403, `status ${empRead.status}`)

  // OPS-020 deleting somebody else's request follows the same boundary.
  const delOther = await h.api('DELETE', `/tasks/${outsiderTask._id}`, mgrTok)
  h.check('OPS-020', 'A manager cannot delete another team\'s request',
    delOther.status === 403, `status ${delOther.status}`)

  // ── reports are scoped the same way ────────────────────────────────────────
  // OPS-021 the summary says whose numbers these are.
  const mgrSummary = await h.api('GET', '/analytics/summary', mgrTok)
  h.check('OPS-021', 'Analytics tells a leader their reports are team-scoped',
    mgrSummary.status === 200 && mgrSummary.body?.scope?.reach === 'team',
    `status ${mgrSummary.status}, reach ${mgrSummary.body?.scope?.reach}`)

  const ceoSummary = await h.api('GET', '/analytics/summary', ceoTok)
  h.check('OPS-022', 'Analytics is workspace-wide for the CEO',
    ceoSummary.body?.scope?.reach === 'org', `reach ${ceoSummary.body?.scope?.reach}`)

  // OPS-023 a manager's report counts only their own people. reportA and reportB
  // raised two requests between them; the Legal branch raised one more.
  const mgrRate = await h.api('GET', '/analytics/approval-rate', mgrTok)
  const mgrTotal = (mgrRate.body?.distribution || []).reduce((s, r) => s + (r.count || 0), 0)
  const ceoRate = await h.api('GET', '/analytics/approval-rate', ceoTok)
  const ceoTotal = (ceoRate.body?.distribution || []).reduce((s, r) => s + (r.count || 0), 0)
  h.check('OPS-023', 'A leader\'s report is narrower than the workspace one',
    mgrTotal > 0 && ceoTotal > mgrTotal, `manager ${mgrTotal}, ceo ${ceoTotal}`)

  // OPS-024 the department filter narrows further, and cannot widen past reach.
  const legalForManager = await h.api('GET', '/analytics/approval-rate?department=Legal', mgrTok)
  const legalTotal = (legalForManager.body?.distribution || []).reduce((s, r) => s + (r.count || 0), 0)
  h.check('OPS-024', 'A department filter cannot reach outside a leader\'s people',
    legalTotal === 0, `Legal rows visible to the Finance manager: ${legalTotal}`)

  const legalForCeo = await h.api('GET', '/analytics/approval-rate?department=Legal', ceoTok)
  const legalCeoTotal = (legalForCeo.body?.distribution || []).reduce((s, r) => s + (r.count || 0), 0)
  h.check('OPS-025', 'The department filter works for a workspace-wide reader',
    legalCeoTotal > 0 && legalCeoTotal < ceoTotal, `legal ${legalCeoTotal}, all ${ceoTotal}`)

  // ── leaders are not builders ───────────────────────────────────────────────
  // OPS-026 the strict split: Shell 3 operates, Shell 2 configures.
  const mgrBuild = await h.api('POST', '/workflows', mgrTok, { title: 'OPS should not build', nodes: [] })
  h.check('OPS-026', 'A manager cannot create a workflow', mgrBuild.status === 403, `status ${mgrBuild.status}`)

  const mgrForm = await h.api('POST', '/forms', mgrTok, { title: 'OPS should not design', fields: [] })
  h.check('OPS-027', 'A manager cannot create a form', mgrForm.status === 403, `status ${mgrForm.status}`)

  const mgrUsers = await h.api('POST', '/users', mgrTok, {
    name: 'Nope', email: h.emailIn(org, 'ops-nope'), department: 'Finance', roleId: String(await h.roleId('Employee'))
  })
  h.check('OPS-028', 'A manager cannot create users', mgrUsers.status === 403, `status ${mgrUsers.status}`)

  // OPS-029 a leader still reads the workspace departments — the picker on their
  // reports page depends on it.
  const mgrDepts = await h.api('GET', '/departments', mgrTok)
  h.check('OPS-029', 'A leader can read the department list',
    mgrDepts.status === 200 && (mgrDepts.body?.departments || []).length > 0, `status ${mgrDepts.status}`)

  // OPS-030 the team page never leaks across tenants: reach is computed inside
  // the caller's org context, so a second workspace stays invisible.
  const otherOrg = await h.createOrg('ops-other')
  const otherCeo = await h.createUser(otherOrg, { name: 'OTHER CEO', email: h.emailIn(otherOrg, 'ops-other-ceo'), roleName: 'CEO' })
  const otherTok = await h.getToken({ email: otherCeo.email, subdomain: otherOrg.subdomain })
  const otherTeam = await h.api('GET', '/team', otherTok)
  const leaked = (otherTeam.body?.members || []).some((m) => String(m.name).startsWith('OPS '))
  h.check('OPS-030', 'A leader in another workspace sees none of this one',
    otherTeam.status === 200 && !leaked, `members ${(otherTeam.body?.members || []).map((m) => m.name).join(', ')}`)
})
