import { useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  FileText,
  LoaderCircle,
  Mail,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Workflow,
} from 'lucide-react'
import { api } from '../utils/api'
import { detectWorkspace } from '../utils/workspace'

function BrandLockup() {
  return (
    <div className="nf-login-brand">
      <Link to="/">
        <img className="nf-login-brand-mark" src="/netflow-icon.png" alt="" />
      </Link>
      <span>
        <strong>NetFlow</strong>
        <small>AI Powered IT Service Management</small>
      </span>
    </div>
  )
}

function ProductFeature({ icon: Icon, title, children }) {
  return (
    <div className="nf-login-feature">
      <span className="nf-login-feature-icon"><Icon aria-hidden="true" /></span>
      <span>
        <strong>{title}</strong>
        <small>{children}</small>
      </span>
    </div>
  )
}

function ProductOverview() {
  return (
    <aside className="nf-saas-login-product" aria-label="NetFlow product overview">
      <div className="nf-saas-login-dots" aria-hidden="true" />
      <div className="nf-saas-login-orb" aria-hidden="true" />
      <div className="relative z-10">
        <BrandLockup />
      </div>

      <div className="nf-saas-login-product-content">
        <p className="nf-saas-login-kicker">
          <Sparkles aria-hidden="true" />
          Manual Control • AI Assistance • Automation
        </p>
        <h2>
          One place to build,
          <span className="nf-saas-login-headline-line"><em>automate</em>, approve,</span>
          <span className="nf-saas-login-headline-line">and track work</span>
        </h2>
        <p className="nf-saas-login-product-copy">
          Create forms and workflows your way—build manually for complete control, use AI to get started faster,
          or combine both for the perfect process.
        </p>

        <div className="nf-saas-login-features">
          <ProductFeature icon={FileText} title="Build Your Way">Design custom forms and workflows step by step.</ProductFeature>
          <ProductFeature icon={Sparkles} title="Create with AI">Describe your process and let AI create a structured starting point.</ProductFeature>
          <ProductFeature icon={Workflow} title="Automate and Track">Route approvals, assign ownership, and monitor every step.</ProductFeature>
        </div>

        <p className="nf-saas-login-assurance">
          <Check aria-hidden="true" />
          Start manually, start with AI, or seamlessly combine both.
        </p>
      </div>

      <div className="nf-saas-login-wave" aria-hidden="true">
        <svg viewBox="0 0 1050 340" preserveAspectRatio="none">
          <defs>
            <linearGradient id="netflow-recovery-wave-soft" x1="0" y1="0" x2="1" y2=".8">
              <stop stopColor="var(--color-brand-100)" />
              <stop offset=".72" stopColor="var(--color-brand-50)" />
              <stop offset="1" stopColor="#F8F9FF" stopOpacity="0" />
            </linearGradient>
            <linearGradient id="netflow-recovery-wave-main" x1="0" y1=".25" x2=".88" y2="1">
              <stop stopColor="var(--color-primary)" />
              <stop offset=".5" stopColor="var(--color-brand-500)" />
              <stop offset="1" stopColor="var(--color-primary-line)" stopOpacity=".18" />
            </linearGradient>
          </defs>
          <path d="M0 10C152 43 246 168 405 215C570 264 690 199 816 222C915 240 985 286 1050 306V340H0Z" fill="url(#netflow-recovery-wave-soft)" />
          <path d="M0 83C159 66 274 157 431 237C585 315 738 322 900 340H0Z" fill="var(--color-brand-300)" fillOpacity=".4" />
          <path d="M0 101C145 79 266 151 427 238C585 324 724 334 858 340H0Z" fill="url(#netflow-recovery-wave-main)" />
          <path d="M0 146C151 119 282 171 430 253C565 328 654 338 738 340H0Z" fill="var(--color-primary-active)" fillOpacity=".82" />
          <path d="M0 86C181 60 286 125 426 196C579 274 744 306 955 340" fill="none" stroke="var(--color-brand-400)" strokeOpacity=".34" strokeWidth="1.5" />
        </svg>
      </div>
    </aside>
  )
}

export default function ForgotPassword() {
  const [email, setEmail] = useState('')
  const [workspace] = useState(() => new URLSearchParams(window.location.search).get('accountScope') === 'platform' ? null : detectWorkspace())
  const [accountScope] = useState(() => new URLSearchParams(window.location.search).get('accountScope') === 'platform' ? 'platform' : workspace ? 'tenant' : '')
  const loginPath = '/login?' + new URLSearchParams({ ...(accountScope ? { accountScope } : {}), ...(workspace ? { org: workspace } : {}) })
  const [emailError, setEmailError] = useState('')
  const [serverError, setServerError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [sent, setSent] = useState(false)

  const handleSubmit = async (event) => {
    event.preventDefault()
    const value = email.trim()
    if (!value) return setEmailError('Email is required')
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return setEmailError('Enter a valid email address')
    setSubmitting(true)
    setEmailError('')
    setServerError('')
    try {
      await api.post('/api/auth/forgot-password', { email: value, ...(accountScope ? { accountScope } : {}), ...(accountScope === 'tenant' ? { subdomain: workspace } : {}) }, { skipAuthRedirect: true })
      setSent(true)
    } catch (cause) {
      setServerError(cause.message || 'Something went wrong. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="nf-saas-login-page nf-saas-recovery-page">
      <ProductOverview />

      <main className="nf-saas-login-form-area">
        <div className="nf-saas-login-form-wrap nf-saas-recovery-wrap">
          <div className="nf-saas-login-mobile-brand lg:hidden">
            <BrandLockup />
          </div>

          <section className="nf-saas-login-card nf-saas-recovery-card" aria-labelledby="recovery-title">
            <p className="nf-saas-login-ai-badge">
              <ShieldCheck aria-hidden="true" />
              Secure Account Recovery
            </p>

            <h1 id="recovery-title" className="nf-saas-login-heading">
              {sent ? 'Check your inbox' : 'Reset your password'}
            </h1>
            <p className="nf-saas-login-subtitle">
              {sent
                ? 'If an eligible account exists, secure reset instructions are on the way.'
                : 'Enter your work email and we will send forgot password link to your email address!'}
            </p>

            {sent ? (
              <div className="nf-saas-recovery-result" role="status" aria-live="polite">
                <span className="nf-saas-recovery-result-icon"><CheckCircle2 aria-hidden="true" /></span>
                <div>
                  <h2>Reset instructions requested</h2>
                  <p>
                    If <strong>{email.trim()}</strong> belongs to an eligible account, the reset link will arrive shortly.
                    It expires in 30 minutes.
                  </p>
                </div>
                <Link to={loginPath} className="nf-saas-login-primary">
                  <span>Back to sign in</span>
                  <ArrowRight aria-hidden="true" />
                </Link>
                <p className="nf-saas-recovery-help">Can’t find the email? Check your spam folder or contact your workspace administrator.</p>
              </div>
            ) : (
              <>
                {serverError && (
                  <div className="nf-saas-login-alert nf-saas-login-alert-danger" role="alert" aria-live="assertive">
                    <ShieldAlert aria-hidden="true" />
                    <span>{serverError}</span>
                  </div>
                )}

                <form onSubmit={handleSubmit} noValidate className="nf-saas-login-form nf-saas-recovery-form" aria-busy={submitting}>
                  <div>
                    <label htmlFor="recovery-email" className="nf-saas-login-label">Work email</label>
                    <div className={`nf-saas-login-input ${emailError ? 'nf-saas-login-input-error' : ''}`}>
                      <Mail aria-hidden="true" />
                      <input
                        id="recovery-email"
                        name="email"
                        type="email"
                        autoComplete="email"
                        value={email}
                        onChange={(event) => {
                          setEmail(event.target.value)
                          setEmailError('')
                          setServerError('')
                        }}
                        placeholder="name@company.com"
                        aria-invalid={Boolean(emailError)}
                        aria-describedby={emailError ? 'recovery-email-error recovery-email-hint' : 'recovery-email-hint'}
                      />
                    </div>
                    {emailError && <p id="recovery-email-error" className="nf-saas-login-field-error">{emailError}</p>}
                    <p id="recovery-email-hint" className="nf-saas-recovery-field-hint">Use the email linked to your NetFlow workspace.</p>
                  </div>

                  <button type="submit" disabled={submitting} className="nf-saas-login-primary">
                    <span>{submitting ? 'Sending...' : 'Send Email'}</span>
                    {submitting ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : <ArrowRight aria-hidden="true" />}
                  </button>
                </form>

                <div className="nf-saas-recovery-note">
                  <ShieldCheck aria-hidden="true" />
                  <span>For your security, the reset link can only be used once and expires after 30 minutes.</span>
                </div>

                <Link to={loginPath} className="nf-saas-recovery-back">
                  <ArrowLeft aria-hidden="true" />
                  Back to sign in
                </Link>
              </>
            )}
          </section>
        </div>

        <div className="nf-saas-login-security">
          <ShieldCheck aria-hidden="true" />
          <span>Your data is secure with us.</span>
        </div>
      </main>
    </div>
  )
}
