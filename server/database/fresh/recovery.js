'use strict'
// Offline, operator-only recovery. Not imported by an HTTP route and never
// uses DATABASE_URL. Bundles contain credentials and must remain encrypted.
const fs = require('node:fs/promises')
const path = require('node:path')
const crypto = require('node:crypto')
const { TENANT_TABLES } = require('./manifest')
const { verifySchema, applyFreshSchema, renderTenantTemplate, migrations, digest } = require('./setup')
const { q, sourceCatalog } = require('../catalog')
const { platformCatalog } = require('./manifest')
const { decode } = require('../storage')
const fail = code => Object.assign(new Error(code), { code })
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex')
const sorted = rows => [...rows].sort()
const tableDigest = rows => sha(JSON.stringify(sorted(rows)))
const SHARED = Object.freeze({ platform: ['organizations','plans','admin_users','admin_roles','platform_broadcasts','audit_logs'],
  system:['schema_migrations','user_directory','resource_routes','outbox','microsoft_identities','provisioning_operations','tenant_lifecycle'] })
const maximumBytes = () => Number(process.env.TENANT_BACKUP_MAX_BYTES || 256*1024*1024)
async function rows (client, schema, table, where='', values=[]) {
  // Keep PostgreSQL's JSON text: preserves numeric precision and microsecond
  // timestamps. Never round-trip recovery row values through JavaScript numbers.
  return (await client.query(`SELECT row_to_json(t)::text AS value FROM ${q(schema)}.${q(table)} t ${where}`,values)).rows.map(r=>r.value)
}
function releases () { return migrations().map(m=>({schema:m.schema,version:m.version,checksum:digest(m.sql)})) }
function manifest (bundle) {
  return { format:bundle.format,orgId:bundle.orgId,schema:bundle.schema,createdAt:bundle.createdAt,
    tables:Object.fromEntries(Object.entries(bundle.tables).map(([key,records])=>[key,{count:records.length,sha256:tableDigest(records)}])),
    files:bundle.files.map(({key,sha256,size,name,contentType,department,connectionFingerprint})=>({key,sha256,size,
      ...(name!==undefined ? {name,contentType} : {}),...(department!==undefined ? {department,connectionFingerprint} : {})})), unreferencedMissingFiles:bundle.unreferencedMissingFiles, release:bundle.release }
}
async function checkTables (client,schema) {
  const actual=(await client.query('SELECT tablename FROM pg_tables WHERE schemaname=$1',[schema])).rows.map(r=>r.tablename).sort()
  if (JSON.stringify(actual)!==JSON.stringify([...TENANT_TABLES].sort())) throw fail('RECOVERY_TABLE_MANIFEST_MISMATCH')
}
function references (value, output=new Set(), orgId=null) {
  if (!value || typeof value!=='object') return output
  if (value.storage==='local' && value.storedFilename && orgId) output.add(orgId+'/'+String(value.storedFilename))
  if (value.dmsDocId || value.dms_doc_id) output.add('dms:'+String(value.dmsDocId || value.dms_doc_id))
  if (value.s3Key || value.s3_key) output.add('s3:'+String(value.s3Key || value.s3_key))
  for (const item of Object.values(value)) {
    if (typeof item==='string') {
      const match=item.match(/\/api\/files\/([a-f0-9]{24}\/[A-Za-z0-9._-]+)(?:\?|$)/i)
      if (match) output.add(match[1])
    } else if (item && typeof item==='object') references(item,output,orgId)
  }
  return output
}
async function collectFiles (bundle,uploadRoot,loadRemote,routeDms) {
  const keys=new Set()
  const metadata=new Map()
  const documentMetadata=value=>{
    if(!value || typeof value!=='object') return
    const key=value.dmsDocId || value.dms_doc_id ? 'dms:'+String(value.dmsDocId || value.dms_doc_id)
      : value.s3Key || value.s3_key ? 's3:'+String(value.s3Key || value.s3_key) : null
    if(key) {
      const name=typeof (value.filename || value.name)==='string' ? path.basename(value.filename || value.name).slice(0,250) : ''
      const mime=value.mimetype || value.mime
      if(name) {
        const candidate={name,contentType:typeof mime==='string' && /^[\w.+-]+\/[\w.+-]+$/.test(mime) ? mime : 'application/octet-stream'}
        if(!metadata.has(key) || JSON.stringify(candidate)<JSON.stringify(metadata.get(key))) metadata.set(key,candidate)
      }
    }
    for(const child of Object.values(value)) if(child && typeof child==='object') documentMetadata(child)
  }
  for (const table of TENANT_TABLES) for (const row of bundle.tables['tenant.'+table]) references(JSON.parse(row),keys,bundle.orgId)
  for (const table of TENANT_TABLES) for (const row of bundle.tables['tenant.'+table]) documentMetadata(JSON.parse(row))
  const root=path.resolve(uploadRoot)
  const dir=path.join(root,bundle.orgId)
  let entries=[]
  try {
    if ((await fs.lstat(dir)).isSymbolicLink() || await fs.realpath(dir)!==dir) throw fail('UNSAFE_BACKUP_FILE_PATH')
    entries=await fs.readdir(dir,{withFileTypes:true})
  } catch(error) { if(error.code!=='ENOENT') throw error }
  for(const entry of entries) {
    if(!entry.isFile() || !/^[A-Za-z0-9._-]+$/.test(entry.name)) throw fail('UNSUPPORTED_BACKUP_FILE_ENTRY')
    keys.add(bundle.orgId+'/'+entry.name)
  }
  bundle.unreferencedMissingFiles=[]
  for(const raw of bundle.tables['tenant.file_grants']) {
    const key=JSON.parse(raw).path
    if(key.startsWith('s3:') || key.startsWith('dms:') || keys.has(key)) { keys.add(key); continue }
    if(!new RegExp('^'+bundle.orgId+'/[A-Za-z0-9._-]+$').test(key)) throw fail('CROSS_TENANT_FILE_REFERENCE')
    // Retention removes unlinked staging bytes while grant metadata may remain.
    // A missing referenced file fails; these unreferenced tombstones are reported.
    if(entries.some(e=>bundle.orgId+'/'+e.name===key)) keys.add(key)
    else bundle.unreferencedMissingFiles.push({key,reason:'Grant metadata has no live record reference and no file on disk'})
  }
  let total=0
  for (const key of [...keys].sort()) {
    let bytes, connection
    if(key.startsWith('dms:') || key.startsWith('s3:')) {
      if (key.startsWith('s3:') && !key.startsWith('s3:'+bundle.orgId+'/')) throw fail('CROSS_TENANT_FILE_REFERENCE')
      if(!loadRemote) throw fail('REMOTE_FILE_READER_REQUIRED')
      if(key.startsWith('dms:')) connection=routeDms(key)
      bytes=await loadRemote(key,connection)
    } else {
      if(!new RegExp('^'+bundle.orgId+'/[A-Za-z0-9._-]+$').test(key)) throw fail('CROSS_TENANT_FILE_REFERENCE')
      const filename=path.join(root,...key.split('/'))
      const stat=await fs.lstat(filename).catch(()=>{ throw fail('RECOVERY_FILE_MISSING') })
      if(!stat.isFile() || stat.isSymbolicLink() || await fs.realpath(filename)!==filename) throw fail('UNSAFE_BACKUP_FILE_PATH')
      if(total+stat.size>maximumBytes()) throw fail('BACKUP_SIZE_LIMIT')
      bytes=await fs.readFile(filename)
    }
    total+=bytes.length
    if(total>maximumBytes()) throw fail('BACKUP_SIZE_LIMIT')
    bundle.files.push({key,size:bytes.length,sha256:sha(bytes),base64:bytes.toString('base64'),...connection,...metadata.get(key)})
  }
}
async function capture (client,{orgId,uploadRoot,loadRemote,writersStopped=false,dmsDepartments={}}) {
  if(!writersStopped) throw fail('WRITERS_MUST_BE_STOPPED')
  if(!/^[a-f0-9]{24}$/.test(orgId)) throw fail('INVALID_ORG_ID')
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ')
  try {
    await verifySchema(client)
    await client.query("SELECT set_config('TimeZone','UTC',true),set_config('netflow.system','platform',true),set_config('netflow.org_id',$1,true),pg_advisory_xact_lock(hashtextextended('tenant-operation:'||$1,0))",[orgId])
    const org=(await client.query('SELECT * FROM platform.organizations WHERE id=$1 FOR UPDATE',[orgId])).rows[0]
    if(!org || org.deleted_at || org.status!=='suspended' || !['ready','maintenance'].includes(org.provisioning_status)) throw fail('SUSPENDED_READY_TENANT_REQUIRED')
    const template=renderTenantTemplate(org.schema_name,orgId)
    const version=(await client.query("SELECT checksum FROM system.schema_migrations WHERE org_id=$1 AND scope='tenant' AND version=$2",[orgId,template.version])).rows[0]
    if(org.schema_version!==template.version || version?.checksum!==template.checksum) throw fail('TENANT_SCHEMA_MISMATCH')
    await checkTables(client,org.schema_name)
    await client.query(`LOCK TABLE ${TENANT_TABLES.map(t=>q(org.schema_name)+'.'+q(t)).join(',')} IN SHARE MODE`)
    const bundle={format:'netflow-tenant-recovery-v1',orgId,schema:org.schema_name,createdAt:new Date().toISOString(),
      sourceDatabase:(await client.query('SELECT current_database() AS name')).rows[0].name,release:releases(),tables:{},files:[]}
    let rowBytes=0
    for(const table of TENANT_TABLES) {
      rowBytes+=Number((await client.query(`SELECT COALESCE(sum(octet_length(row_to_json(t)::text)),0)::text AS bytes FROM ${q(org.schema_name)}.${q(table)} t`)).rows[0].bytes)
      if(rowBytes>maximumBytes()) throw fail('BACKUP_SIZE_LIMIT')
      bundle.tables['tenant.'+table]=await rows(client,org.schema_name,table)
    }
    for(const table of ['document_extraction_jobs','form_generation_jobs']) {
      if(bundle.tables['tenant.'+table].some(r=>!['queued','ready','failed','cancelled'].includes(JSON.parse(r).status))) throw fail('IN_FLIGHT_DOCUMENT_JOB')
    }
    bundle.tables['platform.organizations']=await rows(client,'platform','organizations','WHERE id=$1',[orgId])
    bundle.tables['platform.plans']=await rows(client,'platform','plans','WHERE key=$1',[org.plan])
    bundle.tables['platform.audit_logs']=await rows(client,'platform','audit_logs','WHERE target_org_id=$1 OR metadata->>\'targetOrgId\'=$1',[orgId])
    // Dependency closure for platform actors, never platform authentication.
    const actorIds=new Set([org.storage_extension_granted_by])
    for(const key of ['tenant.file_grants','tenant.notifications','tenant.integration_dead_letters','platform.audit_logs'])
      for(const raw of bundle.tables[key]) { const r=JSON.parse(raw); for(const col of ['granted_by_admin_id','triggered_by','resolved_by','performed_by']) if(r[col]) actorIds.add(r[col]) }
    const operations=await rows(client,'system','provisioning_operations','WHERE org_id=$1',[orgId])
    bundle.tables['system.provisioning_operations']=operations
    bundle.tables['system.tenant_lifecycle']=await rows(client,'system','tenant_lifecycle','WHERE org_id=$1',[orgId])
    for(const raw of bundle.tables['system.tenant_lifecycle']) actorIds.add(JSON.parse(raw).actor_admin_id)
    for(const raw of operations) actorIds.add(JSON.parse(raw).actor_admin_id)
    const broadcastIds=[...new Set(bundle.tables['tenant.notifications'].map(r=>JSON.parse(r).platform_broadcast_id).filter(Boolean))]
    const broadcasts=await rows(client,'platform','platform_broadcasts','WHERE id=ANY($1::text[]) OR target_org_ids IS NULL OR $2=ANY(target_org_ids)',[broadcastIds,orgId])
    bundle.tables['platform.platform_broadcasts']=broadcasts
    for(const raw of broadcasts) actorIds.add(JSON.parse(raw).created_by)
    let profiles=[]; let previous=-1
    while(profiles.length!==previous) {
      previous=profiles.length
      profiles=await rows(client,'platform','admin_users','WHERE id=ANY($1::text[])',[[...actorIds].filter(Boolean)])
      for(const raw of profiles) { const r=JSON.parse(raw); for(const col of ['manager_id','hr_id','out_of_office_delegate_id']) if(r[col]) actorIds.add(r[col]) }
    }
    bundle.tables['platform.admin_users']=profiles
    bundle.tables['platform.admin_roles']=await rows(client,'platform','admin_roles','WHERE id=ANY($1::text[])',[[...new Set(profiles.map(r=>JSON.parse(r).role_id))]])
    bundle.tables['system.user_directory']=await rows(client,'system','user_directory','WHERE org_id=$1 OR (account_scope=\'platform\' AND user_id=ANY($2::text[]))',[orgId,profiles.map(r=>JSON.parse(r).id)])
    bundle.tables['system.schema_migrations']=await rows(client,'system','schema_migrations','WHERE org_id=$1',[orgId])
    bundle.tables['system.resource_routes']=await rows(client,'system','resource_routes','WHERE org_id=$1',[orgId])
    bundle.tables['system.outbox']=await rows(client,'system','outbox','WHERE org_id=$1',[orgId])
    if(bundle.tables['system.outbox'].some(r=>JSON.parse(r).status==='processing')) throw fail('IN_FLIGHT_DELIVERY')
    bundle.tables['system.microsoft_identities']=await rows(client,'system','microsoft_identities','WHERE user_id IN (SELECT user_id FROM system.user_directory WHERE org_id=$1)',[orgId])
    const spec=platformCatalog(sourceCatalog()).Organization
    const organization=(await decode(client,{...spec,tenantOrganization:true,children:sourceCatalog().Organization.children.map(c=>({...c,schema:org.schema_name}))},[org]))[0]
    await collectFiles(bundle,uploadRoot,loadRemote && ((key,connection)=>loadRemote(key,organization,connection)),
      require('./dmsRecoveryRoutes').routes(bundle,organization,dmsDepartments))
    bundle.manifest=manifest(bundle)
    if(Buffer.byteLength(JSON.stringify(bundle))>maximumBytes()*2) throw fail('BACKUP_SIZE_LIMIT')
    await client.query('COMMIT')
    return bundle
  } catch(error) { await client.query('ROLLBACK'); throw error }
}
function validate (bundle) {
  if(bundle?.format!=='netflow-tenant-recovery-v1' || !/^[a-f0-9]{24}$/.test(bundle.orgId)) throw fail('INVALID_RECOVERY_BUNDLE')
  renderTenantTemplate(bundle.schema,bundle.orgId)
  if(JSON.stringify(bundle.release)!==JSON.stringify(releases())) throw fail('RECOVERY_RELEASE_MISMATCH')
  const keys=[...TENANT_TABLES.map(t=>'tenant.'+t),...Object.entries(SHARED).flatMap(([s,tables])=>tables.map(t=>s+'.'+t))].sort()
  if(JSON.stringify(Object.keys(bundle.tables).sort())!==JSON.stringify(keys)) throw fail('RECOVERY_TABLE_MANIFEST_MISMATCH')
  if(JSON.stringify(manifest(bundle))!==JSON.stringify(bundle.manifest)) throw fail('RECOVERY_CHECKSUM_MISMATCH')
  for(const table of TENANT_TABLES) for(const raw of bundle.tables['tenant.'+table]) {
    const row=JSON.parse(raw)
    if ((row.org_id ?? row.tenant_id)!==bundle.orgId) throw fail('RECOVERY_OWNERSHIP_MISMATCH')
  }
  const org=bundle.tables['platform.organizations'].length===1 && JSON.parse(bundle.tables['platform.organizations'][0])
  if(!org || org.id!==bundle.orgId || org.schema_name!==bundle.schema || org.status!=='suspended' || !['ready','maintenance'].includes(org.provisioning_status)) throw fail('RECOVERY_OWNERSHIP_MISMATCH')
  for(const [key,records] of Object.entries(bundle.tables)) if(key.startsWith('system.') && key!=='system.microsoft_identities') {
    for(const raw of records) {
      const row=JSON.parse(raw)
      if(key==='system.user_directory' && row.account_scope==='platform' && row.org_id===null) continue
      if(row.org_id!==bundle.orgId) throw fail('RECOVERY_OWNERSHIP_MISMATCH')
    }
  }
  const seen=new Set()
  for(const file of bundle.files) {
    if(!new RegExp('^'+bundle.orgId+'/[A-Za-z0-9._-]+$').test(file.key) &&
      !(file.key.startsWith('s3:'+bundle.orgId+'/') || /^dms:[A-Za-z0-9_-]+$/.test(file.key))) throw fail('RECOVERY_FILE_SCOPE_MISMATCH')
    if(seen.has(file.key) || sha(Buffer.from(file.base64,'base64'))!==file.sha256 || Buffer.from(file.base64,'base64').length!==file.size) throw fail('RECOVERY_FILE_CHECKSUM_MISMATCH')
    seen.add(file.key)
  }
  return bundle.manifest
}
function seal (bundle,passphrase) {
  if(typeof passphrase!=='string' || passphrase.length<32) throw fail('BACKUP_PASSPHRASE_REQUIRED')
  const salt=crypto.randomBytes(32), iv=crypto.randomBytes(12)
  const key=crypto.scryptSync(passphrase,salt,32), cipher=crypto.createCipheriv('aes-256-gcm',key,iv)
  const bytes=Buffer.concat([cipher.update(JSON.stringify(bundle),'utf8'),cipher.final()])
  key.fill(0)
  return JSON.stringify({format:'netflow-encrypted-backup-v1',salt:salt.toString('base64'),iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),data:bytes.toString('base64')})
}
function unseal (text,passphrase) {
  try {
    if(typeof passphrase!=='string' || passphrase.length<32 || Buffer.byteLength(text)>maximumBytes()*3) throw fail('INVALID_ENCRYPTED_BACKUP')
    const envelope=JSON.parse(text)
    if(envelope.format!=='netflow-encrypted-backup-v1') throw fail('INVALID_ENCRYPTED_BACKUP')
    const key=crypto.scryptSync(passphrase,Buffer.from(envelope.salt,'base64'),32)
    const decipher=crypto.createDecipheriv('aes-256-gcm',key,Buffer.from(envelope.iv,'base64'))
    decipher.setAuthTag(Buffer.from(envelope.tag,'base64'))
    const bundle=JSON.parse(Buffer.concat([decipher.update(Buffer.from(envelope.data,'base64')),decipher.final()]).toString('utf8'))
    key.fill(0); validate(bundle); return bundle
  } catch { throw fail('BACKUP_DECRYPT_OR_VALIDATE_FAILED') }
}
async function importRows (client,schema,table,records) {
  const columns=(await client.query(`SELECT attname FROM pg_attribute WHERE attrelid=$1::regclass
    AND attnum>0 AND NOT attisdropped AND attgenerated='' ORDER BY attnum`,[q(schema)+'.'+q(table)])).rows.map(r=>r.attname)
  for(const raw of records) await client.query(`INSERT INTO ${q(schema)}.${q(table)} (${columns.map(q).join(',')}) OVERRIDING SYSTEM VALUE SELECT ${columns.map(q).join(',')} FROM json_populate_record(NULL::${q(schema)}.${q(table)},$1::json)`,[raw])
}
async function restoreIsolated (client,bundle,{uploadRoot}) {
  validate(bundle)
  const name=(await client.query('SELECT current_database() AS name')).rows[0].name
  if(!/^netflow_restore_[a-z0-9_]+$/.test(name) || name===bundle.sourceDatabase) throw fail('ISOLATED_RESTORE_TARGET_REQUIRED')
  // No overwrite, merge, activation, external delivery or provider write.
  await applyFreshSchema(client)
  const nonempty=(await client.query(`SELECT EXISTS(SELECT 1 FROM platform.organizations) OR EXISTS(SELECT 1 FROM platform.admin_users)
    OR EXISTS(SELECT 1 FROM platform.plans) OR EXISTS(SELECT 1 FROM system.user_directory)
    OR EXISTS(SELECT 1 FROM pg_namespace WHERE nspname LIKE 'tenant\_%') AS present`)).rows[0].present
  if(nonempty) throw fail('RESTORE_TARGET_NOT_EMPTY')
  const root=path.resolve(uploadRoot)
  // Destination must not already exist, even if empty. Failed work is retained
  // for diagnosis; retry uses another new target, never wipes a directory.
  await fs.mkdir(root,{recursive:false,mode:0o700})
  await client.query('BEGIN')
  try {
    await client.query("SELECT set_config('TimeZone','UTC',true),set_config('netflow.system','platform',true),set_config('netflow.org_id',$1,true)",[bundle.orgId])
    const shared=(s,t)=>importRows(client,s,t,bundle.tables[s+'.'+t])
    for(const table of ['plans','admin_roles','admin_users','organizations','platform_broadcasts']) await shared('platform',table)
    await client.query('SET LOCAL ROLE netflow_provisioner')
    await client.query(renderTenantTemplate(bundle.schema,bundle.orgId).sql)
    await client.query('RESET ROLE')
    // Directory triggers run on profile insertion. Insert stored directory rows
    // first so timestamps, inactive and soft-deleted identities are preserved.
    for(const raw of bundle.tables['system.user_directory']) {
      const record=JSON.parse(raw)
      if(record.account_scope==='tenant') await importRows(client,'system','user_directory',[raw])
    }
    for(const table of TENANT_TABLES) await importRows(client,bundle.schema,table,bundle.tables['tenant.'+table])
    // Restore exact directory timestamps changed by profile synchronization.
    for(const raw of bundle.tables['system.user_directory']) await client.query(`UPDATE system.user_directory d SET
      created_at=r.created_at,updated_at=r.updated_at FROM json_populate_record(NULL::system.user_directory,$1::json) r WHERE d.user_id=r.user_id`,[raw])
    for(const table of SHARED.system.filter(t=>t!=='user_directory')) await shared('system',table)
    await shared('platform','audit_logs')
    await client.query('SET CONSTRAINTS ALL IMMEDIATE')
    await checkTables(client,bundle.schema)
    const report={orgId:bundle.orgId,tables:{},files:[],unreferencedMissingFiles:bundle.unreferencedMissingFiles,
      databaseCommitted:false,quarantined:true,platformCredentialsIncluded:false,providerWritesPerformed:false}
    for(const [key,records] of Object.entries(bundle.tables)) {
      const [scope,table]=key.split('.')
      const schema=scope==='tenant' ? bundle.schema : scope
      const actual=await rows(client,schema,table,scope==='system' && table==='schema_migrations' ? "WHERE scope='tenant'" : '')
      if(tableDigest(actual)!==tableDigest(records)) throw fail('RESTORE_RECORD_COMPARISON_FAILED')
      report.tables[key]={count:actual.length,sha256:tableDigest(actual),verified:true}
    }
    for(const file of bundle.files) {
      const filename=file.key.startsWith(bundle.orgId+'/') ? 'uploads/'+file.key : 'provider-objects/'+sha(file.key)+'.bin'
      const dest=path.join(root,...filename.split('/'))
      await fs.mkdir(path.dirname(dest),{recursive:true,mode:0o700})
      await fs.writeFile(dest,Buffer.from(file.base64,'base64'),{flag:'wx',mode:0o600})
      if(sha(await fs.readFile(dest))!==file.sha256) throw fail('RESTORE_FILE_COMPARISON_FAILED')
      report.files.push({key:file.key,file:filename,size:file.size,sha256:file.sha256,verified:true})
    }
    // Rehearsal remains suspended. Revoke sessions/reset routes/file links and
    // quarantine unsent deliveries; never replay an email after recovery.
    await client.query(`UPDATE ${q(bundle.schema)}.user_auth SET token_version=token_version+1,reset_password_token=NULL,reset_password_expires=NULL`)
    await client.query(`DELETE FROM ${q(bundle.schema)}.user_sessions`)
    await client.query(`UPDATE ${q(bundle.schema)}.file_grants SET version=version+1`)
    await client.query("DELETE FROM system.resource_routes WHERE org_id=$1 AND purpose='password_reset'",[bundle.orgId])
    await client.query("UPDATE system.outbox SET status='failed',attempts=GREATEST(attempts,12),retry_at=NULL WHERE org_id=$1 AND status<>'sent'",[bundle.orgId])
    await client.query("SELECT setval('system.outbox_id_seq',GREATEST(COALESCE((SELECT max(id) FROM system.outbox),0),1),EXISTS(SELECT 1 FROM system.outbox))")
    await client.query(`SELECT setval(pg_get_serial_sequence($1,'department_id'),GREATEST(COALESCE((SELECT max(department_id) FROM ${q(bundle.schema)}.organization_departments),0),1),EXISTS(SELECT 1 FROM ${q(bundle.schema)}.organization_departments))`,[q(bundle.schema)+'.organization_departments'])
    report.deliberateChanges=['Sessions and password-reset links revoked','File-link versions incremented','Unsent outbox items held for manual reconciliation','Organization remains suspended; platform authentication excluded']
    await fs.writeFile(path.join(root,'restore-report.json'),JSON.stringify(report,null,2),{flag:'wx',mode:0o600})
    await client.query('COMMIT')
    report.databaseCommitted=true
    await fs.writeFile(path.join(root,'restore-report.json'),JSON.stringify(report,null,2),{mode:0o600})
    return report
  } catch(error) { await client.query('ROLLBACK'); throw error }
}
module.exports={capture,validate,seal,unseal,restoreIsolated,manifest,references}
