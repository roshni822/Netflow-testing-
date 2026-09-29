'use strict'
// Platform-only composite view. Ordinary tenant repositories never acquire this
// capability, including when an administrator manages a suspended organization.
const { transaction, query } = require('../postgres')
const { currentAccess } = require('../context')
const { sourceCatalog, q } = require('../catalog')
const { encode, decode } = require('../storage')
const { platformCatalog } = require('./manifest')
const { runWithOrgId } = require('../../tenancy/tenantContext')
const { renderTenantTemplate } = require('./setup')
const Organization = require('../../models/Organization')
const { isDeepStrictEqual } = require('node:util')
const loaded = new WeakMap()
const audited = new WeakSet()
const messages = { ORG_NOT_FOUND:'Organization not found.', ORG_CHANGED:'This organization changed while you were editing. Refresh and try again.',
  ORG_NOT_READY:'Organization setup or maintenance must finish before this action.', TENANT_SCHEMA_MISMATCH:'Organization storage needs an administrator review.',
  PLATFORM_ACCESS_REQUIRED:'Platform administrator access is required.', INVALID_MANAGEMENT_PATCH:'Some organization settings cannot be changed by this action.' }
const fail = (code, statusCode = 409) => Object.assign(new Error(messages[code] || 'Organization management could not complete.'), { code, statusCode })
const expected = renderTenantTemplate('tenant_manifest', '0'.repeat(24))
function requirePlatform () {
  if (currentAccess().system !== 'platform' || currentAccess().org) throw fail('PLATFORM_ACCESS_REQUIRED', 403)
}
async function placementRow (id) {
  requirePlatform()
  if (!/^[a-f0-9]{24}$/.test(String(id))) throw fail('ORG_NOT_FOUND', 404)
  const row = (await query(`SELECT o.*, m.checksum AS template_checksum FROM platform.organizations o
    LEFT JOIN system.schema_migrations m ON m.org_id=o.id AND m.schema_name=o.schema_name
    AND m.version=o.schema_version AND m.scope='tenant' WHERE o.id=$1 AND o.deleted_at IS NULL`, [id])).rows[0]
  if (!row) throw fail('ORG_NOT_FOUND', 404)
  if (row.provisioning_status !== 'ready') throw fail('ORG_NOT_READY', 409)
  if (!/^tenant_[a-z0-9]+(_[a-z0-9]+)*$/.test(row.schema_name) || Buffer.byteLength(row.schema_name)>63 ||
      row.schema_version !== expected.version || row.template_checksum !== expected.checksum) throw fail('TENANT_SCHEMA_MISMATCH', 503)
  return row
}
function specification (row) {
  const spec = { ...platformCatalog(sourceCatalog()).Organization, tenantOrganization: true }
  spec.children = sourceCatalog().Organization.children.map(c => ({ ...c, schema: row.schema_name, owner: spec }))
  return spec
}
async function load (id) {
  const row = await placementRow(id)
  const spec = specification(row)
  const value = await runWithOrgId(id, () => transaction(async client => (await decode(client, spec, [row]))[0]))
  const org = new Organization(value, { newRecord: false })
  loaded.set(org, { row, spec, original: await encode(spec, org.toObject(), async () => true) })
  return org
}
function jsonRow (spec, row) {
  const value = { ...row }
  for (const field of spec.fields) if (field.type === 'jsonb' && typeof value[field.column] === 'string') value[field.column] = JSON.parse(value[field.column])
  delete value.legacy_extra; delete value.legacy_refs; delete value.source_missing; delete value.api_version
  return value
}
const changes = (before, after) => Object.fromEntries(Object.entries(after).filter(([key, value]) => !isDeepStrictEqual(before[key], value)))
async function save (org, req, action) {
  requirePlatform()
  const base = loaded.get(org)
  if (!base) throw fail('PLATFORM_ORGANIZATION_NOT_LOADED', 500)
  await org.validate()
  const encoded = await encode(base.spec, org.toObject(), async () => true)
  const patch = changes(jsonRow(base.spec, base.original.row), jsonRow(base.spec, encoded.row))
  delete patch.updated_at
  const children = {}
  for (const child of base.spec.children) {
    const before = base.original.children.filter(e => e.spec===child).map(e => jsonRow(child,e.row))
    const after = encoded.children.filter(e => e.spec===child).map(e => jsonRow(child,e.row))
    if (isDeepStrictEqual(before, after)) continue
    if (!['organization_usage','organization_integrations','organization_department_integrations'].includes(child.table)) throw fail('PLATFORM_CHILD_PROTECTED',403)
    children[child.table] = child.one ? changes(before[0] || {}, after[0] || {}) : after
  }
  try {
    await query('SELECT system.manage_organization($1,$2,$3,$4::jsonb,$5::jsonb,$6)',
      [String(req.user._id), String(org._id), base.row.row_version, JSON.stringify(patch), JSON.stringify(children), action])
    audited.add(org)
  } catch (error) {
    if (['ORG_NOT_READY','ORG_CHANGED','INVALID_MANAGEMENT_PATCH'].includes(error.message)) throw fail(error.message)
    throw error
  }
}
async function summary (id) {
  const row = await placementRow(id)
  return require('./provisioning').organizationSummary(row)
}
async function overview () {
  requirePlatform()
  const all = await require('./provisioning').listOrganizations()
  const operational = all.filter(o => o.status==='active' && o.provisioningStatus==='ready' && !o.licensing?.licence?.readOnly)
  const definitions = [['forms','Forms',o=>o.usage.formsTotal>0],['workflows','Workflows',o=>o.usage.workflowsTotal>0],
    ['builders','Builder access',o=>o.usage.builders>0],['dms','DMS',o=>o.integrations?.dmsEnabled || o.integrations?.departmentDms?.some(d=>d.enabled!==false)],
    ['s3','Dedicated S3',o=>o.integrations?.s3?.enabled],['externalUsers','External users',o=>o.features?.externalUsers]]
  return { metrics: { totalOrganizations:all.length, activeOrganizations:operational.length,
    suspendedOrganizations:all.filter(o=>o.status==='suspended').length, activeUsers:operational.reduce((n,o)=>n+o.usage.activeUsers,0) },
    adoptionDenominator:operational.length, adoption:definitions.map(([key,label,test])=>{
      const organizations=operational.filter(test).length
      return {key,label,organizations,percentage:operational.length ? Math.round(organizations/operational.length*100) : 0}
    }) }
}
async function organizationCounts () {
  requirePlatform()
  return (await query(`SELECT count(*)::int AS total, count(*) FILTER(WHERE status='active')::int AS active,
    count(*) FILTER(WHERE status='suspended')::int AS suspended FROM platform.organizations WHERE deleted_at IS NULL`)).rows[0]
}
module.exports = { load, save, summary, overview, organizationCounts, placementRow, requirePlatform, wasAudited: org=>audited.has(org), q }
