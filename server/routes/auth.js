// M1 - Phase 2 - routes/auth.js
// Register / login / me / logout. Issues stateless JWTs signed with JWT_SECRET.

const express = require('express')
const jwt = require('jsonwebtoken')
const speakeasy = require('speakeasy')
const qrcode = require('qrcode')

const User = require('../models/User')
const Role = require('../models/Role')
const Organization = require('../models/Organization')
const AuditLog = require('../models/AuditLog')
const { protect } = require('../middleware/auth')
const { authenticateSession, verifyMfaChallenge, validateTokenUser } = require('../utils/sessionAuth')
const { authLimiter } = require('../middleware/rateLimit')
const { sendSuccess, sendError } = require('../utils/apiResponse')
const { sendPasswordResetEmail } = require('../utils/emailService')
const { getDefaultOrgId } = require('../utils/defaultOrg')
const { subdomainFromHost } = require('../middleware/tenant')
const { checkQuota } = require('../middleware/quota')
const { writeBlockFor } = require('../middleware/licence')
const { listFor: departmentsFor, canonical: canonicalDepartment } = require('../utils/departments')
const msSso = require('../utils/msSso')
const { ensureRolesForOrganization } = require('../utils/roleProvisioning')
const { roleNameKey } = require('../utils/roleCapabilities')
const { getPasswordPolicy } = require('../utils/passwordPolicy')

const RESET_TTL_MINUTES = 30

// Brute-force lockout tuning.
const MAX_FAILED_ATTEMPTS = 5
const LOCK_MINUTES = 15

// MFA tuning.
const MFA_CHALLENGE_TTL = '10m'   // short-lived token between password + code steps
const BACKUP_CODE_COUNT = 8

// Short-lived challenge token issued after the password step. `purpose` is
// 'verify' (user already has MFA) or 'setup' (enrolment mid-login, if used).
const signChallenge = (user, purpose) =>
  jwt.sign({ id: user._id, tv: user.tokenVersion || 0, mfa: purpose, ...require('../database/fresh/authentication').accountClaims(user) }, process.env.JWT_SECRET, { expiresIn: MFA_CHALLENGE_TTL })

// Verify a 6-digit TOTP code, tolerating ±1 time-step for clock drift.
const verifyTotp = (secret, code) =>
  speakeasy.totp.verify({ secret, encoding: 'base32', token: String(code || '').trim(), window: 1 })

// Resolves the acting user id for MFA enrolment endpoints. Accepts EITHER a
// full session bearer token (Profile opt-in) OR a 'setup' challenge in the body.
const resolveEnrollActor = async (req) => {
  const authHeader = req.headers.authorization
  try {
    if (authHeader) {
      if (!authHeader.startsWith('Bearer ')) return null
      const user = await authenticateSession(authHeader.slice(7))
      return { id: user._id, viaChallenge: false }
    }
    if (req.body?.challenge) {
      const decoded = verifyMfaChallenge(req.body.challenge, 'setup')
      const user = await User.findById(decoded.id).select('-password').lean()
      validateTokenUser(decoded, user)
      if (user.mfaEnabled) return null
      return { id: user._id, viaChallenge: true }
    }
  } catch { /* Invalid, inactive or revoked credentials cannot enroll MFA. */ }
  return null
}

const router = express.Router()
const { authGate } = require('../database/fresh/authentication')
router.use((req,res,next) => ['/login','/forgot-password'].includes(req.path) ? next() : authGate(req,res,next))

// Embeds the user's current tokenVersion ("tv") so the token can be revoked
// server-side by bumping User.tokenVersion, and the user's organization
// ("org") so every request can be tenant-scoped without an extra lookup.
// Legacy users without an orgId get one lazily in the protect middleware.
const signToken = (user, sessionId) => {
  const payload = { id: user._id, tv: user.tokenVersion || 0, ...require('../database/fresh/authentication').accountClaims(user) }
  if (sessionId) payload.sid = sessionId
  if (user.orgId) payload.org = String(user.orgId)
  return jwt.sign(payload, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '7d'
  })
}

const createSessionAndSignToken = async (user) => {
  const sessionId = require('crypto').randomBytes(16).toString('hex')
  await require('../models/User').updateOne(
    { _id: user._id },
    { $push: { activeSessions: sessionId } }
  )
  return signToken(user, sessionId)
}

// Resolves the workspace subdomain a request is targeting. An explicit
// `subdomain` (query on GET, body on POST) wins — used in local dev where
// hosts like `localhost` carry no subdomain — otherwise fall back to the
// Host header (acme.netflow.app → "acme" in production). Returns null for
// the bare/default domain.
const requestedSubdomain = (req) => {
  const explicit = String((req.query && req.query.subdomain) || (req.body && req.body.subdomain) || '')
    .toLowerCase().trim()
  if (explicit) return explicit
  return subdomainFromHost(req.headers.host)
}

// GET /api/auth/org-context — public, unauthenticated.
// Lets the login page show which organization (workspace) the visitor is
// signing in to, resolved from the subdomain. Returns { org: null } on the
// bare/default domain and { org: null, unknown: true } for an unrecognised
// subdomain. Exposes only non-sensitive fields (name, subdomain, status).
router.get('/org-context', async (req, res, next) => {
  try {
    const sub = requestedSubdomain(req)
    if (!sub) return sendSuccess(res, { org: null })
    const org = await Organization.findOne({ subdomain: sub })
      .select('name subdomain status')
      .lean()
    if (!org) return sendSuccess(res, { org: null, unknown: true })
    return sendSuccess(res, {
      org: { name: org.name, subdomain: org.subdomain, status: org.status }
    })
  } catch (err) {
    next(err)
  }
})

// POST /api/auth/register
router.post('/register', authLimiter, async (req, res, next) => {
  try {
    const { name, email, password, department, roleId } = req.body
    if (process.env.NODE_ENV === 'production' && process.env.ALLOW_SELF_REGISTRATION !== 'true') return sendError(res, 'Ask your workspace administrator to create your account.', 'REGISTRATION_DISABLED', 403)

    if (!name || !email || !password || !department) {
      return sendError(res, 'name, email, password and department are required', 'MISSING_FIELDS', 400)
    }
    const passwordCheck = getPasswordPolicy(password)
    if (!passwordCheck.valid) return sendError(res, passwordCheck.error, passwordCheck.code, 400)

    const normalisedEmail = String(email).toLowerCase().trim()
    // Self-registration always lands in the default organization (tenant
    // signup via subdomain arrives in build-order step 9). Email uniqueness
    // is checked within that org, matching the unique(orgId + email) index.
    const orgId = await getDefaultOrgId()
    const exists = await User.findOne({ email: normalisedEmail, orgId }).lean()
    if (exists) {
      return sendError(res, 'Email already registered', 'EMAIL_EXISTS', 400)
    }

    // Self-signup consumes a licensed seat like any other user, and the licence
    // has to be live — an expired workspace must not grow.
    const org = orgId ? await Organization.findById(orgId).lean() : null
    if (org) {
      const blocked = writeBlockFor(org)
      if (blocked) return sendError(res, blocked.error, blocked.code, blocked.status, blocked.extra)
      const overQuota = await checkQuota(org, 'users')
      if (overQuota) return sendError(res, overQuota.error, overQuota.code, overQuota.status, overQuota.extra)
    }

    // Departments belong to the workspace being joined, not to the codebase.
    const deptName = canonicalDepartment(org, department)
    if (!deptName) {
      return sendError(res, `department must be one of: ${departmentsFor(org).join(', ')}`, 'INVALID_DEPARTMENT', 400)
    }

    const tenantRoles = await ensureRolesForOrganization(orgId)
    // Public registration can never select a privileged role or bootstrap an admin.
    const employeeRole = tenantRoles.get(roleNameKey('Employee'))
    if (!employeeRole || (roleId && String(roleId) !== String(employeeRole._id))) {
      return sendError(res, 'Role is not assignable through registration.', 'ROLE_NOT_ASSIGNABLE', 403)
    }
    const resolvedRoleId = employeeRole._id

    const user = new User({
      orgId,
      name,
      email: normalisedEmail,
      password,
      department: deptName,
      role: resolvedRoleId,
      needsProductTour: true,
    })
    await user.save()
    await user.populate('role')

    const token = await createSessionAndSignToken(user)
    return sendSuccess(res, { token, user: user.toJSON() }, 201)
  } catch (err) {
    next(err)
  }
})

// POST /api/auth/login
router.post('/login', authLimiter, authGate, async (req, res, next) => {
  try {
    const { email, password } = req.body
    if (!email || !password) {
      return sendError(res, 'email and password are required', 'MISSING_CREDENTIALS', 400)
    }

    // Org-scoped login: when a workspace subdomain is supplied (subdomain
    // routing, step 9) resolve the target org and scope the email lookup to
    // it, so the same email can exist in multiple organizations. Without a
    // subdomain we keep the legacy global lookup (single-tenant / default
    // deployment on the bare domain).
    const sub = requestedSubdomain(req)
    const emailFilter = { email: String(email).toLowerCase().trim() }
    if (sub) {
      const org = await Organization.findOne({ subdomain: sub }).select('_id name status').lean()
      if (!org) {
        return sendError(res, 'Unknown workspace. Check the address and try again.', 'UNKNOWN_ORG', 404)
      }
      if (org.status === 'suspended') {
        return sendError(res, `${org.name} is suspended. Contact your platform administrator.`, 'ORG_SUSPENDED', 403)
      }
      emailFilter.orgId = org._id
    }

    const user = await User.findOne(emailFilter)
      .select('+failedLoginAttempts +lockUntil')
      .populate('role')
    if (!user) {
      return sendError(res, 'Invalid email or password', 'INVALID_CREDENTIALS', 401)
    }
    if (user.isActive === false) {
      return sendError(res, 'Account is deactivated', 'ACCOUNT_DEACTIVATED', 401)
    }
    if (user.isLocked()) {
      const mins = Math.max(1, Math.ceil((user.lockUntil.getTime() - Date.now()) / 60000))
      return res.status(423).json({
        success: false,
        code: 'ACCOUNT_LOCKED',
        error: `Too many failed attempts. Your account is locked. Try again in ${mins} minute${mins === 1 ? '' : 's'}.`,
        lockMinutes: mins
      })
    }

    const ok = await user.comparePassword(password)
    if (!ok) {
      user.failedLoginAttempts = (user.failedLoginAttempts || 0) + 1
      if (user.failedLoginAttempts >= MAX_FAILED_ATTEMPTS) {
        user.lockUntil = new Date(Date.now() + LOCK_MINUTES * 60 * 1000)
        user.failedLoginAttempts = 0
        await user.save({ validateBeforeSave: false })
        return res.status(423).json({
          success: false,
          code: 'ACCOUNT_LOCKED',
          error: `Too many failed attempts. Your account is locked for ${LOCK_MINUTES} minutes.`,
          lockMinutes: LOCK_MINUTES
        })
      }
      await user.save({ validateBeforeSave: false })
      const attemptsRemaining = MAX_FAILED_ATTEMPTS - user.failedLoginAttempts
      return res.status(401).json({
        success: false,
        code: 'INVALID_CREDENTIALS',
        error: `Invalid email or password. ${attemptsRemaining} attempt${attemptsRemaining === 1 ? '' : 's'} left before your account is locked.`,
        attemptsRemaining
      })
    }

    // Password OK — clear the failure counters.
    user.failedLoginAttempts = 0
    user.lockUntil = null

    // MFA gate. If the user opted in, hand back a challenge instead of a session.
    if (user.mfaEnabled) {
      await user.save({ validateBeforeSave: false })
      return sendSuccess(res, { mfaRequired: true, challenge: signChallenge(user, 'verify') })
    }

    // No MFA enabled → issue the real session token.
    user.lastLogin = new Date()
    await user.save({ validateBeforeSave: false })

    const token = await createSessionAndSignToken(user)
    const userPayload = user.toJSON()

    // Audit the login
    await AuditLog.create({
      orgId: user.orgId,
      action: 'user_logged_in',
      performedBy: user._id,
      targetEntity: 'System Login',
      department: user.department,
      ipAddress: req.ip,
      detail: `User ${user.email} logged in successfully.`
    }).catch(() => {})

    if (user.orgId) {
      const orgDoc = await Organization.findById(user.orgId).select('name integrations').lean()
      if (orgDoc) {
        userPayload.tenantName = orgDoc.name
        userPayload.dmsEnabled = Boolean(orgDoc.integrations?.dmsEnabled)
        userPayload.s3Enabled = Boolean(orgDoc.integrations?.s3?.enabled)
        userPayload.s3Bucket = orgDoc.integrations?.s3?.bucket || null
        userPayload.s3Region = orgDoc.integrations?.s3?.region || null
      }
    }
    return sendSuccess(res, { token, user: userPayload })
  } catch (err) {
    next(err)
  }
})

// POST /api/auth/mfa/setup
// Generates (or regenerates) a TOTP secret and returns a QR to scan.
// Works for a logged-in user (opt-in) or a mid-login setup challenge.
router.post('/mfa/setup', async (req, res, next) => {
  try {
    const actor = await resolveEnrollActor(req)
    if (!actor) return sendError(res, 'Not authorized', 'NOT_AUTHORIZED', 401)

    const user = await User.findById(actor.id).select('+mfaSecret').populate('role')
    if (!user) return sendError(res, 'User not found', 'USER_NOT_FOUND', 404)
    if (user.mfaEnabled) {
      return sendError(res, 'MFA is already enabled. Disable it first to re-enrol.', 'MFA_ALREADY_ENABLED', 400)
    }

    const secret = speakeasy.generateSecret({ length: 20 })
    user.mfaSecret = secret.base32
    await user.save({ validateBeforeSave: false })

    const otpauthUrl = speakeasy.otpauthURL({
      secret: secret.base32,
      encoding: 'base32',
      label: user.email,
      issuer: 'NetFlow'
    })
    const qr = await qrcode.toDataURL(otpauthUrl)
    return sendSuccess(res, { qr, manualKey: secret.base32 })
  } catch (err) {
    next(err)
  }
})

// POST /api/auth/mfa/enable  body: { code, challenge? }
// Verifies the first code, enables MFA, returns one-time backup codes. When
// invoked via a 'setup' challenge, it also issues the real session token.
router.post('/mfa/enable', async (req, res, next) => {
  try {
    const actor = await resolveEnrollActor(req)
    if (!actor) return sendError(res, 'Not authorized', 'NOT_AUTHORIZED', 401)

    const { code } = req.body
    if (!code) return sendError(res, 'code is required', 'MISSING_CODE', 400)

    const user = await User.findById(actor.id).select('+mfaSecret +mfaBackupCodes').populate('role')
    if (!user) return sendError(res, 'User not found', 'USER_NOT_FOUND', 404)
    if (!user.mfaSecret) return sendError(res, 'Start MFA setup first', 'MFA_NO_SECRET', 400)

    if (!verifyTotp(user.mfaSecret, code)) {
      return sendError(res, 'That code did not match. Check your authenticator app and try again.', 'MFA_INVALID', 400)
    }

    user.mfaEnabled = true
    const backupCodes = user.generateBackupCodes(BACKUP_CODE_COUNT)
    await user.save({ validateBeforeSave: false })

    const payload = { enabled: true, backupCodes }
    if (actor.viaChallenge) {
      user.lastLogin = new Date()
      await user.save({ validateBeforeSave: false })
      payload.token = await createSessionAndSignToken(user)
      payload.user = user.toJSON()
    }
    return sendSuccess(res, payload)
  } catch (err) {
    next(err)
  }
})

// POST /api/auth/mfa/verify  body: { challenge, code }
// Second login step for already-enrolled users. Accepts a TOTP code or a
// one-time backup code, then issues the real session token.
router.post('/mfa/verify', authLimiter, async (req, res, next) => {
  try {
    const { challenge, code } = req.body
    if (!challenge || !code) return sendError(res, 'challenge and code are required', 'MISSING_FIELDS', 400)

    let decoded
    try {
      decoded = verifyMfaChallenge(challenge, 'verify')
    } catch {
      return sendError(res, 'Your session expired. Please sign in again.', 'MFA_EXPIRED', 401)
    }
    if (decoded.mfa !== 'verify') return sendError(res, 'Invalid request', 'MFA_BAD_CHALLENGE', 400)

    const user = await User.findById(decoded.id).select('+mfaSecret +mfaBackupCodes').populate('role')
    if (!user || !user.mfaEnabled) return sendError(res, 'MFA is not set up for this account', 'MFA_NOT_ENABLED', 400)
    try {
      validateTokenUser(decoded, user)
    } catch (err) {
      return sendError(res, err.message, err.code, 401)
    }

    let ok = verifyTotp(user.mfaSecret, code)
    if (!ok && user.consumeBackupCode(code)) ok = true
    if (!ok) return sendError(res, 'Invalid authentication code', 'MFA_INVALID', 401)

    user.lastLogin = new Date()
    await user.save({ validateBeforeSave: false })

    const token = await createSessionAndSignToken(user)

    // Audit the login
    await AuditLog.create({
      orgId: user.orgId,
      action: 'user_logged_in',
      performedBy: user._id,
      targetEntity: 'System Login',
      department: user.department,
      ipAddress: req.ip,
      detail: `User ${user.email} logged in successfully.`
    }).catch(() => {})

    return sendSuccess(res, { token, user: user.toJSON() })
  } catch (err) {
    next(err)
  }
})

// GET /api/auth/mfa/status  (protected)
router.get('/mfa/status', protect, async (req, res) => {
  return sendSuccess(res, {
    enabled: Boolean(req.user.mfaEnabled),
    required: false
  })
})

// POST /api/auth/mfa/disable  (protected)  body: { code }
// Requires a valid TOTP / backup code to switch MFA off. Available to every role.
router.post('/mfa/disable', protect, async (req, res, next) => {
  try {
    const { code } = req.body
    if (!code) return sendError(res, 'code is required', 'MISSING_CODE', 400)

    const user = await User.findById(req.user._id).select('+mfaSecret +mfaBackupCodes')
    if (!user || !user.mfaEnabled) return sendError(res, 'MFA is not enabled', 'MFA_NOT_ENABLED', 400)

    let ok = verifyTotp(user.mfaSecret, code)
    if (!ok && user.consumeBackupCode(code)) ok = true
    if (!ok) return sendError(res, 'Invalid authentication code', 'MFA_INVALID', 401)

    user.mfaEnabled = false
    user.mfaSecret = null
    user.mfaBackupCodes = undefined
    await user.save({ validateBeforeSave: false })
    return sendSuccess(res, { disabled: true })
  } catch (err) {
    next(err)
  }
})

// POST /api/auth/forgot-password
// Always returns a generic success (never reveals whether the email exists).
router.post('/forgot-password', authLimiter, authGate, async (req, res, next) => {
  try {
    const { email } = req.body
    if (!email) {
      return sendError(res, 'email is required', 'MISSING_EMAIL', 400)
    }

    const generic = {
      message: 'If an account exists for that email, a reset link has been sent.'
    }

    const user = await User.findOne({
      email: String(email).toLowerCase().trim()
    })

    // Do not leak existence, and skip deactivated accounts silently.
    if (!user || user.isActive === false) {
      return sendSuccess(res, generic)
    }

    const rawToken = user.createPasswordResetToken(RESET_TTL_MINUTES)
    await user.save({ validateBeforeSave: false })

    const base = (process.env.CLIENT_URL || 'http://localhost:5173').replace(/\/$/, '')
    const resetUrl = `${base}/reset-password?token=${rawToken}&email=${encodeURIComponent(user.email)}`

    try {
      await sendPasswordResetEmail({
        to: user.email,
        name: user.name,
        resetUrl,
        expiresMinutes: RESET_TTL_MINUTES
      })
    } catch (mailErr) {
      // Roll back the token so a failed send doesn't leave a dangling reset.
      console.error('sendPasswordResetEmail error:', mailErr.message)
      user.resetPasswordToken = null
      user.resetPasswordExpires = null
      await user.save({ validateBeforeSave: false })
    }

    return sendSuccess(res, generic)
  } catch (err) {
    next(err)
  }
})

// POST /api/auth/reset-password
// Body: { token, email, password }. Consumes the token on success.
router.post('/reset-password', authLimiter, async (req, res, next) => {
  try {
    const { token, email, password } = req.body
    if (!token || !email || !password) {
      return sendError(res, 'token, email and password are required', 'MISSING_FIELDS', 400)
    }
    const passwordPolicy = getPasswordPolicy(password)
    if (!passwordPolicy.valid) {
      return sendError(res, passwordPolicy.error, passwordPolicy.code, 400)
    }

    const hashed = User.hashResetToken(token)
    const user = await User.findOne({
      email: String(email).toLowerCase().trim(),
      resetPasswordToken: hashed,
      resetPasswordExpires: { $gt: new Date() }
    }).select('+resetPasswordToken +resetPasswordExpires')

    if (!user) {
      return sendError(res, 'Reset link is invalid or has expired', 'INVALID_RESET_TOKEN', 400)
    }

    if (await user.comparePassword(password)) {
      return sendError(res, 'New password must be different from the current one', 'SAME_PASSWORD', 400)
    }

    user.password = password
    user.resetPasswordToken = null
    user.resetPasswordExpires = null
    // Revoke every existing session — a reset should kick out anyone (incl. an
    // attacker) holding an old token for this account.
    user.tokenVersion = (user.tokenVersion || 0) + 1
    user.activeSessions = []
    await user.save()

    return sendSuccess(res, { message: 'Password has been reset. You can now sign in.' })
  } catch (err) {
    next(err)
  }
})

// GET /api/auth/reset-password/validate?token=&email=
// Lightweight check so the reset page can show a helpful state before submit.
router.get('/reset-password/validate', async (req, res, next) => {
  try {
    const { token, email } = req.query
    if (!token || !email) {
      return sendError(res, 'token and email are required', 'MISSING_FIELDS', 400)
    }
    const hashed = User.hashResetToken(token)
    const user = await User.findOne({
      email: String(email).toLowerCase().trim(),
      resetPasswordToken: hashed,
      resetPasswordExpires: { $gt: new Date() }
    }).select('_id')

    return sendSuccess(res, { valid: Boolean(user) })
  } catch (err) {
    next(err)
  }
})

// GET /api/auth/me
router.get('/me', protect, async (req, res) => {
  const userPayload = { ...req.user }
  if (req.organization) {
    userPayload.tenantName = req.organization.name
    userPayload.dmsEnabled = Boolean(req.organization.integrations?.dmsEnabled)
    userPayload.s3Enabled = Boolean(req.organization.integrations?.s3?.enabled)
    userPayload.s3Bucket = req.organization.integrations?.s3?.bucket || null
    userPayload.s3Region = req.organization.integrations?.s3?.region || null
  }
  return sendSuccess(res, { user: userPayload })
})

// POST /api/auth/product-tour/complete
// Clears the first-login tour flag after the user finishes or skips.
router.post('/product-tour/complete', protect, async (req, res, next) => {
  try {
    const user = await User.findById(req.user._id).populate('role')
    if (!user) return sendError(res, 'User not found', 'USER_NOT_FOUND', 404)
    if (user.needsProductTour) {
      user.needsProductTour = false
      await user.save({ validateBeforeSave: false })
    }
    return sendSuccess(res, { user: user.toJSON() })
  } catch (err) {
    next(err)
  }
})

// POST /api/auth/change-password  (protected)  body: { currentPassword?, newPassword }
// Sets a new password. For a FORCED change (user.mustChangePassword — e.g. a
// freshly provisioned org admin) the current password isn't required (it was
// just used to log in); otherwise the current password must be verified.
// Issues a fresh token and revokes all previous sessions via tokenVersion.
router.post('/change-password', protect, async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body || {}
    const passwordPolicy = getPasswordPolicy(newPassword)
    if (!passwordPolicy.valid) {
      const code = ['PASSWORD_REQUIRED', 'PASSWORD_TOO_SHORT'].includes(passwordPolicy.code) ? 'WEAK_PASSWORD' : passwordPolicy.code
      return sendError(res, passwordPolicy.error, code, 400)
    }

    const user = await User.findById(req.user._id).populate('role')
    if (!user) return sendError(res, 'User not found', 'USER_NOT_FOUND', 404)

    const forced = user.mustChangePassword === true
    if (!forced) {
      if (!currentPassword) {
        return sendError(res, 'Current password is required', 'MISSING_CURRENT_PASSWORD', 400)
      }
      const ok = await user.comparePassword(currentPassword)
      if (!ok) return sendError(res, 'Current password is incorrect', 'INVALID_CURRENT_PASSWORD', 401)
    }

    // Reject a no-op change (new === current).
    if (await user.comparePassword(String(newPassword))) {
      return sendError(res, 'New password must be different from the current one', 'SAME_PASSWORD', 400)
    }

    user.password = String(newPassword)
    user.mustChangePassword = false
    user.tokenVersion = (user.tokenVersion || 0) + 1
    await user.save()

    const token = await createSessionAndSignToken(user)
    const userPayload = user.toJSON()
    if (req.organization) {
      userPayload.tenantName = req.organization.name
      userPayload.dmsEnabled = Boolean(req.organization.integrations?.dmsEnabled)
    }
    return sendSuccess(res, { token, user: userPayload })
  } catch (err) {
    next(err)
  }
})

// POST /api/auth/logout
// Handles single device logout (removes current session) or all devices logout (bumps tokenVersion).
router.post('/logout', protect, async (req, res, next) => {
  try {
    const { allDevices } = req.body
    if (allDevices) {
      await User.updateOne({ _id: req.user._id }, { $inc: { tokenVersion: 1 }, $set: { activeSessions: [] } })
    } else if (req.user.currentSessionId) {
      await User.updateOne({ _id: req.user._id }, { $pull: { activeSessions: req.user.currentSessionId } })
    }
    return sendSuccess(res, { message: 'Logged out successfully' })
  } catch (err) {
    next(err)
  }
})

// ── Microsoft SSO ("Sign in with Microsoft") ───────────────────────────────
// Access requires an existing active account explicitly bound to Microsoft tid+oid.
// Email is never used to auto-link or choose a workspace.
// SSO deliberately bypasses the local MFA/lockout gate above because Microsoft
// is the identity provider.

// The frontend calls this to decide whether to render the SSO button.
router.get('/sso/config', (req, res) => {
  return sendSuccess(res, { microsoft: msSso.isConfigured() })
})

// First entry of CLIENT_URL (it may be a comma-separated list) — where the
// browser is sent back to after the OAuth round-trip.
const clientBaseUrl = () =>
  (process.env.CLIENT_URL || 'http://localhost:5173').split(',')[0].trim()

// Start the login: redirect the browser to Microsoft's consent/login page.
router.get('/oauth/microsoft', async (req, res, next) => {
  try {
    if (!msSso.isConfigured()) {
      return sendError(res, 'Microsoft SSO is not configured', 'SSO_NOT_CONFIGURED', 503)
    }
    const nonce = require('crypto').randomBytes(32).toString('hex')
    res.cookie('netflow_sso_nonce', nonce, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', maxAge: 60000, path: '/api/auth/oauth/microsoft' })
    const url = await msSso.getAuthCodeUrl(msSso.signState(nonce))
    return res.redirect(url)
  } catch (err) {
    next(err)
  }
})

// OAuth redirect target: exchange the code, match an existing user, issue our
// own JWT, and hand it to the SPA via the URL fragment (not a query string, so
// the token isn't captured in server logs or the Referer header).
router.get('/oauth/microsoft/callback', async (req, res) => {
  const client = clientBaseUrl()
  const fail = (reason) => res.redirect(`${client}/login#sso_error=${reason}`)
  try {
    if (!msSso.isConfigured()) return fail('disabled')
    const nonce = String(req.headers?.cookie || '').split(';').map(part => part.trim()).find(part => part.startsWith('netflow_sso_nonce='))?.slice('netflow_sso_nonce='.length)
    res.clearCookie('netflow_sso_nonce', { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/api/auth/oauth/microsoft' })
    if (!msSso.verifyState(req.query.state, nonce)) return fail('state')
    if (!req.query.code) return fail('nocode')

    const result = await msSso.acquireTokenByCode(req.query.code)
    const { tid, oid } = result.idTokenClaims || {}
    if (!tid || !oid || !process.env.MS_TENANT_ID || tid !== process.env.MS_TENANT_ID) return fail('tenant')
    const signIn = async userId => require('../database/postgres').transaction(async () => {
      const user = await User.findById(userId).populate('role')
      if (!user || user.isActive === false) return null
      if (user.mfaEnabled && !result.idTokenClaims?.amr?.includes('mfa')) return null
      user.lastLogin = new Date()
      await user.save({ validateBeforeSave: false })
      return createSessionAndSignToken(user)
    })
    let token
    if (require('../database/layout').organizationSchemas()) {
      token = await require('../database/fresh/microsoft').withMicrosoftIdentity(tid, oid, signIn)
    } else {
      const identity = await require('../database/postgres').query('SELECT user_id FROM netflow_private.microsoft_identities WHERE tenant_id=$1 AND object_id=$2', [tid, oid])
      token = identity.rows[0] ? await signIn(identity.rows[0].user_id) : null
    }
    if (!token) return fail('nouser')
    return res.redirect(`${client}/oauth/callback#token=${token}`)
  } catch (err) {
    console.error('Microsoft SSO callback error:', { code: err.code || 'SSO_FAILED' })
    return fail('failed')
  }
})

module.exports = require('../database/layout').organizationSchemas()
  ? require('../database/atomicRoutes').atomicRoutes(router, { accountLock: true, commitErrorPaths: ['/login'], paths: ['/login', '/reset-password', '/mfa/setup', '/mfa/enable', '/mfa/verify', '/mfa/disable', '/change-password', '/logout'] })
  : router
