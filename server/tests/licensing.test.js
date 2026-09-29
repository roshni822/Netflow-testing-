// LICP — Licensing over HTTP: the Platform Super Admin's plan/limit/licence API.
// Phase 1 scope is the contract only (what can be set, what comes back, what is
// rejected). Enforcement of those numbers is covered by licensing_quota.test.js.

const h = require('./lib/harness')
const { Organization, User } = h

const SA_EMAIL = (process.env.ADMIN_EMAIL || 'superadmin@netflow.app').toLowerCase()
const SA_PASS = process.env.ADMIN_PASSWORD || 'Super@12345'

let seq = 0
const qaSub = (label) => `${h.QA_SUB_PREFIX}lic-${label}-${Date.now().toString(36)}-${seq++}`
const qaEmail = (label) => `lic-${label}-${Date.now().toString(36)}-${seq++}@${h.QA_EMAIL_DOMAIN}`

// Creates an org through the real API so defaults, validation and the bootstrap
// admin all go through the same path production uses.
const createOrg = async (token, label, extra = {}) => {
  const res = await h.api('POST', '/platform/orgs', token, {
    name: `QA Lic ${label}`,
    subdomain: qaSub(label),
    adminEmail: qaEmail(label),
    adminName: `Lic ${label} Admin`,
    ...extra
  })
  return res
}

h.runSuite('licensing', async () => {
  const saTok = await h.getToken({ email: SA_EMAIL, password: SA_PASS })
  if (!saTok) {
    h.check('LICP-000', 'SuperAdmin token obtained (seed superadmin first)', false, 'no token')
    return
  }

  // ── LICP-001 a plan applies its whole preset ───────────────────────────────
  {
    const res = await createOrg(saTok, 'pro', { plan: 'professional' })
    const org = res.body?.org
    h.check('LICP-001', 'Creating an org on Professional applies the preset limits',
      res.status === 201 && org?.plan === 'professional' && org?.limits?.maxUsers === 50
      && org?.limits?.maxBuilders === 3 && org?.limits?.maxForms === 100
      && org?.limits?.maxSubmissionsPerPeriod === 5000 && org?.limits?.maxStorageMb === 10240,
      `status ${res.status} ${JSON.stringify(org?.limits)}`)

    h.check('LICP-002', 'The response carries a licensing snapshot with meters',
      org?.licensing?.planLabel === 'Professional'
      && org?.licensing?.resources?.users?.limit === 50
      && org?.licensing?.resources?.storage?.bufferMb === 500
      && org?.licensing?.licence?.readOnly === false,
      JSON.stringify(org?.licensing?.resources?.users))

    h.check('LICP-003', 'A new tenant starts with an open submission period at zero',
      !!org?.licensing?.period?.start && new Date(org.licensing.period.end) > new Date()
      && org?.licensing?.resources?.submissions?.used === 0,
      JSON.stringify(org?.licensing?.period))

    const admin = await User.findOne({ orgId: org?._id }).setOptions({ skipOrgScope: true }).lean()
    h.check('LICP-004', 'The bootstrap Org Admin holds a builder seat',
      admin?.canBuild === true, `canBuild=${admin?.canBuild}`)
    h.check('LICP-004', 'The builder meter counts that seat',
      org?.licensing?.resources?.builders?.used === 1,
      String(org?.licensing?.resources?.builders?.used))
  }

  // ── LICP-005 defaults for an org created without licensing fields ──────────
  {
    const res = await createOrg(saTok, 'default')
    const org = res.body?.org
    h.check('LICP-005', 'Omitting plan/limits leaves the tenant unlimited (custom)',
      res.status === 201 && org?.plan === 'custom'
      && org?.limits?.maxUsers === 0 && org?.limits?.maxStorageMb === 0
      && org?.licensing?.resources?.users?.unlimited === true,
      `${org?.plan} ${JSON.stringify(org?.limits)}`)
    h.check('LICP-005', 'An org with no expiry is not read-only',
      org?.licensing?.licence?.status === 'active' && org?.licensing?.licence?.expiresAt === null,
      JSON.stringify(org?.licensing?.licence))
  }

  // ── LICP-006 overriding a preset number keeps the selected tier ────────────
  {
    const res = await createOrg(saTok, 'override', { plan: 'basic', limits: { maxUsers: 20 } })
    const org = res.body?.org
    h.check('LICP-006', 'A hand-edited limit is stored and the selected plan is kept',
      res.status === 201 && org?.plan === 'basic' && org?.limits?.maxUsers === 20
      && org?.limits?.maxForms === 25,
      `${org?.plan} users=${org?.limits?.maxUsers} forms=${org?.limits?.maxForms}`)
  }

  // ── LICP-007 rejected payloads ─────────────────────────────────────────────
  {
    const bad = await createOrg(saTok, 'badplan', { plan: 'platinum' })
    h.check('LICP-007', 'An unknown plan is rejected (INVALID_LICENSING)',
      bad.status === 400 && bad.body?.code === 'INVALID_LICENSING',
      `status ${bad.status} code ${bad.body?.code}`)

    const builders = await createOrg(saTok, 'badbuild', { limits: { maxUsers: 5, maxBuilders: 9 } })
    h.check('LICP-007', 'More builder seats than users is rejected',
      builders.status === 400 && /maxBuilders/.test(builders.body?.error || ''),
      `status ${builders.status} ${builders.body?.error}`)

    const negative = await createOrg(saTok, 'badneg', { limits: { maxForms: -1 } })
    h.check('LICP-007', 'A negative limit is rejected', negative.status === 400, `status ${negative.status}`)

    const anchor = await createOrg(saTok, 'badanchor', { billingAnchorDay: 44 })
    h.check('LICP-007', 'An out-of-range billing anchor is rejected',
      anchor.status === 400 && /billingAnchorDay/.test(anchor.body?.error || ''), `status ${anchor.status}`)

    const email = await createOrg(saTok, 'bademail2', { billingEmail: 'nope' })
    h.check('LICP-007', 'A malformed billing email is rejected',
      email.status === 400 && /billingEmail/.test(email.body?.error || ''), `status ${email.status}`)

    const dates = await createOrg(saTok, 'baddates', {
      licence: { validFrom: '2026-06-01', validUntil: '2026-01-01' }
    })
    h.check('LICP-007', 'A licence expiring before it starts is rejected',
      dates.status === 400 && /validUntil/.test(dates.body?.error || ''), `status ${dates.status}`)
  }

  // ── LICP-008 nothing is written when licensing validation fails ────────────
  {
    const sub = qaSub('atomic')
    const res = await h.api('POST', '/platform/orgs', saTok, {
      name: 'QA Lic Atomic', subdomain: sub, adminEmail: qaEmail('atomic'), plan: 'nope'
    })
    const leftover = await Organization.findOne({ subdomain: sub }).lean()
    h.check('LICP-008', 'A rejected create leaves no half-built org behind',
      res.status === 400 && !leftover, `status ${res.status} leftover=${!!leftover}`)
  }

  // ── LICP-009 trial gets an end date automatically ──────────────────────────
  {
    const res = await createOrg(saTok, 'trial', { plan: 'trial' })
    const org = res.body?.org
    const ends = org?.licence?.trialEndsAt ? new Date(org.licence.trialEndsAt) : null
    h.check('LICP-009', 'Trial sets an end date in the future',
      res.status === 201 && org?.plan === 'trial' && ends && ends > new Date(),
      `${org?.plan} ends=${org?.licence?.trialEndsAt}`)
    h.check('LICP-009', 'Trial sells 3 users / 1 builder / 100 submissions',
      org?.limits?.maxUsers === 3 && org?.limits?.maxBuilders === 1
      && org?.limits?.maxSubmissionsPerPeriod === 100, JSON.stringify(org?.limits))
    h.check('LICP-009', 'A live trial is not read-only and reports days left',
      org?.licensing?.licence?.isTrial === true && org?.licensing?.licence?.readOnly === false
      && org?.licensing?.licence?.daysLeft > 0, JSON.stringify(org?.licensing?.licence))
  }

  // ── LICP-010 upgrading a plan through PUT ──────────────────────────────────
  {
    const created = await createOrg(saTok, 'upgrade', { plan: 'basic' })
    const id = created.body?.org?._id

    // Spend part of the old allowance so the upgrade can be checked for both
    // things that matter: the new cap applies, and the count is not forgiven.
    await Organization.updateOne({ _id: id }, { $set: { 'usage.submissions.count': 7 } })

    const res = await h.api('PUT', `/platform/orgs/${id}`, saTok, { plan: 'professional' })
    const org = res.body?.org
    h.check('LICP-010', 'Upgrading Basic to Professional replaces every limit',
      res.status === 200 && org?.plan === 'professional' && org?.limits?.maxUsers === 50
      && org?.limits?.maxStorageMb === 10240 && org?.limits?.maxSubmissionsPerPeriod === 5000,
      `${org?.plan} ${JSON.stringify(org?.limits)}`)
    h.check('LICP-010', 'The window stays open and the submissions already used are kept',
      new Date(org?.licensing?.period?.end) > new Date()
      && org?.licensing?.resources?.submissions?.used === 7
      && org?.licensing?.resources?.submissions?.limit === 5000,
      JSON.stringify(org?.licensing?.resources?.submissions))

    const audit = await h.api('GET', '/platform/activity?action=org_updated', saTok)
    const entry = (audit.body?.logs || []).find((l) => /plan basic/.test(l.detail || ''))
    h.check('LICP-011', 'The plan change is recorded in the platform audit trail',
      !!entry && /professional/.test(entry.detail), entry?.detail || 'no audit entry')
  }

  // ── LICP-012 licence expiry drives read-only ───────────────────────────────
  {
    const created = await createOrg(saTok, 'expire', { plan: 'professional' })
    const id = created.body?.org?._id
    const res = await h.api('PUT', `/platform/orgs/${id}`, saTok, {
      licence: { validFrom: '2024-01-01', validUntil: '2024-06-01' }
    })
    const org = res.body?.org
    h.check('LICP-012', 'A past expiry flips the licence to expired + read-only',
      res.status === 200 && org?.licence?.status === 'expired'
      && org?.licensing?.licence?.readOnly === true
      && org?.licensing?.licence?.reason === 'licence_expired',
      `${org?.licence?.status} ${JSON.stringify(org?.licensing?.licence)}`)

    const revive = await h.api('PUT', `/platform/orgs/${id}`, saTok, {
      licence: { validUntil: new Date(Date.now() + 30 * 86400000).toISOString() }
    })
    h.check('LICP-012', 'Renewing the licence restores write access',
      revive.body?.org?.licence?.status === 'active'
      && revive.body?.org?.licensing?.licence?.readOnly === false,
      JSON.stringify(revive.body?.org?.licensing?.licence))
  }

  // ── LICP-013 billing fields round-trip ─────────────────────────────────────
  {
    const created = await createOrg(saTok, 'billing', { plan: 'basic' })
    const id = created.body?.org?._id
    const res = await h.api('PUT', `/platform/orgs/${id}`, saTok, {
      billingEmail: 'Finance@QA.test', billingAnchorDay: 31
    })
    const org = res.body?.org
    h.check('LICP-013', 'Billing email and anchor day are stored (email normalised)',
      res.status === 200 && org?.billingEmail === 'finance@qa.test' && org?.billingAnchorDay === 31,
      `${org?.billingEmail} / ${org?.billingAnchorDay}`)
    h.check('LICP-013', 'An anchor of 31 still produces a valid window',
      !!org?.licensing?.period?.end, JSON.stringify(org?.licensing?.period))
  }

  // ── LICP-014 usage meters track real data ──────────────────────────────────
  {
    const created = await createOrg(saTok, 'meters', { plan: 'basic' })
    const id = created.body?.org?._id
    const empRole = await h.roleId('Employee')
    await h.runWithOrgId(id, () => User.create({
      orgId: id, name: 'Lic Meter U1', email: qaEmail('meter-u1'),
      password: h.DEFAULT_PASSWORD, department: 'IT', role: empRole
    }))
    // A deactivated user must not consume a licensed seat.
    await h.runWithOrgId(id, () => User.create({
      orgId: id, name: 'Lic Meter U2', email: qaEmail('meter-u2'),
      password: h.DEFAULT_PASSWORD, department: 'IT', role: empRole, isActive: false
    }))

    const list = await h.api('GET', '/platform/orgs', saTok)
    const row = (list.body?.orgs || []).find((o) => String(o._id) === String(id))
    h.check('LICP-014', 'Only active users count towards the seat limit',
      row?.usage?.users === 2 && row?.usage?.usersTotal === 3,
      `licensed=${row?.usage?.users} total=${row?.usage?.usersTotal}`)
    h.check('LICP-014', 'The user meter reports 2 of 10 used',
      row?.licensing?.resources?.users?.used === 2
      && row?.licensing?.resources?.users?.limit === 10
      && row?.licensing?.resources?.users?.percent === 20,
      JSON.stringify(row?.licensing?.resources?.users))
  }

  // ── LICP-015 canBuild is not granted by accident ───────────────────────────
  {
    const created = await createOrg(saTok, 'nobuild', { plan: 'basic' })
    const id = created.body?.org?._id
    const mgrRole = await h.roleId('Manager')
    const mgr = await h.runWithOrgId(id, () => User.create({
      orgId: id, name: 'Lic No Build', email: qaEmail('nobuild-mgr'),
      password: h.DEFAULT_PASSWORD, department: 'IT', role: mgrRole
    }))
    h.check('LICP-015', 'A new user gets no builder seat by default',
      mgr.canBuild === false, `canBuild=${mgr.canBuild}`)
  }
})
