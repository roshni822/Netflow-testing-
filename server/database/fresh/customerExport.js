'use strict'
// Customer portability package, deliberately different from recovery material.
const { validate } = require('./recovery')
const crypto = require('node:crypto')
const excluded = new Set(['user_auth','user_sessions','user_mfa_backup_codes','organization_integrations','organization_department_integrations','file_grants'])
const privateKey = /password|secret|token|jwt|credential|private[_-]?key|authorization|cookie|api[_-]?key|access[_-]?key|code[_-]?hash|mfa|reset[_-]?password|session[_-]?id|client[_-]?credential/i
const technical = new Set(['legacy_extra','legacy_refs','source_missing','row_version','api_version'])
const opaquePayloads = {
  notifications:['message','body','link'],
  integration_dead_letters:['payload','headers','response','error','last_error'],
  webhook_delivery_logs:['request','response','headers','request_body','response_body','error','error_message'],
  document_extraction_jobs:['error','error_message'],form_generation_jobs:['error','error_message']
}
function customerExport (bundle,{includeFiles=false}={}) {
  validate(bundle)
  const secrets=new Set()
  const learn=value=>{
    if(!value || typeof value!=='object') return
    for(const [key,item] of Object.entries(value)) {
      if(privateKey.test(key) && typeof item==='string' && item.length>=6) secrets.add(item)
      else if(item && typeof item==='object') learn(item)
    }
  }
  for(const records of Object.values(bundle.tables)) for(const raw of records) learn(JSON.parse(raw))
  const redactions=new Set()
  const scrub=(value,location)=>{
    if(typeof value==='string') {
      let clean=value
      for(const secret of secrets) if(clean.includes(secret)) {clean=clean.split(secret).join('[REDACTED]');redactions.add(location)}
      clean=clean.replace(/([?&](?:k|token|sig|signature|key|access_token)=)[^&#\s]*/gi,'$1[REDACTED]')
        .replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/gi,'$1[REDACTED]@')
      return clean
    }
    if(Array.isArray(value)) return value.map((v,i)=>scrub(v,location+'.'+i))
    if(!value || typeof value!=='object') return value
    const result={}
    for(const [key,item] of Object.entries(value)) {
      if(privateKey.test(key) || technical.has(key) || (['value','default','defaultValue'].includes(key) && privateKey.test(String(value.key || value.name || value.label || '')))) {
        redactions.add(location+'.'+key); continue
      }
      result[key]=scrub(item,location+'.'+key)
    }
    return result
  }
  const tables={}
  for(const [key,records] of Object.entries(bundle.tables)) {
    const [schema,table]=key.split('.')
    if(schema!=='tenant' || excluded.has(table)) continue
    tables[table]=records.map(raw=>{
      const row=JSON.parse(raw)
      for(const field of opaquePayloads[table] || []) if(field in row) {delete row[field];redactions.add(table+'.'+field)}
      return scrub(row,table)
    })
  }
  const organization=scrub(JSON.parse(bundle.tables['platform.organizations'][0]),'organization')
  delete organization.schema_name
  const files=includeFiles ? bundle.files.map(({key,size,sha256,base64})=>({key,size,sha256,base64})) : []
  return {format:'netflow-customer-export-v1',createdAt:new Date().toISOString(),orgId:bundle.orgId,organization,tables,files,
    manifest:{tables:Object.fromEntries(Object.entries(tables).map(([key,value])=>[key,{count:value.length,sha256:crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex')}])),
      excludedTables:[...excluded],excludedSharedData:['Platform accounts and authentication','Routing, provisioning, SSO and delivery queues'],
      redactions:[...redactions].sort(),filesIncluded:includeFiles,documentCount:files.length,
      purpose:'Customer business data; not a recovery backup. Deliver through your approved encrypted, access-controlled transfer channel.'}}
}
module.exports={customerExport}
