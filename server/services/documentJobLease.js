'use strict'
const { AsyncLocalStorage } = require('node:async_hooks')
const lease = new AsyncLocalStorage()
function filter (id) {
  const current = lease.getStore()
  return current && String(id) === String(current.job._id)
    ? { _id: id, attempts: current.job.attempts, status: { $in: current.states }, expiresAt: { $gt: new Date() } }
    : { _id: id, status: { $ne: 'cancelled' } }
}
const lost = () => Object.assign(new Error('Document processing lease ended'), { code: 'DOCUMENT_LEASE_LOST' })
async function run (Model, job, states, work) {
  return lease.run({ job, states }, async () => {
    let pending = null
    const timer = setInterval(() => {
      if (pending) return
      pending = Model.updateOne(filter(job._id), { $set: { claimedAt: new Date() } }).exec()
        .catch(error => console.error('Document lease renewal failed', { code: error.code || 'LEASE_RENEWAL_FAILED' }))
        .finally(() => { pending = null })
    }, 60000)
    timer.unref()
    try { return await work() }
    finally { clearInterval(timer); if (pending) await pending }
  })
}
module.exports = { filter, run, lost }
