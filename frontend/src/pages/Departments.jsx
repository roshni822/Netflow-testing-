import React, { useMemo, useState } from 'react'
import {
  AlertTriangle,
  Building2,
  Eye,
  Grid2X2,
  List,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  UserMinus,
  Users,
} from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import AppShell from '../components/AppShell'
import EmptyState from '../components/EmptyState'
import Modal from '../components/Modal'
import { AlertBanner } from '../components/Alert'
import { Skeleton } from '../components/Skeleton'
import { toast } from '../lib/toastStore'
import { confirm } from '../lib/confirmStore'
import { departmentsStore, useDepartmentsState } from '../lib/departmentsStore'
import { useReadOnly } from '../lib/usageStore'

const DEPARTMENT_TONES = ['blue', 'teal', 'purple', 'amber', 'coral']

function toneFor(value) {
  let hash = 0
  for (const character of String(value || 'department')) hash = ((hash * 31) + character.charCodeAt(0)) | 0
  return DEPARTMENT_TONES[Math.abs(hash) % DEPARTMENT_TONES.length]
}

function Metric({ label, value, hint, icon: Icon, tone = 'blue' }) {
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

function LayoutToggle({ value, onChange }) {
  return (
    <div className="nf-forms-view-toggle" role="group" aria-label="Departments layout">
      <button type="button" onClick={() => onChange('list')} className={`nf-forms-view-button ${value === 'list' ? 'is-active' : ''}`} aria-label="List view" aria-pressed={value === 'list'} title="List view"><List aria-hidden="true" /></button>
      <button type="button" onClick={() => onChange('grid')} className={`nf-forms-view-button ${value === 'grid' ? 'is-active' : ''}`} aria-label="Grid view" aria-pressed={value === 'grid'} title="Grid view"><Grid2X2 aria-hidden="true" /></button>
    </div>
  )
}

function CataloguePagination({ page, pageSize, total, onPageChange }) {
  const pages = Math.max(1, Math.ceil(total / pageSize))
  const safePage = Math.min(Math.max(1, page), pages)
  const from = total === 0 ? 0 : ((safePage - 1) * pageSize) + 1
  const to = Math.min(safePage * pageSize, total)
  return (
    <nav className="nf-forms-pagination" aria-label="Departments pagination">
      <span>Showing {from}–{to}</span>
      <div className="nf-forms-pagination-actions">
        <button type="button" className="nf-button nf-forms-page-button" disabled={safePage <= 1} onClick={() => onPageChange(safePage - 1)}>Previous</button>
        <button type="button" className="nf-button nf-forms-page-button" disabled={safePage >= pages} onClick={() => onPageChange(safePage + 1)}>Next</button>
      </div>
    </nav>
  )
}

function DepartmentDialog({ mode, initial = '', onClose, onSaved }) {
  const [name, setName] = useState(initial)
  const [saving, setSaving] = useState(false)
  const isRename = mode === 'rename'
  const submit = async (event) => {
    event.preventDefault()
    const clean = name.trim()
    if (!clean) return toast.error('Enter a department name')
    setSaving(true)
    try {
      await (isRename ? departmentsStore.rename(initial, clean) : departmentsStore.create(clean))
      toast.success(isRename ? `Department renamed to "${clean}"` : `"${clean}" added`)
      onSaved()
    } catch (error) {
      toast.error(error.message || 'Could not save the department')
    } finally {
      setSaving(false)
    }
  }
  return (
    <Modal onClose={onClose} title={isRename ? 'Edit department' : 'New department'} description={isRename ? 'Update the department name everywhere it is used.' : 'Create a team for access, routing, and reporting.'}>
      <form onSubmit={submit} className="space-y-4">
        <label className="block text-xs font-semibold text-fg-muted">Department name<input autoFocus value={name} onChange={(event) => setName(event.target.value)} maxLength={40} placeholder="Customer Support" className="nf-field mt-1.5" /></label>
        <div className="flex justify-end gap-2"><button type="button" onClick={onClose} className="nf-button">Cancel</button><button type="submit" disabled={saving} className="nf-button nf-button-primary disabled:opacity-60">{saving ? 'Saving...' : isRename ? 'Save changes' : 'Create department'}</button></div>
      </form>
    </Modal>
  )
}

export default function Departments() {
  const navigate = useNavigate()
  const { departments, orphans, loading, error } = useDepartmentsState()
  const readOnly = useReadOnly()
  const [dialog, setDialog] = useState(null)
  const [busy, setBusy] = useState('')
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [sort, setSort] = useState('name')
  const [page, setPage] = useState(1)
  const [view, setView] = useState(() => { try { return localStorage.getItem('netflow.departments.view') || 'list' } catch { return 'list' } })
  const pageSize = 10

  const results = useMemo(() => departments
    .filter((department) => department.name.toLowerCase().includes(search.trim().toLowerCase()))
    .filter((department) => statusFilter === 'all' || (statusFilter === 'used' ? department.members > 0 : department.members === 0))
    .sort((a, b) => sort === 'members' ? b.members - a.members : a.name.localeCompare(b.name)), [departments, search, statusFilter, sort])
  const safePage = Math.min(page, Math.max(1, Math.ceil(results.length / pageSize)))
  const displayed = results.slice((safePage - 1) * pageSize, safePage * pageSize)
  const stats = useMemo(() => ({
    members: departments.reduce((sum, department) => sum + Number(department.members || 0), 0),
    empty: departments.filter((department) => Number(department.members || 0) === 0).length,
  }), [departments])

  const updateView = (next) => {
    setView(next)
    try { localStorage.setItem('netflow.departments.view', next) } catch { /* optional preference */ }
  }
  const remove = async (department) => {
    if (department.members > 0) return toast.error(`Move all ${department.members} active members before deleting this department`)
    if (departments.length === 1) return toast.error('A workspace needs at least one department')
    const accepted = await confirm({ title: `Delete "${department.name}"?`, message: 'The department will disappear from pickers. Existing history keeps its original value.', confirmLabel: 'Delete', danger: true })
    if (!accepted) return
    setBusy(department.name)
    try { await departmentsStore.remove(department.name); toast.success('Department deleted') }
    catch (cause) { toast.error(cause.message || 'Could not delete the department') }
    finally { setBusy('') }
  }
  const adopt = async (name) => {
    setBusy(name)
    try { await departmentsStore.create(name); toast.success(`"${name}" restored`) }
    catch (cause) { toast.error(cause.message || 'Could not restore the department') }
    finally { setBusy('') }
  }
  const actions = (department, card = false) => (
    <div className={card ? 'nf-forms-card-actions' : 'nf-forms-row-actions'}>
      {card ? (
        <button type="button" className="nf-forms-fill-button" onClick={() => navigate(`/admin?department=${encodeURIComponent(department.name)}`)}><Users aria-hidden="true" className="w-4 h-4" />View members</button>
      ) : (
        <button type="button" className="nf-icon-button" title="View members" aria-label={`View ${department.name} members`} onClick={() => navigate(`/admin?department=${encodeURIComponent(department.name)}`)}><Eye className="w-4 h-4" /></button>
      )}
      <button type="button" className="nf-icon-button" title="Edit department" aria-label={`Edit ${department.name}`} disabled={readOnly || busy === department.name} onClick={() => setDialog({ mode: 'rename', initial: department.name })}><Pencil className="w-4 h-4" /></button>
      <button type="button" className="nf-icon-button hover:text-danger-fg" title="Delete department" aria-label={`Delete ${department.name}`} disabled={readOnly || busy === department.name || departments.length === 1 || department.members > 0} onClick={() => remove(department)}><Trash2 className="w-4 h-4" /></button>
    </div>
  )

  return (
    <AppShell title="Departments" subtitle="Manage teams used for access, workflow routing, and reporting." actions={<button type="button" disabled={readOnly} onClick={() => setDialog({ mode: 'create' })} className="nf-button nf-button-primary"><Plus className="w-4 h-4" />New department</button>} mainClass="flex-1 p-4 md:p-6 pb-24 md:pb-6 overflow-y-auto">
      <div className="nf-forms-admin nf-departments-admin">
        <div className="nf-forms-metrics">
          <Metric label="Departments" value={loading && !departments.length ? '—' : departments.length} hint="Configured teams" icon={Building2} />
          <Metric label="Active members" value={loading && !departments.length ? '—' : stats.members} hint="Across listed departments" icon={Users} tone="teal" />
          <Metric label="Empty teams" value={loading && !departments.length ? '—' : stats.empty} hint="No active members" icon={UserMinus} tone="amber" />
          <Metric label="Unlisted" value={loading && !departments.length ? '—' : orphans.length} hint="Legacy teams to review" icon={AlertTriangle} tone="purple" />
        </div>

        {orphans.length > 0 && <AlertBanner tone="warning" className="mt-[18px]"><strong>Unlisted departments:</strong> {orphans.map((orphan, index) => <React.Fragment key={orphan.name}>{index ? ', ' : ''}<button type="button" disabled={busy === orphan.name || readOnly} onClick={() => adopt(orphan.name)} className="underline">{orphan.name} ({orphan.members})</button></React.Fragment>)}. Restore one or move its members from Users.</AlertBanner>}

        <section className="nf-forms-management-shell">
          <div className="nf-forms-toolbar">
            <div className="nf-forms-toolbar-group">
              <label className="nf-forms-search"><Search aria-hidden="true" className="w-4 h-4 text-fg-subtle absolute left-3 top-1/2 -translate-y-1/2" /><input type="search" value={search} onChange={(event) => { setSearch(event.target.value); setPage(1) }} placeholder="Search departments" aria-label="Search departments" className="nf-forms-field" /></label>
              <select value={statusFilter} onChange={(event) => { setStatusFilter(event.target.value); setPage(1) }} className="nf-forms-select" aria-label="Filter departments"><option value="all">All departments</option><option value="used">In use</option><option value="empty">Empty</option></select>
              <select value={sort} onChange={(event) => { setSort(event.target.value); setPage(1) }} className="nf-forms-select nf-forms-sort" aria-label="Sort departments"><option value="name">Name A–Z</option><option value="members">Most members</option></select>
            </div>
            <LayoutToggle value={view} onChange={updateView} />
          </div>

          {error && departments.length > 0 && <div className="nf-forms-error" role="alert"><AlertTriangle aria-hidden="true" /><span>{error}</span><button type="button" onClick={() => departmentsStore.refresh()} disabled={loading}><RefreshCw aria-hidden="true" className={loading ? 'animate-spin' : ''} />Retry</button></div>}

          <div className="nf-forms-results">
            {loading && departments.length === 0 ? (
              view === 'grid' ? <div className="nf-forms-card-grid" aria-label="Loading departments">{Array.from({ length: 6 }).map((_, index) => <div key={index} className="nf-forms-card nf-forms-skeleton-card"><div className="nf-forms-card-body"><div className="nf-forms-card-head"><Skeleton className="w-9 h-9 rounded-[10px]" /><Skeleton className="h-5 w-16 rounded-full" /></div><Skeleton className="h-4 w-1/2" /><Skeleton className="mt-2 h-3 w-4/5" /><div className="nf-forms-card-facts"><Skeleton className="h-8 w-20" /><Skeleton className="h-8 w-20" /></div></div></div>)}</div>
              : <div className="nf-forms-loading-list" aria-label="Loading departments">{Array.from({ length: 6 }).map((_, index) => <div key={index} className="nf-forms-loading-row"><Skeleton className="w-9 h-9 rounded-[10px] shrink-0" /><div className="flex-1 space-y-2"><Skeleton className="h-3 w-48 max-w-full" /><Skeleton className="h-2.5 w-72 max-w-full" /></div><Skeleton className="h-5 w-20 rounded-full" /></div>)}</div>
            ) : results.length === 0 ? (
              <div className="min-h-[16rem] flex items-center justify-center"><EmptyState icon={<Building2 className="w-5 h-5" />} title={error && departments.length === 0 ? 'Unable to load departments' : departments.length ? 'No matching departments' : 'No departments yet'} description={error && departments.length === 0 ? 'No records are shown because the departments service did not respond.' : departments.length ? 'Try another search or clear the filter.' : 'Create the first team used by your organization.'} action={error && departments.length === 0 ? <button type="button" className="nf-button" onClick={() => departmentsStore.refresh()}><RefreshCw className="w-4 h-4" />Retry</button> : null} /></div>
            ) : view === 'grid' ? (
              <div className="nf-forms-card-grid">{displayed.map((department) => <article key={department.name} className="nf-forms-card"><div className="nf-forms-card-body"><div className="nf-forms-card-head"><span className={`nf-forms-icon nf-forms-icon-${toneFor(department.name)}`}><Building2 aria-hidden="true" /></span><span className={`nf-status ${department.members > 0 ? 'nf-status-success' : 'nf-status-neutral'}`}>{department.members > 0 ? 'In use' : 'Empty'}</span></div><h2 className="nf-forms-card-title">{department.name}</h2><p className="nf-forms-card-description">Used for membership, visibility, workflow routing, and reporting.</p><dl className="nf-forms-card-facts"><div><dt>Active members</dt><dd>{department.members.toLocaleString()}</dd></div><div><dt>Status</dt><dd>{department.members > 0 ? 'In use' : 'Empty'}</dd></div></dl></div><footer className="nf-forms-card-footer">{actions(department, true)}</footer></article>)}</div>
            ) : (
              <div className="nf-forms-list-view"><table className="nf-forms-table nf-departments-table"><thead><tr><th scope="col">Department</th><th scope="col">Active members</th><th scope="col">Status</th><th scope="col">Actions</th></tr></thead><tbody>{displayed.map((department) => <tr key={department.name}><td><div className="nf-forms-cell-main"><span className={`nf-forms-icon nf-forms-icon-${toneFor(department.name)}`}><Building2 aria-hidden="true" /></span><div className="nf-forms-cell-copy"><strong className="nf-forms-cell-title">{department.name}</strong><p className="nf-forms-cell-meta">Access, routing, and reporting</p></div></div></td><td className="nf-forms-number">{department.members.toLocaleString()}</td><td><span className={`nf-status ${department.members > 0 ? 'nf-status-success' : 'nf-status-neutral'}`}>{department.members > 0 ? 'In use' : 'Empty'}</span></td><td>{actions(department)}</td></tr>)}</tbody></table></div>
            )}
          </div>
          {!loading && results.length > 0 && <CataloguePagination page={safePage} pageSize={pageSize} total={results.length} onPageChange={setPage} />}
        </section>
      </div>
      {dialog && <DepartmentDialog mode={dialog.mode} initial={dialog.initial || ''} onClose={() => setDialog(null)} onSaved={() => setDialog(null)} />}
    </AppShell>
  )
}
