'use strict'
const assert=require('node:assert/strict')
const crypto=require('node:crypto')
const bcrypt=require('bcryptjs')
const Organization=require('../../models/Organization')
const {withSystemAccess}=require('../../database/context')
const {createOrganization,operationStatus,listOrganizations,resetAdminPassword,prepare,fingerprint}=require('../../database/fresh/provisioning')
const postgres=require('../../database/postgres')
const {TENANT_TABLES,tenantSchemaName}=require('../../database/fresh/manifest')
const {freshPeriod}=require('../../utils/licensing')
const {digest}=require('../../database/fresh/setup')
const fs=require('node:fs')
const path=require('node:path')
const key=()=>crypto.randomUUID()
const expectCode=code=>e=>e.code===code

async function provisioningChecks(owner,actorId) {
  process.env.PROVISIONING_FINGERPRINT_KEY=crypto.randomBytes(32).toString('hex')
  const build=(name,options={})=>{
    const body={name,subdomain:name.toLowerCase().replace(/[^a-z0-9]+/g,'-'),adminEmail:'initial@qa.test',features:{externalUsers:true},...options}
    const org=new Organization({name:body.name,subdomain:body.subdomain,features:body.features})
    org.usage.submissions=freshPeriod(org)
    return {actorId,key:key(),body,org,admin:{email:body.adminEmail,name:'Isolated Organization Admin',canBuild:false,countsTowardSeats:false},verifyIntegrations:async()=>{}}
  }
  const create=input=>withSystemAccess('platform',()=>createOrganization(input))
  const countSchemas=async()=>Number((await owner.query("SELECT count(*) FROM pg_namespace WHERE nspname LIKE 'tenant\_%'")).rows[0].count)
  const first=build('Provisioned Alpha')
  const started=Date.now()
  const made=await create(first)
  const duration=Date.now()-started
  assert.equal(made.org.schemaName,'tenant_provisioned_alpha')
  assert.equal(made.org.provisioningStatus,'ready')
  assert.equal(made.org.admin.email,first.body.adminEmail)
  assert.equal(made.org.usage.users,0)
  assert.equal(made.org.usage.builders,0)
  assert.equal(made.org.usage.usersTotal,1)
  assert.equal(made.admin.canBuild,false)
  assert.equal(made.admin.countsTowardSeats,false)
  assert.ok(made.admin.tempPassword)
  const stored=(await owner.query('SELECT password FROM tenant_provisioned_alpha.user_auth')).rows[0].password
  assert.equal(await bcrypt.compare(made.admin.tempPassword,stored),true)
  assert.equal((await owner.query('SELECT must_change_password FROM tenant_provisioned_alpha.users')).rows[0].must_change_password,true)
  assert.equal((await owner.query('SELECT count(*)::int n FROM tenant_provisioned_alpha.roles')).rows[0].n,6)
  assert.deepEqual((await owner.query("SELECT tablename FROM pg_tables WHERE schemaname='tenant_provisioned_alpha'")).rows.map(r=>r.tablename).sort(),[...TENANT_TABLES].sort())
  assert.equal((await owner.query('SELECT checksum FROM system.schema_migrations WHERE org_id=$1',[made.org._id])).rows[0].checksum,digest(fs.readFileSync(path.join(__dirname,'../../database/fresh/tenant/001_template.sql'),'utf8')))
  const replay=await create({...build(first.body.name),key:first.key})
  assert.equal(replay.org._id,made.org._id)
  assert.equal(replay.credentialsAlreadyIssued,true)
  assert.equal('tempPassword' in replay.admin,false)
  assert.equal((await owner.query('SELECT password FROM tenant_provisioned_alpha.user_auth')).rows[0].password,stored)
  await assert.rejects(create({...build('Different payload'),key:first.key}),expectCode('IDEMPOTENCY_CONFLICT'))
  await assert.rejects(create(build('Provisioned-Alpha',{subdomain:'different-address'})),expectCode('SCHEMA_NAME_TAKEN'))
  await assert.rejects(create(build('Different schema',{subdomain:first.body.subdomain})),expectCode('SUBDOMAIN_TAKEN'))
  await assert.rejects(create({...build('Missing key'),key:null}),expectCode('IDEMPOTENCY_KEY_REQUIRED'))
  await assert.rejects(create(build('!!!',{subdomain:'invalid-schema-name'})),expectCode('INVALID_SCHEMA_NAME'))
  const before=await countSchemas()
  await assert.rejects(create({...build('Invalid integration'),verifyIntegrations:async()=>{throw Object.assign(new Error('Integration rejected'),{code:'INTEGRATION_REJECTED'})}}),expectCode('INTEGRATION_REJECTED'))
  assert.equal(await countSchemas(),before)
  const operation=await withSystemAccess('platform',()=>operationStatus(actorId,made.operationId))
  assert.equal(operation.status,'succeeded'); assert.equal(operation.attempts,1)
  assert.equal(JSON.stringify(operation).includes(stored),false)
  await assert.rejects(withSystemAccess('platform',()=>operationStatus(crypto.randomBytes(12).toString('hex'),made.operationId)),expectCode('OPERATION_NOT_FOUND'))
  const raceKey=key()
  const races=await Promise.all(Array.from({length:3},()=>create({...build('Concurrent intent'),key:raceKey})))
  assert.equal(races.filter(r=>r.admin?.tempPassword).length,1)
  assert.equal((await owner.query("SELECT count(*)::int n FROM platform.organizations WHERE schema_name='tenant_concurrent_intent'")).rows[0].n,1)
  const nameRace=await Promise.allSettled([create(build('Name Collision')),create(build('Name-Collision',{subdomain:'name-collision-2'}))])
  assert.equal(nameRace.filter(r=>r.status==='fulfilled').length,1)
  assert.equal(nameRace.find(r=>r.status==='rejected').reason.code,'SCHEMA_NAME_TAKEN')

  const invalidSeed=build('Wrong seed owner')
  const bad=await prepare(invalidSeed.org,invalidSeed.admin)
  const badHash=fingerprint(invalidSeed.body)
  const badOp=await withSystemAccess('platform',async()=> (await postgres.query('SELECT system.reserve_organization($1,$2,$3,$4) AS op',[actorId,invalidSeed.key,badHash,bad.organization])).rows[0].op)
  bad.seed.users[0].org_id=crypto.randomBytes(12).toString('hex')
  await assert.rejects(withSystemAccess('platform',()=>postgres.query('SELECT system.provision_organization($1,$2,$3,$4)',[badOp.id,actorId,badHash,bad.seed])),e=>['42501','23514','23503'].includes(e.code))
  assert.equal((await owner.query("SELECT to_regnamespace('tenant_wrong_seed_owner') AS value")).rows[0].value,null,'A seed ownership failure rolls back DDL and already inserted roles')
  assert.equal((await owner.query('SELECT count(*)::int n FROM system.user_directory WHERE org_id=$1',[badOp.orgId])).rows[0].n,0)

  // Inject a late failure after every tenant table/seed has been written. The
  // audit is mandatory; a failure must roll back the schema, directory and admin.
  await owner.query(`CREATE FUNCTION system.test_provisioning_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Isolated audit failure'; END $$;
    CREATE TRIGGER test_provisioning_failure BEFORE INSERT ON platform.audit_logs FOR EACH ROW EXECUTE FUNCTION system.test_provisioning_failure()`)
  const failed=build('Retry after rollback')
  await assert.rejects(create(failed),expectCode('PROVISIONING_FAILED'))
  const failedRow=(await owner.query("SELECT id,provisioning_status,admin_user_id FROM platform.organizations WHERE schema_name='tenant_retry_after_rollback'")).rows[0]
  assert.equal(failedRow.provisioning_status,'failed'); assert.equal(failedRow.admin_user_id,null)
  assert.equal((await owner.query("SELECT to_regnamespace('tenant_retry_after_rollback') AS value")).rows[0].value,null)
  assert.equal((await owner.query('SELECT count(*)::int n FROM system.user_directory WHERE org_id=$1',[failedRow.id])).rows[0].n,0)
  await owner.query('DROP TRIGGER test_provisioning_failure ON platform.audit_logs; DROP FUNCTION system.test_provisioning_failure()')
  const recovered=await create({...build(failed.body.name),key:failed.key})
  assert.equal(recovered.org._id,failedRow.id)
  assert.equal(recovered.org.provisioningStatus,'ready')
  assert.equal((await withSystemAccess('platform',()=>operationStatus(actorId,recovered.operationId))).attempts,2)

  // A deferred failure is a commit-boundary failure, not merely an early input
  // validation error. A durable reservation may remain, but no tenant data may.
  await owner.query(`CREATE FUNCTION system.test_deferred_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Isolated deferred failure'; END $$;
    CREATE CONSTRAINT TRIGGER test_deferred_failure AFTER INSERT ON platform.audit_logs DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION system.test_deferred_failure()`)
  await assert.rejects(create(build('Deferred rollback')),expectCode('PROVISIONING_FAILED'))
  assert.equal((await owner.query("SELECT to_regnamespace('tenant_deferred_rollback') AS value")).rows[0].value,null)
  await owner.query('DROP TRIGGER test_deferred_failure ON platform.audit_logs; DROP FUNCTION system.test_deferred_failure()')

  // Simulate a process dying immediately after reservation. Its same intent can
  // safely resume; a conflicting pre-existing schema is never adopted/dropped.
  const crash=build('Resume reservation')
  const prepared=await prepare(crash.org,crash.admin)
  const reserved=await withSystemAccess('platform',async()=> (await postgres.query('SELECT system.reserve_organization($1,$2,$3,$4) AS op',[actorId,crash.key,fingerprint(crash.body),prepared.organization])).rows[0].op)
  const resumed=await create({...build(crash.body.name),key:crash.key})
  assert.equal(resumed.org._id,reserved.orgId)
  const conflict=build('Do not adopt')
  const conflictSeed=await prepare(conflict.org,conflict.admin)
  await withSystemAccess('platform',()=>postgres.query('SELECT system.reserve_organization($1,$2,$3,$4)',[actorId,conflict.key,fingerprint(conflict.body),conflictSeed.organization]))
  await owner.query('CREATE SCHEMA tenant_do_not_adopt; CREATE TABLE tenant_do_not_adopt.unrelated(id integer)')
  await assert.rejects(create({...build(conflict.body.name),key:conflict.key}),expectCode('SCHEMA_CONFLICT'))
  assert.ok((await owner.query("SELECT to_regclass('tenant_do_not_adopt.unrelated') AS value")).rows[0].value)
  await owner.query('UPDATE platform.organizations SET name=$2 WHERE id=$1',[made.org._id,'Display name changed'])
  assert.equal((await owner.query('SELECT schema_name FROM platform.organizations WHERE id=$1',[made.org._id])).rows[0].schema_name,'tenant_provisioned_alpha')

  const reset=await withSystemAccess('platform',()=>resetAdminPassword(actorId,made.org._id))
  const resetHash=(await owner.query('SELECT password FROM tenant_provisioned_alpha.user_auth')).rows[0].password
  assert.notEqual(resetHash,stored); assert.equal(await bcrypt.compare(reset.admin.tempPassword,resetHash),true)
  assert.equal((await owner.query('SELECT count(*)::int n FROM platform.audit_logs WHERE action=\'org_admin_password_reset\' AND target_org_id=$1',[made.org._id])).rows[0].n,1)
  const listed=await withSystemAccess('platform',()=>listOrganizations())
  assert.ok(listed.find(o=>o._id===made.org._id))
  const ownerInfo=(await owner.query("SELECT rolsuper,rolcanlogin,rolbypassrls FROM pg_roles WHERE rolname='netflow_provisioner'")).rows[0]
  assert.deepEqual(ownerInfo,{rolsuper:false,rolcanlogin:false,rolbypassrls:false})
  assert.equal((await owner.query("SELECT pg_has_role('netflow_app','netflow_provisioner','MEMBER') AS member")).rows[0].member,false)
  await withSystemAccess('platform',async()=>{
    for (const sql of ['CREATE SCHEMA forbidden_phase2','SET ROLE netflow_provisioner','ALTER TABLE tenant_provisioned_alpha.users ADD COLUMN forbidden text','TRUNCATE tenant_provisioned_alpha.users']) await assert.rejects(postgres.query(sql),expectCode('42501'))
    await assert.rejects(postgres.query('SELECT system.reserve_organization($1,$2,$3,$4)',[crypto.randomBytes(12).toString('hex'),key(),'0'.repeat(64),prepared.organization]),expectCode('42501'))
  })
  assert.equal((await postgres.getPool().query('SELECT count(*)::int n FROM tenant_provisioned_alpha.users')).rows[0].n,0)
  await require('./organizationSchemaUpgrade').upgradeChecks(owner)
  console.log(`PASS: Phase 2 provisioning, 33 tables, bcrypt admin, immutable placement, concurrent retries, collisions, rollback/recovery, credential replay/reset and restricted DDL; first creation ${duration}ms (isolated development measurement)`)
}
module.exports={provisioningChecks}
