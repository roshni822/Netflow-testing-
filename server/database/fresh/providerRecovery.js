'use strict'
const fs=require('node:fs/promises')
const path=require('node:path')
const crypto=require('node:crypto')
const recovery=require('./recovery')
const {digest,verifySchema}=require('./setup')
const {q}=require('../catalog')
const {TENANT_TABLES}=require('./manifest')
const dms=require('../../services/dmsClient')
const s3=require('../../services/s3Client')
const fail=code=>Object.assign(new Error(code),{code})
async function saveJournal(filename,journal) {
  const temporary=filename+'.'+crypto.randomUUID()+'.tmp'
  await fs.writeFile(temporary,JSON.stringify(journal,null,2),{flag:'wx',mode:0o600})
  await fs.rename(temporary,filename)
}
function sourceOrganization(bundle) {
  const record=JSON.parse(bundle.tables['platform.organizations'][0])
  const settings=JSON.parse(bundle.tables['tenant.organization_integrations'][0] || '{}')
  return {_id:bundle.orgId,subdomain:record.subdomain,integrations:{dmsBaseUrl:settings.dms_base_url,dmsApiKey:settings.dms_api_key,
    dmsJwt:settings.dms_jwt,dmsEnabled:settings.dms_enabled,dmsOrgSlug:settings.dms_org_slug,
    s3:{enabled:settings.s3_enabled,bucket:settings.s3_bucket,endpoint:settings.s3_endpoint,region:settings.s3_region,
      accessKeyId:settings.s3_access_key_id,secretAccessKey:settings.s3_secret_access_key},
    departmentDms:bundle.tables['tenant.organization_department_integrations'].map(raw=>{const r=JSON.parse(raw);return {department:r.department,baseUrl:r.base_url,apiKey:r.api_key,enabled:r.enabled,folder:r.folder}})}}
}
async function readRemote(key,org,{department}={}) {
  if(key.startsWith('dms:')) return require('../../services/extractionStorage').loadSource({storage:'dms',dmsDocId:key.slice(4),dmsDepartment:department},org)
  if(!key.startsWith('s3:'+org._id+'/')) throw fail('CROSS_TENANT_FILE_REFERENCE')
  const {GetObjectCommand}=require('@aws-sdk/client-s3')
  const result=await s3.getClient(org).send(new GetObjectCommand({Bucket:org.integrations.s3.bucket,Key:key.slice(3)}),{abortSignal:AbortSignal.timeout(30000)})
  const limit=Number(process.env.TENANT_BACKUP_MAX_BYTES || 256*1024*1024), chunks=[]
  let total=0
  for await(const chunk of result.Body) { total+=chunk.length;if(total>limit){result.Body.destroy();throw fail('BACKUP_SIZE_LIMIT')}chunks.push(chunk) }
  return Buffer.concat(chunks)
}
function destination(org,config) {
  if(config?.isolated!==true || !config.integrations || typeof config.integrations!=='object') throw fail('ISOLATED_PROVIDER_CONFIG_REQUIRED')
  const target={_id:org._id,subdomain:org.subdomain,integrations:config.integrations}
  const originalBuckets=new Set([org.integrations.s3?.bucket].filter(Boolean))
  if(target.integrations.s3?.enabled && (originalBuckets.has(target.integrations.s3.bucket) || !s3.isEnabled(target))) throw fail('ISOLATED_S3_BUCKET_REQUIRED')
  const normalize=value=>value ? new URL(value).origin.toLowerCase() : ''
  const roots=new Set([org.integrations.dmsBaseUrl,...org.integrations.departmentDms.map(d=>d.baseUrl)].filter(Boolean).map(normalize))
  for(const endpoint of [target.integrations.dmsBaseUrl,...(target.integrations.departmentDms || []).map(d=>d.baseUrl)].filter(Boolean)) {
    if(roots.has(normalize(endpoint))) throw fail('ISOLATED_DMS_ENDPOINT_REQUIRED')
    dms.normalizeEndpoint(endpoint)
  }
  return target
}
async function adapter(org,file,journalRoot) {
  if(file.key.startsWith('s3:')) {
    if(!s3.isEnabled(org)) throw fail('DESTINATION_PROVIDER_MISSING')
    const {PutObjectCommand}=require('@aws-sdk/client-s3')
    return {put:async(bytes,ref)=>{
      const key=org._id+'/recovery/'+ref
      try { await s3.getClient(org).send(new PutObjectCommand({Bucket:org.integrations.s3.bucket,Key:key,Body:bytes,
        ContentType:file.contentType || 'application/octet-stream',IfNoneMatch:'*'}),{abortSignal:AbortSignal.timeout(60000)}) }
      catch(error) {if(error.$metadata?.httpStatusCode!==412) throw error}
      return 's3:'+key
    },read:key=>readRemote(key,org)}
  }
  if(!dms.isConfiguredFor(org,file.department)) throw fail('DESTINATION_PROVIDER_MISSING')
  return {put:async(bytes,ref)=>{
    const existing=await dms.findByRef({id:ref},{org,department:file.department})
    const existingId=existing?.id || existing?._id || existing?.document?.id || existing?.document?._id
    if(existingId) return 'dms:'+String(existingId)
    const temp=path.join(journalRoot,'upload-'+ref+'.bin')
    try {await fs.writeFile(temp,bytes,{flag:'wx',mode:0o600})}catch(error){if(error.code!=='EEXIST' || digest(await fs.readFile(temp))!==digest(bytes))throw error}
    const result=await dms.uploadFile({filePath:temp,filename:file.name || ref+'.bin',mime:file.contentType || 'application/octet-stream',
      org,department:file.department,ref:{id:ref},quiet:true})
    if(!result?.id || !/^[A-Za-z0-9_-]+$/.test(result.id)) throw fail('INVALID_PROVIDER_DOCUMENT_ID')
    return 'dms:'+result.id
  },read:key=>readRemote(key,org,{department:file.department})}
}
async function restoreProviders(client,bundle,{config,root,adapterFactory=adapter}) {
  recovery.validate(bundle)
  const database=(await client.query('SELECT current_database() AS name')).rows[0].name
  if(!/^netflow_restore_[a-z0-9_]+$/.test(database) || database===bundle.sourceDatabase) throw fail('ISOLATED_RESTORE_TARGET_REQUIRED')
  await verifySchema(client)
  const org=sourceOrganization(bundle),target=destination(org,config)
  const directory=path.resolve(root)
  if((await fs.lstat(directory)).isSymbolicLink() || await fs.realpath(directory)!==directory) throw fail('UNSAFE_RECOVERY_PATH')
  const report=JSON.parse(await fs.readFile(path.join(directory,'restore-report.json'),'utf8'))
  if(!report.databaseCommitted || report.orgId!==bundle.orgId || !report.quarantined || Object.entries(bundle.manifest.tables).some(([key,v])=>report.tables[key]?.sha256!==v.sha256)) throw fail('VERIFIED_RESTORE_REQUIRED')
  const identity=digest(JSON.stringify({database,manifest:bundle.manifest,destination:target.integrations}))
  const journalPath=path.join(directory,'provider-recovery.json')
  let journal={identity,mappings:{},databaseCommitted:false}
  try { journal=JSON.parse(await fs.readFile(journalPath,'utf8'));if(journal.identity!==identity)throw fail('PROVIDER_RECOVERY_TARGET_CHANGED') }
  catch(error){if(error.code!=='ENOENT')throw error;await fs.writeFile(journalPath,JSON.stringify(journal),{flag:'wx',mode:0o600})}
  await client.query("SELECT pg_advisory_lock(hashtextextended('tenant-operation:'||$1,0))",[bundle.orgId])
  try {
    const current=(await client.query('SELECT id,status,schema_name,deleted_at FROM platform.organizations')).rows
    if(current.length!==1 || current[0].id!==bundle.orgId || current[0].status!=='suspended' || current[0].schema_name!==bundle.schema || current[0].deleted_at) throw fail('ISOLATED_SUSPENDED_TENANT_REQUIRED')
    for(const file of bundle.files.filter(f=>f.key.startsWith('s3:') || f.key.startsWith('dms:'))) {
      const provider=await adapterFactory(target,file,directory)
      const ref=digest(identity+file.key).slice(0,48)
      let key=journal.mappings[file.key]?.key
      if(!key) {key=await provider.put(Buffer.from(file.base64,'base64'),ref);journal.mappings[file.key]={key,department:file.department};
        await saveJournal(journalPath,journal)}
      if(!(file.key.startsWith('s3:') ? key.startsWith('s3:'+bundle.orgId+'/recovery/') : /^dms:[A-Za-z0-9_-]+$/.test(key))) throw fail('PROVIDER_RECOVERY_SCOPE_MISMATCH')
      if(digest(await provider.read(key))!==file.sha256) throw fail('PROVIDER_READBACK_MISMATCH')
      journal.mappings[file.key].verified=true
      await saveJournal(journalPath,journal)
    }
    if(journal.databaseCommitted) return {verified:true,replayed:true,objects:Object.keys(journal.mappings).length,quarantined:true}
    await client.query('BEGIN')
    try {
      await client.query("SELECT set_config('netflow.system','platform',true),set_config('netflow.org_id',$1,true)",[bundle.orgId])
      await client.query(await fs.readFile(path.join(__dirname,'provider-relink.sql'),'utf8'))
      const mapping=JSON.stringify(journal.mappings)
      for(const table of TENANT_TABLES.filter(t=>!['audit_logs','organization_integrations','organization_department_integrations','user_auth','user_sessions','user_mfa_backup_codes'].includes(t))) {
        const columns=(await client.query(`SELECT attname,atttypid::regtype::text AS type FROM pg_attribute
          WHERE attrelid=$1::regclass AND attnum>0 AND NOT attisdropped AND attgenerated=''`,[q(bundle.schema)+'.'+q(table)])).rows
        for(const col of columns.filter(c=>c.type==='jsonb')) await client.query(`UPDATE ${q(bundle.schema)}.${q(table)} SET ${q(col.attname)}=pg_temp.relink_document(${q(col.attname)},$1::jsonb)`,[mapping])
        for(const col of columns.filter(c=>['dms_doc_id','s3_key'].includes(c.attname))) {
          const prefix=col.attname==='s3_key' ? 's3:' : 'dms:'
          for(const [from,to] of Object.entries(journal.mappings).filter(([key])=>key.startsWith(prefix)))
            await client.query(`UPDATE ${q(bundle.schema)}.${q(table)} SET ${q(col.attname)}=$2 WHERE ${q(col.attname)}=$1`,[from.slice(prefix.length),to.key.slice(prefix.length)])
        }
      }
      for(const [from,to] of Object.entries(journal.mappings)) await client.query(`UPDATE ${q(bundle.schema)}.file_grants SET path=$2,version=version+1 WHERE path=$1`,[from,to.key])
      const connections=require('./documentConnections')
      await client.query("DELETE FROM system.resource_routes WHERE org_id=$1 AND purpose='document_connection'",[bundle.orgId])
      for(const to of Object.values(journal.mappings).filter(to=>to.key.startsWith('dms:'))) await client.query(`INSERT INTO system.resource_routes(purpose,token_digest,account_scope,org_id,resource_id)
        VALUES('document_connection',$1,'tenant',$2,$3)`,[connections.routeDigest(bundle.orgId,to.key.slice(4)),bundle.orgId,JSON.stringify(connections.value(target,to.department))])
      const i=target.integrations,s=i.s3 || {}
      await client.query(`UPDATE ${q(bundle.schema)}.organization_integrations SET s3_enabled=$2,s3_bucket=$3,s3_endpoint=$4,s3_region=$5,s3_access_key_id=$6,s3_secret_access_key=$7,
        dms_enabled=$8,dms_base_url=$9,dms_api_key=$10,dms_jwt=$11,dms_org_slug=$12,
        source_missing=ARRAY(SELECT value FROM unnest(source_missing) value WHERE value NOT LIKE 'integrations.%') WHERE owner_id=$1`,
      [bundle.orgId,!!s.enabled,s.bucket || null,s.endpoint || null,s.region || null,s.accessKeyId || null,s.secretAccessKey || null,!!i.dmsEnabled,i.dmsBaseUrl || null,i.dmsApiKey || null,i.dmsJwt || null,i.dmsOrgSlug || null])
      await client.query(`DELETE FROM ${q(bundle.schema)}.organization_department_integrations WHERE owner_id=$1`,[bundle.orgId])
      for(const [position,d] of (i.departmentDms || []).entries()) await client.query(`INSERT INTO ${q(bundle.schema)}.organization_department_integrations(owner_id,tenant_id,position,department,api_key,base_url,enabled,folder,department_id)
        VALUES($1,$1,$2,$3,$4,$5,$6,$7,(SELECT department_id FROM ${q(bundle.schema)}.organization_departments WHERE owner_id=$1 AND name_key=lower(btrim($3))))`,[bundle.orgId,position,d.department,d.apiKey || null,d.baseUrl || null,d.enabled!==false,d.folder || null])
      await client.query('SET CONSTRAINTS ALL IMMEDIATE')
      await client.query('COMMIT')
      journal.databaseCommitted=true
      await saveJournal(journalPath,journal)
      return {verified:true,objects:Object.keys(journal.mappings).length,quarantined:true}
    } catch(error){await client.query('ROLLBACK');throw error}
  } finally {await client.query("SELECT pg_advisory_unlock(hashtextextended('tenant-operation:'||$1,0))",[bundle.orgId])}
}
module.exports={readRemote,restoreProviders,sourceOrganization,destination}
