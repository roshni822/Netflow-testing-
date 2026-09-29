// Licensing Phase 4 - lib/usageStore.js
// One shared read of this workspace's licence and usage.
//
// Two endpoints, two audiences (see server/routes/usage.js):
//   /api/usage/licence  every signed-in user — powers the read-only banner
//   /api/usage          Admin only — powers the usage card and the threshold
//                       banner, so 403 for everyone else is expected, not an error
//
// Kept in a store rather than fetched per page because the banner renders inside
// AppShell, i.e. on every screen: a per-page fetch would mean one request per
// navigation for a number that changes hourly at most.

import { useEffect, useSyncExternalStore } from 'react'
import { api, getToken } from '../utils/api'

let state = { licence: null, usage: null, loading: true, usageLoading: false, error: '', canManage: false }
let lastFetchedAt = 0
let inflight = null
let inflightWithUsage = false
let queuedUsageFetch = null
// Which session the cached numbers belong to. Signing in as somebody else must
// not leave the previous tenant's licence on screen.
let cacheToken = null

const listeners = new Set()
const emit = () => { for (const l of listeners) l() }
const setState = (patch) => { state = { ...state, ...patch }; emit() }

// Long interval on purpose: usage moves when somebody submits something, and the
// meters are indicative rather than a live counter. Refresh explicitly after an
// action that changes them.
const POLL_MS = 5 * 60 * 1000
let pollTimer = null

const fetchAll = async ({ withUsage = state.canManage } = {}) => {
  if (inflight) {
    if (withUsage && !inflightWithUsage) {
      if (!queuedUsageFetch) {
        queuedUsageFetch = inflight
          .then(() => fetchAll({ withUsage: true }))
          .finally(() => { queuedUsageFetch = null })
      }
      return queuedUsageFetch
    }
    return inflight
  }
  if (!getToken()) {
    setState({ loading: false, usageLoading: false })
    return null
  }
  inflightWithUsage = Boolean(withUsage)
  inflight = (async () => {
    try {
      const lic = await api.get('/api/usage/licence')
      const patch = { licence: lic.licence || null, loading: false, error: '' }

      if (withUsage) {
        try {
          const res = await api.get('/api/usage')
          patch.usage = res.usage || null
          patch.trend = res.trend || []
          patch.canManage = true
          patch.usageLoading = false
        } catch (err) {
          // A non-admin simply has no business seeing the meters.
          patch.usageLoading = false
          if (err?.status === 403) {
            patch.canManage = false
            patch.usage = null
          }
          else patch.error = err?.message || ''
        }
      }
      lastFetchedAt = Date.now()
      cacheToken = getToken()
      setState(patch)
      return state
    } catch (err) {
      setState({
        loading: false,
        usageLoading: withUsage ? false : state.usageLoading,
        error: err?.message || 'Could not read the licence state'
      })
      return null
    } finally {
      inflight = null
      inflightWithUsage = false
    }
  })()
  return inflight
}

const isStale = () => cacheToken !== getToken() || Date.now() - lastFetchedAt > POLL_MS

export const usageStore = {
  subscribe(listener) {
    listeners.add(listener)
    if (isStale()) fetchAll().catch(() => {})
    if (!pollTimer) pollTimer = setInterval(() => fetchAll().catch(() => {}), POLL_MS)
    return () => {
      listeners.delete(listener)
      if (listeners.size === 0 && pollTimer) {
        clearInterval(pollTimer)
        pollTimer = null
      }
    }
  },
  getSnapshot() {
    return state
  },
  // Called by the pages that can actually read the meters, so the extra request
  // is only made for an Admin.
  enableUsage() {
    if (state.canManage && state.usage) return
    setState({ canManage: true, usageLoading: true, error: '' })
    fetchAll({ withUsage: true }).catch(() => {})
  },
  refresh(opts) {
    lastFetchedAt = 0
    if (opts?.withUsage) setState({ usageLoading: true, error: '' })
    return fetchAll(opts)
  },
  // A provider page can reconcile the persisted counters without needing to
  // fetch the full licensing payload again. Mark this snapshot stale so the
  // next usage consumer (for example Dashboard) reads the reconciled value.
  invalidate() {
    lastFetchedAt = 0
  },
  clear() {
    state = { licence: null, usage: null, loading: true, usageLoading: false, error: '', canManage: false }
    lastFetchedAt = 0
    cacheToken = null
    queuedUsageFetch = null
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null }
    emit()
  }
}

export function useLicensing() {
  const snapshot = useSyncExternalStore(usageStore.subscribe, usageStore.getSnapshot, usageStore.getSnapshot)
  useEffect(() => { if (isStale()) fetchAll().catch(() => {}) })
  return snapshot
}

// True while the workspace refuses new work. Pages use it to disable a create
// button rather than let somebody fill in a form that cannot be saved.
export function useReadOnly() {
  const { licence } = useLicensing()
  return Boolean(licence?.readOnly)
}

// For pages that render the meters: asks for the admin payload on mount.
export function useUsage() {
  const snapshot = useLicensing()
  useEffect(() => { usageStore.enableUsage() }, [])
  return { ...snapshot, loading: snapshot.loading || snapshot.usageLoading }
}
