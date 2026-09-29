import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, Building2, ChartNoAxesColumnIncreasing, CircleAlert, Database, HeartPulse, RefreshCw, Server, ShieldCheck } from 'lucide-react'
import AppShell from '../components/AppShell'
import { AlertBanner } from '../components/Alert'
import { api } from '../utils/api'
import { PLAN_LABELS, meterText } from '../lib/licensing'
import { formatDateTime, isoAttr, relativeTime } from '../utils/datetime'

const titleCase = (value) => String(value || '').replace(/[_-]+/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
const meterName = (key) => ({ users: 'User', builders: 'Builder', forms: 'Form', workflows: 'Workflow', submissions: 'Submission', storage: 'Storage', files: 'File' }[key] || titleCase(key))
const orgState = (org) => (org.status || 'active') === 'suspended' ? 'suspended' : (org.plan === 'trial' || org.licensing?.licence?.isTrial) ? 'trial' : 'active'
const pressure = (org) => Math.max(0, ...Object.values(org.licensing?.resources || {}).filter(Boolean).map((meter) => Number(meter.percent || 0)))

const strongestMeter = (org, states) => Object.entries(org.licensing?.resources || {})
  .filter(([, meter]) => meter && !meter.unlimited && states.includes(meter.state))
  .sort((a, b) => Number(b[1].percent || 0) - Number(a[1].percent || 0))[0]

function organizationRisk(org) {
  if ((org.status || 'active') === 'suspended') return { reason: 'Workspace access is suspended', label: 'Critical', tone: 'danger', rank: 60, type: 'access', current: 'Access blocked' }
  const licence = org.licensing?.licence
  const expired = licence?.status === 'expired' || (licence?.daysLeft != null && licence.daysLeft < 0)
  if (licence?.readOnly || expired) {
    return {
      reason: licence?.isTrial ? 'Trial period has ended' : 'Licence has expired',
      label: 'Critical',
      tone: 'danger',
      rank: 50,
      type: 'licence',
      current: 'Read-only'
    }
  }
  const exceeded = strongestMeter(org, ['exceeded'])
  if (exceeded) return { reason: `${meterName(exceeded[0])} allowance exceeded`, label: 'Critical', tone: 'danger', rank: 40, type: 'limit', resource: exceeded[0], meter: exceeded[1], current: meterText(exceeded[0], exceeded[1]) }
  const critical = strongestMeter(org, ['critical'])
  if (critical) return { reason: `${meterName(critical[0])} nearing allowance`, label: 'Warning', tone: 'warning', rank: 30, type: 'limit', resource: critical[0], meter: critical[1], current: meterText(critical[0], critical[1]) }
  const warning = strongestMeter(org, ['warning'])
  if (warning) return { reason: `${meterName(warning[0])} usage is increasing`, label: 'Warning', tone: 'warning', rank: 20, type: 'limit', resource: warning[0], meter: warning[1], current: meterText(warning[0], warning[1]) }
  if (licence?.daysLeft != null && licence.daysLeft <= 30) return { reason: licence.isTrial ? 'Trial period ending soon' : 'Licence renewal approaching', label: 'Warning', tone: 'warning', rank: 10, type: 'licence', current: `${Math.max(0, licence.daysLeft)} days left` }
  return null
}

const highestMeter = (org) => Object.entries(org.licensing?.resources || {})
  .filter(([, meter]) => meter)
  .sort((a, b) => Number(b[1].percent || 0) - Number(a[1].percent || 0))[0] || null

const planLabel = (key) => PLAN_LABELS[key] || titleCase(key || 'Custom')

function formatUptime(seconds) {
  if (seconds == null || Number.isNaN(Number(seconds))) return 'Unavailable'
  const value = Math.max(0, Math.floor(Number(seconds)))
  const days = Math.floor(value / 86400)
  const hours = Math.floor((value % 86400) / 3600)
  const minutes = Math.floor((value % 3600) / 60)
  if (days) return `${days}d ${hours}h`
  if (hours) return `${hours}h ${minutes}m`
  return `${minutes}m`
}

const activityLabel = (log) => {
  if (log.action === 'org_updated' && (log.metadata?.planFrom || log.metadata?.planTo)) return 'Plan assigned'
  return ({
    org_created: 'Organization created',
    org_updated: 'Organization updated',
    org_suspended: 'Organization suspended',
    org_activated: 'Organization reactivated',
    org_deleted: 'Organization deleted',
    org_admin_password_reset: 'Admin password reset',
    org_storage_extended: 'Storage extension granted',
    org_storage_extension_revoked: 'Storage extension revoked'
  })[log.action] || titleCase(log.action || 'Platform event')
}

function Metric({ label, value, helper, icon: Icon, tone = 'blue', loading }) {
  const tones = {
    blue: ['bg-[#e7eef8] text-[#245a9a]', 'bg-[#eaf1f8]'],
    red: ['bg-danger-subtle text-danger-fg', 'bg-[#fbefec]'],
    amber: ['bg-warning-subtle text-warning-fg', 'bg-[#faf1df]'],
    violet: ['bg-[#efecf5] text-[#675f87]', 'bg-[#f0edf5]']
  }
  const selected = tones[tone] || tones.blue
  return <article className="relative min-h-[150px] overflow-hidden rounded-[12px] border border-line bg-surface p-[18px] shadow-sm">
    <span className={`absolute -bottom-9 -right-7 h-24 w-24 rounded-full ${selected[1]}`} aria-hidden="true" />
    <div className="relative z-[1] flex h-full flex-col">
      <div className="flex items-start justify-between gap-3"><p className="m-0 pt-1 text-[13px] font-medium text-fg-muted">{label}</p><span className={`flex h-9 w-9 items-center justify-center rounded-[10px] ${selected[0]}`}><Icon className="h-[18px] w-[18px]" strokeWidth={1.8} /></span></div>
      <p className="m-0 mt-auto text-[28px] font-bold leading-none tracking-[-0.035em] text-fg tabular-nums">{loading ? '\u2014' : value}</p>
      <p className="m-0 mt-3 max-w-[88%] text-[11px] leading-tight text-fg-muted">{loading ? 'Loading live data' : helper}</p>
    </div>
  </article>
}

function Panel({ title, description, action, children }) {
  return <section className="overflow-hidden rounded-[12px] border border-line bg-surface shadow-sm">
    <header className="flex min-h-[60px] items-start justify-between gap-4 border-b border-line px-[18px] py-4">
      <div><h2 className="m-0 text-[20px] font-bold leading-tight tracking-[-0.025em] text-fg">{title}</h2>{description ? <p className="m-0 mt-0.5 text-[11px] text-fg-muted">{description}</p> : null}</div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </header>{children}
  </section>
}

const EmptyRow = ({ columns, children }) => <tr><td colSpan={columns} className="px-5 py-10 text-center text-sm text-fg-muted">{children}</td></tr>
const SeverityBadge = ({ tone, children }) => <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-semibold ${tone === 'danger' ? 'bg-danger-subtle text-danger-fg' : 'bg-warning-subtle text-warning-fg'}`}><span className="h-1.5 w-1.5 rounded-full bg-current" />{children}</span>

function TableHead({ labels }) {
  return <thead className="bg-surface-3/80"><tr>{labels.map((label) => <th key={label} scope="col" className="border-b border-line px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-[0.08em] text-fg-muted first:pl-5 last:pr-5">{label}</th>)}</tr></thead>
}

function UsagePressure({ resource, meter }) {
  if (!meter) return <span className="text-[11px] text-fg-subtle">No meter</span>
  const percent = meter.unlimited ? 0 : Math.max(0, Number(meter.percent || 0))
  const bar = meter.state === 'exceeded' ? 'bg-danger-solid' : ['critical', 'warning'].includes(meter.state) ? 'bg-warning-solid' : 'bg-success-solid'
  return <div className="min-w-[150px]">
    <div className="flex items-center justify-between gap-3">
      <span className="text-[12px] font-semibold text-fg">{meterName(resource)}</span>
      <span className="text-[10px] font-medium tabular-nums text-fg-muted">{meter.unlimited ? 'Unlimited' : `${Math.round(percent)}%`}</span>
    </div>
    <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface-3" role="progressbar" aria-label={`${meterName(resource)} utilization`} aria-valuemin="0" aria-valuemax="100" aria-valuenow={meter.unlimited ? 0 : Math.min(100, Math.round(percent))}>
      <span className={`block h-full rounded-full ${bar}`} style={{ width: meter.unlimited ? '0%' : `${Math.min(100, percent)}%` }} />
    </div>
    <span className="mt-1 block text-[10px] text-fg-muted">{meterText(resource, meter)}</span>
  </div>
}

const PLAN_COLORS = ['#245a9a', '#b8892d', '#356aa7', '#246b4a', '#6b628d']

function PlanMix({ rows, total, loading, error }) {
  if (loading) return <div className="m-5 h-[154px] animate-pulse rounded-[10px] bg-surface-3" />
  if (error) return <div className="flex min-h-[194px] items-center justify-center px-6 text-center text-sm text-danger-fg">Plan assignments are unavailable.</div>
  if (!rows.length) return <div className="flex min-h-[194px] flex-col items-center justify-center px-6 text-center"><p className="m-0 text-sm font-semibold text-fg">No plan assignments</p><p className="m-0 mt-1 text-xs text-fg-muted">Plan mix appears after an organization is assigned.</p></div>
  if (rows.length === 1) {
    const row = rows[0]
    return <div className="flex min-h-[194px] items-center px-5 py-6">
      <div className="w-full rounded-[10px] border border-line bg-surface-2/55 p-4">
        <div className="flex items-start justify-between gap-4"><div><p className="m-0 text-[11px] font-medium uppercase tracking-[0.08em] text-fg-muted">Assigned plan</p><p className="m-0 mt-1 text-lg font-bold text-fg">{row.label}</p></div><strong className="text-[28px] leading-none text-fg tabular-nums">100%</strong></div>
        <div className="mt-4 h-2 overflow-hidden rounded-full bg-surface-3"><span className="block h-full w-full rounded-full bg-[#245a9a]" /></div>
        <p className="m-0 mt-2 text-[11px] text-fg-muted">{row.count} of {total} organization{total === 1 ? '' : 's'}</p>
      </div>
    </div>
  }
  return <div className="min-h-[194px] px-5 py-5">
    <div className="flex h-2.5 overflow-hidden rounded-full bg-surface-3" aria-label="Plan assignment distribution">{rows.map((row, index) => <span key={row.key} style={{ width: `${(row.count / total) * 100}%`, backgroundColor: PLAN_COLORS[index % PLAN_COLORS.length] }} title={`${row.label}: ${row.count}`} />)}</div>
    <ul className="m-0 mt-5 grid list-none grid-cols-1 gap-x-6 gap-y-3 p-0 sm:grid-cols-2">{rows.map((row, index) => <li key={row.key} className="flex items-center gap-2 text-[12px]"><span className="h-2.5 w-2.5 rounded-[3px]" style={{ backgroundColor: PLAN_COLORS[index % PLAN_COLORS.length] }} /><span className="min-w-0 flex-1 truncate text-fg-muted">{row.label}</span><strong className="text-fg tabular-nums">{row.count}</strong><span className="w-9 text-right text-[10px] text-fg-subtle">{Math.round((row.count / total) * 100)}%</span></li>)}</ul>
  </div>
}

function RiskPostureChart({ critical, warning, clear, loading, error }) {
  if (loading) return <div className="m-5 h-[150px] animate-pulse rounded-[10px] bg-surface-3" />
  if (error) return <div className="flex min-h-[190px] items-center justify-center px-6 text-center text-sm text-danger-fg">Risk posture is unavailable.</div>
  const total = critical + warning + clear
  if (!total) return <div className="flex min-h-[190px] items-center justify-center px-6 text-center text-sm text-fg-muted">No organizations to chart yet.</div>
  const rows = [
    { label: 'Critical', value: critical, color: '#b23b35' },
    { label: 'Warning', value: warning, color: '#b8892d' },
    { label: 'Clear', value: clear, color: '#246b4a' }
  ]
  return <div className="min-h-[190px] px-5 py-5" role="img" aria-label={`Organization risk posture: ${critical} critical, ${warning} warning, ${clear} clear`}>
    <div className="flex h-4 overflow-hidden rounded-full bg-surface-3">{rows.map((row) => row.value > 0 ? <span key={row.label} style={{ width: `${(row.value / total) * 100}%`, backgroundColor: row.color }} /> : null)}</div>
    <div className="mt-5 grid grid-cols-3 divide-x divide-line rounded-[10px] border border-line bg-surface-2/45 py-3">
      {rows.map((row) => <div key={row.label} className="px-3 text-center"><span className="mx-auto mb-2 block h-2 w-2 rounded-full" style={{ backgroundColor: row.color }} /><strong className="block text-xl leading-none text-fg tabular-nums">{row.value}</strong><span className="mt-1.5 block text-[10px] text-fg-muted">{row.label}</span></div>)}
    </div>
    <p className="m-0 mt-3 text-[10px] text-fg-subtle">Each organization is counted once at its highest severity.</p>
  </div>
}

function ResourcePressureChart({ rows, loading, error }) {
  if (loading) return <div className="m-5 h-[150px] animate-pulse rounded-[10px] bg-surface-3" />
  if (error) return <div className="flex min-h-[190px] items-center justify-center px-6 text-center text-sm text-danger-fg">Resource pressure is unavailable.</div>
  if (!rows.some((row) => row.meter)) return <div className="flex min-h-[190px] items-center justify-center px-6 text-center text-sm text-fg-muted">No resource meters are available yet.</div>
  return <div className="min-h-[190px] space-y-3 px-5 py-4" role="img" aria-label="Highest organization utilization by resource">
    {rows.map((row) => {
      const percent = Math.max(0, Number(row.meter?.percent || 0))
      const bar = percent >= 100 ? '#b23b35' : percent >= 80 ? '#b8892d' : '#245a9a'
      return <div key={row.resource}>
        <div className="mb-1 flex items-center justify-between gap-3"><span className="text-[11px] font-medium text-fg">{({ users: 'Users', builders: 'Builders', submissions: 'Submissions', storage: 'Storage' })[row.resource] || meterName(row.resource)}</span><span className="text-[10px] text-fg-muted tabular-nums">{row.meter ? `${Math.round(percent)}%` : 'No data'}</span></div>
        <div className="h-2 overflow-hidden rounded-full bg-surface-3"><span className="block h-full rounded-full" style={{ width: row.meter ? `${Math.min(100, percent)}%` : '0%', backgroundColor: bar }} /></div>
        <p className="m-0 mt-1 truncate text-[9px] text-fg-subtle">{row.meter ? `${row.orgName} · ${meterText(row.resource, row.meter)}` : 'No organization meter'}</p>
      </div>
    })}
  </div>
}

function ActivityList({ rows, loading, error }) {
  if (loading) return <div className="space-y-3 p-5">{Array.from({ length: 3 }).map((_, index) => <div key={index} className="h-[52px] animate-pulse rounded-[9px] bg-surface-3" />)}</div>
  if (error) return <div className="flex min-h-[180px] items-center justify-center px-6 text-center text-sm text-danger-fg">Recent activity is unavailable.</div>
  if (!rows.length) return <div className="flex min-h-[180px] flex-col items-center justify-center px-6 text-center"><p className="m-0 text-sm font-semibold text-fg">No platform events yet</p><p className="m-0 mt-1 text-xs text-fg-muted">Lifecycle changes will appear here.</p></div>
  return <ul className="m-0 list-none divide-y divide-line p-0">{rows.map((log) => <li key={log._id} className="flex items-center gap-3 px-5 py-3.5 hover:bg-surface-2/70">
    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px] bg-info-subtle text-info-fg"><ShieldCheck className="h-4 w-4" strokeWidth={1.8} /></span>
    <div className="min-w-0 flex-1"><p className="m-0 truncate text-[12px] text-fg"><strong className="font-semibold">{activityLabel(log)}</strong><span className="text-fg-muted"> · {log.targetEntity || 'Organization'}</span></p><p className="m-0 mt-0.5 truncate text-[10px] text-fg-muted">By {log.performedBy?.name || 'System'}</p></div>
    <time className="shrink-0 text-[10px] text-fg-subtle" dateTime={isoAttr(log.createdAt)} title={formatDateTime(log.createdAt)}>{relativeTime(log.createdAt) || '—'}</time>
  </li>)}</ul>
}

function ServiceRow({ icon: Icon, name, status, detail, checked, loading }) {
  const ok = status === 'ok'
  return <Link to="/health" className="flex min-h-[86px] items-center gap-3 border-b border-line px-5 py-4 last:border-b-0 hover:bg-surface-2">
    <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-[9px] ${ok ? 'bg-success-subtle text-success-fg' : 'bg-danger-subtle text-danger-fg'}`}><Icon className="h-4 w-4" strokeWidth={1.8} /></span>
    <div className="min-w-0 flex-1"><div className="flex items-center gap-2"><p className="m-0 text-[13px] font-semibold text-fg">{name}</p>{!loading && <span className={`inline-flex items-center gap-1 text-[10px] font-semibold ${ok ? 'text-success-fg' : 'text-danger-fg'}`}><span className="h-1.5 w-1.5 rounded-full bg-current" />{ok ? 'Healthy' : 'Unavailable'}</span>}</div><p className="m-0 mt-1 truncate text-[11px] text-fg-muted">{loading ? 'Checking service...' : detail}</p>{!loading && <p className="m-0 mt-0.5 text-[10px] text-fg-subtle">{checked}</p>}</div>
    <ArrowRight className="h-4 w-4 shrink-0 text-fg-subtle" />
  </Link>
}

export default function PlatformOverviewIntegrated() {
  const [orgs, setOrgs] = useState([])
  const [health, setHealth] = useState(null)
  const [activity, setActivity] = useState([])
  const [orgsLoading, setOrgsLoading] = useState(true)
  const [healthLoading, setHealthLoading] = useState(true)
  const [activityLoading, setActivityLoading] = useState(true)
  const [orgsError, setOrgsError] = useState('')
  const [healthError, setHealthError] = useState('')
  const [activityError, setActivityError] = useState('')
  const [lastUpdatedAt, setLastUpdatedAt] = useState(null)

  const loadOrganizations = useCallback(async () => {
    setOrgsLoading(true)
    setOrgsError('')
    try {
      const data = await api.get('/api/platform/orgs')
      setOrgs(data.orgs || [])
    } catch (error) {
      setOrgsError(error.message || 'Could not load organizations')
    } finally {
      setOrgsLoading(false)
    }
  }, [])

  const loadHealth = useCallback(async () => {
    setHealthLoading(true)
    setHealthError('')
    try {
      setHealth(await api.get('/api/platform/health'))
    } catch (error) {
      setHealthError(error.message || 'Could not load platform health')
    } finally {
      setHealthLoading(false)
    }
  }, [])

  const loadActivity = useCallback(async () => {
    setActivityLoading(true)
    setActivityError('')
    try {
      const data = await api.get('/api/platform/activity?page=1&limit=5')
      setActivity((data.logs || []).slice(0, 5))
    } catch (error) {
      setActivityError(error.message || 'Could not load recent activity')
    } finally {
      setActivityLoading(false)
    }
  }, [])

  const refresh = useCallback(async () => {
    await Promise.all([loadOrganizations(), loadHealth(), loadActivity()])
    setLastUpdatedAt(new Date())
  }, [loadActivity, loadHealth, loadOrganizations])

  useEffect(() => {
    const timer = window.setTimeout(refresh, 0)
    return () => window.clearTimeout(timer)
  }, [refresh])

  const summary = useMemo(() => {
    const counts = { active: 0, trial: 0, suspended: 0 }
    const planCounts = new Map()
    const risks = []
    const seen = new Set()
    const fleet = []

    orgs.forEach((org, index) => {
      const id = String(org._id || org.subdomain || org.name || `organization-${index}`)
      if (seen.has(id)) return
      seen.add(id)
      fleet.push(org)
      counts[orgState(org)] += 1
      const plan = org.plan || 'custom'
      planCounts.set(plan, (planCounts.get(plan) || 0) + 1)
      const risk = organizationRisk(org)
      if (risk) risks.push({ org, ...risk, utilization: Number(risk.meter?.percent || pressure(org)) })
    })

    risks.sort((a, b) => b.rank - a.rank || b.utilization - a.utilization || String(a.org.name || '').localeCompare(String(b.org.name || '')))

    const capacityRows = fleet.map((org) => {
      const highest = highestMeter(org)
      return { org, resource: highest?.[0], meter: highest?.[1], utilization: highest ? Number(highest[1]?.percent || 0) : 0 }
    }).sort((a, b) => b.utilization - a.utilization || String(a.org.name || '').localeCompare(String(b.org.name || ''))).slice(0, 5)

    const resourcePressure = ['users', 'builders', 'submissions', 'storage'].map((resource) => {
      const highest = fleet
        .map((org) => ({ org, meter: org.licensing?.resources?.[resource] }))
        .filter((entry) => entry.meter)
        .sort((a, b) => Number(b.meter.percent || 0) - Number(a.meter.percent || 0))[0]
      return {
        resource,
        meter: highest?.meter || null,
        orgName: highest?.org?.name || highest?.org?.subdomain || 'Organization'
      }
    })

    const plans = [...planCounts.entries()]
      .filter(([, count]) => count > 0)
      .map(([key, count]) => ({ key, count, label: planLabel(key) }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))

    const critical = risks.filter((risk) => risk.tone === 'danger').length
    const warning = risks.filter((risk) => risk.tone === 'warning').length

    return {
      counts,
      total: seen.size,
      critical,
      warning,
      clear: Math.max(0, seen.size - critical - warning),
      capacityWarnings: risks.filter((risk) => risk.tone === 'warning' && risk.type === 'limit').length,
      attention: risks.slice(0, 5),
      capacityRows,
      resourcePressure,
      plans
    }
  }, [orgs])

  const apiOk = health?.api?.status === 'ok'
  const databaseOk = health?.database?.status === 'ok'
  const healthCheckedAt = health?.api?.timestamp
  const healthValue = health && apiOk && databaseOk ? 'Healthy' : 'Degraded'
  const refreshing = orgsLoading || healthLoading || activityLoading
  const refreshedLabel = lastUpdatedAt ? formatDateTime(lastUpdatedAt) : 'Waiting for first refresh'

  const licenceLabel = (org) => {
    const licence = org.licensing?.licence
    if (licence?.readOnly) return 'Read-only licence'
    if (licence?.isTrial) return licence.daysLeft != null ? `Trial · ${Math.max(0, licence.daysLeft)} days left` : 'Trial licence'
    return 'Active licence'
  }

  return <AppShell
    title="Platform overview"
    subtitle="Prioritize tenant intervention, capacity pressure, and core platform health."
    actions={<div className="flex flex-wrap items-center justify-end gap-2">
      <span className="hidden text-[11px] text-fg-muted lg:inline">Last updated {refreshedLabel}</span>
      <button type="button" onClick={refresh} disabled={refreshing} className="inline-flex min-h-10 items-center gap-2 rounded-[9px] border border-line bg-surface px-3 py-2 text-xs font-semibold text-fg hover:bg-surface-2 disabled:opacity-50">
        <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} />Refresh live data
      </button>
      <Link to="/health" className="inline-flex min-h-10 items-center gap-2 rounded-[9px] bg-indigo-600 px-4 py-2 text-xs font-semibold text-white shadow-sm hover:bg-indigo-700">
        <HeartPulse className="h-4 w-4" />Open system health
      </Link>
    </div>}
  >
    <div className="space-y-[18px]">
      {orgsError ? <AlertBanner onRetry={loadOrganizations}>{orgsError}</AlertBanner> : null}

      <div className="grid grid-cols-1 gap-[18px] sm:grid-cols-2 xl:grid-cols-4">
        <Metric
          label="Total organizations"
          value={orgsError && !orgs.length ? '—' : summary.total}
          helper={orgsError && !orgs.length ? 'Organization data unavailable' : `${summary.counts.active} active · ${summary.counts.trial} trial · ${summary.counts.suspended} suspended`}
          icon={Building2}
          loading={orgsLoading}
        />
        <Metric
          label="Critical organizations"
          value={orgsError && !orgs.length ? '—' : summary.critical}
          helper="Suspended, expired, read-only, or over limit"
          icon={CircleAlert}
          tone="red"
          loading={orgsLoading}
        />
        <Metric
          label="Capacity warnings"
          value={orgsError && !orgs.length ? '—' : summary.capacityWarnings}
          helper="Unique organizations approaching a resource limit"
          icon={ChartNoAxesColumnIncreasing}
          tone="amber"
          loading={orgsLoading}
        />
        <Metric
          label="Platform health"
          value={healthError && !health ? '—' : healthValue}
          helper={healthError && !health ? 'Health data unavailable' : healthCheckedAt ? `Checked ${relativeTime(healthCheckedAt)}` : 'Core API and database'}
          icon={HeartPulse}
          tone={health && apiOk && databaseOk ? 'blue' : 'violet'}
          loading={healthLoading}
        />
      </div>

      <div className="grid grid-cols-1 gap-[18px] xl:grid-cols-2">
        <Panel
          title="Organization risk posture"
          description="Exclusive critical, warning, and clear organization counts."
          action={<span className="rounded-full bg-surface-3 px-2.5 py-1 text-[10px] font-semibold text-fg-muted">Live posture</span>}
        >
          <RiskPostureChart
            critical={summary.critical}
            warning={summary.warning}
            clear={summary.clear}
            loading={orgsLoading}
            error={orgsError && !orgs.length}
          />
        </Panel>
        <Panel
          title="Resource pressure"
          description="Highest tenant utilization for each operational resource."
          action={<Link to="/usage" className="inline-flex items-center gap-1 text-xs font-semibold text-indigo-600 hover:underline dark:text-indigo-300">View all usage <ArrowRight className="h-3.5 w-3.5" /></Link>}
        >
          <ResourcePressureChart
            rows={summary.resourcePressure}
            loading={orgsLoading}
            error={orgsError && !orgs.length}
          />
        </Panel>
      </div>

      <Panel
        title="Organizations needing attention"
        description="Each organization appears once under its highest-severity issue."
        action={<Link to="/usage" className="inline-flex items-center gap-1 text-xs font-semibold text-indigo-600 hover:underline dark:text-indigo-300">View all usage <ArrowRight className="h-3.5 w-3.5" /></Link>}
      >
        <div className="overflow-x-auto">
          <table className="w-full min-w-[940px] border-collapse">
            <TableHead labels={['Severity', 'Organization', 'Primary issue', 'Current / limit', 'Plan or licence', 'Action']} />
            <tbody>
              {orgsLoading ? <EmptyRow columns={6}>Loading organizations...</EmptyRow> : orgsError && !orgs.length ? <EmptyRow columns={6}>Organizations needing attention are unavailable.</EmptyRow> : summary.attention.length === 0 ? <EmptyRow columns={6}>No organizations currently need intervention.</EmptyRow> : summary.attention.map((item) => {
                const orgName = item.org.name || item.org.subdomain || 'Unnamed organization'
                const filter = item.org.subdomain || orgName
                return <tr key={item.org._id || filter} className="border-b border-line last:border-b-0 hover:bg-surface-2/70">
                  <td className="px-4 py-3.5 pl-5"><SeverityBadge tone={item.tone}>{item.label}</SeverityBadge></td>
                  <td className="px-4 py-3.5"><strong className="block max-w-[190px] truncate text-[13px] text-fg" title={orgName}>{orgName}</strong><span className="mt-0.5 block text-[10px] text-fg-muted">{item.org.subdomain || 'No subdomain'}</span></td>
                  <td className="px-4 py-3.5 text-[12px] font-medium text-fg">{item.reason}</td>
                  <td className="px-4 py-3.5 text-[12px] tabular-nums text-fg-muted">{item.current || '—'}</td>
                  <td className="px-4 py-3.5"><span className="block text-[12px] font-medium text-fg">{planLabel(item.org.plan)}</span><span className="mt-0.5 block text-[10px] text-fg-muted">{licenceLabel(item.org)}</span></td>
                  <td className="px-4 py-3.5 pr-5"><Link to={`/platform?q=${encodeURIComponent(filter)}`} className="inline-flex min-h-9 items-center rounded-[8px] border border-line px-3 py-2 text-xs font-semibold text-fg hover:bg-surface-2">Review organization</Link></td>
                </tr>
              })}
            </tbody>
          </table>
        </div>
      </Panel>

      <Panel
        title="Capacity and entitlement utilization"
        description="The highest resource pressure across the fleet, with the meters needed to verify each warning."
        action={<Link to="/usage" className="inline-flex items-center gap-1 text-xs font-semibold text-indigo-600 hover:underline dark:text-indigo-300">View all usage <ArrowRight className="h-3.5 w-3.5" /></Link>}
      >
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1040px] border-collapse">
            <TableHead labels={['Organization', 'Highest utilization', 'Users', 'Builders', 'Submissions', 'Storage', 'Plan']} />
            <tbody>
              {orgsLoading ? <EmptyRow columns={7}>Loading capacity data...</EmptyRow> : orgsError && !orgs.length ? <EmptyRow columns={7}>Capacity data is unavailable.</EmptyRow> : summary.capacityRows.length === 0 ? <EmptyRow columns={7}>No organization usage is available yet.</EmptyRow> : summary.capacityRows.map(({ org, resource, meter }) => {
                const meters = org.licensing?.resources || {}
                return <tr key={org._id || org.subdomain} className="border-b border-line last:border-b-0 hover:bg-surface-2/70">
                  <td className="px-4 py-3.5 pl-5"><strong className="block max-w-[180px] truncate text-[13px] text-fg" title={org.name}>{org.name || org.subdomain || 'Unnamed organization'}</strong><span className="mt-0.5 block text-[10px] text-fg-muted">{org.subdomain || 'No subdomain'}</span></td>
                  <td className="px-4 py-3.5"><UsagePressure resource={resource} meter={meter} /></td>
                  <td className="px-4 py-3.5 text-[11px] whitespace-nowrap text-fg-muted">{meterText('users', meters.users)}</td>
                  <td className="px-4 py-3.5 text-[11px] whitespace-nowrap text-fg-muted">{meterText('builders', meters.builders)}</td>
                  <td className="px-4 py-3.5 text-[11px] whitespace-nowrap text-fg-muted">{meterText('submissions', meters.submissions)}</td>
                  <td className="px-4 py-3.5 text-[11px] whitespace-nowrap text-fg-muted">{meterText('storage', meters.storage)}</td>
                  <td className="px-4 py-3.5 pr-5 text-[12px] font-medium text-fg">{planLabel(org.plan)}</td>
                </tr>
              })}
            </tbody>
          </table>
        </div>
      </Panel>

      <div className="grid grid-cols-1 gap-[18px] xl:grid-cols-2">
        <Panel title="Plan mix" description="Assigned plans only; unassigned catalogue plans are hidden.">
          <PlanMix rows={summary.plans} total={summary.total} loading={orgsLoading} error={orgsError && !orgs.length} />
        </Panel>
        <Panel
          title="Core service health"
          description="Availability of the services required to operate the platform."
          action={<Link to="/health" className="inline-flex items-center gap-1 text-xs font-semibold text-indigo-600 hover:underline dark:text-indigo-300">Open system health <ArrowRight className="h-3.5 w-3.5" /></Link>}
        >
          {healthError && !health ? <div className="border-b border-danger-line bg-danger-subtle px-5 py-2 text-[11px] text-danger-fg">{healthError}</div> : null}
          <ServiceRow
            icon={Server}
            name="Core API"
            status={health?.api?.status}
            detail={healthError && !health ? 'Health data unavailable' : `Uptime ${formatUptime(health?.api?.uptimeSeconds)} · ${health?.api?.service || 'Service details unavailable'}`}
            checked={healthCheckedAt ? `Last checked ${formatDateTime(healthCheckedAt)}` : 'Last checked unavailable'}
            loading={healthLoading}
          />
          <ServiceRow
            icon={Database}
            name="Database"
            status={health?.database?.status}
            detail={healthError && !health ? 'Health data unavailable' : `Connection: ${health?.database?.readyState || 'unavailable'} · ${health?.database?.name || 'Database name unavailable'}`}
            checked={healthCheckedAt ? `Last checked ${formatDateTime(healthCheckedAt)}` : 'Last checked unavailable'}
            loading={healthLoading}
          />
        </Panel>
      </div>

      <Panel
        title="Recent platform activity"
        description="The five latest organization lifecycle changes."
        action={<Link to="/activity" className="inline-flex items-center gap-1 text-xs font-semibold text-indigo-600 hover:underline dark:text-indigo-300">View activity <ArrowRight className="h-3.5 w-3.5" /></Link>}
      >
        <ActivityList rows={activity} loading={activityLoading} error={activityError} />
      </Panel>
    </div>
  </AppShell>
}
