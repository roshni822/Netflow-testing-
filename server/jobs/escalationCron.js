// M3 - Phase 2 - jobs/escalationCron.js
// Hourly tick that escalates overdue pending tasks. Uses an atomic
// findOneAndUpdate guard (matched on isEscalated:false) so concurrent cron
// runs can never double-escalate the same task.

const monitor = require('./monitor')

const Task = require('../models/Task')
const User = require('../models/User')
const Role = require('../models/Role')
const { createNotification } = require('../utils/createNotification')
const { writeAuditLog } = require('../utils/writeAuditLog')
const { sendEscalationEmail } = require('../utils/emailService')
const { resolvePref } = require('../utils/notificationPrefs')
const { runWithOrgId } = require('../tenancy/tenantContext')

const findRoleIdByName = async (name) => {
  const role = await Role.findOne({ name }).select('_id').lean()
  return role?._id || null
}

// Resolve the escalation target.
//   Level 0 → Manager in the same department as the assignee
//   Otherwise (or if no manager exists) → any active Admin
//   Last resort → null (we log a warning and skip)
const findEscalationTarget = async (task) => {
  const managerRoleId = await findRoleIdByName('Manager')

  if (managerRoleId && task.escalationLevel === 0 && task.assignedTo?.department) {
    const manager = await User.findOne({
      role: managerRoleId,
      department: task.assignedTo.department,
      isActive: true,
      _id: { $ne: task.assignedTo._id }
    }).lean()
    if (manager) return manager
  }

  const adminRoleId = await findRoleIdByName('Admin')
  if (adminRoleId) {
    const admin = await User.findOne({ role: adminRoleId, isActive: true }).lean()
    if (admin) return admin
  }

  return null
}

// Escalates one overdue task. Runs inside that task's org tenant context so
// target lookups stay within the org and every notification / audit log the
// escalation writes is stamped with the right orgId. Returns true if this
// call performed the escalation.
const escalateTask = async (task, startedAt) => {
  // Atomic: only one cron loop wins the right to escalate this task
  const updated = await Task.findOneAndUpdate(
    { _id: task._id, isEscalated: false },
    {
      $set: { status: 'escalated', isEscalated: true },
      $inc: { escalationLevel: 1 },
      $push: {
        approvalHistory: {
          action: 'escalated',
          performedAt: startedAt,
          comment: 'Auto-escalated by system due to SLA breach'
        }
      }
    },
    { returnDocument: 'after' }
  )

  if (!updated) return false // Another loop already escalated this one

  const target = await findEscalationTarget(task)
  if (!target) {
    console.warn(`escalationCron: no target for task ${task._id}`)
    return false
  }

  const hoursOverdue = Math.max(
    1,
    Math.floor((startedAt - task.dueDate) / 3600000)
  )

  createNotification({
    userId: target._id,
    title: 'Task escalated to you',
    message: `Task "${task.title}" is ${hoursOverdue}hrs overdue and has been escalated to you.`,
    type: 'escalation',
    taskId: task._id,
    triggeredBy: task.submittedBy?._id
  })

  if (target.email && resolvePref(target, 'escalation').email) {
    sendEscalationEmail({
      to: target.email,
      managerName: target.name,
      taskTitle: task.title,
      originalAssignee: task.assignedTo?.name || 'Unknown',
      hoursOverdue
    })
  }

  writeAuditLog({
    action: 'task_escalated',
    performedBy: task.submittedBy?._id || target._id,
    targetEntity: `Task: ${task.title}`,
    department: task.assignedTo?.department,
    detail: `Auto-escalated after ${hoursOverdue} hours overdue`,
    metadata: {
      taskId: task._id,
      escalationLevel: updated.escalationLevel,
      hoursOverdue,
      escalatedTo: target._id,
      escalatedToName: target.name
    }
  })

  try {
    const { emitForTask } = require('../utils/dmsAttachments')
    await emitForTask(updated, {
      type: 'workflow.escalated',
      actor: { name: 'System', email: null },
      detail: `Auto-escalated after ${hoursOverdue} hours overdue`,
      meta: {
        taskId: task._id,
        workflowId: task.workflowId?._id || task.workflowId,
        escalatedTo: target._id,
      },
    })
  } catch (err) {
    console.warn('[dms] escalate event failed', err.message)
  }

  // Workflow-level "Notify admin on SLA breach" oversight ping.
  //   Always            → notify an admin on every breach
  //   After first breach → only from the 2nd escalation onward
  //   Never             → skip
  const notifyPref = task.workflowId?.notifyOnSlaBreach || 'Always'
  const shouldNotifyAdmin =
    notifyPref === 'Always' ||
    (notifyPref === 'After first breach' && updated.escalationLevel >= 2)
  if (shouldNotifyAdmin) {
    const adminRoleId = await findRoleIdByName('Admin')
    const admin = adminRoleId
      ? await User.findOne({ role: adminRoleId, isActive: true }).lean()
      : null
    // Skip if the admin is already the escalation target (avoid a double ping).
    if (admin && String(admin._id) !== String(target._id)) {
      createNotification({
        userId: admin._id,
        title: 'SLA breach alert',
        message: `Task "${task.title}" breached its SLA (${hoursOverdue}hrs overdue) and was escalated to ${target.name}.`,
        type: 'escalation',
        taskId: task._id,
        triggeredBy: task.submittedBy?._id
      })
    }
  }

  return true
}

const runEscalation = async () => {
  const startedAt = new Date()
  try {
    // Platform-wide sweep: deliberately UNSCOPED (no tenant context here), so
    // one cron covers every organization's overdue tasks.
    const overdueTasks = await Task.find({
      status: 'pending',
      dueDate: { $lt: startedAt },
      isEscalated: false
    })
      .populate('assignedTo submittedBy')
      .populate({ path: 'workflowId', select: 'notifyOnSlaBreach title' })

    let escalatedCount = 0

    for (const task of overdueTasks) {
      // Each task is processed inside ITS org's tenant context.
      const escalated = await runWithOrgId(task.orgId, () => escalateTask(task, startedAt))
      if (escalated) escalatedCount++
    }

    console.log(
      `escalationCron @ ${startedAt.toISOString()} — escalated ${escalatedCount} task(s)`
    )
    return { escalatedCount }
  } catch (err) {
    console.error('escalationCron error:', err.message)
    return { error: err.message }
  }
}

const startEscalationCron = () => monitor.schedule('escalation', '0 * * * *', 3600000, runEscalation)

// escalateTask is exported so the automated test suite can exercise the real
// escalation code path against a single, namespaced task inside a tenant
// context — instead of the global runEscalation sweep, which would touch every
// org's overdue tasks on a shared database.
module.exports = { startEscalationCron, runEscalation, escalateTask, findEscalationTarget }
