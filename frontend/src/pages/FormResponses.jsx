// Builder-only viewer for a form's submissions (internal + public).
// Lists every FormResponse for one form in a table and exports to CSV.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import AppShell from '../components/AppShell'
import EmptyState from '../components/EmptyState'
import { ListRowSkeleton } from '../components/Skeleton'
import { AlertBanner } from '../components/Alert'
import { formsStore } from '../lib/formsStore'
import { toAbsoluteUrl } from '../utils/api'
import { useFocusTrap, useScrollLock } from '../utils/a11y'
import { SignatureMark } from '../components/FormFields'

const formatDateTime = (iso) => {
  try { return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) } catch { return '' }
}

const submitterName = (r) =>
  r.submittedBy?.name || r.submittedByExternal?.name || ''
const submitterEmail = (r) =>
  r.submittedBy?.email || r.submittedByExternal?.email || ''

// ---------- value rendering ----------
function CellValue({ field, value }) {
  if (value === undefined || value === null || value === '') {
    return <span className="text-fg-subtle">—</span>
  }
  switch (field.type) {
    case 'file':
      return typeof value === 'object' && value.url ? (
        <a href={toAbsoluteUrl(value.url)} target="_blank" rel="noreferrer" className="text-indigo-600 hover:text-indigo-700 underline">
          {value.name || 'Attachment'}
        </a>
      ) : <span className="text-fg-subtle">—</span>
    case 'signature':
      if (typeof value === 'object') {
        return value.text || value.url
          ? <SignatureMark signature={value} />
          : <span className="text-fg-subtle">—</span>
      }
      return <span className="text-fg" style={{ fontFamily: 'cursive' }}>{String(value)}</span>
    case 'checkbox':
      return <span className="text-fg">{value ? 'Yes' : 'No'}</span>
    case 'grid': {
      const rows = Array.isArray(value) ? value : []
      const cols = field.columns || []
      if (rows.length === 0) return <span className="text-fg-subtle">—</span>
      return (
          <table className="text-xs border border-line rounded">
          <thead>
            <tr className="bg-surface-2">
              {cols.map((c) => (
                <th scope="col" key={c.id} className="px-2 py-1 text-left font-medium text-fg-muted border-b border-line whitespace-nowrap">{c.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                {cols.map((c) => (
                  <td key={c.id} className="px-2 py-1 border-b border-line whitespace-nowrap">{r[c.id] ?? ''}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )
    }
    default:
      // Never stringify objects (signature/file leftovers) as "[object Object]".
      if (typeof value === 'object') {
        if (value.url || value.text) return <SignatureMark signature={value} />
        return <span className="text-fg-subtle">—</span>
      }
      return <span className="text-fg whitespace-pre-wrap">{String(value)}</span>
  }
}

// ---------- CSV ----------
const csvValue = (field, value) => {
  if (value === undefined || value === null) return ''
  if (field.type === 'file') return typeof value === 'object' ? `${value.name || ''} ${value.url ? toAbsoluteUrl(value.url) : ''}`.trim() : ''
  if (field.type === 'signature') {
    if (typeof value === 'object') {
      if (value.text) return value.text
      if (value.url) return toAbsoluteUrl(value.url)
      return ''
    }
    return String(value)
  }
  if (field.type === 'checkbox') return value ? 'Yes' : 'No'
  if (field.type === 'grid') {
    const rows = Array.isArray(value) ? value : []
    const cols = field.columns || []
    return rows.map((r) => cols.map((c) => `${c.label}: ${r[c.id] ?? ''}`).join('; ')).join(' | ')
  }
  if (typeof value === 'object') return value.text || value.url || value.name || ''
  return String(value)
}

// A 20-field form produced a 23-column table, so the grid now shows a preview
// of the first few answers and puts the rest behind a per-response detail panel.
const PREVIEW_COLUMNS = 4
const PAGE_SIZE = 25

function ResponseDetail({ response, fields, onClose }) {
  const panelRef = useRef(null)
  useScrollLock(Boolean(response))
  useFocusTrap(Boolean(response), panelRef, { onEscape: onClose })

  if (!response) return null
  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={onClose} aria-hidden="true" />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Response details"
        tabIndex={-1}
        className="relative w-full max-w-md h-full bg-surface border-l border-line shadow-xl overflow-y-auto focus:outline-none"
      >
        <div className="sticky top-0 bg-surface border-b border-line px-5 py-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-fg">
              {submitterName(response) || 'Anonymous'}
            </h2>
            <p className="text-xs text-fg-muted">
              {formatDateTime(response.createdAt)}
              {submitterEmail(response) ? ` · ${submitterEmail(response)}` : ''}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close response details"
            className="shrink-0 w-8 h-8 rounded-md border border-line text-fg-muted hover:bg-surface-2 flex items-center justify-center"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <dl className="px-5 py-4 space-y-3">
          {fields.map((f) => (
            <div key={f.id}>
              <dt className="text-xs font-medium text-fg-muted">{f.label}</dt>
              <dd className="mt-0.5 text-sm">
                <CellValue field={f} value={response.formData?.[f.id]} />
              </dd>
            </div>
          ))}
        </dl>
        {(response.attachments || []).filter((attachment) => attachment.kind === 'auto_fill_source').length > 0 && (
          <section className="border-t border-line px-5 py-4">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-fg-muted">Auto-fill source</h3>
            <ul className="mt-2 space-y-2">
              {(response.attachments || []).filter((attachment) => attachment.kind === 'auto_fill_source').map((attachment, index) => (
                <li key={(attachment.dmsDocId || attachment.path || attachment.filename) + '-' + index}>
                  <a href={toAbsoluteUrl(attachment.path)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 text-sm font-medium text-indigo-600 underline hover:text-indigo-700">
                    {attachment.filename || 'Source PDF'}
                  </a>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  )
}

function FormResponses() {
  const { id } = useParams()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(1)
  const [showAllColumns, setShowAllColumns] = useState(false)
  const [detailId, setDetailId] = useState(null)

  const load = useCallback(() => {
    setLoading(true)
    formsStore.responses(id)
      .then((d) => { setData(d); setError('') })
      .catch((err) => setError(err.message || 'Failed to load responses'))
      .finally(() => setLoading(false))
  }, [id])

  // Start the external request with its pending UI state.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load() }, [load])

  const fields = useMemo(
    () => (data?.form?.fields || []).filter((f) => f.type !== 'repeater'),
    [data]
  )
  const responses = useMemo(() => data?.responses || [], [data])

  // Search covers who submitted it and every answer, so "acme" finds a response
  // whose only mention of Acme is inside a text field.
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return responses
    return responses.filter((r) => {
      if (submitterName(r).toLowerCase().includes(q)) return true
      if (submitterEmail(r).toLowerCase().includes(q)) return true
      return fields.some((f) => csvValue(f, r.formData?.[f.id]).toLowerCase().includes(q))
    })
  }, [responses, fields, query])

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const currentPage = Math.min(page, totalPages)
  const pageRows = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE)
  const visibleColumns = showAllColumns ? fields : fields.slice(0, PREVIEW_COLUMNS)
  const hiddenColumnCount = fields.length - visibleColumns.length
  const detailResponse = filtered.find((r) => r._id === detailId) || null



  const exportCsv = () => {
    const esc = (s) => `"${String(s ?? '').replaceAll('"', '""')}"`
    const headers = ['#', 'Submitted at', 'Submitted by', 'Email', 'Source', ...fields.map((f) => f.label)]
    const lines = [headers.map(esc).join(',')]
    filtered.forEach((r, i) => {
      const cells = [
        i + 1,
        formatDateTime(r.createdAt),
        submitterName(r) || 'Anonymous',
        submitterEmail(r),
        r.source || 'internal',
        ...fields.map((f) => csvValue(f, r.formData?.[f.id]))
      ]
      lines.push(cells.map(esc).join(','))
    })
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    const safe = (data?.form?.title || 'form').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
    a.href = url
    a.download = `${safe || 'form'}-responses${query.trim() ? '-filtered' : ''}.csv`
    // Firefox ignores clicks on detached nodes, so attach before clicking.
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  const title = data?.form?.title ? `${data.form.title} — Responses` : 'Responses'
  const subtitle = loading
    ? 'Loading…'
    : query.trim()
      ? `${filtered.length} of ${responses.length} responses match`
      : `${responses.length} ${responses.length === 1 ? 'response' : 'responses'}`

  return (
    <AppShell
      title={title}
      subtitle={subtitle}
      back={{ to: '/forms', label: 'Back to forms' }}
      actions={
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={load}
            className="px-3 py-1.5 rounded-md border border-line hover:bg-surface-2 text-sm font-medium text-fg transition"
          >
            Refresh
          </button>
          <button
            type="button"
            onClick={exportCsv}
            disabled={loading || filtered.length === 0}
            title={query.trim() ? 'Exports the responses matching your search' : 'Exports every response'}
            className="px-3 py-1.5 rounded-md bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-sm font-medium shadow-sm transition"
          >
            {query.trim() ? `Export ${filtered.length} matching` : 'Export CSV'}
          </button>
        </div>
      }
    >
      {error && (
        <AlertBanner className="mb-4" onRetry={load}>{error}</AlertBanner>
      )}

      {!loading && responses.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <label className="sr-only" htmlFor="response-search">Search responses</label>
          <input
            id="response-search"
            type="search"
            value={query}
            onChange={(e) => { setQuery(e.target.value); setPage(1) }}
            placeholder="Search submitter or any answer…"
            className="w-full sm:w-72 px-3 py-2 text-sm rounded-md border border-line bg-surface focus:outline-none focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400 transition"
          />
          {fields.length > PREVIEW_COLUMNS && (
            <button
              type="button"
              onClick={() => setShowAllColumns((v) => !v)}
              className="px-3 py-2 rounded-md border border-line hover:bg-surface-2 text-sm font-medium text-fg transition"
            >
              {showAllColumns ? `Show first ${PREVIEW_COLUMNS} columns` : `Show all ${fields.length} columns`}
            </button>
          )}
        </div>
      )}

      <div className="bg-surface border border-line rounded-lg">
        {loading ? (
          <div className="divide-y divide-line">
            {Array.from({ length: 6 }).map((_, i) => <ListRowSkeleton key={i} />)}
          </div>
        ) : responses.length === 0 ? (
          <EmptyState
            title="No responses yet"
            description="Share the form's public link to start collecting submissions."
          />
        ) : filtered.length === 0 ? (
          <EmptyState
            title="No responses match your search"
            description="Try a shorter search term, or clear it to see every response."
          />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[11px] font-semibold tracking-wider text-fg-subtle uppercase border-b border-line">
                    <th scope="col" className="px-4 py-3 whitespace-nowrap">Submitted</th>
                    <th scope="col" className="px-4 py-3 whitespace-nowrap">By</th>
                    <th scope="col" className="px-4 py-3 whitespace-nowrap">Source</th>
                    {visibleColumns.map((f) => (
                      <th scope="col" key={f.id} className="px-4 py-3 whitespace-nowrap">{f.label}</th>
                    ))}
                    <th scope="col" className="px-4 py-3 whitespace-nowrap text-right">Details</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {pageRows.map((r) => (
                    <tr key={r._id} className="hover:bg-surface-2/60 align-top">
                      <td className="px-4 py-3 whitespace-nowrap text-fg-muted">{formatDateTime(r.createdAt)}</td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <p className="text-fg">{submitterName(r) || <span className="text-fg-subtle">Anonymous</span>}</p>
                        {submitterEmail(r) && <p className="text-xs text-fg-subtle">{submitterEmail(r)}</p>}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${r.source === 'public' ? 'bg-success-subtle text-success-fg' : 'bg-surface-3 text-fg-muted'}`}>
                          {r.source === 'public' ? 'Public' : 'Internal'}
                        </span>
                      </td>
                      {visibleColumns.map((f) => (
                        <td key={f.id} className="px-4 py-3 max-w-xs">
                          <CellValue field={f} value={r.formData?.[f.id]} />
                        </td>
                      ))}
                      <td className="px-4 py-3 whitespace-nowrap text-right">
                        <button
                          type="button"
                          onClick={() => setDetailId(r._id)}
                          className="px-2.5 py-1 rounded-md border border-info-line bg-info-subtle hover:brightness-95 text-xs font-medium text-info-fg transition"
                        >
                          View{hiddenColumnCount > 0 ? ` (+${hiddenColumnCount})` : ''}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {totalPages > 1 && (
              <div className="px-4 py-3 border-t border-line flex items-center justify-between text-sm">
                <p className="text-fg-muted">
                  Showing {(currentPage - 1) * PAGE_SIZE + 1}–{Math.min(currentPage * PAGE_SIZE, filtered.length)} of {filtered.length}
                </p>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={currentPage === 1}
                    className="px-3 py-1.5 rounded-md border border-line hover:bg-surface-2 disabled:opacity-50 disabled:cursor-not-allowed font-medium text-fg transition"
                  >
                    Previous
                  </button>
                  <span className="text-fg-muted">Page {currentPage} of {totalPages}</span>
                  <button
                    type="button"
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    disabled={currentPage === totalPages}
                    className="px-3 py-1.5 rounded-md border border-line hover:bg-surface-2 disabled:opacity-50 disabled:cursor-not-allowed font-medium text-fg transition"
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {detailResponse && (
        <ResponseDetail
          response={detailResponse}
          fields={fields}
          onClose={() => setDetailId(null)}
        />
      )}
    </AppShell>
  )
}

export default FormResponses
