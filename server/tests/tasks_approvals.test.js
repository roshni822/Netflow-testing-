// TSK — Tasks inbox + approve / reject / request-changes, authorization, invalid
// state, sequential order, parallel quorum, escalation, submitter tracking.
// Frontend-only cases (name search, file preview, button loading, badge colour)
// are Pending.

const h = require('./lib/harness')
const { runWithOrgId, Task, Form, FormResponse } = h
const { escalateTask } = require('../jobs/escalationCron')
const { triggerWorkflow } = require('../utils/workflowEngine')

// Build + publish a workflow via API (builder token), returning its id.
const publishWorkflow = async (token, title, nodes) => {
  const created = await h.api('POST', '/workflows', token, { title, nodes })
  const id = created.body?.workflow?._id
  await h.api('POST', `/workflows/${id}/publish`, token)
  return id
}

h.runSuite('tasks_approvals', async () => {
  const org = await h.createOrg('tsk')

  const manager = await h.createUser(org, { name: 'TSK Manager', email: h.emailIn(org, 'tsk-mgr'), roleName: 'Admin' })
  const submitter = await h.createUser(org, { name: 'TSK Submitter', email: h.emailIn(org, 'tsk-sub'), roleName: 'Employee' })
  const approverA = await h.createUser(org, { name: 'TSK ApproverA', email: h.emailIn(org, 'tsk-a'), roleName: 'Employee' })
  const approverB = await h.createUser(org, { name: 'TSK ApproverB', email: h.emailIn(org, 'tsk-b'), roleName: 'Employee' })
  const stranger = await h.createUser(org, { name: 'TSK Stranger', email: h.emailIn(org, 'tsk-stranger'), roleName: 'Employee' })
  const p1 = await h.createUser(org, { name: 'TSK P1', email: h.emailIn(org, 'tsk-p1'), roleName: 'Employee' })
  const p2 = await h.createUser(org, { name: 'TSK P2', email: h.emailIn(org, 'tsk-p2'), roleName: 'Employee' })
  const fresh = await h.createUser(org, { name: 'TSK Fresh', email: h.emailIn(org, 'tsk-fresh'), roleName: 'Employee' })

  const mgrTok = await h.getToken({ email: manager.email })
  const subTok = await h.getToken({ email: submitter.email })
  const aTok = await h.getToken({ email: approverA.email })
  const bTok = await h.getToken({ email: approverB.email })
  const strangerTok = await h.getToken({ email: stranger.email })
  const p1Tok = await h.getToken({ email: p1.email })
  const p2Tok = await h.getToken({ email: p2.email })
  const freshTok = await h.getToken({ email: fresh.email })

  const mkTask = (extra) => runWithOrgId(org._id, () => Task.create({
    title: 'TSK task', type: 'IT', status: 'pending',
    assignedTo: approverA._id, submittedBy: submitter._id, ...extra
  }))

  // Browser-only: the inbox search is client-side (my-tasks filters by
  // status/type/scope only), and the rest is rendering. Asserted in
  // ui_tasks.test.js, which upgrades these to Pass when the frontend is up.
  for (const tc of ['TSK-004', 'TSK-009', 'TSK-013', 'TSK-023']) {
    h.note(tc, 'Pending', 'Frontend: covered by ui_tasks.test.js')
  }

  // TSK-001 inbox loads.
  await mkTask({ title: 'Inbox task' })
  const inbox = await h.api('GET', '/tasks/my-tasks', aTok)
  h.check('TSK-001', 'Task inbox loads assigned tasks', inbox.status === 200 && (inbox.body?.tasks || []).length >= 1, `status ${inbox.status}, count ${inbox.body?.tasks?.length}`)

  // TSK-002 submitter sees their own requests.
  const subInbox = await h.api('GET', '/tasks/my-tasks?scope=submitted', subTok)
  h.check('TSK-002', 'Submitter sees their submitted requests', (subInbox.body?.tasks || []).some((t) => String(t.submittedBy?._id || t.submittedBy) === String(submitter._id)), `count ${subInbox.body?.tasks?.length}`)

  // TSK-003 status filter.
  const approvedStandalone = await mkTask({ title: 'Already approved', status: 'approved' })
  const pendingOnly = await h.api('GET', '/tasks/my-tasks?status=pending', aTok)
  h.check('TSK-003', 'Status filter returns only pending', (pendingOnly.body?.tasks || []).every((t) => t.status === 'pending'), `statuses ${(pendingOnly.body?.tasks || []).map((t) => t.status).join(',')}`)

  // TSK-005 due date present.
  const dueTask = await mkTask({ title: 'Due task', dueDate: new Date(Date.now() + 48 * 3600000) })
  const dueList = await h.api('GET', '/tasks/my-tasks', aTok)
  const dueRow = (dueList.body?.tasks || []).find((t) => String(t._id) === String(dueTask._id))
  h.check('TSK-005', 'Task carries a correct due date', !!dueRow?.dueDate, `dueDate ${dueRow?.dueDate}`)

  // TSK-006 task detail.
  const detail = await h.api('GET', `/tasks/${dueTask._id}`, aTok)
  h.check('TSK-006', 'Task detail opens', detail.status === 200 && String(detail.body?.task?._id) === String(dueTask._id), `status ${detail.status}`)

  // TSK-007 empty inbox.
  const emptyInbox = await h.api('GET', '/tasks/my-tasks', freshTok)
  h.check('TSK-007', 'Empty inbox for a user with no tasks', emptyInbox.status === 200 && (emptyInbox.body?.tasks || []).length === 0, `count ${emptyInbox.body?.tasks?.length}`)

  // TSK-008 submitted form data visible in detail.
  const form = await runWithOrgId(org._id, () => Form.create({ title: 'TSK form', status: 'published', createdBy: manager._id, fields: [{ id: 'amount', type: 'number', label: 'Amount' }] }))
  const fr = await runWithOrgId(org._id, () => FormResponse.create({ formId: form._id, submittedBy: submitter._id, formData: { amount: 500 }, status: 'submitted' }))
  const formTask = await mkTask({ title: 'Form-linked task', formResponseId: fr._id })
  const formDetail = await h.api('GET', `/tasks/${formTask._id}`, aTok)
  h.check('TSK-008', 'Task detail shows submitted form data', formDetail.body?.task?.formResponseId?.formData?.amount === 500, `got ${JSON.stringify(formDetail.body?.task?.formResponseId?.formData)}`)

  // Task history keeps its display metadata even if the source form/response is
  // removed later. This prevents UUID labels and raw file JSON in old requests.
  const snapshotWf = await publishWorkflow(mgrTok, 'TSK Form Snapshot', [
    { id: 'start', type: 'start', nextNode: 'approval' },
    { id: 'approval', type: 'approval', config: { approverId: approverA._id }, nextNode: 'end' },
    { id: 'end', type: 'end' }
  ])
  const snapshotExec = await runWithOrgId(org._id, () =>
    triggerWorkflow(snapshotWf, fr._id, submitter._id)
  )
  const snapshotTask = await runWithOrgId(org._id, () =>
    Task.findOne({ workflowExecutionId: snapshotExec._id, currentNode: 'approval' }).lean()
  )
  await runWithOrgId(org._id, async () => {
    await FormResponse.deleteOne({ _id: fr._id })
    await Form.deleteOne({ _id: form._id })
  })
  const snapshotDetail = await h.api('GET', '/tasks/' + snapshotTask._id, aTok)
  const snapshotPayload = snapshotDetail.body?.task
  h.check(
    'TSK-008-SNAPSHOT',
    'Task detail uses the real form metadata snapshot after source deletion',
    snapshotDetail.status === 200 &&
      snapshotPayload?.triggerFormData?.amount === 500 &&
      snapshotPayload?.triggerFormTitle === 'TSK form' &&
      snapshotPayload?.triggerFormFields?.[0]?.label === 'Amount',
    'status ' + snapshotDetail.status +
      ', title ' + snapshotPayload?.triggerFormTitle +
      ', fields ' + JSON.stringify(snapshotPayload?.triggerFormFields)
  )

  // TSK-011 approve without comment.
  const t11 = await mkTask({ title: 'Approve no comment' })
  const a11 = await h.api('POST', `/tasks/${t11._id}/approve`, aTok, {})
  h.check('TSK-011', 'Approve without comment succeeds', a11.status === 200 && a11.body?.task?.status === 'approved', `status ${a11.status}, task ${a11.body?.task?.status}`)

  // TSK-012 approve with comment.
  const t12 = await mkTask({ title: 'Approve with comment' })
  const a12 = await h.api('POST', `/tasks/${t12._id}/approve`, aTok, { comment: 'Looks good' })
  const hist12 = (a12.body?.task?.approvalHistory || []).some((x) => x.action === 'approved' && x.comment === 'Looks good')
  h.check('TSK-012', 'Approve comment saved in history', a12.status === 200 && hist12, `history ${JSON.stringify(a12.body?.task?.approvalHistory)}`)

  // TSK-014 reject with comment → submitter notified.
  const t14 = await mkTask({ title: 'Reject task' })
  const r14 = await h.api('POST', `/tasks/${t14._id}/reject`, aTok, { comment: 'Not acceptable' })
  const notif14 = await h.waitUntil(async () => {
    const n = await h.api('GET', '/notifications', subTok)
    return (n.body?.notifications || []).find((x) => x.type === 'rejection' && String(x.taskId) === String(t14._id))
  })
  h.check('TSK-014', 'Reject with comment → rejected + submitter notified', r14.status === 200 && r14.body?.task?.status === 'rejected' && !!notif14, `status ${r14.status}, task ${r14.body?.task?.status}, notif ${!!notif14}`)

  // TSK-016 request changes: comment required, then stays pending.
  const t16 = await mkTask({ title: 'Request changes' })
  const rcNoComment = await h.api('POST', `/tasks/${t16._id}/request-changes`, aTok, {})
  const rcWithComment = await h.api('POST', `/tasks/${t16._id}/request-changes`, aTok, { comment: 'Please attach the invoice' })
  h.check('TSK-016', 'Request changes requires comment, then stays pending',
    rcNoComment.status === 400 && rcNoComment.body?.code === 'COMMENT_REQUIRED' && rcWithComment.status === 200 && rcWithComment.body?.task?.status === 'pending',
    `noComment ${rcNoComment.status}/${rcNoComment.body?.code}, withComment ${rcWithComment.status}/${rcWithComment.body?.task?.status}`)

  // TSK-017 opening someone else's task → forbidden.
  const t17 = await mkTask({ title: 'Private task' })
  const otherView = await h.api('GET', `/tasks/${t17._id}`, strangerTok)
  h.check('TSK-017', "Cannot open another user's task (403)", otherView.status === 403, `got ${otherView.status}`)

  // TSK-018 action on an already-approved task.
  const reapprove = await h.api('POST', `/tasks/${approvedStandalone._id}/approve`, aTok, {})
  h.check('TSK-018', 'Approving an already-approved task blocked (INVALID_STATE)', reapprove.status === 400 && reapprove.body?.code === 'INVALID_STATE', `status ${reapprove.status}, code ${reapprove.body?.code}`)

  // TSK-019 sequential order: stage-2 approver has no task until stage-1 is approved.
  const seqWf = await publishWorkflow(mgrTok, 'TSK Sequential', [
    { id: 'start', type: 'start', nextNode: 'a1' },
    { id: 'a1', type: 'approval', config: { approverId: approverA._id }, nextNode: 'a2' },
    { id: 'a2', type: 'approval', config: { approverId: approverB._id }, nextNode: 'end' },
    { id: 'end', type: 'end' }
  ])
  const seqExec = await h.api('POST', `/workflows/${seqWf}/execute`, subTok, {})
  const seqExecId = seqExec.body?.executionId
  const stage1 = await h.waitUntil(() => runWithOrgId(org._id, async () => {
    const t = await Task.findOne({ workflowExecutionId: seqExecId, currentNode: 'a1' }).lean()
    return t || null
  }))
  const stage2Before = await runWithOrgId(org._id, () => Task.findOne({ workflowExecutionId: seqExecId, currentNode: 'a2' }).lean())
  await h.api('POST', `/tasks/${stage1._id}/approve`, aTok, {})
  const stage2After = await h.waitUntil(() => runWithOrgId(org._id, async () => {
    const t = await Task.findOne({ workflowExecutionId: seqExecId, currentNode: 'a2' }).lean()
    return t || null
  }))
  h.check('TSK-019', 'Sequential order enforced (stage-2 task only after stage-1 approval)', !!stage1 && !stage2Before && !!stage2After, `stage1 ${!!stage1}, stage2Before ${!!stage2Before}, stage2After ${!!stage2After}`)

  // TSK-010 approval chain / stages visible on the multi-stage task.
  const chainDetail = await h.api('GET', `/tasks/${stage1._id}`, aTok)
  h.check('TSK-010', 'Approval chain shows all stages', (chainDetail.body?.task?.approvalChain || []).length >= 2, `len ${(chainDetail.body?.task?.approvalChain || []).length}`)

  // TSK-015 workflow status after reject.
  const rejWf = await publishWorkflow(mgrTok, 'TSK Reject', [
    { id: 'start', type: 'start', nextNode: 'a1' },
    { id: 'a1', type: 'approval', config: { approverId: approverA._id }, nextNode: 'end' },
    { id: 'end', type: 'end' }
  ])
  const rejExec = await h.api('POST', `/workflows/${rejWf}/execute`, subTok, {})
  const rejExecId = rejExec.body?.executionId
  const rejTask = await h.waitUntil(() => runWithOrgId(org._id, async () => {
    const t = await Task.findOne({ workflowExecutionId: rejExecId, status: 'pending' }).lean()
    return t || null
  }))
  await h.api('POST', `/tasks/${rejTask._id}/reject`, aTok, { comment: 'No' })
  const rejFinal = await h.waitUntil(async () => {
    const e = await h.api('GET', `/workflows/executions/${rejExecId}`, mgrTok)
    return e.body?.execution?.status === 'failed' ? e.body.execution : null
  })
  h.check('TSK-015', 'Workflow ends as failed/rejected after reject', !!rejFinal, `status ${rejFinal?.status}`)

  // TSK-020 parallel: all approve → approved.
  const par20 = await runWithOrgId(org._id, () => Task.create({
    title: 'Parallel all-approve', type: 'IT', status: 'pending', approvalType: 'parallel',
    submittedBy: submitter._id, assignedTo: p1._id,
    parallelApprovers: [p1._id, p2._id],
    parallelApprovals: [{ userId: p1._id, status: 'pending' }, { userId: p2._id, status: 'pending' }],
    requiredApprovals: 2
  }))
  const v1 = await h.api('POST', `/tasks/${par20._id}/approve`, p1Tok, {})
  const v2 = await h.api('POST', `/tasks/${par20._id}/approve`, p2Tok, {})
  const par20Final = await runWithOrgId(org._id, () => Task.findById(par20._id).lean())
  h.check('TSK-020', 'Parallel all-approve → Approved', v1.status === 200 && v2.status === 200 && par20Final.status === 'approved', `v1 ${v1.status}, v2 ${v2.status}, final ${par20Final.status}`)

  // TSK-021 parallel: one reject (quorum impossible) → rejected.
  const par21 = await runWithOrgId(org._id, () => Task.create({
    title: 'Parallel one-reject', type: 'IT', status: 'pending', approvalType: 'parallel',
    submittedBy: submitter._id, assignedTo: p1._id,
    parallelApprovers: [p1._id, p2._id],
    parallelApprovals: [{ userId: p1._id, status: 'pending' }, { userId: p2._id, status: 'pending' }],
    requiredApprovals: 2
  }))
  const rej21 = await h.api('POST', `/tasks/${par21._id}/reject`, p1Tok, { comment: 'No from me' })
  const par21Final = await runWithOrgId(org._id, () => Task.findById(par21._id).lean())
  h.check('TSK-021', 'Parallel one-reject (2 of 2) → Rejected', rej21.status === 200 && par21Final.status === 'rejected', `rej ${rej21.status}, final ${par21Final.status}`)

  // TSK-022 auto-escalate on SLA breach (real escalation code, scoped to our task).
  const overdue = await runWithOrgId(org._id, () => Task.create({
    title: 'Overdue task', type: 'IT', status: 'pending',
    assignedTo: submitter._id, submittedBy: submitter._id,
    dueDate: new Date(Date.now() - 3 * 3600000), isEscalated: false
  }))
  // Escalation target = a Manager in the assignee's department (submitter is IT; manager is IT).
  const populated = await runWithOrgId(org._id, () => Task.findById(overdue._id).populate('assignedTo submittedBy').lean())
  const escalated = await runWithOrgId(org._id, () => escalateTask(populated, new Date()))
  const overdueAfter = await runWithOrgId(org._id, () => Task.findById(overdue._id).lean())
  const escNotif = await h.waitUntil(() => runWithOrgId(org._id, () => h.Notification.findOne({ taskId: overdue._id, type: 'escalation' }).lean()))
  h.check('TSK-022', 'Overdue task escalates + new owner notified', escalated === true && overdueAfter.status === 'escalated' && !!escNotif, `escalated ${escalated}, status ${overdueAfter.status}, notif ${!!escNotif}`)

  // TSK-024 submitter can track request status.
  const track = await h.api('GET', '/tasks/my-tasks?scope=submitted', subTok)
  const tracked = (track.body?.tasks || []).find((t) => String(t._id) === String(t14._id))
  h.check('TSK-024', 'Submitter can track request status', !!tracked && tracked.status === 'rejected', `found ${!!tracked}, status ${tracked?.status}`)
})
