'use strict'
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const { withSystemAccess } = require('../../database/context')
const { runWithOrgId } = require('../../tenancy/tenantContext')
const pg = require('../../database/postgres')
const documents = require('../../utils/documentAccess')

async function releaseControlChecks () {
  const previous = process.env.FILE_URL_SECRET
  process.env.FILE_URL_SECRET = crypto.randomBytes(48).toString('hex')
  try {
    await withSystemAccess('test', async () => {
      const org = await require('../../models/Organization').findOne({ subdomain: 'qa-fresh-one' }).lean()
      const roles = await require('../../utils/roleProvisioning').ensureRolesForOrganization(org._id)
      const User = require('../../models/User')
      const owner = await User.create({ orgId: org._id, department: 'IT', name: 'File owner', email: 'files-owner@qa.test', password: crypto.randomBytes(24).toString('hex'), role: roles.get('employee')._id })
      const peer = await User.create({ orgId: org._id, department: 'IT', name: 'File peer', email: 'files-peer@qa.test', password: crypto.randomBytes(24).toString('hex'), role: roles.get('employee')._id })
      const ownerView = await User.findById(owner._id).populate('role').lean(), peerView = await User.findById(peer._id).populate('role').lean()
      const file = `${org._id}/release-test.txt`
      await documents.grant(file, org._id, owner._id)
      await runWithOrgId(org._id, async () => {
        assert.equal(await documents.canRead(file, ownerView, org._id), true)
        assert.equal(await documents.canRead(file, peerView, org._id), false, 'Same tenant alone does not grant file access')
        assert.equal(await documents.canRead(file, { ...ownerView, orgId: 'other' }, org._id), false)
        const link = await documents.issue(file, org._id)
        assert.equal(await documents.verify(file, org._id, link), true)
        assert.equal(await documents.verify(file + 'x', org._id, link), false)
        assert.equal(await documents.verify(file, org._id, link, 'upload'), false)
        const realNow = Date.now
        try { Date.now = () => realNow() + 301000; assert.equal(await documents.verify(file, org._id, link), false) } finally { Date.now = realNow }
        await documents.revoke(file, org._id)
        assert.equal(await documents.verify(file, org._id, link), false)
        const forged = { url: `/api/files/${file}` }
        await assert.rejects(documents.validateInputs(forged, peerView, org._id), { code: 'DOCUMENT_FORBIDDEN', statusCode: 403 })
        const proof = await documents.issue(file, org._id, 'upload')
        await documents.validateInputs({ ...forged, uploadToken: proof }, null, org._id)
      })
      const Audit = require('../../models/AuditLog')
      const audit = await Audit.create({ orgId: org._id, action: 'user_updated', performedBy: owner._id, targetEntity: 'release-test' })
      await assert.rejects(pg.query('UPDATE netflow.audit_logs SET detail=$1 WHERE id=$2', ['changed', audit._id]), error => error.code === '42501')
      await assert.rejects(pg.query('DELETE FROM netflow.audit_logs WHERE id=$1', [audit._id]), error => error.code === '42501')
      await User.deleteOne({ _id: owner._id })
      assert.equal(String((await Audit.findById(audit._id).lean()).performedBy), String(owner._id), 'Deleting an account preserves its historical actor ID')
    })
    console.log('PASS: document ownership, same-tenant denial, expiry, revocation, attachment injection, append-only audits and actor retention')
  } finally { if (previous === undefined) delete process.env.FILE_URL_SECRET; else process.env.FILE_URL_SECRET = previous }
}
module.exports = { releaseControlChecks }
