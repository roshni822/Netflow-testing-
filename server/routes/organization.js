// Shell 2 (Org Admin) - routes/organization.js
// What a tenant may see and change about itself.
//   GET /api/organization          Admin — profile, policy and plan in one read
//   PUT /api/organization          Admin — display name and billing contact only
//   GET /api/organization/dms-storage  Admin — live DMS storage usage for this org
//
// Everything that decides what the tenant is allowed to do — subdomain, plan,
// limits, licence dates, email-domain policy, feature flags — stays with the
// Platform Super Admin. It is returned here read-only so the admin can see the
// rules they are working inside without having to ask support what they are.

const express = require('express')

const Organization = require('../models/Organization')
const { protect } = require('../middleware/auth')
const { roleGuard } = require('../middleware/roleGuard')
const { sendSuccess, sendError } = require('../utils/apiResponse')
const { writeAuditLog } = require('../utils/writeAuditLog')
const { licenceState } = require('../utils/licensing')
const { listFor } = require('../utils/departments')
const { limitsForPlan } = require('../config/plans')
const { policyFor, settingsFor, validateSettings } = require('../utils/pdfAutoFillPolicy')
const dms = require('../services/dmsClient')
const { fetchEndpoint } = require('../services/dmsEndpoint')

const router = express.Router()

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const MAX_NAME_LENGTH = 80

router.use(protect, roleGuard('Admin'))

const publicShape = (org) => {
  const policy = policyFor(org)
  return {
    _id: org._id,
    name: org.name,
    subdomain: org.subdomain,
    status: org.status,
    billingEmail: org.billingEmail || '',
    billingAnchorDay: org.billingAnchorDay || 1,
    allowedDomains: org.allowedDomains || [],
    features: {
      externalUsers: Boolean(org.features?.externalUsers)
    },
    pdfAutoFill: {
      entitled: policy.entitled,
      operational: policy.operational,
      effective: policy.enabled,
      enabled: policy.configured,
      languageMode: policy.languageMode,
      audiences: policy.audiences
    },
    departments: listFor(org),
    licence: licenceState(org),
    createdAt: org.createdAt
  }
}

const loadOrg = async (req, res) => {
  if (!req.orgId) {
    sendError(res, 'No workspace resolved for this account', 'NO_ORG', 400)
    return null
  }
  const org = await Organization.findById(req.orgId)
  if (!org) {
    sendError(res, 'Workspace not found', 'ORG_NOT_FOUND', 404)
    return null
  }
  return org
}

// POST /api/organization/dms-login
router.post('/dms-login', async (req, res, next) => {
  try {
    const org = await loadOrg(req, res)
    if (!org) return undefined

    const { email, password } = req.body
    if (!email || !password) {
      return sendError(res, 'Email and password required', 'BAD_REQUEST', 400)
    }

    const rootUrl = dms.resolveBaseUrl(org)
    if (!rootUrl) {
      return sendError(res, 'DMS is not configured', 'DMS_NOT_CONFIGURED', 400)
    }

    const base = rootUrl.replace(/\/api\/?$/, '')
    const loginUrl = org.integrations?.dmsBaseUrl ? `${rootUrl}/auth/login` : `${base}/api/auth/login`

    const response = await (org.integrations?.dmsBaseUrl ? fetchEndpoint : fetch)(loginUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
      signal: AbortSignal.timeout(10000),
      redirect: 'error'
    })

    let data;
    try {
      data = await response.json()
    } catch (parseErr) {
      return sendError(res, `DMS returned an invalid response (Status ${response.status}). The service might be down.`, 'DMS_INVALID_RESPONSE', response.status || 502)
    }

    if (!response.ok) {
      return sendError(res, data.message || 'DMS Login Failed', 'DMS_LOGIN_FAILED', response.status)
    }

    if (!data.token) {
      return sendError(res, 'No token received from DMS', 'DMS_NO_TOKEN', 500)
    }

    org.integrations.dmsJwt = data.token
    await org.save()

    writeAuditLog(req.user, 'update', 'Organization', org._id, 'DMS login successful')
    return sendSuccess(res, { message: 'DMS Login successful' })
  } catch (err) {
    next(err)
  }
})

// GET /api/organization
router.get('/', async (req, res, next) => {
  try {
    const org = await loadOrg(req, res)
    if (!org) return undefined
    return sendSuccess(res, { organization: publicShape(org) })
  } catch (err) {
    next(err)
  }
})

// PUT /api/organization
router.put('/', async (req, res, next) => {
  try {
    const org = await loadOrg(req, res)
    if (!org) return undefined

    const { name, billingEmail, pdfAutoFill } = req.body || {}
    const changes = []

    if (name !== undefined) {
      const clean = String(name).trim()
      if (!clean) return sendError(res, 'Workspace name is required', 'MISSING_NAME', 400)
      if (clean.length > MAX_NAME_LENGTH) {
        return sendError(res, `Workspace name must be ${MAX_NAME_LENGTH} characters or fewer`, 'NAME_TOO_LONG', 400)
      }
      if (clean !== org.name) {
        changes.push(`name "${org.name}" → "${clean}"`)
        org.name = clean
      }
    }

    if (billingEmail !== undefined) {
      const clean = String(billingEmail).trim().toLowerCase()
      if (clean && !EMAIL_RE.test(clean)) {
        return sendError(res, 'Enter a valid billing email address', 'INVALID_BILLING_EMAIL', 400)
      }
      if (clean !== (org.billingEmail || '')) {
        changes.push(`billing email "${org.billingEmail || 'none'}" → "${clean || 'none'}"`)
        org.billingEmail = clean
      }
    }

    if (pdfAutoFill !== undefined) {
      const parsed = validateSettings(pdfAutoFill)
      if (parsed.error) {
        return sendError(res, parsed.error, 'INVALID_PDF_AUTO_FILL_SETTINGS', 400)
      }
      const before = settingsFor(org)
      if (JSON.stringify(before) !== JSON.stringify(parsed.value)) {
        org.pdfAutoFill.enabled = parsed.value.enabled
        org.pdfAutoFill.languageMode = parsed.value.languageMode
        org.pdfAutoFill.audiences.authenticated = parsed.value.audiences.authenticated
        org.pdfAutoFill.audiences.public = parsed.value.audiences.public
        changes.push(
          'PDF auto-fill ' + (parsed.value.enabled ? 'enabled' : 'disabled') +
          ', language=' + parsed.value.languageMode +
          ', authenticated=' + parsed.value.audiences.authenticated +
          ', public=' + parsed.value.audiences.public
        )
      }
    }

    if (!changes.length) return sendSuccess(res, { organization: publicShape(org) })

    await org.save()

    writeAuditLog({
      action: 'org_settings_updated',
      performedBy: req.user._id,
      targetEntity: `Organization: ${org.name}`,
      department: req.user.department,
      ipAddress: req.ip,
      detail: `${req.user.name} updated ${changes.join(', ')}`,
      metadata: { changes }
    })

    return sendSuccess(res, { organization: publicShape(org) })
  } catch (err) {
    next(err)
  }
})

// GET /api/organization/dms-storage
// Returns live DMS storage usage for this org. Uses the org's own dmsApiKey
// when configured; falls back to the global DMS_API_KEY env var.
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
        message: 'DMS is not enabled on this platform'
      })
    }

    const org = req.organization
    const usage = await dms.getStorageUsage({ org, user: req.user })
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
      return sendError(res, err.message || 'DMS storage lookup failed', code, err.status || 502, { dms: err.body || null })
    }
    next(err)
  }
})

// GET /api/organization/dms-status
// Read-only DMS connection status for Org Admins.
// Includes: platform/org enabled flags, live connectivity ping, storage usage,
// and the expected DMS folder structure for this org's departments.
// Config (API key, slug, enabled flag) is set by the Platform Super Admin only.
router.get('/dms-status', async (req, res, next) => {
  try {
    const org = await loadOrg(req, res)
    if (!org) return undefined

    const platformDmsEnabled = dms.isEnabled()
    const orgDmsEnabled = Boolean(org.integrations?.dmsEnabled)
    const effectiveDmsEnabled = platformDmsEnabled || orgDmsEnabled

    // DMS connection ping (only when at least one enabled flag is on)
    let connected = false
    if (effectiveDmsEnabled) {
      connected = await dms.ping({ org }).catch(() => false)
    }

    // Storage usage (best-effort, skip when not connected)
    let storage = null
    if (connected) {
      try {
        storage = await dms.getStorageUsage({ org, user: req.user })
      } catch {
        storage = null
      }
    }

    // The expected DMS folder structure based on this org's departments.
    // e.g. ["acme/hr", "acme/finance", "acme/admin"]
    const orgSlug = org.integrations?.dmsOrgSlug || org.subdomain || ''
    const departments = listFor(org)
    const expectedFolders = orgSlug
      ? departments.map((d) => `${orgSlug}/${d.toLowerCase().replace(/[^a-z0-9-]/g, '-')}`)
      : []

    // Per-department DMS status — shows which departments have their own DMS key
    // vs. using the shared org/platform key.
    const departmentDmsStatus = departments.map((dept) => {
      const deptCfg = dms.resolveDeptConfig(org, dept)
      const deptFolder = deptCfg?.folder || (orgSlug
        ? `${orgSlug}/${dept.toLowerCase().replace(/[^a-z0-9-]/g, '-')}`
        : null)
      return {
        department: dept,
        enabled: deptCfg ? deptCfg.enabled !== false : true,
        hasOwnKey: Boolean(deptCfg?.apiKey?.trim()),
        hasOwnBaseUrl: Boolean(deptCfg?.baseUrl?.trim()),
        folder: deptFolder
      }
    })

    const planLimits = limitsForPlan(org.plan)
    const fallbackLimitMb = planLimits?.maxStorageMb || null

    return sendSuccess(res, {
      platformDmsEnabled,
      orgDmsEnabled,
      effectiveDmsEnabled,
      connected,
      orgSlug,
      expectedFolders,
      departmentDmsStatus,
      storage: storage
        ? {
            usedBytes: storage.usedBytes || 0,
            usedMb: storage.usedMb || 0,
            documentCount: storage.documentCount || 0,
            limitMb: storage.limitMb || fallbackLimitMb
          }
        : null
    })
  } catch (err) {
    if (err instanceof dms.DmsError) {
      return sendError(res, err.message || 'DMS status check failed', err.code || 'DMS_ERROR', err.status || 502, { dms: err.body || null })
    }
    next(err)
  }
})

module.exports = router
