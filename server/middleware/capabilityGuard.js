const { hasCapability, hasPermission } = require('../utils/roleCapabilities')

const denied = (res, detail) => res.status(403).json({
  success: false,
  error: detail,
  code: 'FORBIDDEN'
})

const requireCapability = (...capabilities) => (req, res, next) => {
  if (!req.user?.role) return denied(res, 'No role assigned')
  if (!capabilities.some((capability) => hasCapability(req.user, capability))) {
    return denied(res, 'Your role does not have access to this action')
  }
  next()
}

const requirePermission = (...permissions) => (req, res, next) => {
  if (!req.user?.role) return denied(res, 'No role assigned')
  if (!permissions.some((permission) => hasPermission(req.user, permission))) {
    return denied(res, 'Your role does not have access to this action')
  }
  next()
}

module.exports = { requireCapability, requirePermission }
