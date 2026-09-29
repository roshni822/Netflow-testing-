// Real, tenant-owned role catalogue and capability management.

const express = require('express')
const { isValidId } = require('../database/ids')

const Role = require('../models/Role')
const User = require('../models/User')
const Workflow = require('../models/Workflow')
const { protect } = require('../middleware/auth')
const { requireCapability } = require('../middleware/capabilityGuard')
const { sendSuccess, sendError } = require('../utils/apiResponse')
const { writeAuditLog } = require('../utils/writeAuditLog')
const {
  CAPABILITIES,
  DEPRECATED_BUILDER_CAPABILITIES,
  DEFAULT_ROLES,
  roleNameKey,
  isProtectedRoleName,
  normaliseCapabilityKeys,
  permissionsForCapabilities,
  capabilitiesFromPermissions,
  shellForRole
} = require('../utils/roleCapabilities')

const router = express.Router()
const ROLE_ORDER = DEFAULT_ROLES.map((role) => role.name)
const SYSTEM_ROLE_NAMES = new Set(ROLE_ORDER.map(roleNameKey))

const byDisplayOrder = (a, b) => {
  const ai = ROLE_ORDER.indexOf(a.name)
  const bi = ROLE_ORDER.indexOf(b.name)
  if (ai !== -1 && bi !== -1) return ai - bi
  if (ai !== -1) return -1
  if (bi !== -1) return 1
  return a.name.localeCompare(b.name)
}

const cleanRoleInput = (body = {}) => {
  const name = String(body.name || '').trim().replace(/\s+/g, ' ')
  const description = String(body.description || '').trim()
  const rawCapabilities = body.capabilities
  if (!name) return { error: 'Role name is required.' }
  if (name.length > 80) return { error: 'Role name must be 80 characters or fewer.' }
  if (description.length > 500) return { error: 'Description must be 500 characters or fewer.' }
  if (!Array.isArray(rawCapabilities)) return { error: 'Capabilities must be an array.' }
  if (rawCapabilities.some((capability) => DEPRECATED_BUILDER_CAPABILITIES.has(String(capability)))) {
    return { error: 'Builder access is managed per user. Manage forms and Build flows cannot be assigned to a role.' }
  }
  const capabilities = normaliseCapabilityKeys(rawCapabilities)
  if (capabilities.length !== new Set(rawCapabilities.map(String)).size) {
    return { error: 'One or more capabilities are not recognized.' }
  }
  return { name, description, capabilities }
}

const workflowReferenceCount = (roleName) => Workflow.countDocuments({
  $or: [
    { 'nodes.config.approverRole': roleName },
    { 'nodes.config.assignToRole': roleName }
  ]
})

const rolePayload = (role, stats = {}, references = 0) => ({
  _id: role._id,
  name: role.name,
  description: role.description || '',
  shell: shellForRole(role),
  members: Number(stats.members || 0),
  builders: Number(stats.builders || 0),
  capabilities: capabilitiesFromPermissions(role.permissions),
  protected: isProtectedRoleName(role.name),
  system: SYSTEM_ROLE_NAMES.has(roleNameKey(role.name)),
  workflowReferences: Number(references || 0),
  updatedAt: role.updatedAt || null
})

// GET /api/roles - assignable catalogue for the current organization.
router.get('/', protect, async (req, res, next) => {
  try {
    const roles = await Role.find({ name: { $ne: 'SuperAdmin' } }).sort({ name: 1 }).lean()
    return sendSuccess(res, { count: roles.length, roles })
  } catch (err) {
    next(err)
  }
})

// GET /api/roles/summary
router.get('/summary', protect, requireCapability('manage_users'), async (req, res, next) => {
  try {
    if (!req.orgId) return sendError(res, 'No workspace resolved for this account', 'NO_ORG', 400)

    const roles = await Role.find({ name: { $ne: 'SuperAdmin' } }).lean()
    const counts = await User.aggregate([
      { $match: { orgId: req.orgId, isActive: { $ne: false } } },
      { $group: { _id: '$role', members: { $sum: 1 }, builders: { $sum: { $cond: ['$canBuild', 1, 0] } } } }
    ])
    const byRoleId = new Map(counts.map((count) => [String(count._id), count]))
    const references = await Promise.all(roles.map((role) => workflowReferenceCount(role.name)))
    const payload = roles
      .map((role, index) => rolePayload(role, byRoleId.get(String(role._id)), references[index]))
      .sort(byDisplayOrder)

    return sendSuccess(res, {
      roles: payload,
      capabilities: CAPABILITIES.map(({ key, label, description, note }) => ({ key, label, description, note })),
      builderSeats: {
        used: payload.reduce((sum, role) => sum + role.builders, 0),
        limit: req.organization?.limits?.maxBuilders || 0
      }
    })
  } catch (err) {
    next(err)
  }
})

// POST /api/roles
router.post('/', protect, requireCapability('manage_users'), async (req, res, next) => {
  try {
    const input = cleanRoleInput(req.body)
    if (input.error) return sendError(res, input.error, 'VALIDATION_ERROR', 400)
    if (['superadmin', 'admin', 'ceo'].includes(roleNameKey(input.name))) {
      return sendError(res, 'Admin, CEO, and SuperAdmin are reserved role names.', 'PROTECTED_ROLE', 403)
    }

    const existing = await Role.findOne({ nameKey: roleNameKey(input.name) }).lean()
    if (existing) return sendError(res, 'A role named "' + input.name + '" already exists.', 'DUPLICATE_ROLE', 409)

    const role = await Role.create({
      orgId: req.orgId,
      name: input.name,
      nameKey: roleNameKey(input.name),
      description: input.description,
      permissions: permissionsForCapabilities(input.capabilities)
    })

    await writeAuditLog({
      action: 'role_changed',
      performedBy: req.user._id,
      targetEntity: 'Role: ' + role.name,
      department: req.user.department,
      ipAddress: req.ip,
      detail: 'Created role "' + role.name + '"',
      metadata: { operation: 'created', roleId: String(role._id), capabilities: input.capabilities }
    })

    return sendSuccess(res, { role: rolePayload(role.toObject()) }, 201)
  } catch (err) {
    if (err?.code === 11000) return sendError(res, 'A role with that name already exists.', 'DUPLICATE_ROLE', 409)
    next(err)
  }
})

// PUT /api/roles/:id
router.put('/:id', protect, requireCapability('manage_users'), async (req, res, next) => {
  try {
    if (!isValidId(req.params.id)) return sendError(res, 'Role not found', 'NOT_FOUND', 404)
    const role = await Role.findById(req.params.id)
    if (!role) return sendError(res, 'Role not found', 'NOT_FOUND', 404)
    if (isProtectedRoleName(role.name)) {
      return sendError(res, role.name + ' is protected and cannot be edited.', 'PROTECTED_ROLE', 403)
    }

    const input = cleanRoleInput(req.body)
    if (input.error) return sendError(res, input.error, 'VALIDATION_ERROR', 400)
    if (['superadmin', 'admin', 'ceo'].includes(roleNameKey(input.name))) {
      return sendError(res, 'Admin, CEO, and SuperAdmin are reserved role names.', 'PROTECTED_ROLE', 403)
    }

    const duplicate = await Role.findOne({
      _id: { $ne: role._id },
      nameKey: roleNameKey(input.name)
    }).lean()
    if (duplicate) return sendError(res, 'A role named "' + input.name + '" already exists.', 'DUPLICATE_ROLE', 409)

    const previousName = role.name
    const previousCapabilities = capabilitiesFromPermissions(role.permissions)
    role.name = input.name
    role.nameKey = roleNameKey(input.name)
    role.description = input.description
    role.permissions = permissionsForCapabilities(input.capabilities, role.permissions)
    await role.save()

    if (previousName !== role.name) {
      await Workflow.updateMany(
        { 'nodes.config.approverRole': previousName },
        { $set: { 'nodes.$[node].config.approverRole': role.name } },
        { arrayFilters: [{ 'node.config.approverRole': previousName }] }
      )
      await Workflow.updateMany(
        { 'nodes.config.assignToRole': previousName },
        { $set: { 'nodes.$[node].config.assignToRole': role.name } },
        { arrayFilters: [{ 'node.config.assignToRole': previousName }] }
      )
    }

    await writeAuditLog({
      action: 'role_changed',
      performedBy: req.user._id,
      targetEntity: 'Role: ' + role.name,
      department: req.user.department,
      ipAddress: req.ip,
      detail: 'Updated role "' + previousName + '"',
      metadata: {
        operation: 'updated',
        roleId: String(role._id),
        previousName,
        name: role.name,
        previousCapabilities,
        capabilities: input.capabilities
      }
    })

    const members = await User.countDocuments({ role: role._id, isActive: { $ne: false } })
    const references = await workflowReferenceCount(role.name)
    return sendSuccess(res, { role: rolePayload(role.toObject(), { members }, references) })
  } catch (err) {
    if (err?.code === 11000) return sendError(res, 'A role with that name already exists.', 'DUPLICATE_ROLE', 409)
    next(err)
  }
})

// DELETE /api/roles/:id
router.delete('/:id', protect, requireCapability('manage_users'), async (req, res, next) => {
  try {
    if (!isValidId(req.params.id)) return sendError(res, 'Role not found', 'NOT_FOUND', 404)
    const role = await Role.findById(req.params.id)
    if (!role) return sendError(res, 'Role not found', 'NOT_FOUND', 404)
    if (isProtectedRoleName(role.name)) {
      return sendError(res, role.name + ' is protected and cannot be deleted.', 'PROTECTED_ROLE', 403)
    }

    const usersCount = await User.countDocuments({ role: role._id })
    if (usersCount > 0) {
      return sendError(res, 'Cannot delete this role because ' + usersCount + ' people are still assigned to it.', 'ROLE_IN_USE', 409)
    }
    const references = await workflowReferenceCount(role.name)
    if (references > 0) {
      return sendError(res, 'Cannot delete this role because ' + references + ' workflows still reference it.', 'ROLE_REFERENCED', 409)
    }

    await role.deleteOne()
    await writeAuditLog({
      action: 'role_changed',
      performedBy: req.user._id,
      targetEntity: 'Role: ' + role.name,
      department: req.user.department,
      ipAddress: req.ip,
      detail: 'Deleted role "' + role.name + '"',
      metadata: { operation: 'deleted', roleId: String(role._id) }
    })
    return sendSuccess(res, { message: 'Role permanently deleted.' })
  } catch (err) {
    next(err)
  }
})

module.exports = require('../database/atomicRoutes').atomicRoutes(router)
