// PERM — API guards + role matrix (Roles & Permissions sheet).
// Frontend-only cases (sidebar nav visibility, client-side route redirects) are
// marked Pending with a reason; everything enforced at the API is asserted.

const h = require('./lib/harness')
const { runWithOrgId, Form, Workflow } = h

h.runSuite('permissions', async () => {
  const org = await h.createOrg('perm')

  const employee = await h.createUser(org, { name: 'Perm Employee', email: h.emailIn(org, 'perm-emp'), roleName: 'Employee', department: 'IT' })
  const empFinance = await h.createUser(org, { name: 'Perm Finance', email: h.emailIn(org, 'perm-fin'), roleName: 'Employee', department: 'Finance' })
  const manager = await h.createUser(org, { name: 'Perm Manager', email: h.emailIn(org, 'perm-mgr'), roleName: 'Manager', canBuild: false })
  const hr = await h.createUser(org, { name: 'Perm HR', email: h.emailIn(org, 'perm-hr'), roleName: 'HR', canBuild: false })
  const vp = await h.createUser(org, { name: 'Perm VP', email: h.emailIn(org, 'perm-vp'), roleName: 'VP', canBuild: false })
  const ceo = await h.createUser(org, { name: 'Perm CEO', email: h.emailIn(org, 'perm-ceo'), roleName: 'CEO', canBuild: false })

  const empTok = await h.getToken({ email: employee.email, subdomain: org.subdomain })
  const empFinTok = await h.getToken({ email: empFinance.email, subdomain: org.subdomain })
  const mgrTok = await h.getToken({ email: manager.email, subdomain: org.subdomain })
  const hrTok = await h.getToken({ email: hr.email, subdomain: org.subdomain })
  const vpTok = await h.getToken({ email: vp.email, subdomain: org.subdomain })
  const ceoTok = await h.getToken({ email: ceo.email, subdomain: org.subdomain })

  // Frontend-only nav / client route redirects.
  // Sidebar visibility and the client-side route guards are asserted in
  // ui_permissions.test.js, which upgrades these to Pass.
  for (const tc of ['PERM-001', 'PERM-002', 'PERM-004', 'PERM-005', 'PERM-006', 'PERM-008']) {
    h.note(tc, 'Pending', 'Frontend: covered by ui_permissions.test.js')
  }

  // PERM-003 — Viewer was the read-only seat that could sign in but not submit.
  // Shell 4 retired it: nobody held one, and a workspace whose only page is a
  // form you cannot fill in is not a product. The case is now that the seat
  // cannot be handed out at all.
  const catalogue = await h.api('GET', '/roles', empTok)
  const offered = (catalogue.body?.roles || []).map((r) => r.name)
  h.check('PERM-003', 'The read-only Viewer seat is no longer offered',
    !offered.includes('Viewer'), `got ${offered.join(',')}`)

  // PERM-007 — Employee cannot read a form's responses (builder-only).
  const empResp = await h.api('GET', '/forms/000000000000000000000000/responses', empTok)
  h.check('PERM-007', 'Employee blocked from /forms/:id/responses (403)', empResp.status === 403, `got ${empResp.status}`)

  // PERM-009 — Admin-only user management rejects an Employee token.
  const empCreateUser = await h.api('POST', '/users', empTok, { name: 'x', email: h.emailIn(org, 'x'), department: 'IT', roleId: '000000000000000000000000' })
  h.check('PERM-009', 'Employee token blocked from POST /users (403)', empCreateUser.status === 403, `got ${empCreateUser.status}`)

  // PERM-010 — no token → 401.
  const noTok = await h.api('GET', '/forms', null)
  h.check('PERM-010', 'No token → 401 on /forms', noTok.status === 401, `got ${noTok.status}`)

  // PERM-011 — Employee cannot create a workflow.
  const empWf = await h.api('POST', '/workflows', empTok, { title: 'nope' })
  h.check('PERM-011', 'Employee token blocked from POST /workflows (403)', empWf.status === 403, `got ${empWf.status}`)

  // PERM-012 — Manager (ops shell) cannot design forms/workflows; Org Admin can.
  const mgrForm = await h.api('POST', '/forms', mgrTok, { title: 'Mgr Form', fields: [] })
  const mgrWf = await h.api('POST', '/workflows', mgrTok, { title: 'Mgr WF', nodes: [] })
  h.check('PERM-012', 'Manager blocked from creating form + workflow (403)', mgrForm.status === 403 && mgrWf.status === 403, `form ${mgrForm.status}, wf ${mgrWf.status}`)

  const adminWithoutBuilder = await h.createUser(org, { name: 'Perm Admin No Builder', email: h.emailIn(org, 'perm-admin-no-builder'), roleName: 'Admin', canBuild: false })
  const adminWithoutBuilderTok = await h.getToken({ email: adminWithoutBuilder.email, subdomain: org.subdomain })
  const adminWithoutBuilderForm = await h.api('POST', '/forms', adminWithoutBuilderTok, { title: 'Admin Without Builder Form', fields: [] })
  const adminWithoutBuilderWorkflow = await h.api('POST', '/workflows', adminWithoutBuilderTok, { title: 'Admin Without Builder Workflow', nodes: [] })
  h.check('PERM-012', 'Admin wildcard permission does not replace a Builder seat',
    adminWithoutBuilderForm.status === 403 && adminWithoutBuilderWorkflow.status === 403,
    `form ${adminWithoutBuilderForm.status}, workflow ${adminWithoutBuilderWorkflow.status}`)

  const admin = await h.createUser(org, { name: 'Perm Admin', email: h.emailIn(org, 'perm-admin'), roleName: 'Admin' })
  const adminTok = await h.getToken({ email: admin.email, subdomain: org.subdomain })
  const adminForm = await h.api('POST', '/forms', adminTok, { title: 'Admin Form', fields: [] })
  const adminWf = await h.api('POST', '/workflows', adminTok, { title: 'Admin WF', nodes: [] })
  h.check('PERM-012', 'Org Admin can create form + workflow (201)', adminForm.status === 201 && adminWf.status === 201, `form ${adminForm.status}, wf ${adminWf.status}`)

  // Per-user Builder is additive: the same Manager token gains build access,
  // keeps its Manager role, and still receives no user-admin power.
  const grantBuilder = await h.api('PUT', `/users/${manager._id}`, adminTok, { canBuild: true })
  const managerMeWithBuilder = await h.api('GET', '/auth/me', mgrTok)
  const builderForm = await h.api('POST', '/forms', mgrTok, { title: 'Manager Builder Form', fields: [] })
  const builderWorkflow = await h.api('POST', '/workflows', mgrTok, { title: 'Manager Builder Workflow', nodes: [] })
  const builderAdminAttempt = await h.api('POST', '/users', mgrTok, {
    name: 'Not allowed', email: h.emailIn(org, 'not-allowed'), department: 'IT', roleId: manager.role
  })
  h.check('PERM-012', 'Builder grant immediately gives the same Manager token Forms and Workflows access',
    grantBuilder.status === 200 && managerMeWithBuilder.body?.user?.canBuild === true &&
      builderForm.status === 201 && builderWorkflow.status === 201,
    `grant ${grantBuilder.status}, me=${managerMeWithBuilder.body?.user?.canBuild}, form ${builderForm.status}, workflow ${builderWorkflow.status}`)
  h.check('PERM-012', 'Manager + Builder preserves the Manager role and does not gain Users administration',
    managerMeWithBuilder.body?.user?.role?.name === 'Manager' && builderAdminAttempt.status === 403,
    `role ${managerMeWithBuilder.body?.user?.role?.name}, users ${builderAdminAttempt.status}`)

  const revokeBuilder = await h.api('PUT', `/users/${manager._id}`, adminTok, { canBuild: false })
  const managerMeAfterRevoke = await h.api('GET', '/auth/me', mgrTok)
  const revokedForm = await h.api('POST', '/forms', mgrTok, { title: 'Revoked Manager Form', fields: [] })
  const builderAudit = await h.api('GET', '/audit-logs?limit=50', adminTok)
  const auditActions = new Set((builderAudit.body?.logs || []).map((entry) => entry.action))
  h.check('PERM-012', 'Builder revoke immediately blocks the same token without changing its role',
    revokeBuilder.status === 200 && managerMeAfterRevoke.body?.user?.canBuild === false &&
      managerMeAfterRevoke.body?.user?.role?.name === 'Manager' && revokedForm.status === 403,
    `revoke ${revokeBuilder.status}, role ${managerMeAfterRevoke.body?.user?.role?.name}, form ${revokedForm.status}`)
  h.check('PERM-012', 'Builder grant and revoke write dedicated audit events',
    auditActions.has('builder_access_granted') && auditActions.has('builder_access_revoked'),
    `actions ${[...auditActions].join(', ')}`)

  // PERM-013 — HR / VP / CEO are ops leaders: reports yes, builder no.
  const hrWf = await h.api('POST', '/workflows', hrTok, { title: 'HR WF', nodes: [] })
  const vpWf = await h.api('POST', '/workflows', vpTok, { title: 'VP WF', nodes: [] })
  const ceoWf = await h.api('POST', '/workflows', ceoTok, { title: 'CEO WF', nodes: [] })
  const hrKpis = await h.api('GET', '/analytics/department-kpis', hrTok)
  const vpKpis = await h.api('GET', '/analytics/department-kpis', vpTok)
  const ceoKpis = await h.api('GET', '/analytics/department-kpis', ceoTok)
  h.check('PERM-013', 'HR/VP/CEO cannot build workflows but can read reports',
    hrWf.status === 403 && vpWf.status === 403 && ceoWf.status === 403 &&
    hrKpis.status === 200 && vpKpis.status === 200 && ceoKpis.status === 200,
    `wf ${hrWf.status}/${vpWf.status}/${ceoWf.status}, kpis ${hrKpis.status}/${vpKpis.status}/${ceoKpis.status}`)
  // Employee is blocked from the detailed report (used again for ANA-011).
  const empKpis = await h.api('GET', '/analytics/department-kpis', empTok)
  h.check('PERM-013', 'Employee blocked from department-kpis (403)', empKpis.status === 403, `got ${empKpis.status}`)

  // PERM-014 — a non-assignee Employee cannot approve a task.
  const stray = await runWithOrgId(org._id, () => h.Task.create({
    title: 'Perm stray task', type: 'IT', status: 'pending',
    assignedTo: manager._id, submittedBy: manager._id
  }))
  const empApprove = await h.api('POST', `/tasks/${stray._id}/approve`, empTok, { comment: 'x' })
  h.check('PERM-014', 'Employee (non-approver) blocked from approve (403)', empApprove.status === 403, `got ${empApprove.status}`)

  // PERM-015 — department-scoped form visibility.
  const deptForm = await runWithOrgId(org._id, () => Form.create({
    title: 'Finance-only form', status: 'published', createdBy: manager._id,
    fields: [{ id: 'f1', type: 'text', label: 'F1' }]
  }))
  await runWithOrgId(org._id, () => Workflow.create({
    title: 'Finance visibility wf', status: 'published', createdBy: manager._id,
    linkedFormId: deptForm._id, nodes: [],
    access: { visibility: 'departments', departments: ['Finance'] }
  }))
  const itList = await h.api('GET', '/forms', empTok)
  const finList = await h.api('GET', '/forms', empFinTok)
  const itSees = (itList.body?.forms || []).some((f) => String(f._id) === String(deptForm._id))
  const finSees = (finList.body?.forms || []).some((f) => String(f._id) === String(deptForm._id))
  h.check('PERM-015', 'Dept-scoped form hidden from other dept, shown to owning dept', !itSees && finSees, `IT sees=${itSees}, Finance sees=${finSees}`)

  const grantEmployeeBuilder = await h.api('PUT', `/users/${empFinance._id}`, adminTok, { canBuild: true })
  const employeeBuilderMe = await h.api('GET', '/auth/me', empFinTok)
  const employeeBuilderForm = await h.api('POST', '/forms', empFinTok, { title: 'Employee Builder Form', fields: [] })
  const employeeBuilderWorkflow = await h.api('POST', '/workflows', empFinTok, { title: 'Employee Builder Workflow', nodes: [] })
  const employeeAdminAttempt = await h.api('POST', '/users', empFinTok, {
    name: 'Still not allowed', email: h.emailIn(org, 'still-not-allowed'), department: 'IT', roleId: employee.role
  })
  h.check('PERM-011', 'Employee + Builder can build but retains Employee permissions',
    grantEmployeeBuilder.status === 200 && employeeBuilderMe.body?.user?.role?.name === 'Employee' &&
      employeeBuilderForm.status === 201 && employeeBuilderWorkflow.status === 201 && employeeAdminAttempt.status === 403,
    `grant ${grantEmployeeBuilder.status}, role ${employeeBuilderMe.body?.user?.role?.name}, form ${employeeBuilderForm.status}, workflow ${employeeBuilderWorkflow.status}, users ${employeeAdminAttempt.status}`)
  await h.api('PUT', `/users/${empFinance._id}`, adminTok, { canBuild: false })

  // Dynamic role access is persisted and enforced without issuing a new token.
  const summary = await h.api('GET', '/roles/summary', adminTok)
  const summaryRoles = summary.body?.roles || []
  const adminRole = summaryRoles.find((role) => role.name === 'Admin')
  const ceoRole = summaryRoles.find((role) => role.name === 'CEO')
  const managerRole = summaryRoles.find((role) => role.name === 'Manager')
  const employeeRole = summaryRoles.find((role) => role.name === 'Employee')
  const capabilityKeys = (summary.body?.capabilities || []).map((capability) => capability.key)

  h.check('RBAC-001', 'Role matrix exposes only the four independent permissions',
    JSON.stringify(capabilityKeys) === JSON.stringify(['decide_tasks', 'manage_users', 'view_audit', 'view_analytics']),
    `capabilities ${capabilityKeys.join(', ')}`)

  const protectedAdminEdit = await h.api('PUT', `/roles/${adminRole?._id}`, adminTok, {
    name: 'Admin', description: 'Changed', capabilities: []
  })
  const protectedCeoDelete = await h.api('DELETE', `/roles/${ceoRole?._id}`, adminTok)
  h.check('RBAC-001', 'Admin and CEO reject edit/delete at the API',
    protectedAdminEdit.status === 403 && protectedCeoDelete.status === 403,
    `admin edit ${protectedAdminEdit.status}, CEO delete ${protectedCeoDelete.status}`)

  const rejectedBuilderCapabilities = await h.api('PUT', `/roles/${managerRole?._id}`, adminTok, {
    name: 'Manager',
    description: managerRole?.description || '',
    capabilities: ['manage_forms', 'build_flows', 'decide_tasks', 'view_analytics']
  })
  const rejectedBuilderRoleCreate = await h.api('POST', '/roles', adminTok, {
    name: 'Legacy Designer',
    description: 'Must not restore role-based Builder access',
    capabilities: ['design']
  })
  await runWithOrgId(org._id, () => h.Role.updateOne(
    { _id: managerRole?._id },
    { $addToSet: { permissions: { $each: ['forms:manage', 'workflows:manage'] } } }
  ))
  const staleRoleForms = await h.api('GET', '/forms', mgrTok)
  const staleRoleWorkflows = await h.api('GET', '/workflows', mgrTok)
  const staleRoleSeesDraftForm = (staleRoleForms.body?.forms || []).some((form) => String(form._id) === String(adminForm.body?.form?._id))
  const staleRoleSeesDraftWorkflow = (staleRoleWorkflows.body?.workflows || []).some((workflow) => String(workflow._id) === String(adminWf.body?.workflow?._id))
  const updateManagerPolicy = await h.api('PUT', `/roles/${managerRole?._id}`, adminTok, {
    name: 'Manager',
    description: managerRole?.description || '',
    capabilities: ['decide_tasks', 'view_analytics']
  })
  const cleanedManagerRole = await runWithOrgId(org._id, () => h.Role.findById(managerRole?._id).lean())
  const deprecatedStoredPermissions = ['manage_forms', 'build_flows', 'forms:manage', 'workflows:manage', 'design']
    .filter((permission) => (cleanedManagerRole?.permissions || []).includes(permission))
  const roleOnlyForm = await h.api('POST', '/forms', mgrTok, { title: 'Role only form', fields: [] })
  const grantManagerBuilderAgain = await h.api('PUT', `/users/${manager._id}`, adminTok, { canBuild: true })
  const managerGrantedForm = await h.api('POST', '/forms', mgrTok, { title: 'Manager granted form', fields: [] })
  const managerGrantedWorkflow = await h.api('POST', '/workflows', mgrTok, { title: 'Manager granted workflow', nodes: [] })
  h.check('RBAC-002', 'Deprecated Builder capabilities are rejected by role management',
    rejectedBuilderCapabilities.status === 400 && rejectedBuilderRoleCreate.status === 400 &&
      /managed per user/i.test(rejectedBuilderCapabilities.body?.error || '') &&
      /managed per user/i.test(rejectedBuilderRoleCreate.body?.error || ''),
    `update ${rejectedBuilderCapabilities.status}, create ${rejectedBuilderRoleCreate.status}`)
  h.check('RBAC-002', 'Stored legacy Builder permissions no longer expose management catalogues',
    staleRoleForms.status === 200 && staleRoleWorkflows.status === 200 &&
      !staleRoleSeesDraftForm && !staleRoleSeesDraftWorkflow,
    `forms ${staleRoleForms.status}/draft=${staleRoleSeesDraftForm}, workflows ${staleRoleWorkflows.status}/draft=${staleRoleSeesDraftWorkflow}`)
  h.check('RBAC-002', 'Independent role permissions do not grant Builder access',
    updateManagerPolicy.status === 200 && deprecatedStoredPermissions.length === 0 &&
      roleOnlyForm.status === 403 && grantManagerBuilderAgain.status === 200 &&
      managerGrantedForm.status === 201 && managerGrantedWorkflow.status === 201,
    `edit ${updateManagerPolicy.status}, deprecated ${deprecatedStoredPermissions.join(',') || 'none'}, role-only ${roleOnlyForm.status}, builder ${grantManagerBuilderAgain.status}, form ${managerGrantedForm.status}, workflow ${managerGrantedWorkflow.status}`)

  const created = await h.api('POST', '/roles', adminTok, {
    name: 'Workflow Coordinator',
    description: 'Form oversight, task decisions, and reporting',
    capabilities: ['decide_tasks', 'view_analytics']
  })
  const createdRole = created.body?.role
  const assigned = await h.api('POST', `/users/${employee._id}/assign-role`, adminTok, { roleId: createdRole?._id })
  const blockedDelete = await h.api('DELETE', `/roles/${createdRole?._id}`, adminTok)
  h.check('RBAC-003', 'Assigned roles cannot be deleted',
    created.status === 201 && assigned.status === 200 && blockedDelete.status === 409,
    `create ${created.status}, assign ${assigned.status}, delete ${blockedDelete.status}`)

  await h.api('POST', `/users/${employee._id}/assign-role`, adminTok, { roleId: employeeRole?._id })
  const deleted = await h.api('DELETE', `/roles/${createdRole?._id}`, adminTok)
  h.check('RBAC-004', 'An unassigned non-protected role can be deleted',
    deleted.status === 200, `got ${deleted.status}`)
})
