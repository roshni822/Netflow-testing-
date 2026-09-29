import { useCallback, useEffect, useMemo, useState } from 'react'
import { Building2, Database, HeartPulse, RefreshCw, Server } from 'lucide-react'
import AppShell from '../components/AppShell'
import { AlertBanner } from '../components/Alert'
import { api } from '../utils/api'

const EMPTY = '\u2014'

const formatUptime = (seconds) => {
  if (seconds == null || Number.isNaN(Number(seconds))) return EMPTY
  const value = Math.max(0, Math.floor(Number(seconds)))
  const days = Math.floor(value / 86400)
  const hours = Math.floor((value % 86400) / 3600)
  const minutes = Math.floor((value % 3600) / 60)
  return days ? days + 'd ' + hours + 'h' : hours ? hours + 'h ' + minutes + 'm' : minutes + 'm'
}

const formatTime = (value) => {
  if (!value) return EMPTY
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? EMPTY
    : date.toLocaleString(undefined, {
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit'
      })
}

const titleCase = (value) => String(value || '')
  .replace(/[_-]+/g, ' ')
  .replace(/\b\w/g, (letter) => letter.toUpperCase())

function Metric({ label, value, helper, icon: Icon, tone = 'blue', loading }) {
  const tones = {
    blue: ['bg-[#e7eef8] text-[#245a9a]', 'bg-[#eaf1f8]'],
    green: ['bg-success-subtle text-success-fg', 'bg-[#eaf3ed]'],
    amber: ['bg-warning-subtle text-warning-fg', 'bg-[#faf1df]'],
    violet: ['bg-[#efecf5] text-[#675f87]', 'bg-[#f0edf5]']
  }
  const selected = tones[tone] || tones.blue

  return (
    <article className="relative min-h-[142px] overflow-hidden rounded-xl border border-line bg-surface p-4 shadow-sm">
      <span className={'absolute -bottom-9 -right-7 h-24 w-24 rounded-full ' + selected[1]} aria-hidden="true" />
      <div className="relative z-[1] flex h-full flex-col">
        <div className="flex items-start justify-between gap-3">
          <p className="m-0 pt-1 text-[12px] font-medium text-fg-muted">{label}</p>
          <span className={'flex h-9 w-9 items-center justify-center rounded-[10px] ' + selected[0]}>
            <Icon className="h-[18px] w-[18px]" strokeWidth={1.8} />
          </span>
        </div>
        <p className="m-0 mt-auto text-[26px] font-bold leading-none tracking-[-0.035em] text-fg">
          {loading ? EMPTY : value}
        </p>
        <p className="m-0 mt-3 max-w-[88%] text-[11px] text-fg-muted">
          {loading ? 'Checking live status' : helper}
        </p>
      </div>
    </article>
  )
}

function Pill({ ok, label, warning = false }) {
  const tone = ok
    ? 'bg-success-subtle text-success-fg'
    : warning
      ? 'bg-warning-subtle text-warning-fg'
      : 'bg-danger-subtle text-danger-fg'

  return (
    <span className={'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-semibold ' + tone}>
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {label}
    </span>
  )
}

function HealthPanel({ title, description, icon: Icon, tone, ok, status, rows, loading }) {
  const iconClass = tone === 'green'
    ? 'bg-success-subtle text-success-fg'
    : tone === 'violet'
      ? 'bg-[#efecf5] text-[#675f87]'
      : 'bg-[#e7eef8] text-[#245a9a]'

  return (
    <section className="rounded-xl border border-line bg-surface p-5 shadow-sm">
      {loading ? (
        <div className="h-52 animate-pulse rounded-lg bg-surface-3" />
      ) : (
        <>
          <div className="flex items-start justify-between gap-3">
            <span className={'flex h-10 w-10 items-center justify-center rounded-xl ' + iconClass}>
              <Icon className="h-5 w-5" strokeWidth={1.8} />
            </span>
            <Pill
              ok={ok}
              warning={!ok && status !== 'unavailable'}
              label={titleCase(status || 'unavailable')}
            />
          </div>
          <h2 className="m-0 mt-5 text-xl font-bold tracking-[-0.025em] text-fg">{title}</h2>
          <p className="m-0 mt-1 min-h-9 text-xs leading-relaxed text-fg-muted">{description}</p>
          <dl className="mt-5 grid grid-cols-2 gap-3 border-t border-line pt-4">
            {rows.map((row) => (
              <div key={row.label}>
                <dt className="text-[10px] font-semibold uppercase tracking-wide text-fg-subtle">{row.label}</dt>
                <dd className="m-0 mt-1 break-words text-xs font-semibold text-fg">{row.value ?? EMPTY}</dd>
              </div>
            ))}
          </dl>
        </>
      )}
    </section>
  )
}

export default function PlatformHealthIntegrated() {
  const [data, setData] = useState(null)
  const [organizations, setOrganizations] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    const results = await Promise.allSettled([
      api.get('/api/platform/health'),
      api.get('/api/platform/orgs')
    ])
    if (results[0].status === 'fulfilled') {
      setData(results[0].value)
    } else {
      setData(null)
      setError(results[0].reason?.message || 'Could not load system health')
    }
    setOrganizations(results[1].status === 'fulfilled' ? results[1].value.orgs || [] : [])
    setLoading(false)
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(load, 0)
    return () => window.clearTimeout(timer)
  }, [load])

  const availability = useMemo(() => {
    let available = 0
    let suspended = 0
    let atRisk = 0

    organizations.forEach((org) => {
      if ((org.status || 'active') === 'suspended') {
        suspended += 1
        return
      }
      available += 1
      const licence = org.licensing?.licence
      const riskyMeter = Object.values(org.licensing?.resources || {}).some(
        (meter) => meter && !meter.unlimited && ['warning', 'critical', 'exceeded'].includes(meter.state)
      )
      if (
        licence?.readOnly ||
        (licence?.daysLeft != null && licence.daysLeft <= 30) ||
        riskyMeter
      ) {
        atRisk += 1
      }
    })

    return { available, suspended, atRisk }
  }, [organizations])

  const apiOk = data?.api?.status === 'ok'
  const dbOk = data?.database?.status === 'ok'
  const overallOk = data?.overall === 'healthy'

  return (
    <AppShell
      title="System health"
      subtitle="Review only the core API, database, document provider, and organization availability signals."
      actions={(
        <button
          type="button"
          onClick={load}
          disabled={loading}
          className="inline-flex min-h-10 items-center gap-2 rounded-[9px] bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700 disabled:opacity-60"
        >
          <RefreshCw className={'h-4 w-4 ' + (loading ? 'animate-spin' : '')} />
          Refresh
        </button>
      )}
    >
      <div className="space-y-[18px]">
        {error ? <AlertBanner onRetry={load}>{error}</AlertBanner> : null}

        <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
          <Metric
            label="Overall status"
            value={overallOk ? 'Healthy' : data ? 'Degraded' : 'Unavailable'}
            helper={data?.api?.timestamp ? 'Checked ' + formatTime(data.api.timestamp) : 'No health response'}
            icon={HeartPulse}
            tone={overallOk ? 'green' : 'amber'}
            loading={loading}
          />
          <Metric
            label="API uptime"
            value={formatUptime(data?.api?.uptimeSeconds)}
            helper={data?.api?.service || 'No service response'}
            icon={Server}
            loading={loading}
          />
          <Metric
            label="Database"
            value={data?.database?.readyState ? titleCase(data.database.readyState) : 'Unavailable'}
            helper={data?.database?.name || 'No connection response'}
            icon={Database}
            tone={dbOk ? 'green' : 'amber'}
            loading={loading}
          />
          <Metric
            label="Organizations"
            value={data?.organizations?.total ?? organizations.length}
            helper={availability.available + ' currently available'}
            icon={Building2}
            tone="violet"
            loading={loading}
          />
        </div>

        <div className="grid grid-cols-1 gap-[18px] lg:grid-cols-2">
          <HealthPanel
            title="Core API"
            description="Request health, runtime, and last successful service check."
            icon={Server}
            ok={apiOk}
            status={data?.api?.status}
            rows={[
              { label: 'Uptime', value: formatUptime(data?.api?.uptimeSeconds) },
              { label: 'Checked', value: formatTime(data?.api?.timestamp) }
            ]}
            loading={loading}
          />
          <HealthPanel
            title="Database"
            description="Current database connectivity and deployment response signal."
            icon={Database}
            tone="green"
            ok={dbOk}
            status={data?.database?.status}
            rows={[
              { label: 'Connection', value: data?.database?.readyState },
              { label: 'Database', value: data?.database?.name }
            ]}
            loading={loading}
          />
        </div>

      </div>
    </AppShell>
  )
}
