import { useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowLeft, ArrowRight, LockKeyhole, ShieldAlert, ShieldCheck } from 'lucide-react'
import LoginLayout from '../components/LoginLayout'
import PasswordRequirements from '../components/PasswordRequirements'
import { getPasswordPolicy } from '../utils/passwordPolicy'
import { authStore, useUser } from '../utils/auth'
import { toast } from '../lib/toastStore'

export default function ChangePassword() {
  const navigate = useNavigate()
  const user = useUser()
  const forced = Boolean(user?.mustChangePassword)
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [show, setShow] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [touchedConfirm, setTouchedConfirm] = useState(false)
  const [touchedPassword, setTouchedPassword] = useState(false)
  const passwordRef = useRef(null)
  const confirmRef = useRef(null)
  const passwordPolicy = getPasswordPolicy(newPassword)
  const passwordError = passwordPolicy.error || (!forced && currentPassword && newPassword === currentPassword ? 'New password must be different from the current one' : '')
  const showPasswordError = touchedPassword && Boolean(passwordError)
  const mismatch = newPassword !== confirm
  const showMismatch = touchedConfirm && mismatch

  const submit = async (event) => {
    event.preventDefault()
    setError('')
    setTouchedConfirm(true)
    setTouchedPassword(true)
    if (!forced && !currentPassword) {
      event.currentTarget.elements.currentPassword.focus()
      return setError('Enter your current password')
    }
    if (passwordError) return passwordRef.current?.focus()
    if (mismatch) return confirmRef.current?.focus()
    setBusy(true)
    try {
      await authStore.changePassword(forced ? undefined : currentPassword, newPassword)
      toast.success('Password updated')
      navigate('/dashboard', { replace: true })
    } catch (cause) {
      setError(cause.message || 'Could not change the password')
    } finally {
      setBusy(false)
    }
  }

  const fieldClass = (invalid = false) => `nf-saas-login-input ${invalid ? 'nf-saas-login-input-error' : ''}`
  const title = forced ? 'Set a new password' : 'Change your password'

  return (
    <LoginLayout label={title}>
      <p className="nf-saas-login-ai-badge"><ShieldCheck aria-hidden="true" />{forced ? 'First sign-in security' : 'Account security'}</p>
      <h1 className="nf-saas-login-heading">{title}</h1>
      <p className="nf-saas-login-subtitle">{forced ? 'Replace the temporary password before entering your workspace.' : 'Confirm your current password, then choose a new secure password.'}</p>
      {error && <div id="change-password-error" className="nf-saas-login-alert nf-saas-login-alert-danger" role="alert"><ShieldAlert aria-hidden="true" /><span>{error}</span></div>}
      <form onSubmit={submit} className="nf-saas-login-form" aria-busy={busy}>
        {!forced && (
          <div>
            <label htmlFor="current-password" className="nf-saas-login-label">Current password</label>
            <div className={fieldClass(Boolean(error && !currentPassword))}>
              <LockKeyhole aria-hidden="true" />
              <input id="current-password" name="currentPassword" type={show ? 'text' : 'password'} value={currentPassword} onChange={(event) => { setCurrentPassword(event.target.value); setError('') }} autoComplete="current-password" placeholder="Enter your current password" aria-invalid={Boolean(error && !currentPassword)} aria-describedby={error ? 'change-password-error' : undefined} />
            </div>
          </div>
        )}
        <div>
          <label htmlFor="new-password" className="nf-saas-login-label">New password</label>
          <div className={fieldClass(showPasswordError)}>
            <LockKeyhole aria-hidden="true" />
            <input ref={passwordRef} id="new-password" name="newPassword" type={show ? 'text' : 'password'} value={newPassword} onChange={(event) => { setNewPassword(event.target.value); setError('') }} onBlur={() => setTouchedPassword(true)} autoComplete="new-password" placeholder="Enter your new password" aria-invalid={showPasswordError} aria-describedby={'new-password-hint' + (showPasswordError ? ' new-password-error' : '')} />
          </div>
          <PasswordRequirements id="new-password-hint" password={newPassword} />
          {showPasswordError && <p id="new-password-error" className="nf-saas-login-field-error" role="alert">{passwordError}</p>}
        </div>
        <div>
          <label htmlFor="confirm-password" className="nf-saas-login-label">Confirm new password</label>
          <div className={fieldClass(showMismatch)}>
            <LockKeyhole aria-hidden="true" />
            <input ref={confirmRef} id="confirm-password" name="confirmPassword" type={show ? 'text' : 'password'} value={confirm} onChange={(event) => { setConfirm(event.target.value); setTouchedConfirm(true); setError('') }} onBlur={() => setTouchedConfirm(true)} autoComplete="new-password" placeholder="Re-enter your new password" aria-invalid={showMismatch} aria-describedby={showMismatch ? 'confirm-password-error' : confirm && !mismatch ? 'confirm-password-match' : undefined} />
          </div>
          {showMismatch && <p id="confirm-password-error" className="nf-saas-login-field-error" role="alert">Passwords do not match</p>}
          {confirm && !mismatch && <p id="confirm-password-match" className="mt-1.5 text-xs text-emerald-700" role="status">Passwords match</p>}
        </div>
        <label className="flex min-h-8 w-fit cursor-pointer items-center gap-2 text-[11px] text-[var(--color-primary-active)]"><input type="checkbox" checked={show} onChange={(event) => setShow(event.target.checked)} className="h-4 w-4 rounded border-line accent-[var(--color-primary)]" />Show passwords</label>
        <button type="submit" disabled={busy} className="nf-saas-login-primary"><span>{busy ? 'Saving…' : forced ? 'Set password and continue' : 'Update password'}</span>{!busy && <ArrowRight aria-hidden="true" />}</button>
      </form>
      {!forced ? <Link to="/profile" className="nf-saas-login-back"><ArrowLeft aria-hidden="true" />Back to profile</Link> : <button type="button" onClick={() => authStore.logout().then(() => navigate('/login', { replace: true }))} className="nf-saas-login-back"><ArrowLeft aria-hidden="true" />Sign out</button>}
    </LoginLayout>
  )
}
