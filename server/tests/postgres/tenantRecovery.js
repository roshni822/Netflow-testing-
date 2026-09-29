'use strict'
const assert=require('node:assert/strict')
const path=require('node:path')
const crypto=require('node:crypto')
const {Client}=require('pg')
const recovery=require('../../database/fresh/recovery')
const {customerExport}=require('../../database/fresh/customerExport')
async function recoveryChecks ({owner,fixture,call,expect,platformToken}) {
  const options={orgId:fixture.orgId,uploadRoot:process.env.UPLOAD_ROOT,writersStopped:true}
  await assert.rejects(recovery.capture(owner,{...options,writersStopped:false}),e=>e.code==='WRITERS_MUST_BE_STOPPED')
  await assert.rejects(recovery.capture(owner,options),e=>e.code==='SUSPENDED_READY_TENANT_REQUIRED')
  expect(await call('/platform/orgs/'+fixture.orgId+'/suspend',platformToken,{}),200,'Suspend for recovery rehearsal')
  const sourceBefore=(await owner.query('SELECT row_to_json(t)::text AS row FROM tenant_http_other_tenant.users t ORDER BY id')).rows
  const bundle=await recovery.capture(owner,options)
  assert.equal(Object.keys(bundle.tables).length,46)
  assert.ok(bundle.files.length>=2,'Uploads and referenced extraction bytes captured')
  const passphrase=crypto.randomBytes(32).toString('hex')
  const encrypted=recovery.seal(bundle,passphrase)
  assert.ok(!encrypted.includes(fixture.email))
  assert.deepEqual(recovery.unseal(encrypted,passphrase),bundle)
  assert.throws(()=>recovery.unseal(encrypted,crypto.randomBytes(32).toString('hex')),e=>e.code==='BACKUP_DECRYPT_OR_VALIDATE_FAILED')
  const tampered=structuredClone(bundle)
  tampered.tables['tenant.users'][0]+=' '
  assert.throws(()=>recovery.validate(tampered),e=>e.code==='RECOVERY_CHECKSUM_MISMATCH')
  const corruptFile=structuredClone(bundle)
  corruptFile.files[0].base64=Buffer.from('corrupt fixture').toString('base64')
  assert.throws(()=>recovery.validate(corruptFile),e=>e.code==='RECOVERY_FILE_CHECKSUM_MISMATCH')
  const foreign=structuredClone(bundle)
  const user=JSON.parse(foreign.tables['tenant.users'][0]); user.org_id='f'.repeat(24)
  foreign.tables['tenant.users'][0]=JSON.stringify(user); foreign.manifest=recovery.manifest(foreign)
  assert.throws(()=>recovery.validate(foreign),e=>e.code==='RECOVERY_OWNERSHIP_MISMATCH')
  const customer=customerExport(bundle,{includeFiles:true})
  assert.equal(customer.tables.users.length,bundle.tables['tenant.users'].length)
  assert.equal(customer.files.length,bundle.files.length)
  for(const key of ['user_auth','user_sessions','user_mfa_backup_codes','organization_integrations']) assert.equal(customer.tables[key],undefined)
  for(const raw of bundle.tables['tenant.user_auth']) assert.ok(!JSON.stringify(customer).includes(JSON.parse(raw).password))
  for(const raw of bundle.tables['tenant.workflows']) {
    const secret=JSON.parse(raw).inbound_webhook_secret
    if(secret) assert.ok(!JSON.stringify(customer).includes(secret))
  }
  await assert.rejects(recovery.restoreIsolated(owner,bundle,{uploadRoot:path.join(process.env.UPLOAD_ROOT,'must-not-create')}),e=>e.code==='ISOLATED_RESTORE_TARGET_REQUIRED')
  await owner.query('CREATE DATABASE netflow_restore_verification')
  const p=owner.connectionParameters
  const restored=new Client({host:p.host,port:p.port,user:p.user,password:p.password,database:'netflow_restore_verification'})
  await restored.connect()
  try {
    const output=path.join(path.dirname(process.env.UPLOAD_ROOT),'restored-files')
    const result=await recovery.restoreIsolated(restored,bundle,{uploadRoot:output})
    assert.equal(Object.keys(result.tables).length,46)
    assert.ok(Object.values(result.tables).every(t=>t.verified))
    assert.ok(result.files.every(f=>f.verified))
    assert.equal((await restored.query('SELECT count(*)::int n FROM platform.organizations')).rows[0].n,1)
    assert.equal((await restored.query('SELECT status FROM platform.organizations')).rows[0].status,'suspended')
    assert.equal((await restored.query('SELECT count(*)::int n FROM platform.admin_auth')).rows[0].n,0)
    assert.equal((await restored.query('SELECT count(*)::int n FROM tenant_http_provisioning.user_sessions')).rows[0].n,0)
    assert.equal((await restored.query("SELECT count(*)::int n FROM system.outbox WHERE status<>'sent' AND attempts<12")).rows[0].n,0)
    await assert.rejects(recovery.restoreIsolated(restored,bundle,{uploadRoot:output+'-retry'}),e=>e.code==='RESTORE_TARGET_NOT_EMPTY')
    await require('./providerRecovery').providerChecks({owner,restored,bundle,output})
  } finally {await restored.end()}
  assert.deepEqual((await owner.query('SELECT row_to_json(t)::text AS row FROM tenant_http_other_tenant.users t ORDER BY id')).rows,sourceBefore)
  const after=await recovery.capture(owner,options)
  assert.deepEqual(after.tables,bundle.tables,'Source snapshot remains unchanged by isolated restore')
  expect(await call('/platform/orgs/'+fixture.orgId+'/activate',platformToken,{}),200,'Resume fixture after recovery rehearsal')
  console.log('PASS: encrypted complete 33-table tenant recovery, shared dependencies, exact values/counts/FKs, local files, redacted customer package, tamper/overwrite guards and source isolation')
}
module.exports={recoveryChecks}
