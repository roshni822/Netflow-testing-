'use strict'
const router=require('express').Router()
const { organizationSchemas }=require('../database/layout')
const { sendSuccess,sendError }=require('../utils/apiResponse')
const ops=require('../database/fresh/platformOperations')
router.use((req,res,next)=>organizationSchemas() ? next() : next('router'))
router.use(async(req,res,next)=>{
  try { await require('../config/plans').reloadPlans(); next() } catch(error) { next(error) }
})
const handle=(fn,status=200)=>async(req,res,next)=>{
  try { res.set('Cache-Control','no-store'); return sendSuccess(res,await fn(req),status) }
  catch(error) { if(error.statusCode) return sendError(res,error.message,error.code,error.statusCode); next(error) }
}
router.post('/plans',handle(req=>ops.plan(req.user._id,'create',req.body.key,req.body),201))
router.put('/plans/:key',handle(req=>ops.plan(req.user._id,'update',req.params.key,req.body)))
router.delete('/plans/:key',handle(req=>ops.plan(req.user._id,'delete',req.params.key)))
router.post('/admins',handle(req=>ops.admin(req.user._id,'create',null,req.body),201))
for(const action of ['reset-password','activate','deactivate']) router.post('/admins/:id/'+action,handle(req=>ops.admin(req.user._id,action,req.params.id)))
router.post('/broadcast',handle(req=>ops.broadcast(req.user._id,req.body),201))
router.get('/orgs/:id/storage',handle(req=>require('../database/fresh/providerOperations').configuration(req.params.id)))
router.get('/orgs/:id/storage/:provider',handle(req=>require('../database/fresh/providerOperations').documents(req.params.id,req.params.provider,req.query)))
router.get(['/dms-storage','/dms-documents'],(req,res)=>sendError(res,'Select an organization in its storage view.','ORGANIZATION_REQUIRED',400))
router.post('/orgs/:id/archive',handle(async req=>{
  const days=req.body.retentionDays
  if(!Number.isInteger(days) || days<1 || days>3650 || typeof req.body.reason!=='string' || !req.body.reason.trim() || req.body.reason.length>500)
    throw ops.fail('INVALID_ARCHIVE_REQUEST','Enter a reason and a retention period between 1 and 3650 days.')
  if(!/^[a-f0-9]{24}$/.test(req.params.id)) throw ops.fail('ORG_NOT_FOUND','Organization not found.',404)
  try { await require('../database/postgres').query('SELECT system.archive_organization($1,$2,$3,$4,false)',[String(req.user._id),req.params.id,days,req.body.reason]) }
  catch(error) { if(error.code==='P0001') throw ops.fail(error.message,'Suspend the organization and finish pending deliveries before archiving.',409); throw error }
  return {archived:true,dataRetained:true}
}))
router.post('/orgs/:id/restore-archive',handle(async req=>{
  try { await require('../database/postgres').query('SELECT system.archive_organization($1,$2,NULL,NULL,true)',[String(req.user._id),req.params.id]) }
  catch(error) { if(error.code==='P0001') throw ops.fail(error.message,'The organization is not an available archive.',409); throw error }
  return {restored:true,status:'suspended'}
}))
router.delete('/orgs/:id',(req,res)=>sendError(res,'Archive the organization first. Permanent removal requires a verified backup, isolated restore and the operator recovery command.','VERIFIED_OFFBOARDING_REQUIRED',409))
module.exports=router
