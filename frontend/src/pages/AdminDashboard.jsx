import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  Activity, AlertTriangle, ArrowRight, CheckCircle2, Clock3, Database,
  FileText, GitBranch, Info, ShieldCheck, Users,
} from 'lucide-react'
import {
  CartesianGrid, LabelList, Line, LineChart,
  ResponsiveContainer, Tooltip as ChartTooltip, XAxis, YAxis,
} from 'recharts'
import AppShell from '../components/AppShell'
import { DateRangeControl, Panel, PanelHeader } from '../components/NetFlowUI'
import WorkflowControlTower from '../components/WorkflowControlTower'
import { api } from '../utils/api'
import { useUser } from '../utils/auth'
import { canCreateForm, canCreateWorkflow } from '../utils/permissions'
import { useTasks, tasksStore } from '../lib/tasksStore'
import { useWorkflows, workflowsStore } from '../lib/workflowsStore'
import { useUsage } from '../lib/usageStore'
import { formatMb } from '../lib/licensing'

const OUTCOMES = [
  { key: 'inProgress', name: 'In progress', color: '#245a9a', tone: 'info' },
  { key: 'completed', name: 'Completed', color: '#246b4a', tone: 'success' },
  { key: 'onHold', name: 'Waiting', color: '#b8892d', tone: 'warning' },
  { key: 'failed', name: 'Failed', color: '#b93832', tone: 'danger' },
  { key: 'cancelled', name: 'Cancelled', color: '#6b628d', tone: 'neutral' },
]
const lower = (value) => String(value || '').trim().toLowerCase()
const asArray = (value) => Array.isArray(value) ? value : []
const inRange = (date, range) => {
  if (!range || !date) return true
  const value = new Date(date).getTime()
  return value >= new Date(`${range.from}T00:00:00Z`).getTime() && value <= new Date(`${range.to}T23:59:59.999Z`).getTime()
}
const rangeQuery = (range) => range ? `from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}` : ''
const rangeLabel = (range) => {
  if (!range) return 'All available data'
  const format = (value) => new Date(`${value}T12:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
  return `${format(range.from)} - ${format(range.to)}`
}
const formatAge = (date) => {
  if (!date) return 'Date unavailable'
  const hours = Math.max(0, Math.floor((Date.now() - new Date(date).getTime()) / 3600000))
  if (hours < 1) return 'Just now'
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

const localIsoDate = (date) => {
  const shifted = new Date(date.getTime() - (date.getTimezoneOffset() * 60000))
  return shifted.toISOString().slice(0, 10)
}

const recentRange = (days) => {
  const to = new Date()
  const from = new Date(to)
  from.setDate(from.getDate() - days + 1)
  return { from: localIsoDate(from), to: localIsoDate(to) }
}

const greetingFor = (date) => {
  const hour = date.getHours()
  if (hour >= 5 && hour < 12) return 'Good morning'
  if (hour >= 12 && hour < 17) return 'Good afternoon'
  return 'Good evening'
}

const activityVolume = (item) => OUTCOMES.reduce((total, { key }) => total + Number(item[key] || 0), 0)

const isoWeekParts = (value) => {
  const date = new Date(value)
  date.setUTCHours(0, 0, 0, 0)
  date.setUTCDate(date.getUTCDate() + 4 - (date.getUTCDay() || 7))
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1))
  return {
    year: date.getUTCFullYear(),
    week: Math.ceil((((date - yearStart) / 86400000) + 1) / 7),
  }
}

const formatSlaInterval = (start, end, includeYear = false) => {
  const startDay = start.getUTCDate()
  const endDay = end.getUTCDate()
  const startMonth = start.toLocaleDateString(undefined, { month: 'short', timeZone: 'UTC' })
  const endMonth = end.toLocaleDateString(undefined, { month: 'short', timeZone: 'UTC' })
  const startYear = start.getUTCFullYear()
  const endYear = end.getUTCFullYear()
  if (startYear === endYear && startMonth === endMonth) {
    const days = startDay === endDay ? `${startDay}` : `${startDay}–${endDay}`
    return `${startMonth} ${days}${includeYear ? `, ${startYear}` : ''}`
  }
  if (startYear === endYear) {
    return `${startMonth} ${startDay}–${endMonth} ${endDay}${includeYear ? `, ${startYear}` : ''}`
  }
  return `${startMonth} ${startDay}, ${startYear}–${endMonth} ${endDay}, ${endYear}`
}

const buildSlaTrend = (rows, range) => {
  if (!range?.from || !range?.to) return []
  const lookup = new Map(asArray(rows).map((row) => [
    `${Number(row.year)}-W${String(Number(row.week)).padStart(2, '0')}`,
    Number(row.breaches ?? row.value ?? 0),
  ]))
  const rangeStart = new Date(`${range.from}T00:00:00Z`)
  const first = new Date(rangeStart)
  first.setUTCDate(first.getUTCDate() - ((first.getUTCDay() + 6) % 7))
  const rangeEnd = new Date(`${range.to}T23:59:59Z`)
  const result = []
  for (const cursor = new Date(first); cursor <= rangeEnd && result.length < 16; cursor.setUTCDate(cursor.getUTCDate() + 7)) {
    const { year, week } = isoWeekParts(cursor)
    const key = `${year}-W${String(week).padStart(2, '0')}`
    const weekEnd = new Date(cursor)
    weekEnd.setUTCDate(weekEnd.getUTCDate() + 6)
    const intervalStart = new Date(Math.max(cursor.getTime(), rangeStart.getTime()))
    const intervalEnd = new Date(Math.min(weekEnd.getTime(), rangeEnd.getTime()))
    result.push({
      key,
      week: `W${week}`,
      label: formatSlaInterval(intervalStart, intervalEnd),
      fullLabel: formatSlaInterval(intervalStart, intervalEnd, true),
      value: lookup.get(key) || 0,
    })
  }
  return result
}

const exactDateTime = (date) => date
  ? new Date(date).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
  : 'Date unavailable'

const auditActor = (entry) => entry.performedBy?.name || 'System'
const auditTarget = (entry) => String(entry.targetEntity || '')
  .trim()
  .replace(/^(workflow|form|user|department|role):\s*/i, '')
const auditTitle = (entry, count = 1) => {
  const actor = auditActor(entry)
  const target = auditTarget(entry)
  const action = String(entry.action || '')
  if (action === 'user_logged_in') return `${actor} logged in${count > 1 ? ` ${count} times` : ''}`
  if (action === 'user_invited') return `${actor} invited${target ? ` ${target}` : ' a user'}`
  if (action === 'user_updated') return `${actor} updated${target ? ` ${target}` : ' a user'}`
  if (action === 'user_deleted') return `${actor} deleted${target ? ` ${target}` : ' a user'}`
  if (action === 'builder_access_granted') return `${actor} granted Builder access${target ? ` to ${target}` : ''}`
  if (action === 'builder_access_revoked') return `${actor} revoked Builder access${target ? ` from ${target}` : ''}`
  const verbs = {
    form_submitted: 'submitted a form', form_deleted: 'deleted a form',
    task_approved: 'approved a request', task_rejected: 'rejected a request',
    task_submitted: 'submitted a task', task_escalated: 'escalated a task',
    workflow_started: 'started a workflow', workflow_completed: 'completed a workflow',
    workflow_cancelled: 'cancelled a workflow', workflow_deleted: 'deleted a workflow',
    role_changed: 'changed a role', department_created: 'created a department',
    department_renamed: 'renamed a department', department_deleted: 'deleted a department',
    org_settings_updated: 'updated workspace settings', users_imported: 'imported users',
  }
  const description = verbs[action] || `· ${action.replaceAll('_', ' ') || 'administration activity'}`
  return `${actor} ${description}${target ? `: ${target}` : ''}`
}

const DASHBOARD_AUDIT_ACTIONS = new Set([
  'user_invited', 'user_updated', 'user_deleted', 'builder_access_granted',
  'builder_access_revoked', 'role_changed', 'department_created',
  'department_renamed', 'department_deleted', 'org_settings_updated',
  'users_imported', 'form_deleted', 'workflow_deleted', 'workflow_cancelled',
])
const DASHBOARD_AUDIT_QUERY = [...DASHBOARD_AUDIT_ACTIONS].join(',')

const groupDashboardAudit = (entries) => asArray(entries)
  .filter((entry) => DASHBOARD_AUDIT_ACTIONS.has(String(entry.action || '')))
  .slice(0, 4)
  .map((entry) => ({ entry, count: 1 }))

function MetricCard({ label, value, meta, tone = 'blue', icon: Icon, to }) {
  const tones = {
    blue: 'bg-indigo-50 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-200', green: 'bg-success-subtle text-success-fg',
    gold: 'bg-warning-subtle text-warning-fg', red: 'bg-danger-subtle text-danger-fg',
  }
  const accents = {
    blue: 'text-indigo-700 hover:bg-indigo-50', green: 'text-success-fg hover:bg-success-subtle',
    gold: 'text-warning-fg hover:bg-warning-subtle', red: 'text-danger-fg hover:bg-danger-subtle',
  }
  const corners = {
    blue: 'bg-indigo-50 dark:bg-indigo-500/15', green: 'bg-success-subtle',
    gold: 'bg-warning-subtle', red: 'bg-danger-subtle',
  }
  return (
    <div className="nf-panel relative min-h-[132px] overflow-hidden px-[18px] py-4">
      <span aria-hidden="true" className={`absolute -right-[25px] -bottom-[48px] h-[98px] w-[98px] rounded-full opacity-60 ${corners[tone]}`} />
      <div className="relative z-10 flex items-start justify-between gap-3">
        <p className="text-xs font-semibold text-fg-muted">{label}</p>
        <span className={`inline-flex h-9 w-9 items-center justify-center rounded-[10px] ${tones[tone]}`}><Icon className="h-[18px] w-[18px]" /></span>
      </div>
      <p className="relative z-10 mt-4 text-[28px] font-bold leading-none tabular-nums text-fg">{value}</p>
      <div className="relative z-10 mt-2 flex min-h-5 items-center justify-between gap-3">
        <p className="min-w-0 text-[11px] text-fg-muted">{meta}</p>
        {to && (
          <Link to={to} aria-label={`View ${label.toLowerCase()}`} className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 ${accents[tone]}`}>
            <ArrowRight className="h-4 w-4" />
          </Link>
        )}
      </div>
    </div>
  )
}

function EmptyPanel({ title, description, icon: Icon = Info, compact = false, positive = false }) {
  return (
    <div className={`${compact ? 'min-h-[82px] flex-row text-left' : 'min-h-[132px] flex-col text-center'} flex items-center justify-center gap-3 px-6 py-4`}>
      <span className={`shrink-0 rounded-full inline-flex items-center justify-center ${compact ? 'h-9 w-9' : 'h-11 w-11'} ${positive ? 'bg-success-subtle text-success-fg' : 'bg-indigo-50 text-indigo-700'}`}><Icon className="w-5 h-5" /></span>
      <div>
        <h3 className="text-sm font-bold text-fg">{title}</h3>
        <p className="mt-0.5 max-w-md text-xs leading-5 text-fg-muted">{description}</p>
      </div>
    </div>
  )
}

function DataUnavailable({ title, onRetry }) {
  return (
    <div className="min-h-[168px] flex flex-col items-center justify-center px-6 py-5 text-center" role="status">
      <span className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-danger-subtle text-danger-fg"><AlertTriangle className="h-5 w-5" /></span>
      <h3 className="mt-3 text-sm font-bold text-fg">{title}</h3>
      <p className="mt-1 text-xs text-fg-muted">The connected service did not return this data.</p>
      <button type="button" className="nf-button mt-3" onClick={onRetry}>Try again</button>
    </div>
  )
}

function LoadingPanel({ label }) {
  return (
    <div className="min-h-[132px] flex items-center justify-center px-6 py-5" role="status" aria-label={label}>
      <div className="w-full max-w-sm animate-pulse space-y-3">
        <div className="mx-auto h-11 w-11 rounded-full bg-surface-3" />
        <div className="mx-auto h-3 w-36 rounded bg-surface-3" />
        <div className="mx-auto h-2.5 w-52 rounded bg-surface-3" />
      </div>
    </div>
  )
}

function SlaSummary({ total }) {
  const clear = total === 0
  return (
    <div className="min-h-[104px] flex items-center justify-center px-5 py-4">
      <div className={`flex w-full items-center gap-3 rounded-xl border p-4 ${clear ? 'border-success-line bg-success-subtle' : 'border-danger-line bg-danger-subtle'}`}>
        <span className={`inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-surface ${clear ? 'text-success-fg' : 'text-danger-fg'}`}>
          {clear ? <ShieldCheck className="h-5 w-5" /> : <AlertTriangle className="h-5 w-5" />}
        </span>
        <div>
          <p className="text-sm font-bold text-fg">{clear ? 'No breaches in selected period' : `${total.toLocaleString()} SLA ${total === 1 ? 'breach' : 'breaches'}`}</p>
          <p className="mt-0.5 text-xs text-fg-muted">{clear ? 'All measured work stayed within its deadline.' : 'Open the approval queue to review affected work.'}</p>
        </div>
      </div>
    </div>
  )
}

function SlaChartTooltip({ active, payload }) {
  const point = payload?.[0]?.payload
  if (!active || !point) return null
  const value = Number(point.value || 0)
  return (
    <div className="rounded-[10px] border border-line bg-surface px-3 py-2 shadow-lg">
      <p className="text-[11px] font-semibold text-fg-muted">{point.fullLabel}</p>
      <p className="mt-1 text-sm font-bold text-fg">{value.toLocaleString()} SLA {value === 1 ? 'breach' : 'breaches'}</p>
    </div>
  )
}

const formatCompletion = (days) => {
  if (days == null || Number.isNaN(Number(days))) return '-'
  const value = Number(days)
  if (value <= 0) return '0h'
  if (value < (1 / 24)) return '<1h'
  if (value < 1) return `${Math.max(1, Math.round(value * 24))}h`
  const rounded = Number(value.toFixed(1))
  return `${rounded} ${rounded === 1 ? 'day' : 'days'}`
}

export default function AdminDashboard() {
  const user = useUser()
  const navigate = useNavigate()
  const tasks = useTasks()
  const workflows = useWorkflows()
  const { usage, loading: usageLoading } = useUsage()
  const [range, setRange] = useState(() => recentRange(30))
  const [clock, setClock] = useState(() => new Date())
  const [summary, setSummary] = useState(null)
  const [departments, setDepartments] = useState([])
  const [activity, setActivity] = useState([])
  const [controlTower, setControlTower] = useState(null)
  const [slaRows, setSlaRows] = useState([])
  const [audit, setAudit] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadErrors, setLoadErrors] = useState({})
  const [refreshKey, setRefreshKey] = useState(0)
  const [taskState, setTaskState] = useState('loading')

  useEffect(() => {
    let active = true
    tasksStore.refresh().then(
      () => { if (active) setTaskState('ready') },
      () => { if (active) setTaskState('error') },
    )
    workflowsStore.refresh().catch(() => {})
    return () => { active = false }
  }, [])

  useEffect(() => {
    const updateClock = () => setClock(new Date())
    const timer = window.setInterval(updateClock, 60000)
    document.addEventListener('visibilitychange', updateClock)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', updateClock)
    }
  }, [])

  useEffect(() => {
    let active = true
    const query = rangeQuery(range)
    const suffix = query ? `?${query}` : ''
    const auditSuffix = query
      ? `?${query}&actions=${encodeURIComponent(DASHBOARD_AUDIT_QUERY)}&limit=8`
      : `?actions=${encodeURIComponent(DASHBOARD_AUDIT_QUERY)}&limit=8`
    const slaSuffix = suffix
    Promise.allSettled([
      api.get(`/api/analytics/summary${suffix}`),
      api.get(`/api/analytics/department-kpis${suffix}`),
      api.get(`/api/analytics/activity${suffix}`),
      api.get(`/api/analytics/workflow-control-tower${suffix}${suffix ? '&' : '?'}limit=6`),
      api.get(`/api/analytics/sla-breaches${slaSuffix}`),
      api.get(`/api/audit-logs${auditSuffix}`),
    ]).then(([summaryResult, departmentResult, activityResult, controlTowerResult, slaResult, auditResult]) => {
      if (!active) return
      setSummary(summaryResult.status === 'fulfilled' ? (summaryResult.value.summary || summaryResult.value) : null)
      setDepartments(departmentResult.status === 'fulfilled' ? asArray(departmentResult.value.kpis || departmentResult.value.series || departmentResult.value) : [])
      setActivity(activityResult.status === 'fulfilled' ? asArray(activityResult.value.series) : [])
      setControlTower(controlTowerResult.status === 'fulfilled' ? controlTowerResult.value : null)
      setSlaRows(slaResult.status === 'fulfilled' ? asArray(slaResult.value.series || slaResult.value.slaBreaches || slaResult.value.data) : [])
      setAudit(auditResult.status === 'fulfilled' ? asArray(auditResult.value.logs) : [])
      setLoadErrors({
        summary: summaryResult.status === 'rejected',
        departments: departmentResult.status === 'rejected',
        activity: activityResult.status === 'rejected',
        controlTower: controlTowerResult.status === 'rejected',
        sla: slaResult.status === 'rejected',
        audit: auditResult.status === 'rejected',
      })
      setLoading(false)
    })
    return () => { active = false }
  }, [range, refreshKey])

  const applyDashboardRange = (nextRange) => {
    setLoading(true)
    setLoadErrors({})
    setRange(nextRange)
  }

  const retryDashboardData = () => {
    setLoading(true)
    setLoadErrors({})
    setRefreshKey((key) => key + 1)
  }

  const retryTasks = () => {
    setTaskState('loading')
    tasksStore.refresh().then(() => setTaskState('ready'), () => setTaskState('error'))
  }

  const filteredTasks = useMemo(() => asArray(tasks).filter((task) => inRange(task.createdAt, range)), [tasks, range])
  const needsAttention = useMemo(() => filteredTasks
    .filter((task) => ['pending', 'in review', 'in_review', 'sla breached', 'escalated'].includes(lower(task.status)))
    .sort((a, b) => (a.dueDate ? new Date(a.dueDate).getTime() : Infinity) - (b.dueDate ? new Date(b.dueDate).getTime() : Infinity) || new Date(a.createdAt) - new Date(b.createdAt))
    .slice(0, 5), [filteredTasks])
  const workflowRows = asArray(workflows)
  const activeWorkflows = workflowRows.filter((workflow) => lower(workflow.status) === 'active').length
  const totalWorkflows = Number(summary?.totalWorkflows ?? workflowRows.length)
  const dailyActivity = useMemo(() => activity
    .filter((item) => !range || (item.isoDate >= range.from && item.isoDate <= range.to))
    .map((item) => ({ ...item, volume: activityVolume(item) })), [activity, range])
  const workflowVolumeTotal = dailyActivity.reduce((total, point) => total + point.volume, 0)
  const inProgressVolume = dailyActivity.reduce((total, point) => total + Number(point.inProgress || 0), 0)
  const waitingVolume = dailyActivity.reduce((total, point) => total + Number(point.onHold || 0), 0)
  const completedVolume = dailyActivity.reduce((total, point) => total + Number(point.completed || 0), 0)
  const slaTrend = useMemo(() => buildSlaTrend(slaRows, range), [slaRows, range])
  const slaBreachTotal = slaTrend.reduce((total, point) => total + point.value, 0)
  const slaPeak = slaTrend.reduce((peak, point) => (!peak || point.value > peak.value ? point : peak), null)
  const slaPeakValue = Number(slaPeak?.value || 0)
  
  const slaAxisMax = Math.max(1, slaPeakValue)
  const slaAxisTicks = slaAxisMax <= 4 ? Array.from({ length: slaAxisMax + 1 }, (_, index) => index) : undefined
  const showSlaDetails = !loading && (loadErrors.sla || slaBreachTotal > 0)
  const departmentRows = useMemo(() => [...departments].sort((left, right) => {
    const breachDifference = Number(right.slaBreaches || 0) - Number(left.slaBreaches || 0)
    if (breachDifference) return breachDifference
    const completionDifference = Number(right.avgCompletionDays || 0) - Number(left.avgCompletionDays || 0)
    if (completionDifference) return completionDifference
    return String(left.department || left._id || '').localeCompare(String(right.department || right._id || ''))
  }), [departments])
  const dashboardAudit = useMemo(() => groupDashboardAudit(audit), [audit])
  const firstName = String(user?.name || 'Review user').split(' ')[0]
  const greeting = greetingFor(clock)
  const resources = usage?.resources || {}
  const userMeter = resources.users
  const storageMeter = resources.storage
  const usersUsed = Number(userMeter?.used || 0)
  const usersLimit = Number(userMeter?.limit || 0)
  const storageUsed = Number(storageMeter?.used || 0)
  const storageLimit = Number(storageMeter?.limit || 0)
  const storageAvailable = storageMeter?.available !== false
  const storagePercent = storageLimit > 0 ? Math.round((storageUsed / storageLimit) * 100) : null
  const storageValue = !storageMeter || !storageAvailable ? '-' : storageUsed > 0 ? formatMb(storageUsed) : '0 B'
  const workflowMeta = workflowRows.length === totalWorkflows
    ? `${activeWorkflows.toLocaleString()} active · ${Math.max(0, totalWorkflows - activeWorkflows).toLocaleString()} inactive`
    : 'Current workspace catalogue'
  const usersMeta = usageLoading && !userMeter
    ? 'Loading user usage'
    : userMeter
    ? (usersLimit > 0 ? `${usersUsed.toLocaleString()} of ${usersLimit.toLocaleString()} seats used` : 'No enforced user limit')
    : 'Usage unavailable'
  const storageMeta = usageLoading && !storageMeter
    ? 'Loading storage usage'
    : storageMeter && !storageAvailable
    ? 'Live DMS storage unavailable'
    : storageMeter
    ? (storageUsed <= 0
      ? (storageLimit > 0 ? `No files stored · ${formatMb(storageLimit)} available` : 'No files stored')
      : (storageLimit > 0 ? `of ${formatMb(storageLimit)} · ${storagePercent}% used` : 'No enforced storage limit'))
    : 'Usage unavailable'

  return (
    <AppShell
      title={`${greeting}, ${firstName}`}
      subtitle="Monitor performance, spot workflow risk, and manage workspace capacity."
      actions={<div className="flex flex-wrap items-center gap-2"><DateRangeControl value={range} onApply={applyDashboardRange} />{canCreateForm(user) && <Link to="/forms?new=1" className="nf-button">Create form</Link>}{canCreateWorkflow(user) && <Link to="/workflows/new" className="nf-button nf-button-primary"><GitBranch aria-hidden="true" className="w-4 h-4" />New workflow</Link>}</div>}
      mainClass="nf-admin-dashboard flex-1 min-h-0 overflow-y-auto p-4 md:p-6 pb-24 [&_.nf-page-header]:flex-wrap max-lg:[&_.nf-page-header]:flex-col max-sm:[&_.nf-panel-header]:flex-col max-sm:[&_.nf-panel-header]:items-start"
    >

      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-fg-muted">Current workspace</p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <MetricCard label="Total workflows" value={loading || loadErrors.summary ? '-' : totalWorkflows.toLocaleString()} meta={loading ? 'Loading workflow catalogue' : loadErrors.summary ? 'Analytics unavailable' : workflowMeta} icon={GitBranch} to={canCreateWorkflow(user) ? '/workflows' : undefined} />
        <MetricCard label="Total forms" value={loading || loadErrors.summary ? '-' : Number(summary?.totalForms || 0).toLocaleString()} meta={loading ? 'Loading form catalogue' : loadErrors.summary ? 'Analytics unavailable' : 'Current workspace catalogue'} tone="green" icon={FileText} to="/forms" />
        <MetricCard label="Total users" value={!userMeter ? '-' : usersUsed.toLocaleString()} meta={usersMeta} tone="blue" icon={Users} to="/admin" />
        <MetricCard label="Storage used" value={storageValue} meta={storageMeta} tone="gold" icon={Database} to="/billing" />
      </div>

      <div className="mb-2 mt-5 flex flex-wrap items-center justify-between gap-2">
        <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-fg-muted">Activity overview</p>
        <p className="text-[11px] text-fg-subtle">{rangeLabel(range)}</p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <MetricCard label="Workflow runs" value={loading || loadErrors.activity ? '-' : workflowVolumeTotal.toLocaleString()} meta="In selected period" icon={Activity} to="/analytics" />
        <MetricCard label="In progress" value={loading || loadErrors.activity ? '-' : inProgressVolume.toLocaleString()} meta={`${waitingVolume.toLocaleString()} waiting`} tone="gold" icon={Clock3} to="/analytics" />
        <MetricCard label="Completed" value={loading || loadErrors.activity ? '-' : completedVolume.toLocaleString()} meta="In selected period" tone="green" icon={CheckCircle2} to="/analytics" />
        <MetricCard label="SLA breaches" value={loading || loadErrors.sla ? '-' : slaBreachTotal.toLocaleString()} meta={slaBreachTotal > 0 ? 'Approval deadlines missed' : 'No deadline misses'} tone="red" icon={AlertTriangle} to="/tasks" />
      </div>

      <Panel className="mt-4">
        <PanelHeader title="Needs attention" description="Breached first, then due soon" actions={<Link to="/tasks" className="nf-button">Open approval queue <ArrowRight aria-hidden="true" className="w-4 h-4" /></Link>} />
        {taskState === 'loading' ? <LoadingPanel label="Loading approval records" /> : taskState === 'error' ? (
          <DataUnavailable title="Approval records unavailable" onRetry={retryTasks} />
        ) : needsAttention.length ? (
          <div className="overflow-x-auto">
            <table className="nf-data-table min-w-[760px]">
              <thead><tr><th>Priority & item</th><th>Requested by</th><th>Workflow</th><th>Current owner</th><th aria-label="Actions" /></tr></thead>
              <tbody>{needsAttention.map((task) => {
                const overdue = task.slaBreached || (task.dueDate && new Date(task.dueDate) < clock)
                return (
                  <tr key={task.id}>
                    <td><div className="flex items-center gap-3">
                      <AlertTriangle aria-hidden="true" className={`w-4 h-4 ${overdue ? 'text-danger-fg' : 'text-warning-fg'}`} />
                      <div><strong className="block text-sm text-fg">{task.title || 'Approval task'}</strong><span className="text-[11px] text-fg-muted">{overdue ? 'SLA breached' : formatAge(task.createdAt)}</span></div>
                    </div></td>
                    <td>{task.requester || 'Unavailable'}</td>
                    <td>{task.workflow || 'Unavailable'}</td>
                    <td>{task.approver || 'Unassigned'}</td>
                    <td className="text-right"><button type="button" className="nf-button" onClick={() => navigate(`/tasks/${task.id}`)}>Review</button></td>
                  </tr>
                )
              })}</tbody>
            </table>
          </div>
        ) : <EmptyPanel compact positive title="No approval tasks need attention" icon={CheckCircle2} />}
      </Panel>

      <div>
        <WorkflowControlTower
          data={controlTower}
          loading={loading}
          error={loadErrors.controlTower}
          onRetry={retryDashboardData}
          canManage={canCreateWorkflow(user)}
        />

      </div>

      {showSlaDetails && (
        <Panel className="mt-4 overflow-hidden">
          <PanelHeader title="SLA breach trend" description="Track approval deadline breaches over the selected period" actions={<Link to="/tasks" className="nf-button">Review queue <ArrowRight aria-hidden="true" className="w-4 h-4" /></Link>} />
          {loadErrors.sla ? (
            <DataUnavailable title="SLA trend unavailable" onRetry={retryDashboardData} />
          ) : slaTrend.length < 4 ? (
            <SlaSummary total={slaBreachTotal} />
          ) : (
            <div>
             
              <div
                className="h-[176px] px-4 pb-4 pt-2"
                role="img"
                aria-label={`${slaBreachTotal} SLA ${slaBreachTotal === 1 ? 'breach' : 'breaches'} across ${slaTrend.length} intervals. Peak ${slaPeakValue} during ${slaPeak?.fullLabel}.`}
              >
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={slaTrend} margin={{ top: 18, right: 12, left: -10, bottom: 0 }}>
                    <CartesianGrid vertical={false} stroke="var(--color-line)" />
                    <XAxis dataKey="label" axisLine={false} tickLine={false} minTickGap={16} height={28} tick={{ fontSize: 10, fill: 'var(--color-fg-muted)' }} />
                    <YAxis domain={[0, slaAxisMax]} ticks={slaAxisTicks} axisLine={false} tickLine={false} width={28} tick={{ fontSize: 10, fill: 'var(--color-fg-muted)' }} allowDecimals={false} />
                    <ChartTooltip content={<SlaChartTooltip />} cursor={{ stroke: 'var(--color-line-strong)', strokeDasharray: '3 3' }} />
                    <Line name="SLA breaches" type="linear" dataKey="value" stroke="#b93832" strokeWidth={2.5} dot={{ r: 3, fill: 'var(--color-surface)', strokeWidth: 2.5 }} activeDot={{ r: 5 }} isAnimationActive={false}>
                      <LabelList dataKey="value" position="top" offset={8} fill="#b93832" fontSize={11} fontWeight={700} formatter={(value) => Number(value) > 0 ? Number(value).toLocaleString() : ''} />
                    </Line>
                  </LineChart>
                </ResponsiveContainer>
              </div>
              <table className="sr-only">
                <caption>SLA breaches by selected-period interval</caption>
                <thead><tr><th>Interval</th><th>Breaches</th></tr></thead>
                <tbody>{slaTrend.map((point) => <tr key={point.key}><td>{point.fullLabel}</td><td>{point.value}</td></tr>)}</tbody>
              </table>
            </div>
          )}
        </Panel>
      )}

      <div className="mt-4 grid grid-cols-1 xl:grid-cols-[minmax(0,1.65fr)_minmax(300px,.75fr)] items-start gap-4">
        <Panel className="overflow-hidden">
          <PanelHeader title="Approval performance by department" description="Compare approval volume, completion time, and SLA performance" actions={<Link to="/analytics" className="nf-button">Compare departments <ArrowRight aria-hidden="true" className="w-4 h-4" /></Link>} />
          {loading ? <LoadingPanel label="Loading department performance" /> : loadErrors.departments ? (
            <DataUnavailable title="Department performance unavailable" onRetry={retryDashboardData} />
          ) : departmentRows.length ? (
            <div className="overflow-x-auto">
              <table className="nf-data-table min-w-[760px]">
                <thead><tr><th>Department</th><th>Approval tasks</th><th>Approval rate</th><th>Avg. completion</th><th>SLA breaches</th><th>Status</th></tr></thead>
                <tbody>{departmentRows.map((department) => {
                  const total = Number(department.totalRequests || 0)
                  const breaches = Number(department.slaBreaches || 0)
                  const approvalRate = department.approved != null && total ? Math.round((Number(department.approved) / total) * 100) : null
                  const status = total === 0 ? 'No activity' : breaches > 0 ? 'At risk' : 'Healthy'
                  const tone = status === 'Healthy' ? 'success' : status === 'At risk' ? 'danger' : 'neutral'
                  return (
                    <tr key={department.department || department._id}>
                      <td className="font-semibold">{department.department || department._id || 'Unassigned'}</td>
                      <td>{total.toLocaleString()}</td>
                      <td>{approvalRate == null ? '-' : `${approvalRate}%`}</td>
                      <td>{formatCompletion(department.avgCompletionDays)}</td>
                      <td>{breaches.toLocaleString()}</td>
                      <td><span className={`nf-status nf-status-${tone}`}>{status}</span></td>
                    </tr>
                  )
                })}</tbody>
              </table>
            </div>
          ) : <EmptyPanel title="No department approval activity" description="No approval tasks linked to a submitter department were recorded in this period." />}
        </Panel>

        <Panel className="overflow-hidden">
          <PanelHeader title="Recent activity" description="Important workspace changes" actions={<Link to="/audit-log" className="nf-button">View audit log <ArrowRight aria-hidden="true" className="w-4 h-4" /></Link>} />
          {loading ? <LoadingPanel label="Loading administration activity" /> : loadErrors.audit ? (
            <DataUnavailable title="Administration activity unavailable" onRetry={retryDashboardData} />
          ) : dashboardAudit.length ? (
            <ul className="divide-y divide-line px-4">
              {dashboardAudit.map(({ entry, count }) => (
                <li key={entry.id || entry._id} className="flex items-center gap-3 py-3">
                  <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full bg-indigo-600" />
                  <div className="min-w-0 flex-1">
                    <strong className="block break-words text-sm text-fg">{auditTitle(entry, count)}</strong>
                    <span className="text-[11px] text-fg-muted" title={exactDateTime(entry.createdAt)}>{formatAge(entry.createdAt)}{entry.department ? ` · ${entry.department}` : ''}</span>
                  </div>
                  {count > 1 && <span className="nf-status nf-status-info" aria-label={`${count} grouped audit events`}>{count} events</span>}
                </li>
              ))}
            </ul>
          ) : <EmptyPanel compact title="No administration changes" description="No important workspace changes were recorded. Sign-in events remain available in the audit log." />}
        </Panel>
      </div>
    </AppShell>
  )
}
