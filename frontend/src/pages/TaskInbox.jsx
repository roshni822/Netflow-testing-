// M3 - Phase 2 - TaskInbox.jsx - Live tasks from GET /api/tasks/my-tasks

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Activity, AlertTriangle, CheckCircle2, Clock3, Eye, FileText, ListChecks, MoreHorizontal, Plus, Search, Trash2, UsersRound } from 'lucide-react'
import AppShell from '../components/AppShell'
import { useTasks, tasksStore, TASK_FILTERS } from '../lib/tasksStore'
import { useUser } from '../utils/auth'
import { canViewTeam, isApprover as isApproverRole } from '../utils/permissions'
import { api } from '../utils/api'
import { adaptTask } from '../utils/adapters'
import { confirm } from '../lib/confirmStore'
import { ListRowSkeleton, Skeleton } from '../components/Skeleton'
import EmptyState from '../components/EmptyState'
import { AlertBanner } from '../components/Alert'
import { statusBadge } from '../utils/badges'
import { Pagination, ViewToggle } from '../components/NetFlowUI'
import { formatDate } from '../utils/datetime'

// The list is grouped by department, so a page-number pager would split groups
// oddly. Progressive "show more" keeps the grouping intact.
const PAGE_SIZE = 10
const INBOX_MENU_GAP = 6
const INBOX_MENU_EDGE = 8

function inboxMenuPosition(anchor, menuWidth, menuHeight) {
  const rect = anchor.getBoundingClientRect()
  const spaceBelow = window.innerHeight - rect.bottom - INBOX_MENU_EDGE
  const openAbove = spaceBelow < menuHeight + INBOX_MENU_GAP && rect.top > spaceBelow
  const top = openAbove
    ? Math.max(INBOX_MENU_EDGE, rect.top - menuHeight - INBOX_MENU_GAP)
    : Math.min(window.innerHeight - menuHeight - INBOX_MENU_EDGE, rect.bottom + INBOX_MENU_GAP)
  const left = Math.max(
    INBOX_MENU_EDGE,
    Math.min(window.innerWidth - menuWidth - INBOX_MENU_EDGE, rect.right - menuWidth)
  )
  return { top: Math.max(INBOX_MENU_EDGE, top), left, placement: openAbove ? 'top' : 'bottom' }
}

function useInboxMenu(open, setOpen, width, estimatedHeight) {
  const [position, setPosition] = useState({ top: 0, left: 0, placement: 'bottom' })
  const triggerRef = useRef(null)
  const menuRef = useRef(null)
  const menuId = useId()

  useEffect(() => {
    if (!open) return undefined

    const reposition = () => {
      if (!triggerRef.current) return
      setPosition(inboxMenuPosition(
        triggerRef.current,
        menuRef.current?.offsetWidth || width,
        menuRef.current?.offsetHeight || estimatedHeight
      ))
    }
    const closeOutside = (event) => {
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
      const items = Array.from(menuRef.current?.querySelectorAll(
        '[role="menuitem"]:not(:disabled), [role="menuitemcheckbox"]:not(:disabled)'
      ) || [])
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
      menuRef.current?.querySelector('[role^="menuitem"]')?.focus()
    })
    document.addEventListener('pointerdown', closeOutside)
    document.addEventListener('keydown', handleKeyDown)
    document.addEventListener('scroll', reposition, true)
    window.addEventListener('resize', reposition)

    return () => {
      window.cancelAnimationFrame(frame)
      document.removeEventListener('pointerdown', closeOutside)
      document.removeEventListener('keydown', handleKeyDown)
      document.removeEventListener('scroll', reposition, true)
      window.removeEventListener('resize', reposition)
    }
  }, [estimatedHeight, open, setOpen, width])

  const toggle = () => {
    if (open) {
      setOpen(false)
      return
    }
    if (triggerRef.current) {
      setPosition(inboxMenuPosition(triggerRef.current, width, estimatedHeight))
    }
    setOpen(true)
  }

  return { menuId, menuRef, position, toggle, triggerRef }
}

const SORTS = [
  { value: 'date_desc', label: 'Recently updated' },
  { value: 'date_asc',  label: 'Oldest updated' },
  { value: 'name_asc',  label: 'Name (A–Z)' },
  { value: 'name_desc', label: 'Name (Z–A)' },
  { value: 'status',    label: 'Status' }
]

const APPROVAL_SORTS = [
  { value: 'due', label: 'Due first' },
  { value: 'date_desc', label: 'Recently updated' },
  { value: 'date_asc', label: 'Oldest updated' },
  { value: 'name_asc', label: 'Name (A–Z)' },
  { value: 'status', label: 'Status' },
]

// A request is deletable only once it's finished. Workflow requests use the
// parent execution's status; standalone tasks fall back to their own status.
const FINISHED_EXEC = new Set(['completed', 'failed', 'cancelled'])
const RESOLVED_STATUS = new Set(['Approved', 'Rejected', 'Cancelled'])
const isRequestFinished = (task) =>
  task.executionId ? FINISHED_EXEC.has(task.executionStatus) : RESOLVED_STATUS.has(task.status)

const formatTimeLeft = (minutes) => {
  if (minutes < 0) return null
  if (minutes < 60) return `${Math.max(1, Math.round(minutes))}m left`
  const hours = minutes / 60
  if (hours < 24) return `${Math.round(hours)}h left`
  return `${Math.round(hours / 24)}d left`
}

// Urgency was signalled by colour alone, which colour-blind users can't read.
// Each level now carries its own glyph and wording too.
const slaBadge = (task) => {
  if (task.slaBreached || task.dueInMinutes < 0) {
    return {
      label: 'SLA breached',
      icon: '▲',
      srLabel: 'Overdue: ',
      cls: 'bg-danger-subtle text-danger-fg border-danger-line',
    }
  }
  if (task.dueInMinutes < 6 * 60) {
    return {
      label: `Due soon · ${formatTimeLeft(task.dueInMinutes)}`,
      icon: '●',
      srLabel: 'Due soon: ',
      cls: 'bg-warning-subtle text-warning-fg border-warning-line',
    }
  }
  return {
    label: formatTimeLeft(task.dueInMinutes),
    icon: '○',
    srLabel: 'On track: ',
    cls: 'bg-success-subtle text-success-fg border-success-line',
  }
}

const taskStatusBadge = (status) => {
  if (status === 'Approved' || status === 'Rejected' || status === 'Escalated') {
    return { label: status, cls: statusBadge(status).badge }
  }
  return { label: 'Pending your approval', cls: 'bg-surface-2 text-fg-muted border-line' }
}

function TaskCard({ task, onOpen, onApprove, onReject, busy, canAct, showApprover, canDelete, onDelete, selectable, selected, onToggleSelect }) {
  const sla = slaBadge(task)
  const status = taskStatusBadge(task.status)
  const isResolved = task.status !== 'Pending'

  return (
    <div
      onClick={() => onOpen(task.id)}
      className="flex items-start gap-4 px-5 py-4 bg-surface rounded-lg border border-line hover:border-indigo-300 hover:shadow-sm transition cursor-pointer"
    >
      {selectable && (
        <input
          type="checkbox"
          checked={selected}
          onClick={(e) => e.stopPropagation()}
          onChange={() => onToggleSelect(task.id)}
          aria-label={`Select ${task.title} for bulk approval`}
          className="mt-2.5 w-4 h-4 rounded border-line text-indigo-600 focus:ring-indigo-400 shrink-0"
        />
      )}
      <div className={`w-9 h-9 rounded-full flex items-center justify-center text-xs font-semibold shrink-0 ${task.avatarColor}`}>
        {task.initials}
      </div>

      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-fg truncate">
          {task.title}
          <span className="text-fg-subtle font-normal"> · {task.detail}</span>
        </p>
        <p className="text-xs text-fg-muted mt-0.5">
          {showApprover
            ? `With ${task.approver || 'an approver'} · ${task.workflow}`
            : `${task.requester} · ${task.workflow}`}
        </p>

        <div className="flex flex-wrap items-center gap-1.5 mt-2">
          {sla.label && (
            <span className={`inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-md border font-medium ${sla.cls}`}>
              <span aria-hidden="true">{sla.icon}</span>
              <span className="sr-only">{sla.srLabel}</span>
              {sla.label}
            </span>
          )}
          <span className={`text-[11px] px-2 py-0.5 rounded-md border ${status.cls}`}>
            {showApprover && task.status === 'Pending' ? 'Awaiting approval' : status.label}
          </span>
        </div>
      </div>

      {canAct ? (
        <div className="flex flex-col gap-1.5 shrink-0">
          <button
            type="button"
            disabled={isResolved || busy}
            onClick={(e) => {
              e.stopPropagation()
              onApprove(task.id)
            }}
            className={`px-4 py-1 text-xs font-medium rounded-md border transition ${
              isResolved || busy
                ? 'border-line text-fg-subtle cursor-not-allowed'
                : 'border-success-line text-success-fg hover:bg-success-subtle'
            }`}
          >
            {busy === 'approve' ? 'Approving…' : 'Approve'}
          </button>
          <button
            type="button"
            disabled={isResolved || busy}
            onClick={(e) => {
              e.stopPropagation()
              onReject(task.id)
            }}
            className={`px-4 py-1 text-xs font-medium rounded-md border transition ${
              isResolved || busy
                ? 'border-line text-fg-subtle cursor-not-allowed'
                : 'border-danger-line text-danger-fg hover:bg-danger-subtle'
            }`}
          >
            {busy === 'reject' ? 'Rejecting…' : 'Reject'}
          </button>
        </div>
      ) : (
        <div className="shrink-0 self-center flex items-center gap-2">
          {canDelete && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onDelete(task.id) }}
              disabled={busy === 'delete'}
              aria-label="Delete request"
              title="Delete request"
              className="p-1 rounded-md text-fg-subtle hover:text-danger-fg hover:bg-danger-subtle disabled:opacity-50 transition"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 7h12M9 7V5a1 1 0 011-1h4a1 1 0 011 1v2m-1 0v12a1 1 0 01-1 1H8a1 1 0 01-1-1V7m3 4v6m4-6v6" />
              </svg>
            </button>
          )}
          <span className="text-xs text-fg-subtle">View →</span>
        </div>
      )}
    </div>
  )
}

const REQUEST_ICON_TONES = [
  'nf-requests-icon-teal',
  'nf-requests-icon-purple',
  'nf-requests-icon-blue',
]

const requestIconTone = (id) => {
  const value = String(id || '')
  let hash = 0
  for (const char of value) hash = ((hash * 31) + char.charCodeAt(0)) >>> 0
  return REQUEST_ICON_TONES[hash % REQUEST_ICON_TONES.length]
}

const requestReference = (task) => {
  const source = String(task.executionId || task.id || '').replace(/[^a-z0-9]/gi, '')
  return `REQ-${(source.slice(-6) || 'REQUEST').toUpperCase()}`
}

const requestStatus = (task) => {
  const execution = String(task.executionStatus || '').toLowerCase()
  const lastAction = task._raw?.approvalHistory?.at?.(-1)?.action

  if (execution === 'completed') return 'Completed'
  if (execution === 'cancelled') return 'Cancelled'
  if (execution === 'failed') return 'Failed'
  if (lastAction === 'request_changes' && task.status === 'Pending') return 'Changes requested'
  if (task.status === 'Rejected') return 'Rejected'
  if (task.status === 'Escalated') return 'Escalated'
  if (task.status === 'Approved') return 'Approved'
  if ((task.approvalChain || []).some((step) => step.status === 'approved')) return 'In review'
  return 'Pending'
}

const requestStatusVisual = (status) => {
  if (status === 'Changes requested') {
    return {
      badge: 'bg-violet-50 text-violet-700 border-violet-200 dark:bg-violet-500/15 dark:text-violet-300 dark:border-violet-500/30',
      dot: 'bg-violet-500',
    }
  }
  if (status === 'In review') {
    return { badge: 'bg-info-subtle text-info-fg border-info-line', dot: 'bg-info-solid' }
  }
  if (status === 'Cancelled') {
    return { badge: 'bg-surface-3 text-fg-muted border-line', dot: 'bg-fg-subtle' }
  }
  if (status === 'Failed') {
    return statusBadge('Rejected')
  }
  return statusBadge(status)
}

const requestCurrentStep = (task, status) => {
  if (['Completed', 'Approved', 'Rejected', 'Cancelled', 'Failed'].includes(status)) return 'Complete'
  if (status === 'Changes requested') return 'Your update required'

  const chain = task.approvalChain || []
  const current = chain.find((step) => step.isCurrent)
    || chain.find((step) => step.status === 'pending' || step.status === 'escalated')
  if (current) return current.title || current.roleLabel || 'Approval in progress'
  if (task.actionType === 'submit') return task._raw?.title || 'Your update required'
  return task._raw?.title || task.detail || 'Pending review'
}

const formatLastUpdated = (value) => {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'

  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const day = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  const dayDiff = Math.round((today.getTime() - day.getTime()) / 86400000)
  if (dayDiff === 0) {
    return `Today, ${date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`
  }
  if (dayDiff === 1) return 'Yesterday'
  return formatDate(date, '—')
}

const toRequestRecord = (task) => {
  const status = requestStatus(task)
  const statusVisual = requestStatusVisual(status)
  return {
    id: task.id,
    title: task.title || 'Request',
    department: task.department || 'General',
    reference: requestReference(task),
    submittedAt: task.createdAt,
    updatedAt: task.updatedAt || task.createdAt,
    status,
    statusVisual,
    currentStep: requestCurrentStep(task, status),
    trackable: !isRequestFinished(task) && !['Rejected', 'Cancelled', 'Failed', 'Completed'].includes(status),
    canDelete: isRequestFinished(task),
    iconTone: requestIconTone(task.executionId || task.id),
  }
}

function RequestMoreMenu({ request, onOpen, onDelete, busy }) {
  const [open, setOpen] = useState(false)
  const { menuId, menuRef, position, toggle, triggerRef } = useInboxMenu(
    open,
    setOpen,
    164,
    request.canDelete ? 88 : 49
  )

  return (
    <div className="nf-requests-more-wrap">
      <button
        ref={triggerRef}
        type="button"
        className="nf-requests-more"
        aria-label={`More actions for ${request.title}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={toggle}
      >
        <MoreHorizontal aria-hidden="true" />
      </button>
      {open && typeof document !== 'undefined' && createPortal(
        <div
          id={menuId}
          ref={menuRef}
          className="nf-requests-menu is-floating"
          role="menu"
          aria-label={'Actions for ' + request.title}
          data-placement={position.placement}
          style={{ top: position.top, left: position.left }}
        >
          <button type="button" role="menuitem" onClick={() => { setOpen(false); onOpen(request.id) }}>
            <Eye aria-hidden="true" />
            View details
          </button>
          {request.canDelete && (
            <button
              type="button"
              role="menuitem"
              className="is-danger"
              disabled={busy === 'delete'}
              onClick={() => { setOpen(false); onDelete(request.id) }}
            >
              <Trash2 aria-hidden="true" />
              {busy === 'delete' ? 'Deleting…' : 'Delete request'}
            </button>
          )}
        </div>,
        document.body
      )}
    </div>
  )
}

function RequestPrimaryAction({ request, onOpen }) {
  return (
    <button type="button" className="nf-requests-primary-action" onClick={() => onOpen(request.id)}>
      <Activity aria-hidden="true" />
      {request.trackable ? 'Track' : 'View'}
    </button>
  )
}

function SubmittedRequestsTable({ requests, onOpen, onDelete, busyMap }) {
  return (
    <div className="nf-requests-table-scroll">
      <table className="nf-requests-table">
        <thead>
          <tr>
            <th scope="col">Request</th>
            <th scope="col">Submitted</th>
            <th scope="col">Status</th>
            <th scope="col">Current step</th>
            <th scope="col">Last updated</th>
            <th scope="col">Actions</th>
          </tr>
        </thead>
        <tbody>
          {requests.map((request) => (
            <tr key={request.id}>
              <td>
                <div className="nf-requests-title-cell">
                  <span aria-hidden="true" className={`nf-requests-row-dot ${request.statusVisual.dot}`} />
                  <div>
                    <button type="button" onClick={() => onOpen(request.id)}>{request.title}</button>
                    <span>{request.reference} · {request.department}</span>
                  </div>
                </div>
              </td>
              <td><time dateTime={request.submittedAt || undefined}>{formatDate(request.submittedAt, '—')}</time></td>
              <td>
                <span className={`nf-requests-status ${request.statusVisual.badge}`}>
                  <span aria-hidden="true" className={`nf-requests-status-dot ${request.statusVisual.dot}`} />
                  {request.status}
                </span>
              </td>
              <td>{request.currentStep}</td>
              <td><time dateTime={request.updatedAt || undefined}>{formatLastUpdated(request.updatedAt)}</time></td>
              <td>
                <div className="nf-requests-actions">
                  <RequestPrimaryAction request={request} onOpen={onOpen} />
                  <RequestMoreMenu request={request} onOpen={onOpen} onDelete={onDelete} busy={busyMap[request.id]} />
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function SubmittedRequestsGrid({ requests, onOpen, onDelete, busyMap }) {
  return (
    <div className="nf-requests-grid">
      {requests.map((request) => (
        <article key={request.id} className="nf-requests-card">
          <div className="nf-requests-card-body">
            <div className="nf-requests-card-top">
              <span aria-hidden="true" className={`nf-requests-card-icon ${request.iconTone}`}>
                <ListChecks />
              </span>
              <span className={`nf-requests-status ${request.statusVisual.badge}`}>
                <span aria-hidden="true" className={`nf-requests-status-dot ${request.statusVisual.dot}`} />
                {request.status}
              </span>
            </div>
            <button type="button" className="nf-requests-card-title" onClick={() => onOpen(request.id)}>
              {request.title}
            </button>
            <p className="nf-requests-card-meta">{request.reference} · {request.department}</p>
            <dl className="nf-requests-card-facts">
              <div>
                <dt>Submitted</dt>
                <dd><time dateTime={request.submittedAt || undefined}>{formatDate(request.submittedAt, '—')}</time></dd>
              </div>
              <div>
                <dt>Last updated</dt>
                <dd><time dateTime={request.updatedAt || undefined}>{formatLastUpdated(request.updatedAt)}</time></dd>
              </div>
              <div className="nf-requests-card-step">
                <dt>Current step</dt>
                <dd>{request.currentStep}</dd>
              </div>
            </dl>
          </div>
          <footer className="nf-requests-card-footer">
            <RequestPrimaryAction request={request} onOpen={onOpen} />
            <RequestMoreMenu request={request} onOpen={onOpen} onDelete={onDelete} busy={busyMap[request.id]} />
          </footer>
        </article>
      ))}
    </div>
  )
}

function SubmittedRequestsSkeleton({ viewMode }) {
  if (viewMode === 'grid') {
    return (
      <div className="nf-requests-grid" aria-label="Loading requests">
        {Array.from({ length: 6 }).map((_, index) => (
          <div key={index} className="nf-requests-card nf-requests-skeleton-card">
            <div className="nf-requests-card-body">
              <div className="nf-requests-card-top">
                <Skeleton className="h-9 w-9 rounded-lg" />
                <Skeleton className="h-5 w-20 rounded-full" />
              </div>
              <Skeleton className="mt-4 h-4 w-2/3" />
              <Skeleton className="mt-2 h-3 w-1/3" />
              <div className="nf-requests-card-facts">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
              </div>
            </div>
            <div className="nf-requests-card-footer"><Skeleton className="h-8 w-20 rounded-lg" /></div>
          </div>
        ))}
      </div>
    )
  }
  return (
    <div className="nf-requests-table-loading" aria-label="Loading requests">
      {Array.from({ length: 7 }).map((_, index) => <ListRowSkeleton key={index} />)}
    </div>
  )
}

const approvalDue = (task, status) => {
  const resolvedLabels = {
    Completed: 'Completed',
    Approved: 'Approved',
    Rejected: 'Rejected',
  }

  if (status === 'Cancelled') return { label: 'Cancelled', tone: 'is-neutral' }
  if (status === 'Failed') return { label: 'Failed', tone: 'is-overdue' }

  const resolvedLabel = resolvedLabels[status]
  if (resolvedLabel) {
    if (!task.dueDate) return { label: resolvedLabel, tone: 'is-complete' }

    const due = new Date(task.dueDate)
    const resolved = new Date(task.resolvedAt || task.updatedAt)
    if (Number.isNaN(due.getTime()) || Number.isNaN(resolved.getTime())) {
      return { label: resolvedLabel, tone: 'is-neutral' }
    }

    const missedSla = resolved.getTime() > due.getTime() || task.slaBreached
    return {
      label: `${resolvedLabel} ${missedSla ? 'after SLA' : 'on time'}`,
      tone: missedSla ? 'is-overdue' : 'is-complete',
    }
  }

  if (!task.dueDate) {
    return task.slaBreached
      ? { label: 'SLA breached', tone: 'is-overdue' }
      : { label: 'No deadline', tone: 'is-neutral' }
  }

  const due = new Date(task.dueDate)
  if (Number.isNaN(due.getTime())) return { label: 'No deadline', tone: 'is-neutral' }
  const now = new Date()
  const minutes = Math.round((due.getTime() - now.getTime()) / 60000)

  if (minutes < 0 || task.slaBreached) {
    const overdue = Math.abs(minutes)
    if (overdue < 60) return { label: `Overdue by ${Math.max(1, overdue)}m`, tone: 'is-overdue' }
    if (overdue < 1440) return { label: `Overdue by ${Math.max(1, Math.round(overdue / 60))}h`, tone: 'is-overdue' }
    return { label: `Overdue by ${Math.max(1, Math.round(overdue / 1440))}d`, tone: 'is-overdue' }
  }

  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const dueDay = new Date(due.getFullYear(), due.getMonth(), due.getDate())
  const days = Math.round((dueDay.getTime() - today.getTime()) / 86400000)
  if (days === 0) return { label: 'Due today', tone: 'is-soon' }
  if (days === 1) return { label: 'Due tomorrow', tone: 'is-soon' }
  return { label: `Due in ${days} days`, tone: 'is-on-track' }
}

const toApprovalRecord = (task, canAct) => {
  const baseStatus = requestStatus(task)
  const slaIsStatus = task.slaBreached && baseStatus === 'Pending'
  const status = slaIsStatus ? 'SLA breached' : baseStatus
  const isResolved = ['Completed', 'Approved', 'Rejected', 'Cancelled', 'Failed'].includes(baseStatus)
  const statusVisual = slaIsStatus
    ? { badge: 'bg-danger-subtle text-danger-fg border-danger-line', dot: 'bg-danger-solid' }
    : requestStatusVisual(baseStatus)

  return {
    id: task.id,
    title: task.title || 'Request',
    requester: task.requester || 'Unknown requester',
    department: task.department || 'General',
    reference: requestReference(task),
    status,
    statusVisual,
    currentStep: requestCurrentStep(task, baseStatus),
    due: approvalDue(task, baseStatus),
    actionLabel: isResolved ? 'View details' : baseStatus === 'Changes requested' ? 'Open' : 'Review',
    canDecide: canAct && task.status === 'Pending' && task.actionType === 'approval',
    original: task,
  }
}

function ApprovalMoreMenu({ record, onApprove, onReject, busy, selectable, selected, onToggleSelect }) {
  const [open, setOpen] = useState(false)
  const estimatedHeight = 10 + (34 * ((record.canDecide ? 2 : 0) + (selectable ? 1 : 0)))
  const { menuId, menuRef, position, toggle, triggerRef } = useInboxMenu(
    open,
    setOpen,
    214,
    estimatedHeight
  )

  const run = async (callback) => {
    await callback?.()
    setOpen(false)
  }

  return (
    <div className="nf-requests-more-wrap">
      <button
        ref={triggerRef}
        type="button"
        className="nf-requests-more"
        aria-label={`More actions for ${record.title}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={toggle}
      >
        <MoreHorizontal aria-hidden="true" />
      </button>
      {open && typeof document !== 'undefined' && createPortal(
        <div
          id={menuId}
          ref={menuRef}
          className="nf-requests-menu nf-approval-menu is-floating"
          role="menu"
          aria-label={'Actions for ' + record.title}
          data-placement={position.placement}
          style={{ top: position.top, left: position.left }}
        >
          {record.canDecide && (
            <>
              <button type="button" role="menuitem" disabled={Boolean(busy)} onClick={() => run(() => onApprove(record.id))}>
                <CheckCircle2 aria-hidden="true" />
                {busy === 'approve' ? 'Approving…' : 'Approve'}
              </button>
              <button type="button" role="menuitem" className="is-danger" disabled={Boolean(busy)} onClick={() => run(() => onReject(record.id))}>
                <AlertTriangle aria-hidden="true" />
                {busy === 'reject' ? 'Rejecting…' : 'Reject'}
              </button>
            </>
          )}
          {selectable && (
            <button type="button" role="menuitemcheckbox" aria-checked={selected} onClick={() => run(onToggleSelect)}>
              <ListChecks aria-hidden="true" />
              {selected ? 'Remove from bulk selection' : 'Select for bulk approval'}
            </button>
          )}
        </div>,
        document.body
      )}
    </div>
  )
}

function ApprovalInboxTable({ records, onOpen, onApprove, onReject, busyMap, eligibleIds, selectedIds, onToggleSelect }) {
  return (
    <div className="nf-approval-table-scroll">
      <table className="nf-approval-table">
        <thead>
          <tr>
            <th scope="col">Request</th>
            <th scope="col">Requester</th>
            <th scope="col">Status</th>
            <th scope="col">Current step</th>
            <th scope="col">SLA / due</th>
            <th scope="col">Actions</th>
          </tr>
        </thead>
        <tbody>
          {records.map((record) => {
            const selectable = eligibleIds.has(record.id)
            const selected = selectedIds.includes(record.id)
            const hasMoreActions = record.canDecide || selectable
            return (
              <tr key={record.id} className={selected ? 'is-selected' : ''}>
                <td>
                  <div className="nf-requests-title-cell">
                    <span aria-hidden="true" className={`nf-requests-row-dot ${record.statusVisual.dot}`} />
                    <div>
                      <button type="button" onClick={() => onOpen(record.id)}>{record.title}</button>
                      <span>{record.reference} · {record.department}</span>
                    </div>
                  </div>
                </td>
                <td>{record.requester}</td>
                <td>
                  <span className={`nf-requests-status ${record.statusVisual.badge}`}>
                    <span aria-hidden="true" className={`nf-requests-status-dot ${record.statusVisual.dot}`} />
                    {record.status}
                  </span>
                </td>
                <td>{record.currentStep}</td>
                <td><span className={`nf-approval-due ${record.due.tone}`}>{record.due.label}</span></td>
                <td>
                  <div className="nf-requests-actions">
                    <button type="button" className="nf-requests-primary-action" onClick={() => onOpen(record.id)}>{record.actionLabel}</button>
                    {hasMoreActions && (
                      <ApprovalMoreMenu
                        record={record}
                        onApprove={onApprove}
                        onReject={onReject}
                        busy={busyMap[record.id]}
                        selectable={selectable}
                        selected={selected}
                        onToggleSelect={() => onToggleSelect(record.id)}
                      />
                    )}
                  </div>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function ApprovalInboxGrid({ records, onOpen, onApprove, onReject, busyMap, eligibleIds, selectedIds, onToggleSelect }) {
  return (
    <div className="nf-approval-grid">
      {records.map((record) => {
        const selectable = eligibleIds.has(record.id)
        const selected = selectedIds.includes(record.id)
        const hasMoreActions = record.canDecide || selectable
        return (
          <article key={record.id} className={`nf-approval-card ${selected ? 'is-selected' : ''}`}>
            <div className="nf-approval-card-body">
              <div className="nf-approval-card-top">
                <span className={`nf-requests-card-icon ${requestIconTone(record.id)}`}><ListChecks aria-hidden="true" /></span>
                <span className={`nf-requests-status ${record.statusVisual.badge}`}>
                  <span aria-hidden="true" className={`nf-requests-status-dot ${record.statusVisual.dot}`} />
                  {record.status}
                </span>
              </div>
              <button type="button" className="nf-requests-card-title" onClick={() => onOpen(record.id)}>{record.title}</button>
              <p className="nf-requests-card-meta">{record.reference} · {record.department}</p>
              <dl className="nf-approval-card-facts">
                <div><dt>Requester</dt><dd>{record.requester}</dd></div>
                <div><dt>SLA / due</dt><dd><span className={`nf-approval-due ${record.due.tone}`}>{record.due.label}</span></dd></div>
                <div className="nf-approval-card-step"><dt>Current step</dt><dd>{record.currentStep}</dd></div>
              </dl>
            </div>
            <footer className="nf-approval-card-footer">
              <button type="button" className="nf-requests-primary-action" onClick={() => onOpen(record.id)}>{record.actionLabel}</button>
              {hasMoreActions && (
                <ApprovalMoreMenu
                  record={record}
                  onApprove={onApprove}
                  onReject={onReject}
                  busy={busyMap[record.id]}
                  selectable={selectable}
                  selected={selected}
                  onToggleSelect={() => onToggleSelect(record.id)}
                />
              )}
            </footer>
          </article>
        )
      })}
    </div>
  )
}

function ApprovalEmptyState({ scope, onFill }) {
  if (scope === 'team') {
    return (
      <div className="nf-approval-empty">
        <span className="nf-approval-empty-icon"><UsersRound aria-hidden="true" /></span>
        <h2>No team approvals need attention</h2>
        <p>Team approvals within your access scope appear here.</p>
      </div>
    )
  }
  if (scope === 'submitted') {
    return (
      <div className="nf-approval-empty">
        <span className="nf-approval-empty-icon"><FileText aria-hidden="true" /></span>
        <h2>No submitted requests yet</h2>
        <p>Requests you submit appear here while they move through approval.</p>
        <button type="button" className="nf-button nf-button-primary" onClick={onFill}><Plus aria-hidden="true" />Fill form</button>
      </div>
    )
  }
  return (
    <div className="nf-approval-empty">
      <span className="nf-approval-empty-icon"><CheckCircle2 aria-hidden="true" /></span>
      <h2>No approvals need attention</h2>
      <p>New decisions assigned to you will appear here.</p>
    </div>
  )
}

function RequestStatCard({ label, value, hint, icon: Icon, tone = 'blue' }) {
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

function TaskInbox() {
  const navigate = useNavigate()
  const tasks = useTasks()
  const me = useUser()
  const isApprover = isApproverRole(me)
  const approvalInbox = isApprover
  const leadsTeam = canViewTeam(me)
  const meId = me?._id ? String(me._id) : null
  const [searchParams, setSearchParams] = useSearchParams()

  // Approvers default to their approval queue; everyone else to their requests.
  // ?scope=team lets the ops dashboard and Team page deep-link into the tab.
  const [scope, setScope] = useState(() => {
    const wanted = searchParams.get('scope')
    if (wanted === 'team' && leadsTeam) return 'team'
    if (wanted === 'assigned' && isApprover) return 'assigned'
    if (wanted === 'submitted') return 'submitted'
    return isApprover ? 'assigned' : 'submitted'
  })
  const [filter, setFilter] = useState('All tasks')
  const [sort, setSort] = useState(() => scope === 'submitted' ? 'date_desc' : 'due')
  const [query, setQuery] = useState('')
  const [busyMap, setBusyMap] = useState({})
  const [selectedIds, setSelectedIds] = useState([])
  const [bulkBusy, setBulkBusy] = useState(false)
  const [page, setPage] = useState(1)
  const [viewMode, setViewMode] = useState(() => { try { return localStorage.getItem('netflow.requests.view') || 'list' } catch { return 'list' } })
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [teamTasks, setTeamTasks] = useState([])
  const [teamLoading, setTeamLoading] = useState(false)

  useEffect(() => {
    tasksStore.refresh().catch((e) => setError(e.message)).finally(() => setLoading(false))
  }, [])

  // The team's work is not in the personal store — it is a different query — so
  // it is fetched on demand the first time the tab is opened.
  const loadTeamTasks = useCallback(() => {
    setTeamLoading(true)
    return api.get('/api/tasks/my-tasks?scope=team')
      .then((res) => setTeamTasks((res.tasks || []).map(adaptTask).filter(Boolean)))
      .catch((err) => setError(err.message || "Could not load your team's requests"))
      .finally(() => setTeamLoading(false))
  }, [])

  useEffect(() => {
    if (scope !== 'team' || !leadsTeam) return undefined
    const timer = window.setTimeout(loadTeamTasks, 0)
    return () => window.clearTimeout(timer)
  }, [scope, leadsTeam, loadTeamTasks])

  const refresh = () => (scope === 'team' ? loadTeamTasks() : tasksStore.refresh())

  // Keep the URL honest so the tab survives a refresh or a shared link.
  useEffect(() => {
    const current = searchParams.get('scope')
    if (current === scope) return
    const next = new URLSearchParams(searchParams)
    next.set('scope', scope)
    setSearchParams(next, { replace: true })
  }, [scope, searchParams, setSearchParams])

  const openTask = (id) => navigate(`/tasks/${id}`)

  const handleAction = async (id, action) => {
    if (action === 'reject') {
      const ok = await confirm({
        title: 'Reject this request?',
        message: 'The requester is notified straight away. Open the request instead if you want to add a reason.',
        confirmLabel: 'Reject',
        danger: true,
      })
      if (!ok) return
    }
    setBusyMap((m) => ({ ...m, [id]: action }))
    setError('')
    try {
      if (action === 'approve') await tasksStore.approve(id)
      else await tasksStore.reject(id)
      await tasksStore.refresh()
    } catch (err) {
      setError(err.message || 'Action failed')
    } finally {
      setBusyMap((m) => {
        const next = { ...m }
        delete next[id]
        return next
      })
    }
  }

  const handleDelete = async (id) => {
    const ok = await confirm({
      title: 'Delete request?',
      message: 'Permanently delete this request and its history? This cannot be undone.',
      confirmLabel: 'Delete',
      danger: true,
    })
    if (!ok) return
    setBusyMap((m) => ({ ...m, [id]: 'delete' }))
    setError('')
    try {
      await tasksStore.deleteRequest(id)
    } catch (err) {
      setError(err.message || 'Delete failed')
    } finally {
      setBusyMap((m) => {
        const next = { ...m }
        delete next[id]
        return next
      })
    }
  }

  // Scope first (assigned to me / submitted by me / my team's), then the status
  // filter. The team scope comes from its own request, the other two are slices
  // of the personal store.
  const scoped = useMemo(() => {
    if (scope === 'team') return teamTasks
    if (!meId) return tasks
    const list = tasks.filter((t) =>
      scope === 'assigned'
        ? String(t.assignedToId) === meId
        : String(t.submittedById) === meId
    )
    // Employees' "My requests" are ordered by submission date/time, newest first.
    if (scope === 'submitted') {
      const sortedList = [...list].sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))
      const execMap = new Map()
      for (const t of sortedList) {
        if (!t.executionId) {
          execMap.set(t.id, t)
          continue
        }
        if (!execMap.has(t.executionId)) {
          execMap.set(t.executionId, t)
        }
      }
      return Array.from(execMap.values())
    }
    return list
  }, [tasks, teamTasks, scope, meId])

  const byFilter = useMemo(() => {
    switch (filter) {
      case 'Pending':      return scoped.filter((t) => t.status === 'Pending')
      case 'SLA breached': return scoped.filter((t) => t.slaBreached || t.status === 'Escalated' || t.dueInMinutes < 0)
      case 'Approved':     return scoped.filter((t) => t.status === 'Approved')
      case 'Rejected':     return scoped.filter((t) => t.status === 'Rejected')
      default:             return scoped
    }
  }, [scoped, filter])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return byFilter
    return byFilter.filter((t) =>
      [t.title, t.detail, t.requester, t.approver, t.workflow, t.department]
        .some((v) => String(v || '').toLowerCase().includes(q))
    )
  }, [byFilter, query])

  const sortedFiltered = useMemo(() => {
    const updatedAt = (task) => new Date(task.updatedAt || task.createdAt || 0).getTime()
    const dueAt = (task) => {
      const value = task.dueDate ? new Date(task.dueDate).getTime() : Number.POSITIVE_INFINITY
      return Number.isFinite(value) ? value : Number.POSITIVE_INFINITY
    }
    const byName = (a, b) => (a.title || '').localeCompare(b.title || '')
    const copy = [...filtered]
    switch (sort) {
      case 'due':       return copy.sort((a, b) => dueAt(a) - dueAt(b) || updatedAt(b) - updatedAt(a))
      case 'date_asc':  return copy.sort((a, b) => updatedAt(a) - updatedAt(b))
      case 'name_asc':  return copy.sort(byName)
      case 'name_desc': return copy.sort((a, b) => byName(b, a))
      case 'status':    return copy.sort((a, b) => requestStatus(a).localeCompare(requestStatus(b)) || updatedAt(b) - updatedAt(a))
      default:          return copy.sort((a, b) => updatedAt(b) - updatedAt(a))
    }
  }, [filtered, sort])

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const safePage = Math.min(page, totalPages)
  const visibleTasks = useMemo(
    () => sortedFiltered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE),
    [sortedFiltered, safePage]
  )
  const requestRecords = useMemo(() => visibleTasks.map(toRequestRecord), [visibleTasks])
  const approvalRecords = useMemo(
    () => visibleTasks.map((task) => toApprovalRecord(
      task,
      scope === 'assigned'
    )),
    [visibleTasks, scope]
  )
  const submittedRequestRecords = useMemo(
    () => (scope === 'submitted' ? scoped.map(toRequestRecord) : []),
    [scope, scoped]
  )
  const requestSummary = useMemo(() => {
    const inProgress = new Set(['Pending', 'In review', 'Escalated'])
    const completed = new Set(['Approved', 'Completed'])
    return {
      total: submittedRequestRecords.length,
      inProgress: submittedRequestRecords.filter((request) => inProgress.has(request.status)).length,
      attention: submittedRequestRecords.filter((request) => request.status === 'Changes requested').length,
      completed: submittedRequestRecords.filter((request) => completed.has(request.status)).length,
    }
  }, [submittedRequestRecords])
  const updateView = (next) => { setViewMode(next); try { localStorage.setItem('netflow.requests.view', next) } catch { /* optional preference */ } }
  const changeScope = (next) => {
    setScope(next)
    setSort(next === 'submitted' ? 'date_desc' : 'due')
    setPage(1)
    setSelectedIds([])
  }
  const changeQuery = (next) => {
    setQuery(next)
    setPage(1)
    setSelectedIds([])
  }
  const changeFilter = (next) => {
    setFilter(next)
    setPage(1)
    setSelectedIds([])
  }
  const changeSort = (next) => {
    setSort(next)
    setPage(1)
  }

  // Group the visible tasks by department, departments sorted alphabetically,
  // and within each department by submission date/time (newest first).
  const groups = useMemo(() => {
    const byDate = (a, b) => new Date(a.updatedAt || a.createdAt || 0) - new Date(b.updatedAt || b.createdAt || 0)
    const byName = (a, b) => (a.title || '').localeCompare(b.title || '')
    const sortItems = (arr) => {
      const copy = [...arr]
      switch (sort) {
        case 'date_asc':  return copy.sort(byDate)
        case 'name_asc':  return copy.sort(byName)
        case 'name_desc': return copy.sort((a, b) => byName(b, a))
        case 'status':    return copy.sort((a, b) => (a.status || '').localeCompare(b.status || '') || byDate(b, a))
        default:          return copy.sort((a, b) => byDate(b, a)) // date_desc — newest first
      }
    }

    const byDept = new Map()
    for (const t of visibleTasks) {
      const dept = t.department || 'General'
      if (!byDept.has(dept)) byDept.set(dept, [])
      byDept.get(dept).push(t)
    }
    return [...byDept.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([department, items]) => ({ department, items: sortItems(items) }))
  }, [visibleTasks, sort])

  // Bulk approve only ever touches rows the user can actually act on.
  const bulkEligible = useMemo(
    () =>
      scope === 'assigned'
        ? filtered.filter((t) => t.status === 'Pending' && t.actionType === 'approval' && String(t.assignedToId) === meId)
        : [],
    [filtered, scope, meId]
  )
  const eligibleIds = useMemo(() => new Set(bulkEligible.map((t) => t.id)), [bulkEligible])
  const selected = useMemo(() => selectedIds.filter((id) => eligibleIds.has(id)), [selectedIds, eligibleIds])

  const toggleSelect = (id) =>
    setSelectedIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]))

  const handleBulkApprove = async () => {
    if (selected.length === 0) return
    const ok = await confirm({
      title: `Approve ${selected.length} ${selected.length === 1 ? 'task' : 'tasks'}?`,
      message: 'Each one is approved without a comment. Open a task individually if you need to add one.',
      confirmLabel: `Approve ${selected.length}`,
    })
    if (!ok) return
    setBulkBusy(true)
    setError('')
    const failures = []
    for (const id of selected) {
      try {
        await tasksStore.approve(id)
      } catch (err) {
        failures.push(err.message || 'Unknown error')
      }
    }
    await tasksStore.refresh().catch(() => {})
    setSelectedIds([])
    setBulkBusy(false)
    if (failures.length) {
      setError(
        `${selected.length - failures.length} of ${selected.length} approved. ${failures.length} failed: ${failures[0]}`
      )
    }
  }

  const tabs = approvalInbox
    ? [
        { key: 'assigned', label: 'Assigned to me' },
        { key: 'submitted', label: 'Submitted by me' },
        ...(leadsTeam ? [{ key: 'team', label: 'Team approvals' }] : []),
      ]
    : [{ key: 'submitted', label: 'My requests' }]

  // "My requests" tab shows things you submitted (requests); "Assigned to me"
  // shows approvals routed to you (tasks); "My team" shows what the people you
  // lead have in flight. Title + counts follow the active tab.
  const onRequests = scope === 'submitted'
  const onTeam = scope === 'team'
  const employeeRequests = onRequests && !approvalInbox
  const itemNoun = onRequests || onTeam ? 'request' : 'task'

  const scopeTabs = (
    <div className={approvalInbox ? 'nf-approval-scope-tabs' : 'nf-requests-scope-tabs'} role="tablist" aria-label="Inbox scope">
      {tabs.map((tab) => (
        <button
          key={tab.key}
          id={`inbox-tab-${tab.key}`}
          type="button"
          role="tab"
          onClick={() => changeScope(tab.key)}
          aria-selected={scope === tab.key}
          aria-controls={`inbox-panel-${tab.key}`}
          className={scope === tab.key ? 'is-active' : ''}
        >
          {tab.label}
        </button>
      ))}
    </div>
  )

  const actions = approvalInbox || onRequests ? (
    <button type="button" onClick={() => navigate('/forms')} className="nf-button nf-button-primary">
      <Plus aria-hidden="true" className="h-4 w-4" />
      Fill form
    </button>
  ) : (
    <>
      <label className="sr-only" htmlFor="task-search">Search {itemNoun}s</label>
      <input
        id="task-search"
        type="search"
        value={query}
        onChange={(e) => changeQuery(e.target.value)}
        placeholder={`Search ${itemNoun}s…`}
        className="text-sm px-3 py-1.5 w-44 lg:w-56 rounded-md border border-line bg-surface text-fg focus:outline-none focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400 transition"
      />
      {scopeTabs}
      <select
        value={filter}
        onChange={(e) => changeFilter(e.target.value)}
        className="text-sm px-3 py-1.5 rounded-md border border-line bg-surface text-fg hover:bg-surface-2 focus:outline-none focus:ring-2 focus:ring-indigo-200 transition"
      >
        {TASK_FILTERS.map((f) => <option key={f}>{f}</option>)}
      </select>
      <select
        value={sort}
        onChange={(e) => changeSort(e.target.value)}
        aria-label="Sort requests"
        className="text-sm px-3 py-1.5 rounded-md border border-line bg-surface text-fg hover:bg-surface-2 focus:outline-none focus:ring-2 focus:ring-indigo-200 transition"
      >
        {SORTS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
      </select>
      <button
        type="button"
        onClick={refresh}
        className="text-sm px-3 py-1.5 rounded-md border border-line bg-surface text-fg hover:bg-surface-2 transition"
        title="Refresh"
      >
        Refresh
      </button>
      <ViewToggle value={viewMode} onChange={updateView} label="Requests layout" />
    </>
  )

  const requestToolbar = (
    <div className="nf-requests-toolbar">
      <div className="nf-requests-toolbar-fields">
        <label className="nf-requests-search" htmlFor="task-search">
          <Search aria-hidden="true" />
          <span className="sr-only">Search requests</span>
          <input
            id="task-search"
            type="search"
            value={query}
            onChange={(event) => changeQuery(event.target.value)}
            placeholder="Search requests"
          />
        </label>
        <select value={filter} onChange={(event) => changeFilter(event.target.value)} aria-label="Filter requests by status">
          <option value="All tasks">All statuses</option>
          {TASK_FILTERS.filter((option) => option !== 'All tasks').map((option) => <option key={option}>{option}</option>)}
        </select>
        <select value={sort} onChange={(event) => changeSort(event.target.value)} aria-label="Sort requests">
          {SORTS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
      </div>
      <ViewToggle value={viewMode} onChange={updateView} label="Requests layout" />
    </div>
  )
  const approvalToolbar = (
    <div className="nf-approval-toolbar">
      <div className="nf-approval-toolbar-fields">
        <label className="nf-approval-search" htmlFor="task-search">
          <Search aria-hidden="true" />
          <span className="sr-only">Search requests</span>
          <input
            id="task-search"
            type="search"
            value={query}
            onChange={(event) => changeQuery(event.target.value)}
            placeholder="Search requests"
          />
        </label>
        <select value={filter} onChange={(event) => changeFilter(event.target.value)} aria-label="Filter requests by status">
          <option value="All tasks">All statuses</option>
          {TASK_FILTERS.filter((option) => option !== 'All tasks').map((option) => <option key={option}>{option}</option>)}
        </select>
        <select value={sort} onChange={(event) => changeSort(event.target.value)} aria-label="Sort requests">
          {(onRequests ? SORTS : APPROVAL_SORTS).map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
      </div>
      <ViewToggle value={viewMode} onChange={updateView} label="Approval inbox layout" />
    </div>
  )
  const requestMetricValue = (value) => (loading && tasks.length === 0 ? '—' : value)

  return (
    <AppShell
      title={approvalInbox ? 'Approval inbox' : onTeam ? "My team's requests" : onRequests ? 'My requests' : 'Task inbox'}
      subtitle={
        approvalInbox
          ? 'Prioritize assigned decisions by SLA, status, and current step.'
          : onRequests
          ? 'Track submitted requests and respond when a workflow needs more information.'
          : query.trim()
          ? `${filtered.length} of ${byFilter.length} ${itemNoun}s match`
          : `${filtered.length} ${filtered.length === 1 ? itemNoun : itemNoun + 's'} shown`
      }
      actions={actions}
    >
      <div className={approvalInbox ? 'nf-approval-page' : onRequests ? 'nf-requests-page' : ''}>
      {approvalInbox ? scopeTabs : onRequests && tabs.length > 1 ? scopeTabs : null}
      <div
        id={`inbox-panel-${scope}`}
        role={approvalInbox ? 'tabpanel' : undefined}
        aria-labelledby={approvalInbox ? `inbox-tab-${scope}` : undefined}
      >
      {employeeRequests ? (
        <section className="nf-forms-metrics nf-requests-metrics" aria-label="Request status overview">
          <RequestStatCard
            label="Total requests"
            value={requestMetricValue(requestSummary.total)}
            hint="All submitted requests"
            icon={FileText}
          />
          <RequestStatCard
            label="In progress"
            value={requestMetricValue(requestSummary.inProgress)}
            hint="Pending or under review"
            icon={Clock3}
            tone="teal"
          />
          <RequestStatCard
            label="Needs attention"
            value={requestMetricValue(requestSummary.attention)}
            hint="Waiting for your response"
            icon={AlertTriangle}
            tone="amber"
          />
          <RequestStatCard
            label="Completed"
            value={requestMetricValue(requestSummary.completed)}
            hint="Approved or completed"
            icon={CheckCircle2}
            tone="purple"
          />
        </section>
      ) : null}
      {employeeRequests ? requestToolbar : null}
      {approvalInbox ? approvalToolbar : null}
      {error && <AlertBanner className="mb-4" onRetry={refresh}>{error}</AlertBanner>}

      {approvalInbox && selected.length > 0 && (
        <div className="nf-approval-bulkbar">
          <label className="flex items-center gap-2 text-sm text-fg">
            <input
              type="checkbox"
              checked={selected.length === bulkEligible.length && bulkEligible.length > 0}
              onChange={(e) => setSelectedIds(e.target.checked ? bulkEligible.map((t) => t.id) : [])}
              className="w-4 h-4 rounded border-line text-indigo-600 focus:ring-indigo-400"
            />
            Select all {bulkEligible.length} pending
          </label>
          <span className="text-sm text-fg-muted">
            {selected.length > 0 ? `${selected.length} selected` : 'Nothing selected'}
          </span>
          <div className="nf-approval-bulk-actions">
            {selected.length > 0 && (
              <button
                type="button"
                onClick={() => setSelectedIds([])}
                className="text-sm px-3 py-1.5 rounded-md border border-line text-fg hover:bg-surface-2 transition"
              >
                Clear
              </button>
            )}
            <button
              type="button"
              onClick={handleBulkApprove}
              disabled={selected.length === 0 || bulkBusy}
              className="text-sm px-3 py-1.5 rounded-md bg-success-solid text-white font-semibold hover:brightness-110 disabled:opacity-50 disabled:cursor-not-allowed shadow-sm transition"
            >
              {bulkBusy ? 'Approving…' : `Approve ${selected.length || ''}`.trim()}
            </button>
          </div>
        </div>
      )}

          {(loading && tasks.length === 0) || (onTeam && teamLoading && teamTasks.length === 0) ? (
            approvalInbox || onRequests ? (
              <SubmittedRequestsSkeleton viewMode={viewMode} />
            ) : (
              <div className="bg-surface border border-line rounded-lg divide-y divide-line">
                {Array.from({ length: 6 }).map((_, i) => <ListRowSkeleton key={i} />)}
              </div>
            )
          ) : filtered.length === 0 ? (
            <div className={approvalInbox ? 'nf-approval-empty-shell' : onRequests ? 'nf-requests-empty' : 'bg-surface border border-dashed border-line rounded-lg py-16'}>
              {query.trim() ? (
                <EmptyState
                  title={`Nothing matches “${query.trim()}”`}
                  description="Try a shorter search term, or clear it to see everything."
                  action={
                    <button type="button" onClick={() => changeQuery('')} className="text-xs text-indigo-600 hover:text-indigo-700 font-medium">
                      Clear search
                    </button>
                  }
                />
              ) : filter !== 'All tasks' ? (
                <EmptyState
                  title="Nothing matches this filter"
                  description="Try a different filter to see more."
                  action={
                    <button type="button" onClick={() => changeFilter('All tasks')} className="text-xs text-indigo-600 hover:text-indigo-700 font-medium">
                      Show all
                    </button>
                  }
                />
              ) : approvalInbox ? (
                <ApprovalEmptyState scope={scope} onFill={() => navigate('/forms')} />
              ) : onTeam ? (
                <EmptyState
                  title="Nothing from your team"
                  description="Requests raised by the people who report to you show up here while they move through approvals."
                />
              ) : scope === 'submitted' ? (
                <EmptyState
                  title="No requests yet"
                  description="You haven't submitted any requests yet. Fill out a form to get started."
                  action={
                    <button type="button" onClick={() => navigate('/forms')} className="nf-button nf-button-primary">
                      <Plus aria-hidden="true" className="h-4 w-4" />
                      Fill form
                    </button>
                  }
                />
              ) : (
                <EmptyState title="You're all caught up" description="Nothing is waiting on your approval right now." />
              )}
            </div>
          ) : approvalInbox && !onRequests ? (
            <div className="nf-approval-results">
              {viewMode === 'grid' ? (
                <ApprovalInboxGrid
                  records={approvalRecords}
                  onOpen={openTask}
                  onApprove={(id) => handleAction(id, 'approve')}
                  onReject={(id) => handleAction(id, 'reject')}
                  busyMap={busyMap}
                  eligibleIds={eligibleIds}
                  selectedIds={selected}
                  onToggleSelect={toggleSelect}
                />
              ) : (
                <ApprovalInboxTable
                  records={approvalRecords}
                  onOpen={openTask}
                  onApprove={(id) => handleAction(id, 'approve')}
                  onReject={(id) => handleAction(id, 'reject')}
                  busyMap={busyMap}
                  eligibleIds={eligibleIds}
                  selectedIds={selected}
                  onToggleSelect={toggleSelect}
                />
              )}
              <div className="nf-approval-pagination">
                <Pagination page={safePage} pageSize={PAGE_SIZE} total={filtered.length} onPageChange={setPage} noun={onTeam ? 'team approvals' : 'approvals'} />
              </div>
            </div>
          ) : onRequests ? (
            <div className={`nf-requests-results ${approvalInbox ? 'nf-approval-submitted-results' : ''}`}>
              {viewMode === 'grid' ? (
                <SubmittedRequestsGrid requests={requestRecords} onOpen={openTask} onDelete={handleDelete} busyMap={busyMap} />
              ) : (
                <SubmittedRequestsTable requests={requestRecords} onOpen={openTask} onDelete={handleDelete} busyMap={busyMap} />
              )}
              <div className="nf-requests-pagination">
                <Pagination page={safePage} pageSize={PAGE_SIZE} total={filtered.length} onPageChange={setPage} noun="requests" />
              </div>
            </div>
          ) : (
            <div className="space-y-6">
              {groups.map((group) => (
                <div key={group.department}>
                  <div className="flex items-center gap-2 mb-2 px-1">
                    <h2 className="text-xs font-semibold tracking-wider text-fg-muted uppercase">
                      {group.department}
                    </h2>
                    <span className="text-[11px] font-medium text-fg-subtle bg-surface-3 rounded-full px-1.5 py-0.5 min-w-[18px] text-center">
                      {group.items.length}
                    </span>
                    <div className="flex-1 h-px bg-surface-3" />
                  </div>
                  <div className={viewMode === 'grid' ? 'grid grid-cols-1 xl:grid-cols-2 gap-3' : 'space-y-3'}>
                    {group.items.map((task) => (
                      <TaskCard
                        key={task.id}
                        task={task}
                        onOpen={openTask}
                        onApprove={(id) => handleAction(id, 'approve')}
                        onReject={(id) => handleAction(id, 'reject')}
                        busy={busyMap[task.id]}
                        canAct={scope === 'assigned' && String(task.assignedToId) === meId}
                        showApprover={scope !== 'assigned'}
                        canDelete={scope === 'submitted' && String(task.submittedById) === meId && isRequestFinished(task)}
                        onDelete={handleDelete}
                        selectable={bulkEligible.length > 1 && eligibleIds.has(task.id)}
                        selected={selected.includes(task.id)}
                        onToggleSelect={toggleSelect}
                      />
                    ))}
                  </div>
                </div>
              ))}

              <div className="nf-panel overflow-hidden"><Pagination page={safePage} pageSize={PAGE_SIZE} total={filtered.length} onPageChange={setPage} noun={scope === 'assigned' ? 'approvals' : 'requests'} /></div>
            </div>
          )}
      </div>
      </div>
    </AppShell>
  )
}

export default TaskInbox
