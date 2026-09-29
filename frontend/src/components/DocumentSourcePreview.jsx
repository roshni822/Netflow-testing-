import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ChevronLeft, ChevronRight, Expand, LoaderCircle,
  Minus, Plus, X
} from 'lucide-react'
import { API_BASE, getToken } from '../utils/api'

const sourceRegionBounds = (region) => {
  const width = Math.max(0, Math.min(1, Number(region?.width) || 0))
  const height = Math.max(0, Math.min(1, Number(region?.height) || 0))
  const left = Math.max(0, Math.min(1, Number(region?.x) || 0))
  const top = Math.max(0, Math.min(1, Number(region?.y) || 0))
  // Keep the extraction bounds: padding/minimum sizes cover adjacent table rows.
  return {
    left, top,
    width: Math.min(1 - left, width),
    height: Math.min(1 - top, height)
  }
}

export default function DocumentSourcePreview({ job, activeCandidate, candidates = [] }) {
  const activeCandidateId = activeCandidate?.candidateId || ''
  const suggestedPage = activeCandidate?.sourceRegions?.[0]?.page || 1
  const [pageOverride, setPageOverride] = useState({ candidateId: '', page: null })
  const page = pageOverride.candidateId === activeCandidateId && pageOverride.page
    ? pageOverride.page
    : suggestedPage
  const [zoom, setZoom] = useState(100)
  const [imageUrl, setImageUrl] = useState('')
  const [loadedPage, setLoadedPage] = useState(null)
  const [error, setError] = useState({ page: null, message: '' })
  const [fullscreen, setFullscreen] = useState(false)
  const [showAllMatches, setShowAllMatches] = useState(true)
  const dialogRef = useRef(null)
  const fullscreenButtonRef = useRef(null)
  const viewportRef = useRef(null)
  const primaryHighlightRef = useRef(null)

  useEffect(() => {
    if (!job?.jobId || !job?.pageCount) return undefined
    let cancelled = false
    let objectUrl = ''
    const controller = new AbortController()
    const token = getToken()
    fetch(
      API_BASE + '/api/forms/document-drafts/' + encodeURIComponent(job.jobId) + '/pages/' + page,
      {
        headers: token ? { Authorization: 'Bearer ' + token } : {},
        signal: controller.signal
      }
    )
      .then(async (response) => {
        if (!response.ok) throw new Error('Document preview is unavailable.')
        return response.blob()
      })
      .then((blob) => {
        if (cancelled) return
        objectUrl = URL.createObjectURL(blob)
        setImageUrl(objectUrl)
        setLoadedPage(page)
        setError({ page: null, message: '' })
      })
      .catch((cause) => {
        if (!cancelled && cause?.name !== 'AbortError') {
          setError({ page, message: cause.message || 'Document preview is unavailable.' })
        }
      })

    return () => {
      cancelled = true
      controller.abort()
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [job?.jobId, job?.pageCount, page])

  useEffect(() => {
    if (!fullscreen) return undefined
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    dialogRef.current?.focus()
    const onKeyDown = (event) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      setFullscreen(false)
      requestAnimationFrame(() => fullscreenButtonRef.current?.focus())
    }
    // Capture on window before the parent modal's Escape handler so Escape
    // closes fullscreen without also closing the complete generation flow.
    window.addEventListener('keydown', onKeyDown, true)
    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', onKeyDown, true)
    }
  }, [fullscreen])

  const activeRegions = (activeCandidate?.sourceRegions || [])
    .filter((region) => Number(region.page) === Number(page))
  const highlightedRegions = useMemo(() => {
    const unique = new Map()
    const visibleCandidates = showAllMatches ? candidates : (activeCandidate ? [activeCandidate] : [])
    const addCandidate = (candidate) => {
      const isActive = candidate?.candidateId === activeCandidateId
      const kind = isActive ? 'active' : candidate?.included ? 'included' : 'suggestion'
      const rank = isActive ? 3 : candidate?.included ? 2 : 1
      for (const region of candidate?.sourceRegions || []) {
        if (Number(region.page) !== Number(page)) continue
        const key = [
          region.page, region.lineId, region.x, region.y, region.width, region.height
        ].join(':')
        const existing = unique.get(key)
        if (!existing || rank > existing.rank) {
          unique.set(key, {
            key,
            region,
            candidateId: candidate.candidateId,
            isActive,
            kind,
            rank
          })
        }
      }
    }
    visibleCandidates.forEach(addCandidate)
    if (activeCandidate && !visibleCandidates.some((candidate) =>
      candidate?.candidateId === activeCandidateId
    )) {
      addCandidate(activeCandidate)
    }
    return [...unique.values()]
  }, [activeCandidate, activeCandidateId, candidates, page, showAllMatches])
  const activePrimaryKey = highlightedRegions.find((entry) => entry.isActive)?.key || ''
  const highlightedCandidateCount = new Set(
    highlightedRegions.map((entry) => entry.candidateId)
  ).size

  useEffect(() => {
    if (!activeCandidateId || !activeRegions.length || loadedPage !== page) return undefined
    const timer = setTimeout(() => {
      setZoom((current) => Math.max(125, current))
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          const viewport = viewportRef.current
          const target = primaryHighlightRef.current
          if (!viewport || !target) return
          const viewportBox = viewport.getBoundingClientRect()
          const targetBox = target.getBoundingClientRect()
          viewport.scrollBy({
            left: targetBox.left - viewportBox.left + (targetBox.width / 2) - (viewport.clientWidth / 2),
            top: targetBox.top - viewportBox.top + (targetBox.height / 2) - (viewport.clientHeight / 2),
            behavior: 'smooth'
          })
        })
      })
    }, 120)
    return () => clearTimeout(timer)
  }, [activeCandidateId, loadedPage, page, activeRegions.length])

  const changeZoom = (value) => setZoom(Math.max(75, Math.min(200, value)))
  const changePage = (nextPage) => setPageOverride({ candidateId: activeCandidateId, page: nextPage })

  return (
    <section
      ref={dialogRef}
      tabIndex={fullscreen ? -1 : undefined}
      role={fullscreen ? 'dialog' : 'region'}
      aria-modal={fullscreen || undefined}
      aria-label={fullscreen ? 'Fullscreen reference document' : 'Reference document'}
      className={
        fullscreen
          ? 'fixed inset-0 z-[100] flex h-[100dvh] min-h-0 flex-col overflow-hidden bg-surface shadow-2xl'
          : 'flex h-full min-h-[32rem] min-w-0 flex-col overflow-hidden rounded-xl border border-line bg-surface'
      }
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-surface px-3 py-2.5">
        <div className="min-w-0">
          <p className="truncate text-xs font-semibold text-fg">{job?.filename || 'Reference document'}</p>
          <p className="text-[11px] text-fg-muted">Page {page} of {job?.pageCount || 1}</p>
        </div>
        <div className="flex max-w-full flex-wrap items-center gap-1" aria-label="Document preview controls">
          <button type="button" aria-label="Previous page" disabled={page <= 1} onClick={() => changePage(Math.max(1, page - 1))} className="rounded-md border border-line p-1.5 text-fg hover:bg-surface-2 disabled:opacity-40"><ChevronLeft className="h-3.5 w-3.5" /></button>
          <span className="min-w-10 text-center text-xs text-fg">{page}/{job?.pageCount || 1}</span>
          <button type="button" aria-label="Next page" disabled={page >= (job?.pageCount || 1)} onClick={() => changePage(Math.min(job?.pageCount || 1, page + 1))} className="rounded-md border border-line p-1.5 text-fg hover:bg-surface-2 disabled:opacity-40"><ChevronRight className="h-3.5 w-3.5" /></button>
          <span className="mx-1 h-5 w-px bg-line" aria-hidden="true" />
          <button type="button" aria-label="Zoom out" disabled={zoom <= 75} onClick={() => changeZoom(zoom - 25)} className="rounded-md border border-line p-1.5 text-fg hover:bg-surface-2 disabled:opacity-40"><Minus className="h-3.5 w-3.5" /></button>
          <span className="min-w-10 text-center text-xs text-fg">{zoom}%</span>
          <button type="button" aria-label="Zoom in" disabled={zoom >= 200} onClick={() => changeZoom(zoom + 25)} className="rounded-md border border-line p-1.5 text-fg hover:bg-surface-2 disabled:opacity-40"><Plus className="h-3.5 w-3.5" /></button>
          <button ref={fullscreenButtonRef} type="button" aria-label={fullscreen ? 'Close fullscreen' : 'Open fullscreen'} onClick={() => setFullscreen((value) => !value)} className="ml-1 rounded-md border border-line p-1.5 text-fg hover:bg-surface-2">
            {fullscreen ? <X className="h-3.5 w-3.5" /> : <Expand className="h-3.5 w-3.5" />}
          </button>
          <button type="button" aria-pressed={showAllMatches}
            aria-label={showAllMatches ? 'Hide other matched fields' : 'Show all matched fields'}
            onClick={() => setShowAllMatches((value) => !value)}
            className={'ml-1 rounded-md border px-2 py-1.5 text-xs font-semibold transition ' + (showAllMatches
              ? 'border-indigo-300 bg-indigo-50 text-indigo-700 dark:border-indigo-500/50 dark:bg-indigo-500/15 dark:text-indigo-200'
              : 'border-line bg-surface text-fg hover:bg-surface-2')}
          >Show all matches: {showAllMatches ? 'On' : 'Off'}</button>
        </div>
      </div>

      {highlightedRegions.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-line bg-surface px-3 py-2 text-[11px] text-fg-muted">
          <span>{highlightedCandidateCount} matched field{highlightedCandidateCount === 1 ? '' : 's'} on this page</span>
          <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm border border-indigo-500 bg-indigo-400/25" /> Included</span>
          <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm border border-dashed border-amber-500 bg-amber-300/25" /> Suggestion</span>
          <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm border border-fuchsia-600 bg-fuchsia-300/30" /> Selected</span>
        </div>
      )}

      {activeCandidate && !activeCandidate.sourceRegions?.length && (
        <div className="border-b border-warning-line bg-warning-subtle px-3 py-2 text-xs text-warning-fg" role="status">
          This low-confidence suggestion has no verified source region. Review it against the document before including it.
        </div>
      )}

      <div ref={viewportRef} className="min-h-0 flex-1 overflow-auto bg-surface-2 p-3 sm:p-4">
        {error.page === page ? (
          <p className="p-6 text-sm text-danger-fg">{error.message}</p>
        ) : imageUrl && loadedPage === page ? (
          <div className="relative mx-auto overflow-hidden rounded-md border border-line bg-white shadow-sm" style={{ width: zoom + '%' }}>
            <img src={imageUrl} alt={'Reference document page ' + page} className="block h-auto w-full" />
            {highlightedRegions.map((entry) => {
              const box = sourceRegionBounds(entry.region)
              const classes = entry.kind === 'active'
                ? 'border-fuchsia-600 bg-amber-300/35'
                : entry.kind === 'included'
                  ? 'border-indigo-500 bg-indigo-400/20'
                  : 'border-dashed border-amber-500 bg-amber-300/20'
              return (
                <span
                  ref={entry.key === activePrimaryKey ? primaryHighlightRef : undefined}
                  key={entry.key}
                  className={'pointer-events-none absolute box-border m-0 rounded-[1px] border p-0 ' + classes}
                  style={{
                    left: (box.left * 100) + '%',
                    top: (box.top * 100) + '%',
                    width: (box.width * 100) + '%',
                    height: (box.height * 100) + '%'
                  }}
                  aria-hidden="true"
                />
              )
            })}
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
