// PRF — Profile + password + MFA.
// The Profile page is read-only for name/email/role/department (name is edited
// from the Admin Panel via PUT /users/:id); the new/confirm match and avatar are
// client-side, so those are Pending. Password change + MFA are fully asserted.

const h = require('./lib/harness')

h.runSuite('profile', async () => {
  const org = await h.createOrg('prf')

  const admin = await h.createUser(org, { name: 'PRF Admin', email: h.emailIn(org, 'prf-admin'), roleName: 'Admin', mfaEnabled: true })
  const adminTok = await h.getToken({ email: admin.email, mfaSecret: admin._mfaSecret })

  const profileUser = await h.createUser(org, { name: 'PRF User', email: h.emailIn(org, 'prf-user'), roleName: 'Employee', department: 'Sales' })
  const profileTok = await h.getToken({ email: profileUser.email })

  const nameTarget = await h.createUser(org, { name: 'PRF NameTarget', email: h.emailIn(org, 'prf-name'), roleName: 'Employee' })
  const pw1 = await h.createUser(org, { name: 'PRF Pw1', email: h.emailIn(org, 'prf-pw1'), roleName: 'Employee' })
  const pw2 = await h.createUser(org, { name: 'PRF Pw2', email: h.emailIn(org, 'prf-pw2'), roleName: 'Employee' })
  const pw3 = await h.createUser(org, { name: 'PRF Pw3', email: h.emailIn(org, 'prf-pw3'), roleName: 'Employee' })
  const mfaUser = await h.createUser(org, { name: 'PRF Mfa', email: h.emailIn(org, 'prf-mfa'), roleName: 'Employee' })

  // The new/confirm match is a client-side check (the API takes only
  // newPassword); avatar upload turns out to have no UI at all. Both are
  // settled in ui_profile.test.js.
  h.note('PRF-004', 'Pending', 'Frontend: covered by ui_profile.test.js')
  h.note('PRF-008', 'Pending', 'Frontend: covered by ui_profile.test.js')

  // PRF-001 profile loads.
  const prof = await h.api('GET', '/users/me/profile', profileTok)
  const pu = prof.body?.user
  h.check('PRF-001', 'Profile returns name/email/role/department', prof.status === 200 && pu?.name === 'PRF User' && pu?.email === profileUser.email && pu?.role?.name === 'Employee' && pu?.department === 'Sales', `status ${prof.status}`)

  // PRF-002 update name (Admin Panel path).
  const nameUpd = await h.api('PUT', `/users/${nameTarget._id}`, adminTok, { name: 'PRF Renamed' })
  h.check('PRF-002', 'Name update persists', nameUpd.status === 200 && nameUpd.body?.user?.name === 'PRF Renamed', `got ${nameUpd.body?.user?.name}`)

  // PRF-003 empty name rejected.
  const emptyName = await h.api('PUT', `/users/${nameTarget._id}`, adminTok, { name: '   ' })
  h.check('PRF-003', 'Empty name rejected (INVALID_NAME)', emptyName.status === 400 && emptyName.body?.code === 'INVALID_NAME', `status ${emptyName.status}, code ${emptyName.body?.code}`)

  // PRF-005 change password with correct current password.
  const t1 = await h.getToken({ email: pw1.email })
  const newPw = 'CedarRiver@999'
  const chg = await h.api('POST', '/auth/change-password', t1, { currentPassword: h.DEFAULT_PASSWORD, newPassword: newPw })
  const loginNew = await h.getToken({ email: pw1.email, password: newPw })
  const loginOld = await h.api('POST', '/auth/login', null, { email: pw1.email, password: h.DEFAULT_PASSWORD })
  h.check('PRF-005', 'Password change works; new logs in, old rejected', chg.status === 200 && !!loginNew && loginOld.status === 401, `chg ${chg.status}, new ${!!loginNew}, old ${loginOld.status}`)

  // PRF-006 wrong current password.
  const t2 = await h.getToken({ email: pw2.email })
  const wrong = await h.api('POST', '/auth/change-password', t2, { currentPassword: 'totally-wrong', newPassword: 'AnotherRiver@999' })
  h.check('PRF-006', 'Wrong current password rejected (INVALID_CURRENT_PASSWORD)', wrong.status === 401 && wrong.body?.code === 'INVALID_CURRENT_PASSWORD', `status ${wrong.status}, code ${wrong.body?.code}`)

  // PRF-007 weak new password.
  const t3 = await h.getToken({ email: pw3.email })
  const weak = await h.api('POST', '/auth/change-password', t3, { currentPassword: h.DEFAULT_PASSWORD, newPassword: '123' })
  h.check('PRF-007', 'Weak new password rejected (WEAK_PASSWORD)', weak.status === 400 && weak.body?.code === 'WEAK_PASSWORD', `status ${weak.status}, code ${weak.body?.code}`)

  // PRF-009 role/email read-only for a normal user (no self-edit endpoint).
  const selfEdit = await h.api('PUT', `/users/${profileUser._id}`, profileTok, { role: String(await h.roleId('Manager')), email: 'hacked@qa.test' })
  h.check('PRF-009', 'Employee cannot self-edit role/email (403)', selfEdit.status === 403, `got ${selfEdit.status}`)

  // PRF-010 enable MFA → next login requires an OTP, then disable.
  const mfaTok = await h.getToken({ email: mfaUser.email })
  const setup = await h.api('POST', '/auth/mfa/setup', mfaTok, {})
  const secret = setup.body?.manualKey
  const enable = await h.api('POST', '/auth/mfa/enable', mfaTok, { code: h.speakeasy.totp({ secret, encoding: 'base32' }) })
  const loginAfter = await h.api('POST', '/auth/login', null, { email: mfaUser.email, password: h.DEFAULT_PASSWORD })
  const mfaRequired = loginAfter.body?.mfaRequired === true
  // disable again (need a session token: complete the MFA to get one)
  let disabled = false
  if (mfaRequired) {
    const verify = await h.api('POST', '/auth/mfa/verify', null, { challenge: loginAfter.body.challenge, code: h.speakeasy.totp({ secret, encoding: 'base32' }) })
    const sessTok = verify.body?.token
    const dis = await h.api('POST', '/auth/mfa/disable', sessTok, { code: h.speakeasy.totp({ secret, encoding: 'base32' }) })
    disabled = dis.status === 200 && dis.body?.disabled === true
  }
  h.check('PRF-010', 'MFA enable → login asks OTP → disable works', setup.status === 200 && !!secret && enable.status === 200 && mfaRequired && disabled, `setup ${setup.status}, enable ${enable.status}, otpAsked ${mfaRequired}, disabled ${disabled}`)
})
