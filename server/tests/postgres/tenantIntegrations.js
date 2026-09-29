'use strict'
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const { withSystemAccess } = require('../../database/context')
const { withAccount } = require('../../database/fresh/routing')
const { getPlacement } = require('../../tenancy/tenantContext')
const postgres = require('../../database/postgres')

async function integrationChecks ({ call, expect, owner, fixture, port, platformId }) {
  const orgId = fixture.orgId
  const scoped = work => withSystemAccess('authentication', () => withAccount({ account_scope: 'tenant', org_id: orgId }, work))
  const login = await call('/auth/login', null, { email: fixture.email, password: fixture.password, subdomain: fixture.workspace })
  expect(login, 200, 'Integration login')
  const token = login.body.token
  const userId = login.body.user._id
  const Form = require('../../models/Form')
  const form = await scoped(() => Form.findOne({ 'public.enabled': true }).lean())
  const publicPath = '/public/forms/' + form.public.token
  expect(await call(publicPath), 200, 'Public token resolves verified tenant')
  expect(await call(publicPath + '/submit', null, { formData: { phase: 'four' } }), 201, 'Anonymous submission stays in tenant schema')
  assert.equal((await owner.query("SELECT count(*)::int n FROM tenant_http_provisioning.form_responses WHERE source='public'")).rows[0].n, 1)
  assert.equal((await owner.query('SELECT count(*)::int n FROM tenant_http_other_tenant.form_responses')).rows[0].n, 0)
  expect(await call('/forms/' + form._id + '/public', token, { enabled: false }), 200, 'Disable public link')
  expect(await call(publicPath), 404, 'Disabled token no longer routes')
  expect(await call('/forms/' + form._id + '/public', token, { enabled: true }), 200, 'Re-enable public link')
  await assert.rejects(scoped(() => postgres.transaction(async () => {
    await Form.updateOne({ _id: form._id }, { $set: { 'public.enabled': false } })
    throw new Error('intentional rollback')
  })))
  expect(await call(publicPath), 200, 'Capability and document roll back together')

  const workflow = await scoped(() => require('../../models/Workflow').findOne({ status: 'published' }).lean())
  expect(await call('/workflows/' + workflow._id, token, { inboundWebhook: { enabled: true, requireSignature: true } }, {}, 'PUT'), 200, 'Webhook configuration')
  const hooked = await scoped(() => require('../../models/Workflow').findById(workflow._id).lean())
  const hookPath = '/hooks/' + hooked.inboundWebhook.token
  const body = { formData: { phase: 'four-hook' } }
  expect(await call(hookPath, null, body), 401, 'Webhook signature still required')
  const headers = { 'Idempotency-Key': crypto.randomUUID(), 'X-NetFlow-Signature': 'sha256=' + require('../../utils/inboundWebhook').signBody(hooked.inboundWebhook.secret, JSON.stringify(body)) }
  const triggered = await call(hookPath, null, body, headers)
  expect(triggered, 201, 'Signed webhook creates tenant workflow')
  const replay = await call(hookPath, null, body, headers)
  expect(replay, 200, 'Webhook replay does not create a second execution')
  assert.equal(replay.body.executionId, triggered.body.executionId)
  expect(await call('/hooks/status/' + triggered.body.statusToken), 200, 'Execution status resolves tenant')
  expect(await call('/workflows/' + workflow._id, token, { inboundWebhook: { enabled: true, regenerateToken: true } }, {}, 'PUT'), 200, 'Rotate webhook capability')
  expect(await call(hookPath, null, body, headers), 404, 'Previous webhook token revoked')

  const request = (route, options = {}) => fetch(`http://127.0.0.1:${port}/api${route}`, options)
  const upload = async route => {
    const data = new FormData()
    // Synthetic bytes are confined to this disposable test cluster and upload root.
    data.append('file', new Blob([Buffer.from('%PDF-1.4\n% isolated upload routing fixture\n%%EOF\n')], { type: 'application/pdf' }), 'isolated.pdf')
    return request(route, { method: 'POST', headers: { Authorization: 'Bearer ' + token }, body: data })
  }
  const uploaded = await upload('/uploads')
  assert.equal(uploaded.status, 201, 'Local upload succeeds with tenant file grants')
  const file = (await uploaded.json()).file
  const filePath = new URL(file.url, 'http://local').pathname.replace('/api', '')
  const download = await request(file.url.replace('/api', ''))
  assert.equal(download.status, 200, 'Signed download')
  await download.arrayBuffer()
  assert.equal((await request(filePath)).status, 403, 'Unsigned download denied')
  assert.equal((await request(filePath, { headers: { Authorization: 'Bearer ' + fixture.otherToken } })).status, 403, 'Another tenant cannot read attachment')
  expect(await call(filePath + '/link', token, { revoke: true }), 200, 'Owner refresh and revoke')
  assert.equal((await request(file.url.replace('/api', ''))).status, 403, 'Revoked signed URL rejected')
  const cross = await owner.query("SELECT id FROM platform.organizations WHERE subdomain='http-other-tenant'")
  await scoped(async () => {
    const user = await require('../../models/User').findById(userId).populate('role').lean()
    assert.equal(await require('../../utils/documentAccess').canRead(cross.rows[0].id + '/file.pdf', user, orgId), false)
    await assert.rejects(require('../../utils/documentAccess').validateInputs({ file: { url: '/api/files/' + cross.rows[0].id + '/file.pdf' } }, user, orgId), e => e.code === 'DOCUMENT_FORBIDDEN')
  })

  await owner.query("UPDATE platform.organizations SET plan='custom',pdf_auto_fill=$2 WHERE id=$1", [orgId, { enabled: true, entitlementOverride: true, audiences: { authenticated: true, public: true } }])
  const staged = await upload('/forms/document-drafts')
  const generation = await staged.json()
  assert.equal(staged.status, 202, 'Document generation staging: ' + (generation.code || 'response'))
  expect(await call('/forms/document-drafts/' + generation.job.jobId, token), 200, 'Tenant sees staged job')
  expect(await call('/forms/document-drafts/' + generation.job.jobId, fixture.otherToken), 404, 'Other tenant cannot read job')
  await scoped(() => Form.updateOne({ _id: form._id }, { $set: { 'autoFill.enabled': true } }))
  const extraction = await upload('/forms/' + form._id + '/extractions')
  const extracted = await extraction.json()
  assert.equal(extraction.status, 202, 'PDF extraction staging: ' + (extracted.code || 'response'))
  expect(await call('/forms/' + form._id, token, {}, {}, 'DELETE'), 409, 'Retained document sources are not silently discarded by form deletion')
  const publicExtraction = await call(publicPath + '/extractions/' + extracted.job.jobId, null, null, { 'x-extraction-token': 'invalid' })
  expect(publicExtraction, 404, 'Public token cannot read authenticated extraction')

  const { forEachTenant } = require('../../database/fresh/workers')
  const seen = []
  await forEachTenant('integration-verification', async () => {
    const placement = getPlacement(); seen.push(placement.orgId)
    assert.ok((await require('../../models/User').find({}).lean()).every(user => user.orgId === placement.orgId))
    if (placement.orgId === orgId) {
      const processor = require('../../services/formGenerationProcessor')
      const claims = await Promise.all([processor.claimNext(), processor.claimNext()])
      assert.equal(claims.filter(Boolean).length, 1, 'Concurrent queue claims are exclusive')
      await require('../../models/FormGenerationJob').updateOne({ _id: generation.job.jobId }, { $set: { claimedAt: new Date(Date.now() - 3600000) } })
      await processor.recoverStaleJobs()
      assert.equal((await require('../../models/FormGenerationJob').findById(generation.job.jobId)).status, 'queued')
      const nextClaim = await processor.claimNext()
      const Job = require('../../models/FormGenerationJob')
      const lease = require('../../services/documentJobLease')
      await lease.run(Job, nextClaim, ['security_scan'], async () => {
        await Job.updateOne({ _id: nextClaim._id }, { $inc: { attempts: 1 } })
        const stale = await Job.updateOne(lease.filter(nextClaim._id), { $set: { status: 'ready' } })
        assert.equal(stale.matchedCount, 0, 'Stale processing attempt cannot overwrite a newer claim')
      })
      await Job.updateOne({ _id: nextClaim._id }, { $set: { expiresAt: new Date(Date.now()-1000) } })
      await processor.cleanupExpired()
      assert.equal(await Job.findById(nextClaim._id), null, 'Expired staged source and metadata are cleaned in tenant scope')
    }
    await require('../../jobs/usageCron').reconcileUsage()
    await require('../../jobs/postgresRetention').sweep()
    await require('../../jobs/timerCron').resumeDueTimers()
  })
  assert.equal(seen.length, process.env.NETFLOW_SCHEMA_BROWSER_TEST==='1' ? 3 : 2, 'Worker visits only ready tenants, including the optional browser fixture')
  await owner.query("UPDATE platform.organizations SET licence_valid_until=now()-interval '1 day' WHERE id=$1", [orgId])
  await forEachTenant('licence-verification', () => require('../../jobs/licenceCron').checkLicences())
  assert.equal((await owner.query('SELECT licence_status FROM platform.organizations WHERE id=$1', [orgId])).rows[0].licence_status, 'expired')
  await owner.query("UPDATE platform.organizations SET licence_valid_until=NULL,licence_status='active' WHERE id=$1", [orgId])

  const outbox = require('../../database/outbox')
  const retryKey = crypto.randomUUID()
  await scoped(() => outbox.enqueue('email', { isolated: true }, retryKey))
  let failed = false
  const send = async event => {
    assert.equal(getPlacement()?.orgId || null, event.org_id)
    if (event.event_key === retryKey && !failed) { failed = true; throw new Error('Simulated temporary delivery failure') }
  }
  for (let i = 0; i < 5; i++) await outbox.drain(send)
  assert.equal((await owner.query('SELECT status FROM system.outbox WHERE event_key=$1', [retryKey])).rows[0].status, 'failed')
  await owner.query('UPDATE system.outbox SET retry_at=now() WHERE event_key=$1', [retryKey])
  await Promise.all([outbox.drain(send), outbox.drain(send)])
  assert.deepEqual((await owner.query('SELECT status,attempts FROM system.outbox WHERE event_key=$1', [retryKey])).rows[0], { status: 'sent', attempts: 2 })
  const deferredKey = crypto.randomUUID()
  await scoped(() => outbox.enqueue('email', { isolated: true }, deferredKey))
  await owner.query("UPDATE platform.organizations SET status='suspended' WHERE id=$1", [orgId])
  await outbox.drain(send)
  assert.deepEqual((await owner.query('SELECT status,attempts FROM system.outbox WHERE event_key=$1', [deferredKey])).rows[0], { status: 'pending', attempts: 0 }, 'Suspension defers delivery without consuming attempts')
  expect(await call(publicPath), 404, 'Suspended public link denied')
  assert.equal((await request(filePath, { headers: { Authorization: 'Bearer ' + token } })).status, 404, 'Suspended file access denied')
  const visited = []
  await forEachTenant('suspension-verification', () => { visited.push(getPlacement().orgId) })
  assert.equal(visited.includes(orgId), false)
  await owner.query("UPDATE platform.organizations SET status='active' WHERE id=$1", [orgId])
  await outbox.drain(send)
  assert.equal((await owner.query('SELECT status FROM system.outbox WHERE event_key=$1', [deferredKey])).rows[0].status, 'sent')

  const tid = crypto.randomUUID(); const oid = crypto.randomUUID(); const platformOid = crypto.randomUUID()
  await owner.query('INSERT INTO system.microsoft_identities(user_id,tenant_id,object_id) VALUES($1,$2,$3),($4,$2,$5)', [userId,tid,oid,platformId,platformOid])
  const microsoft = require('../../database/fresh/microsoft')
  await withSystemAccess('authentication', async () => {
    assert.equal(await microsoft.withMicrosoftIdentity(tid,oid,async id => { assert.equal(getPlacement().orgId,orgId); return (await require('../../models/User').findById(id))._id }),userId)
    assert.equal(await microsoft.withMicrosoftIdentity(tid,platformOid,async id => { assert.equal(getPlacement(),null); return (await require('../../models/User').findById(id))._id }),platformId)
    assert.equal(await microsoft.withMicrosoftIdentity(tid,crypto.randomUUID(),()=>assert.fail('Unbound identity must not run')),null)
    assert.equal(await microsoft.withMicrosoftIdentity(crypto.randomUUID(),oid,()=>assert.fail('Wrong Microsoft tenant must not run')),null)
  })
  const disposableForm = await scoped(() => Form.create({ title: 'Capability deletion fixture', orgId, createdBy: userId, status: 'published', public: { enabled: true, token: crypto.randomBytes(24).toString('hex') } }))
  const disposableLink = '/public/forms/' + disposableForm.public.token
  expect(await call(disposableLink), 200, 'New resource routes before deletion')
  await scoped(() => Form.deleteOne({ _id: disposableForm._id }))
  expect(await call(disposableLink), 404, 'Deleted resource removes its routing capability')
  console.log('PASS: Phase 4 public forms, signed webhooks, files, staging, scoped workers, retries, suspension and explicit Microsoft identity routing')
}
module.exports = { integrationChecks }
