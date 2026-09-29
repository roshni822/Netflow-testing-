// Shared - Phase 2 - middleware/roleGuard.js
// Allow only callers whose role name is in the whitelist.
// Usage: router.post('/', protect, roleGuard('Admin'), handler)

const roleGuard = (...allowedRoles) => {
  return (req, res, next) => {
    if (!req.user || !req.user.role) {
      return res.status(403).json({
        success: false,
        error: 'No role assigned',
        code: 'NO_ROLE'
      })
    }

    const userRole = req.user.role.name
    if (allowedRoles.includes('SuperAdmin') && require('../database/layout').organizationSchemas() &&
        (req.user.accountScope !== 'platform' || req.user.orgId || !req.user.role.permissions?.includes('platform:manage_orgs'))) {
      return res.status(403).json({ success: false, error: 'Platform permission is required.', code: 'FORBIDDEN' })
    }
    if (!allowedRoles.includes(userRole)) {
      return res.status(403).json({
        success: false,
        error: `Role '${userRole}' is not authorized for this action`,
        code: 'FORBIDDEN'
      })
    }

    next()
  }
}

module.exports = { roleGuard }
