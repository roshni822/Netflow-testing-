// DMS storage accounting regression coverage. The DMS client is injected with
// deterministic provider responses; persisted usage is written to harness-owned
// qa-* organizations in the real database.

const h = require('./lib/harness')
const { Organization } = h
const { reconcileOrg } = require('../jobs/usageCron')
const {
  readDmsStorageUsage,
  persistStorageUsage,
  withStorageUsage,
} = require('../services/storageUsage')

const MB = 1024 * 1024

h.runSuite('storage_usage', async () => {
  const org = await h.createOrg('storage-dms', {
    plan: 'custom',
    limits: { maxStorageMb: 100 },
    usage: { storageBytes: 0, fileCount: 0 }
  })
  const fakeDms = {
    isConfiguredFor: () => true,
    getStorageUsage: async () => ({
      source: 'documents_sum',
      usedBytes: 7 * MB,
      documentCount: 4,
      organizationId: 'dms-organization'
    })
  }

  const live = await readDmsStorageUsage({ org, client: fakeDms })
  h.check('STORAGE-001', 'Connected DMS usage keeps its real byte and document totals',
    live.configured === true && live.available === true
    && live.usedBytes === 7 * MB && live.documentCount === 4
    && live.source === 'documents_sum',
    JSON.stringify(live))

  const effective = withStorageUsage(org.toObject(), live)
  h.check('STORAGE-001', 'A live DMS snapshot replaces the stale dashboard counter',
    effective.usage.storageBytes === 7 * MB && effective.usage.fileCount === 4,
    JSON.stringify(effective.usage))

  await persistStorageUsage(org.toObject(), live)
  let stored = await Organization.findById(org._id).lean()
  h.check('STORAGE-002', 'DMS sync persists usage for quota and platform consumers',
    stored.usage.storageBytes === 7 * MB && stored.usage.fileCount === 4,
    `${stored.usage.storageBytes} bytes / ${stored.usage.fileCount} files`)

  await Organization.updateOne({ _id: org._id }, {
    $set: { 'usage.storageBytes': 0, 'usage.fileCount': 0 }
  })
  const changes = await reconcileOrg(await Organization.findById(org._id).lean(), {
    readRemoteStorage: async () => live
  })
  stored = await Organization.findById(org._id).lean()
  h.check('STORAGE-003', 'Nightly reconciliation uses DMS instead of local zero',
    stored.usage.storageBytes === 7 * MB && stored.usage.fileCount === 4
    && changes.some((change) => /storage 0\.0/.test(change)),
    `${stored.usage.storageBytes} bytes; ${changes.join('; ')}`)

  const unavailable = await readDmsStorageUsage({
    org,
    client: {
      isConfiguredFor: () => true,
      getStorageUsage: async () => { throw new Error('DMS offline') }
    }
  })
  const didPersist = await persistStorageUsage(stored, unavailable)
  const outageChanges = await reconcileOrg(stored, {
    readRemoteStorage: async () => unavailable
  })
  const afterFailure = await Organization.findById(org._id).lean()
  h.check('STORAGE-004', 'An unavailable DMS never replaces the last real total with zero',
    unavailable.configured === true && unavailable.available === false
    && didPersist === false && afterFailure.usage.storageBytes === 7 * MB
    && outageChanges.some((change) => /kept last known usage/.test(change)),
    `${unavailable.error?.message}; ${afterFailure.usage.storageBytes} bytes; ${outageChanges.join('; ')}`)

  const local = await readDmsStorageUsage({
    org,
    client: { isConfiguredFor: () => false }
  })
  h.check('STORAGE-005', 'An organization without DMS keeps the existing local accounting path',
    local.configured === false && local.available === true && local.source === 'netflow',
    JSON.stringify(local))
})
