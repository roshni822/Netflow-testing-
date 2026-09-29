// Application demo store. Auto-starts once per signed-in user (any role) until
// they Skip or Done. Local completion key is the gate — not role or needsProductTour.

import { useSyncExternalStore } from 'react'

const DONE_KEY = (userId) => `fs.userGuide.completed.${userId}`

let state = {
  tourOpen: false,
  steps: [],
  stepIndex: 0,
  mode: null, // 'forced' | 'full' | 'page'
}

const listeners = new Set()
const emit = () => { for (const l of listeners) l() }

function setState(patch) {
  state = { ...state, ...patch }
  emit()
}

export function hasCompletedTour(userId) {
  if (!userId) return true
  try {
    return localStorage.getItem(DONE_KEY(userId)) === '1'
  } catch {
    return true
  }
}

export function markTourCompleted(userId) {
  if (!userId) return
  try { localStorage.setItem(DONE_KEY(userId), '1') } catch { /* ignore */ }
}

/** True for any role on first visit after password setup, until Skip/Done. */
export function shouldAutoStartTour(user) {
  if (!user) return false
  if (user.mustChangePassword) return false
  const userId = user._id != null ? String(user._id) : (user.id != null ? String(user.id) : '')
  if (!userId) return false
  if (hasCompletedTour(userId)) return false
  return true
}

export const userGuideStore = {
  subscribe(listener) {
    listeners.add(listener)
    return () => listeners.delete(listener)
  },
  getSnapshot() {
    return state
  },
  startTour(steps, mode = 'full') {
    if (!steps?.length) return
    setState({
      tourOpen: true,
      steps,
      stepIndex: 0,
      mode,
    })
  },
  setStepIndex(stepIndex) {
    setState({ stepIndex })
  },
  next() {
    const { stepIndex, steps } = state
    if (stepIndex >= steps.length - 1) return
    setState({ stepIndex: stepIndex + 1 })
  },
  prev() {
    if (state.stepIndex <= 0) return
    setState({ stepIndex: state.stepIndex - 1 })
  },
  stopTour() {
    setState({
      tourOpen: false,
      steps: [],
      stepIndex: 0,
      mode: null,
    })
  },
}

export function useUserGuide() {
  return useSyncExternalStore(
    userGuideStore.subscribe,
    userGuideStore.getSnapshot,
    userGuideStore.getSnapshot,
  )
}
