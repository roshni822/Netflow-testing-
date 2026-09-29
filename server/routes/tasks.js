// M3 - Phase 2 - routes/tasks.js
// Approval task inbox + approve / reject / request-changes actions.
// All routes require auth. Mutating actions also notify, audit, and email.
//
// NOTE: workflowEngine is lazy-required inside the handlers so this file
// can load before /utils/workflowEngine.js exists (Sprint 5).

const express = require('express')

const Task = require('../models/Task')
const User = require('../models/User')
const WorkflowExecution = require('../models/WorkflowExecution')
const Workflow = require('../models/Workflow')
const FormResponse = require('../models/FormResponse')
const Notification = require('../models/Notification')
const { protect } = require('../middleware/auth')
const { requireCapability } = require('../middleware/capabilityGuard')
const { sendSuccess, sendError } = require('../utils/apiResponse')
const { createNotification } = require('../utils/createNotification')
const { writeAuditLog } = require('../utils/writeAuditLog')
const { isFieldVisible } = require('../utils/conditionalLogic')
const { validateField } = require('../utils/validation')
const { resolvePref } = require('../utils/notificationPrefs')
const { releaseFor } = require('../utils/fileGc')
const { canReach, teamMemberIds, hasOrgWideReach } = require('../utils/team')
const {
  sendApprovalEmail,
  sendRejectionEmail
} = require('../utils/emailService')
const {
  refreshTaskAttachments,
  refreshFormDataUrls,
  refreshFileObject,
  refreshResponseAttachments,
  emitForTask,
} = require('../utils/dmsAttachments')

const router = express.Router()
const validateDocuments = async (req, res, next) => {
  try { await require('../utils/documentAccess').validateInputs(req.body, req.user, req.orgId); next() } catch (error) { next(error) }
}

const sameId = (a, b) => String(a) === String(b)

// ?scope=team can span the whole workspace for an Admin or CEO. Counts on the
// ops dashboard come from /api/team, which aggregates instead, so this list only
// has to be long enough to browse.
const TEAM_SCOPE_LIMIT = 200

// Beyond their own queue, a leader reaches the requests of the people who
// report to them; Admin and the CEO reach the whole workspace. See utils/team —
// this used to be a flat role list that gave every Manager the entire tenant.
const overridesTask = (user, task) =>
  canReach(user, [task?.submittedBy?._id || task?.submittedBy, task?.assignedTo?._id || task?.assignedTo])

// Build the full multi-stage approval chain for a task's workflow execution:
// every approval node in graph order, who each stage is assigned to, and
// whether it is approved / rejected / pending / not-yet-reached. Powers the
// "who approved, who's pending, how many approvals required" view.
const decisionFromTask = (t) => {
  const entry = [...(t.approvalHistory || [])]
    .reverse()
    .find((h) => ['approved', 'rejected', 'escalated'].includes(h.action))
  return entry
    ? { by: entry.performedBy?.name || null, at: entry.performedAt || null }
    : null
}

const buildApprovalChain = async (task) => {
  // Standalone task (no workflow execution) — a single-stage chain.
  if (!task.workflowExecutionId) {
    const d = decisionFromTask(task)
    const status = task.status === 'completed' ? 'approved' : task.status
    return {
      approvalChain: [{
        nodeId: task.currentNode || 'stage-1',
        title: task.title,
        role: null,
        status,
        assignee: task.assignedTo ? { name: task.assignedTo.name, email: task.assignedTo.email } : null,
        decidedBy: d?.by || null,
        decidedAt: d?.at || null,
        isCurrent: task.status === 'pending'
      }],
      approvalSummary: { required: 1, approved: status === 'approved' ? 1 : 0 }
    }
  }

  const execution = await WorkflowExecution.findById(task.workflowExecutionId).lean()
  const workflow = execution ? await Workflow.findById(execution.workflowId).lean() : null
  if (!workflow) return { approvalChain: [], approvalSummary: null }

  const allTasks = await Task.find({ workflowExecutionId: task.workflowExecutionId })
    .populate('assignedTo', 'name email')
    .populate('approvalHistory.performedBy', 'name email')
    .lean()

  // Latest task per node id (a node could be re-instantiated on a re-run).
  const taskByNode = new Map()
  for (const t of allTasks.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))) {
    taskByNode.set(t.currentNode, t)
  }

  // Order approval nodes by walking the graph from the start node.
  const nodeById = new Map((workflow.nodes || []).map((n) => [n.id, n]))
  const start = (workflow.nodes || []).find((n) => n.type === 'start')
  const orderedApprovals = []
  const seen = new Set()
  const walk = (nodeId) => {
    if (!nodeId || seen.has(nodeId)) return
    seen.add(nodeId)
    const n = nodeById.get(nodeId)
    if (!n) return
    if (n.type === 'approval' || n.type === 'multiApproval') orderedApprovals.push(n)
    // Follow every branch type so approvals downstream of a Decision (truePath/
    // falsePath) OR a Review node (forwardPath/changesPath) are still discovered.
    walk(n.config?.truePath)
    walk(n.config?.forwardPath)
    walk(n.config?.falsePath)
    walk(n.config?.changesPath)
    walk(n.nextNode)
  }
  walk(start ? start.id : null)
  if (orderedApprovals.length === 0) {
    for (const n of workflow.nodes || []) if (n.type === 'approval' || n.type === 'multiApproval') orderedApprovals.push(n)
  }

  const pendingNodeId = execution?.variables?.pendingNodeId || null

  const chain = orderedApprovals.map((n) => {
    const t = taskByNode.get(n.id)
    const d = t ? decisionFromTask(t) : null
    const status = t ? (t.status === 'completed' ? 'approved' : t.status) : 'upcoming'
    const isCurrent = (pendingNodeId && n.id === pendingNodeId) || (t && t.status === 'pending')

    // Committee/quorum progress ("2 of 3 approved") when this is a multi node.
    let quorum = null
    if (n.type === 'multiApproval') {
      const M = t ? (t.parallelApprovers || []).length : (n.config?.approverIds || []).length
      const approvedVotes = t ? (t.parallelApprovals || []).filter((p) => p.status === 'approved').length : 0
      const required = t
        ? Math.min(Math.max(t.requiredApprovals || 1, 1), M || 1)
        : Math.min(Math.max(n.config?.requiredApprovals || 1, 1), M || 1)
      quorum = { total: M, approved: approvedVotes, required }
    }

    return {
      nodeId: n.id,
      title: n.label || 'Approval',
      role: n.config?.approverRole || null,
      status,
      assignee: t?.assignedTo ? { name: t.assignedTo.name, email: t.assignedTo.email } : null,
      decidedBy: d?.by || null,
      decidedAt: d?.at || null,
      isCurrent: !!isCurrent,
      quorum
    }
  })

  const approved = chain.filter((c) => c.status === 'approved').length
  return { approvalChain: chain, approvalSummary: { required: chain.length, approved } }
}

const tryAdvanceWorkflow = async (taskId, outcome) => {
  try {
    const { advanceWorkflow } = require('../utils/workflowEngine')
    await advanceWorkflow(taskId, outcome)
  } catch (err) {
    console.error('advanceWorkflow error:', err.message)
  }
}

// GET /api/tasks/my-tasks
// Returns tasks relevant to the current user. By default this includes BOTH
// tasks assigned to them (their approval queue) AND tasks they submitted
// (their own requests), so employees who only submit forms still see their
// requests here. Use ?scope=assigned or ?scope=submitted to narrow it, or
// ?scope=team for what the people reporting to you have in flight.
router.get('/my-tasks', protect, async (req, res, next) => {
  try {
    const me = req.user._id
    const { status, type, scope } = req.query

    const query = {}
    if (status) query.status = status
    if (type) query.type = type

    // Committee (multi-approval) tasks are shared: they list every voter in
    // `parallelApprovers`, so match those too (not just the representative
    // `assignedTo`) — otherwise co-approvers wouldn't see the task.
    if (scope === 'assigned') query.$or = [{ assignedTo: me }, { parallelApprovers: me }]
    else if (scope === 'submitted') query.submittedBy = me
    else if (scope === 'team') {
      // A leader watching their people: what their reports raised and what is
      // sitting with them, excluding the leader's own rows (those are the other
      // scopes). Admin and the CEO answer for the whole workspace, so for them
      // "team" is everyone else. Someone with nobody reporting to them gets an
      // empty list, not an error — the tab simply has nothing in it.
      if (hasOrgWideReach(req.user)) {
        query.submittedBy = { $ne: me }
      } else {
        const team = [...(await teamMemberIds(me))]
        if (!team.length) return sendSuccess(res, { count: 0, tasks: [] })
        query.$or = [{ submittedBy: { $in: team } }, { assignedTo: { $in: team } }]
      }
    } else query.$or = [{ assignedTo: me }, { parallelApprovers: me }, { submittedBy: me }]

    const tasks = await Task.find(query)
      .populate('submittedBy', 'name email department')
      .populate('assignedTo', 'name email department')
      .populate('workflowId', 'title advanced')
      .populate({
        path: 'formResponseId',
        select: 'formData status formId',
        populate: { path: 'formId', select: 'title fields' }
      })
      .sort({ dueDate: 1, createdAt: -1 })
      // Your own queue is naturally bounded; a CEO's "team" is the whole
      // workspace, and every row costs an approval-chain build. Cap that one.
      .limit(scope === 'team' ? TEAM_SCOPE_LIMIT : 0)
      .lean()

    // Attach each task's approval chain so dashboards / inbox rows can show
    // progress (who approved, who's pending, how many approvals required).
    // Built once per workflow execution — every stage task shares the chain.
    const chainByExec = new Map()
    for (const t of tasks) {
      const key = t.workflowExecutionId ? String(t.workflowExecutionId) : null
      if (key && chainByExec.has(key)) {
        const cached = chainByExec.get(key)
        t.approvalChain = cached.approvalChain
        t.approvalSummary = cached.approvalSummary
        continue
      }
      const built = await buildApprovalChain(t)
      if (key) chainByExec.set(key, built)
      t.approvalChain = built.approvalChain
      t.approvalSummary = built.approvalSummary
    }

    // Flag which of the user's OWN pending requests can be cancelled (workflow
    // must opt in via advanced.allowCancel). Separate loop so cached-chain
    // `continue` above doesn't skip it.
    for (const t of tasks) {
      t.canCancel =
        String(t.submittedBy?._id || t.submittedBy) === String(me) &&
        ['pending', 'escalated'].includes(t.status) &&
        t.workflowId?.advanced?.allowCancel === true
    }

    // Attach each parent execution's status so the client can tell which WHOLE
    // requests are finished (used to gate hard-delete of a request).
    const execIds = [...new Set(
      tasks.map((t) => t.workflowExecutionId && String(t.workflowExecutionId)).filter(Boolean)
    )]
    if (execIds.length) {
      const execs = await WorkflowExecution.find({ _id: { $in: execIds } })
        .select('status variables triggeredByExternal')
        .lean()
      const byId = new Map(execs.map((e) => [String(e._id), e]))
      for (const t of tasks) {
        if (!t.workflowExecutionId) continue
        const exec = byId.get(String(t.workflowExecutionId))
        if (!exec) continue
        t.executionStatus = exec.status || null
        // Inbound-webhook runs have no FormResponse — surface variables so the
        // inbox/detail UI can show what the external form submitted.
        if (!t.formResponseId && exec.variables?.formData && typeof exec.variables.formData === 'object') {
          t.triggerFormData = exec.variables.formData
        }
        t.triggerSubmitter =
          (exec.variables?.submitter && typeof exec.variables.submitter === 'object'
            ? exec.variables.submitter
            : null) ||
          exec.triggeredByExternal ||
          null
      }
    }

    let finalTasks = tasks
    if (scope === 'submitted' || scope === 'team') {
      const execMap = new Map()
      const sortedByCreated = [...tasks].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      for (const t of sortedByCreated) {
        if (!t.workflowExecutionId) {
          execMap.set(t._id, t)
          continue
        }
        const key = String(t.workflowExecutionId)
        if (!execMap.has(key)) {
          // Use form/workflow title instead of the node step title
          t.title = t.formResponseId?.formId?.title || t.workflowId?.title || t.title
          execMap.set(key, t)
        }
      }
      finalTasks = Array.from(execMap.values()).sort((a, b) => {
        if (a.dueDate && b.dueDate) return new Date(a.dueDate) - new Date(b.dueDate)
        if (a.dueDate) return -1
        if (b.dueDate) return 1
        return new Date(b.createdAt) - new Date(a.createdAt)
      })
    }

    return sendSuccess(res, { count: finalTasks.length, tasks: finalTasks })
  } catch (err) {
    next(err)
  }
})

// GET /api/tasks/:id
router.get('/:id', protect, async (req, res, next) => {
  try {
    const task = await Task.findById(req.params.id)
      .populate('submittedBy', 'name email department')
      .populate('assignedTo', 'name email department')
      .populate('workflowId', 'title advanced')
      .populate({
        path: 'formResponseId',
        select: 'formData status attachments formId',
        populate: { path: 'formId', select: 'title fields' }
      })
      .populate({
        path: 'approvalHistory.performedBy',
        select: 'name email',
        populate: { path: 'role', select: 'name' }
      })
      .populate('parallelApprovers', 'name email')
      .populate('parallelApprovals.userId', 'name email')
      .lean()

    if (!task) return sendError(res, 'Task not found', 'TASK_NOT_FOUND', 404)

    const allowed =
      sameId(task.assignedTo?._id, req.user._id) ||
      sameId(task.submittedBy?._id, req.user._id) ||
      (task.parallelApprovers || []).some((p) => sameId(p?._id || p, req.user._id)) ||
      await overridesTask(req.user, task)

    if (!allowed) {
      return sendError(res, 'Not authorised to view this task', 'FORBIDDEN', 403)
    }

    const { approvalChain, approvalSummary } = await buildApprovalChain(task)
    task.approvalChain = approvalChain
    task.approvalSummary = approvalSummary

    // Can the viewer (the submitter) cancel this in-flight request?
    task.canCancel =
      sameId(task.submittedBy?._id, req.user._id) &&
      ['pending', 'escalated'].includes(task.status) &&
      task.workflowId?.advanced?.allowCancel === true

    // Files uploaded at EARLIER steps (e.g. a submit node's costing doc) so the
    // current assignee/approver can review everything that came before. The
    // current task's own uploads already render via `attachments`, so drop those.
    if (task.workflowExecutionId) {
      const exec = await WorkflowExecution
        .findById(task.workflowExecutionId)
        .select('variables executionLog triggeredByExternal')
        .lean()
      const docs = Array.isArray(exec?.variables?.documents) ? exec.variables.documents : []
      task.priorDocuments = docs.filter((d) => d.nodeId !== task.currentNode)
      const forms = Array.isArray(exec?.variables?.forms) ? exec.variables.forms : []
      task.priorForms = forms.filter((f) => f.nodeId !== task.currentNode)
      // Webhook-triggered runs store payload on the execution, not a FormResponse.
      if (!task.formResponseId && exec?.variables?.formData && typeof exec.variables.formData === 'object') {
        task.triggerFormData = exec.variables.formData
      }
      // Executions snapshot the source form's display metadata at submission
      // time. Use that snapshot when the original form or response was later
      // removed, without inventing labels for older executions that predate it.
      if (Array.isArray(exec?.variables?.formFields)) {
        task.triggerFormFields = exec.variables.formFields
      }
      if (typeof exec?.variables?.formTitle === 'string') {
        task.triggerFormTitle = exec.variables.formTitle
      }
      task.triggerSubmitter =
        (exec?.variables?.submitter && typeof exec.variables.submitter === 'object'
          ? exec.variables.submitter
          : null) ||
        exec?.triggeredByExternal ||
        null
      // Integration (api) node outcomes for the Manager UI.
      task.integrationEvents = (Array.isArray(exec?.executionLog) ? exec.executionLog : [])
        .filter((e) => e && e.nodeType === 'api')
        .map((e) => ({
          nodeId: e.nodeId,
          status: e.status,
          ok: e.output?.ok !== false && !e.output?.error && e.status !== 'failed',
          error: e.output?.error || null,
          httpStatus: e.output?.status ?? null,
          attempts: e.output?.attempts ?? null,
          skipped: !!e.output?.skipped,
          exitedAt: e.exitedAt || null
        }))
    } else {
      task.priorDocuments = []
      task.priorForms = []
      task.integrationEvents = []
    }

    const ctx = { org: req.organization, user: req.user }
    let out = await refreshTaskAttachments(task, ctx)
    if (out.formResponseId?.formData) {
      out = {
        ...out,
        formResponseId: {
          ...out.formResponseId,
          formData: await refreshFormDataUrls(out.formResponseId.formData, ctx),
        },
      }
    }
    if (Array.isArray(out.formResponseId?.attachments)) {
      out.formResponseId = {
        ...out.formResponseId,
        attachments: await refreshResponseAttachments(out.formResponseId.attachments, ctx)
      }
    }
    if (Array.isArray(out.priorDocuments) && out.priorDocuments.length) {
      out.priorDocuments = await Promise.all(
        out.priorDocuments.map((d) => refreshFileObject(d, ctx))
      )
    }

    return sendSuccess(res, { task: out })
  } catch (err) {
    next(err)
  }
})

// DELETE /api/tasks/:id — the submitter permanently deletes one of their OWN
// finished requests. When the task belongs to a workflow, the WHOLE request is
// removed: every stage task + the linked form response + related notifications
// + the execution. In-flight (running/paused) requests cannot be deleted.
// Audit logs are append-only and deliberately left intact.
router.delete('/:id', protect, async (req, res, next) => {
  try {
    const task = await Task.findById(req.params.id).lean()
    if (!task) return sendError(res, 'Task not found', 'TASK_NOT_FOUND', 404)

    if (!sameId(task.submittedBy, req.user._id) && !(await overridesTask(req.user, task))) {
      return sendError(res, 'Not authorised to delete this request', 'FORBIDDEN', 403)
    }

    let freed = { bytes: 0, files: 0 }
    if (task.workflowExecutionId) {
      const execution = await WorkflowExecution.findById(task.workflowExecutionId).lean()
      // Guard: only finished requests can be deleted.
      if (execution && !['completed', 'failed', 'cancelled'].includes(execution.status)) {
        return sendError(res, 'This request is still in progress and cannot be deleted', 'REQUEST_IN_PROGRESS', 409)
      }

      const siblingTasks = await Task.find({ workflowExecutionId: task.workflowExecutionId })
        .select('_id formData attachments').lean()
      const taskIds = siblingTasks.map((t) => t._id)
      const response = execution?.formResponseId
        ? await FormResponse.findById(execution.formResponseId).select('formData attachments').lean()
        : null

      await Notification.deleteMany({ taskId: { $in: taskIds } })
      await Task.deleteMany({ workflowExecutionId: task.workflowExecutionId })
      if (execution?.formResponseId) await FormResponse.deleteOne({ _id: execution.formResponseId })
      await WorkflowExecution.deleteOne({ _id: task.workflowExecutionId })

      // The whole request is gone, so its attachments — the submitter's uploads,
      // each stage's uploads and any generated PDF — go with it.
      freed = await releaseFor(req.orgId, {
        responses: response ? [response] : [],
        tasks: siblingTasks,
        executions: execution ? [execution] : []
      })
    } else {
      // Standalone task (no workflow) — only delete when resolved.
      if (!['approved', 'rejected', 'completed', 'cancelled'].includes(task.status)) {
        return sendError(res, 'Only finished requests can be deleted', 'REQUEST_NOT_RESOLVED', 409)
      }
      const response = task.formResponseId
        ? await FormResponse.findById(task.formResponseId).select('formData attachments').lean()
        : null
      await Notification.deleteMany({ taskId: task._id })
      if (task.formResponseId) await FormResponse.deleteOne({ _id: task.formResponseId })
      await Task.deleteOne({ _id: task._id })
      freed = await releaseFor(req.orgId, {
        responses: response ? [response] : [],
        tasks: [task]
      })
    }

    return sendSuccess(res, { deleted: true, files: freed.files })
  } catch (err) {
    next(err)
  }
})

// Internal helper: ensure caller can act on this task. Acting on someone else's
// task is an override, so it follows the reporting line rather than the role
// name — see overridesTask above.
const requireApprover = async (task, user) => {
  if (sameId(task.assignedTo, user._id)) return null

  if (task.approvalType === 'parallel') {
    const inParallel = (task.parallelApprovers || []).some(p => sameId(p, user._id))
    if (inParallel) return null
  }

  if (await overridesTask(user, task)) return null
  return 'Not authorised to act on this task'
}

// Internal helper: validate an e-signature payload from the client.
const isValidSignature = (s) =>
  !!s && (
    (s.kind === 'typed' && typeof s.text === 'string' && s.text.trim()) ||
    ((s.kind === 'uploaded' || s.kind === 'drawn') && (s.url || s.dmsDocId))
  )

// Normalise a signature payload to the shape we persist (drop anything extra).
const cleanSignature = (s) => {
  if (!isValidSignature(s)) return undefined
  if (s.kind === 'typed') {
    return { kind: 'typed', text: String(s.text).trim(), font: s.font || 'cursive' }
  }
  return {
    kind: s.kind === 'drawn' ? 'drawn' : 'uploaded',
    url: s.url || undefined,
    ...(s.dmsDocId ? { dmsDocId: String(s.dmsDocId) } : {}),
  }
}

// Internal helper: is a Submit-node form-field value empty? (for required checks)
const isFieldEmpty = (field, v) => {
  if (v === undefined || v === null || v === '') return true
  if (field.type === 'checkbox') return v === false
  if (field.type === 'signature') {
    if (typeof v === 'string') return !v.trim()
    return !(v && (v.text || v.url))
  }
  if (field.type === 'file') return !(v && typeof v === 'object' && (v.url || v.dmsDocId))
  return false
}

// True when a task is a committee/quorum approval (shared across several voters).
const isMultiApproval = (task) =>
  task.approvalType === 'parallel' && Array.isArray(task.parallelApprovers) && task.parallelApprovers.length > 0

// Tally the votes on a multi-approval task. `required` is clamped to 1..M.
const countVotes = (task) => {
  const approvers = task.parallelApprovers || []
  const votes = task.parallelApprovals || []
  const M = approvers.length
  const has = (id, status) => votes.some((pa) => sameId(pa.userId, id) && pa.status === status)
  const approved = approvers.filter((id) => has(id, 'approved')).length
  const rejected = approvers.filter((id) => has(id, 'rejected')).length
  const required = Math.min(Math.max(task.requiredApprovals || M || 1, 1), M || 1)
  return { M, approved, rejected, required }
}

// Record one voter's decision on a multi-approval task (idempotent per user).
const recordParallelVote = (task, userId, status) => {
  const idx = (task.parallelApprovals || []).findIndex((p) => sameId(p.userId, userId))
  if (idx >= 0) {
    task.parallelApprovals[idx].status = status
    task.parallelApprovals[idx].decidedAt = new Date()
  } else {
    task.parallelApprovals.push({ userId, status, decidedAt: new Date() })
  }
}

// Ping the co-approvers who haven't voted yet ("X approved — 1 of 2 so far").
const notifyOtherApprovers = (task, actorId, actorName, verb, progressText) => {
  const decided = new Set(
    (task.parallelApprovals || [])
      .filter((p) => p.status && p.status !== 'pending')
      .map((p) => String(p.userId?._id || p.userId))
  )
  for (const id of task.parallelApprovers || []) {
    if (sameId(id, actorId) || decided.has(String(id))) continue
    createNotification({
      userId: id,
      title: 'Approval update',
      message: `${actorName} ${verb} "${task.title}". ${progressText}`,
      type: 'assignment',
      taskId: task._id,
      triggeredBy: actorId
    })
  }
}

// POST /api/tasks/:id/approve
router.post('/:id/approve', protect, validateDocuments, requireCapability('decide_tasks'), async (req, res, next) => {
  try {
    const { comment, signature } = req.body || {}

    const task = await Task.findById(req.params.id)
    if (!task) return sendError(res, 'Task not found', 'TASK_NOT_FOUND', 404)
    if (task.status !== 'pending') {
      return sendError(res, `Task is already ${task.status}`, 'INVALID_STATE', 400)
    }

    const denial = await requireApprover(task, req.user)
    if (denial) return sendError(res, denial, 'FORBIDDEN', 403)

    if (task.requireSignature && !isValidSignature(signature)) {
      return sendError(res, 'This approval requires your e-signature', 'SIGNATURE_REQUIRED', 400)
    }
    const sig = task.requireSignature ? cleanSignature(signature) : undefined

    // Committee/quorum approval: record this vote; advance only once N of M
    // approvals are in. Otherwise the task stays pending for the others.
    if (isMultiApproval(task)) {
      // Guard: this voter already decided.
      const prior = (task.parallelApprovals || []).find((p) => sameId(p.userId, req.user._id))
      if (prior && prior.status !== 'pending') {
        return sendError(res, `You have already ${prior.status} this task`, 'ALREADY_VOTED', 400)
      }

      recordParallelVote(task, req.user._id, 'approved')
      task.approvalHistory.push({
        action: 'approved',
        performedBy: req.user._id,
        performedAt: new Date(),
        comment: comment || undefined,
        signature: sig
      })

      const { approved, required } = countVotes(task)
      if (approved < required) {
        await task.save()
        notifyOtherApprovers(task, req.user._id, req.user.name, 'approved', `${approved} of ${required} approvals received.`)
        writeAuditLog({
          action: 'task_approved',
          performedBy: req.user._id,
          targetEntity: `Task: ${task.title}`,
          department: req.user.department,
          ipAddress: req.ip,
          detail: `${req.user.name} approved "${task.title}" (${approved}/${required})`,
          metadata: { taskId: task._id, partial: true }
        })
        return sendSuccess(res, {
          message: `Approval recorded (${approved} of ${required}). Awaiting other approvers.`,
          task: task.toObject()
        })
      }
      // Quorum reached — fall through to finalise the stage as approved.
    } else {
      // Sequential: single approver
      task.approvalHistory.push({
        action: 'approved',
        performedBy: req.user._id,
        performedAt: new Date(),
        comment: comment || undefined,
        signature: sig
      })
    }

    task.status = 'approved'

    // Finalize staging attachments (Two-Stage Upload Architecture)
    try {
      const attachments = task.attachments || []
      const dms = require('../services/dmsClient')
      for (const file of attachments) {
         if (file.dmsDocId && file.dmsFolder === 'staging') {
            await dms.postEvent(file.dmsDocId, {
               type: 'finalized_from_staging',
               detail: 'Task approved. File finalized to permanent archive.',
               meta: { folder: req.user.department || 'archive' }
            }, { org: req.organization }).catch(() => {})
         }
      }
    } catch(e) { console.error('Failed to finalize files from staging', e) }

    await task.save()

    emitForTask(task, {
      type: 'workflow.approved',
      actor: req.user,
      detail: comment || `Approved by ${req.user.name}`,
      meta: { taskId: task._id, workflowId: task.workflowId, comment: comment || null },
      org: req.organization,
    }).catch(() => {})

    tryAdvanceWorkflow(task._id, 'approved')

    writeAuditLog({
      action: 'task_approved',
      performedBy: req.user._id,
      targetEntity: `Task: ${task.title}`,
      department: req.user.department,
      ipAddress: req.ip,
      detail: `${req.user.name} approved "${task.title}"`,
      metadata: { taskId: task._id, comment: comment || null }
    })

    if (task.submittedBy) {
      createNotification({
        userId: task.submittedBy,
        title: 'Request approved',
        message: `Your request "${task.title}" has been approved.`,
        type: 'approval',
        taskId: task._id,
        triggeredBy: req.user._id
      })

      const submitter = await User.findById(task.submittedBy).select('name email notificationPrefs').lean()
      if (submitter?.email && resolvePref(submitter, 'approval').email) {
        sendApprovalEmail({
          to: submitter.email,
          submitterName: submitter.name,
          taskTitle: task.title,
          approverName: req.user.name,
          comment
        })
      }
    }

    return sendSuccess(res, { task: task.toObject() })
  } catch (err) {
    next(err)
  }
})

// POST /api/tasks/:id/submit
// For Submit-node tasks: the assignee fills the inline form the designer defined
// + an optional comment, which advances the workflow (no approve/reject). File
// fields are surfaced as task.attachments so downstream nodes can open them.
router.post('/:id/submit', protect, validateDocuments, async (req, res, next) => {
  try {
    const { comment, formData } = req.body || {}

    const task = await Task.findById(req.params.id)
    if (!task) return sendError(res, 'Task not found', 'TASK_NOT_FOUND', 404)
    if (task.status !== 'pending') {
      return sendError(res, `Task is already ${task.status}`, 'INVALID_STATE', 400)
    }

    const denial = await requireApprover(task, req.user)
    if (denial) return sendError(res, denial, 'FORBIDDEN', 403)

    const fields = Array.isArray(task.formFields) ? task.formFields : []
    const data = formData && typeof formData === 'object' ? formData : {}

    // Server-side required-field validation (mirrors the client form).
    // Skip fields hidden by conditional logic so a hidden required field can't
    // block an otherwise-valid submission.
    const missing = fields
      .filter((f) => f.required && isFieldVisible(f, data) && isFieldEmpty(f, data[f.id]))
      .map((f) => f.label || f.id)
    if (missing.length) {
      return sendError(res, `Please complete required field(s): ${missing.join(', ')}`, 'FIELD_REQUIRED', 400)
    }

    // Advanced validation (length / range / format) on visible, filled fields.
    for (const f of fields) {
      if (!isFieldVisible(f, data)) continue
      const err = validateField(f, data[f.id])
      if (err) return sendError(res, err, 'FIELD_INVALID', 400)
    }

    // Surface file-type field values as real attachments for downstream nodes.
    const files = fields
      .filter((f) => f.type === 'file')
      .map((f) => data[f.id])
      .filter((v) => v && typeof v === 'object' && (v.url || v.dmsDocId))
      .map((v) => ({
        name: v.name,
        url: v.url,
        mime: v.mime,
        size: v.size,
        ...(v.dmsDocId ? { dmsDocId: String(v.dmsDocId) } : {}),
        ...(v.provisionalId ? { provisionalId: String(v.provisionalId) } : {}),
      }))

    task.formData = data
    task.markModified('formData')
    task.attachments = files
    task.approvalHistory.push({
      action: 'submitted',
      performedBy: req.user._id,
      performedAt: new Date(),
      comment: comment || undefined
    })
    task.status = 'completed'

    // Finalize staging attachments (Two-Stage Upload Architecture)
    try {
      const attachments = task.attachments || []
      const dms = require('../services/dmsClient')
      for (const file of attachments) {
         if (file.dmsDocId && file.dmsFolder === 'staging') {
            await dms.postEvent(file.dmsDocId, {
               type: 'finalized_from_staging',
               detail: 'Task completed. File finalized to permanent archive.',
               meta: { folder: req.user.department || 'archive' }
            }, { org: req.organization }).catch(() => {})
         }
      }
    } catch(e) { console.error('Failed to finalize files from staging', e) }

    await task.save()

    emitForTask(task, {
      type: 'workflow.submitted',
      actor: req.user,
      detail: comment || `Submitted by ${req.user.name}`,
      meta: { taskId: task._id, workflowId: task.workflowId },
      org: req.organization,
    }).catch(() => {})

    tryAdvanceWorkflow(task._id, 'submitted')

    writeAuditLog({
      action: 'task_submitted',
      performedBy: req.user._id,
      targetEntity: `Task: ${task.title}`,
      department: req.user.department,
      ipAddress: req.ip,
      detail: `${req.user.name} submitted "${task.title}"`,
      metadata: { taskId: task._id, attachments: files.length, comment: comment || null }
    })

    if (task.submittedBy && !sameId(task.submittedBy, req.user._id)) {
      createNotification({
        userId: task.submittedBy,
        title: 'Request updated',
        message: `"${task.title}" has been submitted and moved to the next step.`,
        type: 'assignment',
        taskId: task._id,
        triggeredBy: req.user._id
      })
    }

    return sendSuccess(res, { task: task.toObject() })
  } catch (err) {
    next(err)
  }
})

// POST /api/tasks/:id/review
// For Review-node tasks: the reviewer views the submission + accumulated
// documents and chooses to forward (no changes) or send back for changes.
// Advances the engine with outcome 'forward' | 'changes' (no approve/reject).
router.post('/:id/review', protect, validateDocuments, requireCapability('decide_tasks'), async (req, res, next) => {
  try {
    const { outcome, comment } = req.body || {}
    const decision = outcome === 'changes' ? 'changes' : 'forward'

    const task = await Task.findById(req.params.id)
    if (!task) return sendError(res, 'Task not found', 'TASK_NOT_FOUND', 404)
    if (task.status !== 'pending') {
      return sendError(res, `Task is already ${task.status}`, 'INVALID_STATE', 400)
    }
    if (task.actionType !== 'review') {
      return sendError(res, 'This task is not a review task', 'INVALID_ACTION', 400)
    }

    const denial = await requireApprover(task, req.user)
    if (denial) return sendError(res, denial, 'FORBIDDEN', 403)

    if (decision === 'changes' && (!comment || !String(comment).trim())) {
      return sendError(res, 'Please describe the changes required', 'COMMENT_REQUIRED', 400)
    }

    task.approvalHistory.push({
      action: decision === 'changes' ? 'request_changes' : 'approved',
      performedBy: req.user._id,
      performedAt: new Date(),
      comment: comment || undefined
    })
    task.status = 'completed'
    await task.save()

    tryAdvanceWorkflow(task._id, decision)

    writeAuditLog({
      action: 'task_reviewed',
      performedBy: req.user._id,
      targetEntity: `Task: ${task.title}`,
      department: req.user.department,
      ipAddress: req.ip,
      detail: `${req.user.name} reviewed "${task.title}" → ${decision === 'changes' ? 'changes required' : 'forwarded'}`,
      metadata: { taskId: task._id, outcome: decision, comment: comment || null }
    })

    if (task.submittedBy && !sameId(task.submittedBy, req.user._id)) {
      createNotification({
        userId: task.submittedBy,
        title: decision === 'changes' ? 'Changes requested' : 'Review passed',
        message: decision === 'changes'
          ? `"${task.title}" needs changes before it can proceed.`
          : `"${task.title}" was reviewed and moved to the next step.`,
        type: decision === 'changes' ? 'reminder' : 'assignment',
        taskId: task._id,
        triggeredBy: req.user._id
      })
    }

    return sendSuccess(res, { task: task.toObject() })
  } catch (err) {
    next(err)
  }
})

// POST /api/tasks/:id/reject
router.post('/:id/reject', protect, validateDocuments, requireCapability('decide_tasks'), async (req, res, next) => {
  try {
    const { comment, signature } = req.body || {}
    if (!comment || !String(comment).trim()) {
      return sendError(res, 'A rejection comment is required', 'COMMENT_REQUIRED', 400)
    }

    const task = await Task.findById(req.params.id)
    if (!task) return sendError(res, 'Task not found', 'TASK_NOT_FOUND', 404)
    if (task.status !== 'pending') {
      return sendError(res, `Task is already ${task.status}`, 'INVALID_STATE', 400)
    }

    const denial = await requireApprover(task, req.user)
    if (denial) return sendError(res, denial, 'FORBIDDEN', 403)

    if (task.requireSignature && !isValidSignature(signature)) {
      return sendError(res, 'This decision requires your e-signature', 'SIGNATURE_REQUIRED', 400)
    }

    // Committee/quorum reject policy: a single reject does NOT fail the stage
    // while N approvals are still mathematically possible. Only when enough
    // people reject that N can no longer be reached does the stage fail.
    if (isMultiApproval(task)) {
      const prior = (task.parallelApprovals || []).find((p) => sameId(p.userId, req.user._id))
      if (prior && prior.status !== 'pending') {
        return sendError(res, `You have already ${prior.status} this task`, 'ALREADY_VOTED', 400)
      }

      recordParallelVote(task, req.user._id, 'rejected')
      task.approvalHistory.push({
        action: 'rejected',
        performedBy: req.user._id,
        performedAt: new Date(),
        comment,
        signature: task.requireSignature ? cleanSignature(signature) : undefined
      })

      const { M, approved, rejected, required } = countVotes(task)
      const stillPossible = (M - rejected) >= required
      if (stillPossible) {
        await task.save()
        notifyOtherApprovers(task, req.user._id, req.user.name, 'rejected', `Still awaiting approvals (${approved} of ${required}).`)
        writeAuditLog({
          action: 'task_rejected',
          performedBy: req.user._id,
          targetEntity: `Task: ${task.title}`,
          department: req.user.department,
          ipAddress: req.ip,
          detail: `${req.user.name} rejected "${task.title}" (${approved}/${required} approved; quorum still possible)`,
          metadata: { taskId: task._id, partial: true }
        })
        return sendSuccess(res, {
          message: `Rejection recorded. Quorum still possible (${approved} of ${required} approved).`,
          task: task.toObject()
        })
      }
      // Quorum impossible — fall through to finalise the stage as rejected.
    } else {
      task.approvalHistory.push({
        action: 'rejected',
        performedBy: req.user._id,
        performedAt: new Date(),
        comment,
        signature: task.requireSignature ? cleanSignature(signature) : undefined
      })
    }

    task.status = 'rejected'
    
    // Rejected Vault: Document the move to the Rejected Vault
    try {
      const attachments = task.attachments || []
      const dms = require('../services/dmsClient')
      for (const file of attachments) {
         if (file.dmsDocId) {
            await dms.postEvent(file.dmsDocId, {
               type: 'moved_to_rejected_vault',
               detail: 'Task was rejected. File moved to Rejected Vault.',
               meta: { folder: 'rejected' }
            }, { org: req.organization }).catch(() => {})
         }
      }
    } catch(e) {
      console.error('Failed to update Rejected Vault', e)
    }

    await task.save()

    emitForTask(task, {
      type: 'workflow.rejected',
      actor: req.user,
      detail: comment || `Rejected by ${req.user.name}`,
      meta: { taskId: task._id, workflowId: task.workflowId, comment },
      org: req.organization,
    }).catch(() => {})

    tryAdvanceWorkflow(task._id, 'rejected')

    writeAuditLog({
      action: 'task_rejected',
      performedBy: req.user._id,
      targetEntity: `Task: ${task.title}`,
      department: req.user.department,
      ipAddress: req.ip,
      detail: `${req.user.name} rejected "${task.title}"`,
      metadata: { taskId: task._id, comment }
    })

    if (task.submittedBy) {
      createNotification({
        userId: task.submittedBy,
        title: 'Request rejected',
        message: `Your request "${task.title}" was rejected.`,
        type: 'rejection',
        taskId: task._id,
        triggeredBy: req.user._id
      })

      const submitter = await User.findById(task.submittedBy).select('name email notificationPrefs').lean()
      if (submitter?.email && resolvePref(submitter, 'rejection').email) {
        sendRejectionEmail({
          to: submitter.email,
          submitterName: submitter.name,
          taskTitle: task.title,
          approverName: req.user.name,
          comment
        })
      }
    }

    return sendSuccess(res, { task: task.toObject() })
  } catch (err) {
    next(err)
  }
})

// POST /api/tasks/:id/request-changes
router.post('/:id/request-changes', protect, validateDocuments, requireCapability('decide_tasks'), async (req, res, next) => {
  try {
    const { comment, signature } = req.body || {}
    if (!comment || !String(comment).trim()) {
      return sendError(res, 'A comment is required when requesting changes', 'COMMENT_REQUIRED', 400)
    }

    const task = await Task.findById(req.params.id)
    if (!task) return sendError(res, 'Task not found', 'TASK_NOT_FOUND', 404)
    if (task.status !== 'pending') {
      return sendError(res, `Task is already ${task.status}`, 'INVALID_STATE', 400)
    }

    const denial = await requireApprover(task, req.user)
    if (denial) return sendError(res, denial, 'FORBIDDEN', 403)

    if (task.requireSignature && !isValidSignature(signature)) {
      return sendError(res, 'This decision requires your e-signature', 'SIGNATURE_REQUIRED', 400)
    }

    task.approvalHistory.push({
      action: 'request_changes',
      performedBy: req.user._id,
      performedAt: new Date(),
      comment,
      signature: task.requireSignature ? cleanSignature(signature) : undefined
    })
    // Status stays 'pending' — submitter has to act before approval can proceed.
    await task.save()

    writeAuditLog({
      action: 'request_changes',
      performedBy: req.user._id,
      targetEntity: `Task: ${task.title}`,
      department: req.user.department,
      ipAddress: req.ip,
      detail: `${req.user.name} requested changes on "${task.title}"`,
      metadata: { taskId: task._id, comment }
    })

    if (task.submittedBy) {
      createNotification({
        userId: task.submittedBy,
        title: 'Changes requested',
        message: `Changes requested on your request "${task.title}".`,
        type: 'reminder',
        taskId: task._id,
        triggeredBy: req.user._id
      })
    }

    return sendSuccess(res, { task: task.toObject() })
  } catch (err) {
    next(err)
  }
})

module.exports = require('../database/atomicRoutes').atomicRoutes(router)
