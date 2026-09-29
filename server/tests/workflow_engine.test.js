// WFB — Workflow builder config + engine. Builds graphs via the API and runs the
// real engine (execute → approve → advance). Canvas interactions (pan/zoom,
// unsaved-changes) live in ui_workflows.test.js and Slack is Pending; node/edge
// persistence, routing, conditions, SLA, execution log, loop protection and
// strict direct-manager routing are asserted here.

const h = require('./lib/harness')
const { runWithOrgId, Task, Form, FormResponse, Notification, WorkflowExecution } = h

const publishWorkflow = async (token, title, nodes, extra = {}) => {
  const created = await h.api('POST', '/workflows', token, { title, nodes, ...extra })
  const id = created.body?.workflow?._id
  const pub = await h.api('POST', `/workflows/${id}/publish`, token)
  return { id, publishStatus: pub.status, workflow: created.body?.workflow }
}

const execute = async (wfId, token, variables = {}) => {
  const r = await h.api('POST', `/workflows/${wfId}/execute`, token, { variables })
  return r.body?.executionId
}

h.runSuite('workflow_engine', async () => {
  const org = await h.createOrg('wfb')

  const builder = await h.createUser(org, { name: 'WFB Builder', email: h.emailIn(org, 'wfb-builder'), roleName: 'Admin', department: 'IT' })
  const subEmp = await h.createUser(org, { name: 'WFB Submitter', email: h.emailIn(org, 'wfb-sub'), roleName: 'Employee', department: 'IT' })
  const pinned = await h.createUser(org, { name: 'WFB Pinned', email: h.emailIn(org, 'wfb-pinned'), roleName: 'Employee' })

  const opsManager = await h.createUser(org, { name: 'WFB OpsMgr', email: h.emailIn(org, 'wfb-opsmgr'), roleName: 'Manager', department: 'Operations' })
  const opsSub = await h.createUser(org, { name: 'WFB OpsSub', email: h.emailIn(org, 'wfb-opssub'), roleName: 'Employee', department: 'Operations' })

  const dmManager = await h.createUser(org, { name: 'WFB DMgr', email: h.emailIn(org, 'wfb-dmgr'), roleName: 'Manager' })
  const dmSub = await h.createUser(org, { name: 'WFB DMSub', email: h.emailIn(org, 'wfb-dmsub'), roleName: 'Employee', managerId: dmManager._id })

  const stageA = await h.createUser(org, { name: 'WFB StageA', email: h.emailIn(org, 'wfb-sa'), roleName: 'Employee' })
  const stageB = await h.createUser(org, { name: 'WFB StageB', email: h.emailIn(org, 'wfb-sb'), roleName: 'Employee' })
  const stageC = await h.createUser(org, { name: 'WFB StageC', email: h.emailIn(org, 'wfb-sc'), roleName: 'Employee' })
  const p1 = await h.createUser(org, { name: 'WFB P1', email: h.emailIn(org, 'wfb-p1'), roleName: 'Employee' })
  const p2 = await h.createUser(org, { name: 'WFB P2', email: h.emailIn(org, 'wfb-p2'), roleName: 'Employee' })

  // WFB-032 proves an inactive manager does not fall through to this skip-level candidate.
  const skipMgr = await h.createUser(org, { name: 'WFB Skip', email: h.emailIn(org, 'wfb-skip'), roleName: 'Manager' })
  const inactiveMgr = await h.createUser(org, { name: 'WFB Inactive', email: h.emailIn(org, 'wfb-inactive'), roleName: 'Manager', isActive: false, managerId: skipMgr._id })
  const escSub = await h.createUser(org, { name: 'WFB EscSub', email: h.emailIn(org, 'wfb-escsub'), roleName: 'Employee', managerId: inactiveMgr._id })

  const bTok = await h.getToken({ email: builder.email })
  const subTok = await h.getToken({ email: subEmp.email })
  const opsSubTok = await h.getToken({ email: opsSub.email })
  const dmSubTok = await h.getToken({ email: dmSub.email })
  const escSubTok = await h.getToken({ email: escSub.email })
  const aTok = await h.getToken({ email: stageA.email })
  const bbTok = await h.getToken({ email: stageB.email })
  const cTok = await h.getToken({ email: stageC.email })

  const taskByExec = (execId, filter = {}) => runWithOrgId(org._id, () => Task.findOne({ workflowExecutionId: execId, ...filter }).lean())
  const pendingTask = (execId, filter = {}) => h.waitUntil(() => taskByExec(execId, { status: 'pending', ...filter }))

  // ── Pending / frontend-only ────────────────────────────────────────────────
  h.note('WFB-001', 'Pending', 'Frontend: canvas pan/zoom — covered by ui_workflows.test.js')
  h.note('WFB-024', 'Pending', 'External: Slack webhook post (needs a live Slack URL)')
  h.note('WFB-027', 'Pending', 'Frontend: unsaved-changes warning — covered by ui_workflows.test.js')

  // ── WFB-013 a cyclic graph is stopped, not run forever ─────────────────────
  // The canvas allows back-edges on purpose (a Review node's "changes" path
  // loops to an earlier step), so the engine is the layer that has to survive a
  // loop with no human step in it — processNode recurses, so an unguarded cycle
  // would run until the call stack died.
  const loopWf = await publishWorkflow(bTok, 'WFB loop wf', [
    { id: 'start', type: 'start', nextNode: 'a' },
    { id: 'a', type: 'assignment', config: { assignTo: String(pinned._id) }, nextNode: 'b' },
    { id: 'b', type: 'assignment', config: { assignTo: String(stageA._id) }, nextNode: 'a' },
    { id: 'end', type: 'end' }
  ])
  const loopExec = await execute(loopWf.id, subTok)
  const loopFinal = await h.waitUntil(async () => {
    const e = await runWithOrgId(org._id, () => WorkflowExecution.findById(loopExec).lean())
    return e && e.status !== 'running' ? e : null
  })
  h.check('WFB-013', 'A graph that loops without pausing fails instead of running forever',
    loopFinal?.status === 'failed' && /loops without reaching/i.test(loopFinal?.failureReason || ''),
    `publish ${loopWf.publishStatus}, status ${loopFinal?.status}, reason "${loopFinal?.failureReason}"`)
  h.check('WFB-013', 'The loop is cut short rather than logging unboundedly',
    (loopFinal?.executionLog || []).length <= 120,
    `${loopFinal?.executionLog?.length} log entries`)

  // ── WFB-002..012 node/edge persistence ─────────────────────────────────────
  const allTypesNodes = [
    { id: 'start', type: 'start', nextNode: 'approval1' },
    { id: 'approval1', type: 'approval', label: 'Approve', config: { approverId: pinned._id }, nextNode: 'cond1', position: { x: 10, y: 10 } },
    { id: 'cond1', type: 'condition', label: 'Check', config: { conditionField: 'amount', conditionOperator: 'gt', conditionValue: '0', truePath: 'notif1', falsePath: 'end' } },
    { id: 'notif1', type: 'notification', label: 'Notify', config: { notificationMessage: 'hi' }, nextNode: 'timer1' },
    { id: 'timer1', type: 'timer', label: 'Wait', config: { slaHours: 1 }, nextNode: 'assign1' },
    { id: 'assign1', type: 'assignment', label: 'Assign', config: { assignTo: pinned._id }, nextNode: 'end' },
    { id: 'end', type: 'end', label: 'End' }
  ]
  const persist = await h.api('POST', '/workflows', bTok, { title: 'WFB All Nodes', nodes: allTypesNodes, edges: [{ id: 'e1', source: 'start', target: 'approval1' }] })
  const persistId = persist.body?.workflow?._id
  const reload = await h.api('GET', `/workflows/${persistId}`, bTok)
  const rNodes = reload.body?.workflow?.nodes || []
  const hasType = (t) => rNodes.some((n) => n.type === t)
  h.check('WFB-002', 'Start node persists', hasType('start'))
  h.check('WFB-003', 'Approval node persists', hasType('approval'))
  h.check('WFB-004', 'Condition node persists with truePath/falsePath', rNodes.some((n) => n.type === 'condition' && n.config?.truePath && n.config?.falsePath))
  h.check('WFB-005', 'Notification node persists with message', rNodes.some((n) => n.type === 'notification' && n.config?.notificationMessage))
  h.check('WFB-006', 'Timer node persists', hasType('timer'))
  h.check('WFB-007', 'Assignment node persists with assignTo', rNodes.some((n) => n.type === 'assignment' && n.config?.assignTo))
  h.check('WFB-008', 'End node persists', hasType('end'))
  h.check('WFB-011', 'Edge saved on create', (reload.body?.workflow?.edges || []).length === 1)

  // WFB-010 move a node (position saved).
  const movedNodes = rNodes.map((n) => n.id === 'approval1' ? { ...n, position: { x: 999, y: 888 } } : n)
  await h.api('PUT', `/workflows/${persistId}`, bTok, { nodes: movedNodes })
  const afterMove = await h.api('GET', `/workflows/${persistId}`, bTok)
  const movedNode = (afterMove.body?.workflow?.nodes || []).find((n) => n.id === 'approval1')
  h.check('WFB-010', 'Node position is saved', movedNode?.position?.x === 999 && movedNode?.position?.y === 888, `got ${JSON.stringify(movedNode?.position)}`)

  // WFB-009 delete a node, WFB-012 delete an edge.
  const prunedNodes = (afterMove.body?.workflow?.nodes || []).filter((n) => n.id !== 'notif1')
  await h.api('PUT', `/workflows/${persistId}`, bTok, { nodes: prunedNodes, edges: [] })
  const afterPrune = await h.api('GET', `/workflows/${persistId}`, bTok)
  h.check('WFB-009', 'Deleted node is removed', !(afterPrune.body?.workflow?.nodes || []).some((n) => n.id === 'notif1'))
  h.check('WFB-012', 'Deleted edge is removed', (afterPrune.body?.workflow?.edges || []).length === 0)

  // WFB-026 save persists after reload (title + graph).
  await h.api('PUT', `/workflows/${persistId}`, bTok, { title: 'WFB Renamed' })
  const afterSave = await h.api('GET', `/workflows/${persistId}`, bTok)
  h.check('WFB-026', 'Workflow save persists after refresh', afterSave.body?.workflow?.title === 'WFB Renamed')

  // ── WFB-014 approverId routing ─────────────────────────────────────────────
  const wf14 = await publishWorkflow(bTok, 'WFB approverId', [
    { id: 'start', type: 'start', nextNode: 'a' },
    { id: 'a', type: 'approval', config: { approverId: pinned._id }, nextNode: 'end' },
    { id: 'end', type: 'end' }
  ])
  const ex14 = await execute(wf14.id, subTok)
  const t14 = await pendingTask(ex14)
  h.check('WFB-014', 'approverId → that user gets the task', String(t14?.assignedTo) === String(pinned._id), `assignedTo ${t14?.assignedTo}`)

  // ── WFB-015 approverRole → Manager in submitter's department ────────────────
  const wf15 = await publishWorkflow(bTok, 'WFB approverRole', [
    { id: 'start', type: 'start', nextNode: 'a' },
    { id: 'a', type: 'approval', config: { approverRole: 'Manager' }, nextNode: 'end' },
    { id: 'end', type: 'end' }
  ])
  const ex15 = await execute(wf15.id, opsSubTok) // Operations submitter → Operations manager
  const t15 = await pendingTask(ex15)
  h.check('WFB-015', 'approverRole Manager → dept manager gets task', String(t15?.assignedTo) === String(opsManager._id), `assignedTo ${t15?.assignedTo}, expected ${opsManager._id}`)

  // ── WFB-016 direct_manager token ────────────────────────────────────────────
  const wf16 = await publishWorkflow(bTok, 'WFB direct_manager', [
    { id: 'start', type: 'start', nextNode: 'a' },
    { id: 'a', type: 'approval', config: { approverRole: 'direct_manager' }, nextNode: 'end' },
    { id: 'end', type: 'end' }
  ])
  const ex16 = await execute(wf16.id, dmSubTok)
  const t16 = await pendingTask(ex16)
  h.check('WFB-016', "direct_manager → submitter's manager gets task", String(t16?.assignedTo) === String(dmManager._id), `assignedTo ${t16?.assignedTo}, expected ${dmManager._id}`)

  // ── WFB-033 live form approval preview uses the real workflow route ─────────
  const previewForm = await runWithOrgId(org._id, () => Form.create({
    title: 'WFB approval preview form',
    status: 'published',
    createdBy: builder._id,
    fields: [{ id: 'amount', type: 'number', label: 'Amount', required: true }]
  }))
  await publishWorkflow(bTok, 'WFB approval preview', [
    { id: 'start', type: 'start', nextNode: 'manager' },
    { id: 'manager', type: 'approval', label: 'Manager approval', config: { approverRole: 'direct_manager', slaHours: 24 }, nextNode: 'amount-check' },
    { id: 'amount-check', type: 'condition', config: { conditionField: 'amount', conditionOperator: 'gt', conditionValue: '100', truePath: 'committee', falsePath: 'end' } },
    { id: 'committee', type: 'multiApproval', label: 'Finance committee', config: { approverIds: [stageA._id, stageB._id, stageC._id], requiredApprovals: 2, slaHours: 48 }, nextNode: 'end' },
    { id: 'end', type: 'end' }
  ], { linkedFormId: String(previewForm._id) })

  const previewPending = await h.api('POST', `/forms/${previewForm._id}/approval-preview`, dmSubTok, { formData: {} })
  const pendingRoute = previewPending.body?.approvalRoute
  h.check('WFB-033', 'Approval preview resolves the real manager and waits for a controlling answer',
    previewPending.status === 200 &&
      pendingRoute?.confirmation === 'needs_input' &&
      pendingRoute?.stages?.[0]?.approver?.name === dmManager.name &&
      pendingRoute?.requiredInputs?.[0]?.fieldId === 'amount' &&
      pendingRoute?.summary?.approvalsRequired === 1,
    `status ${previewPending.status}, route ${JSON.stringify(pendingRoute)}`)

  const previewHigh = await h.api('POST', `/forms/${previewForm._id}/approval-preview`, dmSubTok, { formData: { amount: 150 } })
  const highRoute = previewHigh.body?.approvalRoute
  h.check('WFB-033', 'Approval preview follows the matching branch and counts quorum decisions',
    previewHigh.status === 200 &&
      highRoute?.confirmation === 'confirmed' &&
      highRoute?.summary?.approvalStages === 2 &&
      highRoute?.summary?.approvalsRequired === 3 &&
      highRoute?.stages?.[1]?.quorum?.required === 2 &&
      highRoute?.stages?.[1]?.quorum?.total === 3,
    `status ${previewHigh.status}, route ${JSON.stringify(highRoute)}`)

  const previewLow = await h.api('POST', `/forms/${previewForm._id}/approval-preview`, dmSubTok, { formData: { amount: 50 } })
  const lowRoute = previewLow.body?.approvalRoute
  h.check('WFB-033', 'Approval preview removes conditional approvals that are not required',
    previewLow.status === 200 &&
      lowRoute?.confirmation === 'confirmed' &&
      lowRoute?.summary?.approvalStages === 1 &&
      lowRoute?.summary?.approvalsRequired === 1 &&
      lowRoute?.canSubmit === true,
    `status ${previewLow.status}, route ${JSON.stringify(lowRoute)}`)

  // ── WFB-034 approval-route alerts and submission guard ────────────────────
  const fallbackForm = await runWithOrgId(org._id, () => Form.create({
    title: 'WFB manager fallback preview',
    status: 'published',
    createdBy: builder._id,
    fields: [{ id: 'note', type: 'text', label: 'Note', required: true }]
  }))
  await publishWorkflow(bTok, 'WFB manager fallback', [
    { id: 'start', type: 'start', nextNode: 'manager' },
    { id: 'manager', type: 'approval', label: 'Manager approval', config: { approverRole: 'direct_manager' }, nextNode: 'end' },
    { id: 'end', type: 'end' }
  ], { linkedFormId: String(fallbackForm._id) })

  const fallbackPreview = await h.api('POST', `/forms/${fallbackForm._id}/approval-preview`, subTok, { formData: { note: 'Ready' } })
  const fallbackRoute = fallbackPreview.body?.approvalRoute
  h.check('WFB-034', 'Missing direct manager is a blocking alert and never falls back',
    fallbackPreview.status === 200 &&
      fallbackRoute?.canSubmit === false &&
      fallbackRoute?.issues?.some((issue) => (
        issue.code === 'manager_unassigned' &&
        issue.severity === 'error' &&
        /no active direct manager assigned/i.test(issue.message)
      )) &&
      fallbackRoute?.stages?.[0]?.status === 'unconfigured' &&
      !fallbackRoute?.stages?.[0]?.approver,
    `status ${fallbackPreview.status}, route ${JSON.stringify(fallbackRoute)}`)

  const beforeManagerBlockedSubmit = await runWithOrgId(org._id, () => FormResponse.countDocuments({ formId: fallbackForm._id }))
  const managerBlockedSubmit = await h.api('POST', `/forms/${fallbackForm._id}/submit`, subTok, { formData: { note: 'Ready' } })
  const afterManagerBlockedSubmit = await runWithOrgId(org._id, () => FormResponse.countDocuments({ formId: fallbackForm._id }))
  h.check('WFB-034', 'Missing direct manager blocks submission before saving a response',
    managerBlockedSubmit.status === 409 &&
      managerBlockedSubmit.body?.code === 'APPROVAL_ROUTE_UNAVAILABLE' &&
      beforeManagerBlockedSubmit === afterManagerBlockedSubmit,
    `status ${managerBlockedSubmit.status}, code ${managerBlockedSubmit.body?.code}, responses ${beforeManagerBlockedSubmit} -> ${afterManagerBlockedSubmit}`)

  const inactiveManagerPreview = await h.api('POST', `/forms/${fallbackForm._id}/approval-preview`, escSubTok, { formData: { note: 'Ready' } })
  const inactiveManagerRoute = inactiveManagerPreview.body?.approvalRoute
  h.check('WFB-032', 'Inactive direct manager is blocking and does not resolve to the skip-level manager',
    inactiveManagerPreview.status === 200 &&
      inactiveManagerRoute?.canSubmit === false &&
      inactiveManagerRoute?.issues?.some((issue) => issue.code === 'manager_unassigned' && issue.severity === 'error') &&
      !inactiveManagerRoute?.stages?.[0]?.approver,
    `status ${inactiveManagerPreview.status}, route ${JSON.stringify(inactiveManagerRoute)}`)

  const inactiveExecutionResponse = await h.api('POST', `/workflows/${wf16.id}/execute`, escSubTok, { variables: {} })
  const inactiveExecutionId = inactiveExecutionResponse.body?.executionId
  const inactiveExecution = await runWithOrgId(org._id, () => WorkflowExecution.findById(inactiveExecutionId).lean())
  const inactiveTask = await taskByExec(inactiveExecutionId)
  h.check('WFB-032', 'Runtime creates no approval task and never escalates an inactive manager',
    inactiveExecutionResponse.status === 201 &&
      inactiveExecution?.status === 'failed' &&
      !inactiveTask &&
      /no resolvable approver/i.test(inactiveExecution?.failureReason || ''),
    `status ${inactiveExecution?.status}, task ${inactiveTask?._id || 'none'}, reason ${inactiveExecution?.failureReason || 'none'}`)

  const blockedForm = await runWithOrgId(org._id, () => Form.create({
    title: 'WFB unavailable approver preview',
    status: 'published',
    createdBy: builder._id,
    fields: [{ id: 'note', type: 'text', label: 'Note', required: true }]
  }))
  await publishWorkflow(bTok, 'WFB unavailable approver', [
    { id: 'start', type: 'start', nextNode: 'legal' },
    { id: 'legal', type: 'approval', label: 'Legal approval', config: { approverRole: 'legal_manager' }, nextNode: 'end' },
    { id: 'end', type: 'end' }
  ], { linkedFormId: String(blockedForm._id) })

  const blockedPreview = await h.api('POST', `/forms/${blockedForm._id}/approval-preview`, subTok, { formData: { note: 'Ready' } })
  const blockedRoute = blockedPreview.body?.approvalRoute
  h.check('WFB-034', 'An unresolved approval is returned as a blocking structured issue',
    blockedPreview.status === 200 &&
      blockedRoute?.canSubmit === false &&
      blockedRoute?.issues?.some((issue) => issue.code === 'approver_unconfigured' && issue.severity === 'error' && issue.title === 'Legal approval'),
    `status ${blockedPreview.status}, route ${JSON.stringify(blockedRoute)}`)

  const beforeBlockedSubmit = await runWithOrgId(org._id, () => FormResponse.countDocuments({ formId: blockedForm._id }))
  const blockedSubmit = await h.api('POST', `/forms/${blockedForm._id}/submit`, subTok, { formData: { note: 'Ready' } })
  const afterBlockedSubmit = await runWithOrgId(org._id, () => FormResponse.countDocuments({ formId: blockedForm._id }))
  h.check('WFB-034', 'The server refuses a known-unroutable submission before saving a response',
    blockedSubmit.status === 409 &&
      blockedSubmit.body?.code === 'APPROVAL_ROUTE_UNAVAILABLE' &&
      beforeBlockedSubmit === afterBlockedSubmit,
    `status ${blockedSubmit.status}, code ${blockedSubmit.body?.code}, responses ${beforeBlockedSubmit} -> ${afterBlockedSubmit}`)

  const unlinkedForm = await runWithOrgId(org._id, () => Form.create({
    title: 'WFB unlinked preview',
    status: 'published',
    createdBy: builder._id,
    fields: []
  }))
  const unlinkedPreview = await h.api('POST', `/forms/${unlinkedForm._id}/approval-preview`, subTok, { formData: {} })
  h.check('WFB-034', 'A form without a workflow returns a non-blocking warning',
    unlinkedPreview.status === 200 &&
      unlinkedPreview.body?.approvalRoute?.canSubmit === true &&
      unlinkedPreview.body?.approvalRoute?.issues?.some((issue) => issue.code === 'workflow_unlinked' && issue.severity === 'warning'),
    `status ${unlinkedPreview.status}, route ${JSON.stringify(unlinkedPreview.body?.approvalRoute)}`)

  // ── WFB-017 role-based approval resolves to a valid Manager ──
  const wf17 = await publishWorkflow(bTok, 'WFB role manager', [
    { id: 'start', type: 'start', nextNode: 'a' },
    { id: 'a', type: 'approval', config: { approverRole: 'Manager' }, nextNode: 'end' },
    { id: 'end', type: 'end' }
  ])
  const ex17 = await execute(wf17.id, dmSubTok)
  const t17 = await pendingTask(ex17)
  const t17Assignee = t17 ? await runWithOrgId(org._id, () => h.User.findById(t17.assignedTo).lean()) : null
  h.check('WFB-017', 'approverRole Manager resolves to a valid active approver', !!t17Assignee && t17Assignee.isActive !== false, `assignee ${t17Assignee?.name}`)

  // ── WFB-018 + WFB-030 sequential / multi-level routing ──────────────────────
  const wf30 = await publishWorkflow(bTok, 'WFB multilevel', [
    { id: 'start', type: 'start', nextNode: 'a' },
    { id: 'a', type: 'approval', config: { approverId: stageA._id }, nextNode: 'b' },
    { id: 'b', type: 'approval', config: { approverId: stageB._id }, nextNode: 'c' },
    { id: 'c', type: 'approval', config: { approverId: stageC._id }, nextNode: 'end' },
    { id: 'end', type: 'end' }
  ])
  const ex30 = await execute(wf30.id, subTok)
  const s1 = await pendingTask(ex30, { currentNode: 'a' })
  const s2Before = await taskByExec(ex30, { currentNode: 'b' })
  await h.api('POST', `/tasks/${s1._id}/approve`, aTok, {})
  const s2 = await pendingTask(ex30, { currentNode: 'b' })
  await h.api('POST', `/tasks/${s2._id}/approve`, bbTok, {})
  const s3 = await pendingTask(ex30, { currentNode: 'c' })
  h.check('WFB-018', 'Sequential approvals happen one after another', !!s1 && !s2Before && !!s2, `s1 ${!!s1}, s2Before ${!!s2Before}, s2 ${!!s2}`)
  h.check('WFB-030', 'Multi-level chain routes each stage to the right approver',
    String(s1?.assignedTo) === String(stageA._id) && String(s2?.assignedTo) === String(stageB._id) && String(s3?.assignedTo) === String(stageC._id),
    `a=${s1?.assignedTo} b=${s2?.assignedTo} c=${s3?.assignedTo}`)

  // ── WFB-019 parallel (multiApproval) ────────────────────────────────────────
  const wf19 = await publishWorkflow(bTok, 'WFB parallel', [
    { id: 'start', type: 'start', nextNode: 'm' },
    { id: 'm', type: 'multiApproval', config: { approverIds: [p1._id, p2._id], requiredApprovals: 2 }, nextNode: 'end' },
    { id: 'end', type: 'end' }
  ])
  const ex19 = await execute(wf19.id, subTok)
  const t19 = await pendingTask(ex19)
  const approversSet = new Set((t19?.parallelApprovers || []).map(String))
  const notifs19 = await h.waitUntil(async () => {
    const n = await runWithOrgId(org._id, () => Notification.countDocuments({ taskId: t19._id, type: 'assignment' }))
    return n >= 2 ? n : null
  })
  h.check('WFB-019', 'Parallel node assigns all approvers at once', approversSet.has(String(p1._id)) && approversSet.has(String(p2._id)) && !!notifs19, `approvers ${[...approversSet].join(',')}, notifs ${notifs19}`)

  // ── WFB-020 SLA hours → due date ────────────────────────────────────────────
  const wf20 = await publishWorkflow(bTok, 'WFB sla', [
    { id: 'start', type: 'start', nextNode: 'a' },
    { id: 'a', type: 'approval', config: { approverId: pinned._id, slaHours: 10 }, nextNode: 'end' },
    { id: 'end', type: 'end' }
  ])
  const ex20 = await execute(wf20.id, subTok)
  const t20 = await pendingTask(ex20)
  const expectedDue = Date.now() + 10 * 3600000
  const dueDiff = t20?.dueDate ? Math.abs(new Date(t20.dueDate).getTime() - expectedDue) : Infinity
  h.check('WFB-020', 'slaHours sets the task due date', dueDiff < 5 * 60 * 1000, `dueDate ${t20?.dueDate}, diff ${Math.round(dueDiff / 1000)}s`)

  // ── WFB-021 condition operators ─────────────────────────────────────────────
  const testCond = async (op, fieldVal, condVal, expectMet) => {
    const wf = await publishWorkflow(bTok, `WFB cond ${op} ${Math.random()}`, [
      { id: 'start', type: 'start', nextNode: 'c' },
      { id: 'c', type: 'condition', config: { conditionField: 'val', conditionOperator: op, conditionValue: String(condVal), truePath: 'endT', falsePath: 'endF' } },
      { id: 'endT', type: 'end' },
      { id: 'endF', type: 'end' }
    ])
    const ex = await execute(wf.id, subTok, { val: fieldVal })
    const done = await h.waitUntil(async () => {
      const e = await h.api('GET', `/workflows/executions/${ex}`, bTok)
      return ['completed', 'failed'].includes(e.body?.execution?.status) ? e.body.execution : null
    })
    const log = (done?.executionLog || []).find((l) => l.nodeId === 'c')
    return log?.output?.conditionMet === expectMet
  }
  const condResults = await Promise.all([
    testCond('eq', '5', '5', true),
    testCond('gt', 10, 5, true),
    testCond('lt', 3, 5, true),
    testCond('gte', 5, 5, true),
    testCond('lte', 5, 5, true),
    testCond('contains', 'hello world', 'world', true)
  ])
  h.check('WFB-021', 'Condition operators eq/gt/lt/gte/lte/contains all evaluate correctly', condResults.every(Boolean), `results ${condResults.join(',')}`)

  // ── WFB-022 condition on lastApprovalOutcome (approve→true, reject→false) ────
  const buildOutcomeWf = (title) => publishWorkflow(bTok, title, [
    { id: 'start', type: 'start', nextNode: 'a' },
    { id: 'a', type: 'approval', config: { approverId: stageA._id }, nextNode: 'c' },
    { id: 'c', type: 'condition', config: { conditionField: 'lastApprovalOutcome', conditionOperator: 'eq', conditionValue: 'approved', truePath: 'endT', falsePath: 'endF' } },
    { id: 'endT', type: 'end' },
    { id: 'endF', type: 'end' }
  ])
  const wf22a = await buildOutcomeWf('WFB outcome approve')
  const ex22a = await execute(wf22a.id, subTok)
  const t22a = await pendingTask(ex22a, { currentNode: 'a' })
  await h.api('POST', `/tasks/${t22a._id}/approve`, aTok, {})
  // The log row appears when the node is entered; conditionMet is only written
  // when it completes, so waiting on the row alone reads an undefined outcome.
  const done22a = await h.waitUntil(async () => {
    const e = await h.api('GET', `/workflows/executions/${ex22a}`, bTok)
    const log = (e.body?.execution?.executionLog || []).find((l) => l.nodeId === 'c')
    return typeof log?.output?.conditionMet === 'boolean' ? { met: log.output.conditionMet } : null
  })
  const wf22b = await buildOutcomeWf('WFB outcome reject')
  const ex22b = await execute(wf22b.id, subTok)
  const t22b = await pendingTask(ex22b, { currentNode: 'a' })
  await h.api('POST', `/tasks/${t22b._id}/reject`, aTok, { comment: 'no' })
  const done22b = await h.waitUntil(async () => {
    const e = await h.api('GET', `/workflows/executions/${ex22b}`, bTok)
    const log = (e.body?.execution?.executionLog || []).find((l) => l.nodeId === 'c')
    return typeof log?.output?.conditionMet === 'boolean' ? { met: log.output.conditionMet } : null
  })
  h.check('WFB-022', 'lastApprovalOutcome routes approve→true, reject→false', done22a?.met === true && done22b?.met === false, `approve→${done22a?.met}, reject→${done22b?.met}`)

  // ── WFB-023 notification node message ───────────────────────────────────────
  const wf23 = await publishWorkflow(bTok, 'WFB notif node', [
    { id: 'start', type: 'start', nextNode: 'n' },
    { id: 'n', type: 'notification', config: { notificationMessage: 'Custom WFB notice 123' }, nextNode: 'end' },
    { id: 'end', type: 'end' }
  ])
  const ex23 = await execute(wf23.id, subTok)
  const gotNotif = await h.waitUntil(() => runWithOrgId(org._id, () => Notification.findOne({ userId: subEmp._id, message: 'Custom WFB notice 123' }).lean()))
  h.check('WFB-023', 'Notification node delivers the configured message', !!gotNotif)

  // ── WFB-025 linked form submission triggers the workflow ────────────────────
  const linkedForm = await runWithOrgId(org._id, () => Form.create({ title: 'WFB linked form', status: 'published', createdBy: builder._id, fields: [{ id: 'note', type: 'text', label: 'Note' }] }))
  await publishWorkflow(bTok, 'WFB linked wf', [
    { id: 'start', type: 'start', nextNode: 'a' },
    { id: 'a', type: 'approval', config: { approverId: pinned._id }, nextNode: 'end' },
    { id: 'end', type: 'end' }
  ], { linkedFormId: String(linkedForm._id) })
  const submitRes = await h.api('POST', `/forms/${linkedForm._id}/submit`, subTok, { formData: { note: 'hello' } })
  h.check('WFB-025', 'Submitting a linked form triggers the workflow', submitRes.status === 201 && submitRes.body?.workflowTriggered === true && !!submitRes.body?.executionId, `status ${submitRes.status}, triggered ${submitRes.body?.workflowTriggered}`)

  // ── WFB-028 simple flow end-to-end + WFB-031 execution log ──────────────────
  const wf28 = await publishWorkflow(bTok, 'WFB simple e2e', [
    { id: 'start', type: 'start', nextNode: 'a' },
    { id: 'a', type: 'approval', config: { approverId: stageA._id }, nextNode: 'end' },
    { id: 'end', type: 'end' }
  ])
  const ex28 = await execute(wf28.id, subTok)
  const t28 = await pendingTask(ex28)
  await h.api('POST', `/tasks/${t28._id}/approve`, aTok, {})
  const done28 = await h.waitUntil(async () => {
    const e = await h.api('GET', `/workflows/executions/${ex28}`, bTok)
    return e.body?.execution?.status === 'completed' ? e.body.execution : null
  })
  const logNodes = (done28?.executionLog || []).map((l) => l.nodeId)
  // The engine logs processing nodes; `start` is a virtual entry pointer and is
  // not itself written to the execution log, so we assert the real nodes ran.
  h.check('WFB-028', 'Simple Start→Approval→End completes; all nodes logged', !!done28 && ['a', 'end'].every((n) => logNodes.includes(n)), `status ${done28?.status}, nodes ${logNodes.join(',')}`)
  h.check('WFB-031', 'Execution log entries carry timestamps', (done28?.executionLog || []).length > 0 && (done28.executionLog).every((l) => !!l.enteredAt), 'missing enteredAt')

  // WFB-029 reject flow ends as failed/rejected.
  const wf29 = await publishWorkflow(bTok, 'WFB reject flow', [
    { id: 'start', type: 'start', nextNode: 'a' },
    { id: 'a', type: 'approval', config: { approverId: stageA._id }, nextNode: 'end' },
    { id: 'end', type: 'end' }
  ])
  const ex29 = await execute(wf29.id, subTok)
  const t29 = await pendingTask(ex29)
  await h.api('POST', `/tasks/${t29._id}/reject`, aTok, { comment: 'declined' })
  const done29 = await h.waitUntil(async () => {
    const e = await h.api('GET', `/workflows/executions/${ex29}`, bTok)
    return e.body?.execution?.status === 'failed' ? e.body.execution : null
  })
  h.check('WFB-029', 'Reject flow ends the workflow as Rejected/failed', !!done29, `status ${done29?.status}`)

})
