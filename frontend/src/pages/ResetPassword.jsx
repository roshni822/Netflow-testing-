import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowRight, Eye, EyeOff, LoaderCircle, LockKeyhole, ShieldAlert, ShieldCheck } from 'lucide-react'
import LoginLayout from '../components/LoginLayout'
import PasswordRequirements from '../components/PasswordRequirements'
import { getPasswordPolicy } from '../utils/passwordPolicy'
import { api } from '../utils/api'

function ResetLayout({ title, description, children, eyebrow = 'Secure reset' }) {
  return (
    <LoginLayout label={title}>
      <p className="nf-saas-login-ai-badge"><ShieldCheck aria-hidden="true" />{eyebrow}</p>
      <h1 className="nf-saas-login-heading">{title}</h1>
      <p className="nf-saas-login-subtitle break-words">{description}</p>
      {children}
    </LoginLayout>
  )
}

export default function ResetPassword() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const token = params.get('token') || ''
  const email = params.get('email') || ''
  const [checking, setChecking] = useState(() => Boolean(token && email))
  const [linkValid, setLinkValid] = useState(false)
  const [form, setForm] = useState({ password: '', confirm: '' })
  const [showPassword, setShowPassword] = useState(false)
  const [errors, setErrors] = useState({})
  const [serverError, setServerError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState(false)
  const [touchedPassword, setTouchedPassword] = useState(false)
  const [touchedConfirm, setTouchedConfirm] = useState(false)
  const passwordRef = useRef(null)
  const confirmRef = useRef(null)
  const passwordPolicy = getPasswordPolicy(form.password)
  const passwordError = errors.password || (touchedPassword ? passwordPolicy.error : '')
  const confirmError = errors.confirm || (touchedConfirm && form.confirm !== form.password ? 'Passwords do not match' : '')

  useEffect(() => {
    let active = true
    if (!token || !email) {
      return undefined
    }
    api.get(`/api/auth/reset-password/validate?token=${encodeURIComponent(token)}&email=${encodeURIComponent(email)}`, { skipAuthRedirect: true })
      .then((data) => { if (active) setLinkValid(Boolean(data.valid)) })
      .catch(() => { if (active) setLinkValid(false) })
      .finally(() => { if (active) setChecking(false) })
    return () => { active = false }
  }, [token, email])

  const handleChange = (event) => {
    const { name, value } = event.target
    setForm((current) => ({ ...current, [name]: value }))
    setErrors({})
    if (name === 'confirm') setTouchedConfirm(true)
    setServerError('')
  }

  const handleSubmit = async (event) => {
    event.preventDefault()
    setTouchedPassword(true)
    setTouchedConfirm(true)
    const next = {}
    if (!passwordPolicy.valid) next.password = passwordPolicy.error
    if (form.confirm !== form.password) next.confirm = 'Passwords do not match'
    setErrors(next)
    if (Object.keys(next).length) {
      if (next.password) passwordRef.current?.focus()
      else confirmRef.current?.focus()
      return
    }
    setSubmitting(true)
    setServerError('')
    try {
      await api.post('/api/auth/reset-password', { token, email, password: form.password }, { skipAuthRedirect: true })
      setDone(true)
      setTimeout(() => navigate('/login'), 2500)
    } catch (cause) {
      setServerError(cause.message || 'Could not reset password. Please request a new link.')
    } finally {
      setSubmitting(false)
    }
  }

  if (checking) {
    return <ResetLayout title="Checking your reset link" description="We are confirming that this password reset request is still valid."><div role="status" className="mt-6 flex items-center gap-2 text-xs text-[var(--color-primary-active)]"><LoaderCircle aria-hidden="true" className="h-4 w-4 animate-spin motion-reduce:animate-none" />Checking link…</div></ResetLayout>
  }

  if (!linkValid) {
    return <ResetLayout title="Link expired or invalid" description="Reset links expire after 30 minutes and can only be used once."><Link to="/forgot-password" className="nf-saas-login-primary mt-6">Request a new link<ArrowRight aria-hidden="true" /></Link></ResetLayout>
  }

  if (done) {
    return <ResetLayout eyebrow="Password updated" title="Your password is ready" description="The new password has been saved securely. You will be redirected to sign in."><Link to="/login" className="nf-saas-login-primary mt-6">Go to sign in<ArrowRight aria-hidden="true" /></Link></ResetLayout>
  }

  return (
    <ResetLayout title="Create a new password" description={<>Choose a strong password for <strong>{email}</strong>.</>}>
      {serverError && <div className="nf-saas-login-alert nf-saas-login-alert-danger" role="alert"><ShieldAlert aria-hidden="true" /><span>{serverError}</span></div>}
      <form onSubmit={handleSubmit} noValidate className="nf-saas-login-form" aria-busy={submitting}>
        <div>
          <label htmlFor="password" className="nf-saas-login-label">New password</label>
          <div className={`nf-saas-login-input ${passwordError ? 'nf-saas-login-input-error' : ''}`}>
            <LockKeyhole aria-hidden="true" />
            <input ref={passwordRef} id="password" name="password" type={showPassword ? 'text' : 'password'} autoComplete="new-password" value={form.password} onChange={handleChange} onBlur={() => setTouchedPassword(true)} placeholder="Enter your new password" aria-invalid={Boolean(passwordError)} aria-describedby={'password-hint' + (passwordError ? ' password-error' : '')} />
            <button type="button" onClick={() => setShowPassword((current) => !current)} className="nf-saas-password-toggle" aria-label={showPassword ? 'Hide passwords' : 'Show passwords'} aria-pressed={showPassword}>{showPassword ? <Eye aria-hidden="true" /> : <EyeOff aria-hidden="true" />}</button>
          </div>
          <PasswordRequirements id="password-hint" password={form.password} />
          {passwordError && <p id="password-error" className="nf-saas-login-field-error" role="alert">{passwordError}</p>}
        </div>
        <div>
          <label htmlFor="confirm" className="nf-saas-login-label">Confirm password</label>
          <div className={`nf-saas-login-input ${confirmError ? 'nf-saas-login-input-error' : ''}`}>
            <LockKeyhole aria-hidden="true" />
            <input ref={confirmRef} id="confirm" name="confirm" type={showPassword ? 'text' : 'password'} autoComplete="new-password" value={form.confirm} onChange={handleChange} onBlur={() => setTouchedConfirm(true)} placeholder="Re-enter your new password" aria-invalid={Boolean(confirmError)} aria-describedby={confirmError ? 'confirm-error' : form.confirm && form.confirm === form.password ? 'confirm-match' : undefined} />
          </div>
          {confirmError && <p id="confirm-error" className="nf-saas-login-field-error" role="alert">{confirmError}</p>}
          {form.confirm && form.confirm === form.password && <p id="confirm-match" className="mt-1.5 text-xs text-emerald-700" role="status">Passwords match</p>}
        </div>
        <button type="submit" disabled={submitting} className="nf-saas-login-primary"><span>{submitting ? 'Updating…' : 'Update password'}</span>{!submitting && <ArrowRight aria-hidden="true" />}</button>
      </form>
    </ResetLayout>
  )
}
