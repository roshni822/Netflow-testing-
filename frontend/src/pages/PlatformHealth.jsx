// SuperAdmin — system health (from /api/platform/health)
// Visual language aligned with the Organizations Stitch cards.

import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import AppShell from '../components/AppShell'
import { api } from '../utils/api'
import { Skeleton } from '../components/Skeleton'
import { AlertBanner } from '../components/Alert'

function formatUptime(seconds) {
  if (seconds == null || Number.isNaN(seconds)) return '—'
  const s = Math.max(0, Math.floor(seconds))
  const d = Math.floor(s / 86400)
  const h = Math.floor((s % 86400) / 3600)
  const m = Math.floor((s % 3600) / 60)
  if (d > 0) return `${d}d ${h}h ${m}m`
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

function formatTimestamp(value) {
  if (!value) return '—'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
  })
}

function maskHost(host) {
  if (!host) return '—'
  const s = String(host)
  if (!s.includes('@')) return s.replace(/^mongodb(\+srv)?:\/\//, '')
  return s.slice(s.lastIndexOf('@') + 1)
}

function StatusPill({ ok, label }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold ${
        ok
          ? 'bg-success-subtle text-success-fg'
          : 'bg-warning-subtle text-warning-fg'
      }`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${ok ? 'bg-success-solid' : 'bg-warning-solid'}`} />
      {label}
    </span>
  )
}

function HealthCard({ title, icon: Icon, iconWrap, children, footer }) {
  return (
    <div className="bg-surface border border-line rounded-xl overflow-hidden shadow-sm flex flex-col">
      <div className="px-5 pt-5 pb-3 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-fg m-0">{title}</h2>
        </div>
        {Icon && (
          <span className={`w-9 h-9 rounded-[10px] flex items-center justify-center shrink-0 ${iconWrap}`}>
            <Icon className="w-[18px] h-[18px]" />
          </span>
        )}
      </div>
      <div className="px-5 pb-4 flex-1">{children}</div>
      {footer && (
        <div className="px-5 py-3 border-t border-line bg-surface-2/40">
          {footer}
        </div>
      )}
    </div>
  )
}

function HealthCardSkeleton({ rows = 3 }) {
  return (
    <>
      <Skeleton className="h-6 w-24 rounded-full mb-3" />
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center justify-between gap-4 py-2 border-b border-line last:border-0">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-3 w-24" />
        </div>
      ))}
    </>
  )
}

function Row({ label, value }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2 border-b border-line last:border-0">
      <span className="text-xs text-fg-muted">{label}</span>
      <span className="text-xs font-medium text-fg text-right break-all">{value ?? '—'}</span>
    </div>
  )
}

function MetricTile({ label, value, tone = 'default' }) {
  const valueCls = tone === 'danger'
    ? 'text-danger-fg'
    : tone === 'success'
      ? 'text-success-fg'
      : tone === 'indigo'
        ? 'text-indigo-600 dark:text-indigo-300'
        : 'text-fg'
  return (
    <div className="rounded-xl border border-line bg-surface px-4 py-3.5">
      <p className="text-[11px] font-medium text-fg-muted m-0">{label}</p>
      <p className={`text-2xl font-bold tracking-tight mt-1 tabular-nums ${valueCls}`}>{value}</p>
    </div>
  )
}

export default function PlatformHealth() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(() => {
    setLoading(true)
    setError('')
    api.get('/api/platform/health')
      .then(setData)
      .catch((e) => setError(e.message || 'Could not load health'))
      .finally(() => setLoading(false))
  }, [])

  // Start the external request with its pending UI state.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load() }, [load])

  const overallOk = data?.overall === 'healthy'
  const apiOk = data?.api?.status === 'ok'
  const dbOk = data?.database?.status === 'ok'
  const orgs = data?.organizations || {}

  return (
    <AppShell
      title="Health"
      subtitle="API, database, and organization status for this deployment."
      actions={
        <button
          type="button"
          onClick={load}
          disabled={loading}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-line hover:bg-surface-2 text-sm font-medium text-fg transition disabled:opacity-50"
        >
          <IconRefresh className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      }
    >
      <div className="space-y-4">
        {error && <AlertBanner onRetry={load}>{error}</AlertBanner>}

        <div
          className={`rounded-xl border p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 shadow-sm ${
            loading
              ? 'bg-surface border-line'
              : overallOk
                ? 'bg-success-subtle/40 border-success-line'
                : 'bg-warning-subtle/40 border-warning-line'
          }`}
        >
          <div className="flex items-start gap-3.5">
            <span
              className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 ${
                loading
                  ? 'bg-surface-3 text-fg-muted'
                  : overallOk
                    ? 'bg-success-subtle text-success-fg'
                    : 'bg-warning-subtle text-warning-fg'
              }`}
            >
              {loading ? <IconPulse className="w-5 h-5" /> : overallOk ? <IconCheck className="w-5 h-5" /> : <IconAlert className="w-5 h-5" />}
            </span>
            <div>
              <p className="text-sm font-semibold text-fg m-0">Overall status</p>
              <p className="text-xs text-fg-muted mt-0.5" aria-live="polite">
                {loading
                  ? 'Checking services…'
                  : (data?.api?.timestamp
                    ? `Last checked ${formatTimestamp(data.api.timestamp)}`
                    : '—')}
              </p>
            </div>
          </div>
          {loading ? (
            <Skeleton className="h-7 w-24 rounded-full" />
          ) : data ? (
            <StatusPill ok={overallOk} label={overallOk ? 'Healthy' : 'Degraded'} />
          ) : null}
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <MetricTile
            label="API uptime"
            value={loading ? '—' : formatUptime(data?.api?.uptimeSeconds)}
            tone="indigo"
          />
          <MetricTile
            label="Organizations"
            value={loading ? '—' : (orgs.total ?? '—')}
            tone="indigo"
          />
          <MetricTile
            label="Active"
            value={loading ? '—' : (orgs.active ?? '—')}
            tone="success"
          />
          <MetricTile
            label="Suspended"
            value={loading ? '—' : (orgs.suspended ?? '—')}
            tone={(orgs.suspended || 0) > 0 ? 'danger' : 'default'}
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <HealthCard
            title="API"
            icon={IconApi}
            iconWrap="bg-indigo-50 text-indigo-600 dark:bg-indigo-500/15 dark:text-indigo-300"
          >
            {loading ? (
              <HealthCardSkeleton />
            ) : (
              <>
                <div className="mb-2">
                  <StatusPill ok={apiOk} label={apiOk ? 'OK' : 'Issue'} />
                </div>
                <Row label="Service" value={data?.api?.service} />
                <Row label="Environment" value={data?.api?.env} />
                <Row label="Uptime" value={formatUptime(data?.api?.uptimeSeconds)} />
              </>
            )}
          </HealthCard>

          <HealthCard
            title="Database"
            icon={IconDatabase}
            iconWrap="bg-sky-50 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300"
          >
            {loading ? (
              <HealthCardSkeleton />
            ) : (
              <>
                <div className="mb-2">
                  <StatusPill ok={dbOk} label={dbOk ? 'Connected' : 'Not connected'} />
                </div>
                <Row label="State" value={data?.database?.readyState} />
                <Row label="Name" value={data?.database?.name} />
                <Row label="Host" value={maskHost(data?.database?.host)} />
              </>
            )}
          </HealthCard>

          <HealthCard
            title="Organizations"
            icon={IconBuilding}
            iconWrap="bg-violet-50 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300"
            footer={
              <Link
                to="/platform"
                className="text-xs font-medium text-indigo-600 dark:text-indigo-300 hover:underline"
              >
                Manage organizations →
              </Link>
            }
          >
            {loading ? (
              <HealthCardSkeleton />
            ) : (
              <>
                <Row label="Total" value={orgs.total} />
                <Row label="Active" value={orgs.active} />
                <Row label="Suspended" value={orgs.suspended} />
              </>
            )}
          </HealthCard>
        </div>
      </div>
    </AppShell>
  )
}

function IconRefresh(p) {
  return (
    <svg {...p} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
    </svg>
  )
}
function IconPulse(p) {
  return (
    <svg {...p} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
      <path strokeLinecap="round" strokeLinejoin="round" d="M22 12h-4l-3 9L9 3l-3 9H2" />
    </svg>
  )
}
function IconCheck(p) {
  return (
    <svg {...p} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  )
}
function IconAlert(p) {
  return (
    <svg {...p} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
    </svg>
  )
}
function IconApi(p) {
  return (
    <svg {...p} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
      <path strokeLinecap="round" strokeLinejoin="round" d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
    </svg>
  )
}
function IconDatabase(p) {
  return (
    <svg {...p} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 7c0 1.657 3.582 3 8 3s8-1.343 8-3-3.582-3-8-3-8 1.343-8 3z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 7v5c0 1.657 3.582 3 8 3s8-1.343 8-3V7M4 12v5c0 1.657 3.582 3 8 3s8-1.343 8-3v-5" />
    </svg>
  )
}
function IconBuilding(p) {
  return (
    <svg {...p} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 21h18M5 21V7l7-4 7 4v14M9 9h.01M9 12h.01M9 15h.01M15 9h.01M15 12h.01M15 15h.01" />
    </svg>
  )
}
