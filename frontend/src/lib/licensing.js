// Licensing Phase 4 - lib/licensing.js
// The client's half of the licensing vocabulary: plan names, limit labels, and
// the words shown when a limit or a licence gets in the user's way.
//
// The numbers here are a mirror of server/config/plans.js and are used only to
// prefill the Super Admin's form when they pick a plan. Everything the UI
// *displays* comes from the API (`licensing` / `usage` payloads), so a price
// change on the server never has to be repeated here to be correct on screen.

export const PLAN_OPTIONS = [
  {
    key: 'trial',
    label: 'Trial',
    hint: '14 days, then read-only',
    limits: {
      maxUsers: 3,
      maxBuilders: 1,
      maxForms: 5,
      maxWorkflows: 2,
      maxSubmissionsPerPeriod: 100,
      maxStorageMb: 1024,
      maxFiles: 0
    }
  },
  {
    key: 'basic',
    label: 'Basic',
    hint: '10 users · 1 builder · 5 GB',
    limits: {
      maxUsers: 10,
      maxBuilders: 1,
      maxForms: 25,
      maxWorkflows: 10,
      maxSubmissionsPerPeriod: 1000,
      maxStorageMb: 5120,
      maxFiles: 0
    }
  },
  {
    key: 'professional',
    label: 'Professional',
    hint: '50 users · 3 builders · 10 GB',
    limits: {
      maxUsers: 50,
      maxBuilders: 3,
      maxForms: 100,
      maxWorkflows: 50,
      maxSubmissionsPerPeriod: 5000,
      maxStorageMb: 10240,
      maxFiles: 0
    }
  },
  {
    key: 'enterprise',
    label: 'Enterprise',
    hint: 'Unlimited by default, tighten per customer',
    limits: {
      maxUsers: 0,
      maxBuilders: 0,
      maxForms: 0,
      maxWorkflows: 0,
      maxSubmissionsPerPeriod: 0,
      maxStorageMb: 0,
      maxFiles: 0
    }
  }
]

export const PLAN_LABELS = {
  trial: 'Trial',
  basic: 'Basic',
  professional: 'Professional',
  enterprise: 'Enterprise',
  custom: 'Custom'
}

// The editable limit fields, in the order they are sold.
export const LIMIT_FIELDS = [
  { key: 'maxUsers', label: 'Users' },
  { key: 'maxBuilders', label: 'Builder users'},
  { key: 'maxForms', label: 'Forms'},
  { key: 'maxWorkflows', label: 'Workflows'},
  { key: 'maxSubmissionsPerPeriod', label: 'Form Submissions'},
  { key: 'maxStorageMb', label: 'Storage (MB)'},
  { key: 'maxFiles', label: 'Files'}
]

// Resource meters, in the order the usage card and the org row show them.
export const METER_ORDER = [
  { key: 'users', label: 'Users' },
  { key: 'builders', label: 'Builders' },
  { key: 'forms', label: 'Forms' },
  { key: 'workflows', label: 'Workflows' },
  { key: 'submissions', label: 'Submissions' },
  { key: 'storage', label: 'Storage' },
  { key: 'files', label: 'Files' }
]

// ---------------------------------------------------------------------------
// formatting
// ---------------------------------------------------------------------------

export const formatMb = (mb) => {
  const n = Number(mb) || 0
  if (n <= 0) return '0 MB'
  if (n >= 1024) {
    const gb = n / 1024
    return `${gb >= 10 ? Math.round(gb) : gb.toFixed(1)} GB`
  }
  // Sub-megabyte DMS totals would otherwise round to "0 MB".
  if (n < 1) {
    const kb = n * 1024
    if (kb < 1) return `${Math.max(1, Math.round(n * 1024 * 1024))} B`
    return `${kb >= 10 ? Math.round(kb) : kb.toFixed(1)} KB`
  }
  if (n < 10) return `${n.toFixed(1)} MB`
  return `${Math.round(n)} MB`
}

export const formatCount = (n) => Number(n || 0).toLocaleString()

// "8 of 10" / "512 MB of 5 GB" / "1,204 used" when the limit is unlimited.
export const meterText = (resource, meter) => {
  if (!meter) return '—'
  const isStorage = resource === 'storage'
  const used = isStorage ? formatMb(meter.used) : formatCount(meter.used)
  if (meter.unlimited) return `${used} used`
  return `${used} of ${isStorage ? formatMb(meter.limit) : formatCount(meter.limit)}`
}

export const formatDate = (value) => {
  if (!value) return '—'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
}

// A Date to the yyyy-mm-dd a native date input needs.
export const toDateInput = (value) => {
  if (!value) return ''
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return ''
  return d.toISOString().slice(0, 10)
}

// ---------------------------------------------------------------------------
// tones
// ---------------------------------------------------------------------------

// `state` comes from the server (ok | warning | critical | exceeded) so the
// colour on screen always matches the threshold that triggers a warning email.
export const METER_TONE = {
  ok: { bar: 'bg-success-solid', text: 'text-fg-muted' },
  warning: { bar: 'bg-warning-solid', text: 'text-warning-fg' },
  critical: { bar: 'bg-warning-solid', text: 'text-warning-fg' },
  exceeded: { bar: 'bg-danger-solid', text: 'text-danger-fg' }
}

export const toneFor = (meter) => METER_TONE[meter?.state] || METER_TONE.ok

// The chip next to an org's name: what state its licence is in, in three words.
export const licenceChip = (licence) => {
  if (!licence) return null
  if (licence.status === 'suspended') return { label: 'Suspended', tone: 'danger' }
  if (licence.readOnly) {
    return { label: licence.isTrial ? 'Trial ended' : 'Licence expired', tone: 'danger' }
  }
  if (licence.daysLeft === null || licence.daysLeft === undefined) {
    return { label: licence.isTrial ? 'Trial' : 'Perpetual', tone: 'neutral' }
  }
  if (licence.daysLeft <= 30) {
    const when = licence.daysLeft <= 0
      ? 'ends today'
      : licence.daysLeft === 1 ? 'ends tomorrow' : `${licence.daysLeft} days left`
    return { label: `${licence.isTrial ? 'Trial ' : ''}${when}`, tone: 'warning' }
  }
  return { label: licence.isTrial ? 'Trial active' : 'Active', tone: 'success' }
}

export const CHIP_CLASS = {
  success: 'bg-success-subtle text-success-fg border-success-line',
  warning: 'bg-warning-subtle text-warning-fg border-warning-line',
  danger: 'bg-danger-subtle text-danger-fg border-danger-line',
  neutral: 'bg-surface-3 text-fg-muted border-line'
}

// ---------------------------------------------------------------------------
// read-only + limit copy
// ---------------------------------------------------------------------------

// The banner every user sees once the workspace stops accepting new work. Says
// what still works first — the alternative is a room full of people who think
// the system is down.
export const readOnlyCopy = (licence) => {
  if (!licence) return null
  if (licence.suspended || licence.status === 'suspended') {
    return {
      title: 'This workspace is suspended',
      body: 'Your platform administrator has paused this workspace. Contact them to restore access.'
    }
  }
  if (!licence.readOnly) return null
  const what = licence.isTrial ? 'trial' : 'licence'
  return {
    title: licence.isTrial ? 'Your trial has ended' : 'Your licence has expired',
    body: `This workspace is read-only since ${formatDate(licence.expiresAt)}. `
      + 'You can still sign in, read and export your data, and complete approvals already in progress. '
      + `New requests, forms, workflows and users are paused until the ${what} is renewed.`
  }
}

// Turns a 403 from middleware/quota.js into something worth reading. The server
// already sends an actionable sentence; this adds the heading and keeps the
// wording identical between a toast and an inline banner.
export const explainLimitError = (err) => {
  const data = err?.data || {}
  if (err?.code === 'LICENCE_READ_ONLY') {
    return {
      kind: 'licence',
      title: data.reason === 'trial_expired' ? 'Trial ended' : 'Licence expired',
      message: err.message
    }
  }
  if (err?.code === 'BUILDER_SEAT_REQUIRED') {
    return { kind: 'builder', title: 'No builder seat', message: err.message }
  }
  if (err?.code !== 'LIMIT_REACHED') return null
  const noun = {
    users: 'User limit reached',
    builders: 'Builder seats used up',
    forms: 'Form limit reached',
    workflows: 'Workflow limit reached',
    submissions: 'Submission allowance used up',
    storage: 'Storage full',
    files: 'File limit reached'
  }
  return {
    kind: 'limit',
    title: noun[data.resource] || 'Plan limit reached',
    message: err.message,
    resource: data.resource,
    used: data.used,
    limit: data.limit,
    planLabel: data.planLabel
  }
}

// True when an error is a licensing refusal rather than a bug — callers use it
// to show the explanation instead of "something went wrong".
export const isLicensingError = (err) =>
  ['LIMIT_REACHED', 'LICENCE_READ_ONLY', 'BUILDER_SEAT_REQUIRED'].includes(err?.code)
