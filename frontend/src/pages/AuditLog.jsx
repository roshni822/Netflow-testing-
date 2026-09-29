// M3 - Phase 2 - AuditLog.jsx - Live audit trail from /api/audit-logs

import { useEffect, useMemo, useState } from 'react'
import { Activity, CheckCircle2, Download, Search, TriangleAlert, XCircle } from 'lucide-react'
import AppShell from '../components/AppShell'
import { api, buildQuery } from '../utils/api'
import { useDepartmentNames } from '../lib/departmentsStore'
import { useDebouncedValue } from '../utils/useDebouncedValue'
import { formatDateTime, isoAttr } from '../utils/datetime'
import { Skeleton } from '../components/Skeleton'
import EmptyState from '../components/EmptyState'
import { AlertBanner } from '../components/Alert'
import { toast } from '../lib/toastStore'

const PAGE_SIZE = 25
// Server caps limit at 200, and an export shouldn't hammer the API forever.
const EXPORT_PAGE_SIZE = 200
const EXPORT_MAX_ROWS = 10000

const fieldCls =
  'pl-9 pr-3 py-2 w-full text-sm rounded-lg border border-line bg-surface-2 text-fg placeholder:text-fg-subtle focus:bg-surface focus:outline-none focus:ring-2 focus:ring-indigo-200 focus:border-indigo-300 transition'
const selectCls =
  'text-sm px-3 py-2 rounded-lg border border-line bg-surface text-fg focus:outline-none focus:ring-2 focus:ring-indigo-200 transition'

// These values must match the `action` enum in server/models/AuditLog.js — the
// filter is an exact match server-side, so an invented value silently returns
// nothing. Grouped the way an auditor reads them.
const ACTION_FILTERS = [
  { value: '', label: 'All actions' },
  { group: 'Approvals', options: [
    { value: 'task_submitted',   label: 'Task submitted' },
    { value: 'task_approved',    label: 'Task approved' },
    { value: 'task_rejected',    label: 'Task rejected' },
    { value: 'request_changes',  label: 'Changes requested' },
    { value: 'task_escalated',   label: 'Task escalated' },
    { value: 'approver_inferred', label: 'Approver inferred' }
  ] },
  { group: 'Workflows', options: [
    { value: 'workflow_started',   label: 'Workflow started' },
    { value: 'workflow_completed', label: 'Workflow completed' },
    { value: 'workflow_failed',    label: 'Workflow failed' },
    { value: 'workflow_cancelled', label: 'Workflow cancelled' },
    { value: 'workflow_deleted',   label: 'Workflow deleted' }
  ] },
  { group: 'Forms', options: [
    { value: 'form_submitted', label: 'Form submitted' },
    { value: 'form_deleted',   label: 'Form deleted' }
  ] },
  { group: 'People', options: [
    { value: 'user_invited',   label: 'User invited' },
    { value: 'user_updated',   label: 'User updated' },
    { value: 'user_deleted',   label: 'User deactivated' },
    { value: 'builder_access_granted', label: 'Builder access granted' },
    { value: 'builder_access_revoked', label: 'Builder access revoked' },
    { value: 'role_changed',   label: 'Role changed' },
    { value: 'users_imported', label: 'Users imported' }
  ] },
  { group: 'Organization', options: [
    { value: 'department_created',   label: 'Department created' },
    { value: 'department_renamed',   label: 'Department renamed' },
    { value: 'department_deleted',   label: 'Department deleted' },
    { value: 'org_settings_updated', label: 'Organization settings updated' }
  ] },
  { group: 'Security', options: [
    { value: 'user_logged_in', label: 'User logged in' }
  ] },
  { group: 'Integrations', options: [
    { value: 'webhook_called',   label: 'Webhook sent' },
    { value: 'webhook_received', label: 'Webhook received' }
  ] },
  { group: 'Licence & usage', options: [
    { value: 'org_limit_reached',            label: 'Plan limit reached' },
    { value: 'org_licence_expired',          label: 'Licence expired' },
    { value: 'org_storage_extended',         label: 'Storage extended' },
    { value: 'org_storage_extension_revoked', label: 'Storage extension revoked' }
  ] }
]

const SUCCESS_ACTIONS = new Set(['task_approved', 'workflow_completed', 'org_activated'])
const REJECTED_ACTIONS = new Set(['task_rejected', 'request_changes'])
const ALERT_ACTIONS = new Set([
  'workflow_failed',
  'task_escalated',
  'org_licence_expired',
  'org_limit_reached',
  'org_suspended',
  'org_deleted',
  'user_deleted',
  'form_deleted',
  'workflow_deleted'
])

const RESULT_META = {
  success: { label: 'Success', className: 'is-success' },
  rejected: { label: 'Rejected', className: 'is-rejected' },
  failed: { label: 'Failed', className: 'is-failed' },
  attention: { label: 'Attention', className: 'is-attention' },
  recorded: { label: 'Recorded', className: 'is-recorded' }
}

const titleCase = (s) =>
  String(s || '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())

const entryDepartment = (l) => l.department || l.performedBy?.department || ''
const actorName = (l) => l.performedBy?.name || 'System'

const entryResult = (log) => {
  if (log.action === 'webhook_called' && log.metadata?.ok === true) return RESULT_META.success
  if (log.action === 'webhook_called' && log.metadata?.ok === false) return RESULT_META.failed
  if (log.action === 'workflow_failed') return RESULT_META.failed
  if (REJECTED_ACTIONS.has(log.action)) return RESULT_META.rejected
  if (SUCCESS_ACTIONS.has(log.action)) return RESULT_META.success
  if (ALERT_ACTIONS.has(log.action)) return RESULT_META.attention
  return RESULT_META.recorded
}

function AuditSummaryCard({ label, value, hint, tone, icon: Icon, active, loading, onClick }) {
  return (
    <button
      type="button"
      className={`nf-audit-summary-card is-${tone}${active ? ' is-active' : ''}`}
      aria-pressed={active}
      onClick={onClick}
    >
      <span className="nf-audit-summary-corner" aria-hidden="true" />
      <span className="nf-audit-summary-heading">
        <span>{label}</span>
        <span className="nf-audit-summary-icon" aria-hidden="true">
          <Icon />
        </span>
      </span>
      {loading ? (
        <Skeleton className="nf-audit-summary-skeleton" />
      ) : (
        <strong>{Number(value || 0).toLocaleString()}</strong>
      )}
      <small>{hint}</small>
    </button>
  )
}

const csvCell = (value) => {
  const s = String(value ?? '')
  return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s
}

function AuditLog() {
  const departments = useDepartmentNames()
  const [logs, setLogs] = useState([])
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [searchInput, setSearchInput] = useState('')
  const [actionFilter, setActionFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('') // '', 'success', 'rejected', 'alerts'
  const [department, setDepartment] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [reloadKey, setReloadKey] = useState(0)
  const [exporting, setExporting] = useState(false)
  const [summary, setSummary] = useState({ total: 0, success: 0, rejected: 0, alerts: 0 })

  const debouncedSearch = useDebouncedValue(searchInput.trim())

  const filterParams = useMemo(() => ({
    search: debouncedSearch || undefined,
    action: actionFilter || undefined,
    status: (!actionFilter && statusFilter) || undefined,
    department: department || undefined
  }), [debouncedSearch, actionFilter, statusFilter, department])

  useEffect(() => {
    let cancelled = false
    const startTimer = window.setTimeout(() => {
      if (!cancelled) {
        setLoading(true)
        setError('')
      }
    }, 0)
    api.get(`/api/audit-logs${buildQuery({ ...filterParams, page, limit: PAGE_SIZE })}`)
      .then((data) => {
        if (cancelled) return
        setLogs(data.logs || [])
        setTotal(data.total ?? data.pagination?.total ?? (data.logs || []).length)
        setSummary({
          total: data.summary?.total ?? 0,
          success: data.summary?.success ?? 0,
          rejected: data.summary?.rejected ?? 0,
          alerts: data.summary?.alerts ?? 0
        })
      })
      .catch((e) => {
        if (!cancelled) setError(e.status === 403 ? 'Audit log requires Manager role or higher.' : e.message)
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => {
      cancelled = true
      window.clearTimeout(startTimer)
    }
  }, [page, filterParams, reloadKey])

  const totalPages = useMemo(() => Math.max(1, Math.ceil(total / PAGE_SIZE)), [total])
  const hasFilters = Boolean(debouncedSearch || actionFilter || statusFilter || department)

  const clearFilters = () => {
    setSearchInput('')
    setActionFilter('')
    setStatusFilter('')
    setDepartment('')
    setPage(1)
  }

  const selectSummaryStatus = (status) => {
    setActionFilter('')
    setStatusFilter((current) => current === status ? '' : status)
    setPage(1)
  }

  const exportCsv = async () => {
    setExporting(true)
    try {
      const rows = []
      let cursor = 1
      let pages = 1
      do {
        const data = await api.get(
          `/api/audit-logs${buildQuery({ ...filterParams, page: cursor, limit: EXPORT_PAGE_SIZE })}`
        )
        const batch = data.logs || []
        rows.push(...batch)
        pages = Math.min(Number(data.totalPages) || 1, Math.ceil(EXPORT_MAX_ROWS / EXPORT_PAGE_SIZE))
        if (batch.length === 0) break
        cursor += 1
      } while (cursor <= pages && rows.length < EXPORT_MAX_ROWS)

      const csv = [
        ['When (UTC)', 'Actor', 'Email', 'Action', 'Target', 'Result', 'Department', 'IP address', 'Detail'],
        ...rows.map((l) => [
          isoAttr(l.createdAt) || '',
          actorName(l),
          l.performedBy?.email || '',
          l.action,
          l.targetEntity || '',
          entryResult(l).label,
          entryDepartment(l),
          l.ipAddress || '',
          l.detail || ''
        ])
      ].map((r) => r.map(csvCell).join(',')).join('\n')

      const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `audit-log${hasFilters ? '-filtered' : ''}-${new Date().toISOString().slice(0, 10)}.csv`
      document.body.appendChild(a); a.click(); document.body.removeChild(a)
      URL.revokeObjectURL(url)
      toast.success(
        rows.length >= EXPORT_MAX_ROWS
          ? `Exported the first ${EXPORT_MAX_ROWS.toLocaleString()} entries. Narrow the filters to export the rest.`
          : `Exported ${rows.length.toLocaleString()} ${rows.length === 1 ? 'entry' : 'entries'}.`
      )
    } catch (e) {
      toast.error(e.message || 'Export failed')
    } finally {
      setExporting(false)
    }
  }

  const actions = (
    <button
      onClick={exportCsv}
      disabled={exporting || (!loading && total === 0)}
      className="nf-audit-export"
      title={hasFilters ? 'Exports every entry matching the current filters' : 'Exports every entry'}
    >
      <Download aria-hidden="true" className='text-white' />
      {exporting ? 'Exporting…' : hasFilters ? 'Export filtered CSV' : 'Export CSV'}
    </button>
  )

  const rangeStart = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1
  const rangeEnd = Math.min(page * PAGE_SIZE, total)

  return (
    <AppShell
      title="Audit log"
      subtitle="Immutable record of approvals, changes, and admin activity"
      actions={actions}
      mainClass="flex-1 min-h-0 flex flex-col overflow-y-auto p-4 md:p-6 pb-24 md:pb-6"
    >
      <div className="nf-audit-page">
          <section className="nf-audit-summary-grid" aria-label="Audit activity summary">
            <AuditSummaryCard
              label="All activity"
              value={summary.total}
              hint="Every recorded event"
              tone="all"
              icon={Activity}
              loading={loading && !logs.length}
              active={!statusFilter && !actionFilter}
              onClick={() => {
                setActionFilter('')
                setStatusFilter('')
                setPage(1)
              }}
            />
            <AuditSummaryCard
              label="Successful outcomes"
              value={summary.success}
              hint="Approvals and completions"
              tone="success"
              icon={CheckCircle2}
              loading={loading && !logs.length}
              active={statusFilter === 'success'}
              onClick={() => selectSummaryStatus('success')}
            />
            <AuditSummaryCard
              label="Rejected outcomes"
              value={summary.rejected}
              hint="Rejections and changes"
              tone="rejected"
              icon={XCircle}
              loading={loading && !logs.length}
              active={statusFilter === 'rejected'}
              onClick={() => selectSummaryStatus('rejected')}
            />
            <AuditSummaryCard
              label="Alerts"
              value={summary.alerts}
              hint="Failures and escalations"
              tone="alert"
              icon={TriangleAlert}
              loading={loading && !logs.length}
              active={statusFilter === 'alerts'}
              onClick={() => selectSummaryStatus('alerts')}
            />
          </section>

          <div className="nf-audit-toolbar" aria-label="Audit log filters">
            <div className="nf-audit-search">
              <Search aria-hidden="true" />
              <input
                type="search"
                value={searchInput}
                onChange={(e) => {
                  setSearchInput(e.target.value)
                  setPage(1)
                }}
                placeholder="Search target or detail"
                aria-label="Search audit entries"
                className={fieldCls}
              />
            </div>
            <div className="nf-audit-filters">
              <select
                value={actionFilter}
                onChange={(e) => {
                  setActionFilter(e.target.value)
                  if (e.target.value) setStatusFilter('')
                  setPage(1)
                }}
                aria-label="Filter by action"
                className={selectCls}
              >
                {ACTION_FILTERS.map((f) => f.group ? (
                  <optgroup key={f.group} label={f.group}>
                    {f.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </optgroup>
                ) : (
                  <option key={f.value} value={f.value}>{f.label}</option>
                ))}
              </select>
              <select
                value={statusFilter}
                onChange={(e) => {
                  setStatusFilter(e.target.value)
                  if (e.target.value) setActionFilter('')
                  setPage(1)
                }}
                aria-label="Filter by result"
                className={selectCls}
              >
                <option value="">All results</option>
                <option value="success">Positive outcomes</option>
                <option value="rejected">Rejected outcomes</option>
                <option value="alerts">Alerts</option>
              </select>
              <select
                value={department}
                onChange={(e) => { setDepartment(e.target.value); setPage(1) }}
                aria-label="Filter by department"
                className={selectCls}
              >
                <option value="">All departments</option>
                {departments.map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
              {hasFilters && (
                <button
                  type="button"
                  onClick={clearFilters}
                  className="nf-audit-clear"
                >
                  Clear filters
                </button>
              )}
            </div>
          </div>

          {error && (
            <div className="nf-audit-error">
              <AlertBanner onRetry={() => setReloadKey((k) => k + 1)}>
                {error}
              </AlertBanner>
            </div>
          )}

          <div className="nf-audit-table-shell">
          <div className="nf-audit-table-scroll">
            {loading ? (
              <div className="divide-y divide-line">
                {Array.from({ length: 8 }).map((_, i) => (
                  <div key={i} className="px-5 py-3.5 flex items-start gap-3">
                    <Skeleton className="w-2 h-2 rounded-full mt-2 shrink-0" />
                    <div className="flex-1 space-y-2">
                      <Skeleton className="h-4 w-2/3 max-w-md" />
                      <Skeleton className="h-3 w-1/2 max-w-sm" />
                      <Skeleton className="h-2.5 w-40" />
                    </div>
                    <Skeleton className="h-5 w-24 rounded-md hidden sm:block" />
                  </div>
                ))}
              </div>
            ) : logs.length === 0 ? (
              <div className="h-full min-h-[16rem] flex items-center justify-center">
                <EmptyState
                  title={hasFilters ? 'No entries match these filters' : 'No activity recorded yet'}
                  description={hasFilters
                    ? 'Try a different action, department or search term.'
                    : 'Approvals, submissions and admin changes will appear here as they happen.'}
                  action={hasFilters ? (
                    <button
                      onClick={clearFilters}
                      className="px-4 py-2 rounded-lg border border-line hover:bg-surface-2 text-sm font-medium text-fg transition"
                    >
                      Clear filters
                    </button>
                  ) : null}
                />
              </div>
            ) : (
              <>
                {/* Desktop table */}
                <table className="nf-audit-table">
                  <colgroup>
                    <col className="nf-audit-col-when" />
                    <col className="nf-audit-col-actor" />
                    <col className="nf-audit-col-action" />
                    <col className="nf-audit-col-target" />
                    <col className="nf-audit-col-result" />
                    <col className="nf-audit-col-department" />
                  </colgroup>
                  <thead>
                    <tr>
                      <th scope="col">When</th>
                      <th scope="col">User</th>
                      <th scope="col">Action</th>
                      <th scope="col">Target &amp; detail</th>
                      <th scope="col">Result</th>
                      <th scope="col">Department</th>
                    </tr>
                  </thead>
                  <tbody>
                    {logs.map((l) => {
                      const dept = entryDepartment(l)
                      const result = entryResult(l)
                      const targetDetail = [l.targetEntity, l.detail].filter(Boolean).join(' · ')
                      return (
                        <tr key={l._id}>
                          <td>
                            <time
                              dateTime={isoAttr(l.createdAt)}
                              title={isoAttr(l.createdAt)}
                            >
                              {formatDateTime(l.createdAt)}
                            </time>
                          </td>
                          <td title={l.performedBy?.email || undefined}>
                            <span className="nf-audit-cell-text">{actorName(l)}</span>
                          </td>
                          <td>
                            <span className="nf-audit-cell-text">{titleCase(l.action)}</span>
                          </td>
                          <td title={targetDetail || undefined}>
                            {targetDetail ? (
                              <span className="nf-audit-cell-text nf-audit-target">{targetDetail}</span>
                            ) : (
                              <p className="text-fg-subtle">—</p>
                            )}
                          </td>
                          <td>
                            <span className={`nf-audit-result ${result.className}`}>
                              <i aria-hidden="true" />
                              {result.label}
                            </span>
                          </td>
                          <td>
                            {dept ? (
                              <span className="nf-audit-cell-text">
                                {dept}
                              </span>
                            ) : (
                              <span className="text-xs text-fg-subtle">—</span>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>

                {/* Mobile list */}
                <ul className="nf-audit-mobile-list">
                  {logs.map((l) => {
                    const dept = entryDepartment(l)
                    const result = entryResult(l)
                    return (
                      <li key={l._id} className="nf-audit-mobile-row">
                        <div className="flex items-start justify-between gap-3">
                          <span className="text-xs font-semibold text-fg">{titleCase(l.action)}</span>
                          <span className={`nf-audit-result ${result.className}`}>
                            <i aria-hidden="true" />
                            {result.label}
                          </span>
                        </div>
                        <p className="mt-2 text-sm font-semibold text-fg">{actorName(l)}</p>
                        {l.targetEntity && (
                          <p className="mt-0.5 text-sm text-fg truncate">{l.targetEntity}</p>
                        )}
                        {l.detail && (
                          <p className="mt-1 text-xs text-fg-muted line-clamp-3 whitespace-pre-wrap break-words">
                            {l.detail}
                          </p>
                        )}
                        <p className="mt-2 text-[11px] text-fg-subtle">
                          <time dateTime={isoAttr(l.createdAt)} title={isoAttr(l.createdAt)}>
                            {formatDateTime(l.createdAt)}
                          </time>
                          {dept ? ` · ${dept}` : ''}
                        </p>
                      </li>
                    )
                  })}
                </ul>
              </>
            )}
          </div>

          {(totalPages > 1 || total > 0) && (
            <div className="nf-audit-pagination">
              <p>
                {loading ? 'Loading…' : (
                  <>
                    <span className="font-medium text-fg tabular-nums">{rangeStart}–{rangeEnd}</span>
                    {' '}of {total.toLocaleString()}
                    {totalPages > 1 && (
                      <span className="text-fg-subtle"> · page {page} of {totalPages}</span>
                    )}
                  </>
                )}
              </p>
              {totalPages > 1 && (
                <div className="nf-audit-page-actions">
                  <button
                    type="button"
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={page === 1 || loading}
                    className="nf-audit-page-button"
                  >
                    Previous
                  </button>
                  <button
                    type="button"
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    disabled={page === totalPages || loading}
                    className="nf-audit-page-button"
                  >
                    Next
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </AppShell>
  )
}

export default AuditLog
