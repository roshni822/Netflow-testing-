import { ArchiveOrganization, OrganizationStorage } from '../components/PlatformOperations'
// Multi-tenancy build-order step 7 (+ polish) - pages/PlatformPanel.jsx
// Platform Super Admin panel: manage organizations (tenants).
// Create orgs (with an auto-provisioned Org Admin), edit settings, suspend/
// activate, reset the admin password, and delete a tenant (with auto-backup).
// The default organization is hidden here (it's the platform's internal org).
// SuperAdmin role only (route + API enforced).

import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useSearchParams } from 'react-router-dom'
import {
  AlertTriangle, Building2, Check, Clock3, Eye, HardDrive,
  KeyRound, MoreHorizontal, Pencil, Power, Trash2, SlidersHorizontal, CreditCard
} from 'lucide-react'
import AppShell from '../components/AppShell'
import { api } from '../utils/api'
import { toast } from '../lib/toastStore'
import { confirm } from '../lib/confirmStore'
import { TableRowSkeleton } from '../components/Skeleton'
import EmptyState from '../components/EmptyState'
import { AlertBanner } from '../components/Alert'
import Modal from '../components/Modal'
import UsageMeter from '../components/UsageMeter'
import ThreeDToggle from '../components/ThreeDToggle'
import {
  PLAN_OPTIONS, PLAN_LABELS, LIMIT_FIELDS, METER_ORDER,
  licenceChip, CHIP_CLASS, formatMb, formatDate, toDateInput
} from '../lib/licensing'

const PAGE_SIZE = 20

const AVATAR_TONES = [
  'bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-300',
  'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300',
  'bg-sky-100 text-sky-700 dark:bg-sky-500/20 dark:text-sky-300',
  'bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300',
  'bg-violet-100 text-violet-700 dark:bg-violet-500/20 dark:text-violet-300',
  'bg-teal-100 text-teal-700 dark:bg-teal-500/20 dark:text-teal-300'
]

const orgInitials = (name) => {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean)
  if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase()
  return String(name || '?').slice(0, 2).toUpperCase()
}

const avatarTone = (seed) => {
  let h = 0
  const s = String(seed || '')
  for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) >>> 0
  return AVATAR_TONES[h % AVATAR_TONES.length]
}

const planLabelFromKey = (key) => PLAN_LABELS[key] || String(key || 'custom')
  .replace(/[_-]+/g, ' ')
  .replace(/\b\w/g, (letter) => letter.toUpperCase())

const planSummary = (org) => {
  const label = planLabelFromKey(org.plan)
  const until = org.licence?.trialEndsAt || org.licence?.validUntil
  return until ? `${label} · until ${formatDate(until)}` : `${label} · Perpetual`
}

// The row shows only the single highest-risk meter, so use the same complete
// resource set as the server-side health classification.
const PLATFORM_METERS = METER_ORDER

const EMPTY_LIMITS = LIMIT_FIELDS.reduce((acc, f) => ({ ...acc, [f.key]: 0 }), { gracePercent: 0 })

const DEFAULT_DEPARTMENTS = ['HR', 'Finance', 'IT', 'Operations', 'Sales', 'Legal']

const EMPTY_FORM = {
  name: '',
  subdomain: '',
  allowedDomains: '',
  externalUsers: false,
  pdfAutoFillEntitlementOverride: true,
  plan: 'trial',
  limits: { ...PLAN_OPTIONS[0].limits, gracePercent: 0 },
  validFrom: '',
  validUntil: '',
  trialEndsAt: '',
  billingEmail: '',
  billingAnchorDay: 1,
  adminEmail: '',
  adminName: '',
  // Bootstrap Org Admin licensing (create only). Defaults match prior behaviour.
  adminCanBuild: true,
  countAdminTowardSeats: true,
  // DMS initial state for creation
  dmsEnabled: false,
  dmsName: '',
  dmsBaseUrl: '',
  dmsApiKey: '',
  dmsApiKeyChanged: false,
  dmsOrgSlug: '',
  departmentDms: DEFAULT_DEPARTMENTS.map((dept) => ({
    department: dept,
    apiKey: '',
    apiKeyChanged: false,
    baseUrl: '',
    folder: '',
    enabled: true
  })),
  // S3 initial state
  s3Enabled: false,
  s3Bucket: '',
  s3Endpoint: '',
  s3Region: 'auto',
  s3AccessKeyId: '',
  s3SecretAccessKey: '',
  s3SecretChanged: false
}

const newConnectionTest = () => ({
  status: 'idle',
  message: '',
  testedAt: null,
  expiresAt: null,
  verificationReceipt: ''
})

const connectionTestIsFresh = (test, now) =>
  test?.status === 'connected' &&
  Boolean(test.verificationReceipt) &&
  Number.isFinite(Date.parse(test.expiresAt)) &&
  Date.parse(test.expiresAt) > now

const orgToForm = (org) => {
  const orgDepts = Array.isArray(org?.departments) && org.departments.length > 0 
    ? org.departments 
    : DEFAULT_DEPARTMENTS

  return {
    ...EMPTY_FORM,
    name: org.name || '',
    subdomain: org.subdomain || '',
    allowedDomains: (org.allowedDomains || []).join(', '),
    externalUsers: org.features?.externalUsers === true,
    pdfAutoFillEntitlementOverride: org.pdfAutoFill?.entitlementOverride === true,
    plan: org.plan || 'custom',
    limits: { ...EMPTY_LIMITS, ...(org.limits || {}) },
    validFrom: toDateInput(org.licence?.validFrom),
    validUntil: toDateInput(org.licence?.validUntil),
    trialEndsAt: toDateInput(org.licence?.trialEndsAt),
    billingEmail: org.billingEmail || '',
    billingAnchorDay: org.billingAnchorDay || 1,
    // DMS integration (SuperAdmin only)
    dmsEnabled: Boolean(org.integrations?.dmsEnabled),
    dmsName: org.integrations?.dmsName || '',
    dmsBaseUrl: org.integrations?.dmsBaseUrl || '',
    dmsApiKey: org.integrations?.dmsApiKey ? '••••••••' : '',  // masked for display
    dmsApiKeyChanged: false,  // track if user actually typed a new key
    dmsOrgSlug: org.integrations?.dmsOrgSlug || '',
    departmentDms: orgDepts.map(dept => {
      const existing = org.integrations?.departmentDms?.find(d => 
        String(d.department).toLowerCase() === String(dept).toLowerCase()
      )
      return {
        department: dept,
        apiKey: existing?.apiKey ? '••••••••' : '',
        apiKeyChanged: false,
        baseUrl: existing?.baseUrl || '',
        folder: existing?.folder || '',
        enabled: existing ? existing.enabled !== false : true
      }
    }),
    // S3 integration
    s3Enabled: Boolean(org.integrations?.s3?.enabled),
    s3Bucket: org.integrations?.s3?.bucket || '',
    s3Endpoint: org.integrations?.s3?.endpoint || '',
    s3Region: org.integrations?.s3?.region || 'auto',
    s3AccessKeyId: org.integrations?.s3?.accessKeyId || '',
    s3SecretAccessKey: org.integrations?.s3?.secretAccessKey ? '••••••••' : '',
    s3SecretChanged: false
  }
}

// Dates are sent as '' → null so clearing a field means "perpetual" rather than
// "leave it as it was".
const dateOut = (value) => (value ? value : null)

// Backend still requires a unique subdomain; derive one from the org name so
// the create form does not ask for it.
const slugFromName = (name) => {
  let s = String(name || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
  if (!s || !/^[a-z0-9]/.test(s)) s = `org-${Date.now().toString(36)}`
  if (!/[a-z0-9]$/.test(s)) s = `${s}0`
  return s
}

const formToPayload = (f, { subdomain } = {}) => ({
  name: f.name.trim(),
  subdomain: (subdomain ?? f.subdomain).trim().toLowerCase(),
  allowedDomains: f.allowedDomains,
  features: { externalUsers: f.externalUsers },
  ...(f.plan === 'custom'
    ? { pdfAutoFillEntitlementOverride: f.pdfAutoFillEntitlementOverride === true }
    : {}),
  plan: f.plan === 'custom' ? undefined : f.plan,
  limits: Object.fromEntries(
    [...LIMIT_FIELDS.map((x) => x.key), 'gracePercent'].map((k) => [k, Number(f.limits[k]) || 0])
  ),
  licence: {
    validFrom: dateOut(f.validFrom),
    validUntil: dateOut(f.validUntil),
    // Only a trial has a trial end date; sending one for a paid plan would be
    // overwritten by the server anyway, so it is not sent at all.
    ...(f.plan === 'trial' ? { trialEndsAt: dateOut(f.trialEndsAt) } : {})
  },
  billingEmail: f.billingEmail.trim(),
  billingAnchorDay: Number(f.billingAnchorDay) || 1,
  // DMS integration
  integrations: {
    dmsEnabled: Boolean(f.dmsEnabled),
    dmsName: f.dmsName.trim(),
    dmsBaseUrl: f.dmsBaseUrl.trim(),
    // Only send the API key if it was actually changed (not just the masked placeholder)
    ...(f.dmsApiKeyChanged ? { dmsApiKey: f.dmsApiKey.trim() } : {}),
    dmsOrgSlug: (f.dmsOrgSlug || '').trim().toLowerCase().replace(/[^a-z0-9-]/g, '-'),
    ...(f.departmentDms ? {
      departmentDms: f.departmentDms.map(d => ({
        department: d.department,
        ...(d.apiKeyChanged ? { apiKey: d.apiKey.trim() } : {}),
        baseUrl: d.baseUrl.trim(),
        folder: d.folder.trim(),
        enabled: d.enabled
      }))
    } : {}),
    s3: {
      enabled: Boolean(f.s3Enabled),
      bucket: f.s3Bucket.trim(),
      endpoint: f.s3Endpoint.trim(),
      region: f.s3Region.trim(),
      accessKeyId: f.s3AccessKeyId.trim(),
      ...(f.s3SecretChanged ? { secretAccessKey: f.s3SecretAccessKey.trim() } : {})
    }
  }
})

const copyToClipboard = (text) => {
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(text).then(() => toast.success('Copied')).catch(() => {})
  }
}

function ConnectionTestControl({ integration, test, onTest, disabled, now, isEdit = false }) {
  const expired = test.status === 'connected' && !connectionTestIsFresh(test, now)
  const status = expired ? 'stale' : test.status
  const labels = {
    idle: 'Not tested', testing: 'Testing connection…', connected: 'Connected',
    failed: 'Connection failed', stale: expired ? 'Test expired' : 'Needs retest'
  }
  const messages = {
    idle: isEdit
      ? 'Test the current connection before saving changes.'
      : 'Test this connection before creating the organization.',
    testing: 'Checking the real service and required permissions.',
    connected: `Verified at ${new Date(test.testedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}. Valid for 10 minutes.`,
    failed: test.message || 'The service could not be validated.',
    stale: expired ? 'The previous verification expired. Test again.' : 'Configuration changed after the previous test.'
  }
  const busy = status === 'testing'
  const retry = status === 'failed' || status === 'stale'
  const tone = status === 'connected'
    ? 'border-success-line bg-success-subtle text-success-fg'
    : status === 'failed'
      ? 'border-danger-line bg-danger-subtle text-danger-fg'
      : status === 'stale'
        ? 'border-warning-line bg-warning-subtle text-warning-fg'
        : status === 'testing'
          ? 'border-indigo-200 bg-indigo-50 text-indigo-700'
          : 'border-line bg-surface text-fg-muted'

  return (
    <div className="flex flex-col sm:flex-row sm:items-center gap-3 border-t border-line pt-3">
      <div role="status" aria-live="polite" aria-busy={busy} data-status={status} className={`connection-test-status min-w-0 flex-1 rounded-lg border px-3 py-2 ${tone}`}>
        <p className="text-xs font-semibold">{labels[status]}</p>
        <p className="mt-0.5 text-[11px] opacity-90">{messages[status]}</p>
      </div>
      <button type="button" onClick={onTest} disabled={disabled || busy} className="shrink-0 px-3 py-2 text-xs font-semibold rounded-lg border border-indigo-300 text-indigo-700 bg-surface hover:bg-indigo-50 focus:outline-none focus:ring-2 focus:ring-indigo-300 transition disabled:cursor-not-allowed disabled:opacity-50">
        {busy ? 'Testing…' : `${retry ? 'Retry' : 'Test'} ${integration} connection`}
      </button>
    </div>
  )
}

function StatusBadge({ status, provisioningStatus }) {
  if (provisioningStatus && provisioningStatus !== 'ready') {
    return <span className="inline-flex rounded-full bg-warning-subtle px-2 py-0.5 text-[11px] font-medium text-warning-fg">{provisioningStatus === 'maintenance' ? 'Archived' : provisioningStatus === 'failed' ? 'Setup failed' : 'Setting up'}</span>
  }
  const active = status === 'active'
  return (
    <span className={`inline-flex items-center gap-1.5 text-[11px] font-medium px-2 py-0.5 rounded-full ${
      active
        ? 'bg-success-subtle text-success-fg'
        : 'bg-danger-subtle text-danger-fg'
    }`}>
      <span className={`w-1.5 h-1.5 rounded-full ${active ? 'bg-success-solid' : 'bg-danger-solid'}`} />
      {active ? 'Active' : 'Suspended'}
    </span>
  )
}

function HealthBadge({ tone = 'neutral', children }) {
  const tones = {
    success: 'bg-success-subtle text-success-fg',
    warning: 'bg-warning-subtle text-warning-fg',
    danger: 'bg-danger-subtle text-danger-fg',
    neutral: 'bg-surface-3 text-fg-muted'
  }
  const dots = {
    success: 'bg-success-solid',
    warning: 'bg-warning-solid',
    danger: 'bg-danger-solid',
    neutral: 'bg-fg-subtle'
  }
  return (
    <span className={`inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium ${tones[tone] || tones.neutral}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${dots[tone] || dots.neutral}`} aria-hidden />
      {children}
    </span>
  )
}

function OrgFormSection({ title, icon: Icon, children }) {
  return (
    <section className="min-w-0 space-y-3 rounded-xl border border-line bg-surface p-4">
      <div className="flex items-center gap-2.5">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600 dark:bg-indigo-500/15 dark:text-indigo-300">
          <Icon aria-hidden="true" className="h-4 w-4" />
        </span>
        <h3 className="text-sm font-semibold text-fg">{title}</h3>
      </div>
      {children}
    </section>
  )
}

function OrgToggleRow({ label, description, checked, onChange }) {
  return (
    <div className="flex min-h-11 items-center justify-between gap-4 py-2">
      <div className="min-w-0">
        <p className="text-sm font-medium text-fg">{label}</p>
        {description && <p className="mt-0.5 text-xs leading-5 text-fg-muted">{description}</p>}
      </div>
      <div className="shrink-0 [&_button]:focus-visible:outline-2 [&_button]:focus-visible:outline-offset-4 [&_button]:focus-visible:outline-indigo-500">
        <ThreeDToggle checked={checked} onChange={onChange} ariaLabel={label} />
      </div>
    </div>
  )
}

// Create/edit dialog. `org` = null for create, an org object for edit.
function OrgDialog({ org, onClose, onSaved }) {
  const formId = useId()
  const isEdit = Boolean(org)
  const [form, setForm] = useState(isEdit ? orgToForm(org) : EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [plans,setPlans]=useState([])
  const [plansReady,setPlansReady]=useState(false)
  const [plansError,setPlansError]=useState('')
  useEffect(()=>{
    let live=true
    api.get('/api/platform/plans').then(data=>{
      if(!live) return
      setPlans(data.plans || []);setPlansReady(true)
      if(!isEdit) {
        const preset=data.plans?.find(p=>p.key==='trial') || data.plans?.[0]
        if(preset) setForm(current=>({...current,plan:preset.key,limits:{...preset.limits,gracePercent:0}}))
      }
    }).catch(error=>{if(live)setPlansError(error.message || 'Could not load plans.')})
    return ()=>{live=false}
  },[isEdit])
  const creationIntent = useRef(null)
  const [creationMessage, setCreationMessage] = useState('')
  const [connectionTests, setConnectionTests] = useState({
    dms: newConnectionTest(),
    s3: newConnectionTest()
  })
  const connectionTestRuns = useRef({ dms: 0, s3: 0 })
  const [verificationNow, setVerificationNow] = useState(Date.now())

  useEffect(() => {
    const timer = window.setInterval(() => setVerificationNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [])

  const invalidateConnectionTest = (integration) => {
    connectionTestRuns.current[integration] += 1
    setConnectionTests((current) => {
      const previous = current[integration]
      if (previous.status === 'idle') return current
      return {
        ...current,
        [integration]: { ...newConnectionTest(), status: 'stale' }
      }
    })
  }

  const set = (key) => (e) => {
    const value = e.target.type === 'checkbox' ? e.target.checked : e.target.value
    setForm((f) => ({ ...f, [key]: value }))
  }

  const setIntegrationValue = (integration, key, changedFlag = null) => (e) => {
    invalidateConnectionTest(integration)
    const value = e.target.value
    setForm((current) => ({
      ...current,
      [key]: value,
      ...(changedFlag ? { [changedFlag]: true } : {})
    }))
  }

  const setIntegrationEnabled = (integration, key) => (value) => {
    connectionTestRuns.current[integration] += 1
    setForm((current) => ({ ...current, [key]: value }))
    setConnectionTests((current) => ({ ...current, [integration]: newConnectionTest() }))
  }

  // DMS API key helper: mark as changed so payload includes the new value
  const setDmsApiKey = setIntegrationValue('dms', 'dmsApiKey', 'dmsApiKeyChanged')

  const testIntegration = async (integration) => {
    const runId = connectionTestRuns.current[integration] + 1
    connectionTestRuns.current[integration] = runId
    setConnectionTests((current) => ({
      ...current,
      [integration]: { ...newConnectionTest(), status: 'testing' }
    }))
    const config = integration === 'dms'
      ? {
          baseUrl: form.dmsBaseUrl.trim(),
          ...(form.dmsApiKeyChanged ? { apiKey: form.dmsApiKey.trim() } : {}),
          orgSlug: form.dmsOrgSlug.trim()
        }
      : {
          bucket: form.s3Bucket.trim(),
          endpoint: form.s3Endpoint.trim(),
          region: form.s3Region.trim() || 'auto',
          accessKeyId: form.s3AccessKeyId.trim(),
          ...(form.s3SecretChanged ? { secretAccessKey: form.s3SecretAccessKey.trim() } : {})
        }
    try {
      const result = await api.post('/api/platform/integrations/test', {
        integration,
        config,
        ...(isEdit ? { orgId: org._id } : {})
      })
      if (connectionTestRuns.current[integration] !== runId) return
      setConnectionTests((current) => ({
        ...current,
        [integration]: {
          status: 'connected',
          message: '',
          testedAt: result.testedAt,
          expiresAt: result.expiresAt,
          verificationReceipt: result.verificationReceipt
        }
      }))
      setVerificationNow(Date.now())
    } catch (error) {
      if (connectionTestRuns.current[integration] !== runId) return
      setConnectionTests((current) => ({
        ...current,
        [integration]: {
          ...newConnectionTest(),
          status: 'failed',
          message: error.message || 'The connection could not be validated.'
        }
      }))
    }
  }

  const connectionTestRunning = Object.values(connectionTests).some((test) => test.status === 'testing')
  const dmsVerified = !form.dmsEnabled || connectionTestIsFresh(connectionTests.dms, verificationNow)
  const s3Verified = !form.s3Enabled || connectionTestIsFresh(connectionTests.s3, verificationNow)
  const enabledConnectionsVerified = dmsVerified && s3Verified
  const pendingConnectionNames = [
    form.dmsEnabled && !dmsVerified ? 'DMS' : null,
    form.s3Enabled && !s3Verified ? 'S3' : null
  ].filter(Boolean)
  const s3FieldsComplete = Boolean(
    form.s3Bucket.trim() &&
    form.s3AccessKeyId.trim() &&
    form.s3SecretAccessKey.trim()
  )

  const setLimit = (key) => (e) =>
    setForm((f) => ({ ...f, limits: { ...f.limits, [key]: e.target.value } }))

  // Picking a plan fills in that tier's numbers. They stay editable for
  // negotiated deals (e.g. Enterprise with tightened seats) — the tier name
  // is kept on save.
  const choosePlan = (key) => {
    const preset = plans.find((p) => p.key === key)
    setForm((f) => ({
      ...f,
      plan: key,
      limits: preset ? { ...f.limits, ...preset.limits } : f.limits,
      trialEndsAt: key === 'trial' && !f.trialEndsAt
        ? toDateInput(new Date(Date.now() + (preset?.trialDays || 14) * 86400000))
        : f.trialEndsAt
    }))
  }

  const submit = async (e) => {
    e.preventDefault()
    if (saving || !plansReady) return
    if (!form.name.trim()) return toast.error('Organization name is required')
    if (!isEdit && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.adminEmail.trim())) {
      return toast.error('A valid admin email is required')
    }
    if (!isEdit && !enabledConnectionsVerified) {
      return toast.error('Test every enabled integration before creating the organization')
    }
    setSaving(true)
    try {
      if (isEdit) {
        const payload = formToPayload(form)
        payload.integrationVerifications = { ...(form.dmsEnabled ? { dms: connectionTests.dms.verificationReceipt } : {}) }
        delete payload.subdomain // permanent address — not editable here
        await api.put(`/api/platform/orgs/${org._id}`, payload)
        toast.success('Organization updated')
        onSaved(null)
      } else {
        // Preserve both address and request ID after a lost response. Receipt
        // refreshes do not create a different organization intent.
        const signature = JSON.stringify(form)
        if (!creationIntent.current || creationIntent.current.signature !== signature) {
          const base = slugFromName(form.name)
          creationIntent.current = { signature, key: crypto.randomUUID(), subdomain: `${base}-${crypto.randomUUID().slice(0, 6)}` }
        }
        const { subdomain, key } = creationIntent.current
        const payload = {
          ...formToPayload(form, { subdomain }),
          adminEmail: form.adminEmail.trim(),
          adminName: form.adminName.trim(),
          adminCanBuild: form.adminCanBuild === true,
          countAdminTowardSeats: form.countAdminTowardSeats === true,
          integrationVerifications: {
            ...(form.dmsEnabled ? { dms: connectionTests.dms.verificationReceipt } : {}),
            ...(form.s3Enabled ? { s3: connectionTests.s3.verificationReceipt } : {})
          }
        }
        setCreationMessage('Creating the organization and its workspace…')
        const res = await api.post('/api/platform/orgs', payload, { headers: { 'Idempotency-Key': key } })
        if (res.pending) {
          setCreationMessage('Setup is still running. Keep these details unchanged and select Retry setup to check again.')
          return
        }
        if (res.credentialsAlreadyIssued) {
          toast.success('Organization already created. Use Reset admin password to issue new credentials.')
          onSaved(res)
          return
        }
        toast.success(`Organization "${payload.name}" created`)
        onSaved(res)
      }
    } catch (err) {
      if (!isEdit) setCreationMessage(`${err.message || 'Setup could not finish.'} Keep these details unchanged to retry the same request.`)
      toast.error(err.message || 'Could not save the organization')
    } finally {
      setSaving(false)
    }
  }

  const fieldCls = 'mt-1.5 min-h-11 w-full min-w-0 rounded-lg border border-line bg-surface px-3 py-2.5 text-sm text-fg transition focus:outline-none focus:ring-2 focus:ring-indigo-300'

  return (
    <Modal
      onClose={onClose}
      size="xl"
      className="overflow-hidden rounded-2xl"
      maximizable
      title={isEdit ? `Edit ${org.name}` : 'New organization'}
      bodyClass="min-h-0 flex-1 overflow-y-auto bg-surface-2/50"
      footer={
        <div className="flex w-full flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          {!isEdit && pendingConnectionNames.length > 0 && (
            <p role="status" className="text-xs font-medium text-warning-fg">
              Test required: {pendingConnectionNames.join(' and ')}.
            </p>
          )}
          <div className="flex w-full gap-2 sm:ml-auto sm:w-auto">
            <button type="button" onClick={onClose} className="min-h-11 shrink-0 rounded-lg border border-line bg-surface px-4 py-2 text-sm font-medium text-fg transition hover:bg-surface-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500">
              Cancel
            </button>
            <button form={formId} type="submit" disabled={!plansReady || saving || (!isEdit && (connectionTestRunning || !enabledConnectionsVerified))} className="min-h-11 flex-1 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500 disabled:cursor-not-allowed disabled:opacity-60 sm:flex-none">
              {saving ? 'Saving…' : isEdit ? 'Save changes' : creationMessage ? 'Retry setup' : 'Create organization'}
            </button>
          </div>
        </div>
      }
    >
      <form id={formId} onSubmit={submit} className="space-y-4 p-4" aria-busy={saving}>
        {plansError && <p role="alert" className="text-sm text-danger-fg">{plansError}</p>}
        {!isEdit && creationMessage && <p role="status" aria-live="polite" className="rounded-lg border border-line bg-surface p-3 text-sm text-fg">{creationMessage}</p>}
        <OrgFormSection title="Organization details" icon={Building2}>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="text-xs font-medium text-fg">Organization Name</span>
              <input value={form.name} onChange={set('name')} placeholder="Netlink Software Group America Inc." className={fieldCls} />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-fg">Allowed Domains</span>
              <input value={form.allowedDomains} onChange={set('allowedDomains')} placeholder="netlink.com" className={fieldCls} />
            </label>
          </div>
          <div className="border-t border-line">
            <OrgToggleRow
              label="Allow external domains"
              checked={form.externalUsers}
              onChange={(value) => setForm((current) => ({ ...current, externalUsers: value }))}
            />
          </div>
        </OrgFormSection>

        {!isEdit && (
          <OrgFormSection title="First organization admin" icon={KeyRound}>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <label className="block">
                <span className="text-xs font-medium text-fg">Admin email</span>
                <input type="email" value={form.adminEmail} onChange={set('adminEmail')} placeholder="admin@netlink.com" className={fieldCls} />
              </label>
              <label className="block">
                <span className="text-xs font-medium text-fg">Admin name (optional)</span>
                <input value={form.adminName} onChange={set('adminName')} placeholder="Netlink Admin" className={fieldCls} />
              </label>
            </div>
            <div className="divide-y divide-line border-y border-line">
              <OrgToggleRow
                label="Make Builder"
                description="Create and edit forms and workflows."
                checked={form.adminCanBuild}
                onChange={(value) => setForm((current) => ({ ...current, adminCanBuild: value }))}
              />
              <OrgToggleRow
                label="Admin count as user"
                description="Off = admin is not count as user"
                checked={form.countAdminTowardSeats}
                onChange={(value) => setForm((current) => ({ ...current, countAdminTowardSeats: value }))}
              />
            </div>
            <p className="text-xs leading-5 text-fg-muted">
              Once save this setting , can't change
              {form.allowedDomains.trim() && ' Admin email must match an allowed domain.'}
            </p>
          </OrgFormSection>
        )}

        {/* ── plan ─────────────────────────────────────────────────────── */}
        <OrgFormSection title="Plan & limits" icon={SlidersHorizontal}>
        <div className="space-y-3">
          <div className="grid grid-cols-1 min-[400px]:grid-cols-2 sm:grid-cols-4 gap-2">
            {plans.map((p) => (
              <button
                key={p.key}
                type="button"
                onClick={() => choosePlan(p.key)}
                aria-pressed={form.plan === p.key}
                className={`min-w-0 text-left px-3 py-3 rounded-lg border transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500 ${
                  form.plan === p.key
                    ? 'border-indigo-400 bg-indigo-50 dark:bg-indigo-500/15 ring-1 ring-indigo-300'
                    : 'border-line bg-surface-2 hover:bg-surface-3'
                }`}
              >
                <span className="block text-sm font-medium text-fg">{p.label}</span>
                <span className="block text-xs leading-5 text-fg-muted mt-0.5">{p.trialDays ? `${p.trialDays} day trial` : `${p.limits?.maxUsers || 'Unlimited'} users`}</span>
              </button>
            ))}
          </div>
          {form.plan === 'custom' && (
            <div className="space-y-3">
              <p className="text-[11px] text-warning-fg">
                Custom plan: set PDF Auto-Fill access below.
              </p>
              <div className="rounded-lg border border-line bg-surface-2/50 p-3 flex items-start justify-between gap-4">
                <div>
                  <p className="text-sm font-semibold text-fg">PDF Auto-Fill entitlement</p>
                </div>
                <ThreeDToggle
                  checked={form.pdfAutoFillEntitlementOverride}
                  onChange={(value) => setForm((current) => ({ ...current, pdfAutoFillEntitlementOverride: value }))}
                  ariaLabel="Enable PDF Auto-Fill entitlement"
                />
              </div>
            </div>
          )}
        </div>

        {/* ── limits ───────────────────────────────────────────────────── */}
        <div className="rounded-lg border border-line bg-surface-2/50 p-3 space-y-3">
          <div className="flex items-baseline justify-between">
            <p className="text-xs font-semibold text-fg">Limits</p>
            <p className="text-xs leading-5 text-fg-muted">0 = unlimited</p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {LIMIT_FIELDS.map((field) => (
              <label key={field.key} className="block">
                <span className="text-xs font-medium text-fg">{field.label}</span>
                <input
                  type="number"
                  min="0"
                  value={form.limits[field.key] ?? 0}
                  onChange={setLimit(field.key)}
                  className={fieldCls}
                />
                <span className="text-xs leading-5 text-fg-muted">{field.help}</span>
              </label>
            ))}
            <label className="block">
              <span className="text-xs font-medium text-fg">Grace (%)</span>
              <input
                type="number"
                min="0"
                max="50"
                value={form.limits.gracePercent ?? 0}
                onChange={setLimit('gracePercent')}
                className={fieldCls}
              />
             
            </label>
          </div>
        </div>

        </OrgFormSection>

        {/* ── licence ──────────────────────────────────────────────────── */}
        <OrgFormSection title="Licence period" icon={Clock3}>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <label className="block">
              <span className="text-xs font-medium text-fg">Valid from</span>
              <input type="date" value={form.validFrom} onChange={set('validFrom')} className={fieldCls} />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-fg">Valid until</span>
              <input type="date" value={form.validUntil} onChange={set('validUntil')} className={fieldCls} />
              
            </label>
            {form.plan === 'trial' && (
              <label className="block">
                <span className="text-xs font-medium text-fg">Trial ends</span>
                <input type="date" value={form.trialEndsAt} onChange={set('trialEndsAt')} className={fieldCls} />
              </label>
            )}
          </div>

          {isEdit && org.licence?.status === 'expired' && (
            <p className="text-[11px] text-danger-fg">
              Currently expired since {formatDate(org.licence?.validUntil || org.licence?.trialEndsAt)} — set a
              later date to restore write access.
            </p>
          )}
        </OrgFormSection>

        {/* ── billing ──────────────────────────────────────────────────── */}
        <OrgFormSection title="Billing" icon={CreditCard}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="block">
            <span className="text-xs font-medium text-fg">Billing email </span>
            <input
              type="email"
              value={form.billingEmail}
              onChange={set('billingEmail')}
              placeholder="admin@netflow.com"
              required
              className={fieldCls}
            />
             <span className="text-xs leading-5 text-fg-muted">
             email for alert notification 
            </span>
           
          </label>
          <label className="block">
            <span className="text-xs font-medium text-fg">Monthly reset day</span>
            <input
              type="number"
              min="1"
              max="31"
              value={form.billingAnchorDay}
              onChange={set('billingAnchorDay')}
              className={fieldCls}
            />
            <span className="text-xs leading-5 text-fg-muted">
              31 = month-end.
            </span>
          </label>
        </div>

        </OrgFormSection>

        <OrgFormSection title="Integrations" icon={HardDrive}>
        {/* ── DMS integration (SuperAdmin sets this) ───────────── */}
        <div className="rounded-lg border border-line bg-surface-2/50 p-4 space-y-4">
          <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-semibold text-fg">Connect your DMS</p>
               
              </div>
              <ThreeDToggle 
                checked={form.dmsEnabled} 
                onChange={setIntegrationEnabled('dms', 'dmsEnabled')}
                ariaLabel="Enable DMS integration"
              />
            </div>

            <div hidden={!form.dmsEnabled} className="space-y-3">
              <label className="block">
                <span className="text-xs font-medium text-fg">DMS Provider Name (optional)</span>
                <input value={form.dmsName} onChange={set('dmsName')} maxLength={80} placeholder="Provider Name" className={fieldCls} />
              </label>
              <label className="block">
                <span className="text-xs font-medium text-fg">DMS Endpoint</span>
                <input type="url" value={form.dmsBaseUrl} onChange={setIntegrationValue('dms', 'dmsBaseUrl')} placeholder="https://base-layer.systems/api/" spellCheck={false} autoComplete="off" className={fieldCls} />
              </label>
              <label className="block">
                <span className="text-xs font-medium text-fg">API Key</span>
                <input
                  type="password"
                  value={form.dmsApiKey}
                  onChange={setDmsApiKey}
                  placeholder="Enter API key"
                  autoComplete="new-password"
                  className={fieldCls}
                />
              </label>
              <ConnectionTestControl
                integration="DMS"
                test={connectionTests.dms}
                now={verificationNow}
                onTest={() => testIntegration('dms')}
                disabled={connectionTestRunning}
                isEdit={isEdit}
              />
            </div>

          
          </div>

        {/* ── S3 Dedicated Storage (SuperAdmin sets this) ───────────── */}
        <div className="rounded-lg border border-line bg-surface-2/50 p-4 space-y-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-semibold text-fg">S3 Storage</p>
             
            </div>
            <ThreeDToggle 
              checked={form.s3Enabled} 
              onChange={setIntegrationEnabled('s3', 's3Enabled')}
              ariaLabel="Enable S3 integration"
            />
          </div>

          <div hidden={!form.s3Enabled} className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="block">
                <span className="text-xs font-medium text-fg">Bucket Name</span>
                <input
                  value={form.s3Bucket}
                  onChange={setIntegrationValue('s3', 's3Bucket')}
                  placeholder="Netflow"
                  className={fieldCls}
                />
              </label>
              <label className="block">
                <span className="text-xs font-medium text-fg">Region</span>
                <input
                  value={form.s3Region}
                  onChange={setIntegrationValue('s3', 's3Region')}
                  placeholder="auto"
                  className={fieldCls}
                />
              </label>
              <label className="block sm:col-span-2">
                <span className="text-xs font-medium text-fg">Endpoint URL</span>
                <input
                  value={form.s3Endpoint}
                  onChange={setIntegrationValue('s3', 's3Endpoint')}
                  placeholder="https://<account>.r2.cloudflarestorage.com"
                  className={fieldCls}
                />
              </label>
              <label className="block">
                <span className="text-xs font-medium text-fg">Access Key ID</span>
                <input
                  value={form.s3AccessKeyId}
                  onChange={setIntegrationValue('s3', 's3AccessKeyId')}
                  placeholder="AKIAIOSFODNN7EXAMPLE"
                  className={fieldCls}
                />
              </label>
              <label className="block">
                <span className="text-xs font-medium text-fg">Secret Access Key</span>
                <input
                  type="password"
                  value={form.s3SecretAccessKey}
                  onChange={setIntegrationValue('s3', 's3SecretAccessKey', 's3SecretChanged')}
                  placeholder="••••••••"
                  autoComplete="new-password"
                  className={fieldCls}
                />
              </label>
            </div>
            <ConnectionTestControl
              integration="S3"
              test={connectionTests.s3}
              now={verificationNow}
              onTest={() => testIntegration('s3')}
              disabled={connectionTestRunning || !s3FieldsComplete}
              isEdit={isEdit}
            />
          </div>
        </div>

        </OrgFormSection>
      </form>
    </Modal>
  )
}

// Temporary storage grant. Separate from the plan limit on purpose: support
// buys a stuck tenant a few days without changing what they are contracted for,
// so the plan value stays the number that matters at renewal.
function StorageDialog({ org, onClose, onSaved }) {
  const storage = org.licensing?.resources?.storage
  const live = org.storageExtension?.extraMb > 0 ? org.storageExtension : null
  const [extraMb, setExtraMb] = useState(1024)
  const [days, setDays] = useState(7)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)

  const grant = async () => {
    setBusy(true)
    try {
      await api.post(`/api/platform/orgs/${org._id}/storage-extension`, {
        extraMb: Number(extraMb), days: Number(days), reason: reason.trim()
      })
      toast.success(`Granted ${formatMb(extraMb)} to ${org.name} for ${days} day(s)`)
      onSaved()
    } catch (err) {
      toast.error(err.message || 'Could not grant the extension')
    } finally {
      setBusy(false)
    }
  }

  const revoke = async () => {
    setBusy(true)
    try {
      await api.delete(`/api/platform/orgs/${org._id}/storage-extension`)
      toast.success('Extension revoked')
      onSaved()
    } catch (err) {
      toast.error(err.message || 'Could not revoke the extension')
    } finally {
      setBusy(false)
    }
  }

  const fieldCls = 'mt-1 w-full px-3 py-2 text-sm border border-line rounded-lg bg-surface-2 text-fg focus:outline-none focus:ring-2 focus:ring-indigo-300'

  return (
    <Modal
      onClose={onClose}
      stacked
      title={`Storage for ${org.name}`}
      description="Grant temporary space without changing the contracted plan."
    >
      <div className="space-y-4">
        {storage && (
          <div className="rounded-lg border border-line bg-surface-2 p-3">
            <UsageMeter resource="storage" label="Storage in use" meter={storage} />
            <p className="text-[11px] text-fg-subtle mt-2">
              {storage.unlimited
                ? 'This tenant has unlimited storage — an extension would do nothing.'
                : `${formatMb(storage.limitBytes / (1024 * 1024))} available `
                  + `(${formatMb(org.limits?.maxStorageMb || 0)} licensed`
                  + `${storage.extensionMb ? ` + ${formatMb(storage.extensionMb)} extension` : ''}), `
                  + `plus a ${formatMb(storage.bufferMb)} reserve for in-flight approvals.`}
            </p>
          </div>
        )}

        {live && (
          <div className="rounded-lg border border-info-line bg-info-subtle text-info-fg p-3 text-xs">
            <p className="font-semibold">{formatMb(live.extraMb)} extension active</p>
            <p className="mt-0.5">
              Expires {formatDate(live.expiresAt)}{live.reason ? ` · ${live.reason}` : ''}
            </p>
            <button
              type="button"
              onClick={revoke}
              disabled={busy}
              className="mt-2 px-2.5 py-1 rounded-md border border-current/30 text-[11px] font-semibold hover:bg-current/10 transition disabled:opacity-60"
            >
              Revoke now
            </button>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="text-xs font-medium text-fg-muted">Extra storage (MB)</span>
            <input type="number" min="1" max="102400" value={extraMb} onChange={(e) => setExtraMb(e.target.value)} className={fieldCls} />
          </label>
          <label className="block">
            <span className="text-xs font-medium text-fg-muted">For how many days</span>
            <input type="number" min="1" max="90" value={days} onChange={(e) => setDays(e.target.value)} className={fieldCls} />
          </label>
        </div>
        <label className="block">
          <span className="text-xs font-medium text-fg-muted">Reason (recorded in the audit trail)</span>
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Waiting on the Professional upgrade PO"
            className={fieldCls}
          />
        </label>

        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm font-medium text-fg-muted hover:bg-surface-3 rounded-lg transition">
            Cancel
          </button>
          <button
            type="button"
            onClick={grant}
            disabled={busy || !Number(extraMb) || !Number(days)}
            className="px-4 py-2 text-sm font-medium bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition disabled:opacity-60"
          >
            {busy ? 'Saving…' : live ? 'Replace extension' : 'Grant extension'}
          </button>
        </div>
      </div>
    </Modal>
  )
}

function CredentialRow({ label, value, mono }) {
  return (
    <div className="flex items-center justify-between gap-3 px-3 py-2 rounded-lg bg-surface-2 border border-line">
      <div className="min-w-0">
        <p className="text-[10px] uppercase tracking-wide text-fg-subtle">{label}</p>
        <p className={`text-sm text-fg truncate ${mono ? 'font-mono' : ''}`}>{value}</p>
      </div>
      <button
        onClick={() => copyToClipboard(value)}
        className="shrink-0 px-2 py-1 text-xs font-medium text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-500/10 rounded-md transition"
      >
        Copy
      </button>
    </div>
  )
}

// One-time reveal of an admin's temporary credentials (create + reset).
function CredsModal({ data, onClose }) {
  return (
    <Modal
      onClose={onClose}
      stacked
      // Closing by accident loses the only copy of the password.
      closeOnBackdrop={false}
      showClose={false}
      title={data.title || 'Admin credentials'}
      footer={
        <button onClick={onClose} className="px-4 py-2 text-sm font-medium bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition">
          Done
        </button>
      }
    >
      <div className="space-y-4">
        <div className="p-3 rounded-lg bg-warning-subtle border border-warning-line text-warning-fg text-xs">
          Copy these now — only a password hash is stored, and the password <strong>won&rsquo;t be shown again</strong>.
          Share it securely with the org admin; they must change it on first login.
        </div>
        <div className="space-y-2">
          <CredentialRow label="Login email" value={data.email} />
          <CredentialRow label="Temporary password" value={data.tempPassword} mono />
        </div>
        {data.warning && (
          <p className="text-xs text-warning-fg">{data.warning}</p>
        )}
      </div>
    </Modal>
  )
}

// Delete confirmation — requires typing the org name to arm the button.
function DeleteDialog(props) {
  if(props.org.schemaName) return <ArchiveOrganization org={props.org} onClose={props.onClose} onArchived={props.onDeleted} Modal={Modal} />
  return <LegacyDeleteDialog {...props} />
}
function LegacyDeleteDialog({ org, onClose, onDeleted }) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const armed = text.trim() === org.name

  const doDelete = async () => {
    if (!armed) return
    setBusy(true)
    try {
      const res = await api.delete(`/api/platform/orgs/${org._id}`)
      toast.success(`Deleted "${org.name}" — ${res.deleted} records removed. Backup saved.`)
      onDeleted()
    } catch (err) {
      toast.error(err.message || 'Could not delete the organization')
    } finally {
      setBusy(false)
    }
  }

  const u = org.usage || {}
  return (
    <Modal
      onClose={onClose}
      stacked
      danger
      title={`Delete ${org.name}?`}
      footer={
        <>
          <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-fg-muted hover:bg-surface-3 rounded-lg transition">
            Cancel
          </button>
          <button
            onClick={doDelete}
            disabled={!armed || busy}
            className="px-4 py-2 text-sm font-medium bg-rose-600 text-white rounded-lg hover:bg-rose-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {busy ? 'Deleting…' : 'Delete organization'}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="p-3 rounded-lg bg-danger-subtle border border-danger-line text-danger-fg text-sm">
          This permanently deletes the organization and <strong>all its data</strong>:
          <span className="block mt-1 text-xs">
            {u.users ?? 0} users · {u.workflows ?? 0} workflows · {u.forms ?? 0} forms and all tasks,
            notifications and audit logs.
          </span>
        </div>
        <p className="text-xs text-fg-muted">
          A full backup is taken automatically before deletion, but it can only be restored by your
          hosting team — this cannot be undone from here.
        </p>
        <label className="block">
          <span className="text-xs font-medium text-fg-muted">
            Type <span className="font-semibold text-fg">{org.name}</span> to confirm
          </span>
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            className="mt-1 w-full px-3 py-2 text-sm border border-line rounded-lg bg-surface-2 text-fg focus:outline-none focus:ring-2 focus:ring-rose-300"
          />
        </label>
      </div>
    </Modal>
  )
}

function OrgAvatar({ name, seed, compact = false }) {
  return (
    <div
      className={`${compact ? 'nf-forms-icon nf-users-avatar' : 'w-10 h-10 rounded-lg flex items-center justify-center text-sm font-semibold shrink-0'} ${avatarTone(seed || name)}`}
      aria-hidden="true"
    >
      {orgInitials(name)}
    </div>
  )
}

function getUsageHealth(org) {
  const priority = { exceeded: 4, critical: 3, warning: 2, ok: 1 }
  const available = PLATFORM_METERS
    .map(({ key, label }) => ({ key, label, meter: org.licensing?.resources?.[key] }))
    .filter(({ meter }) => meter)
    .sort((a, b) => {
      const stateDifference = (priority[b.meter?.state] || 1) - (priority[a.meter?.state] || 1)
      return stateDifference || (Number(b.meter?.percent) || 0) - (Number(a.meter?.percent) || 0)
    })
  const current = available[0]
  if (!current) return { label: 'No usage data', tone: 'neutral', resource: null, meter: null }
  const state = current.meter.state || 'ok'
  const label = state === 'exceeded' ? 'Over limit' : state === 'critical' ? 'Critical' : state === 'warning' ? 'High usage' : 'Within limit'
  const tone = state === 'exceeded' ? 'danger' : state === 'critical' || state === 'warning' ? 'warning' : 'success'
  return { ...current, statusLabel: label, tone }
}

function UsageHealth({ org }) {
  const health = getUsageHealth(org)
  return (
    <div className="min-w-0">
      <div className="mb-1.5 flex items-center justify-end">
        <HealthBadge tone={health.tone}>{health.statusLabel || health.label}</HealthBadge>
      </div>
      {health.meter ? (
        <UsageMeter resource={health.key} label={health.label} meter={health.meter} compact variant="brand" />
      ) : (
        <p className="text-xs text-fg-subtle">Usage will appear when data is available.</p>
      )}
    </div>
  )
}

const ORG_MENU_WIDTH = 236
const ORG_MENU_HEIGHT = 260
const ORG_MENU_GAP = 6
const ORG_MENU_EDGE = 8

const organizationMenuPosition = (trigger, measuredHeight = ORG_MENU_HEIGHT) => {
  const rect = trigger.getBoundingClientRect()
  const spaceBelow = window.innerHeight - rect.bottom
  const openAbove = spaceBelow < measuredHeight + ORG_MENU_GAP && rect.top > spaceBelow
  const top = openAbove
    ? Math.max(ORG_MENU_EDGE, rect.top - measuredHeight - ORG_MENU_GAP)
    : Math.min(window.innerHeight - measuredHeight - ORG_MENU_EDGE, rect.bottom + ORG_MENU_GAP)
  const left = Math.max(
    ORG_MENU_EDGE,
    Math.min(window.innerWidth - ORG_MENU_WIDTH - ORG_MENU_EDGE, rect.right - ORG_MENU_WIDTH)
  )
  return { top: Math.max(ORG_MENU_EDGE, top), left, placement: openAbove ? 'top' : 'bottom' }
}

function OrganizationActionMenu({ org, busy, onEdit, onStorage, onReset, onToggle, onDelete }) {
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState({ top: 0, left: 0, placement: 'bottom' })
  const triggerRef = useRef(null)
  const menuRef = useRef(null)
  const menuId = useId()

  useEffect(() => {
    if (!open) return undefined
    const reposition = () => {
      if (!triggerRef.current) return
      setPosition(organizationMenuPosition(triggerRef.current, menuRef.current?.offsetHeight || ORG_MENU_HEIGHT))
    }
    const handlePointerDown = (event) => {
      if (triggerRef.current?.contains(event.target) || menuRef.current?.contains(event.target)) return
      setOpen(false)
    }
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        setOpen(false)
        triggerRef.current?.focus()
        return
      }
      if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
      const items = Array.from(menuRef.current?.querySelectorAll('[role="menuitem"]:not(:disabled)') || [])
      if (!items.length) return
      event.preventDefault()
      const currentIndex = items.indexOf(document.activeElement)
      let nextIndex = 0
      if (event.key === 'End') nextIndex = items.length - 1
      else if (event.key === 'ArrowUp') nextIndex = currentIndex <= 0 ? items.length - 1 : currentIndex - 1
      else if (event.key === 'ArrowDown') nextIndex = currentIndex >= items.length - 1 ? 0 : currentIndex + 1
      items[nextIndex]?.focus()
    }

    const frame = window.requestAnimationFrame(() => {
      reposition()
      menuRef.current?.querySelector('[role="menuitem"]:not(:disabled)')?.focus()
    })
    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    document.addEventListener('scroll', reposition, true)
    window.addEventListener('resize', reposition)
    return () => {
      window.cancelAnimationFrame(frame)
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
      document.removeEventListener('scroll', reposition, true)
      window.removeEventListener('resize', reposition)
    }
  }, [open])

  const close = (handler) => () => {
    setOpen(false)
    triggerRef.current?.focus()
    handler()
  }
  const toggleMenu = () => {
    if (open) return setOpen(false)
    if (triggerRef.current) setPosition(organizationMenuPosition(triggerRef.current))
    setOpen(true)
  }
  const item = 'flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-fg hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-40'
  const danger = 'flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-danger-fg hover:bg-danger-subtle disabled:cursor-not-allowed disabled:opacity-40'
  const suspended = (org.status || 'active') === 'suspended'

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        className="nf-icon-button nf-forms-more-button"
        disabled={busy}
        onClick={toggleMenu}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={`More actions for ${org.name}`}
        title={busy ? 'Organization update in progress' : 'More actions'}
      >
        {busy ? <span aria-hidden>…</span> : <MoreHorizontal aria-hidden className="h-4 w-4" />}
      </button>
      {open && typeof document !== 'undefined' && createPortal(
        <div
          id={menuId}
          ref={menuRef}
          role="menu"
          aria-label={`Actions for ${org.name}`}
          data-placement={position.placement}
          className="nf-forms-row-menu nf-platform-org-menu"
          style={{ top: position.top, left: position.left }}
        >
          <button type="button" role="menuitem" disabled={org.provisioningStatus==='maintenance'} className={item} onClick={close(onEdit)}><Pencil aria-hidden className="h-4 w-4" />Edit organization</button>
          <button type="button" role="menuitem" disabled={org.provisioningStatus==='maintenance'} className={item} onClick={close(onStorage)}><HardDrive aria-hidden className="h-4 w-4" />Manage storage</button>
          <button type="button" role="menuitem" disabled={org.provisioningStatus==='maintenance'} className={item} onClick={close(onReset)}><KeyRound aria-hidden className="h-4 w-4" />Reset admin password</button>
          <button type="button" role="menuitem" className={item} onClick={close(onToggle)}><Power aria-hidden className="h-4 w-4" />{org.provisioningStatus === 'maintenance' ? 'Restore archive' : suspended ? 'Reactivate organization' : 'Suspend organization'}</button>
          <div role="separator" className="my-1 border-t border-line" />
          <button type="button" role="menuitem" disabled={org.provisioningStatus==='maintenance'} className={danger} onClick={close(onDelete)}><Trash2 aria-hidden className="h-4 w-4" />{org.schemaName ? 'Archive organization' : 'Delete permanently'}</button>
        </div>,
        document.body
      )}
    </div>
  )
}

function OrgCard({ org, busy, onReview, onEdit, onStorage, onReset, onToggle, onDelete }) {
  const chip = licenceChip(org.licensing?.licence)
  const domains = org.allowedDomains || []
  const externalOn = org.features?.externalUsers === true

  return (
    <article className="bg-surface border border-line rounded-xl flex flex-col overflow-hidden shadow-sm hover:border-indigo-200 dark:hover:border-indigo-500/40 transition">
      <div className="p-4 flex flex-col gap-4 flex-1">
        <div className="flex items-start gap-3">
          <OrgAvatar name={org.name} seed={org._id || org.subdomain} />
          <div className="min-w-0 flex-1">
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <h3 className="break-words text-sm font-semibold text-fg" title={org.name}>{org.name}</h3>
                <p className="truncate text-xs text-fg-subtle" title={org.subdomain}>{org.subdomain}</p>
              </div>
              <StatusBadge status={org.status} provisioningStatus={org.provisioningStatus} />
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-fg-subtle">Plan</p>
            <p className="mt-0.5 truncate text-xs text-fg">{planSummary(org)}</p>
            {chip && <span className={`mt-1 inline-flex rounded border px-1.5 py-0.5 text-[10px] font-medium ${CHIP_CLASS[chip.tone]}`}>{chip.label}</span>}
          </div>
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-fg-subtle">Admin</p>
            <p className="text-xs text-fg mt-0.5 truncate" title={org.admin?.email || ''}>
              {org.admin?.email || '—'}
            </p>
          </div>
        </div>

        <UsageHealth org={org} />

        <div className="flex flex-wrap gap-1.5">
          {domains.length
            ? domains.slice(0, 2).map((d) => (
                <span key={d} className="inline-flex items-center px-1.5 py-0.5 rounded-md bg-surface-3 text-[10px] font-medium text-fg-muted">
                  @{d}
                </span>
              ))
            : (
              <span className="inline-flex items-center px-1.5 py-0.5 rounded-md bg-surface-3 text-[10px] font-medium text-fg-subtle">
                All email domains allowed
              </span>
            )}
          {domains.length > 2 && (
            <span className="inline-flex items-center rounded-md bg-surface-3 px-1.5 py-0.5 text-[10px] font-medium text-fg-muted">
              +{domains.length - 2}
            </span>
          )}
          <span className="inline-flex items-center px-1.5 py-0.5 rounded-md bg-surface-3 text-[10px] font-medium text-fg-muted">
            External users {externalOn ? 'allowed' : 'blocked'}
          </span>
        </div>
      </div>

      <div className="border-t border-line bg-surface-2/60 flex items-center justify-end gap-2 px-4 py-3">
        <button
          type="button"
          onClick={onReview}
          disabled={busy}
          className="nf-icon-button min-h-11 min-w-11"
          title="View details"
          aria-label="View details"
        >
          <Eye className="h-4 w-4" aria-hidden="true" />
        </button>
        <OrganizationActionMenu org={org} busy={busy} onEdit={onEdit} onStorage={onStorage} onReset={onReset} onToggle={onToggle} onDelete={onDelete} />
      </div>
    </article>
  )
}

function OrgReviewDialog({ org, busy, onClose, onEdit, onReset, onToggle, onStorage, onDelete }) {
  const domains = org.allowedDomains || []
  return (
    <Modal
      size="xl"
      onClose={onClose}
      title={org.name}
      description={org.subdomain || 'Organization details'}
      footer={<><button type="button" className="nf-button" onClick={onClose}>Close</button><button type="button" disabled={org.provisioningStatus==='maintenance'} className="nf-button nf-button-primary" onClick={() => { onClose(); onEdit() }}>Edit organization</button></>}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-xl border border-line bg-surface-2 p-4"><p className="text-[10px] font-semibold uppercase tracking-wider text-fg-subtle">Status</p><div className="mt-2"><StatusBadge status={org.status} provisioningStatus={org.provisioningStatus} /></div></div>
        <div className="rounded-xl border border-line bg-surface-2 p-4"><p className="text-[10px] font-semibold uppercase tracking-wider text-fg-subtle">Plan &amp; licence</p><p className="mt-2 text-sm font-semibold text-fg">{planSummary(org)}</p></div>
        <div className="rounded-xl border border-line bg-surface-2 p-4"><p className="text-[10px] font-semibold uppercase tracking-wider text-fg-subtle">Administrator</p><p className="mt-2 text-sm font-semibold text-fg break-all">{org.admin?.email || 'Not assigned'}</p></div>
        <div className="rounded-xl border border-line bg-surface-2 p-4"><p className="text-[10px] font-semibold uppercase tracking-wider text-fg-subtle">Domains &amp; features</p><p className="mt-2 text-sm font-semibold text-fg">{domains.length ? domains.map((domain) => `@${domain}`).join(', ') : 'All email domains allowed'}</p><p className="mt-1 text-xs text-fg-muted">External users {org.features?.externalUsers ? 'allowed' : 'blocked'}</p></div>
      </div>
      {org.lifecycle && <p className="mt-4 text-sm text-fg-muted">Archive retention ends {formatDate(org.lifecycle.purgeAfter)}. {org.lifecycle.backupVerifiedAt ? 'Backup restore verified.' : 'Backup restore verification pending.'}</p>}
      <div className="mt-5 rounded-xl border border-line p-4">
        <h3 className="text-sm font-bold text-fg">Usage against plan</h3>
        <div className="mt-4 grid gap-x-5 gap-y-4 sm:grid-cols-2">
          {PLATFORM_METERS.map(({ key, label }) => <UsageMeter key={key} resource={key} label={label} meter={org.licensing?.resources?.[key]} variant="brand" />)}
        </div>
      </div>
      <div className="mt-5 flex flex-wrap gap-2 border-t border-line pt-4">
        <button type="button" disabled={busy || org.provisioningStatus==='maintenance'} className="nf-button" onClick={() => { onClose(); onReset() }}>Reset admin password</button>
        {Number(org.limits?.maxStorageMb) > 0 && <button type="button" disabled={busy || org.provisioningStatus==='maintenance'} className="nf-button" onClick={() => { onClose(); onStorage() }}>Storage extension</button>}
        <button type="button" disabled={busy} className={`nf-button ${org.status === 'active' ? 'text-danger-fg' : 'text-success-fg'}`} onClick={() => { onClose(); onToggle() }}>{org.provisioningStatus === 'maintenance' ? 'Restore archive' : org.status === 'active' ? 'Suspend organization' : 'Activate organization'}</button>
        <button type="button" disabled={busy || org.provisioningStatus==='maintenance'} className="nf-button text-danger-fg" onClick={() => { onClose(); onDelete() }}>{org.schemaName ? 'Archive organization' : 'Delete organization'}</button>
      </div>
    {org.schemaName && org.provisioningStatus === 'ready' && <OrganizationStorage key={org._id} orgId={org._id} />}
    </Modal>
  )
}

function OrgCardSkeleton() {
  return (
    <div className="bg-surface border border-line rounded-xl p-4 animate-pulse space-y-4">
      <div className="flex gap-3">
        <div className="w-10 h-10 rounded-lg bg-surface-3" />
        <div className="flex-1 space-y-2">
          <div className="h-3.5 w-1/2 rounded bg-surface-3" />
          <div className="h-3 w-1/3 rounded bg-surface-3" />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="h-8 rounded bg-surface-3" />
        <div className="h-8 rounded bg-surface-3" />
      </div>
      <div className="space-y-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-3 rounded bg-surface-3" />
        ))}
      </div>
    </div>
  )
}

function PlatformMetric({ label, value, helper, icon: Icon, tone = 'blue' }) {
  const tones = {
    blue: ['bg-[#e7eef8] text-[#245a9a]', 'bg-[#eaf1f8]'],
    green: ['bg-success-subtle text-success-fg', 'bg-[#eaf3ed]'],
    amber: ['bg-warning-subtle text-warning-fg', 'bg-[#faf1df]'],
    red: ['bg-danger-subtle text-danger-fg', 'bg-[#fbefec]']
  }
  const selected = tones[tone] || tones.blue
  return (
    <article className="relative min-h-[120px] overflow-hidden rounded-xl border border-line bg-surface p-4 shadow-sm">
      <span className={`absolute -bottom-9 -right-7 h-24 w-24 rounded-full ${selected[1]}`} aria-hidden="true" />
      <div className="relative z-[1] flex h-full flex-col">
        <div className="flex items-start justify-between gap-3"><p className="m-0 pt-1 text-xs font-medium text-fg-muted">{label}</p><span className={`flex h-9 w-9 items-center justify-center rounded-[10px] ${selected[0]}`}><Icon aria-hidden className="h-[18px] w-[18px]" strokeWidth={1.8} /></span></div>
        <p className="m-0 mt-3 text-[26px] font-bold leading-none tracking-[-0.035em] text-fg tabular-nums">{value}</p>
        <p className="m-0 mt-2 max-w-[90%] text-[11px] leading-tight text-fg-muted">{helper}</p>
      </div>
    </article>
  )
}

export default function PlatformPanel() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [orgs, setOrgs] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [dialog, setDialog] = useState(() => searchParams.get('new') === '1' ? 'create' : null)
  const [busyId, setBusyId] = useState(null)
  const [creds, setCreds] = useState(null)        // one-time creds modal
  const [reviewTarget, setReviewTarget] = useState(null)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [storageTarget, setStorageTarget] = useState(null)
  const [summary, setSummary] = useState({ total: 0, healthy: 0, expiringSoon: 0, needsAttention: 0 })
  const [pagination, setPagination] = useState({ page: 1, limit: PAGE_SIZE, total: 0, totalPages: 1 })
  const [planFilterOptions, setPlanFilterOptions] = useState(() => (
    Object.entries(PLAN_LABELS).map(([key, label]) => ({ key, label }))
  ))
  const requestIdRef = useRef(0)

  const search = searchParams.get('q') || ''
  const statusFilter = searchParams.get('status') || 'all'
  const planFilter = searchParams.get('plan') || 'all'
  const healthFilter = searchParams.get('health') || 'all'
  const sort = searchParams.get('sort') || 'risk'
  const requestedPage = Math.max(1, Number.parseInt(searchParams.get('page'), 10) || 1)

  const updateQuery = useCallback((updates) => {
    const next = new URLSearchParams(searchParams)
    Object.entries(updates).forEach(([key, value]) => {
      const isDefault = value === undefined || value === null || value === '' ||
        value === 'all' || (key === 'sort' && value === 'risk') || (key === 'page' && Number(value) === 1)
      if (isDefault) next.delete(key)
      else next.set(key, String(value))
    })
    setSearchParams(next, { replace: true })
  }, [searchParams, setSearchParams])

  const load = useCallback(async () => {
    const requestId = ++requestIdRef.current
    setError('')
    setLoading(true)
    const query = new URLSearchParams({
      page: String(requestedPage),
      limit: String(PAGE_SIZE),
      sort
    })
    if (search.trim()) query.set('q', search.trim())
    if (statusFilter !== 'all') query.set('status', statusFilter)
    if (planFilter !== 'all') query.set('plan', planFilter)
    if (healthFilter !== 'all') query.set('health', healthFilter)

    try {
      const data = await api.get(`/api/platform/orgs?${query.toString()}`)
      if (requestId !== requestIdRef.current) return
      setOrgs(data.orgs || [])
      setSummary(data.summary || { total: 0, healthy: 0, expiringSoon: 0, needsAttention: 0 })
      setPagination(data.pagination || { page: 1, limit: PAGE_SIZE, total: data.orgs?.length || 0, totalPages: 1 })
      if (data.filterOptions?.plans?.length) setPlanFilterOptions(data.filterOptions.plans)
      if (data.pagination?.page && data.pagination.page !== requestedPage) {
        updateQuery({ page: data.pagination.page })
      }
    } catch (err) {
      if (requestId !== requestIdRef.current) return
      const msg = err.message || 'Could not load organizations'
      setError(msg)
      toast.error(msg)
    } finally {
      if (requestId === requestIdRef.current) setLoading(false)
    }
  }, [healthFilter, planFilter, requestedPage, search, sort, statusFilter, updateQuery])

  useEffect(() => {
    const timer = window.setTimeout(load, search.trim() ? 250 : 0)
    return () => window.clearTimeout(timer)
  }, [load, search])

  useEffect(() => {
    if (searchParams.get('new') !== '1') return
    const timer = setTimeout(() => {
      setDialog('create')
      const next = new URLSearchParams(searchParams)
      next.delete('new')
      setSearchParams(next, { replace: true })
    }, 0)
    return () => clearTimeout(timer)
  }, [searchParams, setSearchParams])

  const hasFilters = Boolean(search.trim()) || statusFilter !== 'all' || planFilter !== 'all' || healthFilter !== 'all' || sort !== 'risk'
  const clearFilters = () => {
    const next = new URLSearchParams(searchParams)
    ;['q', 'status', 'plan', 'health', 'sort', 'page'].forEach((key) => next.delete(key))
    setSearchParams(next, { replace: true })
  }

  const handleSaved = (res) => {
    setDialog(null)
    load()
    if (res?.admin?.tempPassword) {
      setCreds({
        title: 'Organization created',
        email: res.admin.email,
        tempPassword: res.admin.tempPassword,
        warning: res.admin.warning
      })
    }
  }

  const toggleStatus = async (org) => {
    if(org.provisioningStatus === 'maintenance') {
      setBusyId(org._id)
      try { await api.post(`/api/platform/orgs/${org._id}/restore-archive`); toast.success('Archive restored. Organization remains suspended.'); await load() }
      catch(err) {toast.error(err.message)} finally {setBusyId(null)}
      return
    }
    const suspend = org.status === 'active'
    if (suspend) {
      const ok = await confirm({
        title: `Suspend ${org.name}?`,
        message: 'Every user in this organization loses access until it is reactivated.',
        confirmLabel: 'Suspend',
        danger: true,
      })
      if (!ok) return
    }
    setBusyId(org._id)
    try {
      await api.post(`/api/platform/orgs/${org._id}/${suspend ? 'suspend' : 'activate'}`)
      toast.success(suspend ? `${org.name} suspended` : `${org.name} reactivated`)
      await load()
    } catch (err) {
      toast.error(err.message || 'Could not change the organization status')
    } finally {
      setBusyId(null)
    }
  }

  const resetAdminPassword = async (org) => {
    const ok = await confirm({
      title: 'Reset admin password?',
      message: `A new temporary password will be generated for ${org.admin?.email || 'the org admin'}, and their current sessions will end.`,
      confirmLabel: 'Reset password',
      danger: true
    })
    if (!ok) return
    setBusyId(org._id)
    try {
      const res = await api.post(`/api/platform/orgs/${org._id}/reset-admin-password`)
      setCreds({ title: 'New admin password', email: res.admin.email, tempPassword: res.admin.tempPassword })
    } catch (err) {
      toast.error(err.message || 'Could not reset the admin password')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <AppShell
      title="Organizations"
      subtitle="Manage tenant lifecycle, plan and licence assignment, usage, domains, and feature access."
      actions={
        <button
          onClick={() => setDialog('create')}
          className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 shadow-sm transition"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 5v14M5 12h14" />
          </svg>
          Create organization
        </button>
      }
    >
      {error && (
        <AlertBanner className="mb-4" onRetry={() => { setLoading(true); load() }}>
          {error}
        </AlertBanner>
      )}

      <div className="mb-4 grid grid-cols-2 gap-3 xl:grid-cols-4">
        <PlatformMetric label="Organizations" value={loading ? '—' : summary.total} helper="All tenant workspaces" icon={Building2} />
        <PlatformMetric label="Healthy" value={loading ? '—' : summary.healthy} helper="No licence or usage risk" icon={Check} tone="green" />
        <PlatformMetric label="Expiring soon" value={loading ? '—' : summary.expiringSoon} helper="Writable licences with 0–30 days left" icon={Clock3} tone="amber" />
        <PlatformMetric label="Needs attention" value={loading ? '—' : summary.needsAttention} helper="Unique workspaces requiring action" icon={AlertTriangle} tone="red" />
      </div>

      <section className="min-w-0" aria-label="Organization list">
        <div className="flex flex-wrap items-center gap-2 border-b border-line py-3">
          <div className="relative min-w-[220px] flex-1 xl:max-w-sm">
          <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 text-fg-subtle absolute left-3 top-1/2 -translate-y-1/2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M17 10a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="search"
            value={search}
            onChange={(e) => updateQuery({ q: e.target.value, page: 1 })}
            placeholder="Search name, subdomain, domain or admin…"
            aria-label="Search organizations"
            className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-line bg-surface-2 focus:bg-surface focus:outline-none focus:ring-2 focus:ring-indigo-200 focus:border-indigo-300 transition"
          />
          </div>
          <select
          value={statusFilter}
          onChange={(e) => updateQuery({ status: e.target.value, page: 1 })}
          aria-label="Filter by status"
          className="px-3 py-2 text-sm rounded-lg border border-line bg-surface focus:outline-none focus:ring-2 focus:ring-indigo-200 focus:border-indigo-300"
        >
          <option value="all">All statuses</option>
          <option value="active">Active</option>
          <option value="suspended">Suspended</option>
          </select>
          <select
          value={planFilter}
          onChange={(e) => updateQuery({ plan: e.target.value, page: 1 })}
          aria-label="Filter by plan"
          className="px-3 py-2 text-sm rounded-lg border border-line bg-surface focus:outline-none focus:ring-2 focus:ring-indigo-200 focus:border-indigo-300"
        >
          <option value="all">All plans</option>
          {planFilterOptions.map(({ key, label }) => (
            <option key={key} value={key}>{label}</option>
          ))}
          </select>
          <select
            value={healthFilter}
            onChange={(e) => updateQuery({ health: e.target.value, page: 1 })}
            aria-label="Filter by health"
            className="px-3 py-2 text-sm rounded-lg border border-line bg-surface focus:outline-none focus:ring-2 focus:ring-indigo-200 focus:border-indigo-300"
          >
            <option value="all">All health</option>
            <option value="attention">Needs attention</option>
            <option value="expiring">Expiring soon</option>
            <option value="read_only">Read-only</option>
            <option value="over_limit">Over limit</option>
          </select>
          <select
            value={sort}
            onChange={(e) => updateQuery({ sort: e.target.value, page: 1 })}
            aria-label="Sort organizations"
            className="px-3 py-2 text-sm rounded-lg border border-line bg-surface focus:outline-none focus:ring-2 focus:ring-indigo-200 focus:border-indigo-300"
          >
            <option value="risk">Risk first</option>
            <option value="name">Name A–Z</option>
            <option value="expiry">Expiry soonest</option>
            <option value="usage">Usage high–low</option>
          </select>
          {hasFilters && (
            <button
              type="button"
              onClick={clearFilters}
              className="text-xs px-3 py-2 rounded-lg text-fg-muted hover:text-fg hover:bg-surface-2 transition"
            >
              Clear filters
            </button>
          )}
          <span className="ml-auto whitespace-nowrap text-xs text-fg-muted" role="status" aria-live="polite">
            {loading ? 'Updating…' : `${pagination.total} ${pagination.total === 1 ? 'organization' : 'organizations'}`}
          </span>
        </div>

        {loading && orgs.length === 0 ? (
          <>
            <div className="grid grid-cols-1 gap-3 p-3 lg:hidden">
              {Array.from({ length: 4 }).map((_, i) => <OrgCardSkeleton key={i} />)}
            </div>
            <div className="hidden overflow-x-auto lg:block">
              <table className="w-full text-sm">
                <tbody className="divide-y divide-line">
                  {Array.from({ length: 5 }).map((_, i) => <TableRowSkeleton key={i} cols={6} />)}
                </tbody>
              </table>
            </div>
          </>
      ) : orgs.length === 0 ? (
        <div>
          <EmptyState
            title={hasFilters ? 'No organizations match your filters' : 'No organizations yet'}
            description={hasFilters
              ? 'Try a different search term or status.'
              : 'Create the first tenant to get started.'}
            action={hasFilters ? (
              <button
                type="button"
                onClick={clearFilters}
                className="px-4 py-2 rounded-md border border-line hover:bg-surface-2 text-sm font-medium text-fg transition"
              >
                Clear filters
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setDialog('create')}
                className="px-4 py-2 rounded-md bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 transition"
              >
                + New organization
              </button>
            )}
          />
        </div>
      ) : (
        <>
        <div className="grid grid-cols-1 gap-3 p-3 lg:hidden">
          {orgs.map((org) => (
            <OrgCard
              key={org._id}
              org={org}
              busy={busyId === org._id}
              onReview={() => setReviewTarget(org)}
              onEdit={() => setDialog(org)}
              onStorage={() => setStorageTarget(org)}
              onReset={() => resetAdminPassword(org)}
              onToggle={() => toggleStatus(org)}
              onDelete={() => setDeleteTarget(org)}
            />
          ))}
        </div>
        <div className="nf-forms-list-view mt-3.5 hidden lg:block">
            <table className="nf-forms-table nf-organizations-table" aria-label="Organizations">
              <colgroup><col className="w-[24%]" /><col className="w-[10%]" /><col className="w-[14%]" /><col className="w-[20%]" /><col className="w-[16%]" /><col className="w-[16%]" /></colgroup>
              <thead>
                <tr>
                  <th scope="col">Organization</th>
                  <th scope="col">Status</th>
                  <th scope="col">Plan &amp; licence</th>
                  <th scope="col">Usage health</th>
                  <th scope="col">Domains</th>
                  <th scope="col">Actions</th>
                </tr>
              </thead>
              <tbody>
                {orgs.map((org) => (
                  <tr key={org._id}>
                    <td>
                      <div className="nf-forms-cell-main">
                        <OrgAvatar name={org.name} seed={org._id || org.subdomain} compact />
                        <div className="nf-forms-cell-copy">
                          <strong className="nf-forms-cell-title" title={org.name}>{org.name}</strong>
                         
                          {org.admin?.email && (
                            <p className="nf-forms-cell-meta" title={org.admin.email}>Admin: {org.admin.email}</p>
                          )}
                        </div>
                      </div>
                    </td>
                    <td>
                      <StatusBadge status={org.status} provisioningStatus={org.provisioningStatus} />
                    </td>
                    <td>
                      <span className="font-semibold text-fg">{org.licensing?.licence?.planLabel || PLAN_LABELS[org.plan] || 'Custom'}</span>
                      {(() => {
                        const chip = licenceChip(org.licensing?.licence)
                        return chip ? <span className={`mt-1 block w-fit rounded border px-1.5 py-0.5 text-[10px] font-medium ${CHIP_CLASS[chip.tone]}`}>{chip.label}</span> : null
                      })()}
                    </td>
                    <td>
                      <UsageHealth org={org} />
                    </td>
                    <td className="nf-organizations-domains">
                      {(org.allowedDomains || []).length
                        ? (org.allowedDomains || []).slice(0, 1).map((d) => (
                            <span key={d} className="inline-block mr-1 mb-1 px-1.5 py-0.5 rounded bg-surface-3 text-fg-muted">@{d}</span>
                          ))
                        : <span className="text-fg-subtle">All email domains allowed</span>}
                      {(org.allowedDomains || []).length > 1 && <span className="text-[10px] text-fg-muted">+{org.allowedDomains.length - 1}</span>}
                    </td>
                    <td>
                      <div className="flex items-center justify-end gap-2">
                      <button type="button" onClick={() => setReviewTarget(org)} disabled={busyId === org._id} className="nf-button min-h-9 px-3 text-xs whitespace-nowrap">
                        View details
                      </button>
                      <OrganizationActionMenu
                        org={org}
                        busy={busyId === org._id}
                        onEdit={() => setDialog(org)}
                        onStorage={() => setStorageTarget(org)}
                        onReset={() => resetAdminPassword(org)}
                        onToggle={() => toggleStatus(org)}
                        onDelete={() => setDeleteTarget(org)}
                      />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
        </div>
        </>
      )}

        {!loading && pagination.totalPages > 1 && (
          <footer className="flex min-h-[58px] flex-wrap items-center justify-between gap-3 py-3">
            <span className="text-xs text-fg-muted">
              Showing {(pagination.page - 1) * pagination.limit + 1}–{Math.min(pagination.page * pagination.limit, pagination.total)} of {pagination.total}
            </span>
            <div className="flex items-center gap-2">
              <button type="button" className="nf-button min-h-9 px-3 text-xs" disabled={pagination.page <= 1} onClick={() => updateQuery({ page: pagination.page - 1 })}>Previous</button>
              <span className="inline-flex h-9 min-w-9 items-center justify-center rounded-lg border border-indigo-300 bg-indigo-50 px-2 text-sm font-semibold text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300">
                {pagination.page} of {pagination.totalPages}
              </span>
              <button type="button" className="nf-button min-h-9 px-3 text-xs" disabled={pagination.page >= pagination.totalPages} onClick={() => updateQuery({ page: pagination.page + 1 })}>Next</button>
            </div>
          </footer>
        )}
      </section>

      {dialog && (
        <OrgDialog
          org={dialog === 'create' ? null : dialog}
          onClose={() => setDialog(null)}
          onSaved={handleSaved}
        />
      )}
      {reviewTarget && (
        <OrgReviewDialog
          org={reviewTarget}
          busy={busyId === reviewTarget._id}
          onClose={() => setReviewTarget(null)}
          onEdit={() => setDialog(reviewTarget)}
          onReset={() => resetAdminPassword(reviewTarget)}
          onToggle={() => toggleStatus(reviewTarget)}
          onStorage={() => setStorageTarget(reviewTarget)}
          onDelete={() => setDeleteTarget(reviewTarget)}
        />
      )}
      {creds && <CredsModal data={creds} onClose={() => setCreds(null)} />}
      {storageTarget && (
        <StorageDialog
          org={storageTarget}
          onClose={() => setStorageTarget(null)}
          onSaved={() => { setStorageTarget(null); load() }}
        />
      )}
      {deleteTarget && (
        <DeleteDialog
          org={deleteTarget}
          onClose={() => setDeleteTarget(null)}
          onDeleted={() => { setDeleteTarget(null); load() }}
        />
      )}
    </AppShell>
  )
}
