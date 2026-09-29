const h = require('./lib/harness')
const PlatformBroadcast = require('../models/PlatformBroadcast')
const { runWithOrgId, Form, Workflow, AuditLog } = h

const SA_EMAIL = (process.env.ADMIN_EMAIL || 'superadmin@netflow.app').toLowerCase()
const SA_PASS = process.env.ADMIN_PASSWORD || 'Super@12345'

h.runSuite('platform_dashboard', async () => {
  const saTok = await h.getToken({ email: SA_EMAIL, password: SA_PASS })
  if (!saTok) {
    h.check('PDASH-000', 'SuperAdmin token obtained', false, 'seed superadmin first')
    return
  }

  const org = await h.createOrg('dashboard', {
    features: { externalUsers: true },
    integrations: { dmsEnabled: true, s3: { enabled: true } }
  })
  const manager = await h.createUser(org, {
    name: 'Dashboard Manager',
    email: h.emailIn(org, 'dashboard-manager'),
    roleName: 'Manager',
    canBuild: true
  })
  const managerTok = await h.getToken({ email: manager.email, subdomain: org.subdomain })

  await runWithOrgId(org._id, async () => {
    await Form.create({ title: 'Dashboard Form', fields: [], status: 'published', createdBy: manager._id })
    await Workflow.create({ title: 'Dashboard Workflow', nodes: [], edges: [], status: 'published', createdBy: manager._id })
  })

  const guarded = await h.api('GET', '/platform/overview', managerTok)
  h.check('PDASH-001', 'Overview is SuperAdmin-only', guarded.status === 403, `got ${guarded.status}`)

  const overview = await h.api('GET', '/platform/overview', saTok)
  const rows = overview.body?.adoption || []
  const row = (key) => rows.find((item) => item.key === key)
  h.check('PDASH-002', 'Overview returns persisted fleet metrics', overview.status === 200 && overview.body?.metrics?.activeUsers >= 1)
  h.check('PDASH-003', 'Overview derives product adoption from real records', ['forms', 'workflows', 'builders', 'dms', 's3', 'externalUsers'].every((key) => row(key)?.organizations >= 1), JSON.stringify(rows))
  h.check('PDASH-004', 'Adoption percentages use the declared denominator', rows.every((item) => item.percentage === (overview.body.adoptionDenominator ? Math.round(item.organizations / overview.body.adoptionDenominator * 100) : 0)))

  const invalidRange = await h.api('GET', '/platform/historical-stats?range=2Y', saTok)
  h.check('PDASH-005', 'Historical endpoint rejects invalid ranges', invalidRange.status === 400 && invalidRange.body?.code === 'INVALID_RANGE')

  await AuditLog.create({ action: 'org_created', performedBy: manager._id, targetEntity: org.name, detail: 'QA dashboard lifecycle event' })
  const history = await h.api('GET', '/platform/historical-stats?range=3M', saTok)
  const latest = history.body?.snapshots?.at(-1)
  h.check('PDASH-006', 'Lifecycle history is zero-filled and event-derived', history.status === 200 && history.body.snapshots.length === 3 && latest?.metrics?.newOrgs >= 1, JSON.stringify(history.body))

  const unauthenticated = await h.api('GET', '/broadcasts/active')
  h.check('PDASH-007', 'Active broadcast requires authentication', unauthenticated.status === 401)
  const blocked = await h.api('POST', '/platform/broadcast', managerTok, { message: 'No', severity: 'info', expiresAt: new Date(Date.now() + 3600000) })
  h.check('PDASH-008', 'Non-SuperAdmin cannot publish broadcasts', blocked.status === 403)
  const invalidBroadcast = await h.api('POST', '/platform/broadcast', saTok, { message: '', severity: 'info', expiresAt: new Date(Date.now() + 3600000) })
  h.check('PDASH-009', 'Broadcast validation rejects empty messages', invalidBroadcast.status === 400)

  const marker = `QA dashboard broadcast ${Date.now()}`
  const created = await h.api('POST', '/platform/broadcast', saTok, { message: marker, severity: 'warning', expiresAt: new Date(Date.now() + 3600000) })
  const active = await h.api('GET', '/broadcasts/active', managerTok)
  h.check('PDASH-010', 'Authenticated tenant users receive the active broadcast', created.status === 201 && active.body?.broadcast?.message === marker)
  const audit = await AuditLog.findOne({ action: 'platform_broadcast_sent', 'metadata.broadcastId': String(created.body?.broadcast?._id) }).setOptions({ skipOrgScope: true }).lean()
  h.check('PDASH-011', 'Publishing a broadcast writes an audit event', Boolean(audit))

  await PlatformBroadcast.updateOne({ _id: created.body.broadcast._id }, { $set: { expiresAt: new Date(Date.now() - 1000) } })
  const expired = await h.api('GET', '/broadcasts/active', managerTok)
  h.check('PDASH-012', 'Expired broadcasts are not returned', expired.body?.broadcast == null)
  await PlatformBroadcast.deleteMany({ message: marker })
})
