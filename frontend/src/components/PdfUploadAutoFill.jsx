import { useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertCircle, Camera, Check, CheckCircle2, ChevronLeft, ChevronRight, FileText,
  Expand, LoaderCircle, Maximize2, Minus, Plus, RefreshCw, ShieldCheck, Sparkles, Upload, X
} from 'lucide-react'
import { API_BASE, api, getToken, uploadWithProgress } from '../utils/api'
import { CameraCapture } from './FormFields'
import { isFieldVisible } from './formFieldHelpers'

const TERMINAL = new Set(['ready', 'failed', 'cancelled'])
const STAGE_META = [
  { key: 'queued', label: 'Queued' },
  { key: 'security_scan', label: 'Security' },
  { key: 'inspecting', label: 'Inspect' },
  { key: 'extracting_text', label: 'Extract' },
  { key: 'ocr_processing', label: 'OCR' },
  { key: 'mapping_fields', label: 'Match' },
  { key: 'validating', label: 'Validate' },
  { key: 'ready', label: 'Ready' }
]
const STAGES = STAGE_META.map((stage) => stage.key)
const REVIEW_GROUP_LABELS = {
  pending: 'Needs review',
  applied: 'Applied',
  protected: 'Existing answers kept',
  deferred: 'Manual attention'
}

const empty = (value) =>
  value === undefined || value === null || value === '' ||
  (Array.isArray(value) && value.length === 0)

const suggestionValueSummary = (suggestion, field) => {
  if (field?.type === 'grid' && Array.isArray(suggestion?.value)) {
    const rows = suggestion.value.length
    const columns = Array.isArray(field.columns) ? field.columns.length : 0
    return rows + ' ' + (rows === 1 ? 'row' : 'rows') + ' detected · ' + columns + ' ' + (columns === 1 ? 'column' : 'columns')
  }
  return String(suggestion?.value ?? '')
}

const errorCopy = {
  INVALID_PDF: 'This file is not a readable PDF.',
  INVALID_IMAGE: 'This file is not a readable JPG, JPEG, or PNG image.',
  INVALID_DOCUMENT: 'Choose a readable PDF, JPG, JPEG, or PNG document.',
  INVALID_FILE_TYPE: 'Only PDF, JPG, JPEG, and PNG documents are supported.',
  FILE_TYPE_MISMATCH: 'The file extension or type does not match its content.',
  IMAGE_DIMENSIONS_EXCEEDED: 'Image dimensions must not exceed 40 megapixels.',
  PDF_ENCRYPTED: 'Password-protected PDFs are not supported.',
  PAGE_LIMIT_EXCEEDED: 'The PDF has more than 25 pages.',
  MALWARE_DETECTED: 'The document did not pass the security scan.',
  MALWARE_SCAN_UNAVAILABLE: 'The security scanner is temporarily unavailable.',
  OCR_UNAVAILABLE: 'Scanned pages cannot be read right now. You can still fill the form manually.',
  OCR_FAILED: 'Scanned-page reading failed. You can retry or continue manually.',
  LLM_UNAVAILABLE: 'Field matching is temporarily unavailable. You can still fill the form manually.',
  PROCESSING_FAILED: 'We could not process this document. You can retry or continue manually.'
}

function ConfidenceBadge({ tier, confidence }) {
  const classes = tier === 'high'
    ? 'bg-success-subtle text-success-fg border-success-line'
    : tier === 'medium'
      ? 'bg-warning-subtle text-warning-fg border-warning-line'
      : 'bg-surface-2 text-fg-muted border-line'
  return (
    <span className={'inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold ' + classes}>
      {Math.round(confidence)}% {tier}
    </span>
  )
}

function SourcePreview({ job, accessToken, publicToken, activeSuggestion, suggestions = [] }) {
  const sourceName = job?.sourceType === 'image' ? 'image' : 'document'
  const activeSuggestionId = activeSuggestion?.fieldId || ''
  const suggestedPage = activeSuggestion?.sourceRegions?.[0]?.page || 1
  const [pageOverride, setPageOverride] = useState({ suggestionId: '', page: null })
  const page = pageOverride.suggestionId === activeSuggestionId && pageOverride.page
    ? pageOverride.page
    : suggestedPage
  const [imageUrl, setImageUrl] = useState('')
  const [loadedPage, setLoadedPage] = useState(null)
  const [error, setError] = useState('')
  const [zoom, setZoom] = useState(100)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const viewerRef = useRef(null)
  const fullscreenButtonRef = useRef(null)
  const regions = useMemo(() => {
    const uniqueRegions = new Map()
    const activeRegionKeys = new Set((activeSuggestion?.sourceRegions || []).map((region) => [
      region.page, region.lineId, region.x, region.y, region.width, region.height
    ].join(':')))
    for (const suggestion of suggestions) {
      if (suggestion.valid === false) continue
      for (const region of suggestion.sourceRegions || []) {
        if (region.page !== page) continue
        const key = [
          region.page, region.lineId, region.x, region.y, region.width, region.height
        ].join(':')
        if (!uniqueRegions.has(key) || activeRegionKeys.has(key)) {
          uniqueRegions.set(key, { ...region, active: activeRegionKeys.has(key) })
        }
      }
    }
    return Array.from(uniqueRegions.values())
  }, [suggestions, activeSuggestion, page])

  useEffect(() => {
    if (!job?.jobId || !job.pageCount) return undefined
    let cancelled = false
    let objectUrl = ''
    const base = publicToken
      ? '/api/public/forms/' + encodeURIComponent(publicToken) + '/extractions/'
      : '/api/forms/' + encodeURIComponent(job.formId) + '/extractions/'
    const endpoint = base + encodeURIComponent(job.jobId) + '/pages/' + page
    const headers = {}
    const token = getToken()
    if (!publicToken && token) headers.Authorization = 'Bearer ' + token
    if (publicToken && accessToken) headers['x-extraction-token'] = accessToken

    fetch(API_BASE + endpoint, { headers })
      .then(async (response) => {
        if (!response.ok) throw new Error('Page preview unavailable')
        return response.blob()
      })
      .then((blob) => {
        if (cancelled) return
        objectUrl = URL.createObjectURL(blob)
        setImageUrl(objectUrl)
        setLoadedPage(page)
        setError('')
      })
      .catch((cause) => { if (!cancelled) setError(cause.message) })

    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [job?.jobId, job?.pageCount, job?.formId, page, accessToken, publicToken])

  const changePage = (nextPage) => {
    setError('')
    setImageUrl('')
    setPageOverride({ suggestionId: activeSuggestionId, page: nextPage })
  }

  const changeZoom = (nextZoom) => setZoom(Math.max(75, Math.min(200, nextZoom)))

  useEffect(() => {
    if (!isFullscreen) return undefined
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    fullscreenButtonRef.current?.focus()

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        setIsFullscreen(false)
        return
      }
      if (event.key !== 'Tab' || !viewerRef.current) return
      const focusable = Array.from(viewerRef.current.querySelectorAll(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      ))
      if (!focusable.length) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.body.style.overflow = previousOverflow
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [isFullscreen])

  if (!job?.pageCount) return null
  return (
    <section
      ref={viewerRef}
      role={isFullscreen ? 'dialog' : 'region'}
      aria-modal={isFullscreen || undefined}
      aria-label={isFullscreen ? 'Fullscreen source document preview' : 'Source document preview'}
      className={isFullscreen
        ? 'fixed inset-0 z-[100] flex h-[100dvh] w-screen min-h-0 flex-col overflow-hidden bg-surface shadow-2xl'
        : 'flex h-full min-h-0 flex-col overflow-hidden bg-surface'}
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-surface px-3 py-2.5">
        <div className="min-w-0">
          <p className="truncate text-xs font-semibold text-fg">{job.filename || 'Source document'}</p>
          <p className="text-[11px] text-fg-muted">Page {page} of {job.pageCount}</p>
        </div>
        <div className="flex items-center gap-1" aria-label="Source preview controls">
          <button type="button" aria-label="Previous source page" disabled={page <= 1} onClick={() => changePage(Math.max(1, page - 1))} className="rounded-md border border-line bg-surface p-1.5 text-fg transition hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-40"><ChevronLeft className="h-3.5 w-3.5" /></button>
          <span className="min-w-12 text-center text-xs font-medium text-fg">{page} / {job.pageCount}</span>
          <button type="button" aria-label="Next source page" disabled={page >= job.pageCount} onClick={() => changePage(Math.min(job.pageCount, page + 1))} className="rounded-md border border-line bg-surface p-1.5 text-fg transition hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-40"><ChevronRight className="h-3.5 w-3.5" /></button>
          <span className="mx-1 h-5 w-px bg-line" aria-hidden="true" />
          <button type="button" aria-label="Zoom out" disabled={zoom <= 75} onClick={() => changeZoom(zoom - 25)} className="rounded-md border border-line bg-surface p-1.5 text-fg transition hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-40"><Minus className="h-3.5 w-3.5" /></button>
          <span className="min-w-10 text-center text-xs font-medium text-fg">{zoom}%</span>
          <button type="button" aria-label="Zoom in" disabled={zoom >= 200} onClick={() => changeZoom(zoom + 25)} className="rounded-md border border-line bg-surface p-1.5 text-fg transition hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-40"><Plus className="h-3.5 w-3.5" /></button>
          <button type="button" aria-label="Fit source to width" onClick={() => setZoom(100)} className="ml-1 inline-flex items-center gap-1 rounded-md border border-line bg-surface px-2 py-1.5 text-xs font-medium text-fg transition hover:bg-surface-2"><Maximize2 className="h-3.5 w-3.5" /> Fit</button>
          <button
            ref={fullscreenButtonRef}
            type="button"
            aria-label={isFullscreen ? 'Close fullscreen source preview' : 'Open fullscreen source preview'}
            title={isFullscreen ? 'Close fullscreen' : 'Fullscreen'}
            onClick={() => setIsFullscreen((current) => !current)}
            className="ml-1 rounded-md border border-line bg-surface p-1.5 text-fg transition hover:bg-surface-2 focus:outline-none focus:ring-2 focus:ring-indigo-300"
          >
            {isFullscreen ? <X className="h-3.5 w-3.5" /> : <Expand className="h-3.5 w-3.5" />}
          </button>
        </div>
      </div>
      <div className={(isFullscreen ? 'min-h-0' : 'min-h-[28rem] lg:min-h-0') + ' flex-1 overflow-auto bg-surface-2 p-3 sm:p-4'}>
        {error ? (
          <p className="p-6 text-sm text-danger-fg">{error}</p>
        ) : imageUrl && loadedPage === page ? (
          <div className="relative mx-auto overflow-hidden rounded-md border border-line bg-white shadow-sm transition-[width]" style={{ width: zoom + '%' }}>
            <img src={imageUrl} alt={sourceName + ' page ' + page} className="block w-full h-auto" />
            {regions.map((region) => (
              <span
                key={region.lineId}
                className={region.active ? 'absolute z-10 rounded-sm border-2 border-fuchsia-600 bg-fuchsia-400/30 ring-2 ring-fuchsia-300/30 pointer-events-none' : 'absolute rounded-sm border-2 border-indigo-500 bg-indigo-400/20 pointer-events-none'}
                style={{
                  left: (region.x * 100) + '%',
                  top: (region.y * 100) + '%',
                  width: (region.width * 100) + '%',
                  height: (region.height * 100) + '%'
                }}
                aria-hidden="true"
              />
            ))}
          </div>
        ) : (
          <div className="flex min-h-64 items-center justify-center text-sm text-fg-muted">
            <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> Loading page...
          </div>
        )}
      </div>
    </section>
  )
}

export default function PdfUploadAutoFill({
  formId,
  publicToken,
  fields,
  values,
  onApply,
  onExtractionChange
}) {
  const inputRef = useRef(null)
  const pollRef = useRef(null)
  const appliedJobRef = useRef(null)
  const extractionChangeRef = useRef(onExtractionChange)
  const [mode, setMode] = useState('choice')
  const [file, setFile] = useState(null)
  const [uploadProgress, setUploadProgress] = useState(null)
  const [job, setJob] = useState(null)
  const [accessToken, setAccessToken] = useState('')
  const [error, setError] = useState('')
  const [reviewConfirmed, setReviewConfirmed] = useState(false)
  const [activeSuggestion, setActiveSuggestion] = useState(null)
  const [dismissed, setDismissed] = useState(() => new Set())
  const [applied, setApplied] = useState(() => new Set())
  const [protectedFields, setProtectedFields] = useState(() => new Set())
  const [reviewFilter, setReviewFilter] = useState('all')
  const [mobilePanel, setMobilePanel] = useState('suggestions')

  const base = publicToken
    ? '/api/public/forms/' + encodeURIComponent(publicToken) + '/extractions'
    : '/api/forms/' + encodeURIComponent(formId) + '/extractions'
  const headers = publicToken && accessToken ? { 'x-extraction-token': accessToken } : {}

  const stopPolling = () => {
    if (pollRef.current) clearTimeout(pollRef.current)
    pollRef.current = null
  }

  useEffect(() => {
    extractionChangeRef.current = onExtractionChange
  }, [onExtractionChange])


  useEffect(() => () => stopPolling(), [])

  useEffect(() => {
    extractionChangeRef.current?.(job?.status === 'ready' ? {
      jobId: job.jobId,
      ...(publicToken ? { accessToken } : {}),
      reviewConfirmed,
      feedback: {
        appliedFieldIds: [...applied].sort(),
        dismissedFieldIds: [...dismissed].sort()
      }
    } : null)
  }, [job?.jobId, job?.status, accessToken, reviewConfirmed, publicToken, applied, dismissed])

  useEffect(() => {
    if (job?.status !== 'ready' || appliedJobRef.current === job.jobId) return
    appliedJobRef.current = job.jobId
    const protectedNow = new Set()
    const appliedNow = new Set()
    for (const suggestion of job.suggestions || []) {
      const field = fields.find((candidate) => candidate.id === suggestion.fieldId)
      if (!field) continue
      if (!empty(values?.[suggestion.fieldId])) {
        protectedNow.add(suggestion.fieldId)
      } else if (
        ['high', 'medium'].includes(suggestion.tier) &&
        suggestion.valid &&
        suggestion.criticApproved === true &&
        suggestion.criticStatus === 'validated' &&
        isFieldVisible(field, values || {})
      ) {
        onApply?.(suggestion, { automatic: true })
        appliedNow.add(suggestion.fieldId)
      }
    }
    setProtectedFields(protectedNow)
    setApplied(appliedNow)
    setActiveSuggestion((job.suggestions || []).find((item) => item.sourceRegions?.length) || null)
  }, [job, values, onApply, fields])

  const poll = async (jobId, tokenValue = accessToken) => {
    try {
      const response = await api.get(base + '/' + encodeURIComponent(jobId), {
        headers: publicToken ? { 'x-extraction-token': tokenValue } : {},
        skipAuthRedirect: Boolean(publicToken)
      })
      setJob({ ...response.job, formId })
      if (!TERMINAL.has(response.job.status)) {
        pollRef.current = setTimeout(() => poll(jobId, tokenValue), 1100)
      }
    } catch (cause) {
      setError(cause.message || 'Could not read processing status.')
    }
  }

  const chooseFile = async (chosen) => {
    if (!chosen) return
    const filename = chosen.name.toLowerCase()
    const allowedMime = new Set(['application/pdf', 'image/jpeg', 'image/jpg', 'image/png'])
    const allowedExtension = /\.(pdf|jpe?g|png)$/.test(filename)
    if (!allowedMime.has(chosen.type) && !allowedExtension) {
      setError('Choose a PDF, JPG, JPEG, or PNG document.')
      return
    }
    if (chosen.size > 25 * 1024 * 1024) {
      setError('Document must be 25 MB or smaller.')
      return
    }

    if (job?.jobId && !job.consumed) {
      await api.delete(base + '/' + encodeURIComponent(job.jobId), { headers, skipAuthRedirect: Boolean(publicToken) }).catch(() => {})
    }

    stopPolling()
    setMode('upload')
    setFile(chosen)
    setJob(null)
    setAccessToken('')
    setReviewConfirmed(false)
    setDismissed(new Set())
    setApplied(new Set())
    setProtectedFields(new Set())
    setReviewFilter('all')
    setMobilePanel('suggestions')
    setUploadProgress(0)
    setError('')
    const form = new FormData()
    form.append('file', chosen)
    try {
      const response = await uploadWithProgress(base, form, { onProgress: setUploadProgress })
      const tokenValue = response.accessToken || ''
      setAccessToken(tokenValue)
      setJob({ ...response.job, formId })
      setUploadProgress(100)
      poll(response.job.jobId, tokenValue)
    } catch (cause) {
      setError(cause.message || 'Document upload failed.')
      setUploadProgress(null)
    }
  }

  const retry = async () => {
    if (!job?.jobId) return
    setError('')
    try {
      const response = await api.post(base + '/' + encodeURIComponent(job.jobId) + '/retry', undefined, { headers, skipAuthRedirect: Boolean(publicToken) })
      setJob({ ...response.job, formId })
      poll(job.jobId)
    } catch (cause) {
      setError(cause.message || 'Retry failed.')
    }
  }

  const reset = async ({ cancel = true } = {}) => {
    stopPolling()
    if (cancel && job?.jobId && !job.consumed) {
      await api.delete(base + '/' + encodeURIComponent(job.jobId), { headers, skipAuthRedirect: Boolean(publicToken) }).catch(() => {})
    }
    setMode('choice')
    setFile(null)
    setJob(null)
    setAccessToken('')
    setUploadProgress(null)
    setReviewConfirmed(false)
    setActiveSuggestion(null)
    setDismissed(new Set())
    setApplied(new Set())
    setProtectedFields(new Set())
    setReviewFilter('all')
    setMobilePanel('suggestions')
    setError('')
    onExtractionChange?.(null)
    if (inputRef.current) inputRef.current.value = ''
  }

  const suggestions = job?.suggestions || []
  const reviewItems = suggestions
    .filter((item) => !dismissed.has(item.fieldId))
    .map((item) => {
      const field = fields.find((candidate) => candidate.id === item.fieldId)
      const fieldVisible = field ? isFieldVisible(field, values || {}) : false
      const occupied = !empty(values?.[item.fieldId])
      let status = 'pending'
      if (applied.has(item.fieldId)) status = 'applied'
      else if (protectedFields.has(item.fieldId) || occupied) status = 'protected'
      else if (!field || !fieldVisible) status = 'deferred'
      return { item, field, fieldVisible, status }
    })
  const applicableMedium = reviewItems.filter(({ item, status }) =>
    item.tier === 'medium' && item.valid && item.criticApproved === true && status === 'pending'
  )
  const applySuggestion = (suggestion) => {
    const record = reviewItems.find(({ item }) => item.fieldId === suggestion.fieldId)
    if (!record || record.status !== 'pending') return
    onApply?.(suggestion, { automatic: false })
    setApplied((current) => new Set([...current, suggestion.fieldId]))
  }
  const applyAllMedium = () => {
    for (const { item } of applicableMedium) {
      onApply?.(item, { automatic: false })
    }
    if (applicableMedium.length) {
      setApplied((current) => new Set([...current, ...applicableMedium.map(({ item }) => item.fieldId)]))
    }
  }
  const dismissSuggestion = (fieldId) => {
    setDismissed((current) => new Set([...current, fieldId]))
    if (activeSuggestion?.fieldId === fieldId) {
      setActiveSuggestion(reviewItems.find(({ item }) => item.fieldId !== fieldId && item.sourceRegions?.length)?.item || null)
    }
  }
  const statusCounts = reviewItems.reduce((counts, { status }) => {
    counts[status] += 1
    return counts
  }, { pending: 0, applied: 0, protected: 0, deferred: 0 })
  const filteredItems = reviewFilter === 'all'
    ? reviewItems
    : reviewItems.filter(({ status }) => status === reviewFilter)
  const groupedItems = ['pending', 'applied', 'protected', 'deferred']
    .map((status) => ({ status, items: filteredItems.filter((record) => record.status === status) }))
    .filter((group) => group.items.length)
  const progress = job ? job.progress : uploadProgress
  const currentStage = job ? STAGES.indexOf(job.status) : -1
  const progressValue = Math.max(0, Math.min(100, Number(progress) || 0))
  const ocrUsageKnown = Array.isArray(job?.pageMeta) && job.pageMeta.length > 0
  const ocrWasUsed = ocrUsageKnown && job.pageMeta.some((page) => page?.usedOcr === true)

  if (mode === 'manual') {
    return (
      <div className="rounded-lg border border-line bg-surface-2 px-4 py-3 flex items-center justify-between gap-3">
        <p className="text-sm text-fg-muted">Manual entry selected.</p>
        <button type="button" onClick={() => setMode('choice')} className="text-sm font-medium text-indigo-600 hover:text-indigo-700">Use a document instead</button>
      </div>
    )
  }

  if (mode === 'camera') {
    return (
      <section className="overflow-hidden rounded-xl border border-line bg-surface shadow-sm">
        <div className="flex items-center gap-3 border-b border-line px-4 py-3 sm:px-5">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600 ring-1 ring-indigo-100 dark:bg-indigo-500/15 dark:text-indigo-300 dark:ring-indigo-500/20">
            <Camera className="h-5 w-5" />
          </span>
          <div>
            <h2 className="text-sm font-semibold text-fg">Capture a document</h2>
            <p className="mt-0.5 text-xs text-fg-muted">Keep the full page visible and text in focus.</p>
          </div>
        </div>
        <div className="p-4 sm:p-5">
          <CameraCapture
            value={null}
            onChange={(captured) => {
              if (captured?.file) chooseFile(captured.file)
            }}
            autoStart
            inlineMode
            onCancel={() => setMode('choice')}
          />
        </div>
      </section>
    )
  }

  if (mode === 'choice') {
    return (
      <section className="overflow-hidden rounded-xl border border-line bg-surface shadow-sm">
        <div className="flex flex-col gap-4 p-4 sm:px-5">
          <div className="flex min-w-0 items-center gap-3.5">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-indigo-600 text-white shadow-sm shadow-indigo-600/20">
              <Sparkles className="h-[18px] w-[18px]" />
            </span>
            <div className="min-w-0">
              <h2 className="text-sm font-semibold leading-5 text-fg">Fill from a document</h2>
              <p className="mt-0.5 text-xs leading-5 text-fg-muted">Upload PDF, JPG, JPEG or PNG (up to 25 MB)</p>
            </div>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:gap-3">
            <button type="button" onClick={() => inputRef.current?.click()} className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-300 focus:ring-offset-2 sm:w-auto">
              <Upload className="h-4 w-4" /> Upload document
            </button>
            <button type="button" onClick={() => setMode('camera')} className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg border border-indigo-300 bg-surface px-4 py-2.5 text-sm font-semibold text-indigo-600 shadow-sm transition hover:bg-indigo-50 hover:text-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-300 focus:ring-offset-2 dark:border-indigo-500/50 dark:text-indigo-300 dark:hover:bg-indigo-500/10 sm:w-auto">
              <Camera className="h-4 w-4" /> Use camera
            </button>
            <button type="button" onClick={() => setMode('manual')} className="min-h-11 rounded-md px-2 py-2 text-sm font-semibold text-indigo-600 transition hover:bg-indigo-50 hover:text-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-300 dark:text-indigo-300 dark:hover:bg-indigo-500/10 dark:hover:text-indigo-200">Enter manually</button>
          </div>
        </div>
        <input ref={inputRef} type="file" accept="application/pdf,image/jpeg,image/png,.pdf,.jpg,.jpeg,.png" className="sr-only" onChange={(event) => chooseFile(event.target.files?.[0])} />
      </section>
    )
  }

  return (
    <section className="space-y-4" aria-live="polite">
      <div className="overflow-hidden rounded-xl border border-line bg-surface shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3.5 sm:px-5">
          <div className="flex min-w-0 items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600 ring-1 ring-indigo-100 dark:bg-indigo-500/15 dark:text-indigo-300 dark:ring-indigo-500/20">
              <FileText className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold leading-5 text-fg">{file?.name || job?.filename}</p>
              <p className="mt-0.5 text-xs text-fg-muted">{file ? (file.size / 1024 / 1024).toFixed(2) + ' MB' : ''}</p>
            </div>
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={() => inputRef.current?.click()} className="rounded-lg border border-line bg-surface px-3 py-2 text-xs font-semibold text-fg shadow-sm transition hover:bg-surface-2 focus:outline-none focus:ring-2 focus:ring-indigo-300">Replace</button>
            <button type="button" onClick={() => reset()} className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface px-3 py-2 text-xs font-semibold text-fg shadow-sm transition hover:bg-surface-2 focus:outline-none focus:ring-2 focus:ring-indigo-300"><X className="h-3.5 w-3.5" /> Cancel</button>
          </div>
        </div>
        <input ref={inputRef} type="file" accept="application/pdf,image/jpeg,image/png,.pdf,.jpg,.jpeg,.png" className="sr-only" onChange={(event) => chooseFile(event.target.files?.[0])} />

        {job?.status !== 'ready' && job?.status !== 'failed' && (
          <div className="border-t border-line px-4 py-4 sm:px-5 sm:pb-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-2">
                <LoaderCircle className="h-4 w-4 shrink-0 animate-spin text-indigo-600" />
                <p className="truncate text-sm font-medium text-fg">{job?.stage || 'Uploading document'}</p>
              </div>
              <span className="rounded-full bg-indigo-50 px-2.5 py-1 text-xs font-semibold tabular-nums text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-200">
                {progress == null ? 'Working...' : Math.round(progressValue) + '%'}
              </span>
            </div>

            <div
              className="mt-4 overflow-x-auto pb-1"
              role="progressbar"
              aria-label="Document processing progress"
              aria-valuemin="0"
              aria-valuemax="100"
              aria-valuenow={Math.round(progressValue)}
              aria-valuetext={(job?.stage || 'Uploading document') + ', ' + Math.round(progressValue) + '%'}
            >
              <div className="min-w-[42rem] px-1">
                <div className="relative">
                  <div className="absolute left-[6.25%] right-[6.25%] top-4 h-0.5 rounded-full bg-line" aria-hidden="true" />
                  <div
                    className="absolute left-[6.25%] top-4 h-0.5 rounded-full bg-indigo-600 transition-[width] duration-500 ease-out"
                    style={{ width: (progressValue * 0.875) + '%' }}
                    aria-hidden="true"
                  />
                  <ol className="relative grid grid-cols-8">
                    {STAGE_META.map((stage, index) => {
                      const ocrNotUsed = stage.key === 'ocr_processing' && currentStage > index && ocrUsageKnown && !ocrWasUsed
                      const complete = currentStage > index && !ocrNotUsed
                      const current = currentStage === index
                      return (
                        <li key={stage.key} className="flex min-w-0 flex-col items-center text-center" aria-current={current ? 'step' : undefined}>
                          <span
                            className={'relative z-10 flex h-8 w-8 items-center justify-center rounded-full border-2 text-[11px] font-bold tabular-nums transition-colors ' + (
                              ocrNotUsed
                                ? 'border-red-500 bg-red-50 text-red-600 dark:bg-red-500/15 dark:text-red-300'
                                : complete
                                  ? 'border-indigo-600 bg-indigo-600 text-white'
                                  : current
                                    ? 'border-indigo-600 bg-surface text-indigo-700 shadow-[0_0_0_4px_rgba(99,102,241,0.14)] dark:text-indigo-200'
                                    : 'border-line bg-surface text-fg-subtle'
                            )}
                            aria-label={stage.label + (ocrNotUsed ? ', not used' : complete ? ', completed' : current ? ', current step' : ', not started')}
                          >
                            {ocrNotUsed
                              ? <X className="h-3.5 w-3.5" strokeWidth={3} />
                              : complete
                                ? <Check className="h-3.5 w-3.5" strokeWidth={3} />
                                : index + 1}
                            {current && <span className="absolute -inset-1 -z-10 animate-pulse rounded-full bg-indigo-100/70 dark:bg-indigo-500/20" aria-hidden="true" />}
                          </span>
                          <span className={'mt-2 text-[11px] font-medium ' + (ocrNotUsed ? 'text-red-600 dark:text-red-300' : current ? 'text-indigo-700 dark:text-indigo-200' : complete ? 'text-fg' : 'text-fg-subtle')}>
                            {stage.label}
                            {ocrNotUsed && <span className="block text-[10px] font-semibold">Not used</span>}
                          </span>
                        </li>
                      )
                    })}
                  </ol>
                </div>
              </div>
            </div>
            <p className="mt-2 text-xs text-fg-muted">
              {job ? 'Step ' + Math.max(1, currentStage + 1) + ' of ' + STAGES.length : 'Uploading source file before processing'}
            </p>
          </div>
        )}

        {(error || job?.status === 'failed') && (
          <div className="m-4 mt-0 flex items-start gap-2 rounded-lg border border-danger-line bg-danger-subtle p-3 text-sm text-danger-fg sm:mx-5">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <div className="flex-1">
              <p>{error || errorCopy[job.errorCode] || 'Document processing failed.'}</p>
              {job?.canRetry && <button type="button" onClick={retry} className="mt-2 inline-flex items-center gap-1 font-semibold underline"><RefreshCw className="h-3.5 w-3.5" /> Retry</button>}
            </div>
          </div>
        )}
      </div>

      {job?.status === 'ready' && (
        <div className="overflow-hidden rounded-xl border border-line bg-surface shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line bg-surface px-4 py-3">
            <div className="min-w-0">
              <h3 className="text-sm font-semibold text-fg">Review extracted information</h3>
              <p className="mt-0.5 text-xs text-fg-muted">High and medium AI-verified matches are applied automatically. Compare them with the highlighted source before submitting.</p>
            </div>
            <div className="flex flex-wrap items-center gap-1.5 text-xs">
              <span className="rounded-md bg-success-subtle px-2 py-1 font-medium text-success-fg">{job.summary?.high || 0} high</span>
              <span className="rounded-md bg-warning-subtle px-2 py-1 font-medium text-warning-fg">{job.summary?.medium || 0} medium</span>
              <span className="rounded-md bg-surface-2 px-2 py-1 font-medium text-fg-muted">{job.summary?.low || 0} low</span>
              <span className="rounded-md border border-line px-2 py-1 font-medium text-fg">{statusCounts.pending} pending</span>
              <button
                type="button"
                onClick={applyAllMedium}
                disabled={!applicableMedium.length}
                className="inline-flex items-center gap-1 rounded-md bg-indigo-600 px-2.5 py-1.5 font-semibold text-white transition hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-300 disabled:cursor-not-allowed disabled:opacity-45"
              >
                <Check className="h-3.5 w-3.5" /> Apply all ({applicableMedium.length})
              </button>
              <label className={'inline-flex cursor-pointer items-center gap-2 rounded-md border px-2.5 py-1.5 font-semibold transition ' + (reviewConfirmed ? 'border-success-line bg-success-subtle text-success-fg' : 'border-line bg-surface text-fg')}>
                <input type="checkbox" checked={reviewConfirmed} onChange={(event) => setReviewConfirmed(event.target.checked)} className="h-3.5 w-3.5 rounded border-line text-indigo-600 focus:ring-indigo-500" />
                Reviewed
              </label>
            </div>
          </div>

          <div className="grid grid-cols-2 border-b border-line bg-surface p-1 lg:hidden" role="tablist" aria-label="Document review panels">
            <button type="button" role="tab" aria-selected={mobilePanel === 'suggestions'} onClick={() => setMobilePanel('suggestions')} className={'rounded-md px-3 py-2 text-sm font-semibold transition ' + (mobilePanel === 'suggestions' ? 'bg-indigo-600 text-white' : 'text-fg-muted')}>Suggestions ({reviewItems.length})</button>
            <button type="button" role="tab" aria-selected={mobilePanel === 'source'} onClick={() => setMobilePanel('source')} className={'rounded-md px-3 py-2 text-sm font-semibold transition ' + (mobilePanel === 'source' ? 'bg-indigo-600 text-white' : 'text-fg-muted')}>Source document</button>
          </div>

          <div className="grid min-h-0 lg:h-[calc(100vh-12rem)] lg:min-h-[34rem] lg:max-h-[48rem] lg:grid-cols-[minmax(320px,0.9fr)_minmax(0,1.1fr)]">
            <aside className={(mobilePanel === 'suggestions' ? 'flex' : 'hidden') + ' min-h-0 flex-col bg-surface lg:flex'} aria-label="Extracted field suggestions">
              <div className="border-b border-line px-3 py-2.5">
                <div className="flex gap-1 overflow-x-auto" role="tablist" aria-label="Filter suggestions">
                  {[
                    ['all', 'All', reviewItems.length],
                    ['pending', 'Pending', statusCounts.pending],
                    ['applied', 'Applied', statusCounts.applied],
                    ['protected', 'Protected', statusCounts.protected],
                    ['deferred', 'Deferred', statusCounts.deferred]
                  ].map(([value, label, count]) => (
                    <button key={value} type="button" role="tab" aria-selected={reviewFilter === value} onClick={() => setReviewFilter(value)} className={'whitespace-nowrap rounded-md px-2.5 py-1.5 text-xs font-medium transition ' + (reviewFilter === value ? 'bg-indigo-50 text-indigo-700 ring-1 ring-indigo-200' : 'text-fg-muted hover:bg-surface-2 hover:text-fg')}>
                      {label} <span className="ml-0.5 opacity-70">{count}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="min-h-[28rem] flex-1 overflow-y-auto p-3 lg:min-h-0">
                {groupedItems.map((group) => (
                  <section key={group.status} className="mb-4 last:mb-0">
                    <div className="mb-2 flex items-center justify-between">
                      <h4 className="text-[11px] font-semibold uppercase tracking-wider text-fg-subtle">{REVIEW_GROUP_LABELS[group.status]}</h4>
                      <span className="text-[11px] text-fg-muted">{group.items.length}</span>
                    </div>
                    <div className="space-y-2">
                      {group.items.map(({ item, field, status }) => {
                        const selected = activeSuggestion?.fieldId === item.fieldId
                        const cardTone = status === 'pending'
                          ? 'border-warning-line bg-warning-subtle/40'
                          : status === 'applied'
                            ? 'border-success-line bg-success-subtle/35'
                            : status === 'deferred'
                              ? 'border-dashed border-line bg-surface-2/60'
                              : 'border-line bg-surface'
                        return (
                          <article key={item.fieldId} className={'rounded-lg border p-3 transition ' + cardTone + (selected ? ' ring-2 ring-indigo-200' : '')}>
                            <button type="button" onClick={() => { setActiveSuggestion(item); setMobilePanel('source') }} className="w-full rounded-sm text-left focus:outline-none focus:ring-2 focus:ring-indigo-300">
                              <div className="flex items-start justify-between gap-2">
                                <span className="text-xs font-semibold text-fg-muted">{field?.label || item.fieldId}</span>
                                <ConfidenceBadge tier={item.tier} confidence={item.confidence} />
                              </div>
                              <p className="mt-1.5 break-words text-sm font-medium text-fg">{suggestionValueSummary(item, field)}</p>
                              {item.sourceLabel && <p className="mt-1 text-[11px] text-fg-muted">Source: {item.sourceLabel}</p>}
                              {item.decisionReason && <p className="mt-1 text-[11px] leading-4 text-fg-subtle">{item.decisionReason}</p>}
                              {item.validationMessage && <p className="mt-1.5 rounded-md border border-warning-line bg-warning-subtle px-2 py-1.5 text-[11px] leading-4 text-warning-fg">{item.validationMessage}</p>}
                            </button>

                            <div className="mt-2 flex flex-wrap items-center gap-2">
                              {status === 'pending' && (
                                <button type="button" onClick={() => applySuggestion(item)} className="inline-flex items-center gap-1 rounded-md bg-indigo-600 px-2.5 py-1.5 text-xs font-semibold text-white transition hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-300">
                                  {item.tier === 'low' || item.valid === false || item.criticApproved !== true
                                    ? <><Plus className="h-3.5 w-3.5" /> Review & Add</>
                                    : <><Check className="h-3.5 w-3.5" /> Apply</>}
                                </button>
                              )}
                              {status === 'applied' && <span className="inline-flex items-center gap-1 text-xs font-semibold text-success-fg"><CheckCircle2 className="h-3.5 w-3.5" /> Applied to form</span>}
                              {status === 'protected' && <span className="inline-flex items-center gap-1 text-xs font-semibold text-indigo-700"><ShieldCheck className="h-3.5 w-3.5" /> Existing answer protected</span>}
                              {status === 'deferred' && <span className="text-xs text-fg-muted">{!field ? 'The target field is no longer available.' : 'Conditional field is currently hidden.'}</span>}
                              {item.criticApproved !== true && status !== 'applied' && status !== 'protected' && (
                                <span className="text-xs text-fg-muted">AI validation unavailable - review before applying.</span>
                              )}
                              {['medium', 'low'].includes(item.tier) && status !== 'applied' && (
                                <button type="button" onClick={() => dismissSuggestion(item.fieldId)} className="rounded-md border border-line bg-surface px-2.5 py-1.5 text-xs font-medium text-fg transition hover:bg-surface-2">Dismiss</button>
                              )}
                            </div>
                          </article>
                        )
                      })}
                    </div>
                  </section>
                ))}

                {!reviewItems.length && <p className="rounded-md bg-surface-2 p-4 text-sm text-fg-muted">No grounded field matches were found. Continue manually.</p>}
                {reviewItems.length > 0 && !filteredItems.length && <p className="rounded-md bg-surface-2 p-4 text-sm text-fg-muted">No suggestions in this category.</p>}
              </div>

              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-line px-3 py-2 text-[11px] text-fg-muted">
                <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-warning-fg" /> Pending</span>
                <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-success-fg" /> Applied</span>
                <span className="inline-flex items-center gap-1"><ShieldCheck className="h-3 w-3 text-indigo-600" /> Protected</span>
              </div>
            </aside>

            <div className={(mobilePanel === 'source' ? 'block' : 'hidden') + ' min-h-0 border-line lg:block lg:border-l'} role="tabpanel">
              <SourcePreview job={job} accessToken={accessToken} publicToken={publicToken} activeSuggestion={activeSuggestion} suggestions={suggestions} />
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
