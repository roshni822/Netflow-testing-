// Shell 3 (Business Ops) - utils/team.js
// Who a leader is responsible for, and therefore how far their authority runs.
//
// Until now "leader" was a flat check: routes/tasks.js let any Admin, CEO or
// Manager view, approve or delete ANY request in the tenant, while HR and VP —
// the same seniority — could only touch what was assigned to them. That is both
// too wide and inconsistent: a Manager in Sales had no business overriding an
// approval in Legal.
//
// The rule here is the org chart, not the role name:
//   Admin, CEO   org-wide. Admin operates the workspace; the CEO sits at the top
//                of every reporting line, so "their team" is everyone anyway.
//   Manager, HR  their own people — everyone below them on the managerId chain,
//   VP           plus anyone who names them as HR partner.
//   everyone     themselves only.
//
// "Below them" is transitive: a VP reaches their managers' reports too, which is
// what makes a VP's inbox useful without giving them the whole tenant.

const User = require('../models/User')
const { hasCapability } = require('./roleCapabilities')

// Roles whose remit is the entire workspace, so no graph walk is needed.
const ORG_WIDE_ROLES = ['Admin', 'CEO']

// Roles that lead people but only see their own branch of the chart.
const TEAM_ROLES = ['Manager', 'HR', 'VP']

// Guards against a managerId cycle (A reports to B reports to A) turning the
// walk into an infinite loop, and keeps the query count bounded.
const MAX_DEPTH = 6

const roleOf = (user) => user?.role?.name || null

const hasOrgWideReach = (user) => ORG_WIDE_ROLES.includes(roleOf(user))
const leadsATeam = (user) =>
  TEAM_ROLES.includes(roleOf(user)) || hasCapability(user, 'decide_tasks')

// 'org' | 'team' | 'self' — how far this user can see beyond their own records.
const reachOf = (user) => {
  if (hasOrgWideReach(user)) return 'org'
  if (leadsATeam(user)) return 'team'
  return 'self'
}

// Every person below `userId` on the reporting chain, plus anyone who names
// them as their HR partner. Returns a Set of id strings, never including the
// leader themself. Tenant scoping comes from the ambient org context, so this
// can only ever return people in the caller's own workspace.
const teamMemberIds = async (userId) => {
  const rootId = String(userId)
  const found = new Set()

  let frontier = [userId]
  for (let depth = 0; depth < MAX_DEPTH && frontier.length; depth++) {
    const rows = await User.find({
      $or: [{ managerId: { $in: frontier } }, ...(depth === 0 ? [{ hrId: userId }] : [])]
    })
      .select('_id')
      .lean()

    const next = []
    for (const row of rows) {
      const id = String(row._id)
      if (id === rootId || found.has(id)) continue
      found.add(id)
      next.push(row._id)
    }
    frontier = next
  }

  return found
}

// The ids a user may see records for, including their own. `null` means "no
// restriction" — the caller's remit is the whole workspace, so a query filter
// would only slow things down.
const visibleUserIds = async (user) => {
  if (hasOrgWideReach(user)) return null
  const ids = leadsATeam(user) ? await teamMemberIds(user._id) : new Set()
  ids.add(String(user._id))
  return ids
}

// Can this user act on a record that belongs to `targetIds` (submitter,
// assignee, …)? Org-wide roles always can; a leader can when any of the people
// involved is one of theirs.
const canReach = async (user, targetIds = []) => {
  if (hasOrgWideReach(user)) return true
  if (!leadsATeam(user)) return false

  const wanted = targetIds.filter(Boolean).map(String)
  if (!wanted.length) return false

  const team = await teamMemberIds(user._id)
  return wanted.some((id) => team.has(id))
}

module.exports = {
  ORG_WIDE_ROLES,
  TEAM_ROLES,
  hasOrgWideReach,
  leadsATeam,
  reachOf,
  teamMemberIds,
  visibleUserIds,
  canReach
}
