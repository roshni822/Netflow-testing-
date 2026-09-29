// Licensing — unit suite (no server, no DB).
// Covers the pure maths the whole licensing stack rests on: billing windows,
// plan presets, payload validation and usage meters. Fast enough to run on every
// change, and it catches the class of bug that is invisible over HTTP (e.g. an
// anchor of 31 silently becoming 1 March).

const path = require('path')
require('dotenv').config({ path: path.join(__dirname, '..', '.env') })

const { periodFor, isStale, clampDay, normalizeAnchor } = require('../utils/billingPeriod')
const {
  applyLicensingPayload, licenceState, usageSnapshot, effectiveCeiling,
  storageLimitMb, freshPeriod, resetNotified
} = require('../utils/licensing')
const { PLAN_PRESETS, limitsForPlan, bufferMbFor, matchesPreset, isUnlimited } = require('../config/plans')

const results = {}
let passed = 0
let failed = 0

const record = (tcId, ok, note) => {
  const prev = results[tcId]
  if (ok) {
    if (!prev || prev.status !== 'Fail') results[tcId] = { status: 'Pass', note: prev?.note || '' }
  } else {
    results[tcId] = { status: 'Fail', note: (prev?.note ? prev.note + ' | ' : '') + (note || 'assertion failed') }
  }
}

const check = (tcId, name, cond, extra = '') => {
  if (cond) {
    passed++
    console.log(`  PASS  ${tcId}  ${name}`)
  } else {
    failed++
    console.log(`  FAIL  ${tcId}  ${name}${extra ? ` — ${extra}` : ''}`)
  }
  record(tcId, cond, cond ? '' : `${name}${extra ? ` — ${extra}` : ''}`)
}

// A stand-in for an Organization document: plain nested objects are enough for
// helpers that only read/write fields.
const fakeOrg = (over = {}) => ({
  plan: 'custom',
  billingEmail: '',
  billingAnchorDay: 1,
  licence: { validFrom: null, validUntil: null, trialEndsAt: null, status: 'active' },
  limits: {
    maxUsers: 0, maxBuilders: 0, maxForms: 0, maxWorkflows: 0,
    maxSubmissionsPerPeriod: 0, maxStorageMb: 0, maxFiles: 0, gracePercent: 0
  },
  usage: {
    storageBytes: 0, fileCount: 0, bufferBytesUsed: 0,
    submissions: { periodStart: null, periodEnd: null, count: 0 },
    notified: {}
  },
  storageExtension: { extraMb: 0, expiresAt: null },
  ...over
})

const iso = (d) => (d ? new Date(d).toISOString().slice(0, 10) : null)

const run = () => {
  console.log('\n=== licensing (unit) ===')

  // ── billing periods ───────────────────────────────────────────────────────
  {
    const { start, end } = periodFor(20, new Date('2026-03-25T10:00:00Z'))
    check('LIC-001', 'period starts on the anchor day already passed this month',
      iso(start) === '2026-03-20', iso(start))
    check('LIC-001', 'period ends on next month\'s anchor', iso(end) === '2026-04-20', iso(end))
  }
  {
    const { start, end } = periodFor(20, new Date('2026-03-05T10:00:00Z'))
    check('LIC-002', 'before the anchor, the window belongs to last month',
      iso(start) === '2026-02-20' && iso(end) === '2026-03-20', `${iso(start)}..${iso(end)}`)
  }
  {
    // The classic bug: anchor 31 in a 28-day month must not roll into March.
    const { start, end } = periodFor(31, new Date('2026-02-15T00:00:00Z'))
    check('LIC-003', 'anchor 31 clamps to the last day of February',
      iso(start) === '2026-01-31' && iso(end) === '2026-02-28', `${iso(start)}..${iso(end)}`)
    const leap = periodFor(31, new Date('2028-02-15T00:00:00Z'))
    check('LIC-003', 'anchor 31 clamps to 29 Feb in a leap year',
      iso(leap.end) === '2028-02-29', iso(leap.end))
  }
  {
    const { start, end } = periodFor(15, new Date('2026-12-20T00:00:00Z'))
    check('LIC-004', 'window crosses the year boundary',
      iso(start) === '2026-12-15' && iso(end) === '2027-01-15', `${iso(start)}..${iso(end)}`)
  }
  {
    check('LIC-005', 'anchor is clamped into 1..31',
      normalizeAnchor(0) === 1 && normalizeAnchor(99) === 31 && normalizeAnchor('7') === 7)
    check('LIC-005', 'clampDay respects month length', clampDay(2026, 1, 31) === 28)
  }
  {
    const now = new Date('2026-03-25T00:00:00Z')
    const live = periodFor(20, now)
    check('LIC-006', 'a current window is not stale',
      isStale({ periodStart: live.start, periodEnd: live.end, count: 3 }, 20, now) === false)
    check('LIC-006', 'an elapsed window is stale',
      isStale({ periodStart: new Date('2026-01-20'), periodEnd: new Date('2026-02-20'), count: 3 }, 20, now) === true)
    check('LIC-006', 'a missing window is stale', isStale(null, 20, now) === true)
    check('LIC-006', 'changing the anchor makes the window stale',
      isStale({ periodStart: live.start, periodEnd: live.end, count: 3 }, 5, now) === true)
  }

  // ── plan presets ──────────────────────────────────────────────────────────
  {
    const basic = limitsForPlan('basic')
    check('LIC-010', 'Basic sells 10 users / 1 builder / 25 forms / 10 workflows',
      basic.maxUsers === 10 && basic.maxBuilders === 1 && basic.maxForms === 25 && basic.maxWorkflows === 10,
      JSON.stringify(basic))
    check('LIC-010', 'Basic sells 1,000 submissions and 5 GB',
      basic.maxSubmissionsPerPeriod === 1000 && basic.maxStorageMb === 5120)
    const pro = limitsForPlan('professional')
    check('LIC-010', 'Professional sells 50 users / 3 builders / 100 forms / 5,000 submissions / 10 GB',
      pro.maxUsers === 50 && pro.maxBuilders === 3 && pro.maxForms === 100
      && pro.maxSubmissionsPerPeriod === 5000 && pro.maxStorageMb === 10240, JSON.stringify(pro))
    const ent = limitsForPlan('enterprise')
    check('LIC-010', 'Enterprise is unlimited by default',
      Object.values(ent).every((v) => v === 0), JSON.stringify(ent))
    check('LIC-010', 'custom has no preset', limitsForPlan('custom') === null)
    check('LIC-010', 'trial carries an expiry length', PLAN_PRESETS.trial.trialDays > 0)
  }
  {
    check('LIC-011', '0 means unlimited', isUnlimited(0) && isUnlimited(null) && !isUnlimited(1))
    check('LIC-011', 'preset match detects an edited limit',
      matchesPreset('basic', limitsForPlan('basic'))
      && !matchesPreset('basic', { ...limitsForPlan('basic'), maxUsers: 11 }))
  }
  {
    check('LIC-012', 'buffer is 5% of a 5 GB plan', bufferMbFor(5120) === 256, String(bufferMbFor(5120)))
    check('LIC-012', 'buffer caps at 500 MB', bufferMbFor(200 * 1024) === 500, String(bufferMbFor(200 * 1024)))
    check('LIC-012', 'unlimited storage needs no buffer', bufferMbFor(0) === 0)
  }

  // ── payload validation ────────────────────────────────────────────────────
  {
    const org = fakeOrg()
    const errs = applyLicensingPayload(org, { plan: 'professional' })
    check('LIC-020', 'choosing a plan applies its whole preset',
      !errs.length && org.plan === 'professional' && org.limits.maxUsers === 50 && org.limits.maxStorageMb === 10240,
      errs.join('; '))
  }
  {
    const org = fakeOrg()
    applyLicensingPayload(org, { plan: 'basic' })
    const errs = applyLicensingPayload(org, { limits: { maxUsers: 15 } })
    check('LIC-021', 'editing one number off-preset keeps the selected plan',
      !errs.length && org.plan === 'basic' && org.limits.maxUsers === 15 && org.limits.maxForms === 25,
      `${org.plan} ${errs.join('; ')}`)
  }
  {
    const org = fakeOrg()
    const errs = applyLicensingPayload(org, { plan: 'basic', limits: { maxUsers: 20 } })
    check('LIC-021', 'plan + override in one request keeps the plan and override',
      org.limits.maxUsers === 20 && org.plan === 'basic' && !errs.length, `${org.plan}/${org.limits.maxUsers}`)
  }
  {
    const org = fakeOrg()
    const errs = applyLicensingPayload(org, { plan: 'enterprise', limits: { maxUsers: 2, maxForms: 1 } })
    check('LIC-021', 'enterprise with tightened limits stays enterprise',
      org.plan === 'enterprise' && org.limits.maxUsers === 2 && org.limits.maxForms === 1 && !errs.length,
      `${org.plan}/${org.limits.maxUsers}`)
  }
  {
    const org = fakeOrg()
    const errs = applyLicensingPayload(org, { plan: 'gold' })
    check('LIC-022', 'an unknown plan is rejected', errs.length === 1 && /Unknown plan/.test(errs[0]), errs.join('; '))
  }
  {
    const org = fakeOrg()
    const errs = applyLicensingPayload(org, { limits: { maxUsers: 5, maxBuilders: 9 } })
    check('LIC-022', 'more builder seats than users is rejected',
      errs.some((e) => /maxBuilders cannot exceed maxUsers/.test(e)), errs.join('; '))
  }
  {
    const org = fakeOrg()
    const errs = applyLicensingPayload(org, { limits: { maxForms: -2 } })
    check('LIC-022', 'a negative limit is rejected', errs.some((e) => /maxForms/.test(e)), errs.join('; '))
    const g = applyLicensingPayload(fakeOrg(), { limits: { gracePercent: 80 } })
    check('LIC-022', 'grace above 50% is rejected', g.some((e) => /gracePercent/.test(e)), g.join('; '))
  }
  {
    const org = fakeOrg()
    const errs = applyLicensingPayload(org, { billingEmail: 'not-an-email' })
    check('LIC-023', 'a malformed billing email is rejected', errs.some((e) => /billingEmail/.test(e)))
    const ok = applyLicensingPayload(org, { billingEmail: ' Finance@ACME.com ' })
    check('LIC-023', 'a billing email is normalised', !ok.length && org.billingEmail === 'finance@acme.com', org.billingEmail)
    const bad = applyLicensingPayload(fakeOrg(), { billingAnchorDay: 40 })
    check('LIC-023', 'an out-of-range anchor day is rejected', bad.some((e) => /billingAnchorDay/.test(e)))
  }
  {
    const org = fakeOrg()
    const errs = applyLicensingPayload(org, {
      licence: { validFrom: '2026-01-01', validUntil: '2025-01-01' }
    })
    check('LIC-024', 'a licence that expires before it starts is rejected',
      errs.some((e) => /validUntil must be after/.test(e)), errs.join('; '))
    const bad = applyLicensingPayload(fakeOrg(), { licence: { validUntil: 'someday' } })
    check('LIC-024', 'an unparseable licence date is rejected', bad.some((e) => /valid date/.test(e)))
  }
  {
    const org = fakeOrg()
    applyLicensingPayload(org, { plan: 'trial' })
    check('LIC-025', 'picking Trial sets an end date automatically',
      org.licence.trialEndsAt instanceof Date && org.licence.trialEndsAt > new Date(),
      String(org.licence.trialEndsAt))
    applyLicensingPayload(org, { plan: 'professional' })
    check('LIC-025', 'upgrading off Trial clears the trial end date', org.licence.trialEndsAt === null)
  }
  {
    const org = fakeOrg()
    const errs = applyLicensingPayload(org, { licence: { validUntil: '2020-01-01' } })
    check('LIC-026', 'a past expiry marks the licence expired on write',
      !errs.length && org.licence.status === 'expired', org.licence.status)
  }

  // ── licence state ─────────────────────────────────────────────────────────
  {
    const perpetual = licenceState(fakeOrg())
    check('LIC-030', 'a perpetual licence is active and writable',
      perpetual.status === 'active' && perpetual.readOnly === false && perpetual.expiresAt === null)

    const expired = licenceState(fakeOrg({
      licence: { validUntil: new Date('2020-01-01'), trialEndsAt: null, status: 'active' }
    }))
    check('LIC-030', 'an expired licence is read-only with a reason',
      expired.readOnly === true && expired.reason === 'licence_expired', JSON.stringify(expired))

    const trial = licenceState(fakeOrg({
      plan: 'trial',
      licence: { validUntil: null, trialEndsAt: new Date('2020-01-01'), status: 'active' }
    }))
    check('LIC-030', 'an ended trial reports trial_expired, not licence_expired',
      trial.readOnly === true && trial.reason === 'trial_expired', trial.reason)

    const suspended = licenceState(fakeOrg({ licence: { status: 'suspended' } }))
    check('LIC-030', 'a suspended licence stays suspended', suspended.status === 'suspended' && suspended.readOnly)
  }
  {
    const soon = new Date(Date.now() + 3 * 86400000)
    const s = licenceState(fakeOrg({ licence: { validUntil: soon, status: 'active' } }))
    check('LIC-031', 'days remaining is reported for the renewal banner',
      s.daysLeft === 3 && s.readOnly === false, String(s.daysLeft))
    // Whichever ends first wins, so a trial inside a longer licence still bites.
    const both = licenceState(fakeOrg({
      plan: 'trial',
      licence: { validUntil: new Date(Date.now() + 90 * 86400000), trialEndsAt: soon, status: 'active' }
    }))
    check('LIC-031', 'the earliest of licence/trial end is the expiry', both.daysLeft === 3, String(both.daysLeft))
  }

  // ── ceilings, storage, meters ─────────────────────────────────────────────
  {
    check('LIC-040', 'no grace means the limit is the ceiling', effectiveCeiling(10, 0) === 10)
    check('LIC-040', '10% grace on 10 allows 11', effectiveCeiling(10, 10) === 11)
    check('LIC-040', 'unlimited has no ceiling', effectiveCeiling(0, 10) === 0)
  }
  {
    const org = fakeOrg({ limits: { ...fakeOrg().limits, maxStorageMb: 5120 } })
    check('LIC-041', 'storage limit is the licensed size without an extension',
      storageLimitMb(org) === 5120)
    org.storageExtension = { extraMb: 1024, expiresAt: new Date(Date.now() + 86400000) }
    check('LIC-041', 'a live extension raises the storage limit', storageLimitMb(org) === 6144)
    org.storageExtension = { extraMb: 1024, expiresAt: new Date(Date.now() - 86400000) }
    check('LIC-041', 'an expired extension is ignored', storageLimitMb(org) === 5120)
    const unlimited = fakeOrg()
    unlimited.storageExtension = { extraMb: 1024, expiresAt: null }
    check('LIC-041', 'unlimited storage cannot be extended', storageLimitMb(unlimited) === 0)
  }
  {
    const org = fakeOrg({
      plan: 'basic',
      limits: { ...fakeOrg().limits, ...limitsForPlan('basic') },
      usage: {
        storageBytes: 4 * 1024 * 1024 * 1024, fileCount: 12, bufferBytesUsed: 0,
        submissions: { periodStart: new Date(), periodEnd: new Date(), count: 900 },
        notified: {}
      }
    })
    const snap = usageSnapshot(org, { users: 8, builders: 1, forms: 25, workflows: 3 })
    check('LIC-042', 'snapshot reports the plan label', snap.planLabel === 'Basic', snap.planLabel)
    check('LIC-042', '900 of 1,000 submissions is 90% and critical',
      snap.resources.submissions.percent === 90 && snap.resources.submissions.state === 'critical',
      JSON.stringify(snap.resources.submissions))
    check('LIC-042', '8 of 10 users is 80% and a warning',
      snap.resources.users.percent === 80 && snap.resources.users.state === 'warning')
    check('LIC-042', 'a full resource reports exceeded',
      snap.resources.forms.state === 'exceeded' && snap.resources.forms.remaining === 0)
    check('LIC-042', 'storage is reported in MB against the licensed size',
      snap.resources.storage.used === 4096 && snap.resources.storage.limit === 5120
      && snap.resources.storage.bufferMb === 256, JSON.stringify(snap.resources.storage))
    check('LIC-042', 'an unlimited resource never warns',
      snap.resources.files.unlimited === true && snap.resources.files.state === 'ok')
  }
  {
    const org = fakeOrg({ billingAnchorDay: 9 })
    const p = freshPeriod(org, new Date('2026-05-10T00:00:00Z'))
    check('LIC-043', 'a fresh period starts at the anchor with a zero count',
      iso(p.periodStart) === '2026-05-09' && p.count === 0, iso(p.periodStart))
  }
  {
    const org = fakeOrg()
    org.usage.notified = { sub80: true, sub90: true, stor80: true, buffer: true }
    resetNotified(org, 'sub')
    check('LIC-044', 'resetting submission warnings leaves storage warnings alone',
      org.usage.notified.sub80 === false && org.usage.notified.sub90 === false
      && org.usage.notified.stor80 === true)
    resetNotified(org, 'all')
    check('LIC-044', 'resetting everything clears the buffer warning too',
      org.usage.notified.stor80 === false && org.usage.notified.buffer === false)
  }

  console.log(`\nlicensing (unit): ${passed} passed, ${failed} failed`)
  console.log(`__RESULTS__ ${JSON.stringify(results)}`)
  process.exit(failed > 0 ? 1 : 0)
}

run()
