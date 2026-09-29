import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertTriangle, BarChart3, CheckCircle2, CirclePause, Grid2X2, List, PencilLine, Plus, RefreshCw, Workflow as WorkflowIcon } from 'lucide-react'
import AppShell from '../components/AppShell'
import EmptyState from '../components/EmptyState'
import { Skeleton } from '../components/Skeleton'
import { useWorkflows, workflowsStore } from '../lib/workflowsStore'
import { useDepartmentNames } from '../lib/departmentsStore'
import { useUser } from '../utils/auth'
import { canCreateWorkflow, canEditWorkflow } from '../utils/permissions'
import { confirm } from '../lib/confirmStore'
import { toast } from '../lib/toastStore'
import { useReadOnly } from '../lib/usageStore'
import { useOutsideDismiss } from '../utils/a11y'

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

function SearchIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 text-fg-subtle absolute left-3 top-1/2 -translate-y-1/2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
      <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M17 10a7 7 0 11-14 0 7 7 0 0114 0z" />
    </svg>
  )
}

function WorkflowGlyph({ className = 'w-4 h-4' }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
    </svg>
  )
}

function IconWorkflow(props) {
  return (
    <svg {...props} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
      <circle cx="6" cy="6" r="2.5" />
      <circle cx="18" cy="12" r="2.5" />
      <circle cx="6" cy="18" r="2.5" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M8.5 7.5l7 3.5M8.5 16.5l7-3.5" />
    </svg>
  )
}

function StatusBadge({ status, onClick, interactive }) {
  const tone = status === 'Active' ? 'success' : status === 'Paused' ? 'purple' : status === 'Draft' ? 'warning' : 'neutral'
  const base = `nf-status nf-status-${tone}`
  if (!interactive) {
    return <span className={base}>{status}</span>
  }
  return (
    <button
      type="button"
      onClick={onClick}
      title={status === 'Active' ? 'Pause workflow' : 'Publish workflow'}
      aria-label={`${status === 'Active' ? 'Pause' : 'Publish'} workflow`}
      className={`${base} nf-forms-status-action`}
    >
      {status}
    </button>
  )
}

const WORKFLOW_ICON_TONES = ['blue', 'teal', 'purple', 'amber', 'coral']

function workflowIconTone(id) {
  const value = String(id || 'workflow')
  let hash = 0
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash * 31) + value.charCodeAt(index)) | 0
  }
  return WORKFLOW_ICON_TONES[Math.abs(hash) % WORKFLOW_ICON_TONES.length]
}

function WorkflowsViewToggle({ value, onChange }) {
  return (
    <div className="nf-forms-view-toggle" role="group" aria-label="Workflows layout">
      <button type="button" onClick={() => onChange('list')} className={`nf-forms-view-button ${value === 'list' ? 'is-active' : ''}`} aria-label="List view" aria-pressed={value === 'list'} title="List view">
        <List aria-hidden="true" />
      </button>
      <button type="button" onClick={() => onChange('grid')} className={`nf-forms-view-button ${value === 'grid' ? 'is-active' : ''}`} aria-label="Grid view" aria-pressed={value === 'grid'} title="Grid view">
        <Grid2X2 aria-hidden="true" />
      </button>
    </div>
  )
}

function WorkflowsPagination({ page, pageSize, total, onPageChange }) {
  const pages = Math.max(1, Math.ceil(total / pageSize))
  const safePage = Math.min(Math.max(1, page), pages)
  const from = total === 0 ? 0 : ((safePage - 1) * pageSize) + 1
  const to = Math.min(safePage * pageSize, total)
  return (
    <nav className="nf-forms-pagination" aria-label="Workflows pagination">
      <span>Showing {from}–{to}</span>
      <div className="nf-forms-pagination-actions">
        <button type="button" className="nf-button nf-forms-page-button" disabled={safePage <= 1} onClick={() => onPageChange(safePage - 1)}>Previous</button>
        <button type="button" className="nf-button nf-forms-page-button" disabled={safePage >= pages} onClick={() => onPageChange(safePage + 1)}>Next</button>
      </div>
    </nav>
  )
}

function MetricCard({ label, value, hint, icon: Icon, tone = 'blue' }) {
  return (
    <div className={`nf-forms-metric nf-forms-tone-${tone}`}>
      <div className="nf-forms-metric-top">
        <p className="nf-forms-metric-label">{label}</p>
        <span className="nf-forms-metric-icon"><Icon aria-hidden="true" /></span>
      </div>
      <p className="nf-forms-metric-value">{value}</p>
      <p className="nf-forms-metric-hint">{hint}</p>
    </div>
  )
}

function WorkflowMenu({ workflow, canEdit, canCreate, onEdit, onToggle, onDelete }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  useOutsideDismiss(open, ref, () => setOpen(false))
  const item = 'w-full text-left px-3 py-2 text-sm text-fg hover:bg-surface-2 flex items-center gap-2'
  return (
    <div className="relative" ref={ref}>
      <button type="button" onClick={() => setOpen((current) => !current)} aria-haspopup="menu" aria-expanded={open} aria-label={`More actions for ${workflow.name}`} className="nf-icon-button">
        <svg className="w-[18px] h-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/></svg>
      </button>
      {open && (
        <div role="menu" className="absolute right-0 top-full mt-1 z-30 w-48 rounded-xl border border-line bg-surface py-1 shadow-lg overflow-hidden">
          {canEdit && <button type="button" role="menuitem" className={item} onClick={() => { setOpen(false); onEdit() }}>Edit workflow</button>}
          {canCreate && <button type="button" role="menuitem" className={item} onClick={() => { setOpen(false); onToggle() }}>{workflow.status === 'Active' ? 'Pause workflow' : 'Publish workflow'}</button>}
          {canCreate && <><div className="my-1 border-t border-line"/><button type="button" role="menuitem" className="w-full text-left px-3 py-2 text-sm text-danger-fg hover:bg-danger-subtle" onClick={() => { setOpen(false); onDelete() }}>Delete workflow</button></>}
        </div>
      )}
    </div>
  )
}

function Workflows() {
  const navigate = useNavigate()
  const workflows = useWorkflows()
  const configuredCategories = useDepartmentNames()
  const me = useUser()
  const canCreate = canCreateWorkflow(me)
  const canEdit = canEditWorkflow(me)
  const readOnly = useReadOnly()
  const [search, setSearch] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('All categories')
  const [tagFilter, setTagFilter] = useState(null)
  const [statusFilter, setStatusFilter] = useState('All statuses')
  const [sortOrder, setSortOrder] = useState('updated')
  const [page, setPage] = useState(1)
  const [viewMode, setViewMode] = useState(() => {
    try { return localStorage.getItem('netflow.workflows.view') || 'list' } catch { return 'list' }
  })
  const [booting, setBooting] = useState(true)
  const [loadError, setLoadError] = useState('')
  useEffect(() => {
    let active = true
    workflowsStore.refresh()
      .catch((error) => {
        if (active) setLoadError(error?.message || 'Workflows could not be loaded.')
      })
      .finally(() => {
        if (active) setBooting(false)
      })
    return () => { active = false }
  }, [])

  const categories = useMemo(() => {
    const realCategories = workflows.map((workflow) => workflow.category).filter(Boolean)
    return [...new Set([...configuredCategories, ...realCategories])]
  }, [configuredCategories, workflows])

  // Derive unique tags based on current category filter (before tag filter is applied)
  const uniqueTags = useMemo(() => {
    const categoryMatched = workflows.filter((w) => categoryFilter === 'All categories' || w.category === categoryFilter)
    const tags = new Set()
    for (const w of categoryMatched) {
      if (Array.isArray(w.tags)) {
        for (const t of w.tags) {
          tags.add(t)
        }
      }
    }
    return Array.from(tags).sort()
  }, [workflows, categoryFilter])

  // Reset tag filter if we switch categories and the tag isn't there anymore
  useEffect(() => {
    if (tagFilter && !uniqueTags.includes(tagFilter)) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setTagFilter(null)
    }
  }, [uniqueTags, tagFilter])

  const filtered = useMemo(() => {
    const matches = workflows.filter((w) => {
      const matchesSearch =
        !search.trim() ||
        w.name.toLowerCase().includes(search.toLowerCase()) ||
        (w.description || '').toLowerCase().includes(search.toLowerCase()) ||
        (Array.isArray(w.tags) && w.tags.some(t => t.toLowerCase().includes(search.toLowerCase())))
      const matchesCat = categoryFilter === 'All categories' || w.category === categoryFilter
      const matchesStatus = statusFilter === 'All statuses' || w.status === statusFilter
      const matchesTag = !tagFilter || (Array.isArray(w.tags) && w.tags.includes(tagFilter))
      return matchesSearch && matchesCat && matchesStatus && matchesTag
    })
    return matches.sort((a, b) => {
      if (sortOrder === 'name') return (a.name || '').localeCompare(b.name || '')
      if (sortOrder === 'steps') return (b.steps || 0) - (a.steps || 0)
      return new Date(b.updatedAt || b.createdAt || 0) - new Date(a.updatedAt || a.createdAt || 0)
    })
  }, [workflows, search, categoryFilter, statusFilter, tagFilter, sortOrder])

  const pageSize = 10
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize))
  const safePage = Math.min(page, totalPages)
  const displayedWorkflows = filtered.slice((safePage - 1) * pageSize, safePage * pageSize)

  const updateView = (mode) => {
    setViewMode(mode)
    try { localStorage.setItem('netflow.workflows.view', mode) } catch { /* preference storage unavailable */ }
  }

  const retryWorkflows = async () => {
    setBooting(true)
    setLoadError('')
    try {
      await workflowsStore.refresh()
    } catch (error) {
      setLoadError(error?.message || 'Workflows could not be loaded.')
    } finally {
      setBooting(false)
    }
  }

  const handleToggleStatus = async (w) => {
    if (w.status === 'Active') {
      const ok = await confirm({
        title: 'Deactivate workflow?',
        message: `New submissions won't be routed through "${w.name}" until you activate it again. Runs already in progress continue.`,
        confirmLabel: 'Deactivate',
        danger: true,
      })
      if (!ok) return
    }
    try {
      await workflowsStore.toggleStatus(w.id)
      toast.success(w.status === 'Active' ? 'Workflow deactivated' : 'Workflow activated')
    } catch (err) {
      toast.error(err.message || 'Could not change the workflow status')
    }
  }

  const handleDelete = async (w) => {
    const ok = await confirm({
      title: 'Delete workflow?',
      message: 'This permanently deletes the workflow and its runs and tasks. This cannot be undone.',
      confirmLabel: 'Delete',
      danger: true,
    })
    if (!ok) return
    try {
      await workflowsStore.remove(w.id)
      toast.success('Workflow deleted')
    } catch (err) {
      toast.error(err.message || 'Could not delete workflow')
    }
  }

  const activeCount = workflows.filter((workflow) => workflow.status === 'Active').length
  const draftCount = workflows.filter((workflow) => workflow.status === 'Draft').length
  const pausedCount = workflows.filter((workflow) => workflow.status === 'Paused').length

  const actions = canCreate ? (
    <button
      data-tour="workflows-create"
      onClick={() => navigate('/workflows/new')}
      disabled={readOnly}
      title={readOnly ? 'The workspace licence has expired — new workflows are paused.' : undefined}
      className="nf-button nf-button-primary"
    >
      <Plus className="w-4 h-4" aria-hidden="true" />
      New workflow
    </button>
  ) : null

  return (
    <AppShell
      title="Workflows"
      subtitle="Build visible, governed paths for approvals, reviews, notifications, and integrations."
      actions={actions}
      mainClass="flex-1 p-4 md:p-6 pb-24 md:pb-6 overflow-y-auto"
    >
      <div className="nf-workflows-admin">
        <div className="nf-forms-metrics">
          <MetricCard label="Total workflows" value={booting && !workflows.length ? '—' : workflows.length} hint="Current workspace" icon={WorkflowIcon} />
          <MetricCard label="Active" value={booting && !workflows.length ? '—' : activeCount} hint="Currently routing work" icon={CheckCircle2} tone="teal" />
          <MetricCard label="Drafts" value={booting && !workflows.length ? '—' : draftCount} hint="Not published" icon={PencilLine} tone="amber" />
          <MetricCard label="Paused" value={booting && !workflows.length ? '—' : pausedCount} hint="Temporarily inactive" icon={CirclePause} tone="purple" />
        </div>

        <section data-tour="workflows-list" className="nf-forms-management-shell">
          <div className="nf-forms-toolbar">
            <div className="nf-forms-toolbar-group">
              <div className="nf-forms-search">
                <SearchIcon />
                <input
                  type="search"
                  value={search}
                  onChange={(event) => { setSearch(event.target.value); setPage(1) }}
                  placeholder="Search by name or description"
                  aria-label="Search workflows"
                  className="nf-forms-field"
                />
              </div>
              <select
                value={categoryFilter}
                onChange={(event) => { setCategoryFilter(event.target.value); setTagFilter(null); setPage(1) }}
                aria-label="Filter workflows by category"
                className="nf-forms-select"
              >
                <option>All categories</option>
                {categories.map((category) => <option key={category}>{category}</option>)}
              </select>
              <select
                value={statusFilter}
                onChange={(event) => { setStatusFilter(event.target.value); setPage(1) }}
                aria-label="Filter workflows by status"
                className="nf-forms-select"
              >
                <option>All statuses</option>
                <option>Active</option>
                <option>Draft</option>
                <option>Paused</option>
                <option>Archived</option>
              </select>
              {uniqueTags.length > 0 && (
                <select
                  value={tagFilter || ''}
                  onChange={(event) => { setTagFilter(event.target.value || null); setPage(1) }}
                  aria-label="Filter workflows by tag"
                  className="nf-forms-select"
                >
                  <option value="">All tags</option>
                  {uniqueTags.map((tag) => <option key={tag} value={tag}>#{tag}</option>)}
                </select>
              )}
              <select
                value={sortOrder}
                onChange={(event) => { setSortOrder(event.target.value); setPage(1) }}
                aria-label="Sort workflows"
                className="nf-forms-select nf-forms-sort"
              >
                <option value="updated">Recently updated</option>
                <option value="name">Name A–Z</option>
                <option value="steps">Most steps</option>
              </select>
            </div>
            <WorkflowsViewToggle value={viewMode} onChange={updateView} />
          </div>

          {loadError && workflows.length > 0 && (
            <div className="nf-forms-error" role="alert">
              <AlertTriangle aria-hidden="true" />
              <span>{loadError}</span>
              <button type="button" onClick={retryWorkflows} disabled={booting}>
                <RefreshCw aria-hidden="true" className={booting ? 'animate-spin' : ''} />
                Retry
              </button>
            </div>
          )}

          <div className="nf-forms-results">
              {booting && workflows.length === 0 ? (
                viewMode === 'grid' ? (
                  <div className="nf-forms-card-grid" aria-label="Loading workflows">
                    {Array.from({ length: 6 }).map((_, index) => (
                      <div key={index} className="nf-forms-card nf-forms-skeleton-card">
                        <div className="nf-forms-card-body">
                          <div className="nf-forms-card-head"><Skeleton className="w-9 h-9 rounded-[10px]" /><Skeleton className="h-5 w-20 rounded-full" /></div>
                          <Skeleton className="h-4 w-1/2" />
                          <Skeleton className="mt-2 h-3 w-4/5" />
                          <div className="nf-forms-card-facts"><Skeleton className="h-8 w-20" /><Skeleton className="h-8 w-16" /><Skeleton className="h-8 w-24" /><Skeleton className="h-8 w-20" /></div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="nf-forms-loading-list" aria-label="Loading workflows">
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
                    icon={<IconWorkflow className="w-5 h-5" />}
                    title={loadError && workflows.length === 0 ? 'Unable to load workflows' : workflows.length === 0 ? 'No workflows yet' : 'No workflows match'}
                    description={
                      loadError && workflows.length === 0
                        ? 'No records are shown because the workflows service did not respond.'
                        : workflows.length === 0
                        ? canCreate
                          ? 'Create a workflow to route form submissions through approvals and automations.'
                          : 'No workflows have been published yet. Ask an Admin or Manager to create one.'
                        : 'Try a different search or clear the filters.'
                    }
                    action={
                      loadError && workflows.length === 0 ? (
                        <button type="button" onClick={retryWorkflows} disabled={booting} className="nf-button">
                          <RefreshCw aria-hidden="true" className={`w-4 h-4 ${booting ? 'animate-spin' : ''}`} />
                          Retry
                        </button>
                      ) : workflows.length === 0 && canCreate ? (
                        <button
                          type="button"
                          onClick={() => navigate('/workflows/new')}
                          disabled={readOnly}
                          title={readOnly ? 'The workspace licence has expired — new workflows are paused.' : undefined}
                          className="nf-button nf-button-primary"
                        >
                          Create workflow
                        </button>
                      ) : null
                    }
                  />
                </div>
              ) : viewMode === 'grid' ? (
                <div className="nf-forms-card-grid">
                  {displayedWorkflows.map((workflow) => {
                    const isActive = workflow.status === 'Active'
                    return (
                      <article key={workflow.id} className="nf-forms-card">
                        <div className="nf-forms-card-body">
                          <div className="nf-forms-card-head">
                            <span className={`nf-forms-icon nf-forms-icon-${workflowIconTone(workflow.id)}`}>
                              <WorkflowGlyph />
                            </span>
                            <StatusBadge status={workflow.status} interactive={canCreate} onClick={() => handleToggleStatus(workflow)} />
                          </div>
                          <button type="button" disabled={!canEdit} className="nf-forms-card-title" onClick={() => canEdit && navigate(`/workflows/${workflow.id}/edit`)}>
                            {workflow.name || 'Untitled workflow'}
                          </button>
                          <p className="nf-forms-card-description">{workflow.description || 'No description'}</p>
                          <dl className="nf-forms-card-facts">
                            <div><dt>Category</dt><dd>{workflow.category || '—'}</dd></div>
                            <div><dt>Steps</dt><dd>{workflow.steps ?? 0}</dd></div>
                            <div><dt>Tags</dt><dd>{workflow.tags?.length ? workflow.tags.slice(0, 2).join(', ') : '—'}</dd></div>
                            <div><dt>Created</dt><dd>{formatDate(workflow.createdAt)}</dd></div>
                          </dl>
                        </div>
                        <footer className="nf-forms-card-footer">
                          <div className="nf-forms-card-actions">
                            {isActive && (
                              <button type="button" onClick={() => navigate('/analytics')} className="nf-forms-fill-button" aria-label={`View runs for ${workflow.name}`}>
                                <BarChart3 aria-hidden="true" className="w-4 h-4" />
                                View runs
                              </button>
                            )}
                            <WorkflowMenu workflow={workflow} canEdit={canEdit} canCreate={canCreate} onEdit={() => navigate(`/workflows/${workflow.id}/edit`)} onToggle={() => handleToggleStatus(workflow)} onDelete={() => handleDelete(workflow)} />
                          </div>
                        </footer>
                      </article>
                    )
                  })}
                </div>
              ) : (
                <>
                  <div className="nf-forms-list-view pb-32">
                    <table className="nf-forms-table nf-forms-catalogue-table">
                      <thead>
                        <tr>
                          <th scope="col">Workflow</th>
                          <th scope="col">Category</th>
                          <th scope="col">Steps</th>
                          <th scope="col">Status</th>
                          <th scope="col">Created</th>
                          <th scope="col">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {displayedWorkflows.map((workflow) => {
                          const isActive = workflow.status === 'Active'
                          return (
                            <tr key={workflow.id}>
                              <td>
                                <div className="nf-forms-cell-main">
                                  <span className={`nf-forms-icon nf-forms-icon-${workflowIconTone(workflow.id)}`}>
                                    <WorkflowGlyph />
                                  </span>
                                  <div className="nf-forms-cell-copy">
                                    <button type="button" disabled={!canEdit} onClick={() => canEdit && navigate(`/workflows/${workflow.id}/edit`)} className="nf-forms-cell-title">
                                      {workflow.name || 'Untitled workflow'}
                                    </button>
                                    <p className="nf-forms-cell-meta">{workflow.description || 'No description'}</p>
                                  </div>
                                </div>
                              </td>
                              <td>{workflow.category || '—'}</td>
                              <td className="nf-forms-number">{workflow.steps ?? 0}</td>
                              <td><StatusBadge status={workflow.status} interactive={canCreate} onClick={() => handleToggleStatus(workflow)} /></td>
                              <td>{formatDate(workflow.createdAt)}</td>
                              <td>
                                <div className="nf-forms-row-actions">
                                  {isActive && (
                                    <button type="button" onClick={() => navigate('/analytics')} className="nf-icon-button" aria-label={`View runs for ${workflow.name}`} title="View runs">
                                      <BarChart3 aria-hidden="true" className="w-4 h-4" />
                                    </button>
                                  )}
                                  {(canEdit || canCreate) && <WorkflowMenu workflow={workflow} canEdit={canEdit} canCreate={canCreate} onEdit={() => navigate(`/workflows/${workflow.id}/edit`)} onToggle={() => handleToggleStatus(workflow)} onDelete={() => handleDelete(workflow)} />}
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
            {!booting && filtered.length > 0 && (
              <WorkflowsPagination page={safePage} pageSize={pageSize} total={filtered.length} onPageChange={setPage} />
            )}
        </section>
      </div>
    </AppShell>
  )
}

export default Workflows
