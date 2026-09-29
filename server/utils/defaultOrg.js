// Multi-tenancy - utils/defaultOrg.js
// Resolves (and caches) the default organization's id. Used to lazily stamp
// legacy users/records created before tenancy until every create path is
// org-aware (build-order step 5).

const Organization = require('../models/Organization')

let cachedId = null

const getDefaultOrgId = async () => {
  if (cachedId) return cachedId
  const org = await Organization.findOne({ isDefault: true }).select('_id').lean()
  cachedId = org ? org._id : null
  return cachedId
}

module.exports = { getDefaultOrgId }
