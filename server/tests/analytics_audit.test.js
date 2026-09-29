// ANA — Analytics (summary + reports vs DB truth, access gate) and Audit log
// (events created, filter, pagination). CSV/PDF export (ANA-008/009) is
// generated client-side → Pending.

const h = require('./lib/harness')
const { runWithOrgId, Task, Workflow, WorkflowExecution } = h
const { escalateTask } = require('../jobs/escalationCron')

const publishWorkflow = async (token, title, nodes) => {
  const created = await h.api('POST', '/workflows', token, { title, nodes })
  const id = created.body?.workflow?._id
  await h.api('POST', `/workflows/${id}/publish`, token)
  return id
}

h.runSuite('analytics_audit', async () => {
  const org = await h.createOrg('ana')

  const manager = await h.createUser(org, { name: 'ANA Manager', email: h.emailIn(org, 'ana-mgr'), roleName: 'Admin', department: 'IT' })
  const submitter = await h.createUser(org, { name: 'ANA Submitter', email: h.emailIn(org, 'ana-sub'), roleName: 'Employee', department: 'IT', managerId: manager._id })
  const employee = await h.createUser(org, { name: 'ANA Employee', email: h.emailIn(org, 'ana-emp'), roleName: 'Employee' })

  const mgrTok = await h.getToken({ email: manager.email })
  const subTok = await h.getToken({ email: submitter.email })
  const empTok = await h.getToken({ email: employee.email })

  // Both exports are built in the browser and never hit the API; the downloads
  // are captured and opened in ui_analytics.test.js, which upgrades these.
  h.note('ANA-008', 'Pending', 'Frontend: covered by ui_analytics.test.js')
  h.note('ANA-009', 'Pending', 'Frontend: covered by ui_analytics.test.js')

  // ── Static, controlled dataset (created directly so counts are deterministic) ──
  const wfDoc = await runWithOrgId(org._id, () => Workflow.create({ title: 'ANA seed wf', status: 'published', createdBy: manager._id, nodes: [] }))
  const mkTask = (status) => runWithOrgId(org._id, () => Task.create({ title: `ANA ${status}`, type: 'IT', status, assignedTo: manager._id, submittedBy: submitter._id }))
  await mkTask('approved'); await mkTask('approved'); await mkTask('rejected'); await mkTask('pending')
  await runWithOrgId(org._id, () => WorkflowExecution.create({ workflowId: wfDoc._id, triggeredBy: submitter._id, status: 'completed', startedAt: new Date(Date.now() - 3600000), completedAt: new Date() }))
  await runWithOrgId(org._id, () => WorkflowExecution.create({ workflowId: wfDoc._id, triggeredBy: submitter._id, status: 'running', startedAt: new Date() }))

  const towerWorkflow = await runWithOrgId(org._id, () => Workflow.create({
    title: 'ANA control tower risk',
    status: 'published',
    createdBy: manager._id,
    nodes: [],
  }))
  const towerDay = '2026-01-15'
  const towerRun = (status, createdAt, startedAt, completedAt) => runWithOrgId(org._id, () => WorkflowExecution.create({
    workflowId: towerWorkflow._id,
    triggeredBy: submitter._id,
    status,
    createdAt: new Date(createdAt),
    startedAt: new Date(startedAt || createdAt),
    ...(completedAt ? { completedAt: new Date(completedAt) } : {}),
  }))
  await towerRun('completed', `${towerDay}T08:00:00Z`, `${towerDay}T07:00:00Z`, `${towerDay}T08:00:00Z`)
  await towerRun('failed', `${towerDay}T09:00:00Z`)
  await towerRun('cancelled', `${towerDay}T10:00:00Z`)
  await towerRun('paused', `${towerDay}T11:00:00Z`)
  await towerRun('completed', `${towerDay}T12:00:00Z`, `${towerDay}T09:00:00Z`, `${towerDay}T12:00:00Z`)
  const towerTask = (status, dueDate) => runWithOrgId(org._id, () => Task.create({
    title: `ANA tower ${status}`,
    type: 'IT',
    status,
    assignedTo: manager._id,
    submittedBy: submitter._id,
    workflowId: towerWorkflow._id,
    createdAt: new Date(`${towerDay}T13:00:00Z`),
    ...(dueDate ? { dueDate } : {}),
  }))
  await towerTask('pending', new Date(Date.now() - 3600000))
  await towerTask('escalated')
  await towerTask('completed', new Date(Date.now() - 7200000))

  // ANA-001 analytics endpoints load.
  const summary = await h.api('GET', '/analytics/summary', mgrTok)
  const approvalRate = await h.api('GET', '/analytics/approval-rate', mgrTok)
  const completion = await h.api('GET', '/analytics/completion-time', mgrTok)
  const activity = await h.api('GET', '/analytics/activity', mgrTok)
  h.check('ANA-001', 'Analytics page endpoints load (summary/charts)', [summary, approvalRate, completion, activity].every((r) => r.status === 200), `statuses ${[summary, approvalRate, completion, activity].map((r) => r.status).join(',')}`)

  // ANA-002 summary counts match DB truth (org-scoped).
  const truth = await runWithOrgId(org._id, () => Promise.all([
    Task.countDocuments({ status: 'approved' }),
    Task.countDocuments({ status: 'rejected' }),
    Task.countDocuments({ status: 'pending' }),
    WorkflowExecution.countDocuments({})
  ]))
  const s = summary.body?.summary || {}
  h.check('ANA-002', 'Summary stats match actual data', s.approvedTasks === truth[0] && s.rejectedTasks === truth[1] && s.pendingTasks === truth[2] && s.totalExecutions === truth[3], `summary ${s.approvedTasks}/${s.rejectedTasks}/${s.pendingTasks}/${s.totalExecutions} vs db ${truth.join('/')}`)

  // ANA-003 completion-time report renders a series.
  h.check('ANA-003', 'Completion-time report returns a series', completion.status === 200 && Array.isArray(completion.body?.series) && completion.body.series.length >= 1, `series ${completion.body?.series?.length}`)

  // ANA-004 approval-rate distribution matches counts.
  const dist = approvalRate.body?.distribution || []
  const approvedRow = dist.find((d) => d.status === 'approved')
  const rejectedRow = dist.find((d) => d.status === 'rejected')
  h.check('ANA-004', 'Approval-rate distribution matches counts', (approvedRow?.count || 0) === truth[0] && (rejectedRow?.count || 0) === truth[1], `dist approved ${approvedRow?.count}, rejected ${rejectedRow?.count} vs ${truth[0]}/${truth[1]}`)

  // ANA-005 department KPI report.
  const kpis = await h.api('GET', '/analytics/department-kpis', mgrTok)
  const itRow = (kpis.body?.kpis || []).find((k) => k.department === 'IT')
  h.check('ANA-005', 'Department KPI report has correct IT figures', kpis.status === 200 && !!itRow && itRow.totalRequests >= 4 && itRow.approved >= 2 && itRow.rejected >= 1, `itRow ${JSON.stringify(itRow)}`)

  // ANA-006 SLA breach report renders.
  const sla = await h.api('GET', '/analytics/sla-breaches', mgrTok)
  h.check('ANA-006', 'SLA breach report returns a series', sla.status === 200 && Array.isArray(sla.body?.series), `status ${sla.status}`)

  const tower = await h.api('GET', `/analytics/workflow-control-tower?from=${towerDay}&to=${towerDay}&limit=6`, mgrTok)
  const towerRisk = tower.body?.workflows?.[0]
  h.check('ANA-023', 'Workflow Control Tower separates live workload from selected-period performance',
    tower.status === 200 &&
      tower.body?.period?.from === towerDay &&
      tower.body?.period?.to === towerDay &&
      tower.body?.totals?.openRequests === 2 &&
      tower.body?.totals?.overdueTasks === 1 &&
      tower.body?.totals?.failedRuns === 1 &&
      tower.body?.totals?.medianCompletionMs === 7200000,
    JSON.stringify(tower.body))
  h.check('ANA-024', 'Workflow Control Tower groups without duplicating requests and sorts risk first',
    String(towerRisk?.workflowId) === String(towerWorkflow._id) &&
      towerRisk?.openRequests === 1 &&
      towerRisk?.pendingTasks === 2 &&
      towerRisk?.overdueTasks === 1 &&
      towerRisk?.failedRuns === 1 &&
      towerRisk?.terminalRuns === 4 &&
      towerRisk?.completionRate === 50 &&
      tower.body?.totalWorkflows === 2,
    JSON.stringify(towerRisk))
  const limitedTower = await h.api('GET', `/analytics/workflow-control-tower?from=${towerDay}&to=${towerDay}&limit=1`, mgrTok)
  const invalidTower = await h.api('GET', `/analytics/workflow-control-tower?from=${towerDay}`, mgrTok)
  h.check('ANA-025', 'Workflow Control Tower caps rows and rejects incomplete exact ranges',
    limitedTower.status === 200 &&
      limitedTower.body?.workflows?.length === 1 &&
      limitedTower.body?.returnedWorkflows === 1 &&
      invalidTower.status === 400 &&
      invalidTower.body?.code === 'INVALID_DATE_RANGE',
    `limited ${JSON.stringify(limitedTower.body)}, invalid ${JSON.stringify(invalidTower.body)}`)

  // ANA-007 date-range filter changes results (future window → zero).
  const future = new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10)
  const filtered = await h.api('GET', `/analytics/summary?from=${future}`, mgrTok)
  h.check('ANA-007', 'Date-range filter is applied', filtered.status === 200 && (filtered.body?.summary?.totalExecutions || 0) === 0 && (filtered.body?.summary?.approvedTasks || 0) === 0, `future totals exec ${filtered.body?.summary?.totalExecutions}, approved ${filtered.body?.summary?.approvedTasks}`)

  // Exact ranges power the Org Admin dashboard's single global date filter.
  const todayUtc = new Date().toISOString().slice(0, 10)
  const exactActivity = await h.api('GET', `/analytics/activity?from=${todayUtc}&to=${todayUtc}`, mgrTok)
  const exactSeries = exactActivity.body?.series || []
  h.check('ANA-019', 'Activity accepts an exact From/Till range',
    exactActivity.status === 200 && exactSeries.length === 1 && exactSeries[0]?.isoDate === todayUtc &&
      exactSeries[0]?.completed === 1 && exactSeries[0]?.inProgress === 1,
    `status ${exactActivity.status}, series ${JSON.stringify(exactSeries)}`)

  const rangeStart = new Date(`${todayUtc}T00:00:00.000Z`)
  rangeStart.setUTCDate(rangeStart.getUTCDate() - 90)
  const oversizedActivity = await h.api('GET', `/analytics/activity?from=${rangeStart.toISOString().slice(0, 10)}&to=${todayUtc}`, mgrTok)
  h.check('ANA-020', 'Activity rejects ranges longer than 90 days',
    oversizedActivity.status === 400 && oversizedActivity.body?.code === 'DATE_RANGE_TOO_LARGE',
    `status ${oversizedActivity.status}, body ${JSON.stringify(oversizedActivity.body)}`)

  const dayOffset = (offset) => {
    const date = new Date(`${todayUtc}T00:00:00Z`)
    date.setUTCDate(date.getUTCDate() + offset)
    return date.toISOString().slice(0, 10)
  }
  await runWithOrgId(org._id, () => Task.create({
    title: 'ANA exact-range overdue', type: 'IT', status: 'pending',
    assignedTo: manager._id, submittedBy: submitter._id,
    createdAt: new Date(`${todayUtc}T00:00:00.000Z`),
    dueDate: new Date(`${todayUtc}T00:00:00.001Z`),
  }))
  await runWithOrgId(org._id, () => Task.create({
    title: 'ANA outside-range overdue', type: 'IT', status: 'pending',
    assignedTo: manager._id, submittedBy: submitter._id,
    createdAt: new Date(`${dayOffset(-1)}T00:00:00.000Z`),
    dueDate: new Date(`${dayOffset(-1)}T00:00:00.001Z`),
  }))
  const exactSla = await h.api('GET', `/analytics/sla-breaches?from=${todayUtc}&to=${todayUtc}`, mgrTok)
  const exactSlaTotal = (exactSla.body?.series || []).reduce((sum, row) => sum + Number(row.breaches || 0), 0)
  h.check('ANA-021', 'SLA breaches use exact dashboard boundaries and count active overdue tasks',
    exactSla.status === 200 && exactSlaTotal === 1 &&
      exactSla.body?.range?.from === todayUtc && exactSla.body?.range?.to === todayUtc,
    JSON.stringify(exactSla.body))
  const invalidExactSla = await h.api('GET', `/analytics/sla-breaches?from=${todayUtc}`, mgrTok)
  h.check('ANA-022', 'SLA exact ranges reject incomplete boundaries',
    invalidExactSla.status === 400 && invalidExactSla.body?.code === 'INVALID_DATE_RANGE',
    JSON.stringify(invalidExactSla.body))

  const seedExecution = (status, createdAt) => runWithOrgId(org._id, () => WorkflowExecution.create({
    workflowId: wfDoc._id, triggeredBy: submitter._id, status, createdAt: new Date(createdAt),
  }))
  await seedExecution('running', `${dayOffset(-6)}T23:59:59.999Z`)
  await seedExecution('completed', `${dayOffset(-5)}T00:00:00.000Z`)
  await seedExecution('cancelled', `${dayOffset(-3)}T12:00:00.000Z`)
  await seedExecution('failed', `${dayOffset(-2)}T23:59:59.999Z`)
  await seedExecution('completed', `${dayOffset(-1)}T00:00:00.000Z`)
  const historicalQuery = `from=${dayOffset(-5)}&to=${dayOffset(-2)}`
  const historical = await h.api('GET', `/analytics/activity?${historicalQuery}`, mgrTok)
  const historicalSummary = await h.api('GET', `/analytics/summary?${historicalQuery}`, mgrTok)
  const historicalSeries = historical.body?.series || []
  const countRuns = (rows) => rows.reduce((sum, row) => sum + ['completed', 'inProgress', 'onHold', 'failed', 'cancelled'].reduce((n, key) => n + Number(row[key] || 0), 0), 0)
  h.check('ANA-019', 'Exact ranges include UTC boundaries, zero-fill gaps and count all execution statuses once',
    historical.status === 200 && historicalSeries.length === 4 &&
      historicalSeries[0]?.completed === 1 && countRuns([historicalSeries[1]]) === 0 &&
      historicalSeries[2]?.cancelled === 1 && historicalSeries[3]?.failed === 1 &&
      countRuns(historicalSeries) === 3 && historicalSummary.body?.summary?.totalExecutions === 3,
    `series ${JSON.stringify(historicalSeries)}`)
  const todayAfterHistory = await h.api('GET', `/analytics/activity?from=${todayUtc}&to=${todayUtc}`, mgrTok)
  h.check('ANA-019', 'Exact ranges exclude live runs created before the period',
    countRuns(todayAfterHistory.body?.series || []) === 2,
    JSON.stringify(todayAfterHistory.body))
  const legacyActivity = await h.api('GET', '/analytics/activity?days=7', mgrTok)
  h.check('ANA-019', 'Legacy days-based activity keeps its live overlay and response fields',
    legacyActivity.status === 200 && legacyActivity.body?.series?.length === 7 &&
      legacyActivity.body.series.at(-1).inProgress === 2 &&
      !Object.hasOwn(legacyActivity.body.series[0], 'cancelled'), JSON.stringify(legacyActivity.body))
  const invalidQueries = ['from=2026-02-30&to=2026-03-01', `from=${todayUtc}`, `from=${todayUtc}&to=${dayOffset(-1)}`]
  const invalidResponses = await Promise.all(invalidQueries.map((query) => h.api('GET', `/analytics/activity?${query}`, mgrTok)))
  h.check('ANA-020', 'Malformed, incomplete and reversed exact ranges are rejected',
    invalidResponses.every((response) => response.status === 400 && response.body?.code === 'INVALID_DATE_RANGE'))
  const maximumRange = await h.api('GET', `/analytics/activity?from=${dayOffset(-89)}&to=${todayUtc}`, mgrTok)
  h.check('ANA-020', 'A 90-day inclusive range is supported', maximumRange.status === 200 && maximumRange.body?.series?.length === 90)

  // ANA-010 empty-data org does not crash.
  const emptyOrg = await h.createOrg('ana-empty')
  const emptyMgr = await h.createUser(emptyOrg, { name: 'Empty Mgr', email: h.emailIn(emptyOrg, 'ana-empty-mgr'), roleName: 'Manager' })
  const emptyTok = await h.getToken({ email: emptyMgr.email })
  const emptySummary = await h.api('GET', '/analytics/summary', emptyTok)
  h.check('ANA-010', 'Empty-data analytics returns zeros, no crash', emptySummary.status === 200 && (emptySummary.body?.summary?.totalExecutions || 0) === 0, `status ${emptySummary.status}`)
  const emptyTower = await h.api('GET', '/analytics/workflow-control-tower', emptyTok)
  h.check('ANA-026', 'Empty tenant returns a stable Control Tower empty state',
    emptyTower.status === 200 &&
      emptyTower.body?.totalWorkflows === 0 &&
      emptyTower.body?.workflows?.length === 0 &&
      emptyTower.body?.totals?.openRequests === 0,
    JSON.stringify(emptyTower.body))

  // ANA-011 employee blocked from restricted reports.
  const empKpis = await h.api('GET', '/analytics/department-kpis', empTok)
  const empSla = await h.api('GET', '/analytics/sla-breaches', empTok)
  const empTower = await h.api('GET', '/analytics/workflow-control-tower', empTok)
  h.check('ANA-011', 'Employee blocked from restricted analytics (403)',
    empKpis.status === 403 && empSla.status === 403 && empTower.status === 403,
    `kpis ${empKpis.status}, sla ${empSla.status}, tower ${empTower.status}`)

  // ── Audit log ───────────────────────────────────────────────────────────────
  // ANA-012 audit log loads.
  const auditLoad = await h.api('GET', '/audit-logs', mgrTok)
  h.check('ANA-012', 'Audit log page loads events with timestamps', auditLoad.status === 200 && Array.isArray(auditLoad.body?.logs), `status ${auditLoad.status}`)

  // Trigger real audit events.
  const startedWf = await publishWorkflow(mgrTok, 'ANA started wf', [
    { id: 'start', type: 'start', nextNode: 'a' },
    { id: 'a', type: 'approval', config: { approverId: manager._id }, nextNode: 'end' },
    { id: 'end', type: 'end' }
  ])
  const startExec = await h.api('POST', `/workflows/${startedWf}/execute`, subTok, {})
  const startTask = await h.waitUntil(() => runWithOrgId(org._id, () => Task.findOne({ workflowExecutionId: startExec.body?.executionId, status: 'pending' }).lean()))
  await h.api('POST', `/tasks/${startTask._id}/approve`, mgrTok, {}) // → workflow_completed

  // approver_inferred via direct_manager routing.
  const inferWf = await publishWorkflow(mgrTok, 'ANA infer wf', [
    { id: 'start', type: 'start', nextNode: 'a' },
    { id: 'a', type: 'approval', config: { approverRole: 'direct_manager' }, nextNode: 'end' },
    { id: 'end', type: 'end' }
  ])
  await h.api('POST', `/workflows/${inferWf}/execute`, subTok, {})

  // task_escalated via the real escalation code path.
  const overdue = await runWithOrgId(org._id, () => Task.create({ title: 'ANA overdue', type: 'IT', status: 'pending', assignedTo: submitter._id, submittedBy: submitter._id, dueDate: new Date(Date.now() - 3 * 3600000), isEscalated: false }))
  const populated = await runWithOrgId(org._id, () => Task.findById(overdue._id).populate('assignedTo submittedBy').lean())
  await runWithOrgId(org._id, () => escalateTask(populated, new Date()))

  const hasAction = (action) => h.waitUntil(async () => {
    const r = await h.api('GET', `/audit-logs?action=${action}`, mgrTok)
    return (r.body?.logs || []).length >= 1 ? r : null
  })
  const started = await hasAction('workflow_started')
  const completed = await hasAction('workflow_completed')
  const escalated = await hasAction('task_escalated')
  const inferred = await hasAction('approver_inferred')

  h.check('ANA-013', 'workflow_started audit event is written', !!started)
  h.check('ANA-014', 'workflow_completed audit event is written', !!completed)
  h.check('ANA-015', 'task_escalated audit event is written', !!escalated)
  h.check('ANA-016', 'approver_inferred audit event is written', !!inferred)

  // ANA-017 filter by action returns only that action.
  h.check('ANA-017', 'Audit log filter narrows to the chosen action', !!started && (started.body?.logs || []).every((l) => l.action === 'workflow_started'), 'filter returned other actions')

  // ANA-018 pagination.
  const paged = await h.api('GET', '/audit-logs?page=1&limit=5', mgrTok)
  h.check('ANA-018', 'Audit log pagination works', paged.status === 200 && (paged.body?.logs || []).length <= 5 && typeof paged.body?.total === 'number' && (paged.body?.totalPages || 0) >= 1, `count ${paged.body?.logs?.length}, total ${paged.body?.total}, pages ${paged.body?.totalPages}`)
  const importantAudit = await h.api('GET', '/audit-logs?actions=workflow_started,workflow_completed', mgrTok)
  h.check('ANA-023', 'Audit log supports a real multi-action dashboard filter',
    importantAudit.status === 200 && (importantAudit.body?.logs || []).length >= 2 &&
      importantAudit.body.logs.every((entry) => ['workflow_started', 'workflow_completed'].includes(entry.action)),
    JSON.stringify(importantAudit.body))
})
