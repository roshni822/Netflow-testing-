'use strict'
// Fixtures exist only in a new disposable local PostgreSQL cluster. This suite
// never loads .env, connects to MongoDB, or uses a configured Supabase project.
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const { localCluster } = require('./localCluster')
const { catalog } = require('../../database/catalog')
const { withSystemAccess } = require('../../database/context')
const { applySchema, schemaFile } = require('../../database/setup')
const { bootstrap } = require('../../database/bootstrap')
const postgres = require('../../database/postgres')

async function main () {
  delete process.env.DATABASE_PROVIDER // Verify PostgreSQL works as the default.
  for (const packageName of ['mongoose', 'mongodb', 'bson']) assert.throws(() => require.resolve(packageName), 'MongoDB packages must be absent')
  require('./setupConfig.test').setupConfigChecks()
  require('./startupError.test')
  await require('./modelContracts').modelContractChecks()
  const cluster = await localCluster()
  try {
    assert.equal(require('../../database/schema').generateSchema(), fs.readFileSync(schemaFile, 'utf8'))
    assert.deepEqual(await applySchema(cluster.owner), { applied: true })
    assert.deepEqual(await applySchema(cluster.owner), { alreadyApplied: true })
    assert.equal((await cluster.owner.query("SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema='netflow_migration'")).rows[0].n, 1, 'Only schema version metadata remains')
    await cluster.owner.query(fs.readFileSync(path.join(__dirname, '../../database/provision-runtime.sql'), 'utf8'))
    await cluster.owner.query('GRANT netflow_app TO netflow_verification_app')
    process.env.DATABASE_URL = cluster.appURL
    await require('../../config/db')()
    const credentials = { name: 'Isolated Test Administrator', email: 'platform@qa.test', password: crypto.randomBytes(24).toString('base64url') }
    await assert.rejects(bootstrap({ ...credentials, password: '' }), error => error.code === 'ADMIN_PASSWORD_REQUIRED')
    await assert.rejects(bootstrap({ ...credentials, email: '' }), error => error.code === 'ADMIN_IDENTITY_REQUIRED')
    assert.equal((await bootstrap(credentials)).created, true)
    assert.equal((await bootstrap({ ...credentials, password: crypto.randomBytes(24).toString('hex') })).alreadyConfigured, true)
    await withSystemAccess('test', async () => {
      const models = catalog()
      assert.equal(await models.Organization.model.countDocuments(), 1)
      assert.equal(await models.User.model.countDocuments(), 1)
      assert.equal(await models.Role.model.countDocuments(), 1)
      assert.equal(await models.Plan.model.countDocuments(), 5)
      for (const spec of Object.values(models).filter(spec => !['Organization', 'User', 'Role', 'Plan'].includes(spec.name))) assert.equal(await spec.model.countDocuments(), 0, spec.name + ' starts empty')
      const admin = await models.User.model.findOne({ email: credentials.email })
      assert.ok(await admin.comparePassword(credentials.password), 'Idempotent setup never resets passwords')
      await assert.rejects(bootstrap({ ...credentials, email: 'different@qa.test' }), error => error.code === 'DATABASE_NOT_EMPTY')
    })
    console.log('PASS: empty PostgreSQL setup, schema retry, required administrator credentials, idempotent bootstrap and no demo/business data')

    const tenantPassword = crypto.randomBytes(24).toString('base64url')
    const baseline = await withSystemAccess('test', async () => {
      const models = Object.fromEntries(Object.entries(catalog()).map(([name, spec]) => [name, spec.model]))
      const { Organization, User, Form, Workflow, WorkflowExecution, Task } = models
      const organizations = []
      const admins = []
      for (const suffix of ['one', 'two']) {
        const org = await Organization.create({ name: 'Isolated test ' + suffix, subdomain: 'qa-fresh-' + suffix, plan: 'basic', features: { externalUsers: true } })
        const roles = await require('../../utils/roleProvisioning').ensureRolesForOrganization(org._id, { force: true })
        const admin = await User.create({ orgId: org._id, name: 'Test administrator', email: 'admin@qa.test', password: tenantPassword, department: 'IT', role: roles.get('admin')._id, canBuild: true })
        organizations.push(org); admins.push(admin)
      }
      await User.create({ orgId: organizations[0]._id, name: 'Test colleague', email: 'member@qa.test', password: tenantPassword, department: 'IT', role: admins[0].role })
      const forms = []
      for (let i = 0; i < 3; i++) forms.push(await Form.create({ orgId: organizations[0]._id, title: 'Isolated form ' + i, createdBy: admins[0]._id, fields: [{ id: 'name', type: 'text', label: 'Name' }] }))
      const workflow = await Workflow.create({ orgId: organizations[0]._id, title: 'Isolated workflow', createdBy: admins[0]._id, linkedFormId: forms[0]._id, linkedFormIds: [forms[0]._id], nodes: [{ id: 'start', type: 'start' }, { id: 'end', type: 'end' }], edges: [{ id: 'edge', source: 'start', target: 'end' }] })
      const execution = await WorkflowExecution.create({ orgId: organizations[0]._id, workflowId: workflow._id, triggeredBy: admins[0]._id })
      await Task.create({ orgId: organizations[0]._id, workflowId: workflow._id, workflowExecutionId: execution._id, assignedTo: admins[0]._id, submittedBy: admins[0]._id, title: 'Isolated task', type: 'approval' })
      return { counts: Object.fromEntries(await Promise.all(Object.values(catalog()).map(async spec => [spec.collection, await spec.model.countDocuments()]))), users: await User.find({}).lean() }
    })
    const { Client } = require('pg')
    const runtime = new Client({ connectionString: cluster.appURL })
    await runtime.connect()
    try {
      assert.equal((await runtime.query('SELECT count(*)::int AS n FROM netflow.users')).rows[0].n, 0)
      assert.equal((await runtime.query('SELECT count(*)::int AS n FROM netflow_private.user_auth')).rows[0].n, 0)
    } finally { await runtime.end() }
    await postgres.close()
    await require('./repositories').repositoryChecks(baseline, cluster.appURL)
    await require('./http').httpChecks(cluster.owner, cluster.appURL, { email: 'admin@qa.test', password: tenantPassword, subdomain: 'qa-fresh-one' })
    await require('./releaseControls').releaseControlChecks()
    await require('./tenantLifecycle').tenantLifecycleChecks(cluster.appURL)
    console.log('PASS: fresh-database suite; MongoDB was never read or connected')
  } finally { await postgres.close(); await cluster.stop() }
}

main().catch(error => {
  console.error(JSON.stringify({ failed: true, name: error.name, code: error.code, table: error.table, constraint: error.constraint, assertion: error.code === 'ERR_ASSERTION' ? error.message.split('\n')[0] : undefined, message: error.code ? undefined : error.message }))
  process.exitCode = 1
})
