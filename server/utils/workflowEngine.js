// M2 - Phase 2 - utils/workflowEngine.js
// Core state machine. Walks workflow nodes one at a time, pauses on approval
// nodes (M3's approve/reject API resumes via advanceWorkflow), and writes a
// per-node executionLog. Public surface: triggerWorkflow, advanceWorkflow,
// processNode.

const WorkflowExecution = require('../models/WorkflowExecution')
const Task = require('../models/Task')
const User = require('../models/User')
const Role = require('../models/Role')
const Organization = require('../models/Organization')
const Form = require('../models/Form')

const { getOrgId } = require('../tenancy/tenantContext')
const { listFor: departmentsFor } = require('./departments')

const { createNotification } = require('./createNotification')
const { writeAuditLog } = require('./writeAuditLog')
const { sendTaskAssignedEmail } = require('./emailService')
const { resolvePref } = require('./notificationPrefs')

// ---------- helpers ----------

const findRoleIdByName = async (name) => {
  if (!name) return null
  const role = await Role.findOne({ name }).lean()
  return role?._id || null
}

const normaliseToken = (s) =>
  String(s || '').trim().toLowerCase().replace(/\s+/g, '_')

// The tenant's own team list (utils/departments), read through the ambient org
// context the engine already runs inside.
const orgDepartments = async () => {
  const orgId = getOrgId()
  const org = orgId ? await Organization.findById(orgId).select('departments').lean() : null
  return departmentsFor(org)
}

// Resolve a `<department>_manager` semantic token (e.g. "hr_manager",
// "finance_manager") to the first active Manager in that department.
const resolveDepartmentManager = async (token) => {
  if (!/_manager$/.test(token)) return null
  const departments = await orgDepartments()
  const dept = departments.find((d) => `${normaliseToken(d)}_manager` === token)
  if (!dept) return null
  const managerRoleId = await findRoleIdByName('Manager')
  if (!managerRoleId) return null
  const user = await User.findOne({
    role: managerRoleId,
    department: dept,
    isActive: true
  }).lean()
  return user?._id || null
}

const findFirstUserByRoleName = async (roleName) => {
  const roleId = await findRoleIdByName(roleName)
  if (!roleId) return null
  const u = await User.findOne({ role: roleId, isActive: true }).lean()
  return u?._id || null
}

// True when a user is currently on Out-of-Office (within the optional window).
const isUserOOO = (user, at = new Date()) => {
  const o = user && user.outOfOffice
  if (!o || !o.enabled) return false
  if (o.from && at < new Date(o.from)) return false
  if (o.until && at > new Date(o.until)) return false
  return true
}

// If the resolved approver is out of office, route to their chosen delegate.
// Returns { assignedTo, reason }; `reason` is null when no redirect happened 
// (so the original assignee stays).
const redirectIfOutOfOffice = async (assignedTo) => {
  if (!assignedTo) return { assignedTo, reason: null }
  const original = await User.findById(assignedTo)
    .select('name isActive outOfOffice managerId')
    .lean()
  if (!original || !isUserOOO(original)) return { assignedTo, reason: null }

  // Route to the chosen delegate if they are active and not also away
  if (original.outOfOffice?.delegateId) {
    const delegate = await User.findById(original.outOfOffice.delegateId)
      .select('name isActive outOfOffice')
      .lean()
    if (delegate && delegate.isActive !== false && !isUserOOO(delegate)) {
      return {
        assignedTo: delegate._id,
        reason: `${original.name} is out of office; routed to their chosen delegate ${delegate.name}.`
      }
    }
  }

  // No auto-routing fallback to manager. Task stays with original assignee if delegate is invalid/absent.
  return { assignedTo, reason: null }
}

// Find a reference user from the submitted form data
const resolveFormAutoApprover = async (execution) => {
  let formData = execution?.variables?.formData || null
  let formFields = execution?.variables?.formFields || null

  if (execution?.formResponseId) {
    const FormResponse = require('../models/FormResponse')
    const formResponse = await FormResponse.findById(execution.formResponseId).lean()
    if (!formResponse) return { userId: null, reason: null }
    formData = formData || formResponse.formData
    if (!formFields) {
      const form = await Form.findById(formResponse.formId).select('fields').lean()
      formFields = form?.fields || null
    }
  } else if (!formFields && execution?.variables?.formId) {
    const form = await Form.findById(execution.variables.formId).select('fields').lean()
    formFields = form?.fields || null
  }

  if (!formData || !Array.isArray(formFields)) return { userId: null, reason: null }

  // Find the first field marked as referenceUser
  const refField = formFields.find(f => f.referenceUser)
  if (!refField) return { userId: null, reason: null }

  const userName = formData[refField.id]
  if (!userName) return { userId: null, reason: null }

  // Lookup the user by exact name
  const user = await User.findOne({ name: userName, isActive: true }).lean()
  if (user) {
    return { userId: user._id, reason: `Auto-routed to ${user.name} — selected in the form field "${refField.label}".` }
  }
  return { userId: null, reason: `${userName} was selected in the form but is not an active user.` }
}

// Resolve a semantic approver token using submitter context. Returns a User _id
// or null if the token is not recognised / no matching user exists. Tokens are
// case- and whitespace-insensitive ("Direct manager", "direct_manager", and
// "DIRECT MANAGER" all resolve identically).
const resolveSemanticApprover = async (rawToken, submitter, execution) => {
  const token = normaliseToken(rawToken)
  if (!token) return null

  if (token === 'direct_manager') {
    return submitter?.managerId || null
  }
  if (token === 'hr_partner') {
    return submitter?.hrId || null
  }
  if (token === 'ceo') {
    return (await findFirstUserByRoleName('CEO')) || (await findFirstUserByRoleName('Admin'))
  }
  // Legacy alias: 'super_admin' now maps to the single Admin role.
  if (token === 'super_admin' || token === 'hr_admin') {
    return findFirstUserByRoleName('Admin')
  }

  // <department>_manager — e.g. "hr_manager", "finance_manager"
  const deptManager = await resolveDepartmentManager(token)
  if (deptManager) return deptManager

  return null
}

// Resolve only the submitter's explicitly assigned direct manager. A missing or
// inactive manager is intentionally unresolved: the approval preview blocks the
// form submission and tells the user that an administrator must assign one.
// Direct-manager steps must never silently escalate to HR, a skip-level manager,
// or an administrator. Returns { userId, reason }.
const resolveDirectManager = async (submitter) => {
  if (!submitter) return { userId: null, reason: null }
  const who = submitter.name || 'the submitter'

  // The submitter's own direct manager must still be active.
  if (submitter.managerId) {
    const mgr = await User.findOne({ _id: submitter.managerId, isActive: true }).select('name').lean()
    if (mgr) {
      return { userId: mgr._id, reason: `Auto-routed to ${mgr.name} — ${who}'s direct manager.` }
    }
  }

  return { userId: null, reason: `${who} has no active direct manager assigned.` }
}

// Auto-detect the submitter's ASSIGNED HR partner (User.hrId) and route to
// them. Verifies the partner is active; if missing or inactive, escalates to an
// active Manager in the HR department, then to an administrator — never to an
// unrelated person. Mirrors resolveDirectManager. Returns { userId, reason }.
const resolveHrPartner = async (submitter) => {
  if (!submitter) return { userId: null, reason: null }
  const who = submitter.name || 'the submitter'

  // 1) The submitter's own assigned HR partner — must still be active.
  if (submitter.hrId) {
    const hr = await User.findOne({ _id: submitter.hrId, isActive: true }).select('name').lean()
    if (hr) {
      return { userId: hr._id, reason: `Auto-routed to ${hr.name} — ${who}'s assigned HR partner.` }
    }
  }

  // 2) No usable HR partner -> an active Manager in the HR department.
  const hrManagerId = await resolveDepartmentManager('hr_manager')
  if (hrManagerId) {
    const mgr = await User.findById(hrManagerId).select('name').lean()
    return { userId: hrManagerId, reason: `${who} has no active HR partner; routed to HR manager ${mgr?.name || ''}.`.replace(/\s+\.$/, '.') }
  }

  // 3) Last resort -> an administrator.
  const adminId = await findFirstUserByRoleName('Admin')
  if (adminId) {
    const admin = await User.findById(adminId).select('name').lean()
    return { userId: adminId, reason: `${who} has no HR partner on record; escalated to ${admin?.name || 'an administrator'}.` }
  }

  return { userId: null, reason: null }
}

// Condition node field accessor. Lookup order:
//   1. "submitter.<key>"        -> execution.variables.submitter[key]
//   2. plain top-level variable -> execution.variables[field]
//      (used for runtime values like `lastApprovalOutcome`)
//   3. fallback                 -> execution.variables.formData[field]
const readConditionField = (field, variables) => {
  if (!field) return undefined
  if (field.startsWith('submitter.')) {
    const key = field.slice('submitter.'.length)
    return variables?.submitter?.[key]
  }
  if (variables && Object.prototype.hasOwnProperty.call(variables, field)) {
    return variables[field]
  }
  return (variables?.formData || {})[field]
}

const evaluateCondition = (operator, fieldValue, conditionValue) => {
  switch (operator) {
    case 'eq': return String(fieldValue) === String(conditionValue)
    case 'gt': return Number(fieldValue) > Number(conditionValue)
    case 'lt': return Number(fieldValue) < Number(conditionValue)
    case 'gte': return Number(fieldValue) >= Number(conditionValue)
    case 'lte': return Number(fieldValue) <= Number(conditionValue)
    case 'contains': return String(fieldValue ?? '').includes(conditionValue)
    default: return false
  }
}

const updateNodeLog = async (execution, nodeId, status, output = {}) => {
  const logEntry = execution.executionLog.find(l => l.nodeId === nodeId && !l.exitedAt)
  if (logEntry) {
    logEntry.status = status
    logEntry.exitedAt = new Date()
    logEntry.output = output
  }
  await execution.save()
}

const notifyExternalResult = async (execution, outcome) => {
  try {
    const Workflow = require('../models/Workflow')
    const { sendResultCallback } = require('./resultCallback')
    const workflow = await Workflow.findById(execution.workflowId).lean()
    if (!workflow) return
    await sendResultCallback(workflow, execution, outcome)
  } catch (err) {
    console.error('notifyExternalResult:', err.message)
  }
}

const completeExecution = async (execution) => {
  execution.status = 'completed'
  execution.completedAt = new Date()
  execution.timerResumeAt = undefined
  execution.timerNextNodeId = undefined
  if (execution.currentNodeId) {
    await updateNodeLog(execution, execution.currentNodeId, 'completed')
  } else {
    await execution.save()
  }

  writeAuditLog({
    action: 'workflow_completed',
    performedBy: execution.triggeredBy,
    targetEntity: `Workflow Execution #${execution._id}`,
    detail: 'Workflow completed successfully'
  })

  const outcome = execution.variables?.lastApprovalOutcome === 'rejected' ? 'rejected' : 'completed'
  await notifyExternalResult(execution, outcome)

  return { completed: true, executionId: execution._id }
}

// End-node option: when config.generatePdf is on, produce a signed PDF of the
// approved request (form data + approval trail + captured e-signatures), file it
// under /uploads, and surface it on both the execution's documents and the
// submitter's FormResponse so everyone can download it. Best-effort: a PDF
// failure never blocks the workflow from completing.
const maybeGeneratePdf = async (execution, node, workflow) => {
  // Generate when the End node opts in, OR when the workflow-wide
  // "Auto-generate PDF on completion" advanced setting is enabled.
  if (!node?.config?.generatePdf && !workflow?.advanced?.autoPdf) return
  try {
    const { generateApprovalPdf } = require('./pdf')
    const doc = await generateApprovalPdf(execution, workflow)

    execution.variables = execution.variables || {}
    const prior = Array.isArray(execution.variables.documents) ? execution.variables.documents : []
    execution.variables.documents = [
      ...prior,
      {
        name: doc.name, url: doc.url, mime: doc.mime, size: doc.size,
        step: node.label || 'Approved request', nodeId: node.id, generated: true,
      },
    ]
    execution.markModified('variables')
    await execution.save()

    if (execution.formResponseId) {
      const FormResponse = require('../models/FormResponse')
      await FormResponse.findByIdAndUpdate(execution.formResponseId, {
        // size is stored so deleting the submission can credit the bytes back.
        $push: { attachments: { filename: doc.name, path: doc.url, mimetype: doc.mime, size: doc.size } },
      })
    }

    writeAuditLog({
      action: 'workflow_completed',
      performedBy: execution.triggeredBy,
      targetEntity: `Workflow Execution #${execution._id}`,
      detail: `Signed PDF generated (${doc.name})`,
      metadata: { nodeId: node.id, url: doc.url }
    })
  } catch (err) {
    console.error(`PDF generation failed for execution ${execution._id}:`, err.message)
  }
}

const failExecution = async (execution, reason) => {
  execution.status = 'failed'
  execution.failedAt = new Date()
  execution.failureReason = reason
  execution.timerResumeAt = undefined
  execution.timerNextNodeId = undefined
  if (execution.currentNodeId) {
    await updateNodeLog(execution, execution.currentNodeId, 'failed', { reason })
  } else {
    await execution.save()
  }

  writeAuditLog({
    action: 'workflow_failed',
    performedBy: execution.triggeredBy,
    targetEntity: `Workflow Execution #${execution._id}`,
    detail: reason
  })

  const outcome = /reject/i.test(String(reason || '')) ? 'rejected' : 'failed'
  await notifyExternalResult(execution, outcome)

  return { failed: true, reason }
}

// ---------- node handlers ----------

// Resolves who an approval / submit task should be assigned to. Order: a pinned
// user (config.approverId) -> semantic tokens (direct_manager / hr_partner /
// ceo / <dept>_manager) -> plain role-name lookup scoped to the submitter's
// department. Shared by the approval + submit handlers.
// Returns { assignedTo, routingReason, routingSla }.
const resolveAssignee = async (execution, node, workflow, { audit = true } = {}) => {
  let assignedTo = node.config?.approverId || null
  const submitter = execution.variables?.submitter || null
  const roleToken = normaliseToken(node.config?.approverRole)
  let routingReason = null
  let routingSla = null

  // Pass 1: semantic tokens (direct_manager, hr_partner, hr_manager, ceo, ...).
  // These need submitter context, which is why we resolve them first.
  // "direct_manager" auto-detects the submitter and routes to their OWN manager,
  // "hr_partner" to their OWN assigned HR partner — never an unrelated person —
  // Direct-manager routing stops when that assignment is missing or inactive;
  // HR-partner routing retains its separate fallback policy.
  if (!assignedTo && node.config?.approverRole) {
    const token = roleToken
    if (token === 'direct_manager' || token === 'hr_partner' || token === 'form_auto') {
      let routed = { userId: null, reason: null }
      if (token === 'direct_manager') {
        routed = await resolveDirectManager(submitter)
      } else if (token === 'hr_partner') {
        routed = await resolveHrPartner(submitter)
      } else if (token === 'form_auto') {
        routed = await resolveFormAutoApprover(execution)
      }
      if (routed.userId) {
        assignedTo = routed.userId
        routingReason = routed.reason
        if (audit) {
          writeAuditLog({
            action: 'approver_inferred',
            performedBy: execution.triggeredBy,
            targetEntity: `${workflow.title} — ${node.id}`,
            department: execution.variables?.department,
            detail: routed.reason
          })
        }
      }
    } else {
      assignedTo = await resolveSemanticApprover(node.config.approverRole, submitter, execution)
    }
  }

  // Pass 2: plain role-name lookup (existing behaviour). Scoped to the
  // submitter's department when one is known, with a relax-and-retry fallback.
  // Resolves custom roles like "Warehouse Manager" / "Accounts Officer".
  if (!assignedTo && node.config?.approverRole && roleToken !== 'direct_manager') {
    const roleId = await findRoleIdByName(node.config.approverRole)
    if (roleId) {
      const query = { role: roleId, isActive: true }
      if (execution.variables?.department) query.department = execution.variables.department
      const approver = await User.findOne(query).lean()
      assignedTo = approver?._id || null

      if (!assignedTo && query.department) {
        delete query.department
        const fallback = await User.findOne(query).lean()
        assignedTo = fallback?._id || null
      }
    }
  }

  // Out-of-Office redirect: if the resolved assignee is away, route to their
  // manager. Applies to approval / submit / review nodes alike since they all
  // resolve their assignee through this function.
  if (assignedTo) {
    const ooo = await redirectIfOutOfOffice(assignedTo)
    if (ooo.reason) {
      assignedTo = ooo.assignedTo
      routingReason = [routingReason, ooo.reason].filter(Boolean).join(' ')
      if (audit) {
        writeAuditLog({
          action: 'approver_inferred',
          performedBy: execution.triggeredBy,
          targetEntity: `Workflow: ${workflow.title}`,
          detail: ooo.reason,
          metadata: { nodeId: node.id, redirectedTo: String(assignedTo), reason: 'out_of_office' }
        })
      }
    }
  }

  return { assignedTo, routingReason, routingSla }
}

const handleApprovalNode = async (execution, node, workflow) => {
  const { assignedTo, routingReason, routingSla } = await resolveAssignee(execution, node, workflow)

  if (!assignedTo) {
    return await failExecution(
      execution,
      `Approval node "${node.id}" has no resolvable approver (approverRole="${node.config?.approverRole || ''}")`
    )
  }

  const slaHours = routingSla || node.config?.slaHours || 48

  const task = await Task.create({
    workflowExecutionId: execution._id,
    workflowId: workflow._id,
    assignedTo,
    submittedBy: execution.triggeredBy,
    formResponseId: execution.formResponseId,
    title: `${workflow.title} — Approval Required`,
    type: workflow.department || 'General',
    status: 'pending',
    dueDate: new Date(Date.now() + slaHours * 3600000),
    currentNode: node.id,
    approvalType: node.config?.approvalType || 'sequential',
    requireSignature: node.config?.requireSignature === true
  })

  createNotification({
    userId: assignedTo,
    title: 'New approval task assigned',
    message: `You have a new task requiring your approval: ${task.title}`,
    type: 'assignment',
    taskId: task._id,
    triggeredBy: execution.triggeredBy
  })

  const approver = await User.findById(assignedTo).select('name email notificationPrefs').lean()
  if (approver?.email && resolvePref(approver, 'assignment').email) {
    sendTaskAssignedEmail({
      to: approver.email,
      assigneeName: approver.name,
      taskTitle: task.title,
      submittedBy: 'NetFlow workflow',
      dueDate: task.dueDate
    })
  }

  execution.variables = execution.variables || {}
  execution.variables.pendingTaskId = task._id.toString()
  execution.variables.pendingNodeId = node.id
  if (routingReason) execution.variables.routingReason = routingReason
  // Mark the flexible variables object for persistence as one JSONB value.
  execution.markModified('variables')
  await execution.save()

  return { paused: true, taskId: task._id }
}

// Multi/committee approval node: one shared task sent to several people at once.
// The stage passes as soon as `requiredApprovals` (N of M) approve; it fails once
// enough reject that N approvals become impossible. Uses Task.parallelApprovers /
// parallelApprovals; the N-of-M tallying lives in routes/tasks.js.
const resolveMultiApprovers = async (rawIds = []) => {
  // Resolve each configured person: must be active; apply Out-of-Office
  // redirect; dedupe (two entries can resolve to the same person).
  const seen = new Set()
  const approvers = []
  for (const rawId of rawIds) {
    if (!rawId) continue
    const user = await User.findById(rawId).select('_id isActive').lean()
    if (!user || user.isActive === false) continue
    const { assignedTo } = await redirectIfOutOfOffice(user._id)
    const key = String(assignedTo)
    if (seen.has(key)) continue
    seen.add(key)
    approvers.push(assignedTo)
  }
  return approvers
}

const handleMultiApprovalNode = async (execution, node, workflow) => {
  const rawIds = Array.isArray(node.config?.approverIds) ? node.config.approverIds : []
  const approvers = await resolveMultiApprovers(rawIds)

  if (approvers.length === 0) {
    return await failExecution(
      execution,
      `Multi-approval node "${node.id}" has no resolvable approvers`
    )
  }

  const M = approvers.length
  let required = Number(node.config?.requiredApprovals) || 1
  required = Math.min(Math.max(required, 1), M) // clamp to 1..M

  const slaHours = node.config?.slaHours || 48

  const task = await Task.create({
    workflowExecutionId: execution._id,
    workflowId: workflow._id,
    assignedTo: approvers[0], // representative assignee for legacy queries/escalation
    submittedBy: execution.triggeredBy,
    formResponseId: execution.formResponseId,
    title: `${workflow.title} — ${node.label || 'Approval Required'}`,
    type: workflow.department || 'General',
    actionType: 'approval',
    status: 'pending',
    dueDate: new Date(Date.now() + slaHours * 3600000),
    currentNode: node.id,
    approvalType: 'parallel',
    requireSignature: node.config?.requireSignature === true,
    parallelApprovers: approvers,
    parallelApprovals: approvers.map((u) => ({ userId: u, status: 'pending' })),
    requiredApprovals: required
  })

  // Notify + email every approver up front.
  const people = await User.find({ _id: { $in: approvers } }).select('name email notificationPrefs').lean()
  for (const p of people) {
    createNotification({
      userId: p._id,
      title: 'New approval task assigned',
      message: `You have a committee approval task (${required} of ${M} approvals needed): ${task.title}`,
      type: 'assignment',
      taskId: task._id,
      triggeredBy: execution.triggeredBy
    })
    if (p.email && resolvePref(p, 'assignment').email) {
      sendTaskAssignedEmail({
        to: p.email,
        assigneeName: p.name,
        taskTitle: task.title,
        submittedBy: 'NetFlow workflow',
        dueDate: task.dueDate
      })
    }
  }

  execution.variables = execution.variables || {}
  execution.variables.pendingTaskId = task._id.toString()
  execution.variables.pendingNodeId = node.id
  execution.markModified('variables')
  await execution.save()

  return { paused: true, taskId: task._id }
}

// Submit node: like an approval, but the assignee uploads document(s) + a comment
// and clicks Submit (no approve/reject). Pauses until POST /api/tasks/:id/submit
// resumes the workflow via advanceWorkflow(taskId, 'submitted').
const handleSubmitNode = async (execution, node, workflow) => {
  const { assignedTo, routingReason, routingSla } = await resolveAssignee(execution, node, workflow)

  if (!assignedTo) {
    return await failExecution(
      execution,
      `Submit node "${node.id}" has no resolvable assignee (approverRole="${node.config?.approverRole || ''}")`
    )
  }

  const slaHours = routingSla || node.config?.slaHours || 48

  const task = await Task.create({
    workflowExecutionId: execution._id,
    workflowId: workflow._id,
    assignedTo,
    submittedBy: execution.triggeredBy,
    formResponseId: execution.formResponseId,
    title: `${workflow.title} — ${node.label || 'Submission Required'}`,
    type: workflow.department || 'General',
    actionType: 'submit',
    status: 'pending',
    dueDate: new Date(Date.now() + slaHours * 3600000),
    currentNode: node.id,
    instructions: node.config?.instructions || '',
    formFields: Array.isArray(node.config?.formFields) ? node.config.formFields : []
  })

  createNotification({
    userId: assignedTo,
    title: 'New submission task assigned',
    message: `You have a new task that needs a submission: ${task.title}`,
    type: 'assignment',
    taskId: task._id,
    triggeredBy: execution.triggeredBy
  })

  const assignee = await User.findById(assignedTo).select('name email notificationPrefs').lean()
  if (assignee?.email && resolvePref(assignee, 'assignment').email) {
    sendTaskAssignedEmail({
      to: assignee.email,
      assigneeName: assignee.name,
      taskTitle: task.title,
      submittedBy: 'NetFlow workflow',
      dueDate: task.dueDate
    })
  }

  execution.variables = execution.variables || {}
  execution.variables.pendingTaskId = task._id.toString()
  execution.variables.pendingNodeId = node.id
  if (routingReason) execution.variables.routingReason = routingReason
  execution.markModified('variables')
  await execution.save()

  return { paused: true, taskId: task._id }
}

// Review (viewer) node: a reviewer (e.g. Brand Representative) views the
// submission + accumulated documents, then chooses to forward (no changes) or
// send it back for changes. Pauses until POST /api/tasks/:id/review resumes the
// engine with outcome 'forward' | 'changes', which advanceWorkflow routes via
// the node's config.forwardPath / config.changesPath.
const handleReviewNode = async (execution, node, workflow) => {
  const { assignedTo, routingReason, routingSla } = await resolveAssignee(execution, node, workflow)

  if (!assignedTo) {
    return await failExecution(
      execution,
      `Review node "${node.id}" has no resolvable reviewer (approverRole="${node.config?.approverRole || ''}")`
    )
  }

  const slaHours = routingSla || node.config?.slaHours || 48

  const task = await Task.create({
    workflowExecutionId: execution._id,
    workflowId: workflow._id,
    assignedTo,
    submittedBy: execution.triggeredBy,
    formResponseId: execution.formResponseId,
    title: `${workflow.title} — ${node.label || 'Review Required'}`,
    type: workflow.department || 'General',
    actionType: 'review',
    status: 'pending',
    dueDate: new Date(Date.now() + slaHours * 3600000),
    currentNode: node.id,
    instructions: node.config?.instructions || ''
  })

  createNotification({
    userId: assignedTo,
    title: 'New review task assigned',
    message: `You have a new task to review: ${task.title}`,
    type: 'assignment',
    taskId: task._id,
    triggeredBy: execution.triggeredBy
  })

  const reviewer = await User.findById(assignedTo).select('name email notificationPrefs').lean()
  if (reviewer?.email && resolvePref(reviewer, 'assignment').email) {
    sendTaskAssignedEmail({
      to: reviewer.email,
      assigneeName: reviewer.name,
      taskTitle: task.title,
      submittedBy: 'NetFlow workflow',
      dueDate: task.dueDate
    })
  }

  execution.variables = execution.variables || {}
  execution.variables.pendingTaskId = task._id.toString()
  execution.variables.pendingNodeId = node.id
  if (routingReason) execution.variables.routingReason = routingReason
  execution.markModified('variables')
  await execution.save()

  return { paused: true, taskId: task._id }
}

const handleConditionNode = async (execution, node, workflow) => {
  const {
    conditionField,
    conditionOperator,
    conditionValue,
    truePath,
    falsePath
  } = node.config || {}

  // Supports both "formField" (reads execution.variables.formData) and
  // "submitter.role" / "submitter.department" / etc. for routing by who
  // submitted the form.
  const fieldValue = readConditionField(conditionField, execution.variables)

  const conditionMet = evaluateCondition(conditionOperator, fieldValue, conditionValue)

  const nextNodeId = conditionMet ? truePath : falsePath
  await updateNodeLog(execution, node.id, 'completed', { conditionMet, nextNodeId })

  if (!nextNodeId) {
    return await failExecution(execution, `Condition node "${node.id}" has no path for outcome ${conditionMet}`)
  }
  return await processNode(execution, nextNodeId, workflow)
}

const handleNotificationNode = async (execution, node, workflow) => {
  createNotification({
    userId: execution.triggeredBy,
    title: 'Workflow update',
    message: node.config?.notificationMessage || 'Your workflow has been updated',
    type: 'assignment',
    triggeredBy: execution.triggeredBy
  })
  await updateNodeLog(execution, node.id, 'completed')
  return await processNode(execution, node.nextNode, workflow)
}

const handleTimerNode = async (execution, node, workflow) => {
  // Real wait: pause the execution and resume via timerCron when timerResumeAt elapses.
  // slaHours may be fractional (e.g. minutes stored as hours/60 from the UI).
  const hours = Number(node.config?.slaHours)
  const waitMs = Number.isFinite(hours) && hours > 0
    ? Math.max(1000, Math.round(hours * 3600 * 1000))
    : 1000

  // Short waits (≤ 30s): sleep in-process so local demos feel instant/responsive.
  if (waitMs <= 30000) {
    await new Promise((r) => setTimeout(r, waitMs))
    await updateNodeLog(execution, node.id, 'completed', { waitedMs: waitMs, mode: 'inline' })
    return await processNode(execution, node.nextNode, workflow)
  }

  execution.status = 'paused'
  execution.timerResumeAt = new Date(Date.now() + waitMs)
  execution.timerNextNodeId = node.nextNode || null
  execution.markModified('timerResumeAt')
  await updateNodeLog(execution, node.id, 'completed', {
    waitedMs: waitMs,
    mode: 'scheduled',
    resumeAt: execution.timerResumeAt
  })
  await execution.save()
  return { paused: true, timer: true, resumeAt: execution.timerResumeAt }
}

const handleAssignmentNode = async (execution, node, workflow) => {
  execution.variables = execution.variables || {}
  execution.variables.assignedTo = node.config?.assignTo || null
  execution.markModified('variables')
  await execution.save()
  await updateNodeLog(execution, node.id, 'completed')
  return await processNode(execution, node.nextNode, workflow)
}

// Integration / webhook node ('api'): one outbound HTTP call to an external
// system (ERP, Slack, payments, ...). Opt-in and skipped-safe — if the call
// fails and config.continueOnError is true (default) the workflow still
// advances, so a flaky endpoint never strands a request. The response can be
// stashed under config.saveResponseAs for later condition nodes to read.
const handleApiNode = async (execution, node, workflow) => {
  const { interpolate, isSafeUrl, callWebhook } = require('./webhook')
  const cfg = node.config || {}
  const url = String(cfg.apiUrl || '').trim()
  const method = cfg.apiMethod || 'POST'
  const continueOnError = cfg.continueOnError !== false
  let body

  const audit = (ok, detail, extra = {}) => writeAuditLog({
    action: 'webhook_called',
    performedBy: execution.triggeredBy,
    targetEntity: `${workflow.title} — ${node.label || node.id}`,
    department: execution.variables?.department,
    detail,
    metadata: { nodeId: node.id, url, method, ok, ...extra }
  })

  // Shared failure path: continue past the node or fail the whole run.
  const onFail = async (reason, extra = {}) => {
    audit(false, `Webhook failed: ${reason}`, extra)
    execution.variables = execution.variables || {}
    execution.variables.lastIntegrationError = {
      nodeId: node.id,
      reason,
      at: new Date().toISOString(),
      ...extra
    }
    execution.markModified('variables')
    await execution.save()

    // Dead-letter for exhausted outbound failures (observability / replay later).
    try {
      const IntegrationDeadLetter = require('../models/IntegrationDeadLetter')
      await IntegrationDeadLetter.create({
        orgId: execution.orgId || workflow.orgId,
        workflowId: workflow._id,
        executionId: execution._id,
        nodeId: node.id,
        url,
        method,
        error: reason,
        httpStatus: extra.status ?? null,
        attempts: extra.attempts ?? null,
        requestBodyPreview: body ? String(body).slice(0, 2000) : ''
      })
    } catch (dlqErr) {
      console.error('IntegrationDeadLetter write failed:', dlqErr.message)
    }

    if (continueOnError) {
      await updateNodeLog(execution, node.id, 'completed', {
        error: reason,
        skipped: true,
        ok: false,
        ...extra
      })
      return await processNode(execution, node.nextNode, workflow)
    }
    await updateNodeLog(execution, node.id, 'failed', { error: reason, ok: false, ...extra })
    return await failExecution(execution, `Integration node "${node.id}" failed: ${reason}`)
  }

  if (!url) return await onFail('No URL configured')
  const safe = isSafeUrl(url)
  if (!safe.ok) return await onFail(safe.reason)

  const vars = execution.variables || {}
  const headers = (Array.isArray(cfg.apiHeaders) ? cfg.apiHeaders : [])
    .filter((h) => h && h.key)
    .map((h) => ({ key: h.key, value: interpolate(h.value, vars) }))
  
  const sendAllData = cfg.sendAllData === true || (cfg.sendAllData === undefined && !cfg.apiBody?.trim())
  if (sendAllData) {
    const rawData = vars.formData || {}
    const fieldMap = {}
    
    try {
      const Form = require('../models/Form')
      let formDoc = null
      if (execution.formResponseId) {
        const FormResponse = require('../models/FormResponse')
        const resp = await FormResponse.findById(execution.formResponseId).select('formId').lean()
        if (resp && resp.formId) formDoc = await Form.findById(resp.formId).select('fields').lean()
      } else if (workflow.linkedFormId) {
        formDoc = await Form.findById(workflow.linkedFormId).select('fields').lean()
      }
      
      if (formDoc && Array.isArray(formDoc.fields)) {
        formDoc.fields.forEach(f => {
          if (f.id && f.label) fieldMap[f.id] = f.label
        })
      }
    } catch (e) {
      console.warn('[workflowEngine] Failed to map form fields', e.message)
    }

    if (workflow && Array.isArray(workflow.nodes)) {
      workflow.nodes.forEach(n => {
        const fields = (n.config && Array.isArray(n.config.formFields)) ? n.config.formFields : (Array.isArray(n.formFields) ? n.formFields : null)
        if (fields) {
          fields.forEach(f => {
            if (f.id && f.label) fieldMap[f.id] = f.label
          })
        }
      })
    }
    const mappedData = {}
    for (const [key, val] of Object.entries(rawData)) {
      mappedData[fieldMap[key] || key] = val
    }
    body = JSON.stringify(mappedData)
  } else {
    body = cfg.apiBody ? interpolate(cfg.apiBody, vars) : undefined
  }

  let result
  try {
    result = await callWebhook({ url, method, headers, body, auth: cfg.apiAuth, retries: 3 })
  } catch (err) {
    return await onFail(err.message || 'Request error', { attempts: err.attempts || 3 })
  }

  if (!result.ok) {
    return await onFail(`Received HTTP ${result.status}`, {
      status: result.status,
      attempts: result.attempts
    })
  }

  // Success: optionally expose the response to downstream nodes/conditions.
  if (cfg.saveResponseAs) {
    execution.variables = execution.variables || {}
    execution.variables[cfg.saveResponseAs] = result.data
    execution.markModified('variables')
    await execution.save()
  }

  await updateNodeLog(execution, node.id, 'completed', {
    status: result.status,
    attempts: result.attempts,
    ok: true
  })
  audit(true, `Webhook ${method} ${url} -> ${result.status}`, {
    status: result.status,
    attempts: result.attempts
  })
  return await processNode(execution, node.nextNode, workflow)
}

// ---------- public API ----------

// Generous next to any real graph (the longest hand-built chains are well under
// 30 nodes), low enough that a runaway loop is caught long before the call stack
// or the executionLog becomes a problem.
const MAX_HOPS_PER_WALK = 100

const processNode = async (execution, nodeId, workflow) => {
  if (!nodeId) {
    return await failExecution(execution, 'No nextNode to process')
  }

  // The canvas allows back-edges on purpose — a Review node's "changes" path
  // normally loops to an earlier submit step — so a graph can legitimately be
  // cyclic. What it must never do is loop through nodes that don't pause for a
  // human: processNode recurses, so that walk would run until the stack gives
  // out and take the server with it. Hops are counted per walk on the in-memory
  // document; every resume loads a fresh one, so review loops stay unbounded
  // across rounds while a single runaway walk is cut short.
  const hops = (execution.$locals.hops || 0) + 1
  execution.$locals.hops = hops
  if (hops > MAX_HOPS_PER_WALK) {
    return await failExecution(
      execution,
      `Stopped after ${MAX_HOPS_PER_WALK} steps at node "${nodeId}" — this path loops without reaching an approval or end node`
    )
  }

  const node = workflow.nodes.find(n => n.id === nodeId)
  if (!node) {
    return await failExecution(execution, `Node ${nodeId} not found in workflow`)
  }

  execution.currentNodeId = nodeId
  execution.executionLog.push({
    nodeId: node.id,
    nodeType: node.type,
    enteredAt: new Date(),
    status: 'in_progress'
  })
  await execution.save()

  switch (node.type) {
    case 'start':
      await updateNodeLog(execution, node.id, 'completed')
      return await processNode(execution, node.nextNode, workflow)

    case 'approval':
      return await handleApprovalNode(execution, node, workflow)

    case 'multiApproval':
      return await handleMultiApprovalNode(execution, node, workflow)

    case 'submit':
      return await handleSubmitNode(execution, node, workflow)

    case 'review':
      return await handleReviewNode(execution, node, workflow)

    case 'condition':
      return await handleConditionNode(execution, node, workflow)

    case 'notification':
      return await handleNotificationNode(execution, node, workflow)

    case 'timer':
      return await handleTimerNode(execution, node, workflow)

    case 'assignment':
      return await handleAssignmentNode(execution, node, workflow)

    case 'api':
      return await handleApiNode(execution, node, workflow)

    case 'end':
      await maybeGeneratePdf(execution, node, workflow)
      return await completeExecution(execution)

    case 'document':
      // Stubbed — log and skip (End-node generatePdf covers PDF-on-completion)
      console.log(`Node type "${node.type}" not implemented; skipping`)
      await updateNodeLog(execution, node.id, 'skipped', { note: `${node.type} not implemented` })
      return await processNode(execution, node.nextNode, workflow)

    default:
      return await failExecution(execution, `Unknown node type: ${node.type}`)
  }
}

// Read-only preview used by the form filler. It walks the same success path and
// resolves people with the same helpers as a real execution, but creates no
// execution, task, notification, or audit event.
const previewPerson = async (userId) => {
  if (!userId) return null
  const user = await User.findById(userId)
    .select('name department role')
    .populate('role', 'name')
    .lean()
  if (!user) return null
  return {
    name: user.name || 'Assigned approver',
    role: user.role?.name || null,
    department: user.department || null,
  }
}

const approverRoleLabel = (value) => String(value || '')
  .trim()
  .replace(/_/g, ' ')
  .replace(/\b\w/g, (letter) => letter.toUpperCase())

const previewApprovalRoute = async ({ workflow, form, formData = {}, submitter }) => {
  const submitterId = submitter?._id || submitter?.id
  const submitterDoc = submitterId
    ? await User.findById(submitterId).populate('role', 'name').lean()
    : null

  const variables = {
    formData: formData && typeof formData === 'object' ? formData : {},
    formFields: Array.isArray(form?.fields) ? form.fields : [],
    formId: form?._id || null,
    lastApprovalOutcome: 'approved',
  }
  if (submitterDoc) {
    variables.submitter = {
      id: submitterDoc._id,
      name: submitterDoc.name,
      email: submitterDoc.email,
      role: submitterDoc.role?.name || null,
      department: submitterDoc.department || null,
      managerId: submitterDoc.managerId || null,
      hrId: submitterDoc.hrId || null,
    }
    if (submitterDoc.department) variables.department = submitterDoc.department
  }

  const execution = {
    formResponseId: null,
    triggeredBy: submitterId || null,
    variables,
  }
  const nodes = Array.isArray(workflow?.nodes) ? workflow.nodes : []
  const nodeById = new Map(nodes.map((node) => [node.id, node]))
  const fieldById = new Map((form?.fields || []).map((field) => [field.id, field]))
  const start = nodes.find((node) => node.type === 'start')
  const stages = []
  const requiredInputs = []
  const issues = []
  const seen = new Set()
  let confirmation = 'confirmed'
  let message = ''
  let nodeId = start?.nextNode || null
  let approvalsRequired = 0
  let approvalStages = 0
  let reviewStages = 0
  let hops = 0

  if (!start) {
    confirmation = 'invalid'
    message = 'The linked workflow has no start step.'
  }

  while (nodeId && confirmation === 'confirmed' && hops < MAX_HOPS_PER_WALK) {
    hops += 1
    if (seen.has(nodeId)) {
      confirmation = 'runtime_only'
      message = 'The remaining route depends on a workflow loop and will be confirmed while it runs.'
      break
    }
    seen.add(nodeId)

    const node = nodeById.get(nodeId)
    if (!node) {
      confirmation = 'invalid'
      message = 'The linked workflow contains an unavailable step.'
      break
    }
    const config = node.config || {}

    if (node.type === 'end') break

    if (node.type === 'condition') {
      const conditionField = config.conditionField
      const formField = fieldById.get(conditionField)
      const isSubmitterField = String(conditionField || '').startsWith('submitter.')
      const hasRuntimeValue = Object.prototype.hasOwnProperty.call(variables, conditionField)
      const fieldValue = readConditionField(conditionField, variables)
      const isEmpty = fieldValue === undefined || fieldValue === null || fieldValue === ''

      if (formField && isEmpty) {
        confirmation = 'needs_input'
        requiredInputs.push({
          fieldId: formField.id,
          label: formField.label || formField.id,
        })
        message = `Complete ${formField.label || formField.id} to confirm the remaining approval route.`
        break
      }

      if (!formField && !isSubmitterField && !hasRuntimeValue) {
        confirmation = 'runtime_only'
        message = 'The remaining route depends on data created during the workflow.'
        break
      }

      if (isSubmitterField && isEmpty) {
        confirmation = 'runtime_only'
        message = 'The remaining route depends on submitter information that is not configured.'
        break
      }

      const conditionMet = evaluateCondition(
        config.conditionOperator,
        fieldValue,
        config.conditionValue
      )
      nodeId = conditionMet ? config.truePath : config.falsePath
      if (!nodeId) {
        confirmation = 'invalid'
        message = 'A conditional approval path has not been configured.'
      }
      continue
    }

    if (node.type === 'approval' || node.type === 'review') {
      const resolved = await resolveAssignee(execution, node, workflow, { audit: false })
      const person = await previewPerson(resolved.assignedTo)
      const configuredRole = approverRoleLabel(config.approverRole)
      const kind = node.type === 'review' ? 'review' : 'approval'
      const title = node.label || (kind === 'review' ? 'Review' : 'Approval')
      const routingToken = normaliseToken(config.approverRole)
      stages.push({
        nodeId: node.id,
        kind,
        title,
        approver: person,
        configuredRole: configuredRole || null,
        department: person?.department || workflow.department || null,
        slaHours: Number(resolved.routingSla || config.slaHours) || 48,
        status: person ? 'resolved' : 'unconfigured',
        routingReason: resolved.routingReason || null,
      })
      if (!person) {
        const issueCode = routingToken === 'direct_manager' && !config.approverId
          ? 'manager_unassigned'
          : 'approver_unconfigured'
        const issueMessage = issueCode === 'manager_unassigned'
          ? `${submitterDoc?.name || 'This requester'} has no active direct manager assigned. Ask a workspace administrator to assign a manager before submitting.`
          : `${title} has no active approver configured. Ask a workspace administrator to assign one.`
        issues.push({
          code: issueCode,
          severity: 'error',
          nodeId: node.id,
          title,
          message: issueMessage,
        })
      }
      if (kind === 'approval') {
        approvalStages += 1
        approvalsRequired += 1
      } else {
        reviewStages += 1
      }
      nodeId = kind === 'review'
        ? (config.forwardPath || node.nextNode)
        : node.nextNode
      continue
    }

    if (node.type === 'multiApproval') {
      const approverIds = await resolveMultiApprovers(
        Array.isArray(config.approverIds) ? config.approverIds : []
      )
      const people = await Promise.all(approverIds.map(previewPerson))
      const approvers = people.filter(Boolean)
      const total = approvers.length
      const configuredRequired = Math.max(Number(config.requiredApprovals) || 1, 1)
      const required = total > 0 ? Math.min(configuredRequired, total) : 0
      stages.push({
        nodeId: node.id,
        kind: 'multiApproval',
        title: node.label || 'Committee approval',
        approvers,
        configuredRole: null,
        department: workflow.department || null,
        slaHours: Number(config.slaHours) || 48,
        status: total > 0 ? 'resolved' : 'unconfigured',
        quorum: { required, total },
      })
      if (total === 0) {
        issues.push({
          code: 'approver_unconfigured',
          severity: 'error',
          nodeId: node.id,
          title: node.label || 'Committee approval',
          message: `${node.label || 'Committee approval'} has no active approvers configured. Ask a workspace administrator to assign them.`,
        })
      }
      approvalStages += 1
      approvalsRequired += required
      nodeId = node.nextNode
      continue
    }

    nodeId = node.nextNode
  }

  if (hops >= MAX_HOPS_PER_WALK && nodeId) {
    confirmation = 'runtime_only'
    message = 'The remaining route will be confirmed while the workflow runs.'
  }

  if (confirmation === 'invalid') {
    issues.push({
      code: 'route_invalid',
      severity: 'error',
      nodeId: null,
      title: 'Approval route is incomplete',
      message: message || 'The linked workflow must be corrected before this request can be submitted.',
    })
  }

  return {
    linked: true,
    workflowTitle: workflow.title || 'Linked workflow',
    automatic: workflow.triggerOn !== 'Manual trigger only',
    confirmation,
    message,
    requiredInputs,
    issues,
    canSubmit: !issues.some((issue) => issue.severity === 'error'),
    stages,
    summary: {
      approvalStages,
      approvalsRequired,
      reviewStages,
    },
  }
}

// Called by routes/forms.js POST /:id/submit and routes/workflows.js POST /:id/execute.
const triggerWorkflow = async (workflowId, formResponseId, userId, extraVariables = {}) => {
  const Workflow = require('../models/Workflow')
  const FormResponse = require('../models/FormResponse')

  const workflow = await Workflow.findById(workflowId)
  if (!workflow) throw new Error('Workflow not found')
  if (workflow.status !== 'published') {
    throw new Error(`Workflow status is "${workflow.status}", cannot trigger`)
  }

  const startNode = workflow.nodes.find(n => n.type === 'start')
  if (!startNode) throw new Error('Workflow has no start node')

  const variables = { ...extraVariables }

  // Cache submitter context so approval / condition nodes can route on the
  // submitter's role + department without re-querying for every node.
  // Inbound webhooks may already supply variables.submitter (external guest);
  // only overwrite when the caller did not provide one.
  if (!variables.submitter && userId) {
    const submitter = await User.findById(userId).populate('role').lean()
    if (submitter) {
      variables.submitter = {
        id: submitter._id,
        name: submitter.name,
        email: submitter.email,
        role: submitter.role?.name || null,
        department: submitter.department || null,
        managerId: submitter.managerId || null,
        hrId: submitter.hrId || null
      }
      if (submitter.department) variables.department = submitter.department
    }
  }

  if (formResponseId) {
    const formResponse = await FormResponse.findById(formResponseId).lean()
    if (formResponse) {
      variables.formData = formResponse.formData

      // Keep a durable display snapshot with the execution. Form responses and
      // form definitions can be removed later, but task history must remain
      // understandable for audit and approval review. WorkflowExecution.variables
      // is intentionally Mixed, so this is additive and needs no migration.
      if (formResponse.formId && !Array.isArray(variables.formFields)) {
        const sourceForm = await Form.findById(formResponse.formId)
          .select('title fields')
          .lean()
        if (sourceForm) {
          variables.formTitle = sourceForm.title || null
          variables.formFields = Array.isArray(sourceForm.fields) ? sourceForm.fields : []
        }
      }
    }
  }

  // An inbound webhook starts a run with no signed-in person behind it, so it
  // needs two things: attribution without a User row, and a status token the
  // caller can poll with, since it cannot hold a session to ask again.
  const externalSubmitter = variables.submitter?.source === 'webhook'
    ? {
        name: variables.submitter.name || 'External submitter',
        email: variables.submitter.email || '',
        source: 'webhook'
      }
    : undefined

  const crypto = require('crypto')
  const statusToken = externalSubmitter ? crypto.randomBytes(24).toString('hex') : undefined

  const execution = await WorkflowExecution.create({
    orgId: workflow.orgId,
    workflowId,
    formResponseId,
    triggeredBy: userId,
    ...(externalSubmitter ? { triggeredByExternal: externalSubmitter } : {}),
    ...(statusToken ? { statusToken } : {}),
    status: 'running',
    variables
  })

  const startDetail = externalSubmitter
    ? `Execution #${execution._id} started via inbound webhook `
      + `from ${externalSubmitter.name}${externalSubmitter.email ? ` <${externalSubmitter.email}>` : ''}`
    : `Execution #${execution._id} started`

  writeAuditLog({
    action: 'workflow_started',
    performedBy: userId,
    targetEntity: `Workflow: ${workflow.title}`,
    detail: startDetail,
    metadata: {
      workflowId,
      formResponseId,
      executionId: execution._id,
      ...(externalSubmitter ? { externalSubmitter } : {})
    }
  })

  // Walk the graph. Will resolve when the engine pauses (approval node)
  // or completes / fails. Await so the caller knows the kick-off succeeded.
  await processNode(execution, startNode.nextNode, workflow)

  return execution
}

// Called by routes/tasks.js after approve / reject.
const advanceWorkflow = async (taskId, outcome = 'approved') => {
  const Workflow = require('../models/Workflow')

  const task = await Task.findById(taskId)
  if (!task) throw new Error('Task not found')

  if (!task.workflowExecutionId) {
    // Standalone task (e.g. seeded without a workflow). Nothing to advance.
    return { skipped: true, reason: 'Task has no linked execution' }
  }

  const execution = await WorkflowExecution.findById(task.workflowExecutionId)
  if (!execution) throw new Error('Execution not found')

  const workflow = await Workflow.findById(execution.workflowId)
  if (!workflow) throw new Error('Workflow not found')

  const currentNode = workflow.nodes.find(n => n.id === task.currentNode)
  if (!currentNode) {
    return await failExecution(execution, `Current node "${task.currentNode}" missing from workflow`)
  }

  // Cache the outcome on the execution so any downstream Decision (condition)
  // node can route on `conditionField: "lastApprovalOutcome"`.
  execution.variables = execution.variables || {}
  execution.variables.lastApprovalOutcome = outcome
  if (execution.variables.pendingTaskId) {
    delete execution.variables.pendingTaskId
    delete execution.variables.pendingNodeId
  }
  if (Array.isArray(task.attachments) && task.attachments.length > 0) {
    const prior = Array.isArray(execution.variables.documents) ? execution.variables.documents : []
    execution.variables.documents = [
      ...prior,
      ...task.attachments.map((f) => ({
        name: f.name, url: f.url, mime: f.mime, size: f.size,
        step: task.title, nodeId: task.currentNode,
      })),
    ]
  }
  // Carry submitted Submit-node form values forward so later reviewers/approvers
  // can see the structured data (name, account no., e-signature, …), not just files.
  // Also merge into variables.formData so Integration nodes can use {{formData.x}}.
  if (task.formData && typeof task.formData === 'object' && Object.keys(task.formData).length > 0) {
    const priorForms = Array.isArray(execution.variables.forms) ? execution.variables.forms : []
    execution.variables.forms = [
      ...priorForms,
      {
        step: task.title,
        nodeId: task.currentNode,
        fields: Array.isArray(task.formFields) ? task.formFields : [],
        data: task.formData,
      },
    ]
    execution.variables.formData = {
      ...(execution.variables.formData && typeof execution.variables.formData === 'object'
        ? execution.variables.formData
        : {}),
      ...task.formData
    }
  }
  execution.markModified('variables')

  await updateNodeLog(execution, task.currentNode, 'completed', { outcome })

  // Review (viewer) node: the reviewer's choice routes directly to one of the
  // node's two branch targets — 'changes' goes back (e.g. to the submit step),
  // anything else ('forward') continues. No approve/reject semantics.
  if (currentNode.type === 'review') {
    const target = outcome === 'changes'
      ? currentNode.config?.changesPath
      : currentNode.config?.forwardPath
    if (!target) {
      return await failExecution(
        execution,
        `Review node "${task.currentNode}" has no ${outcome === 'changes' ? 'changes' : 'forward'} path configured`
      )
    }
    return await processNode(execution, target, workflow)
  }

  // A rejection only terminates the workflow if there's no Decision node
  // downstream to handle it. If the next node is a condition, we let it
  // branch (so the designer can build "approve goes here / reject goes there"
  // flows). Otherwise rejection ends the execution like before.
  const nextNode = currentNode.nextNode
    ? workflow.nodes.find(n => n.id === currentNode.nextNode)
    : null

  if (outcome === 'rejected' && (!nextNode || nextNode.type !== 'condition')) {
    return await failExecution(execution, `Rejected at node ${task.currentNode}`)
  }

  return await processNode(execution, currentNode.nextNode, workflow)
}

module.exports = { triggerWorkflow, advanceWorkflow, processNode, previewApprovalRoute, isUserOOO }
