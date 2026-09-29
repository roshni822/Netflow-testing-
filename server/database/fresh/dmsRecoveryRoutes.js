'use strict'
const dms=require('../../services/dmsClient')
const connections=require('./documentConnections')
const fail=code=>Object.assign(new Error(code),{code})
function routes (bundle,org,overrides={}) {
  if(!overrides || typeof overrides!=='object' || Array.isArray(overrides)) throw fail('INVALID_DMS_DOCUMENT_MAP')
  const trusted=new Map(bundle.tables['system.resource_routes'].map(raw=>JSON.parse(raw))
    .filter(r=>r.purpose==='document_connection').map(r=>[r.token_digest,JSON.parse(r.resource_id)]))
  const departments=(org.integrations?.departmentDms || []).filter(d=>d.enabled!==false)
  const connection=department=>{
    if(typeof department!=='string' || department.length>100) throw fail('INVALID_DMS_DOCUMENT_MAP')
    const endpoint=dms.resolveBaseUrl(org,department)
    if(!endpoint) throw fail('DMS_RECOVERY_NOT_CONFIGURED')
    return connections.value(org,department).connectionFingerprint
  }
  return key=>{
    const binding=trusted.get(connections.routeDigest(bundle.orgId,key.slice(4)))
    const candidates=binding ? [connections.check(binding,org).department] : []
    if(Object.hasOwn(overrides,key)) {
      if(typeof overrides[key]!=='string') throw fail('INVALID_DMS_DOCUMENT_MAP')
      candidates.push(overrides[key])
    }
    if(!candidates.length) {
      if(departments.length) throw fail('DMS_DOCUMENT_ROUTE_REQUIRED')
      candidates.push('')
    }
    if(new Set(candidates.map(connection)).size!==1) throw fail('DMS_DOCUMENT_CONNECTION_AMBIGUOUS')
    return {department:candidates[0],connectionFingerprint:connection(candidates[0])}
  }
}
module.exports={routes}
