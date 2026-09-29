// M1 - Phase 2 - Register.jsx - Wired to POST /api/auth/register

import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { authStore, DEPARTMENTS } from '../utils/auth'

function Register() {
  const navigate = useNavigate()
  const [form, setForm] = useState({
    firstName: '',
    lastName: '',
    email: '',
    department: DEPARTMENTS[0],
    password: '',
    agree: false
  })
  const [errors, setErrors] = useState({})
  const [showPassword, setShowPassword] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [serverError, setServerError] = useState('')

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target
    setForm((p) => ({ ...p, [name]: type === 'checkbox' ? checked : value }))
    setErrors((p) => ({ ...p, [name]: '' }))
    setServerError('')
  }

  const validate = () => {
    const next = {}
    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!form.firstName.trim()) next.firstName = 'First name is required'
    if (!form.lastName.trim()) next.lastName = 'Last name is required'
    if (!form.email.trim()) next.email = 'Work email is required'
    else if (!emailPattern.test(form.email)) next.email = 'Enter a valid email address'
    if (!form.password) next.password = 'Password is required'
    else if (form.password.length < 12) next.password = 'Password must be at least 12 characters'
    if (!form.agree) next.agree = 'You must agree to the terms'
    return next
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    const v = validate()
    setErrors(v)
    if (Object.keys(v).length > 0) return
    setSubmitting(true)
    setServerError('')
    try {
      await authStore.register({
        name: `${form.firstName.trim()} ${form.lastName.trim()}`,
        email: form.email.trim(),
        password: form.password,
        department: form.department
      })
      navigate('/dashboard')
    } catch (err) {
      setServerError(err.message || 'Registration failed')
    } finally {
      setSubmitting(false)
    }
  }

  const inputBase = 'w-full px-3 py-2.5 text-sm rounded-lg border focus:outline-none focus:ring-2 transition'
  const inputOk   = 'border-line focus:ring-indigo-200 focus:border-indigo-400'
  const inputErr  = 'border-red-300 focus:ring-red-200 focus:border-red-400'

  return (
    <div className="h-screen overflow-hidden flex bg-auth-bg">
      {/* ── Left branding panel ── */}
      <div className="hidden lg:flex flex-col justify-between w-1/2 px-14 py-12 bg-auth-bg">
        {/* Logo */}
        <div className="flex items-center gap-2.5">
          <img src="/netflow-icon.png" alt="" className="w-9 h-9 rounded-xl shadow" />
          <div>
            <span className="font-bold text-fg text-lg leading-none">NetFlow</span>
            <p className="text-[10px] text-fg-subtle leading-none mt-0.5">Automate. Orchestrate. Scale.</p>
          </div>
        </div>

        {/* Hero text */}
        <div className="mb-10">
          <h2 className="text-4xl font-extrabold text-fg leading-tight mb-3">
            Join your team.<br />
            <span className="text-indigo-600">Build workflows.</span><br />
            Move faster.
          </h2>
          <p className="text-fg-muted text-sm max-w-xs leading-relaxed">
            Create your account and start collaborating on automated approval workflows with your organization today.
          </p>

          {/* Feature pills */}
          <div className="mt-8 space-y-3">
            {[
              { icon: '⚡', text: 'Automated approval routing' },
              { icon: '🔔', text: 'Real-time task notifications' },
              { icon: '📊', text: 'Analytics & SLA tracking' },
            ].map(({ icon, text }) => (
              <div key={text} className="flex items-center gap-3 bg-surface/70 rounded-xl px-4 py-3 shadow-sm w-fit">
                <span className="text-lg">{icon}</span>
                <span className="text-sm font-medium text-fg">{text}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Right form panel ── */}
      <div className="flex flex-1 items-center overflow-hidden justify-center px-6 py-12 bg-surface lg:rounded-l-3xl shadow-2xl">
        <div className="w-full max-w-sm">
          {/* Mobile logo */}
          <div className="flex items-center gap-2 mb-6 lg:hidden">
            <img src="/netflow-icon.png" alt="" className="w-8 h-8 rounded-lg shadow-sm" />
            <span className="font-bold text-fg">NetFlow</span>
          </div>

          <h1 className="text-2xl font-bold text-fg">Create your account </h1>
          <p className="text-sm text-fg-muted mt-1 mb-7">Start building approval workflows today.</p>

          {serverError && (
            <div className="mb-4 p-3 rounded-lg bg-danger-subtle border border-danger-line text-danger-fg text-sm">
              {serverError}
            </div>
          )}

          <form onSubmit={handleSubmit} noValidate className="space-y-4">
            {/* Name row */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="firstName" className="block text-sm font-medium text-fg mb-1.5">First name</label>
                <input id="firstName" name="firstName" type="text" autoComplete="given-name"
                  value={form.firstName} onChange={handleChange} placeholder="Arjun"
                  className={`${inputBase} ${errors.firstName ? inputErr : inputOk}`} />
                {errors.firstName && <p className="mt-1 text-xs text-danger-fg">{errors.firstName}</p>}
              </div>
              <div>
                <label htmlFor="lastName" className="block text-sm font-medium text-fg mb-1.5">Last name</label>
                <input id="lastName" name="lastName" type="text" autoComplete="family-name"
                  value={form.lastName} onChange={handleChange} placeholder="Kumar"
                  className={`${inputBase} ${errors.lastName ? inputErr : inputOk}`} />
                {errors.lastName && <p className="mt-1 text-xs text-danger-fg">{errors.lastName}</p>}
              </div>
            </div>

            {/* Email */}
            <div>
              <label htmlFor="email" className="block text-sm font-medium text-fg mb-1.5">Work email</label>
              <div className="relative">
                <span className="absolute inset-y-0 left-3 flex items-center pointer-events-none text-fg-subtle">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                  </svg>
                </span>
                <input id="email" name="email" type="email" autoComplete="email"
                  value={form.email} onChange={handleChange} placeholder="you@company.com"
                  className={`${inputBase} pl-9 ${errors.email ? inputErr : inputOk}`} />
              </div>
              {errors.email && <p className="mt-1 text-xs text-danger-fg">{errors.email}</p>}
            </div>

            {/* Department */}
            <div>
              <label htmlFor="department" className="block text-sm font-medium text-fg mb-1.5">Department</label>
              <select id="department" name="department" value={form.department} onChange={handleChange}
                className={`${inputBase} ${inputOk} bg-surface`}>
                {DEPARTMENTS.map((d) => <option key={d}>{d}</option>)}
              </select>
            </div>

            {/* Password */}
            <div>
              <label htmlFor="password" className="block text-sm font-medium text-fg mb-1.5">Password</label>
              <div className="relative">
                <span className="absolute inset-y-0 left-3 flex items-center pointer-events-none text-fg-subtle">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                  </svg>
                </span>
                <input id="password" name="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="new-password"
                  value={form.password} onChange={handleChange} placeholder="Min 6 characters"
                  className={`${inputBase} pl-9 pr-14 ${errors.password ? inputErr : inputOk}`} />
                <button type="button" onClick={() => setShowPassword((s) => !s)}
                  className="absolute inset-y-0 right-3 text-xs font-semibold text-indigo-600 hover:text-indigo-800">
                  {showPassword ? 'Hide' : 'Show'}
                </button>
              </div>
              {errors.password && <p className="mt-1 text-xs text-danger-fg">{errors.password}</p>}
            </div>

            {/* Terms */}
            <div>
              <label className="flex items-start gap-2 text-sm text-fg-muted select-none cursor-pointer">
                <input type="checkbox" name="agree" checked={form.agree} onChange={handleChange}
                  className="w-4 h-4 mt-0.5 rounded border-line text-indigo-600 focus:ring-indigo-400 flex-shrink-0" />
                <span>
                  I agree to the{' '}
                  <a href="#" className="text-indigo-600 hover:text-indigo-800 font-medium">Terms of Service</a>
                  {' '}and{' '}
                  <a href="#" className="text-indigo-600 hover:text-indigo-800 font-medium">Privacy Policy</a>
                </span>
              </label>
              {errors.agree && <p className="mt-1 text-xs text-danger-fg">{errors.agree}</p>}
            </div>

            <button type="submit" disabled={submitting}
              className="w-full py-2.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 disabled:opacity-60 disabled:cursor-not-allowed text-white text-sm font-semibold shadow transition">
              {submitting ? 'Creating account…' : 'Create account'}
            </button>
          </form>

          {/* Divider */}
          <div className="flex items-center gap-3 my-5">
            <hr className="flex-1 border-line" />
            <span className="text-xs text-fg-subtle">or</span>
            <hr className="flex-1 border-line" />
          </div>

 

          <p className="text-center text-sm text-fg-muted mt-6">
            Already have an account?{' '}
            <Link to="/login" className="text-indigo-600 hover:text-indigo-800 font-semibold">Sign in</Link>
          </p>
        </div>
      </div>
    </div>
  )
}

export default Register
