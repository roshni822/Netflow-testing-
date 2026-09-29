'use strict'
const { AsyncLocalStorage } = require('node:async_hooks')
const access = new AsyncLocalStorage()
const transactions = new AsyncLocalStorage()
const reasons = new Set(['authentication', 'public-form', 'webhook', 'signed-file', 'platform', 'worker', 'startup', 'migration', 'test'])
function withSystemAccess (reason, fn) {
  if (!reasons.has(reason)) throw new Error('Invalid database access purpose')
  return access.run({ system: reason }, fn)
}
function currentAccess () {
  const { getOrgId, getPlacement } = require('../tenancy/tenantContext')
  const org = getOrgId()
  const placement = getPlacement()
  return org ? { org: String(org), ...(placement ? { schema: placement.schemaName, version: placement.version } : {}), ...(access.getStore()?.system === 'worker' ? { system: 'worker' } : {}) } : access.getStore() || {}
}
function trackBackground (promise) {
  const state = transactions.getStore()
  if (state) {
    state.pending.add(promise)
    promise.then(() => state.pending.delete(promise), error => { state.pending.delete(promise); state.error = error })
  }
  return promise
}
module.exports = { withSystemAccess, currentAccess, transactions, trackBackground }
