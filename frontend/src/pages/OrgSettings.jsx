import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Activity,
  AlertTriangle,
  Building2,
  CheckCircle2,
  Database,
  FileScan,
  Globe2,
  KeyRound,
  LockKeyhole,
  Save,
  ShieldCheck,
  UsersRound,
  X
} from 'lucide-react'
import AppShell from '../components/AppShell'
import EmptyState from '../components/EmptyState'
import { AlertBanner } from '../components/Alert'
import { Skeleton } from '../components/Skeleton'
import { api } from '../utils/api'
import { useUser } from '../utils/auth'
import { toast } from '../lib/toastStore'
import { formatDate, formatDateTime } from '../utils/datetime'
import { useReadOnly } from '../lib/usageStore'

const DEFAULT_PDF_AUTO_FILL = {
  enabled: true,
  languageMode: 'english',
  audiences: { authenticated: true, public: false }
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const pdfSettingsFrom = (org) => ({
  enabled: org?.pdfAutoFill?.enabled !== false,
  languageMode: org?.pdfAutoFill?.languageMode || 'english',
  audiences: {
    authenticated: org?.pdfAutoFill?.audiences?.authenticated !== false,
    public: org?.pdfAutoFill?.audiences?.public === true
  }
})

const formatSize = (bytes) => {
  const safe = Number(bytes) || 0
  if (safe >= 1024 ** 3) return `${(safe / (1024 ** 3)).toFixed(1)} GB`
  if (safe >= 1024 ** 2) return `${(safe / (1024 ** 2)).toFixed(1)} MB`
  if (safe >= 1024) return `${(safe / 1024).toFixed(1)} KB`
  return `${safe} B`
}

const initialsFor = (name) => (name || 'System')
  .split(/\s+/)
  .filter(Boolean)
  .map((part) => part[0])
  .join('')
  .slice(0, 2)
  .toUpperCase()

const titleCaseAction = (action) => (action || 'Activity recorded')
  .replace(/_/g, ' ')
  .replace(/\b\w/g, (letter) => letter.toUpperCase())

const sectionFromHash = () => {
  if (typeof window === 'undefined') return 'settings-profile'
  return window.location.hash.replace(/^#/, '') || 'settings-profile'
}

function MetricCard({ icon: Icon, label, value, detail, tone = 'blue', action }) {
  return (
    <article className={`nf-settings-metric is-${tone}`}>
      <div className="nf-settings-metric-icon" aria-hidden="true"><Icon size={19} /></div>
      <div className="nf-settings-metric-copy">
        <p>{label}</p>
        <strong>{value}</strong>
        <span>{detail}</span>
      </div>
      {action && <div className="nf-settings-metric-action">{action}</div>}
    </article>
  )
}

function SettingsSection({ id, tabId, icon: Icon, eyebrow, title, description, action, children }) {
  return (
    <section
      id={id}
      className="nf-settings-section"
      role="tabpanel"
      tabIndex="-1"
      aria-labelledby={tabId || `${id}-title`}
    >
      <header className="nf-settings-section-header">
        <div className="nf-settings-section-heading">
          <span className="nf-settings-section-icon" aria-hidden="true"><Icon size={18} /></span>
          <div>
            {eyebrow && <p>{eyebrow}</p>}
            <h2 id={`${id}-title`}>{title}</h2>
            {description && <span>{description}</span>}
          </div>
        </div>
        {action && <div>{action}</div>}
      </header>
      <div className="nf-settings-section-body">{children}</div>
    </section>
  )
}

function ManagedTile({ label, value, detail, icon: Icon, tone = 'blue', children }) {
  return (
    <article className="nf-settings-managed-tile">
      <div className={`nf-settings-managed-icon is-${tone}`} aria-hidden="true"><Icon size={17} /></div>
      <div className="nf-settings-managed-copy">
        <p>{label}</p>
        <strong>{value}</strong>
        {detail && <span>{detail}</span>}
        {children}
      </div>
      <span className="nf-settings-managed-label"><LockKeyhole size={11} /> Managed</span>
    </article>
  )
}

function SettingsSkeleton() {
  return (
    <div className="nf-settings-page" aria-busy="true" aria-label="Loading organization settings">
      <div className="nf-settings-metrics">
        {[0, 1, 2, 3].map((item) => (
          <div className="nf-settings-metric" key={item}>
            <Skeleton className="h-11 w-11 rounded-xl" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-5 w-32" />
              <Skeleton className="h-3 w-28" />
            </div>
          </div>
        ))}
      </div>
      <div className="nf-settings-layout">
        <Skeleton className="h-64 rounded-xl" />
        <div className="space-y-4">
          <Skeleton className="h-72 rounded-xl" />
          <Skeleton className="h-64 rounded-xl" />
        </div>
      </div>
    </div>
  )
}

export default function OrgSettings() {
  const user = useUser()
  const readOnly = useReadOnly()
  const [org, setOrg] = useState(null)
  const [name, setName] = useState('')
  const [billingEmail, setBillingEmail] = useState('')
  const [pdfAutoFill, setPdfAutoFill] = useState(DEFAULT_PDF_AUTO_FILL)
  const [dmsStatus, setDmsStatus] = useState(null)
  const [recentActivity, setRecentActivity] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [pageError, setPageError] = useState('')
  const [dmsError, setDmsError] = useState('')
  const [activityError, setActivityError] = useState('')
  const [activeSection, setActiveSection] = useState(sectionFromHash)

  const applyOrganization = useCallback((organization) => {
    setOrg(organization)
    setName(organization?.name || '')
    setBillingEmail(organization?.billingEmail || '')
    setPdfAutoFill(pdfSettingsFrom(organization))
  }, [])

  const loadAll = useCallback(async () => {
    setLoading(true)
    setPageError('')
    setDmsError('')
    setActivityError('')
    const [orgResult, dmsResult, auditResult] = await Promise.allSettled([
      api.get('/api/organization'),
      api.get('/api/organization/dms-status'),
      api.get('/api/audit-logs?limit=5')
    ])

    if (orgResult.status === 'fulfilled') {
      applyOrganization(orgResult.value.organization)
    } else {
      setPageError(orgResult.reason?.message || 'Organization settings could not be loaded.')
    }

    if (dmsResult.status === 'fulfilled') {
      setDmsStatus(dmsResult.value)
    } else {
      setDmsStatus(null)
      setDmsError(dmsResult.reason?.message || 'Document storage status is unavailable.')
    }

    if (auditResult.status === 'fulfilled') {
      setRecentActivity(auditResult.value.logs || [])
    } else {
      setRecentActivity([])
      setActivityError(auditResult.reason?.message || 'Recent activity is unavailable.')
    }
    setLoading(false)
  }, [applyOrganization])

  useEffect(() => {
    const timer = window.setTimeout(loadAll, 0)
    return () => window.clearTimeout(timer)
  }, [loadAll])

  const profileDirty = Boolean(org) && (
    name.trim() !== (org.name || '') ||
    billingEmail.trim().toLowerCase() !== (org.billingEmail || '')
  )
  const pdfDirty = Boolean(org) &&
    JSON.stringify(pdfAutoFill) !== JSON.stringify(pdfSettingsFrom(org))
  const dirty = profileDirty || pdfDirty
  const emailInvalid = Boolean(billingEmail.trim()) && !EMAIL_RE.test(billingEmail.trim())
  const audienceInvalid = pdfAutoFill.enabled &&
    !pdfAutoFill.audiences.authenticated &&
    !pdfAutoFill.audiences.public

  const discardChanges = () => {
    if (org) applyOrganization(org)
  }

  const handleSaveAll = async () => {
    if (!dirty || saving || readOnly) return
    if (!name.trim()) {
      toast.error('Workspace name is required.')
      return
    }
    if (emailInvalid) {
      toast.error('Enter a valid billing email address.')
      return
    }
    if (audienceInvalid) {
      toast.error('Select at least one audience before enabling PDF auto-fill.')
      return
    }
    setSaving(true)
    try {
      const data = await api.put('/api/organization', {
        name: name.trim(),
        billingEmail: billingEmail.trim().toLowerCase(),
        pdfAutoFill
      })
      applyOrganization(data.organization)
      toast.success('Organization settings saved')
    } catch (error) {
      toast.error(error.message || 'Could not save the settings')
    } finally {
      setSaving(false)
    }
  }

  const licence = org?.licence
  const domainCount = org?.allowedDomains?.length || 0
  const departmentCount = org?.departments?.length || 0
  const storage = dmsStatus?.storage
  const usedBytes = Number(storage?.usedBytes) || 0
  const limitBytes = storage?.limitMb != null ? Number(storage.limitMb) * 1024 * 1024 : null
  const storagePercent = limitBytes > 0
    ? Math.min(100, Math.round((usedBytes / limitBytes) * 100))
    : null
  const sectionLinks = useMemo(() => [
    ['settings-profile', 'Profile'],
    ['settings-access', 'Access & security'],
    ['settings-pdf', 'PDF Auto-Fill'],
    ...(user?.dmsEnabled !== false ? [['settings-storage', 'Document storage']] : []),
    ['settings-activity', 'Activity']
  ], [user?.dmsEnabled])
  const resolvedActiveSection = sectionLinks.some(([id]) => id === activeSection)
    ? activeSection
    : sectionLinks[0][0]

  useEffect(() => {
    const syncFromUrl = () => setActiveSection(sectionFromHash())
    window.addEventListener('hashchange', syncFromUrl)
    window.addEventListener('popstate', syncFromUrl)
    return () => {
      window.removeEventListener('hashchange', syncFromUrl)
      window.removeEventListener('popstate', syncFromUrl)
    }
  }, [])

  const selectSection = (id, { focusPanel = false } = {}) => {
    setActiveSection(id)
    if (window.location.hash !== `#${id}`) {
      window.history.pushState(null, '', `#${id}`)
    }
    if (focusPanel) {
      window.requestAnimationFrame(() => document.getElementById(id)?.focus())
    }
  }

  const handleSectionKeyDown = (event, index) => {
    let nextIndex = null
    if (event.key === 'ArrowDown' || event.key === 'ArrowRight') nextIndex = (index + 1) % sectionLinks.length
    if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') nextIndex = (index - 1 + sectionLinks.length) % sectionLinks.length
    if (event.key === 'Home') nextIndex = 0
    if (event.key === 'End') nextIndex = sectionLinks.length - 1
    if (nextIndex == null) return
    event.preventDefault()
    const nextId = sectionLinks[nextIndex][0]
    selectSection(nextId)
    document.getElementById(`settings-tab-${nextId}`)?.focus()
  }

  const toggleAudience = (key, checked) => {
    setPdfAutoFill((current) => ({
      ...current,
      audiences: { ...current.audiences, [key]: checked }
    }))
  }

  return (
    <AppShell
      title="Organization settings"
      subtitle="Manage workspace preferences, access policies, and connected services."
      actions={(
        <button
          type="button"
          onClick={handleSaveAll}
          disabled={!dirty || saving || readOnly || emailInvalid || audienceInvalid}
          className="nf-button nf-button-primary"
        >
          <Save size={16} aria-hidden="true" />
          {saving ? 'Saving…' : 'Save all changes'}
        </button>
      )}
      mainClass="flex-1 overflow-y-auto p-4 pb-28 md:p-6 md:pb-10"
    >
      {loading ? (
        <SettingsSkeleton />
      ) : pageError || !org ? (
        <div className="nf-settings-page">
          <AlertBanner tone="error" onRetry={loadAll}>
            <strong>Organization settings are unavailable.</strong>
            <span className="block mt-1">{pageError || 'No organization data was returned.'}</span>
          </AlertBanner>
        </div>
      ) : (
        <div className="nf-settings-page">
          {readOnly && (
            <AlertBanner tone="warning">
              This workspace is read-only because its licence has expired. Settings remain visible, but changes cannot be saved.
            </AlertBanner>
          )}

          <section className="nf-settings-metrics" aria-label="Organization overview">
            <MetricCard
              icon={Database}
              label="Plan"
              value={licence?.planLabel || org.plan || 'Free'}
              detail="Managed by the platform team"
              tone="blue"
            />
            <MetricCard
              icon={ShieldCheck}
              label="Licence"
              value={licence?.status === 'active' ? 'Active' : licence?.status || 'Unknown'}
              detail={licence?.expiresAt ? `Renews ${formatDate(licence.expiresAt)}` : 'No expiry date'}
              tone={licence?.status === 'active' ? 'green' : 'amber'}
            />
            <MetricCard
              icon={Globe2}
              label="Sign-in policy"
              value={domainCount ? `${domainCount} allowed` : 'Unrestricted'}
              detail={domainCount ? 'Approved email domains' : 'Any email domain can sign in'}
              tone="violet"
            />
            <MetricCard
              icon={KeyRound}
              label="Admin security"
              value={user?.mfaEnabled ? 'MFA active' : 'MFA disabled'}
              detail={user?.mfaEnabled ? 'Authenticator protection enabled' : 'Additional protection recommended'}
              tone={user?.mfaEnabled ? 'green' : 'amber'}
              action={(
                <Link to="/profile" className="nf-settings-inline-link">
                  {user?.mfaEnabled ? 'Manage' : 'Enable'}
                </Link>
              )}
            />
          </section>

          <div className="nf-settings-layout">
            <nav className="nf-settings-nav" aria-label="Settings sections">
              <div className="nf-settings-nav-heading">
                <span>Settings</span>
                <small>Organization admin</small>
              </div>
              <div className="nf-settings-nav-links" role="tablist" aria-label="Organization settings">
                {sectionLinks.map(([id, label], index) => (
                  <button
                    key={id}
                    id={`settings-tab-${id}`}
                    type="button"
                    role="tab"
                    aria-selected={resolvedActiveSection === id}
                    aria-controls={id}
                    tabIndex={resolvedActiveSection === id ? 0 : -1}
                    className={resolvedActiveSection === id ? 'is-primary' : ''}
                    onClick={() => selectSection(id)}
                    onKeyDown={(event) => handleSectionKeyDown(event, index)}
                  >
                    <span aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>
                    {label}
                  </button>
                ))}
              </div>
              <div className="nf-settings-nav-note">
                <LockKeyhole size={14} aria-hidden="true" />
                <p><strong>Platform managed</strong><span>Locked policies are visible for clarity.</span></p>
              </div>
            </nav>

            <div className="nf-settings-content">
              {resolvedActiveSection === 'settings-profile' && (
                <SettingsSection
                  id="settings-profile"
                  tabId="settings-tab-settings-profile"
                  icon={Building2}
                  eyebrow="Workspace identity"
                  title="Organization profile"
                  description="Details shown throughout your workspace and on operational messages."
                >
                <div className="nf-settings-form-grid">
                  <label className="nf-settings-field" htmlFor="workspace-name">
                    <span>Workspace name</span>
                    <input
                      id="workspace-name"
                      value={name}
                      maxLength={80}
                      disabled={readOnly}
                      onChange={(event) => setName(event.target.value)}
                      aria-invalid={!name.trim()}
                    />
                    <small>Used in navigation, emails, and generated documents.</small>
                  </label>
                  <label className="nf-settings-field" htmlFor="billing-email">
                    <span>Billing contact</span>
                    <input
                      id="billing-email"
                      type="email"
                      value={billingEmail}
                      disabled={readOnly}
                      onChange={(event) => setBillingEmail(event.target.value)}
                      aria-invalid={emailInvalid}
                      aria-describedby={emailInvalid ? 'billing-email-error' : 'billing-email-help'}
                      placeholder="billing@company.com"
                    />
                    <small id={emailInvalid ? 'billing-email-error' : 'billing-email-help'} className={emailInvalid ? 'is-error' : ''}>
                      {emailInvalid ? 'Enter a valid email address.' : 'Receives renewal and usage notifications.'}
                    </small>
                  </label>
                  <div className="nf-settings-field is-wide">
                    <span>Workspace address</span>
                    <div className="nf-settings-locked-value">
                      <code>{org.subdomain || 'Not configured'}</code>
                      <span><LockKeyhole size={12} /> Locked</span>
                    </div>
                    <small>Contact the platform team to change this permanent workspace identifier.</small>
                  </div>
                </div>
                </SettingsSection>
              )}

              {resolvedActiveSection === 'settings-access' && (
                <SettingsSection
                  id="settings-access"
                  tabId="settings-tab-settings-access"
                  icon={ShieldCheck}
                  eyebrow="Governance"
                  title="Access & security"
                  description="Review the organization policies enforced by the platform team."
                  action={<span className="nf-settings-readonly-pill"><LockKeyhole size={12} /> Read-only</span>}
                >
                <div className="nf-settings-managed-grid">
                  <ManagedTile
                    icon={Database}
                    label="Plan & licence"
                    value={licence?.planLabel || org.plan || 'Free'}
                    detail={licence?.expiresAt ? `${licence?.status || 'Unknown'} · ${formatDate(licence.expiresAt)}` : licence?.status || 'No expiry'}
                    tone="blue"
                  />
                  <ManagedTile
                    icon={Globe2}
                    label="Allowed sign-in domains"
                    value={domainCount ? `${domainCount} configured` : 'Unrestricted'}
                    detail={domainCount ? org.allowedDomains.map((domain) => `@${domain}`).join(', ') : 'No domain restrictions'}
                    tone="violet"
                  />
                  <ManagedTile
                    icon={UsersRound}
                    label="External Domain"
                    value={org.features?.externalUsers ? 'Allowed' : 'Not allowed'}
                    detail="Controls access outside approved domains"
                    tone={org.features?.externalUsers ? 'green' : 'amber'}
                  />
                  <ManagedTile
                    icon={Building2}
                    label="Departments"
                    value={`${departmentCount} ${departmentCount === 1 ? 'team' : 'teams'}`}
                    detail="Organization structure available to access rules"
                    tone="green"
                  />
                </div>
                <div className="nf-settings-security-callout">
                  <div>
                    <KeyRound size={18} aria-hidden="true" />
                    <p>
                      <strong>Administrator MFA</strong>
                      <span>{user?.mfaEnabled ? 'Multi-factor authentication is active for your account.' : 'Enable MFA to add another layer of account protection.'}</span>
                    </p>
                  </div>
                  <Link to="/profile" className="nf-button">
                    {user?.mfaEnabled ? 'Manage MFA' : 'Enable MFA'}
                  </Link>
                </div>
                </SettingsSection>
              )}

              {resolvedActiveSection === 'settings-pdf' && (
                <SettingsSection
                  id="settings-pdf"
                  tabId="settings-tab-settings-pdf"
                  icon={FileScan}
                  eyebrow="Document intelligence"
                  title="PDF Auto-Fill"
                  description="Configure OCR-assisted field extraction for eligible forms."
                  action={(
                    <label className="nf-settings-switch">
                    <span>{pdfAutoFill.enabled ? 'Enabled' : 'Disabled'}</span>
                    <input
                      type="checkbox"
                      role="switch"
                      aria-label="Enable PDF Auto-Fill"
                      checked={pdfAutoFill.enabled}
                      disabled={readOnly}
                      onChange={(event) => setPdfAutoFill((current) => ({ ...current, enabled: event.target.checked }))}
                    />
                    <i aria-hidden="true" />
                    </label>
                  )}
                >
                <div className="nf-settings-status-row">
                  <span className={org.pdfAutoFill?.entitled ? 'is-success' : 'is-warning'}>
                    {org.pdfAutoFill?.entitled ? <CheckCircle2 size={13} /> : <AlertTriangle size={13} />}
                    {org.pdfAutoFill?.entitled ? 'Included in plan' : 'Not included in plan'}
                  </span>
                  <span className={org.pdfAutoFill?.operational ? 'is-success' : 'is-neutral'}>
                    {org.pdfAutoFill?.operational ? <CheckCircle2 size={13} /> : <AlertTriangle size={13} />}
                    {org.pdfAutoFill?.operational ? 'Service ready' : 'Service unavailable'}
                  </span>
                </div>

                {!org.pdfAutoFill?.entitled && (
                  <AlertBanner tone="warning">
                    Your preferences will be saved, but processing remains suspended until plan entitlement is restored.
                  </AlertBanner>
                )}
                {!org.pdfAutoFill?.operational && (
                  <AlertBanner tone="info">
                    The OCR runtime is unavailable. Saved preferences will take effect when the platform service is restored.
                  </AlertBanner>
                )}

                <div className="nf-settings-policy-grid">
                  <fieldset disabled={readOnly}>
                    <legend>OCR language</legend>
                    <label className="nf-settings-choice is-selected">
                      <input
                        type="radio"
                        name="pdf-language"
                        value="english"
                        checked={pdfAutoFill.languageMode === 'english'}
                        onChange={() => setPdfAutoFill((current) => ({ ...current, languageMode: 'english' }))}
                      />
                      <span><strong>English</strong><small>Official PP-OCRv6 medium model</small></span>
                    </label>
                  </fieldset>

                  <fieldset disabled={readOnly}>
                    <legend>Respondent access</legend>
                    <div className="nf-settings-choice-stack">
                      <label className={pdfAutoFill.audiences.authenticated ? 'nf-settings-choice is-selected' : 'nf-settings-choice'}>
                        <input
                          type="checkbox"
                          checked={pdfAutoFill.audiences.authenticated}
                          onChange={(event) => toggleAudience('authenticated', event.target.checked)}
                        />
                        <span><strong>Logged-in users</strong><small>Authenticated NetFlow forms</small></span>
                      </label>
                      <label className={pdfAutoFill.audiences.public ? 'nf-settings-choice is-selected' : 'nf-settings-choice'}>
                        <input
                          type="checkbox"
                          checked={pdfAutoFill.audiences.public}
                          onChange={(event) => toggleAudience('public', event.target.checked)}
                        />
                        <span><strong>Public forms</strong><small>Anyone with a public form link</small></span>
                      </label>
                    </div>
                    {audienceInvalid && <p className="nf-settings-field-error">Select at least one audience before saving.</p>}
                  </fieldset>
                </div>
                </SettingsSection>
              )}

              {resolvedActiveSection === 'settings-storage' && user?.dmsEnabled !== false && (
                <SettingsSection
                  id="settings-storage"
                  tabId="settings-tab-settings-storage"
                  icon={Database}
                  eyebrow="Integration"
                  title="Document storage"
                  description="Live connection and usage information from your configured DMS."
                  action={dmsStatus && (
                    <span className={`nf-settings-connection ${dmsStatus.connected ? 'is-connected' : 'is-disconnected'}`}>
                      <i aria-hidden="true" />
                      {dmsStatus.connected ? 'Connected' : dmsStatus.effectiveDmsEnabled ? 'Disconnected' : 'Not enabled'}
                    </span>
                  )}
                >
                  {dmsError ? (
                    <AlertBanner tone="error" onRetry={loadAll}>
                      <strong>Storage status is unavailable.</strong>
                      <span className="block mt-1">{dmsError}</span>
                    </AlertBanner>
                  ) : (
                    <div className="nf-settings-storage">
                      <div className="nf-settings-storage-facts">
                        <div><span>Organization folder</span><strong><code>{dmsStatus?.orgSlug ? `${dmsStatus.orgSlug}/` : 'Not configured'}</code></strong></div>
                        <div><span>Expected folders</span><strong>{dmsStatus?.expectedFolders?.length || 0}</strong></div>
                        <div><span>Documents</span><strong>{storage?.documentCount?.toLocaleString() ?? 'Unavailable'}</strong></div>
                      </div>
                      <div className="nf-settings-storage-meter">
                        <div className="nf-settings-storage-meter-head">
                          <div>
                            <span>Storage used</span>
                            <strong>{storage ? formatSize(usedBytes) : 'Usage unavailable'}</strong>
                          </div>
                          <span>{limitBytes ? `${formatSize(limitBytes)} total` : storage ? 'Unlimited plan' : 'No live usage data'}</span>
                        </div>
                        <div
                          className="nf-settings-progress"
                          role="progressbar"
                          aria-label="Document storage used"
                          aria-valuemin="0"
                          aria-valuemax={limitBytes || undefined}
                          aria-valuenow={storage && limitBytes ? usedBytes : undefined}
                        >
                          <i style={{ width: `${storagePercent ?? 0}%` }} />
                        </div>
                        <small>
                          {storagePercent != null
                            ? `${storagePercent}% of the configured allowance is in use.`
                            : storage
                              ? 'Your current plan does not set a storage limit.'
                              : 'Live usage will appear when the DMS is connected and reports storage.'}
                        </small>
                      </div>
                    </div>
                  )}
                </SettingsSection>
              )}

              {resolvedActiveSection === 'settings-activity' && (
                <SettingsSection
                  id="settings-activity"
                  tabId="settings-tab-settings-activity"
                  icon={Activity}
                  eyebrow="Audit"
                  title="Recent organization activity"
                  description="The five latest organization events from the audit service."
                  action={<Link to="/audit-log" className="nf-settings-inline-link">View all activity</Link>}
                >
                {activityError ? (
                  <AlertBanner tone="error" onRetry={loadAll}>
                    <strong>Recent activity is unavailable.</strong>
                    <span className="block mt-1">{activityError}</span>
                  </AlertBanner>
                ) : recentActivity.length === 0 ? (
                  <EmptyState
                    title="No organization activity yet"
                    description="New administrative events will appear here automatically."
                    icon={<Activity size={20} />}
                    className="nf-settings-activity-empty"
                  />
                ) : (
                  <ol className="nf-settings-activity-list">
                    {recentActivity.map((log) => (
                      <li key={log._id}>
                        <span className="nf-settings-avatar" aria-hidden="true">{initialsFor(log.performedBy?.name)}</span>
                        <div>
                          <p><strong>{log.performedBy?.name || 'System'}</strong><span>{titleCaseAction(log.action)}</span></p>
                          <small>{log.targetEntity || log.detail || 'Organization event'}</small>
                        </div>
                        <time dateTime={log.createdAt}>{formatDateTime(log.createdAt, 'Time unavailable')}</time>
                      </li>
                    ))}
                  </ol>
                )}
                </SettingsSection>
              )}
            </div>
          </div>

          {dirty && (
            <div className="nf-settings-savebar" role="status" aria-live="polite">
              <div>
                <span className="nf-settings-savebar-dot" aria-hidden="true" />
                <p><strong>Unsaved changes</strong><span>Review and save your organization settings.</span></p>
              </div>
              <div className="nf-settings-savebar-actions">
                <button type="button" className="nf-button" onClick={discardChanges} disabled={saving}>
                  <X size={15} aria-hidden="true" /> Discard
                </button>
                <button
                  type="button"
                  className="nf-button nf-button-primary"
                  onClick={handleSaveAll}
                  disabled={saving || readOnly || emailInvalid || audienceInvalid}
                >
                  <Save size={15} aria-hidden="true" /> {saving ? 'Saving…' : 'Save changes'}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </AppShell>
  )
}
