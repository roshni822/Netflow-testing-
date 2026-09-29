// Shell scoping — middleware/shellScope.js
// Platform staff (SuperAdmin) operate the deployment; they never read or write
// a tenant's business data. The sidebar already hides those pages, but a
// hand-typed URL or a stale tab would still reach the API, so the same rule is
// enforced here: SuperAdmin may only call the platform console, auth, their own
// /users/me record and their notifications.

const PLATFORM_ALLOWED = [
  /^\/api\/platform(\/|$)/,
  /^\/api\/auth(\/|$)/,
  /^\/api\/users\/me(\/|$)/,
  /^\/api\/notifications(\/|$)/
]

// Returns a block descriptor when the caller is out of their shell, else null.
const checkShellScope = ({ user, path }) => {
  if (user?.role?.name !== 'SuperAdmin') return null

  const clean = String(path || '').split('?')[0]
  if (!clean.startsWith('/api/')) return null
  if (PLATFORM_ALLOWED.some((re) => re.test(clean))) return null

  return {
    status: 403,
    error: 'Platform administrators work in the platform console, not inside a workspace.',
    code: 'PLATFORM_SCOPE'
  }
}

module.exports = { checkShellScope, PLATFORM_ALLOWED }
