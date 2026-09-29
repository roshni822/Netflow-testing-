'use strict'
const assert = require('node:assert/strict')
const { catalog } = require('../../database/catalog')
const { withSystemAccess } = require('../../database/context')
const { runWithOrgId } = require('../../tenancy/tenantContext')

async function tenantLifecycleChecks (appURL) {
  process.env.DATABASE_URL = appURL
  const postgres = require('../../database/postgres')
  const operations = require('../../database/operations')
  await postgres.connect()
  try {
    await withSystemAccess('test', async () => {
      const Organization = catalog().Organization.model
      const org = await Organization.findOne({ isDefault: { $ne: true } }).lean()
      assert.ok(org, 'An isolated test tenant is required')
      const models = operations.tenantModels()
      const before = Object.fromEntries(await Promise.all(models.map(async model => [model.modelName, await model.countDocuments({ orgId: org._id })])))
      const foreignBefore = await catalog().User.model.countDocuments({ orgId: { $ne: org._id } })
      const organizationsBefore = await Organization.countDocuments()
      // Local queue row only: no delivery worker or external endpoint is called.
      await runWithOrgId(org._id, () => require('../../database/outbox').enqueue('email', {}, 'isolated-tenant-lifecycle'))
      assert.equal((await operations.exportTenantOutbox(org._id)).length, 1)
      for (const model of models) {
        assert.equal((await operations.exportTenantModel(model.modelName, org._id)).length, before[model.modelName], model.modelName + ' backup coverage')
      }
      await assert.rejects(postgres.transaction(async () => {
        await operations.deleteTenant(org._id)
        throw new Error('Deliberate tenant deletion rollback')
      }), error => {
        if (error.message !== 'Deliberate tenant deletion rollback') throw error
        return true
      })
      for (const model of models) assert.equal(await model.countDocuments({ orgId: org._id }), before[model.modelName], model.modelName + ' rollback')
      assert.equal(await Organization.countDocuments(), organizationsBefore)
      assert.equal((await operations.exportTenantOutbox(org._id)).length, 1)
      const deleted = await operations.deleteTenant(org._id)
      assert.equal(deleted, Object.values(before).reduce((sum, count) => sum + count, 0))
      for (const model of models) assert.equal((await operations.exportTenantModel(model.modelName, org._id)).length, 0, model.modelName + ' deletion coverage')
      assert.equal(await Organization.findById(org._id), null)
      assert.equal((await operations.exportTenantOutbox(org._id)).length, 0)
      assert.equal(await catalog().User.model.countDocuments({ orgId: { $ne: org._id } }), foreignBefore, 'Other tenant users survive')
    })
    console.log('PASS: complete tenant backup/export, atomic deletion rollback, owned data removal and other-tenant preservation on disposable test database')
  } finally { await postgres.close() }
}
module.exports = { tenantLifecycleChecks }
