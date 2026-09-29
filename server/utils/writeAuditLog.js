// M3 - Phase 2 - utils/writeAuditLog.js
// Fire-and-forget audit writer. NEVER throws — audit failure must not break
// the action being audited.

const AuditLog = require('../models/AuditLog')

const writeAuditLog = async ({
  action,
  performedBy,
  targetEntity,
  department,
  ipAddress,
  detail,
  metadata = {}
}) => {
  try {
    if (!performedBy || !action || !targetEntity) return null
    return await AuditLog.create({
      action,
      performedBy,
      targetEntity,
      department,
      ipAddress,
      detail,
      metadata
    })
  } catch (err) {
    console.error('writeAuditLog error:', err.message)
    return null
  }
}

module.exports = { writeAuditLog: (...args) => require('../database/context').trackBackground(writeAuditLog(...args)) }
