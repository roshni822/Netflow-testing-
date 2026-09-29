// Multi-tenancy build-order step 4 - middleware/tenant.js
// Tenant resolver: decides which organization a request belongs to and
// attaches it to the request (req.orgId + req.organization).
//
// Resolution order:
//   1. Authenticated requests — the user's orgId (also embedded in the JWT
//      "org" claim at login; the user document stays the source of truth).
//      Legacy users created before tenancy are lazily stamped with the
//      default organization on their first authenticated request.
//   2. Unauthenticated requests — the subdomain from the Host header
//      (acme.netflow.app → org "acme"). Wired up fully in build-order
//      step 9 (subdomain routing); the helpers live here from day one.
//
// Requests for suspended organizations are rejected with 403 ORG_SUSPENDED.

const Organization = require('../models/Organization')
const User = require('../models/User')
const { getDefaultOrgId } = require('../utils/defaultOrg')

// Resolves and validates the organization for an authenticated user.
// Returns { ok: true, org } on success (org may be null on a fresh install
// with no seeded default org) or { ok: false, status, error, code }.
const resolveTenantForUser = async (user) => {
  if (require('../database/layout').organizationSchemas()) {
    if (user.accountScope === 'platform' && !user.orgId) return { ok: true, org: null }
    if (user.accountScope === 'tenant' && user.orgId) {
      const placement = await require('../database/fresh/routing').resolvePlacement(String(user.orgId))
      const org = await require('../tenancy/tenantContext').runWithPlacement(placement, async () => await Organization.findById(user.orgId).lean())
      return { ok: true, org, placement }
    }
    return { ok: false, status: 403, code: 'ACCOUNT_SCOPE_MISMATCH', error: 'An explicitly resolved account context is required.' }
  }
  let orgId = user.orgId || null

  if (!orgId) {
    orgId = await getDefaultOrgId()
    if (orgId) {
      await User.updateOne({ _id: user._id, orgId: null }, { $set: { orgId } })
      user.orgId = orgId
    }
  }

  if (!orgId) return { ok: true, org: null }

  const org = await Organization.findById(orgId).lean()
  if (!org) {
    return { ok: false, status: 403, error: 'Organization no longer exists', code: 'ORG_NOT_FOUND' }
  }
  if (org.status === 'suspended') {
    return {
      ok: false,
      status: 403,
      error: 'This organization is suspended. Contact your platform administrator.',
      code: 'ORG_SUSPENDED'
    }
  }
  return { ok: true, org }
}

// Express middleware for routes that run AFTER `protect`. Kept separate so
// future non-protect flows (e.g. public form links) can reuse the resolver.
const tenant = async (req, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, error: 'Not authorized', code: 'NO_USER' })
    }
    const result = await resolveTenantForUser(req.user)
    if (!result.ok) {
      return res.status(result.status).json({ success: false, error: result.error, code: result.code })
    }
    req.organization = result.org
    req.orgId = result.org ? result.org._id : null
    next()
  } catch (err) {
    next(err)
  }
}

// ── Subdomain helpers (adopted fully in build-order step 9) ─────────────────

// Subdomains that can never belong to a tenant.
const RESERVED_SUBDOMAINS = new Set(['www', 'api', 'app', 'admin', 'platform'])

// Hosting/platform domains that are the app's own infrastructure. The label in
// front (e.g. "netflow-s4de" in netflow-s4de.onrender.com, or "net-flow-sw" in
// net-flow-sw.vercel.app) is a project name, never a tenant workspace.
const PLATFORM_HOST_SUFFIXES = ['.onrender.com', '.vercel.app', '.netlify.app', '.herokuapp.com']

// "acme.netflow.app:443" → "acme". Returns null for bare domains, IPs,
// localhost, and the app's own hosting domains. When APP_ROOT_DOMAIN is set,
// only direct children of that domain are treated as workspaces.
const subdomainFromHost = (host) => {
  const hostname = String(host || '').split(':')[0].toLowerCase()
  if (!hostname || /^\d+(\.\d+){3}$/.test(hostname)) return null
  if (hostname === 'localhost' || hostname.endsWith('.localhost')) return null

  // Never resolve a tenant from the app's own hosting host.
  if (PLATFORM_HOST_SUFFIXES.some((s) => hostname.endsWith(s))) return null

  // When a tenant root domain is configured, only its direct children are
  // workspaces (acme.netflow.app → "acme"); the apex itself is the default org.
  const root = String(process.env.APP_ROOT_DOMAIN || '').toLowerCase().replace(/^\.+/, '')
  if (root) {
    if (hostname === root || !hostname.endsWith(`.${root}`)) return null
    const label = hostname.slice(0, -(root.length + 1)).split('.').pop()
    if (!label || RESERVED_SUBDOMAINS.has(label)) return null
    return label
  }

  // Legacy fallback: <sub>.<domain>.<tld>.
  const parts = hostname.split('.')
  if (parts.length < 3) return null
  const sub = parts[0]
  if (RESERVED_SUBDOMAINS.has(sub)) return null
  return sub
}

// Looks up an ACTIVE org by its subdomain. Returns null when unknown.
const resolveOrgFromSubdomain = async (subdomain) => {
  if (!subdomain) return null
  return Organization.findOne({ subdomain: String(subdomain).toLowerCase(), status: 'active' }).lean()
}

module.exports = {
  resolveTenantForUser,
  tenant,
  subdomainFromHost,
  resolveOrgFromSubdomain
}
