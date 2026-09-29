'use strict'
// Platform mutations always commit together with their audit record.
const { transaction, query } = require('../postgres')
const { requirePlatform } = require('./management')
const { newId } = require('../ids')
const Plan = require('../../models/Plan')
const User = require('../../models/User')
const Role = require('../../models/Role')
const { generatePassword } = require('../../utils/password')
const fail = (code, message, statusCode=400) => Object.assign(new Error(message), {code,statusCode})
async function audit (client, actor, action, metadata={}, orgId=null) {
  await client.query(`INSERT INTO platform.audit_logs(id,performed_by,action,target_entity,target_org_id,detail,metadata)
    VALUES($1,$2,$3,$4,$5,$6,$7)`,[newId(),String(actor),action,orgId || 'platform',orgId,'Platform administration',JSON.stringify(metadata)])
}
async function operation (actor, lock, fn) {
  requirePlatform()
  return transaction(async client => {
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['platform:'+lock])
    const authorized=await client.query(`SELECT 1 FROM platform.admin_users u JOIN platform.admin_roles r ON r.id=u.role_id
      WHERE u.id=$1 AND u.deleted_at IS NULL AND u.is_active IS TRUE AND r.name_key='superadmin'
        AND 'platform:manage_orgs'=ANY(r.permissions)`,[String(actor)])
    if(!authorized.rowCount) throw fail('PLATFORM_ACCESS_REQUIRED','Active platform administrator access is required.',403)
    return fn(client)
  })
}
function planInput (input, previous={}) {
  const value={...previous,limits:{...previous.limits},features:{...previous.features}}
  if(input.label!==undefined) {
    if(typeof input.label!=='string' || !input.label.trim() || input.label.length>100) throw fail('INVALID_PLAN','Enter a plan name of 1–100 characters.')
    value.label=input.label.trim()
  }
  if(input.trialDays!==undefined) {
    if(input.trialDays!==null && (!Number.isSafeInteger(input.trialDays) || input.trialDays<1 || input.trialDays>3650)) throw fail('INVALID_PLAN','Trial days must be an integer from 1 to 3650, or null.')
    value.trialDays=input.trialDays
  }
  if(input.limits!==undefined) {
    if(!input.limits || Array.isArray(input.limits) || typeof input.limits!=='object') throw fail('INVALID_PLAN','Invalid plan limits.')
    const allowed=Object.values(require('../../config/plans').LIMIT_FIELD)
    for(const [key,n] of Object.entries(input.limits)) {
      if(!allowed.includes(key) || !Number.isSafeInteger(n) || n<0) throw fail('INVALID_PLAN','Limits must be nonnegative whole numbers; zero means unlimited.')
      value.limits[key]=n
    }
  }
  if(input.features!==undefined) {
    if(!input.features || Object.keys(input.features).some(k=>k!=='pdfAutoFill') || typeof input.features.pdfAutoFill!=='boolean') throw fail('INVALID_PLAN','Invalid plan features.')
    value.features={pdfAutoFill:input.features.pdfAutoFill}
  }
  return value
}
async function plan (actor, action, key, input={}) {
  if(typeof key!=='string' || !/^[a-z0-9-]{1,48}$/.test(key)) throw fail('INVALID_PLAN','Use a short lowercase plan key containing letters, numbers or hyphens.')
  if(key==='custom') throw fail('PROTECTED_PLAN','The custom plan is reserved.')
  const result=await operation(actor,'plans',async client=>{
    let current=await Plan.findOne({key})
    if(action==='create') {
      if(current) throw fail('PLAN_EXISTS','This plan key already exists.',409)
      const data=planInput(input)
      if(!data.label) throw fail('INVALID_PLAN','Plan name is required.')
      current=await Plan.create({...data,key,isCustom:false})
    } else {
      if(!current) throw fail('PLAN_NOT_FOUND','Plan not found.',404)
      if(action==='delete') {
        // Include archived/deleted registry entries: their contract remains a dependency.
        if((await client.query('SELECT 1 FROM platform.organizations WHERE plan=$1 LIMIT 1',[key])).rowCount) throw fail('PLAN_IN_USE','This plan is assigned to an organization.',409)
        await Plan.deleteOne({key})
      } else {
        const data=planInput(input,current.toObject())
        for(const field of ['label','trialDays','limits','features']) if(data[field]!==undefined) current.set(field,data[field])
        await current.save()
      }
    }
    await audit(client,actor,'plan_'+({create:'created',update:'updated',delete:'deleted'}[action]),{key})
    return action==='delete' ? {deleted:true} : {plan:current.toObject()}
  })
  await require('../../config/plans').reloadPlans()
  return result
}
async function admin (actor, action, id, input={}) {
  return operation(actor,'admins',async client=>{
    const role=await Role.findOne({name:'SuperAdmin'})
    if(!role) throw fail('ADMIN_ROLE_MISSING','Platform role is missing.',409)
    let user, tempPassword
    if(action==='create') {
      const email=typeof input.email==='string' ? input.email.trim().toLowerCase() : ''
      const name=typeof input.name==='string' ? input.name.trim() : ''
      if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length>254 || !name || name.length>100) throw fail('INVALID_ADMIN','Enter a name and a valid email address.')
      // Email-only login cannot disambiguate accounts; reject duplicate directory identities.
      if((await client.query("SELECT 1 FROM system.user_directory WHERE email_key=$1 AND state<>'deleted'",[email])).rowCount) throw fail('EMAIL_UNAVAILABLE','This email cannot be used for a new account.',409)
      tempPassword=generatePassword(18)
      user=await User.create({name,email,password:tempPassword,role:role._id,department:'IT',mustChangePassword:true,
        isActive:true,isProtected:false,canBuild:false,countsTowardSeats:false})
    } else {
      if(!/^[a-f0-9]{24}$/.test(String(id))) throw fail('ADMIN_NOT_FOUND','Platform admin not found.',404)
      user=await User.findOne({_id:id,role:role._id})
      if(!user) throw fail('ADMIN_NOT_FOUND','Platform admin not found.',404)
      if(action==='deactivate') {
        if(String(actor)===String(id) || user.isProtected) throw fail('PROTECTED_ADMIN','Your own account and the protected administrator cannot be deactivated.',409)
        if(await User.countDocuments({role:role._id,isActive:true})<=1) throw fail('LAST_ADMIN','At least one active platform administrator is required.',409)
      }
      if(action==='reset-password') {
        tempPassword=generatePassword(18)
        user.password=tempPassword
        user.mustChangePassword=true
        user.failedLoginAttempts=0; user.lockUntil=null
        user.resetPasswordToken=null; user.resetPasswordExpires=null
      } else user.isActive=action==='activate'
      if(action!=='activate') { user.tokenVersion=Number(user.tokenVersion || 0)+1; user.activeSessions=[] }
      await user.save()
    }
    const event={create:'created','reset-password':'password_reset',activate:'activated',deactivate:'deactivated'}[action]
    await audit(client,actor,'platform_admin_'+event,{adminUserId:String(user._id)})
    return {admin:{_id:user._id,name:user.name,email:user.email,isActive:user.isActive,...(tempPassword ? {tempPassword} : {})}}
  })
}
async function broadcast (actor,input) {
  const message=typeof input.message==='string' ? input.message.trim() : ''
  const severity=input.severity || 'info', expiresAt=new Date(input.expiresAt)
  const targets=input.orgIds===undefined || input.orgIds===null ? null : input.orgIds
  if(!message || message.length>500 || !['info','warning','critical'].includes(severity) || !Number.isFinite(+expiresAt) || +expiresAt<=Date.now()) throw fail('INVALID_BROADCAST','Enter a message, severity and a future expiry.')
  if(targets!==null && (!Array.isArray(targets) || !targets.length || targets.length>1000 || targets.some(id=>typeof id!=='string' || !/^[a-f0-9]{24}$/.test(id)) || new Set(targets).size!==targets.length)) throw fail('INVALID_BROADCAST_TARGETS','Select valid organizations or all organizations.')
  return operation(actor,'broadcasts',async client=>{
    if(targets && (await client.query("SELECT id FROM platform.organizations WHERE id=ANY($1::text[]) AND deleted_at IS NULL AND provisioning_status='ready'",[targets])).rowCount!==targets.length) throw fail('INVALID_BROADCAST_TARGETS','An organization is unavailable.',409)
    const id=newId()
    const row=(await client.query(`INSERT INTO platform.platform_broadcasts(id,message,severity,expires_at,created_by,target_org_ids,created_at,updated_at)
      VALUES($1,$2,$3,$4,$5,$6,now(),now()) RETURNING id AS "_id",message,severity,expires_at AS "expiresAt",created_at AS "createdAt",target_org_ids AS "orgIds"`,[id,message,severity,expiresAt,String(actor),targets])).rows[0]
    // Older banners remain available to their own audience. Latest matching live banner wins.
    await audit(client,actor,'platform_broadcast_sent',{broadcastId:id,audience:targets || 'all',expiresAt})
    return {broadcast:row}
  })
}
module.exports={plan,admin,broadcast,audit,operation,fail}
