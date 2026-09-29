import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts'
import { formatCount, formatMb } from '../lib/licensing'
import { organizationName, resourceLabel } from '../lib/platformDashboardAnalytics'

const TOOLTIP_STYLE = {
  background: 'var(--color-surface)',
  border: '1px solid var(--color-line)',
  borderRadius: '9px',
  boxShadow: '0 8px 24px rgb(36 39 44 / 12%)',
  color: 'var(--color-fg)',
  fontSize: '11px'
}

const formatMonth = (value) => new Date(value).toLocaleDateString(undefined, {
  month: 'short',
  year: '2-digit',
  timeZone: 'UTC'
})

const formatResourceValue = (resource, value) =>
  resource === 'storage' ? formatMb(value) : formatCount(value)

function LoadingChart({ compact = false }) {
  return <div className={`animate-pulse rounded-[9px] bg-surface-3 ${compact ? 'h-[220px]' : 'h-[286px]'}`} aria-label="Loading chart" />
}

function ChartMessage({ title, description, action }) {
  return <div className="flex min-h-[220px] flex-col items-center justify-center px-6 text-center">
    <p className="m-0 text-sm font-semibold text-fg">{title}</p>
    <p className="m-0 mt-1 max-w-md text-xs leading-relaxed text-fg-muted">{description}</p>
    {action ? <div className="mt-4">{action}</div> : null}
  </div>
}

export function OrganizationGrowthChart({ rows, loading, error, onRetry }) {
  if (loading) return <LoadingChart />
  if (error) return <ChartMessage title="Unable to load organization history" description={error} action={<button type="button" onClick={onRetry} className="rounded-[8px] border border-line px-3 py-2 text-xs font-semibold text-fg hover:bg-surface-2">Retry</button>} />
  if (!rows.length) return <ChartMessage title="No organization history yet" description="Monthly lifecycle activity will appear when historical records are available." />

  const last = rows[rows.length - 1]
  const lifecycleTotal = rows.reduce((sum, row) =>
    sum +
    row.newOrganizations +
    row.activatedOrganizations +
    row.suspendedOrganizations +
    row.deletedOrganizations, 0)
  const lifecycleSeries = [
    { key: 'newOrganizations', label: 'Created', color: '#2f8f57' },
    { key: 'activatedOrganizations', label: 'Activated', color: '#245a9a' },
    { key: 'suspendedOrganizations', label: 'Suspended', color: '#b8892d' },
    { key: 'deletedOrganizations', label: 'Deleted', color: '#b23b35' }
  ]

  return <div className="px-4 pb-4 pt-4 sm:px-5">
    <div className="flex flex-wrap items-end justify-between gap-4 px-1">
      <div>
        <span className="block text-[10px] font-semibold uppercase tracking-[0.08em] text-fg-subtle">Current total</span>
        <strong className="mt-1 block text-[28px] leading-none tracking-[-0.035em] text-fg tabular-nums">{formatCount(last.totalOrganizations)}</strong>
      </div>
      <p className="m-0 text-[10px] text-fg-muted">{rows.length} monthly lifecycle record{rows.length === 1 ? '' : 's'}</p>
    </div>

    <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 border-t border-line pt-3" aria-label="Lifecycle event legend">
      {lifecycleSeries.map((series) => <span key={series.key} className="inline-flex items-center gap-2 text-[11px] font-medium text-fg-muted">
        <span className="h-2.5 w-2.5 rounded-[2px]" style={{ backgroundColor: series.color }} aria-hidden="true" />
        {series.label}
      </span>)}
    </div>

    {lifecycleTotal === 0
      ? <ChartMessage title="No lifecycle activity in this range" description="There were no created, activated, suspended, or deleted organization events." />
      : <div className="mt-1 h-[270px]" role="img" aria-label={`Monthly organization lifecycle activity. Current total: ${last.totalOrganizations}`}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} margin={{ top: 16, right: 18, bottom: 4, left: -12 }} barCategoryGap="24%" barGap={2} accessibilityLayer>
            <CartesianGrid vertical={false} stroke="var(--color-line)" strokeDasharray="3 3" />
            <XAxis dataKey="timestamp" tickFormatter={formatMonth} axisLine={false} tickLine={false} minTickGap={24} tick={{ fontSize: 10, fill: 'var(--color-fg-muted)' }} />
            <YAxis allowDecimals={false} axisLine={false} tickLine={false} width={36} domain={[0, (maximum) => Math.max(1, maximum)]} tick={{ fontSize: 10, fill: 'var(--color-fg-muted)' }} />
            <Tooltip labelFormatter={formatMonth} formatter={(value, name) => [formatCount(value), name]} contentStyle={TOOLTIP_STYLE} cursor={{ fill: 'var(--color-surface-2)' }} />
            {lifecycleSeries.map((series) => <Bar key={series.key} dataKey={series.key} name={series.label} fill={series.color} radius={[3, 3, 0, 0]} maxBarSize={28} isAnimationActive={false} />)}
          </BarChart>
        </ResponsiveContainer>
      </div>}
  </div>
}

export function ResourceUtilizationChart({ rows, loading, error }) {
  if (loading) return <LoadingChart compact />
  if (error) return <ChartMessage title="Unable to load resource utilization" description={error} />
  if (!rows.length) return <ChartMessage title="No organizations yet" description="Create your first organization to start seeing platform analytics." />
  if (!rows.some((row) => row.hasData)) return <ChartMessage title="Usage data unavailable" description="Resource meters will appear when organization licensing data is available." />

  return <div className="space-y-4 px-5 py-4" role="img" aria-label="Fleet resource utilization across metered organizations">
    {rows.map((row) => {
      const percent = row.percent
      const width = percent == null ? 0 : Math.min(100, Math.max(0, percent))
      const color = percent != null && percent >= 100 ? '#b23b35' : percent != null && percent >= 80 ? '#b8892d' : '#245a9a'
      const primary = row.limit > 0
        ? `${formatResourceValue(row.resource, row.used)} / ${formatResourceValue(row.resource, row.limit)}`
        : `${formatResourceValue(row.resource, row.totalUsed)} used`
      const context = row.limit > 0
        ? `${row.meteredOrganizations} metered organization${row.meteredOrganizations === 1 ? '' : 's'}${row.unlimitedOrganizations ? ` · ${row.unlimitedOrganizations} unlimited` : ''}`
        : row.unlimitedOrganizations
          ? `${row.unlimitedOrganizations} organization${row.unlimitedOrganizations === 1 ? '' : 's'} with unlimited allowance`
          : 'No meter data'

      return <div key={row.resource}>
        <div className="flex items-start justify-between gap-4">
          <div><p className="m-0 text-[12px] font-semibold text-fg">{row.label}</p><p className="m-0 mt-0.5 text-[10px] text-fg-muted">{primary}</p></div>
          <strong className="text-[12px] text-fg tabular-nums">{percent == null ? 'Unlimited' : `${percent}%`}</strong>
        </div>
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-surface-3" role="progressbar" aria-label={`${row.label} utilization`} aria-valuemin="0" aria-valuemax="100" aria-valuenow={percent == null ? undefined : Math.min(100, Math.max(0, percent))}>
          <span className="block h-full rounded-full" style={{ width: `${width}%`, backgroundColor: color }} />
        </div>
        <p className="m-0 mt-1 text-[9px] text-fg-subtle">{context}</p>
      </div>
    })}
  </div>
}

export function OrganizationComparisonChart({ rows, resource, loading, error }) {
  if (loading) return <LoadingChart compact />
  if (error) return <ChartMessage title="Unable to load organization analytics" description={error} />
  if (!rows.length) return <ChartMessage title="No organizations yet" description="Create your first organization to start seeing platform analytics." />

  const maximum = Math.max(1, ...rows.map((row) => Number(row.meter?.used || 0)))

  return <div className="space-y-3.5 px-5 py-4" role="img" aria-label={`Organizations ranked by ${resourceLabel(resource).toLowerCase()}`}>
    {rows.map(({ org, meter }) => {
      const used = Number(meter?.used || 0)
      const width = used > 0 ? Math.max(2, (used / maximum) * 100) : 0
      const color = meter?.state === 'exceeded' ? '#b23b35' : ['critical', 'warning'].includes(meter?.state) ? '#b8892d' : '#245a9a'
      const allowance = meter?.unlimited
        ? 'Unlimited allowance'
        : `${formatResourceValue(resource, meter?.limit)} limit · ${Math.round(Number(meter?.percent || 0))}%`

      return <div key={org._id || org.subdomain}>
        <div className="mb-1 flex items-center justify-between gap-4">
          <span className="min-w-0 truncate text-[11px] font-semibold text-fg" title={organizationName(org)}>{organizationName(org)}</span>
          <span className="shrink-0 text-[10px] text-fg-muted tabular-nums">{formatResourceValue(resource, used)} used</span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-surface-3"><span className="block h-full rounded-full" style={{ width: `${width}%`, backgroundColor: color }} /></div>
        <p className="m-0 mt-1 truncate text-[9px] text-fg-subtle">{org.subdomain || 'No subdomain'} · {allowance}</p>
      </div>
    })}
  </div>
}
