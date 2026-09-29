'use strict'
const crypto = require('node:crypto')
const { query } = require('../database/postgres')
const { withSystemAccess } = require('../database/context')
const { hasPermission } = require('./roleCapabilities')

const manage = user => hasPermission(user, 'documents:manage')
const fileScope = fn => require('../tenancy/tenantContext').getPlacement() ? fn() : withSystemAccess('signed-file', fn)
const grantsTable = orgId => {
  if (!require('../database/layout').organizationSchemas()) return 'netflow_private.file_grants'
  const placement = require('../tenancy/tenantContext').getPlacement()
  if (!placement || placement.orgId !== String(orgId)) throw Object.assign(new Error('Document scope required'), { code: 'DATABASE_SCOPE_REQUIRED' })
  return require('../database/catalog').q(placement.schemaName) + '.file_grants'
}
const canonical = value => {
  if (!value || typeof value !== 'object') return null
  if (value.dmsDocId) return 'dms:' + String(value.dmsDocId)
  if (value.s3Key) return 's3:' + String(value.s3Key)
  const url = String(value.url || value.path || '')
  const match = url.match(/\/api\/files\/([a-f\d]{24}\/[A-Za-z\d._-]+)(?:\?|$)/i)
  return match?.[1] || null
}
function references (object, output = new Map(), depth = 0) {
  if (!object || typeof object !== 'object' || depth > 40) return output
  const key = canonical(object)
  if (key) output.set(key, object)
  for (const value of Object.values(object)) if (value && typeof value === 'object') references(value, output, depth + 1)
  return output
}
async function grant (path, orgId, ownerId = null) {
  return fileScope(() => query(`INSERT INTO ${grantsTable(orgId)}(path,org_id,owner_id) VALUES($1,$2,$3) ON CONFLICT(path) DO NOTHING`, [path, String(orgId), ownerId ? String(ownerId) : null]))
}
async function version (path, orgId) {
  const result = await fileScope(() => query(`SELECT version FROM ${grantsTable(orgId)} WHERE path=$1 AND org_id=$2`, [path, String(orgId)]))
  return String(result.rows[0]?.version || '1')
}
const mac = value => crypto.createHmac('sha256', process.env.FILE_URL_SECRET || process.env.JWT_SECRET).update(value).digest('hex')
async function issue (path, orgId, purpose = 'view') {
  const expires = Math.floor(Date.now() / 1000) + (purpose === 'upload' ? 3600 : 300)
  const revision = await version(path, orgId)
  const payload = `${path}|${orgId}|${purpose}|${expires}|${revision}`
  return `${expires}.${revision}.${mac(payload)}`
}
async function verify (path, orgId, token, purpose = 'view') {
  const parts = String(token || '').split('.')
  if (parts.length !== 3) return false
  const [expiry, revision, signature] = parts
  if (!/^\d+$/.test(expiry || '') || Number(expiry) <= Date.now() / 1000 || !/^\d+$/.test(revision || '') || !/^[a-f\d]{64}$/.test(signature || '')) return false
  const expected = mac(`${path}|${orgId}|${purpose}|${expiry}|${revision}`)
  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return false
  return revision === await version(path, orgId)
}
async function revoke (path, orgId) {
  await grant(path, orgId)
  await query(`UPDATE ${grantsTable(orgId)} SET version=version+1 WHERE path=$1 AND org_id=$2`, [path, String(orgId)])
}
async function canRead (path, user, orgId) {
  if (!user || String(user.orgId) !== String(orgId)) return false
  if (path.startsWith('s3:') ? !path.startsWith('s3:' + orgId + '/') : !path.startsWith('dms:') && !path.startsWith(orgId + '/')) return false
  if (manage(user)) return true
  const record = await query(`SELECT owner_id FROM ${grantsTable(orgId)} WHERE path=$1 AND org_id=$2`, [path, String(orgId)])
  if (record.rows[0]?.owner_id === String(user._id)) return true
  // Only records this user can act on or submitted may confer attachment access.
  const Task = require('../models/Task')
  const Response = require('../models/FormResponse')
  const tasks = await Task.find({ orgId, $or: [{ assignedTo: user._id }, { submittedBy: user._id }, { parallelApprovers: user._id }] }).lean()
  for (const task of tasks) {
    if (references(task).has(path)) return true
    if (task.formResponseId) {
      const response = await Response.findOne({ _id: task.formResponseId, orgId }).lean()
      if (references(response).has(path)) return true
    }
    if (task.workflowExecutionId) {
      const execution = await require('../models/WorkflowExecution').findOne({ _id: task.workflowExecutionId, orgId }).lean()
      if (references(execution?.variables).has(path)) return true
      const related = await Task.find({ orgId, workflowExecutionId: task.workflowExecutionId }).lean()
      if (related.some(record => references(record).has(path))) return true
    }
  }
  const responses = await Response.find({ orgId, submittedBy: user._id }).lean()
  return responses.some(response => references(response).has(path))
}
async function validateInputs (object, user, orgId) {
  for (const [path, file] of references(object)) {
    if (user && await canRead(path, user, orgId)) continue
    if (await verify(path, orgId, file.uploadToken, 'upload')) continue
    throw Object.assign(new Error('You do not have access to an attached document.'), { statusCode: 403, code: 'DOCUMENT_FORBIDDEN' })
  }
}
module.exports = { manage, canonical, references, grant, issue, verify, revoke, canRead, validateInputs }
