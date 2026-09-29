const jobLease = require('./documentJobLease')
const FormGenerationJob = require('../models/FormGenerationJob')
const Organization = require('../models/Organization')
const { runWithOrgId } = require('../tenancy/tenantContext')
const { scanDocument } = require('./malwareScanner')
const { inspectDocument, renderDocumentPage } = require('./mupdfClient')
const { recognizePages } = require('./paddleOcrClient')
const { generateDocumentFormDraft } = require('./documentFormMapper')
const { extractionGaps } = require('./documentCandidateAudit')
const { loadSource, deleteSource } = require('./extractionStorage')
const { runtimeReady } = require('../utils/pdfAutoFillPolicy')

const MAX_RETRIES = Math.max(1, Number(process.env.PDF_AUTOFILL_MAX_ATTEMPTS || 3))
const CONCURRENCY = Math.max(1, Number(process.env.PDF_AUTOFILL_WORKER_CONCURRENCY || 1))
const STALE_CLAIM_MS = Math.max(
  20 * 60 * 1000,
  Number(process.env.PDF_AUTOFILL_STALE_CLAIM_MS || 20 * 60 * 1000)
)
const MAX_STORED_LINE_CHARACTERS = 120000
const MAX_STORED_LINES = 4000
const PROCESSING_STATUSES = [
  'security_scan', 'inspecting', 'extracting_text',
  'ocr_processing', 'generating_schema', 'validating'
]
const RETRYABLE_CODES = new Set([
  'LLM_UNAVAILABLE', 'LLM_RATE_LIMITED', 'LLM_TIMEOUT',
  'OCR_UNAVAILABLE', 'OCR_TIMEOUT',
  'PDF_PROCESSING_TIMEOUT', 'MALWARE_SCAN_UNAVAILABLE'
])
const SAFE_ERROR_CODES = new Set([
  'INVALID_PDF', 'INVALID_IMAGE', 'INVALID_DOCUMENT', 'INVALID_FILE_TYPE',
  'FILE_TYPE_MISMATCH', 'IMAGE_DIMENSIONS_EXCEEDED', 'PDF_ENCRYPTED',
  'PAGE_LIMIT_EXCEEDED', 'FILE_TOO_LARGE', 'MALWARE_DETECTED',
  'MALWARE_SCAN_UNAVAILABLE', 'PDF_PROCESSING_FAILED',
  'PDF_PROCESSING_TIMEOUT', 'OCR_UNAVAILABLE', 'OCR_FAILED', 'OCR_TIMEOUT',
  'LLM_UNAVAILABLE', 'LLM_RATE_LIMITED', 'LLM_AUTHENTICATION_FAILED',
  'LLM_MODEL_UNAVAILABLE', 'LLM_TIMEOUT', 'LLM_OUTPUT_TRUNCATED',
  'LLM_QUOTA_EXHAUSTED',
  'SCHEMA_INVALID', 'NO_FIELDS_DETECTED', 'DOCUMENT_INPUT_TOO_LARGE',
  'SOURCE_FILE_MISSING', 'PROCESSING_FAILED'
])

let active = 0
let ticking = false
let queueTimer = null
let cleanupTimer = null

function retryDelayFor(code, attempts) {
  const exponent = Math.max(0, Number(attempts || 1) - 1)
  if (code === 'LLM_UNAVAILABLE' || code === 'LLM_RATE_LIMITED' || code === 'LLM_TIMEOUT') {
    return Math.min(60000, 20000 * Math.pow(2, exponent))
  }
  return Math.min(15000, 1500 * Math.pow(2, exponent))
}

const cancellationError = () => {
  const error = new Error('Document form generation was cancelled')
  error.code = 'GENERATION_CANCELLED'
  return error
}

const score = (value) => {
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
      const text = String(raw.text || '').replace(/\s+/g, ' ').trim()
      if (!text || !Number.isInteger(page)) continue
      const x = bbox ? Number(bbox[0]) / width : Number(raw.x)
      const y = bbox ? Number(bbox[1]) / height : Number(raw.y)
      const boxWidth = bbox ? (Number(bbox[2]) - Number(bbox[0])) / width : Number(raw.width)
      const boxHeight = bbox ? (Number(bbox[3]) - Number(bbox[1])) / height : Number(raw.height)
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

function boundedStoredLines(lines) {
  const bounded = []
  let characters = 0
  for (const line of lines || []) {
    const length = String(line?.text || '').length
    if (bounded.length >= MAX_STORED_LINES || characters + length > MAX_STORED_LINE_CHARACTERS) break
    bounded.push(line)
    characters += length
  }
  return bounded
}

async function assertJobActive(jobId) {
  const exists = await FormGenerationJob.exists({
    ...jobLease.filter(jobId)
  }).setOptions({ skipOrgScope: true })
  if (!exists) throw cancellationError()
}

async function setStage(jobId, status, stage, progress, extra = {}) {
  const result = await FormGenerationJob.updateOne(
    jobLease.filter(jobId),
    { $set: { status, stage, progress, ...extra } },
    { skipOrgScope: true }
  )
  if (!result.matchedCount) throw cancellationError()
}

async function processJob(job) {
  try {
    const org = await Organization.findById(job.orgId).lean()
    if (!org) {
      const error = new Error('Document form generation is no longer available for this organization')
      error.code = 'PROCESSING_FAILED'
      throw error
    }

    await runWithOrgId(job.orgId, async () => {
      const mimetype = job.sourceFile?.mimetype || 'application/pdf'
      const isPdf = mimetype === 'application/pdf'
      const buffer = await loadSource(job.sourceFile, org, null)

      await setStage(job._id, 'security_scan', 'Checking file safety', 8)
      await scanDocument(buffer)
      await assertJobActive(job._id)

      await setStage(job._id, 'inspecting', isPdf ? 'Inspecting PDF' : 'Inspecting image', 18)
      const inspected = await inspectDocument(buffer, mimetype)
      await assertJobActive(job._id)

      await setStage(job._id, 'extracting_text', 'Extracting document structure', 38, {
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
        await setStage(job._id, 'ocr_processing', 'Reading scanned pages with OCR', 55)
        ocrLines = normalizeOcrLines(
          await recognizePages(inspected.renderedPages)
        )
        await assertJobActive(job._id)
      }

      const lines = assignLineIds([...digitalLines, ...ocrLines].sort((a, b) =>
        a.page - b.page || a.y - b.y || a.x - b.x
      ))
      await setStage(job._id, 'generating_schema', 'Generating grounded form fields', 76, {
        lines: boundedStoredLines(lines)
      })
      const generationStarted = Date.now()
      const draft = await generateDocumentFormDraft(lines, { filename: job.sourceFile.filename })
      await assertJobActive(job._id)
      const gaps = extractionGaps(inspected.pages, lines)
      draft.coverage = { ...draft.coverage, ...gaps }
      if (gaps.unreadablePageCount || gaps.lowConfidenceOcrPageCount) draft.coverage.status = 'partial'
      // Counts/reason codes only: never log document text, values or model output.
      console.info('[document-form-generator] review', JSON.stringify({
        processingVersion: draft.processingVersion, fields: draft.candidates.length,
        coverage: draft.coverage, limitReached: draft.limitReached, diagnostics: draft.diagnostics,
        generationDurationMs: Date.now() - generationStarted
      }))

      await setStage(job._id, 'validating', 'Validating field types and confidence', 92)
      await setStage(job._id, 'ready', 'Ready for review', 100, {
        generatedTitle: draft.title,
        generatedDescription: draft.description,
        documentType: draft.documentType,
        criticStatus: draft.criticStatus,
        candidates: draft.candidates,
        confidenceSummary: draft.confidenceSummary,
        qualitySummary: draft.qualitySummary,
        processingVersion: draft.processingVersion,
        maxFields: draft.maxFields,
        limitReached: draft.limitReached,
        coverage: draft.coverage,
        truncated: draft.truncated,
        detectedFieldCount: draft.detectedFieldCount,
        errorCode: null,
        errorDetail: null,
        retryAt: null
      })
    })
  } catch (error) {
    if (error?.code === 'GENERATION_CANCELLED') return
    const rawCode = String(error?.code || '')
    const code = SAFE_ERROR_CODES.has(rawCode) ? rawCode : 'PROCESSING_FAILED'
    if (RETRYABLE_CODES.has(code) && job.attempts < MAX_RETRIES) {
      const retryDelay = retryDelayFor(code, job.attempts)
      await FormGenerationJob.updateOne(
        jobLease.filter(job._id),
        {
          $set: {
            status: 'queued',
            stage: 'Retrying temporary processing failure',
            progress: 0,
            retryAt: new Date(Date.now() + retryDelay),
            errorCode: null,
            errorDetail: null
          }
        },
        { skipOrgScope: true }
      )
      return
    }

    await FormGenerationJob.updateOne(
      jobLease.filter(job._id),
      {
        $set: {
          status: 'failed',
          stage: 'Processing failed',
          progress: 100,
          retryAt: null,
          errorCode: code,
          errorDetail: String(error?.message || error).slice(0, 1000)
        }
      },
      { skipOrgScope: true }
    )
  }
}

async function claimNext() {
  const now = new Date()
  return FormGenerationJob.findOneAndUpdate(
    {
      status: 'queued',
      attempts: { $lt: MAX_RETRIES },
      expiresAt: { $gt: now },
      $or: [{ retryAt: null }, { retryAt: { $lte: now } }]
    },
    {
      $set: {
        status: 'security_scan',
        stage: 'Checking file safety',
        progress: 5,
        claimedAt: now,
        retryAt: null
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
  await FormGenerationJob.updateMany(
    { ...base, attempts: { $lt: MAX_RETRIES } },
    {
      $set: {
        status: 'queued',
        stage: 'Recovered after worker restart',
        progress: 0,
        claimedAt: null,
        retryAt: null
      }
    },
    { skipOrgScope: true }
  )
  await FormGenerationJob.updateMany(
    { ...base, attempts: { $gte: MAX_RETRIES } },
    {
      $set: {
        status: 'failed',
        stage: 'Processing failed',
        progress: 100,
        errorCode: 'PROCESSING_FAILED'
      }
    },
    { skipOrgScope: true }
  )
}

async function tick() {
  if (!runtimeReady() || ticking) return
  ticking = true
  try {
    while (active < CONCURRENCY) {
      const job = await claimNext()
      if (!job) break
      active += 1
      require('../jobs/monitor').track(jobLease.run(FormGenerationJob, job, PROCESSING_STATUSES, () => processJob(job)))
        .catch((error) => console.error('[document-form-generator] worker failed:', error.message))
        .finally(() => { active -= 1 })
    }
  } finally {
    ticking = false
  }
}

async function cleanupExpired() {
  const jobs = await FormGenerationJob.find({
    expiresAt: { $lte: new Date() }
  }).setOptions({ skipOrgScope: true }).limit(100).lean()
  for (const job of jobs) {
    try {
      const org = await Organization.findById(job.orgId).lean()
      if (org) {
        await deleteSource(job.sourceFile, org, null)
      } else if (job.sourceFile?.storage === 'local') {
        // Local sources only need the tenant id to resolve their isolated path.
        await deleteSource(job.sourceFile, { _id: job.orgId }, null)
      } else {
        // Remote deletion needs the organization's credentials. Keep the job so
        // an administrative cleanup can recover it instead of orphaning a file.
        console.warn('[document-form-generator] expired remote source retained because organization is unavailable')
        continue
      }
    } catch (error) {
      console.warn('[document-form-generator] source cleanup failed:', error.message)
      continue
    }
    await FormGenerationJob.deleteOne({ _id: job._id }).setOptions({ skipOrgScope: true })
  }
}

function startFormGenerationProcessor() {
  if (queueTimer) return
  const monitor = require('../jobs/monitor')
  // Recovery and cleanup remain active when document processing is disabled.
  cleanupTimer = monitor.interval('form-generation-cleanup', 3600000, async () => {
    await recoverStaleJobs()
    await cleanupExpired()
  })
  cleanupTimer.run()
  if (runtimeReady()) queueTimer = monitor.interval('form-generation', 1000, tick)
}


async function renderGenerationPage(job, pageNumber, org, user) {
  const buffer = await loadSource(job.sourceFile, org, user)
  return renderDocumentPage(
    buffer,
    job.sourceFile?.mimetype || 'application/pdf',
    pageNumber,
    1.6
  )
}

module.exports = {
  startFormGenerationProcessor,
  claimNext,
  recoverStaleJobs,
  renderGenerationPage,
  cleanupExpired,
  boundedStoredLines,
  retryDelayFor,
  MAX_RETRIES
}
