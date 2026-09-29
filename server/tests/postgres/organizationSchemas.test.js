'use strict'
// Intentional fixtures live exclusively in a newly-created disposable cluster.
// No .env loading, configured database, email, webhook or external storage calls.
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const { spawn } = require('node:child_process')
const { once } = require('node:events')
const { Client } = require('pg')
const jwt = require('jsonwebtoken')
const speakeasy = require('speakeasy')
const { localCluster } = require('./localCluster')
const { applyFreshSchema, renderTenantTemplate, verifySchema } = require('../../database/fresh/setup')
const { bootstrapPlatform } = require('../../database/fresh/bootstrap')
const { tenantSchemaName, TENANT_TABLES } = require('../../database/fresh/manifest')
const { generatePlatformSQL, generateTenantSQL } = require('../../database/fresh/schema')
const { withSystemAccess } = require('../../database/context')
const { runWithOrgId } = require('../../tenancy/tenantContext')
const postgres = require('../../database/postgres')
const id = () => crypto.randomBytes(12).toString('hex')
const password = () => crypto.randomBytes(24).toString('base64url')
const errorCode = code => error => error.code===code
let phase = 'initialization'

async function main () {
  process.env.NETFLOW_SKIP_DOTENV='1'
  process.env.DATABASE_LAYOUT='organization-schemas'
  assert.equal(generatePlatformSQL(),fs.readFileSync(path.join(__dirname,'../../database/fresh/migrations/001_platform.sql'),'utf8'))
  assert.equal(generateTenantSQL(),fs.readFileSync(path.join(__dirname,'../../database/fresh/tenant/001_template.sql'),'utf8'))
  assert.equal(tenantSchemaName('Netlink Software'),'tenant_netlink_software')
  assert.equal(tenantSchemaName('  Netlink--Software! '),'tenant_netlink_software')
  assert.throws(() => tenantSchemaName('a'.repeat(57)),errorCode('INVALID_SCHEMA_NAME'))
  assert.throws(() => tenantSchemaName('!!!'),errorCode('INVALID_SCHEMA_NAME'))
  assert.throws(() => renderTenantTemplate('tenant_x"; SELECT 1;--',id()),errorCode('INVALID_TENANT_PLACEMENT'))
  const cluster=await localCluster()
  const owner=cluster.owner
  process.env.UPLOAD_ROOT=path.join(cluster.directory,'uploads')
  try {
    phase='empty-target guards'
    await owner.query('CREATE TABLE public.unrelated_data(id integer)')
    await assert.rejects(applyFreshSchema(owner),errorCode('FRESH_TARGET_NOT_EMPTY'))
    await owner.query('DROP TABLE public.unrelated_data') // Isolated test fixture only.
    await owner.query("CREATE TYPE public.unrelated_status AS ENUM('pending')")
    await assert.rejects(applyFreshSchema(owner),errorCode('FRESH_TARGET_NOT_EMPTY'))
    await owner.query('DROP TYPE public.unrelated_status')
    await owner.query('CREATE SCHEMA netflow')
    await assert.rejects(applyFreshSchema(owner),errorCode('FRESH_TARGET_NOT_EMPTY'))
    await owner.query('DROP SCHEMA netflow')
    phase='apply baseline'
    assert.equal((await applyFreshSchema(owner)).applied,true)
    assert.equal((await applyFreshSchema(owner)).alreadyApplied,true)
    assert.equal((await verifySchema(owner)).tenantTemplateTables,33)
    await owner.query("BEGIN; UPDATE system.schema_migrations SET checksum=repeat('0',64) WHERE schema_name='platform'")
    await assert.rejects(verifySchema(owner),errorCode('FRESH_SCHEMA_MISMATCH'))
    await owner.query('ROLLBACK')
    phase='bootstrap'
    const credentials={name:'Isolated Platform Administrator',email:'platform@qa.test',password:password()}
    const bootstrap=await bootstrapPlatform(owner,credentials)
    assert.equal(bootstrap.initialized,true)
    const originalHash=(await owner.query('SELECT password FROM platform.admin_auth')).rows[0].password
    assert.equal((await bootstrapPlatform(owner,{...credentials,password:password()})).alreadyInitialized,true)
    assert.equal((await owner.query('SELECT password FROM platform.admin_auth')).rows[0].password,originalHash)
    await assert.rejects(bootstrapPlatform(owner,{...credentials,email:'other@qa.test'}),errorCode('BOOTSTRAP_IDENTITY_CONFLICT'))
    assert.equal((await owner.query('SELECT count(*)::int n FROM platform.organizations')).rows[0].n,0)
    assert.equal((await owner.query("SELECT count(*)::int n FROM pg_namespace WHERE nspname LIKE 'tenant\_%'")).rows[0].n,0)
    assert.equal((await owner.query('SELECT count(*)::int n FROM platform.plans')).rows[0].n,5)
    assert.deepEqual((await owner.query('SELECT account_scope,org_id FROM system.user_directory')).rows,[{account_scope:'platform',org_id:null}])
    console.log('PASS: guarded fresh baseline, exact retry/checksum, one platform admin, zero customer organizations/schemas')
    phase='runtime platform adapters'
    await owner.query('GRANT netflow_app TO netflow_verification_app')
    process.env.DATABASE_URL=cluster.appURL
    await postgres.connect()
    const User=require('../../models/User')
    await withSystemAccess('authentication',async () => {
      const user=await User.findById(bootstrap.adminId).populate('role')
      assert.equal(user.accountScope,'platform'); assert.equal(user.orgId,null)
      assert.equal(user.role.name,'SuperAdmin')
      assert.equal(await user.comparePassword(credentials.password),true)
      user.lastLogin=new Date()
      await user.save()
      await assert.rejects(postgres.transaction(() => runWithOrgId(id(),() => postgres.query('SELECT 1'))),errorCode('DATABASE_SCOPE_SWITCH'))
      await assert.rejects(require('../../models/Form').find({}).exec(),errorCode('DATABASE_SCOPE_REQUIRED'))
    })
    phase='tenant template'
    const tenants=[]
    for (const suffix of ['one','two']) {
      const orgId=id(); const schemaName=tenantSchemaName('Isolated '+suffix); const userId=id(); const roleId=id()
      const template=renderTenantTemplate(schemaName,orgId)
      await owner.query('BEGIN')
      try {
        await owner.query("SELECT set_config('netflow.org_id',$1,true)",[orgId])
        await owner.query('INSERT INTO platform.organizations(id,name,subdomain,schema_name) VALUES($1,$2,$3,$4)',[orgId,'Isolated '+suffix,'qa-'+suffix,schemaName])
        await owner.query(template.sql)
        await owner.query(`INSERT INTO "${schemaName}".roles(id,org_id,name,name_key,permissions) VALUES($1,$2,'SuperAdmin','superadmin',ARRAY['platform:manage_orgs'])`,[roleId,orgId])
        await owner.query(`INSERT INTO "${schemaName}".users(id,org_id,name,email,department,role,is_active) VALUES($1,$2,'Isolated User','platform@qa.test','IT',$3,true)`,[userId,orgId,roleId])
        await owner.query('UPDATE platform.organizations SET admin_user_id=$2 WHERE id=$1',[orgId,userId])
        await owner.query('INSERT INTO system.schema_migrations(schema_name,version,scope,org_id,checksum,release_id) VALUES($1,$2,\'tenant\',$3,$4,\'isolated-template-verification\')',[schemaName,template.version,orgId,template.checksum])
        await owner.query('COMMIT')
      } catch(error) { await owner.query('ROLLBACK'); throw error }
      const tables=(await owner.query('SELECT tablename FROM pg_tables WHERE schemaname=$1',[schemaName])).rows.map(r=>r.tablename).sort()
      assert.deepEqual(tables,[...TENANT_TABLES].sort())
      tenants.push({orgId,schemaName,userId})
    }
    const [a,b]=tenants
    await assert.rejects(owner.query('UPDATE platform.organizations SET admin_user_id=$2 WHERE id=$1',[a.orgId,b.userId]),errorCode('23503'))
    await assert.rejects(owner.query('UPDATE system.user_directory SET email_key=$2 WHERE user_id=$1',[a.userId,'drift@qa.test']),errorCode('23514'))
    await assert.rejects(owner.query('UPDATE platform.organizations SET schema_name=$2 WHERE id=$1',[a.orgId,'tenant_changed']),errorCode('23514'))
    await assert.rejects(owner.query('INSERT INTO platform.organizations(id,name,subdomain,schema_name) VALUES($1,$2,$3,$4)',[id(),'Collision','collision',a.schemaName]),errorCode('23505'))
    const runtime=new Client({connectionString:cluster.appURL})
    await runtime.connect()
    try {
      assert.equal((await runtime.query('SELECT count(*)::int n FROM platform.admin_users')).rows[0].n,0)
      assert.equal((await runtime.query(`SELECT count(*)::int n FROM "${a.schemaName}".users`)).rows[0].n,0)
      await runtime.query("SELECT set_config('netflow.system','worker',false)")
      assert.equal((await runtime.query(`SELECT count(*)::int n FROM "${a.schemaName}".users`)).rows[0].n,0,'Service context never bypasses tenant RLS')
      await runtime.query("SELECT set_config('netflow.org_id',$1,false)",[a.orgId])
      assert.equal((await runtime.query(`SELECT count(*)::int n FROM "${a.schemaName}".users`)).rows[0].n,1)
      assert.equal((await runtime.query(`SELECT count(*)::int n FROM "${b.schemaName}".users`)).rows[0].n,0)
      await assert.rejects(runtime.query(`INSERT INTO "${b.schemaName}".roles(id,org_id,name,name_key) VALUES($1,$2,'x','x')`,[id(),a.orgId]),e=>['42501','23514'].includes(e.code))
      for (const sql of ['CREATE SCHEMA forbidden',`ALTER TABLE "${a.schemaName}".users ADD COLUMN forbidden text`,`TRUNCATE "${a.schemaName}".users`,`DROP TABLE "${a.schemaName}".users`]) {
        await assert.rejects(runtime.query(sql),errorCode('42501'))
      }
      // GRANT without grant options can return a warning/no-op. Check its ACL.
      await runtime.query(`GRANT ALL ON "${a.schemaName}".users TO PUBLIC`)
      assert.equal((await runtime.query(`SELECT EXISTS(SELECT 1 FROM pg_class c,aclexplode(c.relacl) a
        WHERE c.oid=$1::regclass AND a.grantee=0) AS public_access`,[a.schemaName+'.users'])).rows[0].public_access,false)
      await runtime.query('BEGIN')
      await runtime.query(`UPDATE "${a.schemaName}".users SET email='updated@qa.test' WHERE id=$1`,[a.userId])
      assert.equal((await runtime.query('SELECT email_key FROM system.user_directory WHERE user_id=$1',[a.userId])).rows[0].email_key,'updated@qa.test')
      await runtime.query('ROLLBACK')
      assert.equal((await runtime.query('UPDATE system.user_directory SET email_key=$2 WHERE user_id=$1',[a.userId,'forged@qa.test'])).rowCount,0,'Direct directory mutation is hidden by RLS')
      await runtime.query(`INSERT INTO "${a.schemaName}".notifications(id,org_id,user_id,title,message,type,triggered_by) VALUES($1,$2,$3,'Fixture','Fixture','system',$4)`,[id(),a.orgId,a.userId,bootstrap.adminId])
      await assert.rejects(runtime.query(`INSERT INTO "${a.schemaName}".notifications(id,org_id,user_id,title,message,type,triggered_by) VALUES($1,$2,$3,'Fixture','Fixture','system',$4)`,[id(),a.orgId,a.userId,b.userId]),errorCode('23514'))
    } finally { await runtime.end() }
    await Promise.all(Array.from({length:12},(_,index)=>{
      const tenant=tenants[index%2]
      return runWithOrgId(tenant.orgId,()=>postgres.transaction(async client=>{
        assert.equal((await client.query(`SELECT id FROM "${tenant.schemaName}".users`)).rows[0].id,tenant.userId)
        assert.equal((await client.query(`SELECT count(*)::int n FROM "${tenants[(index+1)%2].schemaName}".users`)).rows[0].n,0)
      }))
    }))
    assert.equal((await postgres.getPool().query(`SELECT count(*)::int n FROM "${a.schemaName}".users`)).rows[0].n,0,'Pooled connections do not retain tenant scope')
    assert.equal((await bootstrapPlatform(owner,{...credentials,password:password()})).alreadyInitialized,true,'Setup retry after organizations exist is harmless')
    console.log('PASS: all 33 tenant tables, local references, name collisions, RLS isolation, directory synchronization and restricted runtime')
    phase='HTTP authentication'
    await httpChecks(cluster.appURL,credentials,bootstrap.adminId,owner)
    phase='Phase 2 provisioning'
    await require('./organizationProvisioning').provisioningChecks(owner,bootstrap.adminId)
    console.log('PASS: Phases 1-6 organization schemas (isolated database only)')
  } finally { await postgres.close(); await cluster.stop() }
}

async function httpChecks (appURL,credentials,adminId,owner) {
  const secret=password(); const port=15550
  const child=spawn(process.execPath,['server.js'],{cwd:path.join(__dirname,'../..'),windowsHide:true,
    env:{SystemRoot:process.env.SystemRoot,PATH:process.env.PATH,TEMP:process.env.TEMP,NODE_ENV:'test',NETFLOW_SKIP_DOTENV:'1',
      DATABASE_LAYOUT:'organization-schemas',DATABASE_URL:appURL,JWT_SECRET:secret,PROVISIONING_FINGERPRINT_KEY:password(),PAUSE_BACKGROUND_JOBS:'1',DISABLE_RATE_LIMIT:'1',PORT:String(port),DMS_ENABLED:'false',UPLOAD_ROOT:process.env.UPLOAD_ROOT,PDF_AUTOFILL_ENABLED:'true'},
    stdio:['ignore','pipe','pipe']})
  let startupOutput=''
  child.stdout.on('data',()=>{})
  child.stderr.on('data',data=>{startupOutput=(startupOutput+data.toString()).slice(-8000)})
  const call=async (route,token,body,headers={},method=body ? 'POST' : 'GET') => {
    const response=await fetch(`http://127.0.0.1:${port}/api${route}`,{method,
      headers:{'Content-Type':'application/json',...headers,...(token ? {Authorization:'Bearer '+token} : {})},...(body ? {body:JSON.stringify(body)} : {})})
    return {status:response.status,body:await response.json()}
  }
  const expect= (response,status,label) => assert.equal(response.status,status,`${label}: ${response.body.code || 'response'}`)
  try {
    let ready=false
    for(let i=0;i<100;i++) {
      if(child.exitCode!==null) throw new Error('Isolated server startup failed: '+(startupOutput.match(/code: '([A-Z0-9_]+)'/)?.[1] || 'unknown'))
      try { if((await call('/health')).status===200) {ready=true;break} } catch {}
      await new Promise(resolve=>setTimeout(resolve,200))
    }
    assert.ok(ready,'Isolated server starts')
    expect(await call('/ready'),503,'Foundation is not advertised as production ready')
    const ambiguousLogin=await call('/auth/login',null,{email:credentials.email,password:credentials.password})
    const unknownLogin=await call('/auth/login',null,{email:'missing@qa.test',password:credentials.password})
    expect(ambiguousLogin,401,'Ambiguous email does not disclose account choices')
    assert.deepEqual(ambiguousLogin,unknownLogin,'Missing and ambiguous accounts share status and response body')
    const ambiguousReset=await call('/auth/forgot-password',null,{email:credentials.email})
    const unknownReset=await call('/auth/forgot-password',null,{email:'missing@qa.test'})
    expect(ambiguousReset,200,'Ambiguous recovery remains generic')
    assert.deepEqual(ambiguousReset,unknownReset,'Recovery does not reveal account count')
    expect(await call('/auth/login',null,{email:credentials.email,password:credentials.password,subdomain:'qa-one'}),503,'Tenant login cannot fall through to platform')
    const login=await call('/auth/login',null,{...credentials,accountScope:'platform'})
    expect(login,200,'Platform password login')
    const token=login.body.token
    assert.ok(token)
    assert.equal(login.body.user.accountScope,'platform'); assert.equal(login.body.user.orgId,null)
    assert.equal('password' in login.body.user,false)
    const claims=jwt.verify(token,secret)
    assert.equal(claims.scope,'platform'); assert.equal('org' in claims,false)
    expect(await call('/auth/me',token),200,'Platform has no default organization dependency')
    for(const route of ['/platform/admins','/platform/plans','/platform/activity']) expect(await call(route,token),200,route)
    expect(await call('/platform/orgs',token,{}),400,'Provisioning validates required fields')
    const orgBody={name:'HTTP Provisioning',subdomain:'http-provisioning',adminEmail:'http@qa.test',features:{externalUsers:true}}
    const requestHeaders={'Idempotency-Key':crypto.randomUUID()}
    expect(await call('/platform/orgs',null,orgBody,requestHeaders),401,'Organization creation requires a session')
    expect(await call('/platform/orgs',token,orgBody),400,'Organization creation requires an idempotency UUID')
    const provisioned=await call('/platform/orgs',token,orgBody,requestHeaders)
    expect(provisioned,201,'Atomic organization creation')
    assert.equal(provisioned.body.org.schemaName,'tenant_http_provisioning')
    assert.ok(provisioned.body.admin.tempPassword)
    const repeated=await call('/platform/orgs',token,orgBody,requestHeaders)
    expect(repeated,200,'Organization replay')
    assert.equal(repeated.body.org._id,provisioned.body.org._id)
    assert.equal(repeated.body.credentialsAlreadyIssued,true)
    assert.equal('tempPassword' in repeated.body.admin,false)
    expect(await call('/platform/orgs',token,{...orgBody,name:'Changed payload'},requestHeaders),409,'Changed request key rejected')
    const operation=await call('/platform/provisioning/'+provisioned.body.operationId,token)
    expect(operation,200,'Authorized operation status')
    assert.equal(operation.body.operation.status,'succeeded')
    const listed=await call('/platform/orgs?q=HTTP&sort=name&page=1&limit=1',token)
    expect(listed,200,'Organization management list')
    assert.equal(listed.body.orgs[0]._id,provisioned.body.org._id)
    const tenantFixture = await require('./tenantRouting').tenantRoutingChecks({ call, expect, owner, provisioned: provisioned.body, orgBody, platformToken: token, secret })
    if(process.env.NETFLOW_SCHEMA_BROWSER_TEST==='1') await require('./organizationProvisioningBrowser').browserChecks(login.body, tenantFixture)
    await require('./tenantIntegrations').integrationChecks({call,expect,owner,fixture:tenantFixture,port,platformId:adminId})
    await require('./tenantManagement').managementChecks({call,expect,owner,fixture:tenantFixture,platformToken:token,platformId:adminId})
    await require('./platformOperations').operationsChecks({call,expect,owner,fixture:tenantFixture,platformToken:token,platformId:adminId})
    await require('./tenantRecovery').recoveryChecks({call,expect,owner,fixture:tenantFixture,platformToken:token})
    expect(await call('/platform/orgs/'+provisioned.body.org._id+'/reset-admin-password',token,{}),200,'Lost credential recovery action')
    expect(await call('/auth/login',null,{email:orgBody.adminEmail,password:provisioned.body.admin.tempPassword,subdomain:orgBody.subdomain}),401,'Reset invalidates the original tenant password')
    for(const payload of [{id:claims.id,tv:claims.tv,sid:claims.sid},{...claims,scope:'tenant',org:id()},{...claims,org:id()}]) {
      delete payload.iat; delete payload.exp
      expect(await call('/auth/me',jwt.sign(payload,secret,{expiresIn:'10m'})),401,'Reject unscoped or mismatched token')
    }
    const setup=await call('/auth/mfa/setup',token,{})
    expect(setup,200,'MFA setup')
    const totp=()=>speakeasy.totp({secret:setup.body.manualKey,encoding:'base32'})
    const enabled=await call('/auth/mfa/enable',token,{code:totp()})
    expect(enabled,200,'MFA enable')
    const challenge=await call('/auth/login',null,{...credentials,accountScope:'platform'})
    assert.equal(challenge.body.mfaRequired,true)
    expect(await call('/auth/me',challenge.body.challenge),401,'Challenge is not a session')
    const completed=await call('/auth/mfa/verify',null,{challenge:challenge.body.challenge,code:enabled.body.backupCodes[0]})
    expect(completed,200,'MFA backup code sign-in')
    expect(await call('/auth/mfa/verify',null,{challenge:challenge.body.challenge,code:enabled.body.backupCodes[0]}),401,'Backup code cannot replay')
    expect(await call('/auth/mfa/disable',completed.body.token,{code:totp()}),200,'MFA disable')
    expect(await call('/auth/logout',token,{}),200,'Logout')
    expect(await call('/auth/me',token),401,'Revoked session')
    const nextPassword=password()
    expect(await call('/auth/change-password',completed.body.token,{currentPassword:credentials.password,newPassword:nextPassword}),200,'Password change')
    expect(await call('/auth/me',completed.body.token),401,'Password change revokes old tokens')
    const resetToken=await withSystemAccess('authentication',async()=>{
      const user=await require('../../models/User').findById(adminId)
      const raw=user.createPasswordResetToken(); await user.save(); return raw
    })
    assert.equal((await owner.query("SELECT count(*)::int n FROM system.resource_routes WHERE purpose='password_reset'")).rows[0].n,1)
    const resetPassword=password()
    expect(await call('/auth/reset-password',null,{email:credentials.email,token:resetToken,password:resetPassword}),200,'Routed password reset')
    expect(await call('/auth/reset-password',null,{email:credentials.email,token:resetToken,password:password()}),400,'Reset token cannot replay')
    assert.equal((await owner.query("SELECT count(*)::int n FROM system.resource_routes WHERE purpose='password_reset'")).rows[0].n,0)
    const wrong=()=>call('/auth/login',null,{email:credentials.email,password:'intentionally-invalid',accountScope:'platform'})
    for(let i=0;i<4;i++) expect(await wrong(),401,'Failed login counted')
    expect(await wrong(),423,'Account lockout')
    expect(await call('/auth/login',null,{email:credentials.email,password:resetPassword,accountScope:'platform'}),423,'Lockout enforced')
    assert.equal((await owner.query('SELECT count(*)::int n FROM platform.organizations')).rows[0].n,process.env.NETFLOW_SCHEMA_BROWSER_TEST==='1' ? 5 : 4,'Only deliberate isolated fixture organizations exist')
    console.log('PASS: real HTTP login, account ambiguity, scoped JWTs, MFA, reset, password change, session revocation and lockout')
  } finally {
    if(child.exitCode===null) { child.kill('SIGTERM'); await once(child,'exit') }
  }
}
main().catch(error=>{
  console.error(JSON.stringify({failed:true,phase,code:error.code,table:error.table,constraint:error.constraint,
    message:error.code==='ERR_ASSERTION' ? error.message.split('\n')[0] : error.code ? undefined : error.message,position:error.position,
    source:error.stack?.split('\n').find(line=>/fresh[\\/]|providerRecovery.js|platformOperations.js/.test(line))?.trim(),
    location:error.stack?.split('\n').find(line=>line.includes('organizationSchemas.test.js:'))?.trim()}))
  process.exitCode=1
})
