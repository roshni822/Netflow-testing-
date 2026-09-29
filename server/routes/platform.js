// Multi-tenancy build-order step 7 (+ polish) - routes/platform.js
// Platform-level organization management, SuperAdmin only.
//   GET    /api/platform/orgs                     list orgs + usage (hides default)
//   POST   /api/platform/orgs                     create an org + its first Org Admin
//   PUT    /api/platform/orgs/:id                 update name/domains/features/limits
//   POST   /api/platform/orgs/:id/suspend         suspend (blocks every org user)
//   POST   /api/platform/orgs/:id/activate        reactivate
//   GET    /api/platform/orgs/:id/usage           one tenant's meters (?disk=1)
//   POST   /api/platform/orgs/:id/storage-extension     grant temporary storage
//   DELETE /api/platform/orgs/:id/storage-extension     revoke it early
//   POST   /api/platform/orgs/:id/reset-admin-password  new temp password for the admin
//   DELETE /api/platform/orgs/:id                 backup + cascade-delete a tenant
//   GET    /api/platform/activity                 platform org-lifecycle audit
//   GET    /api/platform/plans                    plan catalogue + tenant counts
//   GET    /api/platform/admins                   list SuperAdmin accounts
//   POST   /api/platform/admins                   invite a SuperAdmin
//   POST   /api/platform/admins/:id/reset-password
//   POST   /api/platform/admins/:id/deactivate
//   POST   /api/platform/admins/:id/activate
//   GET    /api/platform/health                   system status for SuperAdmin
//   GET    /api/platform/dms-storage              live DMS storage usage
//
// All tenant queries here name orgId explicitly (or use skipOrgScope), so the
// org-scope plugin never silently narrows a Super Admin's cross-tenant view to
// their own (default) org.

const express = require('express')
const fs = require('fs')
const path = require('path')
const { isValidId } = require('../database/ids')
const { withSystemAccess } = require('../database/context')
const { runWithOrgId } = require('../tenancy/tenantContext')
const { organizationSchemas } = require('../database/layout')
const provisioning = require('../database/fresh/provisioning')
const management = require('../database/fresh/management')
const loadManagedOrg = id => organizationSchemas() ? management.load(id) : Organization.findById(id)
const saveManagedOrg = (org, req, action) => organizationSchemas() ? management.save(org, req, action) : org.save()

const Organization = require('../models/Organization')
const User = require('../models/User')
const Role = require('../models/Role')
const Form = require('../models/Form')
const FormDraft = require('../models/FormDraft')
const FormResponse = require('../models/FormResponse')
const Workflow = require('../models/Workflow')
const WorkflowExecution = require('../models/WorkflowExecution')
const Task = require('../models/Task')
const Notification = require('../models/Notification')
const AuditLog = require('../models/AuditLog')
const PlatformBroadcast = require('../models/PlatformBroadcast')
const { protect } = require('../middleware/auth')
const { roleGuard } = require('../middleware/roleGuard')
const { sendSuccess, sendError } = require('../utils/apiResponse')
const { checkEmailDomain } = require('../utils/domainPolicy')
const { generatePassword } = require('../utils/password')
const { writeAuditLog } = require('../utils/writeAuditLog')
const { applyLicensingPayload, usageSnapshot, freshPeriod, resetNotified, licenceState } = require('../utils/licensing')
const { countsFor } = require('../utils/usage')
const dms = require('../services/dmsClient')
const s3 = require('../services/s3Client')
const { platformIntegrationLimiter } = require('../middleware/rateLimit')
const { issueIntegrationReceipt, receiptMatches } = require('../utils/integrationVerification')
const { ensurePeriod } = require('../utils/usageMeter')
const { purgeOrgFiles } = require('../utils/fileGc')
const { measureOrg } = require('../utils/fileStore')
const { PLAN_PRESETS, SELLABLE_PLANS } = require('../config/plans')
const { ensureRolesForOrganization, clearRoleProvisioningCache } = require('../utils/roleProvisioning')

const formatPlanMb = (mb) => {
  const n = Number(mb) || 0
  if (n <= 0) return 'Unlimited'
  if (n >= 1024) {
    const gb = n / 1024
    return `${gb >= 10 ? Math.round(gb) : gb.toFixed(1)} GB`
  }
  return `${Math.round(n)} MB`
}

const router = express.Router()

router.use(protect, roleGuard('SuperAdmin'), (req, res, next) => {
  // Platform operations cross tenant boundaries. Enter this context only after
  // authenticating and authorizing the SuperAdmin; ordinary routes stay scoped.
  return runWithOrgId(null, () => withSystemAccess('platform', next))
})
router.use(require('./freshPlatform'))

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const PLATFORM_ACTIONS = [
  'org_created',
  'org_updated',
  'org_suspended',
  'org_activated',
  'org_deleted',
  'org_admin_password_reset',
  'org_storage_extended',
  'org_storage_extension_revoked',
  'org_licence_expired',
  'platform_broadcast_sent', 'plan_created', 'plan_updated', 'plan_deleted',
  'platform_admin_created', 'platform_admin_password_reset', 'platform_admin_activated', 'platform_admin_deactivated',
  'org_archived', 'org_restored', 'org_purge_verified'
]

const LIFECYCLE_ACTIONS = ['org_created', 'org_suspended', 'org_activated', 'org_deleted']
const HISTORY_RANGES = { '3M': 3, '6M': 6, '12M': 12 }

const monthStartUtc = (value = new Date()) =>
  new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), 1))

const monthKey = (value) => {
  const date = new Date(value)
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`
}

// A temporary storage grant is a support action, not a plan change: it buys a
// tenant time to clean up (or to sign a bigger contract) without stranding the
// approvals that are already waiting on an attachment.
const MAX_EXTENSION_MB = 100 * 1024
const MAX_EXTENSION_DAYS = 90


const auditPlatform = (req, action, org, detail, metadata = {}) =>
  organizationSchemas() && management.wasAudited(org) ? null : writeAuditLog({
    action,
    performedBy: req.user._id,
    targetEntity: org?.name || org?.subdomain || 'organization',
    department: req.user.department,
    ipAddress: req.ip,
    detail,
    metadata: {
      ...metadata,
      targetOrgId: org?._id ? String(org._id) : undefined,
      subdomain: org?.subdomain
    }
  })


// Normalises a domains payload: array or comma-separated string → clean list.
const parseDomains = (input) => {
  const raw = Array.isArray(input) ? input : String(input || '').split(',')
  return [...new Set(
    raw.map((d) => String(d).toLowerCase().trim().replace(/^@/, '')).filter(Boolean)
  )]
}

const INTEGRATION_TEST_TIMEOUT_MS = 10000

class PlatformIntegrationError extends Error {
  constructor(message, { code = 'INTEGRATION_TEST_FAILED', status = 502, integration = null } = {}) {
    super(message)
    this.name = 'PlatformIntegrationError'
    this.code = code
    this.status = status
    this.integration = integration
  }
}

const safeDmsError = (error) => {
  if (['DMS_INVALID_ENDPOINT', 'DMS_ENDPOINT_MIGRATION_REQUIRED', 'DMS_INCOMPATIBLE_API'].includes(error?.code)) {
    return new PlatformIntegrationError(error.message, { code: error.code, status: error.status || 422, integration: 'dms' })
  }
  if (error?.code === 'DMS_DISABLED') {
    return new PlatformIntegrationError('DMS is disabled on this server.', {
      code: 'DMS_DISABLED', status: 503, integration: 'dms'
    })
  }
  if (error?.code === 'DMS_MISCONFIGURED') {
    return new PlatformIntegrationError('The DMS API URL is not configured.', {
      code: 'DMS_MISCONFIGURED', status: 503, integration: 'dms'
    })
  }
  if (error?.code === 'DMS_UNAUTHORIZED' || error?.status === 401 || error?.status === 403) {
    return new PlatformIntegrationError('The DMS credentials were rejected.', {
      code: 'DMS_AUTH_FAILED', status: 422, integration: 'dms'
    })
  }
  if (error?.code === 'DMS_TIMEOUT') {
    return new PlatformIntegrationError('The DMS connection test timed out.', {
      code: 'INTEGRATION_TEST_TIMEOUT', status: 504, integration: 'dms'
    })
  }
  return new PlatformIntegrationError('The DMS service could not be reached.', {
    code: 'DMS_UNREACHABLE', status: 502, integration: 'dms'
  })
}

const testPlatformIntegration = async (integration, config = {}) => {
  if (integration === 'dms') {
    const input = {
      baseUrl: String(config.baseUrl || '').trim(),
      apiKey: String(config.apiKey || '').trim(),
      jwtToken: String(config.jwtToken || '').trim(),
      orgSlug: String(config.orgSlug || '').toLowerCase().trim().replace(/[^a-z0-9-]/g, '-')
    }
    try {
      const result = await dms.testConnection({ ...input, timeoutMs: INTEGRATION_TEST_TIMEOUT_MS })
      return { ...result, verificationConfig: dms.connectionConfig(input) }
    } catch (error) {
      throw safeDmsError(error)
    }
  }

  if (integration === 's3') {
    const effective = s3.connectionConfig(config)
    try {
      const result = await s3.testConnection(effective, { timeoutMs: INTEGRATION_TEST_TIMEOUT_MS })
      return { ...result, verificationConfig: effective }
    } catch (error) {
      if (error instanceof s3.S3ConnectionError) {
        throw new PlatformIntegrationError(error.message, {
          code: error.code, status: error.status, integration: 's3'
        })
      }
      throw new PlatformIntegrationError('The S3 service could not be reached.', {
        code: 'S3_UNREACHABLE', status: 502, integration: 's3'
      })
    }
  }

  throw new PlatformIntegrationError('Integration must be either dms or s3.', {
    code: 'UNSUPPORTED_INTEGRATION', status: 400
  })
}

const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value || {}, key)

// Edit tests may reuse secrets already stored for the tenant. Only submitted
// replacements override them, and the merged configuration never leaves the
// server or appears in logs.
const resolveIntegrationTestConfig = async ({ integration, config, orgId }) => {
  const submitted = config && typeof config === 'object' ? config : {}
  if (!orgId) return submitted
  if (!isValidId(orgId)) {
    throw new PlatformIntegrationError('Organization not found.', {
      code: 'ORG_NOT_FOUND', status: 404, integration
    })
  }

  const org = organizationSchemas() ? await management.load(orgId) : await Organization.findById(orgId).select('subdomain integrations').lean()
  if (!org) {
    throw new PlatformIntegrationError('Organization not found.', {
      code: 'ORG_NOT_FOUND', status: 404, integration
    })
  }

  if (integration === 'dms') {
    const endpoint = hasOwn(submitted, 'baseUrl') ? dms.assertEndpointChange(org, submitted.baseUrl) : org.integrations?.dmsBaseUrl
    return {
      baseUrl: endpoint,
      apiKey: hasOwn(submitted, 'apiKey') ? submitted.apiKey : org.integrations?.dmsApiKey,
      jwtToken: org.integrations?.dmsJwt,
      orgSlug: hasOwn(submitted, 'orgSlug')
        ? (submitted.orgSlug || org.subdomain)
        : (org.integrations?.dmsOrgSlug || org.subdomain)
    }
  }

  if (integration === 's3') {
    const stored = org.integrations?.s3 || {}
    return {
      bucket: hasOwn(submitted, 'bucket') ? submitted.bucket : stored.bucket,
      endpoint: hasOwn(submitted, 'endpoint') ? submitted.endpoint : stored.endpoint,
      region: hasOwn(submitted, 'region') ? submitted.region : stored.region,
      accessKeyId: hasOwn(submitted, 'accessKeyId') ? submitted.accessKeyId : stored.accessKeyId,
      secretAccessKey: hasOwn(submitted, 'secretAccessKey')
        ? submitted.secretAccessKey
        : stored.secretAccessKey
    }
  }

  return submitted
}

const enabledIntegrationInputs = (integrations = {}) => {
  const inputs = []
  if (integrations.dmsEnabled === true) {
    inputs.push({
      integration: 'dms',
      config: {
        baseUrl: integrations.dmsBaseUrl,
        apiKey: integrations.dmsApiKey,
        jwtToken: integrations.dmsJwt,
        orgSlug: integrations.dmsOrgSlug
      }
    })
  }
  if (integrations.s3?.enabled === true) {
    inputs.push({ integration: 's3', config: integrations.s3 })
  }
  return inputs
}

const verifyOrTestCreateIntegrations = async ({ integrations, receipts, actorId }) => {
  for (const item of enabledIntegrationInputs(integrations)) {
    const verificationConfig = item.integration === 'dms'
      ? dms.connectionConfig(item.config)
      : s3.connectionConfig(item.config)
    const receipt = receipts?.[item.integration]
    if (receiptMatches({
      receipt,
      integration: item.integration,
      config: verificationConfig,
      actorId
    })) continue

    // Existing API consumers remain compatible: no receipt means one real
    // server-side validation before any organization data is persisted.
    await testPlatformIntegration(item.integration, item.config)
  }
}

// GET /api/platform/overview - compact, safe aggregates for the dashboard.
// This avoids loading every tenant document and running usageFor() N times just
// to render four KPIs and adoption percentages.
router.get('/overview', async (req, res, next) => {
  try {
    if (organizationSchemas()) return sendSuccess(res, await management.overview())
    const orgs = await Organization.find({ isDefault: { $ne: true } })
      .select('_id status plan licence features integrations.dmsEnabled integrations.departmentDms integrations.s3.enabled')
      .lean()

    const operational = orgs.filter((org) => {
      if ((org.status || 'active') === 'suspended') return false
      return licenceState(org).readOnly === false
    })
    const operationalIds = operational.map((org) => org._id)

    let activeUsers = 0
    let formOrgIds = []
    let workflowOrgIds = []
    let builderOrgIds = []
    if (operationalIds.length) {
      [activeUsers, formOrgIds, workflowOrgIds, builderOrgIds] = await Promise.all([
        User.countDocuments({ orgId: { $in: operationalIds }, isActive: { $ne: false } })
          .setOptions({ skipOrgScope: true }),
        Form.distinct('orgId', { orgId: { $in: operationalIds } })
          .setOptions({ skipOrgScope: true }),
        Workflow.distinct('orgId', { orgId: { $in: operationalIds } })
          .setOptions({ skipOrgScope: true }),
        User.distinct('orgId', {
          orgId: { $in: operationalIds },
          isActive: { $ne: false },
          canBuild: true,
          countsTowardSeats: { $ne: false }
        }).setOptions({ skipOrgScope: true })
      ])
    }

    const denominator = operational.length
    const adoptionRow = (key, label, organizations) => ({
      key,
      label,
      organizations,
      percentage: denominator ? Math.round((organizations / denominator) * 100) : 0
    })
    const dmsOrganizations = operational.filter((org) =>
      org.integrations?.dmsEnabled === true ||
      (org.integrations?.departmentDms || []).some((item) => item?.enabled !== false)
    ).length
    const s3Organizations = operational.filter((org) => org.integrations?.s3?.enabled === true).length
    const externalOrganizations = operational.filter((org) => org.features?.externalUsers === true).length

    return sendSuccess(res, {
      metrics: {
        totalOrganizations: orgs.length,
        activeOrganizations: operational.length,
        suspendedOrganizations: orgs.filter((org) => (org.status || 'active') === 'suspended').length,
        activeUsers
      },
      adoptionDenominator: denominator,
      adoption: [
        adoptionRow('forms', 'Forms', formOrgIds.length),
        adoptionRow('workflows', 'Workflows', workflowOrgIds.length),
        adoptionRow('builders', 'Builder access', builderOrgIds.length),
        adoptionRow('dms', 'DMS', dmsOrganizations),
        adoptionRow('s3', 'Dedicated S3', s3Organizations),
        adoptionRow('externalUsers', 'External users', externalOrganizations)
      ]
    })
  } catch (err) {
    next(err)
  }
})

// GET /api/platform/historical-stats?range=3M|6M|12M|ALL
// Historical values are lifecycle event counts. No current state is projected
// backwards, so every point remains auditable against AuditLog.
router.get('/historical-stats', async (req, res, next) => {
  try {
    const range = String(req.query.range || '12M').toUpperCase()
    if (range !== 'ALL' && !HISTORY_RANGES[range]) {
      return sendError(res, 'range must be one of 3M, 6M, 12M or ALL', 'INVALID_RANGE', 400)
    }

    const nowMonth = monthStartUtc()
    let firstMonth
    if (range === 'ALL') {
      const first = await AuditLog.findOne({ action: { $in: LIFECYCLE_ACTIONS } })
        .setOptions({ skipOrgScope: true })
        .select('createdAt')
        .sort({ createdAt: 1 })
        .lean()
      firstMonth = first ? monthStartUtc(first.createdAt) : nowMonth
    } else {
      const months = HISTORY_RANGES[range]
      firstMonth = new Date(Date.UTC(nowMonth.getUTCFullYear(), nowMonth.getUTCMonth() - months + 1, 1))
    }

    const logs = await AuditLog.find({
      action: { $in: LIFECYCLE_ACTIONS },
      createdAt: { $gte: firstMonth }
    })
      .setOptions({ skipOrgScope: true })
      .select('action createdAt')
      .sort({ createdAt: 1 })
      .lean()

    const currentTotalOrganizations = organizationSchemas() ? (await management.organizationCounts()).total : await Organization.countDocuments({ isDefault: { $ne: true } })

    const buckets = new Map()
    for (let cursor = firstMonth; cursor <= nowMonth;) {
      const timestamp = new Date(cursor)
      buckets.set(monthKey(timestamp), {
        timestamp: timestamp.toISOString(),
        metrics: { newOrgs: 0, suspendedOrgs: 0, activatedOrgs: 0, deletedOrgs: 0 }
      })
      cursor = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1))
    }

    const metricByAction = {
      org_created: 'newOrgs',
      org_suspended: 'suspendedOrgs',
      org_activated: 'activatedOrgs',
      org_deleted: 'deletedOrgs'
    }
    for (const log of logs) {
      const bucket = buckets.get(monthKey(log.createdAt))
      const metric = metricByAction[log.action]
      if (bucket && metric) bucket.metrics[metric] += 1
    }

    const snapshots = [...buckets.values()]
    let runningTotalOrganizations = currentTotalOrganizations
    for (let index = snapshots.length - 1; index >= 0; index -= 1) {
      const snapshot = snapshots[index]
      snapshot.metrics.totalOrganizations = runningTotalOrganizations
      runningTotalOrganizations = Math.max(
        0,
        runningTotalOrganizations - snapshot.metrics.newOrgs + snapshot.metrics.deletedOrgs
      )
    }

    return sendSuccess(res, { range, snapshots })
  } catch (err) {
    next(err)
  }
})

// POST /api/platform/broadcast - replace the active platform-wide banner.
router.post('/broadcast', async (req, res, next) => {
  try {
    const message = String(req.body?.message || '').trim()
    const severity = String(req.body?.severity || 'info').toLowerCase()
    const expiresAt = new Date(req.body?.expiresAt)

    if (!message || message.length > 500) {
      return sendError(res, 'Message must be between 1 and 500 characters', 'INVALID_MESSAGE', 400)
    }
    if (!['info', 'warning', 'critical'].includes(severity)) {
      return sendError(res, 'Severity must be info, warning or critical', 'INVALID_SEVERITY', 400)
    }
    if (Number.isNaN(expiresAt.getTime()) || expiresAt.getTime() <= Date.now()) {
      return sendError(res, 'Expiration must be in the future', 'INVALID_EXPIRY', 400)
    }

    const now = new Date()
    await PlatformBroadcast.updateMany(
      { supersededAt: null, expiresAt: { $gt: now } },
      { $set: { supersededAt: now } }
    )
    const broadcast = await PlatformBroadcast.create({
      message,
      severity,
      expiresAt,
      createdBy: req.user._id
    })
    await writeAuditLog({
      action: 'platform_broadcast_sent',
      performedBy: req.user._id,
      targetEntity: 'Platform',
      department: req.user.department,
      ipAddress: req.ip,
      detail: `Sent a ${severity} platform broadcast`,
      metadata: { broadcastId: String(broadcast._id), expiresAt }
    })

    return sendSuccess(res, {
      broadcast: {
        _id: broadcast._id,
        message: broadcast.message,
        severity: broadcast.severity,
        expiresAt: broadcast.expiresAt,
        createdAt: broadcast.createdAt
      }
    }, 201)
  } catch (err) {
    next(err)
  }
})

// Raw counts for the org card. `users`/`forms`/`workflows` follow the licensing
// rules (utils/usage.js) so the numbers here match what the quota gate enforces;
// totals are kept alongside so a Super Admin can still see deactivated seats.
const usageFor = async (orgId) => {
  const [licensed, usersTotal, formsTotal, workflowsTotal, pendingTasks] = await Promise.all([
    countsFor(orgId),
    User.countDocuments({ orgId }).setOptions({ skipOrgScope: true }),
    Form.countDocuments({ orgId }).setOptions({ skipOrgScope: true }),
    Workflow.countDocuments({ orgId }).setOptions({ skipOrgScope: true }),
    Task.countDocuments({ orgId, status: 'pending' }).setOptions({ skipOrgScope: true })
  ])
  return { ...licensed, usersTotal, formsTotal, workflowsTotal, pendingTasks }
}

// The platform catalogue needs the same live counters as `usageFor`, but doing
// that work once per tenant turns the page into an N+1 query fan-out. Aggregate
// each resource family once and join the counts in memory instead.
const countMap = (rows, shape) => new Map(rows.map((row) => [String(row._id), shape(row)]))

const usageForMany = async (orgIds) => {
  if (!orgIds.length) return new Map()

  const [userRows, formRows, workflowRows, taskRows] = await Promise.all([
    User.aggregate([
      { $match: { orgId: { $in: orgIds } } },
      {
        $group: {
          _id: '$orgId',
          usersTotal: { $sum: 1 },
          users: {
            $sum: {
              $cond: [
                { $and: [{ $eq: ['$isActive', true] }, { $ne: ['$countsTowardSeats', false] }] },
                1,
                0
              ]
            }
          },
          builders: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $eq: ['$isActive', true] },
                    { $ne: ['$countsTowardSeats', false] },
                    { $eq: ['$canBuild', true] }
                  ]
                },
                1,
                0
              ]
            }
          }
        }
      }
    ]).option({ skipOrgScope: true }),
    Form.aggregate([
      { $match: { orgId: { $in: orgIds } } },
      {
        $group: {
          _id: '$orgId',
          formsTotal: { $sum: 1 },
          forms: { $sum: { $cond: [{ $ne: ['$status', 'archived'] }, 1, 0] } }
        }
      }
    ]).option({ skipOrgScope: true }),
    Workflow.aggregate([
      { $match: { orgId: { $in: orgIds } } },
      {
        $group: {
          _id: '$orgId',
          workflowsTotal: { $sum: 1 },
          workflows: { $sum: { $cond: [{ $ne: ['$status', 'archived'] }, 1, 0] } }
        }
      }
    ]).option({ skipOrgScope: true }),
    Task.aggregate([
      { $match: { orgId: { $in: orgIds }, status: 'pending' } },
      { $group: { _id: '$orgId', pendingTasks: { $sum: 1 } } }
    ]).option({ skipOrgScope: true })
  ])

  const users = countMap(userRows, (row) => ({
    users: row.users || 0,
    builders: row.builders || 0,
    usersTotal: row.usersTotal || 0
  }))
  const forms = countMap(formRows, (row) => ({ forms: row.forms || 0, formsTotal: row.formsTotal || 0 }))
  const workflows = countMap(workflowRows, (row) => ({
    workflows: row.workflows || 0,
    workflowsTotal: row.workflowsTotal || 0
  }))
  const tasks = countMap(taskRows, (row) => ({ pendingTasks: row.pendingTasks || 0 }))

  return new Map(orgIds.map((orgId) => {
    const key = String(orgId)
    return [key, {
      users: 0,
      builders: 0,
      forms: 0,
      workflows: 0,
      usersTotal: 0,
      formsTotal: 0,
      workflowsTotal: 0,
      pendingTasks: 0,
      ...(users.get(key) || {}),
      ...(forms.get(key) || {}),
      ...(workflows.get(key) || {}),
      ...(tasks.get(key) || {})
    }]
  }))
}

// Org card payload: document + admin + counts + the licence/limit snapshot the
// UI meters render.
//
// `usage` stays the flat count object the panel has always rendered, which means
// it shadows the stored usage sub-document. That is deliberate — the stored
// meters (submission window, storage bytes, buffer) are richer than raw numbers
// and are published under `licensing` instead, already paired with their limits.
const maskDmsSecrets = (org) => ({
  ...org,
  integrations: {
    ...org.integrations,
    dmsApiKey: org.integrations?.dmsApiKey ? '••••••••' : '',
    dmsJwt: org.integrations?.dmsJwt ? '••••••••' : '',
    departmentDms: (org.integrations?.departmentDms || []).map(item => ({ ...item, apiKey: item.apiKey ? '••••••••' : '' }))
  }
})

const withLicensing = async (org, extra = {}) => {
  if (organizationSchemas()) return { ...await management.summary(String(org._id)), ...extra }
  const plain = maskDmsSecrets(typeof org.toObject === 'function' ? org.toObject() : org)
  const counts = await usageFor(plain._id)
  return {
    ...plain,
    ...extra,
    usage: counts,
    licensing: usageSnapshot(plain, counts)
  }
}

const withLicensingMany = async (orgs, extraById = new Map()) => {
  const countsById = await usageForMany(orgs.map((org) => org._id))
  return orgs.map((org) => {
    const plain = maskDmsSecrets(typeof org.toObject === 'function' ? org.toObject() : org)
    const key = String(plain._id)
    const counts = countsById.get(key) || {}
    return {
      ...plain,
      ...(extraById.get(key) || {}),
      usage: counts,
      licensing: usageSnapshot(plain, counts)
    }
  })
}

const PLATFORM_USAGE_PRIORITY = { exceeded: 4, critical: 3, warning: 2, ok: 1 }

const organizationHealth = (org) => {
  const licence = org.licensing?.licence || {}
  const meters = Object.values(org.licensing?.resources || {}).filter(Boolean)
  const worstState = meters.reduce((worst, meter) => (
    (PLATFORM_USAGE_PRIORITY[meter.state] || 1) > (PLATFORM_USAGE_PRIORITY[worst] || 0)
      ? meter.state
      : worst
  ), 'ok')
  const highestUsagePercent = meters.reduce((highest, meter) => (
    meter.unlimited ? highest : Math.max(highest, Number(meter.percent) || 0)
  ), 0)
  const expiringSoon = !licence.readOnly && licence.daysLeft !== null &&
    licence.daysLeft !== undefined && licence.daysLeft >= 0 && licence.daysLeft <= 30
  const readOnly = Boolean(licence.readOnly)
  const overLimit = meters.some((meter) => meter.state === 'exceeded')
  const usageRisk = meters.some((meter) => ['warning', 'critical', 'exceeded'].includes(meter.state))
  const workspaceSuspended = (org.status || 'active') === 'suspended'
  const setupIncomplete = org.provisioningStatus && org.provisioningStatus !== 'ready'
  const needsAttention = setupIncomplete || workspaceSuspended || readOnly || expiringSoon || usageRisk

  let riskRank = 0
  if (setupIncomplete || workspaceSuspended || readOnly) riskRank = 5
  else if (overLimit) riskRank = 4
  else if (expiringSoon) riskRank = 3
  else if (worstState === 'critical') riskRank = 2
  else if (worstState === 'warning') riskRank = 1

  return {
    healthy: !needsAttention,
    expiringSoon,
    readOnly,
    overLimit,
    usageRisk,
    needsAttention,
    worstState,
    highestUsagePercent,
    daysLeft: licence.daysLeft,
    riskRank
  }
}

// Dumps an org's document + every tenant collection scoped to it into a
// timestamped JSON folder (restorable — types preserved). Native driver reads
// bypass the org-scope plugin. Returns { dir, documents }.
const backupOrg = async (org) => {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const dir = path.join(__dirname, '..', 'backups', `org-${org.subdomain}-${stamp}`)
  fs.mkdirSync(dir, { recursive: true })

  fs.writeFileSync(
    path.join(dir, 'organization.jsonl'),
    JSON.stringify(org) + '\n'
  )

  let documents = 0
  const backupModels = require('../database/operations').tenantModels()
  for (const model of backupModels) {
    const name = model.definition.collection
    const docs = await require('../database/operations').exportTenantModel(model.modelName, org._id)
    if (!docs.length) continue
    const lines = docs.map((d) => JSON.stringify(d)).join('\n')
    fs.writeFileSync(path.join(dir, `${name}.jsonl`), lines + '\n')
    documents += docs.length
  }
  {
    const events = await require('../database/operations').exportTenantOutbox(org._id)
    if (events.length) {
      fs.writeFileSync(path.join(dir, 'delivery-outbox.jsonl'), events.map(event => JSON.stringify(event)).join('\n') + '\n')
      documents += events.length
    }
  }
  return { dir, documents }
}

// GET /api/platform/orgs — every tenant (default org hidden) with live usage
// and its bootstrap admin's email.
router.get('/orgs', async (req, res, next) => {
  try {
    let withUsage
    if (organizationSchemas()) withUsage = await provisioning.listOrganizations()
    else {
    const orgs = await Organization.find({ isDefault: { $ne: true } }).sort({ createdAt: 1 }).lean()

    const adminIds = orgs.map((o) => o.adminUserId).filter(Boolean)
    const admins = adminIds.length
      ? await User.find({ _id: { $in: adminIds } }).select('email name').setOptions({ skipOrgScope: true }).lean()
      : []
    const adminById = new Map(admins.map((a) => [String(a._id), a]))
    const extras = new Map(orgs.map((org) => [
      String(org._id),
      { admin: org.adminUserId ? adminById.get(String(org.adminUserId)) || null : null }
    ]))
    withUsage = await withLicensingMany(orgs, extras)
    }

    const managementKeys = ['q', 'status', 'plan', 'health', 'sort', 'page', 'limit']
    const managementView = managementKeys.some((key) => Object.prototype.hasOwnProperty.call(req.query, key))
    if (!managementView) return sendSuccess(res, { orgs: withUsage })

    const page = Math.max(1, parseInt(req.query.page, 10) || 1)
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20))
    const q = String(req.query.q || '').trim().toLowerCase()
    const status = String(req.query.status || 'all').trim().toLowerCase()
    const plan = String(req.query.plan || 'all').trim().toLowerCase()
    const health = String(req.query.health || 'all').trim().toLowerCase()
    const sort = String(req.query.sort || 'risk').trim().toLowerCase()

    const rows = withUsage.map((org) => ({ org, health: organizationHealth(org) }))
    const summary = rows.reduce((totals, row) => {
      totals.total += 1
      if (row.health.healthy) totals.healthy += 1
      if (row.health.expiringSoon) totals.expiringSoon += 1
      if (row.health.needsAttention) totals.needsAttention += 1
      return totals
    }, { total: 0, healthy: 0, expiringSoon: 0, needsAttention: 0 })

    const filtered = rows.filter(({ org, health: healthState }) => {
      if (status !== 'all' && ((org.provisioningStatus && org.provisioningStatus !== 'ready') || (org.status || 'active') !== status)) return false
      if (plan !== 'all' && String(org.plan || 'custom').toLowerCase() !== plan) return false
      if (health === 'attention' && !healthState.needsAttention) return false
      if (health === 'expiring' && !healthState.expiringSoon) return false
      if (health === 'read_only' && !healthState.readOnly) return false
      if (health === 'over_limit' && !healthState.overLimit) return false
      if (!q) return true
      return [
        org.name,
        org.subdomain,
        org.admin?.name,
        org.admin?.email,
        org.billingEmail,
        ...(org.allowedDomains || [])
      ].some((value) => String(value || '').toLowerCase().includes(q))
    })

    const byName = (a, b) => String(a.org.name || '').localeCompare(String(b.org.name || ''))
    const expiryValue = (row) => Number.isFinite(Number(row.health.daysLeft))
      ? Number(row.health.daysLeft)
      : Number.POSITIVE_INFINITY
    filtered.sort((a, b) => {
      if (sort === 'name') return byName(a, b)
      if (sort === 'expiry') return expiryValue(a) - expiryValue(b) || byName(a, b)
      if (sort === 'usage') {
        return b.health.highestUsagePercent - a.health.highestUsagePercent || byName(a, b)
      }
      return b.health.riskRank - a.health.riskRank ||
        expiryValue(a) - expiryValue(b) ||
        b.health.highestUsagePercent - a.health.highestUsagePercent ||
        byName(a, b)
    })

    const total = filtered.length
    const totalPages = Math.max(1, Math.ceil(total / limit))
    const safePage = Math.min(page, totalPages)
    const start = (safePage - 1) * limit
    const pageRows = filtered.slice(start, start + limit).map(({ org }) => org)
    const planOptions = Array.from(new Map(withUsage.map((org) => [
      org.plan || 'custom',
      org.licensing?.licence?.planLabel || org.plan || 'Custom'
    ])).entries()).map(([key, label]) => ({ key, label }))
      .sort((a, b) => a.label.localeCompare(b.label))

    return sendSuccess(res, {
      orgs: pageRows,
      summary,
      pagination: { page: safePage, limit, total, totalPages },
      filterOptions: { plans: planOptions }
    })
  } catch (err) {
    next(err)
  }
})

// Validate create-form credentials or an existing tenant's effective saved
// configuration without creating an organization or persisting test input.
router.post('/integrations/test', platformIntegrationLimiter, async (req, res, next) => {
  const integration = String(req.body?.integration || '').toLowerCase().trim()
  try {
    const config = await resolveIntegrationTestConfig({
      integration,
      config: req.body?.config,
      orgId: req.body?.orgId
    })
    const result = await testPlatformIntegration(integration, config)
    const receipt = issueIntegrationReceipt({
      integration,
      config: result.verificationConfig,
      actorId: req.user._id
    })
    return sendSuccess(res, {
      integration,
      status: 'connected',
      checks: result.checks,
      ...receipt
    })
  } catch (error) {
    if (error instanceof PlatformIntegrationError || ['DMS_INVALID_ENDPOINT', 'DMS_ENDPOINT_MIGRATION_REQUIRED'].includes(error.code)) {
      return sendError(res, error.message, error.code, error.status, {
        integration: error.integration || integration || null
      })
    }
    console.warn('[platform-integration] unexpected test failure', {
      integration: integration || 'unknown',
      errorType: error?.name || 'Error'
    })
    return sendError(res, 'The integration connection could not be tested.', 'INTEGRATION_TEST_FAILED', 502, {
      integration: integration || null
    })
  }
})

// POST /api/platform/orgs — create a new organization AND its first Org Admin.
// The admin gets a temporary password (returned once) and must change it on
// first login (models/User.mustChangePassword).
router.post('/orgs', async (req, res, next) => {
  try {
    const {
      name, subdomain, allowedDomains, features, adminEmail, adminName,
      // Platform Super Admin options for the bootstrap Org Admin (default on):
      //   adminCanBuild           — grant form/workflow builder access
      //   countAdminTowardSeats — bill this admin against user + builder limits
      adminCanBuild,
      countAdminTowardSeats,
      pdfAutoFillEntitlementOverride
    } = req.body || {}
    if (!name || !subdomain) {
      return sendError(res, 'name and subdomain are required', 'MISSING_FIELDS', 400)
    }
    const email = String(adminEmail || '').toLowerCase().trim()
    if (!email) return sendError(res, 'Admin email is required', 'MISSING_ADMIN_EMAIL', 400)
    if (!EMAIL_RE.test(email)) return sendError(res, 'Enter a valid admin email', 'INVALID_ADMIN_EMAIL', 400)
    const grantBuild = adminCanBuild !== false && adminCanBuild !== 'false'
    const billSeats = countAdminTowardSeats !== false && countAdminTowardSeats !== 'false'

    const sub = String(subdomain).toLowerCase().trim()
    if (!organizationSchemas()) {
      const taken = await Organization.findOne({ subdomain: sub }).lean()
      if (taken) return sendError(res, `Subdomain "${sub}" is already taken`, 'SUBDOMAIN_TAKEN', 400)
    }

    const parsedDomains = parseDomains(allowedDomains)
    const parsedFeatures = {
      externalUsers: features?.externalUsers === true
    }

    // Validate the admin email against the org's OWN domain policy up front.
    const policy = checkEmailDomain({ name, allowedDomains: parsedDomains, features: parsedFeatures }, email)
    if (!policy.allowed) return sendError(res, policy.reason, 'ADMIN_DOMAIN_NOT_ALLOWED', 400)

    // Build the org in memory so a bad plan/limit payload is rejected before we
    // write anything (and before a temp password is generated).
    
    // Parse DMS Integrations for creation time
    const integrationsDoc = {}
    if (req.body?.integrations) {
      const integrations = req.body.integrations
      if (integrations.dmsBaseUrl !== undefined) integrationsDoc.dmsBaseUrl = dms.normalizeEndpoint(integrations.dmsBaseUrl)
      if (integrations.dmsName !== undefined) integrationsDoc.dmsName = String(integrations.dmsName || '').trim()
      if (integrations.dmsApiKey !== undefined) integrationsDoc.dmsApiKey = String(integrations.dmsApiKey || '').trim()
      if (integrations.dmsEnabled !== undefined) integrationsDoc.dmsEnabled = Boolean(integrations.dmsEnabled)
      if (integrations.dmsOrgSlug !== undefined) integrationsDoc.dmsOrgSlug = String(integrations.dmsOrgSlug || '').toLowerCase().trim().replace(/[^a-z0-9-]/g, '-')
      
      if (integrations.s3 !== undefined) {
        integrationsDoc.s3 = {
          enabled: Boolean(integrations.s3.enabled),
          bucket: String(integrations.s3.bucket || '').trim(),
          endpoint: String(integrations.s3.endpoint || '').trim(),
          region: String(integrations.s3.region || 'auto').trim(),
          accessKeyId: String(integrations.s3.accessKeyId || '').trim(),
          secretAccessKey: String(integrations.s3.secretAccessKey || '').trim()
        }
      }
      
      if (Array.isArray(integrations.departmentDms)) {
        integrationsDoc.departmentDms = integrations.departmentDms
          .filter((d) => d && String(d.department || '').trim())
          .map((d) => ({
            department: String(d.department).trim(),
            apiKey:  String(d.apiKey  || '').trim(),
            baseUrl: String(d.baseUrl || '').trim(),
            folder:  String(d.folder  || '').trim(),
            enabled: d.enabled !== false
          }))
      }
    }

    const org = new Organization({
      name: String(name).trim(),
      subdomain: sub,
      allowedDomains: parsedDomains,
      features: parsedFeatures,
      ...(Object.keys(integrationsDoc).length ? { integrations: integrationsDoc } : {})
    })

    const licensingErrors = applyLicensingPayload(org, req.body || {})
    if (licensingErrors.length) {
      return sendError(res, licensingErrors[0], 'INVALID_LICENSING', 400, { errors: licensingErrors })
    }
    if (pdfAutoFillEntitlementOverride !== undefined) {
      if (org.plan !== 'custom') {
        return sendError(res, 'PDF auto-fill entitlement overrides are only valid for custom plans.', 'INVALID_ENTITLEMENT_OVERRIDE', 400)
      }
      org.pdfAutoFill.entitlementOverride = pdfAutoFillEntitlementOverride === true
    }

    const verifyIntegrations = () => verifyOrTestCreateIntegrations({
      integrations: integrationsDoc,
      receipts: req.body?.integrationVerifications,
      actorId: req.user._id
    })

    // Start the submission allowance from day one rather than waiting for the
    // first submission, so the UI can show a period immediately.
    org.usage.submissions = freshPeriod(org)
    if (organizationSchemas()) {
      const result = await provisioning.createOrganization({ actorId: String(req.user._id), key: req.get('Idempotency-Key'), body: req.body,
        org, admin: { email, name: String(adminName || '').trim() || `${org.name} Admin`, canBuild: grantBuild, countsTowardSeats: billSeats }, verifyIntegrations })
      if (result.admin) result.admin.warning = policy.warning || null
      res.set('Cache-Control', 'no-store')
      return sendSuccess(res, result, result.pending ? 202 : result.replayed ? 200 : 201)
    }
    await verifyIntegrations()
    await org.save()

    const tenantRoles = await ensureRolesForOrganization(org._id, { force: true })
    const adminRole = tenantRoles.get('admin')
    if (!adminRole) {
      await Organization.deleteOne({ _id: org._id })
      return sendError(res, 'Admin role could not be provisioned.', 'NO_ADMIN_ROLE', 500)
    }

    const tempPassword = generatePassword(14)
    let admin
    try {
      admin = await User.create({
        orgId: org._id,
        name: String(adminName || '').trim() || `${org.name} Admin`,
        email,
        password: tempPassword,
        department: 'IT',
        role: adminRole._id,
        mustChangePassword: true,
        needsProductTour: true,
        // Defaults keep today’s behaviour: first admin can build and bills a seat.
        // Platform Super Admin may opt out of either via the create-org form.
        canBuild: grantBuild,
        countsTowardSeats: billSeats
      })
    } catch (adminErr) {
      await Role.deleteMany({ orgId: org._id }).setOptions({ skipOrgScope: true })
      clearRoleProvisioningCache(org._id)
      // Never leave an org with no admin — roll the org back.
      await Organization.deleteOne({ _id: org._id })
      if (adminErr.code === 11000) {
        return sendError(res, 'A user with that email already exists in this organization', 'ADMIN_EXISTS', 400)
      }
      throw adminErr
    }

    org.adminUserId = admin._id
    await org.save()

    auditPlatform(req, 'org_created', org, `Created organization "${org.name}" (${org.subdomain}) with admin ${admin.email}`, {
      adminEmail: admin.email,
      adminCanBuild: grantBuild,
      countAdminTowardSeats: billSeats
    })

    return sendSuccess(res, {
      org: await withLicensing(org, {
        admin: { _id: admin._id, email: admin.email, name: admin.name }
      }),
      // Shown to the Super Admin exactly once — the password is hashed at rest.
      admin: {
        email: admin.email,
        name: admin.name,
        tempPassword,
        warning: policy.warning || null,
        canBuild: grantBuild,
        countsTowardSeats: billSeats
      }
    }, 201)
  } catch (err) {
    if (organizationSchemas() && err.status && !err.integration) {
      const messages = {
        IDEMPOTENCY_KEY_REQUIRED: 'A valid organization creation request ID is required.',
        IDEMPOTENCY_CONFLICT: 'This request ID was already used with different organization details.',
        INVALID_SCHEMA_NAME: 'Use an organization name that produces 1–56 letters, digits or underscores.',
        SCHEMA_NAME_TAKEN: 'An organization with the same database schema name already exists. Use a distinct name.',
        SUBDOMAIN_TAKEN: 'This organization address is already reserved.',
        PROVISIONING_KEY_REQUIRED: 'Organization creation requires the server provisioning key to be configured.',
        PROVISIONING_FAILED: 'Organization setup did not complete. Retry the same request safely.',
        SCHEMA_CONFLICT: 'The reserved schema conflicts with existing database objects. Contact the database operator.'
      }
      if (messages[err.code]) return sendError(res, messages[err.code], err.code, err.status, { operationId: err.operationId })
    }
    if (err instanceof PlatformIntegrationError) {
      return sendError(res, err.message, err.code, err.status, {
        integration: err.integration
      })
    }
    if (err instanceof PlatformIntegrationError || ['DMS_INVALID_ENDPOINT', 'DMS_ENDPOINT_MIGRATION_REQUIRED'].includes(err.code)) {
      return sendError(res, err.message, err.code, err.status || 422)
    }
    if (err.name === 'ValidationError') {
      return sendError(res, err.message, 'INVALID_ORG', 400)
    }
    next(err)
  }
})

router.get('/provisioning/:operationId', async (req, res, next) => {
  try {
    if (!organizationSchemas()) return sendError(res, 'Operation not found.', 'OPERATION_NOT_FOUND', 404)
    res.set('Cache-Control', 'no-store')
    return sendSuccess(res, { operation: await provisioning.operationStatus(String(req.user._id), req.params.operationId) })
  } catch (error) {
    if (error.code === 'OPERATION_NOT_FOUND') return sendError(res, 'Operation not found.', error.code, 404)
    next(error)
  }
})

// PUT /api/platform/orgs/:id — update settings (not status; see suspend/activate).
router.put('/orgs/:id', async (req, res, next) => {
  try {
    const org = await loadManagedOrg(req.params.id)
    if (!org) return sendError(res, 'Organization not found', 'ORG_NOT_FOUND', 404)

    const { name, allowedDomains, features, integrations, pdfAutoFillEntitlementOverride } = req.body || {}
    if (name !== undefined) org.name = String(name).trim()
    if (allowedDomains !== undefined) org.allowedDomains = parseDomains(allowedDomains)
    if (features !== undefined) {
      if (features.externalUsers !== undefined) org.features.externalUsers = Boolean(features.externalUsers)
    }

    // DMS integration settings — SuperAdmin only. dmsApiKey is write-once from
    // this endpoint (pass empty string '' to clear it).
    const previousDms = JSON.stringify({ enabled: org.integrations?.dmsEnabled, ...dms.connectionConfig({
      baseUrl: org.integrations?.dmsBaseUrl, apiKey: org.integrations?.dmsApiKey,
      jwtToken: org.integrations?.dmsJwt, orgSlug: org.integrations?.dmsOrgSlug
    }) })
    const previousS3 = JSON.stringify(org.integrations?.s3 || {})
    const dmsChanges = []
    if (integrations !== undefined) {
      if (integrations.dmsBaseUrl !== undefined) {
        const endpoint = dms.assertEndpointChange(org, integrations.dmsBaseUrl)
        if (endpoint !== (org.integrations?.dmsBaseUrl || '')) {
          org.integrations.dmsBaseUrl = endpoint
          dmsChanges.push('dmsBaseUrl')
        }
      }
      if (integrations.dmsName !== undefined) {
        org.integrations.dmsName = String(integrations.dmsName || '').trim()
        dmsChanges.push('dmsName')
      }
      if (integrations.dmsApiKey !== undefined && integrations.dmsApiKey !== '••••••••') {
        const newKey = String(integrations.dmsApiKey || '').trim()
        if (newKey !== (org.integrations?.dmsApiKey || '')) {
          org.integrations.dmsApiKey = newKey
          dmsChanges.push('dmsApiKey')
        }
      }
      if (integrations.dmsEnabled !== undefined) {
        const newVal = Boolean(integrations.dmsEnabled)
        if (newVal !== Boolean(org.integrations?.dmsEnabled)) {
          org.integrations.dmsEnabled = newVal
          dmsChanges.push(`dmsEnabled=${newVal}`)
        }
      }
      if (integrations.dmsOrgSlug !== undefined) {
        const newSlug = String(integrations.dmsOrgSlug || '').toLowerCase().trim()
          .replace(/[^a-z0-9-]/g, '-')
        if (newSlug !== (org.integrations?.dmsOrgSlug || '')) {
          org.integrations.dmsOrgSlug = newSlug
          dmsChanges.push(`dmsOrgSlug=${newSlug || '(subdomain)'}`)
        }
      }

      if (integrations.s3 !== undefined) {
        const s3 = integrations.s3
        if (!org.integrations.s3) org.integrations.s3 = {}
        if (s3.enabled !== undefined) org.integrations.s3.enabled = Boolean(s3.enabled)
        if (s3.bucket !== undefined) org.integrations.s3.bucket = String(s3.bucket || '').trim()
        if (s3.endpoint !== undefined) org.integrations.s3.endpoint = String(s3.endpoint || '').trim()
        if (s3.region !== undefined) org.integrations.s3.region = String(s3.region || 'auto').trim()
        if (s3.accessKeyId !== undefined && s3.accessKeyId !== '\u2022'.repeat(8)) org.integrations.s3.accessKeyId = String(s3.accessKeyId || '').trim()
        if (s3.secretAccessKey !== undefined) {
          const newSecret = String(s3.secretAccessKey || '').trim()
          if (newSecret !== '••••••••') {
            org.integrations.s3.secretAccessKey = newSecret
            dmsChanges.push('s3.secretAccessKey')
          }
        }
        dmsChanges.push('s3 settings')
      }
      
      // Clean up legacy root-level S3 object
      org.set('s3', undefined, { strict: false })

      // Per-department DMS configs — full replace (send the whole array to update)
      if (Array.isArray(integrations.departmentDms)) {
        org.integrations.departmentDms = integrations.departmentDms
          .filter((d) => d && String(d.department || '').trim())
          .map((d) => {
            const deptName = String(d.department).trim()
            let apiKey = String(d.apiKey || '').trim()
            // Preserve existing key if masked or missing
            if (apiKey === '••••••••' || !apiKey) {
              const existing = org.integrations.departmentDms?.find(
                (e) => String(e.department).toLowerCase() === deptName.toLowerCase()
              )
              // Only fallback to existing if we didn't explicitly send an empty string
              // Wait, if !apiKey, how do we clear it? We can allow frontend to send
              // a special flag or we just let it keep existing if it's strictly '••••••••'
              if (apiKey === '••••••••') {
                apiKey = existing?.apiKey || ''
              }
            }
            return {
              department: deptName,
              apiKey,
              baseUrl: String(d.baseUrl || '').trim(),
              folder:  String(d.folder  || '').trim(),
              enabled: d.enabled !== false
            }
          })
        dmsChanges.push(`departmentDms[${org.integrations.departmentDms.length}]`)
      }
    }

    const before = { plan: org.plan, limits: org.limits.toObject ? org.limits.toObject() : { ...org.limits } }
    const licensingErrors = applyLicensingPayload(org, req.body || {})
    if (licensingErrors.length) {
      return sendError(res, licensingErrors[0], 'INVALID_LICENSING', 400, { errors: licensingErrors })
    }
    if (pdfAutoFillEntitlementOverride !== undefined) {
      if (org.plan !== 'custom') {
        return sendError(res, 'PDF auto-fill entitlement overrides are only valid for custom plans.', 'INVALID_ENTITLEMENT_OVERRIDE', 400)
      }
      org.pdfAutoFill.entitlementOverride = pdfAutoFillEntitlementOverride === true
    }

    // A plan change re-dates the allowance: the new submission cap should apply
    // from now, not from a window that was sized for the old plan.
    if (org.plan !== before.plan
      || Number(org.limits.maxSubmissionsPerPeriod || 0) !== Number(before.limits.maxSubmissionsPerPeriod || 0)) {
      const period = freshPeriod(org)
      // Keep the count — the tenant did submit those — only re-window it.
      org.usage.submissions.periodStart = period.periodStart
      org.usage.submissions.periodEnd = period.periodEnd
      resetNotified(org, 'sub')
    }
    if (Number(org.limits.maxStorageMb || 0) !== Number(before.limits.maxStorageMb || 0)) {
      resetNotified(org, 'stor')
    }

    if (org.integrations?.dmsEnabled) {
      const config = {
        baseUrl: org.integrations.dmsBaseUrl, apiKey: org.integrations.dmsApiKey,
        jwtToken: org.integrations.dmsJwt, orgSlug: org.integrations.dmsOrgSlug
      }
      const effective = dms.connectionConfig(config)
      if (previousDms !== JSON.stringify({ enabled: org.integrations.dmsEnabled, ...effective }) &&
          !receiptMatches({ receipt: req.body?.integrationVerifications?.dms, integration: 'dms', config: effective, actorId: req.user._id })) {
        await testPlatformIntegration('dms', config)
      }
    }

    if (organizationSchemas() && org.integrations?.s3?.enabled && previousS3 !== JSON.stringify(org.integrations.s3)) {
      const effective = s3.connectionConfig(org.integrations.s3)
      if (!receiptMatches({ receipt:req.body?.integrationVerifications?.s3, integration:'s3', config:effective, actorId:req.user._id })) {
        await testPlatformIntegration('s3', org.integrations.s3)
      }
    }

    await saveManagedOrg(org, req, 'org_updated')

    const planChanged = org.plan !== before.plan
    const entitlementDetail = pdfAutoFillEntitlementOverride !== undefined
      ? 'PDF auto-fill entitlement=' + (org.pdfAutoFill.entitlementOverride === true)
      : null
    const detail = [
      entitlementDetail,
      planChanged ? `plan ${before.plan} → ${org.plan}` : null,
      dmsChanges.length ? `DMS: ${dmsChanges.join(', ')}` : null
    ].filter(Boolean).join('; ')

    auditPlatform(
      req,
      'org_updated',
      org,
      `Updated organization "${org.name}" (${org.subdomain})${detail ? ` — ${detail}` : ''}`,
      {
        ...(planChanged ? { planFrom: before.plan, planTo: org.plan } : {}),
        ...(dmsChanges.length ? { dmsChanges } : {})
      }
    )
    return sendSuccess(res, { org: await withLicensing(org) })
  } catch (err) {
    if (err instanceof PlatformIntegrationError || ['DMS_INVALID_ENDPOINT', 'DMS_ENDPOINT_MIGRATION_REQUIRED'].includes(err.code)) {
      return sendError(res, err.message, err.code, err.status || 422)
    }
    if (err.name === 'ValidationError') {
      return sendError(res, err.message, 'INVALID_ORG', 400)
    }
    next(err)
  }
})

// GET /api/platform/orgs/:id/usage — one tenant's meters, freshly counted.
//
// The list endpoint already carries a snapshot per org; this exists for the org
// detail view, which needs it after an edit, and for support work — with
// `?disk=1` it also measures the attachment directory so drift between the stored
// meter and the filesystem is visible without waiting for the nightly job.
router.get('/orgs/:id/usage', async (req, res, next) => {
  try {
    // Rolling here as well as on the tenant's own endpoint: a Super Admin
    // investigating "why are they blocked?" must not be shown a stale window.
    if (organizationSchemas()) {
      const placement = await management.placementRow(req.params.id)
      if (placement.status==='active') await require('../database/fresh/routing').withAccount(
        {account_scope:'tenant',org_id:req.params.id},async()=>await ensurePeriod(req.params.id))
      const org = await management.summary(req.params.id)
      const payload = { org: { _id:org._id,name:org.name,subdomain:org.subdomain,status:org.status }, counts:org.usage,
        usage:org.licensing, storageExtension:org.storageExtension?.extraMb ? org.storageExtension : null }
      if (String(req.query.disk || '')==='1') {
        const stored = await management.load(req.params.id)
        const actual = measureOrg(org._id)
        payload.disk = { ...actual, driftBytes:actual.bytes-Number(stored.usage?.storageBytes || 0), driftFiles:actual.files-Number(stored.usage?.fileCount || 0) }
      }
      return sendSuccess(res,payload)
    }
    await ensurePeriod(req.params.id)

    const org = await Organization.findById(req.params.id).lean()
    if (!org) return sendError(res, 'Organization not found', 'ORG_NOT_FOUND', 404)

    const counts = await usageFor(org._id)
    const payload = {
      org: { _id: org._id, name: org.name, subdomain: org.subdomain, status: org.status },
      counts,
      usage: usageSnapshot(org, counts),
      storageExtension: org.storageExtension?.extraMb ? org.storageExtension : null
    }

    if (String(req.query.disk || '') === '1') {
      const actual = measureOrg(org._id)
      payload.disk = {
        bytes: actual.bytes,
        files: actual.files,
        driftBytes: actual.bytes - Number(org.usage?.storageBytes || 0),
        driftFiles: actual.files - Number(org.usage?.fileCount || 0)
      }
    }

    return sendSuccess(res, payload)
  } catch (err) {
    next(err)
  }
})

// POST /api/platform/orgs/:id/suspend — every user of the org is locked out
// on their next request (middleware/tenant.js rejects with ORG_SUSPENDED).
router.post('/orgs/:id/suspend', async (req, res, next) => {
  try {
    const org = await loadManagedOrg(req.params.id)
    if (!org) return sendError(res, 'Organization not found', 'ORG_NOT_FOUND', 404)
    if (org.isDefault) {
      return sendError(res, 'The default organization cannot be suspended (it hosts the platform admin).', 'CANNOT_SUSPEND_DEFAULT', 400)
    }
    org.status = 'suspended'
    await saveManagedOrg(org, req, 'org_suspended')
    auditPlatform(req, 'org_suspended', org, `Suspended organization "${org.name}" (${org.subdomain})`)
    return sendSuccess(res, { org: organizationSchemas() ? await withLicensing(org) : org.toObject() })
  } catch (err) {
    next(err)
  }
})

// POST /api/platform/orgs/:id/activate
router.post('/orgs/:id/activate', async (req, res, next) => {
  try {
    const org = await loadManagedOrg(req.params.id)
    if (!org) return sendError(res, 'Organization not found', 'ORG_NOT_FOUND', 404)
    org.status = 'active'
    await saveManagedOrg(org, req, 'org_activated')
    auditPlatform(req, 'org_activated', org, `Activated organization "${org.name}" (${org.subdomain})`)
    return sendSuccess(res, { org: organizationSchemas() ? await withLicensing(org) : org.toObject() })
  } catch (err) {
    next(err)
  }
})

// POST /api/platform/orgs/:id/storage-extension — grant temporary extra storage.
// Support lever for a tenant that has filled both its plan and its completion
// buffer: raises the ceiling for a fixed number of days without touching the
// contracted limit, so the plan value stays the source of truth at renewal.
router.post('/orgs/:id/storage-extension', async (req, res, next) => {
  try {
    const org = await loadManagedOrg(req.params.id)
    if (!org) return sendError(res, 'Organization not found', 'ORG_NOT_FOUND', 404)

    const extraMb = Number(req.body?.extraMb)
    const days = Number(req.body?.days)
    const reason = String(req.body?.reason || '').trim()

    if (!Number.isFinite(extraMb) || extraMb <= 0 || extraMb > MAX_EXTENSION_MB) {
      return sendError(res, `extraMb must be between 1 and ${MAX_EXTENSION_MB}.`, 'VALIDATION_ERROR', 400)
    }
    if (!Number.isFinite(days) || days <= 0 || days > MAX_EXTENSION_DAYS) {
      return sendError(res, `days must be between 1 and ${MAX_EXTENSION_DAYS}.`, 'VALIDATION_ERROR', 400)
    }
    if (!Number(org.limits?.maxStorageMb || 0)) {
      return sendError(res, 'This organization already has unlimited storage.', 'STORAGE_UNLIMITED', 400)
    }

    const expiresAt = new Date(Date.now() + days * 86400000)
    org.storageExtension = { extraMb, expiresAt, grantedBy: req.user._id, reason }
    // A bigger ceiling means the old "you are full" emails are stale.
    resetNotified(org, 'stor')
    await saveManagedOrg(org, req, 'org_storage_extended')

    auditPlatform(
      req,
      'org_storage_extended',
      org,
      `Granted ${extraMb} MB extra storage to "${org.name}" for ${days} day(s)${reason ? ` — ${reason}` : ''}`,
      { extraMb, days, expiresAt, reason }
    )
    return sendSuccess(res, { org: await withLicensing(org) })
  } catch (err) {
    next(err)
  }
})

// DELETE /api/platform/orgs/:id/storage-extension — end the grant early.
router.delete('/orgs/:id/storage-extension', async (req, res, next) => {
  try {
    const org = await loadManagedOrg(req.params.id)
    if (!org) return sendError(res, 'Organization not found', 'ORG_NOT_FOUND', 404)

    const had = Number(org.storageExtension?.extraMb || 0)
    org.storageExtension = { extraMb: 0, expiresAt: null, grantedBy: null, reason: '' }
    await saveManagedOrg(org, req, 'org_storage_extension_revoked')

    if (had) {
      auditPlatform(
        req,
        'org_storage_extension_revoked',
        org,
        `Revoked the ${had} MB storage extension on "${org.name}"`,
        { extraMb: had }
      )
    }
    return sendSuccess(res, { org: await withLicensing(org) })
  } catch (err) {
    next(err)
  }
})

// POST /api/platform/orgs/:id/reset-admin-password — issues a fresh temporary
// password for the org's bootstrap admin (shown once), forces a change on next
// login, and revokes the admin's existing sessions.
router.post('/orgs/:id/reset-admin-password', async (req, res, next) => {
  try {
    if (organizationSchemas()) {
      res.set('Cache-Control', 'no-store')
      return sendSuccess(res, await provisioning.resetAdminPassword(String(req.user._id), req.params.id))
    }
    const org = await Organization.findById(req.params.id)
    if (!org) return sendError(res, 'Organization not found', 'ORG_NOT_FOUND', 404)
    if (org.isDefault) {
      return sendError(res, 'The default organization has no tenant admin to reset.', 'CANNOT_RESET_DEFAULT', 400)
    }

    let admin = null
    if (org.adminUserId) {
      admin = await User.findOne({ _id: org.adminUserId }).setOptions({ skipOrgScope: true })
    }
    if (!admin) {
      // Legacy org without a recorded admin — fall back to its earliest Admin.
      const adminRole = await Role.findOne({ orgId: org._id, nameKey: 'admin' }).setOptions({ skipOrgScope: true })
      if (adminRole) {
        admin = await User.findOne({ orgId: org._id, role: adminRole._id }).sort({ createdAt: 1 })
      }
    }
    if (!admin) return sendError(res, 'No admin user found for this organization', 'NO_ORG_ADMIN', 404)

    const tempPassword = generatePassword(14)
    admin.password = tempPassword
    admin.mustChangePassword = true
    admin.tokenVersion = (admin.tokenVersion || 0) + 1
    await admin.save()

    if (!org.adminUserId) { org.adminUserId = admin._id; await org.save() }

    auditPlatform(req, 'org_admin_password_reset', org, `Reset admin password for "${org.name}" (${admin.email})`, {
      adminEmail: admin.email
    })

    return sendSuccess(res, { admin: { email: admin.email, name: admin.name, tempPassword } })
  } catch (err) {
    next(err)
  }
})

// DELETE /api/platform/orgs/:id — irreversibly removes a tenant. Backs the org
// up first (JSON on disk), then cascade-deletes every tenant collection and
// the org document. The default org is protected.
router.delete('/orgs/:id', async (req, res, next) => {
  try {
    const org = await Organization.findById(req.params.id)
    if (!org) return sendError(res, 'Organization not found', 'ORG_NOT_FOUND', 404)
    if (org.isDefault) {
      return sendError(res, 'The default organization cannot be deleted.', 'CANNOT_DELETE_DEFAULT', 400)
    }

    const snapshot = org.toObject()
    const backup = await backupOrg(snapshot)

    // Await so the platform event is written under the SuperAdmin's org before
    // the tenant's own AuditLog docs are wiped.
    await auditPlatform(req, 'org_deleted', snapshot, `Deleted organization "${snapshot.name}" (${snapshot.subdomain})`, {
      backupDir: path.basename(backup.dir),
      backupDocuments: backup.documents
    })

    const deleted = await require('../database/operations').deleteTenant(org._id)
    clearRoleProvisioningCache(org._id)

    // The backup above already contains every record; the tenant's attachment
    // directory is what the database cannot hold, so it is removed last — after
    // the deletes succeeded, never before.
    const filesPurged = await purgeOrgFiles(org._id)

    console.log(`[platform] Deleted org "${org.name}" (${org.subdomain}): ${deleted} docs removed, attachments ${filesPurged ? 'purged' : 'left in place'}. Backup → ${backup.dir}`)
    return sendSuccess(res, {
      deleted,
      filesPurged,
      backup: { documents: backup.documents, dir: path.basename(backup.dir) }
    })
  } catch (err) {
    next(err)
  }
})

// GET /api/platform/activity — SuperAdmin org-lifecycle audit trail
router.get('/activity', async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1)
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 25))
    const action = String(req.query.action || '').trim()
    const search = String(req.query.search || '').trim()

    const query = {
      action: action && PLATFORM_ACTIONS.includes(action)
        ? action
        : { $in: PLATFORM_ACTIONS }
    }
    if (search) {
      const regex = new RegExp(String(search).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')
      query.$or = [{ targetEntity: regex }, { detail: regex }]
    }

    const [total, logs] = await Promise.all([
      AuditLog.countDocuments(query).setOptions({ skipOrgScope: true }),
      AuditLog.find(query)
        .setOptions({ skipOrgScope: true })
        .populate({ path: 'performedBy', select: 'name email' })
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean()
    ])

    return sendSuccess(res, {
      total,
      page,
      totalPages: Math.ceil(total / limit) || 1,
      count: logs.length,
      logs,
      actions: PLATFORM_ACTIONS
    })
  } catch (err) {
    next(err)
  }
})

// GET /api/platform/plans — catalogue + how many tenants sit on each tier.
// Limits are config-driven today (server/config/plans.js); this endpoint is
// read-only so the Super Admin UI can show what is sold without editing code.
router.get('/plans', async (req, res, next) => {
  try {
    const orgs = organizationSchemas()
      ? (await require('../database/postgres').query('SELECT plan,status,provisioning_status AS "provisioningStatus" FROM platform.organizations WHERE deleted_at IS NULL')).rows
      : await Organization.find({ isDefault: { $ne: true } }).select('plan status').lean()

    const counts = {}
    for (const key of [...SELLABLE_PLANS, 'custom']) counts[key] = { total: 0, active: 0, suspended: 0 }
    for (const org of orgs) {
      const plan = counts[org.plan] ? org.plan : 'custom'
      counts[plan].total += 1
      if (org.provisioningStatus && org.provisioningStatus !== 'ready') counts[plan].pending = (counts[plan].pending || 0) + 1
      else if ((org.status || 'active') === 'suspended') counts[plan].suspended += 1
      else counts[plan].active += 1
    }

    const limitLabel = (n) => (n ? String(n) : 'Unlimited')

    const plans = SELLABLE_PLANS.map((key) => {
      const preset = PLAN_PRESETS[key]
      const limits = preset.limits || {}
      return {
        key,
        label: preset.label,
        trialDays: preset.trialDays || null,
        features: {
          pdfAutoFill: preset.features?.pdfAutoFill === true
        },
        limits: {
          maxUsers: limits.maxUsers || 0,
          maxBuilders: limits.maxBuilders || 0,
          maxForms: limits.maxForms || 0,
          maxWorkflows: limits.maxWorkflows || 0,
          maxSubmissionsPerPeriod: limits.maxSubmissionsPerPeriod || 0,
          maxStorageMb: limits.maxStorageMb || 0,
          maxFiles: limits.maxFiles || 0
        },
        limitsDisplay: {
          users: limitLabel(limits.maxUsers),
          builders: limitLabel(limits.maxBuilders),
          forms: limitLabel(limits.maxForms),
          workflows: limitLabel(limits.maxWorkflows),
          submissions: limitLabel(limits.maxSubmissionsPerPeriod),
          storage: formatPlanMb(limits.maxStorageMb),
          files: limitLabel(limits.maxFiles)
        },
        tenants: counts[key] || { total: 0, active: 0, suspended: 0 }
      }
    })

    return sendSuccess(res, {
      plans,
      custom: {
        key: 'custom',
        label: PLAN_PRESETS.custom.label,
        features: { pdfAutoFill: false },
        tenants: counts.custom || { total: 0, active: 0, suspended: 0 }
      },
      totalTenants: orgs.length
    })
  } catch (err) {
    next(err)
  }
})

// POST /api/platform/plans — create a new subscription plan dynamically.
router.post('/plans', async (req, res, next) => {
  try {
    const Plan = require('../models/Plan')
    const { reloadPlans } = require('../config/plans')
    
    const { key, label, trialDays, limits, features } = req.body
    if (!key || !label) {
      return sendError(res, 'Key and label are required', 'MISSING_FIELDS', 400)
    }
    
    const existing = await Plan.findOne({ key })
    if (existing) {
      return sendError(res, `Plan key "${key}" already exists`, 'PLAN_EXISTS', 400)
    }

    const plan = await Plan.create({
      key,
      label,
      trialDays: trialDays ? Number(trialDays) : null,
      limits: limits || {},
      features: {
        pdfAutoFill: features?.pdfAutoFill !== false
      },
      isCustom: false
    })

    await reloadPlans()
    
    auditPlatform(req, 'plan_created', null, `Created subscription plan "${label}" (${key})`, { key, label })
    return sendSuccess(res, { plan }, 201)
  } catch (err) {
    if (err.name === 'ValidationError') return sendError(res, err.message, 'VALIDATION_ERROR', 400)
    next(err)
  }
})

// PUT /api/platform/plans/:key — update an existing subscription plan.
router.put('/plans/:key', async (req, res, next) => {
  try {
    const Plan = require('../models/Plan')
    const { reloadPlans } = require('../config/plans')
    
    const plan = await Plan.findOne({ key: req.params.key })
    if (!plan) return sendError(res, 'Plan not found', 'PLAN_NOT_FOUND', 404)
    if (plan.isCustom) return sendError(res, 'Cannot edit the custom plan preset', 'INVALID_OPERATION', 400)

    const { label, trialDays, limits, features } = req.body
    if (label !== undefined) plan.label = label
    if (trialDays !== undefined) plan.trialDays = trialDays === null ? null : Number(trialDays)
    if (limits !== undefined) {
      plan.limits = { ...plan.limits, ...limits }
    }
    if (features?.pdfAutoFill !== undefined) {
      plan.set('features.pdfAutoFill', features.pdfAutoFill === true)
    }

    await plan.save()
    await reloadPlans()
    
    auditPlatform(req, 'plan_updated', null, `Updated subscription plan "${plan.label}" (${plan.key})`, { key: plan.key })
    return sendSuccess(res, { plan })
  } catch (err) {
    if (err.name === 'ValidationError') return sendError(res, err.message, 'VALIDATION_ERROR', 400)
    next(err)
  }
})

// DELETE /api/platform/plans/:key — delete a subscription plan.
router.delete('/plans/:key', async (req, res, next) => {
  try {
    const Plan = require('../models/Plan')
    const { reloadPlans } = require('../config/plans')
    
    const key = req.params.key
    const plan = await Plan.findOne({ key })
    if (!plan) return sendError(res, 'Plan not found', 'PLAN_NOT_FOUND', 404)
    if (plan.isCustom) return sendError(res, 'Cannot delete the custom plan preset', 'INVALID_OPERATION', 400)

    const inUse = await Organization.exists({ plan: key })
    if (inUse) {
      return sendError(res, 'Cannot delete plan because organizations are actively using it', 'PLAN_IN_USE', 400)
    }

    await Plan.deleteOne({ key })
    await reloadPlans()
    
    auditPlatform(req, 'plan_deleted', null, `Deleted subscription plan "${plan.label}" (${key})`, { key })
    return sendSuccess(res, { deleted: true })
  } catch (err) {
    next(err)
  }
})

// GET /api/platform/admins — every SuperAdmin account on this deployment.
router.get('/admins', async (req, res, next) => {
  try {
    const role = await Role.findOne({ name: 'SuperAdmin' }).lean()
    if (!role) return sendSuccess(res, { admins: [] })

    const admins = await User.find({ role: role._id })
      .setOptions({ skipOrgScope: true })
      .select('name email department isActive isProtected mustChangePassword lastLogin createdAt')
      .sort({ createdAt: 1 })
      .lean()

    return sendSuccess(res, {
      admins: admins.map((u) => ({
        ...u,
        isSelf: String(u._id) === String(req.user._id)
      })),
      count: admins.length
    })
  } catch (err) {
    next(err)
  }
})

// POST /api/platform/admins — provision another platform SuperAdmin.
router.post('/admins', async (req, res, next) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase()
    const name = String(req.body.name || '').trim() || 'Platform Admin'
    if (!EMAIL_RE.test(email)) return sendError(res, 400, 'A valid email is required')

    const role = await Role.findOne({ name: 'SuperAdmin' })
    if (!role) return sendError(res, 500, 'SuperAdmin role is missing — run seed:superadmin')

    const defaultOrg = await Organization.findOne({ isDefault: true }).lean()
    if (!defaultOrg) return sendError(res, 500, 'Default organization is missing')

    const existing = await User.findOne({ email, orgId: defaultOrg._id })
      .setOptions({ skipOrgScope: true })
      .lean()
    if (existing) return sendError(res, 409, 'A user with this email already exists on the platform')

    const tempPassword = generatePassword()
    const user = await User.create({
      orgId: defaultOrg._id,
      name,
      email,
      password: tempPassword,
      department: 'IT',
      role: role._id,
      mustChangePassword: true,
      needsProductTour: true,
      isProtected: false,
      isActive: true
    })

    writeAuditLog({
      action: 'platform_admin_created',
      performedBy: req.user._id,
      targetEntity: email,
      department: req.user.department,
      ipAddress: req.ip,
      detail: `Provisioned SuperAdmin "${name}" <${email}>`,
      metadata: { adminUserId: String(user._id) }
    })

    return sendSuccess(res, {
      admin: {
        _id: user._id,
        name: user.name,
        email: user.email,
        tempPassword
      }
    }, 201)
  } catch (err) {
    next(err)
  }
})

// POST /api/platform/admins/:id/reset-password
router.post('/admins/:id/reset-password', async (req, res, next) => {
  try {
    const role = await Role.findOne({ name: 'SuperAdmin' }).lean()
    if (!role) return sendError(res, 500, 'SuperAdmin role is missing')

    const user = await User.findOne({ _id: req.params.id, role: role._id })
      .setOptions({ skipOrgScope: true })
    if (!user) return sendError(res, 404, 'Platform admin not found')

    const tempPassword = generatePassword()
    user.password = tempPassword
    user.mustChangePassword = true
    user.tokenVersion = (user.tokenVersion || 0) + 1
    await user.save()

    writeAuditLog({
      action: 'platform_admin_password_reset',
      performedBy: req.user._id,
      targetEntity: user.email,
      department: req.user.department,
      ipAddress: req.ip,
      detail: `Reset password for SuperAdmin <${user.email}>`,
      metadata: { adminUserId: String(user._id) }
    })

    return sendSuccess(res, {
      admin: { _id: user._id, email: user.email, tempPassword }
    })
  } catch (err) {
    next(err)
  }
})

// POST /api/platform/admins/:id/deactivate|activate
// Separate paths — newer path-to-regexp rejects `:action(a|b)` regex groups.
const setAdminActive = (activate) => async (req, res, next) => {
  try {
    const role = await Role.findOne({ name: 'SuperAdmin' }).lean()
    if (!role) return sendError(res, 500, 'SuperAdmin role is missing')

    const user = await User.findOne({ _id: req.params.id, role: role._id })
      .setOptions({ skipOrgScope: true })
    if (!user) return sendError(res, 404, 'Platform admin not found')

    if (String(user._id) === String(req.user._id)) {
      return sendError(res, 400, 'You cannot deactivate your own account')
    }
    if (user.isProtected && !activate) {
      return sendError(res, 400, 'The seeded platform admin cannot be deactivated')
    }

    if (!activate) {
      const activeCount = await User.countDocuments({ role: role._id, isActive: true })
        .setOptions({ skipOrgScope: true })
      if (activeCount <= 1) {
        return sendError(res, 400, 'Cannot deactivate the last active platform admin')
      }
    }

    user.isActive = activate
    if (!activate) user.tokenVersion = (user.tokenVersion || 0) + 1
    await user.save()

    writeAuditLog({
      action: activate ? 'platform_admin_activated' : 'platform_admin_deactivated',
      performedBy: req.user._id,
      targetEntity: user.email,
      department: req.user.department,
      ipAddress: req.ip,
      detail: `${activate ? 'Activated' : 'Deactivated'} SuperAdmin <${user.email}>`,
      metadata: { adminUserId: String(user._id) }
    })

    return sendSuccess(res, {
      admin: {
        _id: user._id,
        email: user.email,
        isActive: user.isActive
      }
    })
  } catch (err) {
    next(err)
  }
}

router.post('/admins/:id/deactivate', setAdminActive(false))
router.post('/admins/:id/activate', setAdminActive(true))

// GET /api/platform/health — system status for the SuperAdmin Health page
router.get('/health', async (req, res, next) => {
  try {
    const postgresHealth = await require('../database/operations').health()
    const dbOk = postgresHealth.ok

    const freshCounts = organizationSchemas() ? await management.organizationCounts() : null
    const [totalOrgs, activeOrgs, suspendedOrgs] = freshCounts ? [freshCounts.total,freshCounts.active,freshCounts.suspended] : await Promise.all([
      Organization.countDocuments({ isDefault: { $ne: true } }),
      Organization.countDocuments({ isDefault: { $ne: true }, status: 'active' }),
      Organization.countDocuments({ isDefault: { $ne: true }, status: 'suspended' })
    ])

    return sendSuccess(res, {
      overall: dbOk ? 'healthy' : 'degraded',
      api: {
        status: 'ok',
        service: 'netflow-server',
        env: process.env.NODE_ENV || 'development',
        uptimeSeconds: Math.floor(process.uptime()),
        timestamp: new Date().toISOString()
      },
      database: {
        status: dbOk ? 'ok' : 'degraded',
        readyState: postgresHealth.readyState,
        name: postgresHealth.name,
        host: postgresHealth.host
      },
      organizations: {
        total: totalOrgs,
        active: activeOrgs,
        suspended: suspendedOrgs
      }
    })
  } catch (err) {
    next(err)
  }
})

// GET /api/platform/dms-storage — live bytes in DMS (API key org).
router.get('/dms-storage', async (req, res, next) => {
  try {
    if (!dms.isEnabled()) {
      return sendSuccess(res, {
        enabled: false,
        source: null,
        usedBytes: 0,
        usedMb: 0,
        limitBytes: null,
        limitMb: null,
        documentCount: 0,
        organizationId: null,
        message: 'DMS is not enabled'
      })
    }

    const usage = await dms.getStorageUsage({ user: req.user })
    return sendSuccess(res, usage || {
      enabled: true,
      source: null,
      usedBytes: 0,
      usedMb: 0,
      limitBytes: null,
      limitMb: null,
      documentCount: 0,
      organizationId: null
    })
  } catch (err) {
    if (err instanceof dms.DmsError) {
      const code = err.status === 401 ? 'DMS_UNAUTHORIZED' : (err.code || 'DMS_ERROR')
      return sendError(res, err.message || 'DMS storage lookup failed', code, err.status || 502, {
        dms: err.body || null
      })
    }
    next(err)
  }
})

// GET /api/platform/dms-documents — paginated DMS document list with folder grouping
// Supports ?limit=&offset= query params. Groups docs by sourceRef type
// (tasks, forms, workflows, other) so the UI can render a simulated folder tree.
router.get('/dms-documents', async (req, res, next) => {
  try {
    if (!dms.isEnabled()) {
      return sendSuccess(res, {
        enabled: false,
        documents: [],
        total: 0,
        groups: { tasks: 0, forms: 0, workflows: 0, other: 0 },
        message: 'DMS is not enabled'
      })
    }

    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200)
    const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0)

    const result = await dms.listDocuments({ user: req.user, limit, offset })
    const docs = result?.documents || []
    const total = result?.total ?? null

    // Build folder groups based on sourceRef metadata
    const groups = { tasks: 0, forms: 0, workflows: 0, other: 0 }
    for (const doc of docs) {
      const ref = doc.sourceRef || doc.externalRef || {}
      if (ref.taskId) groups.tasks += 1
      else if (ref.formResponseId) groups.forms += 1
      else if (ref.workflowId) groups.workflows += 1
      else groups.other += 1
    }

    return sendSuccess(res, { enabled: true, documents: docs, total, groups })
  } catch (err) {
    if (err instanceof dms.DmsError) {
      const code = err.status === 401 ? 'DMS_UNAUTHORIZED' : (err.code || 'DMS_ERROR')
      return sendError(res, err.message || 'DMS document listing failed', code, err.status || 502, { dms: err.body || null })
    }
    next(err)
  }
})

module.exports = router
