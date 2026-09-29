// Licensing Phase 3 - jobs/usageCron.js
// Nightly reconciliation of the usage meters.
//
// The live counters are $inc'd at the point of use, which is fast and concurrent
// but drifts: a crash between writing a file and incrementing, a delete that
// bypassed the API, a restored backup. Drift in a number that blocks customers is
// not acceptable, so once a night the meters are rebuilt from the source of truth
// — the filesystem for storage, the collections for everything counted.
//
// It also does the two things that are otherwise only triggered by traffic: it
// rolls a submission window that elapsed while a quiet tenant was idle, and it
// re-evaluates the warning thresholds so a tenant sitting at 92% is told even if
// nobody submitted anything today.

const monitor = require('./monitor')

const Organization = require('../models/Organization')
const { measureOrg } = require('../utils/fileStore')
const { ensurePeriod } = require('../utils/usageMeter')
const { evaluateWarnings } = require('../utils/usageWarnings')
const { MB } = require('../utils/licensing')
const { readDmsStorageUsage } = require('../services/storageUsage')

// Reconciles one tenant. Returns what changed, for the log.
const reconcileOrg = async (org, { readRemoteStorage = readDmsStorageUsage } = {}) => {
  const changes = []

  const remote = await readRemoteStorage({ org })
  const remoteUnavailable = remote.configured && !remote.available
  const actual = remoteUnavailable
    ? null
    : remote.configured
    ? { bytes: remote.usedBytes, files: remote.documentCount ?? Number(org.usage?.fileCount || 0) }
    : measureOrg(org._id)
  const storedBytes = Number(org.usage?.storageBytes || 0)
  const storedFiles = Number(org.usage?.fileCount || 0)

  if (remoteUnavailable) {
    changes.push('DMS storage unavailable; kept last known usage')
  } else if (actual.bytes !== storedBytes || actual.files !== storedFiles) {
    const limitBytes = Number(org.limits?.maxStorageMb || 0) * MB
    await Organization.updateOne({ _id: org._id }, {
      $set: {
        'usage.storageBytes': actual.bytes,
        'usage.fileCount': actual.files,
        // Buffer usage only means anything above the licensed size; whatever is
        // now under the limit has been repaid by the deletes that freed it.
        'usage.bufferBytesUsed': limitBytes
          ? Math.max(0, Math.min(Number(org.usage?.bufferBytesUsed || 0), actual.bytes - limitBytes))
          : 0
      }
    })
    changes.push(
      `storage ${(storedBytes / MB).toFixed(1)}→${(actual.bytes / MB).toFixed(1)} MB, `
      + `files ${storedFiles}→${actual.files}`
    )
  }

  // Rolls the allowance for a tenant nobody touched this period.
  const period = org.usage?.submissions || {}
  const rolled = await ensurePeriod(org._id)
  if (rolled && String(rolled.periodStart) !== String(period.periodStart)) {
    changes.push(`submission window rolled to ${new Date(rolled.periodStart).toISOString().slice(0, 10)}`)
  }

  // Read back only when something moved, so warnings are judged on fresh numbers.
  const current = changes.length
    ? await Organization.findById(org._id).select('name plan limits usage billingEmail storageExtension').lean()
    : org
  const warned = await evaluateWarnings(current)
  warned.forEach((w) => changes.push(`warned: ${w.title}`))

  return changes
}

const reconcileUsage = async () => {
  const orgs = await Organization.find({})
    .select('name subdomain plan limits usage billingEmail storageExtension')
    .lean()

  let touched = 0
  let failures = 0
  for (const org of orgs) {
    try {
      const changes = await reconcileOrg(org)
      if (changes.length) {
        touched += 1
        console.log(`[usageCron] ${org.subdomain}: ${changes.join('; ')}`)
      }
    } catch (err) {
      failures++
      console.error(`[usageCron] ${org.subdomain} failed:`, err.message)
    }
  }
  if (touched) console.log(`[usageCron] reconciled ${touched} of ${orgs.length} tenant(s)`)
  return { scanned: orgs.length, touched, ...(failures ? { error: 'Usage reconciliation failed' } : {}) }
}

const startUsageCron = () => monitor.schedule('usage', '20 2 * * *', 86400000, reconcileUsage)

module.exports = { startUsageCron, reconcileUsage, reconcileOrg }
