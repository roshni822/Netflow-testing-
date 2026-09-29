'use strict'
const management=require('./management')
const {query}=require('../postgres')
const {runWithOrgId}=require('../../tenancy/tenantContext')
const dms=require('../../services/dmsClient')
const s3=require('../../services/s3Client')
const {fail}=require('./platformOperations')
async function configuration (orgId) {
  const org=await management.load(orgId)
  return {orgId,accountedBytes:Number(org.usage?.storageBytes || 0),accountedFiles:Number(org.usage?.fileCount || 0),
    connections:[...(s3.isEnabled(org) ? [{key:'s3',provider:'s3',label:'S3 storage'}] : []),
      ...(dms.isConfiguredFor(org) ? [{key:'dms',provider:'dms',label:'Organization DMS'}] : []),
      ...(org.integrations?.departmentDms || []).filter(d=>d.enabled!==false && dms.isConfiguredFor(org,d.department))
        .map(d=>({key:'dms:'+d.department,provider:'dms',department:d.department,label:d.department+' DMS'}))]}
}
async function documents (orgId,provider,{department,cursor}={}) {
  const org=await management.load(orgId)
  const placement=await management.placementRow(orgId)
  if(cursor && (typeof cursor!=='string' || cursor.length>4096)) throw fail('INVALID_CURSOR','Invalid page cursor.')
  try {
    if(provider==='s3') {
      if(!s3.isEnabled(org)) throw fail('PROVIDER_NOT_CONFIGURED','S3 storage is not configured.',409)
      const {ListObjectsV2Command}=require('@aws-sdk/client-s3')
      const result=await s3.getClient(org).send(new ListObjectsV2Command({Bucket:org.integrations.s3.bucket,Prefix:orgId+'/',MaxKeys:100,ContinuationToken:cursor || undefined}),{abortSignal:AbortSignal.timeout(15000)})
      const documents=(result.Contents || []).filter(d=>d.Key.startsWith(orgId+'/')).map(d=>({id:d.Key,name:d.Key.slice(orgId.length+1),size:Number(d.Size),updatedAt:d.LastModified}))
      return {orgId,provider,documents,hasMore:Boolean(result.IsTruncated),nextCursor:result.NextContinuationToken || null,
        listedBytes:documents.reduce((n,d)=>n+d.size,0),scope:'organization-prefix'}
    }
    if(provider!=='dms') throw fail('INVALID_PROVIDER','Unknown storage provider.')
    if(department && !org.integrations?.departmentDms?.some(d=>d.enabled!==false && d.department===department)) throw fail('INVALID_DEPARTMENT','Select a configured department.')
    if(!dms.isConfiguredFor(org,department)) throw fail('PROVIDER_NOT_CONFIGURED','DMS is not configured.',409)
    const offset=Number(cursor || 0)
    if(!Number.isSafeInteger(offset) || offset<0 || offset>10000000) throw fail('INVALID_CURSOR','Invalid page cursor.')
    const result=await dms.listDocuments({org,department,limit:100,offset})
    const raw=result?.documents || []
    const ids=raw.map(d=>String(d.id || d._id || ''))
    const allowed=new Set(await runWithOrgId(orgId,async()=>
      (await query(`SELECT path FROM ${management.q(placement.schema_name)}.file_grants WHERE path=ANY($1::text[])`,[ids.map(id=>'dms:'+id)])).rows.map(r=>r.path.slice(4))))
    const connections=require('./documentConnections')
    const bindings=new Map((await query("SELECT token_digest,resource_id FROM system.resource_routes WHERE org_id=$1 AND purpose='document_connection' AND token_digest=ANY($2::text[])",
      [orgId,ids.map(id=>connections.routeDigest(orgId,id))])).rows.map(r=>[r.token_digest,JSON.parse(r.resource_id)]))
    const matches=id=>{
      if(!allowed.has(id)) return false
      const binding=bindings.get(connections.routeDigest(orgId,id))
      if(!binding) return !department && !org.integrations?.departmentDms?.some(d=>d.enabled!==false)
      const stored=connections.check(binding,org).department
      return dms.resolveBaseUrl(org,stored)===dms.resolveBaseUrl(org,department)
        && dms.resolveApiKey(org,stored)===dms.resolveApiKey(org,department) && dms.resolveJwt(org,stored)===dms.resolveJwt(org,department)
    }
    const documents=raw.filter(d=>matches(String(d.id || d._id))).map(d=>({id:String(d.id || d._id),
      name:typeof d.name==='string' ? d.name : 'Document',mime:typeof d.mime==='string' ? d.mime : null,
      size:Number.isFinite(Number(d.size ?? d.fileSize)) && Number(d.size ?? d.fileSize)>=0 ? Number(d.size ?? d.fileSize) : null}))
    const hasMore=result?.total!=null ? offset+raw.length<result.total && raw.length>0 : raw.length===100
    return {orgId,provider,department:department || null,documents,hasMore,nextCursor:hasMore ? String(offset+raw.length) : null,
      listedBytes:documents.every(d=>d.size!==null) ? documents.reduce((n,d)=>n+d.size,0) : null,scope:'application-linked-documents'}
  } catch(error) {
    if(error.statusCode) throw error
    // Never forward provider responses, signed URLs or credentials to clients.
    throw fail('PROVIDER_READ_FAILED','The storage provider could not be read. Check the organization connection.',502)
  }
}
module.exports={configuration,documents}
