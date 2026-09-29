'use strict'
// Trusted upload-time binding. Browser-supplied attachment departments never
// decide which credential/endpoint is used to read an existing document.
const {digest}=require('./setup')
const {query}=require('../postgres')
const fail=code=>Object.assign(new Error(code),{code,statusCode:409})
const routeDigest=(orgId,id)=>digest('netflow:dms-route:'+orgId+':'+id)
function value(org,department='') {
  const dms=require('../../services/dmsClient')
  const name=String(department || '').trim()
  const endpoint=dms.resolveBaseUrl(org,name)
  if(!endpoint || name.length>100) throw fail('DMS_RECOVERY_NOT_CONFIGURED')
  return {department:name,connectionFingerprint:digest(JSON.stringify([String(org._id),endpoint,name.toLowerCase()]))}
}
function check(binding,org) {
  if(!binding || typeof binding.department!=='string' || binding.connectionFingerprint!==value(org,binding.department).connectionFingerprint) throw fail('DMS_CONNECTION_CHANGED')
  return binding
}
function scoped(org) {
  return require('../layout').organizationSchemas() && require('../../tenancy/tenantContext').getPlacement()?.orgId===String(org?._id)
}
async function register(id,org,department) {
  if(!scoped(org)) return
  const binding=value(org,department)
  const result=await query(`INSERT INTO system.resource_routes(purpose,token_digest,account_scope,org_id,resource_id)
    VALUES('document_connection',$1,'tenant',$2,$3) ON CONFLICT(purpose,token_digest) DO UPDATE SET resource_id=system.resource_routes.resource_id
    WHERE system.resource_routes.org_id=EXCLUDED.org_id AND system.resource_routes.resource_id=EXCLUDED.resource_id RETURNING resource_id`,
  [routeDigest(String(org._id),String(id)),String(org._id),JSON.stringify(binding)])
  if(!result.rowCount) throw fail('DMS_DOCUMENT_CONNECTION_AMBIGUOUS')
}
async function resolve(id,org) {
  const row=(await query("SELECT resource_id FROM system.resource_routes WHERE purpose='document_connection' AND token_digest=$1 AND org_id=$2",
    [routeDigest(String(org._id),String(id)),String(org._id)])).rows[0]
  if(row) return check(JSON.parse(row.resource_id),org).department
  if(org.integrations?.departmentDms?.some(d=>d.enabled!==false)) throw fail('DMS_DOCUMENT_ROUTE_REQUIRED')
  return undefined
}
module.exports={routeDigest,value,check,scoped,register,resolve}
