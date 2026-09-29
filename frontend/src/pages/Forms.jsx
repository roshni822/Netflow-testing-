import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { AlertTriangle, BarChart3, CheckCircle2, FileText, Grid2X2, List, PencilLine, Plus, RefreshCw } from 'lucide-react'
import AppShell from '../components/AppShell'
import NewFormModal from '../components/NewFormModal'
import EmptyState from '../components/EmptyState'
import { Skeleton } from '../components/Skeleton'
import { useForms, formsStore, FORM_CATEGORIES } from '../lib/formsStore'
import { useUser } from '../utils/auth'
import { canCreateForm, canSubmitForms, canEditForm } from '../utils/permissions'
import { toast } from '../lib/toastStore'
import { confirm } from '../lib/confirmStore'
import { useReadOnly } from '../lib/usageStore'

const formatDate = (iso) => {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    })
  } catch {
    return ''
  }
}

function StatCard({ label, value, hint, icon: Icon, tone = 'blue' }) {
  return (
    <div className={`nf-forms-metric nf-forms-tone-${tone}`}>
      <div className="nf-forms-metric-top">
        <p className="nf-forms-metric-label">{label}</p>
        <span className="nf-forms-metric-icon"><Icon aria-hidden="true" /></span>
      </div>
      <p className="nf-forms-metric-value">{value}</p>
      {hint ? <p className="nf-forms-metric-hint">{hint}</p> : null}
    </div>
  )
}

function SearchIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 text-fg-subtle absolute left-3 top-1/2 -translate-y-1/2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
      <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M17 10a7 7 0 11-14 0 7 7 0 0114 0z" />
    </svg>
  )
}

function FormGlyph({ className = 'w-4 h-4' }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 4H7a2 2 0 01-2-2V5a2 2 0 012-2h7l4 4v11a2 2 0 01-2 2z" />
    </svg>
  )
}

function IconForm(props) {
  return (
    <svg {...props} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 4H7a2 2 0 01-2-2V5a2 2 0 012-2h7l4 4v11a2 2 0 01-2 2z" />
    </svg>
  )
}

function StatusBadge({ status, onClick, interactive }) {
  const tone = status === 'Published' ? 'success' : status === 'Draft' ? 'warning' : 'neutral'
  const base = `nf-status nf-status-${tone}`
  if (!interactive) {
    return <span className={base}>{status}</span>
  }
  return (
    <button
      type="button"
      onClick={onClick}
      title={status === 'Published' ? 'Archive form' : 'Publish form'}
      aria-label={`${status === 'Published' ? 'Archive' : 'Publish'} form`}
      className={`${base} nf-forms-status-action`}
    >
      {status}
    </button>
  )
}

const ROW_MENU_WIDTH = 192
const ROW_MENU_GAP = 6
const ROW_MENU_EDGE = 8

function rowMenuPosition(anchor, menuHeight = 210) {
  const rect = anchor.getBoundingClientRect()
  const spaceBelow = window.innerHeight - rect.bottom - ROW_MENU_EDGE
  const openAbove = spaceBelow < menuHeight + ROW_MENU_GAP && rect.top > spaceBelow
  const top = openAbove
    ? Math.max(ROW_MENU_EDGE, rect.top - menuHeight - ROW_MENU_GAP)
    : Math.min(window.innerHeight - menuHeight - ROW_MENU_EDGE, rect.bottom + ROW_MENU_GAP)
  const left = Math.max(
    ROW_MENU_EDGE,
    Math.min(window.innerWidth - ROW_MENU_WIDTH - ROW_MENU_EDGE, rect.right - ROW_MENU_WIDTH)
  )
  return { top: Math.max(ROW_MENU_EDGE, top), left, placement: openAbove ? 'top' : 'bottom' }
}

function RowMenu({ form, canCreate, canEdit, onResponses, onCopyLink, onStopSharing, onEdit, onDelete }) {
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState({ top: 0, left: 0, placement: 'bottom' })
  const triggerRef = useRef(null)
  const menuRef = useRef(null)
  const menuId = useId()

  useEffect(() => {
    if (!open) return undefined

    const reposition = () => {
      if (!triggerRef.current) return
      setPosition(rowMenuPosition(triggerRef.current, menuRef.current?.offsetHeight || 210))
    }
    const handlePointerDown = (event) => {
      if (triggerRef.current?.contains(event.target) || menuRef.current?.contains(event.target)) return
      setOpen(false)
    }
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        setOpen(false)
        triggerRef.current?.focus()
        return
      }

      if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
      const items = Array.from(menuRef.current?.querySelectorAll('[role="menuitem"]:not(:disabled)') || [])
      if (!items.length) return
      event.preventDefault()
      const currentIndex = items.indexOf(document.activeElement)
      let nextIndex = 0
      if (event.key === 'End') nextIndex = items.length - 1
      else if (event.key === 'ArrowUp') nextIndex = currentIndex <= 0 ? items.length - 1 : currentIndex - 1
      else if (event.key === 'ArrowDown') nextIndex = currentIndex >= items.length - 1 ? 0 : currentIndex + 1
      items[nextIndex]?.focus()
    }

    const frame = window.requestAnimationFrame(() => {
      reposition()
      menuRef.current?.querySelector('[role="menuitem"]')?.focus()
    })
    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    document.addEventListener('scroll', reposition, true)
    window.addEventListener('resize', reposition)

    return () => {
      window.cancelAnimationFrame(frame)
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
      document.removeEventListener('scroll', reposition, true)
      window.removeEventListener('resize', reposition)
    }
  }, [open])

  const item =
    'w-full text-left px-3 py-2 text-sm text-fg hover:bg-surface-2 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2'
  const danger = 'w-full text-left px-3 py-2 text-sm text-danger-fg hover:bg-danger-subtle flex items-center gap-2'
  const close = (fn) => () => {
    setOpen(false)
    triggerRef.current?.focus()
    fn?.()
  }

  const showShare = canCreate && form.status === 'Published'
  const toggleMenu = () => {
    if (open) {
      setOpen(false)
      return
    }
    if (triggerRef.current) setPosition(rowMenuPosition(triggerRef.current))
    setOpen(true)
  }

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={toggleMenu}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={`Actions for ${form.name}`}
        className="nf-icon-button nf-forms-more-button"
      >
        <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="5.5" cy="12" r="1.35" />
          <circle cx="12" cy="12" r="1.35" />
          <circle cx="18.5" cy="12" r="1.35" />
        </svg>
      </button>
      {open && typeof document !== 'undefined' && createPortal(
        <div
          id={menuId}
          ref={menuRef}
          role="menu"
          aria-label={'Actions for ' + form.name}
          data-placement={position.placement}
          className="nf-forms-row-menu"
          style={{ top: position.top, left: position.left }}
        >
          {canCreate && (
            <button type="button" role="menuitem" className={item} onClick={close(onResponses)}>
              View responses
            </button>
          )}
          {showShare && form.isPublic && (
            <>
              <button type="button" role="menuitem" className={item} onClick={close(onCopyLink)}>
                Copy public link
              </button>
              <button type="button" role="menuitem" className={item} onClick={close(onStopSharing)}>
                Stop sharing
              </button>
            </>
          )}
          {canEdit && (
            <button type="button" role="menuitem" className={item} onClick={close(onEdit)}>
              Edit form
            </button>
          )}
          {canCreate && (
            <>
              <div className="my-1 border-t border-line" />
              <button type="button" role="menuitem" className={danger} onClick={close(onDelete)}>
                Delete
              </button>
            </>
          )}
        </div>,
        document.body
      )}
    </div>
  )
}

// Shell 4 — what Forms means to someone who only ever starts requests.
const FORM_ICON_TONES = ['blue', 'teal', 'purple', 'amber', 'coral']

function formIconTone(id) {
  const value = String(id || 'form')
  let hash = 0
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash * 31) + value.charCodeAt(index)) | 0
  }
  return FORM_ICON_TONES[Math.abs(hash) % FORM_ICON_TONES.length]
}

function FillFormIcon({ className = 'w-4 h-4' }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <path d="M13.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h7" />
      <path d="M14 2v6h6v5" />
      <path d="m14.5 19.5 1-3 4.7-4.7a1.4 1.4 0 0 1 2 2l-4.7 4.7-3 1Z" />
    </svg>
  )
}

function ShareIcon({ className = 'w-4 h-4' }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <circle cx="18" cy="5" r="3" />
      <circle cx="6" cy="12" r="3" />
      <circle cx="18" cy="19" r="3" />
      <path d="m8.6 10.5 6.8-4M8.6 13.5l6.8 4" />
    </svg>
  )
}

function FormsViewToggle({ value, onChange }) {
  return (
    <div className="nf-forms-view-toggle" role="group" aria-label="Forms layout">
      <button
        type="button"
        onClick={() => onChange('list')}
        className={`nf-forms-view-button ${value === 'list' ? 'is-active' : ''}`}
        aria-label="List view"
        aria-pressed={value === 'list'}
        title="List view"
      >
        <List aria-hidden="true" />
      </button>
      <button
        type="button"
        onClick={() => onChange('grid')}
        className={`nf-forms-view-button ${value === 'grid' ? 'is-active' : ''}`}
        aria-label="Grid view"
        aria-pressed={value === 'grid'}
        title="Grid view"
      >
        <Grid2X2 aria-hidden="true" />
      </button>
    </div>
  )
}

function FormsPagination({ page, pageSize, total, onPageChange, totalLabel = '' }) {
  const pages = Math.max(1, Math.ceil(total / pageSize))
  const safePage = Math.min(Math.max(1, page), pages)
  const from = total === 0 ? 0 : ((safePage - 1) * pageSize) + 1
  const to = Math.min(safePage * pageSize, total)

  return (
    <nav className="nf-forms-pagination" aria-label="Forms pagination">
      <span>Showing {from}–{to}{totalLabel ? ` of ${total} ${totalLabel}` : ''}</span>
      <div className="nf-forms-pagination-actions">
        <button type="button" className="nf-button nf-forms-page-button" disabled={safePage <= 1} onClick={() => onPageChange(safePage - 1)}>
          Previous
        </button>
        <button type="button" className="nf-button nf-forms-page-button" disabled={safePage >= pages} onClick={() => onPageChange(safePage + 1)}>
          Next
        </button>
      </div>
    </nav>
  )
}

function RequestCatalogue() {
  const navigate = useNavigate()
  const forms = useForms()
  const readOnly = useReadOnly()
  const searchRef = useRef(null)
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('')
  const [sortOrder, setSortOrder] = useState('name')
  const [page, setPage] = useState(1)
  const [viewMode, setViewMode] = useState(() => {
    try { return localStorage.getItem('netflow.catalogue.view') || 'list' } catch { return 'list' }
  })
  const [booting, setBooting] = useState(true)
  const [loadError, setLoadError] = useState('')

  useEffect(() => {
    let active = true
    formsStore.refresh()
      .catch((error) => {
        if (active) setLoadError(error?.message || 'Available forms could not be loaded.')
      })
      .finally(() => {
        if (active) setBooting(false)
      })
    return () => { active = false }
  }, [])

  const startable = useMemo(
    () => forms.filter((f) => f.status === 'Published' && f.fields > 0),
    [forms]
  )

  const categories = useMemo(
    () => [...new Set(startable.map((f) => f.category).filter(Boolean))].sort(),
    [startable]
  )

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    const matches = startable.filter((f) => {
      const matchesSearch = !q
        || (f.name || '').toLowerCase().includes(q)
        || (f.description || '').toLowerCase().includes(q)
      return matchesSearch && (!category || f.category === category)
    })
    return matches.sort((a, b) => {
      if (sortOrder === 'recent') return new Date(b.updatedAt || b.createdAt || 0) - new Date(a.updatedAt || a.createdAt || 0)
      if (sortOrder === 'category') return (a.category || '').localeCompare(b.category || '') || (a.name || '').localeCompare(b.name || '')
      return (a.name || '').localeCompare(b.name || '')
    })
  }, [startable, search, category, sortOrder])

  const pageSize = 10
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize))
  const safePage = Math.min(page, totalPages)
  const displayedForms = filtered.slice((safePage - 1) * pageSize, safePage * pageSize)

  const updateView = (mode) => {
    setViewMode(mode)
    try { localStorage.setItem('netflow.catalogue.view', mode) } catch { /* preference storage unavailable */ }
  }

  const retryForms = async () => {
    setBooting(true)
    setLoadError('')
    try {
      await formsStore.refresh()
    } catch (error) {
      setLoadError(error?.message || 'Available forms could not be loaded.')
    } finally {
      setBooting(false)
    }
  }

  const openForm = (form) => navigate(`/forms/${form.id}/fill`)
  const pausedTitle = readOnly
    ? 'The workspace licence has expired — new requests are paused.'
    : undefined

  return (
    <AppShell
      title="Start a request"
      subtitle="Choose a published form available to your role and department."
      mainClass="flex-1 p-4 md:p-6 pb-24 md:pb-6 overflow-y-auto"
    >
      <div className="nf-forms-catalogue">
        <section data-tour="forms-list" className="nf-forms-management-shell nf-forms-catalogue-shell">
          <div className="nf-forms-toolbar">
            <div className="nf-forms-toolbar-group">
              <label className="nf-forms-search">
                <SearchIcon />
                <input
                  ref={searchRef}
                  type="search"
                  value={search}
                  onChange={(event) => { setSearch(event.target.value); setPage(1) }}
                  placeholder="Search by name or description"
                  aria-label="Search available forms"
                  className="nf-forms-field"
                />
              </label>
              <select
                value={category}
                onChange={(event) => { setCategory(event.target.value); setPage(1) }}
                aria-label="Filter by category"
                className="nf-forms-select"
              >
                <option value="">All categories</option>
                {categories.map((option) => <option key={option} value={option}>{option}</option>)}
              </select>
              <select
                value={sortOrder}
                onChange={(event) => { setSortOrder(event.target.value); setPage(1) }}
                aria-label="Sort available forms"
                className="nf-forms-select nf-forms-sort"
              >
                <option value="name">Name A-Z</option>
                <option value="category">Category</option>
                <option value="recent">Recently updated</option>
              </select>
            </div>
            <FormsViewToggle value={viewMode} onChange={updateView} />
          </div>

          {loadError ? (
            <div className="nf-forms-error" role="alert">
              <AlertTriangle aria-hidden="true" />
              <span>{loadError}</span>
              <button type="button" onClick={retryForms} disabled={booting}>
                <RefreshCw aria-hidden="true" />
                {booting ? 'Retrying…' : 'Try again'}
              </button>
            </div>
          ) : null}

          <div className="nf-forms-results">
            {booting && !startable.length ? (
              viewMode === 'grid' ? (
                <div className="nf-forms-card-grid" aria-label="Loading available forms">
                  {Array.from({ length: 6 }).map((_, index) => (
                    <article key={index} className="nf-forms-card nf-forms-catalogue-card nf-forms-skeleton-card">
                      <div className="nf-forms-card-body">
                        <div className="nf-forms-card-head">
                          <Skeleton className="h-9 w-9 rounded-[10px]" />
                          <Skeleton className="h-5 w-20 rounded-full" />
                        </div>
                        <Skeleton className="mt-4 h-4 w-2/3" />
                        <Skeleton className="mt-2 h-3 w-full" />
                        <div className="nf-forms-card-facts">
                          <Skeleton className="h-8 w-24" />
                          <Skeleton className="h-8 w-20" />
                        </div>
                      </div>
                      <div className="nf-forms-card-footer"><Skeleton className="h-8 w-24 rounded-lg" /></div>
                    </article>
                  ))}
                </div>
              ) : (
                <div className="nf-forms-loading-list" aria-label="Loading available forms">
                  {Array.from({ length: 7 }).map((_, index) => (
                    <div key={index} className="nf-forms-loading-row">
                      <Skeleton className="h-9 w-9 rounded-[10px]" />
                      <Skeleton className="h-4 w-48" />
                      <Skeleton className="h-4 w-24" />
                      <Skeleton className="h-4 w-16" />
                      <Skeleton className="h-8 w-24 rounded-lg" />
                    </div>
                  ))}
                </div>
              )
            ) : !filtered.length ? (
              <div className="nf-forms-catalogue-empty">
                <EmptyState
                  title={startable.length ? 'Nothing matches that' : 'No requests available yet'}
                  description={startable.length
                    ? 'Try a different word, or clear the category filter.'
                    : 'When an admin publishes a form for your team, it shows up here.'}
                  icon={<IconForm className="w-5 h-5" />}
                />
              </div>
            ) : viewMode === 'grid' ? (
              <div className="nf-forms-card-grid" aria-label="Available forms">
                {displayedForms.map((form) => {
                  const tone = formIconTone(form.id)
                  return (
                    <article key={form.id} className="nf-forms-card nf-forms-catalogue-card">
                      <div className="nf-forms-card-body">
                        <div className="nf-forms-card-head">
                          <span className={`nf-forms-icon nf-forms-icon-${tone}`}><FormGlyph /></span>
                          <span className="nf-status nf-status-success">Available</span>
                        </div>
                        <button
                          type="button"
                          onClick={() => openForm(form)}
                          disabled={readOnly}
                          title={pausedTitle}
                          className="nf-forms-card-title"
                        >
                          {form.name}
                        </button>
                        <p className="nf-forms-card-description">{form.description || 'No description'}</p>
                        <dl className="nf-forms-card-facts">
                          <div><dt>Category</dt><dd>{form.category || 'Uncategorized'}</dd></div>
                          <div><dt>Fields</dt><dd>{form.fields ?? 0}</dd></div>
                        </dl>
                      </div>
                      <div className="nf-forms-card-footer">
                        <div className="nf-forms-card-actions">
                          <button
                            type="button"
                            onClick={() => openForm(form)}
                            disabled={readOnly}
                            title={pausedTitle}
                            className="nf-forms-fill-button"
                          >
                            <FillFormIcon />
                            Fill form
                          </button>
                        </div>
                      </div>
                    </article>
                  )
                })}
              </div>
            ) : (
              <div className="nf-forms-list-view">
                <table className="nf-forms-table nf-forms-catalogue-table">
                  <thead>
                    <tr>
                      <th>Form</th>
                      <th>Category</th>
                      <th>Fields</th>
                      <th>Access</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {displayedForms.map((form) => {
                      const tone = formIconTone(form.id)
                      return (
                        <tr key={form.id}>
                          <td>
                            <div className="nf-forms-cell-main">
                              <span className={`nf-forms-icon nf-forms-icon-${tone}`}><FormGlyph /></span>
                              <span className="nf-forms-cell-copy">
                                <button
                                  type="button"
                                  onClick={() => openForm(form)}
                                  disabled={readOnly}
                                  title={pausedTitle}
                                  className="nf-forms-cell-title"
                                >
                                  {form.name}
                                </button>
                                <small className="nf-forms-cell-meta">{form.description || 'No description'}</small>
                              </span>
                            </div>
                          </td>
                          <td>{form.category || 'Uncategorized'}</td>
                          <td className="nf-forms-number">{form.fields ?? 0}</td>
                          <td><span className="nf-status nf-status-success">Available</span></td>
                          <td>
                            <button
                              type="button"
                              onClick={() => openForm(form)}
                              disabled={readOnly}
                              title={pausedTitle}
                              className="nf-forms-fill-button nf-forms-catalogue-row-fill"
                            >
                              <FillFormIcon />
                              Fill form
                            </button>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {filtered.length > 0 ? (
            <FormsPagination
              page={safePage}
              pageSize={pageSize}
              total={filtered.length}
              onPageChange={setPage}
              totalLabel={filtered.length === 1 ? 'available form' : 'available forms'}
            />
          ) : null}
        </section>
      </div>
    </AppShell>
  )
}

function FormsLibrary() {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const forms = useForms()
  const me = useUser()
  const canCreate = canCreateForm(me)
  const canSubmit = canSubmitForms(me)
  const canEdit = canEditForm(me)
  const readOnly = useReadOnly()
  const [search, setSearch] = useState('')
  const [sortOrder, setSortOrder] = useState('updated')
  const [page, setPage] = useState(1)
  const [viewMode, setViewMode] = useState(() => {
    try { return localStorage.getItem('netflow.forms.view') || 'list' } catch { return 'list' }
  })
  const [newOpen, setNewOpen] = useState(false)
  const [booting, setBooting] = useState(true)
  const [loadError, setLoadError] = useState('')
  useEffect(() => {
    let active = true
    formsStore.refresh()
      .catch((error) => {
        if (active) setLoadError(error?.message || 'Forms could not be loaded.')
      })
      .finally(() => {
        if (active) setBooting(false)
      })
    return () => { active = false }
  }, [])

  useEffect(() => {
    if (searchParams.get('new') !== '1') return
    const timer = window.setTimeout(() => {
      if (!readOnly) setNewOpen(true)
      const next = new URLSearchParams(searchParams)
      next.delete('new')
      setSearchParams(next, { replace: true })
    }, 0)
    return () => window.clearTimeout(timer)
  }, [readOnly, searchParams, setSearchParams])

  const buildUrl = (token) => `${window.location.origin}/f/${token}`
  const copyText = async (text) => {
    try { await navigator.clipboard.writeText(text); return true } catch { return false }
  }
  const shareForm = async (f) => {
    try {
      const target = f.isPublic && f.publicToken ? f : await formsStore.setPublic(f.id, true)
      const url = buildUrl(target.publicToken)
      const ok = await copyText(url)
      if (ok) toast.success('Public link copied to clipboard')
      else window.prompt('Public link — copy it:', url)
    } catch (err) {
      toast.error(err.message || 'Could not create a public link.')
    }
  }
  const copyLink = async (f) => {
    const url = buildUrl(f.publicToken)
    const ok = await copyText(url)
    if (ok) toast.success('Public link copied to clipboard')
    else window.prompt('Public link — copy it:', url)
  }
  const stopSharing = async (f) => {
    const ok = await confirm({
      title: 'Stop sharing?',
      message: 'The public link will stop working until you share again.',
      confirmLabel: 'Stop sharing',
      danger: false,
    })
    if (!ok) return
    try {
      await formsStore.setPublic(f.id, false)
      toast.success('Sharing stopped')
    } catch (err) {
      toast.error(err.message || 'Failed to update sharing.')
    }
  }
  const [categoryFilter, setCategoryFilter] = useState('All categories')
  const [statusFilter, setStatusFilter] = useState('All statuses')
  const availableCategories = useMemo(() => {
    const realCategories = forms.map((form) => form.category).filter(Boolean)
    return [...new Set([...FORM_CATEGORIES, ...realCategories])]
  }, [forms])

  const filtered = useMemo(() => {
    const matches = forms.filter((f) => {
      const matchesSearch =
        !search.trim() ||
        (f.name || '').toLowerCase().includes(search.toLowerCase()) ||
        (f.description || '').toLowerCase().includes(search.toLowerCase())
      const matchesCat = categoryFilter === 'All categories' || f.category === categoryFilter
      const matchesStatus = statusFilter === 'All statuses' || f.status === statusFilter
      return matchesSearch && matchesCat && matchesStatus
    })
    return matches.sort((a, b) => {
      if (sortOrder === 'name') return (a.name || '').localeCompare(b.name || '')
      if (sortOrder === 'submissions') return (b.submissions || 0) - (a.submissions || 0)
      return new Date(b.updatedAt || b.createdAt || 0) - new Date(a.updatedAt || a.createdAt || 0)
    })
  }, [forms, search, categoryFilter, statusFilter, sortOrder])

  const pageSize = 10
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize))
  const safePage = Math.min(page, totalPages)
  const displayedForms = filtered.slice((safePage - 1) * pageSize, safePage * pageSize)

  const updateView = (mode) => {
    setViewMode(mode)
    try { localStorage.setItem('netflow.forms.view', mode) } catch { /* preference storage unavailable */ }
  }

  const retryForms = async () => {
    setBooting(true)
    setLoadError('')
    try {
      await formsStore.refresh()
    } catch (error) {
      setLoadError(error?.message || 'Forms could not be loaded.')
    } finally {
      setBooting(false)
    }
  }

  const toggleStatus = async (form) => {
    try {
      await formsStore.togglePublished(form.id)
      toast.success(form.status === 'Published' ? 'Form archived' : 'Form published')
    } catch (error) {
      toast.error(error?.message || 'Could not update the form status.')
    }
  }

  const deleteForm = async (form) => {
    const approved = await confirm({
      title: 'Delete form?',
      message: 'This permanently deletes the form and all its submissions. This cannot be undone.',
      confirmLabel: 'Delete',
      danger: true,
    })
    if (!approved) return
    try {
      await formsStore.remove(form.id)
      toast.success('Form deleted')
    } catch (error) {
      toast.error(error?.message || 'Could not delete the form.')
    }
  }

  const published = forms.filter((f) => f.status === 'Published').length
  const drafts = forms.filter((f) => f.status === 'Draft').length
  const totalSubmissions = forms.reduce((sum, f) => sum + (f.submissions || 0), 0)

  const actions = canCreate ? (
    <button
      data-tour="forms-create"
      onClick={() => setNewOpen(true)}
      disabled={readOnly}
      title={readOnly ? 'The workspace licence has expired — new forms are paused.' : undefined}
      className="nf-button nf-button-primary"
    >
      <Plus className="w-4 h-4" aria-hidden="true" />
      Create form
    </button>
  ) : null

  return (
    <AppShell
      title="Forms"
      subtitle="Build, publish, share, and monitor structured intake."
      actions={actions}
      mainClass="flex-1 p-4 md:p-6 pb-24 md:pb-6 overflow-y-auto"
    >
      <div className="nf-forms-admin">
        <div className="nf-forms-metrics">
          <StatCard label="Total forms" value={booting && !forms.length ? '—' : forms.length} hint="Current workspace" icon={FileText} />
          <StatCard label="Published" value={booting && !forms.length ? '—' : published} hint="Ready to collect responses" icon={CheckCircle2} tone="teal" />
          <StatCard label="Drafts" value={booting && !forms.length ? '—' : drafts} hint="Not published" icon={PencilLine} tone="amber" />
          <StatCard label="Submissions" value={booting && !forms.length ? '—' : totalSubmissions} hint="All time" icon={BarChart3} tone="purple" />
        </div>

        <section data-tour="forms-list" className="nf-forms-management-shell">
          <div className="nf-forms-toolbar">
            <div className="nf-forms-toolbar-group">
              <div className="nf-forms-search">
                <SearchIcon />
                <input
                  type="search"
                  value={search}
                  onChange={(event) => { setSearch(event.target.value); setPage(1) }}
                  placeholder="Search by name or description"
                  aria-label="Search forms"
                  className="nf-forms-field"
                />
              </div>
              <select
                value={categoryFilter}
                onChange={(event) => { setCategoryFilter(event.target.value); setPage(1) }}
                aria-label="Filter by category"
                className="nf-forms-select"
              >
                <option>All categories</option>
                {availableCategories.map((category) => (
                  <option key={category}>{category}</option>
                ))}
              </select>
              <select
                value={statusFilter}
                onChange={(event) => { setStatusFilter(event.target.value); setPage(1) }}
                aria-label="Filter by status"
                className="nf-forms-select"
              >
                <option>All statuses</option>
                <option>Published</option>
                <option>Draft</option>
                <option>Archived</option>
              </select>
              <select
                value={sortOrder}
                onChange={(event) => { setSortOrder(event.target.value); setPage(1) }}
                aria-label="Sort forms"
                className="nf-forms-select nf-forms-sort"
              >
                <option value="updated">Recently updated</option>
                <option value="name">Name A–Z</option>
                <option value="submissions">Most submissions</option>
              </select>
            </div>
            <FormsViewToggle value={viewMode} onChange={updateView} />
          </div>

          {loadError && forms.length > 0 && (
            <div className="nf-forms-error" role="alert">
              <AlertTriangle aria-hidden="true" />
              <span>{loadError}</span>
              <button type="button" onClick={retryForms} disabled={booting}>
                <RefreshCw aria-hidden="true" className={booting ? 'animate-spin' : ''} />
                Retry
              </button>
            </div>
          )}

          <div className="nf-forms-results">
            {booting && forms.length === 0 ? (
              viewMode === 'grid' ? (
                <div className="nf-forms-card-grid" aria-label="Loading forms">
                  {Array.from({ length: 6 }).map((_, index) => (
                    <div key={index} className="nf-forms-card nf-forms-skeleton-card">
                      <div className="nf-forms-card-body">
                        <div className="nf-forms-card-head"><Skeleton className="w-9 h-9 rounded-[10px]" /><Skeleton className="h-5 w-20 rounded-full" /></div>
                        <Skeleton className="h-4 w-1/2" />
                        <Skeleton className="mt-2 h-3 w-4/5" />
                        <div className="nf-forms-card-facts"><Skeleton className="h-8 w-20" /><Skeleton className="h-8 w-16" /><Skeleton className="h-8 w-20" /><Skeleton className="h-8 w-24" /></div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="nf-forms-loading-list" aria-label="Loading forms">
                  {Array.from({ length: 6 }).map((_, index) => (
                    <div key={index} className="nf-forms-loading-row">
                      <Skeleton className="w-9 h-9 rounded-[10px] shrink-0" />
                      <div className="flex-1 space-y-2">
                        <Skeleton className="h-3 w-48 max-w-full" />
                        <Skeleton className="h-2.5 w-72 max-w-full" />
                      </div>
                      <Skeleton className="h-5 w-20 rounded-full" />
                    </div>
                  ))}
                </div>
              )
            ) : filtered.length === 0 ? (
              <div className="h-full min-h-[16rem] flex items-center justify-center">
                <EmptyState
                  icon={<IconForm className="w-5 h-5" />}
                  title={loadError && forms.length === 0 ? 'Unable to load forms' : forms.length === 0 ? 'No forms yet' : 'No forms match'}
                  description={
                    loadError && forms.length === 0
                      ? 'No records are shown because the forms service did not respond.'
                      : forms.length === 0
                      ? canCreate
                        ? 'Create a form to start collecting requests and routing approvals.'
                        : 'No forms have been published yet. Ask an Admin or Manager to create one.'
                      : 'Try a different search or clear the filters.'
                  }
                  action={
                    loadError && forms.length === 0 ? (
                      <button type="button" onClick={retryForms} disabled={booting} className="nf-button">
                        <RefreshCw aria-hidden="true" className={`w-4 h-4 ${booting ? 'animate-spin' : ''}`} />
                        Retry
                      </button>
                    ) : forms.length === 0 && canCreate ? (
                      <button
                        type="button"
                        onClick={() => setNewOpen(true)}
                        disabled={readOnly}
                        title={readOnly ? 'The workspace licence has expired — new forms are paused.' : undefined}
                        className="nf-button nf-button-primary"
                      >
                        Create form
                      </button>
                    ) : null
                  }
                />
              </div>
            ) : viewMode === 'grid' ? (
              <div className="nf-forms-card-grid">
                {displayedForms.map((form) => {
                  const isPublished = form.status === 'Published'
                  const canFill = canSubmit && form.fields > 0 && !readOnly
                  return (
                    <article key={form.id} className="nf-forms-card">
                      <div className="nf-forms-card-body">
                        <div className="nf-forms-card-head">
                          <span className={`nf-forms-icon nf-forms-icon-${formIconTone(form.id)}`}>
                            <FormGlyph />
                          </span>
                          <StatusBadge
                            status={form.status}
                            interactive={canCreate}
                            onClick={() => toggleStatus(form)}
                          />
                        </div>
                        <button type="button" className="nf-forms-card-title" onClick={() => navigate(`/forms/${form.id}/edit`)}>
                          {form.name || 'Untitled form'}
                        </button>
                        <p className="nf-forms-card-description">{form.description || 'No description'}</p>
                        <dl className="nf-forms-card-facts">
                          <div><dt>Category</dt><dd>{form.category || '—'}</dd></div>
                          <div><dt>Fields</dt><dd>{form.fields ?? 0}</dd></div>
                          <div><dt>Submissions</dt><dd>{form.submissions ?? 0}</dd></div>
                          <div><dt>Created</dt><dd>{formatDate(form.createdAt)}</dd></div>
                        </dl>
                      </div>
                      <footer className="nf-forms-card-footer">
                        <div className="nf-forms-card-actions">
                          {isPublished && (
                            <>
                              <button
                                type="button"
                                disabled={!canFill}
                                onClick={() => navigate(`/forms/${form.id}/fill`)}
                                className="nf-forms-fill-button"
                                aria-label={`Fill ${form.name}`}
                                title={readOnly ? 'The workspace licence has expired — new responses are paused.' : 'Fill form'}
                              >
                                <FillFormIcon />
                                Fill form
                              </button>
                              <button
                                type="button"
                                onClick={() => form.isPublic ? copyLink(form) : shareForm(form)}
                                className="nf-icon-button"
                                aria-label={form.isPublic ? `Copy public link for ${form.name}` : `Share ${form.name}`}
                                title={form.isPublic ? 'Copy public link' : 'Share form'}
                              >
                                <ShareIcon />
                              </button>
                            </>
                          )}
                          <RowMenu
                            form={form}
                            canCreate={canCreate}
                            canEdit={canEdit}
                            onResponses={() => navigate(`/forms/${form.id}/responses`)}
                            onCopyLink={() => copyLink(form)}
                            onStopSharing={() => stopSharing(form)}
                            onEdit={() => navigate(`/forms/${form.id}/edit`)}
                            onDelete={() => deleteForm(form)}
                          />
                        </div>
                      </footer>
                    </article>
                  )
                })}
              </div>
            ) : (
              <>
                <div className="nf-forms-list-view">
                  <table className="nf-forms-table">
                    <thead>
                      <tr>
                        <th scope="col">Form</th>
                        <th scope="col">Category</th>
                        <th scope="col">Fields</th>
                        <th scope="col">Submissions</th>
                        <th scope="col">Status</th>
                        <th scope="col">Created</th>
                        <th scope="col">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {displayedForms.map((form) => {
                        const primaryHref = canEdit
                          ? `/forms/${form.id}/edit`
                          : canCreate
                            ? `/forms/${form.id}/responses`
                            : null
                        const isPublished = form.status === 'Published'
                        const canFill = canSubmit && form.fields > 0 && !readOnly
                        return (
                          <tr key={form.id}>
                            <td>
                              <div className="nf-forms-cell-main">
                                <span className={`nf-forms-icon nf-forms-icon-${formIconTone(form.id)}`}>
                                  <FormGlyph />
                                </span>
                                <div className="nf-forms-cell-copy">
                                  <button type="button" disabled={!primaryHref} onClick={() => primaryHref && navigate(primaryHref)} className="nf-forms-cell-title">
                                    {form.name || 'Untitled form'}
                                  </button>
                                  <p className="nf-forms-cell-meta">{form.description || 'No description'}</p>
                                </div>
                              </div>
                            </td>
                            <td>{form.category || '—'}</td>
                            <td className="nf-forms-number">{form.fields ?? 0}</td>
                            <td className="nf-forms-number">{form.submissions ?? 0}</td>
                            <td>
                              <StatusBadge
                                status={form.status}
                                interactive={canCreate}
                                onClick={() => toggleStatus(form)}
                              />
                            </td>
                            <td>{formatDate(form.createdAt)}</td>
                            <td>
                              <div className="nf-forms-row-actions">
                                {isPublished && (
                                  <>
                                    <button
                                      type="button"
                                      disabled={!canFill}
                                      onClick={() => navigate(`/forms/${form.id}/fill`)}
                                      className="nf-icon-button"
                                      aria-label={`Fill ${form.name}`}
                                      title={readOnly ? 'The workspace licence has expired — new responses are paused.' : 'Fill form'}
                                    >
                                      <FillFormIcon />
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => form.isPublic ? copyLink(form) : shareForm(form)}
                                      className="nf-icon-button"
                                      aria-label={form.isPublic ? `Copy public link for ${form.name}` : `Share ${form.name}`}
                                      title={form.isPublic ? 'Copy public link' : 'Share form'}
                                    >
                                      <ShareIcon />
                                    </button>
                                  </>
                                )}
                                <RowMenu
                                  form={form}
                                  canCreate={canCreate}
                                  canEdit={canEdit}
                                  onResponses={() => navigate(`/forms/${form.id}/responses`)}
                                  onCopyLink={() => copyLink(form)}
                                  onStopSharing={() => stopSharing(form)}
                                  onEdit={() => navigate(`/forms/${form.id}/edit`)}
                                  onDelete={() => deleteForm(form)}
                                />
                              </div>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
          {filtered.length > 0 && (
            <FormsPagination page={safePage} pageSize={pageSize} total={filtered.length} onPageChange={setPage} />
          )}
        </section>
      </div>
      <NewFormModal open={newOpen} onClose={() => setNewOpen(false)} />
    </AppShell>
  )
}

function Forms() {
  const me = useUser()
  return canCreateForm(me) ? <FormsLibrary /> : <RequestCatalogue />
}

export default Forms
