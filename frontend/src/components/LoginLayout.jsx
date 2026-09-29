import { Link } from 'react-router-dom'
import { Check, FileText, ShieldCheck, Sparkles, Workflow } from 'lucide-react'

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

// Shared presentation only. Authentication state and actions stay in each page.
export default function LoginLayout({ children, label = 'Sign in to NetFlow' }) {
  return (
    <div className="nf-saas-login-page">
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
              <linearGradient id="netflow-wave-soft" x1="0" y1="0" x2="1" y2=".8">
                <stop stopColor="var(--color-brand-100)" />
                <stop offset=".72" stopColor="var(--color-brand-50)" />
                <stop offset="1" stopColor="#F8F9FF" stopOpacity="0" />
              </linearGradient>
              <linearGradient id="netflow-wave-main" x1="0" y1=".25" x2=".88" y2="1">
                <stop stopColor="var(--color-primary)" />
                <stop offset=".5" stopColor="var(--color-brand-500)" />
                <stop offset="1" stopColor="var(--color-primary-line)" stopOpacity=".18" />
              </linearGradient>
            </defs>
            <path d="M0 10C152 43 246 168 405 215C570 264 690 199 816 222C915 240 985 286 1050 306V340H0Z" fill="url(#netflow-wave-soft)" />
            <path d="M0 83C159 66 274 157 431 237C585 315 738 322 900 340H0Z" fill="var(--color-brand-300)" fillOpacity=".4" />
            <path d="M0 101C145 79 266 151 427 238C585 324 724 334 858 340H0Z" fill="url(#netflow-wave-main)" />
            <path d="M0 146C151 119 282 171 430 253C565 328 654 338 738 340H0Z" fill="var(--color-primary-active)" fillOpacity=".82" />
            <path d="M0 86C181 60 286 125 426 196C579 274 744 306 955 340" fill="none" stroke="var(--color-brand-400)" strokeOpacity=".34" strokeWidth="1.5" />
          </svg>
        </div>
      </aside>

      <main className="nf-saas-login-form-area">
        <div className="nf-saas-login-form-wrap">
          <div className="nf-saas-login-mobile-brand lg:hidden">
            <BrandLockup />
          </div>
          <section className="nf-saas-login-card" aria-label={label}>

            {children}
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
