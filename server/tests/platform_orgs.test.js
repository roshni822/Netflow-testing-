// PLAT — Platform Super Admin org management (complements the OADM suite).
// Suspend/activate + lockout, edit, usage counters, duplicate/invalid subdomain,
// reset-admin-password + session invalidation, default-org guards, cascade
// delete + backup on disk. Nav/route-guard/dialog/clipboard cases are frontend.

const fs = require('fs')
const path = require('path')
const { newId } = require('../database/ids')
const h = require('./lib/harness')
const { runWithOrgId, User, Form, Organization } = h

const SA_EMAIL = (process.env.ADMIN_EMAIL || 'superadmin@netflow.app').toLowerCase()
const SA_PASS = process.env.ADMIN_PASSWORD || 'Super@12345'

let subSeq = 0
const qaSub = (label) => `${h.QA_SUB_PREFIX}plat-${label}-${Date.now().toString(36)}-${subSeq++}`

h.runSuite('platform_orgs', async () => {
  const saTok = await h.getToken({ email: SA_EMAIL, password: SA_PASS })
  if (!saTok) { h.check('PLAT-000', 'SuperAdmin token obtained (seed superadmin first)', false, 'no token'); return }

  // Nav visibility, the client route guard, the dialogs and the clipboard copy
  // are asserted in ui_platform.test.js, which upgrades these to Pass.
  for (const tc of ['PLAT-001', 'PLAT-002', 'PLAT-008', 'PLAT-014', 'PLAT-023', 'PLAT-024']) {
    h.note(tc, 'Pending', 'Frontend: covered by ui_platform.test.js')
  }

  // PLAT-003 API guard — a non-SuperAdmin is forbidden.
  const guardOrg = await h.createOrg('plat-guard')
  const guardMgr = await h.createUser(guardOrg, { name: 'Plat Guard Mgr', email: h.emailIn(guardOrg, 'plat-guard-mgr'), roleName: 'Manager' })
  const guardTok = await h.getToken({ email: guardMgr.email })
  const guarded = await h.api('GET', '/platform/orgs', guardTok)
  h.check('PLAT-003', 'Non-SuperAdmin blocked from /api/platform/orgs (403)', guarded.status === 403, `got ${guarded.status}`)
  const guardedIntegrationTest = await h.api('POST', '/platform/integrations/test', guardTok, {
    integration: 's3', config: {}
  })
  h.check('PLAT-003b', 'Non-SuperAdmin blocked from integration tests (403)',
    guardedIntegrationTest.status === 403, `got ${guardedIntegrationTest.status}`)

  const invalidS3Test = await h.api('POST', '/platform/integrations/test', saTok, {
    integration: 's3', config: { bucket: 'missing-credentials' }
  })
  h.check('PLAT-003c', 'S3 connection test validates required configuration',
    invalidS3Test.status === 400 && invalidS3Test.body?.code === 'INVALID_INTEGRATION_CONFIG',
    `status=${invalidS3Test.status} code=${invalidS3Test.body?.code}`)

  const missingEditOrgTest = await h.api('POST', '/platform/integrations/test', saTok, {
    integration: 'dms',
    orgId: newId(),
    config: {}
  })
  h.check('PLAT-003e', 'Existing-tenant connection tests reject unknown organizations',
    missingEditOrgTest.status === 404 && missingEditOrgTest.body?.code === 'ORG_NOT_FOUND',
    `status=${missingEditOrgTest.status} code=${missingEditOrgTest.body?.code}`)

  const invalidIntegrationSub = qaSub('invalid-integration')
  const invalidIntegrationCreate = await h.api('POST', '/platform/orgs', saTok, {
    name: 'QA Invalid Integration',
    subdomain: invalidIntegrationSub,
    adminEmail: `plat-invalid-integration@${h.QA_EMAIL_DOMAIN}`,
    integrations: { s3: { enabled: true, bucket: 'missing-credentials' } }
  })
  const invalidIntegrationOrg = await Organization.findOne({ subdomain: invalidIntegrationSub })
    .setOptions({ skipOrgScope: true }).lean()
  h.check('PLAT-003d', 'Failed integration validation writes no organization',
    invalidIntegrationCreate.status === 400 && !invalidIntegrationOrg,
    `status=${invalidIntegrationCreate.status} persisted=${Boolean(invalidIntegrationOrg)}`)

  // PLAT-004 org list loads.
  const list0 = await h.api('GET', '/platform/orgs', saTok)
  h.check('PLAT-004', 'Organizations list loads for SuperAdmin', list0.status === 200 && Array.isArray(list0.body?.orgs), `status ${list0.status}`)

  const managedList = await h.api('GET', '/platform/orgs?page=1&limit=2&sort=name', saTok)
  const managedNames = (managedList.body?.orgs || []).map((org) => org.name)
  const sortedNames = [...managedNames].sort((a, b) => a.localeCompare(b))
  h.check('PLAT-004', 'Management list returns real summary and pagination metadata',
    managedList.status === 200 &&
      managedList.body?.summary?.total === (list0.body?.orgs || []).length &&
      managedList.body?.pagination?.limit === 2 &&
      Array.isArray(managedList.body?.filterOptions?.plans),
    `status ${managedList.status}, summary ${managedList.body?.summary?.total}, legacy ${(list0.body?.orgs || []).length}`)
  h.check('PLAT-004', 'Management list applies deterministic server-side name sorting',
    managedNames.every((name, index) => name === sortedNames[index]),
    `names ${managedNames.join(', ')}`)
  h.check('PLAT-004', 'No-query organization list remains backward compatible',
    !Object.prototype.hasOwnProperty.call(list0.body || {}, 'pagination'),
    'legacy response unexpectedly became paginated')

  // PLAT-005 default org hidden.
  h.check('PLAT-005', 'Default organization is hidden from the list', (list0.body?.orgs || []).every((o) => o.isDefault !== true), 'a default org appeared')

  // PLAT-009 create a valid org + admin (one-time credentials returned).
  const sub1 = qaSub('main')
  const admEmail1 = `plat-admin-1@${h.QA_EMAIL_DOMAIN}`
  const created = await h.api('POST', '/platform/orgs', saTok, {
    name: 'QA Plat Main',
    subdomain: sub1,
    adminEmail: admEmail1,
    adminName: 'Plat Admin One',
    pdfAutoFillEntitlementOverride: true
  })
  const org1Id = created.body?.org?._id
  h.check('PLAT-009', 'Create org + admin returns 201 with one-time password', created.status === 201 && !!org1Id && !!created.body?.admin?.tempPassword, `status ${created.status}, temp ${!!created.body?.admin?.tempPassword}`)
  h.check('PLAT-009b', 'Default bootstrap admin bills seats and can build',
    created.body?.admin?.canBuild === true && created.body?.admin?.countsTowardSeats === true,
    `canBuild=${created.body?.admin?.canBuild} seats=${created.body?.admin?.countsTowardSeats}`)
  h.check('PLAT-009e', 'SuperAdmin can explicitly entitle a custom-plan tenant to PDF auto-fill',
    created.body?.org?.plan === 'custom' && created.body?.org?.pdfAutoFill?.entitlementOverride === true,
    `plan=${created.body?.org?.plan} override=${created.body?.org?.pdfAutoFill?.entitlementOverride}`)

  // Complimentary bootstrap admin: can build but does not consume plan seats.
  const freeSub = qaSub('freeadmin')
  const freeEmail = `plat-free-admin@${h.QA_EMAIL_DOMAIN}`
  const freeOrg = await h.api('POST', '/platform/orgs', saTok, {
    name: 'QA Plat Free Admin',
    subdomain: freeSub,
    adminEmail: freeEmail,
    adminName: 'Free Admin',
    plan: 'trial',
    adminCanBuild: true,
    countAdminTowardSeats: false
  })
  const freeOrgId = freeOrg.body?.org?._id
  h.check('PLAT-009c', 'Create org with complimentary admin returns 201',
    freeOrg.status === 201 && !!freeOrgId && freeOrg.body?.admin?.countsTowardSeats === false,
    `status ${freeOrg.status}, seats=${freeOrg.body?.admin?.countsTowardSeats}`)
  if (freeOrgId) {
    const { countUsers, countBuilders } = require('../utils/usage')
    const seatedUsers = await countUsers(freeOrgId)
    const seatedBuilders = await countBuilders(freeOrgId)
    h.check('PLAT-009d', 'Complimentary admin is excluded from user/builder meters',
      seatedUsers === 0 && seatedBuilders === 0,
      `users=${seatedUsers} builders=${seatedBuilders}`)
  }

  const invalidOverride = await h.api('POST', '/platform/orgs', saTok, {
    name: 'QA Plat Invalid Entitlement',
    subdomain: qaSub('invalid-entitlement'),
    adminEmail: `plat-invalid-entitlement@${h.QA_EMAIL_DOMAIN}`,
    plan: 'trial',
    pdfAutoFillEntitlementOverride: true
  })
  h.check('PLAT-009f', 'Per-tenant PDF entitlement override is rejected for sellable plans',
    invalidOverride.status === 400 && invalidOverride.body?.code === 'INVALID_ENTITLEMENT_OVERRIDE',
    `status=${invalidOverride.status} code=${invalidOverride.body?.code}`)

  const plans = await h.api('GET', '/platform/plans', saTok)
  h.check('PLAT-009g', 'Plan API exposes PDF auto-fill entitlement for every sellable plan',
    plans.status === 200 && (plans.body?.plans || []).length > 0 &&
      plans.body.plans.every((plan) => typeof plan.features?.pdfAutoFill === 'boolean'),
    `status=${plans.status} plans=${plans.body?.plans?.length || 0}`)

  const disposablePlanKey = `qa-pdf-plan-${Date.now().toString(36)}`
  try {
    const createdPlan = await h.api('POST', '/platform/plans', saTok, {
      key: disposablePlanKey,
      label: 'QA PDF Feature Plan',
      limits: {}
    })
    h.check('PLAT-009h', 'New plans include PDF auto-fill by default',
      createdPlan.status === 201 && createdPlan.body?.plan?.features?.pdfAutoFill === true,
      `status=${createdPlan.status} feature=${createdPlan.body?.plan?.features?.pdfAutoFill}`)

    const updatedPlan = await h.api('PUT', `/platform/plans/${disposablePlanKey}`, saTok, {
      features: { pdfAutoFill: false }
    })
    h.check('PLAT-009i', 'SuperAdmin can update a plan PDF auto-fill entitlement',
      updatedPlan.status === 200 && updatedPlan.body?.plan?.features?.pdfAutoFill === false,
      `status=${updatedPlan.status} feature=${updatedPlan.body?.plan?.features?.pdfAutoFill}`)
  } finally {
    await h.api('DELETE', `/platform/plans/${disposablePlanKey}`, saTok)
  }

  // PLAT-006 admin email is shown per org.
  const listAfter = await h.api('GET', '/platform/orgs', saTok)
  const row1 = (listAfter.body?.orgs || []).find((o) => String(o._id) === String(org1Id))
  h.check('PLAT-006', 'Bootstrap admin email is shown for the org', row1?.admin?.email === admEmail1, `got ${row1?.admin?.email}`)

  const searchedList = await h.api('GET', `/platform/orgs?page=1&limit=20&q=${encodeURIComponent(sub1)}`, saTok)
  h.check('PLAT-006', 'Management search finds a tenant by its real subdomain',
    searchedList.status === 200 && searchedList.body?.pagination?.total === 1 &&
      String(searchedList.body?.orgs?.[0]?._id) === String(org1Id),
    `status ${searchedList.status}, matches ${searchedList.body?.pagination?.total}`)

  // PLAT-015 temp password is not retrievable later.
  h.check('PLAT-015', 'Temp password is not exposed in the org list', !!row1 && (!row1.admin || !('tempPassword' in row1.admin)), 'tempPassword leaked in list')

  // PLAT-007 usage counters match reality.
  const empRoleId = await h.roleId('Employee')
  await runWithOrgId(org1Id, () => User.create({ orgId: org1Id, name: 'Plat U1', email: `plat-u1@${h.QA_EMAIL_DOMAIN}`, password: h.DEFAULT_PASSWORD, department: 'IT', role: empRoleId }))
  await runWithOrgId(org1Id, () => Form.create({ orgId: org1Id, title: 'Plat Form', status: 'published', createdBy: org1Id, fields: [] }))
  const { countUsers: countSeatedUsers, countForms } = require('../utils/usage')
  const [dbUsers, dbForms] = await Promise.all([countSeatedUsers(org1Id), countForms(org1Id)])
  const listUsage = await h.api('GET', '/platform/orgs', saTok)
  const usageRow = (listUsage.body?.orgs || []).find((o) => String(o._id) === String(org1Id))
  h.check('PLAT-007', 'Usage counters match actual data', usageRow?.usage?.users === dbUsers && usageRow?.usage?.forms === dbForms, `usage ${usageRow?.usage?.users}/${usageRow?.usage?.forms} vs db ${dbUsers}/${dbForms}`)

  // PLAT-010 duplicate subdomain rejected.
  const dup = await h.api('POST', '/platform/orgs', saTok, { name: 'Dupe', subdomain: sub1, adminEmail: `plat-dup@${h.QA_EMAIL_DOMAIN}` })
  h.check('PLAT-010', 'Duplicate subdomain rejected (SUBDOMAIN_TAKEN)', dup.status === 400 && dup.body?.code === 'SUBDOMAIN_TAKEN', `status ${dup.status}, code ${dup.body?.code}`)

  // PLAT-011 invalid subdomain characters rejected.
  const badSub = await h.api('POST', '/platform/orgs', saTok, { name: 'Bad Sub', subdomain: 'qa plat invalid!', adminEmail: `plat-bad@${h.QA_EMAIL_DOMAIN}` })
  h.check('PLAT-011', 'Invalid subdomain characters rejected (400)', badSub.status === 400, `status ${badSub.status}, code ${badSub.body?.code}`)

  // PLAT-012 missing admin email blocked.
  const noEmail = await h.api('POST', '/platform/orgs', saTok, { name: 'No Email', subdomain: qaSub('noemail') })
  h.check('PLAT-012', 'Missing admin email blocked (MISSING_ADMIN_EMAIL)', noEmail.status === 400 && noEmail.body?.code === 'MISSING_ADMIN_EMAIL', `status ${noEmail.status}, code ${noEmail.body?.code}`)

  // PLAT-013 invalid admin email format.
  const badEmail = await h.api('POST', '/platform/orgs', saTok, { name: 'Bad Email', subdomain: qaSub('bademail'), adminEmail: 'abc' })
  h.check('PLAT-013', 'Invalid admin email rejected (INVALID_ADMIN_EMAIL)', badEmail.status === 400 && badEmail.body?.code === 'INVALID_ADMIN_EMAIL', `status ${badEmail.status}, code ${badEmail.body?.code}`)

  // PLAT-016 edit name/domains/limits.
  const edit = await h.api('PUT', `/platform/orgs/${org1Id}`, saTok, {
    name: 'QA Plat Renamed',
    allowedDomains: ['acme.com', 'acme.org'],
    limits: { maxUsers: 50 },
    pdfAutoFillEntitlementOverride: false
  })
  h.check('PLAT-016', 'Edit name/domains/limits and custom PDF entitlement persists', edit.status === 200 && edit.body?.org?.name === 'QA Plat Renamed' && (edit.body?.org?.allowedDomains || []).includes('acme.com') && edit.body?.org?.limits?.maxUsers === 50 && edit.body?.org?.pdfAutoFill?.entitlementOverride === false, `got ${JSON.stringify(edit.body?.org?.limits)}`)

  // PLAT-017 subdomain is not editable.
  const subEdit = await h.api('PUT', `/platform/orgs/${org1Id}`, saTok, { subdomain: 'qa-plat-changed' })
  h.check('PLAT-017', 'Subdomain cannot be changed via edit', subEdit.status === 200 && subEdit.body?.org?.subdomain === sub1, `got ${subEdit.body?.org?.subdomain}`)

  // PLAT-018/019/020 suspend → lockout → activate.
  const lockOrg = await h.api('POST', '/platform/orgs', saTok, { name: 'QA Plat Lock', subdomain: qaSub('lock'), adminEmail: `plat-lock-admin@${h.QA_EMAIL_DOMAIN}` })
  const lockOrgId = lockOrg.body?.org?._id
  const lockEmp = await h.createUser({ _id: lockOrgId }, { name: 'Lock Emp', email: `plat-lock-emp@${h.QA_EMAIL_DOMAIN}`, roleName: 'Employee' })
  const lockEmpTok = await h.getToken({ email: lockEmp.email })

  const suspend = await h.api('POST', `/platform/orgs/${lockOrgId}/suspend`, saTok)
  const afterSuspend = await h.api('GET', '/tasks/my-tasks', lockEmpTok)
  h.check('PLAT-018', 'Suspend sets org status to suspended', suspend.status === 200 && suspend.body?.org?.status === 'suspended', `status ${suspend.status}, org ${suspend.body?.org?.status}`)
  h.check('PLAT-019', 'Suspended org user is locked out (ORG_SUSPENDED)', afterSuspend.status === 403 && afterSuspend.body?.code === 'ORG_SUSPENDED', `status ${afterSuspend.status}, code ${afterSuspend.body?.code}`)

  const activate = await h.api('POST', `/platform/orgs/${lockOrgId}/activate`, saTok)
  const afterActivate = await h.api('GET', '/tasks/my-tasks', lockEmpTok)
  h.check('PLAT-020', 'Activate restores access', activate.status === 200 && activate.body?.org?.status === 'active' && afterActivate.status === 200, `activate ${activate.status}, access ${afterActivate.status}`)

  // PLAT-021/022 reset admin password + session invalidation (tokenVersion bump).
  const adminBefore = await runWithOrgId(lockOrgId, () => User.findById(lockOrg.body?.org?.adminUserId).lean())
  const reset = await h.api('POST', `/platform/orgs/${lockOrgId}/reset-admin-password`, saTok)
  const adminAfter = await runWithOrgId(lockOrgId, () => User.findById(lockOrg.body?.org?.adminUserId).lean())
  h.check('PLAT-021', 'Reset admin password returns a new one-time password', reset.status === 200 && !!reset.body?.admin?.tempPassword, `status ${reset.status}, temp ${!!reset.body?.admin?.tempPassword}`)
  h.check('PLAT-022', 'Reset invalidates the admin session (tokenVersion bumped)', (adminAfter?.tokenVersion || 0) === (adminBefore?.tokenVersion || 0) + 1, `before ${adminBefore?.tokenVersion}, after ${adminAfter?.tokenVersion}`)

  // PLAT-025/026 cascade delete + backup on disk.
  const delOrg = await h.api('POST', '/platform/orgs', saTok, { name: 'QA Plat Delete', subdomain: qaSub('del'), adminEmail: `plat-del-admin@${h.QA_EMAIL_DOMAIN}` })
  const delOrgId = delOrg.body?.org?._id
  await runWithOrgId(delOrgId, () => Form.create({ orgId: delOrgId, title: 'Doomed form', status: 'draft', createdBy: delOrgId, fields: [] }))
  const del = await h.api('DELETE', `/platform/orgs/${delOrgId}`, saTok)
  const orgGone = await Organization.findById(delOrgId).lean()
  const usersGone = await User.find({ orgId: delOrgId }).setOptions({ skipOrgScope: true }).lean()
  h.check('PLAT-025', 'Delete cascades org + its data', del.status === 200 && (del.body?.deleted || 0) >= 1 && !orgGone && usersGone.length === 0, `status ${del.status}, deleted ${del.body?.deleted}, orgGone ${!orgGone}, users ${usersGone.length}`)

  const backupDir = del.body?.backup?.dir ? path.join(__dirname, '..', 'backups', del.body.backup.dir) : null
  const backupExists = backupDir ? fs.existsSync(backupDir) : false
  h.check('PLAT-026', 'Backup folder written before delete', backupExists, `dir ${del.body?.backup?.dir}`)
  if (backupExists) { try { fs.rmSync(backupDir, { recursive: true, force: true }) } catch { /* best effort */ } }

  // PLAT-027/028 default-org guards.
  const defaultOrg = await Organization.findOne({ isDefault: true }).lean()
  if (defaultOrg) {
    const delDefault = await h.api('DELETE', `/platform/orgs/${defaultOrg._id}`, saTok)
    const suspendDefault = await h.api('POST', `/platform/orgs/${defaultOrg._id}/suspend`, saTok)
    h.check('PLAT-027', 'Default org cannot be deleted (CANNOT_DELETE_DEFAULT)', delDefault.status === 400 && delDefault.body?.code === 'CANNOT_DELETE_DEFAULT', `status ${delDefault.status}, code ${delDefault.body?.code}`)
    h.check('PLAT-028', 'Default org cannot be suspended (CANNOT_SUSPEND_DEFAULT)', suspendDefault.status === 400 && suspendDefault.body?.code === 'CANNOT_SUSPEND_DEFAULT', `status ${suspendDefault.status}, code ${suspendDefault.body?.code}`)
  } else {
    h.note('PLAT-027', 'Pending', 'No default org present to test the guard')
    h.note('PLAT-028', 'Pending', 'No default org present to test the guard')
  }

  // PLAT-029 shell scoping — platform staff cannot reach workspace data at all,
  // not even the default org they are technically stamped with.
  const tenantCalls = [
    ['GET', '/forms'],
    ['GET', '/tasks/my-tasks'],
    ['GET', '/workflows'],
    ['GET', '/users'],
    ['GET', '/analytics/summary'],
    ['GET', '/audit-logs']
  ]
  for (const [method, route] of tenantCalls) {
    const res = await h.api(method, route, saTok)
    h.check('PLAT-029', `SuperAdmin blocked from ${route} (PLATFORM_SCOPE)`,
      res.status === 403 && res.body?.code === 'PLATFORM_SCOPE',
      `status ${res.status}, code ${res.body?.code}`)
  }

  // …while their own account endpoints keep working, or the console would have
  // no profile page and no bell.
  const selfCalls = [
    ['GET', '/auth/me'],
    ['GET', '/users/me/profile'],
    ['GET', '/notifications']
  ]
  for (const [method, route] of selfCalls) {
    const res = await h.api(method, route, saTok)
    h.check('PLAT-029', `SuperAdmin can still call ${route}`,
      res.status === 200, `status ${res.status}, code ${res.body?.code}`)
  }
})
