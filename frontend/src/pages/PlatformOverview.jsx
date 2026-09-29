// SuperAdmin — Platform overview dashboard
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import AppShell from '../components/AppShell'
import { AlertBanner } from '../components/Alert'
import { api, buildQuery } from '../utils/api'
import { formatDateTime, isoAttr, relativeTime } from '../utils/datetime'
import { PLAN_LABELS, formatMb, meterText, toneFor } from '../lib/licensing'

const TILE_COLORS = ['#245a9a', '#246b4a', '#b8892d', '#6b628d', '#b23b35', '#1b477c', '#337b58', '#8a5b12']

const ACTION_STYLE = {
  org_created: { bg: 'bg-success-subtle', fg: 'text-success-fg', icon: IconTrend },
  org_updated: { bg: 'bg-info-subtle', fg: 'text-info-fg', icon: IconClock },
  org_suspended: { bg: 'bg-danger-subtle', fg: 'text-danger-fg', icon: IconBan },
  org_activated: { bg: 'bg-success-subtle', fg: 'text-success-fg', icon: IconCheck },
  org_deleted: { bg: 'bg-danger-subtle', fg: 'text-danger-fg', icon: IconBan },
  org_admin_password_reset: { bg: 'bg-warning-subtle', fg: 'text-warning-fg', icon: IconAlert },
  org_storage_extended: { bg: 'bg-info-subtle', fg: 'text-info-fg', icon: IconUsers },
  org_storage_extension_revoked: { bg: 'bg-warning-subtle', fg: 'text-warning-fg', icon: IconAlert }
}

const orgBucket = (org) => {
  if ((org.status || 'active') === 'suspended') return 'suspended'
  if (org.plan === 'trial' || org.licensing?.licence?.isTrial) return 'trial'
  return 'active'
}

const orgInitials = (name = '') => {
  const parts = String(name).trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

const tileColor = (name = '') => {
  let hash = 0
  for (let i = 0; i < name.length; i += 1) hash = (hash * 31 + name.charCodeAt(i)) >>> 0
  return TILE_COLORS[hash % TILE_COLORS.length]
}

const titleCase = (s) =>
  String(s || '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())

const pressureScore = (org) => {
  const meters = org.licensing?.resources || {}
  return Math.max(
    meters.storage?.percent || 0,
    meters.submissions?.percent || 0,
    meters.users?.percent || 0,
    meters.builders?.percent || 0
  )
}

function SectionCard({ title, description, action, children, className = '', bodyClass = '' }) {
  return (
    <section className={`bg-surface border border-line rounded-xl shadow-sm overflow-hidden flex flex-col ${className}`}>
      <header className="px-5 py-4 border-b border-line flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-fg m-0 tracking-tight">{title}</h2>
          {description && <p className="text-xs text-fg-muted mt-0.5 m-0">{description}</p>}
        </div>
        {action}
      </header>
      <div className={`flex-1 ${bodyClass}`}>{children}</div>
    </section>
  )
}

function PlatformKpiCard({ label, value, foot, icon: Icon, tone = 'indigo' }) {
  const tones = {
    indigo: {
      icon: 'bg-indigo-50 text-indigo-600 dark:bg-indigo-500/15 dark:text-indigo-300',
      accent: 'bg-indigo-500'
    },
    success: {
      icon: 'bg-success-subtle text-success-fg',
      accent: 'bg-success-solid'
    },
    danger: {
      icon: 'bg-danger-subtle text-danger-fg',
      accent: 'bg-danger-solid'
    },
    slate: {
      icon: 'bg-surface-3 text-fg-muted',
      accent: 'bg-fg-subtle'
    }
  }
  const t = tones[tone] || tones.indigo
  return (
    <div className="relative bg-surface border border-line rounded-xl p-4 shadow-sm overflow-hidden">
      <span className={`absolute left-0 top-0 bottom-0 w-0.5 ${t.accent}`} aria-hidden="true" />
      <div className="flex items-start gap-3.5">
        <span className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${t.icon}`}>
          <Icon className="w-5 h-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-fg-subtle">{label}</p>
          <p className="text-[1.75rem] font-bold leading-none mt-1.5 tracking-tight text-fg tabular-nums">{value}</p>
          {foot ? <p className="text-[11px] text-fg-muted mt-2 leading-snug">{foot}</p> : null}
        </div>
      </div>
    </div>
  )
}

function StatusDonut({ active, suspended, trial }) {
  const total = active + suspended + trial
  const a = total ? (active / total) * 100 : 0
  const s = total ? (suspended / total) * 100 : 0
  const gradient = total
    ? `conic-gradient(#246b4a 0 ${a}%, #b23b35 ${a}% ${a + s}%, #8a857d ${a + s}% 100%)`
    : 'conic-gradient(var(--color-surface-3, #eef2f7) 0 100%)'

  const rows = [
    { label: 'Active', value: active, dot: 'bg-success-solid' },
    { label: 'Suspended', value: suspended, dot: 'bg-danger-solid' },
    { label: 'Trial', value: trial, dot: 'bg-fg-subtle' }
  ]

  return (
    <div className="flex items-center gap-6 px-5 py-5 min-h-[168px]">
      <div
        className="relative w-[7.5rem] h-[7.5rem] rounded-full shrink-0 flex items-center justify-center"
        style={{ background: gradient }}
        role="img"
        aria-label={`${active} active, ${suspended} suspended, ${trial} trial`}
      >
        <div className="absolute inset-[15px] rounded-full bg-surface border border-line/60" />
        <div className="relative z-[1] text-center leading-none">
          <p className="text-2xl font-bold text-fg tabular-nums">{total}</p>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-fg-subtle mt-1">Fleet</p>
        </div>
      </div>
      <ul className="flex-1 space-y-3">
        {rows.map((row) => (
          <li key={row.label} className="flex items-center gap-2.5 text-sm">
            <span className={`w-2 h-2 rounded-full shrink-0 ${row.dot}`} />
            <span className="text-fg-muted">{row.label}</span>
            <strong className="ml-auto tabular-nums text-fg font-semibold">{row.value}</strong>
          </li>
        ))}
      </ul>
    </div>
  )
}

function StorageRing({ usedMb, limitMb, orgCount, sourceLabel, documentCount }) {
  const pct = limitMb > 0 ? Math.min(100, (usedMb / limitMb) * 100) : 0
  const displayPct = limitMb > 0 ? (pct < 10 ? pct.toFixed(1) : Math.round(pct)) : '—'
  const gradient = limitMb > 0
    ? `conic-gradient(#245a9a 0 ${pct}%, var(--color-surface-3, #eef2f7) 0)`
    : `conic-gradient(#245a9a 0 8%, var(--color-surface-3, #eef2f7) 0)`

  return (
    <div className="flex flex-col items-center justify-center text-center px-5 py-5 min-h-[168px]">
      <div
        className="relative w-[7rem] h-[7rem] rounded-full flex items-center justify-center mb-3.5"
        style={{ background: gradient }}
        role="img"
        aria-label={limitMb > 0 ? `${displayPct} percent storage used` : `${formatMb(usedMb)} storage used`}
      >
        <div className="absolute inset-[13px] rounded-full bg-surface border border-line/60" />
        <span className="relative z-[1] text-xl font-bold tracking-tight text-fg tabular-nums">{displayPct}{limitMb > 0 ? '%' : ''}</span>
      </div>
      <p className="text-sm text-fg m-0">
        <strong className="font-semibold tabular-nums">{formatMb(usedMb)}</strong>
        <span className="text-fg-muted"> of {limitMb > 0 ? formatMb(limitMb) : 'licensed capacity'}</span>
      </p>
      <p className="text-xs text-fg-subtle mt-1 m-0">
        {sourceLabel
          ? `${sourceLabel}${documentCount != null ? ` · ${documentCount} document${documentCount === 1 ? '' : 's'}` : ''}`
          : `across ${orgCount} organization${orgCount === 1 ? '' : 's'}`}
      </p>
    </div>
  )
}

function CompactMeter({ resource, meter }) {
  if (!meter) return <span className="text-xs text-fg-subtle">—</span>
  const tone = toneFor(meter)
  const width = meter.unlimited ? 0 : Math.min(100, Math.max(meter.percent || 0, meter.used > 0 ? 2 : 0))
  return (
    <div className="min-w-[6.5rem]">
      <span className={`block text-[11px] tabular-nums mb-1.5 font-medium ${tone.text}`}>
        {meter.unlimited ? meterText(resource, meter) : meterText(resource, meter).replace(' of ', ' / ')}
      </span>
      <div
        className="h-1 w-full rounded-full bg-surface-3 overflow-hidden"
        role="progressbar"
        aria-valuenow={meter.unlimited ? 0 : meter.percent}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div className={`h-full rounded-full transition-[width] duration-500 ${tone.bar}`} style={{ width: `${width}%` }} />
      </div>
    </div>
  )
}

function AttentionRail({ items }) {
  if (!items.length) return null
  return (
    <div className="rounded-xl border border-line bg-surface shadow-sm overflow-hidden">
      <div className="px-4 py-2.5 border-b border-line bg-surface-2/60 flex items-center gap-2">
        <span className="w-1.5 h-1.5 rounded-full bg-warning-solid" />
        <p className="text-[11px] font-semibold uppercase tracking-wider text-fg-subtle m-0">Needs attention</p>
      </div>
      <ul className="divide-y divide-line sm:divide-y-0 sm:flex sm:divide-x">
        {items.map((item) => (
          <li key={item.key} className="flex-1 min-w-0">
            <Link
              to="/platform"
              className={`flex items-center gap-2.5 px-4 py-3 text-xs font-medium transition hover:bg-surface-2 ${item.className}`}
            >
              <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${item.dot}`} />
              <span className="truncate">{item.label}</span>
              <span className="ml-auto text-fg-subtle shrink-0">Review →</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}

export default function PlatformOverview() {
  const navigate = useNavigate()
  const [orgs, setOrgs] = useState([])
  const [activity, setActivity] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [updatedAt, setUpdatedAt] = useState(null)
  const [reloadKey, setReloadKey] = useState(0)

  const load = useCallback(async () => {
    setError('')
    setLoading(true)
    try {
      const [orgData, actData] = await Promise.all([
        api.get('/api/platform/orgs'),
        api.get(`/api/platform/activity${buildQuery({ page: 1, limit: 6 })}`)
      ])
      setOrgs(orgData.orgs || [])
      setActivity(actData.logs || [])
      setUpdatedAt(new Date())
    } catch (err) {
      setError(err.message || 'Could not load platform overview')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    // Start the external request with its pending UI state.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load()
  }, [load, reloadKey])

  const stats = useMemo(() => {
    let active = 0
    let suspended = 0
    let trial = 0
    let totalUsers = 0
    let totalBuilders = 0
    let readOnly = 0
    let expiring = 0
    let overLimit = 0
    let netflowStorageUsedMb = 0
    let storageLimitMb = 0
    const planCounts = {}

    for (const org of orgs) {
      const bucket = orgBucket(org)
      if (bucket === 'active') active += 1
      else if (bucket === 'suspended') suspended += 1
      else trial += 1

      const users = org.licensing?.resources?.users
      const builders = org.licensing?.resources?.builders
      totalUsers += Number(users?.used || org.usage?.users || 0)
      totalBuilders += Number(builders?.used || 0)

      const lic = org.licensing?.licence
      if (lic?.readOnly) readOnly += 1
      else if (lic?.daysLeft !== null && lic?.daysLeft !== undefined && lic.daysLeft <= 30) expiring += 1

      const meters = org.licensing?.resources || {}
      if (Object.values(meters).some((m) => m && !m.unlimited && m.state === 'exceeded')) overLimit += 1

      const storage = meters.storage
      if (storage) {
        netflowStorageUsedMb += Number(storage.used || 0)
        if (!storage.unlimited) storageLimitMb += Number(storage.limit || 0)
      }

      const plan = org.plan || 'custom'
      planCounts[plan] = (planCounts[plan] || 0) + 1
    }

    const planRows = Object.entries(planCounts)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([key, count]) => ({ key, label: PLAN_LABELS[key] || titleCase(key), count }))

    const maxPlan = planRows.reduce((m, r) => Math.max(m, r.count), 0) || 1

    const topOrgs = [...orgs]
      .sort((a, b) => pressureScore(b) - pressureScore(a) || String(a.name).localeCompare(String(b.name)))
      .slice(0, 5)

    const total = orgs.length
    const pct = (n) => (total ? Math.round((n / total) * 100) : 0)

    return {
      total,
      active,
      suspended,
      trial,
      totalUsers,
      totalBuilders,
      readOnly,
      expiring,
      overLimit,
      storageUsedMb: netflowStorageUsedMb,
      storageLimitMb,
      planRows,
      maxPlan,
      topOrgs,
      pct
    }
  }, [orgs])

  const attention = useMemo(() => {
    const items = []
    if (stats.readOnly > 0) {
      items.push({
        key: 'readonly',
        label: `${stats.readOnly} tenant${stats.readOnly === 1 ? '' : 's'} read-only — licence lapsed`,
        className: 'text-danger-fg',
        dot: 'bg-danger-solid'
      })
    }
    if (stats.expiring > 0) {
      items.push({
        key: 'expiring',
        label: `${stats.expiring} renew${stats.expiring === 1 ? 's' : ''} within 30 days`,
        className: 'text-warning-fg',
        dot: 'bg-warning-solid'
      })
    }
    if (stats.overLimit > 0) {
      items.push({
        key: 'limits',
        label: `${stats.overLimit} tenant${stats.overLimit === 1 ? '' : 's'} at a plan limit`,
        className: 'text-fg-muted',
        dot: 'bg-fg-subtle'
      })
    }
    if (stats.suspended > 0) {
      items.push({
        key: 'suspended',
        label: `${stats.suspended} suspended organization${stats.suspended === 1 ? '' : 's'}`,
        className: 'text-danger-fg',
        dot: 'bg-danger-solid'
      })
    }
    return items
  }, [stats])

  const updatedLabel = updatedAt
    ? updatedAt.toLocaleString(undefined, {
      day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
    })
    : '—'

  return (
    <AppShell
      title="Platform overview"
      subtitle="Fleet health, licence pressure, and recent platform changes."
      actions={
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setReloadKey((k) => k + 1)}
            disabled={loading}
            aria-label="Refresh overview"
            title="Refresh"
            className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg border border-line bg-surface text-fg-muted hover:bg-surface-2 hover:text-fg disabled:opacity-50 transition"
          >
            <IconRefresh className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span className="hidden sm:inline">Refresh</span>
          </button>
          <button
            type="button"
            onClick={() => navigate('/platform')}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-semibold bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 shadow-sm transition"
          >
            Manage organizations
            <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </div>
      }
    >
      <div className="space-y-5">
        {error && (
          <AlertBanner onRetry={() => setReloadKey((k) => k + 1)}>
            {error}
          </AlertBanner>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3.5">
          <PlatformKpiCard
            label="Organizations"
            value={loading ? '—' : stats.total}
            foot={loading ? '' : `${stats.active} active · ${stats.trial} trial`}
            icon={IconBuilding}
            tone="indigo"
          />
          <PlatformKpiCard
            label="Active"
            value={loading ? '—' : stats.active}
            foot={loading ? '' : `${stats.pct(stats.active)}% of the fleet`}
            icon={IconCheck}
            tone="success"
          />
          <PlatformKpiCard
            label="Suspended"
            value={loading ? '—' : stats.suspended}
            foot={loading ? '' : `${stats.pct(stats.suspended)}% of the fleet`}
            icon={IconBan}
            tone="danger"
          />
        </div>

        {!loading && <AttentionRail items={attention} />}

        <div>
          <div className="flex items-baseline justify-between gap-3 mb-2.5 px-0.5">
            <h3 className="text-[11px] font-semibold uppercase tracking-wider text-fg-subtle m-0">Fleet composition</h3>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-3.5">
            <SectionCard title="Organization status" description="Live count by operating state" bodyClass="p-0">
              {loading ? (
                <div className="h-40 m-5 rounded-lg bg-surface-3 animate-pulse" />
              ) : (
                <StatusDonut active={stats.active} suspended={stats.suspended} trial={stats.trial} />
              )}
            </SectionCard>

            <SectionCard title="Plan distribution" description="How tenants are packaged" bodyClass="px-5 py-5">
              {loading ? (
                <div className="h-40 rounded-lg bg-surface-3 animate-pulse" />
              ) : stats.planRows.length === 0 ? (
                <p className="text-sm text-fg-muted m-0">No organizations yet.</p>
              ) : (
                <div className="space-y-3.5">
                  {stats.planRows.map((row) => {
                    const share = stats.total ? Math.round((row.count / stats.total) * 100) : 0
                    return (
                      <div key={row.key}>
                        <div className="flex items-center justify-between gap-2 text-xs mb-1.5">
                          <span className="font-medium text-fg truncate">{row.label}</span>
                          <span className="tabular-nums text-fg-muted shrink-0">
                            <strong className="text-fg font-semibold">{row.count}</strong>
                            <span className="text-fg-subtle"> · {share}%</span>
                          </span>
                        </div>
                        <div className="h-1.5 rounded-full bg-surface-3 overflow-hidden">
                          <div
                            className="h-full rounded-full bg-indigo-500 transition-[width] duration-500"
                            style={{ width: `${(row.count / stats.maxPlan) * 100}%` }}
                          />
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </SectionCard>

            <SectionCard
              title="Storage usage"
              description="Aggregate licensed capacity across organizations"
              bodyClass="p-0"
            >
              {loading ? (
                <div className="h-40 m-5 rounded-lg bg-surface-3 animate-pulse" />
              ) : (
                <StorageRing
                  usedMb={stats.storageUsedMb}
                  limitMb={stats.storageLimitMb}
                  orgCount={stats.total}
                />
              )}
            </SectionCard>
          </div>
        </div>

        <div>
          <div className="flex items-baseline justify-between gap-3 mb-2.5 px-0.5">
            <h3 className="text-[11px] font-semibold uppercase tracking-wider text-fg-subtle m-0">Operations</h3>
          </div>
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-3.5">
            <SectionCard
              title="Recent activity"
              description="Platform-level changes"
              action={(
                <Link to="/activity" className="text-xs font-semibold text-indigo-600 dark:text-indigo-300 hover:underline shrink-0">
                  View all →
                </Link>
              )}
              bodyClass="p-0"
            >
              {loading ? (
                <div className="p-4 space-y-3">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <div key={i} className="h-12 rounded-lg bg-surface-3 animate-pulse" />
                  ))}
                </div>
              ) : activity.length === 0 ? (
                <p className="px-5 py-10 text-sm text-fg-muted text-center m-0">No platform events yet.</p>
              ) : (
                <ul className="divide-y divide-line">
                  {activity.map((log) => {
                    const style = ACTION_STYLE[log.action] || ACTION_STYLE.org_updated
                    const Icon = style.icon
                    return (
                      <li key={log._id} className="px-5 py-3.5 flex items-center gap-3 hover:bg-surface-2/70 transition">
                        <span className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${style.bg} ${style.fg}`}>
                          <Icon className="w-4 h-4" />
                        </span>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-fg m-0 truncate">
                            <strong className="font-semibold">{log.targetEntity || 'Organization'}</strong>
                            {' '}
                            <span className="text-fg-muted font-normal">
                              {titleCase(log.action).replace(/^Org /, '').toLowerCase()}
                            </span>
                          </p>
                          {log.detail && (
                            <p className="text-[11px] text-fg-muted mt-0.5 truncate m-0">{log.detail}</p>
                          )}
                        </div>
                        <time
                          className="text-[11px] text-fg-subtle whitespace-nowrap shrink-0"
                          dateTime={isoAttr(log.createdAt)}
                          title={formatDateTime(log.createdAt)}
                        >
                          {relativeTime(log.createdAt)}
                        </time>
                      </li>
                    )
                  })}
                </ul>
              )}
            </SectionCard>

            <SectionCard
              title="Top organizations by usage"
              description="Highest licence pressure first"
              action={(
                <Link to="/platform" className="text-xs font-semibold text-indigo-600 dark:text-indigo-300 hover:underline shrink-0">
                  Manage →
                </Link>
              )}
              bodyClass="p-0"
            >
              {loading ? (
                <div className="p-4 space-y-3">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <div key={i} className="h-12 rounded-lg bg-surface-3 animate-pulse" />
                  ))}
                </div>
              ) : stats.topOrgs.length === 0 ? (
                <p className="px-5 py-10 text-sm text-fg-muted text-center m-0">No organizations yet.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm min-w-[42rem]">
                    <thead>
                      <tr className="border-b border-line bg-surface-2/80 text-left">
                        <th scope="col" className="px-5 py-3 text-[11px] font-semibold text-fg-subtle uppercase tracking-wider">Organization</th>
                        <th scope="col" className="px-4 py-3 text-[11px] font-semibold text-fg-subtle uppercase tracking-wider">Users</th>
                        <th scope="col" className="px-4 py-3 text-[11px] font-semibold text-fg-subtle uppercase tracking-wider">Builders</th>
                        <th scope="col" className="px-4 py-3 text-[11px] font-semibold text-fg-subtle uppercase tracking-wider">Submissions</th>
                        <th scope="col" className="px-5 py-3 text-[11px] font-semibold text-fg-subtle uppercase tracking-wider">Storage</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line">
                      {stats.topOrgs.map((org) => {
                        const resources = org.licensing?.resources || {}
                        const bucket = orgBucket(org)
                        const statusCls = bucket === 'suspended'
                          ? 'bg-danger-subtle text-danger-fg'
                          : bucket === 'trial'
                            ? 'bg-surface-3 text-fg-muted'
                            : 'bg-success-subtle text-success-fg'
                        return (
                          <tr
                            key={org._id}
                            className="hover:bg-surface-2/70 transition cursor-pointer"
                            onClick={() => navigate('/platform')}
                          >
                            <td className="px-5 py-3.5">
                              <div className="flex items-center gap-3">
                                <span
                                  className="w-9 h-9 rounded-lg text-white text-[11px] font-bold flex items-center justify-center shrink-0"
                                  style={{ background: tileColor(org.name) }}
                                >
                                  {orgInitials(org.name)}
                                </span>
                                <div className="min-w-0">
                                  <div className="flex items-center gap-2 min-w-0">
                                    <p className="font-semibold text-fg m-0 truncate">{org.name}</p>
                                    <span className={`shrink-0 px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide ${statusCls}`}>
                                      {bucket}
                                    </span>
                                  </div>
                                  <p className="text-xs text-fg-subtle m-0 truncate">{org.subdomain}.netflow.app</p>
                                </div>
                              </div>
                            </td>
                            <td className="px-4 py-3.5 align-middle">
                              <CompactMeter resource="users" meter={resources.users} />
                            </td>
                            <td className="px-4 py-3.5 align-middle">
                              <CompactMeter resource="builders" meter={resources.builders} />
                            </td>
                            <td className="px-4 py-3.5 align-middle">
                              <CompactMeter resource="submissions" meter={resources.submissions} />
                            </td>
                            <td className="px-5 py-3.5 align-middle">
                              <CompactMeter resource="storage" meter={resources.storage} />
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </SectionCard>
          </div>
        </div>

        <footer className="flex flex-wrap items-center justify-between gap-2 pt-1 pb-1 text-xs text-fg-subtle">
          <span>Last updated {updatedLabel}</span>
          <span className="tabular-nums">
            {loading ? 'Refreshing…' : `${stats.total} organization${stats.total === 1 ? '' : 's'} in view`}
          </span>
        </footer>
      </div>
    </AppShell>
  )
}

function IconBuilding(p) {
  return (
    <svg {...p} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.75">
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 21h18M5 21V7l7-4 7 4v14M9 9h.01M9 12h.01M9 15h.01M15 9h.01M15 12h.01M15 15h.01" />
    </svg>
  )
}
function IconCheck(p) {
  return (
    <svg {...p} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.75">
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  )
}
function IconUsers(p) {
  return (
    <svg {...p} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.75">
      <path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a4 4 0 00-4-4h-1M9 20H4v-2a4 4 0 014-4h1m4-4a4 4 0 100-8 4 4 0 000 8zm6 4a3 3 0 100-6 3 3 0 000 6z" />
    </svg>
  )
}



function IconTrend(p) {
  return (
    <svg {...p} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.75">
      <path strokeLinecap="round" strokeLinejoin="round" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
    </svg>
  )
}
function IconAlert(p) {
  return (
    <svg {...p} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.75">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
    </svg>
  )
}
function IconBan(p) {
  return (
    <svg {...p} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.75">
      <path strokeLinecap="round" strokeLinejoin="round" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728L5.636 5.636m12.728 12.728A9 9 0 015.636 5.636" />
    </svg>
  )
}
function IconClock(p) {
  return (
    <svg {...p} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.75">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6l4 2m6-2a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  )
}
function IconRefresh(p) {
  return (
    <svg {...p} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.75">
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
    </svg>
  )
}
