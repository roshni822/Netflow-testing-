// Shared - Phase 2 - middleware/auth.js
// JWT bearer-token verification. Used by every protected route.

const { authenticateSession } = require('../utils/sessionAuth')
const { resolveTenantForUser } = require('./tenant')
const { checkRequest } = require('./licence')
const { checkShellScope } = require('./shellScope')
const { runWithOrgId } = require('../tenancy/tenantContext')
const { ensureRolesForOrganization } = require('../utils/roleProvisioning')
const { roleNameKey } = require('../utils/roleCapabilities')

const protect = async (req, res, next) => {
  try {
    let token
    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
      token = req.headers.authorization.split(' ')[1]
    }

    if (!token) {
      return res.status(401).json({
        success: false,
        error: 'Not authorized, no token',
        code: 'NO_TOKEN'
      })
    }

    const user = await authenticateSession(token)

    // Multi-tenancy: resolve the user's organization (middleware/tenant.js)
    // and attach it so downstream code can scope every query by req.orgId.
    const tenantResult = await resolveTenantForUser(user)
    if (!tenantResult.ok) {
      return res.status(tenantResult.status).json({
        success: false,
        error: tenantResult.error,
        code: tenantResult.code
      })
    }

    // Legacy deployments shared one global role catalogue. Provision the
    // tenant-owned catalogue before entering the scoped request context, then
    // use the tenant copy immediately for this request.
    if (!require('../database/layout').organizationSchemas() && tenantResult.org?._id && user.role?.name !== 'SuperAdmin') {
      const tenantRoles = await ensureRolesForOrganization(tenantResult.org._id)
      const tenantRole = tenantRoles.get(roleNameKey(user.role?.name))
      if (tenantRole) user.role = tenantRole
    }

    req.user = user
    req.organization = tenantResult.org
    req.orgId = tenantResult.org ? tenantResult.org._id : null

    const requestPath = (req.originalUrl || req.url || '').split('?')[0]

    // Shell scoping: platform staff stay in the platform console — see
    // middleware/shellScope.
    const scopeBlock = checkShellScope({ user, path: requestPath })
    if (scopeBlock) {
      return res.status(scopeBlock.status).json({
        success: false,
        error: scopeBlock.error,
        code: scopeBlock.code
      })
    }

    // Licensing: an expired tenant is read-only. Checked here because this is the
    // one place every authenticated request goes through — see middleware/licence.
    const licenceBlock = checkRequest({
      org: req.organization,
      method: req.method,
      path: requestPath
    })
    if (licenceBlock) {
      return res.status(licenceBlock.status).json({
        success: false,
        error: licenceBlock.error,
        code: licenceBlock.code,
        ...licenceBlock.extra
      })
    }

    // Run the rest of the request inside the ambient tenant context so the
    // org-scope plugin auto-filters every query and stamps every create —
    // including async work the handlers kick off (workflow engine,
    // notifications, audit logs).
    if (tenantResult.placement) return require('../tenancy/tenantContext').runWithPlacement(tenantResult.placement, next)
    if (req.orgId) return runWithOrgId(req.orgId, () => next())
    return require('../database/context').withSystemAccess('platform', () => next())
  } catch (err) {
    return res.status(err.status || 401).json({
      success: false,
      error: err.status ? err.message : 'Token invalid or expired',
      code: err.status ? err.code : 'INVALID_TOKEN'
    })
  }
}

module.exports = { protect: (req, res, next) => require('../database/context').withSystemAccess('authentication', () => protect(req, res, next)) }
