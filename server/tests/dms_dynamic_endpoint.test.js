// Real HTTP fixture servers, actual DMS client, no database or external DMS writes.
const assert = require('node:assert/strict')
const http = require('node:http')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const Module = require('node:module')
const dns = require('node:dns')
const dms = require('../services/dmsClient')
const { publicAddress, normalizeEndpoint, fetchEndpoint } = require('../services/dmsEndpoint')
const { issueIntegrationReceipt, receiptMatches } = require('../utils/integrationVerification')
const Organization = require('../models/Organization')
const { loadSource } = require('../services/extractionStorage')

async function main() {
  const saved = { ...process.env }
  const servers = [], seen = []
  let temp
  try {
    process.env.JWT_SECRET = 'isolated-dms-receipt-secret'
    process.env.DMS_ENABLED = 'true'
    process.env.DMS_API_URL = 'https://legacy.example.test/api'
    process.env.DMS_API_KEY = 'PLATFORM_SECRET_NEVER_SEND'
    process.env.DMS_JWT = 'PLATFORM_TOKEN_NEVER_SEND'
    for (const tenant of ['a', 'b']) {
      const server = http.createServer(async (req, res) => {
        const chunks = []
        for await (const chunk of req) chunks.push(chunk)
        seen.push({ tenant, path: req.url, headers: req.headers, body: Buffer.concat(chunks).toString() })
        assert.notEqual(req.headers['x-api-key'], process.env.DMS_API_KEY)
        assert.notEqual(req.headers.authorization, 'Bearer ' + process.env.DMS_JWT)
        if (req.url === '/signed-file?token=fixture') {
          assert.equal(req.headers['x-api-key'], undefined)
          res.end('fixture document'); return
        }
        res.setHeader('content-type', 'application/json')
        if (req.headers['x-api-key'] !== 'key-' + tenant) {
          res.writeHead(401); res.end(JSON.stringify({ error: 'Unauthorized' })); return
        }
        if (req.url.includes('/incompatible/')) { res.end('<html>Login</html>'); return }
        if (req.url.includes('/redirect/')) { res.writeHead(302, { location: 'http://127.0.0.1/private' }); res.end(); return }
        if (req.url.endsWith('/upload')) { res.end(JSON.stringify({ document: { id: 'document-' + tenant, name: 'fixture.txt' } })); return }
        if (req.url.includes('/url?')) {
          const url = req.url.includes('/unsafe-scheme/') ? 'javascript:alert(1)'
            : req.url.includes('/private-url/') ? 'https://169.254.169.254/latest/meta-data/'
              : req.url.includes('/signed-file/') ? '/signed-file?token=fixture' : null
          res.end(JSON.stringify(url ? { url, signed: true } : { signed: false })); return
        }
        if (req.url.includes('/documents?')) { res.end(JSON.stringify({ documents: [{ id: 'document-' + tenant, size: 12 }], total: 1 })); return }
        if (req.url.endsWith('/folders')) { res.end(JSON.stringify({ tree: [] })); return }
        res.end(JSON.stringify({ id: 'document-' + tenant }))
      })
      await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
      servers.push(server)
    }
    const origins = servers.map(server => 'http://127.0.0.1:' + server.address().port)
    process.env.DMS_TRUSTED_ORIGINS = origins.join(',')
    const orgs = origins.map((origin, i) => ({ subdomain: 'tenant-' + i, integrations: { dmsEnabled: true, dmsBaseUrl: origin + '/api', dmsApiKey: 'key-' + ['a', 'b'][i] } }))
    assert.equal(normalizeEndpoint(origins[0] + '/api/'), origins[0] + '/api')
    for (const value of ['ftp://host/api', 'https://user:pass@host/api', 'https://host/api?q=secret', 'https://host/api#hash', 'not-a-url', 'http://public.example/api']) {
      assert.throws(() => normalizeEndpoint(value), error => error.code === 'DMS_INVALID_ENDPOINT')
    }
    for (const address of ['127.0.0.1','10.0.0.1','169.254.169.254','100.64.0.1','192.168.1.1','::1','::ffff:127.0.0.1','fd00::1','fe80::1','0.0.0.0']) assert.equal(publicAddress(address), false, address)
    assert.equal(publicAddress('8.8.8.8'), true)
    await assert.rejects(() => fetchEndpoint('https://127.0.0.1/api'), error => error.code === 'DMS_INVALID_ENDPOINT')
    const originalLookup = dns.lookup
    dns.lookup = (host, options, callback) => callback(null, [{ address:'127.0.0.1', family:4 }])
    try {
      await assert.rejects(() => fetchEndpoint('https://untrusted.example.test/api', { signal:AbortSignal.timeout(2000) }), error => error.code === 'DMS_INVALID_ENDPOINT')
    } finally { dns.lookup = originalLookup }
    assert.equal(dms.resolveApiKey({ integrations: { dmsBaseUrl: origins[0] + '/api' } }), '')
    assert.equal(dms.resolveJwt({ integrations: { dmsBaseUrl: origins[0] + '/api' } }), '')
    const beforeMissing = seen.length
    await assert.rejects(() => dms.testConnection({ baseUrl: origins[0] + '/api' }), error => error.code === 'DMS_UNAUTHORIZED')
    assert.equal(seen.length, beforeMissing)
    await assert.rejects(() => dms.signedUrl('unsafe-scheme', { org:orgs[0] }), error => error.code === 'DMS_INVALID_ENDPOINT')
    await assert.rejects(() => loadSource({ storage:'dms', dmsDocId:'private-url' }, orgs[0]), error => error.code === 'DMS_INVALID_ENDPOINT')
    assert.equal((await loadSource({ storage:'dms', dmsDocId:'signed-file' }, orgs[0])).toString(), 'fixture document')
    await assert.rejects(() => fetchEndpoint(origins[0] + '/signed-file?token=fixture', { maxResponseBytes: 4 }), error => error.code === 'DMS_INVALID_ENDPOINT')
    for (const [i, org] of orgs.entries()) {
      const config = { baseUrl: org.integrations.dmsBaseUrl, apiKey: org.integrations.dmsApiKey, orgSlug: org.subdomain }
      const result = await dms.testConnection(config)
      assert.equal(result.checks.every(check => check.status === 'passed'), true)
      assert.equal(await dms.ping({ org }), true)
      assert.equal((await dms.listDocuments({ org })).documents[0].id, 'document-' + ['a','b'][i])
      assert.equal(await dms.signedUrl('existing-id', { org }), origins[i] + '/api/documents/existing-id/file')
      await dms.getDoc('existing-id', { org })
      await dms.postEvent('existing-id', { type: 'workflow.submitted' }, { org })
      await dms.getFoldersTree({ org })
      await dms.deleteDoc('fixture-only-id', { org })
      const issued = issueIntegrationReceipt({ integration: 'dms', config: dms.connectionConfig(config), actorId: 'admin' })
      assert.equal(receiptMatches({ receipt: issued.verificationReceipt, integration: 'dms', config: dms.connectionConfig(config), actorId: 'admin' }), true)
      assert.equal(receiptMatches({ receipt: issued.verificationReceipt, integration: 'dms', config: dms.connectionConfig({ ...config, baseUrl: origins[1-i] + '/api' }), actorId: 'admin' }), false)
    }
    await assert.rejects(() => dms.testConnection({ baseUrl: origins[0] + '/api', apiKey:'wrong' }), error => error.status === 401)
    await assert.rejects(() => dms.testConnection({ baseUrl: origins[0] + '/incompatible', apiKey:'key-a' }), error => error.code === 'DMS_INCOMPATIBLE_API')
    await assert.rejects(() => dms.testConnection({ baseUrl: origins[0] + '/redirect', apiKey:'key-a' }), error => error.code === 'DMS_INVALID_ENDPOINT')
    assert.throws(() => dms.assertEndpointChange(orgs[0], origins[1] + '/api'), error => error.code === 'DMS_ENDPOINT_MIGRATION_REQUIRED')
    assert.equal(dms.assertEndpointChange(orgs[0], origins[0] + '/api/'), origins[0] + '/api')
    assert.equal(dms.resolveBaseUrl({ integrations: { dmsApiKey:'old-key' } }), process.env.DMS_API_URL, 'Legacy document routing unchanged')
    temp = fs.mkdtempSync(path.join(os.tmpdir(), 'netflow-dynamic-dms-'))
    const filePath = path.join(temp, 'fixture.txt')
    fs.writeFileSync(filePath, 'fixture text')
    const uploaded = await dms.uploadFile({ filePath, filename:'fixture.txt', org:orgs[0], department:'HR' })
    assert.equal(uploaded.id, 'document-a')
    assert.equal(uploaded.url, origins[0] + '/api/documents/document-a/file')
    const upload = seen.find(request => request.path.endsWith('/upload'))
    assert.ok(upload.body.includes('fixture text'))
    const departmentOrg = { ...orgs[0], integrations:{ ...orgs[0].integrations, departmentDms:[{ department:'HR', baseUrl:origins[1] + '/api', apiKey:'key-b', folder:'team-folder' }] } }
    const departmental = await dms.uploadFile({ filePath, filename:'fixture.txt', org:departmentOrg, department:'HR' })
    assert.equal(departmental.id, 'document-b')
    assert.equal(departmental.url, origins[1] + '/api/documents/document-b/file')
    assert.equal(dms.resolveJwt(departmentOrg, 'HR'), '')
    assert.ok(seen.some(request => request.tenant === 'b' && request.body.includes('team-folder')))

    // Expose lexical route helpers only in this isolated compiled test module.
    const routeFile = require.resolve('../routes/platform')
    const compiled = new Module(routeFile, module)
    compiled.filename = routeFile
    compiled.paths = module.paths
    compiled._compile(fs.readFileSync(routeFile, 'utf8') + '\nmodule.exports.__test = { resolveIntegrationTestConfig, enabledIntegrationInputs, testPlatformIntegration, maskDmsSecrets, verifyOrTestCreateIntegrations };', routeFile)
    const helpers = compiled.exports.__test
    const originalFind = Organization.findById
    Organization.findById = () => ({ select: () => ({ lean: async () => orgs[0] }) })
    try {
      const merged = await helpers.resolveIntegrationTestConfig({ integration:'dms', config:{}, orgId:'507f1f77bcf86cd799439011' })
      assert.equal(merged.baseUrl, orgs[0].integrations.dmsBaseUrl)
      assert.equal(merged.apiKey, 'key-a')
      await assert.rejects(() => helpers.resolveIntegrationTestConfig({ integration:'dms', config:{baseUrl:orgs[1].integrations.dmsBaseUrl}, orgId:'507f1f77bcf86cd799439011' }), error => error.code === 'DMS_ENDPOINT_MIGRATION_REQUIRED')
      const safe = helpers.maskDmsSecrets({ integrations:{ dmsBaseUrl:origins[0]+'/api', dmsApiKey:'SECRET', dmsJwt:'TOKEN', departmentDms:[{apiKey:'DEPT_SECRET'}] } })
      assert.equal(safe.integrations.dmsBaseUrl, origins[0]+'/api')
      assert.ok(!JSON.stringify(safe).includes('SECRET') && !JSON.stringify(safe).includes('TOKEN'))
      const input = helpers.enabledIntegrationInputs(orgs[0].integrations)[0]
      assert.equal(input.config.baseUrl, origins[0]+'/api')
      await helpers.verifyOrTestCreateIntegrations({ integrations:orgs[0].integrations, actorId:'admin' })
      await assert.rejects(() => helpers.testPlatformIntegration('dms',{baseUrl:'https://user:pass@host/api',apiKey:'key'}), error => error.code === 'DMS_INVALID_ENDPOINT' && error.status === 422)
    } finally { Organization.findById = originalFind }
    // Exercise the real edit handler through pre-save validation. Stop at save
    // so no audit, database, or quota queries can be performed by this test.
    const edit = compiled.exports.stack.find(layer => layer.route?.path === '/orgs/:id' && layer.route.methods.put).route.stack.at(-1).handle
    const saveBoundary = new Error('isolated-save-boundary')
    let doc, nextError, responseBody, status, reachedSave
    Organization.findById = async () => doc
    const runEdit = async integrations => {
      nextError = null; responseBody = null; status = null; reachedSave = false
      doc = new Organization({ name:'Fixture org', subdomain:'fixture-org', integrations:orgs[0].integrations })
      doc.save = async () => { reachedSave = true; throw saveBoundary }
      const response = { status(code) { status=code; return this }, json(body) { responseBody=body; return this } }
      await edit({ params:{id:String(doc._id)}, body:{integrations}, user:{_id:'admin'} }, response, error => { nextError=error })
    }
    try {
      await runEdit({dmsName:'Company DMS',dmsBaseUrl:orgs[0].integrations.dmsBaseUrl})
      assert.equal(nextError,saveBoundary)
      assert.equal(doc.integrations.dmsName,'Company DMS')
      assert.equal(doc.integrations.dmsBaseUrl,origins[0]+'/api')
      await runEdit({dmsApiKey:'wrong'})
      assert.equal(reachedSave,false)
      assert.equal(status,422)
      assert.equal(responseBody.code,'DMS_AUTH_FAILED')
      await runEdit({dmsBaseUrl:origins[1]+'/api'})
      assert.equal(reachedSave,false)
      assert.equal(status,409)
      assert.equal(responseBody.code,'DMS_ENDPOINT_MIGRATION_REQUIRED')
      const beforeSlugChange = seen.length
      await runEdit({dmsOrgSlug:'new-folder',dmsApiKey:'key-a'})
      assert.equal(nextError,saveBoundary)
      assert.ok(seen.length>beforeSlugChange,'Changed DMS settings are tested server-side before saving')
    } finally { Organization.findById = originalFind }
    console.log('PASS dynamic DMS: tenant routing, no platform secret fallback, authenticated tests, URL safety, redirect blocking, receipts, legacy protection, upload/download, department routing and masked responses')
  } finally {
    for (const server of servers) await new Promise(resolve => server.close(resolve))
    if (temp) fs.rmSync(temp, { recursive:true, force:true })
    for (const key of ['JWT_SECRET','DMS_ENABLED','DMS_API_URL','DMS_API_KEY','DMS_JWT','DMS_TRUSTED_ORIGINS']) {
      if (saved[key] === undefined) delete process.env[key]
      else process.env[key] = saved[key]
    }
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
