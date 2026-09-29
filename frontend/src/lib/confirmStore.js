// Shared - confirmStore.js
// Promise-based confirmation dialog, using the same useSyncExternalStore
// pattern as toastStore/notificationsStore. Mount <ConfirmDialog/> once near
// the app root, then `await confirm({ title, message, confirmLabel, danger })`
// anywhere; it resolves to true (accepted) or false (cancelled/dismissed).

import { useSyncExternalStore } from 'react'

let state = null // { title, message, confirmLabel, cancelLabel, danger, resolve }
const listeners = new Set()
const emit = () => { for (const l of listeners) l() }

export function confirm(opts = {}) {
  return new Promise((resolve) => {
    // If a dialog is already open, resolve it false before replacing it.
    if (state) state.resolve(false)
    state = {
      title: opts.title || 'Are you sure?',
      message: opts.message || '',
      confirmLabel: opts.confirmLabel || 'Confirm',
      cancelLabel: opts.cancelLabel || 'Cancel',
      danger: opts.danger ?? true,
      resolve,
    }
    emit()
  })
}

function settle(result) {
  if (!state) return
  const r = state.resolve
  state = null
  emit()
  r(result)
}

export const confirmController = {
  accept: () => settle(true),
  cancel: () => settle(false),
}

function subscribe(listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
function getSnapshot() {
  return state
}

export function useConfirmState() {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}
