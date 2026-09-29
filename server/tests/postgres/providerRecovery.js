'use strict'
const assert=require('node:assert/strict')
const path=require('node:path')
const fs=require('node:fs/promises')
const crypto=require('node:crypto')
const {Client}=require('pg')
const recovery=require('../../database/fresh/recovery')
const providers=require('../../database/fresh/providerRecovery')
const offboarding=require('../../database/fresh/offboarding')
async function providerChecks({owner,restored,bundle,output}) {
  // Extend only the disposable restored tenant, never the source fixture.
  const id=bundle.orgId, schema='"'+bundle.schema+'"'
  const actor=JSON.parse(bundle.tables['platform.admin_users'][0]).id
  await restored.query("SELECT set_config('netflow.system','platform',false)")
  await restored.query('SELECT system.archive_organization($1,$2,30,\'Isolated offboarding rehearsal\',false)',[actor,id])
  await restored.query(`UPDATE ${schema}.organization_integrations SET s3_enabled=true,s3_bucket='isolated-source-fixture',s3_access_key_id='fixture-only',s3_secret_access_key='fixture-only',
    dms_enabled=true,dms_base_url='https://source.example.test',dms_api_key='fixture-only'`)
  await restored.query(`INSERT INTO ${schema}.organization_department_integrations(owner_id,tenant_id,position,department,api_key,base_url,enabled)
    VALUES($1,$1,999,'Recovery','fixture-only','https://source-department.example.test',true)`,[id])
  const bytes=new Map([['dms:recovery-fixture',Buffer.from('Isolated department document')],['s3:'+id+'/proof.bin',Buffer.from('Isolated S3 document')]])
  const payload=[{dmsDocId:'recovery-fixture',dmsDepartment:'Recovery',url:'https://source.example.test/signed',name:'DMS fixture'},{s3Key:id+'/proof.bin',name:'S3 fixture'}]
  await restored.query(`UPDATE ${schema}.form_responses SET attachments=$1::jsonb,form_data=jsonb_set(form_data,'{precisionFixture}','9007199254740993123.00000001'::jsonb) WHERE id=(SELECT id FROM ${schema}.form_responses LIMIT 1)`,[JSON.stringify(payload)])
  for(const key of bytes.keys()) await restored.query(`INSERT INTO ${schema}.file_grants(path,org_id) VALUES($1,$2)`,[key,id])
  const connections=require('../../database/fresh/documentConnections')
  const sourceOrg={_id:id,integrations:{dmsBaseUrl:'https://source.example.test',departmentDms:[{department:'Recovery',baseUrl:'https://source-department.example.test',enabled:true}]}}
  await restored.query(`INSERT INTO system.resource_routes(purpose,token_digest,account_scope,org_id,resource_id)
    VALUES('document_connection',$1,'tenant',$2,$3)`,[connections.routeDigest(id,'recovery-fixture'),id,JSON.stringify(connections.value(sourceOrg,'Recovery'))])
  const loadRemote=async(key,org,route)=>{if(key.startsWith('dms:'))assert.equal(route.department,'Recovery');assert.equal(String(org._id),id);return bytes.get(key)}
  const options={orgId:id,uploadRoot:path.join(output,'uploads'),writersStopped:true,loadRemote}
  const captured=await recovery.capture(restored,options)
  assert.equal(captured.files.find(f=>f.key==='dms:recovery-fixture').department,'Recovery')
  assert.equal(captured.files.find(f=>f.key==='dms:recovery-fixture').name,'DMS fixture')
  const route=require('../../database/fresh/dmsRecoveryRoutes').routes(captured,providers.sourceOrganization(captured))
  assert.throws(()=>route('dms:unknown'),e=>e.code==='DMS_DOCUMENT_ROUTE_REQUIRED')
  const ambiguous=require('../../database/fresh/dmsRecoveryRoutes').routes(captured,providers.sourceOrganization(captured),{'dms:recovery-fixture':''})
  assert.throws(()=>ambiguous('dms:recovery-fixture'),e=>e.code==='DMS_DOCUMENT_CONNECTION_AMBIGUOUS')
  const passphrase=crypto.randomBytes(32).toString('hex'),encrypted=recovery.seal(captured,passphrase)
  await owner.query('CREATE DATABASE netflow_restore_phase6')
  const p=owner.connectionParameters,target=new Client({host:p.host,port:p.port,user:p.user,password:p.password,database:'netflow_restore_phase6'})
  await target.connect()
  try {
    const root=output+'-phase6'
    const report=await recovery.restoreIsolated(target,captured,{uploadRoot:root})
    await offboarding.recordVerification(restored,captured,encrypted,report,'netflow_restore_phase6')
    await assert.rejects(offboarding.purge(restored,captured,encrypted,{...options,confirmOrg:id}),e=>e.code==='RETENTION_AND_VERIFIED_ARCHIVE_REQUIRED')
    const config={isolated:true,integrations:{s3:{enabled:true,bucket:'isolated-destination-fixture',accessKeyId:'fixture-only',secretAccessKey:'fixture-only'},
      dmsEnabled:true,dmsBaseUrl:'https://destination.example.test',dmsApiKey:'fixture-only',departmentDms:[{department:'Recovery',baseUrl:'https://destination-department.example.test',apiKey:'fixture-only',enabled:true}]}}
    assert.throws(()=>providers.destination(providers.sourceOrganization(captured),{...config,integrations:{...config.integrations,s3:{...config.integrations.s3,bucket:'isolated-source-fixture'}}}),e=>e.code==='ISOLATED_S3_BUCKET_REQUIRED')
    const objects=new Map();let puts=0,corrupt=true
    const adapterFactory=async(org,file)=>({put:async(value,ref)=>{puts++;const key=file.key.startsWith('s3:') ? 's3:'+id+'/recovery/'+ref : 'dms:rehydrated-fixture';objects.set(key,value);return key},read:async key=>corrupt ? Buffer.from('Wrong readback') : objects.get(key)})
    await assert.rejects(providers.restoreProviders(target,captured,{config,root,adapterFactory}),e=>e.code==='PROVIDER_READBACK_MISMATCH')
    assert.equal((await target.query(`SELECT count(*)::int n FROM ${schema}.file_grants WHERE path='dms:recovery-fixture'`)).rows[0].n,1)
    corrupt=false
    assert.equal((await providers.restoreProviders(target,captured,{config,root,adapterFactory})).objects,2)
    assert.equal(puts,2,'Retry reuses previously uploaded object')
    assert.equal((await providers.restoreProviders(target,captured,{config,root,adapterFactory})).replayed,true)
    assert.equal(puts,2)
    assert.equal((await target.query(`SELECT count(*)::int n FROM ${schema}.file_grants WHERE path='dms:rehydrated-fixture'`)).rows[0].n,1)
    const values=(await target.query(`SELECT attachments,form_data->>'precisionFixture' AS exact FROM ${schema}.form_responses WHERE form_data ? 'precisionFixture'`)).rows[0]
    assert.equal(values.exact,'9007199254740993123.00000001')
    assert.equal(values.attachments[0].dmsDocId,'rehydrated-fixture');assert.equal(values.attachments[0].url,null)
    assert.equal((await target.query('SELECT status FROM platform.organizations')).rows[0].status,'suspended')
    // Expire only this disposable archive and verify source drift rejection.
    await restored.query("UPDATE system.tenant_lifecycle SET archived_at=now()-interval '2 days',purge_after=now()-interval '1 day'")
    await restored.query(`UPDATE ${schema}.forms SET title=title||' changed'`)
    await assert.rejects(offboarding.purge(restored,captured,encrypted,{...options,confirmOrg:id}),e=>e.code==='OFFBOARDING_SNAPSHOT_CHANGED')
    await restored.query(`UPDATE ${schema}.forms SET title=left(title,length(title)-8)`)
    // An external dependency must stop schema removal atomically.
    await restored.query(`CREATE VIEW public.protected_dependency AS SELECT id FROM ${schema}.forms`)
    await assert.rejects(offboarding.purge(restored,captured,encrypted,{...options,confirmOrg:id}),e=>e.code==='2BP01')
    assert.ok((await restored.query('SELECT to_regclass($1) present',[bundle.schema+'.users'])).rows[0].present)
    await restored.query('DROP VIEW public.protected_dependency')
    const deleted=await offboarding.purge(restored,captured,encrypted,{...options,confirmOrg:id})
    assert.equal(deleted.purged,true)
    assert.equal((await restored.query('SELECT to_regnamespace($1) present',[bundle.schema])).rows[0].present,null)
    assert.equal((await restored.query("SELECT count(*)::int n FROM system.user_directory WHERE account_scope='tenant' AND state<>'deleted'")).rows[0].n,0)
    await restored.query("UPDATE system.user_directory SET updated_at=now() WHERE account_scope='tenant'")
    assert.ok((await fs.readdir(path.join(output,'uploads',id))).length>0,'Original recovery files retained, no implicit provider deletion')
  } finally {await target.end()}
  console.log('PASS: department backup routing, isolated S3/DMS adapters, readback mismatch/retry, exact JSON numbers, scoped relinking and retention/proof/drift/dependency-protected offboarding')
}
module.exports={providerChecks}
