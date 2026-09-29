// components/DmsProviderWidget.jsx
// Expandable DMS Provider sidebar item.
// Shown to SuperAdmin (global DMS stats) and OrgAdmin (org-scoped key).
// Acts as a nav item that expands to show live storage stats directly in the sidebar.

import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { api } from '../utils/api'
import { isSuperAdmin, isOrgAdmin } from '../utils/permissions'

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

const REFRESH_MS = 5 * 60 * 1000 // auto-refresh every 5 min

// ── sub-components ──────────────────────────────────────────────────────────

function FolderRow({ icon, label, count, indent = false }) {
  return (
    <div className={`flex items-center gap-2 py-1.5 ${indent ? 'pl-5' : 'pl-1'}`}>
      <span className="text-fg-subtle shrink-0">{icon}</span>
      <span className="flex-1 text-[11px] text-fg-muted truncate">{label}</span>
      {count != null && (
        <span className="text-[10px] font-medium text-fg-subtle bg-surface-3 rounded-full px-1.5 py-0.5 min-w-[20px] text-center">
          {fmtCount(count)}
        </span>
      )}
    </div>
  )
}

// ── main widget ──────────────────────────────────────────────────────────────

export default function DmsProviderWidget({ user }) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(true)
  const [storage, setStorage] = useState(null)
  const [groups, setGroups] = useState(null)
  const [error, setError] = useState(null)
  const [needsLogin, setNeedsLogin] = useState(false)
  const [loginEmail, setLoginEmail] = useState('')
  const [loginPassword, setLoginPassword] = useState('')
  const [loginLoading, setLoginLoading] = useState(false)
  const [loginError, setLoginError] = useState(null)
  const timerRef = useRef(null)

  const { pathname } = useLocation()
  const isSuper = isSuperAdmin(user)
  const isAdmin = isOrgAdmin(user)

  // Expand automatically if they are actually on the /dms page
  const isOnPage = pathname === '/dms'

  const fetchData = useCallback(async () => {
    if (!isSuper && !isAdmin) return
    setLoading(true)
    setError(null)
    setNeedsLogin(false)
    try {
      const storageEndpoint = isSuper
        ? '/api/platform/dms-storage'
        : '/api/organization/dms-storage'
      const storageRes = await api.get(storageEndpoint)
      const s = storageRes.data || storageRes
      setStorage({
        enabled: Boolean(s.enabled),
        usedBytes: Number(s.usedBytes || 0),
        limitBytes: s.limitBytes != null ? Number(s.limitBytes) : null,
        documentCount: s.documentCount != null ? Number(s.documentCount) : null,
        source: s.source || null,
      })

      if (isSuper) {
        try {
          const docRes = await api.get('/api/platform/dms-documents?limit=200')
          const d = docRes.data || docRes
          if (d.groups) setGroups(d.groups)
          if (s.documentCount == null && d.total != null) {
            setStorage(prev => prev ? { ...prev, documentCount: Number(d.total) } : prev)
          }
        } catch {
          // non-fatal
        }
      }
    } catch (err) {
      console.warn('[DmsProviderWidget] fetch error', err)
      if (err?.code === 'DMS_UNAUTHORIZED') {
        setNeedsLogin(true)
      } else {
        setError(err?.data?.message || err?.message || 'Failed to load DMS info')
      }
    } finally {
      setLoading(false)
    }
  }, [isSuper, isAdmin])

  const handleDmsLogin = async (e) => {
    e.preventDefault()
    setLoginLoading(true)
    setLoginError(null)
    try {
      await api.post('/api/organization/dms-login', { email: loginEmail, password: loginPassword })
      // Login successful, fetch data again
      setNeedsLogin(false)
      fetchData()
    } catch (err) {
      setLoginError(err?.data?.message || err?.message || 'Login failed')
    } finally {
      setLoginLoading(false)
    }
  }

  // Fetch only when opened (or if on the page)
  useEffect(() => {
    if (open || isOnPage) {
      // Start the external request with its pending UI state.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      fetchData()
      timerRef.current = setInterval(fetchData, REFRESH_MS)
      return () => clearInterval(timerRef.current)
    }
  }, [open, isOnPage, fetchData])

  const [previousPage, setPreviousPage] = useState(isOnPage)
  if (previousPage !== isOnPage) {
    setPreviousPage(isOnPage)
    if (isOnPage) setOpen(true)
  }

  // Only show for SuperAdmin and OrgAdmin
  if (!isSuper && !isAdmin) return null

  const connected = storage?.enabled === true
  
  const pct = storage?.limitBytes && storage.limitBytes > 0
    ? Math.min((storage.usedBytes / storage.limitBytes) * 100, 100)
    : null

  const barColor = pct == null
    ? 'bg-indigo-500'
    : pct >= 90
      ? 'bg-red-500'
      : pct >= 70
        ? 'bg-amber-400'
        : 'bg-emerald-500'

  const isActive = open || isOnPage

  return (
    <div className="mt-1">
      <button
        onClick={() => setOpen(!open)}
        className={`w-full group relative flex items-center gap-3 pl-3 pr-2.5 py-2.5 rounded-xl text-[13px] font-medium transition-colors ${
          isActive
            ? 'bg-indigo-50 text-indigo-700 shadow-sm shadow-indigo-500/5 dark:bg-indigo-500/15 dark:text-indigo-300 dark:shadow-none'
            : 'text-fg-muted hover:bg-surface-3/80 hover:text-fg'
        }`}
      >
        <span
          className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 transition-colors ${
            isActive
              ? 'bg-indigo-100/80 text-indigo-600 dark:bg-indigo-500/25 dark:text-indigo-300'
              : 'bg-surface-2 text-fg-muted group-hover:bg-surface group-hover:text-fg ring-1 ring-line/60'
          }`}
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><ellipse cx="12" cy="5" rx="9" ry="3" /><path strokeLinecap="round" strokeLinejoin="round" d="M3 5v14c0 1.657 4.03 3 9 3s9-1.343 9-3V5M3 12c0 1.657 4.03 3 9 3s9-1.343 9-3" /></svg>
        </span>
        <span className="flex-1 whitespace-nowrap tracking-tight text-left">DMS Provider</span>
        <svg xmlns="http://www.w3.org/2000/svg" className={`w-3.5 h-3.5 text-fg-subtle transition-transform duration-200 ${open ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Expanded panel */}
      <div className={`overflow-hidden transition-all duration-300 ease-in-out ${open ? 'max-h-[800px] opacity-100 mt-2 mb-4' : 'max-h-0 opacity-0'}`}>
        <div className="pl-[52px] pr-3 space-y-3 pb-1">

          {/* ── Loading skeleton ─────────────────────────────── */}
          {loading && !storage && (
            <div className="space-y-2.5 animate-pulse">
              <div className="h-2 w-3/4 rounded bg-surface-3" />
              <div className="h-1.5 w-full rounded-full bg-surface-3" />
              <div className="h-2 w-1/2 rounded bg-surface-3" />
              <div className="h-2 w-2/3 rounded bg-surface-3" />
            </div>
          )}

          {/* ── Error state ──────────────────────────────────── */}
          {!loading && error && (
            <div className="text-[11px] text-danger-fg bg-danger-subtle border border-danger-line rounded-lg px-2.5 py-2">
              <p className="font-medium">Connection error</p>
              <p className="mt-0.5 opacity-80 line-clamp-2">{error}</p>
              <button
                type="button"
                onClick={fetchData}
                className="mt-1.5 text-[10px] underline underline-offset-2 hover:no-underline"
              >
                Retry
              </button>
            </div>
          )}

          {/* ── Login state ──────────────────────────────────── */}
          {!loading && needsLogin && (
            <div className="bg-surface-2 rounded-lg border border-line p-3 shadow-sm">
              <h4 className="text-[12px] font-semibold text-fg mb-1">DMS Login Required</h4>
              <p className="text-[10px] text-fg-muted mb-3">Please authenticate to connect your DMS workspace.</p>
              
              <form onSubmit={handleDmsLogin} className="flex flex-col gap-2">
                <input
                  type="email"
                  placeholder="Email address"
                  className="w-full bg-surface border border-line rounded px-2.5 py-1.5 text-[11px] text-fg placeholder-fg-muted/50 focus:outline-none focus:border-indigo-500/50"
                  value={loginEmail}
                  onChange={(e) => setLoginEmail(e.target.value)}
                  required
                />
                <input
                  type="password"
                  placeholder="Password"
                  className="w-full bg-surface border border-line rounded px-2.5 py-1.5 text-[11px] text-fg placeholder-fg-muted/50 focus:outline-none focus:border-indigo-500/50"
                  value={loginPassword}
                  onChange={(e) => setLoginPassword(e.target.value)}
                  required
                />
                
                {loginError && (
                  <p className="text-[10px] text-danger-fg">{loginError}</p>
                )}
                
                <button
                  type="submit"
                  disabled={loginLoading}
                  className="mt-1 w-full bg-indigo-600 hover:bg-indigo-700 text-white text-[11px] font-medium py-1.5 rounded transition-colors disabled:opacity-70"
                >
                  {loginLoading ? 'Connecting...' : 'Connect to DMS'}
                </button>
              </form>
            </div>
          )}

          {/* ── Main content ─────────────────────────────────── */}
          {storage && !error && !needsLogin && (
            <>
              {/* Connected status & Provider name */}
              <div className="flex items-center gap-2">
                <span className="relative flex h-2 w-2 shrink-0">
                  {connected && !loading && (
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-60" />
                  )}
                  <span className={`relative inline-flex rounded-full h-2 w-2 ${connected ? 'bg-emerald-500' : 'bg-amber-400'}`} />
                </span>
                <span className="text-[11px] font-semibold text-fg">DMS</span>
                {loading && (
                  <svg xmlns="http://www.w3.org/2000/svg" className="w-3 h-3 text-fg-subtle animate-spin ml-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m0 0A8.001 8.001 0 0112 4c3.506 0 6.496 2.002 7.999 5m.001-5v5h-.583M20 20v-5h-.583m0 0A8.001 8.001 0 014 15m.582 5v-5H4" />
                  </svg>
                )}
              </div>

              {/* ── Storage bar ──────────────────────────────── */}
              <div className="bg-surface-2 rounded-lg px-2.5 py-2 border border-line/60">
                <div className="flex items-baseline justify-between mb-1.5 gap-1">
                  <span className="text-[11px] font-bold text-fg">{fmtBytes(storage.usedBytes)}</span>
                  <span className="text-[10px] text-fg-subtle">
                    {storage.limitBytes ? `/ ${fmtBytes(storage.limitBytes)}` : 'no limit'}
                  </span>
                </div>
                <div className="h-1.5 w-full rounded-full bg-surface-3 overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-700 ${barColor}`}
                    style={{
                      width: pct != null ? `${pct}%` : storage.usedBytes > 0 ? '100%' : '0%',
                      opacity: pct != null ? 1 : 0.35
                    }}
                  />
                </div>
                {pct != null && (
                  <p className="text-[10px] text-fg-subtle mt-1 text-right">{Math.round(pct)}% used</p>
                )}
              </div>

              {/* ── Doc count ────────────────────────────────── */}
              {storage.documentCount != null && (
                <div className="flex items-center gap-2 bg-surface-2 rounded-lg px-2.5 py-1.5 border border-line/60">
                  <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5 text-fg-subtle shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.75">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                  <span className="text-[11px] font-semibold text-fg">{fmtCount(storage.documentCount)}</span>
                  <span className="text-[10px] text-fg-subtle">docs</span>
                </div>
              )}

              {/* ── Folder structure ─────────────────────────── */}
              {isSuper && connected && groups && (
                <div className="rounded-lg bg-surface-2 border border-line/60 overflow-hidden py-0.5">
                  <FolderRow
                    icon={
                      <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5 text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.75">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" />
                      </svg>
                    }
                    label="All Documents"
                    count={storage.documentCount}
                  />
                  <div className="border-t border-line/40 mx-1 my-0.5" />
                  <FolderRow
                    icon={
                      <svg xmlns="http://www.w3.org/2000/svg" className="w-3 h-3 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.75">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                      </svg>
                    }
                    label="Approvals"
                    count={groups.tasks}
                    indent
                  />
                  <FolderRow
                    icon={
                      <svg xmlns="http://www.w3.org/2000/svg" className="w-3 h-3 text-violet-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.75">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      </svg>
                    }
                    label="Form Responses"
                    count={groups.forms}
                    indent
                  />
                  <FolderRow
                    icon={
                      <svg xmlns="http://www.w3.org/2000/svg" className="w-3 h-3 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.75">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                      </svg>
                    }
                    label="Workflows"
                    count={groups.workflows}
                    indent
                  />
                  {(groups.other > 0) && (
                    <FolderRow
                      icon={
                        <svg xmlns="http://www.w3.org/2000/svg" className="w-3 h-3 text-fg-subtle" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.75">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M5 19a2 2 0 01-2-2V7a2 2 0 012-2h4l2 2h4a2 2 0 012 2v1M5 19h14a2 2 0 002-2v-5a2 2 0 00-2-2H9a2 2 0 00-2 2v5a2 2 0 01-2 2z" />
                        </svg>
                      }
                      label="Other"
                      count={groups.other}
                      indent
                    />
                  )}
                </div>
              )}

              {/* ── View Details CTA (SuperAdmin only) ───────── */}
              {isSuper && (
                <Link
                  to="/dms"
                  className="flex items-center gap-1.5 w-full text-[11px] font-medium text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-300 py-1 transition mt-2"
                >
                  View complete details & search
                  <svg xmlns="http://www.w3.org/2000/svg" className="w-3 h-3 ml-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                  </svg>
                </Link>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

