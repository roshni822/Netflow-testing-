import { useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import AuthLayout from '../components/AuthLayout'
import { setToken } from '../utils/api'
import { authStore } from '../utils/auth'

const parseHash = () => new URLSearchParams((window.location.hash || '').replace(/^#/, ''))

export default function OAuthCallback() {
  const navigate = useNavigate()
  const handled = useRef(false)

  useEffect(() => {
    if (handled.current) return
    handled.current = true
    const params = parseHash()
    const token = params.get('token')
    const ssoError = params.get('sso_error')
    if (window.history?.replaceState) window.history.replaceState(null, '', window.location.pathname)
    if (ssoError || !token) {
      navigate(`/login${ssoError ? `?sso_error=${encodeURIComponent(ssoError)}` : ''}`, { replace: true })
      return
    }
    ;(async () => {
      try {
        setToken(token)
        const user = await authStore.refresh()
        navigate(user ? '/dashboard' : '/login?sso_error=session', { replace: true })
      } catch {
        navigate('/login?sso_error=session', { replace: true })
      }
    })()
  }, [navigate])

  return (
    <AuthLayout eyebrow="Organization sign-in" title="Signing you in" description="NetFlow is verifying your identity provider response and opening the correct workspace." compact>
      <div className="rounded-xl border border-line bg-surface-2 p-4" role="status" aria-live="polite">
        <div className="mb-2 flex items-center justify-between gap-3 text-xs font-semibold text-fg-muted"><span>Secure session</span><span>Verifying…</span></div>
        <div className="h-2 overflow-hidden rounded-full bg-surface-3"><span className="block h-full w-2/3 animate-pulse rounded-full bg-indigo-600" /></div>
      </div>
    </AuthLayout>
  )
}
