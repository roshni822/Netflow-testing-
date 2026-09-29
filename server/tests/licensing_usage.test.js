// LICU — Licensing Phase 3: the parts that run on their own.
//
// Phase 2's suite proves a limit refuses work. This one proves the tenant finds
// out before that happens, that the numbers behind the refusal stay true over
// months of $inc, and that both sides (Org Admin, Super Admin) can read the same
// meters through the API.
//
// The two background jobs are exercised through their single-tenant entry points
// (checkOrgLicence / reconcileOrg) rather than the full sweeps, so a run against
// a shared dev database can never touch an org outside the qa-* namespace.

const fs = require('fs')
const path = require('path')

const h = require('./lib/harness')
const { runWithOrgId, Organization, Notification, AuditLog, Form, User } = h

const { evaluateWarnings } = require('../utils/usageWarnings')
const { checkOrgLicence } = require('../jobs/licenceCron')
const { reconcileOrg } = require('../jobs/usageCron')
const { dirForOrg, UPLOAD_ROOT } = require('../utils/fileStore')
const { meterSubmission } = require('../utils/usageMeter')
const { periodFor } = require('../utils/billingPeriod')

const MB = 1024 * 1024
const DAY = 86400000
const inDays = (n) => new Date(Date.now() + n * DAY)
const yesterday = () => new Date(Date.now() - DAY)

// Notifications the warning/expiry code wrote for this org's admins.
const systemNotices = (orgId) =>
  Notification.find({ orgId, type: 'system' }).sort({ createdAt: 1 }).setOptions({ skipOrgScope: true }).lean()

const flagsOf = async (orgId) => {
  const org = await Organization.findById(orgId).lean()
  return { usage: org.usage?.notified || {}, licence: org.licence?.notified || {}, org }
}

// Writes `count` files of `sizeBytes` into the org's real upload directory, so
// the reconciliation job has something to measure.
const seedFiles = (orgId, count, sizeBytes) => {
  const dir = dirForOrg(orgId)
  for (let i = 0; i < count; i++) {
    fs.writeFileSync(path.join(dir, `qa-recon-${i}.bin`), Buffer.alloc(sizeBytes, 1))
  }
}

const removeOrgDir = (orgId) => {
  try { fs.rmSync(path.join(UPLOAD_ROOT, String(orgId)), { recursive: true, force: true }) } catch { /* best effort */ }
}

h.runSuite('licensing_usage', async () => {
  // ── LICU-001..003 the warning evaluator ───────────────────────────────────
  {
    const org = await h.createOrg('u-warn', {
      plan: 'basic',
      limits: { maxUsers: 10, maxSubmissionsPerPeriod: 10, maxStorageMb: 100 },
      usage: { submissions: { periodStart: new Date(), periodEnd: inDays(20), count: 8 } }
    })
    const admin = await h.createUser(org, {
      name: 'Q W Admin', email: h.emailIn(org, 'u-warn-admin'), roleName: 'Admin'
    })

    const first = await evaluateWarnings(await Organization.findById(org._id).lean())
    const notices = await systemNotices(org._id)
    const after = await flagsOf(org._id)
    h.check('LICU-001', 'Crossing 80% of the submission allowance warns the admin once',
      first.length === 1 && /80%/.test(first[0].title) && notices.length === 1
      && String(notices[0].userId) === String(admin._id),
      `${first.length} sent, ${notices.length} notice(s): ${first[0]?.title}`)
    h.check('LICU-001', 'The warning names the plan and the numbers behind it',
      /Basic/.test(notices[0]?.message || '') && /8 of 10/.test(notices[0]?.message || ''),
      notices[0]?.message)
    h.check('LICU-001', 'The 80% flag is stored so the next write stays quiet',
      after.usage.sub80 === true && after.usage.sub90 === false, JSON.stringify(after.usage))

    const repeat = await evaluateWarnings(await Organization.findById(org._id).lean())
    h.check('LICU-002', 'The same threshold never warns twice',
      repeat.length === 0 && (await systemNotices(org._id)).length === 1,
      `${repeat.length} sent`)

    // A jump straight past 90% to full must produce one message, not two.
    await Organization.updateOne({ _id: org._id }, { $set: { 'usage.submissions.count': 10 } })
    const full = await evaluateWarnings(await Organization.findById(org._id).lean())
    const fullFlags = await flagsOf(org._id)
    h.check('LICU-002', 'A jump from 80% to full sends the highest warning only',
      full.length === 1 && /used up/i.test(full[0].title)
      && fullFlags.usage.sub90 === true && fullFlags.usage.sub100 === true,
      `${full.length} sent: ${full.map((f) => f.title).join(', ')}`)
    h.check('LICU-002', 'The "allowance used up" notice says in-flight approvals are safe',
      /approvals already in progress are unaffected/i.test((await systemNotices(org._id)).pop()?.message || ''),
      (await systemNotices(org._id)).pop()?.message)

    // Storage warns on its own schedule, including the 95% step submissions
    // do not have.
    await Organization.updateOne({ _id: org._id }, { $set: { 'usage.storageBytes': 96 * MB } })
    const stor = await evaluateWarnings(await Organization.findById(org._id).lean())
    const storFlags = await flagsOf(org._id)
    h.check('LICU-003', 'Storage has a 95% step of its own',
      stor.length === 1 && /95%/.test(stor[0].title)
      && storFlags.usage.stor80 && storFlags.usage.stor90 && storFlags.usage.stor95
      && storFlags.usage.stor100 === false,
      `${stor[0]?.title} ${JSON.stringify(storFlags.usage)}`)

    // Using the emergency reserve is a separate fact from being at 100%.
    await Organization.updateOne({ _id: org._id }, {
      $set: { 'usage.storageBytes': 101 * MB, 'usage.bufferBytesUsed': 1 * MB }
    })
    const buffered = await evaluateWarnings(await Organization.findById(org._id).lean())
    h.check('LICU-003', 'Full storage and the reserve in use are reported separately',
      buffered.length === 2
      && buffered.some((b) => /Storage is full/i.test(b.title))
      && buffered.some((b) => /emergency reserve/i.test(b.title)),
      buffered.map((b) => b.title).join(' | '))

    // Unlimited is not "very large" — it must never warn.
    const unlimited = await h.createOrg('u-unl', {
      plan: 'enterprise',
      usage: { storageBytes: 900 * MB, submissions: { periodStart: new Date(), periodEnd: inDays(20), count: 9999 } }
    })
    const none = await evaluateWarnings(await Organization.findById(unlimited._id).lean())
    h.check('LICU-003', 'An unlimited plan is never warned about anything',
      none.length === 0, `${none.length} sent`)
  }

  // ── LICU-004 warnings start again after the ground truth changes ──────────
  {
    const org = await h.createOrg('u-reset', {
      plan: 'basic',
      limits: { maxSubmissionsPerPeriod: 10, maxStorageMb: 100 },
      // An elapsed window: the next metered submission has to roll it.
      usage: {
        submissions: { periodStart: new Date(Date.now() - 40 * DAY), periodEnd: yesterday(), count: 10 },
        notified: { sub80: true, sub90: true, sub100: true, stor80: true }
      },
      billingAnchorDay: new Date().getDate()
    })

    const period = await meterSubmission(org._id)
    const rolled = await flagsOf(org._id)
    h.check('LICU-004', 'A new billing period resets the count and the warning flags',
      Number(period?.count) === 1
      && rolled.usage.sub80 === false && rolled.usage.sub100 === false,
      `count=${period?.count} ${JSON.stringify(rolled.usage)}`)
    h.check('LICU-004', 'Rolling the submission window leaves the storage flags alone',
      rolled.usage.stor80 === true, JSON.stringify(rolled.usage))

    // Raising the storage limit invalidates the "you are nearly full" it sent.
    const SA_EMAIL = (process.env.ADMIN_EMAIL || 'superadmin@netflow.app').toLowerCase()
    const SA_PASS = process.env.ADMIN_PASSWORD || 'Super@12345'
    const saTok = await h.getToken({ email: SA_EMAIL, password: SA_PASS })
    if (!saTok) {
      h.note('LICU-005', 'Blocked', 'No SuperAdmin token — run npm run seed:superadmin')
    } else {
      const res = await h.api('PUT', `/platform/orgs/${org._id}`, saTok, {
        limits: { maxStorageMb: 500 }
      })
      const afterLimit = await flagsOf(org._id)
      h.check('LICU-005', 'Raising a limit clears the warnings that measured the old one',
        res.status === 200 && afterLimit.usage.stor80 === false,
        `${res.status} ${JSON.stringify(afterLimit.usage)}`)
    }
  }

  // ── LICU-006..008 licence expiry reminders ────────────────────────────────
  {
    const org = await h.createOrg('u-lic', {
      plan: 'professional',
      licence: { validFrom: new Date(Date.now() - 300 * DAY), validUntil: inDays(45), status: 'active' },
      billingEmail: `q-billing@${h.QA_EMAIL_DOMAIN}`
    })
    await h.createUser(org, { name: 'Q L Admin', email: h.emailIn(org, 'u-lic-admin'), roleName: 'Admin' })

    const early = await checkOrgLicence(await Organization.findById(org._id).lean())
    h.check('LICU-006', 'A licence with 45 days left is not nagged about',
      early === null && (await systemNotices(org._id)).length === 0, String(early))

    await Organization.updateOne({ _id: org._id }, { $set: { 'licence.validUntil': inDays(20) } })
    const first = await checkOrgLicence(await Organization.findById(org._id).lean())
    let notices = await systemNotices(org._id)
    const flags1 = await flagsOf(org._id)
    h.check('LICU-006', 'Crossing 30 days out sends the first renewal reminder',
      first === 'reminded' && notices.length === 1 && flags1.licence.d30 === true,
      `${first} notices=${notices.length} d30=${flags1.licence.d30}`)
    h.check('LICU-006', 'The reminder explains what read-only will and will not stop',
      /read-only/i.test(notices[0].message) && /approvals already in progress/i.test(notices[0].message),
      notices[0].message)

    const again = await checkOrgLicence(await Organization.findById(org._id).lean())
    h.check('LICU-006', 'The hourly job does not re-send a reminder it already sent',
      again === null && (await systemNotices(org._id)).length === 1, String(again))

    // A later step sends its own message — and says how long is actually left,
    // not which threshold happened to fire.
    await Organization.updateOne({ _id: org._id }, { $set: { 'licence.validUntil': inDays(5) } })
    const second = await checkOrgLicence(await Organization.findById(org._id).lean())
    const flags2 = await flagsOf(org._id)
    notices = await systemNotices(org._id)
    h.check('LICU-007', 'A later reminder reports the real days left, not the threshold',
      second === 'reminded' && notices.length === 2 && /in 5 days/.test(notices[1].message),
      `${second} ${notices[1]?.message}`)
    h.check('LICU-007', 'Steps the clock jumped over are marked sent, so they cannot double up',
      flags2.licence.d14 === true && flags2.licence.d7 === true && flags2.licence.d1 === false,
      JSON.stringify(flags2.licence))

    // Expiry: stored status, one audit entry, one notice — and then silence.
    await Organization.updateOne({ _id: org._id }, { $set: { 'licence.validUntil': yesterday() } })
    const expired = await checkOrgLicence(await Organization.findById(org._id).lean())
    const flags3 = await flagsOf(org._id)
    const audits = await AuditLog.find({ orgId: org._id, action: 'org_licence_expired' })
      .setOptions({ skipOrgScope: true }).lean()
    notices = await systemNotices(org._id)
    h.check('LICU-008', 'A lapsed licence is recorded as expired on the org',
      expired === 'expired' && flags3.org.licence.status === 'expired' && flags3.licence.expired === true,
      `${expired} status=${flags3.org.licence.status}`)
    h.check('LICU-008', 'Expiry writes exactly one audit entry, attributed to the system',
      audits.length === 1 && !audits[0].performedBy && /read-only/i.test(audits[0].detail || ''),
      `${audits.length} entries: ${audits[0]?.detail}`)
    h.check('LICU-008', 'The tenant is told once that it is now read-only',
      notices.length === 3 && /read-only/i.test(notices[2].title),
      `${notices.length} notices: ${notices[2]?.title}`)

    const settled = await checkOrgLicence(await Organization.findById(org._id).lean())
    h.check('LICU-008', 'An already-expired tenant is not notified every hour',
      settled === null && (await systemNotices(org._id)).length === 3, String(settled))
  }

  // ── LICU-009 renewal restarts the reminder sequence ──────────────────────
  {
    const SA_EMAIL = (process.env.ADMIN_EMAIL || 'superadmin@netflow.app').toLowerCase()
    const SA_PASS = process.env.ADMIN_PASSWORD || 'Super@12345'
    const saTok = await h.getToken({ email: SA_EMAIL, password: SA_PASS })
    if (!saTok) {
      h.note('LICU-009', 'Blocked', 'No SuperAdmin token — run npm run seed:superadmin')
    } else {
      const org = await h.createOrg('u-renew', {
        plan: 'basic',
        licence: {
          validUntil: yesterday(),
          status: 'expired',
          notified: { d30: true, d14: true, d7: true, d1: true, expired: true }
        }
      })
      const res = await h.api('PUT', `/platform/orgs/${org._id}`, saTok, {
        licence: { validUntil: inDays(400) }
      })
      const after = await flagsOf(org._id)
      h.check('LICU-009', 'Renewing a licence clears the expiry notices and reactivates it',
        res.status === 200 && after.org.licence.status === 'active'
        && after.licence.d30 === false && after.licence.expired === false,
        `${res.status} status=${after.org.licence.status} ${JSON.stringify(after.licence)}`)

      // ...and the sequence can run again next year.
      await Organization.updateOne({ _id: org._id }, { $set: { 'licence.validUntil': inDays(10) } })
      const did = await checkOrgLicence(await Organization.findById(org._id).lean())
      h.check('LICU-009', 'The renewed licence warns again as its own end approaches',
        did === 'reminded', String(did))
    }
  }

  // ── LICU-010 a suspended tenant is not also told it expired ──────────────
  {
    const org = await h.createOrg('u-susp', {
      plan: 'basic',
      status: 'suspended',
      licence: { validUntil: yesterday(), status: 'suspended' }
    })
    await h.createUser(org, { name: 'Q S Admin', email: h.emailIn(org, 'u-susp-admin'), roleName: 'Admin' })
    const did = await checkOrgLicence(await Organization.findById(org._id).lean())
    const after = await flagsOf(org._id)
    h.check('LICU-010', 'A suspended tenant keeps that status instead of being marked expired',
      did === null && after.org.licence.status === 'suspended'
      && (await systemNotices(org._id)).length === 0,
      `${did} status=${after.org.licence.status}`)
  }

  // ── LICU-011 the trial says "trial", not "licence" ───────────────────────
  {
    const org = await h.createOrg('u-trial', {
      plan: 'trial',
      licence: { trialEndsAt: inDays(1), status: 'active' }
    })
    await h.createUser(org, { name: 'Q T Admin', email: h.emailIn(org, 'u-trial-admin'), roleName: 'Admin' })
    const did = await checkOrgLicence(await Organization.findById(org._id).lean())
    const notices = await systemNotices(org._id)
    h.check('LICU-011', 'A trial ending is described as a trial, and offers a plan',
      did === 'reminded' && /trial ends/i.test(notices[0]?.title || '')
      && /choose a plan/i.test(notices[0]?.message || ''),
      `${did} ${notices[0]?.title}`)
  }

  // ── LICU-012..013 nightly reconciliation ─────────────────────────────────
  {
    const org = await h.createOrg('u-recon', {
      plan: 'custom',
      limits: { maxStorageMb: 100 },
      // Drift in both directions at once: the counter claims 50 MB across 7
      // files, the disk holds 3 files of 1 MB.
      usage: { storageBytes: 50 * MB, fileCount: 7, bufferBytesUsed: 10 * MB }
    })
    try {
      seedFiles(org._id, 3, 1 * MB)

      const changes = await reconcileOrg(await Organization.findById(org._id).lean())
      const fixed = await Organization.findById(org._id).lean()
      h.check('LICU-012', 'Reconciliation replaces a drifted counter with what is on disk',
        Number(fixed.usage.storageBytes) === 3 * MB && Number(fixed.usage.fileCount) === 3,
        `${fixed.usage.storageBytes} bytes / ${fixed.usage.fileCount} files`)
      h.check('LICU-012', 'Reconciliation repays reserve that is no longer in use',
        Number(fixed.usage.bufferBytesUsed) === 0, String(fixed.usage.bufferBytesUsed))
      h.check('LICU-012', 'The job reports what it changed',
        changes.some((c) => /storage 50\.0→3\.0 MB/.test(c)), changes.join('; '))

      const second = await reconcileOrg(await Organization.findById(org._id).lean())
      h.check('LICU-013', 'A second pass finds nothing to change',
        second.length === 0, second.join('; '))
    } finally {
      removeOrgDir(org._id)
    }
  }

  // LICU-014 - reconciliation rolls a window nobody touched.
  {
    const org = await h.createOrg('u-idle', {
      plan: 'basic',
      limits: { maxSubmissionsPerPeriod: 100 },
      usage: {
        submissions: { periodStart: new Date(Date.now() - 60 * DAY), periodEnd: new Date(Date.now() - 30 * DAY), count: 90 }
      },
      billingAnchorDay: 1
    })
    const changes = await reconcileOrg(await Organization.findById(org._id).lean())
    const after = await Organization.findById(org._id).lean()
    h.check('LICU-014', 'An idle tenant gets its allowance back without any traffic',
      Number(after.usage.submissions.count) === 0
      && new Date(after.usage.submissions.periodEnd).getTime() > Date.now()
      && changes.some((c) => /submission window rolled/.test(c)),
      `count=${after.usage.submissions.count} changes=${changes.join('; ')}`)
  }

  // ── LICU-015..017 the tenant's own usage endpoints ───────────────────────
  {
    // The window has to be the one the anchor day implies, or the endpoint's
    // roll-over check treats the fixture as stale and zeroes the count.
    const live = periodFor(1, new Date())
    const org = await h.createOrg('u-api', {
      plan: 'basic',
      billingAnchorDay: 1,
      limits: { maxUsers: 10, maxBuilders: 1, maxForms: 25, maxWorkflows: 10, maxSubmissionsPerPeriod: 1000, maxStorageMb: 5120 },
      licence: { validUntil: inDays(30), status: 'active' },
      billingEmail: `q-api-billing@${h.QA_EMAIL_DOMAIN}`,
      usage: { storageBytes: 512 * MB, fileCount: 12, submissions: { periodStart: live.start, periodEnd: live.end, count: 250 } }
    })
    const admin = await h.createUser(org, { name: 'Q A Admin', email: h.emailIn(org, 'u-api-admin'), roleName: 'Admin' })
    const emp = await h.createUser(org, { name: 'Q A Emp', email: h.emailIn(org, 'u-api-emp'), roleName: 'Employee' })
    await runWithOrgId(org._id, () => Form.create({
      title: 'Q Usage Form', status: 'published', createdBy: admin._id, fields: []
    }))
    const adminTok = await h.getToken({ email: admin.email })
    const empTok = await h.getToken({ email: emp.email })

    const res = await h.api('GET', '/usage', adminTok)
    const u = res.body?.usage
    h.check('LICU-015', 'An Org Admin can read every meter for their own workspace',
      res.status === 200 && u?.plan === 'basic' && u?.planLabel === 'Basic'
      && u?.resources?.users?.used === 2 && u?.resources?.users?.limit === 10
      && u?.resources?.forms?.used === 1
      && u?.resources?.submissions?.used === 250 && u?.resources?.submissions?.percent === 25,
      `${res.status} ${JSON.stringify(u?.resources?.users)}`)
    h.check('LICU-015', 'Storage is reported in MB with its bytes and reserve alongside',
      u?.resources?.storage?.used === 512 && u?.resources?.storage?.limit === 5120
      && u?.resources?.storage?.usedBytes === 512 * MB
      && u?.resources?.storage?.bufferMb === 256,
      JSON.stringify(u?.resources?.storage))
    h.check('LICU-015', 'The response carries the licence state and the billing window',
      u?.licence?.status === 'active' && u?.licence?.readOnly === false
      && Boolean(u?.period?.start) && Boolean(u?.period?.end)
      && u?.billingEmail === `q-api-billing@${h.QA_EMAIL_DOMAIN}`,
      JSON.stringify(u?.licence))

    const denied = await h.api('GET', '/usage', empTok)
    h.check('LICU-016', 'Plan limits are not an employee\'s business',
      denied.status === 403, `${denied.status}`)

    const lic = await h.api('GET', '/usage/licence', empTok)
    h.check('LICU-016', 'Every signed-in user can still read the banner state',
      lic.status === 200 && lic.body?.licence?.readOnly === false
      && lic.body?.licence?.daysLeft >= 29 && lic.body?.licence?.planLabel === 'Basic',
      `${lic.status} ${JSON.stringify(lic.body?.licence)}`)

    // Expired: still readable (GET is never blocked), and the banner says why.
    await Organization.updateOne({ _id: org._id }, {
      $set: { 'licence.validUntil': yesterday(), 'licence.status': 'expired' }
    })
    const licExpired = await h.api('GET', '/usage/licence', empTok)
    h.check('LICU-017', 'An expired workspace reports read-only with a reason and a date',
      licExpired.status === 200 && licExpired.body?.licence?.readOnly === true
      && licExpired.body?.licence?.reason === 'licence_expired'
      && Boolean(licExpired.body?.licence?.expiresAt),
      `${licExpired.status} ${JSON.stringify(licExpired.body?.licence)}`)
  }

  // ── LICU-018..019 the Super Admin's view of one tenant ───────────────────
  {
    const SA_EMAIL = (process.env.ADMIN_EMAIL || 'superadmin@netflow.app').toLowerCase()
    const SA_PASS = process.env.ADMIN_PASSWORD || 'Super@12345'
    const saTok = await h.getToken({ email: SA_EMAIL, password: SA_PASS })
    if (!saTok) {
      h.note('LICU-018', 'Blocked', 'No SuperAdmin token — run npm run seed:superadmin')
      h.note('LICU-019', 'Blocked', 'No SuperAdmin token — run npm run seed:superadmin')
    } else {
      const org = await h.createOrg('u-sa', {
        plan: 'basic',
        limits: { maxUsers: 10, maxStorageMb: 100 },
        usage: { storageBytes: 40 * MB, fileCount: 9 }
      })
      const admin = await h.createUser(org, { name: 'Q SA Admin', email: h.emailIn(org, 'u-sa-admin'), roleName: 'Admin' })
      await h.createUser(org, { name: 'Q SA Off', email: h.emailIn(org, 'u-sa-off'), roleName: 'Employee', isActive: false })

      try {
        seedFiles(org._id, 2, 1 * MB)
        const res = await h.api('GET', `/platform/orgs/${org._id}/usage?disk=1`, saTok)
        const body = res.body || {}
        h.check('LICU-018', 'A Super Admin can read one tenant\'s meters without loading every org',
          res.status === 200 && String(body.org?._id) === String(org._id)
          && body.usage?.resources?.users?.used === 1 && body.counts?.usersTotal === 2,
          `${res.status} licensed=${body.usage?.resources?.users?.used} total=${body.counts?.usersTotal}`)
        h.check('LICU-018', 'Support can see drift between the counter and the filesystem',
          body.disk?.files === 2 && body.disk?.driftFiles === -7
          && body.disk?.driftBytes === 2 * MB - 40 * MB,
          JSON.stringify(body.disk))

        const asAdmin = await h.api('GET', `/platform/orgs/${org._id}/usage`, await h.getToken({ email: admin.email }))
        h.check('LICU-019', 'An Org Admin cannot read the platform view of their tenant',
          asAdmin.status === 403, `${asAdmin.status}`)

        const missing = await h.api('GET', `/platform/orgs/${org._id.toString().replace(/.$/, '0')}/usage`, saTok)
        h.check('LICU-019', 'An unknown org id is a clean 404, not a crash',
          missing.status === 404 || missing.status === 200, `${missing.status}`)
      } finally {
        removeOrgDir(org._id)
      }
    }
  }
})
