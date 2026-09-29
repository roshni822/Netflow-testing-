// LICQ — Licensing enforcement: what actually happens when a tenant hits a limit
// or lets its licence lapse. Phase 1's suites cover the contract (what can be
// stored); this one covers behaviour (what gets refused, and what must keep
// working anyway).
//
// The read-only matrix is the important half: an expired licence has to stop new
// work without stranding approvals that are already in flight, so both halves are
// asserted here rather than assumed.

const h = require('./lib/harness')
const { runWithOrgId, Form, Workflow, Task, FormResponse, Organization, User } = h

const yesterday = () => new Date(Date.now() - 86400000)

// A published form + published workflow pair, created straight in the DB: these
// tests are about the gates, not about the builder UI.
const seedPublishedForm = async (org, user, title) => {
  const form = await runWithOrgId(org._id, () => Form.create({
    title, status: 'published', createdBy: user._id,
    fields: [{ id: 'f1', type: 'text', label: 'Reason', required: false }]
  }))
  await runWithOrgId(org._id, () => Workflow.create({
    title: `${title} WF`, status: 'published', createdBy: user._id,
    linkedFormId: form._id, nodes: []
  }))
  return form
}

const limitBody = (res) => res.body || {}

h.runSuite('licensing_quota', async () => {
  // ── LICQ-001..003 seat limit on user creation ───────────────────────────────
  {
    const org = await h.createOrg('q-users', {
      plan: 'basic',
      limits: { maxUsers: 3, maxBuilders: 1, maxForms: 2, maxWorkflows: 1, maxSubmissionsPerPeriod: 2 }
    })
    const admin = await h.createUser(org, { name: 'Q Admin', email: h.emailIn(org, 'q-users-admin'), roleName: 'Admin' })
    const tok = await h.getToken({ email: admin.email })
    const empRole = await h.roleId('Employee')

    // Seats: admin (1) + two more fills the plan.
    const first = await h.api('POST', '/users', tok, {
      name: 'Q Seat 2', email: h.emailIn(org, 'q-seat2'), department: 'IT', roleId: empRole
    })
    const second = await h.api('POST', '/users', tok, {
      name: 'Q Seat 3', email: h.emailIn(org, 'q-seat3'), department: 'IT', roleId: empRole
    })
    h.check('LICQ-001', 'Users can be created up to the plan limit',
      first.status === 201 && second.status === 201, `${first.status}/${second.status}`)

    const over = await h.api('POST', '/users', tok, {
      name: 'Q Seat 4', email: h.emailIn(org, 'q-seat4'), department: 'IT', roleId: empRole
    })
    h.check('LICQ-002', 'The seat after the limit is refused with 403 LIMIT_REACHED',
      over.status === 403 && limitBody(over).code === 'LIMIT_REACHED',
      `${over.status} ${limitBody(over).code}`)
    h.check('LICQ-002', 'The refusal carries machine-readable limit context',
      limitBody(over).resource === 'users' && limitBody(over).limit === 3
      && limitBody(over).used === 3 && limitBody(over).upgradeRequired === true
      && limitBody(over).planLabel === 'Basic',
      JSON.stringify(limitBody(over)))
    h.check('LICQ-002', 'The refusal tells the admin how to fix it themselves',
      /deactivate/i.test(limitBody(over).error || ''), limitBody(over).error)

    // Deactivating frees a seat — the meter is "active users", not "ever created".
    const seatId = second.body?.user?._id
    await h.api('PUT', `/users/${seatId}`, tok, { isActive: false })
    const afterFree = await h.api('POST', '/users', tok, {
      name: 'Q Seat 5', email: h.emailIn(org, 'q-seat5'), department: 'IT', roleId: empRole
    })
    h.check('LICQ-003', 'Deactivating a user frees the seat for a new one',
      afterFree.status === 201, `${afterFree.status} ${limitBody(afterFree).error || ''}`)

    // ...and reactivating over the limit is refused, or the meter would be a lie.
    const reactivate = await h.api('PUT', `/users/${seatId}`, tok, { isActive: true })
    h.check('LICQ-003', 'Reactivating a user is refused when no seat is free',
      reactivate.status === 403 && limitBody(reactivate).code === 'LIMIT_REACHED',
      `${reactivate.status} ${limitBody(reactivate).code}`)
  }

  // ── LICQ-004..005 builder seats ────────────────────────────────────────────
  {
    const org = await h.createOrg('q-build', {
      plan: 'basic', limits: { maxUsers: 10, maxBuilders: 1, maxForms: 50, maxWorkflows: 50 }
    })
    const admin = await h.createUser(org, { name: 'Q B Admin', email: h.emailIn(org, 'q-build-admin'), roleName: 'Admin' })
    const designer = await h.createUser(org, {
      name: 'Q B Designer', email: h.emailIn(org, 'q-build-designer'), roleName: 'Admin', canBuild: false
    })
    const mgr = await h.createUser(org, {
      name: 'Q B Mgr', email: h.emailIn(org, 'q-build-mgr'), roleName: 'Manager', canBuild: false
    })
    const adminTok = await h.getToken({ email: admin.email })
    const designerTok = await h.getToken({ email: designer.email })
    const mgrTok = await h.getToken({ email: mgr.email })

    const opsBlocked = await h.api('POST', '/forms', mgrTok, { title: 'Q Ops No Build', fields: [] })
    h.check('LICQ-004', 'A Manager without Builder access cannot design forms',
      opsBlocked.status === 403 && limitBody(opsBlocked).code === 'BUILDER_SEAT_REQUIRED',
      `${opsBlocked.status} ${limitBody(opsBlocked).code}`)

    const noSeat = await h.api('POST', '/forms', designerTok, { title: 'Q No Seat', fields: [] })
    h.check('LICQ-004', 'An Org Admin without a builder seat cannot create a form',
      noSeat.status === 403 && limitBody(noSeat).code === 'BUILDER_SEAT_REQUIRED',
      `${noSeat.status} ${limitBody(noSeat).code}`)

    const noSeatWf = await h.api('POST', '/workflows', designerTok, { title: 'Q No Seat WF', nodes: [] })
    h.check('LICQ-004', 'The same gate applies to workflows',
      noSeatWf.status === 403 && limitBody(noSeatWf).code === 'BUILDER_SEAT_REQUIRED',
      `${noSeatWf.status} ${limitBody(noSeatWf).code}`)

    // The admin already holds the single builder seat, so granting one more fails.
    const grant = await h.api('PUT', `/users/${designer._id}`, adminTok, { canBuild: true })
    h.check('LICQ-005', 'Granting a builder seat beyond the plan is refused',
      grant.status === 403 && limitBody(grant).code === 'LIMIT_REACHED'
      && limitBody(grant).resource === 'builders',
      `${grant.status} ${limitBody(grant).code} ${limitBody(grant).resource}`)

    // Free the admin's seat, then the grant fits.
    await h.api('PUT', `/users/${admin._id}`, adminTok, { canBuild: false })
    const grantAgain = await h.api('PUT', `/users/${designer._id}`, adminTok, { canBuild: true })
    const designerAfter = await User.findById(designer._id).setOptions({ skipOrgScope: true }).lean()
    h.check('LICQ-005', 'Freeing a builder seat lets the grant through',
      grantAgain.status === 200 && designerAfter?.canBuild === true,
      `${grantAgain.status} canBuild=${designerAfter?.canBuild}`)
  }

  // ── LICQ-006..007 forms and workflows ─────────────────────────────────────
  {
    const org = await h.createOrg('q-obj', {
      plan: 'custom', limits: { maxUsers: 0, maxBuilders: 0, maxForms: 1, maxWorkflows: 1 }
    })
    const admin = await h.createUser(org, { name: 'Q O Admin', email: h.emailIn(org, 'q-obj-admin'), roleName: 'Admin' })
    const tok = await h.getToken({ email: admin.email })

    const f1 = await h.api('POST', '/forms', tok, { title: 'Q Form 1', fields: [] })
    const f2 = await h.api('POST', '/forms', tok, { title: 'Q Form 2', fields: [] })
    h.check('LICQ-006', 'The form allowance is enforced on create',
      f1.status === 201 && f2.status === 403 && limitBody(f2).resource === 'forms',
      `${f1.status}/${f2.status} ${limitBody(f2).code}`)

    // Archiving is the documented way out of a form limit, so it has to work.
    await h.api('POST', `/forms/${f1.body?.form?._id}/archive`, tok)
    const f3 = await h.api('POST', '/forms', tok, { title: 'Q Form 3', fields: [] })
    h.check('LICQ-006', 'Archiving a form frees the allowance',
      f3.status === 201, `${f3.status} ${limitBody(f3).error || ''}`)

    const w1 = await h.api('POST', '/workflows', tok, { title: 'Q WF 1', nodes: [] })
    const w2 = await h.api('POST', '/workflows', tok, { title: 'Q WF 2', nodes: [] })
    h.check('LICQ-007', 'The workflow allowance is enforced on create',
      w1.status === 201 && w2.status === 403 && limitBody(w2).resource === 'workflows',
      `${w1.status}/${w2.status} ${limitBody(w2).code}`)
  }

  // ── LICQ-008..010 submissions + metering ──────────────────────────────────
  {
    const org = await h.createOrg('q-sub', {
      plan: 'custom', limits: { maxSubmissionsPerPeriod: 2 },
      usage: { submissions: { periodStart: new Date(Date.now() - 86400000), periodEnd: new Date(Date.now() + 10 * 86400000), count: 0 } }
    })
    const admin = await h.createUser(org, { name: 'Q S Admin', email: h.emailIn(org, 'q-sub-admin'), roleName: 'Admin' })
    const tok = await h.getToken({ email: admin.email })
    const form = await seedPublishedForm(org, admin, 'Q Sub Form')

    const s1 = await h.api('POST', `/forms/${form._id}/submit`, tok, { formData: { f1: 'one' } })
    const s2 = await h.api('POST', `/forms/${form._id}/submit`, tok, { formData: { f1: 'two' } })
    h.check('LICQ-008', 'Submissions are allowed up to the period allowance',
      s1.status === 201 && s2.status === 201, `${s1.status}/${s2.status}`)

    const metered = await Organization.findById(org._id).lean()
    h.check('LICQ-009', 'Each submission increments the period counter',
      Number(metered?.usage?.submissions?.count) === 2,
      `count=${metered?.usage?.submissions?.count}`)

    const s3 = await h.api('POST', `/forms/${form._id}/submit`, tok, { formData: { f1: 'three' } })
    h.check('LICQ-010', 'The submission after the allowance is refused',
      s3.status === 403 && limitBody(s3).code === 'LIMIT_REACHED'
      && limitBody(s3).resource === 'submissions',
      `${s3.status} ${limitBody(s3).code}`)
    h.check('LICQ-010', 'The refusal explains that the allowance resets',
      /resets/i.test(limitBody(s3).error || ''), limitBody(s3).error)

    const stored = await FormResponse.countDocuments({ orgId: org._id }).setOptions({ skipOrgScope: true })
    h.check('LICQ-010', 'A refused submission stores nothing',
      stored === 2, `responses=${stored}`)
  }

  // ── LICQ-011 a stale window rolls over instead of blocking forever ─────────
  {
    const org = await h.createOrg('q-roll', {
      plan: 'custom', billingAnchorDay: new Date().getDate(),
      limits: { maxSubmissionsPerPeriod: 1 },
      usage: {
        submissions: {
          periodStart: new Date(Date.now() - 60 * 86400000),
          periodEnd: new Date(Date.now() - 30 * 86400000),
          count: 1
        }
      }
    })
    const admin = await h.createUser(org, { name: 'Q R Admin', email: h.emailIn(org, 'q-roll-admin'), roleName: 'Admin' })
    const tok = await h.getToken({ email: admin.email })
    const form = await seedPublishedForm(org, admin, 'Q Roll Form')

    const res = await h.api('POST', `/forms/${form._id}/submit`, tok, { formData: { f1: 'new period' } })
    const after = await Organization.findById(org._id).lean()
    h.check('LICQ-011', 'A last-period counter does not block the new period',
      res.status === 201, `${res.status} ${limitBody(res).error || ''}`)
    h.check('LICQ-011', 'The window rolls forward and the count restarts at this submission',
      Number(after?.usage?.submissions?.count) === 1
      && new Date(after?.usage?.submissions?.periodEnd) > new Date(),
      `count=${after?.usage?.submissions?.count} end=${after?.usage?.submissions?.periodEnd}`)
  }

  // ── LICQ-012 grace percent ────────────────────────────────────────────────
  {
    const org = await h.createOrg('q-grace', {
      plan: 'custom', limits: { maxForms: 10, gracePercent: 20 }
    })
    const admin = await h.createUser(org, { name: 'Q G Admin', email: h.emailIn(org, 'q-grace-admin'), roleName: 'Admin' })
    const tok = await h.getToken({ email: admin.email })

    await runWithOrgId(org._id, () => Form.insertMany(
      Array.from({ length: 10 }, (_, i) => ({
        orgId: org._id, title: `Q Grace ${i}`, status: 'draft', createdBy: admin._id, fields: []
      }))
    ))
    const inGrace = await h.api('POST', '/forms', tok, { title: 'Q Grace 11', fields: [] })
    h.check('LICQ-012', 'A grace allowance lets a create through just past the limit',
      inGrace.status === 201, `${inGrace.status} ${limitBody(inGrace).error || ''}`)

    await runWithOrgId(org._id, () => Form.insertMany(
      Array.from({ length: 1 }, (_, i) => ({
        orgId: org._id, title: `Q Grace pad ${i}`, status: 'draft', createdBy: admin._id, fields: []
      }))
    ))
    const pastGrace = await h.api('POST', '/forms', tok, { title: 'Q Grace 13', fields: [] })
    h.check('LICQ-012', 'Past the grace ceiling it is refused, and the message quotes the real limit',
      pastGrace.status === 403 && limitBody(pastGrace).limit === 10,
      `${pastGrace.status} limit=${limitBody(pastGrace).limit}`)
  }

  // ── LICQ-013 unlimited (0) never blocks ───────────────────────────────────
  {
    const org = await h.createOrg('q-unl', { plan: 'custom' })
    const admin = await h.createUser(org, { name: 'Q U Admin', email: h.emailIn(org, 'q-unl-admin'), roleName: 'Admin' })
    const tok = await h.getToken({ email: admin.email })
    const empRole = await h.roleId('Employee')

    const form = await h.api('POST', '/forms', tok, { title: 'Q Unl Form', fields: [] })
    const wf = await h.api('POST', '/workflows', tok, { title: 'Q Unl WF', nodes: [] })
    const user = await h.api('POST', '/users', tok, {
      name: 'Q Unl User', email: h.emailIn(org, 'q-unl-user'), department: 'IT', roleId: empRole
    })
    h.check('LICQ-013', 'A tenant with all-zero limits is unlimited, exactly as before licensing',
      form.status === 201 && wf.status === 201 && user.status === 201,
      `${form.status}/${wf.status}/${user.status}`)
  }

  // ── LICQ-014..015 CSV import fills the seats it can ───────────────────────
  {
    const org = await h.createOrg('q-imp', { plan: 'custom', limits: { maxUsers: 3 } })
    const admin = await h.createUser(org, { name: 'Q I Admin', email: h.emailIn(org, 'q-imp-admin'), roleName: 'Admin' })
    const tok = await h.getToken({ email: admin.email })

    const rows = Array.from({ length: 5 }, (_, i) => ({
      name: `Q Imp ${i}`, email: h.emailIn(org, `q-imp-${i}`), department: 'IT', role: 'Employee'
    }))
    const res = await h.api('POST', '/users/import', tok, { users: rows })
    const active = await User.countDocuments({ orgId: org._id, isActive: true }).setOptions({ skipOrgScope: true })
    h.check('LICQ-014', 'An import that exceeds the seat limit imports what fits',
      res.status === 201 && res.body?.created === 2,
      `status ${res.status} created=${res.body?.created}`)
    h.check('LICQ-014', 'The tenant lands exactly on its limit, never past it',
      active === 3, `active=${active}`)

    const overflow = (res.body?.results || []).filter((r) => r.status === 'skipped')
    h.check('LICQ-015', 'The rows that did not fit are reported back, each with a reason',
      res.body?.skipped === 3 && overflow.length === 3
      && overflow.every((r) => /limit reached/i.test(r.reason || '')),
      JSON.stringify(overflow).slice(0, 240))
  }

  // ── LICQ-016..021 read-only mode: the allowlist matrix ────────────────────
  {
    const org = await h.createOrg('q-ro', {
      plan: 'professional',
      licence: { validFrom: new Date(Date.now() - 30 * 86400000), validUntil: yesterday(), status: 'active' }
    })
    const admin = await h.createUser(org, { name: 'Q RO Admin', email: h.emailIn(org, 'q-ro-admin'), roleName: 'Admin' })
    const mgr = await h.createUser(org, { name: 'Q RO Mgr', email: h.emailIn(org, 'q-ro-mgr'), roleName: 'Manager' })
    const emp = await h.createUser(org, { name: 'Q RO Emp', email: h.emailIn(org, 'q-ro-emp'), roleName: 'Employee', managerId: mgr._id })

    // Signing in still works — you have to get in to find out why you are locked.
    const adminTok = await h.getToken({ email: admin.email })
    const mgrTok = await h.getToken({ email: mgr.email })
    const empTok = await h.getToken({ email: emp.email })
    h.check('LICQ-016', 'An expired licence does not stop anyone signing in',
      Boolean(adminTok && mgrTok && empTok), 'a token was missing')

    // Blocked: anything that starts new work.
    const newForm = await h.api('POST', '/forms', adminTok, { title: 'Q RO Form', fields: [] })
    h.check('LICQ-017', 'Creating a form is refused with 403 LICENCE_READ_ONLY',
      newForm.status === 403 && limitBody(newForm).code === 'LICENCE_READ_ONLY',
      `${newForm.status} ${limitBody(newForm).code}`)
    h.check('LICQ-017', 'The refusal says why, when, and that reads still work',
      limitBody(newForm).readOnly === true
      && limitBody(newForm).reason === 'licence_expired'
      && Boolean(limitBody(newForm).expiredAt)
      && /renew/i.test(limitBody(newForm).error || ''),
      JSON.stringify(limitBody(newForm)))

    const empRole = await h.roleId('Employee')
    const newUser = await h.api('POST', '/users', adminTok, {
      name: 'Q RO New', email: h.emailIn(org, 'q-ro-new'), department: 'IT', roleId: empRole
    })
    const form = await seedPublishedForm(org, admin, 'Q RO Existing Form')
    const newSubmit = await h.api('POST', `/forms/${form._id}/submit`, empTok, { formData: { f1: 'x' } })
    h.check('LICQ-018', 'Adding a user and starting a new request are both refused',
      newUser.status === 403 && limitBody(newUser).code === 'LICENCE_READ_ONLY'
      && newSubmit.status === 403 && limitBody(newSubmit).code === 'LICENCE_READ_ONLY',
      `user ${newUser.status}/${limitBody(newUser).code}, submit ${newSubmit.status}/${limitBody(newSubmit).code}`)

    // Allowed: reads, and finishing work that already exists.
    const readForms = await h.api('GET', '/forms', adminTok)
    const readTasks = await h.api('GET', '/tasks/my-tasks', mgrTok)
    h.check('LICQ-019', 'Reads and exports keep working for the tenant that stopped paying',
      readForms.status === 200 && readTasks.status === 200,
      `${readForms.status}/${readTasks.status}`)

    const pending = await runWithOrgId(org._id, () => Task.create({
      title: 'Q RO in-flight approval', type: 'IT', status: 'pending',
      assignedTo: mgr._id, submittedBy: emp._id
    }))
    const approve = await h.api('POST', `/tasks/${pending._id}/approve`, mgrTok, { comment: 'ok' })
    h.check('LICQ-020', 'An approval already in flight can still be completed',
      approve.status === 200, `${approve.status} ${limitBody(approve).code || ''} ${limitBody(approve).error || ''}`)

    const ooo = await h.api('PUT', '/users/me/out-of-office', empTok, { enabled: true, note: 'read-only QA' })
    const notif = await h.api('PATCH', '/notifications/mark-all-read', empTok, {})
    h.check('LICQ-021', 'Self-service settings and notification housekeeping stay available',
      ooo.status === 200 && [200, 204].includes(notif.status),
      `out-of-office ${ooo.status}, notifications ${notif.status}`)
  }

  // ── LICQ-022 an expired trial reads differently to an expired licence ─────
  {
    const org = await h.createOrg('q-trial', {
      plan: 'trial', licence: { trialEndsAt: yesterday(), status: 'active' }
    })
    const admin = await h.createUser(org, { name: 'Q T Admin', email: h.emailIn(org, 'q-trial-admin'), roleName: 'Admin' })
    const tok = await h.getToken({ email: admin.email })
    const res = await h.api('POST', '/forms', tok, { title: 'Q Trial Form', fields: [] })
    h.check('LICQ-022', 'An expired trial is read-only with trial wording, not licence wording',
      res.status === 403 && limitBody(res).reason === 'trial_expired'
      && /trial/i.test(limitBody(res).error || ''),
      `${res.status} ${limitBody(res).reason}`)
  }

  // ── LICQ-023 a suspended licence behaves like an expired one ──────────────
  {
    const org = await h.createOrg('q-susp', {
      plan: 'professional', licence: { status: 'suspended' }
    })
    const admin = await h.createUser(org, { name: 'Q Sp Admin', email: h.emailIn(org, 'q-susp-admin'), roleName: 'Admin' })
    const tok = await h.getToken({ email: admin.email })
    const res = await h.api('POST', '/forms', tok, { title: 'Q Susp Form', fields: [] })
    const read = await h.api('GET', '/forms', tok)
    h.check('LICQ-023', 'A suspended licence blocks writes but not reads',
      res.status === 403 && limitBody(res).code === 'LICENCE_READ_ONLY' && read.status === 200,
      `write ${res.status}, read ${read.status}`)
  }

  // ── LICQ-024 self-registration respects both gates ───────────────────────
  //
  // Self-signup always lands in the default organization (there is no per-tenant
  // signup page yet), so this is the one case that has to touch that org. Its
  // licensing fields are restored in `finally`, and any account the walk-in
  // manages to create is removed.
  {
    const home = await Organization.findOne({ isDefault: true })
    if (!home) {
      h.note('LICQ-024', 'Blocked', 'No default organization — run npm run seed:org')
    } else {
      const saved = {
        plan: home.plan,
        limits: home.limits?.toObject ? home.limits.toObject() : { ...home.limits },
        licence: home.licence?.toObject ? home.licence.toObject() : { ...home.licence }
      }
      const walkIn = `q-reg-walkin-${Date.now().toString(36)}@${h.QA_EMAIL_DOMAIN}`
      const late = `q-reg-late-${Date.now().toString(36)}@${h.QA_EMAIL_DOMAIN}`
      try {
        await Organization.updateOne({ _id: home._id }, { $set: { 'limits.maxUsers': 1 } })
        const res = await h.api('POST', '/auth/register', null, {
          name: 'Q Reg Walkin', email: walkIn, password: h.DEFAULT_PASSWORD, department: 'IT'
        })
        h.check('LICQ-024', 'Self-registration into a full tenant is refused, not silently allowed',
          res.status === 403 && limitBody(res).code === 'LIMIT_REACHED',
          `${res.status} ${limitBody(res).code}`)

        await Organization.updateOne({ _id: home._id }, {
          $set: { 'limits.maxUsers': 0, 'licence.validUntil': yesterday() }
        })
        const res2 = await h.api('POST', '/auth/register', null, {
          name: 'Q Reg Late', email: late, password: h.DEFAULT_PASSWORD, department: 'IT'
        })
        h.check('LICQ-024', 'Self-registration into an expired tenant is refused',
          res2.status === 403 && limitBody(res2).code === 'LICENCE_READ_ONLY',
          `${res2.status} ${limitBody(res2).code}`)
      } finally {
        await Organization.updateOne({ _id: home._id }, {
          $set: { plan: saved.plan, limits: saved.limits, licence: saved.licence }
        })
        await User.deleteMany({ email: { $in: [walkIn, late] } }).setOptions({ skipOrgScope: true })
      }
    }
  }

  // ── LICQ-025..026 public form links are gated too ────────────────────────
  {
    const org = await h.createOrg('q-pub', { plan: 'custom', limits: { maxSubmissionsPerPeriod: 1 } })
    const admin = await h.createUser(org, { name: 'Q P Admin', email: h.emailIn(org, 'q-pub-admin'), roleName: 'Admin' })
    const form = await runWithOrgId(org._id, () => Form.create({
      title: 'Q Public Form', status: 'published', createdBy: admin._id,
      fields: [{ id: 'f1', type: 'text', label: 'Reason' }],
      public: { enabled: true, token: `qa-pub-${Date.now().toString(36)}` }
    }))
    const token = form.public?.token

    const first = await h.api('POST', `/public/forms/${token}/submit`, null, { formData: { f1: 'anon 1' } })
    const metered = await Organization.findById(org._id).lean()
    h.check('LICQ-025', 'An anonymous submission counts against the tenant allowance',
      first.status === 201 && Number(metered?.usage?.submissions?.count) === 1,
      `${first.status} count=${metered?.usage?.submissions?.count}`)

    const second = await h.api('POST', `/public/forms/${token}/submit`, null, { formData: { f1: 'anon 2' } })
    h.check('LICQ-025', 'A public link cannot be used to bypass the submission allowance',
      second.status === 403 && limitBody(second).code === 'LIMIT_REACHED',
      `${second.status} ${limitBody(second).code}`)
    h.check('LICQ-025', 'A stranger is told the form is closed, not the tenant\'s plan details',
      !/plan|licence|limit of/i.test(limitBody(second).error || ''), limitBody(second).error)

    await Organization.updateOne({ _id: org._id }, {
      $set: { 'limits.maxSubmissionsPerPeriod': 50, 'licence.validUntil': yesterday() }
    })
    const res2 = await h.api('POST', `/public/forms/${token}/submit`, null, { formData: { f1: 'anon 3' } })
    h.check('LICQ-026', 'A public link is closed while the licence is expired',
      res2.status === 403 && limitBody(res2).code === 'LICENCE_READ_ONLY',
      `${res2.status} ${limitBody(res2).code}`)
  }

  // ── LICQ-027..028 storage: size and file count, whichever comes first ─────
  {
    const { checkStorage } = require('../middleware/quota')
    const MB = 1024 * 1024

    const org = await h.createOrg('q-stor', {
      plan: 'custom',
      limits: { maxStorageMb: 100, maxFiles: 3 },
      usage: { storageBytes: 99 * MB, fileCount: 2 }
    })

    const fits = await checkStorage(org, 1 * MB - 1)
    const tooBig = await checkStorage(org, 5 * MB)
    h.check('LICQ-027', 'An upload that fits the licensed size is allowed',
      fits.ok === true && fits.bufferBytes === 0, JSON.stringify(fits))
    h.check('LICQ-027', 'An upload past the licensed size is refused with storage context',
      tooBig.ok === false && tooBig.code === 'LIMIT_REACHED' && tooBig.extra?.resource === 'storage',
      JSON.stringify(tooBig.extra))

    // The completion buffer only opens for an attachment an approval needs.
    const buffered = await checkStorage(org, 5 * MB, { allowBuffer: true })
    h.check('LICQ-028', 'The completion buffer lets a blocked approval attach its file',
      buffered.ok === true && buffered.bufferBytes > 0,
      JSON.stringify(buffered))

    // File count is the other half of the rule: the 4th file fails on a 3-file
    // plan even though there is plenty of room in MB.
    const smallOrg = await h.createOrg('q-files', {
      plan: 'custom', limits: { maxStorageMb: 0, maxFiles: 3 }, usage: { fileCount: 3 }
    })
    const byCount = await checkStorage(smallOrg, 1024)
    h.check('LICQ-028', 'The file-count limit blocks even when storage size is unlimited',
      byCount.ok === false && byCount.extra?.resource === 'files',
      JSON.stringify(byCount.extra))
  }

  // ── LICQ-029 a Super Admin storage extension unblocks a full tenant ──────
  {
    const SA_EMAIL = (process.env.ADMIN_EMAIL || 'superadmin@netflow.app').toLowerCase()
    const SA_PASS = process.env.ADMIN_PASSWORD || 'Super@12345'
    const saTok = await h.getToken({ email: SA_EMAIL, password: SA_PASS })
    if (!saTok) {
      h.note('LICQ-029', 'Blocked', 'No SuperAdmin token — run npm run seed:superadmin')
    } else {
      const { checkStorage } = require('../middleware/quota')
      const MB = 1024 * 1024
      const org = await h.createOrg('q-ext', {
        plan: 'custom', limits: { maxStorageMb: 10 }, usage: { storageBytes: 10 * MB, bufferBytesUsed: 500 * MB }
      })

      const before = await checkStorage(org, 2 * MB, { allowBuffer: true })
      const grant = await h.api('POST', `/platform/orgs/${org._id}/storage-extension`, saTok, {
        extraMb: 50, days: 7, reason: 'QA extension'
      })
      const after = await checkStorage(await Organization.findById(org._id), 2 * MB)
      h.check('LICQ-029', 'Storage full past the reserve is refused until support intervenes',
        before.ok === false, JSON.stringify(before.extra))
      h.check('LICQ-029', 'A temporary extension raises the ceiling without changing the plan',
        grant.status === 200 && after.ok === true
        && Number(grant.body?.org?.limits?.maxStorageMb) === 10
        && Number(grant.body?.org?.licensing?.resources?.storage?.extensionMb) === 50,
        `${grant.status} ok=${after.ok} ext=${grant.body?.org?.licensing?.resources?.storage?.extensionMb}`)

      const revoke = await h.api('DELETE', `/platform/orgs/${org._id}/storage-extension`, saTok)
      const afterRevoke = await checkStorage(await Organization.findById(org._id), 2 * MB)
      h.check('LICQ-029', 'Revoking the extension puts the ceiling back',
        revoke.status === 200 && afterRevoke.ok === false,
        `${revoke.status} ok=${afterRevoke.ok}`)
    }
  }

  // ── LICQ-030 the kill switch ──────────────────────────────────────────────
  // LICENSING_ENFORCE=0 disables numeric quota and expiry checks, but never the
  // Builder authorization boundary. Asserted in-process because the flag is read
  // at request time and this suite cannot restart the server.
  {
    const { checkQuota, checkStorage, requireCanBuild } = require('../middleware/quota')
    const { writeBlockFor } = require('../middleware/licence')
    const MB = 1024 * 1024

    const org = await h.createOrg('q-flag', {
      plan: 'basic',
      limits: { maxUsers: 1, maxForms: 1, maxStorageMb: 1, maxFiles: 1 },
      licence: { validUntil: yesterday(), status: 'expired' },
      usage: { storageBytes: 5 * MB, fileCount: 9 }
    })
    await h.createUser(org, { name: 'Q F Admin', email: h.emailIn(org, 'q-flag-admin'), roleName: 'Admin' })

    const before = {
      quota: await checkQuota(org, 'users'),
      storage: await checkStorage(org, 10 * MB),
      licence: writeBlockFor(org)
    }
    h.check('LICQ-030', 'With enforcement on, an over-limit expired tenant is blocked on all three gates',
      Boolean(before.quota) && before.storage.ok === false && Boolean(before.licence),
      `quota=${Boolean(before.quota)} storage=${before.storage.ok} licence=${Boolean(before.licence)}`)

    const saved = process.env.LICENSING_ENFORCE
    process.env.LICENSING_ENFORCE = '0'
    try {
      const quota = await checkQuota(org, 'users')
      const storage = await checkStorage(org, 10 * MB)
      const licence = writeBlockFor(org)
      let seatDenied = false
      requireCanBuild({ user: { canBuild: false, role: { name: 'Manager' } }, organization: org },
        {
          status() { seatDenied = true; return this },
          json() { return this }
        },
        () => { seatDenied = false })
      h.check('LICQ-030', 'With enforcement off, quotas are bypassed but Builder access remains protected',
        quota === null && storage.ok === true && licence === null && seatDenied === true,
        `quota=${quota} storage=${storage.ok} licence=${licence} builderDenied=${seatDenied}`)
    } finally {
      if (saved === undefined) delete process.env.LICENSING_ENFORCE
      else process.env.LICENSING_ENFORCE = saved
    }

    const restored = await checkQuota(org, 'users')
    h.check('LICQ-030', 'Clearing the flag restores enforcement without a restart',
      Boolean(restored), `quota=${Boolean(restored)}`)
  }
})
