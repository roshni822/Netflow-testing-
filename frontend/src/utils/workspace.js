// Multi-tenancy step 9 - utils/workspace.js
// Detects which organization workspace the browser is pointed at, so the login
// page can show the org and scope the login to it.
//
// Resolution order:
//   1. ?org=acme query param (or the older ?workspace= link).
//   2. Host subdomain — production (acme.netflow.app) or a working local
//      wildcard (acme.localhost).
// Login/recovery links carry this context explicitly. Previous browser visits
// must not silently select an account when the visible selector is absent.
//
// Returns the subdomain string (lowercased) or null for the bare/default domain.

const RESERVED = new Set(['www', 'api', 'app', 'admin', 'platform'])

// Hosting/platform domains that are the app's own infrastructure. The label in
// front (e.g. "net-flow-sw" in net-flow-sw.vercel.app) is a project name, not a
// tenant workspace — so these hosts resolve to the bare/default domain.
const PLATFORM_HOST_SUFFIXES = ['.vercel.app', '.onrender.com', '.netlify.app', '.pages.dev']

export const detectWorkspace = () => {
  // 1. Explicit ?org= (local dev).
  try {
    const params = new URLSearchParams(window.location.search)
    const q = params.get('org') || params.get('workspace')
    if (q && q.trim()) {
      const sub = q.trim().toLowerCase()
      return sub
    }
  } catch { /* ignore */ }

  // 2. Host subdomain.
  const host = String(window.location.hostname || '').toLowerCase()
  const isIp = /^\d+(\.\d+){3}$/.test(host)
  const isPlatformHost = PLATFORM_HOST_SUFFIXES.some((s) => host.endsWith(s))
  if (host && !isIp && !isPlatformHost) {
    // When VITE_ROOT_DOMAIN is configured, only its direct children are
    // workspaces (acme.netflow.app → "acme"); the apex is the default.
    const root = String(import.meta.env.VITE_ROOT_DOMAIN || '').toLowerCase().replace(/^\.+/, '')
    if (root) {
      if (host !== root && host.endsWith(`.${root}`)) {
        const label = host.slice(0, -(root.length + 1)).split('.').pop()
        if (label && !RESERVED.has(label)) return label
      }
    } else {
      const parts = host.split('.')
      const isLocal = host.endsWith('localhost')
      // acme.localhost → 2 parts; acme.netflow.app → 3 parts. Bare localhost and
      // apex domains (netflow.app) carry no workspace.
      const hasSub = isLocal ? parts.length >= 2 : parts.length >= 3
      if (hasSub) {
        const sub = parts[0]
        if (sub && sub !== 'localhost' && !RESERVED.has(sub)) return sub
      }
    }
  }

  return null
}
