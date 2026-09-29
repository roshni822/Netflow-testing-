// Licensing Phase 1 - utils/usage.js
// Counting rules for licensed resources, in one place so the quota gate, the
// platform list, the usage API and the reconciliation cron can never disagree
// about what "10 users" means.
//
// Deliberate choices:
//   * Seats are reclaimable — a deactivated user cannot log in, so they do not
//     consume a licensed seat. Same for builders.
//   * Archiving frees a slot. Forms/workflows in 'archived' are read-only
//     history, so counting them would punish tidy tenants.

const User = require('../models/User')
const Form = require('../models/Form')
const Workflow = require('../models/Workflow')

const ACTIVE_USER = { isActive: true }
// Complimentary accounts (e.g. bootstrap admin opted out of seats) must not
// bill against maxUsers / maxBuilders. Missing field = counts (legacy docs).
const SEATED_USER = { countsTowardSeats: { $ne: false } }
const LIVE = { status: { $ne: 'archived' } }

const countUsers = (orgId) => User.countDocuments({ orgId, ...ACTIVE_USER, ...SEATED_USER }).setOptions({ skipOrgScope: true })
const countBuilders = (orgId) => User.countDocuments({ orgId, ...ACTIVE_USER, ...SEATED_USER, canBuild: true }).setOptions({ skipOrgScope: true })
const countForms = (orgId) => Form.countDocuments({ orgId, ...LIVE }).setOptions({ skipOrgScope: true })
const countWorkflows = (orgId) => Workflow.countDocuments({ orgId, ...LIVE }).setOptions({ skipOrgScope: true })

// Everything the usage snapshot needs that is not already a stored counter.
const countsFor = async (orgId) => {
  const [users, builders, forms, workflows] = await Promise.all([
    countUsers(orgId),
    countBuilders(orgId),
    countForms(orgId),
    countWorkflows(orgId)
  ])
  return { users, builders, forms, workflows }
}

// Counts a single resource on demand — the quota gate only ever needs one.
const countResource = (resource, orgId) => {
  switch (resource) {
    case 'users': return countUsers(orgId)
    case 'builders': return countBuilders(orgId)
    case 'forms': return countForms(orgId)
    case 'workflows': return countWorkflows(orgId)
    default: return Promise.resolve(0)
  }
}

module.exports = { countsFor, countResource, countUsers, countBuilders, countForms, countWorkflows }
