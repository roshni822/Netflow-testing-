// Licensing Phase 2 - middleware/licence.js
// What happens when a tenant's licence runs out.
//
// An expired licence does NOT freeze the app. Freezing every write would strand
// approvals that are already in flight — an expense claim sitting on a manager's
// desk would become unapprovable, which is a business outage, not a billing
// nudge. So expiry means: nothing new starts, everything already started can
// finish, and everyone can still read their data and export it.
//
// The default is deny, and the exceptions are listed explicitly below, so a route
// added later is blocked until somebody decides it belongs on the list.
//
// Contract: 403 with code LICENCE_READ_ONLY and
//   { reason: 'licence_expired' | 'trial_expired', expiredAt, plan, planLabel, readOnly: true }

const { licenceState } = require('../utils/licensing')
const { sendError } = require('../utils/apiResponse')
const { enforcementEnabled } = require('./quota')

// Reads never depend on the licence — a customer who stops paying keeps access
// to their own data (and to the export buttons).
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

const ALLOWED_WHEN_READ_ONLY = [
  // Sign-in, MFA, password changes: you have to be able to log in to find out
  // why you are read-only and who to call.
  /^\/api\/auth\//,

  // Finishing work that already exists. Creating a task is impossible in
  // read-only mode, so these can only ever advance something in flight.
  /^\/api\/tasks\/[0-9a-fA-F]{24}\/(approve|reject|review|submit|request-changes)$/,

  // The attachment a decision above cannot be made without. routes/uploads.js
  // additionally requires a taskId in read-only mode, so this is not a hole for
  // ad-hoc uploads.
  /^\/api\/uploads(\/|$)/,

  // Housekeeping that stores no business data.
  /^\/api\/notifications(\/|$)/,
  /^\/api\/users\/me(\/|$)/,

  // Platform administration — how the licence gets renewed in the first place.
  /^\/api\/platform(\/|$)/
]

const isAllowedPath = (path) => ALLOWED_WHEN_READ_ONLY.some((re) => re.test(path))

// Pure check for callers that resolve their own tenant (inbound webhooks, public
// form links) instead of going through `protect`. Returns null when writable.
const writeBlockFor = (org) => {
  if (!enforcementEnabled() || !org) return null
  const state = licenceState(org)
  if (!state.readOnly) return null
  return {
    status: 403,
    code: 'LICENCE_READ_ONLY',
    error: state.isTrial
      ? 'This workspace\'s trial has ended. Existing approvals can still be completed, but new submissions are paused until a plan is activated.'
      : 'This workspace\'s licence has expired. Existing approvals can still be completed, but new work is paused until the licence is renewed.',
    extra: {
      readOnly: true,
      reason: state.reason,
      expiredAt: state.expiresAt,
      plan: state.plan,
      planLabel: state.planLabel
    }
  }
}

// Decides a single request. Called from middleware/auth.protect, which is the
// only point every authenticated request passes through — mounting this as an
// app-level middleware would run before the tenant is resolved, and adding it to
// each router by hand would silently miss whichever one is added next.
// Returns null when the request may proceed.
const checkRequest = ({ org, method, path }) => {
  if (SAFE_METHODS.has(String(method || '').toUpperCase())) return null
  if (!org) return null
  if (isAllowedPath(path)) return null
  return writeBlockFor(org)
}

// Router-level form of the same check, for any route mounted outside `protect`.
const licenceGuard = (req, res, next) => {
  try {
    const block = checkRequest({
      org: req.organization,
      method: req.method,
      path: (req.originalUrl || req.url || '').split('?')[0]
    })
    if (!block) return next()
    return sendError(res, block.error, block.code, block.status, block.extra)
  } catch (err) {
    next(err)
  }
}

// True while the tenant is in read-only mode — used by routes that need to
// tighten a rule rather than refuse outright (e.g. uploads requiring a taskId).
const isReadOnly = (org) => Boolean(writeBlockFor(org))

module.exports = { checkRequest, licenceGuard, writeBlockFor, isReadOnly, ALLOWED_WHEN_READ_ONLY }
