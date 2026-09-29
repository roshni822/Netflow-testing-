'use strict'
const { withSystemAccess } = require('../database/context')
const jobs = new Map()
let stopping = false
const active = new Set()
function track (promise) {
  active.add(promise)
  promise.then(() => active.delete(promise), () => active.delete(promise))
  return promise
}

function register (name, everyMs, work, timerFactory) {
  if (jobs.has(name)) return jobs.get(name)
  const state = { name, started: Date.now(), lastSuccess: null, failed: false, pending: null, everyMs }
  const run = () => {
    if (stopping || state.pending) return state.pending
    state.pending = Promise.resolve().then(() => withSystemAccess('worker', () => {
      if (require('../database/layout').organizationSchemas() && name !== 'outbox') return require('../database/fresh/workers').forEachTenant(name, work)
      return work()
    }))
      .then(result => {
        if (result?.error) throw new Error(result.error)
        state.lastSuccess = Date.now(); state.failed = false
      })
      .catch(error => { state.failed = true; console.error('Background job failed', { job: name, code: error.code || 'WORKER_FAILED' }) })
      .finally(() => { state.pending = null })
    return state.pending
  }
  state.timer = timerFactory(run)
  state.run = run
  jobs.set(name, state)
  return state
}
function interval (name, everyMs, work) {
  return register(name, everyMs, work, run => { const timer = setInterval(run, everyMs); timer.unref(); return { stop: () => clearInterval(timer) } })
}
function schedule (name, expression, everyMs, work) {
  return register(name, everyMs, work, run => require('node-cron').schedule(expression, run, { timezone: 'UTC', noOverlap: true }))
}
function snapshot () {
  return [...jobs.values()].map(state => ({
    name: state.name,
    healthy: !stopping && !state.failed && Date.now() - (state.lastSuccess || state.started) < Math.max(300000, state.everyMs * 3),
    running: Boolean(state.pending),
    lastSuccess: state.lastSuccess ? new Date(state.lastSuccess).toISOString() : null
  }))
}
async function stop () {
  stopping = true
  await Promise.all([...jobs.values()].map(state => state.timer.stop()))
  await Promise.all([...jobs.values()].map(state => state.pending).filter(Boolean))
  await Promise.allSettled([...active])
}
module.exports = { interval, schedule, snapshot, stop, track }
