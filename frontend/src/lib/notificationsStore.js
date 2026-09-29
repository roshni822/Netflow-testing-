// M3 - Phase 2 - notificationsStore.js
// API-backed notifications with 30s polling. Same hook surface as Phase 1.
// New unread items also fire a top-right toast (SaaS-style alert).

import { useEffect, useSyncExternalStore } from 'react'
import { api } from '../utils/api'
import { adaptNotification } from '../utils/adapters'
import { toast } from './toastStore'

let cache = []
let unreadCount = 0
let lastFetchedAt = 0
let inflight = null
// Skip toast spam on the very first load / after login.
let seenIds = null
// Kept as a single frozen object so useSyncExternalStore sees a stable
// reference between renders and only re-renders when it actually changes.
let status = { loading: true, error: '' }
const listeners = new Set()
const emit = () => { for (const l of listeners) l() }

// One shared poll for the whole app. The bell, the unread badge and the
// notifications page all subscribe, and each used to own a 30s interval, so the
// API was really being hit every ~10s.
const POLL_MS = 30000
let pollTimer = null
const startPolling = () => {
  if (pollTimer) return
  pollTimer = setInterval(() => fetchAll().catch(() => {}), POLL_MS)
}
const stopPolling = () => {
  if (!pollTimer) return
  clearInterval(pollTimer)
  pollTimer = null
}

function toastNewArrivals(next) {
  if (seenIds == null) {
    seenIds = new Set(next.map((n) => n.id))
    return
  }
  const fresh = next.filter((n) => !n.read && !seenIds.has(n.id))
  for (const id of next.map((n) => n.id)) seenIds.add(id)
  // Cap so a bulk import doesn't flood the corner.
  for (const n of fresh.slice(0, 3)) {
    const label = n.title ? `${n.title}: ${n.message}` : n.message
    toast.info(label || 'New notification', 6000)
  }
  if (fresh.length > 3) {
    toast.info(`${fresh.length - 3} more new notifications`, 5000)
  }
}

const fetchAll = async () => {
  if (inflight) return inflight
  inflight = (async () => {
    try {
      const data = await api.get('/api/notifications')
      const next = (data.notifications || []).map(adaptNotification)
      toastNewArrivals(next)
      cache = next
      unreadCount = data.unreadCount ?? cache.filter((n) => !n.read).length
      lastFetchedAt = Date.now()
      status = { loading: false, error: '' }
      emit()
      return cache
    } catch (err) {
      status = { loading: false, error: err.message || 'Could not load notifications' }
      emit()
      throw err
    } finally {
      inflight = null
    }
  })()
  return inflight
}

export const notificationsStore = {
  subscribe(listener) {
    listeners.add(listener)
    if (Date.now() - lastFetchedAt > POLL_MS) fetchAll().catch(() => {})
    startPolling()
    return () => {
      listeners.delete(listener)
      if (listeners.size === 0) stopPolling()
    }
  },
  getSnapshot() {
    return cache
  },
  getUnreadCount() {
    return unreadCount
  },
  getStatus() {
    return status
  },
  async refresh() {
    return fetchAll()
  },
  async markRead(id) {
    await api.patch(`/api/notifications/${id}/read`)
    cache = cache.map((n) => (n.id === id ? { ...n, read: true } : n))
    unreadCount = cache.filter((n) => !n.read).length
    emit()
  },
  async markAllRead() {
    await api.patch('/api/notifications/mark-all-read')
    cache = cache.map((n) => ({ ...n, read: true }))
    unreadCount = 0
    emit()
  },
  async remove(id) {
    await api.delete(`/api/notifications/${id}`)
    cache = cache.filter((n) => n.id !== id)
    unreadCount = cache.filter((n) => !n.read).length
    emit()
  },
  clear() {
    cache = []
    unreadCount = 0
    lastFetchedAt = 0
    seenIds = null
    status = { loading: true, error: '' }
    stopPolling()
    emit()
  }
}

export function useNotifications() {
  const snapshot = useSyncExternalStore(
    notificationsStore.subscribe,
    notificationsStore.getSnapshot,
    notificationsStore.getSnapshot
  )
  useEffect(() => {
    if (Date.now() - lastFetchedAt > 5000) fetchAll().catch(() => {})
  }, [])
  return snapshot
}

export function useUnreadCount() {
  useNotifications()
  return unreadCount
}

// `{ loading, error }` for the first load, so the list can show skeletons
// instead of an "all caught up" empty state before any data has arrived.
export function useNotificationsStatus() {
  return useSyncExternalStore(
    notificationsStore.subscribe,
    notificationsStore.getStatus,
    notificationsStore.getStatus
  )
}
