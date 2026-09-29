// OADMIN — Shell 2 (Org Admin): departments, the role matrix and the tenant's
// own settings. These are the surfaces that decide how a workspace is shaped,
// so the interesting cases are the refusals: renaming a team must not strand its
// members, deleting one must not empty a dropdown people still depend on, and an
// Org Admin must not be able to promote anybody onto the platform.

const h = require('./lib/harness')

h.runSuite('org_admin', async () => {
  const org = await h.createOrg('oadmin')
  const other = await h.createOrg('oadmin-other')

  const admin = await h.createUser(org, {
    name: 'ORG Admin', email: h.emailIn(org, 'org-admin'), roleName: 'Admin', mfaEnabled: true
  })
  const employee = await h.createUser(org, {
    name: 'ORG Employee', email: h.emailIn(org, 'org-emp'), roleName: 'Employee', department: 'Finance'
  })
  await h.createUser(other, {
    name: 'Other Admin', email: h.emailIn(other, 'org-other-admin'), roleName: 'Admin'
  })

  const adminTok = await h.getToken({ email: admin.email, mfaSecret: admin._mfaSecret })
  const empTok = await h.getToken({ email: employee.email })
  if (!adminTok || !empTok) {
    h.check('OADMIN-000', 'tokens obtained', false, `admin ${!!adminTok}, employee ${!!empTok}`)
    return
  }

  const namesOf = (body) => (body?.departments || []).map((d) => d.name)

  // ── departments: reading ───────────────────────────────────────────────────
  // OADMIN-001 an org that never configured departments still answers with the
  // legacy six, so no migration is needed before the page is opened.
  const initial = await h.api('GET', '/departments', adminTok)
  h.check('OADMIN-001', 'A fresh workspace falls back to the default team list',
    initial.status === 200 && namesOf(initial.body).includes('Finance') && namesOf(initial.body).length === 6,
    `status ${initial.status}, got ${namesOf(initial.body).join(', ')}`)

  h.check('OADMIN-002', 'Member counts come back with the list',
    (initial.body?.departments || []).find((d) => d.name === 'Finance')?.members >= 1,
    `Finance count ${(initial.body?.departments || []).find((d) => d.name === 'Finance')?.members}`)

  // OADMIN-003 every signed-in user reads the list — the picker appears on
  // non-admin screens too.
  const empRead = await h.api('GET', '/departments', empTok)
  h.check('OADMIN-003', 'A non-admin can read the department list',
    empRead.status === 200 && namesOf(empRead.body).length === 6, `status ${empRead.status}`)

  // ── departments: writing ───────────────────────────────────────────────────
  // OADMIN-004 create.
  const created = await h.api('POST', '/departments', adminTok, { name: 'Customer Support' })
  h.check('OADMIN-004', 'An admin can add a department',
    created.status === 201 && namesOf(created.body).includes('Customer Support'),
    `status ${created.status}, got ${namesOf(created.body).join(', ')}`)

  // OADMIN-005 duplicates, in any casing.
  const dup = await h.api('POST', '/departments', adminTok, { name: 'customer support' })
  h.check('OADMIN-005', 'A duplicate name is refused regardless of case',
    dup.status === 400 && dup.body?.code === 'DEPARTMENT_EXISTS',
    `status ${dup.status}, code ${dup.body?.code}`)

  const blank = await h.api('POST', '/departments', adminTok, { name: '   ' })
  h.check('OADMIN-005', 'A blank name is refused', blank.status === 400, `status ${blank.status}`)

  // OADMIN-006 writes are Admin-only.
  const empWrite = await h.api('POST', '/departments', empTok, { name: 'Shadow IT' })
  h.check('OADMIN-006', 'A non-admin cannot add a department', empWrite.status === 403, `status ${empWrite.status}`)

  // OADMIN-007 a new department is immediately usable on a user.
  const usable = await h.api('POST', '/users', adminTok, {
    name: 'Support Person',
    email: h.emailIn(org, 'org-support'),
    department: 'Customer Support',
    roleId: String(await h.roleId('Employee')),
    password: h.DEFAULT_PASSWORD
  })
  h.check('OADMIN-007', 'A brand-new department can be assigned to a user',
    usable.status === 201 && usable.body?.user?.department === 'Customer Support',
    `status ${usable.status}, dept ${usable.body?.user?.department}`)

  const bogus = await h.api('POST', '/users', adminTok, {
    name: 'Bogus Dept',
    email: h.emailIn(org, 'org-bogus'),
    department: 'Ministry of Silly Walks',
    roleId: String(await h.roleId('Employee')),
    password: h.DEFAULT_PASSWORD
  })
  h.check('OADMIN-008', 'A department this workspace does not have is refused',
    bogus.status === 400 && bogus.body?.code === 'INVALID_DEPARTMENT',
    `status ${bogus.status}, code ${bogus.body?.code}`)

  // OADMIN-009 rename cascades to the people in it.
  const renamed = await h.api('PUT', '/departments/Finance', adminTok, { name: 'Commercial' })
  const movedUser = await h.User.findById(employee._id).setOptions({ skipOrgScope: true }).lean()
  h.check('OADMIN-009', 'Renaming a department moves its members with it',
    renamed.status === 200 && movedUser?.department === 'Commercial' && renamed.body?.renamed?.members >= 1,
    `status ${renamed.status}, member now "${movedUser?.department}", moved ${renamed.body?.renamed?.members}`)

  h.check('OADMIN-010', 'The old name is gone after a rename',
    !namesOf(renamed.body).includes('Finance') && namesOf(renamed.body).includes('Commercial'),
    `got ${namesOf(renamed.body).join(', ')}`)

  const renameClash = await h.api('PUT', '/departments/Commercial', adminTok, { name: 'Customer Support' })
  h.check('OADMIN-011', 'Renaming onto an existing team is refused',
    renameClash.status === 400 && renameClash.body?.code === 'DEPARTMENT_EXISTS',
    `status ${renameClash.status}, code ${renameClash.body?.code}`)

  const renameMissing = await h.api('PUT', '/departments/Nowhere', adminTok, { name: 'Somewhere' })
  h.check('OADMIN-011', 'Renaming a department that does not exist 404s',
    renameMissing.status === 404, `status ${renameMissing.status}`)

  // OADMIN-012 delete is refused while anybody is still in the team.
  const inUse = await h.api('DELETE', '/departments/Commercial', adminTok)
  h.check('OADMIN-012', 'A department with members cannot be deleted',
    inUse.status === 400 && inUse.body?.code === 'DEPARTMENT_IN_USE',
    `status ${inUse.status}, code ${inUse.body?.code}`)

  // OADMIN-013 …and allowed once it is empty.
  const emptyDelete = await h.api('DELETE', '/departments/Legal', adminTok)
  h.check('OADMIN-013', 'An empty department can be deleted',
    emptyDelete.status === 200 && !namesOf(emptyDelete.body).includes('Legal'),
    `status ${emptyDelete.status}, got ${namesOf(emptyDelete.body).join(', ')}`)

  // OADMIN-014 one tenant's list never reaches another.
  const otherOrgFresh = await h.Organization.findById(other._id).lean()
  h.check('OADMIN-014', 'Departments stay inside the tenant that owns them',
    !(otherOrgFresh?.departments || []).includes('Customer Support'),
    `other org has ${(otherOrgFresh?.departments || []).join(', ') || '(defaults)'}`)

  // ── roles ──────────────────────────────────────────────────────────────────
  // OADMIN-015 the matrix, built from the same lists the guards use.
  const summary = await h.api('GET', '/roles/summary', adminTok)
  const roles = summary.body?.roles || []
  const adminRow = roles.find((r) => r.name === 'Admin')
  const managerRow = roles.find((r) => r.name === 'Manager')
  const employeeRow = roles.find((r) => r.name === 'Employee')
  h.check('OADMIN-015', 'The role matrix loads with capabilities and head counts',
    summary.status === 200 && roles.length > 0 && Array.isArray(summary.body?.capabilities) && adminRow?.members >= 1,
    `status ${summary.status}, roles ${roles.length}, admin members ${adminRow?.members}`)

  const capabilityKeys = (summary.body?.capabilities || []).map((capability) => capability.key)
  h.check('OADMIN-016', 'Role matrix contains only independent permissions',
    JSON.stringify(capabilityKeys) === JSON.stringify(['decide_tasks', 'manage_users', 'view_audit', 'view_analytics']) &&
    !capabilityKeys.includes('manage_forms') && !capabilityKeys.includes('build_flows'),
    `capabilities ${capabilityKeys.join(', ')}`)

  h.check('OADMIN-017', 'Leaders decide tasks while baseline form submission stays outside the role matrix',
    adminRow?.capabilities.includes('manage_users') &&
    managerRow?.capabilities.includes('decide_tasks') &&
    !employeeRow?.capabilities.includes('decide_tasks') && employeeRow?.capabilities.length === 0,
    `manager ${managerRow?.capabilities}, employee ${employeeRow?.capabilities}`)

  h.check('OADMIN-018', 'SuperAdmin is absent from a workspace role list',
    !roles.some((r) => r.name === 'SuperAdmin') &&
    !((await h.api('GET', '/roles', adminTok)).body?.roles || []).some((r) => r.name === 'SuperAdmin'),
    `matrix ${roles.map((r) => r.name).join(', ')}`)

  const empMatrix = await h.api('GET', '/roles/summary', empTok)
  h.check('OADMIN-019', 'The role matrix is Admin-only', empMatrix.status === 403, `status ${empMatrix.status}`)

  // OADMIN-020 privilege escalation: an Org Admin must not be able to mint a
  // platform account, on create, on update, or through assign-role.
  const superRoleId = String(await h.roleId('SuperAdmin'))
  const escalateCreate = await h.api('POST', '/users', adminTok, {
    name: 'Sneaky Super',
    email: h.emailIn(org, 'org-sneaky'),
    department: 'IT',
    roleId: superRoleId,
    password: h.DEFAULT_PASSWORD
  })
  const escalateUpdate = await h.api('PUT', `/users/${employee._id}`, adminTok, { role: superRoleId })
  const escalateAssign = await h.api('POST', `/users/${employee._id}/assign-role`, adminTok, { roleId: superRoleId })
  h.check('OADMIN-020', 'An Org Admin cannot grant SuperAdmin on create',
    escalateCreate.status === 403 && escalateCreate.body?.code === 'ROLE_NOT_ASSIGNABLE',
    `status ${escalateCreate.status}, code ${escalateCreate.body?.code}`)
  h.check('OADMIN-020', 'An Org Admin cannot grant SuperAdmin on update',
    escalateUpdate.status === 403 && escalateUpdate.body?.code === 'ROLE_NOT_ASSIGNABLE',
    `status ${escalateUpdate.status}, code ${escalateUpdate.body?.code}`)
  h.check('OADMIN-020', 'An Org Admin cannot grant SuperAdmin via assign-role',
    escalateAssign.status === 403 && escalateAssign.body?.code === 'ROLE_NOT_ASSIGNABLE',
    `status ${escalateAssign.status}, code ${escalateAssign.body?.code}`)

  // ── organization settings ──────────────────────────────────────────────────
  // OADMIN-021 read.
  const settings = await h.api('GET', '/organization', adminTok)
  h.check('OADMIN-021', 'An admin reads their own workspace settings',
    settings.status === 200 &&
    settings.body?.organization?.subdomain === org.subdomain &&
    !!settings.body?.organization?.licence,
    `status ${settings.status}, subdomain ${settings.body?.organization?.subdomain}`)

  // OADMIN-022 write the two fields that are theirs.
  const saved = await h.api('PUT', '/organization', adminTok, {
    name: 'QA Renamed Workspace',
    billingEmail: 'Billing@QA.test'
  })
  h.check('OADMIN-022', 'Name and billing contact are editable',
    saved.status === 200 &&
    saved.body?.organization?.name === 'QA Renamed Workspace' &&
    saved.body?.organization?.billingEmail === 'billing@qa.test',
    `status ${saved.status}, name ${saved.body?.organization?.name}, email ${saved.body?.organization?.billingEmail}`)

  const pdfSaved = await h.api('PUT', '/organization', adminTok, {
    pdfAutoFill: {
      enabled: true,
      languageMode: 'english',
      audiences: { authenticated: true, public: true }
    }
  })
  h.check('OADMIN-022b', 'Tenant Admin controls PDF auto-fill language and audiences',
    pdfSaved.status === 200 &&
    pdfSaved.body?.organization?.pdfAutoFill?.languageMode === 'english' &&
    pdfSaved.body?.organization?.pdfAutoFill?.audiences?.public === true,
    `status ${pdfSaved.status}, policy ${JSON.stringify(pdfSaved.body?.organization?.pdfAutoFill)}`)

  const invalidPdfPolicy = await h.api('PUT', '/organization', adminTok, {
    pdfAutoFill: {
      enabled: true,
      languageMode: 'english_hindi',
      audiences: { authenticated: false, public: false }
    }
  })
  h.check('OADMIN-022c', 'Enabled PDF auto-fill requires at least one audience',
    invalidPdfPolicy.status === 400 &&
    invalidPdfPolicy.body?.code === 'INVALID_PDF_AUTO_FILL_SETTINGS',
    `status ${invalidPdfPolicy.status}, code ${invalidPdfPolicy.body?.code}`)

  const badEmail = await h.api('PUT', '/organization', adminTok, { billingEmail: 'not-an-email' })
  h.check('OADMIN-023', 'An invalid billing email is refused',
    badEmail.status === 400 && badEmail.body?.code === 'INVALID_BILLING_EMAIL',
    `status ${badEmail.status}, code ${badEmail.body?.code}`)

  // OADMIN-024 the platform-controlled fields stay platform-controlled.
  const beforeTamper = await h.Organization.findById(org._id).lean()
  const tamper = await h.api('PUT', '/organization', adminTok, {
    subdomain: 'stolen-subdomain',
    plan: 'enterprise',
    limits: { maxUsers: 99999 },
    features: { externalUsers: true },
    pdfAutoFillEntitlementOverride: false
  })
  const afterTamper = await h.Organization.findById(org._id).lean()
  h.check('OADMIN-024', 'Plan, limits, subdomain and features ignore a tenant write',
    tamper.status === 200 &&
    afterTamper.subdomain === org.subdomain &&
    afterTamper.plan === org.plan &&
    afterTamper.pdfAutoFill?.entitlementOverride === beforeTamper.pdfAutoFill?.entitlementOverride &&
    Number(afterTamper.limits?.maxUsers || 0) === Number(org.limits?.maxUsers || 0),
    `subdomain ${afterTamper.subdomain}, plan ${afterTamper.plan}, maxUsers ${afterTamper.limits?.maxUsers}`)

  const empSettings = await h.api('GET', '/organization', empTok)
  h.check('OADMIN-025', 'Workspace settings are Admin-only', empSettings.status === 403, `status ${empSettings.status}`)

  // OADMIN-026 configuration changes are auditable.
  const audits = await h.AuditLog.find({ orgId: org._id })
    .setOptions({ skipOrgScope: true })
    .select('action')
    .lean()
  const actions = new Set(audits.map((a) => a.action))
  h.check('OADMIN-026', 'Department and settings changes are written to the audit log',
    ['department_created', 'department_renamed', 'department_deleted', 'org_settings_updated']
      .every((a) => actions.has(a)),
    `saw ${[...actions].join(', ')}`)

  // Frontend-only — proved by ui_org_admin.test.js.
  for (const tc of ['OADMIN-030', 'OADMIN-031', 'OADMIN-032']) {
    h.note(tc, 'Pending', 'Frontend: covered by ui_org_admin.test.js')
  }
})
