const jobLease = require('./documentJobLease')
const crypto = require('node:crypto')
const DocumentExtractionJob = require('../models/DocumentExtractionJob')
const Form = require('../models/Form')
const Organization = require('../models/Organization')
const { runWithOrgId } = require('../tenancy/tenantContext')
const { scanDocument } = require('./malwareScanner')
const { inspectDocument, renderDocumentPage } = require('./mupdfClient')
const { recognizePages } = require('./paddleOcrClient')
const { mapFields } = require('./extractionMapper')
const { loadSource, deleteSource, attachmentFor } = require('./extractionStorage')
const { runtimeReady } = require('../utils/pdfAutoFillPolicy')

const MAX_RETRIES = Math.max(1, Number(process.env.PDF_AUTOFILL_MAX_ATTEMPTS || 3))
const CONCURRENCY = Math.max(1, Number(process.env.PDF_AUTOFILL_WORKER_CONCURRENCY || 2))
const PROCESSING_STATUSES = ['security_scan', 'inspecting', 'extracting_text', 'ocr_processing', 'mapping_fields', 'validating']
const STALE_CLAIM_MS = Math.max(20 * 60 * 1000, Number(process.env.PDF_AUTOFILL_STALE_CLAIM_MS || 20 * 60 * 1000))
const SAFE_ERROR_CODES = new Set([
  'INVALID_PDF', 'INVALID_IMAGE', 'INVALID_DOCUMENT', 'INVALID_FILE_TYPE',
  'FILE_TYPE_MISMATCH', 'IMAGE_DIMENSIONS_EXCEEDED',
  'PDF_ENCRYPTED', 'PAGE_LIMIT_EXCEEDED', 'FILE_TOO_LARGE',
  'MALWARE_DETECTED', 'MALWARE_SCAN_UNAVAILABLE', 'PDF_PROCESSING_FAILED',
  'PDF_PROCESSING_TIMEOUT', 'OCR_UNAVAILABLE', 'OCR_FAILED', 'OCR_TIMEOUT',
  'LLM_UNAVAILABLE', 'MAPPING_FAILED', 'SOURCE_FILE_MISSING', 'PROCESSING_FAILED'
])
let active = 0
let ticking = false
let queueTimer = null
let cleanupTimer = null

// Backward-compatible name used by health/status callers. Tenant/audience
// access is enforced separately by pdfAutoFillPolicy.policyFor.
const featureEnabled = runtimeReady

const hashAccessToken = (token) =>
  crypto.createHash('sha256').update(String(token || '')).digest('hex')

const accessTokenMatches = (hash, token) => {
  if (!hash || !token) return false
  const actual = hashAccessToken(token)
  return actual.length === hash.length &&
    crypto.timingSafeEqual(Buffer.from(actual), Buffer.from(hash))
}

async function setStage(jobId, status, stage, progress, extra = {}) {
  const result = await DocumentExtractionJob.updateOne(
    jobLease.filter(jobId),
    { $set: { status, stage, progress, ...extra } },
    { skipOrgScope: true }
  )
  if (!result.matchedCount) throw jobLease.lost()
}

function score(value) {
  const number = Number(value) || 0
  const percent = number <= 1 ? number * 100 : number
  return Math.max(0, Math.min(100, percent))
}

function normalizeOcrLines(pages) {
  const lines = []
  for (const pageResult of pages || []) {
    const page = Number(pageResult.page)
    const width = Math.max(1, Number(pageResult.width) || 1)
    const height = Math.max(1, Number(pageResult.height) || 1)
    for (const raw of pageResult.lines || []) {
      const bbox = Array.isArray(raw.bbox) ? raw.bbox : null
      const x = bbox ? Number(bbox[0]) / width : Number(raw.x)
      const y = bbox ? Number(bbox[1]) / height : Number(raw.y)
      const boxWidth = bbox ? (Number(bbox[2]) - Number(bbox[0])) / width : Number(raw.width)
      const boxHeight = bbox ? (Number(bbox[3]) - Number(bbox[1])) / height : Number(raw.height)
      const text = String(raw.text || '').replace(/\s+/g, ' ').trim()
      if (!text || !Number.isInteger(page)) continue
      lines.push({
        page,
        text,
        confidence: score(raw.confidence),
        source: 'ocr',
        x: Math.max(0, Math.min(1, x || 0)),
        y: Math.max(0, Math.min(1, y || 0)),
        width: Math.max(0, Math.min(1, boxWidth || 0)),
        height: Math.max(0, Math.min(1, boxHeight || 0))
      })
    }
  }
  return lines
}

function assignLineIds(lines) {
  const countByPage = new Map()
  return lines.map((line) => {
    const current = (countByPage.get(line.page) || 0) + 1
    countByPage.set(line.page, current)
    return { ...line, id: 'p' + line.page + '-' + line.source + '-' + current }
  })
}

async function processJob(job) {
  try {
    const org = await Organization.findById(job.orgId).lean()
    const form = await Form.findOne({ _id: job.formId, orgId: job.orgId }).lean()
    if (!org || !form) {
      const error = new Error('PDF auto-fill is no longer available for this form')
      error.code = 'FORM_NOT_AVAILABLE'
      throw error
    }

    await runWithOrgId(job.orgId, async () => {
      const mimetype = job.sourceFile?.mimetype || 'application/pdf'
      const isPdf = mimetype === 'application/pdf'
      const buffer = await loadSource(job.sourceFile, org, null)
      await setStage(job._id, 'security_scan', 'Checking file safety', 8)
      await scanDocument(buffer)

      await setStage(job._id, 'inspecting', isPdf ? 'Inspecting PDF' : 'Inspecting image', 18)
      const inspected = await inspectDocument(buffer, mimetype)

      await setStage(job._id, 'extracting_text', isPdf ? 'Extracting digital text' : 'Preparing image for OCR', 38, {
        pageCount: inspected.pageCount,
        pageMeta: inspected.pages.map((page) => ({
          page: page.page,
          width: page.width,
          height: page.height,
          textLength: page.textLength,
          usedOcr: page.needsOcr
        }))
      })

      const ocrPageNumbers = new Set(inspected.renderedPages.map((page) => page.page))
      const digitalLines = inspected.pages
        .filter((page) => !ocrPageNumbers.has(page.page))
        .flatMap((page) => page.lines || [])
      let ocrLines = []

      if (inspected.renderedPages.length) {
        await setStage(
          job._id,
          'ocr_processing',
          'Reading scanned pages with OCR',
          55
        )
        ocrLines = normalizeOcrLines(
          await recognizePages(inspected.renderedPages)
        )
      }

      const lines = assignLineIds([...digitalLines, ...ocrLines].sort((a, b) =>
        a.page - b.page || a.y - b.y || a.x - b.x
      ))

      await setStage(job._id, 'mapping_fields', 'AI mapping document values to form fields', 76, { lines })
      const mappingResult = await mapFields(form, lines)
      const suggestions = mappingResult.suggestions

      await setStage(job._id, 'validating', 'Validating suggested values', 92)
      const summary = suggestions.reduce((out, item) => {
        out[item.tier] += 1
        return out
      }, { high: 0, medium: 0, low: 0 })

      await setStage(job._id, 'ready', 'Ready for review', 100, {
        suggestions,
        summary,
        templateFingerprint: mappingResult.templateFingerprint,
        documentType: mappingResult.documentType,
        criticStatus: mappingResult.criticStatus,
        errorCode: null,
        errorDetail: null
      })
    })
  } catch (error) {
    if (error?.code === 'DOCUMENT_LEASE_LOST') return
    const rawCode = String(error?.code || '')
    const code = SAFE_ERROR_CODES.has(rawCode) ? rawCode : (
      rawCode === 'FORM_NOT_AVAILABLE' ? rawCode : 'PROCESSING_FAILED'
    )
    await DocumentExtractionJob.updateOne(
      jobLease.filter(job._id),
      {
        $set: {
          status: 'failed',
          stage: 'Processing failed',
          progress: 100,
          errorCode: code,
          errorDetail: String(error?.message || error).slice(0, 1000)
        }
      },
      { skipOrgScope: true }
    )
  }
}

async function claimNext() {
  return DocumentExtractionJob.findOneAndUpdate(
    { status: 'queued', attempts: { $lt: MAX_RETRIES }, expiresAt: { $gt: new Date() } },
    {
      $set: {
        status: 'security_scan',
        stage: 'Checking file safety',
        progress: 5,
        claimedAt: new Date()
      },
      $inc: { attempts: 1 }
    },
    { returnDocument: 'after', sort: { createdAt: 1 }, skipOrgScope: true }
  ).lean()
}

async function recoverStaleJobs() {
  const staleBefore = new Date(Date.now() - STALE_CLAIM_MS)
  const base = {
    status: { $in: PROCESSING_STATUSES },
    claimedAt: { $lte: staleBefore },
    expiresAt: { $gt: new Date() }
  }
  await DocumentExtractionJob.updateMany(
    { ...base, attempts: { $lt: MAX_RETRIES } },
    { $set: { status: 'queued', stage: 'Recovered after worker restart', progress: 0, claimedAt: null } },
    { skipOrgScope: true }
  )
  await DocumentExtractionJob.updateMany(
    { ...base, attempts: { $gte: MAX_RETRIES } },
    { $set: { status: 'failed', stage: 'Processing failed', progress: 100, errorCode: 'PROCESSING_FAILED' } },
    { skipOrgScope: true }
  )
}

async function tick() {
  if (!featureEnabled() || ticking) return
  ticking = true
  try {
    while (active < CONCURRENCY) {
      const job = await claimNext()
      if (!job) break
      active += 1
      require('../jobs/monitor').track(jobLease.run(DocumentExtractionJob, job, PROCESSING_STATUSES, () => processJob(job)))
        .catch((error) => console.error('[pdf-auto-fill] worker failed:', error.message))
        .finally(() => { active -= 1 })
    }
  } finally {
    ticking = false
  }
}

async function cleanupExpired() {
  const now = new Date()
  const jobs = await DocumentExtractionJob.find({
    expiresAt: { $lte: now },
    consumedResponseId: null
  }).setOptions({ skipOrgScope: true }).limit(100).lean()

  for (const job of jobs) {
    try {
      const org = await Organization.findById(job.orgId).lean()
      if (org) await deleteSource(job.sourceFile, org, null)
    } catch (error) {
      console.warn('[pdf-auto-fill] staged source cleanup failed:', error.message)
      continue
    }
    await DocumentExtractionJob.deleteOne({ _id: job._id }).setOptions({ skipOrgScope: true })
  }

  // The retained PDF belongs to the submitted response after consumption, so
  // only remove the temporary extraction metadata for consumed jobs.
  await DocumentExtractionJob.deleteMany({
    expiresAt: { $lte: now },
    consumedResponseId: { $ne: null }
  }).setOptions({ skipOrgScope: true })
}

function startExtractionProcessor() {
  if (queueTimer) return
  const monitor = require('../jobs/monitor')
  // Recovery and cleanup remain active when document processing is disabled.
  cleanupTimer = monitor.interval('extraction-cleanup', 3600000, async () => {
    await recoverStaleJobs()
    await cleanupExpired()
  })
  cleanupTimer.run()
  if (featureEnabled()) queueTimer = monitor.interval('extraction', 1000, tick)
}


async function renderJobPage(job, pageNumber, org, user) {
  const buffer = await loadSource(job.sourceFile, org, user)
  return renderDocumentPage(
    buffer,
    job.sourceFile?.mimetype || 'application/pdf',
    pageNumber,
    1.6
  )
}

async function prepareExtractionAttachment({ extraction, formId, org, requesterId, audience }) {
  if (!extraction?.jobId) return null
  if (extraction.reviewConfirmed !== true) {
    const error = new Error('Please confirm that you reviewed the auto-filled information')
    error.code = 'EXTRACTION_REVIEW_REQUIRED'
    error.statusCode = 400
    throw error
  }

  const job = await DocumentExtractionJob.findOne({
    _id: extraction.jobId,
    formId,
    orgId: org._id
  }).select('+accessTokenHash').setOptions({ skipOrgScope: true })
  if (!job || job.audience !== audience) {
    const error = new Error('Extraction job not found')
    error.code = 'EXTRACTION_NOT_FOUND'
    error.statusCode = 404
    throw error
  }
  if (audience === 'authenticated' && String(job.requesterId) !== String(requesterId)) {
    const error = new Error('Extraction job not found')
    error.code = 'EXTRACTION_NOT_FOUND'
    error.statusCode = 404
    throw error
  }
  if (audience === 'public' && !accessTokenMatches(job.accessTokenHash, extraction.accessToken)) {
    const error = new Error('Extraction access token is invalid')
    error.code = 'EXTRACTION_ACCESS_DENIED'
    error.statusCode = 403
    throw error
  }
  if (job.status !== 'ready') {
    const error = new Error('Extraction is not ready')
    error.code = 'EXTRACTION_NOT_READY'
    error.statusCode = 409
    throw error
  }
  if (job.consumedResponseId) {
    const error = new Error('Extraction has already been submitted')
    error.code = 'EXTRACTION_ALREADY_CONSUMED'
    error.statusCode = 409
    throw error
  }
  if (job.expiresAt <= new Date()) {
    const error = new Error('Extraction has expired')
    error.code = 'EXTRACTION_EXPIRED'
    error.statusCode = 410
    throw error
  }

  return { job, attachment: await attachmentFor(job.sourceFile, org, null) }
}

async function markExtractionConsumed(jobId, responseId) {
  const result = await DocumentExtractionJob.updateOne(
    { _id: jobId, consumedResponseId: null },
    { $set: { consumedResponseId: responseId, consumedAt: new Date(), expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) } },
    { skipOrgScope: true }
  )
  if (result.modifiedCount !== 1) {
    const error = new Error('Extraction has already been submitted')
    error.code = 'EXTRACTION_ALREADY_CONSUMED'
    error.statusCode = 409
    throw error
  }
}

async function releaseExtractionClaim(jobId, responseId) {
  await DocumentExtractionJob.updateOne(
    { _id: jobId, consumedResponseId: responseId },
    { $set: { consumedResponseId: null, consumedAt: null, expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000) } },
    { skipOrgScope: true }
  )
}

module.exports = {
  featureEnabled,
  hashAccessToken,
  accessTokenMatches,
  startExtractionProcessor,
  renderJobPage,
  prepareExtractionAttachment,
  markExtractionConsumed,
  releaseExtractionClaim,
  MAX_RETRIES
}
