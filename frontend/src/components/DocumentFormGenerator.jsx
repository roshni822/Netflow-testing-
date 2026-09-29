import { useEffect, useRef, useState } from 'react'
import {
  AlertCircle, Check, FileText, LoaderCircle, RefreshCw,
  Sparkles, Upload, X
} from 'lucide-react'
import { api, uploadWithProgress } from '../utils/api'
import DocumentFormReview from './DocumentFormReview'
import DocumentSourcePreview from './DocumentSourcePreview'
import { DocumentQualitySummary } from './DocumentConfidence'

const TERMINAL = new Set(['ready', 'failed', 'cancelled'])
const BASE = '/api/forms/document-drafts'
const PROCESSING_STAGES = [
  { key: 'uploading', label: 'Upload' },
  { key: 'security_scan', label: 'Security scan' },
  { key: 'inspecting', label: 'MuPdf' },
  { key: 'extracting_text', label: 'Extract content' },
  { key: 'ocr_processing', label: 'OCR' },
  { key: 'generating_schema', label: 'Generate form fields' },
  { key: 'validating', label: 'Validate structure' }
]
const PROCESSING_STAGE_INDEX = {
  uploading: 0,
  queued: 0.5,
  security_scan: 1,
  inspecting: 2,
  extracting_text: 3,
  ocr_processing: 4,
  generating_schema: 5,
  validating: 6,
  ready: 7
}
const errorCopy = {
  INVALID_DOCUMENT: 'Choose a readable PDF, JPG, JPEG, or PNG document.',
  INVALID_FILE_TYPE: 'Only PDF, JPG, JPEG, and PNG documents are supported.',
  FILE_TYPE_MISMATCH: 'The file extension or type does not match its content.',
  IMAGE_DIMENSIONS_EXCEEDED: 'Image dimensions must not exceed 40 megapixels.',
  PDF_ENCRYPTED: 'Password-protected PDFs are not supported.',
  PAGE_LIMIT_EXCEEDED: 'The PDF has more than 25 pages.',
  MALWARE_DETECTED: 'The document did not pass the security scan.',
  MALWARE_SCAN_UNAVAILABLE: 'The security scanner is temporarily unavailable.',
  OCR_UNAVAILABLE: 'Scanned pages cannot be read right now.',
  OCR_FAILED: 'Scanned-page reading failed.',
  LLM_UNAVAILABLE: 'Form generation is temporarily unavailable.',
  LLM_RATE_LIMITED: 'The AI provider rate limit was reached. Please retry in about a minute.',
  LLM_QUOTA_EXHAUSTED: 'The Gemini project has exhausted its daily API quota. Wait for the quota reset or configure a project with available quota.',
  LLM_AUTHENTICATION_FAILED: 'The configured AI API key was rejected. Ask an administrator to update it.',
  LLM_MODEL_UNAVAILABLE: 'The configured AI model is unavailable. Ask an administrator to check it.',
  LLM_TIMEOUT: 'The AI provider took too long to respond. Please retry.',
  LLM_OUTPUT_TRUNCATED: 'The AI response was too large to complete safely. Try a smaller document or ask an administrator to raise the document output limit.',
  SCHEMA_INVALID: 'The generated field structure was invalid.',
  DOCUMENT_INPUT_TOO_LARGE: 'A document region is too large to process safely. Try a smaller document.',
  NO_FIELDS_DETECTED: 'No source-grounded form fields were detected.',
  PROCESSING_FAILED: 'The document could not be processed.'
}

const includedFieldError = (candidate) => {
  const field = candidate?.field || {}
  const label = String(field.label || '').trim()
  if (!label) return 'Every included field needs a label.'
  if (['dropdown', 'radio'].includes(field.type)) {
    const options = [...new Set(
      (Array.isArray(field.options) ? field.options : [])
        .map((value) => String(value || '').trim())
        .filter(Boolean)
    )]
    if (options.length < 2) return 'Add at least two distinct options to "' + label + '".'
  }
  if (field.type === 'grid') {
    const columns = (Array.isArray(field.columns) ? field.columns : [])
      .filter((column) => String(column?.label || '').trim())
    if (!columns.length) return 'Add at least one named table column to "' + label + '".'
  }
  return ''
}

function ProcessingStageTimeline({ currentStageIndex, pageMetricsKnown, ocrWasUsed }) {
  return (
    <section className="border-b border-line bg-surface-2/45 p-5 lg:border-b-0 lg:border-r" aria-label="Processing stages">
      <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-fg-subtle">Processing stages</p>
      <ol className="mt-4">
        {PROCESSING_STAGES.map((stage, index) => {
          const passed = currentStageIndex > index
          const ocrNotUsed = stage.key === 'ocr_processing' && passed && pageMetricsKnown && !ocrWasUsed
          const complete = passed && !ocrNotUsed
          const current = currentStageIndex === index
          const stateLabel = ocrNotUsed ? 'Skipped' : complete ? 'Completed' : current ? 'In progress' : 'Waiting'
          return (
            <li key={stage.key} className="relative flex gap-3 pb-4 last:pb-0" aria-current={current ? 'step' : undefined}>
              {index < PROCESSING_STAGES.length - 1 && (
                <span
                  className={'absolute bottom-0 left-[11px] top-6 w-px ' + (passed ? 'bg-indigo-300 dark:bg-indigo-500/50' : 'bg-line')}
                  aria-hidden="true"
                />
              )}
              <span
                className={'relative z-10 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 ' + (
                  ocrNotUsed
                    ? 'border-red-500 bg-red-50 text-red-600 dark:bg-red-500/15 dark:text-red-300'
                    : complete
                      ? 'border-indigo-600 bg-indigo-600 text-white'
                      : current
                        ? 'border-indigo-600 bg-surface text-indigo-700 shadow-[0_0_0_3px_rgba(99,102,241,0.14)] dark:text-indigo-200'
                        : 'border-line bg-surface text-fg-subtle'
                )}
                aria-label={stage.label + ', ' + stateLabel.toLowerCase()}
              >
                {ocrNotUsed
                  ? <X className="h-3 w-3" strokeWidth={3} />
                  : complete
                    ? <Check className="h-3 w-3" strokeWidth={3} />
                    : current
                      ? <span className="h-2 w-2 animate-pulse rounded-full bg-indigo-600" />
                      : <span className="h-1.5 w-1.5 rounded-full bg-line" />}
              </span>
              <div className="min-w-0 pt-0.5">
                <p className={'text-xs font-semibold ' + (ocrNotUsed ? 'text-red-600 dark:text-red-300' : current ? 'text-indigo-700 dark:text-indigo-200' : complete ? 'text-fg' : 'text-fg-muted')}>
                  {stage.label}
                </p>
                <p className={'mt-0.5 text-[11px] ' + (ocrNotUsed ? 'font-medium text-red-600 dark:text-red-300' : current ? 'font-medium text-indigo-600 dark:text-indigo-300' : 'text-fg-subtle')}>
                  {stateLabel}
                </p>
              </div>
            </li>
          )
        })}
      </ol>
    </section>
  )
}

function ProcessingDashboard({
  currentStageIndex,
  pageMetricsKnown,
  ocrWasUsed,
  pageCount,
  digitalPageCount,
  ocrPageCount,
  currentEngine,
  stage,
  progress
}) {
  const metrics = [
    ['Pages detected', pageCount > 0 ? String(pageCount) : '—'],
    ['Direct PDF text', pageMetricsKnown ? digitalPageCount + (digitalPageCount === 1 ? ' page' : ' pages') : '—'],
    ['OCR pages', pageMetricsKnown ? ocrPageCount + (ocrPageCount === 1 ? ' page' : ' pages') : '—'],
    ['Current engine', currentEngine]
  ]

  return (
    <div className="grid border-t border-line lg:grid-cols-[18rem_minmax(0,1fr)]">
      <ProcessingStageTimeline
        currentStageIndex={currentStageIndex}
        pageMetricsKnown={pageMetricsKnown}
        ocrWasUsed={ocrWasUsed}
      />

      <section className="p-5" aria-label="Processing details">
        {pageMetricsKnown && <p className="mb-3 text-xs text-fg-muted"><span className="font-medium text-fg">Processing pipeline:</span> {ocrWasUsed ? 'MuPDF → OCR → LLM' : 'MuPDF → LLM'}</p>}
        <div className="grid gap-2 sm:grid-cols-2">
          {metrics.map(([label, value]) => (
            <div key={label} className="rounded-lg border border-line bg-surface-2/45 px-3 py-2.5">
              <p className="text-[11px] font-medium text-fg-muted">{label}</p>
              <p className="mt-1 truncate text-sm font-semibold text-fg" title={value}>{value}</p>
            </div>
          ))}
        </div>

        <div className="mt-4 rounded-lg border border-line bg-surface p-4">
          <div className="flex items-start justify-between gap-3">
            <span className="inline-flex min-w-0 items-center gap-2 text-sm font-semibold text-fg">
              <LoaderCircle className="h-4 w-4 shrink-0 animate-spin text-indigo-600" />
              <span className="truncate">{stage}</span>
            </span>
            <span className="shrink-0 text-sm font-semibold tabular-nums text-fg">{Math.round(progress)}%</span>
          </div>
          <div
            className="mt-3 h-2 overflow-hidden rounded-full bg-surface-3"
            role="progressbar"
            aria-label="Document form generation progress"
            aria-valuemin="0"
            aria-valuemax="100"
            aria-valuenow={Math.round(progress)}
          >
            <div className="h-full rounded-full bg-indigo-600 transition-all duration-500" style={{ width: progress + '%' }} />
          </div>
          <p className="mt-3 text-xs text-fg-muted">This may take a few moments.</p>
        </div>
      </section>
    </div>
  )
}

export default function DocumentFormGenerator({ onCancel, onComplete }) {
  const inputRef = useRef(null)
  const pollRef = useRef(null)
  const jobRef = useRef(null)
  const completedRef = useRef(false)
  const hydratedJobRef = useRef(null)
  const uploadAbortRef = useRef(null)
  const mountedRef = useRef(true)
  const [file, setFile] = useState(null)
  const [uploadProgress, setUploadProgress] = useState(null)
  const [job, setJob] = useState(null)
  const [error, setError] = useState('')
  const [dragging, setDragging] = useState(false)
  const [candidates, setCandidates] = useState([])
  const [activeCandidate, setActiveCandidate] = useState(null)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [mobilePanel, setMobilePanel] = useState('fields')
  const [finishing, setFinishing] = useState(false)

  const stopPolling = () => {
    if (pollRef.current) clearTimeout(pollRef.current)
    pollRef.current = null
  }

  useEffect(() => {
    jobRef.current = job
  }, [job])

  useEffect(() => {
    // React Strict Mode runs an extra setup/cleanup cycle in development.
    // Reset the flag in setup so that cycle cannot permanently disable uploads.
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      uploadAbortRef.current?.abort()
      stopPolling()
      const current = jobRef.current
      if (current?.jobId && !completedRef.current) {
        api.delete(BASE + '/' + encodeURIComponent(current.jobId)).catch(() => {})
      }
    }
  }, [])

  useEffect(() => {
    if (job?.status !== 'ready' || hydratedJobRef.current === job.jobId) return
    hydratedJobRef.current = job.jobId
    const incoming = (job.candidates || []).map((candidate) => ({
      ...candidate,
      included: candidate.includedByDefault === true,
      field: { ...(candidate.field || {}) }
    }))
    setCandidates(incoming)
    setTitle(job.title || '')
    setDescription(job.description || '')
    setActiveCandidate(incoming.find((candidate) => candidate.sourceRegions?.length) || incoming[0] || null)
  }, [job])

  const poll = async (jobId) => {
    if (!mountedRef.current || completedRef.current) return
    try {
      const response = await api.get(BASE + '/' + encodeURIComponent(jobId))
      if (!mountedRef.current || completedRef.current) return
      setJob(response.job)
      if (!TERMINAL.has(response.job.status)) {
        pollRef.current = setTimeout(() => poll(jobId), 1100)
      }
    } catch (cause) {
      if (!mountedRef.current || completedRef.current) return
      setError(cause.message || 'Could not read generation status.')
    }
  }

  const chooseFile = async (chosen) => {
    if (!chosen) return
    const filename = chosen.name.toLowerCase()
    const allowedMime = new Set(['application/pdf', 'image/jpeg', 'image/jpg', 'image/png'])
    if (!allowedMime.has(chosen.type) && !/\.(pdf|jpe?g|png)$/.test(filename)) {
      setError('Choose a PDF, JPG, JPEG, or PNG document.')
      return
    }
    if (chosen.size > 25 * 1024 * 1024) {
      setError('Document must be 25 MB or smaller.')
      return
    }

    if (jobRef.current?.jobId) {
      await api.delete(BASE + '/' + encodeURIComponent(jobRef.current.jobId)).catch(() => {})
    }
    stopPolling()
    uploadAbortRef.current?.abort()
    completedRef.current = false
    hydratedJobRef.current = null
    setFile(chosen)
    setJob(null)
    setCandidates([])
    setActiveCandidate(null)
    setUploadProgress(0)
    setError('')
    const form = new FormData()
    form.append('file', chosen)
    const uploadController = new AbortController()
    uploadAbortRef.current = uploadController
    try {
      const response = await uploadWithProgress(BASE, form, {
        onProgress: setUploadProgress,
        signal: uploadController.signal
      })
      if (!mountedRef.current || completedRef.current || uploadController.signal.aborted) {
        if (response.job?.jobId) {
          api.delete(BASE + '/' + encodeURIComponent(response.job.jobId)).catch(() => {})
        }
        return
      }
      setJob(response.job)
      setUploadProgress(100)
      poll(response.job.jobId)
    } catch (cause) {
      if (cause?.code === 'ABORTED' || completedRef.current || !mountedRef.current) return
      setError(cause.message || 'Document upload failed.')
      setUploadProgress(null)
    } finally {
      if (uploadAbortRef.current === uploadController) uploadAbortRef.current = null
    }
  }

  const retry = async () => {
    if (!job?.jobId) return
    setError('')
    try {
      const response = await api.post(BASE + '/' + encodeURIComponent(job.jobId) + '/retry')
      setJob(response.job)
      poll(job.jobId)
    } catch (cause) {
      setError(cause.message || 'Retry failed.')
    }
  }

  const cancel = async () => {
    completedRef.current = true
    uploadAbortRef.current?.abort()
    stopPolling()
    const current = jobRef.current
    if (current?.jobId) {
      await api.delete(BASE + '/' + encodeURIComponent(current.jobId)).catch(() => {})
    }
    onCancel?.()
  }

  const changeCandidate = (candidateId, changes) => {
    setCandidates((current) => current.map((candidate) =>
      candidate.candidateId === candidateId
        ? { ...candidate, ...changes }
        : candidate
    ))
    setActiveCandidate((current) =>
      current?.candidateId === candidateId ? { ...current, ...changes } : current
    )
  }

  const moveCandidate = (candidateId, direction, included) => {
    setCandidates((current) => {
      const groupIndexes = current
        .map((candidate, index) => ({ candidate, index }))
        .filter(({ candidate }) => candidate.included === included)
        .map(({ index }) => index)
      const groupPosition = groupIndexes.findIndex((index) => current[index].candidateId === candidateId)
      const targetPosition = groupPosition + direction
      if (groupPosition < 0 || targetPosition < 0 || targetPosition >= groupIndexes.length) return current
      const index = groupIndexes[groupPosition]
      const target = groupIndexes[targetPosition]
      const next = [...current]
      const item = next[index]
      next[index] = next[target]
      next[target] = item
      return next
    })
  }

  const toggleCandidate = (candidateId) => {
    setCandidates((current) => current.map((candidate) =>
      candidate.candidateId === candidateId
        ? { ...candidate, included: !candidate.included }
        : candidate
    ))
  }

  const finish = async () => {
    if (!job?.jobId || finishing) return
    setError('')
    if (candidates.filter((candidate) => candidate.included).length > (job.maxFields || 25)) {
      setError('Include at most ' + (job.maxFields || 25) + ' fields per form.')
      return
    }
    const invalid = candidates
      .filter((candidate) => candidate.included)
      .map(includedFieldError)
      .find(Boolean)
    if (invalid) {
      setError(invalid)
      return
    }
    setFinishing(true)
    try {
      const response = await api.post(
        BASE + '/' + encodeURIComponent(job.jobId) + '/complete',
        {
          title: title.trim(),
          description: description.trim(),
          candidates: candidates.map((candidate) => ({
            candidateId: candidate.candidateId,
            included: candidate.included === true,
            field: candidate.field
          }))
        }
      )
      completedRef.current = true
      stopPolling()
      onComplete?.(response.draft)
    } catch (cause) {
      setError(cause.message || 'Could not open the generated form.')
    } finally {
      setFinishing(false)
    }
  }

  if (!file) {
    return (
      <div className="p-6">
        <input
          ref={inputRef}
          type="file"
          accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
          className="sr-only"
          onChange={(event) => chooseFile(event.target.files?.[0])}
        />
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          onDragEnter={(event) => { event.preventDefault(); setDragging(true) }}
          onDragOver={(event) => event.preventDefault()}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault()
            setDragging(false)
            chooseFile(event.dataTransfer.files?.[0])
          }}
          className={
            'flex min-h-72 w-full flex-col items-center justify-center rounded-2xl border-2 border-dashed px-6 text-center transition ' +
            (dragging ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-500/10' : 'border-line bg-surface-2 hover:border-indigo-400 hover:bg-indigo-50/40')
          }
        >
          <span className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-indigo-100 text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-300">
            <Upload className="h-7 w-7" />
          </span>
          <span className="text-base font-semibold text-fg">Upload a reference document</span>
          <span className="mt-1 text-sm text-fg-muted">PDF, JPG, JPEG, or PNG up to 25 MB</span>
          <span className="mt-4 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white">Choose document</span>
        </button>
        {error && <p className="mt-3 text-sm text-danger-fg">{error}</p>}
        <div className="mt-4 flex justify-end">
          <button type="button" onClick={cancel} className="rounded-lg border border-line px-4 py-2 text-sm font-semibold text-fg hover:bg-surface-2">Cancel</button>
        </div>
      </div>
    )
  }

  if (job?.status !== 'ready') {
    const failed = job?.status === 'failed'
    const visibleError = error || (failed ? (errorCopy[job.errorCode] || 'Document processing failed.') : '')
    const processingStatus = job?.status || 'uploading'
    const currentStageIndex = PROCESSING_STAGE_INDEX[processingStatus] ?? 0
    const pageMeta = Array.isArray(job?.pageMeta) ? job.pageMeta : []
    const pageMetricsKnown = pageMeta.length > 0
    const ocrPageCount = pageMeta.filter((page) => page?.usedOcr === true).length
    const digitalPageCount = pageMeta.filter((page) => page?.usedOcr !== true).length
    const ocrWasUsed = ocrPageCount > 0
    const progressValue = Math.max(0, Math.min(100, Number(job?.progress ?? uploadProgress) || 0))
    const currentEngine = processingStatus === 'uploading'
      ? 'Upload service'
      : processingStatus === 'queued'
        ? 'Processing queue'
        : processingStatus === 'security_scan'
        ? 'Security scanner'
        : ['inspecting', 'extracting_text'].includes(processingStatus)
          ? 'MuPDF'
          : processingStatus === 'ocr_processing'
            ? 'PaddleOCR'
            : processingStatus === 'generating_schema'
              ? 'LLM'
              : processingStatus === 'validating'
                ? 'Schema validator'
                : 'Processing service'
    return (
      <div className="p-6">
        <div className="overflow-hidden rounded-xl border border-line bg-surface shadow-sm">
          <div className="flex items-center gap-3 p-4">
            <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-indigo-100 text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-300">
              <FileText className="h-5 w-5" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-fg">{file.name}</p>
              <p className="text-xs text-fg-muted">{(file.size / 1024 / 1024).toFixed(2)} MB</p>
            </div>
          </div>

          {visibleError ? (
            <div className="m-4 mt-0 rounded-lg border border-danger-line bg-danger-subtle p-4 text-danger-fg">
              <p className="flex items-start gap-2 text-sm font-medium"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /> {visibleError}</p>
              {job?.canRetry && (
                <button type="button" onClick={retry} className="mt-3 inline-flex items-center gap-1.5 text-sm font-semibold underline">
                  <RefreshCw className="h-4 w-4" /> Retry
                </button>
              )}
            </div>
          ) : (
            <ProcessingDashboard
              currentStageIndex={currentStageIndex}
              pageMetricsKnown={pageMetricsKnown}
              ocrWasUsed={ocrWasUsed}
              pageCount={job?.pageCount || 0}
              digitalPageCount={digitalPageCount}
              ocrPageCount={ocrPageCount}
              currentEngine={currentEngine}
              stage={job?.stage || (uploadProgress < 100 ? 'Uploading document' : 'Starting processing')}
              progress={progressValue}
            />
          )}
        </div>
      </div>
    )
  }

  const includedCount = candidates.filter((candidate) => candidate.included).length
  return (
    <div className="flex min-h-0 flex-col p-4 sm:p-5">
      <div className="mb-4 grid gap-3 sm:grid-cols-2">
        <label className="text-xs font-medium text-fg-muted">
          Form title
          <input value={title} onChange={(event) => setTitle(event.target.value)} className="mt-1 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-fg focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-200" />
        </label>
        <label className="text-xs font-medium text-fg-muted">
          Description
          <input value={description} onChange={(event) => setDescription(event.target.value)} className="mt-1 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-fg focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-200" />
        </label>
      </div>

      <DocumentQualitySummary job={job} />

      {(job.limitReached || job.truncated) && (
        <div className="mb-4 rounded-lg border border-warning-line bg-warning-subtle px-3 py-2 text-xs text-warning-fg">
          Partial result: the {job.maxFields || 25}-field limit was reached. Split the document into smaller sections to review remaining fields.
        </div>
      )}
      {job.coverage?.status === 'partial' && !(job.limitReached || job.truncated) && (
        <p role="status" className="mb-3 text-xs text-warning-fg">{job.coverage.unreadablePageCount || job.coverage.lowConfidenceOcrPageCount
          ? 'Some pages had no readable text or low OCR quality. Compare the original document and upload a clearer copy if content is missing.'
          : 'Field checking is incomplete. Review Suggestions and compare the document for missing fields' + (job.coverage.unresolvedCount > 0 ? ' (' + job.coverage.unresolvedCount + ' text regions unresolved)' : '') + '.'}</p>
      )}
      {job.criticStatus === 'unavailable' && (
        <div role="status" className="mb-4 flex items-start gap-2 rounded-lg border border-warning-line bg-warning-subtle px-3 py-2 text-xs text-warning-fg">
          <AlertCircle aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
          <span>Some fields need human review. “Not validated” means the independent check is incomplete, not a low confidence score. See confidence details before including them.{job.coverage?.validationFailures > 0 ? ' Validation requests failed: ' + job.coverage.validationFailures + '.' : ''}{job.coverage?.validationSkipped > 0 ? ' Fields exceeding the request limit: ' + job.coverage.validationSkipped + '.' : ''}</span>
        </div>
      )}
      {error && <div className="mb-4 rounded-lg border border-danger-line bg-danger-subtle px-3 py-2 text-sm text-danger-fg">{error}</div>}

      <div className="mb-3 grid grid-cols-3 gap-2 lg:hidden" role="tablist" aria-label="Review panels">
        {[
          ['document', 'Document'],
          ['fields', 'Fields'],
          ['suggestions', 'Suggestions']
        ].map(([value, label]) => (
          <button
            key={value}
            id={'document-review-tab-' + value}
            type="button"
            role="tab"
            aria-selected={mobilePanel === value}
            aria-controls={value === 'document' ? 'document-review-panel-document' : 'document-review-panel-generated'}
            tabIndex={mobilePanel === value ? 0 : -1}
            onClick={() => setMobilePanel(value)}
            onKeyDown={(event) => {
              if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return
              event.preventDefault()
              const values = ['document', 'fields', 'suggestions']
              const offset = event.key === 'ArrowRight' ? 1 : -1
              const next = values[(values.indexOf(value) + offset + values.length) % values.length]
              setMobilePanel(next)
              requestAnimationFrame(() => document.getElementById('document-review-tab-' + next)?.focus())
            }}
            className={'rounded-lg px-2 py-2 text-xs font-semibold ' + (mobilePanel === value ? 'bg-indigo-600 text-white' : 'border border-line bg-surface text-fg')}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[minmax(0,1.08fr)_minmax(24rem,0.92fr)]">
        <div
          id="document-review-panel-document"
          role="tabpanel"
          aria-labelledby="document-review-tab-document"
          className={mobilePanel === 'document' ? 'block min-w-0' : 'hidden min-w-0 lg:block'}
        >
          <DocumentSourcePreview
            job={job}
            candidates={candidates}
            activeCandidate={activeCandidate}
          />
        </div>
        <div
          id="document-review-panel-generated"
          role="tabpanel"
          aria-labelledby={'document-review-tab-' + (mobilePanel === 'suggestions' ? 'suggestions' : 'fields')}
          className={mobilePanel === 'document' ? 'hidden lg:block' : 'block min-h-0'}
        >
          <DocumentFormReview
            candidates={candidates}
            activeCandidate={activeCandidate}
            filterMode={mobilePanel}
            onSelect={setActiveCandidate}
            onChange={changeCandidate}
            onMove={moveCandidate}
            onToggle={toggleCandidate}
          />
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
        <p className="text-xs text-fg-muted">{includedCount} field{includedCount === 1 ? '' : 's'} will open in the form builder.</p>
        <div className="flex items-center gap-2">
          <button type="button" onClick={cancel} disabled={finishing} className="rounded-lg border border-line px-4 py-2 text-sm font-semibold text-fg hover:bg-surface-2 disabled:opacity-50">Cancel</button>
          <button type="button" onClick={finish} disabled={finishing || !title.trim() || includedCount === 0} className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50">
            {finishing ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            Use in Form Builder
          </button>
        </div>
      </div>
    </div>
  )
}
