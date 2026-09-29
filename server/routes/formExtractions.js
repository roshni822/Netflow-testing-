const express = require('express')
const crypto = require('node:crypto')
const multer = require('multer')
const rateLimit = require('express-rate-limit')
const Form = require('../models/Form')
const Organization = require('../models/Organization')
const DocumentExtractionJob = require('../models/DocumentExtractionJob')
const { protect } = require('../middleware/auth')
const { checkStorage } = require('../middleware/quota')
const { sendSuccess, sendError } = require('../utils/apiResponse')
const { storeSource, deleteSource, stagingErrorForClient } = require('../services/extractionStorage')
const {
  hashAccessToken,
  accessTokenMatches,
  renderJobPage,
  MAX_RETRIES
} = require('../services/extractionProcessor')
const { policyFor } = require('../utils/pdfAutoFillPolicy')
const {
  MAX_SOURCE_BYTES,
  validateSourceFile,
  safeSourceFilename
} = require('../utils/extractionSource')
const s3 = require('../services/s3Client')

const JOB_TTL_MS = 24 * 60 * 60 * 1000
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

function uploadOne(req, res) {
  return new Promise((resolve, reject) => {
    upload.single('file')(req, res, (error) => error ? reject(error) : resolve())
  })
}

function publicForm(token) {
  return Form.findOne({
    'public.enabled': true,
    'public.token': token,
    status: 'published'
  }).setOptions({ skipOrgScope: true }).lean()
}

function payload(job) {
  const suggestions = job.status === 'ready'
    ? (job.suggestions || []).map((suggestion) => {
        const value = typeof suggestion?.toObject === 'function' ? suggestion.toObject() : suggestion
        return {
          fieldId: value.fieldId,
          value: value.value,
          confidence: value.confidence,
          tier: value.tier,
          generatorConfidence: value.generatorConfidence,
          criticConfidence: value.criticConfidence,
          criticApproved: value.criticApproved === true,
          criticStatus: value.criticStatus || 'fallback',
          sourceLabel: value.sourceLabel || '',
          decisionReason: value.decisionReason || '',
          valid: value.valid,
          validationMessage: value.validationMessage || null,
          sourceRegions: (value.sourceRegions || []).map((region) => {
            const source = typeof region?.toObject === 'function' ? region.toObject() : region
            return {
              lineId: source.lineId,
              page: source.page,
              x: source.x,
              y: source.y,
              width: source.width,
              height: source.height,
              confidence: source.confidence
            }
          })
        }
      })
    : []
  return {
    jobId: job._id,
    status: job.status,
    stage: job.stage,
    progress: job.progress,
    filename: job.sourceFile?.filename,
    mimetype: job.sourceFile?.mimetype || 'application/pdf',
    sourceType: job.sourceFile?.mimetype === 'application/pdf' ? 'pdf' : 'image',
    size: job.sourceFile?.size,
    pageCount: job.pageCount,
    languageMode: job.languageMode || 'english_hindi',
    documentType: job.documentType || 'document',
    criticStatus: job.criticStatus || 'fallback',
    pageMeta: job.pageMeta || [],
    summary: job.summary || { high: 0, medium: 0, low: 0 },
    suggestions,
    errorCode: job.errorCode || null,
    canRetry: job.status === 'failed' && job.attempts < MAX_RETRIES,
    expiresAt: job.expiresAt,
    consumed: Boolean(job.consumedResponseId)
  }
}

async function createJob({ req, res, form, org, audience, requesterId }) {
  const policy = policyFor(org, audience)
  if (!policy.operational) {
    return sendError(res, 'PDF auto-fill is not available right now.', 'AUTO_FILL_DISABLED', 503)
  }
  if (!policy.entitled) {
    return sendError(res, 'PDF auto-fill is not included for this organization.', 'AUTO_FILL_NOT_ENTITLED', 403)
  }
  if (!policy.configured) {
    return sendError(res, 'PDF auto-fill is disabled by the organization administrator.', 'AUTO_FILL_NOT_ENABLED', 403)
  }
  if (!policy.audienceAllowed) {
    return sendError(res, 'PDF auto-fill is not enabled for this form audience.', 'AUTO_FILL_AUDIENCE_DISABLED', 403)
  }

  try {
    await uploadOne(req, res)
  } catch (error) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return sendError(res, 'Document must be 25 MB or smaller.', 'FILE_TOO_LARGE', 400)
    }
    return sendError(res, 'Document upload failed.', 'UPLOAD_FAILED', 400)
  }

  const validation = validateSourceFile(req.file)
  if (validation.error) {
    return sendError(res, validation.error.message, validation.error.code, 400)
  }

  if (!s3.isEnabled(org)) {
    const room = await checkStorage(org, req.file.size)
    if (!room.ok) {
      return sendError(res, 'Storage limit reached. Remove files or contact your administrator.', 'LIMIT_REACHED', 403)
    }
  }

  let sourceFile
  try {
    sourceFile = await storeSource({
      buffer: req.file.buffer,
      filename: safeSourceFilename(req.file.originalname, validation.source.mimetype),
      mimetype: validation.source.mimetype,
      org,
      user: req.user || null
    })
  } catch (error) {
    console.error('[document-auto-fill] staging failed:', error.code || error.message)
    const failure = stagingErrorForClient(error)
    return sendError(res, failure.message, failure.code, failure.status)
  }

  const accessToken = audience === 'public' ? crypto.randomBytes(32).toString('base64url') : null
  try {
    const job = await DocumentExtractionJob.create({
      orgId: org._id,
      formId: form._id,
      requesterId: requesterId || null,
      audience,
      languageMode: policy.languageMode,
      accessTokenHash: accessToken ? hashAccessToken(accessToken) : null,
      sourceFile,
      status: 'queued',
      stage: 'Queued for processing',
      progress: 0,
      expiresAt: new Date(Date.now() + JOB_TTL_MS)
    })
    return sendSuccess(res, {
      job: payload(job),
      ...(accessToken ? { accessToken } : {})
    }, 202)
  } catch (error) {
    await deleteSource(sourceFile, org, req.user || null).catch(() => {})
    throw error
  }
}

function authenticatedRouter() {
  const router = express.Router({ mergeParams: true })
  router.use(protect)

  router.post('/', limiter, async (req, res, next) => {
    try {
      const form = await Form.findById(req.params.formId).lean()
      if (!form) return sendError(res, 'Form not found', 'FORM_NOT_FOUND', 404)
      return createJob({
        req,
        res,
        form,
        org: req.organization,
        audience: 'authenticated',
        requesterId: req.user._id
      })
    } catch (error) {
      next(error)
    }
  })

  const findOwned = (req, includeToken = false) => {
    let query = DocumentExtractionJob.findOne({
      _id: req.params.jobId,
      formId: req.params.formId,
      requesterId: req.user._id,
      audience: 'authenticated'
    })
    if (includeToken) query = query.select('+accessTokenHash')
    return query
  }

  router.get('/:jobId', async (req, res, next) => {
    try {
      const job = await findOwned(req).lean()
      if (!job) return sendError(res, 'Extraction job not found', 'EXTRACTION_NOT_FOUND', 404)
      return sendSuccess(res, { job: payload(job) })
    } catch (error) { next(error) }
  })

  router.post('/:jobId/retry', async (req, res, next) => {
    try {
      const job = await findOwned(req)
      if (!job) return sendError(res, 'Extraction job not found', 'EXTRACTION_NOT_FOUND', 404)
      if (job.status !== 'failed' || job.attempts >= MAX_RETRIES) {
        return sendError(res, 'This extraction cannot be retried.', 'RETRY_NOT_AVAILABLE', 409)
      }
      job.status = 'queued'
      job.stage = 'Queued for retry'
      job.progress = 0
      job.errorCode = null
      job.expiresAt = new Date(Date.now() + JOB_TTL_MS)
      await job.save()
      return sendSuccess(res, { job: payload(job) })
    } catch (error) { next(error) }
  })

  router.delete('/:jobId', async (req, res, next) => {
    try {
      const job = await findOwned(req)
      if (!job) return sendError(res, 'Extraction job not found', 'EXTRACTION_NOT_FOUND', 404)
      if (job.consumedResponseId) return sendError(res, 'Submitted source documents cannot be cancelled.', 'ALREADY_SUBMITTED', 409)
      job.status = 'cancelled'
      job.stage = 'Cancelled'
      job.progress = 100
      await job.save()
      await deleteSource(job.sourceFile, req.organization, req.user)
      await DocumentExtractionJob.deleteOne({ _id: job._id })
      return sendSuccess(res, { job: payload(job) })
    } catch (error) { next(error) }
  })

  router.get('/:jobId/pages/:page', async (req, res, next) => {
    try {
      const job = await findOwned(req).lean()
      if (!job) return sendError(res, 'Extraction job not found', 'EXTRACTION_NOT_FOUND', 404)
      if (job.status !== 'ready') return sendError(res, 'Source preview is not ready', 'EXTRACTION_NOT_READY', 409)
      const rendered = await renderJobPage(job, Number(req.params.page), req.organization, req.user)
      res.setHeader('Content-Type', 'image/png')
      res.setHeader('Cache-Control', 'private, max-age=300')
      return res.send(Buffer.from(rendered.png))
    } catch (error) {
      if (error.code === 'PAGE_NOT_FOUND') return sendError(res, 'Page not found', 'PAGE_NOT_FOUND', 404)
      next(error)
    }
  })

  return router
}

function publicRouter() {
  const router = express.Router({ mergeParams: true })

  async function context(req, res) {
    const form = await publicForm(req.params.token)
    if (!form) {
      sendError(res, 'This form is not available.', 'FORM_NOT_FOUND', 404)
      return null
    }
    const org = await Organization.findById(form.orgId).lean()
    if (!org) {
      sendError(res, 'This form is not available.', 'FORM_NOT_FOUND', 404)
      return null
    }
    return { form, org }
  }

  async function findAccessible(req) {
    const form = await publicForm(req.params.token)
    if (!form) return null
    const job = await DocumentExtractionJob.findOne({
      _id: req.params.jobId,
      formId: form._id,
      audience: 'public'
    }).select('+accessTokenHash').setOptions({ skipOrgScope: true })
    const token = req.get('x-extraction-token')
    if (!job || !accessTokenMatches(job.accessTokenHash, token)) return null
    return job
  }

  router.post('/', limiter, async (req, res, next) => {
    try {
      const ctx = await context(req, res)
      if (!ctx) return
      return createJob({ req, res, ...ctx, audience: 'public', requesterId: null })
    } catch (error) { next(error) }
  })

  router.get('/:jobId', async (req, res, next) => {
    try {
      const job = await findAccessible(req)
      if (!job || String(job.formId) === '') return sendError(res, 'Extraction job not found', 'EXTRACTION_NOT_FOUND', 404)
      const form = await publicForm(req.params.token)
      if (!form || String(job.formId) !== String(form._id)) return sendError(res, 'Extraction job not found', 'EXTRACTION_NOT_FOUND', 404)
      return sendSuccess(res, { job: payload(job) })
    } catch (error) { next(error) }
  })

  router.post('/:jobId/retry', async (req, res, next) => {
    try {
      const job = await findAccessible(req)
      const form = await publicForm(req.params.token)
      if (!job || !form || String(job.formId) !== String(form._id)) {
        return sendError(res, 'Extraction job not found', 'EXTRACTION_NOT_FOUND', 404)
      }
      if (job.status !== 'failed' || job.attempts >= MAX_RETRIES) {
        return sendError(res, 'This extraction cannot be retried.', 'RETRY_NOT_AVAILABLE', 409)
      }
      job.status = 'queued'
      job.stage = 'Queued for retry'
      job.progress = 0
      job.errorCode = null
      job.expiresAt = new Date(Date.now() + JOB_TTL_MS)
      await job.save()
      return sendSuccess(res, { job: payload(job) })
    } catch (error) { next(error) }
  })

  router.delete('/:jobId', async (req, res, next) => {
    try {
      const job = await findAccessible(req)
      const ctx = await context(req, res)
      if (!job || !ctx || String(job.formId) !== String(ctx.form._id)) {
        return sendError(res, 'Extraction job not found', 'EXTRACTION_NOT_FOUND', 404)
      }
      if (job.consumedResponseId) return sendError(res, 'Submitted source documents cannot be cancelled.', 'ALREADY_SUBMITTED', 409)
      job.status = 'cancelled'
      job.stage = 'Cancelled'
      job.progress = 100
      await job.save()
      await deleteSource(job.sourceFile, ctx.org, null)
      await DocumentExtractionJob.deleteOne({ _id: job._id }).setOptions({ skipOrgScope: true })
      return sendSuccess(res, { job: payload(job) })
    } catch (error) { next(error) }
  })

  router.get('/:jobId/pages/:page', async (req, res, next) => {
    try {
      const job = await findAccessible(req)
      const ctx = await context(req, res)
      if (!job || !ctx || String(job.formId) !== String(ctx.form._id)) {
        return sendError(res, 'Extraction job not found', 'EXTRACTION_NOT_FOUND', 404)
      }
      if (job.status !== 'ready') return sendError(res, 'Source preview is not ready', 'EXTRACTION_NOT_READY', 409)
      const rendered = await renderJobPage(job, Number(req.params.page), ctx.org, null)
      res.setHeader('Content-Type', 'image/png')
      res.setHeader('Cache-Control', 'private, max-age=300')
      return res.send(Buffer.from(rendered.png))
    } catch (error) {
      if (error.code === 'PAGE_NOT_FOUND') return sendError(res, 'Page not found', 'PAGE_NOT_FOUND', 404)
      next(error)
    }
  })

  return router
}

module.exports = { authenticatedRouter, publicRouter }
