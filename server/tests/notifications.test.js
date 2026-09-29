// NTF — In-app notifications: assignment/approval/escalation/custom-node
// triggers, unread count, mark-read, mark-all-read, empty state. Email look
// (NTF-012) and bell polling cadence (NTF-013) are frontend/visual → Pending.

const h = require('./lib/harness')
const { runWithOrgId, Task } = h
const { escalateTask } = require('../jobs/escalationCron')

const publishWorkflow = async (token, title, nodes) => {
  const created = await h.api('POST', '/workflows', token, { title, nodes })
  const id = created.body?.workflow?._id
  await h.api('POST', `/workflows/${id}/publish`, token)
  return id
}

h.runSuite('notifications', async () => {
  const org = await h.createOrg('ntf')

  const manager = await h.createUser(org, { name: 'NTF Manager', email: h.emailIn(org, 'ntf-mgr'), roleName: 'Admin', department: 'IT' })
  const submitter = await h.createUser(org, { name: 'NTF Submitter', email: h.emailIn(org, 'ntf-sub'), roleName: 'Employee', department: 'IT' })
  const approver = await h.createUser(org, { name: 'NTF Approver', email: h.emailIn(org, 'ntf-appr'), roleName: 'Employee' })
  const fresh = await h.createUser(org, { name: 'NTF Fresh', email: h.emailIn(org, 'ntf-fresh'), roleName: 'Employee' })

  const mgrTok = await h.getToken({ email: manager.email })
  const subTok = await h.getToken({ email: submitter.email })
  const apprTok = await h.getToken({ email: approver.email })
  const freshTok = await h.getToken({ email: fresh.email })

  h.note('NTF-012', 'Pending', 'Frontend: email look/content in inbox (visual)')
  h.note('NTF-013', 'Pending', 'Frontend: covered by ui_notifications.test.js')

  // Trigger an assignment notification via the real engine.
  const wf = await publishWorkflow(mgrTok, 'NTF assignment wf', [
    { id: 'start', type: 'start', nextNode: 'a' },
    { id: 'a', type: 'approval', config: { approverId: approver._id }, nextNode: 'end' },
    { id: 'end', type: 'end' }
  ])
  const exec = await h.api('POST', `/workflows/${wf}/execute`, subTok, {})
  const execId = exec.body?.executionId

  // NTF-008 assignment notification created for the approver.
  const assignNotif = await h.waitUntil(async () => {
    const n = await h.api('GET', '/notifications', apprTok)
    return (n.body?.notifications || []).find((x) => x.type === 'assignment') ? n : null
  })
  h.check('NTF-008', 'Task assignment creates an in-app notification', !!assignNotif, 'no assignment notification arrived')

  const apprList = assignNotif || await h.api('GET', '/notifications', apprTok)
  const apprNotifs = apprList.body?.notifications || []
  const assignRow = apprNotifs.find((x) => x.type === 'assignment')

  // NTF-001 unread count badge.
  h.check('NTF-001', 'Bell unread count is present', (apprList.body?.unreadCount || 0) >= 1, `unread ${apprList.body?.unreadCount}`)
  // NTF-002 dropdown list.
  h.check('NTF-002', 'Bell dropdown lists recent notifications', apprNotifs.length >= 1, `count ${apprNotifs.length}`)
  // NTF-005 page loads (same endpoint powers the page).
  h.check('NTF-005', 'Notifications page loads all notifications', apprList.status === 200 && Array.isArray(apprNotifs), `status ${apprList.status}`)
  // NTF-003 notification links to its task.
  h.check('NTF-003', 'Notification carries the related taskId', !!assignRow?.taskId, `taskId ${assignRow?.taskId}`)

  // NTF-004 mark one as read → unread count drops.
  const unreadBefore = apprList.body?.unreadCount || 0
  const markOne = await h.api('PATCH', `/notifications/${assignRow._id}/read`, apprTok)
  const afterOne = await h.api('GET', '/notifications', apprTok)
  h.check('NTF-004', 'Mark-as-read decreases the unread count', markOne.status === 200 && (afterOne.body?.unreadCount || 0) === unreadBefore - 1, `before ${unreadBefore}, after ${afterOne.body?.unreadCount}`)

  // NTF-010 submitter is notified on approve.
  const task = await h.waitUntil(() => runWithOrgId(org._id, () => Task.findOne({ workflowExecutionId: execId, status: 'pending' }).lean()))
  await h.api('POST', `/tasks/${task._id}/approve`, apprTok, {})
  const approvalNotif = await h.waitUntil(async () => {
    const n = await h.api('GET', '/notifications', subTok)
    return (n.body?.notifications || []).find((x) => x.type === 'approval') ? true : null
  })
  h.check('NTF-010', 'Submitter is notified when their request is approved', !!approvalNotif)

  // NTF-011 custom message from a notification node.
  const notifWf = await publishWorkflow(mgrTok, 'NTF custom node wf', [
    { id: 'start', type: 'start', nextNode: 'n' },
    { id: 'n', type: 'notification', config: { notificationMessage: 'NTF custom message ABC' }, nextNode: 'end' },
    { id: 'end', type: 'end' }
  ])
  await h.api('POST', `/workflows/${notifWf}/execute`, subTok, {})
  const customNotif = await h.waitUntil(async () => {
    const n = await h.api('GET', '/notifications', subTok)
    return (n.body?.notifications || []).find((x) => x.message === 'NTF custom message ABC') ? true : null
  })
  h.check('NTF-011', 'Notification node delivers its configured message', !!customNotif)

  // NTF-009 escalation notification to the new owner.
  const overdue = await runWithOrgId(org._id, () => Task.create({
    title: 'NTF overdue', type: 'IT', status: 'pending',
    assignedTo: submitter._id, submittedBy: submitter._id,
    dueDate: new Date(Date.now() - 3 * 3600000), isEscalated: false
  }))
  const populated = await runWithOrgId(org._id, () => Task.findById(overdue._id).populate('assignedTo submittedBy').lean())
  await runWithOrgId(org._id, () => escalateTask(populated, new Date()))
  const escNotif = await h.waitUntil(() => runWithOrgId(org._id, () => h.Notification.findOne({ taskId: overdue._id, type: 'escalation' }).lean()))
  h.check('NTF-009', 'Escalation notifies the new owner', !!escNotif)

  // NTF-006 mark all read → unread count 0.
  await h.api('PATCH', '/notifications/mark-all-read', apprTok)
  const afterAll = await h.api('GET', '/notifications', apprTok)
  h.check('NTF-006', 'Mark all read → unread count is 0', (afterAll.body?.unreadCount || 0) === 0, `unread ${afterAll.body?.unreadCount}`)

  // NTF-007 empty state.
  const emptyState = await h.api('GET', '/notifications', freshTok)
  h.check('NTF-007', 'Empty notifications state for a new user', emptyState.status === 200 && (emptyState.body?.notifications || []).length === 0 && (emptyState.body?.unreadCount || 0) === 0, `count ${emptyState.body?.notifications?.length}`)
})
