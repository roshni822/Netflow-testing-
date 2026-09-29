import { PlatformAnnouncement } from '../components/PlatformOperations'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, ArrowRight, Building2, Database, Gauge, HeartPulse, RefreshCw, Server, ShieldCheck, Users } from 'lucide-react'
import AppShell from '../components/AppShell'
import { AlertBanner } from '../components/Alert'
import {
  OrganizationComparisonChart,
  OrganizationGrowthChart,
  ResourceUtilizationChart
} from '../components/PlatformDashboardCharts'
import {
  HISTORY_OPTIONS,
  RESOURCE_OPTIONS,
  buildDashboardAnalytics,
  normalizeHistory,
  organizationName,
  planLabel,
  rankOrganizations,
  resourceLabel,
  titleCase
} from '../lib/platformDashboardAnalytics'
import { meterText } from '../lib/licensing'
import { api } from '../utils/api'
import { formatDateTime, isoAttr, relativeTime } from '../utils/datetime'

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

function activityLabel(log) {
  if (log.action === 'org_updated' && (log.metadata?.planFrom || log.metadata?.planTo)) return 'Plan assigned'
  return ({
    org_created: 'Organization created',
    org_updated: 'Organization updated',
    org_suspended: 'Organization suspended',
    org_activated: 'Organization reactivated',
    org_deleted: 'Organization deleted',
    org_admin_password_reset: 'Admin password reset',
    org_storage_extended: 'Storage extension granted',
    org_storage_extension_revoked: 'Storage extension revoked',
    org_licence_expired: 'Organization licence expired',
    org_limit_reached: 'Organization limit reached',
    platform_broadcast_sent: 'Platform broadcast sent'
  })[log.action] || titleCase(log.action || 'Platform event')
}

function Kpi({ label, value, helper, icon: Icon, tone = 'neutral', loading }) {
  const tones = {
    neutral: ['bg-surface-3 text-fg-muted', 'bg-surface-3'],
    info: ['bg-[#e7eef8] text-[#245a9a]', 'bg-[#eaf1f8]'],
    success: ['bg-success-subtle text-success-fg', 'bg-[#eaf3ee]'],
    warning: ['bg-warning-subtle text-warning-fg', 'bg-[#faf1df]'],
    danger: ['bg-danger-subtle text-danger-fg', 'bg-[#fbefec]']
  }
  const selected = tones[tone] || tones.neutral
  return <article className="relative min-h-[150px] overflow-hidden rounded-[12px] border border-line bg-surface p-[18px] shadow-sm">
    <span className={`absolute -bottom-9 -right-7 h-24 w-24 rounded-full ${selected[1]}`} aria-hidden="true" />
    <div className="relative z-[1] flex h-full flex-col">
      <div className="flex items-start justify-between gap-3">
        <p className="m-0 pt-1 text-[13px] font-medium text-fg-muted">{label}</p>
        <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] ${selected[0]}`}><Icon className="h-[18px] w-[18px]" strokeWidth={1.8} /></span>
      </div>
      <p className="m-0 mt-auto text-[28px] font-bold leading-none tracking-[-0.035em] text-fg tabular-nums">{loading ? '?' : value}</p>
      <p className="m-0 mt-3 max-w-[88%] text-[11px] leading-tight text-fg-muted">{loading ? 'Loading live data' : helper}</p>
    </div>
  </article>
}

function Panel({ title, description, action, children }) {
  return <section className="overflow-hidden rounded-[12px] border border-line bg-surface shadow-sm">
    <header className="flex min-h-[60px] flex-wrap items-start justify-between gap-4 border-b border-line px-[18px] py-4">
      <div className="min-w-0"><h2 className="m-0 text-[20px] font-bold leading-tight tracking-[-0.025em] text-fg">{title}</h2>{description ? <p className="m-0 mt-0.5 text-[11px] text-fg-muted">{description}</p> : null}</div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </header>
    {children}
  </section>
}

function SegmentedControl({ options, value, onChange, label }) {
  return <div className="inline-flex rounded-[9px] border border-line bg-surface-2 p-0.5" role="group" aria-label={label}>
    {options.map((option) => {
      const optionValue = option.value || option.key
      return <button key={optionValue} type="button" aria-pressed={value === optionValue} onClick={() => onChange(optionValue)} className={`min-h-8 rounded-[7px] px-3 text-[11px] font-semibold transition ${value === optionValue ? 'bg-surface text-fg shadow-sm' : 'text-fg-muted hover:text-fg'}`}>{option.label}</button>
    })}
  </div>
}

function TableHead({ labels }) {
  return <thead className="bg-surface-3/80"><tr>{labels.map((label) => <th key={label} scope="col" className="border-b border-line px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-[0.08em] text-fg-muted first:pl-5 last:pr-5">{label}</th>)}</tr></thead>
}

function EmptyRow({ columns, children }) {
  return <tr><td colSpan={columns} className="px-5 py-10 text-center text-sm text-fg-muted">{children}</td></tr>
}

function SeverityBadge({ severity }) {
  const critical = severity === 'critical'
  return <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-semibold ${critical ? 'bg-danger-subtle text-danger-fg' : 'bg-warning-subtle text-warning-fg'}`}><span className="h-1.5 w-1.5 rounded-full bg-current" />{critical ? 'Critical' : 'Warning'}</span>
}

function ServiceLine({ icon: Icon, name, status, detail, loading }) {
  const ok = status === 'ok'
  return <div className="flex min-h-[86px] items-center gap-3 border-b border-line px-5 py-4 last:border-b-0">
    <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-[9px] ${ok ? 'bg-success-subtle text-success-fg' : 'bg-danger-subtle text-danger-fg'}`}><Icon className="h-4 w-4" strokeWidth={1.8} /></span>
    <div className="min-w-0 flex-1"><div className="flex items-center gap-2"><strong className="text-[13px] text-fg">{name}</strong>{!loading ? <span className={`inline-flex items-center gap-1 text-[10px] font-semibold ${ok ? 'text-success-fg' : 'text-danger-fg'}`}><span className="h-1.5 w-1.5 rounded-full bg-current" />{ok ? 'Healthy' : 'Unavailable'}</span> : null}</div><p className="m-0 mt-1 truncate text-[11px] text-fg-muted">{loading ? 'Checking service...' : detail}</p></div>
  </div>
}

function ActivityList({ rows, loading, error }) {
  if (loading) return <div className="space-y-3 p-5">{Array.from({ length: 5 }).map((_, index) => <div key={index} className="h-[52px] animate-pulse rounded-[9px] bg-surface-3" />)}</div>
  if (error) return <div className="flex min-h-[238px] items-center justify-center px-6 text-center text-xs text-danger-fg">Unable to load recent activity.</div>
  if (!rows.length) return <div className="flex min-h-[238px] flex-col items-center justify-center px-6 text-center"><p className="m-0 text-sm font-semibold text-fg">No platform activity yet</p><p className="m-0 mt-1 text-xs text-fg-muted">Lifecycle changes will appear here.</p></div>

  return <ul className="m-0 list-none divide-y divide-line p-0">{rows.map((log) => <li key={log._id} className="grid grid-cols-[32px_minmax(0,1fr)_auto] items-center gap-3 px-5 py-3.5 hover:bg-surface-2/70">
    <span className="flex h-8 w-8 items-center justify-center rounded-[9px] bg-info-subtle text-info-fg"><ShieldCheck className="h-4 w-4" strokeWidth={1.8} /></span>
    <div className="min-w-0"><p className="m-0 truncate text-[12px] text-fg"><strong className="font-semibold">{activityLabel(log)}</strong><span className="text-fg-muted"> ? {log.targetEntity || 'Organization'}</span></p><p className="m-0 mt-0.5 truncate text-[10px] text-fg-muted">{log.performedBy?.name || 'System'}</p></div>
    <time className="shrink-0 text-[10px] text-fg-subtle" dateTime={isoAttr(log.createdAt)} title={formatDateTime(log.createdAt)}>{relativeTime(log.createdAt) || '?'}</time>
  </li>)}</ul>
}

export default function PlatformOverviewEnterprise() {
  const [orgs, setOrgs] = useState([])
  const [health, setHealth] = useState(null)
  const [activity, setActivity] = useState([])
  const [history, setHistory] = useState([])
  const [range, setRange] = useState('6M')
  const [rankingMetric, setRankingMetric] = useState('users')
  const [orgsLoading, setOrgsLoading] = useState(true)
  const [healthLoading, setHealthLoading] = useState(true)
  const [activityLoading, setActivityLoading] = useState(true)
  const [historyLoading, setHistoryLoading] = useState(true)
  const [orgsError, setOrgsError] = useState('')
  const [healthError, setHealthError] = useState('')
  const [activityError, setActivityError] = useState('')
  const [historyError, setHistoryError] = useState('')
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

  const loadHistory = useCallback(async () => {
    setHistoryLoading(true)
    setHistoryError('')
    try {
      const data = await api.get(`/api/platform/historical-stats?range=${encodeURIComponent(range)}`)
      setHistory(normalizeHistory(data.snapshots))
    } catch (error) {
      setHistoryError(error.message || 'Could not load organization history')
    } finally {
      setHistoryLoading(false)
    }
  }, [range])

  const refreshCurrent = useCallback(async () => {
    await Promise.all([loadOrganizations(), loadHealth(), loadActivity()])
    setLastUpdatedAt(new Date())
  }, [loadActivity, loadHealth, loadOrganizations])

  useEffect(() => {
    const timer = window.setTimeout(refreshCurrent, 0)
    return () => window.clearTimeout(timer)
  }, [refreshCurrent])

  useEffect(() => {
    const timer = window.setTimeout(loadHistory, 0)
    return () => window.clearTimeout(timer)
  }, [loadHistory])

  const analytics = useMemo(() => buildDashboardAnalytics(orgs), [orgs])
  const rankedOrganizations = useMemo(() => rankOrganizations(analytics.fleet, rankingMetric), [analytics.fleet, rankingMetric])
  const apiOk = health?.api?.status === 'ok'
  const databaseOk = health?.database?.status === 'ok'
  const platformHealthy = Boolean(health && apiOk && databaseOk)
  const refreshing = orgsLoading || healthLoading || activityLoading || historyLoading
  const highest = analytics.highestPressure
  const highestMeter = highest?.highestMeter
  const highestValue = highestMeter ? `${Math.round(Number(highestMeter.percent || 0))}%` : '?'
  const highestHelper = highestMeter ? `${highest.label} ? ${organizationName(highest.highestOrganization)}` : 'No metered resource limits'
  const updatedLabel = lastUpdatedAt ? formatDateTime(lastUpdatedAt) : 'Waiting for first refresh'

  const refreshAll = async () => {
    await Promise.all([refreshCurrent(), loadHistory()])
  }

  return <AppShell
    title="Platform overview"
    subtitle="Monitor platform health, organization growth, resource utilization, and operational risk."
    actions={<div className="flex flex-wrap items-center justify-end gap-2">
      <span className="hidden text-[11px] text-fg-muted lg:inline">Last updated {updatedLabel}</span>
      <button type="button" onClick={refreshAll} disabled={refreshing} className="inline-flex min-h-10 items-center gap-2 rounded-[9px] border border-line bg-surface px-3 py-2 text-xs font-semibold text-fg hover:bg-surface-2 disabled:opacity-50">
        <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} />Refresh live data
      </button>
      <Link to="/health" className="inline-flex min-h-10 items-center gap-2 rounded-[9px] bg-indigo-600 px-4 py-2 text-xs font-semibold text-white shadow-sm hover:bg-indigo-700">
        <HeartPulse className="h-4 w-4" />Open system health
      </Link>
    </div>}
  >
    <div className="space-y-[18px]">
      {orgsError ? <AlertBanner onRetry={loadOrganizations}>{orgsError}</AlertBanner> : null}

      <section aria-label="Executive platform summary" className="grid grid-cols-1 gap-[18px] sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        <Kpi label="Total organizations" value={orgsError && !orgs.length ? '?' : analytics.total} helper={analytics.total ? `${analytics.trial} trial ? ${analytics.suspended} suspended` : 'Current platform tenants'} icon={Building2} tone="info" loading={orgsLoading} />
        <Kpi label="Active organizations" value={orgsError && !orgs.length ? '?' : analytics.active} helper="Writable organizations currently operating" icon={Users} tone="success" loading={orgsLoading} />
        <Kpi label="Needs attention" value={orgsError && !orgs.length ? '?' : analytics.attentionCount} helper={analytics.attentionCount ? `${analytics.criticalCount} critical ? ${analytics.warningCount} warning` : 'No organization intervention required'} icon={AlertTriangle} tone={analytics.criticalCount ? 'danger' : analytics.warningCount ? 'warning' : 'success'} loading={orgsLoading} />
        <Kpi label="Highest pressure" value={orgsError && !orgs.length ? '?' : highestValue} helper={orgsError && !orgs.length ? 'Usage data unavailable' : highestHelper} icon={Gauge} tone={highestMeter?.state === 'exceeded' ? 'danger' : ['critical', 'warning'].includes(highestMeter?.state) ? 'warning' : 'info'} loading={orgsLoading} />
        <Kpi label="Platform health" value={healthError && !health ? '?' : platformHealthy ? 'Healthy' : 'Degraded'} helper={healthError && !health ? 'Health data unavailable' : health?.api?.timestamp ? `Checked ${relativeTime(health.api.timestamp)}` : 'Core API and database'} icon={HeartPulse} tone={platformHealthy ? 'success' : 'danger'} loading={healthLoading} />
      </section>

      <Panel title="Organization growth" description="Total organizations over time, reconstructed from auditable lifecycle events." action={<SegmentedControl options={HISTORY_OPTIONS} value={range} onChange={setRange} label="Organization history range" />}>
        <OrganizationGrowthChart rows={history} loading={historyLoading} error={historyError} onRetry={loadHistory} />
      </Panel>

      <div className="grid grid-cols-1 gap-[18px] xl:grid-cols-2">
        <Panel title="Total Resource utilization" description="Used versus licensed capacity across organizations with finite limits." action={<Link to="/usage" className="inline-flex items-center gap-1 text-xs font-semibold text-indigo-600 hover:underline dark:text-indigo-300">View all usage <ArrowRight className="h-3.5 w-3.5" /></Link>}>
          <ResourceUtilizationChart rows={analytics.total ? analytics.resources : []} loading={orgsLoading} error={orgsError && !orgs.length ? orgsError : ''} />
        </Panel>

        <Panel title="Organization analytics" description={`Organizations ranked by current ${resourceLabel(rankingMetric).toLowerCase()} usage.`} action={<>
          <div className="sm:hidden"><label className="sr-only" htmlFor="organization-ranking-metric">Ranking metric</label><select id="organization-ranking-metric" value={rankingMetric} onChange={(event) => setRankingMetric(event.target.value)} className="min-h-9 rounded-[9px] border border-line bg-surface px-2.5 text-[11px] font-semibold text-fg">{RESOURCE_OPTIONS.map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}</select></div>
          <div className="hidden sm:block"><SegmentedControl options={RESOURCE_OPTIONS} value={rankingMetric} onChange={setRankingMetric} label="Organization ranking metric" /></div>
        </>}>
          <OrganizationComparisonChart rows={rankedOrganizations} resource={rankingMetric} loading={orgsLoading} error={orgsError && !orgs.length ? orgsError : ''} />
        </Panel>
      </div>

      <Panel title="Action required" description="Organizations are listed once under their highest-severity actionable issue." action={<Link to="/usage" className="inline-flex items-center gap-1 text-xs font-semibold text-indigo-600 hover:underline dark:text-indigo-300">View all usage <ArrowRight className="h-3.5 w-3.5" /></Link>}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] border-collapse">
            <TableHead labels={['Severity', 'Organization', 'Issue', 'Current / limit', 'Impact', 'Action']} />
            <tbody>
              {orgsLoading ? <EmptyRow columns={6}>Loading organization risks...</EmptyRow> : orgsError && !orgs.length ? <EmptyRow columns={6}>Unable to load organizations requiring attention.</EmptyRow> : !analytics.total ? <EmptyRow columns={6}>No organizations yet. Create your first organization to start seeing platform analytics.</EmptyRow> : !analytics.attention.length ? <EmptyRow columns={6}>No organizations currently require attention.</EmptyRow> : analytics.attention.map((item) => {
                const filter = item.org.subdomain || organizationName(item.org)
                const currentLimit = item.meter ? meterText(item.resource, item.meter).replace(' of ', ' / ') : item.currentLimit || '?'
                return <tr key={item.org._id || filter} className="border-b border-line last:border-b-0 hover:bg-surface-2/70">
                  <td className="px-4 py-3.5 pl-5"><SeverityBadge severity={item.severity} /></td>
                  <td className="px-4 py-3.5"><strong className="block max-w-[190px] truncate text-[13px] text-fg" title={organizationName(item.org)}>{organizationName(item.org)}</strong><span className="mt-0.5 block text-[10px] text-fg-muted">{item.org.subdomain || 'No subdomain'}</span></td>
                  <td className="px-4 py-3.5 text-[12px] font-medium text-fg">{item.issue}</td>
                  <td className="px-4 py-3.5 text-[12px] tabular-nums text-fg-muted">{currentLimit}</td>
                  <td className="px-4 py-3.5"><span className="block text-[12px] text-fg">{item.impact}</span><span className="mt-0.5 block text-[10px] text-fg-muted">{planLabel(item.org)}</span></td>
                  <td className="px-4 py-3.5 pr-5"><Link to={`/platform?q=${encodeURIComponent(filter)}`} className="inline-flex min-h-9 items-center rounded-[8px] border border-line px-3 py-2 text-xs font-semibold text-fg hover:bg-surface-2">Review organization</Link></td>
                </tr>
              })}
            </tbody>
          </table>
        </div>
      </Panel>

      <div className="grid grid-cols-1 gap-[18px] xl:grid-cols-[0.8fr_1.2fr]">
        <Panel title="Platform health" description="Compact status for services required by the platform." action={<Link to="/health" className="inline-flex items-center gap-1 text-xs font-semibold text-indigo-600 hover:underline dark:text-indigo-300">View system health <ArrowRight className="h-3.5 w-3.5" /></Link>}>
          {healthError && !health ? <div className="border-b border-danger-line bg-danger-subtle px-5 py-2 text-[11px] text-danger-fg">{healthError}</div> : null}
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-1">
            <ServiceLine icon={Server} name="Core API" status={health?.api?.status} detail={healthError && !health ? 'Health data unavailable' : `Uptime ${formatUptime(health?.api?.uptimeSeconds)} ? ${health?.api?.service || 'Service unavailable'}`} loading={healthLoading} />
            <ServiceLine icon={Database} name="Database" status={health?.database?.status} detail={healthError && !health ? 'Health data unavailable' : `Connection: ${health?.database?.readyState || 'unavailable'} ? ${health?.database?.name || 'Database unavailable'}`} loading={healthLoading} />
          </div>
          <p className="m-0 border-t border-line px-5 py-2.5 text-[10px] text-fg-subtle">{health?.api?.timestamp ? `Last checked ${formatDateTime(health.api.timestamp)}` : 'Last checked time unavailable'}</p>
        </Panel>

        <Panel title="Recent activity" description="Latest five platform lifecycle events." action={<Link to="/activity" className="inline-flex items-center gap-1 text-xs font-semibold text-indigo-600 hover:underline dark:text-indigo-300">View all activity <ArrowRight className="h-3.5 w-3.5" /></Link>}>
          <ActivityList rows={activity} loading={activityLoading} error={activityError} />
        </Panel>
      </div>
      <PlatformAnnouncement organizations={orgs} />
    </div>
  </AppShell>
}
