// Shared - AdminPanel.jsx
// Real user management. Pulls users from GET /api/users and roles from
// GET /api/roles. Admins can invite, change role, grant builder seats, change
// department, and deactivate / reactivate users. Non-admins see a friendly
// forbidden screen.

import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import AppShell from '../components/AppShell'
import { api } from '../utils/api'
import { fetchAllUsers } from '../utils/users'
import { useUser, initials } from '../utils/auth'
import { useDepartmentNames } from '../lib/departmentsStore'
import { canManageUsers } from '../utils/permissions'
import { parseCsv, buildTemplate } from '../utils/csv'
import { confirm } from '../lib/confirmStore'
import { Skeleton } from '../components/Skeleton'
import EmptyState from '../components/EmptyState'
import { AlertBanner } from '../components/Alert'
import Modal from '../components/Modal'
import ThreeDToggle from '../components/ThreeDToggle'
import { limitBanner, reportLimit } from '../lib/limitFeedback'
import { usageStore, useReadOnly, useUsage } from '../lib/usageStore'
import { meterText } from '../lib/licensing'
import { toast } from '../lib/toastStore'
import { Eye, Grid2X2, List, LockKeyhole, MoreHorizontal, Pencil, Power, Search, Trash2, UserRound, UsersRound } from 'lucide-react'

// A licensing refusal already carries an actionable sentence from the server;
// this only adds the heading so it doesn't read like an unexpected failure.
const errorText = (err, fallback) => {
  const info = limitBanner(err)
  return info ? `${info.title} — ${info.message}` : (err?.message || fallback)
}

const reportDialogError = (err, fallback) => {
  if (reportLimit(err)) return
  toast.error(err?.message || fallback)
}

function useBuilderSeats() {
  const { usage } = useUsage()
  const meter = usage?.resources?.builders || null
  const seatsFull = Boolean(meter && !meter.unlimited && Number(meter.used) >= Number(meter.limit))
  const seatsHint = !meter
    ? 'Lets this person design forms and workflows.'
    : meter.unlimited
      ? 'Unlimited builder seats on this plan.'
      : `${meterText('builders', meter)} builder seats used.`
  return { meter, seatsFull, seatsHint }
}

function BuilderSeatField({ id, checked, onChange, seatsFull, seatsHint, toggle = false }) {
  // Keep an already-granted seat editable (uncheck / re-check) even at the limit.
  const grantBlocked = seatsFull && !checked
  if (toggle) {
    return (
      <div className="flex min-h-14 items-center justify-between gap-4 border-t border-line pt-4">
        <div className="min-w-0">
          <label htmlFor={id} className="text-sm font-medium text-fg">Builder seat</label>
          <p id={`${id}-hint`} className="mt-1 text-xs leading-5 text-fg-muted">
            {grantBlocked
              ? 'No free builder seats — turn the seat off for someone else first.'
              : <>{seatsHint} Builder access adds workspace-wide Forms and Workflows management without changing this person's role.</>}
          </p>
        </div>
        <div className="shrink-0 [&_button]:focus-visible:outline-2 [&_button]:focus-visible:outline-offset-4 [&_button]:focus-visible:outline-indigo-500">
          <ThreeDToggle id={id} checked={checked} onChange={onChange} disabled={grantBlocked} ariaLabel="Builder seat" ariaDescribedBy={`${id}-hint`} />
        </div>
      </div>
    )
  }
  return (
    <div className={`rounded-md border border-line px-3 py-2.5 ${grantBlocked ? 'opacity-70' : ''}`}>
      <label htmlFor={id} className={`flex items-start gap-3 ${grantBlocked ? 'cursor-not-allowed' : 'cursor-pointer'}`}>
        <input
          id={id}
          type="checkbox"
          checked={checked}
          disabled={grantBlocked}
          onChange={(e) => onChange(e.target.checked)}
          className="mt-0.5 rounded border-line text-indigo-600 focus:ring-indigo-400"
        />
        <span className="min-w-0">
          <span className="block text-sm font-medium text-fg">Builder seat</span>
          <span className="block text-[11px] text-fg-subtle mt-0.5">
            {grantBlocked
              ? 'No free builder seats — turn the seat off for someone else first.'
              : seatsHint}
            {!grantBlocked && <> Builder access adds workspace-wide Forms and Workflows management without changing this person's role.</>}
          </span>
        </span>
      </label>
    </div>
  )
}

// Identity hues, not statuses — a person's initials shouldn't read as a warning,
// so each entry keeps its own colour and carries an explicit dark pair.
const AVATAR_PALETTE = [
  'bg-pink-100 text-pink-700 dark:bg-pink-500/20 dark:text-pink-200',
  'bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-200',
  'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-200',
  'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-200',
  'bg-purple-100 text-purple-700 dark:bg-purple-500/20 dark:text-purple-200',
  'bg-indigo-100 text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-200',
  'bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-200'
]
const avatarClassFor = (name) => {
  if (!name) return AVATAR_PALETTE[0]
  let hash = 0
  for (const c of name) hash = (hash * 31 + c.charCodeAt(0)) >>> 0
  return AVATAR_PALETTE[hash % AVATAR_PALETTE.length]
}

const formatLastSignIn = (value) => {
  if (!value) return 'Not yet'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Not yet'
  return date.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' })
}

const USER_MENU_WIDTH = 204
const USER_MENU_GAP = 6
const USER_MENU_EDGE = 8

function userMenuPosition(anchor, menuHeight = 132) {
  const rect = anchor.getBoundingClientRect()
  const spaceBelow = window.innerHeight - rect.bottom - USER_MENU_EDGE
  const openAbove = spaceBelow < menuHeight + USER_MENU_GAP && rect.top > spaceBelow
  const top = openAbove
    ? Math.max(USER_MENU_EDGE, rect.top - menuHeight - USER_MENU_GAP)
    : Math.min(window.innerHeight - menuHeight - USER_MENU_EDGE, rect.bottom + USER_MENU_GAP)
  const left = Math.max(
    USER_MENU_EDGE,
    Math.min(window.innerWidth - USER_MENU_WIDTH - USER_MENU_EDGE, rect.right - USER_MENU_WIDTH)
  )
  return { top: Math.max(USER_MENU_EDGE, top), left, placement: openAbove ? 'top' : 'bottom' }
}

function UserActionMenu({ user, isMe, userBusy, onEdit, onToggleActive, onDelete }) {
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState({ top: 0, left: 0, placement: 'bottom' })
  const triggerRef = useRef(null)
  const menuRef = useRef(null)
  const menuId = useId()

  useEffect(() => {
    if (!open) return undefined

    const reposition = () => {
      if (!triggerRef.current) return
      setPosition(userMenuPosition(triggerRef.current, menuRef.current?.offsetHeight || (isMe ? 48 : 132)))
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
  }, [isMe, open])

  const close = (handler) => () => {
    setOpen(false)
    triggerRef.current?.focus()
    handler()
  }
  const toggleMenu = () => {
    if (open) return setOpen(false)
    if (triggerRef.current) setPosition(userMenuPosition(triggerRef.current, isMe ? 48 : 132))
    setOpen(true)
  }
  const item = 'w-full text-left px-3 py-2 text-sm text-fg hover:bg-surface-2 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2'
  const danger = 'w-full text-left px-3 py-2 text-sm text-danger-fg hover:bg-danger-subtle disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2'

  return (
    <div className="relative">
      <button ref={triggerRef} type="button" className="nf-icon-button nf-forms-more-button" disabled={Boolean(userBusy)} title={userBusy ? 'User update in progress' : 'More actions'} onClick={toggleMenu} aria-haspopup="menu" aria-expanded={open} aria-controls={open ? menuId : undefined} aria-label={`More actions for ${user.name}`}>
        {userBusy ? <span aria-hidden="true" className="text-xs">…</span> : <MoreHorizontal aria-hidden="true" className="w-4 h-4" />}
      </button>
      {open && typeof document !== 'undefined' && createPortal(
        <div id={menuId} ref={menuRef} role="menu" aria-label={`Actions for ${user.name}`} data-placement={position.placement} className="nf-forms-row-menu nf-users-action-menu" style={{ top: position.top, left: position.left }}>
          <button type="button" role="menuitem" className={item} onClick={close(onEdit)}><Pencil aria-hidden="true" className="w-4 h-4" />Edit user</button>
          {!isMe && <button type="button" role="menuitem" className={item} onClick={close(onToggleActive)}><Power aria-hidden="true" className="w-4 h-4" />{user.isActive ? 'Deactivate user' : 'Reactivate user'}</button>}
          {!isMe && <div role="separator" className="my-1 border-t border-line" />}
          {!isMe && <button type="button" role="menuitem" className={danger} onClick={close(onDelete)}><Trash2 aria-hidden="true" className="w-4 h-4" />Delete permanently</button>}
        </div>,
        document.body
      )}
    </div>
  )
}

// ---------- create-user dialog ------------------------------------------

// Show roles in a sensible order in the dropdown. Anything not in this list
// (e.g. a future custom role) is appended alphabetically.
const ROLE_ORDER = ['Admin', 'CEO', 'VP', 'Manager', 'HR', 'Employee']

// System-admin roles sit outside the org chart: no department, no reporting
// manager, and their role isn't reassigned inline from this table.
const SYSTEM_ADMIN_ROLES = new Set(['Admin'])
const sortRoles = (roles) => {
  const indexed = roles.map((r) => ({
    r,
    idx: ROLE_ORDER.indexOf(r.name)
  }))
  indexed.sort((a, b) => {
    if (a.idx === -1 && b.idx === -1) return a.r.name.localeCompare(b.r.name)
    if (a.idx === -1) return 1
    if (b.idx === -1) return -1
    return a.idx - b.idx
  })
  return indexed.map(({ r }) => r)
}

function CreateUserSection({ title, icon: Icon, children }) {
  return (
    <section className="min-w-0 space-y-4 rounded-xl border border-line bg-surface p-4 sm:p-5">
      <div className="flex items-center gap-2.5">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600 dark:bg-indigo-500/15 dark:text-indigo-300">
          <Icon aria-hidden="true" className="h-4 w-4" />
        </span>
        <h3 className="text-sm font-semibold text-fg">{title}</h3>
      </div>
      {children}
    </section>
  )
}

function CreateUserDialog({ roles, managers, hrPeople, onClose, onCreated }) {
  const formId = useId()
  const fieldClass = 'mt-1.5 min-h-11 w-full min-w-0 rounded-lg border border-line bg-surface px-3 py-2.5 text-sm text-fg transition focus:outline-none focus:ring-2 focus:ring-indigo-300'
  const sortedRoles = useMemo(() => sortRoles(roles), [roles])
  const departments = useDepartmentNames()
  const { seatsFull, seatsHint } = useBuilderSeats()
  const defaultRoleId =
    sortedRoles.find((r) => r.name === 'Employee')?._id ||
    sortedRoles[0]?._id ||
    ''

  const [form, setForm] = useState({
    name: '',
    email: '',
    department: '',
    roleId: defaultRoleId,
    managerId: '',
    hrId: '',
    password: '',
    canBuild: false
  })

  // The list arrives a beat after the dialog opens; pick the first team then.
  useEffect(() => {
    if (form.department || !departments.length) return undefined
    const timer = window.setTimeout(() => setForm((current) => ({ ...current, department: departments[0] })), 0)
    return () => window.clearTimeout(timer)
  }, [departments, form.department])
  const [showPassword, setShowPassword] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  const handleChange = (e) => {
    const { name, value } = e.target
    setForm((p) => ({ ...p, [name]: value }))
  }

  const generatePassword = () => {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789'
    let out = ''
    for (let i = 0; i < 10; i++) out += chars[Math.floor(Math.random() * chars.length)]
    setForm((p) => ({ ...p, password: out }))
    setShowPassword(true)
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!form.name.trim() || !form.email.trim()) {
      toast.error('Name and email are required')
      return
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) {
      toast.error('Enter a valid email address')
      return
    }
    if (!form.roleId) {
      toast.error('Pick a role for this user')
      return
    }
    if (!form.password || form.password.length < 6) {
      toast.error('Password must be at least 6 characters')
      return
    }
    setSubmitting(true)
    try {
      const payload = {
        name: form.name.trim(),
        email: form.email.trim().toLowerCase(),
        department: form.department,
        roleId: form.roleId,
        managerId: form.managerId || undefined,
        hrId: form.hrId || undefined,
        password: form.password,
        canBuild: form.canBuild === true
      }
      const data = await api.post('/api/users', payload)
      onCreated(data.user, data.domainWarning)
    } catch (err) {
      reportDialogError(err, 'Failed to create user')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal
      onClose={onClose}
      title="Create a user"
      description="Set up their profile, workspace access and initial password."
      size="xl"
      maximizable
      className="overflow-hidden rounded-2xl"
      bodyClass="min-h-0 flex-1 overflow-y-auto bg-surface-2/50"
      footer={
        <div className="flex w-full justify-end gap-2">
          <button type="button" onClick={onClose} className="min-h-11 shrink-0 rounded-lg border border-line bg-surface px-4 py-2 text-sm font-medium text-fg transition hover:bg-surface-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500">
            Cancel
          </button>
          <button form={formId} type="submit" disabled={submitting} className="min-h-11 flex-1 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500 disabled:cursor-not-allowed disabled:opacity-60 sm:flex-none">
            {submitting ? 'Creating…' : 'Create user'}
          </button>
        </div>
      }
    >
      <form id={formId} onSubmit={handleSubmit} className="space-y-5 p-4 sm:p-6" noValidate aria-busy={submitting}>
        <CreateUserSection title="Personal details" icon={UserRound}>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="cu-name" className="block text-xs font-medium text-fg-muted">Full name</label>
              <input
                id="cu-name"
                name="name"
                value={form.name}
                onChange={handleChange}
                placeholder="e.g. Arjun Kumar"
                className={fieldClass}
              />
            </div>

            <div>
              <label htmlFor="cu-email" className="block text-xs font-medium text-fg-muted">Work email</label>
              <input
                id="cu-email"
                name="email"
                type="email"
                value={form.email}
                onChange={handleChange}
                placeholder="arjun@company.com"
                className={fieldClass}
              />
            </div>

          </div>
        </CreateUserSection>

        <CreateUserSection title="Workspace access" icon={UsersRound}>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="cu-role" className="block text-xs font-medium text-fg-muted">Role</label>
              <select
                id="cu-role"
                name="roleId"
                value={form.roleId}
                onChange={handleChange}
                className={fieldClass}
              >
                {sortedRoles.map((r) => (
                  <option key={r._id} value={r._id}>{r.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="cu-department" className="block text-xs font-medium text-fg-muted">Department</label>
              <select
                id="cu-department"
                name="department"
                value={form.department}
                onChange={handleChange}
                className={fieldClass}
              >
                {departments.map((d) => <option key={d}>{d}</option>)}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="cu-manager" className="block text-xs font-medium text-fg-muted">Reporting manager</label>
              <select
                id="cu-manager"
                name="managerId"
                value={form.managerId}
                onChange={handleChange}
                className={fieldClass}
              >
                <option value="">— No manager —</option>
                {(managers || []).map((m) => (
                  <option key={m._id} value={m._id}>
                    {m.name}{m.department ? ` · ${m.department}` : ''}
                  </option>
                ))}
              </select>
              <p className="mt-1.5 text-xs leading-5 text-fg-muted">
                Who this person reports to. You can change it later from the table.
              </p>
            </div>

            <div>
              <label htmlFor="cu-hr" className="block text-xs font-medium text-fg-muted">HR partner</label>
              <select
                id="cu-hr"
                name="hrId"
                value={form.hrId}
                onChange={handleChange}
                className={fieldClass}
              >
                <option value="">— No HR —</option>
                {(hrPeople || []).map((h) => (
                  <option key={h._id} value={h._id}>
                    {h.name}{h.department ? ` · ${h.department}` : ''}
                  </option>
                ))}
              </select>
              <p className="mt-1.5 text-xs leading-5 text-fg-muted">
                {(hrPeople || []).length === 0
                  ? 'No HR-role users yet — create one to assign HR partners.'
                  : 'The HR person responsible for this user.'}
              </p>
            </div>

          </div>

          <BuilderSeatField
            toggle
            id="cu-canBuild"
            checked={form.canBuild}
            onChange={(canBuild) => setForm((p) => ({ ...p, canBuild }))}
            seatsFull={seatsFull}
            seatsHint={seatsHint}
          />

        </CreateUserSection>

        <CreateUserSection title="Account security" icon={LockKeyhole}>
          <div>
            <div className="flex items-center justify-between gap-3">
              <label htmlFor="cu-password" className="block text-xs font-medium text-fg-muted">
                Initial password <span className="text-rose-500">*</span>
              </label>
              <button
                type="button"
                onClick={generatePassword}
                className="min-h-9 rounded-md px-2 text-xs font-medium text-indigo-600 hover:bg-surface-2 hover:text-indigo-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500 dark:text-indigo-300"
              >
                Generate
              </button>
            </div>
            <div className="relative">
              <input
                id="cu-password"
                name="password"
                type={showPassword ? 'text' : 'password'}
                value={form.password}
                onChange={handleChange}
                placeholder="At least 6 characters"
                autoComplete="new-password"
                className={`${fieldClass} pr-20`}
              />
              <button
                type="button"
                onClick={() => setShowPassword((s) => !s)}
                aria-pressed={showPassword}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                className="absolute right-1 bottom-0 flex min-h-11 items-center rounded-md px-3 text-xs font-medium text-fg-muted hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500"
              >
                {showPassword ? 'Hide' : 'Show'}
              </button>
            </div>
            <p className="mt-1.5 text-xs leading-5 text-fg-muted">
              Share this password securely. The user can change it after their first login.
            </p>
          </div>

        </CreateUserSection>
      </form>
    </Modal>
  )
}

// ---------- edit-user dialog --------------------------------------------

function EditUserDialog({ user, roles, managers, hrPeople, isSelf, onClose, onSaved }) {
  const sortedRoles = useMemo(() => sortRoles(roles || []), [roles])
  const orgDepartments = useDepartmentNames()
  const { seatsFull, seatsHint } = useBuilderSeats()
  // System admins (Admin) sit outside the org chart: no department, manager or
  // HR partner, and their role is managed separately. You also can't change
  // your own role.
  const orgExempt = SYSTEM_ADMIN_ROLES.has(user.role?.name)
  const roleLocked = orgExempt || isSelf

  const [form, setForm] = useState({
    name: user.name || '',
    email: user.email || '',
    password: '',
    roleId: user.role?._id || '',
    department: user.department || '',
    managerId: user.managerId || '',
    hrId: user.hrId || '',
    canBuild: user.canBuild === true
  })
  // Keep whoever is already filed under a retired department visible in the
  // picker, so saving an unrelated change does not move them.
  const departments = useMemo(
    () => (form.department && !orgDepartments.includes(form.department)
      ? [...orgDepartments, form.department]
      : orgDepartments),
    [orgDepartments, form.department]
  )
  const [showPw, setShowPw] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  const handleChange = (e) => {
    const { name, value } = e.target
    setForm((p) => ({ ...p, [name]: value }))
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    const name = form.name.trim()
    const email = form.email.trim().toLowerCase()
    const password = form.password
    if (!name) { toast.error('Name is required'); return }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      toast.error('Enter a valid email address')
      return
    }
    if (password && password.length < 6) {
      toast.error('Password must be at least 6 characters')
      return
    }
    setSubmitting(true)
    try {
      // Role has a dedicated endpoint; skip it when locked or unchanged.
      if (!roleLocked && form.roleId && form.roleId !== (user.role?._id || '')) {
        await api.post(`/api/users/${user._id}/assign-role`, { roleId: form.roleId })
      }
      const payload = { name, email, canBuild: form.canBuild === true }
      if (password) payload.password = password
      if (!orgExempt) {
        payload.department = form.department
        payload.managerId = form.managerId || null
        payload.hrId = form.hrId || null
      }
      const data = await api.put(`/api/users/${user._id}`, payload)
      onSaved(data.user)
    } catch (err) {
      reportDialogError(err, 'Failed to update user')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal
      onClose={onClose}
      title="Edit user"
      description="Update name, email, role, builder seat, department, manager & HR partner, or reset the password."
      bodyClass="overflow-y-auto"
    >
      <form onSubmit={handleSubmit} className="px-5 py-4 space-y-3" noValidate>
          <div>
            <label htmlFor="eu-name" className="block text-xs font-medium text-fg-muted mb-1">Full name</label>
            <input
              id="eu-name"
              name="name"
              value={form.name}
              onChange={handleChange}
              placeholder="e.g. Arjun Kumar"
              className="w-full px-3 py-2 text-sm rounded-md border border-line focus:outline-none focus:ring-2 focus:ring-indigo-200 focus:border-indigo-300"
            />
          </div>

          <div>
            <label htmlFor="eu-email" className="block text-xs font-medium text-fg-muted mb-1">Work email</label>
            <input
              id="eu-email"
              name="email"
              type="email"
              value={form.email}
              onChange={handleChange}
              placeholder="arjun@company.com"
              autoComplete="off"
              className="w-full px-3 py-2 text-sm rounded-md border border-line focus:outline-none focus:ring-2 focus:ring-indigo-200 focus:border-indigo-300"
            />
            <p className="text-[11px] text-fg-subtle mt-1">
              The user signs in with this email — changing it updates their login.
            </p>
          </div>

          {orgExempt ? (
            <>
              <div>
                <label htmlFor="eu-role-locked" className="block text-xs font-medium text-fg-muted mb-1">Role</label>
                <select
                  id="eu-role-locked"
                  name="roleId"
                  value={form.roleId}
                  onChange={handleChange}
                  disabled
                  title="System admin roles are managed separately"
                  className="w-full px-3 py-2 text-sm rounded-md border border-line bg-surface-2 text-fg-muted cursor-not-allowed focus:outline-none"
                >
                  {sortedRoles.map((r) => <option key={r._id} value={r._id}>{r.name}</option>)}
                </select>
              </div>
              <div className="p-2.5 rounded-md bg-surface-2 border border-line text-[11px] text-fg-muted">
                System admins sit outside the org chart, so they have no department, reporting manager or HR partner.
              </div>
            </>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="eu-role" className="block text-xs font-medium text-fg-muted mb-1">Role</label>
                  <select
                    id="eu-role"
                    name="roleId"
                    value={form.roleId}
                    onChange={handleChange}
                    disabled={isSelf}
                    title={isSelf ? "You can't change your own role" : ''}
                    className="w-full px-3 py-2 text-sm rounded-md border border-line focus:outline-none focus:ring-2 focus:ring-indigo-200 focus:border-indigo-300 disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    {sortedRoles.map((r) => <option key={r._id} value={r._id}>{r.name}</option>)}
                  </select>
                </div>
                <div>
                  <label htmlFor="eu-department" className="block text-xs font-medium text-fg-muted mb-1">Department</label>
                  <select
                    id="eu-department"
                    name="department"
                    value={form.department}
                    onChange={handleChange}
                    className="w-full px-3 py-2 text-sm rounded-md border border-line focus:outline-none focus:ring-2 focus:ring-indigo-200 focus:border-indigo-300"
                  >
                    {departments.map((d) => <option key={d}>{d}</option>)}
                  </select>
                </div>
              </div>

              <div>
                <label htmlFor="eu-manager" className="block text-xs font-medium text-fg-muted mb-1">Reporting manager</label>
                <select
                  id="eu-manager"
                  name="managerId"
                  value={form.managerId}
                  onChange={handleChange}
                  className="w-full px-3 py-2 text-sm rounded-md border border-line focus:outline-none focus:ring-2 focus:ring-indigo-200 focus:border-indigo-300"
                >
                  <option value="">— No manager —</option>
                  {(managers || []).filter((m) => m._id !== user._id).map((m) => (
                    <option key={m._id} value={m._id}>
                      {m.name}{m.department ? ` · ${m.department}` : ''}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="eu-hr" className="block text-xs font-medium text-fg-muted mb-1">HR partner</label>
                <select
                  id="eu-hr"
                  name="hrId"
                  value={form.hrId}
                  onChange={handleChange}
                  className="w-full px-3 py-2 text-sm rounded-md border border-line focus:outline-none focus:ring-2 focus:ring-indigo-200 focus:border-indigo-300"
                >
                  <option value="">— No HR —</option>
                  {(hrPeople || []).filter((h) => h._id !== user._id).map((h) => (
                    <option key={h._id} value={h._id}>
                      {h.name}{h.department ? ` · ${h.department}` : ''}
                    </option>
                  ))}
                </select>
                <p className="text-[11px] text-fg-subtle mt-1">
                  {(hrPeople || []).length === 0
                    ? 'No HR-role users yet — create one to assign HR partners.'
                    : 'The HR person who handles this user’s people processes.'}
                </p>
              </div>
            </>
          )}

          <BuilderSeatField
            id="eu-canBuild"
            checked={form.canBuild}
            onChange={(canBuild) => setForm((p) => ({ ...p, canBuild }))}
            seatsFull={seatsFull}
            seatsHint={seatsHint}
          />

          <div>
            <label htmlFor="eu-password" className="block text-xs font-medium text-fg-muted mb-1">New password</label>
            <div className="relative">
              <input
                id="eu-password"
                name="password"
                type={showPw ? 'text' : 'password'}
                value={form.password}
                onChange={handleChange}
                placeholder="Leave blank to keep current"
                autoComplete="new-password"
                className="w-full px-3 py-2 pr-14 text-sm rounded-md border border-line focus:outline-none focus:ring-2 focus:ring-indigo-200 focus:border-indigo-300"
              />
              <button
                type="button"
                onClick={() => setShowPw((s) => !s)}
                tabIndex={-1}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-[11px] font-medium text-indigo-600 hover:text-indigo-700 px-1"
              >
                {showPw ? 'Hide' : 'Show'}
              </button>
            </div>
            <p className="text-[11px] text-fg-subtle mt-1">
              Optional — sets a new sign-in password (min 6 characters). Leave blank to keep the current one.
            </p>
          </div>

          <div className="pt-2 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-2 rounded-md border border-line hover:bg-surface-2 text-sm font-medium text-fg transition"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-4 py-2 rounded-md bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white text-sm font-semibold shadow-sm transition"
            >
              {submitting ? 'Saving…' : 'Save changes'}
            </button>
          </div>
      </form>
    </Modal>
  )
}

// ---------- page --------------------------------------------------------

function AdminPanel() {
  const me = useUser()
  const departments = useDepartmentNames()

  const [users, setUsers] = useState([])
  const [roles, setRoles] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [search, setSearch] = useState('')
  const [roleFilter, setRoleFilter] = useState('All roles')
  const [deptFilter, setDeptFilter] = useState(() => new URLSearchParams(window.location.search).get('department') || 'All departments')
  const [statusFilter, setStatusFilter] = useState('') // '', 'active', 'inactive', 'admins'
  const [sortOrder, setSortOrder] = useState('name')
  const [page, setPage] = useState(1)
  const [viewMode, setViewMode] = useState(() => { try { return localStorage.getItem('netflow.users.view') || 'list' } catch { return 'list' } })
  const [createOpen, setCreateOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [editUser, setEditUser] = useState(null)
  const [viewUser, setViewUser] = useState(null)
  const [busy, setBusy] = useState({}) // { [userId]: 'role' | 'department' | 'deactivate' }
  const [feedback, setFeedback] = useState('')

  const isAdmin = canManageUsers(me)
  const readOnly = useReadOnly()

  // ---------- load ----------
  const loadUsers = async () => {
    try {
      const data = await fetchAllUsers()
      setUsers(data.users || [])
      // Every mutation on this page reloads the list, and each one can move a
      // seat count, so the card is refreshed from the same place.
      usageStore.refresh({ withUsage: true }).catch(() => {})
    } catch (e) {
      setError(e.message || 'Failed to load users')
    }
  }

  const loadRoles = async () => {
    try {
      const data = await api.get('/api/roles')
      setRoles(data.roles || [])
    } catch {
      // Roles are required for the dropdowns. Show a quiet hint instead of
      // a blocking error so the rest of the page still works for browsing.
      setRoles([])
    }
  }

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (!isAdmin) {
        setLoading(false)
        return
      }
      Promise.all([loadUsers(), loadRoles()]).finally(() => setLoading(false))
    }, 0)
    return () => window.clearTimeout(timer)
  }, [isAdmin])

  // ---------- mutations ----------

  const setBusyKey = (id, key) => setBusy((b) => ({ ...b, [id]: key }))
  const clearBusy = (id) => setBusy((b) => {
    const next = { ...b }
    delete next[id]
    return next
  })

  // Role, department, manager and HR partner are all edited from the Edit user
  // dialog (see EditUserDialog) rather than inline in the table.

  const handleToggleActive = async (user) => {
    if (user._id === me?._id) {
      setError('You cannot deactivate your own account.')
      return
    }
    if (user.isActive) {
      const ok = await confirm({
        title: 'Deactivate user?',
        message: `${user.name} will be signed out and won't be able to log in until reactivated.`,
        confirmLabel: 'Deactivate',
        danger: true,
      })
      if (!ok) return
    }
    setBusyKey(user._id, 'deactivate')
    setError('')
    try {
      if (user.isActive) {
        await api.delete(`/api/users/${user._id}`)
        setFeedback(`Deactivated ${user.name}.`)
      } else {
        await api.put(`/api/users/${user._id}`, { isActive: true })
        setFeedback(`Reactivated ${user.name}.`)
      }
      await loadUsers()
    } catch (e) {
      setError(errorText(e, 'Failed to update user'))
    } finally {
      clearBusy(user._id)
    }
  }

  const handleDelete = async (user) => {
    if (user._id === me?._id) {
      setError('You cannot delete your own account.')
      return
    }
    const ok = await confirm({
      title: 'Delete user?',
      message:
        `Permanently delete ${user.name} (${user.email})?\n\n` +
        'This removes the account from the database and cannot be undone. ' +
        'Anyone who reports to them — or has them set as HR partner — will be detached.',
      confirmLabel: 'Delete',
      danger: true,
    })
    if (!ok) return
    setBusyKey(user._id, 'delete')
    setError('')
    try {
      await api.delete(`/api/users/${user._id}/permanent`)
      setFeedback(`Permanently deleted ${user.name}.`)
      await loadUsers()
    } catch (e) {
      setError(e.message || 'Failed to delete user')
    } finally {
      clearBusy(user._id)
    }
  }

  const handleCreated = (user, domainWarning) => {
    setCreateOpen(false)
    setFeedback(
      domainWarning
        ? `Created ${user.name}. Warning: ${domainWarning}`
        : `Created ${user.name} (${user.role?.name || 'no role'}). They can log in with the password you set.`
    )
    loadUsers()
  }

  // ---------- derived ----------

  // Candidate managers: active users with a leadership role, sorted by name.
  const MANAGER_ROLES = new Set(['Admin', 'CEO', 'Manager', 'HR', 'VP'])
  const managerOptions = useMemo(() => {
    return users
      .filter((u) => u.isActive !== false && MANAGER_ROLES.has(u.role?.name))
      .sort((a, b) => a.name.localeCompare(b.name))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [users])

  // HR partners: active users who hold the HR role.
  const hrOptions = useMemo(() => {
    return users
      .filter((u) => u.isActive !== false && u.role?.name === 'HR')
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [users])

  const filtered = useMemo(() => {
    return users.filter((u) => {
      const matchesSearch =
        !search.trim() ||
        u.name.toLowerCase().includes(search.toLowerCase()) ||
        (u.email || '').toLowerCase().includes(search.toLowerCase())
      const matchesRole = roleFilter === 'All roles' || u.role?.name === roleFilter
      const matchesDept = deptFilter === 'All departments' || u.department === deptFilter
      const matchesStatus =
        !statusFilter ||
        (statusFilter === 'active' && u.isActive) ||
        (statusFilter === 'inactive' && !u.isActive) ||
        (statusFilter === 'admins' && SYSTEM_ADMIN_ROLES.has(u.role?.name))
      return matchesSearch && matchesRole && matchesDept && matchesStatus
    }).sort((a, b) => {
      if (sortOrder === 'recent') return new Date(b.updatedAt || b.createdAt || 0) - new Date(a.updatedAt || a.createdAt || 0)
      if (sortOrder === 'role') return String(a.role?.name || '').localeCompare(String(b.role?.name || '')) || a.name.localeCompare(b.name)
      return a.name.localeCompare(b.name)
    })
  }, [users, search, roleFilter, deptFilter, statusFilter, sortOrder])

  const pageSize = 10
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize))
  const safePage = Math.min(page, totalPages)
  const displayedUsers = filtered.slice((safePage - 1) * pageSize, safePage * pageSize)
  const updateView = (next) => {
    setViewMode(next)
    try { localStorage.setItem('netflow.users.view', next) } catch { /* optional preference */ }
  }

  const userStats = useMemo(() => {
    const active = users.filter((u) => u.isActive).length
    const inactive = users.length - active
    const admins = users.filter((u) => SYSTEM_ADMIN_ROLES.has(u.role?.name)).length
    return { total: users.length, active, inactive, admins }
  }, [users])

  // ---------- gates ----------

  if (!me) return null

  if (!isAdmin) {
    return (
      <AppShell title="Users">
        <div className="max-w-md mx-auto bg-surface border border-line rounded-xl p-8 text-center shadow-sm">
          <div className="mx-auto w-12 h-12 rounded-full bg-danger-subtle flex items-center justify-center mb-3">
            <svg xmlns="http://www.w3.org/2000/svg" className="w-6 h-6 text-danger-fg" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3m0 4h.01M5 19h14a2 2 0 001.85-2.74L13.85 4.74a2 2 0 00-3.7 0L3.15 16.26A2 2 0 005 19z" />
            </svg>
          </div>
          <p className="text-base font-semibold text-fg">Admins only</p>
          <p className="text-sm text-fg-muted mt-1">
            You need an Admin role to manage users.
          </p>
        </div>
      </AppShell>
    )
  }

  const newUserBlocked = roles.length === 0 || readOnly
  const blockedHint = readOnly ? 'The workspace licence has expired — adding users is paused.' : undefined
  const actions = (
    <div className="flex items-center gap-2">
      <button
        onClick={() => setImportOpen(true)}
        disabled={newUserBlocked}
        title={blockedHint}
        className="px-4 py-2 rounded-lg border border-line hover:bg-surface-2 disabled:opacity-50 disabled:cursor-not-allowed text-fg text-sm font-medium transition"
      >
        Import CSV
      </button>
      <button
        onClick={() => setCreateOpen(true)}
        disabled={newUserBlocked}
        title={blockedHint}
        className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-semibold shadow-sm transition"
      >
        <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
        </svg>
       New User
      </button>
    </div>
  )

  const selectStatus = (next) => {
    setStatusFilter((current) => (current === next ? '' : next))
    setPage(1)
  }

  const retry = () => {
    setLoading(true)
    setError('')
    Promise.all([loadUsers(), loadRoles()]).finally(() => setLoading(false))
  }

  const userActions = (user, card = false) => {
    const isMe = user._id === me._id
    const userBusy = busy[user._id]
    return (
      <div className={card ? 'nf-forms-card-actions' : 'nf-forms-row-actions'}>
        {card ? (
          <button type="button" className="nf-forms-fill-button" onClick={() => setViewUser(user)}><Eye aria-hidden="true" className="w-4 h-4" />View details</button>
        ) : (
          <button type="button" className="nf-icon-button" onClick={() => setViewUser(user)} title="View user" aria-label={`View ${user.name}`}><Eye aria-hidden="true" className="w-4 h-4" /></button>
        )}
        {user.isProtected ? (
          <span className="nf-users-protected"><LockKeyhole aria-hidden="true" />Protected</span>
        ) : (
          <UserActionMenu user={user} isMe={isMe} userBusy={userBusy} onEdit={() => setEditUser(user)} onToggleActive={() => handleToggleActive(user)} onDelete={() => handleDelete(user)} />
        )}
      </div>
    )
  }

  return (
    <AppShell
      title="Users"
      subtitle="Invite teammates, assign roles and builder seats, and manage access."
      actions={actions}
      mainClass="flex-1 p-4 md:p-6 pb-24 md:pb-6 overflow-y-auto"
    >
      <div className="nf-forms-admin nf-users-admin">
        <div className="nf-forms-metrics">
          <StatusCard label="All users" value={loading ? '—' : userStats.total} hint="In this workspace" loading={loading} active={!statusFilter} onClick={() => { setStatusFilter(''); setPage(1) }} tone="neutral" icon={<IconUsers className="w-5 h-5" />} />
          <StatusCard label="Active" value={loading ? '—' : userStats.active} hint="Can sign in" loading={loading} active={statusFilter === 'active'} onClick={() => selectStatus('active')} tone="success" icon={<IconActive className="w-5 h-5" />} />
          <StatusCard label="Inactive" value={loading ? '—' : userStats.inactive} hint="Deactivated accounts" loading={loading} active={statusFilter === 'inactive'} onClick={() => selectStatus('inactive')} tone="muted" icon={<IconInactive className="w-5 h-5" />} />
          <StatusCard label="Admins" value={loading ? '—' : userStats.admins} hint="Workspace administrators" loading={loading} active={statusFilter === 'admins'} onClick={() => selectStatus('admins')} tone="info" icon={<IconAdmin className="w-5 h-5" />} />
        </div>

        {(feedback || error || (roles.length === 0 && !loading)) && (
          <div className="mt-[18px] space-y-3">
            {feedback && <AlertBanner tone="success">{feedback}</AlertBanner>}
            {error && <AlertBanner onRetry={retry}>{error}</AlertBanner>}
            {roles.length === 0 && !loading && <AlertBanner tone="warning">No roles are set up for this workspace yet, so new users can&rsquo;t be created. Ask your platform administrator to finish setting up the workspace, then reload this page.</AlertBanner>}
          </div>
        )}

        <section className="nf-forms-management-shell">
          <div className="nf-forms-toolbar">
            <div className="nf-forms-toolbar-group">
              <label className="nf-forms-search"><Search aria-hidden="true" className="w-4 h-4 text-fg-subtle absolute left-3 top-1/2 -translate-y-1/2" /><input type="search" value={search} onChange={(event) => { setSearch(event.target.value); setPage(1) }} placeholder="Search name or email" aria-label="Search users" className="nf-forms-field" /></label>
              <select value={roleFilter} onChange={(event) => { setRoleFilter(event.target.value); setPage(1) }} aria-label="Filter by role" className="nf-forms-select"><option>All roles</option>{roles.map((role) => <option key={role._id}>{role.name}</option>)}</select>
              <select value={deptFilter} onChange={(event) => { setDeptFilter(event.target.value); setPage(1) }} aria-label="Filter by department" className="nf-forms-select"><option>All departments</option>{departments.map((department) => <option key={department}>{department}</option>)}</select>
              <select value={statusFilter} onChange={(event) => { setStatusFilter(event.target.value); setPage(1) }} aria-label="Filter by status" className="nf-forms-select"><option value="">All statuses</option><option value="active">Active</option><option value="inactive">Inactive</option><option value="admins">Admins</option></select>
              <select value={sortOrder} onChange={(event) => { setSortOrder(event.target.value); setPage(1) }} aria-label="Sort users" className="nf-forms-select nf-forms-sort"><option value="recent">Recently updated</option><option value="name">Name A–Z</option><option value="role">Role</option></select>
            </div>
            <LayoutToggle value={viewMode} onChange={updateView} />
          </div>

          <div className="nf-forms-results">
            {loading ? (
              viewMode === 'grid' ? <div className="nf-forms-card-grid" aria-label="Loading users">{Array.from({ length: 6 }).map((_, index) => <div key={index} className="nf-forms-card nf-forms-skeleton-card"><div className="nf-forms-card-body"><div className="nf-forms-card-head"><Skeleton className="w-9 h-9 rounded-full" /><Skeleton className="h-5 w-16 rounded-full" /></div><Skeleton className="h-4 w-1/2" /><Skeleton className="mt-2 h-3 w-4/5" /><div className="nf-forms-card-facts"><Skeleton className="h-8 w-20" /><Skeleton className="h-8 w-20" /><Skeleton className="h-8 w-20" /><Skeleton className="h-8 w-20" /></div></div></div>)}</div>
              : <div className="nf-forms-loading-list" aria-label="Loading users">{Array.from({ length: 6 }).map((_, index) => <div key={index} className="nf-forms-loading-row"><Skeleton className="w-9 h-9 rounded-full shrink-0" /><div className="flex-1 space-y-2"><Skeleton className="h-3 w-48 max-w-full" /><Skeleton className="h-2.5 w-72 max-w-full" /></div><Skeleton className="h-5 w-20 rounded-full" /></div>)}</div>
            ) : filtered.length === 0 ? (
              <div className="min-h-[16rem] flex items-center justify-center"><EmptyState title={users.length === 0 ? 'No users yet' : 'No users match your filters'} description={error && users.length === 0 ? 'No records are shown because the users service did not respond.' : users.length === 0 ? 'Use “Invite user” to add your first teammate.' : 'Try clearing the search, status, role or department filter.'} action={error && users.length === 0 ? <button type="button" className="nf-button" onClick={retry}>Retry</button> : null} /></div>
            ) : viewMode === 'grid' ? (
              <div className="nf-forms-card-grid">
                {displayedUsers.map((user) => {
                  const isMe = user._id === me._id
                  return <article key={user._id} className="nf-forms-card"><div className="nf-forms-card-body"><div className="nf-forms-card-head"><span className={`nf-forms-icon nf-users-avatar ${avatarClassFor(user.name)}`}>{initials(user.name)}</span><span className={`nf-status ${user.isActive ? 'nf-status-success' : 'nf-status-neutral'}`}>{user.isActive ? 'Active' : 'Inactive'}</span></div><h2 className="nf-forms-card-title">{user.name}{isMe ? <span className="ml-1 text-[10px] text-indigo-700 dark:text-indigo-200">(You)</span> : null}</h2><p className="nf-forms-card-description">{user.email}</p><dl className="nf-forms-card-facts"><div><dt>Role</dt><dd className="flex flex-wrap items-center gap-1.5">{user.role?.name || '—'}{user.canBuild && <span className="nf-status nf-status-purple">Builder</span>}</dd></div><div><dt>Department</dt><dd>{user.department || '—'}</dd></div><div><dt>Last sign-in</dt><dd>{formatLastSignIn(user.lastLogin)}</dd></div></dl></div><footer className="nf-forms-card-footer">{userActions(user, true)}</footer></article>
                })}
              </div>
            ) : (
              <div className="nf-forms-list-view"><table className="nf-forms-table nf-users-table"><thead><tr><th scope="col">User</th><th scope="col">Role</th><th scope="col">Department</th><th scope="col">Status</th><th scope="col">Last sign-in</th><th scope="col">Actions</th></tr></thead><tbody>{displayedUsers.map((user) => { const isMe = user._id === me._id; return <tr key={user._id}><td><div className="nf-forms-cell-main"><span className={`nf-forms-icon nf-users-avatar ${avatarClassFor(user.name)}`}>{initials(user.name)}</span><div className="nf-forms-cell-copy"><strong className="nf-forms-cell-title">{user.name}{isMe && <span className="ml-1 text-[9px] text-info-fg">YOU</span>}</strong><p className="nf-forms-cell-meta">{user.email}</p></div></div></td><td><span className="inline-flex flex-wrap items-center gap-1.5">{user.role?.name || '—'}{user.canBuild && <span className="nf-status nf-status-purple">Builder</span>}</span></td><td>{user.department || '—'}</td><td><span className={`nf-status ${user.isActive ? 'nf-status-success' : 'nf-status-neutral'}`}>{user.isActive ? 'Active' : 'Inactive'}</span></td><td>{formatLastSignIn(user.lastLogin)}</td><td>{userActions(user)}</td></tr> })}</tbody></table></div>
            )}
          </div>
          {!loading && filtered.length > 0 && <CataloguePagination page={safePage} pageSize={pageSize} total={filtered.length} onPageChange={setPage} />}
        </section>
      </div>
      {createOpen && (
        <CreateUserDialog
          roles={roles}
          managers={managerOptions}
          hrPeople={hrOptions}
          onClose={() => setCreateOpen(false)}
          onCreated={handleCreated}
        />
      )}

      {importOpen && (
        <ImportUsersDialog
          roles={roles}
          onClose={() => setImportOpen(false)}
          onImported={() => { setFeedback('Bulk import finished.'); loadUsers() }}
        />
      )}

      {editUser && (
        <EditUserDialog
          user={editUser}
          roles={roles}
          managers={managerOptions}
          hrPeople={hrOptions}
          isSelf={editUser._id === me._id}
          onClose={() => setEditUser(null)}
          onSaved={(updated) => {
            setEditUser(null)
            setFeedback(`Updated ${updated.name}'s details.`)
            loadUsers()
          }}
        />
      )}

      {viewUser && (
        <Modal onClose={() => setViewUser(null)} title={viewUser.name} description="User account and workspace access">
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
            <div><dt className="text-xs text-fg-muted">Email</dt><dd className="mt-1 font-semibold text-fg break-all">{viewUser.email || '-'}</dd></div>
            <div><dt className="text-xs text-fg-muted">Status</dt><dd className="mt-1"><span className={`nf-status ${viewUser.isActive ? 'nf-status-success' : 'nf-status-neutral'}`}>{viewUser.isActive ? 'Active' : 'Inactive'}</span></dd></div>
            <div><dt className="text-xs text-fg-muted">Role</dt><dd className="mt-1 font-semibold text-fg flex flex-wrap items-center gap-1.5">{viewUser.role?.name || '-'}{viewUser.canBuild && <span className="nf-status nf-status-purple">Builder</span>}</dd></div>
            <div><dt className="text-xs text-fg-muted">Department</dt><dd className="mt-1 font-semibold text-fg">{viewUser.department || '-'}</dd></div>
            <div><dt className="text-xs text-fg-muted">Account protection</dt><dd className="mt-1 font-semibold text-fg">{viewUser.isProtected ? 'Protected' : 'Standard'}</dd></div>
          </dl>
          <div className="mt-5 flex justify-end gap-2"><button type="button" className="nf-button" onClick={() => setViewUser(null)}>Close</button>{!viewUser.isProtected && <button type="button" className="nf-button nf-button-primary" onClick={() => { setViewUser(null); setEditUser(viewUser) }}><Pencil className="w-4 h-4" />Edit user</button>}</div>
        </Modal>
      )}
    </AppShell>
  )
}

function StatusCard({ label, value, hint, tone = 'neutral', icon, active, onClick, loading }) {
  const metricTone = { neutral: 'blue', success: 'teal', muted: 'coral', info: 'purple' }[tone] || 'blue'
  return (
    <button
      type="button"
      onClick={onClick}
      className={`nf-forms-metric nf-forms-tone-${metricTone} nf-users-metric-button ${active ? 'is-active' : ''}`}
      aria-pressed={active}
    >
      <div className="nf-forms-metric-top">
        <p className="nf-forms-metric-label">{label}</p>
        <span className="nf-forms-metric-icon">{icon}</span>
      </div>
      {loading ? <Skeleton className="relative z-10 h-8 w-12" /> : <p className="nf-forms-metric-value">{value}</p>}
      {hint ? <p className="nf-forms-metric-hint">{hint}</p> : null}
    </button>
  )
}

function LayoutToggle({ value, onChange }) {
  return (
    <div className="nf-forms-view-toggle" role="group" aria-label="Users layout">
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
    <nav className="nf-forms-pagination" aria-label="Users pagination">
      <span>Showing {from}–{to}</span>
      <div className="nf-forms-pagination-actions"><button type="button" className="nf-button nf-forms-page-button" disabled={safePage <= 1} onClick={() => onPageChange(safePage - 1)}>Previous</button><button type="button" className="nf-button nf-forms-page-button" disabled={safePage >= pages} onClick={() => onPageChange(safePage + 1)}>Next</button></div>
    </nav>
  )
}

function IconUsers(props) {
  return (
    <svg {...props} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.75">
      <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.5 20.25a7.5 7.5 0 0115 0" />
    </svg>
  )
}
function IconActive(props) {
  return (
    <svg {...props} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.75">
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  )
}
function IconInactive(props) {
  return (
    <svg {...props} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.75">
      <path strokeLinecap="round" strokeLinejoin="round" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
    </svg>
  )
}
function IconAdmin(props) {
  return (
    <svg {...props} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.75">
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
    </svg>
  )
}

// ---------- bulk import dialog ------------------------------------------

const REQUIRED_COLUMNS = ['name', 'email', 'department', 'role']

function ImportUsersDialog({ roles, onClose, onImported }) {
  const departments = useDepartmentNames()
  const [rows, setRows] = useState([])
  const [fileName, setFileName] = useState('')
  const [parseError, setParseError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [result, setResult] = useState(null)
  const fileRef = useRef(null)

  const roleNames = useMemo(
    () => new Set((roles || []).map((r) => r.name.toLowerCase())),
    [roles]
  )
  const deptSet = useMemo(() => new Set(departments.map((d) => d.toLowerCase())), [departments])

  // Client-side row validity hint (server re-validates authoritatively).
  const rowIssue = (r) => {
    if (!r.name || !r.email || !r.department || !r.role) return 'Missing required field'
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(r.email)) return 'Invalid email'
    if (!roleNames.has(String(r.role).toLowerCase())) return `Unknown role "${r.role}"`
    if (!deptSet.has(String(r.department).toLowerCase())) return `Unknown department "${r.department}"`
    return ''
  }

  const validCount = useMemo(() => rows.filter((r) => !rowIssue(r)).length, [rows]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleFile = (e) => {
    setParseError('')
    setResult(null)
    const file = e.target.files?.[0]
    if (!file) return
    setFileName(file.name)
    const reader = new FileReader()
    reader.onload = () => {
      try {
        const { headers, rows: parsed } = parseCsv(reader.result)
        const missing = REQUIRED_COLUMNS.filter((c) => !headers.includes(c))
        if (missing.length) {
          setRows([])
          setParseError(`CSV is missing column(s): ${missing.join(', ')}`)
          return
        }
        setRows(parsed.map((r) => ({
          name: r.name || '', email: r.email || '', department: r.department || '',
          role: r.role || '', manager: r.manager || '', hr: r.hr || ''
        })))
      } catch {
        setRows([])
        setParseError('Could not parse this file. Make sure it is a valid CSV.')
      }
    }
    reader.readAsText(file)
  }

  const downloadTemplate = () => {
    const blob = new Blob([buildTemplate(departments)], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'user-import-template.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  const submit = async () => {
    setSubmitting(true)
    setResult(null)
    try {
      const data = await api.post('/api/users/import', { users: rows })
      setResult(data)
      onImported?.()
    } catch (err) {
      setParseError(errorText(err, 'Import failed'))
    } finally {
      setSubmitting(false)
    }
  }

  const badgeFor = (status) =>
    status === 'created' ? 'bg-success-subtle text-success-fg'
      : status === 'skipped' ? 'bg-warning-subtle text-warning-fg'
        : 'bg-danger-subtle text-danger-fg'

  return (
    <Modal
      onClose={onClose}
      size="xl"
      title="Import users from CSV"
      description="Upload a CSV to invite many users at once. Each gets a temporary password by email."
      bodyClass="overflow-y-auto"
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-2 rounded-md border border-line hover:bg-surface-2 text-sm font-medium text-fg transition"
          >
            {result ? 'Close' : 'Cancel'}
          </button>
          {!result && (
            <button
              type="button"
              onClick={submit}
              disabled={submitting || rows.length === 0 || validCount === 0}
              className="px-4 py-2 rounded-md bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 disabled:cursor-not-allowed text-white text-sm font-semibold shadow-sm transition"
            >
              {submitting ? 'Importing…' : `Import ${validCount} user${validCount === 1 ? '' : 's'}`}
            </button>
          )}
        </>
      }
    >
        <div className="px-5 py-4 space-y-4">
          {!result && (
            <div className="flex justify-end">
              <button type="button" onClick={downloadTemplate} className="nf-button">Download CSV template</button>
            </div>
          )}
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv"
            onChange={handleFile}
            className="hidden"
          />

          {!result && (
            fileName ? (
              <div className="flex items-center justify-between gap-3 rounded-lg border border-line bg-surface-2 px-3 py-2.5">
                <div className="flex items-center gap-2 min-w-0">
                  <svg className="w-4 h-4 text-indigo-500 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" />
                  </svg>
                  <span className="text-sm text-fg truncate">{fileName}</span>
                </div>
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  className="text-[11px] font-medium text-indigo-600 hover:text-indigo-700 shrink-0"
                >
                  Replace
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="w-full flex flex-col items-center justify-center gap-1.5 rounded-lg border-2 border-dashed border-line px-4 py-7 text-center hover:border-info-line hover:bg-info-subtle/50 transition"
              >
                <svg className="w-6 h-6 text-fg-subtle" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><path d="M17 8l-5-5-5 5" /><path d="M12 3v12" />
                </svg>
                <span className="text-sm font-medium text-fg">Choose CSV file</span>
                <span className="text-[11px] text-fg-subtle">
                  Columns: name, email, department, role (required), manager, hr (optional)
                </span>
              </button>
            )
          )}



          {parseError && (
            <div className="p-2 rounded-md bg-danger-subtle border border-danger-line text-xs text-danger-fg">{parseError}</div>
          )}

          {rows.length > 0 && !result && (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-[11px]">
                <span className="text-fg-muted">{rows.length} row{rows.length === 1 ? '' : 's'} found</span>
                <span className="text-fg-muted">
                  <span className="font-medium text-success-fg">{validCount} valid</span>
                  {rows.length - validCount > 0 && (
                    <span className="text-danger-fg"> · {rows.length - validCount} with issues</span>
                  )}
                </span>
              </div>
              <div className="border border-line rounded-lg overflow-hidden">
                <table className="w-full text-xs">
                  <thead className="bg-surface-2 text-[10px] uppercase tracking-wide text-fg-subtle">
                    <tr>
                      <th scope="col" className="text-left px-3 py-2 font-medium">Name</th>
                      <th scope="col" className="text-left px-3 py-2 font-medium">Email</th>
                      <th scope="col" className="text-left px-3 py-2 font-medium">Dept</th>
                      <th scope="col" className="text-left px-3 py-2 font-medium">Role</th>
                      <th scope="col" className="text-left px-3 py-2 font-medium">Issue</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {rows.slice(0, 20).map((r, i) => {
                      const issue = rowIssue(r)
                      return (
                        <tr key={i} className={issue ? 'bg-danger-subtle/60' : ''}>
                          <td className="px-3 py-2 text-fg">{r.name}</td>
                          <td className="px-3 py-2 text-fg">{r.email}</td>
                          <td className="px-3 py-2 text-fg-muted">{r.department}</td>
                          <td className="px-3 py-2 text-fg-muted">{r.role}</td>
                          <td className="px-3 py-2 text-danger-fg">{issue}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
                {rows.length > 20 && (
                  <p className="px-3 py-2 text-[11px] text-fg-subtle bg-surface-2/60">…and {rows.length - 20} more</p>
                )}
              </div>
            </div>
          )}

          {result && (
            <div className="space-y-3">
              <div className="flex flex-wrap gap-2 text-xs font-medium">
                <span className="px-2.5 py-1 rounded-full bg-success-subtle text-success-fg">{result.created} created</span>
                <span className="px-2.5 py-1 rounded-full bg-warning-subtle text-warning-fg">{result.skipped} skipped</span>
                <span className="px-2.5 py-1 rounded-full bg-danger-subtle text-danger-fg">{result.failed} failed</span>
              </div>
              {(result.results || []).some((r) => r.status !== 'created' || r.reason) && (
                <div className="border border-line rounded-lg max-h-60 overflow-y-auto">
                  <table className="w-full text-xs">
                    <tbody className="divide-y divide-line">
                      {(result.results || []).filter((r) => r.status !== 'created' || r.reason).map((r, i) => (
                        <tr key={i}>
                          <td className="px-3 py-2 text-fg-subtle w-10">#{r.row}</td>
                          <td className="px-3 py-2 text-fg">{r.email}</td>
                          <td className="px-3 py-2">
                            <span className={`px-1.5 py-0.5 rounded text-[11px] ${badgeFor(r.status)}`}>{r.status}</span>
                          </td>
                          <td className="px-3 py-2 text-fg-muted">{r.reason}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
    </Modal>
  )
}

export default AdminPanel
