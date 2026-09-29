// Multi-tenancy build-order step 5 - tenancy/tenantContext.js
// Ambient tenant context carried through async call chains (request handlers,
// the workflow engine, fire-and-forget notification/audit writers) via
// AsyncLocalStorage. The PostgreSQL repository reads it to auto-filter
// every query and stamp orgId on create.
//
// Request paths:  middleware/auth.js runs the rest of the request inside
//                 runWithOrgId(req.orgId, ...) after resolving the tenant.
// Non-request:    jobs (escalation cron) wrap per-org work explicitly.
// No context:     access requires an explicit backend service context.

const { AsyncLocalStorage } = require('node:async_hooks')
const { asId } = require('../database/ids')

const als = new AsyncLocalStorage()

const toId = (id) => {
  if (!id) return null
  return asId(id)
}

// Runs fn with orgId as the ambient tenant. Returns fn's result.
const runWithOrgId = (orgId, fn) => {
  const id = toId(orgId)
  const current = als.getStore()
  return als.run(current?.orgId === id ? current : { orgId: id }, fn)
}

// Only the registry resolver issues placements. A request/schema string is
// never a sufficient routing context; ordinary ID-only contexts remain usable
// for explicitly qualified provisioning operations, not model repositories.
const placements = new WeakSet()
const issuePlacement = placement => { const value = Object.freeze(placement); placements.add(value); return value }
const runWithPlacement = (placement, fn) => {
  if (!placements.has(placement)) throw Object.assign(new Error('Verified tenant placement required'), { code: 'DATABASE_SCOPE_REQUIRED' })
  return als.run({ orgId: placement.orgId, placement }, fn)
}
const getPlacement = () => als.getStore()?.placement || null

// The ambient tenant's orgId (string) or null when outside any context.
const getOrgId = () => {
  const store = als.getStore()
  return store ? store.orgId : null
}

module.exports = { runWithOrgId, getOrgId, issuePlacement, runWithPlacement, getPlacement }
