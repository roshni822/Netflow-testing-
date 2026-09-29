'use strict'
const Organization = require('../database/model')('Organization')
Organization.prototype.storageLimitMb = function () {
  const base = Number(this.limits?.maxStorageMb || 0)
  if (base <= 0) return 0
  const ext = this.storageExtension
  const live = ext?.extraMb > 0 && (!ext.expiresAt || ext.expiresAt.getTime() > Date.now())
  return base + (live ? Number(ext.extraMb) : 0)
}

// The date this org stops being writable, whichever comes first, or null when
// it is perpetual.
Organization.prototype.expiryDate = function () {
  const dates = [this.licence?.validUntil, this.licence?.trialEndsAt].filter(Boolean)
  if (!dates.length) return null
  return new Date(Math.min(...dates.map((d) => new Date(d).getTime())))
}


module.exports = Organization
