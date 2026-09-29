const crypto = require('node:crypto')
const { S3Client, ListObjectsV2Command, DeleteObjectCommand, PutObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3')
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner')

const getClient = (org, { maxAttempts } = {}) => {
  const s3 = org?.integrations?.s3
  if (!s3 || !s3.enabled) return null
  if (!s3.bucket || !s3.accessKeyId || !s3.secretAccessKey) return null

  const config = {
    region: s3.region || 'auto',
    credentials: {
      accessKeyId: s3.accessKeyId,
      secretAccessKey: s3.secretAccessKey
    }
  }

  if (s3.endpoint) {
    config.endpoint = s3.endpoint
  }
  if (maxAttempts) config.maxAttempts = maxAttempts

  return new S3Client(config)
}

class S3ConnectionError extends Error {
  constructor(message, { code = 'S3_UNREACHABLE', status = 502 } = {}) {
    super(message)
    this.name = 'S3ConnectionError'
    this.code = code
    this.status = status
  }
}

const connectionConfig = (config = {}) => ({
  bucket: String(config.bucket || '').trim(),
  endpoint: String(config.endpoint || '').trim(),
  region: String(config.region || 'auto').trim() || 'auto',
  accessKeyId: String(config.accessKeyId || '').trim(),
  secretAccessKey: String(config.secretAccessKey || '').trim()
})

const mapConnectionError = (error, phase) => {
  if (error instanceof S3ConnectionError) return error
  const providerCode = String(error?.name || error?.Code || error?.code || '')
  if (['InvalidAccessKeyId', 'SignatureDoesNotMatch', 'CredentialsProviderError', 'InvalidToken', 'ExpiredToken'].includes(providerCode)) {
    return new S3ConnectionError('S3 credentials were rejected', { code: 'S3_AUTH_FAILED', status: 422 })
  }
  if (['NoSuchBucket', 'NotFound', 'NoSuchKey'].includes(providerCode)) {
    return new S3ConnectionError('The S3 bucket could not be found', { code: 'S3_BUCKET_NOT_FOUND', status: 422 })
  }
  if (phase === 'write') {
    return new S3ConnectionError('NetFlow cannot write to this S3 bucket', { code: 'S3_WRITE_FAILED', status: 422 })
  }
  if (phase === 'delete') {
    return new S3ConnectionError('NetFlow cannot delete its S3 connection-test object', { code: 'S3_DELETE_FAILED', status: 422 })
  }
  return new S3ConnectionError('The S3 service could not be reached', { code: 'S3_UNREACHABLE', status: 502 })
}

const sendBeforeDeadline = async (client, command, deadline, phase) => {
  const remaining = deadline - Date.now()
  if (remaining <= 0) {
    throw new S3ConnectionError('The S3 connection test timed out', { code: 'INTEGRATION_TEST_TIMEOUT', status: 504 })
  }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), remaining)
  try {
    return await client.send(command, { abortSignal: controller.signal })
  } catch (error) {
    if (controller.signal.aborted || error?.name === 'AbortError') {
      throw new S3ConnectionError('The S3 connection test timed out', { code: 'INTEGRATION_TEST_TIMEOUT', status: 504 })
    }
    throw mapConnectionError(error, phase)
  } finally {
    clearTimeout(timer)
  }
}

// A real write/delete probe proves the permissions NetFlow needs at runtime.
// The optional client is only for isolated service tests; production always
// constructs the SDK client from the submitted configuration.
const testConnection = async (config, { timeoutMs = 10000, client } = {}) => {
  const effective = connectionConfig(config)
  const missing = ['bucket', 'accessKeyId', 'secretAccessKey'].filter((key) => !effective[key])
  if (missing.length) {
    throw new S3ConnectionError(`Missing required S3 fields: ${missing.join(', ')}`, {
      code: 'INVALID_INTEGRATION_CONFIG',
      status: 400
    })
  }

  const org = { integrations: { s3: { enabled: true, ...effective } } }
  const s3Client = client || getClient(org, { maxAttempts: 1 })
  const probeKey = `.netflow-connection-test/${crypto.randomUUID()}`
  const deadline = Date.now() + timeoutMs

  await sendBeforeDeadline(s3Client, new PutObjectCommand({
    Bucket: effective.bucket,
    Key: probeKey,
    Body: Buffer.alloc(0),
    ContentType: 'application/octet-stream'
  }), deadline, 'write')

  await sendBeforeDeadline(s3Client, new DeleteObjectCommand({
    Bucket: effective.bucket,
    Key: probeKey
  }), deadline, 'delete')

  return {
    checks: [
      { key: 'configuration', status: 'passed' },
      { key: 'writeAccess', status: 'passed' },
      { key: 'deleteAccess', status: 'passed' }
    ]
  }
}

const listFolder = async (org, prefix = '') => {
  const client = getClient(org)
  if (!client) throw new Error('S3 is not configured for this organization')
  
  const bucket = org.integrations.s3.bucket
  if (prefix && !prefix.endsWith('/')) prefix += '/'

  const command = new ListObjectsV2Command({
    Bucket: bucket,
    Prefix: prefix,
    Delimiter: '/'
  })

  const res = await client.send(command)
  
  const folders = (res.CommonPrefixes || []).map(p => {
    const raw = p.Prefix
    const name = raw.slice(prefix.length, -1)
    return { name, path: raw, type: 'folder' }
  })

  const files = (res.Contents || [])
    .filter(c => c.Key !== prefix)
    .map(c => {
      const name = c.Key.slice(prefix.length)
      return {
        name,
        path: c.Key,
        type: 'file',
        size: c.Size,
        lastModified: c.LastModified
      }
    })

  return { folders, files }
}

const getPresignedUploadUrl = async (org, key, contentType) => {
  const client = getClient(org)
  if (!client) throw new Error('S3 is not configured for this organization')
  
  const command = new PutObjectCommand({
    Bucket: org.integrations.s3.bucket,
    Key: key,
    ContentType: contentType || 'application/octet-stream'
  })

  return await getSignedUrl(client, command, { expiresIn: 3600 })
}

const getPresignedDownloadUrl = async (org, key) => {
  const client = getClient(org)
  if (!client) throw new Error('S3 is not configured for this organization')
  
  const command = new GetObjectCommand({
    Bucket: org.integrations.s3.bucket,
    Key: key
  })

  return await getSignedUrl(client, command, { expiresIn: 3600 })
}

const uploadFile = async (org, key, buffer, contentType) => {
  const client = getClient(org)
  if (!client) throw new Error('S3 is not configured for this organization')
  
  const command = new PutObjectCommand({
    Bucket: org.integrations.s3.bucket,
    Key: key,
    Body: buffer,
    ContentType: contentType || 'application/octet-stream'
  })

  return await client.send(command)
}

const deleteFile = async (org, key) => {
  const client = getClient(org)
  if (!client) throw new Error('S3 is not configured for this organization')
  
  const command = new DeleteObjectCommand({
    Bucket: org.integrations.s3.bucket,
    Key: key
  })

  return await client.send(command)
}

// Returns true when the org has a complete, enabled S3 config.
// Used by upload routes to decide whether to route files to S3.
const isEnabled = (org) => {
  const s3 = org?.integrations?.s3
  if (!s3 || !s3.enabled) return false
  return Boolean(s3.bucket && s3.accessKeyId && s3.secretAccessKey)
}

module.exports = {
  getClient,
  connectionConfig,
  testConnection,
  S3ConnectionError,
  isEnabled,
  listFolder,
  getPresignedUploadUrl,
  getPresignedDownloadUrl,
  uploadFile,
  deleteFile
}
