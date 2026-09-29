'use strict'
const assert = require('node:assert/strict')
const { withSystemAccess } = require('../../database/context')
const management = require('../../database/fresh/management')
async function managementChecks ({ call, expect, owner, fixture, platformToken, platformId }) {
  const orgId=fixture.orgId
  const root='/platform/orgs/'+orgId
  const before=(await owner.query('SELECT schema_name FROM platform.organizations WHERE id=$1',[orgId])).rows[0]
  const otherBefore=(await owner.query('SELECT row_to_json(t)::text AS row FROM tenant_http_other_tenant.users t ORDER BY id')).rows
  const login=await call('/auth/login',null,{email:fixture.email,password:fixture.password,subdomain:fixture.workspace})
  expect(login,200,'Management fixture tenant login')
  const tenantToken=login.body.token
  const edit=await call(root,platformToken,{name:'Renamed HTTP tenant',billingEmail:'billing@qa.test',limits:{maxStorageMb:100}}, {},'PUT')
  expect(edit,200,'Platform composite edit')
  assert.equal(edit.body.org.name,'Renamed HTTP tenant')
  assert.equal(edit.body.org.schemaName,before.schema_name)
  assert.equal(edit.body.org.billingEmail,'billing@qa.test')
  const countBefore=(await owner.query('SELECT submissions_count FROM tenant_http_provisioning.organization_usage')).rows[0].submissions_count
  const planned=await call(root,platformToken,{plan:'basic',billingAnchorDay:17,licence:{validUntil:'2099-12-31T00:00:00.000Z'}},{},'PUT')
  expect(planned,200,'Assign existing plan and licence')
  assert.equal(planned.body.org.plan,'basic')
  assert.equal(planned.body.org.licence.validUntil,'2099-12-31T00:00:00.000Z')
  assert.equal(planned.body.org.billingAnchorDay,17)
  assert.equal((await owner.query('SELECT submissions_count FROM tenant_http_provisioning.organization_usage')).rows[0].submissions_count,countBefore,'Plan change preserves submissions')
  const credential=require('node:crypto').randomBytes(20).toString('hex')
  const configured=await call(root,platformToken,{integrations:{s3:{enabled:false,accessKeyId:credential,secretAccessKey:credential}}},{},'PUT')
  expect(configured,200,'Store disabled integration configuration without a provider request')
  assert.ok(!JSON.stringify(configured.body).includes(credential),'Management response masks stored credentials')
  expect(await call(root,platformToken,{integrations:{s3:configured.body.org.integrations.s3}},{},'PUT'),200,'Masked credentials survive a later edit')
  const stored=(await owner.query('SELECT s3_access_key_id,s3_secret_access_key FROM tenant_http_provisioning.organization_integrations')).rows[0]
  assert.equal(stored.s3_access_key_id,credential);assert.equal(stored.s3_secret_access_key,credential)
  expect(await call(root,tenantToken,{name:'Unauthorized'},{},'PUT'),403,'Tenant cannot use platform management')
  expect(await call(root+'/usage',platformToken),200,'Real per-tenant usage')
  expect(await call(root+'/storage-extension',platformToken,{extraMb:10,days:2,reason:'Isolated verification'}),200,'Storage extension')
  expect(await call(root+'/storage-extension',platformToken,null,{},'DELETE'),200,'Revoke storage extension')
  const suspended=await call(root+'/suspend',platformToken,{})
  expect(suspended,200,'Suspend organization')
  assert.equal(suspended.body.org.status,'suspended')
  expect(await call('/forms',tenantToken),403,'Suspended session cannot access tenant')
  expect(await call(root,platformToken,{name:'Managed while suspended'},{},'PUT'),200,'Suspended tenant remains administrable')
  expect(await call(root+'/usage',platformToken),200,'Suspended tenant usage remains visible')
  expect(await call(root+'/activate',platformToken,{}),200,'Reactivate organization')
  expect(await call('/forms',tenantToken),200,'Tenant access restored after activation')
  for (const path of ['/platform/overview','/platform/historical-stats','/platform/health']) expect(await call(path,platformToken),200,path)
  expect(await call(root,platformToken,null,{},'DELETE'),409,'Destructive deletion requires verified offboarding')
  await withSystemAccess('platform',async()=>{
    const first=await management.load(orgId); const stale=await management.load(orgId)
    first.name='Optimistic management'; await management.save(first,{user:{_id:platformId}},'org_updated')
    stale.name='Must not overwrite'; await assert.rejects(management.save(stale,{user:{_id:platformId}},'org_updated'),e=>e.code==='ORG_CHANGED')
    const postgres=require('../../database/postgres')
    await assert.rejects(postgres.query('SELECT system.manage_organization($1,$2,$3,$4::jsonb,$5::jsonb,$6)',
      [platformId,orgId,(await management.placementRow(orgId)).row_version,JSON.stringify({schema_name:'tenant_untrusted'}),'{}','org_updated']),e=>e.code==='P0001')
  })
  await withSystemAccess('authentication',async()=>assert.rejects(require('../../database/postgres').query(
    'SELECT system.manage_organization($1,$2,0,\'{}\',\'{}\',\'org_updated\')',[platformId,orgId]),e=>e.code==='42501'))
  const atomicBefore=(await owner.query('SELECT row_to_json(t)::text AS row FROM platform.organizations t WHERE id=$1',[orgId])).rows[0].row
  await owner.query("CREATE FUNCTION public.reject_phase5_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Isolated audit failure'; END; $$")
  await owner.query("CREATE TRIGGER isolated_audit_failure BEFORE INSERT ON platform.audit_logs FOR EACH ROW WHEN(NEW.action='org_updated') EXECUTE FUNCTION public.reject_phase5_audit()")
  try {
    expect(await call(root,platformToken,{name:'Must roll back with audit'},{},'PUT'),500,'Audit failure aborts organization change')
    assert.equal((await owner.query('SELECT row_to_json(t)::text AS row FROM platform.organizations t WHERE id=$1',[orgId])).rows[0].row,atomicBefore)
  } finally {
    await owner.query('DROP TRIGGER isolated_audit_failure ON platform.audit_logs')
    await owner.query('DROP FUNCTION public.reject_phase5_audit()')
  }
  const actions=(await owner.query('SELECT action FROM platform.audit_logs WHERE target_org_id=$1',[orgId])).rows.map(r=>r.action)
  for (const action of ['org_updated','org_suspended','org_activated','org_storage_extended','org_storage_extension_revoked']) assert.ok(actions.includes(action))
  assert.deepEqual((await owner.query('SELECT row_to_json(t)::text AS row FROM tenant_http_other_tenant.users t ORDER BY id')).rows,otherBefore)
  console.log('PASS: platform management, immutable schema, suspended access, usage/dashboard, atomic audit and stale-edit protection; other tenant unchanged')
}
module.exports={managementChecks}
