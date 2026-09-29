'use strict'
// Operator capability only. HTTP runtime has no DDL or proof-writing grants.
const { q }=require('../catalog')
const { TENANT_TABLES }=require('./manifest')
const { digest }=require('./setup')
const recovery=require('./recovery')
const fail=code=>Object.assign(new Error(code),{code})
function snapshot (bundle) {
  // Audit/proof registration changes no business data. Exclude those records to
  // avoid a circular proof; include every tenant table, route, queue and file.
  return digest(JSON.stringify({tables:Object.fromEntries(Object.entries(bundle.manifest.tables)
    .filter(([key])=>!['system.tenant_lifecycle','platform.audit_logs'].includes(key))),files:bundle.manifest.files}))
}
async function recordVerification (source,bundle,encrypted,report,restoreDatabase) {
  recovery.validate(bundle)
  if(!report.databaseCommitted || report.orgId!==bundle.orgId || !report.quarantined || !/^netflow_restore_[a-z0-9_]+$/.test(restoreDatabase)
    || Object.keys(report.tables).length!==Object.keys(bundle.tables).length
    || Object.entries(bundle.manifest.tables).some(([key,value])=>!report.tables[key]?.verified || report.tables[key].sha256!==value.sha256)
    || report.files.length!==bundle.files.length || report.files.some(f=>!f.verified || !bundle.files.some(b=>b.key===f.key && b.sha256===f.sha256))) throw fail('VERIFIED_RESTORE_REQUIRED')
  await source.query('BEGIN')
  try {
    await source.query("SELECT set_config('netflow.system','platform',true),pg_advisory_xact_lock(hashtextextended('tenant-operation:'||$1,0))",[bundle.orgId])
    const row=(await source.query(`UPDATE system.tenant_lifecycle l SET backup_digest=$2,snapshot_digest=$3,restore_database=$4,verified_at=now()
      FROM platform.organizations o WHERE l.org_id=$1 AND o.id=l.org_id AND o.provisioning_status='maintenance'
      AND o.status='suspended' AND o.deleted_at IS NULL AND l.purged_at IS NULL RETURNING l.org_id`,[bundle.orgId,digest(encrypted),snapshot(bundle),restoreDatabase])).rowCount
    if(row!==1) throw fail('ARCHIVED_TENANT_REQUIRED')
    await source.query(`INSERT INTO platform.audit_logs(id,performed_by,action,target_org_id,target_entity,detail,metadata)
      SELECT left(replace(gen_random_uuid()::text,'-',''),24),actor_admin_id,'org_purge_verified',org_id,'Archived organization',
        'Encrypted backup restored and verified in isolation',jsonb_build_object('backupDigest',backup_digest,'restoreDatabase',restore_database)
      FROM system.tenant_lifecycle WHERE org_id=$1`,[bundle.orgId])
    await source.query('COMMIT')
  } catch(error) {await source.query('ROLLBACK');throw error}
}
async function purge (client,bundle,encrypted,{confirmOrg,uploadRoot,loadRemote,writersStopped=false,dmsDepartments}) {
  if(confirmOrg!==bundle.orgId) throw fail('EXPLICIT_ORG_CONFIRMATION_REQUIRED')
  if(!writersStopped) throw fail('WRITERS_MUST_BE_STOPPED')
  recovery.validate(bundle)
  // Capture independently verifies every stored file and record. Keep a session
  // lock across capture and purge so ordinary tenant operations cannot interleave.
  await client.query("SELECT pg_advisory_lock(hashtextextended('tenant-operation:'||$1,0))",[bundle.orgId])
  try {
    const current=await recovery.capture(client,{orgId:bundle.orgId,uploadRoot,loadRemote,writersStopped,dmsDepartments})
    await client.query('BEGIN')
    try {
      await client.query("SELECT set_config('netflow.system','platform',true),set_config('netflow.org_id',$1,true)",[bundle.orgId])
      const org=(await client.query('SELECT * FROM platform.organizations WHERE id=$1 FOR UPDATE',[bundle.orgId])).rows[0]
      const proof=(await client.query('SELECT *,purge_after<=now() AS expired FROM system.tenant_lifecycle WHERE org_id=$1 FOR UPDATE',[bundle.orgId])).rows[0]
      if(!proof || !proof.expired || proof.purged_at || !proof.verified_at || org.provisioning_status!=='maintenance' || org.status!=='suspended') throw fail('RETENTION_AND_VERIFIED_ARCHIVE_REQUIRED')
      if(proof.backup_digest!==digest(encrypted) || proof.snapshot_digest!==snapshot(bundle) || snapshot(current)!==snapshot(bundle)) throw fail('OFFBOARDING_SNAPSHOT_CHANGED')
      // Resolve deferred profile consistency while profiles still exist. Marking
      // deleted profiles invokes the directory synchronization trigger.
      await client.query(`UPDATE ${q(bundle.schema)}.users SET deleted_at=now(),is_active=false`)
      await client.query('SET CONSTRAINTS ALL IMMEDIATE')
      await client.query('DELETE FROM system.resource_routes WHERE org_id=$1',[bundle.orgId])
      await client.query('DELETE FROM system.microsoft_identities WHERE user_id IN (SELECT user_id FROM system.user_directory WHERE org_id=$1)',[bundle.orgId])
      await client.query("UPDATE system.outbox SET status='failed',attempts=GREATEST(attempts,12),retry_at=NULL,payload='{}'::jsonb WHERE org_id=$1",[bundle.orgId])
      // One DROP list permits internal FKs. RESTRICT prevents removal of external
      // dependencies; there is deliberately no CASCADE, dynamic path or file delete.
      await client.query(`DROP TABLE ${TENANT_TABLES.map(t=>q(bundle.schema)+'.'+q(t)).join(',')} RESTRICT`)
      await client.query(`DROP SCHEMA ${q(bundle.schema)} RESTRICT`)
      await client.query("UPDATE platform.organizations SET provisioning_status='deleted',deleted_at=now(),updated_at=now(),row_version=row_version+1 WHERE id=$1",[bundle.orgId])
      await client.query('UPDATE system.tenant_lifecycle SET purged_at=now() WHERE org_id=$1',[bundle.orgId])
      await client.query(`INSERT INTO platform.audit_logs(id,performed_by,action,target_org_id,target_entity,detail,metadata)
        VALUES(left(replace(gen_random_uuid()::text,'-',''),24),$2,'org_deleted',$1,'Archived organization','Verified tenant schema removal',jsonb_build_object('backupDigest',$3::text,'retainedFileCount',$4::int))`,[bundle.orgId,proof.actor_admin_id,proof.backup_digest,bundle.files.length])
      await client.query('COMMIT')
      return {purged:true,orgId:bundle.orgId,retainedFiles:bundle.files.length,backupRetained:true,registryAndAuditRetained:true}
    } catch(error) {await client.query('ROLLBACK');throw error}
  } finally {await client.query("SELECT pg_advisory_unlock(hashtextextended('tenant-operation:'||$1,0))",[bundle.orgId])}
}
module.exports={snapshot,recordVerification,purge}
