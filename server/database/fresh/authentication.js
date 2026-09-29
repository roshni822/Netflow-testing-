'use strict'
const { query } = require('../postgres')
const { sendError, sendSuccess } = require('../../utils/apiResponse')
const { subdomainFromHost } = require('../../middleware/tenant')
const { organizationSchemas } = require('../layout')
const genericReset = { message: 'If an account exists for that email, a reset link has been sent.' }

function accountClaims (user) {
  if (!organizationSchemas()) return {}
  if (user.accountScope === 'platform' && !user.orgId) return { scope: 'platform' }
  if (user.accountScope === 'tenant' && user.orgId && String(user.orgId) === require('../../tenancy/tenantContext').getOrgId()) return { scope: 'tenant', org: String(user.orgId) }
  throw Object.assign(new Error('Unresolved account scope'), { code: 'ACCOUNT_SCOPE_MISMATCH' })
}

async function authGate (req, res, next) {
  if (!organizationSchemas()) return next()
  try {
    const route = req.path
    if (route === '/register') return sendError(res, 'Accounts must be provisioned by an administrator.', 'REGISTRATION_DISABLED', 403)
    const requestedScope = req.body?.accountScope || req.query?.accountScope
    if (requestedScope && !['platform','tenant'].includes(requestedScope)) return sendError(res, 'Invalid account context.', 'INVALID_ACCOUNT_CONTEXT', 400)
    const subdomain = String(req.body?.subdomain || req.query?.subdomain || subdomainFromHost(req.headers.host) || '').trim().toLowerCase()
    if (['/login','/forgot-password'].includes(route)) {
      const forgot = route === '/forgot-password'
      if (typeof req.body?.email !== 'string' || (!forgot && typeof req.body?.password !== 'string')) return sendError(res, 'Email and password must be text.', 'INVALID_CREDENTIALS', 400)
      let orgId = null
      if (subdomain) {
        if (requestedScope==='platform') return sendError(res, 'Platform sign-in cannot target a workspace.', 'ACCOUNT_SCOPE_MISMATCH', 400)
        const org = (await query('SELECT id FROM platform.organizations WHERE subdomain=$1 AND deleted_at IS NULL', [subdomain])).rows[0]
        if (!org) return forgot ? sendSuccess(res, genericReset) : sendError(res, 'Unknown workspace.', 'UNKNOWN_ORG', 404)
        orgId = org.id
      }
      const email = req.body.email.trim().toLowerCase()
      const { rows } = await query(`SELECT user_id,account_scope,org_id FROM system.user_directory WHERE email_key=$1 AND state<>'deleted'
        AND ($2::text IS NULL OR account_scope=$2) AND ($3::text IS NULL OR org_id=$3)`, [email, subdomain ? 'tenant' : requestedScope || null, orgId])
      // Missing and ambiguous identities share the same public response. Never
      // reveal account choices or try the supplied password across workspaces.
      if (rows.length !== 1) return forgot ? sendSuccess(res, genericReset) : sendError(res, 'Invalid email or password', 'INVALID_CREDENTIALS', 401)
      req.authIdentity = rows[0].user_id
      try { return await require('./routing').withAccount(rows[0], next) }
      catch (error) { if (forgot) return sendSuccess(res, genericReset); throw error }
    }
    if (route === '/reset-password' || route === '/reset-password/validate') {
      const input = req.method==='GET' ? req.query : req.body
      if (typeof input?.token!=='string' || typeof input?.email!=='string') return sendError(res, 'Token and email are required.', 'MISSING_FIELDS', 400)
      const hash = require('../../models/User').hashResetToken(input.token)
      const routed = (await query(`SELECT d.user_id,d.account_scope,d.org_id FROM system.resource_routes r JOIN system.user_directory d ON d.user_id=r.resource_id
        AND d.account_scope=r.account_scope AND d.org_id IS NOT DISTINCT FROM r.org_id
        WHERE r.purpose='password_reset' AND r.token_digest=$1 AND r.expires_at>now()
        AND d.state='active' AND d.email_key=$2`, [hash,input.email.trim().toLowerCase()])).rows[0]
      if (!routed) return req.method==='GET' ? sendSuccess(res, { valid: false }) : sendError(res, 'Reset link is invalid or has expired', 'INVALID_RESET_TOKEN', 400)
      req.authIdentity = routed.user_id
      return await require('./routing').withAccount(routed, next)
    }
    if (['/mfa/setup', '/mfa/enable', '/mfa/verify'].includes(route)) {
      const auth = require('../../utils/sessionAuth')
      const token = req.headers.authorization
      const claims = route !== '/mfa/verify' && token?.startsWith('Bearer ') ? auth.verifySessionToken(token.slice(7))
        : auth.verifyMfaChallenge(req.body?.challenge, route === '/mfa/verify' ? 'verify' : 'setup')
      req.authIdentity = claims.id
      return await require('./routing').withClaims(claims, next)
    }
    next()
  } catch (error) {
    if (error.status) return sendError(res, error.message, error.code, error.status)
    next(error)
  }
}

// Keep unconverted platform features and production readiness gated.
function foundationGate (req, res, next) {
  if (!organizationSchemas() || /^\/(auth|health|ready)(\/|$)/.test(req.path)) return next()
  // These existing routers authenticate and authorize the caller themselves.
  if (req.method==='GET' && ['/platform/admins','/platform/activity','/platform/plans'].includes(req.path)) return next()
  if (req.method==='GET' && ['/platform/overview','/platform/historical-stats','/platform/health'].includes(req.path)) return next()
  if (/^\/platform\/(plans(?:\/[a-z0-9-]+)?|admins(?:\/[a-f0-9]{24}\/(?:reset-password|activate|deactivate))?|broadcast)$/.test(req.path)) return next()
  if (req.method==='PUT' && /^\/platform\/orgs\/[a-f0-9]{24}$/.test(req.path)) return next()
  if (req.method==='DELETE' && /^\/platform\/orgs\/[a-f0-9]{24}$/.test(req.path)) return next()
  if (req.method==='POST' && /^\/platform\/orgs\/[a-f0-9]{24}\/(archive|restore-archive)$/.test(req.path)) return next()
  if (req.method==='GET' && /^\/platform\/orgs\/[a-f0-9]{24}\/usage$/.test(req.path)) return next()
  if (req.method==='GET' && /^\/platform\/orgs\/[a-f0-9]{24}\/storage(?:\/(dms|s3))?$/.test(req.path)) return next()
  if (req.method==='POST' && /^\/platform\/orgs\/[a-f0-9]{24}\/(suspend|activate|storage-extension)$/.test(req.path)) return next()
  if (req.method==='DELETE' && /^\/platform\/orgs\/[a-f0-9]{24}\/storage-extension$/.test(req.path)) return next()
  if (req.path==='/platform/orgs' && ['GET','POST'].includes(req.method)) return next()
  if (req.method==='GET' && /^\/platform\/provisioning\/[a-f0-9-]+$/i.test(req.path)) return next()
  if (req.method==='POST' && (req.path==='/platform/integrations/test' || /^\/platform\/orgs\/[a-f0-9]{24}\/reset-admin-password$/.test(req.path))) return next()
  if (/^\/(users|roles|departments|forms|workflows|tasks|team|notifications|audit-logs|analytics|usage|files|uploads|dms|s3|hooks)(\/|$)/.test(req.path)) return next()
  if (/^\/public\/forms\//.test(req.path)) return next()
  if (req.path === '/organization' && ['GET','PUT'].includes(req.method)) return next()
  if (req.path === '/broadcasts/active' && req.method === 'GET') return next()
  require('../../middleware/auth').protect(req, res, () => {
    return sendError(res, 'This feature is awaiting the organization-schema implementation phase.', 'SCHEMA_PHASE_NOT_READY', 503)
  })
}
module.exports = { accountClaims, authGate, foundationGate }
