// Licensing Phase 2 - middleware/quota.js
// The single gate every "create something" path goes through. Its job is to turn
// a plan number into a refusal the user can act on, which is why the error body
// carries the resource, the limit and the plan rather than just a sentence.
//
// Contract: 403 with code LIMIT_REACHED and
//   { resource, limit, used, plan, planLabel, upgradeRequired: true }
//
// Escape hatch: LICENSING_ENFORCE=0 turns checking off (limits are still stored
// and displayed). The automated suites use it to exercise pre-licensing behaviour.

const { PLAN_PRESETS, LIMIT_FIELD, isUnlimited, bufferMbFor } = require('../config/plans')
const { effectiveCeiling, storageLimitMb, MB } = require('../utils/licensing')
const { countResource } = require('../utils/usage')
const { ensurePeriod } = require('../utils/usageMeter')
const { sendError } = require('../utils/apiResponse')

const enforcementEnabled = () => process.env.LICENSING_ENFORCE !== '0'

// What the user sees. Phrased around the action they can take themselves first,
// because "contact support" is a dead end for a 10-seat customer who has three
// deactivated accounts.
const COPY = {
  users: {
    noun: 'users',
    fix: 'Deactivate a user you no longer need, or ask your platform administrator to raise the limit.'
  },
  builders: {
    noun: 'builder seats',
    fix: 'Turn off "Can build" for someone else in Admin → Users, or ask for more builder seats.'
  },
  forms: {
    noun: 'forms',
    fix: 'Archive a form you no longer use, or ask your platform administrator to raise the limit.'
  },
  workflows: {
    noun: 'workflows',
    fix: 'Archive a workflow you no longer use, or ask your platform administrator to raise the limit.'
  },
  submissions: {
    noun: 'submissions this billing period',
    fix: 'The allowance resets at the start of your next billing period, or ask for a higher limit.'
  },
  storage: {
    noun: 'storage',
    fix: 'Delete some attachments, or ask your platform administrator for more storage.'
  },
  files: {
    noun: 'files',
    fix: 'Delete some attachments, or ask your platform administrator to raise the limit.'
  }
}

const planLabelOf = (org) => require('../config/plans').presetFor(org?.plan)?.label || 'Custom'

const limitOf = (org, resource) => Number(org?.limits?.[LIMIT_FIELD[resource]] || 0)

const limitError = (org, resource, used, limit, message) => ({
  status: 403,
  code: 'LIMIT_REACHED',
  error: message,
  extra: {
    resource,
    limit,
    used,
    plan: org?.plan || 'custom',
    planLabel: planLabelOf(org),
    upgradeRequired: true
  }
})

// Counted resources (users, builders, forms, workflows) and the metered
// submission counter. Returns null when there is room, or an error descriptor.
//
// `adding` lets a bulk path ask "is there room for all of these?" up front
// instead of discovering the ceiling mid-loop.
const checkQuota = async (org, resource, { adding = 1 } = {}) => {
  if (!enforcementEnabled() || !org) return null

  const limit = limitOf(org, resource)
  if (isUnlimited(limit)) return null

  const grace = Number(org.limits?.gracePercent || 0)
  const ceiling = effectiveCeiling(limit, grace)

  let used
  if (resource === 'submissions') {
    const period = await ensurePeriod(org._id)
    used = Number(period?.count || 0)
  } else {
    used = await countResource(resource, org._id)
  }

  if (used + adding <= ceiling) return null

  const copy = COPY[resource] || { noun: resource, fix: 'Ask your platform administrator to raise the limit.' }
  const message = adding > 1
    ? `Adding ${adding} would exceed your ${planLabelOf(org)} plan limit of ${limit} ${copy.noun} (${used} in use). ${copy.fix}`
    : `Your ${planLabelOf(org)} plan allows ${limit} ${copy.noun} and ${used} are in use. ${copy.fix}`

  return limitError(org, resource, used, limit, message)
}

// How many more of a resource this tenant may create: null when unlimited (or
// enforcement is off). Used by partial-success paths like the CSV import, which
// import what fits and report the rest as skipped rather than refusing the file.
const remainingFor = async (org, resource) => {
  if (!enforcementEnabled() || !org) return null
  const limit = limitOf(org, resource)
  if (isUnlimited(limit)) return null
  const ceiling = effectiveCeiling(limit, org.limits?.gracePercent)
  const used = resource === 'submissions'
    ? Number((await ensurePeriod(org._id))?.count || 0)
    : await countResource(resource, org._id)
  return { remaining: Math.max(0, ceiling - used), limit, used }
}

// Storage is two limits at once ("whichever comes first"): total size and file
// count. `allowBuffer` opens the small completion buffer above the licensed size
// — only for an attachment a pending approval cannot proceed without.
const checkStorage = async (org, bytes, { allowBuffer = false, files = 1 } = {}) => {
  if (!enforcementEnabled() || !org) return { ok: true, bufferBytes: 0 }

  const fileLimit = limitOf(org, 'files')
  if (!isUnlimited(fileLimit)) {
    const usedFiles = Number(org.usage?.fileCount || 0)
    if (usedFiles + files > effectiveCeiling(fileLimit, org.limits?.gracePercent)) {
      return {
        ok: false,
        ...limitError(org, 'files', usedFiles, fileLimit,
          `Your ${planLabelOf(org)} plan allows ${fileLimit} stored files and ${usedFiles} are in use. ${COPY.files.fix}`)
      }
    }
  }

  const limitMb = storageLimitMb(org)
  if (isUnlimited(limitMb)) return { ok: true, bufferBytes: 0 }

  const limitBytes = limitMb * MB
  const usedBytes = Number(org.usage?.storageBytes || 0)
  const size = Number(bytes || 0)
  const bufferBytes = bufferMbFor(limitMb) * MB
  const bufferUsed = Number(org.usage?.bufferBytesUsed || 0)

  if (usedBytes + size <= limitBytes) return { ok: true, bufferBytes: 0 }

  const usedMb = Math.round(usedBytes / MB)
  if (!allowBuffer) {
    return {
      ok: false,
      ...limitError(org, 'storage', usedMb, limitMb,
        `Your ${planLabelOf(org)} plan includes ${limitMb} MB of storage and ${usedMb} MB is in use. ${COPY.storage.fix}`)
    }
  }

  // Inside the buffer: allow it, and report how much of the upload came from
  // there so the caller can meter it and warn the admin.
  const remainingBuffer = Math.max(0, bufferBytes - bufferUsed)
  const overflow = usedBytes + size - limitBytes
  if (overflow <= remainingBuffer) {
    return { ok: true, bufferBytes: Math.min(overflow, size) }
  }

  return {
    ok: false,
    ...limitError(org, 'storage', usedMb, limitMb,
      `Storage is full, including the ${Math.round(bufferBytes / MB)} MB emergency reserve. `
      + 'Delete some attachments or ask your platform administrator for a temporary extension so this approval can be completed.')
  }
}

const respond = (res, err) => sendError(res, err.error, err.code, err.status, err.extra)

// Express middleware for a single-item create. Routes that create in bulk should
// call checkQuota directly with `adding`.
const requireQuota = (resource) => async (req, res, next) => {
  try {
    const err = await checkQuota(req.organization, resource)
    if (err) return respond(res, err)
    next()
  } catch (e) {
    next(e)
  }
}

// The per-user Builder gate for routes that design forms and workflows. This
// access is additive to the person's role, so it never grants people, billing,
// settings, or audit powers. Unlike numeric quotas, this access check remains
// authoritative when LICENSING_ENFORCE is disabled.
//
// Existing builders were granted the flag by scripts/migrateLicensing.js, and the
// Super Admin is exempt because they administer the platform rather than build in
// a tenant.
const hasBuilderAccess = (user) =>
  user?.role?.name === 'SuperAdmin' || user?.canBuild === true

const requireCanBuild = (req, res, next) => {
  if (hasBuilderAccess(req.user)) return next()

  return sendError(
    res,
    'Builder access is not enabled for your account. Ask an administrator to enable "Builder seat" in Admin → Users.',
    'BUILDER_SEAT_REQUIRED',
    403,
    { resource: 'builders', plan: req.organization?.plan || 'custom', planLabel: planLabelOf(req.organization) }
  )
}

module.exports = {
  checkQuota,
  checkStorage,
  remainingFor,
  requireQuota,
  requireCanBuild,
  hasBuilderAccess,
  respond,
  enforcementEnabled,
  planLabelOf,
  limitError
}
