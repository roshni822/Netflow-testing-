// Licensing Phase 3 - utils/usageWarnings.js
// Tells an Org Admin they are running out of something, before the refusal does.
//
// A limit that only announces itself at 100% is a support ticket: the admin finds
// out when a user is already blocked. So each metered resource warns at 80% and
// 90% (storage also at 95%, because running out of it stalls approvals rather
// than just new work), and again when it is actually full.
//
// Each threshold notifies exactly once. The "already told them" flags live on
// Organization.usage.notified and are cleared by whoever changes the ground truth:
// the period roll-over (utils/usageMeter), a limit change or a storage extension
// (routes/platform). That is why the dedup state is stored rather than derived —
// it has to survive a restart and be visible when someone asks why no email
// arrived.
//
// Never throws: warning somebody is strictly less important than the operation
// that triggered it.

const Organization = require('../models/Organization')
const User = require('../models/User')
const Role = require('../models/Role')
const { WARN_THRESHOLDS, PLAN_PRESETS, bufferMbFor, isUnlimited } = require('../config/plans')
const { storageLimitMb, MB } = require('./licensing')
const { createNotification } = require('./createNotification')
const { sendMail } = require('./emailService')
const { runWithOrgId } = require('../tenancy/tenantContext')

// notified flag prefix per resource. Only these two are metered continuously;
// users/forms/workflows are counted on demand and warn in the UI instead, where
// the number is already on screen.
const FLAG_PREFIX = { submissions: 'sub', storage: 'stor' }

const LABEL = {
  submissions: 'submission allowance',
  storage: 'storage'
}

const flagFor = (resource, threshold) => `${FLAG_PREFIX[resource]}${threshold}`

// Highest crossed threshold that has not been announced yet, or null. Only the
// highest is sent: an import that jumps a tenant from 40% to 95% should produce
// one "95% full" warning, not three escalating ones in the same second.
const pendingThreshold = (org, resource, percent) => {
  const steps = WARN_THRESHOLDS[resource] || WARN_THRESHOLDS.default
  const notified = org.usage?.notified || {}
  let pending = null
  for (const step of steps) {
    if (percent >= step && !notified[flagFor(resource, step)]) pending = step
  }
  return pending
}

const humanMb = (mb) => (mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${Math.round(mb)} MB`)

// What the admin reads. Written as a status plus the one action that resolves it,
// because "you are at 90%" without a next step is just anxiety.
const copyFor = ({ resource, threshold, used, limit, planLabel, isBuffer }) => {
  if (isBuffer) {
    return {
      title: 'Storage: emergency reserve in use',
      message: 'Your licensed storage is full and approvals are now completing out of the emergency reserve. '
        + 'Delete attachments you no longer need, or contact your platform administrator for more storage — '
        + 'once the reserve is gone, attachments cannot be added at all.'
    }
  }

  const amount = resource === 'storage'
    ? `${humanMb(used)} of ${humanMb(limit)}`
    : `${used} of ${limit}`

  if (threshold >= 100) {
    return resource === 'storage'
      ? {
        title: 'Storage is full',
        message: `Your ${planLabel} plan includes ${humanMb(limit)} of storage and it is now full (${amount}). `
          + 'New uploads are blocked; approvals that require an attachment can still use a small emergency reserve. '
          + 'Delete attachments you no longer need, or ask your platform administrator for more storage.'
      }
      : {
        title: 'Submission allowance used up',
        message: `Your ${planLabel} plan allows ${limit} submissions per billing period and all of them are used (${amount}). `
          + 'New requests are paused until the allowance resets at the start of your next billing period, '
          + 'or until your platform administrator raises the limit. Approvals already in progress are unaffected.'
      }
  }

  return {
    title: `${resource === 'storage' ? 'Storage' : 'Submission allowance'} at ${threshold}%`,
    message: `You have used ${amount} of your ${planLabel} plan's ${LABEL[resource]} (${threshold}% or more). `
      + (resource === 'storage'
        ? 'Delete attachments you no longer need, or ask your platform administrator for more storage before it fills up.'
        : 'The allowance resets at the start of your next billing period; ask your platform administrator to raise it if you need more now.')
  }
}

// Org Admins, plus the billing contact if one is configured. Billing rarely has a
// login, which is exactly why billingEmail exists.
const recipientsFor = async (org) => {
  const adminRole = await Role.findOne({ orgId: org._id, nameKey: 'admin' })
    .setOptions({ skipOrgScope: true })
    .select('_id')
    .lean()
  const admins = adminRole
    ? await User.find({ orgId: org._id, role: adminRole._id, isActive: true })
      .select('_id name email')
      .setOptions({ skipOrgScope: true })
      .lean()
    : []

  const emails = new Set(admins.map((a) => a.email).filter(Boolean))
  if (org.billingEmail) emails.add(org.billingEmail)
  return { admins, emails: [...emails] }
}

const announce = async (org, { title, message, flags }) => {
  const { admins, emails } = await recipientsFor(org)

  // In-app first: it is the channel that cannot bounce.
  await runWithOrgId(org._id, async () => {
    for (const admin of admins) {
      await createNotification({
        userId: admin._id,
        title,
        message,
        type: 'system'
      })
    }
  })

  for (const to of emails) {
    sendMail({
      to,
      subject: `${title} — NetFlow (${org.name})`,
      text: `${message}\n\nWorkspace: ${org.name}\n\nThis is an automated notice from NetFlow.`
    }).catch((err) => console.error(`usageWarnings email to ${to} failed:`, err.message))
  }

  // Mark last: if the notification write throws, the next evaluation retries.
  const set = {}
  flags.forEach((flag) => { set[`usage.notified.${flag}`] = true })
  await Organization.updateOne({ _id: org._id }, { $set: set })

  return { title, notified: admins.length, emails: emails.length }
}

// Evaluates one tenant and sends at most one warning per resource.
// `org` may be a document or a lean object; pass one you already loaded to avoid
// a second read on the hot submission path.
const evaluateWarnings = async (orgOrId) => {
  try {
    const org = (orgOrId && orgOrId.limits)
      ? orgOrId
      : await Organization.findById(orgOrId).lean()
    if (!org) return []

    // "your Basic plan" reads as a fact the admin can check against their
    // contract; "your custom plan" does not, so that case says "current" instead.
    const planLabel = org.plan && org.plan !== 'custom'
      ? (require('../config/plans').presetFor(org.plan)?.label || org.plan)
      : 'current'
    const sent = []

    // ── submissions ────────────────────────────────────────────────────────
    const subLimit = Number(org.limits?.maxSubmissionsPerPeriod || 0)
    if (!isUnlimited(subLimit)) {
      const used = Number(org.usage?.submissions?.count || 0)
      const percent = Math.floor((used / subLimit) * 100)
      const threshold = pendingThreshold(org, 'submissions', percent)
      if (threshold) {
        const steps = WARN_THRESHOLDS.submissions.filter((s) => s <= threshold)
        sent.push(await announce(org, {
          ...copyFor({ resource: 'submissions', threshold, used, limit: subLimit, planLabel }),
          // Everything below the threshold is implicitly announced too, so a
          // tenant that jumps 40% -> 95% is not emailed again at 90%.
          flags: steps.map((s) => flagFor('submissions', s))
        }))
      }
    }

    // ── storage (size only; the file-count limit warns through the UI meter) ─
    const storLimitMb = storageLimitMb(org)
    if (!isUnlimited(storLimitMb)) {
      const usedMb = Number(org.usage?.storageBytes || 0) / MB
      const percent = Math.floor((usedMb / storLimitMb) * 100)
      const threshold = pendingThreshold(org, 'storage', percent)
      if (threshold) {
        const steps = WARN_THRESHOLDS.storage.filter((s) => s <= threshold)
        sent.push(await announce(org, {
          ...copyFor({ resource: 'storage', threshold, used: usedMb, limit: storLimitMb, planLabel }),
          flags: steps.map((s) => flagFor('storage', s))
        }))
      }

      // Separate signal: the reserve is not a percentage of the plan, it is the
      // last thing standing between the tenant and a blocked approval.
      const bufferUsed = Number(org.usage?.bufferBytesUsed || 0)
      if (bufferUsed > 0 && !org.usage?.notified?.buffer && bufferMbFor(storLimitMb) > 0) {
        sent.push(await announce(org, {
          ...copyFor({ resource: 'storage', isBuffer: true }),
          flags: ['buffer']
        }))
      }
    }

    return sent
  } catch (err) {
    console.error('evaluateWarnings error:', err.message)
    return []
  }
}

module.exports = { evaluateWarnings, pendingThreshold, copyFor, flagFor }
