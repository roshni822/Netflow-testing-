// M1 - Phase 2 - routes/users.js
// User CRUD + role assignment. All routes require a valid JWT.
// Create / update / delete / assign-role are limited to Admin.

const express = require('express')

const User = require('../models/User')
const Role = require('../models/Role')
const { protect } = require('../middleware/auth')
const { requireCapability } = require('../middleware/capabilityGuard')
const { sendSuccess, sendError } = require('../utils/apiResponse')
const { writeAuditLog } = require('../utils/writeAuditLog')
const { sendWelcomeEmail } = require('../utils/emailService')
const { sanitizePrefs } = require('../utils/notificationPrefs')
const { checkEmailDomain } = require('../utils/domainPolicy')
const { listFor: departmentsFor, canonical: canonicalDepartment } = require('../utils/departments')
const { requireQuota, checkQuota, remainingFor, respond } = require('../middleware/quota')
const { releaseFor } = require('../utils/fileGc')
const { hasCapability } = require('../utils/roleCapabilities')

const router = express.Router()

// Shared by single create, update and CSV import so one path can't accept an
// address the others would reject.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const generateTempPassword = () => {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$%'
  let out = ''
  for (let i = 0; i < 12; i++) out += chars[Math.floor(Math.random() * chars.length)]
  return out
}

const sameId = (a, b) => String(a) === String(b)

// Anyone signed in may look colleagues up: the out-of-office delegate picker on
// Profile and the approver pickers in the builder all need a name list. What
// they do NOT need is the personnel record — seats, MFA state, reporting lines,
// last sign-in — so everyone but the Admin reads a directory instead.
const DIRECTORY_FIELDS = 'name email department role isActive'
const isPeopleAdmin = (user) => hasCapability(user, 'manage_users')

// Applies the right projection for the caller to a User query.
const scopeToCaller = (query, user) => (isPeopleAdmin(user)
  ? query.select('-password').populate('role')
  : query.select(DIRECTORY_FIELDS).populate('role', 'name'))

// Departments are per-tenant (utils/departments), so "is this a real one?" is a
// question about the caller's org, not about a schema enum.
const resolveDepartment = (org, value) => canonicalDepartment(org, value)

const departmentError = (org, value) =>
  `Unknown department "${value}" (allowed: ${departmentsFor(org).join(', ')})`

// Platform staff are created from the platform console, never from inside a
// workspace — otherwise an Org Admin could promote themselves out of their own
// tenant and into every other one.
const assertAssignableRole = async (roleId) => {
  const role = await Role.findById(roleId).select('name').lean()
  if (!role) return { ok: false, error: 'Role not found', code: 'ROLE_NOT_FOUND', status: 404 }
  if (role.name === 'SuperAdmin') {
    return {
      ok: false,
      error: 'Platform Super Admin cannot be assigned from a workspace',
      code: 'ROLE_NOT_ASSIGNABLE',
      status: 403
    }
  }
  return { ok: true, role }
}

// GET /api/users
router.get('/', protect, async (req, res, next) => {
  try {
    const { department, role, search, isActive } = req.query
    const page = Math.max(1, parseInt(req.query.page) || 1)
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20))

    const query = {}
    if (department) query.department = department
    if (isActive !== undefined) query.isActive = isActive === 'true'

    if (role) {
      const roleDoc = await Role.findOne({ name: role }).lean()
      if (roleDoc) query.role = roleDoc._id
      else query.role = null
    }

    if (search) {
      const regex = new RegExp(String(search).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')
      query.$or = [{ name: regex }, { email: regex }]
    }

    const [total, users] = await Promise.all([
      User.countDocuments(query),
      scopeToCaller(User.find(query), req.user)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean()
    ])

    return sendSuccess(res, {
      total,
      page,
      totalPages: Math.ceil(total / limit) || 1,
      count: users.length,
      users
    })
  } catch (err) {
    next(err)
  }
})

// GET /api/users/me/profile
// Current user's own profile, with role + reporting manager populated, plus
// the list of people who report directly to them (their direct reports).
// Declared before /:id so "me" isn't captured as an id.
router.get('/me/profile', protect, async (req, res, next) => {
  try {
    const user = await User.findById(req.user._id)
      .select('-password')
      .populate('role')
      .populate({
        path: 'managerId',
        select: 'name email department',
        populate: { path: 'role', select: 'name' }
      })
      .populate({
        path: 'hrId',
        select: 'name email department',
        populate: { path: 'role', select: 'name' }
      })
      .populate({
        path: 'outOfOffice.delegateId',
        select: 'name email department'
      })
      .lean()
    if (!user) return sendError(res, 'User not found', 'USER_NOT_FOUND', 404)

    const reports = await User.find({ managerId: req.user._id })
      .select('name email department isActive')
      .populate('role', 'name')
      .sort({ name: 1 })
      .lean()

    return sendSuccess(res, { user, reports })
  } catch (err) {
    next(err)
  }
})

// PUT /api/users/me/out-of-office
// Self-service Out-of-Office. While enabled (and within the optional date
// window), new approval / review / submit tasks that would be assigned to this
// user are auto-routed to their chosen delegate. Declared before
// /:id so "me" isn't captured as an id.
router.put('/me/out-of-office', protect, async (req, res, next) => {
  try {
    const { enabled, from, until, note, delegateId } = req.body || {}

    const parseDate = (v) => {
      if (v === undefined || v === null || v === '') return null
      const d = new Date(v)
      return isNaN(d.getTime()) ? undefined : d
    }
    const fromD = parseDate(from)
    const untilD = parseDate(until)
    if (fromD === undefined || untilD === undefined) {
      return sendError(res, 'Invalid date provided', 'INVALID_DATE', 400)
    }
    if (fromD && untilD && untilD < fromD) {
      return sendError(res, 'The end date must be on or after the start date', 'INVALID_RANGE', 400)
    }

    const outOfOffice = {
      enabled: !!enabled,
      from: fromD,
      until: untilD,
      note: note ? String(note).slice(0, 500) : undefined,
      delegateId: delegateId || undefined
    }

    const user = await User.findByIdAndUpdate(
      req.user._id,
      { outOfOffice },
      { returnDocument: 'after', runValidators: true }
    )
      .select('-password')
      .populate('role')
      .populate({ path: 'managerId', select: 'name email department' })
      .populate({ path: 'hrId', select: 'name email department' })
      .populate({ path: 'outOfOffice.delegateId', select: 'name email department' })
      .lean()

    if (!user) return sendError(res, 'User not found', 'USER_NOT_FOUND', 404)

    writeAuditLog({
      action: 'user_updated',
      performedBy: req.user._id,
      targetEntity: `User: ${user.name}`,
      department: user.department,
      ipAddress: req.ip,
      detail: `${user.name} turned Out-of-Office ${outOfOffice.enabled ? 'ON' : 'OFF'}`,
      metadata: { userId: String(user._id), outOfOffice: outOfOffice.enabled }
    })

    return sendSuccess(res, { user })
  } catch (err) {
    next(err)
  }
})

// PUT /api/users/me/notification-prefs
// Self-service per-event notification channel preferences (in-app vs email).
// The client sends the full prefs object; we normalise it to a trusted shape.
// Declared before /:id so "me" isn't captured as an id.
router.put('/me/notification-prefs', protect, async (req, res, next) => {
  try {
    const notificationPrefs = sanitizePrefs(req.body?.notificationPrefs || req.body)

    const user = await User.findByIdAndUpdate(
      req.user._id,
      { notificationPrefs },
      { returnDocument: 'after', runValidators: true }
    )
      .select('-password')
      .lean()

    if (!user) return sendError(res, 'User not found', 'USER_NOT_FOUND', 404)

    writeAuditLog({
      action: 'user_updated',
      performedBy: req.user._id,
      targetEntity: `User: ${user.name}`,
      department: user.department,
      ipAddress: req.ip,
      detail: `${user.name} updated notification preferences`,
      metadata: { userId: String(user._id) }
    })

    return sendSuccess(res, { user })
  } catch (err) {
    next(err)
  }
})

// GET /api/users/:id
router.get('/:id', protect, async (req, res, next) => {
  try {
    const q = scopeToCaller(User.findById(req.params.id), req.user)
    // Reporting lines are part of the personnel record; /users/me/profile is
    // where someone reads their own.
    if (isPeopleAdmin(req.user)) {
      q.populate({ path: 'managerId', select: 'name email department' })
        .populate({ path: 'hrId', select: 'name email department' })
    }
    const user = await q.lean()
    if (!user) return sendError(res, 'User not found', 'USER_NOT_FOUND', 404)
    return sendSuccess(res, { user })
  } catch (err) {
    next(err)
  }
})

// POST /api/users
router.post('/', protect, requireCapability('manage_users'), requireQuota('users'), async (req, res, next) => {
  try {
    const { name, email, department, roleId, managerId, hrId } = req.body
    if (!name || !email || !department || !roleId) {
      return sendError(res, 'name, email, department and roleId are required', 'MISSING_FIELDS', 400)
    }

    const roleCheck = await assertAssignableRole(roleId)
    if (!roleCheck.ok) return sendError(res, roleCheck.error, roleCheck.code, roleCheck.status)

    const deptName = resolveDepartment(req.organization, department)
    if (!deptName) {
      return sendError(res, departmentError(req.organization, department), 'INVALID_DEPARTMENT', 400)
    }

    // Builder seats are licensed separately from user seats, so granting one at
    // creation time has to clear its own quota.
    const canBuild = req.body.canBuild === true
    if (canBuild) {
      const builderLimit = await checkQuota(req.organization, 'builders')
      if (builderLimit) return respond(res, builderLimit)
    }

    const normalisedEmail = String(email).toLowerCase().trim()
    if (!EMAIL_RE.test(normalisedEmail)) {
      return sendError(res, 'Enter a valid email address', 'INVALID_EMAIL', 400)
    }

    // Domain allowlist policy (set per org by the platform admin). Off-list
    // domains are blocked, unless the org allows external users — in which
    // case the user is created and a warning is returned to the UI.
    const policy = checkEmailDomain(req.organization, normalisedEmail)
    if (!policy.allowed) {
      return sendError(res, policy.reason, 'DOMAIN_NOT_ALLOWED', 400)
    }

    const exists = await User.findOne({ email: normalisedEmail }).lean()
    if (exists) return sendError(res, 'Email already registered', 'EMAIL_EXISTS', 400)

    const tempPassword = req.body.password || generateTempPassword()

    const user = new User({
      name,
      email: normalisedEmail,
      password: tempPassword,
      department: deptName,
      role: roleId,
      canBuild,
      managerId: managerId || undefined,
      hrId: hrId || undefined,
      needsProductTour: true,
    })
    await user.save()
    await user.populate('role')

    sendWelcomeEmail({ to: user.email, name: user.name, tempPassword })

    writeAuditLog({
      action: 'user_invited',
      performedBy: req.user._id,
      targetEntity: `User: ${user.name}`,
      department: user.department,
      ipAddress: req.ip,
      detail: `${req.user.name} invited ${user.name} (${user.email})${policy.external ? ' — EXTERNAL user (domain not on the org allowlist)' : ''}`,
      metadata: {
        newUserId: user._id,
        role: user.role?.name,
        canBuild,
        external: Boolean(policy.external)
      }
    })

    if (canBuild) {
      writeAuditLog({
        action: 'builder_access_granted',
        performedBy: req.user._id,
        targetEntity: `User: ${user.name}`,
        department: user.department,
        ipAddress: req.ip,
        detail: `${req.user.name} granted Builder access to ${user.name}`,
        metadata: {
          userId: String(user._id),
          before: { canBuild: false },
          after: { canBuild: true },
          role: user.role?.name
        }
      })
    }

    return sendSuccess(res, {
      user: user.toJSON(),
      ...(policy.external ? { domainWarning: policy.warning } : {})
    }, 201)
  } catch (err) {
    next(err)
  }
})

// POST /api/users/import
// Bulk-create users from an array of rows (the frontend parses the CSV). Role
// and department are given by NAME. Each row is validated independently so one
// bad row never aborts the batch; the response is a per-row summary. Manager/HR
// are linked by email in a second pass (they may reference someone created in
// the same batch). Duplicate emails (in DB or within the file) are skipped.
const MAX_IMPORT_ROWS = 1000

router.post('/import', protect, requireCapability('manage_users'), async (req, res, next) => {
  try {
    const rows = Array.isArray(req.body?.users) ? req.body.users : null
    if (!rows) return sendError(res, 'users array is required', 'MISSING_USERS', 400)
    if (rows.length === 0) return sendError(res, 'No rows to import', 'EMPTY_IMPORT', 400)
    if (rows.length > MAX_IMPORT_ROWS) {
      return sendError(res, `Too many rows (max ${MAX_IMPORT_ROWS})`, 'IMPORT_TOO_LARGE', 400)
    }

    // Role name -> id (case-insensitive) and the allowed department set. Platform
    // staff are not importable, so SuperAdmin is left out of the map entirely.
    const roles = await Role.find({ name: { $ne: 'SuperAdmin' } }).select('_id name').lean()
    const nameToRoleId = new Map(roles.map((r) => [r.name.toLowerCase(), r._id]))
    const allowedDepartments = departmentsFor(req.organization)

    // Licensed seats left. The import is deliberately partial-success (a bad row
    // never aborts the batch), so seats are spent row by row and the rows that no
    // longer fit are reported as skipped instead of failing the whole file.
    const seats = await remainingFor(req.organization, 'users')
    let seatsLeft = seats ? seats.remaining : Infinity
    if (seats && seatsLeft === 0) {
      const err = await checkQuota(req.organization, 'users')
      if (err) return respond(res, err)
    }

    const results = []
    const seenEmails = new Set()
    const createdByEmail = new Map()  // email -> new user id (for pass 2)
    // Remember which rows want manager/hr linked, resolved in pass 2.
    const pendingLinks = []

    // ---- Pass 1: validate + create ----
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i] || {}
      const rowNum = i + 1
      const name = String(row.name || '').trim()
      const email = String(row.email || '').toLowerCase().trim()
      const department = String(row.department || '').trim()
      const roleName = String(row.role || '').trim()

      if (!name || !email || !department || !roleName) {
        results.push({ row: rowNum, email, status: 'error', reason: 'Missing required field (name, email, department, role)' })
        continue
      }
      if (!EMAIL_RE.test(email)) {
        results.push({ row: rowNum, email, status: 'error', reason: 'Invalid email format' })
        continue
      }
      if (seenEmails.has(email)) {
        results.push({ row: rowNum, email, status: 'skipped', reason: 'Duplicate email within the file' })
        continue
      }
      seenEmails.add(email)

      const roleId = nameToRoleId.get(roleName.toLowerCase())
      if (!roleId) {
        results.push({ row: rowNum, email, status: 'error', reason: `Unknown role "${roleName}"` })
        continue
      }
      const deptName = resolveDepartment(req.organization, department)
      if (!deptName) {
        results.push({ row: rowNum, email, status: 'error', reason: `Unknown department "${department}" (allowed: ${allowedDepartments.join(', ')})` })
        continue
      }

      // Domain allowlist policy — same rules as single user create.
      const policy = checkEmailDomain(req.organization, email)
      if (!policy.allowed) {
        results.push({ row: rowNum, email, status: 'skipped', reason: 'Email domain not on the org allowlist' })
        continue
      }

      const exists = await User.findOne({ email }).select('_id').lean()
      if (exists) {
        results.push({ row: rowNum, email, status: 'skipped', reason: 'Email already registered' })
        continue
      }

      if (seatsLeft <= 0) {
        results.push({
          row: rowNum,
          email,
          status: 'skipped',
          reason: `User limit reached (${seats.limit} licensed) — this row was not imported`
        })
        continue
      }

      try {
        const tempPassword = generateTempPassword()
        const user = new User({
          name,
          email,
          password: tempPassword,
          department: deptName,
          role: roleId,
          needsProductTour: true,
        })
        await user.save()
        seatsLeft -= 1
        createdByEmail.set(email, user._id)
        sendWelcomeEmail({ to: user.email, name: user.name, tempPassword })

        const managerEmail = String(row.manager || '').toLowerCase().trim()
        const hrEmail = String(row.hr || '').toLowerCase().trim()
        if (managerEmail || hrEmail) {
          pendingLinks.push({ rowNum, email, userId: user._id, managerEmail, hrEmail })
        }
        results.push({ row: rowNum, email, status: 'created', reason: policy.external ? 'External domain (allowed by org policy)' : '' })
      } catch (err) {
        results.push({ row: rowNum, email, status: 'error', reason: err.message || 'Could not create user' })
      }
    }

    // ---- Pass 2: link manager / HR by email ----
    if (pendingLinks.length) {
      const refEmails = new Set()
      for (const l of pendingLinks) {
        if (l.managerEmail) refEmails.add(l.managerEmail)
        if (l.hrEmail) refEmails.add(l.hrEmail)
      }
      // Resolve references against the DB, then overlay this batch's new users.
      const emailToId = new Map()
      const dbUsers = await User.find({ email: { $in: [...refEmails] } }).select('_id email').lean()
      for (const u of dbUsers) emailToId.set(u.email, u._id)
      for (const [email, id] of createdByEmail) emailToId.set(email, id)

      for (const link of pendingLinks) {
        const update = {}
        const warn = []
        if (link.managerEmail) {
          const mId = emailToId.get(link.managerEmail)
          if (mId) update.managerId = mId
          else warn.push(`manager "${link.managerEmail}" not found`)
        }
        if (link.hrEmail) {
          const hId = emailToId.get(link.hrEmail)
          if (hId) update.hrId = hId
          else warn.push(`HR "${link.hrEmail}" not found`)
        }
        if (Object.keys(update).length) {
          await User.updateOne({ _id: link.userId }, update)
        }
        if (warn.length) {
          const r = results.find((x) => x.row === link.rowNum)
          if (r) r.reason = [r.reason, warn.join('; ')].filter(Boolean).join('; ')
        }
      }
    }

    const created = results.filter((r) => r.status === 'created').length
    const skipped = results.filter((r) => r.status === 'skipped').length
    const failed = results.filter((r) => r.status === 'error').length

    writeAuditLog({
      action: 'users_imported',
      performedBy: req.user._id,
      targetEntity: `Bulk import: ${created} user(s)`,
      department: req.user.department,
      ipAddress: req.ip,
      detail: `${req.user.name} imported users - created ${created}, skipped ${skipped}, failed ${failed}`,
      metadata: { created, skipped, failed, total: rows.length }
    })

    return sendSuccess(res, { created, skipped, failed, total: rows.length, results }, 201)
  } catch (err) {
    next(err)
  }
})

// PUT /api/users/:id
router.put('/:id', protect, requireCapability('manage_users'), async (req, res, next) => {
  try {
    const { password, _id, role, name, email, ...rest } = req.body
    const updates = { ...rest }

    const target = await User.findById(req.params.id).select('name email isProtected isActive canBuild countsTowardSeats avatar').lean()
    if (!target) return sendError(res, 'User not found', 'USER_NOT_FOUND', 404)
    if (target.isProtected) {
      return sendError(res, 'This account is protected and cannot be modified', 'USER_PROTECTED', 403)
    }

    // Normalise before comparing so a string "true" from a form post still counts
    // as claiming a seat.
    if ('canBuild' in updates) updates.canBuild = updates.canBuild === true || updates.canBuild === 'true'
    if ('isActive' in updates) updates.isActive = updates.isActive === true || updates.isActive === 'true'
    // Org Admins must not flip seat billing from the tenant Admin Panel — only
    // Platform Super Admin sets this at provisioning time.
    delete updates.countsTowardSeats

    // Both of these hand out a licensed seat, so they go through the same gate as
    // creating a user would — otherwise "edit" is a way around the plan.
    // Complimentary accounts (countsTowardSeats === false) never consume seats.
    const billsSeats = target.countsTowardSeats !== false
    if (billsSeats && updates.canBuild === true && target.canBuild !== true) {
      const err = await checkQuota(req.organization, 'builders')
      if (err) return respond(res, err)
    }
    if (billsSeats && updates.isActive === true && target.isActive === false) {
      const err = await checkQuota(req.organization, 'users')
      if (err) return respond(res, err)
    }

    // Optional password reset. Validate up front so we never half-apply changes.
    const newPassword = (password === undefined || password === null) ? '' : String(password)
    const wantsPasswordChange = newPassword.length > 0
    if (wantsPasswordChange && newPassword.length < 6) {
      return sendError(res, 'Password must be at least 6 characters', 'WEAK_PASSWORD', 400)
    }

    if (role !== undefined) {
      if (sameId(req.params.id, req.user._id)) {
        return sendError(res, 'You cannot change your own role', 'CANNOT_CHANGE_OWN_ROLE', 400)
      }
      const roleCheck = await assertAssignableRole(role)
      if (!roleCheck.ok) return sendError(res, roleCheck.error, roleCheck.code, roleCheck.status)
      updates.role = role
    }

    if (updates.department !== undefined) {
      const deptName = resolveDepartment(req.organization, updates.department)
      if (!deptName) {
        return sendError(res, departmentError(req.organization, updates.department), 'INVALID_DEPARTMENT', 400)
      }
      updates.department = deptName
    }

    // Identity fields. Name is trimmed; email is normalised and checked for
    // collisions against everyone else so the unique index never 500s.
    if (name !== undefined) {
      const trimmedName = String(name).trim()
      if (!trimmedName) return sendError(res, 'Name cannot be empty', 'INVALID_NAME', 400)
      updates.name = trimmedName
    }
    if (email !== undefined) {
      const normalisedEmail = String(email).toLowerCase().trim()
      if (!normalisedEmail) return sendError(res, 'Email cannot be empty', 'INVALID_EMAIL', 400)
      if (!EMAIL_RE.test(normalisedEmail)) {
        return sendError(res, 'Enter a valid email address', 'INVALID_EMAIL', 400)
      }
      const clash = await User.findOne({
        email: normalisedEmail,
        _id: { $ne: req.params.id }
      }).lean()
      if (clash) return sendError(res, 'That email is already used by another user', 'EMAIL_EXISTS', 400)
      updates.email = normalisedEmail
    }

    // Allow clearing the reporting manager; an empty string would otherwise
    // reject a malformed record identifier.
    if ('managerId' in updates) {
      if (!updates.managerId) updates.managerId = null
      else if (sameId(updates.managerId, req.params.id)) {
        return sendError(res, 'A user cannot be their own manager', 'INVALID_MANAGER', 400)
      }
    }

    if ('hrId' in updates) {
      if (!updates.hrId) updates.hrId = null
      else if (sameId(updates.hrId, req.params.id)) {
        return sendError(res, 'A user cannot be their own HR', 'INVALID_HR', 400)
      }
    }

    // Snapshot identity (already loaded above) so we can record what changed.
    const before = (updates.name !== undefined || updates.email !== undefined) ? target : null

    // Revoke existing sessions on security-sensitive changes (role change or
    // deactivation) so the affected user's old tokens stop working immediately.
    const revokeSessions = updates.role !== undefined || updates.isActive === false
    const mutation = revokeSessions ? { ...updates, $inc: { tokenVersion: 1 } } : updates

    const user = await User.findByIdAndUpdate(req.params.id, mutation, {
      returnDocument: 'after',
      runValidators: true
    }).select('-password').populate('role')

    if (!user) return sendError(res, 'User not found', 'USER_NOT_FOUND', 404)

    if (before) {
      const changes = []
      if (updates.name !== undefined && updates.name !== before.name) {
        changes.push(`name "${before.name}" → "${updates.name}"`)
      }
      if (updates.email !== undefined && updates.email !== before.email) {
        changes.push(`email "${before.email}" → "${updates.email}"`)
      }
      if (changes.length) {
        writeAuditLog({
          action: 'user_updated',
          performedBy: req.user._id,
          targetEntity: `User: ${user.name}`,
          department: user.department,
          ipAddress: req.ip,
          detail: `${req.user.name} updated ${changes.join(' and ')}`,
          metadata: { userId: String(user._id) }
        })
      }
    }

    if (updates.canBuild !== undefined && updates.canBuild !== (target.canBuild === true)) {
      const granted = updates.canBuild === true
      writeAuditLog({
        action: granted ? 'builder_access_granted' : 'builder_access_revoked',
        performedBy: req.user._id,
        targetEntity: `User: ${user.name}`,
        department: user.department,
        ipAddress: req.ip,
        detail: `${req.user.name} ${granted ? 'granted Builder access to' : 'revoked Builder access from'} ${user.name}`,
        metadata: {
          userId: String(user._id),
          before: { canBuild: target.canBuild === true },
          after: { canBuild: granted },
          role: user.role?.name
        }
      })
    }

    // A replaced avatar leaves the old image orphaned on disk and still counted.
    if ('avatar' in updates && target.avatar && updates.avatar !== target.avatar) {
      await releaseFor(req.orgId, { users: [{ avatar: target.avatar }] })
    }

    if (wantsPasswordChange) {
      // Load the document so the pre('save') hook hashes the new password with
      // bcrypt — findByIdAndUpdate would skip the hook and store it in plaintext.
      const doc = await User.findById(req.params.id)
      if (doc) {
        doc.password = newPassword
        // Kick existing sessions when an admin resets someone's password.
        doc.tokenVersion = (doc.tokenVersion || 0) + 1
        await doc.save()
        writeAuditLog({
          action: 'user_updated',
          performedBy: req.user._id,
          targetEntity: `User: ${user.name}`,
          department: user.department,
          ipAddress: req.ip,
          detail: `${req.user.name} reset the password for ${user.name}`,
          metadata: { userId: String(user._id), passwordReset: true }
        })
      }
    }

    return sendSuccess(res, { user })
  } catch (err) {
    next(err)
  }
})

// DELETE /api/users/:id  (soft delete: isActive = false)
router.delete('/:id', protect, requireCapability('manage_users'), async (req, res, next) => {
  try {
    if (sameId(req.params.id, req.user._id)) {
      return sendError(res, 'You cannot deactivate your own account', 'CANNOT_DEACTIVATE_SELF', 400)
    }

    const target = await User.findById(req.params.id).select('isProtected').lean()
    if (target?.isProtected) {
      return sendError(res, 'This account is protected and cannot be deactivated', 'USER_PROTECTED', 403)
    }

    const user = await User.findByIdAndUpdate(
      req.params.id,
      { isActive: false, $inc: { tokenVersion: 1 } },
      { returnDocument: 'after' }
    ).select('-password').populate('role')

    if (!user) return sendError(res, 'User not found', 'USER_NOT_FOUND', 404)

    return sendSuccess(res, { message: 'User deactivated', user })
  } catch (err) {
    next(err)
  }
})

// DELETE /api/users/:id/permanent  (HARD delete: removes the user from the DB)
// Detaches the user from anyone who reports to them / has them as HR partner so
// the org chart and approval routing never point at a deleted account.
router.delete('/:id/permanent', protect, requireCapability('manage_users'), async (req, res, next) => {
  try {
    if (sameId(req.params.id, req.user._id)) {
      return sendError(res, 'You cannot delete your own account', 'CANNOT_DELETE_SELF', 400)
    }

    const target = await User.findById(req.params.id).populate('role').lean()
    if (!target) return sendError(res, 'User not found', 'USER_NOT_FOUND', 404)
    if (target.isProtected) {
      return sendError(res, 'This account is protected and cannot be deleted', 'USER_PROTECTED', 403)
    }

    const [mgrCleared, hrCleared] = await Promise.all([
      User.updateMany({ managerId: target._id }, { $unset: { managerId: 1 } }),
      User.updateMany({ hrId: target._id }, { $unset: { hrId: 1 } })
    ])

    await User.deleteOne({ _id: target._id })
    await releaseFor(req.orgId, { users: [target] })

    writeAuditLog({
      action: 'user_deleted',
      performedBy: req.user._id,
      targetEntity: `User: ${target.name} <${target.email}>`,
      department: target.department,
      ipAddress: req.ip,
      detail: `${req.user.name} permanently deleted ${target.name} (${target.role?.name || 'no role'})`,
      metadata: {
        deletedUserId: String(target._id),
        reportsDetached: mgrCleared.modifiedCount,
        hrLinksDetached: hrCleared.modifiedCount
      }
    })

    return sendSuccess(res, {
      message: 'User permanently deleted',
      detached: { reports: mgrCleared.modifiedCount, hrLinks: hrCleared.modifiedCount }
    })
  } catch (err) {
    next(err)
  }
})

// POST /api/users/:id/assign-role
router.post('/:id/assign-role', protect, requireCapability('manage_users'), async (req, res, next) => {
  try {
    const { roleId } = req.body
    if (!roleId) return sendError(res, 'roleId is required', 'MISSING_ROLE', 400)

    if (sameId(req.params.id, req.user._id)) {
      return sendError(res, 'You cannot change your own role', 'CANNOT_CHANGE_OWN_ROLE', 400)
    }

    const targetUser = await User.findById(req.params.id).populate('role')
    if (!targetUser) return sendError(res, 'User not found', 'USER_NOT_FOUND', 404)
    if (targetUser.isProtected) {
      return sendError(res, 'This account is protected and its role cannot be changed', 'USER_PROTECTED', 403)
    }

    const roleCheck = await assertAssignableRole(roleId)
    if (!roleCheck.ok) return sendError(res, roleCheck.error, roleCheck.code, roleCheck.status)
    const newRole = roleCheck.role

    const previousRoleName = targetUser.role?.name || 'None'
    targetUser.role = newRole._id
    // Role change alters permissions — revoke existing sessions.
    targetUser.tokenVersion = (targetUser.tokenVersion || 0) + 1
    await targetUser.save({ validateBeforeSave: false })
    await targetUser.populate('role')

    writeAuditLog({
      action: 'role_changed',
      performedBy: req.user._id,
      targetEntity: `User: ${targetUser.name}`,
      department: targetUser.department,
      ipAddress: req.ip,
      detail: `${req.user.name} changed ${targetUser.name}'s role from ${previousRoleName} to ${newRole.name}`,
      metadata: { previousRole: previousRoleName, newRole: newRole.name }
    })

    return sendSuccess(res, { user: targetUser.toJSON() })
  } catch (err) {
    next(err)
  }
})

module.exports = require('../database/layout').organizationSchemas() ? require('../database/atomicRoutes').atomicRoutes(router) : router
