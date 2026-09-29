'use strict'
const crypto = require('node:crypto')
const { transaction, query } = require('../postgres')
const { sourceCatalog, q } = require('../catalog')
const { encode, decode } = require('../storage')
const { platformCatalog, tenantSchemaName } = require('./manifest')
const { runWithOrgId } = require('../../tenancy/tenantContext')
const { DEFAULT_ROLES } = require('../../utils/roleCapabilities')
const { generatePassword } = require('../../utils/password')
const { usageSnapshot, freshPeriod } = require('../../utils/licensing')
const User = require('../../models/User')
const Role = require('../../models/Role')
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i
const fail = (code, status=409) => Object.assign(new Error(code), { code, status, statusCode:status })
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value==='object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key,canonical(value[key])])) : value

function fingerprint (body) {
  const secret = process.env.PROVISIONING_FINGERPRINT_KEY
  if (!secret || secret.length<32) throw fail('PROVISIONING_KEY_REQUIRED',503)
  // Verification receipts expire independently of the submitted configuration.
  // All business inputs, including integration credentials, remain covered.
  const { integrationVerifications, ...intent } = body
  for (const key of ['name','adminName']) if (typeof intent[key]==='string') intent[key]=intent[key].trim()
  for (const key of ['subdomain','adminEmail']) if (typeof intent[key]==='string') intent[key]=intent[key].trim().toLowerCase()
  return crypto.createHmac('sha256',secret).update('netflow:organization:v1\n').update(JSON.stringify(canonical(intent))).digest('hex')
}

function rowJSON (spec, row) {
  const value={...row}
  // The ordinary pg writer serializes JSON columns as strings; recordset import
  // takes real JSON values. Never copy compatibility extras/private payloads.
  delete value.legacy_extra; delete value.legacy_refs
  for (const field of spec.fields) if (field.type==='jsonb' && typeof value[field.column]==='string') value[field.column]=JSON.parse(value[field.column])
  return value
}
async function prepare (org, admin) {
  org.createdAt ||= new Date(); org.updatedAt=org.createdAt
  await org.validate()
  const source=sourceCatalog()
  const encoded=await encode(source.Organization,org.toObject(),async () => true)
  const organization=rowJSON(source.Organization,encoded.row)
  delete organization.is_default; delete organization.departments_mode
  const roles=[]
  for (const preset of DEFAULT_ROLES) {
    const role=new Role({...preset,orgId:String(org._id),createdAt:org.createdAt,updatedAt:org.createdAt})
    await role.validate(); roles.push(role)
  }
  const profile=new User({orgId:String(org._id),name:admin.name,email:admin.email,role:roles.find(r=>r.nameKey==='admin')._id,
    department:'IT',canBuild:admin.canBuild,countsTowardSeats:admin.countsTowardSeats,mustChangePassword:true,needsProductTour:true,
    createdAt:org.createdAt,updatedAt:org.createdAt})
  // Validation requires a credential, but no plaintext is persisted in either
  // reservation or logs. Hashing happens before the provisioning transaction.
  const tempPassword=generatePassword(14)
  profile.password=await User.hashPassword(tempPassword)
  await profile.validate()
  const seed={}
  const add=(spec,row) => (seed[spec.table] ||= []).push(rowJSON(spec,row))
  for (const entry of encoded.children) add(entry.spec,entry.row)
  for (const role of roles) add(source.Role,(await encode(source.Role,role.toObject(),async()=>true)).row)
  const user=await encode(source.User,profile.toObject(),async()=>true)
  add(source.User,user.row)
  for (const entry of user.children) add(entry.spec,entry.row)
  return {organization,seed,tempPassword}
}

const safeFailure = error => ['SCHEMA_CONFLICT','TEMPLATE_VERSION_MISMATCH'].includes(error.message) ? error.message : 'PROVISIONING_FAILED'
const mappedCodes = new Set(['INVALID_SCHEMA_NAME','SCHEMA_NAME_TAKEN','SUBDOMAIN_TAKEN','IDEMPOTENCY_CONFLICT','SCHEMA_CONFLICT','TEMPLATE_VERSION_MISMATCH','ORG_NOT_READY','NO_ORG_ADMIN'])
function mapError (error) {
  if (mappedCodes.has(error.message)) return Object.assign(fail(error.message,error.message==='INVALID_SCHEMA_NAME' ? 400 : 409),{operationId:error.operationId})
  return error
}

async function useReservation (org,orgId) {
  const row=(await query('SELECT * FROM platform.organizations WHERE id=$1',[orgId])).rows[0]
  if (!row) throw fail('INVALID_PROVISIONING_OPERATION')
  const spec=platformCatalog(sourceCatalog()).Organization
  const stored=(await transaction(client=>decode(client,spec,[row])))[0]
  // Retries keep the original licence dates/defaults as well as identity. Keep
  // validated integration inputs in memory; they are not in the reservation.
  Object.assign(org,stored)
  org.usage.submissions=freshPeriod(org,new Date(row.created_at))
}

async function createOrganization ({ actorId, key, body, org, admin, verifyIntegrations }) {
  if (require('../context').transactions.getStore()) throw fail('PROVISIONING_REQUIRES_OWN_TRANSACTIONS',500)
  if (!UUID.test(key || '')) throw fail('IDEMPOTENCY_KEY_REQUIRED',400)
  try { tenantSchemaName(org.name) } catch { throw fail('INVALID_SCHEMA_NAME',400) }
  const hash=fingerprint(body)
  const existing=(await query('SELECT id,org_id,status,request_fingerprint FROM system.provisioning_operations WHERE actor_admin_id=$1 AND idempotency_key=$2',[actorId,key])).rows[0]
  if (existing && existing.request_fingerprint!==hash) throw fail('IDEMPOTENCY_CONFLICT')
  if (existing?.status==='succeeded') return completed(existing.org_id,existing.id,null,true)
  // Failed/pending operations reserve their identity. A crash before/during DDL
  // releases the advisory lock automatically; the same intent safely retries.
  if (existing) {
    await useReservation(org,existing.org_id)
  }
  await verifyIntegrations()
  const prepared=await prepare(org,admin)
  try {
    const reserved=(await query('SELECT system.reserve_organization($1,$2,$3,$4) AS result',[actorId,key,hash,prepared.organization])).rows[0].result
    if (reserved.status==='succeeded') return completed(reserved.orgId,reserved.id,null,true)
    // Another request can reserve the same intent while this one hashes its
    // password. Its reserved ID is authoritative; rebuild IDs before seeding.
    if (reserved.orgId!==String(org._id)) {
      await useReservation(org,reserved.orgId)
      Object.assign(prepared,await prepare(org,admin))
    }
    let outcome
    try {
      outcome=await transaction(async client => {
        await client.query("SET LOCAL lock_timeout='2s'")
        return (await client.query('SELECT system.provision_organization($1,$2,$3,$4) AS result',[reserved.id,actorId,hash,prepared.seed])).rows[0].result
      })
    } catch(error) {
      // A lost connection may mean COMMIT succeeded. Never reset credentials or
      // delete a schema. Failure recording refuses to change a succeeded row.
      await query('SELECT system.fail_provisioning($1,$2,$3,$4)',[reserved.id,actorId,hash,safeFailure(error)]).catch(()=>{})
      throw Object.assign(fail(safeFailure(error),503),{operationId:reserved.id})
    }
    if (outcome.pending) return {pending:true,operationId:reserved.id,code:'PROVISIONING_IN_PROGRESS'}
    return completed(outcome.orgId,reserved.id,outcome.replayed ? null : prepared.tempPassword,outcome.replayed)
  } catch(error) { throw mapError(error) }
}

async function operationStatus (actorId,operationId) {
  if (!UUID.test(operationId || '')) throw fail('OPERATION_NOT_FOUND',404)
  const operation=(await query(`SELECT id AS "operationId",org_id AS "orgId",status,attempts,error_code AS "errorCode",updated_at AS "updatedAt"
    FROM system.provisioning_operations WHERE id=$1 AND actor_admin_id=$2`,[operationId,actorId])).rows[0]
  if (!operation) throw fail('OPERATION_NOT_FOUND',404)
  return operation
}

async function organizationSummary (row) {
  if (row.provisioning_status==='ready') row=await require('./management').placementRow(row.id)
  const spec=platformCatalog(sourceCatalog()).Organization
  let org=(await transaction(client=>decode(client,spec,[row])))[0]
  const placement={schemaName:row.schema_name,provisioningStatus:row.provisioning_status,schemaVersion:row.schema_version,provisionedAt:row.provisioned_at}
  if(row.provisioning_status==='maintenance') placement.lifecycle=(await query(`SELECT archived_at AS "archivedAt",purge_after AS "purgeAfter",
    verified_at AS "backupVerifiedAt" FROM system.tenant_lifecycle WHERE org_id=$1`,[row.id])).rows[0] || null
  if (row.provisioning_status!=='ready') return {...org,...placement,admin:null,usage:null,licensing:usageSnapshot(org,{})}
  const result=await runWithOrgId(row.id,()=>transaction(async client=>{
    const schema=q(row.schema_name)
    const children=sourceCatalog().Organization.children.map(child=>({...child,schema:row.schema_name}))
    org=(await decode(client,{...spec,children,tenantOrganization:true},[row]))[0]
    const admin=(await client.query(`SELECT id AS "_id",name,email,can_build AS "canBuild",counts_toward_seats AS "countsTowardSeats" FROM ${schema}.users WHERE id=$1 AND deleted_at IS NULL`,[row.admin_user_id])).rows[0] || null
    const usage=(await client.query(`SELECT
      (SELECT count(*)::int FROM ${schema}.users WHERE is_active IS TRUE AND deleted_at IS NULL) AS "activeUsers",
      (SELECT count(*)::int FROM ${schema}.users WHERE is_active IS TRUE AND counts_toward_seats IS DISTINCT FROM false AND deleted_at IS NULL) AS users,
      (SELECT count(*)::int FROM ${schema}.users WHERE is_active IS TRUE AND can_build IS TRUE AND counts_toward_seats IS DISTINCT FROM false AND deleted_at IS NULL) AS builders,
      (SELECT count(*)::int FROM ${schema}.users WHERE deleted_at IS NULL) AS "usersTotal",
      (SELECT count(*)::int FROM ${schema}.forms WHERE status IS DISTINCT FROM 'archived') AS forms,
      (SELECT count(*)::int FROM ${schema}.forms) AS "formsTotal",
      (SELECT count(*)::int FROM ${schema}.workflows WHERE status IS DISTINCT FROM 'archived') AS workflows,
      (SELECT count(*)::int FROM ${schema}.workflows) AS "workflowsTotal",
      (SELECT count(*)::int FROM ${schema}.tasks WHERE status='pending') AS "pendingTasks"`)).rows[0]
    return {admin,usage}
  }))
  // Keep configuration flags but never expose DMS/S3 credentials to the browser.
  if (org.integrations) {
    for (const key of ['dmsApiKey','dmsJwt']) org.integrations[key]=org.integrations[key] ? '••••••••' : ''
    if (org.integrations.s3) for (const key of ['accessKeyId','secretAccessKey']) org.integrations.s3[key]=org.integrations.s3[key] ? '••••••••' : ''
    for (const item of org.integrations.departmentDms || []) item.apiKey=item.apiKey ? '••••••••' : ''
  }
  return {...org,...placement,...result,licensing:usageSnapshot(org,result.usage)}
}
async function listOrganizations () {
  const rows=(await query('SELECT * FROM platform.organizations WHERE deleted_at IS NULL ORDER BY created_at,id')).rows
  // Bounded sequential tenant transactions, never a pooled context switch.
  const orgs=[]
  for (const row of rows) orgs.push(await organizationSummary(row))
  return orgs
}
async function completed (orgId,operationId,tempPassword,replayed) {
  const row=(await query('SELECT * FROM platform.organizations WHERE id=$1',[orgId])).rows[0]
  const org=await organizationSummary(row)
  return {org,operationId,replayed,credentialsAlreadyIssued:replayed,
    admin:{...org.admin,...(tempPassword ? {tempPassword} : {}),warning:null}}
}
async function resetAdminPassword (actorId,orgId) {
  if (!/^[a-f0-9]{24}$/.test(orgId)) throw fail('ORG_NOT_FOUND',404)
  const tempPassword=generatePassword(14)
  const hash=await User.hashPassword(tempPassword)
  try {
    const admin=(await query('SELECT system.reset_organization_admin($1,$2,$3) AS result',[actorId,orgId,hash])).rows[0].result
    return {admin:{...admin,tempPassword}}
  } catch(error) { throw mapError(error) }
}
module.exports={organizationSummary,createOrganization,operationStatus,listOrganizations,resetAdminPassword,fingerprint,prepare}
