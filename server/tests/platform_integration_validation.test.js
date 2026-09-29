const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const jwt = require('jsonwebtoken')

process.env.JWT_SECRET = process.env.JWT_SECRET || 'platform-integration-unit-secret'

const dms = require('../services/dmsClient')
const s3 = require('../services/s3Client')
const { stagingErrorForClient } = require('../services/extractionStorage')
const {
  issueIntegrationReceipt,
  receiptMatches
} = require('../utils/integrationVerification')

const originalFetch = global.fetch
const originalDmsEnv = {
  enabled: process.env.DMS_ENABLED,
  url: process.env.DMS_API_URL,
  key: process.env.DMS_API_KEY,
  jwt: process.env.DMS_JWT,
  uploadTimeout: process.env.DMS_UPLOAD_TIMEOUT_MS,
  recoveryWindow: process.env.DMS_UPLOAD_RECOVERY_WINDOW_MS,
  recoveryInterval: process.env.DMS_UPLOAD_RECOVERY_INTERVAL_MS
}

let tempDir = null

const restoreEnv = (key, value) => {
  if (value === undefined) delete process.env[key]
  else process.env[key] = value
}

async function run() {
  const receiptConfig = { bucket: 'tenant-files', secretAccessKey: 'not-returned' }
  const issued = issueIntegrationReceipt({ integration: 's3', config: receiptConfig, actorId: 'admin-1' })
  assert.equal(receiptMatches({ receipt: issued.verificationReceipt, integration: 's3', config: receiptConfig, actorId: 'admin-1' }), true)
  assert.equal(receiptMatches({ receipt: issued.verificationReceipt, integration: 's3', config: { ...receiptConfig, bucket: 'changed' }, actorId: 'admin-1' }), false)
  assert.equal(receiptMatches({ receipt: issued.verificationReceipt, integration: 's3', config: receiptConfig, actorId: 'admin-2' }), false)
  assert.equal(JSON.stringify(jwt.decode(issued.verificationReceipt)).includes('not-returned'), false)

  process.env.DMS_ENABLED = 'true'
  process.env.DMS_API_URL = 'https://dms.test/api'
  process.env.DMS_API_KEY = 'environment-key'
  delete process.env.DMS_JWT
  let dmsRequest = null
  global.fetch = async (url, options) => {
    dmsRequest = { url, options }
    return new Response(JSON.stringify({ documents: [] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    })
  }
  const dmsResult = await dms.testConnection({ orgSlug: 'Acme Org' })
  assert.equal(dmsResult.checks.every((check) => check.status === 'passed'), true)
  assert.match(dmsRequest.url, /\/documents\?limit=1&offset=0$/)
  assert.equal(dmsRequest.options.headers['X-Api-Key'], 'environment-key')

  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'netflow-dms-upload-'))
  const uploadPath = path.join(tempDir, 'GRNs.pdf')
  fs.writeFileSync(uploadPath, Buffer.from('%PDF-1.7\nfixture'))
  const tenant = {
    subdomain: 'netlink',
    integrations: { dmsApiKey: 'tenant-key' }
  }

  global.fetch = async (url) => {
    if (String(url).includes('/documents/upload')) {
      return new Response(JSON.stringify({
        document: { id: 'doc_normal', name: 'GRNs.pdf', size: 16, sourceRef: { id: 'normal-ref' } }
      }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }
    return new Response(JSON.stringify({ url: 'https://dms.test/view/doc_normal', signed: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    })
  }
  const normalUpload = await dms.uploadFile({
    filePath: uploadPath,
    filename: 'GRNs.pdf',
    mime: 'application/pdf',
    org: tenant,
    department: 'staging',
    ref: { id: 'normal-ref' },
    timeoutMs: 50
  })
  assert.equal(normalUpload.id, 'doc_normal')
  assert.equal(normalUpload.recoveredAfterTimeout, false)

  global.fetch = async (url) => {
    if (String(url).includes('/documents/upload')) {
      return new Response(JSON.stringify({ duplicateOf: 'doc_existing' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })
    }
    return new Response(JSON.stringify({ url: 'https://dms.test/view/doc_existing', signed: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    })
  }
  const duplicateUpload = await dms.uploadFile({
    filePath: uploadPath,
    filename: 'GRNs.pdf',
    mime: 'application/pdf',
    org: tenant,
    department: 'staging',
    ref: { id: 'duplicate-ref' },
    timeoutMs: 50
  })
  assert.equal(duplicateUpload.id, 'doc_existing')
  assert.equal(duplicateUpload.duplicateOf, 'doc_existing')

  let uploadAttempts = 0
  let recoveryLookups = 0
  global.fetch = async (url, options = {}) => {
    const target = String(url)
    if (target.includes('/documents/upload')) {
      uploadAttempts += 1
      return new Promise((resolve, reject) => {
        const abort = () => {
          const error = new Error('aborted')
          error.name = 'AbortError'
          reject(error)
        }
        if (options.signal?.aborted) abort()
        else options.signal?.addEventListener('abort', abort, { once: true })
      })
    }
    if (target.includes('/documents/by-external-ref')) {
      recoveryLookups += 1
      assert.match(target, /id=timeout-ref/)
      return new Response(JSON.stringify({
        document: {
          id: 'doc_recovered',
          originalName: 'GRNs.pdf',
          size: 16,
          status: 'Filed',
          sourceRef: { app: 'netflow', id: 'timeout-ref' }
        }
      }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }
    return new Response(JSON.stringify({ url: 'https://dms.test/view/doc_recovered', signed: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    })
  }
  const recoveredUpload = await dms.uploadFile({
    filePath: uploadPath,
    filename: 'GRNs.pdf',
    mime: 'application/pdf',
    org: tenant,
    department: 'staging',
    ref: { id: 'timeout-ref' },
    timeoutMs: 20,
    recoveryWindowMs: 0
  })
  assert.equal(uploadAttempts, 1)
  assert.equal(recoveryLookups, 1)
  assert.equal(recoveredUpload.id, 'doc_recovered')
  assert.equal(recoveredUpload.recoveredAfterTimeout, true)

  global.fetch = async (url, options = {}) => {
    if (!String(url).includes('/documents/upload')) {
      return new Response('{}', { status: 404, headers: { 'Content-Type': 'application/json' } })
    }
    return new Promise((resolve, reject) => {
      const abort = () => {
        const error = new Error('aborted')
        error.name = 'AbortError'
        reject(error)
      }
      if (options.signal?.aborted) abort()
      else options.signal?.addEventListener('abort', abort, { once: true })
    })
  }
  await assert.rejects(
    () => dms.uploadFile({
      filePath: uploadPath,
      filename: 'GRNs.pdf',
      mime: 'application/pdf',
      org: tenant,
      department: 'staging',
      ref: {},
      timeoutMs: 20,
      recoveryWindowMs: 0
    }),
    (error) => error.code === 'DMS_TIMEOUT'
  )

  assert.deepEqual(stagingErrorForClient({ code: 'DMS_TIMEOUT' }), {
    message: 'Document storage did not confirm the upload in time. Please wait a moment and try again.',
    code: 'DMS_UPLOAD_TIMEOUT',
    status: 504
  })
  assert.equal(stagingErrorForClient({ code: 'DMS_UNAUTHORIZED' }).code, 'DOCUMENT_STORAGE_AUTH_FAILED')
  assert.equal(stagingErrorForClient({ code: 'DMS_EMPTY' }).code, 'DOCUMENT_STORAGE_INVALID_RESPONSE')
  assert.equal(stagingErrorForClient({ code: 'QUOTA_EXCEEDED', status: 403 }).code, 'STORAGE_LIMIT_REACHED')
  assert.equal(stagingErrorForClient({ code: 'LICENCE_READ_ONLY', status: 403 }).code, 'LICENCE_READ_ONLY')

  const calls = []
  const fakeS3 = {
    send: async (command) => {
      calls.push(command.constructor.name)
      return {}
    }
  }
  const s3Config = {
    bucket: 'tenant-files', region: 'auto', endpoint: '',
    accessKeyId: 'access', secretAccessKey: 'secret'
  }
  const s3Result = await s3.testConnection(s3Config, { client: fakeS3 })
  assert.deepEqual(calls, ['PutObjectCommand', 'DeleteObjectCommand'])
  assert.equal(s3Result.checks.every((check) => check.status === 'passed'), true)

  await assert.rejects(
    () => s3.testConnection({ bucket: 'tenant-files' }, { client: fakeS3 }),
    (error) => error.code === 'INVALID_INTEGRATION_CONFIG'
  )

  const deleteDenied = {
    send: async (command) => {
      if (command.constructor.name === 'DeleteObjectCommand') {
        const error = new Error('provider detail must not escape')
        error.name = 'AccessDenied'
        throw error
      }
      return {}
    }
  }
  await assert.rejects(
    () => s3.testConnection(s3Config, { client: deleteDenied }),
    (error) => error.code === 'S3_DELETE_FAILED' && !error.message.includes('provider detail')
  )

  console.log('platform integration validation tests passed')
}

run()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => {
    global.fetch = originalFetch
    if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true })
    restoreEnv('DMS_ENABLED', originalDmsEnv.enabled)
    restoreEnv('DMS_API_URL', originalDmsEnv.url)
    restoreEnv('DMS_API_KEY', originalDmsEnv.key)
    restoreEnv('DMS_JWT', originalDmsEnv.jwt)
    restoreEnv('DMS_UPLOAD_TIMEOUT_MS', originalDmsEnv.uploadTimeout)
    restoreEnv('DMS_UPLOAD_RECOVERY_WINDOW_MS', originalDmsEnv.recoveryWindow)
    restoreEnv('DMS_UPLOAD_RECOVERY_INTERVAL_MS', originalDmsEnv.recoveryInterval)
  })
