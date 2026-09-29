// Shell 2 (Org Admin) - routes/departments.js
// The tenant's own team list.
//   GET    /api/departments        any signed-in user — pickers and filters
//   POST   /api/departments        Admin — add a team
//   PUT    /api/departments/:name  Admin — rename, cascading to everything that
//                                  stored the old spelling
//   DELETE /api/departments/:name  Admin — only once nobody is in it
//
// Reads are open to everyone because the department dropdown appears in the
// audit log filter, the workflow visibility picker and the user importer, which
// are not all admin surfaces. Writes are Admin-only.

const express = require('express')

const Organization = require('../models/Organization')
const User = require('../models/User')
const Workflow = require('../models/Workflow')
const { protect } = require('../middleware/auth')
const { requireCapability } = require('../middleware/capabilityGuard')
const { sendSuccess, sendError } = require('../utils/apiResponse')
const { writeAuditLog } = require('../utils/writeAuditLog')
const {
  listFor, canonical, validateName, MAX_DEPARTMENTS
} = require('../utils/departments')

const router = express.Router()

router.use(protect)

// How many people sit in each department right now. Counts are what turn the
// page from a list of strings into something an admin can act on: you cannot
// safely delete or rename a team without knowing who it takes with it.
const memberCounts = async (orgId) => {
  const rows = await User.aggregate([
    { $match: { orgId, isActive: { $ne: false } } },
    { $group: { _id: '$department', count: { $sum: 1 } } }
  ])
  return new Map(rows.map((r) => [String(r._id || ''), r.count]))
}

const listPayload = async (org) => {
  const counts = await memberCounts(org._id)
  const names = listFor(org)
  return {
    departments: names.map((name) => ({ name, members: counts.get(name) || 0 })),
    // Departments on users that are no longer in the org's list — legacy data or
    // a team deleted while somebody still belonged to it. Surfaced so the admin
    // can see and fix it rather than wonder why a filter finds nothing.
    orphans: [...counts.entries()]
      .filter(([name]) => name && !names.some((n) => n.toLowerCase() === name.toLowerCase()))
      .map(([name, members]) => ({ name, members }))
  }
}

const loadOrg = async (req, res) => {
  if (!req.orgId) {
    sendError(res, 'No workspace resolved for this account', 'NO_ORG', 400)
    return null
  }
  const org = await Organization.findById(req.orgId)
  if (!org) {
    sendError(res, 'Workspace not found', 'ORG_NOT_FOUND', 404)
    return null
  }
  return org
}

// GET /api/departments
router.get('/', async (req, res, next) => {
  try {
    const org = await loadOrg(req, res)
    if (!org) return undefined
    return sendSuccess(res, await listPayload(org))
  } catch (err) {
    next(err)
  }
})

// POST /api/departments
router.post('/', requireCapability('manage_users'), async (req, res, next) => {
  try {
    const org = await loadOrg(req, res)
    if (!org) return undefined

    const valid = validateName(req.body?.name)
    if (!valid.ok) return sendError(res, valid.error, valid.code, 400)

    const current = listFor(org)
    if (current.some((d) => d.toLowerCase() === valid.name.toLowerCase())) {
      return sendError(res, `"${valid.name}" already exists`, 'DEPARTMENT_EXISTS', 400)
    }
    if (current.length >= MAX_DEPARTMENTS) {
      return sendError(res, `A workspace can have at most ${MAX_DEPARTMENTS} departments`, 'TOO_MANY_DEPARTMENTS', 400)
    }

    // First write also persists the legacy defaults, so the stored list is
    // complete from here on and no reader has to fall back again.
    org.departments = [...current, valid.name]
    await org.save()

    writeAuditLog({
      action: 'department_created',
      performedBy: req.user._id,
      targetEntity: `Department: ${valid.name}`,
      department: req.user.department,
      ipAddress: req.ip,
      detail: `${req.user.name} created the department "${valid.name}"`
    })

    return sendSuccess(res, await listPayload(org), 201)
  } catch (err) {
    next(err)
  }
})

// PUT /api/departments/:name
router.put('/:name', requireCapability('manage_users'), async (req, res, next) => {
  try {
    const org = await loadOrg(req, res)
    if (!org) return undefined

    const from = canonical(org, req.params.name)
    if (!from) return sendError(res, 'Department not found', 'DEPARTMENT_NOT_FOUND', 404)

    const valid = validateName(req.body?.name)
    if (!valid.ok) return sendError(res, valid.error, valid.code, 400)
    const to = valid.name
    if (to === from) return sendSuccess(res, await listPayload(org))

    const current = listFor(org)
    if (current.some((d) => d.toLowerCase() === to.toLowerCase())) {
      return sendError(res, `"${to}" already exists`, 'DEPARTMENT_EXISTS', 400)
    }

    org.departments = current.map((d) => (d === from ? to : d))
    await org.save()

    // A rename that left members pointing at a name nobody recognises would be
    // worse than no rename at all, so everything that stored the old spelling
    // moves with it.
    const moved = await User.updateMany({ department: from }, { $set: { department: to } })
    await Workflow.updateMany(
      { 'access.departments': from },
      { $set: { 'access.departments.$[dept]': to } },
      { arrayFilters: [{ dept: from }] }
    )
    await Workflow.updateMany({ department: from }, { $set: { department: to } })

    writeAuditLog({
      action: 'department_renamed',
      performedBy: req.user._id,
      targetEntity: `Department: ${to}`,
      department: req.user.department,
      ipAddress: req.ip,
      detail: `${req.user.name} renamed "${from}" to "${to}" (${moved.modifiedCount || 0} member(s) moved)`,
      metadata: { from, to, members: moved.modifiedCount || 0 }
    })

    return sendSuccess(res, { ...(await listPayload(org)), renamed: { from, to, members: moved.modifiedCount || 0 } })
  } catch (err) {
    next(err)
  }
})

// DELETE /api/departments/:name
router.delete('/:name', requireCapability('manage_users'), async (req, res, next) => {
  try {
    const org = await loadOrg(req, res)
    if (!org) return undefined

    const name = canonical(org, req.params.name)
    if (!name) return sendError(res, 'Department not found', 'DEPARTMENT_NOT_FOUND', 404)

    const current = listFor(org)
    if (current.length === 1) {
      return sendError(res, 'A workspace needs at least one department', 'LAST_DEPARTMENT', 400)
    }

    // Deleting out from under people would leave users on a department that no
    // dropdown offers; move them first.
    const members = await User.countDocuments({ department: name, isActive: { $ne: false } })
    if (members > 0) {
      return sendError(
        res,
        `${members} active ${members === 1 ? 'person is' : 'people are'} still in "${name}". Move them to another department first.`,
        'DEPARTMENT_IN_USE',
        400,
        { members }
      )
    }

    org.departments = current.filter((d) => d !== name)
    await org.save()

    writeAuditLog({
      action: 'department_deleted',
      performedBy: req.user._id,
      targetEntity: `Department: ${name}`,
      department: req.user.department,
      ipAddress: req.ip,
      detail: `${req.user.name} deleted the department "${name}"`
    })

    return sendSuccess(res, await listPayload(org))
  } catch (err) {
    next(err)
  }
})

module.exports = require('../database/atomicRoutes').atomicRoutes(router)
