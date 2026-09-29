// Licensing Phase 3 - jobs/licenceCron.js
// Watches the clock on every tenant's licence.
//
// Read-only mode is derived from the dates on every request (utils/licensing), so
// nothing here decides whether a tenant is blocked — it would be a bug if it did.
// What this job exists for is everything the request path cannot do:
//
//   * warn before the licence lapses (30 / 14 / 7 / 1 days), because the first
//     time a customer hears about a renewal should not be a refused submission;
//   * write the stored status and one audit entry at the moment it lapses, so the
//     Super Admin's activity feed shows when it happened rather than only that it
//     is true now;
//   * tell the tenant, once, that they are now read-only and what still works.
//
// Reminders are deduped through licence.notified.*, cleared whenever the dates
// change so a renewal starts the sequence over.

const monitor = require('./monitor')

const Organization = require('../models/Organization')
const User = require('../models/User')
const Role = require('../models/Role')
const AuditLog = require('../models/AuditLog')
const { licenceState, deriveLicenceStatus, expiryOf } = require('../utils/licensing')
const { createNotification } = require('../utils/createNotification')
const { sendMail } = require('../utils/emailService')
const { runWithOrgId } = require('../tenancy/tenantContext')

const DAY = 86400000
const REMINDER_DAYS = [30, 14, 7, 1]
async function updateLicence (org, fields) {
  if (!require('../database/layout').organizationSchemas()) return Organization.updateOne({ _id: org._id }, { $set: fields })
  const notified = Object.fromEntries(Object.entries(fields).filter(([key]) => key.startsWith('licence.notified.')).map(([key,value]) => [key.split('.').at(-1),value]))
  return require('../database/postgres').query('SELECT system.reconcile_licence($1::jsonb)', [JSON.stringify(notified)])
}

const recipientsFor = async (org) => {
  const adminRole = await Role.findOne({ orgId: org._id, nameKey: 'admin' })
    .setOptions({ skipOrgScope: true })
    .select('_id')
    .lean()
  const admins = adminRole
    ? await User.find({ orgId: org._id, role: adminRole._id, isActive: true })
      .select('_id email')
      .setOptions({ skipOrgScope: true })
      .lean()
    : []
  const emails = new Set(admins.map((a) => a.email).filter(Boolean))
  if (org.billingEmail) emails.add(org.billingEmail)
  return { admins, emails: [...emails] }
}

const tell = async (org, title, message) => {
  const { admins, emails } = await recipientsFor(org)
  await runWithOrgId(org._id, async () => {
    for (const admin of admins) {
      await createNotification({ userId: admin._id, title, message, type: 'system' })
    }
  })
  for (const to of emails) {
    sendMail({
      to,
      subject: `${title} — NetFlow (${org.name})`,
      text: `${message}\n\nWorkspace: ${org.name}\n\nThis is an automated notice from NetFlow.`
    }).catch((err) => console.error(`licenceCron email to ${to} failed:`, err.message))
  }
}

const noun = (org) => (org.plan === 'trial' ? 'trial' : 'licence')

const whenText = (days) => {
  if (days <= 0) return 'today'
  if (days === 1) return 'tomorrow'
  return `in ${days} days`
}

// Sends one reminder and marks every threshold it covers. The copy uses the real
// number of days left rather than the threshold that triggered it: a tenant whose
// licence ends in 5 days must not be emailed "ends in 14 days" just because that
// is the step that had not fired yet.
const remind = async (org, daysLeft, thresholds) => {
  const when = whenText(daysLeft)
  const what = noun(org)
  await tell(
    org,
    `Your NetFlow ${what} ends ${when}`,
    `The ${what} for this workspace ends ${when} (${expiryOf(org).toDateString()}). `
    + 'When it does, the workspace becomes read-only: everyone keeps access to their data and approvals '
    + 'already in progress can still be completed, but new requests, forms and users are paused. '
    + `Contact your platform administrator to renew${what === 'trial' ? ' or choose a plan' : ''}.`
  )
  const set = {}
  thresholds.forEach((d) => { set[`licence.notified.d${d}`] = true })
  await updateLicence(org, set)
}

const markExpired = async (org) => {
  await updateLicence(org, { 'licence.status': 'expired', 'licence.notified.expired': true })

  // Recorded under the tenant so their own audit trail explains the change, and
  // surfaced to the Super Admin's activity feed through the shared action list.
  await AuditLog.create({
    orgId: org._id,
    action: 'org_licence_expired',
    targetEntity: `Organization: ${org.name}`,
    detail: `The ${noun(org)} for "${org.name}" (${org.subdomain}) expired on ${expiryOf(org).toDateString()} — the workspace is now read-only`,
    metadata: { plan: org.plan, expiredAt: expiryOf(org) }
  })

  await tell(
    org,
    `This workspace is now read-only (${noun(org)} expired)`,
    `The ${noun(org)} for this workspace expired on ${expiryOf(org).toDateString()}. `
    + 'Everyone can still sign in, read and export their data, and approvals already in progress can be completed. '
    + 'New requests, forms, workflows and users are paused until it is renewed.'
  )
}

// Handles one tenant. Returns what it did: 'expired', 'reminded' or null.
// Split out from the sweep so a single tenant can be exercised (and tested)
// without touching anybody else's licence.
const checkOrgLicence = async (org, now = new Date()) => {
  const expiry = expiryOf(org)
  if (!expiry) return null

  const derived = deriveLicenceStatus(org, now)

  if (derived === 'expired') {
    // Suspended tenants are already read-only for a different reason; do not
    // overwrite that status or send a second notice.
    if (org.licence?.status === 'suspended' || org.licence?.notified?.expired) return null
    await markExpired(org)
    return 'expired'
  }

  if (org.licence?.status === 'suspended') return null

  // Stored status drifted (dates were extended without going through the API).
  if (org.licence?.status !== derived) {
    await updateLicence(org, { 'licence.status': derived })
  }

  const daysLeft = licenceState(org, now).daysLeft
  // Every step the clock has already passed and that has not been announced.
  // Skipped steps (a tenant that only gets looked at with 5 days left) are marked
  // together with the one being sent, so there is exactly one email per step set.
  const due = REMINDER_DAYS.filter((d) => daysLeft <= d && !org.licence?.notified?.[`d${d}`])
  if (!due.length) return null
  await remind(org, daysLeft, due)
  return 'reminded'
}

const checkLicences = async () => {
  const now = new Date()
  const orgs = await Organization.find({
    $or: [
      { 'licence.validUntil': { $ne: null } },
      { 'licence.trialEndsAt': { $ne: null } }
    ]
  })
    .select('name subdomain plan licence billingEmail')
    .lean()

  let expired = 0
  let reminded = 0
  let failures = 0

  for (const org of orgs) {
    try {
      const did = require('../database/layout').organizationSchemas()
        ? await require('../database/postgres').transaction(async client => {
          await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', ['licence:' + org._id])
          return checkOrgLicence(await Organization.findById(org._id).lean(), now)
        })
        : await checkOrgLicence(org, now)
      if (did === 'expired') {
        expired += 1
        console.log(`[licenceCron] ${org.subdomain}: ${noun(org)} expired — now read-only`)
      } else if (did === 'reminded') {
        reminded += 1
        console.log(`[licenceCron] ${org.subdomain}: reminded — ${licenceState(org, now).daysLeft} day(s) left`)
      }
    } catch (err) {
      failures++
      console.error(`[licenceCron] ${org.subdomain} failed:`, err.message)
    }
  }

  if (expired || reminded) {
    console.log(`[licenceCron] ${expired} expired, ${reminded} reminded (of ${orgs.length} dated licence(s))`)
  }
  return { scanned: orgs.length, expired, reminded, ...(failures ? { error: 'Licence reconciliation failed' } : {}) }
}

const startLicenceCron = () => monitor.schedule('licences', '10 * * * *', 3600000, checkLicences)

module.exports = { startLicenceCron, checkLicences, checkOrgLicence }
