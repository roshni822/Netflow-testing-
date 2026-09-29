const fs = require('node:fs')
const crypto = require('node:crypto')
const path = require('node:path')
const dms = require('./dmsClient')
const { fetchEndpoint } = require('./dmsEndpoint')
const s3 = require('./s3Client')
const { dirForOrg, safeFilename, urlFor, resolveStored, removeStored } = require('../utils/fileStore')
const { addStorage, releaseStorage } = require('../utils/usageMeter')

async function responseBuffer(response, code) {
  if (!response.ok) {
    const error = new Error('Stored document could not be read')
    error.code = code
    throw error
  }
  const bytes = Buffer.from(await response.arrayBuffer())
  if (bytes.length > 25 * 1024 * 1024) {
    const error = new Error('Stored document exceeds the configured limit')
    error.code = 'FILE_TOO_LARGE'
    throw error
  }
  return bytes
}

// Convert provider/internal staging failures into stable, non-sensitive API
// errors. The provider response body and credentials must never reach clients.
function stagingErrorForClient(error) {
  const code = String(error?.code || '')
  const status = Number(error?.status || 0)

  if (code === 'DMS_TIMEOUT') {
    return {
      message: 'Document storage did not confirm the upload in time. Please wait a moment and try again.',
      code: 'DMS_UPLOAD_TIMEOUT',
      status: 504
    }
  }
  if (code === 'LICENCE_READ_ONLY' || (status === 403 && /read-only/i.test(String(error?.message || '')))) {
    return {
      message: 'This workspace is read-only until its licence is renewed.',
      code: 'LICENCE_READ_ONLY',
      status: 403
    }
  }
  if (code === 'QUOTA_EXCEEDED' || status === 413) {
    return {
      message: 'Document storage limit has been reached. Remove files or contact your administrator.',
      code: 'STORAGE_LIMIT_REACHED',
      status: 413
    }
  }
  if (code === 'DMS_UNAUTHORIZED' || status === 401 || status === 403) {
    return {
      message: 'Document storage authentication failed. Contact your organization administrator.',
      code: 'DOCUMENT_STORAGE_AUTH_FAILED',
      status: 503
    }
  }
  if (['DMS_DISABLED', 'DMS_MISCONFIGURED'].includes(code)) {
    return {
      message: 'Document storage is not configured for this workspace.',
      code: 'DOCUMENT_STORAGE_UNAVAILABLE',
      status: 503
    }
  }
  if (code === 'DMS_EMPTY') {
    return {
      message: 'Document storage returned an invalid upload confirmation. Please try again.',
      code: 'DOCUMENT_STORAGE_INVALID_RESPONSE',
      status: 502
    }
  }
  if (code === 'ENOSPC') {
    return {
      message: 'The document storage service has no available disk space.',
      code: 'DOCUMENT_STORAGE_FULL',
      status: 507
    }
  }

  return {
    message: 'The document could not be stored for processing.',
    code: 'STAGING_FAILED',
    status: 502
  }
}

async function storeSource({ buffer, filename, mimetype = 'application/pdf', org, user }) {
  const orgId = String(org._id)
  const storedFilename = safeFilename(filename)
  const localPath = path.join(dirForOrg(orgId), storedFilename)
  await fs.promises.writeFile(localPath, buffer)

  if (s3.isEnabled(org)) {
    const s3Key = orgId + '/auto-fill/' + storedFilename
    try {
      await s3.uploadFile(org, s3Key, buffer, mimetype)
      await require('../utils/documentAccess').grant('s3:' + s3Key, orgId, user?._id)
      await fs.promises.unlink(localPath).catch(() => {})
      return { storage: 's3', filename, mimetype, size: buffer.length, s3Key }
    } catch (error) {
      await fs.promises.unlink(localPath).catch(() => {})
      throw error
    }
  }

  if (dms.isConfiguredFor(org)) {
    const provisionalId = crypto.randomBytes(12).toString('hex')
    try {
      const doc = await dms.uploadFile({
        filePath: localPath,
        filename,
        mime: mimetype,
        user,
        org,
        department: 'staging',
        orgSubdomain: org.subdomain,
        ref: { id: provisionalId }
      })
      await fs.promises.unlink(localPath).catch(() => {})
      try {
        await addStorage(orgId, buffer.length)
      } catch (error) {
        await dms.deleteDoc(doc.id, { org, user }).catch(() => {})
        throw error
      }
      await require('../utils/documentAccess').grant('dms:' + doc.id, orgId, user?._id)
      return {
        storage: 'dms',
        filename,
        mimetype,
        size: buffer.length,
        dmsDocId: doc.id,
        dmsDepartment: 'staging',
        path: doc.url || null
      }
    } catch (error) {
      await fs.promises.unlink(localPath).catch(() => {})
      throw error
    }
  }

  try {
    await addStorage(orgId, buffer.length)
  } catch (error) {
    await fs.promises.unlink(localPath).catch(() => {})
    throw error
  }
  await require('../utils/documentAccess').grant(orgId + '/' + storedFilename, orgId, user?._id)
  return {
    storage: 'local',
    filename,
    mimetype,
    size: buffer.length,
    storedFilename,
    path: await urlFor(orgId, storedFilename)
  }
}

async function loadSource(source, org, user) {
  if (source.storage === 'local') {
    const target = resolveStored(String(org._id), String(source.storedFilename || ''))
    if (!target) {
      const error = new Error('Stored document path is invalid')
      error.code = 'SOURCE_FILE_MISSING'
      throw error
    }
    return fs.promises.readFile(target.abs)
  }

  if (source.storage === 's3') {
    const url = await s3.getPresignedDownloadUrl(org, source.s3Key)
    return responseBuffer(await fetch(url), 'S3_SOURCE_UNAVAILABLE')
  }

  if (source.storage === 'dms') {
    const url = await dms.signedUrl(source.dmsDocId, { mode: 'download', org, user, department: source.dmsDepartment })
    const response = dms.resolveBaseUrl(org, source.dmsDepartment)
      ? await fetchEndpoint(url, { signal: AbortSignal.timeout(30000), maxResponseBytes: 25 * 1024 * 1024 })
      : await fetch(url)
    return responseBuffer(response, 'DMS_SOURCE_UNAVAILABLE')
  }

  const error = new Error('Unknown extraction storage backend')
  error.code = 'SOURCE_FILE_MISSING'
  throw error
}

async function deleteSource(source, org, user) {
  if (!source) return
  if (source.storage === 'local') {
    const removed = await removeStored(String(org._id), String(source.storedFilename || ''))
    if (removed) await releaseStorage(org._id, source.size || 0)
  } else if (source.storage === 's3' && source.s3Key) {
    await s3.deleteFile(org, source.s3Key)
  } else if (source.storage === 'dms' && source.dmsDocId) {
    await dms.deleteDoc(source.dmsDocId, { org, user })
    await releaseStorage(org._id, source.size || 0)
  }
}

async function attachmentFor(source, org, user) {
  let pathValue = source.path || ''
  if (source.storage === 'local' && source.storedFilename) {
    pathValue = await urlFor(org._id, source.storedFilename)
  } else if (source.storage === 's3' && source.s3Key) {
    pathValue = '/api/s3/download?key=' + encodeURIComponent(source.s3Key)
  } else if (source.storage === 'dms' && source.dmsDocId) {
    pathValue = await dms.signedUrl(source.dmsDocId, { mode: 'view', org, user }).catch(() => source.path || '')
  }

  return {
    kind: 'auto_fill_source',
    filename: source.filename,
    path: pathValue,
    mimetype: source.mimetype || 'application/pdf',
    size: source.size || 0,
    dmsDocId: source.dmsDocId || null,
    dmsDepartment: source.dmsDepartment || '',
    s3Key: source.s3Key || null,
    provisionalId: null
  }
}

module.exports = {
  storeSource,
  loadSource,
  deleteSource,
  attachmentFor,
  stagingErrorForClient,
  // Compatibility aliases for any older internal callers.
  storePdf: storeSource,
  loadPdf: loadSource,
  deletePdf: deleteSource
}
