import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Bell, CalendarClock, KeyRound, LogOut, ShieldCheck, UserRound } from 'lucide-react'
import AppShell from '../components/AppShell'
import { api } from '../utils/api'
import { authStore, useUser, initials, ROLE_LABELS } from '../utils/auth'
import { isOrgAdmin, isPlatformShell } from '../utils/permissions'
import { Skeleton } from '../components/Skeleton'
import { AlertBanner } from '../components/Alert'
import { CHIP_CLASS, formatDate, licenceChip } from '../lib/licensing'

// Shortcuts for Workflow Admin — matches what the org-admin shell is for.
const ADMIN_SHORTCUTS = [
  { to: '/admin', label: 'Users', hint: 'People & seats' },
  { to: '/departments', label: 'Departments', hint: 'Teams & routing' },
  { to: '/roles', label: 'Roles', hint: 'Permissions' },
  { to: '/settings', label: 'Organization', hint: 'Name & billing' },
  { to: '/forms', label: 'Forms', hint: 'Form library' },
  { to: '/workflows', label: 'Workflows', hint: 'Builder' },
  { to: '/analytics', label: 'Reports', hint: 'Analytics' },
  { to: '/audit-log', label: 'Audit log', hint: 'Change history' },
]

const toDateInput = (d) => {
  if (!d) return ''
  try { return new Date(d).toISOString().slice(0, 10) } catch { return '' }
}

// Tunable notification events (kept in sync with server/utils/notificationPrefs).
const NOTIFICATION_EVENTS = [
  { key: 'assignment', title: 'Task assigned to me' },
  { key: 'approval', title: 'My request was approved' },
  { key: 'rejection', title: 'My request was rejected' },
  { key: 'escalation', title: 'Task escalated to me' }
]

const defaultNotifPrefs = () =>
  NOTIFICATION_EVENTS.reduce((acc, e) => { acc[e.key] = { inApp: true, email: true }; return acc }, {})

// Merge stored prefs over defaults so legacy users (no field yet) show "both on".
const mergeNotifPrefs = (stored) => {
  const src = stored || {}
  return NOTIFICATION_EVENTS.reduce((acc, e) => {
    const p = src[e.key] || {}
    acc[e.key] = { inApp: p.inApp !== false, email: p.email !== false }
    return acc
  }, {})
}

const fieldCls =
  'mt-1 w-full rounded-lg border border-line bg-surface-2 px-3 py-2 text-sm text-fg focus:border-indigo-400 focus:bg-surface focus:outline-none focus:ring-2 focus:ring-indigo-200 transition'

function Card({ title, action, children, className = '', bodyClass = 'nf-profile-card-body' }) {
  const hasBody = children != null && children !== false
  return (
    <section className={`nf-profile-card ${className}`}>
      {(title || action) && (
        <header className={`nf-profile-card-header ${hasBody ? '' : 'is-compact'}`}>
          {title ? <h3>{title}</h3> : <span />}
          {action}
        </header>
      )}
      {hasBody && <div className={bodyClass}>{children}</div>}
    </section>
  )
}

function ProfileMetric({ icon: Icon, label, value, hint, tone = 'blue' }) {
  return (
    <article className={`nf-profile-metric nf-profile-tone-${tone}`}>
      <div className="nf-profile-metric-top">
        <p>{label}</p>
        <span><Icon aria-hidden="true" /></span>
      </div>
      <strong>{value}</strong>
      <small>{hint}</small>
    </article>
  )
}

function PersonTile({ person, empty, loading, tone = 'muted' }) {
  if (loading) return <Skeleton className="h-12 w-full rounded-lg" />
  if (!person) return <p className="nf-profile-empty-copy">{empty}</p>
  const avatar =
    tone === 'success'
      ? 'bg-success-subtle text-success-fg'
      : 'bg-surface-3 text-fg-muted'
  return (
    <div className="nf-profile-person">
      <div className={`nf-profile-person-avatar ${avatar}`}>
        {initials(person.name)}
      </div>
      <div className="nf-profile-person-copy">
        <p>{person.name}</p>
        <small>
          {person.email}
          {person.department ? ` · ${person.department}` : ''}
        </small>
      </div>
    </div>
  )
}

// Compact on/off switch used for each notification channel cell.
function ChannelToggle({ on, onClick, disabled, label }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      title={on ? 'On' : 'Off'}
      className={`nf-profile-switch nf-profile-switch-small ${on ? 'is-on' : ''}`}
    >
      <span />
    </button>
  )
}

function DetailRow({ label, value }) {
  return (
    <div className="nf-profile-detail-row">
      <dt>{label}</dt>
      <dd>
        {value || '—'}
      </dd>
    </div>
  )
}

function AdminWorkspaceCard({ org, loading }) {
  const licence = org?.licence
  const chip = licenceChip(licence)
  const licenceLabel = !licence
    ? '—'
    : licence.status === 'active'
      ? 'Active'
      : licence.status === 'grace'
        ? 'Grace period'
        : licence.status === 'suspended'
          ? 'Suspended'
          : 'Expired'
  const expiryHint = licence?.expiresAt
    ? `${licence.isTrial ? 'Trial ends' : 'Renews'} ${formatDate(licence.expiresAt)}`
    : licence
      ? 'Perpetual'
      : ''

  return (
    <Card
      title="Workspace"
      action={
        <Link to="/settings" className="text-xs font-semibold text-indigo-600 hover:text-indigo-700">
          Settings
        </Link>
      }
    >
      {loading && !org ? (
        <div className="space-y-2">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-4 w-36" />
        </div>
      ) : (
        <>
          <div className="mb-3">
            <p className="text-base font-semibold text-fg truncate">{org?.name || '—'}</p>
            {org?.subdomain && (
              <p className="text-xs text-fg-muted mt-0.5 truncate">{org.subdomain}</p>
            )}
          </div>
          <dl>
            <DetailRow
              label="Plan"
              value={licence?.planLabel || org?.plan || '—'}
            />
            <DetailRow
              label="Licence"
              value={
                <span className="inline-flex items-center gap-2">
                  {chip && (
                    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${CHIP_CLASS[chip.tone]}`}>
                      {chip.label}
                    </span>
                  )}
                  <span>{licenceLabel}{expiryHint ? ` · ${expiryHint}` : ''}</span>
                </span>
              }
            />
            <DetailRow label="Billing contact" value={org?.billingEmail} />
            <DetailRow
              label="Departments"
              value={org?.departments?.length != null ? String(org.departments.length) : '—'}
            />
          </dl>
        </>
      )}
    </Card>
  )
}

function AdminShortcutsCard() {
  return (
    <Card title="Manage">
      <ul className="grid grid-cols-2 sm:grid-cols-4 gap-1 -mx-1">
        {ADMIN_SHORTCUTS.map((item) => (
          <li key={item.to}>
            <Link
              to={item.to}
              className="flex flex-col px-3 py-2.5 rounded-lg hover:bg-surface-2 transition h-full"
            >
              <span className="text-sm font-medium text-fg">{item.label}</span>
              <span className="text-[11px] text-fg-muted">{item.hint}</span>
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  )
}

function Profile() {
  const navigate = useNavigate()
  const cached = useUser()
  const platform = isPlatformShell(cached)
  const orgAdmin = isOrgAdmin(cached)
  // Org admins design/configure the tenant — not the day-to-day approval loop.
  const showReportingLine = !platform && !orgAdmin
  const showTaskPrefs = !platform && !orgAdmin
  const showAdminTools = orgAdmin
  const [profile, setProfile] = useState(cached)
  const [reports, setReports] = useState([])
  const [org, setOrg] = useState(null)
  const [orgLoading, setOrgLoading] = useState(showAdminTools)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  // Out-of-office state (seeded from the loaded profile).
  const [ooo, setOoo] = useState({ enabled: false, from: '', until: '', note: '', delegateId: '' })
  const [oooSaving, setOooSaving] = useState(false)
  const [oooMsg, setOooMsg] = useState('')
  const [activeUsers, setActiveUsers] = useState([])

  const [notifPrefs, setNotifPrefs] = useState(defaultNotifPrefs)
  const [prefsSaving, setPrefsSaving] = useState(false)
  const [prefsMsg, setPrefsMsg] = useState('')

  // Two-factor (MFA) state.
  const [mfa, setMfa] = useState({ enabled: false, required: false })
  const [mfaStep, setMfaStep] = useState('idle')     // idle | setup | backup
  const [mfaSetup, setMfaSetup] = useState(null)     // { qr, manualKey }
  const [mfaCode, setMfaCode] = useState('')
  const [mfaBackup, setMfaBackup] = useState([])
  const [mfaMsg, setMfaMsg] = useState('')
  const [mfaBusy, setMfaBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    api.get('/api/users/me/profile')
      .then((data) => {
        if (cancelled) return
        setProfile(data.user)
        setReports(data.reports || [])
        const o = data.user?.outOfOffice || {}
        setOoo({
          enabled: !!o.enabled,
          from: toDateInput(o.from),
          until: toDateInput(o.until),
          note: o.note || '',
          delegateId: typeof o.delegateId === 'object' ? (o.delegateId?._id || '') : (o.delegateId || '')
        })
        setNotifPrefs(mergeNotifPrefs(data.user?.notificationPrefs))
      })
      .catch((e) => { if (!cancelled) setError(e.message || 'Failed to load profile') })
      .finally(() => { if (!cancelled) setLoading(false) })

    // Delegate picker for OOO — only roles that sit in the approval loop.
    if (showTaskPrefs) {
      api.get('/api/users?isActive=true&limit=1000')
        .then((data) => { if (!cancelled) setActiveUsers(data.users || []) })
        .catch((e) => console.error('Failed to load active users:', e))
    }

    if (showAdminTools) {
      api.get('/api/organization')
        .then((data) => { if (!cancelled) setOrg(data.organization || null) })
        .catch(() => { /* non-fatal — profile still works without org summary */ })
        .finally(() => { if (!cancelled) setOrgLoading(false) })
    }

    api.get('/api/auth/mfa/status')
      .then((data) => { if (!cancelled) setMfa({ enabled: !!data.enabled, required: !!data.required }) })
      .catch(() => { /* non-fatal */ })

    return () => { cancelled = true }
  }, [platform, showTaskPrefs, showAdminTools])

  const startMfaSetup = async () => {
    setMfaBusy(true); setMfaMsg('')
    try {
      const d = await api.post('/api/auth/mfa/setup', {})
      setMfaSetup(d)
      setMfaCode('')
      setMfaStep('setup')
    } catch (e) {
      setMfaMsg(e.message || 'Could not start setup')
    } finally {
      setMfaBusy(false)
    }
  }

  const confirmMfaEnable = async () => {
    if (!mfaCode.trim()) return setMfaMsg('Enter the 6-digit code from your app')
    setMfaBusy(true); setMfaMsg('')
    try {
      const d = await api.post('/api/auth/mfa/enable', { code: mfaCode.trim() })
      setMfaBackup(d.backupCodes || [])
      setMfa((p) => ({ ...p, enabled: true }))
      setMfaStep('backup')
    } catch (e) {
      setMfaMsg(e.message || 'Invalid code')
    } finally {
      setMfaBusy(false)
    }
  }

  const disableMfa = async () => {
    if (!mfaCode.trim()) return setMfaMsg('Enter a current code to confirm')
    setMfaBusy(true); setMfaMsg('')
    try {
      await api.post('/api/auth/mfa/disable', { code: mfaCode.trim() })
      setMfa((p) => ({ ...p, enabled: false }))
      setMfaStep('idle')
      setMfaCode('')
      setMfaMsg('Two-factor authentication disabled')
    } catch (e) {
      setMfaMsg(e.message || 'Invalid code')
    } finally {
      setMfaBusy(false)
    }
  }

  const cancelMfa = () => {
    setMfaStep('idle'); setMfaSetup(null); setMfaCode(''); setMfaMsg(''); setMfaBackup([])
  }

  const user = profile || cached
  const roleName = user?.role?.name
  const roleLabel = roleName ? (ROLE_LABELS[roleName] || roleName) : '—'
  const manager = user?.managerId && typeof user.managerId === 'object' ? user.managerId : null
  const hr = user?.hrId && typeof user.hrId === 'object' ? user.hrId : null

  const saveOoo = async (next = ooo) => {
    setOooSaving(true)
    setOooMsg('')
    try {
      const data = await api.put('/api/users/me/out-of-office', {
        enabled: next.enabled,
        from: next.from || null,
        until: next.until || null,
        note: next.note || null,
        delegateId: next.delegateId || null
      })
      setProfile(data.user)
      setOooMsg('Saved')
      setTimeout(() => setOooMsg(''), 2500)
    } catch (e) {
      setOooMsg(e.message || 'Could not save')
    } finally {
      setOooSaving(false)
    }
  }

  const toggleOoo = () => {
    const next = { ...ooo, enabled: !ooo.enabled }
    setOoo(next)
    saveOoo(next)
  }

  const toggleNotif = async (key, channel) => {
    const prev = notifPrefs
    const next = {
      ...notifPrefs,
      [key]: { ...notifPrefs[key], [channel]: !notifPrefs[key][channel] }
    }
    setNotifPrefs(next)
    setPrefsSaving(true)
    setPrefsMsg('')
    try {
      const data = await api.put('/api/users/me/notification-prefs', { notificationPrefs: next })
      if (data.user?.notificationPrefs) setNotifPrefs(mergeNotifPrefs(data.user.notificationPrefs))
      setPrefsMsg('Saved')
      setTimeout(() => setPrefsMsg(''), 2000)
    } catch (e) {
      setNotifPrefs(prev)
      setPrefsMsg(e.message || 'Could not save')
    } finally {
      setPrefsSaving(false)
    }
  }

  const joined = user?.createdAt
    ? new Date(user.createdAt).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })
    : null
  const lastLogin = user?.lastLogin
    ? new Date(user.lastLogin).toLocaleString()
    : null

  const accountActive = user?.isActive !== false
  const twoCol = showTaskPrefs || showReportingLine || showAdminTools
  const notificationChannelTotal = NOTIFICATION_EVENTS.length * 2
  const notificationChannelsOn = Object.values(notifPrefs).reduce((count, preference) => (
    count + (preference.inApp ? 1 : 0) + (preference.email ? 1 : 0)
  ), 0)
  const mfaLabel = mfa.enabled ? 'Enabled' : mfa.required ? 'Required' : 'Not enabled'

  return (
    <AppShell
      title="My profile"
      subtitle="Manage your account, security, availability, and notification preferences."
      actions={
        <div className="nf-profile-header-actions">
          <button
            type="button"
            onClick={() => authStore.logout(true).then(() => navigate('/login'))}
            className="nf-button nf-button-danger"
          >
            <LogOut aria-hidden="true" />
            Sign out of all devices
          </button>
          <Link
            to="/change-password"
            className="nf-button"
          >
            <KeyRound aria-hidden="true" />
            Change password
          </Link>
        </div>
      }
      mainClass="flex-1 p-4 md:p-6 pb-24 md:pb-6 overflow-y-auto"
    >
      <div className="nf-profile-page">
        {error && <AlertBanner>{error}</AlertBanner>}

        <section className="nf-profile-identity" aria-label="Profile summary">
          <div className="nf-profile-avatar">{initials(user?.name)}</div>
          <div className="nf-profile-identity-copy">
            <h2>{user?.name || 'Guest'}</h2>
            <p>{user?.email || (loading ? 'Loading account…' : 'No email address')}</p>
            <div className="nf-profile-badges">
              <span className="nf-profile-badge info">{roleLabel}</span>
              {user?.canBuild && <span className="nf-profile-badge purple">Builder</span>}
              {!platform && user?.department && <span className="nf-profile-badge neutral">{user.department}</span>}
              <span className={`nf-profile-badge ${accountActive ? 'success' : 'danger'}`}>
                {accountActive ? 'Active' : 'Inactive'}
              </span>
            </div>
          </div>
          <dl className="nf-profile-identity-facts">
            <div><dt>Member since</dt><dd>{joined || (loading ? '…' : '—')}</dd></div>
            <div><dt>Last login</dt><dd>{lastLogin || (loading ? '…' : 'Never')}</dd></div>
          </dl>
        </section>

        <section className="nf-profile-metrics" aria-label="Profile status overview">
          <ProfileMetric
            icon={UserRound}
            label="Account"
            value={loading ? 'Loading…' : accountActive ? 'Active' : 'Inactive'}
            hint="Workspace access"
            tone={accountActive ? 'blue' : 'coral'}
          />
          <ProfileMetric
            icon={ShieldCheck}
            label="Security"
            value={mfaLabel}
            hint={mfa.required ? 'Required by policy' : 'Two-factor authentication'}
            tone={mfa.enabled ? 'teal' : 'amber'}
          />
          {showTaskPrefs && (
            <ProfileMetric
              icon={Bell}
              label="Notifications"
              value={`${notificationChannelsOn} of ${notificationChannelTotal}`}
              hint="Channels enabled"
              tone="purple"
            />
          )}
          {showTaskPrefs && (
            <ProfileMetric
              icon={CalendarClock}
              label="Availability"
              value={ooo.enabled ? 'Out of office' : 'Available'}
              hint="Request routing"
              tone={ooo.enabled ? 'amber' : 'teal'}
            />
          )}
        </section>

        <div className={`nf-profile-layout ${twoCol ? '' : 'is-single'}`}>
          <div className="nf-profile-main-column">

            <Card
              title="Account security"
              className="nf-profile-security-card"
              action={
                mfa.enabled ? (
                  <span className="nf-profile-badge success">MFA on</span>
                ) : mfaStep === 'idle' ? (
                  <button type="button" onClick={startMfaSetup} disabled={mfaBusy} className="nf-button nf-button-primary nf-profile-compact-button">
                    <ShieldCheck aria-hidden="true" />
                    {mfaBusy ? 'Starting…' : 'Enable MFA'}
                  </button>
                ) : null
              }
            >
              <div className="nf-profile-section-intro">
                <span className="nf-profile-section-icon"><ShieldCheck aria-hidden="true" /></span>
                <div>
                  <strong>Two-factor authentication</strong>
                  <p>Add an authentication app as a second verification step when you sign in.</p>
                </div>
              </div>

              {mfaMsg && <p className="nf-profile-inline-message" role="status">{mfaMsg}</p>}

              {mfaStep === 'setup' && (
                <div className="nf-profile-mfa-setup">
                  {mfaSetup?.qr && (
                    <div className="nf-profile-mfa-qr">
                      <img src={mfaSetup.qr} alt="MFA QR code" />
                      <code>{mfaSetup.manualKey}</code>
                    </div>
                  )}
                  <div className="nf-profile-mfa-form">
                    <p>Scan the QR code with your authentication app, then enter its six-digit code.</p>
                    <label className="nf-profile-field-label">
                      Authentication code
                      <input
                        inputMode="numeric"
                        autoComplete="one-time-code"
                        value={mfaCode}
                        onChange={(event) => { setMfaCode(event.target.value); setMfaMsg('') }}
                        placeholder="6-digit code"
                        className={`${fieldCls} text-center tracking-widest`}
                      />
                    </label>
                    <div className="nf-profile-form-actions">
                      <button type="button" onClick={confirmMfaEnable} disabled={mfaBusy} className="nf-button nf-button-primary">
                        {mfaBusy ? 'Verifying…' : 'Verify & enable'}
                      </button>
                      <button type="button" onClick={cancelMfa} className="nf-button">Cancel</button>
                    </div>
                  </div>
                </div>
              )}

              {mfaStep === 'backup' && (
                <div className="nf-profile-backup">
                  <p>Save these backup codes somewhere secure. Each code can only be used once.</p>
                  <div className="nf-profile-backup-codes">
                    {mfaBackup.map((code) => <code key={code}>{code}</code>)}
                  </div>
                  <button type="button" onClick={cancelMfa} className="nf-button nf-button-primary">Done</button>
                </div>
              )}

              {mfaStep === 'idle' && mfa.enabled && (
                <div className="nf-profile-mfa-form">
                  <p>Two-factor authentication is protecting your account. Enter a current code to disable it.</p>
                  <label className="nf-profile-field-label">
                    Current authentication code
                    <input
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      value={mfaCode}
                      onChange={(event) => { setMfaCode(event.target.value); setMfaMsg('') }}
                      placeholder="6-digit code"
                      className={`${fieldCls} text-center tracking-widest`}
                    />
                  </label>
                  <button type="button" onClick={disableMfa} disabled={mfaBusy} className="nf-button nf-button-danger">
                    {mfaBusy ? 'Disabling…' : 'Disable two-factor authentication'}
                  </button>
                </div>
              )}
            </Card>

            {showAdminTools && <AdminShortcutsCard />}

            {showTaskPrefs && (
              <Card
                title="Out of office"
                className="nf-profile-ooo-card"
                action={
                  <button
                    type="button"
                    role="switch"
                    aria-checked={ooo.enabled}
                    onClick={toggleOoo}
                    disabled={oooSaving}
                    title={ooo.enabled ? 'Turn off' : 'Turn on'}
                    aria-label="Out of office"
                    className={`nf-profile-switch ${ooo.enabled ? 'is-on' : ''}`}
                  >
                    <span />
                  </button>
                }
              >
                {ooo.enabled ? (
                  <div className="nf-profile-form-stack">
                    <p className="nf-profile-section-description">Set your dates and delegate so assigned approvals can continue while you are away.</p>
                    <div className="nf-profile-form-grid">
                      <label className="nf-profile-field-label">
                        From
                        <input type="date" value={ooo.from}
                          onChange={(e) => setOoo((p) => ({ ...p, from: e.target.value }))}
                          className={fieldCls} />
                      </label>
                      <label className="nf-profile-field-label">
                        Until
                        <input type="date" value={ooo.until}
                          onChange={(e) => setOoo((p) => ({ ...p, until: e.target.value }))}
                          className={fieldCls} />
                      </label>
                    </div>
                    <label className="nf-profile-field-label">
                      Note
                      <input type="text" value={ooo.note}
                        onChange={(e) => setOoo((p) => ({ ...p, note: e.target.value }))}
                        placeholder="Optional"
                        className={fieldCls} />
                    </label>
                    <label className="nf-profile-field-label">
                      Delegate
                      <select value={ooo.delegateId}
                        onChange={(e) => setOoo((p) => ({ ...p, delegateId: e.target.value }))}
                        className={fieldCls}>
                        <option value="">Select…</option>
                        {activeUsers.filter((u) => u._id !== user?._id).map((u) => (
                          <option key={u._id} value={u._id}>{u.name}</option>
                        ))}
                      </select>
                    </label>
                    {!ooo.delegateId && (
                      <p className="nf-profile-warning">Select a delegate so approvals can be redirected.</p>
                    )}
                    <div className="nf-profile-form-actions">
                      <button type="button" onClick={() => saveOoo()} disabled={oooSaving}
                        className="nf-button nf-button-primary">
                        {oooSaving ? 'Saving…' : 'Save availability'}
                      </button>
                      {oooMsg && <span className="nf-profile-inline-message" role="status">{oooMsg}</span>}
                    </div>
                  </div>
                ) : oooMsg ? (
                  <p className="nf-profile-inline-message" role="status">{oooMsg}</p>
                ) : null}
              </Card>
            )}
          </div>

          {(showTaskPrefs || showReportingLine || showAdminTools) && (
            <aside className="nf-profile-side-column">
              {showAdminTools && (
                <AdminWorkspaceCard org={org} loading={orgLoading} />
              )}

              {showTaskPrefs && (
                <Card
                  title="Notifications"
                  className="nf-profile-notifications-card"
                  action={prefsMsg ? <span className="nf-profile-inline-message" role="status">{prefsMsg}</span> : null}
                >
                  <div className="nf-profile-notification-head" aria-hidden="true">
                    <div>Event</div>
                    <div>In-app</div>
                    <div>Email</div>
                  </div>
                  <div className="nf-profile-notification-list">
                    {NOTIFICATION_EVENTS.map((ev) => (
                      <div key={ev.key} className="nf-profile-notification-row">
                        <p>{ev.title}</p>
                        <div>
                          <ChannelToggle
                            on={notifPrefs[ev.key].inApp}
                            disabled={prefsSaving || loading}
                            onClick={() => toggleNotif(ev.key, 'inApp')}
                            label={`In-app: ${ev.title}`}
                          />
                        </div>
                        <div>
                          <ChannelToggle
                            on={notifPrefs[ev.key].email}
                            disabled={prefsSaving || loading}
                            onClick={() => toggleNotif(ev.key, 'email')}
                            label={`Email: ${ev.title}`}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </Card>
              )}

              {showReportingLine && (
                <>
                  <Card title="Manager">
                    <PersonTile person={manager} loading={loading} empty="Not assigned" />
                  </Card>

                  <Card title="HR partner">
                    <PersonTile person={hr} loading={loading} tone="success" empty="Not assigned" />
                  </Card>

                  <Card
                    title="Reports"
                    action={
                      reports.length > 0 ? (
                        <span className="nf-profile-count">{reports.length}</span>
                      ) : null
                    }
                  >
                    {reports.length === 0 ? (
                      <p className="nf-profile-empty-copy">{loading ? 'Loading…' : 'None'}</p>
                    ) : (
                      <ul className="nf-profile-reports">
                        {reports.map((r) => (
                          <li key={r._id}>
                            <div className="nf-profile-report-avatar">
                              {initials(r.name)}
                            </div>
                            <div className="nf-profile-report-copy">
                              <p>{r.name}</p>
                              <small>{r.email}</small>
                            </div>
                            {r.role?.name && (
                              <span className="nf-profile-badge neutral">
                                {ROLE_LABELS[r.role.name] || r.role.name}
                              </span>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                  </Card>
                </>
              )}
            </aside>
          )}
        </div>
      </div>
    </AppShell>
  )
}

export default Profile
