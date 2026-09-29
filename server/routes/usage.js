// Licensing Phase 3 - routes/usage.js
// What the tenant is allowed to see about its own licence and consumption.
//   GET /api/usage/licence   any signed-in user — banner state, nothing else
//   GET /api/usage           Admin — the full meter set behind the usage card
//
// Split in two on purpose. The read-only banner has to render for an employee, so
// that endpoint must be open to everyone; plan names, limits and how close the
// company is to its contract ceiling are the administrator's business, so those
// are not.
//
// Both read through utils/licensing.usageSnapshot, the same function the platform
// panel uses, so a Super Admin and an Org Admin can never be shown two different
// numbers for the same tenant.

const express = require('express')

const Organization = require('../models/Organization')
const FormResponse = require('../models/FormResponse')
const { protect } = require('../middleware/auth')
const { roleGuard } = require('../middleware/roleGuard')
const { sendSuccess, sendError } = require('../utils/apiResponse')
const { usageSnapshot, licenceState } = require('../utils/licensing')
const { countsFor } = require('../utils/usage')
const { ensurePeriod } = require('../utils/usageMeter')
const { enforcementEnabled } = require('../middleware/quota')
const {
  readDmsStorageUsage,
  withStorageUsage,
  persistStorageUsage,
} = require('../services/storageUsage')

const router = express.Router()

router.use(protect)

// GET /api/usage/licence — is this workspace read-only, and when does it lapse?
router.get('/licence', async (req, res, next) => {
  try {
    if (!req.organization) return sendSuccess(res, { licence: null })
    const state = licenceState(req.organization)
    return sendSuccess(res, {
      licence: {
        ...state,
        // Suspension is an administrative action rather than a date passing; the
        // banner needs to say which one it is.
        suspended: req.organization.licence?.status === 'suspended'
          || req.organization.status === 'suspended',
        enforced: enforcementEnabled()
      }
    })
  } catch (err) {
    next(err)
  }
})

// GET /api/usage — every meter for the caller's own tenant.
router.get('/', roleGuard('Admin'), async (req, res, next) => {
  try {
    if (!req.orgId) return sendError(res, 'No workspace resolved for this account', 'NO_ORG', 400)

    // Roll a window that elapsed while the tenant was idle, so an admin opening
    // the page on the 1st sees 0 used rather than last month's total.
    await ensurePeriod(req.orgId)

    const org = await Organization.findById(req.orgId).lean()
    if (!org) return sendError(res, 'Workspace not found', 'ORG_NOT_FOUND', 404)

    const counts = await countsFor(org._id)
    const dmsStorage = await readDmsStorageUsage({ org, user: req.user })
    if (dmsStorage.configured && dmsStorage.available) {
      await persistStorageUsage(org, dmsStorage)
    }
    const effectiveOrg = dmsStorage.configured && dmsStorage.available
      ? withStorageUsage(org, dmsStorage)
      : org
    
    // Calculate last 7 days submissions trend
    const sevenDaysAgo = new Date()
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6)
    sevenDaysAgo.setHours(0,0,0,0)
    
    const trendAgg = await FormResponse.aggregate([
      { $match: { orgId: org._id, createdAt: { $gte: sevenDaysAgo } } },
      {
        $group: {
          _id: {
            year: { $year: '$createdAt' },
            month: { $month: '$createdAt' },
            day: { $dayOfMonth: '$createdAt' }
          },
          count: { $sum: 1 }
        }
      }
    ])
    
    const trend = []
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
    for (let i = 0; i < 7; i++) {
      const d = new Date(sevenDaysAgo)
      d.setDate(d.getDate() + i)
      const match = trendAgg.find(t => t._id.year === d.getFullYear() && t._id.month === d.getMonth() + 1 && t._id.day === d.getDate())
      trend.push({
        name: days[d.getDay()],
        submissions: match ? match.count : 0
      })
    }

    const usage = usageSnapshot(effectiveOrg, counts)
    usage.resources.storage = {
      ...usage.resources.storage,
      source: dmsStorage.configured ? dmsStorage.source : 'netflow',
      available: !dmsStorage.configured || dmsStorage.available,
    }

    return sendSuccess(res, {
      usage,
      trend: trend,
      enforced: enforcementEnabled()
    })
  } catch (err) {
    next(err)
  }
})

module.exports = router
