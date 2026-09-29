// Licensing Phase 1 - utils/licensing.js
// The one place that turns an Organization document into answers about its
// licence: which limits apply, how full each one is, and whether the tenant is
// still allowed to create things. Routes, middleware, crons and the usage API
// all read from here so they can never disagree.

const {
  PLAN_PRESETS,
  SELLABLE_PLANS,
  LIMIT_FIELD,
  RESOURCES,
  isUnlimited,
  bufferMbFor,
  limitsForPlan,
  presetFor
} = require('../config/plans')
const { periodFor, normalizeAnchor } = require('./billingPeriod')

const MB = 1024 * 1024
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const LIMIT_FIELDS = [
  'maxUsers',
  'maxBuilders',
  'maxForms',
  'maxWorkflows',
  'maxSubmissionsPerPeriod',
  'maxStorageMb',
  'maxFiles',
  'gracePercent'
]

const toInt = (v) => {
  const n = parseInt(v, 10)
  return Number.isFinite(n) ? n : null
}

const toDate = (v) => {
  if (v === null || v === '') return null
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? undefined : d
}

// ---------------------------------------------------------------------------
// Writing: validate + apply a Super Admin payload onto an org document
// ---------------------------------------------------------------------------

// Mutates `org`. Returns a list of human-readable errors; empty means applied.
// Order matters: a plan switch resets every limit to the preset first, then any
// explicit numbers in the same request override it.
const applyLicensingPayload = (org, body = {}) => {
  const errors = []
  const { plan, limits, licence, billingEmail, billingAnchorDay } = body

  if (plan !== undefined) {
    const key = String(plan || '').trim()
    if (!SELLABLE_PLANS.includes(key)) {
      errors.push(`Unknown plan "${key}". Choose one of: ${SELLABLE_PLANS.join(', ')}.`)
    } else {
      const preset = limitsForPlan(key)
      org.plan = key
      if (preset) {
        LIMIT_FIELDS.forEach((f) => {
          if (preset[f] !== undefined) org.limits[f] = preset[f]
        })
      }
      // A trial has to end, otherwise it is a free Enterprise licence.
      if (key === 'trial' && !licence?.trialEndsAt && !org.licence.trialEndsAt) {
        const days = presetFor('trial')?.trialDays || 14
        org.licence.trialEndsAt = new Date(Date.now() + days * 86400000)
      }
      if (key !== 'trial') org.licence.trialEndsAt = null
    }
  }

  if (limits !== undefined && limits !== null) {
    LIMIT_FIELDS.forEach((field) => {
      if (limits[field] === undefined) return
      const n = toInt(limits[field])
      if (n === null || n < 0) {
        errors.push(`${field} must be a number of 0 or more (0 = unlimited).`)
        return
      }
      if (field === 'gracePercent' && n > 50) {
        errors.push('gracePercent cannot exceed 50.')
        return
      }
      org.limits[field] = n
    })

    // Selling 3 builder seats inside a 2-user plan is a support ticket waiting
    // to happen, so reject it at the source.
    const maxUsers = Number(org.limits.maxUsers || 0)
    const maxBuilders = Number(org.limits.maxBuilders || 0)
    if (maxUsers > 0 && maxBuilders > 0 && maxBuilders > maxUsers) {
      errors.push('maxBuilders cannot exceed maxUsers.')
    }

    // Keep the selected tier (e.g. enterprise) even when limits are negotiated
    // away from the catalogue preset — the sold plan name stays what was chosen.
  }

  if (licence !== undefined && licence !== null) {
    const before = expiryOf(org)?.getTime() || null
    for (const field of ['validFrom', 'validUntil', 'trialEndsAt']) {
      if (licence[field] === undefined) continue
      const d = toDate(licence[field])
      if (d === undefined) {
        errors.push(`licence.${field} must be a valid date or null.`)
        continue
      }
      org.licence[field] = d
    }
    // A renewal makes every "your licence ends soon" notice already sent wrong.
    if ((expiryOf(org)?.getTime() || null) !== before) resetExpiryNotices(org)
    if (org.licence.validFrom && org.licence.validUntil
      && org.licence.validUntil.getTime() <= org.licence.validFrom.getTime()) {
      errors.push('licence.validUntil must be after licence.validFrom.')
    }
  }

  if (billingEmail !== undefined) {
    const email = String(billingEmail || '').toLowerCase().trim()
    if (email && !EMAIL_RE.test(email)) errors.push('billingEmail must be a valid email address.')
    else org.billingEmail = email
  }

  if (billingAnchorDay !== undefined) {
    const n = toInt(billingAnchorDay)
    if (n === null || n < 1 || n > 31) errors.push('billingAnchorDay must be between 1 and 31.')
    else org.billingAnchorDay = n
  }

  // Re-derive licence status from the dates so it is never stale on write; the
  // cron only exists to catch orgs nobody touched.
  if (!errors.length) org.licence.status = deriveLicenceStatus(org)

  return errors
}

// ---------------------------------------------------------------------------
// Reading: licence state
// ---------------------------------------------------------------------------

const expiryOf = (org) => {
  const dates = [org?.licence?.validUntil, org?.licence?.trialEndsAt]
    .filter(Boolean)
    .map((d) => new Date(d).getTime())
  return dates.length ? new Date(Math.min(...dates)) : null
}

const deriveLicenceStatus = (org, now = new Date()) => {
  if (org?.licence?.status === 'suspended') return 'suspended'
  const expiry = expiryOf(org)
  if (expiry && expiry.getTime() <= new Date(now).getTime()) return 'expired'
  return 'active'
}

// Read-only means "finish what you started, start nothing new". The allowlist
// of what still works lives in middleware/licence.js.
const licenceState = (org, now = new Date()) => {
  const status = deriveLicenceStatus(org, now)
  const expiry = expiryOf(org)
  const isTrial = org?.plan === 'trial'
  const at = new Date(now).getTime()
  const daysLeft = expiry ? Math.ceil((expiry.getTime() - at) / 86400000) : null

  return {
    status,
    plan: org?.plan || 'custom',
    planLabel: presetFor(org?.plan)?.label || 'Custom',
    isTrial,
    expiresAt: expiry,
    daysLeft,
    readOnly: status !== 'active',
    reason: status === 'active' ? null : (isTrial ? 'trial_expired' : 'licence_expired')
  }
}

// ---------------------------------------------------------------------------
// Reading: usage
// ---------------------------------------------------------------------------

// Licensed storage in MB plus any unexpired Super Admin extension. Works on
// lean objects as well as documents, unlike the model method.
const storageLimitMb = (org, now = new Date()) => {
  const base = Number(org?.limits?.maxStorageMb || 0)
  if (base <= 0) return 0
  const ext = org?.storageExtension
  const live = Number(ext?.extraMb || 0) > 0
    && (!ext?.expiresAt || new Date(ext.expiresAt).getTime() > new Date(now).getTime())
  return base + (live ? Number(ext.extraMb) : 0)
}

// The ceiling a create must stay under: limit + grace (if the org has grace).
const effectiveCeiling = (limit, gracePercent = 0) => {
  if (isUnlimited(limit)) return 0
  const grace = Math.max(0, Number(gracePercent) || 0)
  return grace ? Math.floor(Number(limit) * (1 + grace / 100)) : Number(limit)
}

const pct = (used, limit) => {
  if (isUnlimited(limit)) return 0
  if (Number(limit) <= 0) return 0
  return Math.round((Number(used) / Number(limit)) * 100)
}

const stateFor = (percent, unlimited) => {
  if (unlimited) return 'ok'
  if (percent >= 100) return 'exceeded'
  if (percent >= 90) return 'critical'
  if (percent >= 80) return 'warning'
  return 'ok'
}

const meter = (used, limit, extra = {}) => {
  const unlimited = isUnlimited(limit)
  const percent = pct(used, limit)
  return {
    used: Number(used) || 0,
    limit: Number(limit) || 0,
    unlimited,
    percent,
    remaining: unlimited ? null : Math.max(0, Number(limit) - Number(used)),
    state: stateFor(percent, unlimited),
    ...extra
  }
}

// Builds the payload the usage API and the UI meters render. `counts` comes
// from a caller that already knows how to count (routes/platform.usageFor or
// utils/usage.countsFor) so this stays synchronous and testable.
const usageSnapshot = (org, counts = {}, now = new Date()) => {
  const limits = org?.limits || {}
  const storageMb = storageLimitMb(org, now)
  const usedBytes = Number(org?.usage?.storageBytes || 0)
  const bufferMb = bufferMbFor(storageMb)
  const period = org?.usage?.submissions || {}

  return {
    plan: org?.plan || 'custom',
    planLabel: presetFor(org?.plan)?.label || 'Custom',
    licence: licenceState(org, now),
    gracePercent: Number(limits.gracePercent || 0),
    billingEmail: org?.billingEmail || '',
    billingAnchorDay: normalizeAnchor(org?.billingAnchorDay),
    period: {
      start: period.periodStart || null,
      end: period.periodEnd || null
    },
    resources: {
      users: meter(counts.users || 0, limits.maxUsers),
      builders: meter(counts.builders || 0, limits.maxBuilders),
      forms: meter(counts.forms || 0, limits.maxForms),
      workflows: meter(counts.workflows || 0, limits.maxWorkflows),
      submissions: meter(Number(period.count || 0), limits.maxSubmissionsPerPeriod),
      files: meter(Number(org?.usage?.fileCount || 0), limits.maxFiles),
      storage: meter(Math.round(usedBytes / MB), storageMb, {
        usedBytes,
        limitBytes: storageMb * MB,
        bufferMb,
        bufferBytesUsed: Number(org?.usage?.bufferBytesUsed || 0),
        extensionMb: Math.max(0, storageMb - Number(limits.maxStorageMb || 0))
      })
    }
  }
}

// Clears the "already warned" flags for a family ('sub' | 'stor' | 'all') so the
// next threshold crossing notifies again. Called when the period rolls over or
// when a Super Admin changes the limit the warnings were measured against.
const resetNotified = (org, family = 'all') => {
  if (!org.usage) return
  const flags = {
    sub: ['sub80', 'sub90', 'sub100'],
    stor: ['stor80', 'stor90', 'stor95', 'stor100', 'buffer']
  }
  const keys = family === 'all' ? [...flags.sub, ...flags.stor] : (flags[family] || [])
  keys.forEach((k) => {
    if (org.usage.notified) org.usage.notified[k] = false
  })
}

// Clears the licence expiry reminder flags, so a renewed or extended licence
// starts its reminder sequence again instead of staying silent.
const resetExpiryNotices = (org) => {
  if (!org.licence) return
  org.licence.notified = { d30: false, d14: false, d7: false, d1: false, expired: false }
}

// Fresh submission window for an org, used on create and on roll-over.
const freshPeriod = (org, now = new Date()) => {
  const { start, end } = periodFor(org?.billingAnchorDay, now)
  return { periodStart: start, periodEnd: end, count: 0 }
}

module.exports = {
  MB,
  LIMIT_FIELDS,
  RESOURCES,
  LIMIT_FIELD,
  applyLicensingPayload,
  deriveLicenceStatus,
  licenceState,
  expiryOf,
  storageLimitMb,
  effectiveCeiling,
  usageSnapshot,
  freshPeriod,
  resetNotified,
  resetExpiryNotices,
  meter,
  pct
}
