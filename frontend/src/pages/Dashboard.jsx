// Shared - Phase 2 - Dashboard.jsx
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import AppShell from '../components/AppShell'

import { useUser } from '../utils/auth'
import { canViewReports, isOrgAdmin, isSuperAdmin, isOpsLeader } from '../utils/permissions'

import { useTasks, tasksStore } from '../lib/tasksStore'
import { Skeleton, StatCardSkeleton, ListRowSkeleton } from '../components/Skeleton'
import EmptyState from '../components/EmptyState'
import { AlertBanner } from '../components/Alert'
import { statusBadge } from '../utils/badges'
import PlatformOverview from './PlatformOverviewEnterprise'
import OpsDashboard from './OpsDashboard'
import AdminDashboard from './AdminDashboard'

// ---------- helpers -------------------------------------------------------

function timeAgo(iso) {
  if (!iso) return ''
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

// Parse an ISO date string (YYYY-MM-DD) at local noon to avoid timezone drift.





// ---------- top stat cards ------------------------------------------------



function Panel({ title, subtitle, action, children, className = '', bodyClass = 'p-5' }) {
  return (
    <section className={`bg-surface border border-line rounded-xl shadow-sm overflow-hidden flex flex-col min-h-0 ${className}`}>
      {(title || action) && (
        <div className="shrink-0 px-5 py-3.5 border-b border-line bg-surface-2/40 flex items-start justify-between gap-3">
          {title ? (
            <div className="min-w-0">
              <h2 className="text-sm font-semibold text-fg">{title}</h2>
              {subtitle ? <p className="mt-0.5 text-xs text-fg-muted leading-snug">{subtitle}</p> : null}
            </div>
          ) : <span />}
          {action}
        </div>
      )}
      <div className={`flex-1 min-h-0 ${bodyClass}`}>{children}</div>
    </section>
  )
}



// ---------- workflow activity chart (multi-line SVG) ----------------------





// ---------- recent requests -----------------------------------------------





// ---------- bottom 4 cards ------------------------------------------------

// Tasks overview — donut
function DonutChart({ segments, total, label = 'Total Tasks' }) {
  const R = 36, CX = 50, CY = 50, STROKE = 13
  const circumference = 2 * Math.PI * R
  if (total === 0) {
    return (
      <svg aria-hidden="true" width={90} height={90} viewBox="0 0 100 100" className="shrink-0">
        <circle cx={CX} cy={CY} r={R} fill="none" stroke="var(--color-surface-3)" strokeWidth={STROKE} />
        <text x={CX} y={CY + 4} textAnchor="middle" fontSize="14" fontWeight="700" fill="var(--color-fg)">0</text>
      </svg>
    )
  }
  return (
    <svg aria-hidden="true" width={90} height={90} viewBox="0 0 100 100" className="shrink-0">
      <circle cx={CX} cy={CY} r={R} fill="none" stroke="var(--color-surface-3)" strokeWidth={STROKE} />
      {segments.map((s, i) => {
        if (s.value === 0) return null
        const len = (s.value / total) * circumference
        const preceding = segments.slice(0, i).reduce((sum, item) => sum + item.value, 0)
        const segmentOffset = (preceding / total) * circumference
        return (
          <circle key={i} cx={CX} cy={CY} r={R} fill="none" stroke={s.color} strokeWidth={STROKE}
            strokeDasharray={`${len} ${circumference - len}`} strokeDashoffset={-segmentOffset}
            transform={`rotate(-90 ${CX} ${CY})`} />
        )
      })}
      <text x={CX} y={CY - 2} textAnchor="middle" fontSize="15" fontWeight="700" fill="var(--color-fg)">{total}</text>
      <text x={CX} y={CY + 11} textAnchor="middle" fontSize="7" fill="var(--color-fg-subtle)">{label}</text>
    </svg>
  )
}



// Approval rate — half-circle gauge











// ---------- inline icons --------------------------------------------------


function IconCheck(p) { return <svg {...p} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5"><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg> }





// ---------- builder (admin/manager) dashboard -----------------------------



// ---------- employee dashboard --------------------------------------------

// A single workflow run (one "request") produces one Task per approval step,
// all sharing a workflowExecutionId. Group them so each request counts once and
// derives one overall status + progress.
function groupRequests(tasks, myId) {
  const mine = tasks.filter((t) => (myId ? t.submittedById === myId : true))
  const byExec = new Map()
  for (const t of mine) {
    const key = t._raw?.workflowExecutionId ? String(t._raw.workflowExecutionId) : t.id
    if (!byExec.has(key)) byExec.set(key, [])
    byExec.get(key).push(t)
  }

  const requests = []
  for (const [key, group] of byExec) {
    const sorted = [...group].sort((a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0))
    const first = sorted[0]
    const last = sorted[sorted.length - 1]

    // The /my-tasks endpoint attaches the same execution-wide approval chain to
    // every task in the group, so any non-empty one describes the whole request.
    const chain = sorted.find((t) => (t.approvalChain || []).length > 0)?.approvalChain || []

    let status
    let progress
    if (chain.length > 0) {
      const approved = chain.filter((s) => s.status === 'approved').length
      if (chain.some((s) => s.status === 'rejected')) { status = 'Rejected'; progress = 100 }
      else if (approved === chain.length)             { status = 'Approved'; progress = 100 }
      else if (approved > 0)                          { status = 'In Review'; progress = Math.round((approved / chain.length) * 100) }
      else                                            { status = 'Pending';   progress = 0 }
    } else {
      const statuses = sorted.map((t) => t.status)
      const approvedCount = statuses.filter((s) => s === 'Approved').length
      if (statuses.includes('Rejected')) status = 'Rejected'
      else if (statuses.includes('Pending') || statuses.includes('Escalated')) status = approvedCount > 0 ? 'In Review' : 'Pending'
      else if (approvedCount > 0) status = 'Approved'
      else status = 'Pending'
      progress = status === 'Approved' ? 100 : status === 'Rejected' ? 100 : status === 'In Review' ? 60 : 25
    }

    const isExec = !!first._raw?.workflowExecutionId
    const refId = `${isExec ? 'EX' : 'REQ'}-${String(key).slice(-6).toUpperCase()}`

    requests.push({
      key,
      title: (first.title || 'Request').replace(/\s*—\s*Approval Required\s*$/i, ''),
      category: first.department || first.workflow || 'Request',
      createdAt: first.createdAt,
      latestAt: last.createdAt || first.createdAt,
      status,
      progress,
      chain,
      refId,
      latestTaskId: last.id,
    })
  }
  return requests.sort((a, b) => new Date(b.latestAt || 0) - new Date(a.latestAt || 0))
}

const barColor = (status) => ({
  Approved: 'bg-success-solid',
  'In Review': 'bg-info-solid',
  Pending: 'bg-warning-solid',
  Rejected: 'bg-danger-solid',
}[status] || 'bg-fg-subtle')

const ACTIVITY_VERB = {
  Approved: 'was approved',
  Rejected: 'was rejected',
  'In Review': 'is under review',
  Pending: 'was submitted',
}

function EmployeeMetricCard({ icon: Icon, iconClass, iconWrapClass, label, value, hint, loading }) {
  if (loading) return <StatCardSkeleton />

  return (
    <article className="nf-panel relative min-h-[116px] overflow-hidden p-4 sm:p-[18px]">
      <span
        aria-hidden="true"
        className={`absolute -bottom-10 -right-7 h-24 w-24 rounded-full opacity-45 ${iconWrapClass}`}
      />
      <div className="relative z-10 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-fg-muted">{label}</p>
          <p className="mt-3 text-[28px] font-bold leading-none tabular-nums text-fg">{value}</p>
          <p className="mt-2 text-[11px] leading-snug text-fg-muted">{hint}</p>
        </div>
        <span className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] ${iconWrapClass}`}>
          <Icon aria-hidden="true" className={`h-[18px] w-[18px] ${iconClass}`} />
        </span>
      </div>
    </article>
  )
}

// Compact employee metrics — all derived from the signed-in user's real requests.
function EmployeeStats({ requests, needsAttention, loading }) {
  const now = new Date()
  const isThisMonth = (iso) => {
    if (!iso) return false
    const d = new Date(iso)
    return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear()
  }
  const submitted   = requests.filter((r) => isThisMonth(r.createdAt)).length
  const active      = requests.filter((r) => r.status === 'Pending' || r.status === 'In Review').length
  const completed   = requests.filter((r) => r.status === 'Approved' && isThisMonth(r.latestAt || r.createdAt)).length

  const cards = [
    { label: 'Action required', value: needsAttention, icon: IconAlert, iconWrapClass: 'bg-warning-subtle', iconClass: 'text-warning-fg', hint: 'Items needing your response' },
    { label: 'Active requests', value: active, icon: IconDoc, iconWrapClass: 'bg-info-subtle', iconClass: 'text-info-fg', hint: 'Pending or under review' },
    { label: 'Submitted', value: submitted, icon: IconSend, iconWrapClass: 'bg-violet-50 dark:bg-violet-500/15', iconClass: 'text-violet-600 dark:text-violet-300', hint: 'Created this month' },
    { label: 'Completed', value: completed, icon: IconCheck, iconWrapClass: 'bg-success-subtle', iconClass: 'text-success-fg', hint: 'Approved this month' },
  ]
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {cards.map((card) => (
        <EmployeeMetricCard
          key={card.label}
          {...card}
          loading={loading && requests.length === 0}
        />
      ))}
    </div>
  )
}

function MyRequestsList({ requests, loading }) {
  const navigate = useNavigate()
  const rows = requests.slice(0, 6)
  return (
    <Panel
      title="My Requests"
      subtitle="Track the latest status of requests you submitted."
      className="min-h-[360px]"
      bodyClass="p-0"
      action={(
        <Link
          to="/tasks"
          className="rounded-md px-2 py-1 text-xs font-semibold text-info-fg transition hover:bg-info-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
        >
          View all
        </Link>
      )}
    >
      {loading && rows.length === 0 ? (
        <ul className="divide-y divide-line" aria-label="Loading your requests">
          {Array.from({ length: 5 }).map((_, i) => <li key={i}><ListRowSkeleton /></li>)}
        </ul>
      ) : rows.length === 0 ? (
        <EmptyState
          className="flex-1"
          title="No requests yet"
          description="Fill out a form to submit your first request — it'll show up here."
          action={
            <Link
              to="/forms"
              className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
            >
              Browse forms
            </Link>
          }
        />
      ) : (
        <ul className="divide-y divide-line" aria-label="Your recent requests">
          {rows.map((r) => {
            const styles = statusBadge(r.status)
            return (
              <li key={r.key}>
                <button
                  type="button"
                  onClick={() => navigate(`/tasks/${r.latestTaskId}`)}
                  aria-label={`Open ${r.title}, status ${r.status}`}
                  className="group flex min-h-[74px] w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500 sm:px-5"
                >
                  <span aria-hidden="true" className={`h-2 w-2 shrink-0 rounded-full ${styles.dot}`} />
                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 items-center gap-2">
                      <p className="truncate text-sm font-semibold text-fg">{r.title}</p>
                      <span className={`shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-semibold sm:hidden ${styles.badge}`}>{r.status}</span>
                    </div>
                    <p className="mt-1 truncate text-[11px] text-fg-muted">
                      {r.category} <span aria-hidden="true">·</span> {r.refId} <span aria-hidden="true">·</span> {timeAgo(r.createdAt)}
                    </p>
                  </div>
                  <div className="hidden w-32 shrink-0 sm:block">
                    <div className="mb-1 flex items-center justify-between text-[10px] text-fg-subtle">
                      <span>Progress</span>
                      <span className="tabular-nums">{r.progress}%</span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-surface-3">
                      <span className={`block h-full rounded-full ${barColor(r.status)}`} style={{ width: `${r.progress}%` }} />
                    </div>
                  </div>
                  <span className={`hidden shrink-0 rounded border px-2 py-1 text-[10px] font-semibold sm:inline-flex ${styles.badge}`}>{r.status}</span>
                  <svg aria-hidden="true" className="h-4 w-4 shrink-0 text-fg-subtle transition group-hover:translate-x-0.5 group-hover:text-fg-muted" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path strokeLinecap="round" strokeLinejoin="round" d="m9 18 6-6-6-6" />
                  </svg>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </Panel>
  )
}

// Visual treatment for a single approval-chain node's status.
function statusVisual(s) {
  switch (s) {
    case 'approved':  return { ring: 'bg-success-solid border-success-solid text-white', icon: 'check' }
    case 'rejected':  return { ring: 'bg-danger-solid border-danger-solid text-white',   icon: 'x' }
    case 'escalated': return { ring: 'bg-orange-500 border-orange-500 text-white',       icon: 'up' }
    case 'pending':   return { ring: 'bg-info-solid border-info-solid text-white',       icon: 'dot' }
    default:          return { ring: 'bg-surface border-line text-fg-subtle',        icon: 'dot' }
  }
}

function StepIcon({ kind }) {
  const cls = 'w-2.5 h-2.5'
  if (kind === 'check') return <svg className={cls} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5"><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
  if (kind === 'x')     return <svg className={cls} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5"><path strokeLinecap="round" strokeLinejoin="round" d="M6 6l12 12M18 6L6 18" /></svg>
  if (kind === 'up')    return <svg className={cls} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path strokeLinecap="round" strokeLinejoin="round" d="M12 19V5M5 12l7-7 7 7" /></svg>
  return <span className="w-1.5 h-1.5 rounded-full bg-current" />
}

// Track Status — renders the live approval chain for a selected request.
function TrackStatusCard({ requests }) {
  const navigate = useNavigate()
  const [selectedKey, setSelectedKey] = useState(null)

  const defaultReq = useMemo(
    () => requests.find((r) => r.status === 'In Review' || r.status === 'Pending') || requests[0] || null,
    [requests]
  )
  const active = requests.find((r) => r.key === selectedKey) || defaultReq

  const steps = useMemo(() => {
    if (!active) return []
    const out = [{
      key: 'submitted',
      title: 'Request submitted',
      sub: timeAgo(active.createdAt),
      vis: { ring: 'bg-indigo-500 border-indigo-500 text-white', icon: 'check' },
    }]
    for (const s of active.chain || []) {
      const norm = s.isCurrent && s.status !== 'approved' && s.status !== 'rejected' ? 'pending' : s.status
      let sub
      if (s.status === 'approved')      sub = s.decidedBy ? `Approved by ${s.decidedBy}` : 'Approved'
      else if (s.status === 'rejected') sub = s.decidedBy ? `Rejected by ${s.decidedBy}` : 'Rejected'
      else if (s.status === 'escalated') sub = 'Escalated'
      else if (norm === 'pending')      sub = `Awaiting ${s.assignee || s.roleLabel || 'approval'}`
      else                              sub = s.roleLabel ? `${s.roleLabel} · upcoming` : 'Upcoming'
      out.push({ key: s.nodeId, title: s.title || s.roleLabel || 'Approval', sub, vis: statusVisual(norm), current: s.isCurrent })
    }
    if (active.status === 'Approved') {
      out.push({ key: 'done', title: 'Completed', sub: timeAgo(active.latestAt), vis: { ring: 'bg-success-solid border-success-solid text-white', icon: 'check' } })
    }
    return out
  }, [active])

  if (!active) {
    return (
      <Panel
        title="Track status"
        subtitle="Follow each approval step from submission to completion."
        className="min-h-[360px]"
        bodyClass="p-5"
      >
        <EmptyState
          className="flex-1"
          title="Nothing to track yet"
          description="Submit a request to follow its approval progress here."
          action={
            <Link
              to="/forms"
              className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
            >
              Browse forms
            </Link>
          }
        />
      </Panel>
    )
  }

  const styles = statusBadge(active.status)

  return (
    <Panel
      title="Track status"
      subtitle="Follow each approval step from submission to completion."
      className="min-h-[360px]"
      bodyClass="flex min-h-0 flex-1 flex-col p-4 sm:p-5"
      action={<span className={`shrink-0 rounded border px-2 py-1 text-[10px] font-semibold ${styles.badge}`}>{active.status}</span>}
    >
      {requests.length > 1 && (
        <div className="mb-5">
          <label htmlFor="employee-request-tracker" className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-fg-muted">
            Selected request
          </label>
          <select
            id="employee-request-tracker"
            value={active.key}
            onChange={(e) => setSelectedKey(e.target.value)}
            className="min-h-10 w-full rounded-lg border border-line bg-surface px-3 py-2 text-xs font-medium text-fg focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            {requests.map((r) => (
              <option key={r.key} value={r.key}>{r.title} · {r.refId}</option>
            ))}
          </select>
        </div>
      )}

      <ol className="min-h-0 flex-1" aria-label={`Progress for ${active.title}`}>
        {steps.map((st, i) => (
          <li key={st.key} className="relative pb-5 pl-8 last:pb-0">
            {i < steps.length - 1 && <span aria-hidden="true" className="absolute bottom-0 left-[9px] top-5 w-px bg-line" />}
            <span aria-hidden="true" className={`absolute left-0 top-0.5 flex h-5 w-5 items-center justify-center rounded-full border ${st.vis.ring} ${st.current ? 'ring-2 ring-info-line ring-offset-2 ring-offset-surface' : ''}`}>
              <StepIcon kind={st.vis.icon} />
            </span>
            <p className="text-xs font-semibold leading-tight text-fg">{st.title}</p>
            <p className="mt-1 text-[11px] leading-snug text-fg-muted">{st.sub}</p>
          </li>
        ))}
      </ol>

      <button
        type="button"
        onClick={() => navigate(`/tasks/${active.latestTaskId}`)}
        className="mt-5 min-h-10 w-full rounded-lg border border-line bg-surface px-4 py-2 text-xs font-semibold text-fg transition hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
      >
        View details
      </button>
    </Panel>
  )
}

function RecentActivityCard({ requests }) {
  const navigate = useNavigate()
  const items = requests.slice(0, 5)
  return (
    <Panel
      title="Recent activity"
      subtitle="The latest changes across your requests."
      bodyClass="p-0"
      action={(
        <Link
          to="/tasks"
          className="rounded-md px-2 py-1 text-xs font-semibold text-info-fg transition hover:bg-info-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
        >
          View history
        </Link>
      )}
    >
      {items.length === 0 ? (
        <EmptyState
          title="No activity yet"
          description="Your recent requests and approvals will appear here."
        />
      ) : (
        <ul className="divide-y divide-line" aria-label="Recent request activity">
          {items.map((r) => {
            const styles = statusBadge(r.status)
            return (
              <li key={r.key}>
                <button
                  type="button"
                  onClick={() => navigate(`/tasks/${r.latestTaskId}`)}
                  className="flex min-h-[58px] w-full items-start gap-3 px-4 py-3 text-left transition hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500 sm:px-5"
                >
                  <span aria-hidden="true" className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${styles.dot}`} />
                  <span className="min-w-0 flex-1">
                    <span className="block text-xs leading-snug text-fg">
                      <span className="font-semibold">{r.title}</span> {ACTIVITY_VERB[r.status] || 'updated'}
                    </span>
                    <span className="mt-1 block text-[10px] text-fg-subtle">{r.refId} · {timeAgo(r.latestAt)}</span>
                  </span>
                  <span className={`shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-semibold ${styles.badge}`}>{r.status}</span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </Panel>
  )
}

function RequestSummaryCard({ requests }) {
  const navigate = useNavigate()
  const segs = useMemo(() => ([
    { label: 'Approved',  value: requests.filter((r) => r.status === 'Approved').length,  color: '#246b4a' },
    { label: 'In Review', value: requests.filter((r) => r.status === 'In Review').length, color: '#245a9a' },
    { label: 'Pending',   value: requests.filter((r) => r.status === 'Pending').length,   color: '#b8892d' },
    { label: 'Rejected',  value: requests.filter((r) => r.status === 'Rejected').length,  color: '#b23b35' },
  ]), [requests])
  const total = segs.reduce((s, x) => s + x.value, 0)
  return (
    <Panel
      title="Request summary"
      subtitle="Status distribution across all your requests."
      bodyClass="p-4 sm:p-5"
    >
      <div className="flex items-center gap-5">
        <DonutChart segments={segs} total={total} label="Requests" />
        <ul className="flex-1 space-y-2 text-xs text-fg-muted" aria-label="Request status summary">
          {segs.map((s) => (
            <li key={s.label} className="flex items-center gap-2">
              <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full" style={{ background: s.color }} />
              <span className="flex-1">{s.label}</span>
              <span className="ml-2 font-semibold tabular-nums text-fg">
                {s.value}{total > 0 ? ` (${Math.round((s.value / total) * 100)}%)` : ''}
              </span>
            </li>
          ))}
        </ul>
      </div>
      <button
        type="button"
        onClick={() => navigate('/tasks')}
        className="mt-5 min-h-10 w-full rounded-lg border border-line bg-surface px-4 py-2 text-xs font-semibold text-fg transition hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
      >
        View all requests
      </button>
    </Panel>
  )
}

function NeedsAttentionCard({ rejected, approvals, loading }) {
  const navigate = useNavigate()
  const items = [
    ...rejected.map((r) => ({
      key: `r-${r.key}`,
      title: r.title,
      note: 'Rejected — review the feedback and resubmit',
      meta: r.refId,
      taskId: r.latestTaskId,
      tone: 'danger',
    })),
    ...approvals.map((t) => ({
      key: `a-${t.id}`,
      title: (t.title || 'Task').replace(/\s*—\s*Approval Required\s*$/i, ''),
      note: 'A decision is waiting for you',
      meta: t.department || t.workflow || 'Approval',
      taskId: t.id,
      tone: 'warning',
    })),
  ]

  return (
    <section className={`nf-panel overflow-hidden ${items.length > 0 ? 'border-warning-line' : ''}`} aria-labelledby="employee-attention-heading">
      <div className={`flex items-center justify-between gap-4 border-b px-4 py-3.5 sm:px-5 ${items.length > 0 ? 'border-warning-line bg-warning-subtle' : 'border-line bg-surface-2/40'}`}>
        <div className="flex min-w-0 items-center gap-3">
          <span className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] ${items.length > 0 ? 'bg-surface text-warning-fg' : 'bg-success-subtle text-success-fg'}`}>
            {items.length > 0
              ? <IconAlert aria-hidden="true" className="h-[18px] w-[18px]" />
              : <IconCheck aria-hidden="true" className="h-[18px] w-[18px]" />}
          </span>
          <div className="min-w-0">
            <h2 id="employee-attention-heading" className="text-sm font-semibold text-fg">Needs your attention</h2>
            <p className="mt-0.5 text-[11px] leading-snug text-fg-muted">
              {items.length > 0 ? 'Handle these items first to keep work moving.' : 'Nothing is blocking your work right now.'}
            </p>
          </div>
        </div>
        <span className={`inline-flex min-w-7 items-center justify-center rounded-full px-2 py-1 text-xs font-bold tabular-nums ${items.length > 0 ? 'bg-warning-fg text-surface' : 'bg-success-subtle text-success-fg'}`}>
          {items.length}
        </span>
      </div>

      {loading && items.length === 0 ? (
        <div className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-[76px] rounded-lg" />)}
        </div>
      ) : items.length === 0 ? (
        <div className="flex items-center gap-3 px-4 py-4 sm:px-5">
          <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-success-subtle text-success-fg">
            <IconCheck aria-hidden="true" className="h-4 w-4" />
          </span>
          <div>
            <p className="text-sm font-semibold text-fg">You're all caught up</p>
            <p className="mt-0.5 text-[11px] text-fg-muted">New decisions or returned requests will appear here.</p>
          </div>
        </div>
      ) : (
        <ul className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-3" aria-label="Items requiring your attention">
          {items.slice(0, 5).map((it) => (
            <li key={it.key}>
              <button
                type="button"
                onClick={() => navigate(`/tasks/${it.taskId}`)}
                className="group flex min-h-[76px] w-full items-center gap-3 rounded-lg border border-line bg-surface p-3 text-left transition hover:border-primary-line hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
              >
                <span className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${it.tone === 'danger' ? 'bg-danger-subtle text-danger-fg' : 'bg-warning-subtle text-warning-fg'}`}>
                  <IconAlert aria-hidden="true" className="h-4 w-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-semibold text-fg">{it.title}</p>
                  <p className={`mt-1 line-clamp-1 text-[10px] ${it.tone === 'danger' ? 'text-danger-fg' : 'text-warning-fg'}`}>{it.note}</p>
                  <p className="mt-1 truncate text-[10px] text-fg-subtle">{it.meta}</p>
                </div>
                <svg aria-hidden="true" className="h-4 w-4 shrink-0 text-fg-subtle transition group-hover:translate-x-0.5 group-hover:text-fg-muted" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="m9 18 6-6-6-6" />
                </svg>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function EmployeeDashboard({ user }) {
  const tasks = useTasks()
  const myId = user?._id || user?.id || null
  const firstName = (user?.name || 'there').split(' ')[0]

  const requests = useMemo(() => groupRequests(tasks, myId), [tasks, myId])
  const myApprovals = useMemo(
    () => tasks.filter((t) => myId && t.assignedToId === myId && (t.status === 'Pending' || t.status === 'Escalated')),
    [tasks, myId]
  )
  const rejected = useMemo(() => requests.filter((r) => r.status === 'Rejected'), [requests])
  const needsAttention = rejected.length + myApprovals.length

  const [booting, setBooting] = useState(true)
  const [loadError, setLoadError] = useState('')

  const refreshDashboard = useCallback(async () => {
    setBooting(true)
    setLoadError('')
    try {
      await tasksStore.refresh()
    } catch (err) {
      setLoadError(err?.message || 'Your dashboard data could not be loaded.')
    } finally {
      setBooting(false)
    }
  }, [])

  useEffect(() => {
    let active = true
    tasksStore.refresh()
      .catch((err) => {
        if (active) setLoadError(err?.message || 'Your dashboard data could not be loaded.')
      })
      .finally(() => {
        if (active) setBooting(false)
      })
    return () => { active = false }
  }, [])

  const subtitle = needsAttention > 0
    ? `${needsAttention} item${needsAttention === 1 ? '' : 's'} need your attention. Handle those first, then track everything else.`
    : 'You are all caught up. Track your requests and recent updates from one place.'

  return (
    <AppShell
      title={`Welcome back, ${firstName}`}
      subtitle={subtitle}
      actions={
        <Link
          to="/forms"
          className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
        >
          <svg aria-hidden="true" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 5v14M5 12h14" />
          </svg>
          Start a request
        </Link>
      }
      mainClass="flex-1 min-h-0 flex flex-col p-4 md:p-6 pb-24 md:pb-6 overflow-hidden"
    >
      <div className="mx-auto min-h-0 w-full max-w-[1440px] flex-1 space-y-4 overflow-y-auto pr-0.5 md:space-y-5">
        {loadError && tasks.length === 0 ? (
          <AlertBanner tone="error" onRetry={refreshDashboard}>
            {loadError} No request totals are shown until the real data is available.
          </AlertBanner>
        ) : (
          <>
            <EmployeeStats requests={requests} needsAttention={needsAttention} loading={booting} />

            {loadError ? (
              <AlertBanner tone="error" onRetry={refreshDashboard}>
                {loadError} Showing the most recently loaded request data.
              </AlertBanner>
            ) : null}

            <NeedsAttentionCard rejected={rejected} approvals={myApprovals} loading={booting} />

            <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.65fr)_minmax(320px,0.85fr)] xl:gap-5">
              <MyRequestsList requests={requests} loading={booting} />
              <TrackStatusCard requests={requests} />
            </div>

            <div className="grid grid-cols-1 gap-4 pb-1 lg:grid-cols-[minmax(0,1.35fr)_minmax(300px,0.65fr)] lg:gap-5">
              <RecentActivityCard requests={requests} />
              <RequestSummaryCard requests={requests} />
            </div>
          </>
        )}
      </div>
    </AppShell>
  )
}

// ---------- more inline icons ---------------------------------------------

function IconDoc(p) { return <svg {...p} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 4H7a2 2 0 01-2-2V5a2 2 0 012-2h7l4 4v11a2 2 0 01-2 2z" /></svg> }
function IconSend(p) { return <svg {...p} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" /></svg> }
function IconAlert(p) { return <svg {...p} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" /></svg> }

// ---------- role-routed page ----------------------------------------------

// One page, four shells: the platform overview, the builder view an Org Admin
// needs, the approvals-first view a leader needs, and the employee's own
// requests.
function Dashboard() {
  const user = useUser()
  if (isSuperAdmin(user)) return <PlatformOverview />
  if (isOrgAdmin(user)) return <AdminDashboard />
  if (isOpsLeader(user)) return <OpsDashboard />
  return canViewReports(user) ? <AdminDashboard /> : <EmployeeDashboard user={user} />
}

export default Dashboard
