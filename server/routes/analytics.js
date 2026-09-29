// M3 - Phase 2 - routes/analytics.js
// Read-only aggregate views: summary, completion-time, sla-breaches,
// approval-rate, department-kpis. All protected for Manager+ roles.

const express = require('express')
const { asId } = require('../database/ids')

const Task = require('../models/Task')
const Form = require('../models/Form')
const FormResponse = require('../models/FormResponse')
const Workflow = require('../models/Workflow')
const WorkflowExecution = require('../models/WorkflowExecution')
const User = require('../models/User')
const { protect } = require('../middleware/auth')
const { requireCapability } = require('../middleware/capabilityGuard')
const { sendError, sendSuccess } = require('../utils/apiResponse')
const { visibleUserIds, reachOf } = require('../utils/team')

const router = express.Router()

// Reporting is a leader capability, so the whole router is guarded rather than
// route by route. summary / completion-time / approval-rate / activity used to
// be open to any signed-in user "because the dashboard needs them" — but only
// the Admin's builder dashboard calls them, and leaving them open let an
// Employee read workspace-wide figures the Reports nav never offers them.
router.use(protect, requireCapability('view_analytics'))

const STATUS_COLOR = {
  approved: '#22c55e',
  rejected: '#ef4444',
  escalated: '#f97316',
  pending: '#94a3b8',
  completed: '#0ea5e9'
}
const STATUS_LABEL = {
  approved: 'Approved',
  rejected: 'Rejected',
  escalated: 'Escalated',
  pending: 'Pending',
  completed: 'Completed'
}

const parseBoundary = (input, end = false) => {
  if (!input) return null
  const d = new Date(input)
  if (isNaN(d.getTime())) return null
  if (end) d.setUTCHours(23, 59, 59, 999)
  else d.setUTCHours(0, 0, 0, 0)
  return d
}

const buildDateFilter = (req) => {
  const fromDate = parseBoundary(req.query.from, false)
  const toDate = parseBoundary(req.query.to, true)
  const filter = {}
  if (fromDate || toDate) {
    filter.createdAt = {}
    if (fromDate) filter.createdAt.$gte = fromDate
    if (toDate) filter.createdAt.$lte = toDate
  }
  return filter
}

const parseExactRange = (req, maxDays = 90) => {
  const from = String(req.query.from || '').trim()
  const to = String(req.query.to || '').trim()
  const requested = Boolean(from || to)
  if (!requested) return { requested: false }

  const isIsoDay = (value) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
    const parsed = new Date(`${value}T00:00:00.000Z`)
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
  }
  if (!isIsoDay(from) || !isIsoDay(to) || from > to) {
    return { requested: true, error: 'INVALID_DATE_RANGE' }
  }

  const start = new Date(`${from}T00:00:00.000Z`)
  const afterEnd = new Date(`${to}T00:00:00.000Z`)
  afterEnd.setUTCDate(afterEnd.getUTCDate() + 1)
  const days = Math.round((afterEnd - start) / 86400000)
  if (days > maxDays) return { requested: true, error: 'DATE_RANGE_TOO_LARGE' }
  return { requested: true, from, to, start, afterEnd, days }
}

const effectiveTaskEnd = (snapshotAt) => ({
  $cond: [
    { $in: ['$status', ['pending', 'escalated']] },
    snapshotAt,
    '$updatedAt'
  ]
})

// Reports answer to the same reporting line as the inbox: Admin and the CEO
// read the whole workspace, a Manager/HR/VP reads the people who report to them
// (plus their own records), and ?department= narrows further within that.
//
// Both models carry the person who started the request — Task.submittedBy and
// WorkflowExecution.triggeredBy — so one id set filters every metric on the
// page. `{}` means no restriction.
const buildScope = async (req) => {
  const reach = reachOf(req.user)
  let ids = await visibleUserIds(req.user)   // null = org-wide

  const department = String(req.query.department || '').trim()
  if (department) {
    const inDept = await User.find({ department }).select('_id').lean()
    const deptIds = inDept.map((u) => String(u._id))
    ids = ids ? deptIds.filter((id) => ids.has(id)) : deptIds
  }

  if (!ids) return { reach, department: null, task: {}, exec: {}, response: {} }

  // Aggregation pipelines get no schema casting, so hex strings would silently
  // match nothing. Query helpers cast for themselves but accept these too.
  const list = [...ids].map((id) => asId(String(id)))
  return {
    reach,
    department: department || null,
    task: { submittedBy: { $in: list } },
    exec: { triggeredBy: { $in: list } },
    response: { submittedBy: { $in: list } }
  }
}

// GET /api/analytics/summary
router.get('/summary', async (req, res, next) => {
  try {
    const dateFilter = buildDateFilter(req)
    const scope = await buildScope(req)
    const execFilter = { ...dateFilter, ...scope.exec }
    const taskFilter = { ...dateFilter, ...scope.task }

    const SLA_MS = 7 * 24 * 60 * 60 * 1000 // 7-day SLA window in milliseconds

    const responseFilter = { ...dateFilter, ...scope.response }

    const [
      totalExecutions,
      runningExecutions,
      completedExecutions,
      pausedExecutions,
      pendingTasks,
      totalForms,
      totalWorkflows,
      totalSubmissions,
      approvalAgg,
      slaAgg
    ] = await Promise.all([
      WorkflowExecution.countDocuments(execFilter),
      WorkflowExecution.countDocuments({ ...execFilter, status: 'running' }),
      WorkflowExecution.countDocuments({ ...execFilter, status: 'completed' }),
      WorkflowExecution.countDocuments({ ...execFilter, status: 'paused' }),
      Task.countDocuments({ ...taskFilter, status: 'pending' }),
      Form.countDocuments(),
      Workflow.countDocuments({}),
      FormResponse.countDocuments(responseFilter),
      Task.aggregate([
        {
          $match: {
            ...taskFilter,
            status: { $in: ['approved', 'rejected'] }
          }
        },
        { $group: { _id: '$status', count: { $sum: 1 } } }
      ]),
      // SLA compliance: % of completed executions finished within 7 days
      WorkflowExecution.aggregate([
        {
          $match: {
            ...execFilter,
            status: 'completed',
            completedAt: { $exists: true, $ne: null }
          }
        },
        {
          $project: {
            withinSla: {
              $lte: [{ $subtract: ['$completedAt', '$startedAt'] }, SLA_MS]
            }
          }
        },
        {
          $group: {
            _id: null,
            total:     { $sum: 1 },
            withinSla: { $sum: { $cond: ['$withinSla', 1, 0] } }
          }
        }
      ])
    ])

    let approved = 0
    let rejected = 0
    for (const row of approvalAgg) {
      if (row._id === 'approved') approved = row.count
      if (row._id === 'rejected') rejected = row.count
    }
    const decisionTotal = approved + rejected
    const approvalRate = decisionTotal > 0
      ? Math.round((approved / decisionTotal) * 100)
      : 0

    const slaRow = slaAgg[0]
    const slaCompliance = slaRow && slaRow.total > 0
      ? Math.round((slaRow.withinSla / slaRow.total) * 100)
      : null

    return sendSuccess(res, {
      // What the numbers below cover, so the page can say so out loud rather
      // than letting a Manager read their own slice as an org-wide total.
      scope: { reach: scope.reach, department: scope.department },
      summary: {
        // Catalogue counts: forms and workflows are shared across the workspace,
        // so these stay org-wide even for a scoped leader.
        totalWorkflows,
        totalExecutions,
        runningExecutions,
        completedExecutions,
        pausedExecutions,
        pendingTasks,
        totalForms,
        totalSubmissions,
        approvedTasks: approved,
        rejectedTasks: rejected,
        approvalRate,
        slaCompliance
      }
    })
  } catch (err) {
    next(err)
  }
})

// GET /api/analytics/completion-time
router.get('/completion-time', async (req, res, next) => {
  try {
    const months = Math.min(24, Math.max(1, parseInt(req.query.months) || 6))
    const cutoff = new Date()
    cutoff.setUTCMonth(cutoff.getUTCMonth() - months)
    cutoff.setUTCDate(1)
    cutoff.setUTCHours(0, 0, 0, 0)

    const scope = await buildScope(req)
    const rows = await WorkflowExecution.aggregate([
      {
        $match: {
          ...scope.exec,
          status: 'completed',
          completedAt: { $ne: null },
          createdAt: { $gte: cutoff }
        }
      },
      {
        $group: {
          _id: {
            year: { $year: '$createdAt' },
            month: { $month: '$createdAt' }
          },
          avgMs: { $avg: { $subtract: ['$completedAt', '$createdAt'] } },
          totalCompleted: { $sum: 1 }
        }
      },
      { $sort: { '_id.year': 1, '_id.month': 1 } }
    ])

    const result = rows.map(r => ({
      year: r._id.year,
      month: r._id.month,
      label: `${r._id.year}-${String(r._id.month).padStart(2, '0')}`,
      avgDays: Number(((r.avgMs || 0) / 86400000).toFixed(2)),
      totalCompleted: r.totalCompleted
    }))

    return sendSuccess(res, { series: result })
  } catch (err) {
    next(err)
  }
})

// GET /api/analytics/sla-breaches
router.get('/sla-breaches', async (req, res, next) => {
  try {
    const exactRange = parseExactRange(req)
    if (exactRange.error === 'INVALID_DATE_RANGE') {
      return sendError(res, 'Choose a valid From and Till date.', exactRange.error, 400)
    }
    if (exactRange.error === 'DATE_RANGE_TOO_LARGE') {
      return sendError(res, 'SLA ranges can cover at most 90 days.', exactRange.error, 400)
    }

    let createdAt
    if (exactRange.requested) {
      createdAt = { $gte: exactRange.start, $lt: exactRange.afterEnd }
    } else {
      const weeks = Math.min(52, Math.max(1, parseInt(req.query.weeks) || 8))
      const cutoff = new Date()
      cutoff.setUTCDate(cutoff.getUTCDate() - weeks * 7)
      cutoff.setUTCHours(0, 0, 0, 0)
      createdAt = { $gte: cutoff }
    }

    const scope = await buildScope(req)
    const snapshotAt = new Date()
    const rows = await Task.aggregate([
      {
        $match: {
          ...scope.task,
          createdAt,
          dueDate: { $ne: null },
          $expr: { $gt: [effectiveTaskEnd(snapshotAt), '$dueDate'] }
        }
      },
      {
        $group: {
          _id: {
            year: { $isoWeekYear: '$createdAt' },
            week: { $isoWeek: '$createdAt' }
          },
          breaches: { $sum: 1 }
        }
      },
      { $sort: { '_id.year': 1, '_id.week': 1 } }
    ])

    const result = rows.map(r => ({
      year: r._id.year,
      week: r._id.week,
      label: `${r._id.year}-W${String(r._id.week).padStart(2, '0')}`,
      breaches: r.breaches
    }))

    return sendSuccess(res, {
      series: result,
      asOf: snapshotAt.toISOString(),
      ...(exactRange.requested ? { range: { from: exactRange.from, to: exactRange.to } } : {})
    })
  } catch (err) {
    next(err)
  }
})

// GET /api/analytics/approval-rate
router.get('/approval-rate', async (req, res, next) => {
  try {
    const dateFilter = buildDateFilter(req)
    const scope = await buildScope(req)
    const rows = await Task.aggregate([
      { $match: { ...dateFilter, ...scope.task } },
      { $group: { _id: '$status', count: { $sum: 1 } } }
    ])

    const result = rows.map(r => ({
      status: r._id,
      label: STATUS_LABEL[r._id] || r._id,
      count: r.count,
      color: STATUS_COLOR[r._id] || '#64748b'
    }))

    return sendSuccess(res, { distribution: result })
  } catch (err) {
    next(err)
  }
})

// GET /api/analytics/activity?days=7|30|90 or ?from=YYYY-MM-DD&to=YYYY-MM-DD
// Returns per-day counts of completed / running / paused executions for the
// chart. Every day in the requested window is included (zeros filled in so
// the chart always renders a full, contiguous series).
//
// Exact ranges use UTC calendar boundaries, matching summary, department and
// audit filters. They count each execution once, by creation date. The legacy
// ?days view retains IST buckets and its real-time active-work overlay.
router.get('/activity', async (req, res, next) => {
  try {
    const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000 // UTC+5:30

    const nowUtc = Date.now()
    const nowIst = new Date(nowUtc + IST_OFFSET_MS)
    const todayIst = nowIst.toISOString().slice(0, 10)
    const requestedFrom = String(req.query.from || '').trim()
    const requestedTo = String(req.query.to || '').trim()
    const hasExactRange = Boolean(requestedFrom || requestedTo)
    const isIsoDay = (value) => {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
      const parsed = new Date(`${value}T00:00:00.000Z`)
      return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
    }

    let fromKey
    let toKey
    let days
    if (hasExactRange) {
      if (!isIsoDay(requestedFrom) || !isIsoDay(requestedTo) || requestedFrom > requestedTo) {
        return sendError(res, 'Choose a valid From and Till date.', 'INVALID_DATE_RANGE', 400)
      }
      days = Math.floor((new Date(`${requestedTo}T00:00:00.000Z`) - new Date(`${requestedFrom}T00:00:00.000Z`)) / 86400000) + 1
      if (days > 90) {
        return sendError(res, 'Activity ranges can cover at most 90 days.', 'DATE_RANGE_TOO_LARGE', 400)
      }
      fromKey = requestedFrom
      toKey = requestedTo
    } else {
      days = Math.min(90, Math.max(1, parseInt(req.query.days) || 7))
      toKey = todayIst
      const startDay = new Date(`${toKey}T00:00:00.000Z`)
      startDay.setUTCDate(startDay.getUTCDate() - days + 1)
      fromKey = startDay.toISOString().slice(0, 10)
    }

    const timezone = hasExactRange ? 'UTC' : 'Asia/Kolkata'
    const offset = hasExactRange ? 'Z' : '+05:30'
    const fromUtc = new Date(`${fromKey}T00:00:00${offset}`)
    const afterToUtc = new Date(`${toKey}T00:00:00${offset}`)
    afterToUtc.setUTCDate(afterToUtc.getUTCDate() + 1)
    const includeLiveOverlay = !hasExactRange && fromKey <= todayIst && toKey >= todayIst

    const scope = await buildScope(req)

    // Aggregate only executions created inside the selected boundaries.
    const [rows, liveRunning, livePaused] = await Promise.all([
      WorkflowExecution.aggregate([
        { $match: { ...scope.exec, createdAt: { $gte: fromUtc, $lt: afterToUtc } } },
        {
          $group: {
            _id: {
              day:    { $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone } },
              status: '$status'
            },
            count: { $sum: 1 }
          }
        },
        { $sort: { '_id.day': 1 } }
      ]),
      // Real-time counts for currently active executions (any start date)
      includeLiveOverlay ? WorkflowExecution.countDocuments({ ...scope.exec, status: 'running' }) : Promise.resolve(0),
      includeLiveOverlay ? WorkflowExecution.countDocuments({ ...scope.exec, status: 'paused' }) : Promise.resolve(0),
    ])

    // Fill every calendar day, including days without activity.
    const dayMap = new Map()
    const cursor = new Date(`${fromKey}T00:00:00.000Z`)
    for (let i = 0; i < days; i++) {
      const d = new Date(cursor)
      d.setUTCDate(d.getUTCDate() + i)
      const key = d.toISOString().slice(0, 10)
      dayMap.set(key, { isoDate: key, completed: 0, inProgress: 0, onHold: 0, failed: 0, ...(hasExactRange ? { cancelled: 0 } : {}) })
    }

    // Fill in historical counts from the aggregation.
    for (const row of rows) {
      const { day, status } = row._id
      const entry = dayMap.get(day)
      if (!entry) continue
      if (status === 'completed')    entry.completed  += row.count
      else if (status === 'running') entry.inProgress += row.count
      else if (status === 'paused')  entry.onHold     += row.count
      else if (status === 'failed')  entry.failed     += row.count
      else if (status === 'cancelled' && hasExactRange) entry.cancelled += row.count
    }

    // Overwrite today's live values with real-time counts so executions that
    // started before the window still appear on today's bar.
    const todayEntry = dayMap.get(todayIst)
    if (todayEntry && includeLiveOverlay) {
      todayEntry.inProgress = Math.max(todayEntry.inProgress, liveRunning)
      todayEntry.onHold     = Math.max(todayEntry.onHold,     livePaused)
    }

    return sendSuccess(res, { series: [...dayMap.values()] })
  } catch (err) {
    next(err)
  }
})

// GET /api/analytics/workflow-control-tower?from=YYYY-MM-DD&to=YYYY-MM-DD&limit=6
//
// The control tower deliberately combines two time models and names them in
// the response: workload is a live snapshot (so old, unfinished work cannot
// disappear when the dashboard range changes), while failures and completion
// performance belong to the selected reporting period.
router.get('/workflow-control-tower', async (req, res, next) => {
  try {
    const requestedRange = parseExactRange(req)
    if (requestedRange.error === 'INVALID_DATE_RANGE') {
      return sendError(res, 'Choose a valid From and Till date.', 'INVALID_DATE_RANGE', 400)
    }
    if (requestedRange.error === 'DATE_RANGE_TOO_LARGE') {
      return sendError(res, 'Activity ranges can cover at most 90 days.', 'DATE_RANGE_TOO_LARGE', 400)
    }

    let range = requestedRange
    if (!range.requested) {
      const afterEnd = new Date()
      afterEnd.setUTCHours(0, 0, 0, 0)
      afterEnd.setUTCDate(afterEnd.getUTCDate() + 1)
      const start = new Date(afterEnd)
      start.setUTCDate(start.getUTCDate() - 30)
      range = {
        requested: false,
        start,
        afterEnd,
        from: start.toISOString().slice(0, 10),
        to: new Date(afterEnd.getTime() - 1).toISOString().slice(0, 10),
        days: 30,
      }
    }

    const parsedLimit = Number.parseInt(req.query.limit, 10)
    const limit = Number.isFinite(parsedLimit) ? Math.min(6, Math.max(1, parsedLimit)) : 6
    const snapshotAt = new Date()
    const scope = await buildScope(req)
    const periodFilter = { createdAt: { $gte: range.start, $lt: range.afterEnd } }

    const [executionResult, taskRows] = await Promise.all([
      WorkflowExecution.aggregate([
        {
          $facet: {
            live: [
              { $match: { ...scope.exec, status: { $in: ['running', 'paused'] } } },
              { $group: { _id: '$workflowId', openRequests: { $sum: 1 } } },
            ],
            period: [
              { $match: { ...scope.exec, ...periodFilter } },
              {
                $group: {
                  _id: '$workflowId',
                  completedRuns: { $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] } },
                  failedRuns: { $sum: { $cond: [{ $eq: ['$status', 'failed'] }, 1, 0] } },
                  cancelledRuns: { $sum: { $cond: [{ $eq: ['$status', 'cancelled'] }, 1, 0] } },
                }
              },
            ],
            last: [
              { $match: { ...scope.exec } },
              { $group: { _id: '$workflowId', lastRunAt: { $max: '$createdAt' } } },
            ],
            durations: [
              {
                $match: {
                  ...scope.exec,
                  ...periodFilter,
                  status: 'completed',
                  startedAt: { $exists: true, $ne: null },
                  completedAt: { $exists: true, $ne: null },
                }
              },
              { $project: { _id: 0, durationMs: { $subtract: ['$completedAt', '$startedAt'] } } },
              { $match: { durationMs: { $gte: 0 } } },
            ],
          }
        }
      ]),
      Task.aggregate([
        {
          $match: {
            ...scope.task,
            workflowId: { $ne: null },
            status: { $in: ['pending', 'escalated'] },
          }
        },
        {
          $group: {
            _id: '$workflowId',
            pendingTasks: { $sum: 1 },
            overdueTasks: {
              $sum: {
                $cond: [
                  { $and: [{ $ne: ['$dueDate', null] }, { $lt: ['$dueDate', snapshotAt] }] },
                  1,
                  0,
                ]
              }
            },
          }
        },
      ]),
    ])

    const facets = executionResult[0] || { live: [], period: [], last: [], durations: [] }
    const mapRows = (rows) => new Map(rows.map((row) => [String(row._id), row]))
    const liveByWorkflow = mapRows(facets.live || [])
    const periodByWorkflow = mapRows(facets.period || [])
    const lastByWorkflow = mapRows(facets.last || [])
    const tasksByWorkflow = mapRows(taskRows)
    const metricIds = new Set([
      ...liveByWorkflow.keys(),
      ...periodByWorkflow.keys(),
      ...lastByWorkflow.keys(),
      ...tasksByWorkflow.keys(),
    ].filter((id) => id && id !== 'null'))

    const workflowFilter = scope.reach === 'org'
      ? {}
      : { _id: { $in: [...metricIds].map((id) => asId(id)) } }
    const [workflowDocs, totalWorkflows] = await Promise.all([
      Workflow.find(workflowFilter).select('_id title status').lean(),
      Workflow.countDocuments(workflowFilter),
    ])

    const workflows = workflowDocs.map((workflow) => {
      const id = String(workflow._id)
      const live = liveByWorkflow.get(id) || {}
      const period = periodByWorkflow.get(id) || {}
      const tasks = tasksByWorkflow.get(id) || {}
      const last = lastByWorkflow.get(id) || {}
      const completedRuns = Number(period.completedRuns || 0)
      const failedRuns = Number(period.failedRuns || 0)
      const cancelledRuns = Number(period.cancelledRuns || 0)
      const terminalRuns = completedRuns + failedRuns + cancelledRuns
      return {
        workflowId: workflow._id,
        title: workflow.title,
        status: workflow.status,
        openRequests: Number(live.openRequests || 0),
        pendingTasks: Number(tasks.pendingTasks || 0),
        overdueTasks: Number(tasks.overdueTasks || 0),
        completedRuns,
        failedRuns,
        cancelledRuns,
        terminalRuns,
        completionRate: terminalRuns > 0 ? Math.round((completedRuns / terminalRuns) * 1000) / 10 : null,
        lastRunAt: last.lastRunAt || null,
      }
    }).sort((left, right) =>
      right.overdueTasks - left.overdueTasks ||
      right.failedRuns - left.failedRuns ||
      right.pendingTasks - left.pendingTasks ||
      right.openRequests - left.openRequests ||
      (right.lastRunAt ? new Date(right.lastRunAt).getTime() : 0) - (left.lastRunAt ? new Date(left.lastRunAt).getTime() : 0) ||
      String(left.title || '').localeCompare(String(right.title || ''))
    )

    const durations = (facets.durations || [])
      .map((row) => Number(row.durationMs))
      .filter((duration) => Number.isFinite(duration) && duration >= 0)
      .sort((left, right) => left - right)
    let medianCompletionMs = null
    if (durations.length) {
      const middle = Math.floor(durations.length / 2)
      medianCompletionMs = durations.length % 2
        ? durations[middle]
        : Math.round((durations[middle - 1] + durations[middle]) / 2)
    }

    return sendSuccess(res, {
      asOf: snapshotAt,
      period: { from: range.from, to: range.to },
      totals: {
        openRequests: [...liveByWorkflow.values()].reduce((sum, row) => sum + Number(row.openRequests || 0), 0),
        overdueTasks: [...tasksByWorkflow.values()].reduce((sum, row) => sum + Number(row.overdueTasks || 0), 0),
        failedRuns: [...periodByWorkflow.values()].reduce((sum, row) => sum + Number(row.failedRuns || 0), 0),
        medianCompletionMs,
      },
      workflows: workflows.slice(0, limit),
      totalWorkflows,
      returnedWorkflows: Math.min(limit, workflows.length),
    })
  } catch (err) {
    next(err)
  }
})

// GET /api/analytics/department-kpis
router.get('/department-kpis', async (req, res, next) => {
  try {
    const dateFilter = buildDateFilter(req)
    const scope = await buildScope(req)
    const snapshotAt = new Date()

    const rows = await Task.aggregate([
      { $match: { ...dateFilter, ...scope.task } },
      {
        $lookup: {
          from: 'users',
          localField: 'submittedBy',
          foreignField: '_id',
          as: 'submitter'
        }
      },
      { $unwind: { path: '$submitter', preserveNullAndEmptyArrays: false } },
      {
        $group: {
          _id: '$submitter.department',
          totalRequests: { $sum: 1 },
          approved: {
            $sum: { $cond: [{ $eq: ['$status', 'approved'] }, 1, 0] }
          },
          rejected: {
            $sum: { $cond: [{ $eq: ['$status', 'rejected'] }, 1, 0] }
          },
          escalated: {
            $sum: { $cond: [{ $eq: ['$status', 'escalated'] }, 1, 0] }
          },
          slaBreaches: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $ifNull: ['$dueDate', false] },
                    { $gt: [effectiveTaskEnd(snapshotAt), '$dueDate'] }
                  ]
                },
                1,
                0
              ]
            }
          },
          avgCompletionMs: {
            $avg: {
              $cond: [
                { $in: ['$status', ['approved', 'rejected', 'completed']] },
                { $subtract: ['$updatedAt', '$createdAt'] },
                null
              ]
            }
          }
        }
      },
      {
        $project: {
          _id: 0,
          department: '$_id',
          totalRequests: 1,
          approved: 1,
          rejected: 1,
          escalated: 1,
          slaBreaches: 1,
          avgCompletionDays: {
            $cond: [
              { $gt: ['$avgCompletionMs', 0] },
              { $round: [{ $divide: ['$avgCompletionMs', 86400000] }, 2] },
              0
            ]
          },
          complianceRate: {
            $cond: [
              { $gt: ['$totalRequests', 0] },
              {
                $round: [
                  {
                    $multiply: [
                      {
                        $divide: [
                          { $subtract: ['$totalRequests', '$slaBreaches'] },
                          '$totalRequests'
                        ]
                      },
                      100
                    ]
                  },
                  1
                ]
              },
              0
            ]
          }
        }
      },
      { $sort: { department: 1 } }
    ])

    return sendSuccess(res, { kpis: rows })
  } catch (err) {
    next(err)
  }
})

module.exports = router
