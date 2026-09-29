// EDG — Edge cases + security at the API/DB layer: input handling (XSS/HTML
// stored verbatim → React escapes on render), long/special input, NoSQL
// injection login, concurrency, data-integrity deletes, cron double-run guard,
// health, malformed JSON. Browser-only cases (server-down UX, throttling,
// corrupted localStorage) are Pending.

const h = require('./lib/harness')
const { runWithOrgId, Task, Form, FormResponse, Workflow } = h
const { escalateTask } = require('../jobs/escalationCron')

h.runSuite('edge_security', async () => {
  const org = await h.createOrg('edg')

  const manager = await h.createUser(org, { name: 'EDG Manager', email: h.emailIn(org, 'edg-mgr'), roleName: 'Manager', department: 'IT' })
  const admin = await h.createUser(org, { name: 'EDG Admin', email: h.emailIn(org, 'edg-admin'), roleName: 'Admin', department: 'IT' })
  const employee = await h.createUser(org, { name: 'EDG Employee', email: h.emailIn(org, 'edg-emp'), roleName: 'Employee', department: 'IT' })
  const victim = await h.createUser(org, { name: 'EDG Victim', email: h.emailIn(org, 'edg-victim'), roleName: 'Employee', department: 'IT' })

  const mgrTok = await h.getToken({ email: manager.email })
  const adminTok = await h.getToken({ email: admin.email })
  const empTok = await h.getToken({ email: employee.email })

  h.note('EDG-006', 'Pending', 'Frontend: app behaviour when server is down (visual)')
  h.note('EDG-007', 'Pending', 'Frontend: UX on throttled/slow network (visual)')
  h.note('EDG-008', 'Pending', 'Frontend: request timeout / retry UX (visual)')
  h.note('EDG-010', 'Pending', 'Frontend: two-tab concurrent user edit (last-write UX)')
  h.note('EDG-014', 'Pending', 'Uploads are served as static files by design; access policy is manual')
  h.note('EDG-018', 'Pending', 'Frontend: recovery from corrupted localStorage (visual)')

  // A published form the employee can submit to.
  const form = await runWithOrgId(org._id, () => Form.create({ title: 'EDG form', status: 'published', createdBy: manager._id, fields: [{ id: 'note', type: 'text', label: 'Note' }] }))

  const readNote = async () => {
    const fr = await runWithOrgId(org._id, () => FormResponse.findOne({ formId: form._id }).sort({ createdAt: -1 }).lean())
    return fr?.formData?.note
  }

  // EDG-001 XSS payload is stored verbatim (React escapes on render).
  const xss = '<script>alert(1)</script>'
  const r1 = await h.api('POST', `/forms/${form._id}/submit`, empTok, { formData: { note: xss } })
  h.check('EDG-001', 'XSS payload stored safely (verbatim, not executed server-side)', r1.status === 201 && (await readNote()) === xss, `status ${r1.status}`)

  // EDG-003 very long input.
  const long = 'A'.repeat(6000)
  const r3 = await h.api('POST', `/forms/${form._id}/submit`, empTok, { formData: { note: long } })
  h.check('EDG-003', 'Very long input saved or limited, no crash', (r3.status === 201 || r3.status === 400) && r3.status !== 500, `status ${r3.status}`)

  // EDG-004 special characters / emoji / unicode.
  const special = 'café 🚀 "quotes" <ok> \u00e9\u00fc'
  const r4 = await h.api('POST', `/forms/${form._id}/submit`, empTok, { formData: { note: special } })
  h.check('EDG-004', 'Special characters / emoji round-trip correctly', r4.status === 201 && (await readNote()) === special, `status ${r4.status}`)

  // EDG-002 HTML injection in a task comment stored verbatim.
  const htmlComment = '<b onclick="x">hi</b>'
  const commentTask = await runWithOrgId(org._id, () => Task.create({ title: 'EDG comment task', type: 'IT', status: 'pending', assignedTo: employee._id, submittedBy: employee._id }))
  const appr = await h.api('POST', `/tasks/${commentTask._id}/approve`, empTok, { comment: htmlComment })
  const storedComment = (appr.body?.task?.approvalHistory || []).map((x) => x.comment).find(Boolean)
  h.check('EDG-002', 'HTML in a comment stored verbatim (escaped on render)', appr.status === 200 && storedComment === htmlComment, `got ${storedComment}`)

  // EDG-005 NoSQL-injection login attempt → no bypass.
  const inj1 = await h.api('POST', '/auth/login', null, { email: { $gt: '' }, password: { $gt: '' } })
  const inj2 = await h.api('POST', '/auth/login', null, { email: employee.email, password: { $ne: '' } })
  h.check('EDG-005', 'NoSQL-injection login is rejected (no token, no bypass)', !inj1.body?.token && !inj2.body?.token && inj1.status >= 400 && inj2.status >= 400, `inj1 ${inj1.status}, inj2 ${inj2.status}`)
  // A non-string password used to reach bcrypt and throw, so the probe got a
  // 500 with a stack trace instead of a plain "wrong credentials".
  h.check('EDG-005', 'The probe is answered as a failed login, not a server error',
    inj1.status === 401 && inj2.status === 401, `inj1 ${inj1.status}, inj2 ${inj2.status}`)

  // EDG-009 concurrency: a second action on an already-decided task is rejected.
  // The human "two tabs" repro is sequential (click tab 1, then tab 2), which
  // the status guard blocks with INVALID_STATE. We then probe a truly
  // simultaneous double-submit for the record (non-atomic guard is a known gap).
  const raceTask = await runWithOrgId(org._id, () => Task.create({ title: 'EDG race task', type: 'IT', status: 'pending', assignedTo: employee._id, submittedBy: employee._id }))
  const dblFirst = await h.api('POST', `/tasks/${raceTask._id}/approve`, empTok, {})
  const dblSecond = await h.api('POST', `/tasks/${raceTask._id}/approve`, empTok, {})
  const guarded = dblFirst.status === 200 && dblSecond.status === 400 && dblSecond.body?.code === 'INVALID_STATE'

  const simTask = await runWithOrgId(org._id, () => Task.create({ title: 'EDG race task sim', type: 'IT', status: 'pending', assignedTo: employee._id, submittedBy: employee._id }))
  const [a, b] = await Promise.all([
    h.api('POST', `/tasks/${simTask._id}/approve`, empTok, {}),
    h.api('POST', `/tasks/${simTask._id}/approve`, empTok, {})
  ])
  const simSuccess = [a, b].filter((r) => r.status === 200).length
  const raceNote = simSuccess > 1 ? '; simultaneous double-submit not atomically guarded (both 200) — consider findOneAndUpdate on status' : ''
  h.check('EDG-009', 'Second action on a decided task is rejected (two-tab guard)', guarded, `first ${dblFirst.status}, second ${dblSecond.status}/${dblSecond.body?.code || ''}${raceNote}`)

  // EDG-011 dangling linked-form reference does not break the workflow.
  const linkedForm = await runWithOrgId(org._id, () => Form.create({ title: 'EDG linked form', status: 'published', createdBy: admin._id, fields: [] }))
  const wfWithForm = await h.api('POST', '/workflows', adminTok, { title: 'EDG linked wf', nodes: [{ id: 'start', type: 'start', nextNode: 'end' }, { id: 'end', type: 'end' }], linkedFormId: String(linkedForm._id) })
  const wfWithFormId = wfWithForm.body?.workflow?._id
  await runWithOrgId(org._id, () => Form.deleteOne({ _id: linkedForm._id }))
  const openAfterFormDelete = await h.api('GET', `/workflows/${wfWithFormId}`, adminTok)
  h.check('EDG-011', 'Workflow opens after its linked form is deleted', openAfterFormDelete.status === 200, `status ${openAfterFormDelete.status}`)

  // EDG-012 deleting a workflow cascades its pending tasks (no 500 on the orphan).
  const wfToDelete = await h.api('POST', '/workflows', adminTok, { title: 'EDG doomed wf', nodes: [{ id: 'start', type: 'start', nextNode: 'end' }, { id: 'end', type: 'end' }] })
  const wfDelId = wfToDelete.body?.workflow?._id
  const orphanTask = await runWithOrgId(org._id, () => Task.create({ title: 'EDG orphan task', type: 'IT', status: 'pending', assignedTo: employee._id, submittedBy: employee._id, workflowId: wfDelId }))
  const wfDelete = await h.api('DELETE', `/workflows/${wfDelId}`, adminTok)
  const orphanAfter = await h.api('GET', `/tasks/${orphanTask._id}`, mgrTok)
  h.check('EDG-012', 'Deleting a workflow removes its pending tasks (no 500)', wfDelete.status === 200 && orphanAfter.status === 404, `delete ${wfDelete.status}, task ${orphanAfter.status}`)

  // EDG-013 a deactivated assignee's overdue task still escalates to an active target.
  await runWithOrgId(org._id, () => h.User.updateOne({ _id: victim._id }, { $set: { isActive: false } }))
  const stuck = await runWithOrgId(org._id, () => Task.create({ title: 'EDG stuck task', type: 'IT', status: 'pending', assignedTo: victim._id, submittedBy: employee._id, dueDate: new Date(Date.now() - 3 * 3600000), isEscalated: false }))
  const stuckPop = await runWithOrgId(org._id, () => Task.findById(stuck._id).populate('assignedTo submittedBy').lean())
  const stuckEscalated = await runWithOrgId(org._id, () => escalateTask(stuckPop, new Date()))
  const stuckAfter = await runWithOrgId(org._id, () => Task.findById(stuck._id).lean())
  h.check('EDG-013', "A deactivated user's task escalates instead of getting stuck", stuckEscalated === true && stuckAfter.status === 'escalated', `escalated ${stuckEscalated}, status ${stuckAfter.status}`)

  // EDG-015 cron double-run guard — escalate only once.
  const once = await runWithOrgId(org._id, () => Task.create({ title: 'EDG once task', type: 'IT', status: 'pending', assignedTo: employee._id, submittedBy: employee._id, dueDate: new Date(Date.now() - 3 * 3600000), isEscalated: false }))
  const oncePop = await runWithOrgId(org._id, () => Task.findById(once._id).populate('assignedTo submittedBy').lean())
  const first = await runWithOrgId(org._id, () => escalateTask(oncePop, new Date()))
  const second = await runWithOrgId(org._id, () => escalateTask(oncePop, new Date()))
  h.check('EDG-015', 'Escalation cron double-run escalates a task only once', first === true && second === false, `first ${first}, second ${second}`)

  // EDG-016 health endpoint.
  const health = await h.api('GET', '/health', null)
  h.check('EDG-016', 'Health endpoint returns 200', health.status === 200, `status ${health.status}`)

  // EDG-017 malformed JSON body → 400 (no crash).
  const malformed = await h.apiRaw('POST', '/auth/login', null, '{ this is : not json ')
  h.check('EDG-017', 'Malformed JSON body returns 400, server stays up', malformed.status === 400, `status ${malformed.status}`)
})
