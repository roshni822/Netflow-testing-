// M3 - Phase 2 - routes/auditLogs.js
// Server-side query for the Audit Log Viewer. Supports search + action +
// department + date range, with manual skip/limit pagination.

const express = require('express')

const AuditLog = require('../models/AuditLog')
const { protect } = require('../middleware/auth')
const { requireCapability } = require('../middleware/capabilityGuard')
const { sendSuccess } = require('../utils/apiResponse')

const router = express.Router()

const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const parseDayBoundary = (input, end = false) => {
  if (!input) return null
  const d = new Date(input)
  if (isNaN(d.getTime())) return null
  if (end) d.setUTCHours(23, 59, 59, 999)
  else d.setUTCHours(0, 0, 0, 0)
  return d
}

// Outcome buckets for the audit status cards (same filters as the list, minus
// a single-action filter so the overview stays useful while drilling in).
const SUCCESS_ACTIONS = ['task_approved', 'workflow_completed', 'org_activated']
const REJECTED_ACTIONS = ['task_rejected', 'request_changes']
const ALERT_ACTIONS = [
  'workflow_failed',
  'task_escalated',
  'org_licence_expired',
  'org_limit_reached',
  'org_suspended',
  'org_deleted',
  'user_deleted',
  'form_deleted',
  'workflow_deleted'
]

const STATUS_BUCKETS = {
  success: SUCCESS_ACTIONS,
  rejected: REJECTED_ACTIONS,
  alerts: ALERT_ACTIONS
}

function buildListQuery({ search, action, actions, status, department, from, to }) {
  const query = {}
  if (action) {
    query.action = action
  } else if (actions) {
    const actionList = String(actions).split(',').map((value) => value.trim()).filter(Boolean).slice(0, 50)
    if (actionList.length) query.action = { $in: actionList }
  } else if (status && STATUS_BUCKETS[status]) {
    query.action = { $in: STATUS_BUCKETS[status] }
  }
  if (department) query.department = department

  if (search) {
    const regex = new RegExp(escapeRegex(String(search).trim()), 'i')
    query.$or = [
      { targetEntity: regex },
      { detail: regex }
    ]
  }

  const fromDate = parseDayBoundary(from, false)
  const toDate = parseDayBoundary(to, true)
  if (fromDate || toDate) {
    query.createdAt = {}
    if (fromDate) query.createdAt.$gte = fromDate
    if (toDate) query.createdAt.$lte = toDate
  }
  return query
}

async function summariseActions(baseQuery) {
  const rows = await AuditLog.aggregate([
    { $match: baseQuery },
    { $group: { _id: '$action', count: { $sum: 1 } } }
  ])
  const byAction = Object.fromEntries(rows.map((r) => [r._id, r.count]))
  const sum = (keys) => keys.reduce((n, k) => n + (byAction[k] || 0), 0)
  const total = rows.reduce((n, r) => n + r.count, 0)
  return {
    total,
    success: sum(SUCCESS_ACTIONS),
    rejected: sum(REJECTED_ACTIONS),
    alerts: sum(ALERT_ACTIONS)
  }
}

// GET /api/audit-logs
router.get(
  '/',
  protect,
  requireCapability('view_audit'),
  async (req, res, next) => {
    try {
      const { search, action, actions, status, department, from, to } = req.query
      const page = Math.max(1, parseInt(req.query.page) || 1)
      const limit = Math.min(200, Math.max(1, parseInt(req.query.limit) || 10))

      const query = buildListQuery({ search, action, actions, status, department, from, to })
      // Status cards ignore action/status drill-down so totals stay comparable.
      const summaryQuery = buildListQuery({ search, actions, department, from, to })

      const [total, logs, summary] = await Promise.all([
        AuditLog.countDocuments(query),
        AuditLog.find(query)
          .populate({
            path: 'performedBy',
            select: 'name email department',
            populate: { path: 'role', select: 'name' }
          })
          .sort({ createdAt: -1 })
          .skip((page - 1) * limit)
          .limit(limit)
          .lean(),
        summariseActions(summaryQuery)
      ])

      return sendSuccess(res, {
        total,
        page,
        totalPages: Math.ceil(total / limit) || 1,
        count: logs.length,
        logs,
        summary
      })
    } catch (err) {
      next(err)
    }
  }
)

module.exports = router
