const express = require('express')
const multer = require('multer')
const rateLimit = require('express-rate-limit')
const FormGenerationJob = require('../models/FormGenerationJob')
const { protect } = require('../middleware/auth')
const { requireCanBuild, checkStorage } = require('../middleware/quota')
const { sendSuccess, sendError } = require('../utils/apiResponse')
const { policyFor } = require('../utils/pdfAutoFillPolicy')
const { storeSource, deleteSource, stagingErrorForClient } = require('../services/extractionStorage')
const { renderGenerationPage, MAX_RETRIES } = require('../services/formGenerationProcessor')
const { asStr } = require('../utils/formDraftSchema')
const { reviewedDocumentFields } = require('../services/documentReviewCompletion')
const {
  MAX_SOURCE_BYTES,
  validateSourceFile,
  safeSourceFilename
} = require('../utils/extractionSource')
const s3 = require('../services/s3Client')

const JOB_TTL_MS = 24 * 60 * 60 * 1000
const router = express.Router()
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_SOURCE_BYTES, files: 1 }
})
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: Number(process.env.PDF_AUTOFILL_RATE_LIMIT || 12),
  standardHeaders: true,
  legacyHeaders: false
})

router.use(protect, requireCanBuild)

function uploadOne(req, res) {
  return new Promise((resolve, reject) => {
    upload.single('file')(req, res, (error) => error ? reject(error) : resolve())
  })
}

function payload(job) {
  return {
    jobId: job._id,
    status: job.status,
    stage: job.stage,
    progress: job.progress,
    attempts: job.attempts,
    filename: job.sourceFile?.filename,
    mimetype: job.sourceFile?.mimetype,
    sourceType: job.sourceFile?.mimetype === 'application/pdf' ? 'pdf' : 'image',
    size: job.sourceFile?.size,
    pageCount: job.pageCount,
    pageMeta: job.pageMeta || [],
    title: job.generatedTitle || '',
    description: job.generatedDescription || '',
    documentType: job.documentType || '',
    criticStatus: job.criticStatus || 'validated',
    candidates: job.status === 'ready' ? (job.candidates || []) : [],
    confidenceSummary: job.confidenceSummary || { high: 0, medium: 0, low: 0 },
    qualitySummary: job.qualitySummary || null,
    processingVersion: job.processingVersion || 1,
    maxFields: job.maxFields || 25,
    coverage: job.coverage || null,
    limitReached: Boolean(job.limitReached || job.truncated),
    detectedFieldCount: job.detectedFieldCount || 0,
    truncated: Boolean(job.truncated),
    errorCode: job.errorCode || null,
    canRetry: job.status === 'failed' && job.attempts < MAX_RETRIES,
    expiresAt: job.expiresAt
  }
}

function findOwned(req) {
  return FormGenerationJob.findOne({
    _id: req.params.jobId,
    requesterId: req.user._id,
    orgId: req.organization._id
  })
}

router.post('/', limiter, async (req, res, next) => {
  let sourceFile = null
  let createdJob = null
  let disconnected = false
  let cleanupChain = Promise.resolve()
  const cleanupStaged = () => {
    cleanupChain = cleanupChain
      .then(async () => {
        if (sourceFile) {
          await deleteSource(sourceFile, req.organization, req.user)
          sourceFile = null
        }
        if (createdJob) {
          await FormGenerationJob.deleteOne({ _id: createdJob._id })
          createdJob = null
        }
      })
      .catch((error) => {
        console.warn('[document-form-generator] disconnected upload cleanup failed:', error.message)
      })
    return cleanupChain
  }
  const onClose = () => {
    if (res.writableEnded) return
    disconnected = true
    cleanupStaged()
  }
  res.once('close', onClose)

  try {
    const policy = policyFor(req.organization, 'authenticated')
    if (!policy.operational) {
      return sendError(res, 'Document form generation is not available right now.', 'DOCUMENT_GENERATION_DISABLED', 503)
    }
    if (!policy.entitled) {
      return sendError(res, 'Document form generation is not included for this organization.', 'DOCUMENT_GENERATION_NOT_ENTITLED', 403)
    }
    if (!policy.configured || !policy.audienceAllowed) {
      return sendError(res, 'Document form generation is disabled by the organization administrator.', 'DOCUMENT_GENERATION_NOT_ENABLED', 403)
    }

    try {
      await uploadOne(req, res)
    } catch (error) {
      if (error.code === 'LIMIT_FILE_SIZE') {
        return sendError(res, 'Document must be 25 MB or smaller.', 'FILE_TOO_LARGE', 400)
      }
      return sendError(res, 'Document upload failed.', 'UPLOAD_FAILED', 400)
    }
    if (disconnected || req.aborted) return

    const validation = validateSourceFile(req.file)
    if (validation.error) {
      return sendError(res, validation.error.message, validation.error.code, 400)
    }

    if (!s3.isEnabled(req.organization)) {
      const room = await checkStorage(req.organization, req.file.size)
      if (!room.ok) return sendError(res, room.error, room.code, room.status, room.extra)
    }

    try {
      sourceFile = await storeSource({
        buffer: req.file.buffer,
        filename: safeSourceFilename(req.file.originalname, validation.source.mimetype),
        mimetype: validation.source.mimetype,
        org: req.organization,
        user: req.user
      })
    } catch (error) {
      console.error('[document-form-generator] staging failed:', error.code || error.message)
      const failure = stagingErrorForClient(error)
      return sendError(res, failure.message, failure.code, failure.status)
    }
    if (disconnected || req.aborted) {
      await cleanupStaged()
      return
    }

    try {
      createdJob = await FormGenerationJob.create({
        orgId: req.organization._id,
        requesterId: req.user._id,
        languageMode: policy.languageMode,
        sourceFile,
        status: 'queued',
        stage: 'Queued for processing',
        progress: 0,
        expiresAt: new Date(Date.now() + JOB_TTL_MS)
      })
      if (disconnected || req.aborted) {
        await cleanupStaged()
        return
      }
      const response = sendSuccess(res, { job: payload(createdJob) }, 202)
      // The persisted job now owns the staged source.
      createdJob = null
      sourceFile = null
      return response
    } catch (error) {
      await cleanupStaged()
      throw error
    }
  } catch (error) {
    if (disconnected || req.aborted) {
      await cleanupStaged()
      return
    }
    next(error)
  } finally {
    res.off('close', onClose)
  }
})

router.get('/:jobId', async (req, res, next) => {
  try {
    const job = await findOwned(req).lean()
    if (!job) return sendError(res, 'Generation job not found.', 'GENERATION_NOT_FOUND', 404)
    return sendSuccess(res, { job: payload(job) })
  } catch (error) {
    next(error)
  }
})

router.post('/:jobId/retry', async (req, res, next) => {
  try {
    const job = await findOwned(req)
    if (!job) return sendError(res, 'Generation job not found.', 'GENERATION_NOT_FOUND', 404)
    if (job.status !== 'failed' || job.attempts >= MAX_RETRIES) {
      return sendError(res, 'This generation cannot be retried.', 'RETRY_NOT_AVAILABLE', 409)
    }
    job.status = 'queued'
    job.stage = 'Queued for retry'
    job.progress = 0
    job.errorCode = null
    job.errorDetail = null
    job.retryAt = null
    job.expiresAt = new Date(Date.now() + JOB_TTL_MS)
    await job.save()
    return sendSuccess(res, { job: payload(job) })
  } catch (error) {
    next(error)
  }
})

router.get('/:jobId/pages/:page', async (req, res, next) => {
  try {
    const job = await findOwned(req).lean()
    if (!job) return sendError(res, 'Generation job not found.', 'GENERATION_NOT_FOUND', 404)
    if (job.status !== 'ready') {
      return sendError(res, 'Source preview is not ready.', 'GENERATION_NOT_READY', 409)
    }
    const rendered = await renderGenerationPage(
      job,
      Number(req.params.page),
      req.organization,
      req.user
    )
    res.setHeader('Content-Type', 'image/png')
    res.setHeader('Cache-Control', 'private, max-age=300')
    return res.send(Buffer.from(rendered.png))
  } catch (error) {
    if (error.code === 'PAGE_NOT_FOUND') {
      return sendError(res, 'Page not found.', 'PAGE_NOT_FOUND', 404)
    }
    next(error)
  }
})

router.post('/:jobId/complete', async (req, res, next) => {
  try {
    const job = await findOwned(req)
    if (!job) return sendError(res, 'Generation job not found.', 'GENERATION_NOT_FOUND', 404)
    if (job.status !== 'ready') {
      return sendError(res, 'Generation is not ready for review.', 'GENERATION_NOT_READY', 409)
    }

    const fields = reviewedDocumentFields(job, req.body?.candidates)
    if (!fields.length) {
      return sendError(res, 'Include at least one generated field.', 'NO_FIELDS_SELECTED', 400)
    }

    const draft = {
      title: asStr(req.body?.title, 120) || job.generatedTitle,
      description: asStr(req.body?.description, 500),
      fields,
      entryMode: 'document'
    }
    await deleteSource(job.sourceFile, req.organization, req.user)
    await FormGenerationJob.deleteOne({ _id: job._id })
    console.info('[document-form-generator] review-completed', JSON.stringify({
      processingVersion: job.processingVersion || 1,
      candidates: job.candidates.length, selected: fields.length,
      selectionChanges: (req.body?.candidates || []).filter((item) => {
        const original = job.candidates.find((candidate) => candidate.candidateId === item?.candidateId)
        return original && (item.included === true) !== original.includedByDefault
      }).length
    }))
    return sendSuccess(res, { draft })
  } catch (error) {
    if (error.code === 'INVALID_REVIEWED_FIELD') return sendError(res, error.message, error.code, 400)
    next(error)
  }
})

router.delete('/:jobId', async (req, res, next) => {
  try {
    const job = await findOwned(req)
    if (!job) return sendError(res, 'Generation job not found.', 'GENERATION_NOT_FOUND', 404)
    job.status = 'cancelled'
    job.stage = 'Cancelled'
    job.progress = 100
    await job.save()
    await deleteSource(job.sourceFile, req.organization, req.user)
    await FormGenerationJob.deleteOne({ _id: job._id })
    return sendSuccess(res, { cancelled: true })
  } catch (error) {
    next(error)
  }
})

module.exports = router
