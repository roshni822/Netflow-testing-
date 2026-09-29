'use strict'

const jwt = require('jsonwebtoken')
const User = require('../models/User')

const authError = (code, message) => Object.assign(new Error(message), { code, status: 401 })

function verifyClaims (token) {
  let claims
  try {
    claims = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] })
  } catch {
    throw authError('INVALID_TOKEN', 'Token invalid or expired')
  }
  // All authentication tokens must expire and carry an explicit revocation version.
  if (!claims || typeof claims.id !== 'string' || !claims.id ||
      !Number.isSafeInteger(claims.tv) || claims.tv < 0 || !Number.isFinite(claims.exp)) {
    throw authError('INVALID_TOKEN', 'Token invalid or expired')
  }
  if (require('../database/layout').organizationSchemas()) {
    if (!/^[a-f0-9]{24}$/.test(claims.id) || !((claims.scope === 'platform' && !Object.hasOwn(claims, 'org')) ||
      (claims.scope === 'tenant' && /^[a-f0-9]{24}$/.test(claims.org)))) throw authError('ACCOUNT_SCOPE_MISMATCH', 'Invalid account context')
  }
  return claims
}

function verifySessionToken (token) {
  const claims = verifyClaims(token)
  // MFA challenges and SSO state are never application sessions.
  if ('mfa' in claims || 'sso' in claims || typeof claims.sid !== 'string' || !claims.sid) {
    throw authError('INVALID_TOKEN', 'A completed sign-in is required')
  }
  return claims
}

function verifyMfaChallenge (token, purpose) {
  const claims = verifyClaims(token)
  if (claims.mfa !== purpose || 'sid' in claims || 'sso' in claims) {
    throw authError('MFA_BAD_CHALLENGE', 'Invalid MFA challenge')
  }
  return claims
}

function validateTokenUser (claims, user) {
  if (!user) throw authError('USER_NOT_FOUND', 'User no longer exists')
  if (String(user._id) !== claims.id) throw authError('INVALID_TOKEN', 'Token invalid')
  if (require('../database/layout').organizationSchemas() && (user.accountScope !== claims.scope || (user.orgId ? String(user.orgId) : null) !== (claims.org || null))) {
    throw authError('ACCOUNT_SCOPE_MISMATCH', 'Invalid account context')
  }
  if (user.isActive === false) throw authError('ACCOUNT_DEACTIVATED', 'Account is deactivated')
  if (claims.tv !== (user.tokenVersion ?? 0)) {
    throw authError('TOKEN_REVOKED', 'Session ended. Please sign in again.')
  }
}

async function authenticateSession (token) {
  const claims = verifySessionToken(token)
  const load = async () => {
    const user = await User.findById(claims.id).select('-password').populate('role').lean()
    validateTokenUser(claims, user)
    if (!Array.isArray(user.activeSessions) || !user.activeSessions.includes(claims.sid)) {
      throw authError('SESSION_REVOKED', 'Device session ended. Please sign in again.')
    }
    user.currentSessionId = claims.sid
    return user
  }
  return require('../database/layout').organizationSchemas() ? require('../database/fresh/routing').withClaims(claims, load) : load()
}

module.exports = { authenticateSession, verifySessionToken, verifyMfaChallenge, validateTokenUser }
