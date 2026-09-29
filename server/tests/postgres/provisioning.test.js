'use strict'
const crypto=require('node:crypto')
const assert=require('node:assert/strict')
const fs=require('node:fs')
const path=require('node:path')
const {localCluster}=require('./localCluster')
const {applyFreshSchema}=require('../../database/fresh/setup')
const {bootstrapPlatform}=require('../../database/fresh/bootstrap')
const postgres=require('../../database/postgres')

async function main() {
  process.env.NETFLOW_SKIP_DOTENV='1'
  process.env.DATABASE_LAYOUT='organization-schemas'
  assert.equal(fs.readFileSync(path.join(__dirname,'../../database/fresh/migrations/002_provisioning.sql'),'utf8'),require('../../database/fresh/provisioningSQL').generateProvisioningSQL())
  const cluster=await localCluster()
  try {
    await applyFreshSchema(cluster.owner)
    const admin=await bootstrapPlatform(cluster.owner,{name:'Isolated Phase 2 Admin',email:'phase2@qa.test',password:crypto.randomBytes(24).toString('base64url')})
    await cluster.owner.query('GRANT netflow_app TO netflow_verification_app')
    process.env.DATABASE_URL=cluster.appURL
    await postgres.connect()
    await require('./organizationProvisioning').provisioningChecks(cluster.owner,admin.adminId)
    const functions=(await cluster.owner.query(`SELECT p.prosecdef,p.proconfig,
      EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE a.grantee=0 AND a.privilege_type='EXECUTE') public_execute
      FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='system' AND p.proname IN ('reserve_organization','provision_organization','fail_provisioning','reset_organization_admin')`)).rows
    assert.equal(functions.length,4)
    for(const fn of functions) {
      assert.equal(fn.prosecdef,true)
      assert.equal(fn.public_execute,false)
      assert.ok(fn.proconfig.some(value=>value.replaceAll(' ','')==='search_path=pg_catalog,pg_temp'))
    }
    console.log('PASS: frozen migration, fixed privileged search paths, no PUBLIC execution and restricted function owner')
  } finally {await postgres.close();await cluster.stop()}
}
main().catch(error=>{console.error(JSON.stringify({failed:true,code:error.code||'PROVISIONING_TEST_FAILED',message:error.code==='ERR_ASSERTION'?error.message.split('\n')[0]:undefined}));process.exitCode=1})
