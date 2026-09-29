// Shared - toastStore.js
// Dependency-free toasts using the same useSyncExternalStore pattern as
// notificationsStore. Mount <Toaster/> once near the app root, then call
// toast.success() / toast.error() / toast.info() from anywhere.

import { useSyncExternalStore } from 'react'

let toasts = []
const listeners = new Set()
const emit = () => { for (const l of listeners) l() }
let seq = 0

function addToast(message, type = 'info', duration) {
  const id = ++seq
  // Errors linger a little longer than success/info so they aren't missed.
  const ttl = duration ?? (type === 'error' ? 6000 : 4000)
  toasts = [...toasts, { id, message, type }]
  emit()
  if (ttl > 0) setTimeout(() => removeToast(id), ttl)
  return id
}

function removeToast(id) {
  toasts = toasts.filter((t) => t.id !== id)
  emit()
}

export const toast = {
  success: (msg, d) => addToast(msg, 'success', d),
  error:   (msg, d) => addToast(msg, 'error', d),
  info:    (msg, d) => addToast(msg, 'info', d),
  dismiss: removeToast,
}

function subscribe(listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
function getSnapshot() {
  return toasts
}

export function useToasts() {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}
