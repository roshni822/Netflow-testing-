// Shared - localDraft.js
// The form and workflow builders keep everything in component state, so a
// refresh (or an accidental tab close) used to throw away every field or node
// the user had placed. These helpers mirror the in-progress state into
// localStorage and warn before the page unloads.
//
// Only create mode uses a local draft: when editing, the server copy is the
// source of truth and a stale local snapshot would silently win.

import { useEffect } from 'react'

const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000

export function createDraftStore(key, { maxAgeMs = MAX_AGE_MS } = {}) {
  return {
    read() {
      try {
        const parsed = JSON.parse(localStorage.getItem(key) || 'null')
        if (!parsed) return null
        if (Date.now() - (parsed.savedAt || 0) > maxAgeMs) return null
        return parsed
      } catch {
        return null
      }
    },
    write(payload) {
      try {
        localStorage.setItem(key, JSON.stringify({ ...payload, savedAt: Date.now() }))
      } catch {
        // Quota or private-mode failures shouldn't break the builder.
      }
    },
    clear() {
      try {
        localStorage.removeItem(key)
      } catch {
        // ignore
      }
    },
  }
}

// Browsers only show their own generic message here; the text is ignored.
export function useBeforeUnloadWarning(active) {
  useEffect(() => {
    if (!active) return undefined
    const handler = (e) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [active])
}
