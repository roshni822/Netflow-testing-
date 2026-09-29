// Phase 2 - routes/uploads.js
// Authenticated file upload. When DMS_ENABLED=true, bytes are ingested into
// DMS and the temp local file is deleted; NetFlow only keeps dmsDocId.
// When DMS is off, files stay under server/uploads/<orgId>/ (legacy).

const express = require('express')
const fs = require('fs')
const crypto = require('crypto')
const multer = require('multer')

const Task = require('../models/Task')
const { protect } = require('../middleware/auth')
const { sendSuccess, sendError } = require('../utils/apiResponse')
const { checkStorage, respond } = require('../middleware/quota')
const { isReadOnly } = require('../middleware/licence')
const { addStorage } = require('../utils/usageMeter')
const { dirForOrg, safeFilename } = require('../utils/fileStore')
const dms = require('../services/dmsClient')
const s3Client = require('../services/s3Client')

const documentAccess = require('../utils/documentAccess')
const router = express.Router()

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    try {
      cb(null, dirForOrg(req.orgId))
    } catch (err) {
      cb(err)
    }
  },
  filename: (req, file, cb) => cb(null, safeFilename(file.originalname))
})

const MAX_CEILING_MB = 50

const isForOpenTask = async (req) => {
  const taskId = String(req.query.taskId || req.body?.taskId || '').trim()
  if (!/^[0-9a-fA-F]{24}$/.test(taskId)) return false
  const task = await Task.findById(taskId).select('status assignedTo').lean()
  if (!task || task.status !== 'pending') return false
  return String(task.assignedTo) === String(req.user._id)
}

// POST /api/uploads  (multipart/form-data, field name "file")
router.post('/', protect, async (req, res, next) => {
  try {
    const forTask = await isForOpenTask(req)

    if (isReadOnly(req.organization) && !forTask) {
      return sendError(
        res,
        'This workspace is read-only until its licence is renewed. Attachments can only be added to an approval you already have open.',
        'LICENCE_READ_ONLY',
        403,
        { readOnly: true, resource: 'storage' }
      )
    }

    const reqMb = Math.min(
      Math.max(parseInt(req.query.maxMb, 10) || MAX_CEILING_MB, 1),
      MAX_CEILING_MB
    )
    const upload = multer({ storage, limits: { fileSize: reqMb * 1024 * 1024 } })

    upload.single('file')(req, res, async (err) => {
      try {
        if (err) {
          const code = err.code === 'LIMIT_FILE_SIZE' ? 'FILE_TOO_LARGE' : 'UPLOAD_FAILED'
          const msg = err.code === 'LIMIT_FILE_SIZE'
            ? `File too large. Max ${reqMb} MB.`
            : (err.message || 'Upload failed')
          return sendError(res, msg, code, 400)
        }
        if (!req.file) return sendError(res, 'No file provided', 'NO_FILE', 400)

        // ── DMS path ──────────────────────────────────────────────────────
        if (!s3Client.isEnabled(req.organization) && dms.isConfiguredFor(req.organization)) {
          const provisionalId = crypto.randomBytes(12).toString('hex')
          const taskId = String(req.query.taskId || '').trim() || undefined
          const formResponseId = String(req.query.formResponseId || '').trim() || undefined
          const workflowId = String(req.query.workflowId || '').trim() || undefined

          try {
            const doc = await dms.uploadFile({
              filePath: req.file.path,
              filename: req.file.originalname,
              mime: req.file.mimetype,
              user: req.user,
              org: req.organization,
              // Department-based folder routing: route the file into the user's
              // department sub-folder inside the org's DMS root, e.g. "acme/hr".
              // If not for an open task, it's a temporary upload (Two-Stage Upload), so place in 'staging'.
              department: forTask ? (req.user.department || null) : 'staging',
              orgSubdomain: req.organization?.subdomain || null,
              ref: {
                id: provisionalId,
                ...(taskId ? { taskId } : {}),
                ...(formResponseId ? { formResponseId } : {}),
                ...(workflowId ? { workflowId } : {}),
              },
            })

            await fs.promises.unlink(req.file.path).catch(() => {})
            await documentAccess.grant('dms:' + doc.id, req.orgId, req.user._id)

            return sendSuccess(res, {
              file: {
                name: req.file.originalname,
                url: doc.url || null,
                mime: req.file.mimetype,
                size: req.file.size,
                dmsDocId: doc.id,
                dmsDepartment: forTask ? (req.user.department || '') : 'staging',
                uploadToken: await documentAccess.issue('dms:' + doc.id, req.orgId, 'upload'),
                dmsFolder: doc.folder || null,  // department-based folder path
                provisionalId,
              },
            }, 201)
          } catch (dmsErr) {
            await fs.promises.unlink(req.file.path).catch(() => {})
            const status = dmsErr.status || 502
            const code = dmsErr.code || 'DMS_ERROR'
            if (code === 'LICENCE_READ_ONLY' || status === 403 && String(dmsErr.message || '').includes('read-only')) {
              return sendError(
                res,
                dmsErr.message || 'DMS organisation is read-only. Uploads are blocked.',
                'LICENCE_READ_ONLY',
                403,
                dmsErr.body || { resource: 'storage' }
              )
            }
            if (code === 'QUOTA_EXCEEDED' || status === 413) {
              return sendError(
                res,
                dmsErr.message || 'DMS storage quota exceeded.',
                'QUOTA_EXCEEDED',
                status === 413 ? 413 : 403,
                dmsErr.body || { resource: 'storage' }
              )
            }
            return sendError(
              res,
              dmsErr.message || 'Document service failed to accept the file.',
              code,
              status >= 400 && status < 600 ? status : 502
            )
          }
        }

        // ── S3 path ───────────────────────────────────────────────────────
        if (s3Client.isEnabled(req.organization)) {
          const s3Key = `${req.orgId}/${req.file.filename}`
          try {
            const fileBuffer = await fs.promises.readFile(req.file.path)
            await s3Client.uploadFile(req.organization, s3Key, fileBuffer, req.file.mimetype)
            await documentAccess.grant('s3:' + s3Key, req.orgId, req.user._id)
            await fs.promises.unlink(req.file.path).catch(() => {})

            return sendSuccess(res, {
              file: {
                name: req.file.originalname,
                s3Key,
                uploadToken: await documentAccess.issue('s3:' + s3Key, req.orgId, 'upload'),
                mime: req.file.mimetype,
                size: req.file.size
              }
            }, 201)
          } catch (s3Err) {
            await fs.promises.unlink(req.file.path).catch(() => {})
            console.error('[s3] upload failed:', s3Err.message)
            return sendError(res, 'S3 upload failed. Please try again or contact your administrator.', 'S3_UPLOAD_FAILED', 502)
          }
        }

        // ── Legacy local disk path ────────────────────────────────────────
        const room = await checkStorage(req.organization, req.file.size, { allowBuffer: forTask })
        if (!room.ok) {
          await fs.promises.unlink(req.file.path).catch(() => {})
          return respond(res, room)
        }

        await documentAccess.grant(`${req.orgId}/${req.file.filename}`, req.orgId, req.user._id)
        await addStorage(req.orgId, req.file.size, { bufferBytes: room.bufferBytes })

        return sendSuccess(res, {
          file: {
            name: req.file.originalname,
            url: `/api/files/${req.orgId}/${req.file.filename}?k=${await documentAccess.issue(`${req.orgId}/${req.file.filename}`, req.orgId)}`,
            uploadToken: await documentAccess.issue(`${req.orgId}/${req.file.filename}`, req.orgId, 'upload'),
            mime: req.file.mimetype,
            size: req.file.size
          },
          ...(room.bufferBytes > 0 ? { usedStorageBuffer: true } : {})
        }, 201)
      } catch (inner) {
        next(inner)
      }
    })
  } catch (e) {
    next(e)
  }
})

// POST /api/uploads/link — NetFlow-only helper: optional submitted event with ids
router.post('/link', protect, async (req, res, next) => {
  try {
    if (!dms.isEnabled()) {
      return sendError(res, 'Document service is not enabled.', 'DMS_DISABLED', 503)
    }
    const { dmsDocId, taskId, formResponseId, workflowId } = req.body || {}
    if (!dmsDocId) return sendError(res, 'dmsDocId is required', 'MISSING_FIELDS', 400)
    if (!await documentAccess.canRead('dms:' + dmsDocId, req.user, req.orgId)) return sendError(res, 'Document access denied', 'DOCUMENT_FORBIDDEN', 403)

    try {
      await dms.postEvent(dmsDocId, {
        type: 'workflow.submitted',
        actor: req.user,
        detail: 'Linked from NetFlow',
        meta: {
          ...(taskId ? { taskId } : {}),
          ...(formResponseId ? { formResponseId } : {}),
          ...(workflowId ? { workflowId } : {}),
        },
      }, { org: req.organization })
    } catch (err) {
      console.warn('[dms] link postEvent failed', err.message)
    }

    return sendSuccess(res, { dmsDocId, linked: true })
  } catch (err) {
    next(err)
  }
})

// GET /api/uploads/:dmsDocId/url — fresh signed view/download URL via DMS
router.get('/:dmsDocId/url', protect, async (req, res, next) => {
  try {
    if (!dms.isEnabled()) {
      return sendError(res, 'Document service is not enabled.', 'DMS_DISABLED', 503)
    }
    if (!await documentAccess.canRead('dms:' + req.params.dmsDocId, req.user, req.orgId)) return sendError(res, 'Document access denied', 'DOCUMENT_FORBIDDEN', 403)
    const mode = req.query.mode === 'download' ? 'download' : 'view'
    const url = await dms.signedUrl(req.params.dmsDocId, {
      mode,
      org: req.organization,
      user: req.user,
    })
    if (!url) return sendError(res, 'Could not resolve document URL', 'DMS_URL_FAILED', 502)
    return sendSuccess(res, { url, mode, dmsDocId: req.params.dmsDocId })
  } catch (err) {
    if (err.name === 'DmsError') {
      return sendError(res, err.message, err.code || 'DMS_ERROR', err.status || 502, err.body)
    }
    next(err)
  }
})

module.exports = router
