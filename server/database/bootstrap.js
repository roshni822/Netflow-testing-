'use strict'
const { catalog } = require('./catalog')
const { transaction } = require('./postgres')
const { withSystemAccess } = require('./context')

async function bootstrap ({ email, password, name }) {
  const normalized = String(email || '').trim().toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized) || !String(name || '').trim()) {
    throw Object.assign(new Error('Set ADMIN_EMAIL and ADMIN_NAME to the real administrator'), { code: 'ADMIN_IDENTITY_REQUIRED' })
  }
  if (typeof password !== 'string' || password.length < 12 || Buffer.byteLength(password, 'utf8') > 72) {
    throw Object.assign(new Error('ADMIN_PASSWORD must be at least 12 characters and at most 72 UTF-8 bytes'), { code: 'ADMIN_PASSWORD_REQUIRED' })
  }
  return withSystemAccess('startup', () => transaction(async client => {
    await client.query("SELECT pg_advisory_xact_lock(hashtext('netflow:bootstrap'))")
    const models = catalog()
    const Organization = models.Organization.model
    const User = models.User.model
    const Role = models.Role.model
    const existingOrg = await Organization.findOne({ isDefault: true })
    const existingRole = await Role.findOne({ name: 'SuperAdmin', orgId: { $exists: false } }).setOptions({ skipOrgScope: true })
    if (existingOrg && existingRole) {
      const existingAdmin = await User.findOne({ orgId: existingOrg._id, role: existingRole._id, email: normalized }).setOptions({ skipOrgScope: true })
      if (existingAdmin) return { alreadyConfigured: true }
    }
    for (const spec of Object.values(models).filter(spec => spec.name !== 'Plan')) {
      if (await spec.model.countDocuments().setOptions({ skipOrgScope: true })) {
        throw Object.assign(new Error('Bootstrap requires an empty application database; it never resets existing accounts'), { code: 'DATABASE_NOT_EMPTY' })
      }
    }
    await require('../config/plans').reloadPlans()
    // The system organization is required by existing authentication. It is not
    // a demo/customer tenant and is hidden from the customer organization list.
    const org = await Organization.create({ name: 'Platform Administration', subdomain: 'default', isDefault: true, status: 'active', features: { externalUsers: true } })
    const role = await Role.create({ name: 'SuperAdmin', description: 'Platform administration', permissions: ['platform:manage_orgs'] })
    const admin = await User.create({ orgId: org._id, name: String(name).trim(), email: normalized, password, role: role._id, department: 'IT', isProtected: true, countsTowardSeats: false, canBuild: false })
    org.adminUserId = admin._id
    await org.save()
    return { created: true, systemOrganizations: 1, platformAdministrators: 1, customerOrganizations: 0 }
  }))
}

module.exports = { bootstrap }
