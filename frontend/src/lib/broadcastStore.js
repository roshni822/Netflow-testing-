import { useSyncExternalStore } from 'react'
import { api } from '../utils/api'

const POLL_MS = 60000
const DISMISS_PREFIX = 'netflow.broadcast.dismissed.'

let current = null
let inflight = null
let pollTimer = null
let expiryTimer = null
const listeners = new Set()

const emit = () => { for (const listener of listeners) listener() }

const dismissed = (broadcast) => {
  if (!broadcast?._id) return false
  try { return localStorage.getItem(`${DISMISS_PREFIX}${broadcast._id}`) === '1' } catch { return false }
}

const scheduleExpiry = () => {
  if (expiryTimer) clearTimeout(expiryTimer)
  expiryTimer = null
  if (!current?.expiresAt) return
  const delay = new Date(current.expiresAt).getTime() - Date.now()
  if (delay <= 0) {
    current = null
    emit()
    return
  }
  expiryTimer = setTimeout(() => {
    expiryTimer = null
    const remaining = new Date(current?.expiresAt || 0).getTime() - Date.now()
    if (remaining > 0) scheduleExpiry()
    else {
      current = null
      emit()
    }
  }, Math.min(delay, 2147483647))
}

const setCurrent = (broadcast) => {
  const expires = broadcast?.expiresAt ? new Date(broadcast.expiresAt).getTime() : 0
  current = broadcast && expires > Date.now() && !dismissed(broadcast) ? broadcast : null
  scheduleExpiry()
  emit()
}

const fetchActive = async () => {
  if (inflight) return inflight
  inflight = api.get('/api/broadcasts/active')
    .then((data) => {
      setCurrent(data.broadcast || null)
      return current
    })
    .finally(() => { inflight = null })
  return inflight
}

const startPolling = () => {
  if (pollTimer) return
  pollTimer = setInterval(() => fetchActive().catch(() => {}), POLL_MS)
}

const stopPolling = () => {
  if (pollTimer) clearInterval(pollTimer)
  pollTimer = null
}

export const broadcastStore = {
  subscribe(listener) {
    listeners.add(listener)
    if (listeners.size === 1) {
      fetchActive().catch(() => {})
      startPolling()
    }
    return () => {
      listeners.delete(listener)
      if (listeners.size === 0) stopPolling()
    }
  },
  getSnapshot: () => current,
  refresh: fetchActive,
  publish: setCurrent,
  dismiss() {
    if (current?._id) {
      try { localStorage.setItem(`${DISMISS_PREFIX}${current._id}`, '1') } catch { /* storage unavailable */ }
    }
    current = null
    scheduleExpiry()
    emit()
  }
}

export const useActiveBroadcast = () =>
  useSyncExternalStore(broadcastStore.subscribe, broadcastStore.getSnapshot, broadcastStore.getSnapshot)
