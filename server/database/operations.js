'use strict'
const { catalog, tableName } = require('./catalog')
const { transaction } = require('./postgres')
const { decode } = require('./storage')
const tenantModels = () => Object.values(catalog()).filter(spec => spec.fields.some(field => field.path === 'orgId')).map(spec => spec.model)
async function exportTenantModel (name, orgId) {
  return transaction(async client => {
    const spec = catalog()[name]
    if (!spec.fields.some(f => f.path === 'orgId')) throw new Error('Tenant model required')
    const { rows } = await client.query(`SELECT * FROM ${tableName(spec)} WHERE org_id=$1 OR legacy_refs->>'orgId'=$1 ORDER BY id`, [String(orgId)])
    return decode(client, spec, rows, { includeExtra: true })
  }, { readOnly: true })
}
async function health () {
  try {
    await transaction(client => client.query('SELECT 1'), { readOnly: true })
    return { ok: true, readyState: 'connected', name: 'PostgreSQL', host: null, provider: 'postgres' }
  } catch { return { ok: false, readyState: 'disconnected', name: 'PostgreSQL', host: null, provider: 'postgres' } }
}
async function exportTenantOutbox (orgId) {
  return transaction(async client => (await client.query('SELECT * FROM netflow_private.outbox WHERE tenant_id=$1 ORDER BY id', [String(orgId)])).rows, { readOnly: true })
}
async function deleteTenant (orgId) {
  return transaction(async client => {
    // Use the same catalog as backup/import so newly mapped collections cannot
    // silently escape the tenant lifecycle. Historical cross-tenant references
    // are detached by the repositories; owned child rows cascade.
    await client.query('SELECT id FROM netflow.organizations WHERE id=$1 FOR UPDATE', [String(orgId)])
    await client.query("SELECT set_config('netflow.system', 'platform', true), set_config('netflow.audit_delete_org', $1, true)", [String(orgId)])
    let deleted = (await catalog().AuditLog.model.deleteMany({ orgId })).deletedCount || 0
    for (const model of tenantModels().filter(model => model.modelName !== 'AuditLog')) {
      const result = await model.deleteMany({ orgId }).setOptions({ skipOrgScope: true })
      deleted += result.deletedCount || 0
    }
    await client.query('DELETE FROM netflow_private.outbox WHERE tenant_id=$1', [String(orgId)])
    await catalog().Organization.model.deleteOne({ _id: orgId })
    return deleted
  })
}
module.exports = { exportTenantModel, exportTenantOutbox, tenantModels, deleteTenant, health }
