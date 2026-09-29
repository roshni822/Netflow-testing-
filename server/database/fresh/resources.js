'use strict'
const crypto = require('node:crypto')
const { query } = require('../postgres')
const { getPlacement, runWithPlacement } = require('../../tenancy/tenantContext')
const { resolvePlacement } = require('./routing')
const { organizationSchemas } = require('../layout')
const { sendError } = require('../../utils/apiResponse')
const definitions = {
  Form: { purpose: 'public_form', token: d => d.status === 'published' && d.public?.enabled && d.public.token },
  Workflow: { purpose: 'inbound_webhook', token: d => d.status === 'published' && d.inboundWebhook?.enabled && d.inboundWebhook.token },
  WorkflowExecution: { purpose: 'execution_status', token: d => d.statusToken }
}
const digest = token => crypto.createHash('sha256').update(token).digest('hex')
async function sync (client, name, document) {
  const definition = definitions[name]
  if (!organizationSchemas() || !definition) return
  const placement = getPlacement()
  if (!placement || String(document.orgId) !== placement.orgId) throw Object.assign(new Error('Resource scope required'), { code: 'DATABASE_SCOPE_REQUIRED' })
  await remove(client, name, document._id)
  const token = definition.token(document)
  if (token) await client.query(`INSERT INTO system.resource_routes(purpose,token_digest,account_scope,org_id,resource_id)
    VALUES($1,$2,'tenant',$3,$4)`, [definition.purpose, digest(token), placement.orgId, String(document._id)])
}
async function remove (client, name, id) {
  if (!organizationSchemas() || !definitions[name]) return
  await client.query('DELETE FROM system.resource_routes WHERE purpose=$1 AND org_id=$2 AND resource_id=$3', [definitions[name].purpose, getPlacement().orgId, String(id)])
}
function route (purpose, tokenOf) {
  return async (req, res, next) => {
    if (!organizationSchemas()) return next()
    try {
      const token = tokenOf(req)
      if (typeof token !== 'string' || token.length < 16 || token.length > 512) return sendError(res, 'Resource not found', 'NOT_FOUND', 404)
      const record = (await query(`SELECT org_id,resource_id FROM system.resource_routes
        WHERE purpose=$1 AND token_digest=$2 AND account_scope='tenant' AND (expires_at IS NULL OR expires_at>now())`, [purpose, digest(token)])).rows[0]
      if (!record) return sendError(res, 'Resource not found', 'NOT_FOUND', 404)
      const placement = await resolvePlacement(record.org_id)
      req.routedResourceId = record.resource_id
      return runWithPlacement(placement, next)
    } catch (error) {
      if (error.status) return sendError(res, 'Resource unavailable', 'NOT_FOUND', 404)
      next(error)
    }
  }
}
module.exports = { sync, remove, route, digest }
