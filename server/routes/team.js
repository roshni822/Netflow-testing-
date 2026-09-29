// Shell 3 (Business Ops) - routes/team.js
//   GET /api/team   leaders — the people they are responsible for, with what
//                   each of them is currently waiting on
//
// A leader's question is never "who exists here?" — Users answers that, and it
// is an Admin screen anyway. It is "who on my side is stuck?". So every row
// carries live counts: what is sitting in that person's queue, what they have
// raised that is still moving, and what has already blown its due date.

const express = require('express')

const User = require('../models/User')
const Task = require('../models/Task')
const { protect } = require('../middleware/auth')
const { requireCapability } = require('../middleware/capabilityGuard')
const { sendSuccess } = require('../utils/apiResponse')
const { reachOf, teamMemberIds, hasOrgWideReach } = require('../utils/team')
// Same test the engine uses when it redirects a task, so the chip on this page
// and where the work actually goes can never disagree.
const { isUserOOO } = require('../utils/workflowEngine')

const router = express.Router()

// Anyone whose remit includes other people. Employees and Viewers have no team,
// and the nav never offers them the page.
// A workspace roster is not a report: past a few hundred people this page stops
// being useful and the org chart is the right tool. Cap rather than paginate.
const MAX_MEMBERS = 500

const OPEN_STATUSES = ['pending', 'escalated']

// GET /api/team
router.get('/', protect, requireCapability('decide_tasks'), async (req, res, next) => {
  try {
    const me = req.user._id
    const reach = reachOf(req.user)

    // Admin and the CEO answer for the whole workspace, so their "team" is
    // everyone; a leader gets their own branch of the reporting chart.
    const filter = hasOrgWideReach(req.user)
      ? { _id: { $ne: me } }
      : { _id: { $in: [...(await teamMemberIds(me))] } }

    const members = await User.find({ ...filter, isActive: { $ne: false } })
      .select('name email department managerId hrId outOfOffice')
      .populate('role', 'name')
      .sort({ name: 1 })
      .limit(MAX_MEMBERS)
      .lean()

    if (!members.length) {
      return sendSuccess(res, { reach, members: [], totals: emptyTotals() })
    }

    const ids = members.map((m) => m._id)
    const now = new Date()

    const [queues, raised] = await Promise.all([
      Task.aggregate([
        { $match: { assignedTo: { $in: ids }, status: { $in: OPEN_STATUSES } } },
        {
          $group: {
            _id: '$assignedTo',
            pending: { $sum: 1 },
            // $ifNull, not $ne: a task with no dueDate at all resolves to
            // "missing", which sorts below a Date and would count as overdue.
            overdue: { $sum: { $cond: [{ $and: [{ $ifNull: ['$dueDate', false] }, { $lt: ['$dueDate', now] }] }, 1, 0] } }
          }
        }
      ]),
      Task.aggregate([
        { $match: { submittedBy: { $in: ids }, status: { $in: OPEN_STATUSES } } },
        { $group: { _id: '$submittedBy', open: { $sum: 1 } } }
      ])
    ])

    const queueBy = new Map(queues.map((q) => [String(q._id), q]))
    const raisedBy = new Map(raised.map((r) => [String(r._id), r]))

    const rows = members.map((m) => {
      const q = queueBy.get(String(m._id)) || { pending: 0, overdue: 0 }
      const r = raisedBy.get(String(m._id)) || { open: 0 }
      return {
        _id: m._id,
        name: m.name,
        email: m.email,
        department: m.department,
        role: m.role?.name || null,
        // How this person lands in your list — a direct report reads differently
        // from someone two levels down or an HR-partner assignment.
        relation: relationTo(m, me),
        outOfOffice: isUserOOO(m, now) ? { until: m.outOfOffice?.until || null } : null,
        pendingApprovals: q.pending,
        overdue: q.overdue,
        openRequests: r.open
      }
    })

    return sendSuccess(res, {
      reach,
      members: rows,
      totals: {
        members: rows.length,
        pendingApprovals: rows.reduce((s, r) => s + r.pendingApprovals, 0),
        openRequests: rows.reduce((s, r) => s + r.openRequests, 0),
        overdue: rows.reduce((s, r) => s + r.overdue, 0)
      }
    })
  } catch (err) {
    next(err)
  }
})

const relationTo = (member, meId) => {
  if (String(member.managerId || '') === String(meId)) return 'report'
  if (String(member.hrId || '') === String(meId)) return 'hr'
  return 'indirect'
}

const emptyTotals = () => ({ members: 0, pendingApprovals: 0, openRequests: 0, overdue: 0 })

module.exports = router
