'use strict'
require('../config/environment')()
const fs=require('node:fs/promises')
const path=require('node:path')
const {Client}=require('pg')
const {connectionOptions}=require('../database/postgres')
const {guardTarget}=require('../database/setup')
const recovery=require('../database/fresh/recovery')
const fail=code=>Object.assign(new Error(code),{code})
async function main () {
  const args=process.argv.slice(2), command=args[0]
  const arg=key=>{const i=args.indexOf('--'+key);return i<0 ? null : args[i+1]}
  if(!['backup','verify','customer-export','restore-verify','restore-providers','purge-archive'].includes(command)) throw fail('UNKNOWN_RECOVERY_COMMAND')
  if(!['development','staging'].includes(process.env.SETUP_ENV)) throw fail('RECOVERY_REHEARSAL_ENV_REQUIRED')
  const passphrase=process.env.TENANT_BACKUP_PASSPHRASE
  if(!passphrase || passphrase.length<32) throw fail('BACKUP_PASSPHRASE_REQUIRED')
  const providerRecovery=require('../database/fresh/providerRecovery')
  const dmsDepartments=arg('dms-map') ? JSON.parse(await fs.readFile(path.resolve(arg('dms-map')),'utf8')) : {}
  if(command==='backup') {
    guardTarget(args)
    if(!args.includes('--writers-stopped')) throw fail('WRITERS_MUST_BE_STOPPED')
    if(!arg('out') || !arg('org')) throw fail('ORG_AND_OUTPUT_REQUIRED')
    const client=new Client(connectionOptions('SETUP_DATABASE_URL'))
    try {
      await client.connect()
      const bundle=await recovery.capture(client,{orgId:arg('org'),uploadRoot:process.env.UPLOAD_ROOT || path.join(__dirname,'../uploads'),writersStopped:true,
        dmsDepartments,loadRemote:providerRecovery.readRemote})
      await fs.writeFile(path.resolve(arg('out')),recovery.seal(bundle,passphrase),{flag:'wx',mode:0o600})
      console.log(JSON.stringify({backedUp:true,orgId:bundle.orgId,tables:Object.keys(bundle.tables).length,files:bundle.files.length,encrypted:true,sourceStillSuspended:true}))
    } finally {await client.end()}
    return
  }
  if(!arg('in')) throw fail('INPUT_REQUIRED')
  const encrypted=await fs.readFile(path.resolve(arg('in')),'utf8')
  const bundle=recovery.unseal(encrypted,passphrase)
  if(command==='verify') return console.log(JSON.stringify({verified:true,orgId:bundle.orgId,tables:Object.keys(bundle.tables).length,files:bundle.files.length}))
  if(command==='customer-export') {
    if(!arg('out')) throw fail('OUTPUT_REQUIRED')
    const exported=require('../database/fresh/customerExport').customerExport(bundle,{includeFiles:args.includes('--include-files')})
    await fs.writeFile(path.resolve(arg('out')),JSON.stringify(exported),{flag:'wx',mode:0o600})
    return console.log(JSON.stringify({exported:true,orgId:bundle.orgId,customerPackage:true,files:exported.files.length}))
  }
  guardTarget(args)
  if(command==='purge-archive') {
    const client=new Client(connectionOptions('SETUP_DATABASE_URL'))
    try {
      await client.connect()
      const result=await require('../database/fresh/offboarding').purge(client,bundle,encrypted,{
        confirmOrg:arg('confirm-org'),writersStopped:args.includes('--writers-stopped'),
        uploadRoot:process.env.UPLOAD_ROOT || path.join(__dirname,'../uploads'),loadRemote:providerRecovery.readRemote,
        dmsDepartments:{...Object.fromEntries(bundle.files.filter(f=>f.department!==undefined).map(f=>[f.key,f.department])),...dmsDepartments}})
      console.log(JSON.stringify(result))
    } finally {await client.end()}
    return
  }
  const database=arg('database'), uploadRoot=arg('files')
  if(!database || !/^netflow_restore_[a-z0-9_]+$/.test(database) || !uploadRoot) throw fail('ISOLATED_RESTORE_TARGET_REQUIRED')
  const options=connectionOptions('SETUP_DATABASE_URL')
  const url=new URL(options.connectionString)
  if(decodeURIComponent(url.pathname.slice(1))===database) throw fail('ISOLATED_RESTORE_TARGET_REQUIRED')
  url.pathname='/'+database
  const configured=path.resolve(process.env.UPLOAD_ROOT || path.join(__dirname,'../uploads'))
  const destination=path.resolve(uploadRoot)
  const relative=path.relative(configured,destination)
  if(!relative || (!relative.startsWith('..') && !path.isAbsolute(relative))) throw fail('ISOLATED_FILE_TARGET_REQUIRED')
  const client=new Client({...options,connectionString:url.toString()})
  try {
    await client.connect()
    if(command==='restore-providers') {
      if(!arg('provider-config')) throw fail('ISOLATED_PROVIDER_CONFIG_REQUIRED')
      const config=JSON.parse(await fs.readFile(path.resolve(arg('provider-config')),'utf8'))
      const result=await providerRecovery.restoreProviders(client,bundle,{config,root:destination})
      console.log(JSON.stringify(result))
      return
    }
    const report=await recovery.restoreIsolated(client,bundle,{uploadRoot:destination})
    if(args.includes('--record-offboarding')) {
      const source=new Client(connectionOptions('SETUP_DATABASE_URL'))
      try {await source.connect();await require('../database/fresh/offboarding').recordVerification(source,bundle,encrypted,report,database)}
      finally {await source.end()}
    }
    console.log(JSON.stringify({restoredAndVerified:true,orgId:report.orgId,tables:Object.keys(report.tables).length,files:report.files.length,quarantined:report.quarantined}))
  } finally {await client.end()}
}
main().catch(error=>{console.error(JSON.stringify({failed:true,code:error.code || 'TENANT_RECOVERY_FAILED'}));process.exitCode=1})
