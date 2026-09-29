'use strict'
const assert=require('node:assert/strict')
const {Client}=require('pg')
const {migrations,digest,applyFreshSchema,verifySchema}=require('../../database/fresh/setup')

async function upgradeChecks(owner) {
  // A second database in this disposable cluster represents an existing Phase 1
  // install. Neither URL nor password is loaded from the application's .env.
  await owner.query('CREATE DATABASE netflow_phase1_upgrade')
  const config=owner.connectionParameters
  const client=new Client({host:config.host,port:config.port,user:config.user,password:config.password,database:'netflow_phase1_upgrade'})
  await client.connect()
  try {
    await client.query('BEGIN')
    const baseline=migrations().slice(0,3)
    for(const migration of baseline) await client.query(migration.sql)
    for(const migration of baseline) await client.query('INSERT INTO system.schema_migrations(schema_name,version,scope,checksum,release_id) VALUES($1,$2,$1,$3,$4)',[migration.schema,migration.version,digest(migration.sql),migration.release])
    await client.query("INSERT INTO platform.plans(id,key,label) VALUES(repeat('1',24),'upgrade-fixture','Preserve existing plan')")
    await client.query('COMMIT')
    const checksums=(await client.query('SELECT schema_name,version,checksum FROM system.schema_migrations ORDER BY schema_name,version')).rows
    const upgraded=await applyFreshSchema(client)
    assert.equal(upgraded.migrationsApplied,5)
    assert.equal((await client.query('SELECT label FROM platform.plans WHERE id=repeat(\'1\',24)')).rows[0].label,'Preserve existing plan')
    for(const record of checksums) assert.deepEqual((await client.query('SELECT schema_name,version,checksum FROM system.schema_migrations WHERE schema_name=$1 AND version=$2',[record.schema_name,record.version])).rows[0],record)
    assert.equal((await verifySchema(client)).version,'006')
    assert.equal((await applyFreshSchema(client)).alreadyApplied,true)
    console.log('PASS: additive Phase 1 → Phase 6 upgrade, existing data/checksum preservation and repeat no-op')
    // A separate Phase 3 installation has already issued workflow status links.
    // Verify the Phase 4 backfill preserves those exact capabilities and data.
    await owner.query('CREATE DATABASE netflow_phase3_upgrade')
    const prior = new Client({host:config.host,port:config.port,user:config.user,password:config.password,database:'netflow_phase3_upgrade'})
    await prior.connect()
    try {
      await prior.query('BEGIN')
      for (const migration of migrations().slice(0,5)) {
        await prior.query(migration.sql)
        if (migration.schema==='system' && migration.version==='001') {
          const platform = migrations()[0]
          await prior.query('INSERT INTO system.schema_migrations(schema_name,version,scope,checksum,release_id) VALUES($1,$2,$1,$3,$4)',[platform.schema,platform.version,digest(platform.sql),platform.release])
        }
        if (migration.schema==='system') await prior.query('INSERT INTO system.schema_migrations(schema_name,version,scope,checksum,release_id) VALUES($1,$2,$1,$3,$4)',[migration.schema,migration.version,digest(migration.sql),migration.release])
      }
      const template=require('../../database/fresh/setup').renderTenantTemplate('tenant_upgrade','1'.repeat(24))
      await prior.query("INSERT INTO platform.plans(id,key,label) VALUES(repeat('2',24),'custom','Custom')")
      await prior.query("INSERT INTO platform.organizations(id,name,subdomain,schema_name,provisioning_status,schema_version) VALUES(repeat('1',24),'Upgrade','upgrade','tenant_upgrade','ready','001')")
      await prior.query(template.sql)
      await prior.query("SELECT set_config('netflow.org_id',repeat('1',24),true)")
      await prior.query("INSERT INTO tenant_upgrade.roles(id,org_id,name,name_key) VALUES(repeat('3',24),repeat('1',24),'Admin','admin')")
      await prior.query("INSERT INTO tenant_upgrade.users(id,org_id,name,email,role,department) VALUES(repeat('4',24),repeat('1',24),'Upgrade','upgrade@qa.test',repeat('3',24),'IT')")
      await prior.query("INSERT INTO tenant_upgrade.forms(id,org_id,title,created_by,status,public_enabled,public_token) VALUES(repeat('5',24),repeat('1',24),'Preserved form',repeat('4',24),'published',true,'public-upgrade-capability')")
      await prior.query("INSERT INTO tenant_upgrade.workflows(id,org_id,title,created_by,status,inbound_webhook_enabled,inbound_webhook_token) VALUES(repeat('6',24),repeat('1',24),'Preserved workflow',repeat('4',24),'published',true,'hook-upgrade-capability')")
      await prior.query("INSERT INTO tenant_upgrade.workflow_executions(id,org_id,workflow_id,triggered_by,status_token) VALUES(repeat('7',24),repeat('1',24),repeat('6',24),repeat('4',24),'status-upgrade-capability')")
      await prior.query('COMMIT')
      assert.equal((await applyFreshSchema(prior)).migrationsApplied,3)
      const routes=(await prior.query('SELECT purpose,token_digest FROM system.resource_routes ORDER BY purpose')).rows
      assert.deepEqual(routes, [
        {purpose:'execution_status',token_digest:digest('status-upgrade-capability')},
        {purpose:'inbound_webhook',token_digest:digest('hook-upgrade-capability')},
        {purpose:'public_form',token_digest:digest('public-upgrade-capability')}
      ])
      assert.equal((await prior.query('SELECT title FROM tenant_upgrade.forms')).rows[0].title,'Preserved form')
      assert.equal((await applyFreshSchema(prior)).alreadyApplied,true)
      console.log('PASS: Phase 3 existing-tenant capability backfill and repeat upgrade')
    } finally { await prior.end() }
  } finally { await client.end() }
}
module.exports={upgradeChecks}
