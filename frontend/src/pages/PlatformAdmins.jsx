// SuperAdmin — platform staff accounts (from /api/platform/admins)

import { useCallback, useEffect, useState } from 'react'
import AppShell from '../components/AppShell'
import { api } from '../utils/api'
import { toast } from '../lib/toastStore'
import { confirm } from '../lib/confirmStore'
import { AlertBanner } from '../components/Alert'
import EmptyState from '../components/EmptyState'
import Modal from '../components/Modal'
import { formatDateTime, isoAttr, relativeTime } from '../utils/datetime'

const copyToClipboard = (text) => {
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(text).then(() => toast.success('Copied')).catch(() => {})
  }
}

function CredsModal({ data, onClose }) {
  return (
    <Modal
      onClose={onClose}
      closeOnBackdrop={false}
      showClose={false}
      title={data.title || 'Admin credentials'}
      footer={
        <button
          type="button"
          onClick={onClose}
          className="px-4 py-2 text-sm font-medium bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition"
        >
          Done
        </button>
      }
    >
      <div className="space-y-4">
        <div className="p-3 rounded-lg bg-warning-subtle border border-warning-line text-warning-fg text-xs">
          Copy these now — the password won&rsquo;t be shown again. They must change it on first login.
        </div>
        <div className="space-y-2">
          <CredRow label="Login email" value={data.email} />
          <CredRow label="Temporary password" value={data.tempPassword} mono />
        </div>
      </div>
    </Modal>
  )
}

function CredRow({ label, value, mono }) {
  return (
    <div className="flex items-center justify-between gap-3 px-3 py-2 rounded-lg bg-surface-2 border border-line">
      <div className="min-w-0">
        <p className="text-[10px] uppercase tracking-wide text-fg-subtle">{label}</p>
        <p className={`text-sm text-fg truncate ${mono ? 'font-mono' : ''}`}>{value}</p>
      </div>
      <button
        type="button"
        onClick={() => copyToClipboard(value)}
        className="shrink-0 px-2 py-1 text-xs font-medium text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-500/10 rounded-md transition"
      >
        Copy
      </button>
    </div>
  )
}

function InviteDialog({ onClose, onCreated }) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [saving, setSaving] = useState(false)

  const submit = async (e) => {
    e.preventDefault()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      return toast.error('A valid email is required')
    }
    setSaving(true)
    try {
      const res = await api.post('/api/platform/admins', {
        name: name.trim(),
        email: email.trim().toLowerCase()
      })
      toast.success('Platform admin created')
      onCreated(res)
    } catch (err) {
      toast.error(err.message || 'Could not create admin')
    } finally {
      setSaving(false)
    }
  }

  const fieldCls = 'mt-1 w-full px-3 py-2 text-sm border border-line rounded-lg bg-surface-2 text-fg focus:outline-none focus:ring-2 focus:ring-indigo-300'

  return (
    <Modal
      onClose={onClose}
      title="Invite platform admin"
      description="Creates another SuperAdmin who can manage organizations across the deployment."
    >
      <form onSubmit={submit} className="space-y-3">
        <label className="block">
          <span className="text-xs font-medium text-fg-muted">Name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ops Admin" className={fieldCls} />
        </label>
        <label className="block">
          <span className="text-xs font-medium text-fg-muted">Email</span>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="ops@netflow.app"
            required
            className={fieldCls}
          />
        </label>
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm font-medium text-fg-muted hover:bg-surface-3 rounded-lg transition">
            Cancel
          </button>
          <button type="submit" disabled={saving} className="px-4 py-2 text-sm font-medium bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition disabled:opacity-60">
            {saving ? 'Creating…' : 'Create admin'}
          </button>
        </div>
      </form>
    </Modal>
  )
}

export default function PlatformAdmins() {
  const [admins, setAdmins] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [inviteOpen, setInviteOpen] = useState(false)
  const [creds, setCreds] = useState(null)
  const [busyId, setBusyId] = useState(null)

  const load = useCallback(async () => {
    setError('')
    setLoading(true)
    try {
      const data = await api.get('/api/platform/admins')
      setAdmins(data.admins || [])
    } catch (err) {
      setError(err.message || 'Could not load admins')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(load, 0)
    return () => window.clearTimeout(timer)
  }, [load])

  const resetPassword = async (admin) => {
    const ok = await confirm({
      title: 'Reset password?',
      message: `A temporary password will be generated for ${admin.email}. Their current sessions will end.`,
      confirmLabel: 'Reset password',
      danger: true
    })
    if (!ok) return
    setBusyId(admin._id)
    try {
      const res = await api.post(`/api/platform/admins/${admin._id}/reset-password`)
      setCreds({
        title: 'New password',
        email: res.admin.email,
        tempPassword: res.admin.tempPassword
      })
    } catch (err) {
      toast.error(err.message || 'Could not reset password')
    } finally {
      setBusyId(null)
    }
  }

  const toggleActive = async (admin) => {
    const deactivate = admin.isActive
    if (deactivate) {
      const ok = await confirm({
        title: `Deactivate ${admin.name}?`,
        message: 'They will lose platform access until reactivated.',
        confirmLabel: 'Deactivate',
        danger: true
      })
      if (!ok) return
    }
    setBusyId(admin._id)
    try {
      await api.post(`/api/platform/admins/${admin._id}/${deactivate ? 'deactivate' : 'activate'}`)
      toast.success(deactivate ? 'Admin deactivated' : 'Admin reactivated')
      await load()
    } catch (err) {
      toast.error(err.message || 'Could not update admin')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <AppShell
      title="Platform administrators"
      subtitle="Manage privileged access, forced password changes, and account state."
      actions={
        <button
          type="button"
          onClick={() => setInviteOpen(true)}
          className="nf-button nf-button-primary"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 5v14M5 12h14" />
          </svg>
          Invite administrator
        </button>
      }
    >
      {error && (
        <AlertBanner className="mb-4" onRetry={load}>{error}</AlertBanner>
      )}


      <div className="bg-surface border border-line rounded-xl overflow-hidden shadow-sm">
        {loading ? (
          <div className="p-4 space-y-3 animate-pulse">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-14 rounded-lg bg-surface-3" />
            ))}
          </div>
        ) : admins.length === 0 ? (
          <EmptyState
            title="No custom platform admins"
            action={
              <button
                type="button"
                onClick={() => setInviteOpen(true)}
                className="px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 transition"
              >
                Invite admin
              </button>
            }
          />
        ) : (
          <div>
            <div className="hidden grid-cols-[2fr_.8fr_1.5fr_1fr_1.4fr] gap-4 border-b border-line bg-surface-3/80 px-4 py-3 lg:grid">
              {['Administrator', 'Status', 'Account flags', 'Last login', 'Actions'].map((label) => <span key={label} className="text-[10px] font-semibold uppercase tracking-[0.08em] text-fg-muted">{label}</span>)}
            </div>
            <ul className="divide-y divide-line">
            {admins.map((admin) => (
              <li key={admin._id} className="grid gap-3 px-4 py-3.5 transition hover:bg-surface-2/50 lg:grid-cols-[2fr_.8fr_1.5fr_1fr_1.4fr] lg:items-center lg:gap-4">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="w-10 h-10 rounded-full bg-indigo-600 text-white text-sm font-semibold flex items-center justify-center shrink-0">
                    {String(admin.name || '?').split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase()}
                  </span>
                  <div className="min-w-0">
                    <p className="m-0 truncate text-sm font-semibold text-fg">{admin.name}</p>
                    <p className="text-xs text-fg-muted truncate">{admin.email}</p>
                  </div>
                </div>
                <div><span className={`inline-flex rounded-full px-2.5 py-1 text-[10px] font-semibold ${admin.isActive ? 'bg-success-subtle text-success-fg' : 'bg-danger-subtle text-danger-fg'}`}>{admin.isActive ? 'Active' : 'Inactive'}</span></div>
                <div className="flex flex-wrap gap-1.5">
                  {admin.isSelf && <span className="rounded-md bg-indigo-50 px-1.5 py-0.5 text-[10px] font-medium text-indigo-700">You</span>}
                  {admin.isProtected && <span className="rounded-md bg-surface-3 px-1.5 py-0.5 text-[10px] font-medium text-fg-muted">Seeded</span>}
                  {admin.mustChangePassword && <span className="rounded-md bg-warning-subtle px-1.5 py-0.5 text-[10px] font-medium text-warning-fg">Must change password</span>}
                  {!admin.isSelf && !admin.isProtected && !admin.mustChangePassword && <span className="text-xs text-fg-subtle">—</span>}
                </div>
                <div className="text-xs text-fg-muted">{admin.lastLogin ? <time dateTime={isoAttr(admin.lastLogin)} title={formatDateTime(admin.lastLogin)}>{relativeTime(admin.lastLogin)}</time> : 'Never'}</div>
                <div className="flex items-center gap-1.5 lg:justify-end">
                  <button
                    type="button"
                    disabled={busyId === admin._id}
                    onClick={() => resetPassword(admin)}
                    className="rounded-md border border-line px-2.5 py-1.5 text-xs font-medium text-fg hover:bg-surface-2 transition disabled:opacity-60"
                  >
                    Reset password
                  </button>
                  {!admin.isSelf && !admin.isProtected && (
                    <button
                      type="button"
                      disabled={busyId === admin._id}
                      onClick={() => toggleActive(admin)}
                      className={`rounded-md px-2.5 py-1.5 text-xs font-medium transition disabled:opacity-60 ${
                        admin.isActive
                          ? 'text-danger-fg hover:bg-danger-subtle'
                          : 'text-success-fg hover:bg-success-subtle'
                      }`}
                    >
                      {admin.isActive ? 'Deactivate' : 'Activate'}
                    </button>
                  )}
                </div>
              </li>
            ))}
            </ul>
          </div>
        )}
      </div>

      {inviteOpen && (
        <InviteDialog
          onClose={() => setInviteOpen(false)}
          onCreated={(res) => {
            setInviteOpen(false)
            load()
            if (res?.admin?.tempPassword) {
              setCreds({
                title: 'Platform admin created',
                email: res.admin.email,
                tempPassword: res.admin.tempPassword
              })
            }
          }}
        />
      )}
      {creds && <CredsModal data={creds} onClose={() => setCreds(null)} />}
    </AppShell>
  )
}
