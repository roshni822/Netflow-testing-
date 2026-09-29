'use strict'
const assert = require('node:assert/strict')
const { catalog } = require('../../database/catalog')
const { withSystemAccess } = require('../../database/context')
const { runWithOrgId } = require('../../tenancy/tenantContext')

async function repositoryChecks (baseline, appURL) {
  process.env.DATABASE_URL = appURL
  const postgres = require('../../database/postgres')
  await postgres.connect()
  try {
    await assert.rejects(catalog().User.model.countDocuments(), /requires a tenant/)
    await withSystemAccess('test', async () => {
      for (const spec of Object.values(catalog())) {
        assert.equal(await spec.model.countDocuments(), baseline.counts[spec.collection], spec.name + ' count')
        const documents = await spec.model.find({}).sort({ _id: 1 }).limit(3).lean()
        assert.equal(documents.length, Math.min(3, baseline.counts[spec.collection]), spec.name + ' page')
      }
      const { User, Form, Workflow, Task, WorkflowExecution } = Object.fromEntries(Object.entries(catalog()).map(([name, spec]) => [name, spec.model]))
      const raw = baseline.users
      const loginFields = await User.findOne({}).select('+failedLoginAttempts +lockUntil').populate('role')
      assert.ok(loginFields.name && loginFields.password && loginFields.department, 'Selecting hidden login fields preserves ordinary user fields')
      assert.equal(loginFields.failedLoginAttempts, 0)
      const selected = await User.findOne({}).select('name email role').populate('role', 'name').lean()
      assert.ok(selected._id && selected.name)
      assert.equal(selected.password, undefined)
      const hydrated = await User.findById(selected._id).select('-password').populate('role')
      assert.ok(hydrated.toObject)
      assert.equal(hydrated.password, undefined)
      const passwordBefore = await User.findById(selected._id).lean()
      hydrated.name = hydrated.name
      await hydrated.save()
      assert.equal((await User.findById(selected._id).lean()).password, passwordBefore.password, 'Projected save preserves password hash')
      const active = raw.filter(u => u.isActive !== false).length
      assert.equal(await User.countDocuments({ isActive: { $ne: false } }), active)
      assert.equal(await User.countDocuments({ _id: { $in: raw.slice(0, 3).map(u => u._id) } }), 3)
      const byDepartment = await User.aggregate([{ $group: { _id: '$department', count: { $sum: 1 } } }])
      assert.equal(byDepartment.reduce((sum, r) => sum + r.count, 0), raw.length)
      const forms = await Form.find({ title: /./i }).sort({ updatedAt: -1 }).skip(1).limit(2).lean()
      assert.equal(forms.length, 2)
      await Workflow.find({ 'nodes.config.approverRole': 'Admin' }).lean()
      await Workflow.find({ 'access.allowedInitiators': { $in: raw.slice(0, 1).map(u => u._id) } }).lean()
      const status = await Task.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }])
      assert.equal(status.reduce((sum, r) => sum + r.count, 0), baseline.counts.tasks)
      await WorkflowExecution.aggregate([
        { $match: { status: 'completed', completedAt: { $ne: null } } },
        { $group: { _id: { year: { $year: '$createdAt' }, month: { $month: '$createdAt' } }, avgMs: { $avg: { $subtract: ['$completedAt', '$createdAt'] } }, count: { $sum: 1 } } },
        { $sort: { '_id.year': 1, '_id.month': 1 } }
      ])
      const facets = await WorkflowExecution.aggregate([{ $facet: {
        live: [{ $match: { status: 'running' } }, { $group: { _id: '$workflowId', count: { $sum: 1 } } }],
        durations: [{ $project: { _id: 0, durationMs: { $subtract: ['$completedAt', '$startedAt'] } } }, { $match: { durationMs: { $gte: 0 } } }]
      } }])
      assert.ok(Array.isArray(facets[0].live))
      await Task.aggregate([
        { $lookup: { from: 'users', localField: 'submittedBy', foreignField: '_id', as: 'submitter' } },
        { $unwind: { path: '$submitter', preserveNullAndEmptyArrays: false } },
        { $group: { _id: '$submitter.department', count: { $sum: 1 } } }
      ])
      // Concurrent atomic increments cannot lose updates on the same account.
      const target = raw.find(u => u.email === 'member@qa.test')
      assert.ok(target, 'Isolated tenant member is available for mutation tests')
      const colleague = raw.find(u => u.orgId === target.orgId && u._id !== target._id)
      assert.ok(colleague, 'Same-tenant colleague is available for relation tests')
      {
        const editing = await User.findById(target._id)
        editing.managerId = colleague._id
        await editing.populate({ path: 'managerId', select: 'name role', populate: { path: 'role', select: 'name' } })
        assert.ok(editing.managerId.role.name, 'Nested relation loads')
        assert.ok(editing.isModified('managerId'), 'Population preserves an unsaved reference change')
        await editing.save()
        assert.equal((await User.findById(target._id).lean()).managerId, colleague._id)
      }
      const task = await Task.findOne({})
      task.approvalHistory.push({ action: 'approved', performedBy: task.assignedTo, comment: 'Isolated approval' })
      task.parallelApprovers = [task.assignedTo]
      await task.save()
      const detailed = await Task.findById(task._id).populate('approvalHistory.performedBy', 'name').populate('parallelApprovers', 'name')
      assert.ok(detailed.approvalHistory[0].performedBy.name, 'Embedded relation loads')
      assert.ok(detailed.parallelApprovers[0].name, 'Array relation loads')
      assert.ok(detailed.approvalHistory[0].performedAt instanceof Date, 'Appended child receives timestamp default')
      assert.match(detailed.approvalHistory[0]._id, /^[a-f0-9]{24}$/)
      detailed.title = 'Updated after loading relations'
      await detailed.save()
      assert.equal((await Task.findById(task._id).lean()).approvalHistory[0].performedBy, String(task.assignedTo), 'Saving preserves reference IDs')
      await Task.updateOne({ _id: task._id }, { $push: { approvalHistory: { action: 'reassigned', performedBy: task.assignedTo } } })
      const pushed = await Task.findById(task._id).lean()
      assert.ok(pushed.approvalHistory[1].performedAt instanceof Date, 'Atomic push receives embedded defaults')
      const previous = (await User.findById(target._id).lean()).tokenVersion || 0
      await Promise.all(Array.from({ length: 4 }, () => User.updateOne({ _id: target._id }, { $inc: { tokenVersion: 1 } })))
      assert.equal((await User.findById(target._id).lean()).tokenVersion, previous + 4)
      const left = await User.findById(target._id)
      const right = await User.findById(target._id)
      left.needsProductTour = !left.needsProductTour
      await left.save()
      right.needsProductTour = !right.needsProductTour
      await assert.rejects(right.save(), error => error.code === 'CONCURRENT_UPDATE')
      await runWithOrgId(target.orgId, async () => {
        const expected = raw.filter(u => String(u.orgId) === String(target.orgId)).length
        assert.equal(await User.countDocuments(), expected)
        const foreign = raw.find(u => u.orgId && String(u.orgId) !== String(target.orgId))
        if (foreign) {
          assert.equal(await User.findById(foreign._id).setOptions({ skipOrgScope: true }).lean(), null, 'RLS cannot be bypassed with a repository option')
          const inaccessible = User.fromRow({ _id: target._id, managerId: foreign._id })
          await inaccessible.populate('managerId')
          assert.equal(inaccessible.managerId, null, 'Population cannot expose another tenant')
          assert.equal(inaccessible.isModified('managerId'), false, 'An inaccessible relation does not become a pending write')
        }
      })
      const beforeRollback = (await User.findById(target._id).lean()).tokenVersion
      await assert.rejects(postgres.transaction(async () => {
        await User.updateOne({ _id: target._id }, { $inc: { tokenVersion: 10 } })
        throw new Error('Deliberate isolated rollback')
      }), /Deliberate isolated rollback/)
      assert.equal((await User.findById(target._id).lean()).tokenVersion, beforeRollback)
      const outbox = require('../../database/outbox')
      await assert.rejects(postgres.transaction(async () => {
        await outbox.enqueue('email', { to: target.email }, 'isolated-rollback')
        throw new Error('Deliberate outbox rollback')
      }), /Deliberate outbox rollback/)
      await postgres.transaction(async client => {
        assert.equal((await client.query("SELECT count(*)::int AS n FROM netflow_private.outbox WHERE event_key='isolated-rollback'")).rows[0].n, 0)
        await outbox.enqueue('email', { to: target.email }, 'isolated-commit')
        await outbox.enqueue('email', { to: target.email }, 'isolated-commit')
      })
      let deliveries = 0
      await outbox.drain(async () => { deliveries++ }) // Local capture only; no SMTP/network.
      assert.equal(deliveries, 1, 'Durable event key deduplicates retries')
      const secondDrain = await outbox.drain(async () => { deliveries++ })
      assert.equal(secondDrain, 0)
      // New relations validate even while edits preserve old dangling references.
      await assert.rejects(User.updateOne({ _id: target._id }, { $set: { managerId: '000000000000000000000000' } }), error => error.code === 'INVALID_REFERENCE')
      const userBeforePassword = await User.findById(target._id)
      const existingHash = userBeforePassword.password
      const testPassword = require('node:crypto').randomBytes(24).toString('base64url')
      userBeforePassword.password = testPassword
      await userBeforePassword.save()
      const passwordChanged = await User.findById(target._id)
      assert.ok(await passwordChanged.comparePassword(testPassword), 'Existing bcrypt validation and hashing are preserved')
      assert.notEqual(passwordChanged.password, existingHash)
      assert.equal(passwordChanged.toJSON().password, undefined)
    })
    console.log('PASS: PostgreSQL repositories, population, projections, aggregates, tenant isolation, atomic increments and concurrent-save rejection')
  } finally { await postgres.close() }
}
module.exports = { repositoryChecks }
