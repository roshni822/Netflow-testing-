import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router-dom'
import {
  AlertTriangle,
  Check,
  Eye,
  FileText,
  LockKeyhole,
  MoreHorizontal,
  Minus,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Trash2,
  Users,
} from 'lucide-react'
import AppShell from '../components/AppShell'
import EmptyState from '../components/EmptyState'
import Modal from '../components/Modal'
import { Skeleton } from '../components/Skeleton'
import { StatusBadge } from '../components/NetFlowUI'
import { api } from '../utils/api'
import { authStore } from '../utils/auth'
import { confirm } from '../lib/confirmStore'
import { toast } from '../lib/toastStore'
import { useReadOnly } from '../lib/usageStore'

const ROLE_TONES = ['blue', 'teal', 'purple', 'amber', 'coral']
function toneFor(value) {
  let hash = 0
  for (const character of String(value || 'role')) hash = ((hash * 31) + character.charCodeAt(0)) | 0
  return ROLE_TONES[Math.abs(hash) % ROLE_TONES.length]
}

function Metric({ label, value, hint, icon: Icon, tone = 'blue' }) {
  return (
    <div className={`nf-forms-metric nf-forms-tone-${tone}`}>
      <div className="nf-forms-metric-top"><p className="nf-forms-metric-label">{label}</p><span className="nf-forms-metric-icon"><Icon aria-hidden="true" /></span></div>
      <p className="nf-forms-metric-value">{value}</p>
      {hint ? <p className="nf-forms-metric-hint">{hint}</p> : null}
    </div>
  )
}

function CataloguePagination({ page, pageSize, total, onPageChange }) {
  const pages = Math.max(1, Math.ceil(total / pageSize))
  const safePage = Math.min(Math.max(1, page), pages)
  const from = total === 0 ? 0 : ((safePage - 1) * pageSize) + 1
  const to = Math.min(safePage * pageSize, total)
  return <nav className="nf-forms-pagination" aria-label="Roles pagination"><span>Showing {from}–{to} of {total} roles</span><div className="nf-forms-pagination-actions"><button type="button" className="nf-button nf-forms-page-button" disabled={safePage <= 1} onClick={() => onPageChange(safePage - 1)}>Previous</button><button type="button" className="nf-button nf-forms-page-button" disabled={safePage >= pages} onClick={() => onPageChange(safePage + 1)}>Next</button></div></nav>
}

const ROLE_MENU_WIDTH = 184
const ROLE_MENU_GAP = 6
const ROLE_MENU_EDGE = 8

function roleMenuPosition(anchor, menuHeight = 96) {
  const rect = anchor.getBoundingClientRect()
  const spaceBelow = window.innerHeight - rect.bottom - ROLE_MENU_EDGE
  const openAbove = spaceBelow < menuHeight + ROLE_MENU_GAP && rect.top > spaceBelow
  const top = openAbove
    ? Math.max(ROLE_MENU_EDGE, rect.top - menuHeight - ROLE_MENU_GAP)
    : Math.min(window.innerHeight - menuHeight - ROLE_MENU_EDGE, rect.bottom + ROLE_MENU_GAP)
  const left = Math.max(
    ROLE_MENU_EDGE,
    Math.min(window.innerWidth - ROLE_MENU_WIDTH - ROLE_MENU_EDGE, rect.right - ROLE_MENU_WIDTH)
  )
  return { top: Math.max(ROLE_MENU_EDGE, top), left, placement: openAbove ? 'top' : 'bottom' }
}

function RoleActionMenu({ role, readOnly, deleteDisabled, deleteTitle, onEdit, onDelete }) {
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState({ top: 0, left: 0, placement: 'bottom' })
  const triggerRef = useRef(null)
  const menuRef = useRef(null)
  const menuId = useId()

  useEffect(() => {
    if (!open) return undefined

    const reposition = () => {
      if (!triggerRef.current) return
      setPosition(roleMenuPosition(triggerRef.current, menuRef.current?.offsetHeight || 96))
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
      menuRef.current?.querySelector('[role="menuitem"]:not(:disabled)')?.focus()
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

  const close = (handler) => () => {
    setOpen(false)
    triggerRef.current?.focus()
    handler()
  }
  const toggleMenu = () => {
    if (open) return setOpen(false)
    if (triggerRef.current) setPosition(roleMenuPosition(triggerRef.current))
    setOpen(true)
  }
  const item = 'w-full text-left px-3 py-2 text-sm text-fg hover:bg-surface-2 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2'
  const danger = 'w-full text-left px-3 py-2 text-sm text-danger-fg hover:bg-danger-subtle disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2'

  return (
    <div className="relative">
      <button ref={triggerRef} type="button" className="nf-icon-button nf-forms-more-button" onClick={toggleMenu} aria-haspopup="menu" aria-expanded={open} aria-controls={open ? menuId : undefined} aria-label={`More actions for ${role.name}`}>
        <MoreHorizontal aria-hidden="true" className="w-4 h-4" />
      </button>
      {open && typeof document !== 'undefined' && createPortal(
        <div id={menuId} ref={menuRef} role="menu" aria-label={`Actions for ${role.name}`} data-placement={position.placement} className="nf-forms-row-menu nf-roles-action-menu" style={{ top: position.top, left: position.left }}>
          <button type="button" role="menuitem" className={item} disabled={readOnly} title={readOnly ? 'The workspace licence is read-only' : 'Edit role'} onClick={close(onEdit)}><Pencil aria-hidden="true" className="w-4 h-4" />Edit role</button>
          <button type="button" role="menuitem" className={danger} disabled={deleteDisabled} title={deleteTitle} aria-label={deleteDisabled ? `Delete ${role.name}: ${deleteTitle}` : `Delete ${role.name}`} onClick={close(onDelete)}><Trash2 aria-hidden="true" className="w-4 h-4" />Delete role</button>
        </div>,
        document.body
      )}
    </div>
  )
}

function PermissionList({ role, capabilities }) {
  return <ul className="space-y-2">{capabilities.map((capability) => { const allowed = role.capabilities.includes(capability.key); return <li key={capability.key} className="rounded-[10px] border border-line p-3 flex items-start gap-3"><span className={`mt-0.5 w-5 h-5 rounded-full inline-flex items-center justify-center shrink-0 ${allowed ? 'bg-success-subtle text-success-fg' : 'bg-surface-3 text-fg-subtle'}`}>{allowed ? <Check className="w-3.5 h-3.5" /> : <Minus className="w-3.5 h-3.5" />}</span><div><strong className="block text-sm text-fg">{capability.label}</strong>{capability.description && <p className="mt-0.5 text-xs text-fg-muted">{capability.description}</p>}</div><span className="ml-auto"><StatusBadge tone={allowed ? 'success' : 'neutral'}>{allowed ? 'Allowed' : 'Not allowed'}</StatusBadge></span></li> })}</ul>
}

export default function RolesPermissions() {
  const readOnly = useReadOnly()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState('all')
  const [page, setPage] = useState(1)
  const [selectedRole, setSelectedRole] = useState(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [editingRole, setEditingRole] = useState(null)
  const [saving, setSaving] = useState(false)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [selectedCapabilities, setSelectedCapabilities] = useState([])
  const pageSize = 10

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const summary = await api.get('/api/roles/summary')
      setData(summary)
    }
    catch (cause) { setError(cause.message || 'Could not load roles') }
    finally { setLoading(false) }
  }, [])
  useEffect(() => {
    const timer = window.setTimeout(load, 0)
    return () => window.clearTimeout(timer)
  }, [load])

  const roles = useMemo(() => data?.roles || [], [data])
  const capabilities = useMemo(() => data?.capabilities || [], [data])
  const seats = data?.builderSeats
  const filtered = useMemo(() => roles
    .filter((role) => `${role.name} ${role.description || ''}`.toLowerCase().includes(search.trim().toLowerCase()))
    .filter((role) => typeFilter === 'all' || (typeFilter === 'system' ? role.system : !role.system))
    .sort((a, b) => a.name.localeCompare(b.name)), [roles, search, typeFilter])
  const safePage = Math.min(page, Math.max(1, Math.ceil(filtered.length / pageSize)))
  const displayed = filtered.slice((safePage - 1) * pageSize, safePage * pageSize)

  const totals = useMemo(() => ({
    people: roles.reduce((sum, role) => sum + Number(role.members || 0), 0),
    builders: roles.reduce((sum, role) => sum + Number(role.builders || 0), 0),
  }), [roles])
  const builderSeatValue = useMemo(() => {
    if (!data) return '—'
    const used = Number(seats?.used ?? totals.builders)
    const limit = Number(seats?.limit || 0)
    return limit > 0 ? `${used} of ${limit}` : `${used} used`
  }, [data, seats, totals.builders])
  const builderSeatHint = !data ? null : Number(seats?.limit || 0) > 0 ? 'Used seats' : 'Unlimited'

  const remove = async (role) => {
    if (readOnly || role.protected || role.members || role.workflowReferences) return
    const accepted = await confirm({ title: `Delete "${role.name}"?`, message: 'This permanently removes the role and cannot be undone.', confirmLabel: 'Delete', danger: true })
    if (!accepted) return
    try {
      await api.delete(`/api/roles/${role._id}`)
      toast.success('Role deleted')
      load()
    }
    catch (cause) { toast.error(cause.message || 'Could not delete role') }
  }

  const openCreate = () => {
    if (readOnly) return
    setEditingRole(null)
    setName('')
    setDescription('')
    setSelectedCapabilities([])
    setCreateOpen(true)
  }

  const openEdit = (role) => {
    if (readOnly || role.protected) return
    setEditingRole(role)
    setName(role.name)
    setDescription(role.description || '')
    setSelectedCapabilities([...role.capabilities])
    setCreateOpen(false)
  }

  const closeEditor = () => {
    if (saving) return
    setCreateOpen(false)
    setEditingRole(null)
  }

  const saveRole = async (event) => {
    event.preventDefault()
    if (!name.trim()) return toast.error('Enter a role name')
    setSaving(true)
    try {
      const payload = { name: name.trim(), description: description.trim(), capabilities: selectedCapabilities }
      if (editingRole) {
        await api.put(`/api/roles/${editingRole._id}`, payload)
        toast.success('Role updated')
      } else {
        await api.post('/api/roles', payload)
        toast.success('Role created')
      }
      setCreateOpen(false)
      setEditingRole(null)
      setName('')
      setDescription('')
      setSelectedCapabilities([])
      if (editingRole && String(authStore.getSnapshot()?.role?._id) === String(editingRole._id)) {
        await authStore.refresh()
      }
      load()
    } catch (cause) {
      toast.error(cause.message || (editingRole ? 'Could not update role' : 'Could not create role'))
    } finally {
      setSaving(false)
    }
  }
  const roleActions = (role) => {
    const deleteDisabled = readOnly || role.protected || role.members > 0 || role.workflowReferences > 0
    const deleteTitle = readOnly
      ? 'The workspace licence is read-only'
      : role.protected
      ? 'Admin and CEO are protected'
      : role.members > 0
        ? 'Move assigned people before deleting'
        : role.workflowReferences > 0
          ? 'Remove this role from workflows before deleting'
          : 'Delete role'
    return (
      <div className="nf-forms-row-actions nf-roles-row-actions">
        {role.protected && <span className="nf-roles-protected"><LockKeyhole aria-hidden="true" />Protected</span>}
        <button type="button" className="nf-icon-button" onClick={() => setSelectedRole(role)} title="View permissions" aria-label={`View ${role.name} permissions`}><Eye className="w-4 h-4" /></button>
        {!role.protected && <RoleActionMenu role={role} readOnly={readOnly} deleteDisabled={deleteDisabled} deleteTitle={deleteTitle} onEdit={() => openEdit(role)} onDelete={() => remove(role)} />}
      </div>
    )
  }

  const actions = <button type="button" className="nf-button nf-button-primary" disabled={readOnly} title={readOnly ? 'The workspace licence is read-only' : undefined} onClick={openCreate}><Plus className="w-4 h-4" />Create role</button>

  return (
    <AppShell title="Roles & permissions" subtitle="Compare the independent capabilities that control tasks, people, analytics, and audit." actions={actions} mainClass="flex-1 p-4 md:p-6 pb-24 md:pb-6 overflow-y-auto">
      <div className="nf-forms-admin nf-roles-admin">
        <div className="nf-forms-metrics">
          <Metric label="Roles" value={!data ? '—' : roles.length} icon={ShieldCheck} />
          <Metric label="People assigned" value={!data ? '—' : totals.people} icon={Users} tone="teal" />
          <Metric label="Builder seats" value={builderSeatValue} hint={builderSeatHint} icon={FileText} tone="purple" />
        </div>

        <aside className="nf-roles-review">
          <LockKeyhole aria-hidden="true" />
          <div className="nf-roles-review-copy">
            <strong>Builder access is managed in Users.</strong>
            <p>A Builder seat grants complete Forms and Workflows management without changing the person's role.</p>
          </div>
          <Link to="/admin" className="nf-roles-review-link">Manage builders →</Link>
        </aside>

        <section className="nf-forms-management-shell">
          <div className="nf-forms-toolbar">
            <div className="nf-forms-toolbar-group">
              <label className="nf-forms-search"><Search aria-hidden="true" className="w-4 h-4 text-fg-subtle absolute left-3 top-1/2 -translate-y-1/2" /><input type="search" value={search} onChange={(event) => { setSearch(event.target.value); setPage(1) }} placeholder="Search roles" aria-label="Search roles" className="nf-forms-field" /></label>
              <select value={typeFilter} onChange={(event) => { setTypeFilter(event.target.value); setPage(1) }} className="nf-forms-select" aria-label="Filter roles by type"><option value="all">All role types</option><option value="system">System roles</option><option value="custom">Custom roles</option></select>
            </div>
          </div>

          {error && roles.length > 0 && <div className="nf-forms-error" role="alert"><AlertTriangle aria-hidden="true" /><span>{error}</span><button type="button" onClick={load} disabled={loading}><RefreshCw aria-hidden="true" className={loading ? 'animate-spin' : ''} />Retry</button></div>}

          <div className="nf-forms-results">
            {loading && roles.length === 0 ? (
              <div className="nf-forms-loading-list" aria-label="Loading roles">{Array.from({ length: 4 }).map((_, index) => <div key={index} className="nf-forms-loading-row"><Skeleton className="w-9 h-9 rounded-[10px] shrink-0" /><div className="flex-1 space-y-2"><Skeleton className="h-3 w-48 max-w-full" /><Skeleton className="h-2.5 w-72 max-w-full" /></div><Skeleton className="h-5 w-20 rounded-full" /></div>)}</div>
            ) : filtered.length === 0 ? (
              <div className="min-h-[16rem] flex items-center justify-center"><EmptyState title={error && roles.length === 0 ? 'Unable to load roles' : roles.length ? 'No matching roles' : 'No roles configured'} description={error && roles.length === 0 ? 'No records are shown because the roles service did not respond.' : roles.length ? 'Try another search or clear the filter.' : 'Create the first workspace role.'} icon={<ShieldCheck className="w-5 h-5" />} action={error && roles.length === 0 ? <button type="button" className="nf-button" onClick={load}><RefreshCw className="w-4 h-4" />Retry</button> : null} /></div>
            ) : (
              <div className="nf-forms-list-view"><table className="nf-forms-table nf-roles-table"><thead><tr><th scope="col">Role</th><th scope="col">People</th>{capabilities.map((capability) => <th scope="col" key={capability.key}>{capability.label}</th>)}<th scope="col">Actions</th></tr></thead><tbody>{displayed.map((role) => <tr key={role._id}><td><div className="nf-forms-cell-main"><span className={`nf-forms-icon nf-forms-icon-${toneFor(role._id)}`}><ShieldCheck aria-hidden="true" /></span><div className="nf-forms-cell-copy"><strong className="nf-forms-cell-title">{role.name}</strong><p className="nf-forms-cell-meta">{role.description || 'No description'}</p></div></div></td><td className="nf-forms-number">{role.members}</td>{capabilities.map((capability) => { const allowed = role.capabilities.includes(capability.key); return <td key={capability.key}>{allowed ? <span className="nf-status nf-status-success">Allowed</span> : <span className="nf-role-permission-none" aria-label="Not allowed">—</span>}</td> })}<td>{roleActions(role)}</td></tr>)}</tbody></table></div>
            )}
          </div>
          {!loading && filtered.length > pageSize && <CataloguePagination page={safePage} pageSize={pageSize} total={filtered.length} onPageChange={setPage} />}
        </section>
      </div>

      {selectedRole && <Modal size="lg" onClose={() => setSelectedRole(null)} title={`${selectedRole.name} permissions`} description={`${selectedRole.members} people assigned - ${selectedRole.capabilities.length} of ${capabilities.length} capabilities allowed`}><PermissionList role={selectedRole} capabilities={capabilities} /><div className="mt-5 flex justify-end"><button type="button" className="nf-button" onClick={() => setSelectedRole(null)}>Close</button></div></Modal>}
      {(createOpen || editingRole) && <Modal size="lg" onClose={closeEditor} title={editingRole ? `Edit ${editingRole.name}` : 'Create role'} description="Changes are enforced by both the API and the interface."><form onSubmit={saveRole} className="space-y-4"><label htmlFor="role-name" className="block text-xs font-semibold text-fg-muted">Role name<input id="role-name" value={name} onChange={(event) => setName(event.target.value)} className="nf-field mt-1.5" placeholder="Marketing lead" maxLength={80} autoFocus /></label><label htmlFor="role-description" className="block text-xs font-semibold text-fg-muted">Description<textarea id="role-description" value={description} onChange={(event) => setDescription(event.target.value)} className="nf-field mt-1.5 min-h-20" placeholder="What this role is responsible for" maxLength={500} /></label><fieldset><legend className="text-xs font-semibold text-fg-muted mb-2">Capabilities</legend><div className="max-h-64 overflow-y-auto space-y-2">{capabilities.map((capability) => <label key={capability.key} className="flex items-start gap-3 rounded-[10px] border border-line p-3 cursor-pointer hover:bg-surface-2"><input type="checkbox" className="mt-1" checked={selectedCapabilities.includes(capability.key)} onChange={() => setSelectedCapabilities((current) => current.includes(capability.key) ? current.filter((item) => item !== capability.key) : [...current, capability.key])} /><span><strong className="block text-sm text-fg">{capability.label}</strong>{capability.description && <small className="text-xs text-fg-muted">{capability.description}</small>}{capability.note && <small className="block text-xs text-fg-subtle mt-0.5">{capability.note}</small>}</span></label>)}</div></fieldset><div className="flex justify-end gap-2"><button type="button" className="nf-button" onClick={closeEditor}>Cancel</button><button type="submit" disabled={saving} className="nf-button nf-button-primary">{saving ? (editingRole ? 'Saving...' : 'Creating...') : (editingRole ? 'Save changes' : 'Create role')}</button></div></form></Modal>}
    </AppShell>
  )
}
