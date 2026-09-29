// Shared - themeStore.js
// Light/dark theme, persisted to localStorage and applied as a `.dark` class on
// <html>. A tiny inline script in index.html applies the saved theme before
// first paint (no flash); this store keeps React in sync and handles toggling.

import { useSyncExternalStore } from 'react'
import { flushSync } from 'react-dom'

const KEY = 'fs.theme'
const listeners = new Set()

function readInitial() {
  try {
    const saved = localStorage.getItem(KEY)
    if (saved === 'light' || saved === 'dark') return saved
  } catch { /* storage unavailable */ }
  try {
    if (window.matchMedia?.('(prefers-color-scheme: dark)').matches) return 'dark'
  } catch { /* matchMedia unavailable */ }
  return 'light'
}

let theme = readInitial()
let requestedTheme = theme
let activeTransition = null

function apply(next) {
  try {
    const root = document.documentElement
    root.classList.toggle('dark', next === 'dark')
    root.style.colorScheme = next
  } catch { /* SSR / no document */ }
}

// Reconcile the DOM with the resolved theme (the inline script normally already
// did this, but this covers the OS-preference fallback and StrictMode remounts).
apply(theme)

function emit() {
  listeners.forEach((fn) => fn())
}

function commit(next) {
  theme = next
  try { localStorage.setItem(KEY, theme) } catch { /* storage unavailable */ }
  apply(theme)
  emit()
}

function cancelTransition() {
  const previous = activeTransition
  if (!previous) return
  // Skipping the animation does not cancel its update callback. Invalidate it
  // first so an older request cannot overwrite a newer theme.
  activeTransition = null
  previous.transition?.skipTransition()
  document.documentElement.removeAttribute('data-theme-transition')
}

export const themeStore = {
  get: () => theme,
  set(next) {
    requestedTheme = next === 'dark' ? 'dark' : 'light'
    cancelTransition()
    commit(requestedTheme)
  },
  toggle() {
    const next = requestedTheme === 'dark' ? 'light' : 'dark'
    if (
      activeTransition ||
      typeof document === 'undefined' ||
      typeof document.startViewTransition !== 'function' ||
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    ) {
      // Rapid clicks settle immediately to the latest intent, without queuing
      // animations. Initial load and programmatic set() also remain instant.
      this.set(next)
      return
    }

    requestedTheme = next
    const root = document.documentElement
    const run = { transition: null }
    activeTransition = run

    const finish = () => {
      if (activeTransition !== run) return
      activeTransition = null
      root.removeAttribute('data-theme-transition')
      // The preference must still change if the browser cannot capture a view.
      if (theme !== next) commit(next)
    }

    try {
      run.transition = document.startViewTransition(() => {
        if (activeTransition === run) {
          // Capture only the old view. Keep the new document live underneath
          // it so buttons stay clickable while the old palette wipes away.
          root.setAttribute('data-theme-transition', next)
          // Synchronize React icons and CSS colors before revealing the view.
          flushSync(() => commit(next))
        }
      })
      // ready rejects when a transition is skipped (including rapid clicks).
      run.transition.ready.catch(() => {})
      run.transition.updateCallbackDone.catch(() => {})
      run.transition.finished.then(finish, finish)
    } catch {
      finish()
    }
  },
  subscribe(fn) {
    listeners.add(fn)
    return () => listeners.delete(fn)
  },
}

export function useTheme() {
  return useSyncExternalStore(themeStore.subscribe, themeStore.get, () => 'light')
}
