// SuperAdmin — DMS Provider detail page (/dms)
// Shows live DMS storage, document listing with search, and folder
// structure grouped by sourceRef. Visual language matches PlatformHealth.

import { useCallback, useEffect, useMemo, useState } from 'react'
import AppShell from '../components/AppShell'
import { api } from '../utils/api'
import { Skeleton } from '../components/Skeleton'
import { AlertBanner } from '../components/Alert'

// ── helpers ──────────────────────────────────────────────────────────────────

const fmtBytes = (bytes) => {
  if (!bytes || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  const val = bytes / Math.pow(1024, i)
  return `${val < 10 ? val.toFixed(1) : Math.round(val)} ${units[i]}`
}

const fmtCount = (n) => {
  if (n == null) return '—'
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

const fmtDate = (val) => {
  if (!val) return '—'
  const d = new Date(val)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

const docCategory = (doc) => {
  const ref = doc.sourceRef || doc.externalRef || {}
  if (ref.taskId) return 'Approval'
  if (ref.formResponseId) return 'Form Response'
  if (ref.workflowId) return 'Workflow'
  return 'Other'
}

const categoryColor = {
  'Approval':       'bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300',
  'Form Response':  'bg-violet-100 text-violet-700 dark:bg-violet-500/20 dark:text-violet-300',
  'Workflow':       'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300',
  'Other':          'bg-surface-3 text-fg-muted',
}

// ── sub-components ───────────────────────────────────────────────────────────

function StatCard({ label, value, sub, tone = 'default', loading, icon }) {
  const tones = {
    default: 'bg-surface border-line text-fg',
    success: 'bg-emerald-50 border-emerald-200 text-emerald-800 dark:bg-emerald-500/10 dark:border-emerald-500/30 dark:text-emerald-300',
    warning: 'bg-amber-50 border-amber-200 text-amber-800 dark:bg-amber-500/10 dark:border-amber-500/30 dark:text-amber-300',
    danger:  'bg-red-50 border-red-200 text-red-800 dark:bg-red-500/10 dark:border-red-500/30 dark:text-red-300',
    info:    'bg-indigo-50 border-indigo-200 text-indigo-800 dark:bg-indigo-500/10 dark:border-indigo-500/30 dark:text-indigo-300',
  }
  return (
    <div className={`rounded-xl border shadow-sm px-5 py-4 flex items-start gap-4 ${tones[tone] || tones.default}`}>
      {icon && (
        <div className="w-10 h-10 rounded-xl bg-white/60 dark:bg-white/5 flex items-center justify-center shrink-0 ring-1 ring-black/5 dark:ring-white/10">
          {icon}
        </div>
      )}
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-semibold uppercase tracking-wider opacity-70 mb-1">{label}</p>
        {loading ? (
          <Skeleton className="h-7 w-24 mt-1" />
        ) : (
          <p className="text-2xl font-bold leading-tight">{value}</p>
        )}
        {sub && !loading && <p className="text-xs opacity-60 mt-0.5">{sub}</p>}
      </div>
    </div>
  )
}

function StorageGauge({ usedBytes, limitBytes, loading }) {
  const pct = limitBytes && limitBytes > 0
    ? Math.min((usedBytes / limitBytes) * 100, 100)
    : null

  const color = pct == null
    ? 'from-indigo-400 to-indigo-600'
    : pct >= 90
      ? 'from-red-400 to-red-600'
      : pct >= 70
        ? 'from-amber-300 to-amber-500'
        : 'from-emerald-400 to-emerald-600'

  return (
    <div className="bg-surface border border-line rounded-xl shadow-sm px-5 py-5">
      <h2 className="text-sm font-semibold text-fg mb-4 flex items-center gap-2">
        <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 text-indigo-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.75">
          <path strokeLinecap="round" strokeLinejoin="round" d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4" />
        </svg>
        Storage Usage
      </h2>

      {loading ? (
        <div className="space-y-3 animate-pulse">
          <div className="h-4 w-1/2 bg-surface-3 rounded" />
          <div className="h-3 w-full bg-surface-3 rounded-full" />
        </div>
      ) : (
        <>
          <div className="flex items-end justify-between mb-2">
            <span className="text-3xl font-bold text-fg">{fmtBytes(usedBytes)}</span>
            <span className="text-sm text-fg-muted">{limitBytes ? `of ${fmtBytes(limitBytes)}` : 'No quota configured'}</span>
          </div>

          {/* Bar */}
          <div className="h-3 w-full rounded-full bg-surface-3 overflow-hidden mb-1">
            <div
              className={`h-full rounded-full bg-gradient-to-r ${color} transition-all duration-1000`}
              style={{ width: pct != null ? `${pct}%` : (usedBytes > 0 ? '100%' : '0%'), opacity: pct != null ? 1 : 0.4 }}
            />
          </div>

          <div className="flex items-center justify-between text-xs text-fg-subtle">
            <span>{pct != null ? `${Math.round(pct)}% used` : 'Usage tracked'}</span>
            {pct != null && pct >= 70 && (
              <span className={`font-semibold ${pct >= 90 ? 'text-red-600 dark:text-red-400' : 'text-amber-600 dark:text-amber-400'}`}>
                {pct >= 90 ? '⚠ Near limit' : 'Approaching limit'}
              </span>
            )}
          </div>
        </>
      )}
    </div>
  )
}

function FolderPanel({ groups, total, loading, activeFolder, onSelect }) {
  const folders = [
    {
      key: 'all',
      label: 'All Documents',
      count: total,
      icon: (
        <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.75">
          <path strokeLinecap="round" strokeLinejoin="round" d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" />
        </svg>
      ),
      color: 'text-indigo-500',
    },
    {
      key: 'tasks',
      label: 'Approvals',
      count: groups?.tasks,
      icon: (
        <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.75">
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
        </svg>
      ),
      color: 'text-blue-500',
    },
    {
      key: 'forms',
      label: 'Form Responses',
      count: groups?.forms,
      icon: (
        <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.75">
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
      ),
      color: 'text-violet-500',
    },
    {
      key: 'workflows',
      label: 'Workflows',
      count: groups?.workflows,
      icon: (
        <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.75">
          <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
        </svg>
      ),
      color: 'text-emerald-500',
    },
    {
      key: 'other',
      label: 'Other',
      count: groups?.other,
      icon: (
        <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.75">
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 19a2 2 0 01-2-2V7a2 2 0 012-2h4l2 2h4a2 2 0 012 2v1M5 19h14a2 2 0 002-2v-5a2 2 0 00-2-2H9a2 2 0 00-2 2v5a2 2 0 01-2 2z" />
        </svg>
      ),
      color: 'text-fg-muted',
    },
  ]

  return (
    <div className="bg-surface border border-line rounded-xl shadow-sm overflow-hidden">
      <div className="px-4 py-3 border-b border-line bg-surface-2/40">
        <h3 className="text-xs font-semibold text-fg-muted uppercase tracking-wider">Folder Structure</h3>
      </div>
      <ul className="py-1">
        {folders.map((f) => (
          <li key={f.key}>
            <button
              type="button"
              onClick={() => onSelect(f.key)}
              className={`w-full flex items-center gap-3 px-4 py-2.5 text-left text-sm transition-colors ${
                activeFolder === f.key
                  ? 'bg-indigo-50 dark:bg-indigo-500/15 text-indigo-700 dark:text-indigo-300'
                  : 'text-fg-muted hover:bg-surface-3/70 hover:text-fg'
              }`}
            >
              <span className={activeFolder === f.key ? 'text-indigo-600 dark:text-indigo-400' : f.color}>
                {f.icon}
              </span>
              <span className="flex-1 font-medium">{f.label}</span>
              {loading ? (
                <span className="w-6 h-4 rounded bg-surface-3 animate-pulse" />
              ) : (
                <span className={`text-[11px] font-semibold rounded-full px-1.5 py-0.5 min-w-[22px] text-center ${
                  activeFolder === f.key ? 'bg-indigo-100 dark:bg-indigo-500/25 text-indigo-700 dark:text-indigo-300' : 'bg-surface-3 text-fg-subtle'
                }`}>
                  {fmtCount(f.count)}
                </span>
              )}
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

// ── main page ─────────────────────────────────────────────────────────────────

export default function DmsProvider() {
  const [storageLoading, setStorageLoading] = useState(true)
  const [docsLoading, setDocsLoading] = useState(true)
  const [storage, setStorage] = useState(null)
  const [documents, setDocuments] = useState([])
  const [groups, setGroups] = useState(null)
  const [totalDocs, setTotalDocs] = useState(null)
  const [error, setError] = useState(null)
  const [search, setSearch] = useState('')
  const [activeFolder, setActiveFolder] = useState('all')

  const fetchStorage = useCallback(async () => {
    setStorageLoading(true)
    try {
      const res = await api.get('/api/platform/dms-storage')
      const s = res.data || res
      setStorage({
        enabled: Boolean(s.enabled),
        usedBytes: Number(s.usedBytes || 0),
        limitBytes: s.limitBytes != null ? Number(s.limitBytes) : null,
        documentCount: s.documentCount != null ? Number(s.documentCount) : null,
        source: s.source || null,
        organizationId: s.organizationId || null,
      })
    } catch (err) {
      setError(err?.data?.message || err?.message || 'Failed to load DMS storage')
    } finally {
      setStorageLoading(false)
    }
  }, [])

  const fetchDocs = useCallback(async () => {
    setDocsLoading(true)
    try {
      const res = await api.get('/api/platform/dms-documents?limit=200')
      const d = res.data || res
      setDocuments(Array.isArray(d.documents) ? d.documents : [])
      setTotalDocs(d.total ?? null)
      if (d.groups) setGroups(d.groups)
    } catch (err) {
      console.warn('[DmsProvider] docs fetch error', err)
    } finally {
      setDocsLoading(false)
    }
  }, [])

  useEffect(() => {
    // Start the external request with its pending UI state.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchStorage()
    fetchDocs()
  }, [fetchStorage, fetchDocs])

  const filteredDocs = useMemo(() => {
    let list = documents
    // Folder filter
    if (activeFolder !== 'all') {
      list = list.filter((doc) => {
        const ref = doc.sourceRef || doc.externalRef || {}
        if (activeFolder === 'tasks') return Boolean(ref.taskId)
        if (activeFolder === 'forms') return Boolean(ref.formResponseId)
        if (activeFolder === 'workflows') return Boolean(ref.workflowId)
        if (activeFolder === 'other') return !ref.taskId && !ref.formResponseId && !ref.workflowId
        return true
      })
    }
    // Search filter
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      list = list.filter((doc) =>
        (doc.name || '').toLowerCase().includes(q) ||
        (doc.mime || '').toLowerCase().includes(q) ||
        String(doc.id || doc._id || '').toLowerCase().includes(q)
      )
    }
    return list
  }, [documents, activeFolder, search])

  const connected = storage?.enabled === true

  return (
    <AppShell>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8 space-y-6">

        {/* Page header */}
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <div className="flex items-center gap-3 mb-1">
              <div className="w-10 h-10 rounded-xl bg-indigo-100 dark:bg-indigo-500/20 flex items-center justify-center shrink-0 ring-1 ring-indigo-200 dark:ring-indigo-500/30">
                <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5 text-indigo-600 dark:text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.75">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2" />
                </svg>
              </div>
              <div>
                <h1 className="text-xl font-bold text-fg">DMS Provider</h1>
                <p className="text-sm text-fg-muted">Connected Document Management System</p>
              </div>
            </div>
          </div>

          {/* Status badge + refresh */}
          <div className="flex items-center gap-3">
            {!storageLoading && (
              <span className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold ring-1 ${
                connected
                  ? 'bg-emerald-500/10 text-emerald-700 ring-emerald-200 dark:ring-emerald-500/30 dark:text-emerald-400'
                  : 'bg-amber-500/10 text-amber-700 ring-amber-200 dark:ring-amber-500/30 dark:text-amber-400'
              }`}>
                <span className="relative flex h-2 w-2">
                  {connected && <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-60" />}
                  <span className={`relative inline-flex rounded-full h-2 w-2 ${connected ? 'bg-emerald-500' : 'bg-amber-400'}`} />
                </span>
                {connected ? 'DMS Connected' : 'DMS Disabled'}
              </span>
            )}
            <button
              type="button"
              onClick={() => { fetchStorage(); fetchDocs() }}
              disabled={storageLoading || docsLoading}
              className="flex items-center gap-1.5 text-sm font-medium text-fg-muted hover:text-fg border border-line rounded-lg px-3 py-1.5 bg-surface hover:bg-surface-3 transition disabled:opacity-50"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className={`w-4 h-4 ${(storageLoading || docsLoading) ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m0 0A8.001 8.001 0 0112 4c3.506 0 6.496 2.002 7.999 5m.001-5v5h-.583M20 20v-5h-.583m0 0A8.001 8.001 0 014 15m.582 5v-5H4" />
              </svg>
              Refresh
            </button>
          </div>
        </div>

        {/* Error banner */}
        {error && (
          <AlertBanner
            type="error"
            message={error}
            onDismiss={() => setError(null)}
          />
        )}

        {/* Stat cards row */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <StatCard
            label="Storage Used"
            value={storageLoading ? null : fmtBytes(storage?.usedBytes ?? 0)}
            sub={storage?.limitBytes ? `of ${fmtBytes(storage.limitBytes)} quota` : 'No limit configured'}
            tone={(() => {
              if (!storage?.limitBytes) return 'info'
              const pct = (storage.usedBytes / storage.limitBytes) * 100
              return pct >= 90 ? 'danger' : pct >= 70 ? 'warning' : 'success'
            })()}
            loading={storageLoading}
            icon={
              <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5 text-indigo-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.75">
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4" />
              </svg>
            }
          />
          <StatCard
            label="Total Documents"
            value={docsLoading ? null : fmtCount(totalDocs ?? storage?.documentCount ?? 0)}
            sub="Stored in DMS"
            tone="default"
            loading={docsLoading}
            icon={
              <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5 text-fg-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.75">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            }
          />
          <StatCard
            label="Provider Status"
            value={storageLoading ? null : (connected ? 'Connected' : 'Disabled')}
            sub={storage?.source ? `Source: ${storage.source}` : 'DMS'}
            tone={connected ? 'success' : 'warning'}
            loading={storageLoading}
            icon={
              <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.75">
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2" />
              </svg>
            }
          />
        </div>

        {/* Storage gauge */}
        <StorageGauge
          usedBytes={storage?.usedBytes ?? 0}
          limitBytes={storage?.limitBytes}
          loading={storageLoading}
        />

        {/* Main content: folder tree + document list */}
        <div className="grid grid-cols-1 lg:grid-cols-[220px_1fr] gap-4 items-start">

          {/* Left: folder panel */}
          <FolderPanel
            groups={groups}
            total={totalDocs ?? storage?.documentCount}
            loading={docsLoading}
            activeFolder={activeFolder}
            onSelect={setActiveFolder}
          />

          {/* Right: document table */}
          <div className="bg-surface border border-line rounded-xl shadow-sm overflow-hidden">
            {/* Toolbar */}
            <div className="px-4 py-3 border-b border-line flex items-center gap-3 flex-wrap bg-surface-2/40">
              <h3 className="text-sm font-semibold text-fg flex-1 whitespace-nowrap">
                {activeFolder === 'all' ? 'All Documents' : activeFolder === 'tasks' ? 'Approvals' : activeFolder === 'forms' ? 'Form Responses' : activeFolder === 'workflows' ? 'Workflows' : 'Other'}
                {!docsLoading && (
                  <span className="ml-2 text-[11px] font-normal text-fg-muted">
                    ({filteredDocs.length} shown)
                  </span>
                )}
              </h3>
              <div className="relative">
                <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-subtle pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
                <input
                  type="search"
                  placeholder="Search documents…"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  className="pl-8 pr-3 py-1.5 text-sm border border-line rounded-lg bg-surface text-fg placeholder:text-fg-subtle focus:outline-none focus:ring-2 focus:ring-indigo-200 focus:border-indigo-300 w-48"
                />
              </div>
            </div>

            {/* Table */}
            <div className="overflow-auto max-h-[500px]">
              <table className="w-full text-sm relative">
                <thead className="bg-surface-2/80 backdrop-blur-sm border-b border-line sticky top-0 z-10 shadow-sm">
                  <tr>
                    <th className="text-left px-4 py-2.5 text-[11px] font-semibold text-fg-subtle uppercase tracking-wider whitespace-nowrap">Name</th>
                    <th className="text-left px-4 py-2.5 text-[11px] font-semibold text-fg-subtle uppercase tracking-wider whitespace-nowrap hidden md:table-cell">Type</th>
                    <th className="text-left px-4 py-2.5 text-[11px] font-semibold text-fg-subtle uppercase tracking-wider whitespace-nowrap hidden sm:table-cell">Category</th>
                    <th className="text-right px-4 py-2.5 text-[11px] font-semibold text-fg-subtle uppercase tracking-wider whitespace-nowrap hidden lg:table-cell">Size</th>
                    <th className="text-right px-4 py-2.5 text-[11px] font-semibold text-fg-subtle uppercase tracking-wider whitespace-nowrap hidden xl:table-cell">Date</th>
                  </tr>
                </thead>
                <tbody>
                  {docsLoading && (
                    Array.from({ length: 6 }).map((_, i) => (
                      <tr key={i} className="border-b border-line/50">
                        <td className="px-4 py-3"><Skeleton className="h-4 w-48" /></td>
                        <td className="px-4 py-3 hidden md:table-cell"><Skeleton className="h-4 w-24" /></td>
                        <td className="px-4 py-3 hidden sm:table-cell"><Skeleton className="h-5 w-20 rounded-full" /></td>
                        <td className="px-4 py-3 hidden lg:table-cell text-right"><Skeleton className="h-4 w-12 ml-auto" /></td>
                        <td className="px-4 py-3 hidden xl:table-cell text-right"><Skeleton className="h-4 w-20 ml-auto" /></td>
                      </tr>
                    ))
                  )}

                  {!docsLoading && filteredDocs.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-4 py-10 text-center text-sm text-fg-muted">
                        {connected
                          ? search ? 'No documents match your search.' : 'No documents in this folder.'
                          : 'DMS is not enabled. Enable it in your server configuration (DMS_ENABLED=true).'}
                      </td>
                    </tr>
                  )}

                  {!docsLoading && filteredDocs.map((doc, idx) => {
                    const id = doc.id || doc._id || idx
                    const category = docCategory(doc)
                    return (
                      <tr
                        key={id}
                        className="border-b border-line/50 last:border-0 hover:bg-surface-2/50 transition-colors"
                      >
                        <td className="px-4 py-3 max-w-[200px]">
                          <div className="flex items-center gap-2.5 min-w-0">
                            <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 text-indigo-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.75">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                            </svg>
                            <span className="font-medium text-fg truncate" title={doc.name || id}>
                              {doc.name || String(id).slice(0, 12) + '…'}
                            </span>
                          </div>
                        </td>
                        <td className="px-4 py-3 hidden md:table-cell">
                          <span className="text-xs text-fg-muted font-mono">
                            {doc.mime ? doc.mime.split('/').pop().toUpperCase() : '—'}
                          </span>
                        </td>
                        <td className="px-4 py-3 hidden sm:table-cell">
                          <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${categoryColor[category] || categoryColor.Other}`}>
                            {category}
                          </span>
                        </td>
                        <td className="px-4 py-3 hidden lg:table-cell text-right text-xs text-fg-muted font-medium">
                          {doc.size || doc.fileSize ? fmtBytes(doc.size || doc.fileSize) : '—'}
                        </td>
                        <td className="px-4 py-3 hidden xl:table-cell text-right text-xs text-fg-muted">
                          {fmtDate(doc.createdAt || doc.uploadedAt)}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Configuration info footer */}
        <div className="bg-surface-2/50 border border-line rounded-xl px-5 py-4">
          <h3 className="text-xs font-semibold text-fg-muted uppercase tracking-wider mb-3">Configuration</h3>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm">
            <div>
              <p className="text-[11px] text-fg-subtle uppercase tracking-wider font-semibold mb-1">DMS Status</p>
              <p className="text-fg font-medium">{connected ? 'Enabled (DMS_ENABLED=true)' : 'Disabled (DMS_ENABLED not set)'}</p>
            </div>
            <div>
              <p className="text-[11px] text-fg-subtle uppercase tracking-wider font-semibold mb-1">Data Source</p>
              <p className="text-fg font-medium">{storage?.source || (connected ? 'documents_sum' : '—')}</p>
            </div>
            <div>
              <p className="text-[11px] text-fg-subtle uppercase tracking-wider font-semibold mb-1">Per-Org Keys</p>
              <p className="text-fg font-medium">Configured via Organization → Integrations</p>
            </div>
          </div>
        </div>

      </div>
    </AppShell>
  )
}
