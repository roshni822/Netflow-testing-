'use strict'
const { query } = require('../postgres')
const { issuePlacement, runWithPlacement, runWithOrgId, getPlacement } = require('../../tenancy/tenantContext')
const { withSystemAccess, transactions } = require('../context')
const { renderTenantTemplate } = require('./setup')
const fail = (code, message, status = 403) => Object.assign(new Error(message), { code, status, statusCode: status })
// Only the immutable release fingerprint is cached, never an organization's
// placement/status. Avoid reading and rendering a SQL file on every query.
const { checksum: supportedChecksum, version: supportedVersion } = renderTenantTemplate('tenant_manifest', '0'.repeat(24))

function checkPlacement (row) {
  if (!row || row.deleted_at) throw fail('ORG_NOT_FOUND', 'Workspace is unavailable.')
  if (row.status !== 'active') throw fail('ORG_SUSPENDED', 'This workspace is suspended. Contact your administrator.')
  if (row.provisioning_status !== 'ready') throw fail('ORG_NOT_READY', 'Workspace setup is not complete.', 503)
  if (!/^tenant_[a-z0-9]+(_[a-z0-9]+)*$/.test(row.schema_name) || Buffer.byteLength(row.schema_name) > 63 ||
      row.schema_version !== supportedVersion || row.template_checksum !== supportedChecksum) {
    throw fail('TENANT_SCHEMA_MISMATCH', 'Workspace storage requires an upgrade.', 503)
  }
  return row
}
const placementSQL = `SELECT o.*, m.checksum AS template_checksum FROM platform.organizations o
  LEFT JOIN system.schema_migrations m ON m.schema_name=o.schema_name AND m.org_id=o.id
    AND m.scope='tenant' AND m.version=o.schema_version WHERE o.id=$1`

async function resolvePlacement (orgId) {
  if (!/^[a-f0-9]{24}$/.test(String(orgId))) throw fail('ACCOUNT_SCOPE_MISMATCH', 'Invalid account context.', 401)
  const row = checkPlacement((await query(placementSQL, [String(orgId)])).rows[0])
  const placement=issuePlacement({orgId:row.id,schemaName:row.schema_name,version:row.schema_version})
  const preset=await runWithPlacement(placement,async()=>{
    const p=(await query('SELECT label,trial_days,limits,features,is_custom FROM platform.plans WHERE key=$1',[row.plan])).rows[0]
    if(!p) throw fail('PLAN_CATALOGUE_MISSING','Workspace plan is unavailable.',503)
    return {label:p.label,trialDays:p.trial_days,limits:p.is_custom ? null : p.limits,features:{pdfAutoFill:!p.is_custom && p.features?.pdfAutoFill!==false}}
  })
  return issuePlacement({...placement,planKey:row.plan,planPreset:preset})
}
async function checkTransactionPlacement (client, placement) {
  // Lifecycle/backup operations take the exclusive form before changing state.
  await client.query("SELECT pg_advisory_xact_lock_shared(hashtextextended($1,0))", ['tenant-operation:' + placement.orgId])
  const row = checkPlacement((await client.query(placementSQL, [placement.orgId])).rows[0])
  if (row.schema_name !== placement.schemaName || row.schema_version !== placement.version) throw fail('TENANT_SCHEMA_MISMATCH', 'Workspace storage changed.', 503)
}
async function withAccount (identity, fn) {
  // Resolve lazy repository thenables before leaving the ambient scope.
  if (identity.account_scope === 'platform' && !identity.org_id) return runWithOrgId(null, () => withSystemAccess('authentication', async () => await fn()))
  if (identity.account_scope !== 'tenant' || !identity.org_id) throw fail('ACCOUNT_SCOPE_MISMATCH', 'Invalid account context.', 401)
  const placement = await resolvePlacement(identity.org_id)
  return runWithPlacement(placement, async () => await fn())
}
async function withClaims (claims, fn) {
  // Resolve the signed identity through the directory before reading credentials.
  // Never trust a JWT organization or a caller-provided workspace alone.
  const lookup = async () => {
    const identity = (await query('SELECT user_id,account_scope,org_id,state FROM system.user_directory WHERE user_id=$1 AND state<>\'deleted\'', [claims.id])).rows[0]
    if (!identity || identity.account_scope !== claims.scope || (identity.org_id || null) !== (claims.org || null)) throw fail('ACCOUNT_SCOPE_MISMATCH', 'Invalid account context.', 401)
    if (identity.state !== 'active') throw fail('ACCOUNT_DEACTIVATED', 'Account is deactivated.', 401)
    return withAccount(identity, fn)
  }
  // Re-entrant auth helpers may run inside the already resolved request scope.
  if (getPlacement()) return lookup()
  if (transactions.getStore()) {
    const access = require('../context').currentAccess()
    if (claims.scope === 'platform' && !access.org && access.system === 'authentication') return lookup()
    throw fail('DATABASE_SCOPE_SWITCH', 'Resolve account before starting a transaction.')
  }
  return runWithOrgId(null, () => withSystemAccess('authentication', lookup))
}
module.exports = { resolvePlacement, withAccount, withClaims, checkTransactionPlacement }
