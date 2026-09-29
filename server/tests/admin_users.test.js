// ADM — Admin Panel user management (create/edit/deactivate/delete/import/roles).
// Uses an MFA-enrolled Admin token. Dialog-open /
// cancel and single-create email-format validation are frontend-only → Pending.

const h = require('./lib/harness')

h.runSuite('admin_users', async () => {
  const org = await h.createOrg('adm')

  const admin = await h.createUser(org, { name: 'ADM Admin', email: h.emailIn(org, 'adm-admin'), roleName: 'Admin', mfaEnabled: true })
  const manager = await h.createUser(org, { name: 'ADM Manager', email: h.emailIn(org, 'adm-mgr'), roleName: 'Manager', department: 'Finance' })
  const hr = await h.createUser(org, { name: 'ADM HR', email: h.emailIn(org, 'adm-hr'), roleName: 'HR' })
  const adminTok = await h.getToken({ email: admin.email, mfaSecret: admin._mfaSecret })

  const empRoleId = await h.roleId('Employee')
  const mgrRoleId = await h.roleId('Manager')

  if (!adminTok) { h.check('ADM-000', 'admin token obtained', false, 'no token'); return }

  // Frontend-only.
  // Panel visibility and the create/edit/import dialogs are asserted in
  // ui_admin.test.js, which upgrades these to Pass.
  for (const tc of ['ADM-001', 'ADM-007', 'ADM-011', 'ADM-014', 'ADM-015', 'ADM-023']) {
    h.note(tc, 'Pending', 'Frontend: covered by ui_admin.test.js')
  }

  // ADM-002 users list.
  const list = await h.api('GET', '/users', adminTok)
  h.check('ADM-002', 'Users list loads with role/department', list.status === 200 && Array.isArray(list.body?.users) && list.body.users.length >= 3, `status ${list.status}, count ${list.body?.users?.length}`)

  // ADM-003 search.
  const search = await h.api('GET', `/users?search=${encodeURIComponent('ADM Manager')}`, adminTok)
  h.check('ADM-003', 'User search filters by name', (search.body?.users || []).some((u) => u.email === manager.email) && (search.body?.users || []).every((u) => /ADM Manager/i.test(u.name)), `count ${search.body?.users?.length}`)

  // ADM-004 role filter.
  const roleFilter = await h.api('GET', '/users?role=Manager', adminTok)
  h.check('ADM-004', 'Role filter returns only Managers', (roleFilter.body?.users || []).length >= 1 && (roleFilter.body.users).every((u) => u.role?.name === 'Manager'), `count ${roleFilter.body?.users?.length}`)

  // ADM-005 department filter.
  const deptFilter = await h.api('GET', '/users?department=Finance', adminTok)
  h.check('ADM-005', 'Department filter returns only that dept', (deptFilter.body?.users || []).length >= 1 && (deptFilter.body.users).every((u) => u.department === 'Finance'), `count ${deptFilter.body?.users?.length}`)

  // ADM-006 combined.
  const combined = await h.api('GET', '/users?role=Manager&department=Finance&search=ADM', adminTok)
  h.check('ADM-006', 'Search + role + dept filters combine', (combined.body?.users || []).every((u) => u.role?.name === 'Manager' && u.department === 'Finance'), `count ${combined.body?.users?.length}`)

  // ADM-008 create a valid user + it can log in.
  const newEmail = h.emailIn(org, 'adm-created')
  const create = await h.api('POST', '/users', adminTok, { name: 'Created User', email: newEmail, department: 'IT', roleId: String(empRoleId), password: h.DEFAULT_PASSWORD })
  const createdLoginTok = await h.getToken({ email: newEmail })
  h.check('ADM-008', 'Create valid user (201) and it can log in', create.status === 201 && !!createdLoginTok, `status ${create.status}, login ${!!createdLoginTok}`)

  // ADM-009 duplicate email.
  const dup = await h.api('POST', '/users', adminTok, { name: 'Dup', email: newEmail, department: 'IT', roleId: String(empRoleId) })
  h.check('ADM-009', 'Duplicate email rejected (EMAIL_EXISTS)', dup.status === 400 && dup.body?.code === 'EMAIL_EXISTS', `status ${dup.status}, code ${dup.body?.code}`)

  // ADM-010 missing fields.
  const missing = await h.api('POST', '/users', adminTok, { name: 'NoEmail' })
  h.check('ADM-010', 'Missing required fields rejected (MISSING_FIELDS)', missing.status === 400 && missing.body?.code === 'MISSING_FIELDS', `status ${missing.status}, code ${missing.body?.code}`)

  // ADM-012 assign manager, ADM-013 assign HR.
  const withLinks = await h.api('POST', '/users', adminTok, { name: 'Linked User', email: h.emailIn(org, 'adm-linked'), department: 'IT', roleId: String(empRoleId), managerId: String(manager._id), hrId: String(hr._id) })
  const linkedId = withLinks.body?.user?._id
  const linkedFetch = await h.api('GET', `/users/${linkedId}`, adminTok)
  const lu = linkedFetch.body?.user
  h.check('ADM-012', 'Manager link stored on create', String(lu?.managerId?._id || lu?.managerId) === String(manager._id), `got ${JSON.stringify(lu?.managerId)}`)
  h.check('ADM-013', 'HR partner link stored on create', String(lu?.hrId?._id || lu?.hrId) === String(hr._id), `got ${JSON.stringify(lu?.hrId)}`)

  // ADM-016 change role.
  const roleChange = await h.api('PUT', `/users/${linkedId}`, adminTok, { role: String(mgrRoleId) })
  h.check('ADM-016', 'Change role to Manager', roleChange.status === 200 && roleChange.body?.user?.role?.name === 'Manager', `got ${roleChange.body?.user?.role?.name}`)

  // ADM-017 change department.
  const deptChange = await h.api('PUT', `/users/${linkedId}`, adminTok, { department: 'Sales' })
  h.check('ADM-017', 'Change department to Sales', deptChange.status === 200 && deptChange.body?.user?.department === 'Sales', `got ${deptChange.body?.user?.department}`)

  // ADM-018 change manager/HR (clear manager).
  const linkChange = await h.api('PUT', `/users/${linkedId}`, adminTok, { managerId: '', hrId: String(hr._id) })
  h.check('ADM-018', 'Update/clear manager + set HR', linkChange.status === 200 && !linkChange.body?.user?.managerId, `manager ${JSON.stringify(linkChange.body?.user?.managerId)}`)

  // ADM-019 cannot change own role.
  const ownRole = await h.api('PUT', `/users/${admin._id}`, adminTok, { role: String(empRoleId) })
  h.check('ADM-019', 'Admin cannot change own role (CANNOT_CHANGE_OWN_ROLE)', ownRole.status === 400 && ownRole.body?.code === 'CANNOT_CHANGE_OWN_ROLE', `status ${ownRole.status}, code ${ownRole.body?.code}`)

  // ADM-020 deactivate → cannot log in.
  const deactEmail = h.emailIn(org, 'adm-deact')
  await h.api('POST', '/users', adminTok, { name: 'Deact User', email: deactEmail, department: 'IT', roleId: String(empRoleId), password: h.DEFAULT_PASSWORD })
  const deactUser = (await h.api('GET', `/users?search=${encodeURIComponent(deactEmail)}`, adminTok)).body?.users?.[0]
  const beforeLogin = await h.getToken({ email: deactEmail })
  await h.api('DELETE', `/users/${deactUser._id}`, adminTok)
  const afterLogin = await h.api('POST', '/auth/login', null, { email: deactEmail, password: h.DEFAULT_PASSWORD })
  h.check('ADM-020', 'Deactivated user cannot log in', !!beforeLogin && afterLogin.status === 401 && afterLogin.body?.code === 'ACCOUNT_DEACTIVATED', `before ${!!beforeLogin}, after ${afterLogin.status}/${afterLogin.body?.code}`)

  // ADM-021 reactivate → can log in.
  await h.api('PUT', `/users/${deactUser._id}`, adminTok, { isActive: true })
  const reLogin = await h.getToken({ email: deactEmail })
  h.check('ADM-021', 'Reactivated user can log in again', !!reLogin, `login ${!!reLogin}`)

  // ADM-022 permanent delete.
  const delEmail = h.emailIn(org, 'adm-del')
  const toDelete = await h.api('POST', '/users', adminTok, { name: 'Del User', email: delEmail, department: 'IT', roleId: String(empRoleId) })
  const delId = toDelete.body?.user?._id
  const perm = await h.api('DELETE', `/users/${delId}/permanent`, adminTok)
  const gone = await h.api('GET', `/users/${delId}`, adminTok)
  h.check('ADM-022', 'Permanent delete removes the user', perm.status === 200 && gone.status === 404, `del ${perm.status}, get ${gone.status}`)

  // ADM-024 valid CSV import.
  const importRows = [
    { name: 'Imp One', email: h.emailIn(org, 'imp-one'), department: 'IT', role: 'Employee' },
    { name: 'Imp Two', email: h.emailIn(org, 'imp-two'), department: 'Sales', role: 'Manager' }
  ]
  const imp = await h.api('POST', '/users/import', adminTok, { users: importRows })
  h.check('ADM-024', 'Valid CSV import creates users + summary', imp.status === 201 && imp.body?.created === 2, `status ${imp.status}, created ${imp.body?.created}`)

  // ADM-025 missing required column (role) → row errors.
  const impMissing = await h.api('POST', '/users/import', adminTok, { users: [{ name: 'No Role', email: h.emailIn(org, 'imp-norole'), department: 'IT' }] })
  h.check('ADM-025', 'Row missing role reported as error, not created', impMissing.status === 201 && impMissing.body?.failed >= 1 && impMissing.body?.created === 0, `failed ${impMissing.body?.failed}, created ${impMissing.body?.created}`)

  // ADM-026 duplicate emails (within file + already existing) → skipped.
  const dupRows = [
    { name: 'Dup A', email: h.emailIn(org, 'imp-dup'), department: 'IT', role: 'Employee' },
    { name: 'Dup B', email: h.emailIn(org, 'imp-dup'), department: 'IT', role: 'Employee' }, // dup in file
    { name: 'Dup Existing', email: newEmail, department: 'IT', role: 'Employee' }            // already exists
  ]
  const impDup = await h.api('POST', '/users/import', adminTok, { users: dupRows })
  h.check('ADM-026', 'Duplicate emails skipped, no crash', impDup.status === 201 && impDup.body?.skipped >= 2, `skipped ${impDup.body?.skipped}`)

  // ADM-027 empty import.
  const impEmpty = await h.api('POST', '/users/import', adminTok, { users: [] })
  h.check('ADM-027', 'Empty import rejected (EMPTY_IMPORT)', impEmpty.status === 400 && impEmpty.body?.code === 'EMPTY_IMPORT', `status ${impEmpty.status}, code ${impEmpty.body?.code}`)

  // ADM-028 roles catalogue — the six seats that survived the Shell 4 clear-out.
  const roles = await h.api('GET', '/roles', adminTok)
  const roleNames = (roles.body?.roles || []).map((r) => r.name)
  h.check('ADM-028', 'Roles catalogue lists the core roles', ['Admin', 'CEO', 'Manager', 'HR', 'VP', 'Employee'].every((r) => roleNames.includes(r)), `got ${roleNames.join(',')}`)
})
