// Idempotent bridge from the legacy global role catalogue to tenant-owned
// roles. It runs lazily on the first authenticated request for an organization
// and is also reusable from migrations and platform organization creation.

const Role = require('../models/Role')
const User = require('../models/User')
const Organization = require('../models/Organization')
const {
  DEFAULT_ROLES,
  roleNameKey,
  permissionsForCapabilities,
  capabilitiesFromPermissions
} = require('./roleCapabilities')

const readyOrganizations = new Set()
const pendingOrganizations = new Map()
// Indexes are owned by versioned PostgreSQL migrations.
const ensureRoleIndexes = async () => {}

const normalisedPermissions = (permissions) => {
  if (Array.isArray(permissions) && permissions.includes('*')) return ['*']
  return permissionsForCapabilities(capabilitiesFromPermissions(permissions), permissions)
}

const ensureRolesForOrganization = async (orgId, { force = false } = {}) => {
  if (!orgId) return new Map()
  if (require('../database/layout').organizationSchemas()) {
    if (require('../tenancy/tenantContext').getOrgId() !== String(orgId)) throw Object.assign(new Error('Resolve the organization first'), { code: 'DATABASE_SCOPE_REQUIRED' })
    const roles = await Role.find({ orgId }).lean()
    return new Map(roles.map(role => [roleNameKey(role.name), role]))
  }
  const orgKey = String(orgId)
  if (!force && readyOrganizations.has(orgKey)) {
    const roles = await Role.find({ orgId }).setOptions({ skipOrgScope: true }).lean()
    return new Map(roles.map((role) => [roleNameKey(role.name), role]))
  }
  if (pendingOrganizations.has(orgKey)) return pendingOrganizations.get(orgKey)

  const task = (async () => {
    await ensureRoleIndexes()

    const [organization, existingRoles, users, legacyRoles] = await Promise.all([
      Organization.findById(orgId).select('isDefault').lean(),
      Role.find({ orgId }).setOptions({ skipOrgScope: true }).lean(),
      User.find({ orgId }).setOptions({ skipOrgScope: true }).populate('role').lean(),
      Role.find({ orgId: { $exists: false }, name: { $ne: 'SuperAdmin' } })
        .setOptions({ skipOrgScope: true })
        .lean()
    ])

    const sources = new Map()
    const addSource = (role) => {
      const key = roleNameKey(role?.name)
      if (key && key !== 'superadmin' && !sources.has(key)) sources.set(key, role)
    }

    if (!existingRoles.length) DEFAULT_ROLES.forEach(addSource)
    DEFAULT_ROLES.filter((role) => ['Admin', 'CEO'].includes(role.name)).forEach(addSource)
    users.forEach((user) => addSource(user.role))
    if (organization?.isDefault && !existingRoles.length) legacyRoles.forEach(addSource)

    const roleMap = new Map(existingRoles.map((role) => [roleNameKey(role.name), role]))
    for (const source of sources.values()) {
      const key = roleNameKey(source.name)
      if (roleMap.has(key)) continue
      const created = await Role.findOneAndUpdate(
        { orgId, nameKey: key },
        {
          $setOnInsert: {
            orgId,
            name: String(source.name).trim(),
            nameKey: key,
            description: source.description || '',
            permissions: normalisedPermissions(source.permissions)
          }
        },
        { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true, skipOrgScope: true }
      ).lean()
      roleMap.set(key, created)
    }

    for (const user of users) {
      const currentRole = user.role
      if (currentRole?.orgId && String(currentRole.orgId) === orgKey) continue
      const replacement = roleMap.get(roleNameKey(currentRole?.name)) || roleMap.get('employee')
      if (replacement) {
        await User.updateOne(
          { _id: user._id, orgId },
          { $set: { role: replacement._id } }
        ).setOptions({ skipOrgScope: true })
      }
    }

    readyOrganizations.add(orgKey)
    return roleMap
  })().finally(() => pendingOrganizations.delete(orgKey))

  pendingOrganizations.set(orgKey, task)
  return task
}

const clearRoleProvisioningCache = (orgId) => {
  if (orgId) readyOrganizations.delete(String(orgId))
  else readyOrganizations.clear()
}

module.exports = { ensureRoleIndexes, ensureRolesForOrganization, clearRoleProvisioningCache }
