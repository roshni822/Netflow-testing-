// Shared - AppShell.jsx
// One layout for every authenticated page.
// - Non-employees: left sidebar + top bar (search, bell, user)
// - Employees: top bar (logo + search, bell, user) + bottom tab bar

import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { authStore, useUser, initials, ROLE_LABELS } from '../utils/auth'
import { themeStore, useTheme } from '../lib/themeStore'
import { useTasks } from '../lib/tasksStore'
import { useForms } from '../lib/formsStore'
import { useWorkflows } from '../lib/workflowsStore'
import {
  canCreateWorkflow,
  canEditWorkflow,
  canManageUsers,
  canManageDocuments,
  canViewAudit,
  canViewReports,
  canViewTeam,
  isOrgAdmin,
  isSuperAdmin,
  isPlatformShell,
  getShell,
  SHELL
} from '../utils/permissions'
import { api } from '../utils/api'
import { useFocusTrap, useOutsideDismiss, useScrollLock, modifierKeyLabel } from '../utils/a11y'
import AssistantWidget from './AssistantWidget'
import LicenceBanner from './LicenceBanner'
import NotificationsBell from './NotificationsBell'
import BroadcastBanner from './BroadcastBanner'

// ---------- left rail ----------------------------------------------------
// Four shells. Items without `visible` are always shown inside that shell.
// Never-show lists are enforced by simply omitting those routes from the shell.

const PLATFORM_NAV = [
  {
    label: 'PLATFORM',
    items: [
      { key: 'dashboard', label: 'Dashboard', to: '/dashboard', icon: IconDashboard },
      { key: 'platform', label: 'Organizations', to: '/platform', icon: IconPlatform },
      { key: 'usage', label: 'Usage', to: '/usage', icon: IconAnalytics },
      { key: 'activity', label: 'Activity logs', to: '/activity', icon: IconActivity }
    ]
  },
  {
    label: 'OPERATIONS',
    items: [
      { key: 'health', label: 'System health', to: '/health', icon: IconHealth }
    ]
  },
  {
    label: 'GOVERNANCE',
    items: [
      { key: 'plans', label: 'Plans', to: '/plans', icon: IconPlans },
      { key: 'admins', label: 'Admins', to: '/admins', icon: IconAdmin }
    ]
  }
]

const ORG_ADMIN_NAV = [
  {
    label: 'OVERVIEW',
    items: [
      { key: 'dashboard', label: 'Dashboard', to: '/dashboard', icon: IconDashboard },
    ]
  },
  {
    label: 'BUILD & AUTOMATE',
    items: [
      { key: 'forms', label: 'Forms', to: '/forms', icon: IconForms },
      { key: 'workflows', label: 'Workflows', to: '/workflows', icon: IconWorkflows, visible: canCreateWorkflow }
    ]
  },
  {
    label: 'PEOPLE & ACCESS',
    items: [
      { key: 'departments', label: 'Departments', to: '/departments', icon: IconBuilding, visible: canManageUsers },
      { key: 'users', label: 'Users', to: '/admin', icon: IconTeam, visible: canManageUsers },
      { key: 'roles', label: 'Roles & permissions', to: '/roles', icon: IconRoles, visible: canManageUsers }
    ]
  },
  {
    label: 'CONTENT & STORAGE',
    items: [
      { key: 'documents', label: 'DMS', to: '/documents', icon: IconFolder, visible: canManageDocuments },
      { key: 's3-storage', label: 'S3 Storage', to: '/s3-storage', icon: IconDms, visible: canManageDocuments }
    ]
  },
  {
    label: 'INSIGHTS',
    items: [
      { key: 'reports', label: 'Reports', to: '/analytics', icon: IconAnalytics, visible: canViewReports },
      { key: 'audit', label: 'Audit logs', to: '/audit-log', icon: IconAudit, visible: canViewAudit }
    ]
  },
  {
    label: 'WORKSPACE',
    items: [
      { key: 'org-settings', label: 'Settings', to: '/settings', icon: IconSettings, visible: isOrgAdmin },
      { key: 'billing', label: 'Plan & usage', to: '/billing', icon: IconBilling, visible: isOrgAdmin }
    ]
  }
]

const OPS_NAV = [
  {
    label: 'WORKSPACE',
    items: [
      { key: 'dashboard', label: 'Dashboard', to: '/dashboard', icon: IconDashboard },
      { key: 'tasks', label: 'Approvals', to: '/tasks', icon: IconTasks },
      { key: 'forms', label: 'Forms', to: '/forms', icon: IconForms },
      { key: 'workflows', label: 'Workflows', to: '/workflows', icon: IconWorkflows, visible: canCreateWorkflow }
    ]
  },
  {
    label: 'PEOPLE & INSIGHTS',
    items: [
      { key: 'team', label: 'My team', to: '/team', icon: IconTeam, visible: canViewTeam },
      { key: 'analytics', label: 'Analytics', to: '/analytics', icon: IconAnalytics, visible: canViewReports },
      { key: 'audit', label: 'Audit logs', to: '/audit-log', icon: IconAudit, visible: canViewAudit }
    ]
  }
]

const WORKSPACE_NAV = [
  {
    label: 'WORKSPACE',
    items: [
      { key: 'dashboard', label: 'Dashboard', to: '/dashboard', icon: IconDashboard },
      { key: 'tasks', label: 'My requests', to: '/tasks', icon: IconTasks },
      { key: 'forms', label: 'Forms', to: '/forms', icon: IconForms },
      { key: 'workflows', label: 'Workflows', to: '/workflows', icon: IconWorkflows, visible: canCreateWorkflow },
      { key: 'profile', label: 'Profile', to: '/profile', icon: IconAdmin }
    ]
  }
]

function visibleSections(user) {
  const shell = getShell(user)
  let sections
  if (shell === SHELL.PLATFORM) sections = PLATFORM_NAV
  else if (shell === SHELL.ORG_ADMIN) sections = ORG_ADMIN_NAV
  else if (shell === SHELL.OPS) sections = OPS_NAV
  else sections = WORKSPACE_NAV

  if (shell !== SHELL.PLATFORM && shell !== SHELL.ORG_ADMIN && canManageDocuments(user)) {
    sections = [...sections, { label: 'DOCUMENTS', items: [
      { key: 'documents', label: 'DMS', to: '/documents', icon: IconFolder },
      { key: 's3-storage', label: 'S3 Storage', to: '/s3-storage', icon: IconDms }
    ] }]
  }

  sections = sections.map(section => ({
    ...section,
    items: section.items.filter(item => !item.visible || item.visible(user))
  })).filter(section => section.items.length > 0)

  if (user && user.dmsEnabled === false) {
    sections = sections.map(section => ({
      ...section,
      items: section.items.filter(item => item.key !== 'documents')
    })).filter(section => section.items.length > 0)
  }

  if (user && user.s3Enabled === false) {
    sections = sections.map(section => ({
      ...section,
      items: section.items.filter(item => item.key !== 's3-storage')
    })).filter(section => section.items.length > 0)
  }

  return sections
}

const SHELL_FOOTER = {
  [SHELL.PLATFORM]: 'Platform console',
  [SHELL.ORG_ADMIN]: 'Organization admin',
  [SHELL.OPS]: 'Business ops',
  [SHELL.WORKSPACE]: 'Workspace',
}

// Shared nav rendering — the permission-filtered sections + links. Used by both
// the desktop push-drawer Sidebar and the mobile overlay drawer. `onNavigate`
// (optional) fires when a link is tapped, letting the mobile drawer close.
function NavSections({ user, pendingCount, onNavigate, compact = false }) {
  const { pathname } = useLocation()
  const sections = visibleSections(user)

  return (
    <>
      {sections.map((section, si) => (
        <div key={section.label || `sec-${si}`} className="nf-nav-group">
          {section.label && (
            <p className="nf-nav-label">
              {section.label}
            </p>
          )}
          <ul className="nf-nav-list">
            {section.items.map((item) => {
              if (item.component) {
                const ItemComponent = item.component
                return (
                  <li key={item.key}>
                    <ItemComponent user={user} />
                  </li>
                )
              }
              const Icon = item.icon
              const label = item.labelFor ? item.labelFor(user) : item.label
              const isActive = pathname === item.to || pathname.startsWith(item.to + '/')
              const showBadge = item.key === 'tasks' && pendingCount > 0
              return (
                <li key={item.key}>
                  <Link
                    to={item.to}
                    onClick={onNavigate}
                    title={compact ? label : undefined}
                    data-tour={`nav-${item.key}`}
                    aria-current={isActive ? 'page' : undefined}
                    className="nf-nav-item group"
                  >
                    {isActive && (
                      <span
                        aria-hidden="true"
                        className="nf-nav-active-line"
                      />
                    )}
                    <span className="nf-nav-icon">
                      <Icon className="nf-nav-glyph" />
                    </span>
                    <span className="nf-nav-text">{label}</span>
                    {showBadge && (
                      <span className="nf-nav-count">
                        {pendingCount > 99 ? '99+' : pendingCount}
                      </span>
                    )}
                  </Link>
                </li>
              )
            })}
          </ul>
        </div>
      ))}
    </>
  )
}

// Desktop sidebar: full labels when open and a compact icon rail when collapsed.
// Phones keep their separate bottom navigation and overlay drawer.
function Sidebar({ user, pendingCount, open, onToggle }) {
  const shellLabel = SHELL_FOOTER[getShell(user)] || 'Workspace'

  return (
    <aside
      id="app-sidebar"
      data-collapsed={open ? undefined : 'true'}
      className="nf-sidebar hidden md:flex flex-col shrink-0 overflow-hidden sticky top-0 h-screen"
    >
      <div className="nf-sidebar-frame h-full flex flex-col min-h-0">
        <div className="nf-sidebar-brand shrink-0">
          <Link to="/dashboard" title={open ? undefined : 'NetFlow dashboard'} className="nf-sidebar-brand-link">
            <img src="/netflow-icon.png" alt="" className="nf-sidebar-logo" />
            <span className="nf-sidebar-brand-copy">
              <span className="nf-sidebar-brand-name">NetFlow</span>
              <span className="nf-sidebar-brand-tagline">Work made visible</span>
            </span>
          </Link>
        </div>

        <nav aria-label="Main" className="nf-sidebar-scroll flex-1 min-h-0 overflow-y-auto">
          <NavSections user={user} pendingCount={pendingCount} compact={!open} />
        </nav>

        <div className="nf-sidebar-footer shrink-0">
          <button type="button" onClick={onToggle} aria-label={open ? 'Collapse sidebar' : 'Expand sidebar'} aria-expanded={open} aria-controls="app-sidebar" title={open ? undefined : 'Expand sidebar'} className="nf-sidebar-collapse">
            <svg xmlns="http://www.w3.org/2000/svg" className="nf-sidebar-collapse-icon" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.7"><rect x="3" y="3" width="18" height="18" rx="2" /><path strokeLinecap="round" strokeLinejoin="round" d="M9 3v18" />{open ? <path strokeLinecap="round" strokeLinejoin="round" d="M16 9l-3 3 3 3" /> : <path strokeLinecap="round" strokeLinejoin="round" d="M13 9l3 3-3 3" />}</svg>
            {open && <span className="nf-sidebar-collapse-label">Collapse sidebar</span>}
          </button>
          <div className="nf-workspace-card" title={open ? undefined : (isSuperAdmin(user) ? 'Platform console' : (user?.tenantName || 'Organization workspace'))}>
            <span className="nf-workspace-avatar">{initials(isSuperAdmin(user) ? 'Super Admin' : (user?.tenantName || user?.name || 'Workspace'))}</span>
            <span className="nf-workspace-copy">
              <span className="nf-workspace-name">{isSuperAdmin(user) ? 'Platform console' : (user?.tenantName || 'Organization workspace')}</span>
              <span className="nf-workspace-plan">{shellLabel}</span>
            </span>
          </div>
          <p className="text-[11px] text-fg-subtle leading-snug">
            <span className="font-medium text-fg-muted">{shellLabel}</span>
            <span className="block mt-0.5">Navigation matches your role’s access.</span>
          </p>
        </div>
      </div>
    </aside>
  )
}

// Fixed bottom tab bar for phones (md:hidden). Shows the top destinations; when
// the role has more items than fit, a Menu tab opens the full nav in an overlay
// drawer. Reuses each item's icon + label and the Tasks pending badge.
function BottomTabBar({ user, pendingCount, menuOpen, onOpenMenu }) {
  const { pathname } = useLocation()
  const flat = visibleSections(user).flatMap((s) => s.items)
  const useMenu = flat.length > 5
  const primary = useMenu ? flat.slice(0, 4) : flat.slice(0, 5)
  const isActive = (to) => pathname === to || pathname.startsWith(to + '/')

  return (
    <nav
      aria-label="Primary"
      className="nf-mobile-bottom-nav md:hidden fixed bottom-0 inset-x-0 z-30 bg-surface border-t border-line pb-[env(safe-area-inset-bottom)]"
    >
      <div className="flex items-stretch">
        {primary.map((item) => {
          const Icon = item.icon
          const label = item.labelFor ? item.labelFor(user) : item.label
          const active = isActive(item.to)
          const showBadge = item.key === 'tasks' && pendingCount > 0
          return (
            <Link
              key={item.key}
              to={item.to}
              data-tour={`nav-${item.key}`}
              className={`relative flex-1 min-w-0 flex flex-col items-center justify-center gap-0.5 py-2 text-[11px] font-medium transition-colors ${
                active ? 'text-indigo-600 dark:text-indigo-300' : 'text-fg-muted'
              }`}
            >
              <span className="relative">
                <Icon className="w-5 h-5" />
                {showBadge && (
                  <span className="absolute -top-1.5 -right-2.5 min-w-[16px] h-4 px-1 rounded-full bg-success-solid text-white text-[10px] font-semibold flex items-center justify-center">
                    {pendingCount > 9 ? '9+' : pendingCount}
                  </span>
                )}
              </span>
              <span className="max-w-full truncate">{label}</span>
            </Link>
          )
        })}
        {useMenu && (
          <button
            type="button"
            onClick={onOpenMenu}
            aria-expanded={menuOpen}
            aria-controls="mobile-nav-drawer"
            aria-label="Open menu"
            className={`flex-1 min-w-0 flex flex-col items-center justify-center gap-0.5 py-2 text-[11px] font-medium transition-colors ${
              menuOpen ? 'text-indigo-600 dark:text-indigo-300' : 'text-fg-muted'
            }`}
          >
            <IconMenu className="w-5 h-5" />
            <span>Menu</span>
          </button>
        )}
      </div>
    </nav>
  )
}

// Slide-in overlay that reveals the full nav on phones. Opened by the bottom
// bar's Menu tab; closes on backdrop click, Esc, or tapping a link.
//
// The drawer used to stay mounted off-screen, so its links were still tabbable
// and the page behind it still scrolled under your finger. It now mounts only
// while open (one frame ahead of the slide-in so the transition still plays)
// and traps focus for as long as it's up.
function MobileNavDrawer({ user, pendingCount, open, onClose }) {
  const [mounted, setMounted] = useState(open)
  const [shown, setShown] = useState(open)
  const panelRef = useRef(null)

  useEffect(() => {
    let secondFrame
    let timeout
    const frame = requestAnimationFrame(() => {
      if (open) {
        setMounted(true)
        // Mount before starting the CSS transition on the next browser frame.
        secondFrame = requestAnimationFrame(() => setShown(true))
      } else {
        setShown(false)
        timeout = setTimeout(() => setMounted(false), 200)
      }
    })
    return () => {
      cancelAnimationFrame(frame)
      cancelAnimationFrame(secondFrame)
      clearTimeout(timeout)
    }
  }, [open])

  useScrollLock(open)
  useFocusTrap(open, panelRef, { onEscape: onClose })

  if (!mounted) return null

  return (
    <div className="nf-mobile-drawer-root md:hidden">
      <div
        onClick={onClose}
        className={`fixed inset-0 z-40 bg-black/40 transition-opacity duration-200 ${shown ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
      />
      <aside
        ref={panelRef}
        id="mobile-nav-drawer"
        role="dialog"
        aria-modal="true"
        aria-label="Navigation menu"
        tabIndex={-1}
        className={`nf-sidebar nf-mobile-sidebar fixed inset-y-0 left-0 z-50 max-w-[88%] shadow-xl transition-transform duration-200 ease-in-out ${shown ? 'translate-x-0' : '-translate-x-full'}`}
      >
        <div className="nf-mobile-sidebar-brand">
          <img src="/netflow-icon.png" alt="NetFlow" className="nf-sidebar-logo" />
          <div className="nf-sidebar-brand-copy">
            <p className="nf-sidebar-brand-name">NetFlow</p>
            <p className="nf-sidebar-brand-tagline">
              {SHELL_FOOTER[getShell(user)] || 'Workspace'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close menu"
            className="nf-mobile-sidebar-close"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="nf-nav-glyph" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.7">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <nav className="nf-sidebar-scroll nf-mobile-sidebar-nav">
          <NavSections user={user} pendingCount={pendingCount} onNavigate={onClose} />
        </nav>
      </aside>
    </div>
  )
}

// ---------- global search ------------------------------------------------

const TYPE_BADGE = {
  Request:  'bg-blue-50 text-blue-600 dark:bg-blue-500/15 dark:text-blue-300',
  Form:     'bg-success-subtle text-success-fg',
  Workflow: 'bg-violet-50 text-violet-600 dark:bg-violet-500/15 dark:text-violet-300',
  Org:      'bg-indigo-50 text-indigo-600 dark:bg-indigo-500/15 dark:text-indigo-300',
  Page:     'bg-surface-3 text-fg-muted',
}

// Tenant list behind the platform search box. Loaded the first time the box is
// opened and kept for the session — the console navigates a lot and the list
// only changes when the SuperAdmin themselves creates or deletes an org.
let platformOrgsCache = []

function usePlatformOrgs(enabled) {
  const [orgs, setOrgs] = useState(platformOrgsCache)

  useEffect(() => {
    if (!enabled || platformOrgsCache.length) return
    let cancelled = false
    api.get('/api/platform/orgs')
      .then((data) => {
        platformOrgsCache = data.orgs || []
        if (!cancelled) setOrgs(platformOrgsCache)
      })
      .catch(() => { /* search just falls back to page results */ })
    return () => { cancelled = true }
  }, [enabled])

  return orgs
}

// Navigable pages the current user is actually allowed to open.
function pageResults(user) {
  return visibleSections(user).flatMap((s) =>
    s.items.map((it) => ({
      type: 'Page',
      id: it.to,
      label: typeof it.labelFor === 'function' ? it.labelFor(user) : it.label,
      sub: 'Go to page',
      to: it.to,
    }))
  )
}

const cleanReqTitle = (s) => (s || '').replace(/\s*—\s*Approval Required\s*$/i, '')

// Works for every role: requests + forms come from endpoints all users can read;
// workflows are only surfaced to roles that can open the workflows page. In the
// platform shell there is no tenant data to search, so it searches tenants
// (organizations) and the console's own pages instead.
function GlobalSearch({ user }) {
  const navigate = useNavigate()
  const platform = isPlatformShell(user)
  const tasks = useTasks(!platform)
  const forms = useForms(!platform)
  const workflows = useWorkflows(!platform)

  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const orgs = usePlatformOrgs(platform && open)
  const [activeIdx, setActiveIdx] = useState(0)
  const inputRef = useRef(null)
  const boxRef = useRef(null)
  const modKey = useMemo(() => modifierKeyLabel(), [])

  // Ctrl/Cmd+K focuses the search from anywhere in the app.
  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        inputRef.current?.focus()
        setOpen(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useOutsideDismiss(open, boxRef, () => setOpen(false))

  const results = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return []
    const out = []

    if (platform) {
      for (const o of orgs) {
        const hay = `${o.name || ''} ${o.subdomain || ''}`.toLowerCase()
        if (hay.includes(q)) {
          out.push({
            type: 'Org',
            id: o._id,
            label: o.name || o.subdomain || 'Organization',
            sub: [o.subdomain, o.plan, o.status].filter(Boolean).join(' · ') || 'Organization',
            to: `/platform?q=${encodeURIComponent(o.subdomain || o.name || '')}`
          })
        }
      }
      for (const p of pageResults(user)) {
        if (p.label.toLowerCase().includes(q)) out.push(p)
      }
      return out.slice(0, 12)
    }

    for (const t of tasks) {
      const title = cleanReqTitle(t.title)
      if (title.toLowerCase().includes(q) || (t.department || '').toLowerCase().includes(q)) {
        out.push({ type: 'Request', id: t.id, label: title || 'Request', sub: t.status || t.department || 'Request', to: `/tasks/${t.id}` })
      }
    }
    for (const f of forms) {
      const name = f.name || f.title || ''
      if (name.toLowerCase().includes(q) || (f.category || '').toLowerCase().includes(q)) {
        out.push({ type: 'Form', id: f.id, label: name || 'Form', sub: f.category || 'Form', to: `/forms/${f.id}/fill` })
      }
    }
    if (canCreateWorkflow(user)) {
      // Only Admins can open the editor; everyone else lands on the list.
      const canOpenEditor = canEditWorkflow(user)
      for (const w of workflows) {
        const name = w.name || w.title || ''
        if (name.toLowerCase().includes(q) || (w.category || '').toLowerCase().includes(q)) {
          out.push({
            type: 'Workflow',
            id: w.id,
            label: name || 'Workflow',
            sub: w.status || w.category || 'Workflow',
            to: canOpenEditor && w.id ? `/workflows/${w.id}/edit` : '/workflows',
          })
        }
      }
    }
    for (const p of pageResults(user)) {
      if (p.label.toLowerCase().includes(q)) out.push(p)
    }

    const seen = new Set()
    return out.filter((r) => {
      const k = `${r.type}:${r.id}`
      if (seen.has(k)) return false
      seen.add(k)
      return true
    }).slice(0, 12)
  }, [query, platform, orgs, tasks, forms, workflows, user])



  const go = (r) => {
    if (!r) return
    setOpen(false)
    setQuery(''); setActiveIdx(0)
    navigate(r.to)
  }

  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown')      { e.preventDefault(); setOpen(true); setActiveIdx((i) => Math.min(i + 1, results.length - 1)) }
    else if (e.key === 'ArrowUp')   { e.preventDefault(); setActiveIdx((i) => Math.max(i - 1, 0)) }
    else if (e.key === 'Enter')     { if (results.length) go(results[activeIdx]) }
    else if (e.key === 'Escape')    { setOpen(false); inputRef.current?.blur() }
  }

  const showDropdown = open && query.trim().length > 0

  return (
    <div ref={boxRef} data-tour="search" className="nf-global-search flex-1 max-w-[440px] relative">
      <div className="relative">
        <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-fg-subtle pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
          <circle cx="11" cy="11" r="7" /><path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35" />
        </svg>
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => { setQuery(e.target.value); setActiveIdx(0); setOpen(true) }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder={platform ? 'Search organizations, pages…' : 'Search requests, forms, workflows…'}
          aria-label={platform ? 'Search organizations and pages' : 'Search requests, forms and workflows'}
          role="combobox"
          aria-expanded={showDropdown}
          aria-controls="global-search-results"
          aria-autocomplete="list"
          className="w-full h-10 pl-9 pr-4 sm:pr-16 text-sm text-fg border border-line rounded-[10px] bg-surface-2 placeholder-fg-subtle focus:outline-none focus:ring-2 focus:ring-indigo-300 focus:bg-surface transition"
        />
        <kbd className="hidden sm:block absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-fg-subtle border border-line rounded px-1.5 py-0.5 bg-surface font-sans pointer-events-none">
          {modKey} K
        </kbd>
      </div>

      {showDropdown && (
        <div id="global-search-results" className="absolute left-0 right-0 mt-2 bg-surface border border-line rounded-xl shadow-lg overflow-hidden z-30">
          {results.length === 0 ? (
            <div className="px-4 py-6 text-center text-xs text-fg-subtle">No matches for &ldquo;{query.trim()}&rdquo;</div>
          ) : (
            <ul role="listbox" aria-label="Search results" className="max-h-80 overflow-y-auto py-1">
              {results.map((r, i) => (
                <li key={`${r.type}:${r.id}`} role="option" aria-selected={i === activeIdx}>
                  <button
                    type="button"
                    tabIndex={-1}
                    onMouseEnter={() => setActiveIdx(i)}
                    onClick={() => go(r)}
                    className={`w-full text-left px-3 py-2 flex items-center gap-3 transition ${i === activeIdx ? 'bg-indigo-50 dark:bg-indigo-500/15' : 'hover:bg-surface-2'}`}
                  >
                    <span className={`shrink-0 text-[10px] font-medium px-1.5 py-0.5 rounded ${TYPE_BADGE[r.type] || TYPE_BADGE.Page}`}>{r.type}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-xs font-medium text-fg truncate">{r.label}</span>
                      <span className="block text-[10px] text-fg-subtle truncate">{r.sub}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}

// ---------- top bar ------------------------------------------------------

function TopBar({ user }) {
  const theme = useTheme()
  const displayName = user?.name || 'Guest'
  const roleLabel = user?.role?.name
    ? (ROLE_LABELS[user.role.name] || user.role.name)
    : 'Member'
  // Keep identity and role visible for every shell, matching the approved UI.
  const chipPrimary = displayName
  const chipSecondary = user?.canBuild ? `${roleLabel} · Builder` : roleLabel

  return (
    <header className="nf-topbar h-[68px] bg-surface/95 backdrop-blur-md border-b border-line px-4 md:px-6 flex items-center gap-3 md:gap-4 sticky top-0 z-20">
      {/* Mobile logo; desktop branding stays inside the full or compact rail. */}
      <Link
        to="/dashboard"
        className="nf-mobile-brand flex md:hidden items-center gap-2 shrink-0"
      >
        <img src="/netflow-icon.png" alt="NetFlow" className="w-8 h-8 rounded-xl shadow-sm ring-1 ring-black/5 dark:ring-white/10" />
        <span className="hidden sm:inline font-bold text-fg text-[15px] tracking-tight">NetFlow</span>
      </Link>

      {/* Global search — works for every role */}
      <GlobalSearch user={user} />

      <div className="flex items-center gap-2 ml-auto">
        <button
          type="button"
          data-tour="theme"
          onClick={() => themeStore.toggle()}
          aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          title={theme === 'dark' ? 'Light mode' : 'Dark mode'}
          className="nf-topbar-icon w-10 h-10 rounded-[10px] border border-line flex items-center justify-center text-fg-muted hover:bg-surface-3 transition"
        >
          {theme === 'dark' ? (
            <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="4" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 2v2m0 16v2M4.93 4.93l1.41 1.41m11.32 11.32l1.41 1.41M2 12h2m16 0h2M4.93 19.07l1.41-1.41m11.32-11.32l1.41-1.41" />
            </svg>
          ) : (
            <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" />
            </svg>
          )}
        </button>
        <NotificationsBell />

        <div className="hidden sm:block w-px h-8 bg-line mx-1" />

        <UserMenu
          user={user}
          displayName={displayName}
          chipPrimary={chipPrimary}
          chipSecondary={chipSecondary}
          avatarSeed={displayName}
        />
      </div>
    </header>
  )
}

function UserMenu({ user, displayName, chipPrimary, chipSecondary, avatarSeed }) {
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const wrapRef = useRef(null)
  const buttonRef = useRef(null)
  const primary = chipPrimary || displayName
  const secondary = chipSecondary
  const avatarLabel = avatarSeed || displayName

  // Previously this menu only closed on Escape or by moving the mouse out of
  // it — neither of which happens on a touch device, so it got stuck open.
  useOutsideDismiss(open, wrapRef, () => setOpen(false))

  useEffect(() => {
    if (!open) return undefined
    const onKey = (e) => {
      if (e.key !== 'Escape') return
      setOpen(false)
      buttonRef.current?.focus()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])



  return (
    <div ref={wrapRef} data-tour="user-menu" className="relative">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Account menu for ${displayName}`}
        className="nf-user-button min-h-10 flex items-center gap-2 pl-1 pr-2 py-1 rounded-[10px]  hover:bg-surface-3 transition"
      >
        <div className={`w-8 h-8 rounded-full text-white flex items-center justify-center text-xs font-semibold ${
          isSuperAdmin(user)
            ? 'bg-gradient-to-br from-indigo-500 to-indigo-700'
            : 'bg-gradient-to-br from-slate-700 to-slate-900'
        }`}>
          {initials(avatarLabel)}
        </div>
        <div className="hidden sm:block text-left leading-tight">
          <p className="text-sm font-medium text-fg max-w-[12rem] truncate">{primary}</p>
          {secondary && secondary !== primary && (
            <p className="text-[11px] text-fg-muted truncate max-w-[12rem]">{secondary}</p>
          )}
        </div>
        <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5 text-fg-subtle ml-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && user && (
        <div
          role="menu"
          aria-label="Account"
          className="absolute right-0 mt-2 w-44 bg-surface border border-line rounded-md shadow-lg z-30 py-1"
        >
          <button
            role="menuitem"
            onClick={() => { setOpen(false); navigate('/profile') }}
            className="w-full text-left px-3 py-2 text-sm text-fg hover:bg-surface-2 focus:bg-surface-2 focus:outline-none"
          >
            Your profile
          </button>
          <div className="my-1 h-px bg-surface-3" />
          <button
            role="menuitem"
            onClick={() => { setOpen(false); authStore.logout(false).then(() => navigate('/login')) }}
            className="w-full text-left px-3 py-2 text-sm text-fg hover:bg-danger-subtle hover:text-danger-fg focus:bg-danger-subtle focus:text-danger-fg focus:outline-none"
          >
            Sign out
          </button>
        </div>
      )}
    </div>
  )
}

// ---------- AppShell -----------------------------------------------------

export default function AppShell({
  title,
  subtitle,
  actions,
  back,
  children,
  mainClass = 'flex-1 p-4 md:p-6 pb-24 md:pb-6 overflow-y-auto'
}) {
  const user = useUser()
  const platform = isPlatformShell(user)
  const tasks = useTasks(!platform)
  const { pathname } = useLocation()

  // Mobile-only overlay nav (opened from the bottom bar's Menu tab). Not
  // persisted; auto-closes whenever the route changes.
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [menuPath, setMenuPath] = useState(pathname)
  if (menuPath !== pathname) {
    setMenuPath(pathname)
    setMobileMenuOpen(false)
  }
  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' })
    document.getElementById('main-content')?.scrollTo({ top: 0, left: 0, behavior: 'auto' })
  }, [pathname])

  // Push-drawer open/closed state — user preference, persisted (default open).
  const [navOpen, setNavOpen] = useState(() => {
    try { return localStorage.getItem('fs.navOpen') !== '0' } catch { return true }
  })
  const toggleNav = () => setNavOpen((o) => {
    const next = !o
    try { localStorage.setItem('fs.navOpen', next ? '1' : '0') } catch { /* storage unavailable */ }
    return next
  })

  // Application demo asks the sidebar to open so nav highlights are visible.
  useEffect(() => {
    const openNav = () => {
      setNavOpen(true)
      try { localStorage.setItem('fs.navOpen', '1') } catch { /* ignore */ }
    }
    window.addEventListener('fs:nav-open', openNav)
    return () => window.removeEventListener('fs:nav-open', openNav)
  }, [])

  // Only count approvals genuinely waiting on me (assigned to me + pending),
  // not requests I submitted that happen to be pending on someone else.
  const pendingCount = useMemo(
    () => tasks.filter(
      (t) => t.status === 'Pending' && user && String(t.assignedToId) === String(user._id)
    ).length,
    [tasks, user]
  )

  const hasTitleRow = title || subtitle || actions || back

  return (
    <div className="nf-app-shell min-h-screen flex bg-surface-2 text-fg" data-shell={getShell(user)} data-route={pathname}>
      {/* Keyboard users had to tab past the whole nav and search on every page */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-[120] focus:px-4 focus:py-2 focus:rounded-md focus:bg-indigo-600 focus:text-white focus:text-sm focus:font-medium focus:shadow-lg"
      >
        Skip to main content
      </a>

      {/* Push-drawer sidebar — occupies width when open, pushing content */}
      <Sidebar user={user} pendingCount={pendingCount} open={navOpen} onToggle={toggleNav} />

      <div className="flex-1 flex flex-col min-w-0 min-h-0">
        <TopBar user={user} />
        <BroadcastBanner />

        <main id="main-content" data-tour="main-content" tabIndex={-1} className={`nf-main ${mainClass} focus:outline-none`}>
          {/* Above the page title: a read-only workspace is context for whatever
              the user is about to try, not a footnote. Not mounted in the
              platform shell — it would poll a workspace licence endpoint the
              console is not allowed to call. */}
          {!platform && <div className="shrink-0"><LicenceBanner /></div>}
          {hasTitleRow && (
            <div className="nf-page-header flex flex-col md:flex-row md:items-start md:justify-between gap-3 mb-6 shrink-0">
              <div className="min-w-0" data-tour="page-title">
                {back && (
                  <Link
                    to={back.to}
                    className="text-xs text-fg-muted hover:text-fg inline-flex items-center gap-1 mb-1"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                    </svg>
                    {back.label}
                  </Link>
                )}
                {title && (
                  <h1 className="text-[30px] md:text-[34px] font-bold tracking-[-0.035em] text-fg leading-[1.12]">
                    {title}
                  </h1>
                )}
                {subtitle && (
                  <div className="text-sm text-fg-muted mt-1">{subtitle}</div>
                )}
              </div>
              {actions && (
                <div data-tour="page-actions" className="flex items-center gap-2 flex-wrap shrink-0">
                  {actions}
                </div>
              )}
            </div>
          )}
          {children}
        </main>
      </div>

      {/* Mobile-only: fixed bottom tab bar + slide-in nav overlay (md:hidden) */}
      <BottomTabBar
        user={user}
        pendingCount={pendingCount}
        menuOpen={mobileMenuOpen}
        onOpenMenu={() => setMobileMenuOpen(true)}
      />
      <MobileNavDrawer
        user={user}
        pendingCount={pendingCount}
        open={mobileMenuOpen}
        onClose={() => setMobileMenuOpen(false)}
      />

      {/* Floating AI assistant — answers questions about a workspace's forms and
          requests, so it has nothing to say in the platform console */}
      {!platform && <AssistantWidget />}
    </div>
  )
}

// ---------- inline icons (used in the sidebar nav) ----------------------

function IconDashboard(p) { return (
  <svg {...p} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.7"><rect x="3" y="3" width="7" height="7" rx="2" /><rect x="14" y="3" width="7" height="7" rx="2" /><rect x="3" y="14" width="7" height="7" rx="2" /><rect x="14" y="14" width="7" height="7" rx="2" /></svg>
)}
function IconForms(p) { return (
  <svg {...p} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.7"><path d="M6 3h9l4 4v14H6z" /><path d="M14 3v5h5M9 12h6M9 16h6" /></svg>
)}
function IconWorkflows(p) { return (
  <svg {...p} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.7"><circle cx="5" cy="5" r="2" /><circle cx="19" cy="5" r="2" /><circle cx="12" cy="19" r="2" /><path d="M7 5h10M18 7l-5 10M6 7l5 10" /></svg>
)}
function IconTasks(p) { return (
  <svg {...p} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.7"><path d="M9 5h11M9 12h11M9 19h11" /><path d="m3 5 1 1 2-2m-3 8 1 1 2-2m-3 8 1 1 2-2" /></svg>
)}
function IconAnalytics(p) { return (
  <svg {...p} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.7"><path d="M3 3v18h18" /><path d="m7 16 4-5 4 3 5-7" /></svg>
)}
function IconAudit(p) { return (
  <svg {...p} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.7"><path d="M9 11l3 3L22 4" /><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" /></svg>
)}
function IconActivity(p) { return (
  <svg {...p} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.7"><path d="M3 12h4l3-8 4 16 3-8h4" /></svg>
)}
function IconAdmin(p) { return (
  <svg {...p} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.7"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" /></svg>
)}

function IconTeam(p) { return (
  <svg {...p} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.7"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" /></svg>
)}
function IconRoles(p) { return (
  <svg {...p} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.7"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" /><path d="m9 12 2 2 4-4" /></svg>
)}
function IconSettings(p) { return (
  <svg {...p} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.7"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.4 1V21H9.6v-.08A1.7 1.7 0 0 0 8.5 19.4a1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-.6-1 1.7 1.7 0 0 0-1-.4H3V9.6h.08A1.7 1.7 0 0 0 4.6 8.5a1.7 1.7 0 0 0-.34-1.88l-.06-.06 2.83-2.83.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-.6 1.7 1.7 0 0 0 .4-1V3h4v.08A1.7 1.7 0 0 0 15.5 4.6a1.7 1.7 0 0 0 1.88-.34l.06-.06 2.83 2.83-.06.06A1.7 1.7 0 0 0 19.4 9c.35.25.7.57.8 1 .12.3.2.64.2 1H21v4h-.08a1.7 1.7 0 0 0-1.52 1Z" /></svg>
)}
function IconPlatform(p) { return (
  <svg {...p} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.7"><rect x="3" y="3" width="8" height="18" rx="1" /><rect x="13" y="8" width="8" height="13" rx="1" /><path d="M7 7h1M7 11h1M7 15h1M17 12h1M17 16h1M2 21h20" /></svg>
)}
function IconHealth(p) { return (
  <svg {...p} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.7"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.6l-1-1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 0 0 0-7.8Z" /><path d="M7 12h3l1-2 2 4 1-2h3" /></svg>
)}
function IconPlans(p) { return (
  <svg {...p} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.7"><path d="m12 3 2.2 4.5 5 .7-3.6 3.5.9 5-4.5-2.4-4.5 2.4.9-5-3.6-3.5 5-.7z" /></svg>
)}
function IconMenu(p) { return (
  <svg {...p} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.7"><path d="M4 6h16M4 12h16M4 18h16" /></svg>
)}
function IconDms(p) { return (
  <svg {...p} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.7"><ellipse cx="12" cy="5" rx="9" ry="3" /><path d="M3 5v6c0 1.7 4 3 9 3s9-1.3 9-3V5M3 11v6c0 1.7 4 3 9 3s9-1.3 9-3v-6" /></svg>
)}
function IconBuilding(p) { return (
  <svg {...p} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.7"><path d="M3 21h18M5 21V9l7-5 7 5v12M9 21v-7h6v7" /></svg>
)}
function IconFolder(p) { return (
  <svg {...p} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.7"><path d="M4 4h6l2 2h8v14H4z" /><path d="M8 11h8M8 15h5" /></svg>
)}



function IconBilling(p) { return (
  <svg {...p} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.7"><rect x="2" y="5" width="20" height="14" rx="2" /><path d="M2 10h20M6 15h2" /></svg>
)}
